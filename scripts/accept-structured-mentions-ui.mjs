import { createHash } from 'node:crypto'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { seedCompletedOnboardingForAcceptance } from './lib/dev-desktop.mjs'
import { removeEphemeralRuntimeCampFilesRoot } from './lib/runtime-camp-files-root.mjs'

const root = resolve(import.meta.dirname, '..')
const cliArguments = process.argv.slice(2)
const suppliedAppPath = cliArguments.find((argument) => !argument.startsWith('--'))
const appPath = resolve(
  suppliedAppPath ?? join(root, 'dist', 'mac-arm64', 'Rovai AI.app')
)
const suppliedFixtureRoot = process.env.ROVAI_STRUCTURED_MENTIONS_ACCEPT_DATA_DIR
const fixtureRoot = suppliedFixtureRoot
  ? resolve(suppliedFixtureRoot)
  : await mkdtemp(join(tmpdir(), 'rovai-structured-mentions-ui-accept-'))
const dataDir = join(fixtureRoot, 'user-data')
const suppliedRuntimeTempDir = process.env.ROVAI_STRUCTURED_MENTIONS_ACCEPT_RUNTIME_TMP
const runtimeTempDir = suppliedRuntimeTempDir
  ? resolve(suppliedRuntimeTempDir)
  // The Core owns Unix sockets below TMPDIR. Keep the unique root short enough
  // for sockaddr_un.sun_path on macOS.
  : await mkdtemp('/tmp/rv-sm-')
const suppliedOutputDir = process.env.ROVAI_STRUCTURED_MENTIONS_ACCEPT_OUTPUT_DIR
const outputDir = suppliedOutputDir
  ? resolve(suppliedOutputDir)
  : await mkdtemp(join(tmpdir(), 'rovai-structured-mentions-ui-captures-'))
const acceptanceHome = join(fixtureRoot, 'home')
const debugPort = Number(process.env.ROVAI_STRUCTURED_MENTIONS_ACCEPT_DEBUG_PORT ?? 9491)
const skillPickerOnly = cliArguments.includes('--skill-picker-only')
const skillContextSmoke = cliArguments.includes('--skill-context-smoke')
const imeNewlineOnly = cliArguments.includes('--ime-newline-only')
const cutOnly = cliArguments.includes('--cut-only')
const continuationOnly = cliArguments.includes('--continuation-only')
const replyBackspaceOnly = cliArguments.includes('--reply-backspace-only')
const databasePath = join(dataDir, 'rovai.sqlite')
const acceptanceExecutablePath = skillContextSmoke
  ? join(runtimeTempDir, 'codex-acceptance-runtime.mjs')
  : '/usr/bin/true'
const targetMembers = [
  { agentId: 'agent_1', displayName: '叮叮', teamRole: '游学者' },
  { agentId: 'agent_2', displayName: '芝士', teamRole: '鉴定士' },
  { agentId: 'agent_3', displayName: '咕咕', teamRole: '巡夜人' }
]
const targetMemberIds = targetMembers.map((member) => member.agentId)
const expectedContent = [
  { kind: 'text', text: '请同时检查这条消息：' },
  { kind: 'member_mention', agentId: 'agent_1' },
  { kind: 'text', text: ' ' },
  { kind: 'member_mention', agentId: 'agent_2' },
  { kind: 'text', text: ' ' },
  { kind: 'member_mention', agentId: 'agent_3' },
  { kind: 'text', text: ' ，请给出结论。' }
]
const expectedComposerDocument = composerDocumentFromStructured(expectedContent)
const emptyComposerDocument = { version: 2, segments: [] }
const expectedBody = '请同时检查这条消息：@叮叮 @芝士 @咕咕 ，请给出结论。'
const currentUserMentionMessageId = 'message-current-user-mention-accept'
const currentUserMentionText = '请选择 v0.65 的方案，并逐项说明交互状态、接收者变化、异常分支、键盘焦点、发送前校验以及消息引用在窄窗口下的表现，最后给出可以直接进入开发的结论和风险清单。'
const currentUserMentionBody = `@你 ${currentUserMentionText}`
const currentUserMentionContent = [
  { kind: 'current_user_mention', userId: 'local_user' },
  { kind: 'text', text: currentUserMentionText }
]
const agentMemberMentionMessageId = 'message-agent-member-mention-accept'
const agentLiteralMentionMessageId = 'message-agent-literal-mention-accept'
const agentMemberMentionText = [
  ' review 结论：**通过**。请检查开头的队员 Mention。',
  '',
  '## 事实复核',
  '',
  '- 保留列表与 `行内代码`',
  '- 保留 [验收说明](docs/plan.md) 文件链接',
  '',
  '```sh',
  'pnpm test',
  '```',
  '',
  '| 检查项 | 结果 |',
  '| --- | --- |',
  '| Markdown | PASS |'
].join('\n')
const agentMemberMentionBody = `@叮叮${agentMemberMentionText}`
const agentMemberMentionContent = [
  { kind: 'member_mention', agentId: 'agent_1' },
  { kind: 'text', text: agentMemberMentionText }
]
const agentLiteralMentionBody = '@叮叮 是普通文字，不应打开人物信息卡。'
const acceptanceModelCatalog = JSON.stringify([{
  id: 'gpt-structured-mentions-accept',
  displayName: 'Structured Mentions Acceptance Runtime',
  isDefault: true,
  hidden: false,
  deprecated: false,
  options: []
}])
const acceptanceCapabilities = JSON.stringify([
  'app_server.initialize',
  'model.list',
  'structured_permission_request'
])
const acceptanceProtocols = JSON.stringify(['codex-app-server-v2'])
const acceptancePermissionOptions = JSON.stringify([
  {
    key: 'sandbox_mode',
    label: 'Sandbox',
    description: '',
    valueType: 'enum',
    choices: [{ value: 'workspace-write', label: 'workspace-write' }],
    recommendedValue: 'workspace-write',
    scope: 'session',
    risk: 'normal',
    supported: true,
    required: true,
    unsupportedReason: null
  },
  {
    key: 'approval_policy',
    label: 'Approval policy',
    description: '',
    valueType: 'enum',
    choices: [{ value: 'on-request', label: 'on-request' }],
    recommendedValue: 'on-request',
    scope: 'session',
    risk: 'normal',
    supported: true,
    required: true,
    unsupportedReason: null
  }
])

await access(join(appPath, 'Contents', 'MacOS', 'Rovai AI'))
await mkdir(dataDir, { recursive: true })
seedCompletedOnboardingForAcceptance(dataDir)
await mkdir(acceptanceHome, { recursive: true })
await mkdir(runtimeTempDir, { recursive: true })
await mkdir(outputDir, { recursive: true })
if (skillContextSmoke) {
  await writeFile(acceptanceExecutablePath, fakeCodexAcceptanceRuntime(), { mode: 0o755 })
}
const acceptanceExecutableFingerprint = `sha256:${createHash('sha256')
  .update(await readFile(acceptanceExecutablePath))
  .digest('hex')}`

let running = null
let clipboardArchive = null
let clipboardTouched = false
let clipboardRestored = false
let testFailure = null
let cleanupFailure = null
let result = null

