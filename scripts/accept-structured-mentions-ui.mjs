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

const root = resolve(import.meta.dirname, '..')
const appPath = resolve(
  process.argv[2] ?? join(root, 'dist', 'mac-arm64', 'Rovai-ai.app')
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
const debugPort = Number(process.env.ROVAI_STRUCTURED_MENTIONS_ACCEPT_DEBUG_PORT ?? 9491)
const databasePath = join(dataDir, 'rovai.sqlite')
const acceptanceExecutablePath = '/usr/bin/true'
const targetMembers = [
  { agentId: 'agent_1', displayName: '小狐狸', teamRole: '游学者' },
  { agentId: 'agent_2', displayName: '小河狸', teamRole: '鉴定士' },
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
  { kind: 'text', text: '，请给出结论。' }
]
const expectedBody = '请同时检查这条消息：@小狐狸 @小河狸 @咕咕，请给出结论。'
const acceptanceExecutableFingerprint = `sha256:${createHash('sha256')
  .update(await readFile(acceptanceExecutablePath))
  .digest('hex')}`
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

await access(join(appPath, 'Contents', 'MacOS', 'Rovai-ai'))
await mkdir(dataDir, { recursive: true })
await mkdir(runtimeTempDir, { recursive: true })
await mkdir(outputDir, { recursive: true })

let running = null
let clipboardArchive = null
let clipboardTouched = false
let clipboardRestored = false
let testFailure = null
let cleanupFailure = null
let result = null

try {
  // Clipboard mutation is forbidden unless the complete macOS Pasteboard can be
  // archived first. The archive includes every item, flavor, and byte payload.
  clipboardArchive = await snapshotClipboard()

  running = await launchApp(dataDir, debugPort, 1440, 920)
  await setTheme(running.cdp, 'day')
  const freshAgents = await request(running.cdp, 'agents.list')
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
  const configuredAgents = await request(running.cdp, 'agents.list')
  assert(
    targetMemberIds.every((id) => configuredAgents.some((agent) =>
      agent.agentId === id
      && agent.runtimeReadiness.status === 'ready'
      && agent.runtimeSelection?.adapterKind === 'codex-cli')),
    `Acceptance Runtime is not ready for every target: ${JSON.stringify(configuredAgents)}`
  )

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
  const initialSnapshot = await request(running.cdp, 'camps.snapshot', { campId })
  assert(initialSnapshot.schemaVersion === 19,
    `Camp snapshot schema is not v19: ${initialSnapshot.schemaVersion}`)
  assert(
    deepEqual(initialSnapshot.members.map((member) => member.agentId), targetMemberIds),
    `Camp does not contain exactly the three target members: ${JSON.stringify(initialSnapshot.members)}`
  )

  await waitForSelector(running.cdp, '#camp-message.structured-mention-editor')
  await waitForExpression(running.cdp,
    `document.querySelector('#camp-message')?.getAttribute('contenteditable') === 'true'`)
  await focusEditorAtEnd(running.cdp)
  await running.cdp.send('Input.insertText', { text: expectedContent[0].text })
  let expectedEditorText = expectedContent[0].text
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
    // Wait for each controlled React render and restore the caret before the
    // next native insertion. Sending consecutive CDP inserts into a stale DOM
    // can duplicate the previous controlled value.
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
          .map((button) => button.querySelector('strong')?.textContent ?? null),
        events: window.__structuredMentionAcceptanceEvents ?? []
      }
    })()`), (projection) => projection.text === `${expectedEditorText}@`
      && projection.menu
      && projection.options.includes(member.displayName), 10_000)
    await mouseClickMentionOption(running.cdp, member.displayName)
    expectedEditorText += `@${member.displayName}`
    await waitForExpression(running.cdp,
      `document.querySelectorAll('.structured-mention-token.member-mention').length === ${index + 1}
        && document.querySelector('#camp-message')?.textContent === ${JSON.stringify(expectedEditorText)}`)
    await waitForExpression(running.cdp, `document.activeElement?.id === 'camp-message'`)
    const followingText = expectedContent[(index * 2) + 2].text
    await running.cdp.send('Input.insertText', { text: followingText })
    expectedEditorText += followingText
    await waitForExpression(running.cdp,
      `document.querySelector('#camp-message')?.textContent === ${JSON.stringify(expectedEditorText)}`)
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
        && style.role === 'button'
        && style.label?.endsWith('的基础信息')
        && style.hasPopup === 'dialog'),
    `Structured mentions do not use the selected atomic inline style: ${JSON.stringify(composerInspection)}`
  )

  const durableDraft = await waitForValue(async () =>
    request(running.cdp, 'camp.composerDraft.get', { campId }), (draft) =>
    draft.revision >= 1 && deepEqual(draft.content, expectedContent), 10_000)
  assert(durableDraft.body === expectedBody,
    `Core did not project the current names into the Draft body: ${JSON.stringify(durableDraft)}`)

  const composerCapture = join(outputDir, 'structured-mentions-composer.png')
  await capture(running.cdp, composerCapture)

  await evaluate(running.cdp, `window.getSelection()?.removeAllRanges()`)
  await mouseClick(running.cdp, '.structured-mention-token.member-mention.is-interactive')
  await waitForExpression(running.cdp,
    `document.querySelector('.mention-profile-popover[aria-label="小狐狸的基础信息"]')?.classList.contains('is-positioned')`)
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
    `document.activeElement?.classList.contains('structured-mention-token') === true`, 3_000)
  const draftAfterPopover = await request(running.cdp, 'camp.composerDraft.get', { campId })
  assert(deepEqual(draftAfterPopover.content, expectedContent),
    `Opening the Composer popover changed the durable Draft: ${JSON.stringify(draftAfterPopover)}`)

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
      && sentMentionInspection.label === '查看小狐狸的基础信息'
      && sentMentionInspection.hasPopup === 'dialog',
    `Sent mention does not use the selected Feishu-style inline interaction: ${JSON.stringify(sentMentionInspection)}`
  )

  await evaluate(running.cdp, `window.getSelection()?.removeAllRanges()`)
  await mouseClick(running.cdp,
    '.conversation-bubble.user .message-mention-token.is-interactive')
  await waitForExpression(running.cdp,
    `document.querySelector('.mention-profile-popover[aria-label="小狐狸的基础信息"]')?.classList.contains('is-positioned')`)
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
      `document.querySelector('.mention-profile-popover[aria-label="小狐狸的基础信息"]')?.classList.contains('is-positioned')`)
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
  await running.cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: 2, y: 2, button: 'none', buttons: 0
  })
  await wait(200)
  const hiddenOpacity = await lastCopyButtonOpacity(running.cdp)
  assert(hiddenOpacity < 0.05, `Copy button is visible without hover: ${hiddenOpacity}`)

  await moveMouseToLastUserMessage(running.cdp)
  await wait(200)
  const hoveredOpacity = await lastCopyButtonOpacity(running.cdp)
  assert(hoveredOpacity > 0.95, `Copy button did not appear on hover: ${hoveredOpacity}`)

  await running.cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: 2, y: 2, button: 'none', buttons: 0
  })
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

  result = {
    acceptance: 'structured-mentions-ui',
    appPath,
    outputDir,
    captures: {
      composer: composerCapture,
      composerPopover: composerPopoverCapture,
      sent: sentCapture,
      memberPopover: memberPopoverCapture,
      nativeSelection: selectionCapture,
      hoverCopy: copiedCapture
    },
    campId,
    campMessageId: sent.message.id,
    campTurnId: sent.message.campTurnId,
    agentRunIds: sent.runs.map((run) => run.id),
    agentRunTargets: sent.runs.map((run) => run.agentId),
    agentRunCreatedAt: sent.runs[0].createdAt,
    structuredContent: sent.message.content,
    memberPopoverActivations: ['composer-click', 'history-click', 'history-Enter', 'history-Space'],
    memberPopoverStayedInCamp: true,
    mentionSelectedText,
    selectedText,
    clipboardItemCountBeforeTest: clipboardArchive.length,
    clipboardRestored: false,
    isolatedUserDataRemoved: false
  }
} catch (error) {
  testFailure = error
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
  await rm(fixtureRoot, { recursive: true, force: true })
}
if (!suppliedRuntimeTempDir) {
  await rm(runtimeTempDir, { recursive: true, force: true })
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

async function launchApp(userDataDir, port, width, height) {
  const stderr = []
  const child = spawn(join(appPath, 'Contents', 'MacOS', 'Rovai-ai'), [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`
  ], {
    cwd: root,
    env: {
      ...process.env,
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
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false
    })
    await waitForExpression(cdp,
      `Boolean(window.rovai && document.querySelector('.app-shell'))`, 45_000)
    const health = await request(cdp, 'health.check')
    const expectedDatabasePath = await realpath(join(userDataDir, 'rovai.sqlite'))
    const actualDatabasePath = await realpath(health.database.path)
    assert(actualDatabasePath === expectedDatabasePath,
      `Isolated App opened the wrong database: ${JSON.stringify({ expectedDatabasePath, actualDatabasePath })}`)
    return { cdp, child, port, stderr }
  } catch (error) {
    cdp?.close()
    await terminateChild(child)
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
      await fetch(`http://127.0.0.1:${app.port}/json`)
    } catch {
      await terminateChild(app.child)
      return
    }
    await wait(100)
  }
  await terminateChild(app.child)
  try {
    await fetch(`http://127.0.0.1:${app.port}/json`)
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
      && inspection.ariaLabel === '小狐狸的基础信息'
      && inspection.contentKind === 'member'
      && inspection.positioned
      && inspection.position === 'fixed'
      && inspection.width >= 390 && inspection.width <= 394
      && inspection.sideFirstColumn >= 127 && inspection.sideFirstColumn <= 129
      && inspection.sideMinHeight >= 302
      && inspection.portraitWidth >= 126 && inspection.portraitWidth <= 129
      && inspection.portraitExists
      && inspection.displayName === '小狐狸'
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
  const point = await evaluate(cdp, `(() => {
    const primary = [...document.querySelectorAll(${JSON.stringify(selector)})]
    const fallback = ${options.fallbackSelector
      ? `[...document.querySelectorAll(${JSON.stringify(options.fallbackSelector)})]`
      : '[]'}
    const candidates = primary.length > 0 ? primary : fallback
    const element = candidates[${options.last ? 'candidates.length - 1' : '0'}]
    if (!element || element.disabled) return null
    element.scrollIntoView({ block: 'center', inline: 'center' })
    const rect = element.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  assert(point, `Could not click ${selector}`)
  await dispatchMouseClick(cdp, point)
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
  const point = await evaluate(cdp, `(() => {
    const messages = [...document.querySelectorAll('.conversation-bubble.user')]
    const bubble = messages.at(-1)?.querySelector('.message-bubble')
    if (!bubble) return null
    bubble.scrollIntoView({ block: 'center', inline: 'center' })
    const rect = bubble.getBoundingClientRect()
    return { x: rect.left + Math.min(18, rect.width / 2), y: rect.top + rect.height / 2 }
  })()`)
  assert(point, 'Could not resolve the last user message hover point')
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: point.x, y: point.y, button: 'none', buttons: 0
  })
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

async function setTheme(cdp, preference) {
  await evaluate(cdp,
    `window.rovai.appearance.setPreference(${JSON.stringify(preference)})`, true)
  await waitForExpression(cdp, `document.documentElement.dataset.theme === 'day'`)
}

async function request(cdp, method, params = {}) {
  return evaluate(cdp,
    `window.rovai.request(${JSON.stringify(method)}, ${JSON.stringify(params)})`, true)
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
      const targets = await fetch(`http://127.0.0.1:${port}/json`)
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

function runSql(path, sql) {
  return runProcess('/usr/bin/sqlite3', [path, sql])
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
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right))
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