try {
  acceptance: {
  // Clipboard mutation is forbidden unless the complete macOS Pasteboard can be
  // archived first. The archive includes every item, flavor, and byte payload.
  clipboardArchive = await snapshotClipboard()

  running = await launchApp(dataDir, debugPort, 1440, 920)
  await setTheme(running.cdp, 'day')
  const freshAgents = await request(running.cdp, 'members.list')
  assert(
    targetMemberIds.every((id) => freshAgents.some((agent) =>
      agent.agentId === id && agent.presence === 'present')),
    `Fresh database is missing a target member: ${JSON.stringify(freshAgents)}`
  )
  await closeApp(running)
  running = null

  // Runtime fixture installation is performed only while the isolated App and
  // Core are fully stopped. /usr/bin/true is executable and fingerprinted, but
  // cannot call a model or access user projects.
  await installAcceptanceRuntime(databasePath, targetMemberIds)

  running = await launchApp(dataDir, debugPort, 1440, 920)
  await setTheme(running.cdp, 'day')
  const configuredAgents = await request(running.cdp, 'members.list')
  assert(
    targetMemberIds.every((id) => configuredAgents.some((agent) =>
      agent.agentId === id
      && ['ready', 'light_ready'].includes(agent.runtimeReadiness.status)
      && agent.runtimeConfiguration?.adapterKind === 'codex-cli')),
    `Acceptance Runtime is not ready for every target: ${JSON.stringify(configuredAgents)}`
  )
  const installedSkills = await request(running.cdp, 'skills.list')
  let selectableSkill = installedSkills.find((skill) =>
    skill.name === 'analyze-agent-codebase'
    && skill.enabled
    && skill.lifecycleStatus === 'active')
    ?? installedSkills.find((skill) => skill.enabled && skill.lifecycleStatus === 'active')
  assert(selectableSkill, `No active enabled Skill is available: ${JSON.stringify(installedSkills)}`)
  if (!selectableSkill.groupAssignments.some((assignment) =>
    assignment.groupKey === 'codex'
    && assignment.revisionId === selectableSkill.currentRevision.id)) {
    const assignment = await request(running.cdp, 'skills.setGroupAssignments', {
      commandId: crypto.randomUUID(),
      command: {
        skillId: selectableSkill.id,
        expectedVersion: selectableSkill.version,
        groupKeys: [...new Set([
          ...selectableSkill.groupAssignments.map((value) => value.groupKey),
          'codex'
        ])]
      }
    })
    assert(assignment.status === 'applied',
      `Could not assign the acceptance Skill to Codex: ${JSON.stringify(assignment)}`)
    selectableSkill = await request(running.cdp, 'skills.get', { skillId: selectableSkill.id })
  }

  const created = await request(running.cdp, 'camps.create', {
    commandId: crypto.randomUUID(),
    name: '结构化提及 UI 验收',
    workspace: null,
    memberAgentIds: targetMemberIds,
    defaultLeadAgentId: targetMemberIds[0],
    collaborationMode: 'peer'
  })
  assert(created.status === 'applied', `Three-member Camp creation failed: ${JSON.stringify(created)}`)
  const campId = created.payload?.campId
  assert(typeof campId === 'string' && campId.length > 0, 'Camp creation returned no campId')

  // The Core request above bypasses App.createCamp, so reload before selecting
  // the newly materialized navigation row.
  await reloadRenderer(running.cdp)
  await openCamp(running.cdp, campId)
  await mouseClick(running.cdp, '.camp-conversation-view-controls button:first-child')
  await waitForExpression(running.cdp, `(() => {
    const button = document.querySelector('.camp-conversation-view-controls button:first-child')
    const timeline = document.querySelector('.camp-timeline')
    return button?.getAttribute('aria-pressed') === 'true' && !timeline?.hidden
  })()`)
  const initialSnapshot = await request(running.cdp, 'camps.snapshot', { campId })
  assert(initialSnapshot.schemaVersion === 34,
    `Camp snapshot schema is not v34: ${initialSnapshot.schemaVersion}`)
  assert(
    deepEqual(initialSnapshot.members.map((member) => member.agentId), targetMemberIds),
    `Camp does not contain exactly the three target members: ${JSON.stringify(initialSnapshot.members)}`
  )

  await waitForSelector(running.cdp, '#camp-message.structured-mention-editor')
  await waitForExpression(running.cdp,
    `document.querySelector('#camp-message')?.getAttribute('contenteditable') === 'true'`)
  if (cutOnly) {
    clipboardTouched = true
    const composerCutInspection = await acceptComposerCutRegression(running.cdp, campId)
    result = {
      acceptance: 'composer-cut-ui',
      appPath,
      campId,
      ...composerCutInspection,
      clipboardItemCountBeforeTest: clipboardArchive.length,
      clipboardRestored: false,
      isolatedUserDataRemoved: false
    }
    break acceptance
  }
  if (imeNewlineOnly) {
    const imeNewlineInspection = await acceptImeNewlineRegression(running.cdp, campId)
    result = {
      acceptance: 'composer-ime-newline-ui',
      appPath,
      campId,
      ...imeNewlineInspection,
      clipboardItemCountBeforeTest: clipboardArchive.length,
      clipboardRestored: false,
      isolatedUserDataRemoved: false
    }
    break acceptance
  }
  clipboardTouched = true
  await acceptComposerCutRegression(running.cdp, campId)
  const inlineSkillInspection = await acceptInlineSkillQueries(running.cdp, campId, selectableSkill)
  await focusEditorAtEnd(running.cdp)
  await running.cdp.send('Input.insertText', { text: '/' })
  await waitForExpression(running.cdp, `(() => {
    const menu = document.querySelector('.structured-skill-menu, .skill-picker-menu')
    const option = menu?.querySelector('[data-skill-name=${JSON.stringify(selectableSkill.name)}]')
    return document.querySelector('#camp-message')?.textContent === '/'
      && document.querySelector('#camp-message')?.getAttribute('aria-expanded') === 'true'
      && menu?.getAttribute('role') === 'listbox'
      && Boolean(option)
  })()`, 10_000)
  const skillPickerInspection = await evaluate(running.cdp, `(() => {
    const editor = document.querySelector('#camp-message')
    const menu = document.querySelector('.skill-picker-menu')
    const option = menu?.querySelector('[data-skill-name=${JSON.stringify(selectableSkill.name)}]')
    const mark = option?.querySelector('.skill-identity-mark.is-compact')
    if (!(editor instanceof HTMLElement)
        || !(menu instanceof HTMLElement)
        || !(option instanceof HTMLElement)
        || !(mark instanceof HTMLElement)) return null
    const menuRect = menu.getBoundingClientRect()
    const editorRect = editor.getBoundingClientRect()
    const menuStyle = getComputedStyle(menu)
    const optionStyle = getComputedStyle(option)
    const markStyle = getComputedStyle(mark)
    return {
      menuLabel: menu.getAttribute('aria-label'),
      menuRole: menu.getAttribute('role'),
      optionRole: option.getAttribute('role'),
      optionName: option.dataset.skillName,
      command: option.querySelector('strong')?.textContent ?? null,
      description: option.querySelector('small')?.textContent ?? null,
      menuAboveEditor: menuRect.bottom <= editorRect.top - 5,
      maxHeight: menuStyle.maxHeight,
      optionMinHeight: optionStyle.minHeight,
      markSize: [markStyle.width, markStyle.height],
      markText: mark.textContent,
      markAriaHidden: mark.getAttribute('aria-hidden'),
      markIdentity: mark.style.getPropertyValue('--skill-identity').trim(),
      markColor: markStyle.color,
      viewportFits: menuRect.left >= 0 && menuRect.right <= innerWidth
    }
  })()`)
  assert(
    skillPickerInspection
      && skillPickerInspection.menuLabel === '选择 Skill'
      && skillPickerInspection.menuRole === 'listbox'
      && skillPickerInspection.optionRole === 'option'
      && skillPickerInspection.optionName === selectableSkill.name
      && skillPickerInspection.command === `/${selectableSkill.name}`
      && skillPickerInspection.description === selectableSkill.currentRevision.description
      && skillPickerInspection.menuAboveEditor
      && Number.parseFloat(skillPickerInspection.maxHeight) === 310
      && Number.parseFloat(skillPickerInspection.optionMinHeight) >= 46
      && skillPickerInspection.markSize.every((value) => Number.parseFloat(value) === 28)
      && skillPickerInspection.markText
      && skillPickerInspection.markText !== '/'
      && skillPickerInspection.markAriaHidden === 'true'
      && skillPickerInspection.markIdentity.startsWith('var(--identity-')
      && skillPickerInspection.markColor.length > 0
      && skillPickerInspection.viewportFits,
    `Skill picker does not match the accepted native dropdown: ${JSON.stringify(skillPickerInspection)}`
  )
  const skillPickerCapture = join(outputDir, 'composer-skill-picker.png')
  await capture(running.cdp, skillPickerCapture)
  await moveMouseToElement(running.cdp,
    `.skill-picker-menu [data-skill-name=${JSON.stringify(selectableSkill.name)}]`)
  await waitForExpression(running.cdp,
    `document.querySelector('.skill-picker-menu [data-skill-name=${JSON.stringify(selectableSkill.name)}]')?.getAttribute('aria-selected') === 'true'`)
  await pressKey(running.cdp, {
    key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 36
  })
  const selectedSkillText = `/${selectableSkill.name} `
  await waitForExpression(running.cdp, `(() => {
    const editor = document.querySelector('#camp-message')
    const token = editor?.querySelector('[data-token-kind="skill_mention"]')
    return editor?.textContent === ${JSON.stringify(`/${selectableSkill.name} `)}
      && editor.getAttribute('aria-expanded') === 'false'
      && document.activeElement === editor
      && token?.getAttribute('contenteditable') === 'false'
      && token?.getAttribute('data-skill-id') === ${JSON.stringify(selectableSkill.id)}
      && token?.getAttribute('data-skill-name') === ${JSON.stringify(selectableSkill.name)}
  })()`)
  const selectedSkillContent = [
    { kind: 'skill_mention', skillId: selectableSkill.id, nameAtSend: selectableSkill.name },
    { kind: 'text', text: ' ' }
  ]
  const selectedSkillDraft = await waitForValue(async () =>
    request(running.cdp, 'camp.composerDraft.get', { campId }), (draft) =>
    deepEqual(draft.content, selectedSkillContent), 10_000)
  assert(selectedSkillDraft.body === selectedSkillText,
    `Selected Skill identity or body projection was not persisted: ${JSON.stringify(selectedSkillDraft)}`)

  if (skillContextSmoke) {
    const smokeSuffix = '验证文件链接'
    await focusEditorAtEnd(running.cdp)
    await running.cdp.send('Input.insertText', { text: smokeSuffix })
    const smokeBody = `/${selectableSkill.name} ${smokeSuffix}`
    const smokeContent = [
      { kind: 'skill_mention', skillId: selectableSkill.id, nameAtSend: selectableSkill.name },
      { kind: 'text', text: ` ${smokeSuffix}` }
    ]
    await waitForValue(async () => request(running.cdp, 'camp.composerDraft.get', { campId }),
      (draft) => draft.body === smokeBody && deepEqual(draft.content, smokeContent), 10_000)
    await mouseClick(running.cdp, '.composer .composer-send')

    const smokeSnapshot = await waitForValue(async () =>
      request(running.cdp, 'camps.snapshot', { campId }), (snapshot) => {
      const message = snapshot.messages.find((candidate) =>
        candidate.authorType === 'user' && deepEqual(candidate.content, smokeContent))
      const turn = message
        ? snapshot.turns.find((candidate) => candidate.triggerId === message.id)
        : null
      const run = turn
        ? snapshot.agentRuns.find((candidate) => candidate.campTurnId === turn.id)
        : null
      const manifest = run
        ? snapshot.contextManifests.find((candidate) => candidate.agentRunId === run.id)
        : null
      return run?.status === 'succeeded'
        && manifest?.delivery?.status === 'accepted'
        && manifest.currentInputSkillResolution.entries.length === 1
        && manifest.currentInputSkillResolution.entries[0].outcome === 'included'
    }, 60_000)
    const smokeMessage = smokeSnapshot.messages.find((candidate) =>
      candidate.authorType === 'user' && deepEqual(candidate.content, smokeContent))
    const smokeTurn = smokeSnapshot.turns.find((candidate) =>
      candidate.triggerId === smokeMessage?.id)
    const smokeRun = smokeSnapshot.agentRuns.find((candidate) =>
      candidate.campTurnId === smokeTurn?.id)
    const smokeManifest = smokeSnapshot.contextManifests.find((candidate) =>
      candidate.agentRunId === smokeRun?.id)
    assert(smokeMessage?.body === smokeBody,
      `Structured Skill message body changed: ${JSON.stringify(smokeMessage)}`)
    assert(smokeRun && smokeManifest,
      `Structured Skill Run or Manifest is missing: ${JSON.stringify(smokeSnapshot)}`)
    const resolution = smokeManifest.currentInputSkillResolution
    const resolvedEntry = resolution.entries[0]
    assert(
      resolvedEntry.nameAtSend === selectableSkill.name
        && resolvedEntry.outcome === 'included'
        && typeof resolvedEntry.path === 'string'
        && resolvedEntry.path.endsWith('/SKILL.md'),
      `Structured Skill resolution is not included: ${JSON.stringify(resolution)}`
    )
    await access(resolvedEntry.path)
    const sentSkillCapture = join(outputDir, 'structured-skill-context-sent.png')
    await capture(running.cdp, sentSkillCapture)

    await closeApp(running)
    running = null
    const manifestRows = await runSqlJson(databasePath, `
      SELECT
        run.skill_selection_snapshot_json AS selectionSnapshotJson,
        run.skill_selection_snapshot_digest AS selectionSnapshotDigest,
        manifest.current_input_skill_resolution_json AS resolutionJson,
        manifest.current_input_skill_resolution_digest AS resolutionDigest,
        manifest.rendered_payload_digest AS renderedPayloadDigest,
        blob.sha256 AS blobSha256,
        blob.storage_relative_path AS storageRelativePath
      FROM context_manifest AS manifest
      JOIN agent_run AS run ON run.id = manifest.agent_run_id
      JOIN managed_blob AS blob ON blob.id = manifest.rendered_payload_blob_id
      WHERE manifest.agent_run_id = ${sqlLiteral(smokeRun.id)};
    `)
    assert(manifestRows.length === 1,
      `Structured Skill ContextManifest row is missing: ${JSON.stringify(manifestRows)}`)
    const persisted = manifestRows[0]
    const selection = JSON.parse(persisted.selectionSnapshotJson)
    const persistedResolution = JSON.parse(persisted.resolutionJson)
    assert(selection.entries.length === 1
      && selection.entries[0].skillId === selectableSkill.id
      && selection.entries[0].nameAtSend === selectableSkill.name
      && selection.entries[0].eligibleAtSend === true,
    `Send-time Skill selection is not eligible: ${JSON.stringify(selection)}`)
    assert(deepEqual(persistedResolution, resolution),
      `Persisted Skill resolution differs from the Read Model: ${JSON.stringify(persistedResolution)}`)

    const renderedPayload = await readFile(
      join(dataDir, 'managed-blobs', persisted.storageRelativePath),
      'utf8'
    )
    const renderedPayloadSha256 = createHash('sha256').update(renderedPayload).digest('hex')
    assert(persisted.blobSha256 === renderedPayloadSha256
      && persisted.renderedPayloadDigest === `sha256:${renderedPayloadSha256}`,
    `Rendered payload digest is inconsistent: ${JSON.stringify(persisted)}`)
    const currentInput = extractTaggedJson(renderedPayload, 'CURRENT_INPUT')
    assert(currentInput.message === smokeBody, `CURRENT_INPUT.message changed: ${JSON.stringify(currentInput)}`)
    assert(deepEqual(currentInput.skills, [{
      name: selectableSkill.name,
      path: resolvedEntry.path
    }]), `CURRENT_INPUT.skills is not the resolved sibling: ${JSON.stringify(currentInput)}`)

    result = {
      acceptance: 'composer-skill-context',
      appPath,
      outputDir,
      captures: { skillPicker: skillPickerCapture, sent: sentSkillCapture },
      campId,
      messageId: smokeMessage.id,
      agentRunId: smokeRun.id,
      selectedSkillName: selectableSkill.name,
      structuredContent: smokeMessage.content,
      inlineSkillInspection,
      selectionSnapshotDigest: persisted.selectionSnapshotDigest,
      resolutionDigest: persisted.resolutionDigest,
      renderedPayloadDigest: persisted.renderedPayloadDigest,
      currentInput,
      clipboardItemCountBeforeTest: clipboardArchive.length,
      clipboardRestored: false,
      isolatedUserDataRemoved: false
    }
  } else if (skillPickerOnly) {
    result = {
      acceptance: 'composer-skill-picker-ui',
      appPath,
      outputDir,
      captures: { skillPicker: skillPickerCapture },
      campId,
      selectedSkillName: selectableSkill.name,
      selectedSkillText,
      skillPickerInspection,
      inlineSkillInspection,
      structuredContent: selectedSkillDraft.content,
      clipboardItemCountBeforeTest: clipboardArchive.length,
      clipboardRestored: false,
      isolatedUserDataRemoved: false
    }
  } else if (replyBackspaceOnly) {
    await selectWholeEditor(running.cdp)
    await pressKey(running.cdp, {
      key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 51
    })
    await waitForValue(async () => request(running.cdp, 'camp.composerDraft.get', { campId }),
      (draft) => deepEqual(draft.content, []) && draft.replyIntent === null, 10_000)

    await closeApp(running)
    running = null
    await insertCurrentUserMentionFixture(databasePath, campId)
    running = await launchApp(dataDir, debugPort, 1440, 920)
    await setTheme(running.cdp, 'day')
    await openCamp(running.cdp, campId)
    await mouseClick(running.cdp, '.camp-conversation-view-controls button:first-child')
    await waitForSelector(running.cdp,
      `[data-message-id=${JSON.stringify(currentUserMentionMessageId)}] .message-reply-button`, 30_000)
    await moveMouseToElement(running.cdp,
      `[data-message-id=${JSON.stringify(currentUserMentionMessageId)}] .message-bubble`)
    await mouseClick(running.cdp,
      `[data-message-id=${JSON.stringify(currentUserMentionMessageId)}] .message-reply-button`)
    const availableReplyDraft = await waitForValue(async () =>
      request(running.cdp, 'camp.composerDraft.get', { campId }), (draft) =>
      draft.replyIntent?.replyToCampMessageId === currentUserMentionMessageId
        && draft.replyIntent.author?.authorId === targetMemberIds[0]
        && draft.replyIntent.recipientSelectionRequired === false
        && composerHasMember(draft.content, targetMemberIds[0]), 10_000)

    await focusEditorAtStart(running.cdp)
    await pressKey(running.cdp, {
      key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 51
    })
    const cancelledReplyDraft = await waitForValue(async () =>
      request(running.cdp, 'camp.composerDraft.get', { campId }), (draft) =>
      draft.replyIntent === null && deepEqual(draft.content, availableReplyDraft.content), 10_000)
    await waitForExpression(running.cdp, `(() => {
      const editor = document.querySelector('#camp-message')
      const selection = window.getSelection()
      if (!(editor instanceof HTMLElement)
          || document.activeElement !== editor
          || !selection?.isCollapsed
          || !selection.anchorNode
          || document.querySelector('.composer-reply-line')) return false
      const beforeCaret = document.createRange()
      beforeCaret.selectNodeContents(editor)
      beforeCaret.setEnd(selection.anchorNode, selection.anchorOffset)
      return beforeCaret.toString().length === 0
    })()`)
    const keyboardInspection = await evaluate(running.cdp, `(() => {
      const editor = document.querySelector('#camp-message')
      const selection = window.getSelection()
      if (!(editor instanceof HTMLElement) || !selection?.anchorNode) return null
      const beforeCaret = document.createRange()
      beforeCaret.selectNodeContents(editor)
      beforeCaret.setEnd(selection.anchorNode, selection.anchorOffset)
      return {
        editorFocused: document.activeElement === editor,
        caretCollapsed: selection.isCollapsed,
        caretAtStart: beforeCaret.toString().length === 0,
        replyDockPresent: Boolean(document.querySelector('.composer-reply-line')),
        editorText: editor.textContent
      }
    })()`)
    assert(
      keyboardInspection
        && keyboardInspection.editorFocused
        && keyboardInspection.caretCollapsed
        && keyboardInspection.caretAtStart
        && !keyboardInspection.replyDockPresent
        && keyboardInspection.editorText?.includes(`@${targetMembers[0].displayName}`),
      `Backspace at body start did not preserve the expected editor state: ${JSON.stringify(keyboardInspection)}`
    )

    result = {
      acceptance: 'composer-reply-backspace-ui',
      appPath,
      campId,
      availableReplyDraft,
      cancelledReplyDraft,
      keyboardInspection,
      clipboardItemCountBeforeTest: clipboardArchive.length,
      clipboardRestored: false,
      isolatedUserDataRemoved: false
    }
  } else if (continuationOnly) {
    await selectWholeEditor(running.cdp)
    await pressKey(running.cdp, {
      key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 51
    })
    await waitForValue(async () => request(running.cdp, 'camp.composerDraft.get', { campId }),
      (draft) => deepEqual(draft.content, []), 10_000)
    await waitForExpression(running.cdp, `(() => {
      const rail = document.querySelector('.composer-route-rail')
      const summary = rail?.querySelector('.mention-target-summary')
      return rail?.getAttribute('aria-label') === '接收者路由'
        && summary?.textContent?.trim() === ${JSON.stringify(`默认由 Lead · ${targetMembers[0].displayName}接收`)}
    })()`)
    const defaultRouteInspection = await evaluate(running.cdp, `(() => {
      const rail = document.querySelector('.composer-route-rail')
      const box = document.querySelector('.composer-box')
      const summary = rail?.querySelector('.mention-target-summary')
      const actionRow = box?.querySelector('.composer-action-row')
      const attachmentButton = box?.querySelector('button[aria-label="添加文件"]')
      const fileInput = box?.querySelector('input[type="file"]')
      const composer = box?.closest('.composer')
      if (!(rail instanceof HTMLElement)
          || !(box instanceof HTMLElement)
          || !(summary instanceof HTMLElement)
          || !(actionRow instanceof HTMLElement)
          || !(attachmentButton instanceof HTMLButtonElement)
          || !(fileInput instanceof HTMLInputElement)
          || !(composer instanceof HTMLElement)) return null
      const railRect = rail.getBoundingClientRect()
      const boxRect = box.getBoundingClientRect()
      const composerRect = composer.getBoundingClientRect()
      const composerStyle = getComputedStyle(composer)
      const availableWidth = composerRect.width
        - Number.parseFloat(composerStyle.paddingLeft)
        - Number.parseFloat(composerStyle.paddingRight)
      return {
        railBeforeBox: rail.nextElementSibling === box,
        routeOutsideInput: !box.contains(summary),
        sharedLeftEdge: Math.abs(railRect.left - boxRect.left) < 0.5,
        sharedWidth: Math.abs(railRect.width - boxRect.width) < 0.5,
        boxWidth: boxRect.width,
        fillsResponsiveTrack: Math.abs(boxRect.width - Math.min(1040, availableWidth)) < 1,
        boxDisplay: getComputedStyle(box).display,
        actionRowInsideBox: box.contains(actionRow),
        attachmentLabel: attachmentButton.getAttribute('aria-label'),
        acceptsMultipleFiles: fileInput.multiple,
        fileInputDisplay: getComputedStyle(fileInput).display,
        hasAiBeautifyAction: Boolean(document.querySelector('[aria-label*="美化"]'))
      }
    })()`)
    assert(
      defaultRouteInspection
        && defaultRouteInspection.railBeforeBox
        && defaultRouteInspection.routeOutsideInput
        && defaultRouteInspection.sharedLeftEdge
        && defaultRouteInspection.sharedWidth
        && defaultRouteInspection.boxWidth <= 1041
        && defaultRouteInspection.fillsResponsiveTrack
        && defaultRouteInspection.boxDisplay === 'grid'
        && defaultRouteInspection.actionRowInsideBox
        && defaultRouteInspection.attachmentLabel === '添加文件'
        && defaultRouteInspection.acceptsMultipleFiles
        && defaultRouteInspection.fileInputDisplay === 'none'
        && !defaultRouteInspection.hasAiBeautifyAction,
      `Composer default route rail does not match option A: ${JSON.stringify(defaultRouteInspection)}`
    )
    await focusEditorAtEnd(running.cdp)
    await running.cdp.send('Input.insertText', { text: '@' })
    await waitForExpression(running.cdp, `(() => (
      [...document.querySelectorAll('.structured-mention-menu button[role="option"]')]
        .some((option) => option.querySelector('strong')?.textContent === ${JSON.stringify(targetMembers[1].displayName)})
    ))()`)
    await mouseClickMentionOption(running.cdp, targetMembers[1].displayName)
    await waitForExpression(running.cdp, `(() => (
      document.querySelector('#camp-message')?.textContent === ${JSON.stringify(`@${targetMembers[1].displayName} `)}
        && document.activeElement?.id === 'camp-message'
        && !document.querySelector('.composer-route-rail')
    ))()`)
    await focusEditorAtEnd(running.cdp)
    const continuationMessageText = '继续发送验收'
    await running.cdp.send('Input.insertText', { text: continuationMessageText })
    const addressedDraft = await waitForValue(async () =>
      request(running.cdp, 'camp.composerDraft.get', { campId }), (draft) =>
      draft.body === `@${targetMembers[1].displayName} ${continuationMessageText}`
        && deepEqual(draft.content, [
          { kind: 'member_mention', agentId: targetMemberIds[1] },
          { kind: 'text', text: ` ${continuationMessageText}` }
        ]), 10_000)
    await waitForExpression(running.cdp,
      `document.querySelector('.composer .composer-send')?.disabled === false`)
    const continuationStartedAt = Date.now()
    await mouseClick(running.cdp, '.composer .composer-send')
    await waitForExpression(running.cdp, `(() => {
      const continuation = document.querySelector('.composer-continuation')
      return continuation?.getAttribute('aria-label') === ${JSON.stringify(`继续发给 ${targetMembers[1].displayName}`)}
        && continuation.textContent?.includes(${JSON.stringify(`继续发给 @${targetMembers[1].displayName}`)})
        && document.querySelector('#camp-message')?.textContent === ''
    })()`, 5_000)
    const continuationVisibleAfterAcceptedSendMs = Date.now() - continuationStartedAt
    const continuedDraft = await waitForValue(async () =>
      request(running.cdp, 'camp.composerDraft.get', { campId }), (draft) =>
      composerIsEmpty(draft.content)
        && draft.replyIntent === null
        && draft.continuationIntent?.recipient.agentId === targetMemberIds[1], 5_000)
    await focusEditorAtEnd(running.cdp)
    await pressKey(running.cdp, {
      key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37, nativeVirtualKeyCode: 123
    })
    const continuationLayoutInspection = await evaluate(running.cdp, `(() => {
      const rail = document.querySelector('.composer-route-rail')
      const continuation = rail?.querySelector('.composer-continuation')
      const box = document.querySelector('.composer-box')
      const editor = document.querySelector('#camp-message')
      if (!(rail instanceof HTMLElement)
          || !(continuation instanceof HTMLElement)
          || !(box instanceof HTMLElement)
          || !(editor instanceof HTMLElement)) return null
      const railRect = rail.getBoundingClientRect()
      const boxRect = box.getBoundingClientRect()
      const boxStyle = getComputedStyle(box)
      const editorStyle = getComputedStyle(editor)
      return {
        railBeforeBox: rail.nextElementSibling === box,
        continuationOutsideInput: !box.contains(continuation),
        sharedLeftEdge: Math.abs(railRect.left - boxRect.left) < 0.5,
        sharedWidth: Math.abs(railRect.width - boxRect.width) < 0.5,
        keyboardFocusOnBox: boxStyle.boxShadow !== 'none',
        editorOutlineStyle: editorStyle.outlineStyle,
        editorOutlineWidth: editorStyle.outlineWidth
      }
    })()`)
    assert(
      continuationLayoutInspection
        && continuationLayoutInspection.railBeforeBox
        && continuationLayoutInspection.continuationOutsideInput
        && continuationLayoutInspection.sharedLeftEdge
        && continuationLayoutInspection.sharedWidth
        && continuationLayoutInspection.keyboardFocusOnBox
        && continuationLayoutInspection.editorOutlineStyle === 'none'
        && Number.parseFloat(continuationLayoutInspection.editorOutlineWidth) === 0,
      `Composer continuation route rail or focus treatment regressed: ${JSON.stringify(continuationLayoutInspection)}`
    )
    result = {
      acceptance: 'composer-continuation-ui',
      appPath,
      campId,
      addressedDraft,
      continuedDraft,
      defaultRouteInspection,
      continuationLayoutInspection,
      continuationVisibleAfterAcceptedSendMs,
      requiredRendererReload: false,
      clipboardItemCountBeforeTest: clipboardArchive.length,
      clipboardRestored: false,
      isolatedUserDataRemoved: false
    }
  } else {
  await selectWholeEditor(running.cdp)
  await pressKey(running.cdp, {
    key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 51
  })
  await waitForExpression(running.cdp,
    `document.querySelector('#camp-message')?.textContent === ''`)
  await waitForValue(async () => request(running.cdp, 'camp.composerDraft.get', { campId }),
    (draft) => deepEqual(draft.content, emptyComposerDocument), 10_000)

  // Lexical owns the editing tree. Native input must update that tree without
  // replacing the contenteditable host or moving the browser selection.
  await evaluate(running.cdp, `(() => {
    const editor = document.querySelector('#camp-message')
    if (!(editor instanceof HTMLDivElement)) return false
    window.__composerV2Editor = editor
    editor.focus()
    return true
  })()`)
  await running.cdp.send('Input.insertText', { text: '1' })
  await waitForExpression(running.cdp,
    `document.querySelector('#camp-message')?.textContent === '1'`)
  await evaluate(running.cdp,
    `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`, true)
  const firstNativeInputInspection = await evaluate(running.cdp, `(() => {
    const editor = document.querySelector('#camp-message')
    const selection = window.getSelection()
    if (!(editor instanceof HTMLDivElement) || !selection?.anchorNode) return null
    const beforeCaret = document.createRange()
    beforeCaret.selectNodeContents(editor)
    beforeCaret.setEnd(selection.anchorNode, selection.anchorOffset)
    return {
      stayedMounted: editor === window.__composerV2Editor,
      stayedFocused: document.activeElement === editor,
      text: editor.textContent,
      paragraphCount: editor.querySelectorAll(':scope > p').length,
      caretOffset: beforeCaret.toString().length
    }
  })()`)
  assert(
    firstNativeInputInspection?.stayedMounted
      && firstNativeInputInspection.stayedFocused
      && firstNativeInputInspection.text === '1'
      && firstNativeInputInspection.paragraphCount === 1
      && firstNativeInputInspection.caretOffset === 1,
    `The first native character reset the Lexical editor host: ${JSON.stringify(firstNativeInputInspection)}`
  )
  await selectWholeEditor(running.cdp)
  await pressKey(running.cdp, {
    key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 51
  })
  await waitForValue(async () => request(running.cdp, 'camp.composerDraft.get', { campId }),
    (draft) => deepEqual(draft.content, emptyComposerDocument), 10_000)

  await focusEditorAtEnd(running.cdp)
  await running.cdp.send('Input.imeSetComposition', {
    text: 'ni', selectionStart: 2, selectionEnd: 2
  })
  await running.cdp.send('Input.insertText', { text: '你' })
  await waitForExpression(running.cdp,
    `document.querySelector('#camp-message')?.textContent === '你'`)
  const firstNativeCompositionInspection = await evaluate(running.cdp, `(() => {
    const editor = document.querySelector('#camp-message')
    const selection = window.getSelection()
    if (!(editor instanceof HTMLDivElement) || !selection?.anchorNode) return null
    const beforeCaret = document.createRange()
    beforeCaret.selectNodeContents(editor)
    beforeCaret.setEnd(selection.anchorNode, selection.anchorOffset)
    return {
      stayedMounted: editor === window.__composerV2Editor,
      stayedFocused: document.activeElement === editor,
      text: editor.textContent,
      paragraphCount: editor.querySelectorAll(':scope > p').length,
      caretOffset: beforeCaret.toString().length
    }
  })()`)
  assert(
    firstNativeCompositionInspection?.stayedMounted
      && firstNativeCompositionInspection.stayedFocused
      && firstNativeCompositionInspection.text === '你'
      && firstNativeCompositionInspection.paragraphCount === 1
      && firstNativeCompositionInspection.caretOffset === 1,
    `Native IME composition did not remain in Lexical: ${JSON.stringify(firstNativeCompositionInspection)}`
  )
  await waitForValue(async () => request(running.cdp, 'camp.composerDraft.get', { campId }),
    (draft) => deepEqual(draft.content,
      composerDocumentFromStructured([{ kind: 'text', text: '你' }])), 10_000)
  await selectWholeEditor(running.cdp)
  await pressKey(running.cdp, {
    key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 51
  })
  await waitForValue(async () => request(running.cdp, 'camp.composerDraft.get', { campId }),
    (draft) => deepEqual(draft.content, emptyComposerDocument), 10_000)

  const imeNewlineInspection = await acceptImeNewlineRegression(running.cdp, campId)

  await focusEditorAtEnd(running.cdp)
  await running.cdp.send('Input.insertText', { text: expectedContent[0].text })
  let expectedEditorText = expectedContent[0].text
  const candidateMenuCapture = join(outputDir, 'structured-mentions-candidate-menu.png')
  let candidateMenuCaptured = false
  await waitForValue(async () => evaluate(running.cdp, `(() => {
    const editor = document.querySelector('#camp-message')
    return { text: editor?.textContent ?? null, html: editor?.innerHTML ?? null }
  })()`), (projection) => projection.text === expectedEditorText, 10_000)
  await evaluate(running.cdp, `(() => {
    window.__structuredMentionAcceptanceEvents = []
    const record = (phase) => (event) => {
      if (!(event.target instanceof Element) || event.target.id !== 'camp-message') return
      window.__structuredMentionAcceptanceEvents.push({
        type: event.type,
        phase,
        inputType: event.inputType ?? null,
        data: event.data ?? null,
        cancelable: event.cancelable,
        defaultPrevented: event.defaultPrevented,
        isComposing: event.isComposing ?? null
      })
    }
    document.addEventListener('beforeinput', record('capture'), true)
    document.addEventListener('beforeinput', record('bubble'), false)
    document.addEventListener('input', record('capture'), true)
    document.addEventListener('input', record('bubble'), false)
    return true
  })()`)

  for (const [index, member] of targetMembers.entries()) {
    // Keep each native insertion at the committed Lexical selection while the
    // Typeahead portal opens and closes around the same editor instance.
    await focusEditorAtEnd(running.cdp)
    await running.cdp.send('Input.insertText', { text: '@' })
    await waitForValue(async () => evaluate(running.cdp, `(() => {
      const menu = document.querySelector('.structured-mention-menu')
      const editor = document.querySelector('#camp-message')
      return {
        text: editor?.textContent ?? null,
        html: editor?.innerHTML ?? null,
        ariaExpanded: editor?.getAttribute('aria-expanded') ?? null,
        menu: Boolean(menu),
        options: [...(menu?.querySelectorAll('button[role="option"]') ?? [])]
          .map((button) => ({
            name: button.querySelector('strong')?.textContent ?? null,
            hasMemberAvatar: Boolean(button.querySelector('.member-avatar.mention-avatar')),
            hasImage: Boolean(button.querySelector('.member-avatar.mention-avatar .member-avatar-image'))
          })),
        events: window.__structuredMentionAcceptanceEvents ?? []
      }
    })()`), (projection) => {
      const option = projection.options.find((candidate) => candidate.name === member.displayName)
      return projection.text === `${expectedEditorText}@`
        && projection.menu
        && option?.hasMemberAvatar
        && option.hasImage
    }, 10_000)
    if (!candidateMenuCaptured) {
      await capture(running.cdp, candidateMenuCapture)
      candidateMenuCaptured = true
    }
    await mouseClickMentionOption(running.cdp, member.displayName)
    expectedEditorText += `@${member.displayName} `
    await waitForExpression(running.cdp,
      `document.querySelectorAll('.structured-mention-token.member-mention').length === ${index + 1}
        && document.querySelector('#camp-message')?.textContent === ${JSON.stringify(expectedEditorText)}`)
    await waitForExpression(running.cdp, `document.activeElement?.id === 'camp-message'`)
    await waitForExpression(running.cdp, `(() => {
      const editor = document.querySelector('#camp-message')
      const selection = window.getSelection()
      if (!editor || !selection?.isCollapsed || !selection.anchorNode) return false
      const range = document.createRange()
      range.selectNodeContents(editor)
      range.setEnd(selection.anchorNode, selection.anchorOffset)
      return range.toString().length === (editor.textContent ?? '').length
    })()`)
    if (index === targetMembers.length - 1) {
      const followingText = '，请给出结论。'
      await running.cdp.send('Input.insertText', { text: followingText })
      expectedEditorText += followingText
      await waitForExpression(running.cdp,
        `document.querySelector('#camp-message')?.textContent === ${JSON.stringify(expectedEditorText)}`)
    }
  }

  await running.cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: 2, y: 2, button: 'none', buttons: 0
  })
  await wait(150)
  const composerInspection = await evaluate(running.cdp, `(() => {
    const editor = document.querySelector('#camp-message')
    const tokens = [...document.querySelectorAll('.structured-mention-token.member-mention')]
    return {
      role: editor?.getAttribute('role'),
      contentEditable: editor?.getAttribute('contenteditable'),
      tokenIds: tokens.map((token) => token.dataset.agentId),
      tokenLabels: tokens.map((token) => token.textContent),
      tokenStyles: tokens.map((token) => {
        const style = getComputedStyle(token)
        return {
          contentEditable: token.getAttribute('contenteditable'),
          display: style.display,
          borderTopWidth: style.borderTopWidth,
          paddingInline: [style.paddingLeft, style.paddingRight],
          borderRadius: style.borderRadius,
          backgroundColor: style.backgroundColor,
          color: style.color,
          fontWeight: style.fontWeight,
          userSelect: style.userSelect,
          role: token.getAttribute('role'),
          label: token.getAttribute('aria-label'),
          hasPopup: token.getAttribute('aria-haspopup')
        }
      })
    }
  })()`)
  assert(
    composerInspection.role === 'textbox'
      && composerInspection.contentEditable === 'true'
      && deepEqual(composerInspection.tokenIds, targetMemberIds)
      && deepEqual(composerInspection.tokenLabels, targetMembers.map(({ displayName }) => `@${displayName}`))
      && composerInspection.tokenStyles.every((style) =>
        style.contentEditable === 'false'
        && style.display === 'inline'
        && style.borderTopWidth === '0px'
        && style.paddingInline.every((value) => Number.parseFloat(value) <= 1.1)
        && Number.parseFloat(style.borderRadius) === 3
        && style.backgroundColor === 'rgba(0, 0, 0, 0)'
        && style.color === 'rgb(47, 97, 200)'
        && Number(style.fontWeight) >= 600
        && style.userSelect === 'all'
        && style.role === null
        && style.label?.startsWith('成员 ')
        && style.hasPopup === null),
    `Structured mentions do not use the selected atomic inline style: ${JSON.stringify(composerInspection)}`
  )

  const durableDraft = await waitForValue(async () =>
    request(running.cdp, 'camp.composerDraft.get', { campId }), (draft) =>
    draft.revision >= 1 && deepEqual(draft.content, expectedComposerDocument), 10_000)
  assert(durableDraft.body === expectedBody,
    `Core did not project the current names into the Draft body: ${JSON.stringify(durableDraft)}`)

  const composerCapture = join(outputDir, 'structured-mentions-composer.png')
  await capture(running.cdp, composerCapture)

  await evaluate(running.cdp, `window.getSelection()?.removeAllRanges()`)
  await mouseClickUntilExpression(
    running.cdp,
    `.structured-mention-token.member-mention.is-interactive[data-agent-id=${JSON.stringify(targetMemberIds[0])}]`,
    `document.querySelector('.mention-profile-popover[aria-label="叮叮的基础信息"]')?.classList.contains('is-positioned')`
  )
  await wait(180)
  const composerPopoverInspection = await inspectMentionPopover(running.cdp)
  assertSelectedMemberPopover(composerPopoverInspection, 'Composer')
  assert(!(await evaluate(running.cdp, `Boolean(document.querySelector('.app-toast'))`)),
    'Composer Mention incorrectly opened a global Toast')
  assert(await mentionInteractionStayedInCamp(running.cdp),
    'Clicking a Composer Mention navigated away from the current Camp')
  const composerPopoverCapture = join(outputDir, 'structured-mentions-composer-popover.png')
  await capture(running.cdp, composerPopoverCapture)
  await pressEscape(running.cdp)
  await waitForExpression(running.cdp, `!document.querySelector('.mention-profile-popover')`)
  await waitForExpression(running.cdp,
    `document.activeElement?.id === 'camp-message'`, 3_000)
  const draftAfterPopover = await request(running.cdp, 'camp.composerDraft.get', { campId })
  assert(deepEqual(draftAfterPopover.content, expectedComposerDocument),
    `Opening the Composer popover changed the durable Draft: ${JSON.stringify(draftAfterPopover)}`)

  // Settle any earlier Runtime before testing direct-send auto-open; a private
  // queued publication has no synchronous Run receipt and intentionally does
  // not move selection.
  await waitForValue(() => request(running.cdp, 'camps.snapshot', { campId }),
    (snapshot) => snapshot.agentRuns.every((run) =>
      ['succeeded', 'failed', 'cancelled'].includes(run.status)), 30_000)
  await waitForExpression(running.cdp,
    `document.querySelector('.composer .composer-send')?.disabled === false`)
  await mouseClick(running.cdp, '.composer .composer-send')

  const sent = await waitForValue(async () => {
    const snapshot = await request(running.cdp, 'camps.snapshot', { campId })
    const message = snapshot.messages
      .filter((candidate) => candidate.authorType === 'user')
      .findLast((candidate) => deepEqual(candidate.content, expectedContent))
    if (!message?.campTurnId) return null
    const runs = snapshot.agentRuns.filter((run) => run.campTurnId === message.campTurnId)
    return runs.length === targetMemberIds.length ? { snapshot, message, runs } : null
  }, Boolean, 30_000)

  assert(sent.message.body === expectedBody,
    `Persisted message body projection is wrong: ${JSON.stringify(sent.message)}`)
  assert(sent.message.addressMode === 'explicit',
    `Persisted message is not explicitly addressed: ${JSON.stringify(sent.message)}`)
  assert(deepEqual(sent.message.addressedAgentIds, targetMemberIds),
    `Persisted message targets are wrong: ${JSON.stringify(sent.message.addressedAgentIds)}`)
  assert(deepEqual(sent.message.content, expectedContent),
    `Persisted Structured Content changed: ${JSON.stringify(sent.message.content)}`)
  assert(
    sameMembers(sent.runs.map((run) => run.agentId), targetMemberIds)
      && new Set(sent.runs.map((run) => run.createdAt)).size === 1,
    `The three AgentRuns were not created at one CampTurn boundary: ${JSON.stringify(sent.runs)}`
  )

  const firstSubmittedRun = sent.runs.find((run) => run.agentId === targetMemberIds[0])
  assert(firstSubmittedRun,
    `The first addressed member has no AgentRun: ${JSON.stringify(sent.runs)}`)
  await waitForExpression(running.cdp, `(() => {
    const selected = document.querySelector('.run-pulse-chip.is-selected')
    const focused = document.querySelector('.execution-process-stage.is-focused')
    return selected?.dataset.agentId === ${JSON.stringify(targetMemberIds[0])}
      && focused?.dataset.agentRunId === ${JSON.stringify(firstSubmittedRun.id)}
      && document.activeElement?.id === 'camp-message'
  })()`)
  const submittedRunAutoOpen = await evaluate(running.cdp, `(() => ({
    selectedAgentId: document.querySelector('.run-pulse-chip.is-selected')?.dataset.agentId ?? null,
    focusedRunId: document.querySelector('.execution-process-stage.is-focused')?.dataset.agentRunId ?? null,
    composerKeepsFocus: document.activeElement?.id === 'camp-message',
    drawerCount: document.querySelectorAll('.execution-drawer').length
  }))()`)
  assert(submittedRunAutoOpen.drawerCount === 1
    && submittedRunAutoOpen.selectedAgentId === targetMemberIds[0]
    && submittedRunAutoOpen.focusedRunId === firstSubmittedRun.id
    && submittedRunAutoOpen.composerKeepsFocus,
  `Submitted Run did not auto-open without stealing Composer focus: ${JSON.stringify(submittedRunAutoOpen)}`)

  await waitForExpression(running.cdp, `(() => {
    const messages = [...document.querySelectorAll('.conversation-bubble.user')]
    const message = messages.at(-1)
    return Boolean(message?.querySelector('.structured-message-body')
      && message.querySelectorAll('.message-mention-token').length === 3)
  })()`, 30_000)

  await running.cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: 2, y: 2, button: 'none', buttons: 0
  })
  await wait(150)
  const sentMentionInspection = await evaluate(running.cdp, `(() => {
    const messages = [...document.querySelectorAll('.conversation-bubble.user')]
    const mention = messages.at(-1)?.querySelector('.message-mention-token.is-interactive')
    if (!(mention instanceof HTMLElement)) return null
    const style = getComputedStyle(mention)
    return {
      display: style.display,
      paddingInline: [style.paddingLeft, style.paddingRight],
      borderTopWidth: style.borderTopWidth,
      borderRadius: style.borderRadius,
      backgroundColor: style.backgroundColor,
      color: style.color,
      role: mention.getAttribute('role'),
      label: mention.getAttribute('aria-label'),
      hasPopup: mention.getAttribute('aria-haspopup')
    }
  })()`)
  assert(
    sentMentionInspection
      && sentMentionInspection.display === 'inline'
      && sentMentionInspection.paddingInline.every((value) => Number.parseFloat(value) <= 1.1)
      && sentMentionInspection.borderTopWidth === '0px'
      && Number.parseFloat(sentMentionInspection.borderRadius) === 3
      && sentMentionInspection.backgroundColor === 'rgba(0, 0, 0, 0)'
      && sentMentionInspection.color === 'rgb(47, 97, 200)'
      && sentMentionInspection.role === 'button'
      && sentMentionInspection.label === '查看叮叮的基础信息'
      && sentMentionInspection.hasPopup === 'dialog',
    `Sent mention does not use the selected Feishu-style inline interaction: ${JSON.stringify(sentMentionInspection)}`
  )

  await evaluate(running.cdp, `window.getSelection()?.removeAllRanges()`)
  await mouseClickUntilExpression(
    running.cdp,
    `.conversation-bubble.user .message-mention-token.is-interactive[data-agent-id=${JSON.stringify(targetMemberIds[0])}]`,
    `document.querySelector('.mention-profile-popover[aria-label="叮叮的基础信息"]')?.classList.contains('is-positioned')`
  )
  await wait(180)
  const historyPopoverInspection = await inspectMentionPopover(running.cdp)
  assertSelectedMemberPopover(historyPopoverInspection, 'History')
  assert(!(await evaluate(running.cdp, `Boolean(document.querySelector('.app-toast'))`)),
    'History Mention incorrectly opened a global Toast')
  assert(await mentionInteractionStayedInCamp(running.cdp),
    'Clicking a sent Mention navigated away from the current Camp')
  const memberPopoverCapture = join(outputDir, 'structured-mentions-member-popover.png')
  await capture(running.cdp, memberPopoverCapture)
  await pressEscape(running.cdp)
  await waitForExpression(running.cdp, `!document.querySelector('.mention-profile-popover')`)
  await waitForExpression(running.cdp,
    `document.activeElement?.classList.contains('message-mention-token') === true`, 3_000)

  for (const activation of [
    { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 36 },
    { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 49 }
  ]) {
    await activateLastInteractiveMentionWithKey(running.cdp, activation)
    await waitForExpression(running.cdp,
      `document.querySelector('.mention-profile-popover[aria-label="叮叮的基础信息"]')?.classList.contains('is-positioned')`)
    await wait(180)
    assertSelectedMemberPopover(await inspectMentionPopover(running.cdp), activation.code)
    assert(await mentionInteractionStayedInCamp(running.cdp),
      `${activation.code} on a sent Mention navigated away from the current Camp`)
    await pressEscape(running.cdp)
    await waitForExpression(running.cdp, `!document.querySelector('.mention-profile-popover')`)
    await waitForExpression(running.cdp,
      `document.activeElement?.classList.contains('message-mention-token') === true`, 3_000)
  }

  await evaluate(running.cdp, `window.getSelection()?.removeAllRanges()`)
  const mentionDrag = await mentionSelectionDragPoints(running.cdp)
  await dispatchMouseDrag(running.cdp, mentionDrag.start, mentionDrag.end)
  const mentionSelectedText = await evaluate(running.cdp, `window.getSelection()?.toString() ?? ''`)
  assert(mentionSelectedText === mentionDrag.expected,
    `Native Mention selection did not select the complete visible token: ${JSON.stringify({ mentionSelectedText, mentionDrag })}`)
  assert(!(await evaluate(running.cdp, `Boolean(document.querySelector('.mention-profile-popover'))`)),
    'Dragging across a sent Mention incorrectly opened the member popover')

  const sentCapture = join(outputDir, 'structured-mentions-sent.png')
  await capture(running.cdp, sentCapture)

  // The copy action must remain hidden until hover. Remove focus and move the
  // physical pointer outside the message before reading the transitioned style.
  await evaluate(running.cdp,
    `document.activeElement instanceof HTMLElement && document.activeElement.blur()`)
  await moveMouseAwayFromLastUserMessage(running.cdp)
  await wait(200)
  const hiddenOpacity = await lastCopyButtonOpacity(running.cdp)
  assert(hiddenOpacity < 0.05, `Copy button is visible without hover: ${hiddenOpacity}`)

  await moveMouseToLastUserMessage(running.cdp)
  await wait(200)
  const hoveredOpacity = await lastCopyButtonOpacity(running.cdp)
  assert(hoveredOpacity > 0.95, `Copy button did not appear on hover: ${hoveredOpacity}`)

  await moveMouseAwayFromLastUserMessage(running.cdp)
  await wait(200)
  assert(await lastCopyButtonOpacity(running.cdp) < 0.05,
    'Copy button did not hide after hover ended')

  // Use native mouse events for the selection; no Range is installed into
  // window.getSelection(). Range is used only to locate glyph coordinates.
  const drag = await selectionDragPoints(running.cdp, 0, 7)
  await dispatchMouseDrag(running.cdp, drag.start, drag.end)
  const selectedText = await evaluate(running.cdp, `window.getSelection()?.toString() ?? ''`)
  assert(selectedText === drag.expected,
    `Native mouse selection did not select the expected user text: ${JSON.stringify({ selectedText, drag })}`)

  clipboardTouched = true
  await copySelectionWithMetaC(running.cdp)
  await wait(150)
  const selectedClipboardText = await runProcess('/usr/bin/pbpaste', [])
  assert(selectedClipboardText === selectedText,
    `Meta+C did not copy the native user-message selection: ${JSON.stringify({ selectedText, selectedClipboardText })}`)

  const selectionCapture = join(outputDir, 'structured-mentions-native-selection.png')
  await capture(running.cdp, selectionCapture)

  await moveMouseToLastUserMessage(running.cdp)
  await wait(200)
  assert(await lastCopyButtonOpacity(running.cdp) > 0.95,
    'Copy button is not visible immediately before the real click')
  await mouseClick(running.cdp, '.conversation-bubble.user:last-of-type .message-copy-button', {
    last: true,
    fallbackSelector: '.conversation-bubble.user .message-copy-button'
  })
  await waitForExpression(running.cdp, `(() => {
    const messages = [...document.querySelectorAll('.conversation-bubble.user')]
    return messages.at(-1)?.querySelector('.copy-feedback')?.textContent === '已复制'
  })()`)
  const fullClipboardText = await runProcess('/usr/bin/pbpaste', [])
  assert(fullClipboardText === expectedBody,
    `Hover copy button did not copy the complete message: ${JSON.stringify(fullClipboardText)}`)

  const copiedCapture = join(outputDir, 'structured-mentions-hover-copy.png')
  await capture(running.cdp, copiedCapture)

  // Current User Mention is Agent-only, so create the accepted Core-owned
  // fixture while the isolated App/Core are stopped. Reopening the packaged
  // App then exercises the real read model, copy bridge, and Composer paste.
  await closeApp(running)
  running = null
  await insertAgentMemberMentionFixtures(databasePath, campId)
  await insertCurrentUserMentionFixture(databasePath, campId)
  running = await launchApp(dataDir, debugPort, 1440, 920)
  await setTheme(running.cdp, 'night')
  await openCamp(running.cdp, campId)
  const agentMemberMentionInspection = await acceptAgentMemberMention(running.cdp)
  await waitForExpression(running.cdp, `(() => {
    const message = document.querySelector('[data-message-id=${JSON.stringify(currentUserMentionMessageId)}]')
    return message?.querySelector('.current-user-markdown-body, .structured-message-body')?.textContent
      === ${JSON.stringify(currentUserMentionBody)}
      && message.querySelectorAll('.message-mention-token.current-user').length === 1
  })()`, 30_000)
  await waitForExpression(running.cdp, `(() => {
    const token = document.querySelector(
      '[data-message-id=${JSON.stringify(currentUserMentionMessageId)}] .message-mention-token.current-user'
    )
    if (!(token instanceof HTMLElement)) return false
    const probe = document.createElement('span')
    probe.style.color = 'var(--mention-ink)'
    document.body.appendChild(probe)
    const settled = getComputedStyle(token).color === getComputedStyle(probe).color
    probe.remove()
    return settled
  })()`, 3_000)

  const currentUserMentionInspection = await evaluate(running.cdp, `(() => {
    const message = document.querySelector('[data-message-id=${JSON.stringify(currentUserMentionMessageId)}]')
    const token = message?.querySelector('.message-mention-token.current-user')
    if (!(message instanceof HTMLElement) || !(token instanceof HTMLElement)) return null
    const style = getComputedStyle(token)
    const colorProbe = document.createElement('span')
    colorProbe.style.color = 'var(--mention-ink)'
    document.body.appendChild(colorProbe)
    const mentionInkColor = getComputedStyle(colorProbe).color
    colorProbe.remove()
    return {
      messageText: message.querySelector('.current-user-markdown-body, .structured-message-body')?.textContent ?? null,
      tokenText: token.textContent,
      label: token.getAttribute('aria-label'),
      role: token.getAttribute('role'),
      tabIndex: token.getAttribute('tabindex'),
      hasPopup: token.getAttribute('aria-haspopup'),
      interactive: token.classList.contains('is-interactive'),
      display: style.display,
      borderTopWidth: style.borderTopWidth,
      backgroundColor: style.backgroundColor,
      color: style.color,
      mentionInkColor,
      theme: document.documentElement.dataset.theme
    }
  })()`)
  assert(
    currentUserMentionInspection
      && currentUserMentionInspection.messageText === currentUserMentionBody
      && currentUserMentionInspection.tokenText === '@你'
      && currentUserMentionInspection.label === '提及当前用户：你'
      && currentUserMentionInspection.role === null
      && currentUserMentionInspection.tabIndex === null
      && currentUserMentionInspection.hasPopup === null
      && !currentUserMentionInspection.interactive
      && currentUserMentionInspection.display === 'inline'
      && currentUserMentionInspection.borderTopWidth === '0px'
      && currentUserMentionInspection.backgroundColor === 'rgba(0, 0, 0, 0)'
      && currentUserMentionInspection.color === currentUserMentionInspection.mentionInkColor
      && currentUserMentionInspection.theme === 'night',
    `Current User Mention is not the accepted non-interactive inline token: ${JSON.stringify(currentUserMentionInspection)}`
  )
  await evaluate(running.cdp, `(() => {
    document.querySelector('[data-message-id=${JSON.stringify(currentUserMentionMessageId)}] .message-mention-token.current-user')?.click()
    return true
  })()`)
  assert(!(await evaluate(running.cdp, `Boolean(document.querySelector('.mention-profile-popover'))`)),
    'Current User Mention incorrectly opened a member profile popover')

  const currentUserMentionCapture = join(outputDir, 'current-user-mention-sent.png')
  await capture(running.cdp, currentUserMentionCapture)
  await moveMouseToElement(running.cdp,
    `[data-message-id=${JSON.stringify(currentUserMentionMessageId)}] .message-bubble`)
  await wait(200)
  clipboardTouched = true
  await mouseClick(running.cdp,
    `[data-message-id=${JSON.stringify(currentUserMentionMessageId)}] .message-copy-button`)
  await waitForExpression(running.cdp, `(() => (
    document.querySelector('[data-message-id=${JSON.stringify(currentUserMentionMessageId)}] .copy-feedback')
      ?.textContent === '已复制'
  ))()`)
  const currentUserClipboardText = await runProcess('/usr/bin/pbpaste', [])
  assert(currentUserClipboardText === currentUserMentionBody,
    `Current User Mention plain-text copy is wrong: ${JSON.stringify(currentUserClipboardText)}`)
  const currentUserClipboardArchive = await snapshotClipboard()
  const currentUserClipboardPayload = structuredClipboardPayload(currentUserClipboardArchive)
  assert(
    currentUserClipboardPayload?.version === 1
      && currentUserClipboardPayload.content?.[0]?.kind === 'current_user_mention'
      && currentUserClipboardPayload.content[0].userId === 'local_user'
      && currentUserClipboardPayload.content[0].fallbackText === '@你',
    `Private clipboard did not preserve the stable Current User Mention segment: ${JSON.stringify(currentUserClipboardPayload)}`
  )

  await focusEditorAtEnd(running.cdp)
  await pasteWithMetaV(running.cdp)
  const downgradedDraft = await waitForValue(async () =>
    request(running.cdp, 'camp.composerDraft.get', { campId }), (draft) =>
    deepEqual(draft.content, [{ kind: 'text', text: currentUserMentionBody }]), 10_000)
  assert(downgradedDraft.body === currentUserMentionBody,
    `Composer paste did not downgrade Current User Mention to Text: ${JSON.stringify(downgradedDraft)}`)
  const downgradedComposer = await evaluate(running.cdp, `(() => {
    const editor = document.querySelector('#camp-message')
    return {
      text: editor?.textContent ?? null,
      tokenCount: editor?.querySelectorAll('[data-token-kind]').length ?? -1
    }
  })()`)
  assert(
    downgradedComposer.text === currentUserMentionBody && downgradedComposer.tokenCount === 0,
    `Composer recreated an Agent-only Current User Mention: ${JSON.stringify(downgradedComposer)}`
  )
  const currentUserPasteCapture = join(outputDir, 'current-user-mention-paste-downgraded.png')
  await capture(running.cdp, currentUserPasteCapture)

  // Reply-chain acceptance uses the same isolated Camp and real packaged App.
  // Start from an empty durable Draft so the implicit recipient inserted by a
  // normal reply and the absence of an invalid recipient are both observable.
  await selectWholeEditor(running.cdp)
  await pressKey(running.cdp, {
    key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 51
  })
  await waitForValue(async () => request(running.cdp, 'camp.composerDraft.get', { campId }),
    (draft) => deepEqual(draft.content, []) && draft.replyIntent === null, 10_000)
  await reloadRenderer(running.cdp)
  await setTheme(running.cdp, 'day')
  await openCamp(running.cdp, campId)
  await waitForSelector(running.cdp,
    `[data-message-id=${JSON.stringify(currentUserMentionMessageId)}] .message-reply-button`, 30_000)
  await moveMouseToElement(running.cdp,
    `[data-message-id=${JSON.stringify(currentUserMentionMessageId)}] .message-bubble`)
  await mouseClick(running.cdp,
    `[data-message-id=${JSON.stringify(currentUserMentionMessageId)}] .message-reply-button`)
  const availableReplyDraft = await waitForValue(async () =>
    request(running.cdp, 'camp.composerDraft.get', { campId }), (draft) =>
    draft.replyIntent?.replyToCampMessageId === currentUserMentionMessageId
      && draft.replyIntent.author?.authorId === targetMemberIds[0]
      && draft.replyIntent.author.recipientAvailability === 'available'
      && draft.replyIntent.recipientSelectionRequired === false
      && composerHasMember(draft.content, targetMemberIds[0]), 10_000)
  await waitForExpression(running.cdp, `(() => (
    document.activeElement?.id === 'camp-message'
      && document.querySelector('.composer')?.classList.contains('suppress-pointer-focus-ring')
      && document.querySelector('.composer-reply-line strong')?.textContent === '回复 叮叮'
      && !document.querySelector('.mention-target-summary')
  ))()`)
  // Use a constrained viewport to exercise real overflow. The bounded excerpt
  // can fit at 1440px after Composer width changes, which is valid behavior.
  await setViewport(running.cdp, 1040, 700)
  const lightweightReplyInspection = await inspectLightweightReply(running.cdp)
  assert(
    lightweightReplyInspection.theme === 'day'
      && lightweightReplyInspection.editorFocused
      && lightweightReplyInspection.focusRingSuppressed
      && lightweightReplyInspection.composerBox.borderTopWidth === '1px'
      && lightweightReplyInspection.composerBox.borderTopStyle === 'solid'
      && lightweightReplyInspection.composerBox.borderTopColor
        === lightweightReplyInspection.expectedControlLineColor
      && lightweightReplyInspection.composerBox.backgroundColor
        === lightweightReplyInspection.expectedInputColor
      && lightweightReplyInspection.composerBox.boxShadow === 'none'
      && lightweightReplyInspection.lineBorderWidth === '0px'
      && lightweightReplyInspection.lineBackgroundColor === 'rgba(0, 0, 0, 0)'
      && lightweightReplyInspection.lineBoxShadow === 'none'
      && lightweightReplyInspection.replyIconAbsent
      && lightweightReplyInspection.copyWhiteSpace === 'nowrap'
      && lightweightReplyInspection.copyOverflow === 'hidden'
      && lightweightReplyInspection.authorFlexShrink === '0'
      && !lightweightReplyInspection.authorOverflows
      && lightweightReplyInspection.excerptTextOverflow === 'ellipsis'
      && lightweightReplyInspection.excerptWhiteSpace === 'nowrap'
      && lightweightReplyInspection.excerptOverflows,
    `Pointer reply is not the accepted one-line frameless treatment: ${JSON.stringify(lightweightReplyInspection)}`
  )
  const lightweightReplyCapture = join(outputDir, 'message-reply-lightweight-day.png')
  await capture(running.cdp, lightweightReplyCapture)
  await setViewport(running.cdp, 1440, 920)

  // Match Feishu's reply-dock keyboard boundary: Backspace at the absolute
  // body start cancels only the reply intent and keeps the visible Mention.
  await focusEditorAtStart(running.cdp)
  await pressKey(running.cdp, {
    key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 51
  })
  const replyCancelledFromBodyStart = await waitForValue(async () =>
    request(running.cdp, 'camp.composerDraft.get', { campId }), (draft) =>
    draft.replyIntent === null && deepEqual(draft.content, availableReplyDraft.content), 10_000)
  assert(deepEqual(replyCancelledFromBodyStart.content, availableReplyDraft.content),
    `Backspace at body start changed reply-authored content: ${JSON.stringify(replyCancelledFromBodyStart)}`)
  await waitForExpression(running.cdp, `(() => {
    const editor = document.querySelector('#camp-message')
    const selection = window.getSelection()
    if (!(editor instanceof HTMLElement)
        || document.activeElement !== editor
        || !selection?.isCollapsed
        || !selection.anchorNode
        || document.querySelector('.composer-reply-line')) return false
    const beforeCaret = document.createRange()
    beforeCaret.selectNodeContents(editor)
    beforeCaret.setEnd(selection.anchorNode, selection.anchorOffset)
    return beforeCaret.toString().length === 0
  })()`)

  // Discard the remaining content before the dangerous-boundary case so an
  // invalid original-author Mention cannot be hidden by the normal reply.
  await selectWholeEditor(running.cdp)
  await pressKey(running.cdp, {
    key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 51
  })
  await waitForValue(async () => request(running.cdp, 'camp.composerDraft.get', { campId }),
    (draft) => deepEqual(draft.content, []) && draft.replyIntent === null, 10_000)
  const originalAuthorProfile = await request(running.cdp, 'members.get', {
    agentId: targetMemberIds[0]
  })
  const awayResult = await request(running.cdp, 'members.presence.set', {
    commandId: crypto.randomUUID(),
    command: {
      agentId: targetMemberIds[0],
      expectedVersion: originalAuthorProfile.version,
      presence: 'away'
    }
  })
  assert(awayResult.status === 'applied',
    `Could not make the reply author unavailable: ${JSON.stringify(awayResult)}`)
  await reloadRenderer(running.cdp)
  await setTheme(running.cdp, 'night')
  await openCamp(running.cdp, campId)
  await mouseClick(running.cdp,
    `[data-message-id=${JSON.stringify(currentUserMentionMessageId)}] .message-reply-button`)
  const unavailableReplyDraft = await waitForValue(async () =>
    request(running.cdp, 'camp.composerDraft.get', { campId }), (draft) =>
    draft.replyIntent?.replyToCampMessageId === currentUserMentionMessageId
      && draft.replyIntent.author?.authorId === targetMemberIds[0]
      && draft.replyIntent.author.recipientAvailability === 'unavailable'
      && draft.replyIntent.recipientSelectionRequired === true, 10_000)
  assert(!composerHasMember(unavailableReplyDraft.content, targetMemberIds[0]),
  `Unavailable reply author leaked into the Draft: ${JSON.stringify(unavailableReplyDraft)}`)
  await waitForExpression(running.cdp, `(() => {
    const repair = document.querySelector('.reply-recipient-repair')
    const options = [...document.querySelectorAll('.reply-recipient-options button')]
    return repair?.textContent?.includes('原作者当前不可接收，请选择其他成员')
      && options.some((option) => option.textContent?.trim() === '@芝士')
      && options.some((option) => option.textContent?.trim() === '@咕咕')
      && options.some((option) => option.textContent?.trim() === '@所有队员')
      && !options.some((option) => option.textContent?.trim() === '@叮叮')
      && document.activeElement === options[0]
  })()`)
  await focusEditorAtEnd(running.cdp)
  await running.cdp.send('Input.insertText', { text: '请基于上述引用继续。' })
  const unresolvedReplyDraft = await waitForValue(async () =>
    request(running.cdp, 'camp.composerDraft.get', { campId }), (draft) =>
    draft.body.includes('请基于上述引用继续。')
      && draft.replyIntent?.recipientSelectionRequired === true, 10_000)
  const unresolvedReplyInspection = await evaluate(running.cdp, `(() => ({
    theme: document.documentElement.dataset.theme,
    warning: document.querySelector('.reply-recipient-repair-copy strong')?.textContent ?? null,
    sendDisabled: document.querySelector('.composer-send')?.disabled ?? null,
    summary: document.querySelector('.mention-target-summary')?.textContent ?? null
  }))()`)
  assert(
    unresolvedReplyInspection.theme === 'night'
      && unresolvedReplyInspection.warning === '原作者当前不可接收，请选择其他成员'
      && unresolvedReplyInspection.sendDisabled === true
      && unresolvedReplyInspection.summary === null,
    `Unavailable reply did not block explicit sending: ${JSON.stringify(unresolvedReplyInspection)}`
  )
  const unavailableReplyCapture = join(outputDir, 'message-reply-recipient-required-night.png')
  await capture(running.cdp, unavailableReplyCapture)

  const messageSequenceBeforeRecipientRepair = Math.max(0,
    ...(await request(running.cdp, 'camps.snapshot', { campId })).messages
      .map((message) => message.sequence))
  await mouseClick(running.cdp, '.reply-recipient-options button:nth-child(2)')
  const resolvedReplyDraft = await waitForValue(async () =>
    request(running.cdp, 'camp.composerDraft.get', { campId }), (draft) =>
    draft.replyIntent?.replyToCampMessageId === currentUserMentionMessageId
      && draft.replyIntent.recipientSelectionRequired === false
      && composerHasMember(draft.content, targetMemberIds[2])
      && !composerHasMember(draft.content, targetMemberIds[0]), 10_000)
  await waitForExpression(running.cdp, `(() => (
    !document.querySelector('.reply-recipient-repair')
      && document.querySelector('.composer-reply-line strong')?.textContent === '回复 叮叮'
      && !document.querySelector('.mention-target-summary')
      && document.querySelector('.composer-send')?.disabled === false
  ))()`)
  const continuationStartedAt = Date.now()
  await mouseClick(running.cdp, '.composer-send')
  await waitForExpression(running.cdp, `(() => {
    const continuation = document.querySelector('.composer-continuation')
    return continuation?.getAttribute('aria-label') === '继续发给 咕咕'
      && continuation.textContent?.includes('继续发给 @咕咕')
      && document.querySelector('#camp-message')?.textContent === ''
  })()`, 5_000)
  const continuationVisibleAfterAcceptedSendMs = Date.now() - continuationStartedAt
  const continuedDraft = await waitForValue(async () =>
    request(running.cdp, 'camp.composerDraft.get', { campId }), (draft) =>
    composerIsEmpty(draft.content)
      && draft.replyIntent === null
      && draft.continuationIntent?.recipient.agentId === targetMemberIds[2], 5_000)
  const sentReplySnapshot = await waitForValue(async () =>
    request(running.cdp, 'camps.snapshot', { campId }), (snapshot) =>
    snapshot.messages.some((message) => message.sequence > messageSequenceBeforeRecipientRepair)
      && snapshot.messages.some((message) =>
        message.authorType === 'user'
          && message.replyToCampMessageId === currentUserMentionMessageId
          && deepEqual(message.addressedAgentIds, [targetMemberIds[2]])), 30_000)
  const sentReplyMessage = sentReplySnapshot.messages.find((message) =>
    message.authorType === 'user'
      && message.replyToCampMessageId === currentUserMentionMessageId
      && deepEqual(message.addressedAgentIds, [targetMemberIds[2]]))
  assert(sentReplyMessage,
    `Resolved reply did not create the expected message: ${JSON.stringify(sentReplySnapshot.messages)}`)
  await waitForSelector(running.cdp,
    `[data-message-id=${JSON.stringify(sentReplyMessage.id)}] .reply-parent-quote`, 30_000)
  const sentParentQuoteInspection = await evaluate(running.cdp, `(() => {
    const quote = document.querySelector(
      '[data-message-id=${JSON.stringify(sentReplyMessage.id)}] .reply-parent-quote'
    )
    const author = quote?.querySelector('strong')
    const excerpt = quote?.querySelector('span')
    if (
      !(quote instanceof HTMLElement)
      || !(author instanceof HTMLElement)
      || !(excerpt instanceof HTMLElement)
    ) return null
    const quoteStyle = getComputedStyle(quote)
    const authorStyle = getComputedStyle(author)
    const excerptStyle = getComputedStyle(excerpt)
    return {
      text: quote.textContent,
      borderTopWidth: quoteStyle.borderTopWidth,
      backgroundColor: quoteStyle.backgroundColor,
      whiteSpace: quoteStyle.whiteSpace,
      authorFlexShrink: authorStyle.flexShrink,
      authorOverflows: author.scrollWidth > author.clientWidth,
      excerptTextOverflow: excerptStyle.textOverflow,
      excerptOverflows: excerpt.scrollWidth > excerpt.clientWidth
    }
  })()`)
  assert(
    sentParentQuoteInspection
      && sentParentQuoteInspection.text.includes('叮叮')
      && sentParentQuoteInspection.borderTopWidth === '0px'
      && sentParentQuoteInspection.backgroundColor === 'rgba(0, 0, 0, 0)'
      && sentParentQuoteInspection.whiteSpace === 'nowrap'
      && sentParentQuoteInspection.authorFlexShrink === '0'
      && !sentParentQuoteInspection.authorOverflows
      && sentParentQuoteInspection.excerptTextOverflow === 'ellipsis'
      && sentParentQuoteInspection.excerptOverflows,
    `Sent reply parent quote is not one-line and frameless: ${JSON.stringify(sentParentQuoteInspection)}`
  )
  const sentReplyCapture = join(outputDir, 'message-reply-sent-parent-quote-night.png')
  await capture(running.cdp, sentReplyCapture)

  // Exercise the production minimum window at effective 200% desktop zoom.
  // Replying to the just-sent user message creates a normal quote without
  // adding a recipient, so the dock and the accepted parent quote are visible
  // together in the narrow CSS viewport.
  const detailClose = 'button[aria-label="收起会话详情"]'
  if (await evaluate(running.cdp,
    `Boolean(document.querySelector(${JSON.stringify(detailClose)})?.getClientRects().length)`)) {
    await mouseClick(running.cdp, detailClose)
    await waitForExpression(running.cdp,
      `!document.querySelector(${JSON.stringify(detailClose)})?.getClientRects().length`)
  }
  await moveMouseToElement(running.cdp,
    `[data-message-id=${JSON.stringify(sentReplyMessage.id)}] .message-bubble`)
  await mouseClick(running.cdp,
    `[data-message-id=${JSON.stringify(sentReplyMessage.id)}] .message-reply-button`)
  await waitForValue(async () => request(running.cdp, 'camp.composerDraft.get', { campId }),
    (draft) => draft.replyIntent?.replyToCampMessageId === sentReplyMessage.id
      && draft.replyIntent.author?.authorType === 'user'
      && draft.replyIntent.recipientSelectionRequired === false, 10_000)
  await emulateDesktopZoom(running.cdp, 1040, 700, 2)
  await waitForExpression(running.cdp, `(() => Boolean(
    document.querySelector('.composer-box')
      && document.querySelector('.composer-reply-line .composer-reply-copy > span')
      && document.querySelector(
        '[data-message-id=${JSON.stringify(sentReplyMessage.id)}] .reply-parent-quote'
      )
      && document.querySelector('.composer-send, .composer-stop')
  ))()`)
  const zoom200ReplyInspection = await evaluate(running.cdp, `(() => {
    const box = document.querySelector('.composer-box')
    const line = document.querySelector('.composer-reply-line')
    const excerpt = line?.querySelector('.composer-reply-copy > span')
    const parentQuote = document.querySelector(
      '[data-message-id=${JSON.stringify(sentReplyMessage.id)}] .reply-parent-quote'
    )
    const action = document.querySelector('.composer-send, .composer-stop')
    if (
      !(box instanceof HTMLElement)
      || !(line instanceof HTMLElement)
      || !(excerpt instanceof HTMLElement)
      || !(parentQuote instanceof HTMLElement)
      || !(action instanceof HTMLElement)
    ) return null
    const boxRect = box.getBoundingClientRect()
    const lineRect = line.getBoundingClientRect()
    const actionRect = action.getBoundingClientRect()
    return {
      cssViewport: [innerWidth, innerHeight],
      physicalViewport: [innerWidth * devicePixelRatio, innerHeight * devicePixelRatio],
      devicePixelRatio,
      documentOverflows: document.documentElement.scrollWidth > innerWidth,
      boxFits: boxRect.left >= 0 && boxRect.right <= innerWidth + 1,
      lineFits: line.scrollWidth <= line.clientWidth + 1,
      lineHeight: lineRect.height,
      excerptEllipsizes: getComputedStyle(excerpt).textOverflow === 'ellipsis'
        && getComputedStyle(excerpt).whiteSpace === 'nowrap',
      parentQuoteOneLine: getComputedStyle(parentQuote).whiteSpace === 'nowrap',
      actionVisible: actionRect.left >= 0 && actionRect.right <= innerWidth + 1
        && actionRect.top >= 0 && actionRect.bottom <= innerHeight + 1
    }
  })()`)
  assert(
    zoom200ReplyInspection
      && deepEqual(zoom200ReplyInspection.cssViewport, [520, 350])
      && deepEqual(zoom200ReplyInspection.physicalViewport, [1040, 700])
      && zoom200ReplyInspection.devicePixelRatio === 2
      && !zoom200ReplyInspection.documentOverflows
      && zoom200ReplyInspection.boxFits
      && zoom200ReplyInspection.lineFits
      && zoom200ReplyInspection.excerptEllipsizes
      && zoom200ReplyInspection.parentQuoteOneLine
      && zoom200ReplyInspection.actionVisible,
    `200% zoom hid or overflowed reply functionality: ${JSON.stringify(zoom200ReplyInspection)}`
  )
  const zoom200ReplyCapture = join(outputDir, 'message-reply-zoom-200-night.png')
  await capture(running.cdp, zoom200ReplyCapture)

  await mouseClick(running.cdp, '.composer-reply-cancel')
  await waitForValue(async () => request(running.cdp, 'camp.composerDraft.get', { campId }),
    (draft) => draft.replyIntent === null, 10_000)
  // The Core receipt can arrive before cancelReply's Renderer focus callback.
  // Finish that interaction before moving focus to the keyboard Reply action.
  await waitForExpression(running.cdp, `(() => (
    !document.querySelector('.composer-reply-line')
      && document.activeElement?.id === 'camp-message'
  ))()`)
  await setViewport(running.cdp, 1440, 920)
  await running.cdp.send('Page.bringToFront')
  await running.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  const keyboardReplyFocused = await evaluate(running.cdp, `(() => {
    const button = document.querySelector(
      '[data-message-id=${JSON.stringify(sentReplyMessage.id)}] .message-reply-button'
    )
    if (!(button instanceof HTMLButtonElement)) return false
    button.focus()
    return document.activeElement === button && button.getAttribute('aria-label') === '回复这条消息'
  })()`)
  assert(keyboardReplyFocused, 'Could not focus the Reply action for keyboard acceptance')
  await pressNativeButtonEnter(running.cdp)
  await waitForExpression(running.cdp, `(() => (
    document.activeElement?.id === 'camp-message'
      && !document.querySelector('.composer')?.classList.contains('suppress-pointer-focus-ring')
      && Boolean(document.querySelector('.composer-reply-line'))
  ))()`)

  result = {
    acceptance: 'structured-mentions-ui',
    appPath,
    outputDir,
    captures: {
      skillPicker: skillPickerCapture,
      candidateMenu: candidateMenuCapture,
      composer: composerCapture,
      composerPopover: composerPopoverCapture,
      sent: sentCapture,
      memberPopover: memberPopoverCapture,
      nativeSelection: selectionCapture,
      hoverCopy: copiedCapture,
      currentUserMention: currentUserMentionCapture,
      currentUserPasteDowngraded: currentUserPasteCapture,
      lightweightReply: lightweightReplyCapture,
      unavailableReply: unavailableReplyCapture,
      sentReply: sentReplyCapture,
      zoom200Reply: zoom200ReplyCapture
    },
    campId,
    selectedSkillName: selectableSkill.name,
    selectedSkillText,
    skillPickerInspection,
    inlineSkillInspection,
    firstNativeInputInspection,
    firstNativeCompositionInspection,
    imeNewlineInspection,
    campMessageId: sent.message.id,
    campTurnId: sent.message.campTurnId,
    agentRunIds: sent.runs.map((run) => run.id),
    agentRunTargets: sent.runs.map((run) => run.agentId),
    agentRunCreatedAt: sent.runs[0].createdAt,
    structuredContent: sent.message.content,
    submittedRunAutoOpen,
    memberPopoverActivations: ['composer-click', 'history-click', 'history-Enter', 'history-Space'],
    memberPopoverStayedInCamp: true,
    mentionSelectedText,
    selectedText,
    currentUserMentionInspection,
    agentMemberMentionInspection,
    currentUserClipboardPayload,
    currentUserPasteDowngradedToText: true,
    availableReplyDraft,
    lightweightReplyInspection,
    unavailableReplyDraft,
    unresolvedReplyDraft,
    unresolvedReplyInspection,
    resolvedReplyDraft,
    continuedDraft,
    continuationVisibleAfterAcceptedSendMs,
    sentReplyMessage,
    sentParentQuoteInspection,
    zoom200ReplyInspection,
    keyboardReplyPathEnabled: true,
    clipboardItemCountBeforeTest: clipboardArchive.length,
    clipboardRestored: false,
    isolatedUserDataRemoved: false
  }
  }
  }
} catch (error) {
  testFailure = error
  if (running) {
    let diagnosticTimer
    try {
      await Promise.race([
        (async () => {
          await capture(running.cdp, join(outputDir, 'failure.png'))
          const state = await evaluate(running.cdp, `(() => ({
            activeElement: { id: document.activeElement?.id, className: document.activeElement?.className },
            selectedRuns: [...document.querySelectorAll('.run-pulse-chip.is-selected')].map((node) => ({ ...node.dataset })),
            focusedStages: [...document.querySelectorAll('.execution-process-stage.is-focused')].map((node) => ({ ...node.dataset })),
            drawerCount: document.querySelectorAll('.execution-drawer').length,
            composerText: document.querySelector('#camp-message')?.innerText ?? null
          }))()`)
          await writeFile(join(outputDir, 'failure-state.json'), JSON.stringify(state, null, 2))
        })(),
        new Promise((_, reject) => {
          diagnosticTimer = setTimeout(() => reject(new Error('Failure diagnostics timed out')), 3_000)
        })
      ])
    } catch (captureError) {
      process.stderr.write(`Could not capture acceptance failure: ${captureError}\n`)
    } finally {
      clearTimeout(diagnosticTimer)
    }
  }
} finally {
  if (running) {
    try {
      await closeApp(running)
    } catch (error) {
      cleanupFailure = error
    }
  }
  if (clipboardTouched && clipboardArchive) {
    try {
      await restoreClipboardWithRetry(clipboardArchive)
      clipboardRestored = true
    } catch (error) {
      cleanupFailure = cleanupFailure
        ? new AggregateError([cleanupFailure, error], 'App cleanup and clipboard restoration failed')
        : error
    }
  } else if (clipboardArchive) {
    clipboardRestored = true
  }
}

if (testFailure || cleanupFailure) {
  process.stderr.write(`Preserved structured mention fixture: ${fixtureRoot}\n`)
  process.stderr.write(`Preserved structured mention Runtime temp: ${runtimeTempDir}\n`)
  process.stderr.write(`Preserved structured mention captures: ${outputDir}\n`)
  if (testFailure && cleanupFailure) {
    throw new AggregateError([testFailure, cleanupFailure],
      'Structured mention acceptance and cleanup both failed')
  }
  throw testFailure ?? cleanupFailure
}

if (!suppliedFixtureRoot) {
  await removeEphemeralRuntimeCampFilesRoot(dataDir, {
    homeDirectory: acceptanceHome,
    temporaryDirectory: tmpdir()
  })
  await removeDirectoryWithRetry(fixtureRoot)
}
if (!suppliedRuntimeTempDir) {
  await removeDirectoryWithRetry(runtimeTempDir)
}
result.clipboardRestored = clipboardRestored
result.isolatedUserDataRemoved = !suppliedFixtureRoot
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)

async function installAcceptanceRuntime(path, agentIds) {
  const ids = agentIds.map(sqlLiteral).join(', ')
  await runSql(path, `
    PRAGMA foreign_keys = ON;
    DELETE FROM adapter_installation
    WHERE adapter_kind = 'codex-cli'
      AND auth_scope = 'default'
      AND installation_class = 'managed_default';
    INSERT INTO adapter_installation(
      id, adapter_kind, executable_path, command_name,
      installation_class, source, auth_scope, enabled,
      generation, path_state, version, created_at, updated_at
    ) VALUES (
      'adapter-structured-mentions-accept', 'codex-cli', '${acceptanceExecutablePath}',
      'codex', 'managed_default', 'known_location', 'default', 1,
      1, 'valid', 1, datetime('now'), datetime('now')
    );
    INSERT INTO adapter_capability_snapshot(
      installation_id, reported_version, executable_fingerprint,
      authentication_status, probe_status, permission_schema_version,
      permission_schema_digest, capabilities_json, protocols_json,
      model_catalog_json, permission_options_json, observed_at,
      last_attempted_at, last_successful_probe_at, stale_at, last_error,
      native_session_compatibility_key
    ) VALUES (
      'adapter-structured-mentions-accept', 'acceptance',
      ${sqlLiteral(acceptanceExecutableFingerprint)},
      'authenticated', 'ready', 1, 'sha256:acceptance-permissions',
      ${sqlLiteral(acceptanceCapabilities)}, ${sqlLiteral(acceptanceProtocols)},
      ${sqlLiteral(acceptanceModelCatalog)}, ${sqlLiteral(acceptancePermissionOptions)},
      datetime('now'), datetime('now'), datetime('now'), NULL, NULL,
      'codex-cli:app-server-v2'
    );
    UPDATE agent_profile
    SET selected_runtime_adapter_kind = 'codex-cli',
        default_runtime_installation_id = 'adapter-structured-mentions-accept',
        default_model_selection_json = '{"mode":"runtime_default"}',
        default_permission_config_json =
          '{"adapterKind":"codex-cli","schemaVersion":1,"values":{"sandbox_mode":"workspace-write","approval_policy":"on-request"}}'
    WHERE id IN (${ids});
  `)
}

async function insertCurrentUserMentionFixture(path, campId) {
  const contentJson = JSON.stringify(currentUserMentionContent)
  await runSql(path, `
    BEGIN IMMEDIATE;
    UPDATE camp
    SET last_message_sequence = last_message_sequence + 1,
        version = version + 1,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ${sqlLiteral(campId)};
    INSERT INTO camp_message(
      id, camp_id, sequence, author_type, author_id, body,
      structured_content_json, content_digest, address_mode,
      addressed_agent_ids_json, version, created_at, updated_at
    ) SELECT
      ${sqlLiteral(currentUserMentionMessageId)}, id, last_message_sequence,
      'agent', 'agent_1', ${sqlLiteral(currentUserMentionBody)},
      ${sqlLiteral(contentJson)},
      ${sqlLiteral(`sha256:structured-mentions-accept:${currentUserMentionMessageId}`)},
      'default', '[]', 1,
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM camp WHERE id = ${sqlLiteral(campId)};
    COMMIT;
  `)
}

async function insertAgentMemberMentionFixtures(path, campId) {
  // These are inert presentation fixtures: no Delivery, Run or model invocation.
  for (const message of [
    { id: agentMemberMentionMessageId, body: agentMemberMentionBody, content: agentMemberMentionContent, recipients: ['agent_1'] },
    { id: agentLiteralMentionMessageId, body: agentLiteralMentionBody, content: [{ kind: 'text', text: agentLiteralMentionBody }], recipients: [] }
  ]) {
    await runSql(path, `
      BEGIN IMMEDIATE;
      UPDATE camp SET last_message_sequence = last_message_sequence + 1, version = version + 1
      WHERE id = ${sqlLiteral(campId)};
      INSERT INTO camp_message(
        id, camp_id, sequence, author_type, author_id, body, structured_content_json,
        content_digest, address_mode, addressed_agent_ids_json, effective_recipient_ids_json,
        agent_addressing_mode, version, created_at, updated_at
      ) SELECT
        ${sqlLiteral(message.id)}, id, last_message_sequence, 'agent', 'agent_2',
        ${sqlLiteral(message.body)}, ${sqlLiteral(JSON.stringify(message.content))},
        ${sqlLiteral(`sha256:structured-mentions-accept:${message.id}`)},
        ${sqlLiteral(message.recipients.length ? 'explicit' : 'default')},
        ${sqlLiteral(JSON.stringify(message.recipients))}, ${sqlLiteral(JSON.stringify(message.recipients))},
        'automatic', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM camp WHERE id = ${sqlLiteral(campId)};
      COMMIT;
    `)
  }
}

async function acceptAgentMemberMention(cdp) {
  const messageSelector = `[data-message-id="${agentMemberMentionMessageId}"]`
  const tokenSelector = `${messageSelector} .message-mention-token[data-agent-id="agent_1"]`
  await waitForSelector(cdp, tokenSelector)
  const cases = []
  const screenshots = {}
  for (const variant of [
    { name: 'day', theme: 'day', width: 1440, height: 920 },
    { name: 'night', theme: 'night', width: 1440, height: 920 },
    { name: 'day-compact', theme: 'day', width: 1040, height: 700 },
    { name: 'night-compact', theme: 'night', width: 1040, height: 700 },
    { name: 'night-wide', theme: 'night', width: 2560, height: 1440 },
    { name: 'night-zoom200', theme: 'night', width: 2560, height: 1440, zoom: 2 }
  ]) {
    await setTheme(cdp, variant.theme)
    if (variant.zoom) await emulateDesktopZoom(cdp, variant.width, variant.height, variant.zoom)
    else await setViewport(cdp, variant.width, variant.height)
    await evaluate(cdp, `document.querySelector(${JSON.stringify(messageSelector)})?.scrollIntoView({ block: 'start' })`)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2, button: 'none', buttons: 0 })
    await wait(180)
    const inspection = await evaluate(cdp, `(() => {
      const message = document.querySelector(${JSON.stringify(messageSelector)})
      const token = message?.querySelector('.message-mention-token')
      const body = message?.querySelector('.member-mention-markdown-content')
      const paragraph = body?.querySelector('p')
      if (!token || !body || !paragraph) return null
      const style = getComputedStyle(token)
      const colorProbe = document.createElement('span')
      colorProbe.style.color = 'var(--mention-ink)'
      document.body.appendChild(colorProbe)
      const expectedColor = getComputedStyle(colorProbe).color
      colorProbe.remove()
      const line = document.createRange()
      const bodyText = [...paragraph.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim())
      line.setStart(bodyText, 0)
      line.setEnd(bodyText, 1)
      const paragraphStyle = getComputedStyle(paragraph)
      const timeline = document.querySelector('.camp-timeline')
      const literal = document.querySelector('[data-message-id="${agentLiteralMentionMessageId}"]')
      return {
        tokenText: token.textContent,
        role: token.getAttribute('role'), tabIndex: token.getAttribute('tabindex'),
        label: token.getAttribute('aria-label'), popup: token.getAttribute('aria-haspopup'),
        color: style.color, expectedColor, background: style.backgroundColor,
        display: style.display, cursor: style.cursor,
        sameLine: Math.abs(token.getBoundingClientRect().top - line.getBoundingClientRect().top) < 3,
        paragraphDisplay: paragraphStyle.display,
        proseWidthPreserved: innerWidth < 1800 || (
          paragraph.getBoundingClientRect().width <= parseFloat(paragraphStyle.maxWidth) + 1
          && Number.isFinite(parseFloat(paragraphStyle.maxWidth))
        ),
        heading: body.querySelector('h3')?.textContent,
        listCount: body.querySelectorAll('li').length,
        strong: body.querySelector('strong')?.textContent,
        code: body.querySelector('pre code')?.textContent?.trim(),
        table: Boolean(body.querySelector('table')),
        fileLink: Boolean(body.querySelector('a[title="docs/plan.md"]')),
        literalText: literal?.querySelector('.safe-markdown')?.textContent,
        literalHasToken: Boolean(literal?.querySelector('.message-mention-token')),
        noOverflow: document.documentElement.scrollWidth <= innerWidth + 1
          && timeline.scrollWidth <= timeline.clientWidth + 1
      }
    })()`)
    assert(inspection && inspection.tokenText === '@叮叮'
      && inspection.role === 'button' && inspection.tabIndex === '0'
      && inspection.label === '查看叮叮的基础信息' && inspection.popup === 'dialog'
      && inspection.color === inspection.expectedColor && inspection.background === 'rgba(0, 0, 0, 0)'
      && inspection.display === 'inline' && inspection.cursor === 'pointer'
      && inspection.sameLine && inspection.paragraphDisplay === 'block' && inspection.proseWidthPreserved
      && inspection.heading === '事实复核' && inspection.listCount === 2
      && inspection.strong === '通过' && inspection.code === 'pnpm test'
      && inspection.table && inspection.fileLink && inspection.noOverflow
      && inspection.literalText === agentLiteralMentionBody && !inspection.literalHasToken,
    `Agent Member Mention regression (${variant.name}): ${JSON.stringify(inspection)}`)
    cases.push({ variant: variant.name, ...inspection })
    screenshots[variant.name] = join(outputDir, `agent-member-mention-${variant.name}.png`)
    await capture(cdp, screenshots[variant.name])
  }

  await setViewport(cdp, 1440, 920)
  await setTheme(cdp, 'night')
  await evaluate(cdp, `window.getSelection()?.removeAllRanges()`)
  await mouseClick(cdp, tokenSelector)
  await waitForExpression(cdp, `document.querySelector('.mention-profile-popover')?.classList.contains('is-positioned')`)
  await wait(180)
  assertSelectedMemberPopover(await inspectMentionPopover(cdp), 'Agent leading Mention click')
  screenshots.popover = join(outputDir, 'agent-member-mention-popover.png')
  await capture(cdp, screenshots.popover)
  await pressEscape(cdp)
  await waitForExpression(cdp, `!document.querySelector('.mention-profile-popover')`)
  for (const activation of [
    { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 36 },
    { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 49 }
  ]) {
    await evaluate(cdp, `document.querySelector(${JSON.stringify(tokenSelector)})?.focus()`)
    await pressKey(cdp, activation)
    await waitForExpression(cdp, `document.querySelector('.mention-profile-popover')?.classList.contains('is-positioned')`)
    await wait(180)
    assertSelectedMemberPopover(await inspectMentionPopover(cdp), `Agent leading Mention ${activation.code}`)
    await pressEscape(cdp)
    await waitForExpression(cdp, `!document.querySelector('.mention-profile-popover')
      && document.activeElement === document.querySelector(${JSON.stringify(tokenSelector)})`)
  }

  const drag = await evaluate(cdp, `(() => {
    const token = document.querySelector(${JSON.stringify(tokenSelector)})
    token.scrollIntoView({ block: 'center' })
    const paragraph = document.querySelector(${JSON.stringify(messageSelector)} + ' .member-mention-markdown-content > p')
    const text = [...paragraph.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim())
    const point = (node, offset, end) => {
      const range = document.createRange()
      range.setStart(node, offset); range.setEnd(node, offset + 1)
      const rect = range.getBoundingClientRect()
      return { x: end ? rect.right - 0.1 : rect.left + 0.1, y: rect.top + rect.height / 2 }
    }
    return { start: point(token.firstChild, 0, false), end: point(text, text.textContent.indexOf('review') + 5, true) }
  })()`)
  await dispatchMouseDrag(cdp, drag.start, drag.end)
  const selectedText = await evaluate(cdp, `window.getSelection()?.toString() ?? ''`)
  assert(selectedText.includes('@叮叮') && selectedText.includes('review')
    && !(await evaluate(cdp, `Boolean(document.querySelector('.mention-profile-popover'))`)),
  `Agent Mention drag selection failed: ${JSON.stringify(selectedText)}`)
  await evaluate(cdp, `window.getSelection()?.removeAllRanges()`)
  await moveMouseToElement(cdp, `${messageSelector} .message-surface`)
  await mouseClick(cdp, `${messageSelector} .message-copy-button`)
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(messageSelector)} + ' .copy-feedback')?.textContent === '已复制'`)
  const copiedText = await runProcess('/usr/bin/pbpaste', [])
  assert(copiedText === agentMemberMentionBody, `Agent Mention copy lost source content: ${JSON.stringify(copiedText)}`)
  await evaluate(cdp, `document.querySelector('[data-message-id="${currentUserMentionMessageId}"]')?.scrollIntoView({ block: 'center' })`)
  return { cases, screenshots, activations: ['click', 'Enter', 'Space'], selectedText, copyPreserved: true }
}

async function removeDirectoryWithRetry(path) {
  let lastError = null
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true })
      return
    } catch (error) {
      if (!['ENOTEMPTY', 'EBUSY', 'EPERM'].includes(error?.code)) throw error
      lastError = error
      await wait(100)
    }
  }
  throw lastError ?? new Error(`Could not remove ${path}`)
}

async function launchApp(userDataDir, port, width, height) {
  const stderr = []
  const child = spawn(join(appPath, 'Contents', 'MacOS', 'Rovai AI'), [
    ...(process.env.ROVAI_STRUCTURED_MENTIONS_ACCEPT_DISABLE_SANDBOX === '1'
      ? ['--no-sandbox']
      : []),
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`
  ], {
    cwd: root,
    env: {
      ...process.env,
      HOME: acceptanceHome,
      TMPDIR: runtimeTempDir,
      ROVAI_ALLOW_ISOLATED_INSTANCE: '1'
    },
    stdio: ['ignore', 'ignore', 'pipe']
  })
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
  let cdp = null
  try {
    const target = await waitForTarget(port, stderr)
    cdp = await connectCdp(target.webSocketDebuggerUrl)
    await cdp.send('Page.enable')
    await cdp.send('Page.bringToFront')
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
    })
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false
    })
    await waitForExpression(cdp,
      `Boolean(window.rovai && document.querySelector('.app-shell'))`, 45_000)
    await waitForValue(() => evaluate(cdp, 'window.rovai.supervisor.getSnapshot()', true),
      (snapshot) => snapshot.fullCoreState === 'ready'
        && ['skills', 'mcp', 'attachments', 'builtin-tools'].every((id) =>
          snapshot.coreSubsystems.some((subsystem) => subsystem.id === id && subsystem.state === 'ready')),
      45_000)
    const health = await request(cdp, 'health.check')
    const expectedDatabasePath = await realpath(join(userDataDir, 'rovai.sqlite'))
    const actualDatabasePath = await realpath(health.database.path)
    assert(actualDatabasePath === expectedDatabasePath,
      `Isolated App opened the wrong database: ${JSON.stringify({ expectedDatabasePath, actualDatabasePath })}`)
    return { cdp, child, port, stderr }
  } catch (error) {
    cdp?.close()
    await terminateChild(child)
    await writeFile(join(outputDir, 'app-launch-failure.log'), stderr.join(''))
    throw error
  }
}

async function closeApp(app) {
  try {
    await Promise.race([app.cdp.send('Browser.close'), wait(1_000)])
  } catch {
    // The isolated App may already have exited.
  }
  app.cdp.close()
  const startedAt = Date.now()
  while (Date.now() - startedAt < 5_000) {
    try {
      await fetch(`http://127.0.0.1:${app.port}/json`, {
        signal: AbortSignal.timeout(500)
      })
    } catch {
      await terminateChild(app.child)
      return
    }
    await wait(100)
  }
  await terminateChild(app.child)
  try {
    await fetch(`http://127.0.0.1:${app.port}/json`, {
      signal: AbortSignal.timeout(500)
    })
  } catch {
    return
  }
  throw new Error(`Isolated App did not close debug port ${app.port}`)
}

async function reloadRenderer(cdp) {
  await cdp.send('Page.reload', { ignoreCache: true })
  await waitForExpression(cdp,
    `Boolean(window.rovai && document.querySelector('.app-shell'))`, 45_000)
  await waitForExpression(cdp,
    `Boolean(document.querySelector('.unified-sidebar button[aria-label="新对话"]:not(:disabled)'))`,
    45_000)
}

async function openCamp(cdp, campId) {
  await waitForExpression(cdp, `(() => {
    const target = ${JSON.stringify(`camp:${campId}`)}
    return [...document.querySelectorAll('[data-sidebar-menu-target]')]
      .some((element) => element.dataset.sidebarMenuTarget === target)
  })()`, 30_000)
  const opened = await evaluate(cdp, `(() => {
    const target = ${JSON.stringify(`camp:${campId}`)}
    const menu = [...document.querySelectorAll('[data-sidebar-menu-target]')]
      .find((element) => element.dataset.sidebarMenuTarget === target)
    const button = menu?.closest('.camp-nav-row')?.querySelector('.camp-nav-open')
    button?.click()
    return Boolean(button)
  })()`)
  assert(opened, `Could not open Camp ${campId}`)
  await waitForSelector(cdp, '.camp-workspace', 30_000)
}

async function acceptImeNewlineRegression(cdp, campId) {
  await selectWholeEditor(cdp)
  await pressKey(cdp, {
    key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 51
  })
  await waitForValue(async () => request(cdp, 'camp.composerDraft.get', { campId }),
    (draft) => deepEqual(draft.content, emptyComposerDocument), 10_000)

  await focusEditorAtEnd(cdp)
  await evaluate(cdp, `(() => {
    window.__composerImeNewlineEditor = document.querySelector('#camp-message')
  })()`)
  await cdp.send('Input.imeSetComposition', {
    text: 'nihao', selectionStart: 5, selectionEnd: 5
  })
  await cdp.send('Input.insertText', { text: '你好' })
  const composedDraft = await waitForValue(
    () => request(cdp, 'camp.composerDraft.get', { campId }),
    (draft) => deepEqual(draft.content,
      composerDocumentFromStructured([{ kind: 'text', text: '你好' }])),
    10_000
  )

  await pressKey(cdp, {
    key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 36, modifiers: 8
  })
  const trailingNewlineDraft = await waitForValue(
    () => request(cdp, 'camp.composerDraft.get', { campId }),
    (draft) => deepEqual(draft.content,
      composerDocumentFromStructured([{ kind: 'text', text: '你好\n' }])),
    10_000
  )
  const trailingNewlineInspection = await evaluate(cdp, `(() => {
    const editor = document.querySelector('#camp-message')
    return {
      stayedMounted: editor === window.__composerImeNewlineEditor,
      focused: document.activeElement === editor,
      paragraphCount: editor?.querySelectorAll(':scope > p').length ?? -1,
      lineBreakCount: editor?.querySelectorAll(':scope > p > br').length ?? -1
    }
  })()`)
  assert(
    trailingNewlineInspection.stayedMounted
      && trailingNewlineInspection.focused
      && trailingNewlineInspection.paragraphCount === 1
      && trailingNewlineInspection.lineBreakCount >= 1,
    `Shift+Enter did not create one Lexical line break: ${JSON.stringify(trailingNewlineInspection)}`
  )

  await cdp.send('Input.insertText', { text: 'n' })
  const draft = await waitForValue(
    () => request(cdp, 'camp.composerDraft.get', { campId }),
    (value) => deepEqual(value.content,
      composerDocumentFromStructured([{ kind: 'text', text: '你好\nn' }])),
    10_000
  )
  const postNewlineInputInspection = await evaluate(cdp, `(() => {
    const editor = document.querySelector('#camp-message')
    return {
      stayedMounted: editor === window.__composerImeNewlineEditor,
      focused: document.activeElement === editor,
      text: editor?.textContent ?? null,
      paragraphCount: editor?.querySelectorAll(':scope > p').length ?? -1
    }
  })()`)
  assert(
    postNewlineInputInspection.stayedMounted
      && postNewlineInputInspection.focused
      && postNewlineInputInspection.paragraphCount === 1,
    `The first native character after a line break left Lexical: ${JSON.stringify(postNewlineInputInspection)}`
  )

  await selectWholeEditor(cdp)
  await pressKey(cdp, {
    key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 51
  })
  await waitForValue(async () => request(cdp, 'camp.composerDraft.get', { campId }),
    (value) => deepEqual(value.content, emptyComposerDocument), 10_000)

  return {
    composedDraft,
    trailingNewlineDraft,
    trailingNewlineInspection,
    postNewlineInputInspection,
    draft
  }
}
async function acceptInlineSkillQueries(cdp, campId, skill) {
  const query = `/${skill.name.slice(0, 4)}`
  const optionSelector = `.skill-picker-menu [data-skill-name=${JSON.stringify(skill.name)}]`
  const skillToken = { kind: 'skill_mention', skillId: skill.id, nameAtSend: skill.name }
  const before = await request(cdp, 'camps.snapshot', { campId })
  const expectDraft = (content) => waitForValue(
    () => request(cdp, 'camp.composerDraft.get', { campId }),
    (draft) => deepEqual(draft.content, content), 10_000)
  const expectOpen = () => waitForSelector(cdp, optionSelector)
  const expectClosed = () => waitForExpression(cdp,
    `document.querySelector('#camp-message')?.getAttribute('aria-expanded') === 'false'`)
  const replaceText = async (text) => {
    await selectWholeEditor(cdp)
    if (text) {
      const lines = text.split('\n')
      for (const [index, line] of lines.entries()) {
        if (index > 0) await pressKey(cdp, {
          key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 36, modifiers: 8
        })
        if (line) await cdp.send('Input.insertText', { text: line })
      }
    } else {
      await pressKey(cdp, {
        key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 51
      })
    }
    await expectDraft(text ? [{ kind: 'text', text }] : [])
  }
  const chooseSkill = async () => {
    await expectOpen()
    await moveMouseToElement(cdp, optionSelector)
    await waitForExpression(cdp,
      `document.querySelector(${JSON.stringify(optionSelector)})?.getAttribute('aria-selected') === 'true'`)
    await pressKey(cdp, {
      key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 48
    })
    await expectClosed()
  }

  const safeBoundaries = ['请使用 ', '你好，', '第一行\n', '请\u3000']
  for (const prefix of safeBoundaries) {
    await replaceText(`${prefix}${query}`)
    await expectOpen()
    await pressEscape(cdp)
    await expectClosed()
  }
  const literalSlashText = ['https://example.com', '/usr/local', 'foo/bar', 'a/b', `正文${query}`, `${query} `]
  for (const text of literalSlashText) {
    await replaceText(text)
    await expectClosed()
  }

  await replaceText('请粘贴 ')
  await runProcess('/usr/bin/pbcopy', [], { input: query })
  await pasteWithMetaV(cdp)
  await expectOpen()
  await expectDraft([{ kind: 'text', text: `请粘贴 ${query}` }])
  await pressEscape(cdp)

  await replaceText('前文 待替换 后文')
  const selected = await evaluate(cdp, `(() => {
    const editor = document.querySelector('#camp-message')
    if (!(editor instanceof HTMLElement)) return false
    editor.focus()
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      const start = node.textContent.indexOf('待替换')
      if (start < 0) continue
      window.getSelection().setBaseAndExtent(node, start, node, start + 3)
      return true
    }
    return false
  })()`)
  assert(selected, 'Could not select the middle of the Composer body')
  await cdp.send('Input.insertText', { text: query })
  await chooseSkill()
  const replacedDraft = await expectDraft([
    { kind: 'text', text: '前文 ' }, skillToken, { kind: 'text', text: ' 后文' }
  ])
  assert(replacedDraft.body === `前文 /${skill.name} 后文`,
    `Inline Skill replacement lost text or duplicated whitespace: ${JSON.stringify(replacedDraft)}`)

  await replaceText('@')
  await mouseClickMentionOption(cdp, targetMembers[0].displayName)
  await expectDraft([
    { kind: 'member_mention', agentId: targetMembers[0].agentId }, { kind: 'text', text: ' ' }
  ])
  await pressKey(cdp, {
    key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 51
  })
  await expectDraft([{ kind: 'member_mention', agentId: targetMembers[0].agentId }])
  await cdp.send('Input.insertText', { text: ` ${query}` })
  await chooseSkill()
  const atomDraft = await expectDraft([
    { kind: 'member_mention', agentId: targetMembers[0].agentId },
    { kind: 'text', text: ' ' }, skillToken, { kind: 'text', text: ' ' }
  ])
  assert(atomDraft.body === `@${targetMembers[0].displayName} /${skill.name} `,
    `Inline Skill replacement changed the preceding member: ${JSON.stringify(atomDraft)}`)

  await replaceText('请使用 /')
  const layouts = []
  for (const [theme, width, height] of [['day', 1440, 920], ['night', 1040, 700]]) {
    await setTheme(cdp, theme)
    await setViewport(cdp, width, height)
    await focusEditorAtEnd(cdp)
    await expectOpen()
    await moveMouseToElement(cdp, '.skill-picker-menu [role="option"]')
    await waitForExpression(cdp,
      `document.querySelector('.skill-picker-menu [role="option"]')?.getAttribute('aria-selected') === 'true'`)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 })
    await pressKey(cdp, {
      key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 126
    })
    const layout = await evaluate(cdp, `(() => {
      const editor = document.querySelector('#camp-message')
      const menu = document.querySelector('.skill-picker-menu')
      const active = menu?.querySelector('[aria-selected="true"]')
      if (!editor || !menu || !active) return null
      const menuRect = menu.getBoundingClientRect()
      const editorRect = editor.getBoundingClientRect()
      const activeRect = active.getBoundingClientRect()
      const options = [...menu.querySelectorAll('[role="option"]')]
      return {
        theme: document.documentElement.dataset.theme,
        width: innerWidth, height: innerHeight,
        menuAboveEditor: menuRect.bottom <= editorRect.top - 5,
        viewportFits: menuRect.left >= 0 && menuRect.right <= innerWidth
          && menuRect.top >= 0 && menuRect.bottom <= innerHeight,
        activeVisible: activeRect.top >= menuRect.top && activeRect.bottom <= menuRect.bottom,
        activeIsLast: active === options.at(-1),
        activeDescendantMatches: editor.getAttribute('aria-activedescendant') === active.id,
        optionCount: options.length,
        menuOverflows: menu.scrollHeight > menu.clientHeight,
        menuScrollTop: menu.scrollTop
      }
    })()`)
    assert(layout?.theme === theme && layout.width === width && layout.height === height
      && layout.menuAboveEditor && layout.viewportFits && layout.activeVisible
      && layout.activeIsLast && layout.activeDescendantMatches
      && (!layout.menuOverflows || layout.menuScrollTop > 0),
    `Inline Skill menu layout or keyboard visibility regressed: ${JSON.stringify(layout)}`)
    const capturePath = join(outputDir, `composer-inline-skills-${theme}-${width}.png`)
    await capture(cdp, capturePath)
    layouts.push({ ...layout, capture: capturePath })
  }
  await setTheme(cdp, 'day')
  await setViewport(cdp, 1440, 920)
  await replaceText('')
  const after = await request(cdp, 'camps.snapshot', { campId })
  assert(after.messages.length === before.messages.length
    && after.agentRuns.length === before.agentRuns.length,
  'Typing or selecting an inline Skill must not send a message or start a Run')
  return {
    safeBoundaries, literalSlashText,
    nativePasteRemainsTextUntilSelected: true,
    partialReplacement: replacedDraft.content,
    preservedMember: atomDraft.content,
    noAutomaticSend: true,
    layouts
  }
}

async function acceptComposerCutRegression(cdp, campId) {
  await selectWholeEditor(cdp)
  await pressKey(cdp, {
    key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 51
  })
  await waitForValue(async () => request(cdp, 'camp.composerDraft.get', { campId }),
    (draft) => deepEqual(draft.content, []) && draft.body === '', 10_000)

  await focusEditorAtEnd(cdp)
  await cdp.send('Input.insertText', { text: '123' })
  await waitForValue(async () => request(cdp, 'camp.composerDraft.get', { campId }),
    (draft) => deepEqual(draft.content, [{ kind: 'text', text: '123' }])
      && draft.body === '123', 10_000)
  await evaluate(cdp, `(() => {
    window.__composerCutEditor = document.querySelector('#camp-message')
    window.__composerCutShell = document.querySelector('.app-shell')
    window.__composerCutWorkspace = document.querySelector('.camp-workspace')
    window.__composerCutErrors = []
    window.addEventListener('error', (event) => {
      window.__composerCutErrors.push({
        message: event.message,
        stack: event.error instanceof Error ? event.error.stack : null
      })
    })
  })()`)

  await selectWholeEditor(cdp)
  await cutSelectionWithMetaX(cdp)
  const clipboardText = await waitForValue(
    () => runProcess('/usr/bin/pbpaste', []),
    (text) => text === '123',
    3_000
  )
  const emptyDraft = await waitForValue(
    () => request(cdp, 'camp.composerDraft.get', { campId }),
    (draft) => deepEqual(draft.content, []) && draft.body === '',
    10_000
  )
  await evaluate(cdp,
    `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`, true)
  const afterCut = await evaluate(cdp, `(() => {
    const editor = document.querySelector('#camp-message')
    return {
      appShellStayedMounted: document.querySelector('.app-shell') === window.__composerCutShell,
      workspaceStayedMounted: document.querySelector('.camp-workspace') === window.__composerCutWorkspace,
      editorStayedMounted: editor === window.__composerCutEditor,
      editorFocused: document.activeElement === editor,
      editorText: editor?.textContent ?? null,
      editorHtml: editor?.innerHTML ?? null,
      paragraphCount: editor?.querySelectorAll(':scope > p').length ?? -1,
      breakCount: editor?.querySelectorAll(':scope > p > br').length ?? -1,
      errors: window.__composerCutErrors ?? []
    }
  })()`)
  assert(
    afterCut.appShellStayedMounted
      && afterCut.workspaceStayedMounted
      && afterCut.editorStayedMounted
      && afterCut.editorFocused
      && afterCut.editorText === ''
      && afterCut.paragraphCount === 1
      && afterCut.breakCount === 1
      && afterCut.errors.length === 0,
    `Command+X did not leave one stable empty Composer: ${JSON.stringify(afterCut)}`
  )

  await cdp.send('Input.insertText', { text: '7' })
  const nextDraft = await waitForValue(
    () => request(cdp, 'camp.composerDraft.get', { campId }),
    (draft) => deepEqual(draft.content, [{ kind: 'text', text: '7' }]) && draft.body === '7',
    10_000
  )
  await evaluate(cdp,
    `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`, true)
  const afterSingleInput = await evaluate(cdp, `(() => {
    const editor = document.querySelector('#camp-message')
    return {
      appShellStayedMounted: document.querySelector('.app-shell') === window.__composerCutShell,
      workspaceStayedMounted: document.querySelector('.camp-workspace') === window.__composerCutWorkspace,
      editorStayedMounted: editor === window.__composerCutEditor,
      editorFocused: document.activeElement === editor,
      editorText: editor?.textContent ?? null,
      errors: window.__composerCutErrors ?? []
    }
  })()`)
  assert(
    afterSingleInput.appShellStayedMounted
      && afterSingleInput.workspaceStayedMounted
      && afterSingleInput.editorStayedMounted
      && afterSingleInput.editorFocused
      && afterSingleInput.editorText === '7'
      && afterSingleInput.errors.length === 0,
    `One post-cut digit did not stay one digit: ${JSON.stringify(afterSingleInput)}`
  )

  await selectWholeEditor(cdp)
  const nativeDeleteApplied = await evaluate(cdp, `document.execCommand('delete')`)
  assert(nativeDeleteApplied, 'Chromium did not apply the native delete command')
  const afterNativeEmptyDraft = await waitForValue(
    () => request(cdp, 'camp.composerDraft.get', { campId }),
    (draft) => deepEqual(draft.content, []) && draft.body === '',
    10_000
  )
  await evaluate(cdp,
    `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`, true)
  const afterNativeEmpty = await evaluate(cdp, `(() => {
    const editor = document.querySelector('#camp-message')
    return {
      appShellStayedMounted: document.querySelector('.app-shell') === window.__composerCutShell,
      workspaceStayedMounted: document.querySelector('.camp-workspace') === window.__composerCutWorkspace,
      editorFocused: document.activeElement === editor,
      editorText: editor?.textContent ?? null,
      editorHtml: editor?.innerHTML ?? null,
      paragraphCount: editor?.querySelectorAll(':scope > p').length ?? -1,
      breakCount: editor?.querySelectorAll(':scope > p > br').length ?? -1,
      errors: window.__composerCutErrors ?? []
    }
  })()`)
  assert(
    afterNativeEmpty.appShellStayedMounted
      && afterNativeEmpty.workspaceStayedMounted
      && afterNativeEmpty.editorFocused
      && afterNativeEmpty.editorText === ''
      && afterNativeEmpty.paragraphCount === 1
      && afterNativeEmpty.breakCount === 1
      && afterNativeEmpty.errors.length === 0,
    `A native empty filler became semantic content: ${JSON.stringify(afterNativeEmpty)}`
  )

  return {
    clipboardText,
    emptyDraft,
    afterCut,
    nextDraft,
    afterSingleInput,
    nativeDeleteApplied,
    afterNativeEmptyDraft,
    afterNativeEmpty
  }
}

async function focusEditorAtEnd(cdp) {
  const focused = await evaluate(cdp, `(() => {
    const editor = document.querySelector('#camp-message')
    if (!(editor instanceof HTMLElement)) return false
    editor.focus()
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    return document.activeElement === editor
  })()`)
  assert(focused, 'Could not focus the Structured Mention editor')
}

async function focusEditorAtStart(cdp) {
  const focused = await evaluate(cdp, `(() => {
    const editor = document.querySelector('#camp-message')
    if (!(editor instanceof HTMLElement)) return false
    editor.focus()
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    return document.activeElement === editor
  })()`)
  assert(focused, 'Could not focus the start of the Structured Mention editor')
}

async function mouseClickMentionOption(cdp, displayName) {
  const point = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.structured-mention-menu button[role="option"]')]
      .find((candidate) => candidate.querySelector('strong')?.textContent === ${JSON.stringify(displayName)})
    if (!button || button.disabled) return null
    button.scrollIntoView({ block: 'nearest' })
    const rect = button.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  assert(point, `Could not resolve mention option ${displayName}`)
  await dispatchMouseClick(cdp, point)
}

async function inspectMentionPopover(cdp) {
  return evaluate(cdp, `(() => {
    const panel = document.querySelector('.mention-profile-popover')
    const side = panel?.querySelector('.mention-profile-side-shell')
    const portrait = panel?.querySelector('.mention-profile-portrait')
    if (!(panel instanceof HTMLElement)
        || !(side instanceof HTMLElement)
        || !(portrait instanceof HTMLElement)) return null
    const panelRect = panel.getBoundingClientRect()
    const portraitRect = portrait.getBoundingClientRect()
    const sideStyle = getComputedStyle(side)
    return {
      role: panel.getAttribute('role'),
      ariaModal: panel.getAttribute('aria-modal'),
      ariaLabel: panel.getAttribute('aria-label'),
      contentKind: panel.dataset.contentKind,
      positioned: panel.classList.contains('is-positioned'),
      position: getComputedStyle(panel).position,
      width: panelRect.width,
      sideFirstColumn: Number.parseFloat(sideStyle.gridTemplateColumns),
      sideMinHeight: Number.parseFloat(sideStyle.minHeight),
      portraitWidth: portraitRect.width,
      portraitExists: true,
      displayName: panel.querySelector('.mention-profile-header h2')?.textContent ?? null,
      teamRole: panel.querySelector('.mention-profile-header p')?.textContent ?? null,
      statuses: [...panel.querySelectorAll('.mention-profile-status > span')]
        .map((status) => status.textContent?.trim() ?? ''),
      fields: [...panel.querySelectorAll('.mention-profile-fields dt')]
        .map((field) => field.textContent?.trim() ?? ''),
      campVisible: Boolean(document.querySelector('.camp-workspace')),
      membersViewVisible: Boolean(document.querySelector('.members-view')),
      toastVisible: Boolean(document.querySelector('.app-toast'))
    }
  })()`)
}

function assertSelectedMemberPopover(inspection, context) {
  assert(
    inspection
      && inspection.role === 'dialog'
      && inspection.ariaModal === 'false'
      && inspection.ariaLabel === '叮叮的基础信息'
      && inspection.contentKind === 'member'
      && inspection.positioned
      && inspection.position === 'fixed'
      && inspection.width >= 390 && inspection.width <= 394
      && inspection.sideFirstColumn >= 127 && inspection.sideFirstColumn <= 129
      && inspection.sideMinHeight >= 302
      && inspection.portraitWidth >= 126 && inspection.portraitWidth <= 129
      && inspection.portraitExists
      && inspection.displayName === '叮叮'
      && inspection.teamRole === '游学者'
      && inspection.statuses.length === 2
      && inspection.statuses[0].includes('在队')
      && inspection.fields.join('|') === '专业职责|工作准则|性格底色'
      && inspection.campVisible
      && !inspection.membersViewVisible
      && !inspection.toastVisible,
    `${context} did not open the selected layout-2 member popover: ${JSON.stringify(inspection)}`
  )
}

async function pressEscape(cdp) {
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown', key: 'Escape', code: 'Escape',
    windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 53
  })
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Escape', code: 'Escape',
    windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 53
  })
}

async function pressKey(cdp, activation) {
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: activation.key,
    code: activation.code,
    modifiers: activation.modifiers ?? 0,
    windowsVirtualKeyCode: activation.windowsVirtualKeyCode,
    nativeVirtualKeyCode: activation.nativeVirtualKeyCode
  })
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: activation.key,
    code: activation.code,
    modifiers: activation.modifiers ?? 0,
    windowsVirtualKeyCode: activation.windowsVirtualKeyCode,
    nativeVirtualKeyCode: activation.nativeVirtualKeyCode
  })
}

async function pressNativeButtonEnter(cdp) {
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Enter',
    code: 'Enter',
    text: '\r',
    unmodifiedText: '\r',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 36
  })
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 36
  })
}

async function selectWholeEditor(cdp) {
  const selected = await evaluate(cdp, `(() => {
    const editor = document.querySelector('#camp-message')
    if (!(editor instanceof HTMLElement)) return false
    editor.focus()
    const range = document.createRange()
    range.selectNodeContents(editor)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    if (!selection || selection.rangeCount !== 1) return false
    const selectedRange = selection.getRangeAt(0)
    return selectedRange.startContainer === editor
      && selectedRange.startOffset === 0
      && selectedRange.endContainer === editor
      && selectedRange.endOffset === editor.childNodes.length
  })()`)
  assert(selected, 'Could not select the whole Composer body')
}

async function activateLastInteractiveMentionWithKey(cdp, activation) {
  const focused = await evaluate(cdp, `(() => {
    const messages = [...document.querySelectorAll('.conversation-bubble.user')]
    const mention = messages.at(-1)?.querySelector('.message-mention-token.is-interactive')
    if (!(mention instanceof HTMLElement)) return false
    window.getSelection()?.removeAllRanges()
    mention.focus()
    return document.activeElement === mention
  })()`)
  assert(focused, `Could not focus the sent Mention for ${activation.code}`)
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: activation.key,
    code: activation.code,
    windowsVirtualKeyCode: activation.windowsVirtualKeyCode,
    nativeVirtualKeyCode: activation.nativeVirtualKeyCode
  })
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: activation.key,
    code: activation.code,
    windowsVirtualKeyCode: activation.windowsVirtualKeyCode,
    nativeVirtualKeyCode: activation.nativeVirtualKeyCode
  })
}

async function mentionInteractionStayedInCamp(cdp) {
  return evaluate(cdp, `Boolean(
    document.querySelector('.camp-workspace')
    && document.querySelector('.structured-mention-token.is-interactive, .message-mention-token.is-interactive')
    && !document.querySelector('.members-view')
  )`)
}

async function mouseClick(cdp, selector, options = {}) {
  const scrolled = await evaluate(cdp, `(() => {
    const primary = [...document.querySelectorAll(${JSON.stringify(selector)})]
    const fallback = ${options.fallbackSelector
      ? `[...document.querySelectorAll(${JSON.stringify(options.fallbackSelector)})]`
      : '[]'}
    const candidates = primary.length > 0 ? primary : fallback
    const element = candidates[${options.last ? 'candidates.length - 1' : '0'}]
    if (!element || element.disabled) return null
    element.scrollIntoView({ block: 'center', inline: 'center' })
    return true
  })()`)
  assert(scrolled, `Could not click ${selector}`)
  // Execution-drawer and timeline layout may settle after scrollIntoView. Read
  // the hit point again after a short host-side wait so the real pointer click
  // cannot land on a stale coordinate. Do not depend on requestAnimationFrame:
  // Chromium may throttle it while another desktop window is in front.
  await wait(80)
  const point = await evaluate(cdp, `(() => {
    const primary = [...document.querySelectorAll(${JSON.stringify(selector)})]
    const fallback = ${options.fallbackSelector
      ? `[...document.querySelectorAll(${JSON.stringify(options.fallbackSelector)})]`
      : '[]'}
    const candidates = primary.length > 0 ? primary : fallback
    const element = candidates[${options.last ? 'candidates.length - 1' : '0'}]
    if (!element || element.disabled) return null
    const rect = element.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  assert(point, `Could not click ${selector}`)
  await dispatchMouseClick(cdp, point)
}

async function mouseClickUntilExpression(cdp, selector, expression, attempts = 3) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await mouseClick(cdp, selector)
    try {
      await waitForExpression(cdp, expression, 1_200)
      return
    } catch {
      if (attempt + 1 === attempts) break
      await wait(120)
    }
  }
  throw new Error(`Real pointer click did not satisfy acceptance expression: ${expression}`)
}

async function moveMouseToElement(cdp, selector) {
  const point = await evaluate(cdp, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element) return null
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const rect = element.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  assert(point, `Could not move the pointer to ${selector}`)
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: point.x, y: point.y, button: 'none', buttons: 0
  })
}

async function dispatchMouseClick(cdp, point) {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: 1,
    clickCount: 1
  })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: 0,
    clickCount: 1
  })
}

async function moveMouseToLastUserMessage(cdp) {
  const scrolled = await evaluate(cdp, `(() => {
    const messages = [...document.querySelectorAll('.conversation-bubble.user')]
    const bubble = messages.at(-1)?.querySelector('.message-bubble')
    if (!bubble) return null
    bubble.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' })
    return true
  })()`)
  assert(scrolled, 'Could not resolve the last user message hover point')
  await wait(80)
  const point = await evaluate(cdp, `(() => {
    const messages = [...document.querySelectorAll('.conversation-bubble.user')]
    const bubble = messages.at(-1)?.querySelector('.message-bubble')
    if (!bubble) return null
    const rect = bubble.getBoundingClientRect()
    return { x: rect.left + Math.min(18, rect.width / 2), y: rect.top + rect.height / 2 }
  })()`)
  assert(point, 'Could not resolve the last user message hover point')
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: point.x, y: point.y, button: 'none', buttons: 0
  })
}

async function moveMouseAwayFromLastUserMessage(cdp) {
  const viewport = await evaluate(cdp, `({ width: innerWidth, height: innerHeight })`)
  for (const point of [
    { x: Math.max(2, viewport.width - 2), y: 2 },
    { x: 2, y: Math.max(2, viewport.height - 2) },
    { x: 2, y: 2 }
  ]) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: point.x, y: point.y, button: 'none', buttons: 0
    })
    await wait(40)
  }
  await waitForExpression(cdp, `(() => {
    const messages = [...document.querySelectorAll('.conversation-bubble.user')]
    return messages.length === 0 || !messages.at(-1).matches(':hover')
  })()`, 2_000)
}

async function lastCopyButtonOpacity(cdp) {
  return evaluate(cdp, `(() => {
    const messages = [...document.querySelectorAll('.conversation-bubble.user')]
    const button = messages.at(-1)?.querySelector('.message-copy-button')
    return button ? Number(getComputedStyle(button).opacity) : -1
  })()`)
}

async function selectionDragPoints(cdp, startOffset, endOffset) {
  const points = await evaluate(cdp, `(() => {
    const messages = [...document.querySelectorAll('.conversation-bubble.user')]
    const segment = messages.at(-1)?.querySelector('.structured-message-body > span:first-child')
    const node = segment?.firstChild
    if (!(node instanceof Text)) return null
    const startOffset = ${startOffset}
    const endOffset = ${endOffset}
    if (startOffset < 0 || endOffset <= startOffset || endOffset > node.data.length) return null
    segment.scrollIntoView({ block: 'center', inline: 'center' })
    const characterPoint = (offset, rightEdge) => {
      const range = document.createRange()
      range.setStart(node, offset)
      range.setEnd(node, offset + 1)
      const rect = range.getBoundingClientRect()
      return { x: rightEdge ? rect.right - 0.5 : rect.left + 0.5, y: rect.top + rect.height / 2 }
    }
    return {
      start: characterPoint(startOffset, false),
      end: characterPoint(endOffset - 1, true),
      expected: node.data.slice(startOffset, endOffset)
    }
  })()`)
  assert(points, 'Could not resolve native selection drag coordinates')
  return points
}

async function mentionSelectionDragPoints(cdp) {
  const points = await evaluate(cdp, `(() => {
    const messages = [...document.querySelectorAll('.conversation-bubble.user')]
    const mention = messages.at(-1)?.querySelector('.message-mention-token.is-interactive')
    const previousText = mention?.previousElementSibling?.firstChild
    const nextText = mention?.nextElementSibling?.firstChild
    if (!(previousText instanceof Text) || !(nextText instanceof Text)
        || previousText.data.length === 0 || nextText.data.length === 0) return null
    mention.scrollIntoView({ block: 'center', inline: 'center' })
    const characterPoint = (node, offset, rightEdge) => {
      const range = document.createRange()
      range.setStart(node, offset)
      range.setEnd(node, offset + 1)
      const rect = range.getBoundingClientRect()
      return { x: rightEdge ? rect.right - 0.5 : rect.left + 0.5, y: rect.top + rect.height / 2 }
    }
    return {
      start: characterPoint(previousText, previousText.data.length - 1, false),
      end: characterPoint(nextText, 0, true),
      expected: previousText.data.at(-1) + (mention.textContent ?? '') + nextText.data[0]
    }
  })()`)
  assert(points, 'Could not resolve selection coordinates across the sent Mention')
  return points
}

async function dispatchMouseDrag(cdp, start, end) {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: start.x, y: start.y, button: 'none', buttons: 0
  })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1
  })
  for (let step = 1; step <= 6; step += 1) {
    const progress = step / 6
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: start.x + ((end.x - start.x) * progress),
      y: start.y + ((end.y - start.y) * progress),
      button: 'left',
      buttons: 1
    })
  }
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: end.x, y: end.y, button: 'left', buttons: 0, clickCount: 1
  })
  await wait(100)
}

async function copySelectionWithMetaC(cdp) {
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown', key: 'Meta', code: 'MetaLeft', modifiers: 4,
    windowsVirtualKeyCode: 91, nativeVirtualKeyCode: 55
  })
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown', key: 'c', code: 'KeyC', modifiers: 4,
    windowsVirtualKeyCode: 67, nativeVirtualKeyCode: 8,
    commands: ['Copy']
  })
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'c', code: 'KeyC', modifiers: 4,
    windowsVirtualKeyCode: 67, nativeVirtualKeyCode: 8
  })
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Meta', code: 'MetaLeft', modifiers: 0,
    windowsVirtualKeyCode: 91, nativeVirtualKeyCode: 55
  })
}

async function cutSelectionWithMetaX(cdp) {
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown', key: 'Meta', code: 'MetaLeft', modifiers: 4,
    windowsVirtualKeyCode: 91, nativeVirtualKeyCode: 55
  })
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown', key: 'x', code: 'KeyX', modifiers: 4,
    windowsVirtualKeyCode: 88, nativeVirtualKeyCode: 7,
    commands: ['Cut']
  })
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'x', code: 'KeyX', modifiers: 4,
    windowsVirtualKeyCode: 88, nativeVirtualKeyCode: 7
  })
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Meta', code: 'MetaLeft', modifiers: 0,
    windowsVirtualKeyCode: 91, nativeVirtualKeyCode: 55
  })
}

async function pasteWithMetaV(cdp) {
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown', key: 'Meta', code: 'MetaLeft', modifiers: 4,
    windowsVirtualKeyCode: 91, nativeVirtualKeyCode: 55
  })
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown', key: 'v', code: 'KeyV', modifiers: 4,
    windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 9,
    commands: ['Paste']
  })
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'v', code: 'KeyV', modifiers: 4,
    windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 9
  })
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Meta', code: 'MetaLeft', modifiers: 0,
    windowsVirtualKeyCode: 91, nativeVirtualKeyCode: 55
  })
}

async function setTheme(cdp, preference) {
  await evaluate(cdp,
    `window.rovai.appearance.setPreference(${JSON.stringify(preference)})`, true)
  const expectedTheme = preference === 'night' ? 'night' : 'day'
  await waitForExpression(cdp,
    `document.documentElement.dataset.theme === ${JSON.stringify(expectedTheme)}`)
}

async function setViewport(cdp, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false
  })
  await waitForExpression(cdp,
    `window.innerWidth === ${width} && window.innerHeight === ${height} && window.devicePixelRatio === 1`)
}

async function emulateDesktopZoom(cdp, physicalWidth, physicalHeight, zoomFactor) {
  const cssWidth = Math.round(physicalWidth / zoomFactor)
  const cssHeight = Math.round(physicalHeight / zoomFactor)
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: cssWidth,
    height: cssHeight,
    deviceScaleFactor: zoomFactor,
    mobile: false,
    screenWidth: physicalWidth,
    screenHeight: physicalHeight
  })
  await waitForExpression(cdp, `(() => (
    window.innerWidth === ${cssWidth}
      && window.innerHeight === ${cssHeight}
      && Math.abs(window.devicePixelRatio - ${zoomFactor}) < 0.01
  ))()`)
}

async function inspectLightweightReply(cdp) {
  return evaluate(cdp, `(() => {
    const composer = document.querySelector('.composer')
    const box = document.querySelector('.composer-box')
    const line = document.querySelector('.composer-reply-line')
    const copy = document.querySelector('.composer-reply-copy')
    const author = copy?.querySelector('strong')
    const excerpt = copy?.querySelector(':scope > span')
    const editor = document.querySelector('#camp-message')
    if (
      !(composer instanceof HTMLElement)
      || !(box instanceof HTMLElement)
      || !(line instanceof HTMLElement)
      || !(copy instanceof HTMLElement)
      || !(author instanceof HTMLElement)
      || !(excerpt instanceof HTMLElement)
      || !(editor instanceof HTMLElement)
    ) return null
    const boxStyle = getComputedStyle(box)
    const lineStyle = getComputedStyle(line)
    const copyStyle = getComputedStyle(copy)
    const authorStyle = getComputedStyle(author)
    const excerptStyle = getComputedStyle(excerpt)
    const probe = document.createElement('span')
    probe.style.borderColor = 'var(--control-line)'
    probe.style.backgroundColor = 'var(--input)'
    document.body.appendChild(probe)
    const probeStyle = getComputedStyle(probe)
    const expectedControlLineColor = probeStyle.borderTopColor
    const expectedInputColor = probeStyle.backgroundColor
    probe.remove()
    return {
      theme: document.documentElement.dataset.theme,
      editorFocused: document.activeElement === editor,
      focusRingSuppressed: composer.classList.contains('suppress-pointer-focus-ring')
        && getComputedStyle(editor).outlineStyle === 'none',
      composerBox: {
        borderTopWidth: boxStyle.borderTopWidth,
        borderTopColor: boxStyle.borderTopColor,
        borderTopStyle: boxStyle.borderTopStyle,
        backgroundColor: boxStyle.backgroundColor,
        boxShadow: boxStyle.boxShadow
      },
      expectedControlLineColor,
      expectedInputColor,
      lineBorderWidth: lineStyle.borderTopWidth,
      lineBackgroundColor: lineStyle.backgroundColor,
      lineBoxShadow: lineStyle.boxShadow,
      replyIconAbsent: !line.querySelector(':scope > svg'),
      copyWhiteSpace: copyStyle.whiteSpace,
      copyOverflow: copyStyle.overflow,
      authorFlexShrink: authorStyle.flexShrink,
      authorOverflows: author.scrollWidth > author.clientWidth,
      excerptTextOverflow: excerptStyle.textOverflow,
      excerptWhiteSpace: excerptStyle.whiteSpace,
      excerptOverflows: excerpt.scrollWidth > excerpt.clientWidth
    }
  })()`)
}

async function request(cdp, method, params = {}) {
  return evaluate(cdp,
    `window.rovai.request(${JSON.stringify(method)}, ${JSON.stringify(params)}).catch((failure) => {
      throw new Error(JSON.stringify(failure))
    })`, true)
}

async function capture(cdp, path) {
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true
  })
  await writeFile(path, Buffer.from(result.result.data, 'base64'))
}

async function evaluate(cdp, expression, awaitPromise = false) {
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true
  })
  if (response.result?.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.exception?.description
      ?? response.result.exceptionDetails.text
      ?? `Evaluation failed: ${expression}`)
  }
  return response.result?.result?.value
}

async function waitForSelector(cdp, selector, timeoutMs = 10_000) {
  await waitForExpression(cdp,
    `Boolean(document.querySelector(${JSON.stringify(selector)}))`, timeoutMs)
}

async function waitForExpression(cdp, expression, timeoutMs = 10_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await evaluate(cdp, expression)) return
    await wait(100)
  }
  if (await evaluate(cdp, expression)) return
  throw new Error(`Expression did not become true within ${timeoutMs}ms: ${expression}`)
}

async function waitForValue(load, predicate, timeoutMs) {
  const startedAt = Date.now()
  let latest
  while (Date.now() - startedAt < timeoutMs) {
    latest = await load()
    if (predicate(latest)) return latest
    await wait(100)
  }
  latest = await load()
  if (predicate(latest)) return latest
  throw new Error(`Value did not satisfy acceptance predicate: ${JSON.stringify(latest)}`)
}

async function waitForTarget(port, stderr) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 20_000) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`, {
        signal: AbortSignal.timeout(1_000)
      })
        .then((response) => response.json())
      const target = targets.find((candidate) => candidate.type === 'page')
      if (target) return target
    } catch {
      // Electron is still starting.
    }
    await wait(150)
  }
  throw new Error(`Electron DevTools target did not appear. ${stderr.join('')}`)
}

async function connectCdp(url) {
  const socket = new WebSocket(url)
  const pending = new Map()
  let nextId = 1
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true })
    socket.addEventListener('error', rejectOpen, { once: true })
  })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (!message.id) return
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message)
  })
  socket.addEventListener('close', () => {
    for (const request of pending.values()) request.reject(new Error('CDP connection closed'))
    pending.clear()
  })
  return {
    send(method, params = {}) {
      return new Promise((resolveSend, rejectSend) => {
        const id = nextId++
        pending.set(id, { resolve: resolveSend, reject: rejectSend })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
    close() {
      socket.close()
    }
  }
}

async function snapshotClipboard() {
  const source = String.raw`
    import AppKit
    import Foundation

    let pasteboard = NSPasteboard.general
    var archive: [[[String: String]]] = []
    for item in pasteboard.pasteboardItems ?? [] {
      var flavors: [[String: String]] = []
      for type in item.types {
        guard let data = item.data(forType: type) else {
          fatalError("Could not read Pasteboard flavor \(type.rawValue)")
        }
        flavors.append(["type": type.rawValue, "data": data.base64EncodedString()])
      }
      archive.append(flavors)
    }
    let encoded = try JSONSerialization.data(withJSONObject: archive)
    FileHandle.standardOutput.write(encoded)
  `
  const raw = await runProcess('/usr/bin/xcrun', ['swift', '-e', source])
  const archive = JSON.parse(raw)
  validateClipboardArchive(archive)
  return normalizeClipboardArchive(archive)
}

async function restoreClipboardWithRetry(archive) {
  let lastError = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await restoreClipboard(archive)
      const restored = await snapshotClipboard()
      if (!deepEqual(restored, normalizeClipboardArchive(archive))) {
        throw new Error('Restored Pasteboard bytes do not match the pre-test archive')
      }
      return
    } catch (error) {
      lastError = error
      await wait(100)
    }
  }
  throw new Error(`Could not restore the pre-test Pasteboard after three attempts: ${errorMessage(lastError)}`)
}

async function restoreClipboard(archive) {
  validateClipboardArchive(archive)
  const source = String.raw`
    import AppKit
    import Foundation

    let input = FileHandle.standardInput.readDataToEndOfFile()
    let object = try JSONSerialization.jsonObject(with: input)
    guard let archive = object as? [[[String: String]]] else {
      fatalError("Clipboard archive has an invalid shape")
    }
    var items: [NSPasteboardItem] = []
    for flavors in archive {
      let item = NSPasteboardItem()
      for flavor in flavors {
        guard let typeName = flavor["type"],
              let encoded = flavor["data"],
              let data = Data(base64Encoded: encoded) else {
          fatalError("Clipboard archive contains an invalid flavor")
        }
        guard item.setData(data, forType: NSPasteboard.PasteboardType(typeName)) else {
          fatalError("Could not prepare Pasteboard flavor \(typeName)")
        }
      }
      items.append(item)
    }
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    if !items.isEmpty && !pasteboard.writeObjects(items) {
      fatalError("Could not restore Pasteboard objects")
    }
  `
  await runProcess('/usr/bin/xcrun', ['swift', '-e', source], {
    input: JSON.stringify(archive)
  })
}

function validateClipboardArchive(archive) {
  assert(Array.isArray(archive), 'Pasteboard archive is not an array')
  for (const item of archive) {
    assert(Array.isArray(item), 'Pasteboard item is not an array')
    for (const flavor of item) {
      assert(flavor && typeof flavor === 'object'
        && typeof flavor.type === 'string'
        && typeof flavor.data === 'string', 'Pasteboard flavor is invalid')
    }
  }
}

function normalizeClipboardArchive(archive) {
  return archive.map((item) => item.slice().sort((left, right) =>
    left.type.localeCompare(right.type)))
}

function structuredClipboardPayload(archive) {
  for (const item of archive) {
    const htmlFlavor = item.find(({ type }) => type === 'public.html')
    if (!htmlFlavor) continue
    const html = Buffer.from(htmlFlavor.data, 'base64').toString('utf8')
    const encoded = /data-rovai-structured-camp-message-v1=["']([^"']+)["']/i.exec(html)?.[1]
    if (!encoded) continue
    try {
      return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
    } catch {
      return null
    }
  }
  return null
}

function runSql(path, sql) {
  return runProcess('/usr/bin/sqlite3', [path, sql])
}

async function runSqlJson(path, sql) {
  const raw = await runProcess('/usr/bin/sqlite3', ['-json', path, sql])
  return JSON.parse(raw || '[]')
}

function extractTaggedJson(payload, tag) {
  const opening = `[${tag}]\n`
  const closing = `\n[/${tag}]`
  const start = payload.lastIndexOf(opening)
  assert(start >= 0, `Rendered payload has no ${tag} section`)
  const contentStart = start + opening.length
  const end = payload.indexOf(closing, contentStart)
  assert(end >= 0, `Rendered payload has no closing ${tag} section`)
  return JSON.parse(payload.slice(contentStart, end))
}

function fakeCodexAcceptanceRuntime() {
  return `#!/usr/bin/env node
import readline from 'node:readline'

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
let turnOrdinal = 0
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n')

for await (const line of lines) {
  if (!line.trim()) continue
  const message = JSON.parse(line)
  if (message.id === undefined) continue
  const method = message.method
  if (method === 'initialize') {
    send({ jsonrpc: '2.0', id: message.id, result: { serverInfo: { name: 'rovai-acceptance', version: '1' } } })
    continue
  }
  if (method === 'config/read') {
    send({ jsonrpc: '2.0', id: message.id, result: { config: { mcp_servers: {} }, layers: [] } })
    continue
  }
  if (method === 'thread/start' || method === 'thread/resume') {
    const threadId = message.params?.threadId ?? 'thread-structured-skill-acceptance'
    send({ jsonrpc: '2.0', id: message.id, result: { thread: { id: threadId }, instructionSources: [] } })
    continue
  }
  if (method === 'turn/start') {
    turnOrdinal += 1
    const threadId = message.params?.threadId ?? 'thread-structured-skill-acceptance'
    const turnId = 'turn-structured-skill-' + turnOrdinal
    const item = {
      id: 'message-structured-skill-' + turnOrdinal,
      type: 'agentMessage',
      status: 'completed',
      text: 'Structured Skill context acceptance completed.'
    }
    send({ jsonrpc: '2.0', id: message.id, result: { turn: { id: turnId } } })
    setTimeout(() => {
      send({ method: 'turn/started', params: { threadId, turn: { id: turnId, status: 'inProgress', items: [] } } })
      send({ method: 'item/completed', params: { threadId, turnId, item } })
      send({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed', items: [item] } } })
    }, 1000)
    continue
  }
  send({ jsonrpc: '2.0', id: message.id, result: {} })
}
`
}

function runProcess(command, args, { input } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe']
    })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(String(chunk)))
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
    child.once('error', rejectRun)
    child.once('close', (code, signal) => {
      if (code === 0) resolveRun(stdout.join(''))
      else rejectRun(new Error(`${command} exited with ${code ?? signal}: ${stderr.join('')}`))
    })
    if (input !== undefined) child.stdin.end(input)
  })
}

async function terminateChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolveClose) => child.once('close', resolveClose)),
    wait(2_000)
  ])
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function sameMembers(actual, expected) {
  return actual.length === expected.length
    && [...actual].sort().join('\u0000') === [...expected].sort().join('\u0000')
}

function deepEqual(left, right) {
  if (isComposerDocument(left) && Array.isArray(right)) {
    right = composerDocumentFromStructured(right)
  } else if (Array.isArray(left) && isComposerDocument(right)) {
    left = composerDocumentFromStructured(left)
  }
  if (isComposerDocument(left)) left = composerIdentityProjection(left)
  if (isComposerDocument(right)) right = composerIdentityProjection(right)
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right))
}

function isComposerDocument(value) {
  return value?.version === 2 && Array.isArray(value.segments)
}

function composerDocumentFromStructured(content) {
  if (isComposerDocument(content)) return content
  return {
    version: 2,
    segments: content.map((segment) => {
      if (segment.kind === 'text' || segment.kind === 'atom') return segment
      if (segment.kind === 'member_mention') {
        const atom = { type: 'member', agentId: segment.agentId }
        if (segment.fallbackText) atom.labelFallback = segment.fallbackText.replace(/^@/, '')
        return { kind: 'atom', atom }
      }
      if (segment.kind === 'all_members_mention') {
        return { kind: 'atom', atom: { type: 'all_members' } }
      }
      if (segment.kind === 'skill_mention') {
        return {
          kind: 'atom',
          atom: { type: 'skill', skillId: segment.skillId, nameAtSend: segment.nameAtSend }
        }
      }
      throw new Error(`Unsupported Composer fixture segment: ${JSON.stringify(segment)}`)
    })
  }
}

function composerIdentityProjection(document) {
  return {
    version: 2,
    segments: document.segments.map((segment) => {
      if (segment.kind !== 'atom' || segment.atom.type !== 'member') return segment
      return {
        kind: 'atom',
        atom: { type: 'member', agentId: segment.atom.agentId }
      }
    })
  }
}

function composerHasMember(document, agentId) {
  return document.segments.some((segment) =>
    segment.kind === 'atom'
      && segment.atom.type === 'member'
      && segment.atom.agentId === agentId)
}

function composerIsEmpty(document) {
  return isComposerDocument(document) && document.segments.length === 0
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]))
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))
}
