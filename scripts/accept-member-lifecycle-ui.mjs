import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const appPath = resolve(
  process.argv[2] ?? join(root, 'dist', 'mac-arm64', 'Rovai-ai.app')
)
const fixtureRoot = process.env.ROVAI_MEMBER_LIFECYCLE_ACCEPT_DATA_DIR
  ?? await mkdtemp(join(tmpdir(), 'rovai-member-lifecycle-ui-accept-'))
const freshDataDir = join(fixtureRoot, 'fresh')
const upgradeDataDir = join(fixtureRoot, 'upgrade-v014')
const outputDir = process.env.ROVAI_MEMBER_LIFECYCLE_ACCEPT_OUTPUT_DIR
  ?? await mkdtemp(join(tmpdir(), 'rovai-member-lifecycle-ui-captures-'))
const firstPort = Number(process.env.ROVAI_MEMBER_LIFECYCLE_ACCEPT_DEBUG_PORT ?? 9471)
const acceptanceExecutablePath = '/usr/bin/true'
const acceptanceExecutableFingerprint = `sha256:${createHash('sha256')
  .update(await readFile(acceptanceExecutablePath))
  .digest('hex')}`
const acceptanceModelCatalog = JSON.stringify([{
  id: 'gpt-lifecycle-accept',
  displayName: 'Lifecycle Acceptance Runtime',
  isDefault: true,
  hidden: false,
  deprecated: false,
  options: [{
    key: 'reasoning_effort',
    label: 'Reasoning effort',
    valueType: 'enum',
    values: [
      { value: 'low', label: 'Low' },
      { value: 'high', label: 'High' }
    ],
    defaultValue: 'high',
    scope: 'run'
  }]
}])
const acceptancePermissionOptions = JSON.stringify([
  {
    key: 'sandbox_mode',
    label: 'Sandbox',
    description: '',
    valueType: 'enum',
    choices: [
      { value: 'workspace-write', label: 'workspace-write' },
      { value: 'danger-full-access', label: 'danger-full-access' }
    ],
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
    choices: [
      { value: 'on-request', label: 'on-request' },
      { value: 'never', label: 'never' }
    ],
    recommendedValue: 'on-request',
    scope: 'session',
    risk: 'normal',
    supported: true,
    required: true,
    unsupportedReason: null
  }
])

await mkdir(freshDataDir, { recursive: true })
await mkdir(upgradeDataDir, { recursive: true })
await mkdir(outputDir, { recursive: true })

let running = null
let campId = null
let campTitle = null
const captures = {}

try {
  running = await launchApp(freshDataDir, firstPort, 1440, 920)
  await setTheme(running.cdp, 'day')
  const freshProfiles = await request(running.cdp, 'agents.list')
  assert(
    freshProfiles.length === 4
      && freshProfiles.every((profile) =>
        profile.presence === 'present'
        && profile.runtimeSelection === null
        && profile.runtimePreference === null
        && profile.runtimeReadiness.status === 'runtime_not_configured'),
    `Fresh Profile state is not present/no-Runtime: ${JSON.stringify(freshProfiles)}`
  )
  assert(
    await migrationApplied(join(freshDataDir, 'rovai.sqlite'), 41),
    'Fresh database did not record schema Migration v41'
  )

  await openNewConversation(running.cdp)
  const freshPreflight = await request(running.cdp, 'camps.creationPreflight')
  assert(
    freshPreflight.admissible
      && freshPreflight.initialLeadAgentProfileId === 'agent-luoke'
      && freshPreflight.presentMembers.length === 4
      && freshPreflight.presentMembers.every((member) => !member.runtimeConfigured),
    `Fresh no-Runtime preflight is unexpected: ${JSON.stringify(freshPreflight)}`
  )
  const freshDialog = await evaluate(running.cdp, `({
    createEnabled: document.querySelector('.new-camp-dialog .primary-button')?.disabled === false,
    memberSummary: document.querySelector('.new-camp-picker-trigger.member-trigger strong')?.textContent,
    lead: document.querySelector('.new-camp-lead-field select')?.value,
    mode: document.querySelector('.new-camp-mode-card.selected strong')?.textContent
  })`)
  assert(
    freshDialog.createEnabled
      && freshDialog.memberSummary === '已选择 4 位队员'
      && freshDialog.lead === 'agent-luoke'
      && freshDialog.mode === '并肩协作',
    `Fresh configured-Camp Dialog defaults are unexpected: ${JSON.stringify(freshDialog)}`
  )
  await setTheme(running.cdp, 'night')
  await pressKey(running.cdp, 'Escape')
  await waitForExpression(running.cdp, `!document.querySelector('.new-camp-dialog')`)

  await mouseClick(running.cdp, '.unified-sidebar button[aria-label="设置"]')
  await waitForSelector(running.cdp, '.settings-sidebar-menu')
  const settingsDestinations = await evaluate(running.cdp,
    `[...document.querySelectorAll('.settings-sidebar-menu strong')].map((node) => node.textContent)`)
  assert(!settingsDestinations.includes('上下文'),
    `Settings still exposes a standalone Context destination: ${JSON.stringify(settingsDestinations)}`)

  await openMembers(running.cdp)
  await selectMember(running.cdp, '洛可')
  const summaryBefore = await request(running.cdp, 'context.summaryModel.get')
  const foldedSummaryState = await evaluate(running.cdp, `({
    open: document.querySelector('.member-advanced-settings details')?.open,
    mounted: Boolean(document.querySelector('.summary-model-settings'))
  })`)
  assert(
    foldedSummaryState.open === false && foldedSummaryState.mounted === false,
    `Summary model advanced settings were not folded by default: ${JSON.stringify(foldedSummaryState)}`
  )
  await mouseClick(running.cdp, '.member-advanced-settings summary', '高级设置', true)
  await waitForSelector(running.cdp, '.summary-model-settings')
  await waitForText(running.cdp, '.summary-model-settings', '自动回退')
  await waitForText(running.cdp, '.summary-model-settings', '当前成员的 Agent运行时默认模型')
  const summaryModelControls = await evaluate(running.cdp, `({
    selectCount: document.querySelectorAll('.summary-model-settings select').length,
    labels: [...document.querySelectorAll('.summary-model-settings .field-label')]
      .map((node) => node.textContent?.trim())
  })`)
  assert(
    summaryModelControls.selectCount === 1
      && summaryModelControls.labels.length === 1
      && summaryModelControls.labels[0]?.startsWith('模型'),
    `Summary model exposed an execution-engine selector: ${JSON.stringify(summaryModelControls)}`
  )
  await mouseClick(running.cdp, '.summary-model-settings button', '保存摘要模型')
  const summaryAfter = await waitForSummaryVersion(running.cdp, summaryBefore.version)
  assert(
    summaryAfter.version > summaryBefore.version && summaryAfter.preference === null,
    `Summary model did not save through the existing API: ${JSON.stringify({ summaryBefore, summaryAfter })}`
  )
  await assertExecutionEngineProductCopy(running.cdp)
  await setTheme(running.cdp, 'day')
  await mouseClick(running.cdp, '.member-status-actions button', '暂离')
  await waitForProfile(running.cdp, 'agent-luoke', (profile) => profile.presence === 'away')
  await waitForText(running.cdp, '.app-toast', '已暂离')
  await focusElement(running.cdp, '.member-status-actions button', '归队')
  await pressKey(running.cdp, 'Enter')
  await waitForProfile(running.cdp, 'agent-luoke', (profile) => profile.presence === 'present')
  await waitForText(running.cdp, '.app-toast', '已归队')

  await focusElement(running.cdp, '.member-section-heading button', '编辑身份')
  await pressKey(running.cdp, 'Enter')
  await waitForSelector(running.cdp, '.member-dialog')
  await waitForExpression(running.cdp, `document.activeElement?.closest('.member-dialog') !== null`)
  const hiddenHandleState = await evaluate(running.cdp, `({
    dialogExposesHandle: document.querySelector('.member-dialog')?.textContent?.includes('@handle'),
    rosterExposesHandle: [...document.querySelectorAll('.member-list-copy small')]
      .some((node) => node.textContent?.includes('@'))
  })`)
  assert(
    hiddenHandleState.dialogExposesHandle === false
      && hiddenHandleState.rosterExposesHandle === false,
    `Member configuration still exposes an internal handle: ${JSON.stringify(hiddenHandleState)}`
  )
  await replaceInputValue(running.cdp, '.member-dialog input', '沐瓦')
  await mouseClick(running.cdp, '.member-dialog button', '保存身份')
  await waitForText(running.cdp, '.member-dialog .inline-error', '该名称已被其他成员使用')
  await waitForSelector(running.cdp, '.member-dialog')
  await replaceInputValue(
    running.cdp,
    '.member-dialog input',
    '未保存主题草稿'
  )
  await waitForExpression(running.cdp,
    `document.querySelector('.member-dialog input')?.value === '未保存主题草稿'`)
  await setTheme(running.cdp, 'night')
  await waitForExpression(running.cdp,
    `document.querySelector('.member-dialog input')?.value === '未保存主题草稿'
      && document.activeElement === document.querySelector('.member-dialog input')`)
  await pressKey(running.cdp, 'Escape')
  await waitForExpression(running.cdp, `!document.querySelector('.member-dialog')`)
  await waitForExpression(running.cdp,
    `document.activeElement?.textContent?.trim() === '编辑身份'`)
  assert(
    (await request(running.cdp, 'agents.get', { agentProfileId: 'agent-luoke' })).displayName === '洛可',
    'Escaping the identity dialog persisted an unsaved theme-switch draft'
  )
  await waitForExpression(running.cdp, `!document.querySelector('.app-toast')`, 5_000)

  Object.assign(captures, await captureThemeMatrix(
    running.cdp,
    'fresh-members',
    '洛可',
    outputDir
  ))
  await mouseClick(running.cdp, '.unified-sidebar button[aria-label="设置"]')
  await waitForSelector(running.cdp, '.settings-sidebar-menu')
  await mouseClick(running.cdp, '.settings-sidebar-menu button', '执行引擎', true)
  await waitForSelector(running.cdp, '.runtime-installations')
  const runtimeSettingsState = await evaluate(running.cdp, `(() => {
    const panel = document.querySelector('.runtime-installations')
    const productRows = panel?.querySelector(':scope > .runtime-installation-list')
      ?.querySelectorAll(':scope > .runtime-installation-row')
    const labels = [...(productRows ?? [])]
      .map((row) => row.querySelector('strong')?.textContent)
    const advanced = panel?.querySelector('.runtime-advanced-diagnostics')
    return {
      rowCount: productRows?.length ?? 0,
      labels,
      advancedOpen: advanced?.open,
      explainsShell: panel?.textContent?.includes('交互式登录 Shell 初始化'),
      exposesMemberPathPicker: Boolean(
        panel?.querySelector(':scope > input, :scope > .path-field')
      )
    }
  })()`)
  assert(
    runtimeSettingsState.rowCount === 9
      && runtimeSettingsState.labels.includes('Codex CLI')
      && runtimeSettingsState.labels.includes('Antigravity')
      && runtimeSettingsState.advancedOpen === false
      && runtimeSettingsState.explainsShell
      && !runtimeSettingsState.exposesMemberPathPicker,
    `Runtime settings did not preserve the nine-product or advanced-only path boundary: ${JSON.stringify(runtimeSettingsState)}`
  )
  await setViewport(running.cdp, 1040, 700)
  await setTheme(running.cdp, 'night')
  await assertNoHorizontalOverflow(running.cdp, 'Runtime settings at 1040×700 Night')
  captures.runtimeSettings = join(
    outputDir,
    'runtime-settings-nine-products-night-1040x700.png'
  )
  await capture(running.cdp, captures.runtimeSettings)
  await closeApp(running)
  running = null

  await installAcceptanceRuntime(
    join(freshDataDir, 'rovai.sqlite'),
    ['agent-luoke', 'agent-mianzhi', 'agent-qilu']
  )
  await mkdir(join(freshDataDir, 'quick-chat'), { recursive: true })
  campId = 'camp-lifecycle-accept'
  campTitle = 'Camp 生命周期验收'
  await createCampFixture(
    join(freshDataDir, 'rovai.sqlite'),
    campId,
    campTitle,
    join(freshDataDir, 'quick-chat')
  )
  running = await launchApp(freshDataDir, firstPort + 1, 1040, 700)
  const configuredPreflight = await request(running.cdp, 'camps.creationPreflight')
  assert(
    configuredPreflight.admissible
      && configuredPreflight.initialLeadAgentProfileId === 'agent-luoke'
      && configuredPreflight.presentMembers.length === 4,
    `Configured Runtime did not select the first present Profile for a new Camp: ${JSON.stringify(configuredPreflight)}`
  )

  await openMembers(running.cdp)
  await selectMember(running.cdp, '眠枝')
  const runtimeBeforeDraft = await request(running.cdp, 'agents.get', {
    agentProfileId: 'agent-mianzhi'
  })
  const foldedRuntimeParameters = await evaluate(running.cdp, `({
    open: document.querySelector('.member-runtime-parameters')?.open,
    exposesInstallation: document.querySelector('.member-runtime-parameters')
      ?.textContent?.includes('Installation ID')
  })`)
  assert(
    foldedRuntimeParameters.open === false && !foldedRuntimeParameters.exposesInstallation,
    `Member Runtime parameters were not folded or exposed Installation details: ${JSON.stringify(foldedRuntimeParameters)}`
  )
  await mouseClick(running.cdp, '.member-runtime-parameters summary')
  await waitForText(running.cdp, '.member-runtime-parameters', '模型策略')
  await selectFieldValue(
    running.cdp,
    '.member-section',
    'Product Runtime',
    'qoder-cli',
    'Agent运行时'
  )
  await waitForText(running.cdp, '.member-runtime-parameters', '当前还没有可编辑的能力快照')
  await selectFieldValue(
    running.cdp,
    '.member-section',
    'Product Runtime',
    'codex-cli',
    'Agent运行时'
  )
  const switchedRuntimeDefaults = await runtimeParameterValues(running.cdp)
  assert(
    switchedRuntimeDefaults.modelMode === 'runtime_default'
      && switchedRuntimeDefaults.sandboxMode === 'danger-full-access'
      && switchedRuntimeDefaults.approvalPolicy === 'never',
    `Switching back to Codex did not load Core defaults: ${JSON.stringify(switchedRuntimeDefaults)}`
  )
  await mouseClick(running.cdp, '.member-form-actions button', '放弃更改')
  const restoredRuntimeDraft = await runtimeParameterValues(running.cdp)
  assert(
    restoredRuntimeDraft.modelMode === 'runtime_default'
      && restoredRuntimeDraft.sandboxMode === 'workspace-write'
      && restoredRuntimeDraft.approvalPolicy === 'on-request',
    `Discard did not restore the persisted Runtime draft: ${JSON.stringify(restoredRuntimeDraft)}`
  )
  await selectFieldValue(
    running.cdp,
    '.member-runtime-parameters',
    '模型策略',
    'explicit'
  )
  await waitForText(running.cdp, '.member-runtime-parameters', '推理强度')
  await selectFieldValue(
    running.cdp,
    '.member-runtime-parameters',
    '推理强度',
    'high'
  )
  await selectFieldValue(
    running.cdp,
    '.member-runtime-parameters',
    '文件系统访问',
    'danger-full-access'
  )
  await selectFieldValue(
    running.cdp,
    '.member-runtime-parameters',
    '审批策略',
    'never'
  )
  captures.memberRuntimeParameters = join(
    outputDir,
    'member-runtime-parameters-day-1040x700.png'
  )
  await capture(running.cdp, captures.memberRuntimeParameters)
  await mouseClick(running.cdp, '.member-form-actions button', '保存 Agent运行时与参数')
  const configuredRuntime = await waitForProfile(
    running.cdp,
    'agent-mianzhi',
    (profile) => profile.version > runtimeBeforeDraft.version
      && profile.runtimeReadiness.status === 'ready'
  )
  assert(
    configuredRuntime.runtimePreference?.model.mode === 'explicit'
      && configuredRuntime.runtimePreference.model.modelId === 'gpt-lifecycle-accept'
      && configuredRuntime.runtimePreference.model.options.reasoning_effort === 'high'
      && configuredRuntime.runtimePreference.permissions.values.sandbox_mode
        === 'danger-full-access'
      && configuredRuntime.runtimePreference.permissions.values.approval_policy === 'never',
    `Member Runtime configuration was not saved atomically: ${JSON.stringify(configuredRuntime.runtimePreference)}`
  )
  await waitForExpression(running.cdp, `[...document.querySelectorAll('.member-form-actions button')]
    .some((button) => button.textContent?.trim() === '清除执行引擎' && !button.disabled)`)
  await mouseClick(running.cdp, '.member-form-actions button', '清除执行引擎')
  await waitForProfile(running.cdp, 'agent-mianzhi',
    (profile) => profile.presence === 'present'
      && profile.runtimeSelection === null
      && profile.runtimePreference === null)

  await openCamp(running.cdp, campTitle)
  await waitForSelector(running.cdp, '.conversation-bubble.user .message-copy-button')
  const userMessageCopyState = await evaluate(running.cdp, `({
    selectable: getComputedStyle(document.querySelector('.conversation-bubble.user')).userSelect === 'text',
    label: document.querySelector('.conversation-bubble.user .message-copy-button')?.getAttribute('aria-label')
  })`)
  assert(
    userMessageCopyState.selectable
      && userMessageCopyState.label === '复制这条消息',
    `User message is not selectable/copyable: ${JSON.stringify(userMessageCopyState)}`
  )
  await mouseClick(running.cdp, '.conversation-bubble.user .message-copy-button')
  await waitForText(running.cdp, '.conversation-bubble.user .message-copy-button', '已复制')
  let snapshot = await request(running.cdp, 'camps.snapshot', { campId })
  assert(
    snapshot.camp.defaultLeadAgentId === 'agent-luoke'
      && snapshot.members.length === 4,
    `Fresh Camp did not include every present member with 洛可 as Lead: ${JSON.stringify(snapshot.camp)}`
  )

  await openMembers(running.cdp)
  await selectMember(running.cdp, '绮露')
  const qiluBeforeRemoval = await request(running.cdp, 'agents.get', {
    agentProfileId: 'agent-qilu'
  })
  assert(
    qiluBeforeRemoval.runtimeSelection?.adapterKind === 'codex-cli'
      && qiluBeforeRemoval.runtimePreference !== null,
    'Removal retention fixture did not configure a Runtime for 绮露'
  )
  await mouseClick(running.cdp, '.member-danger-zone button', '移除 绮露')
  await waitForSelector(running.cdp, '.dialog-content')
  await waitForExpression(running.cdp,
    `document.activeElement === document.querySelector('.dialog-content input')`)
  await running.cdp.send('Input.insertText', { text: '绮露' })
  await waitForExpression(running.cdp,
    `Boolean([...document.querySelectorAll('.dialog-content button')]
      .find((button) => button.textContent?.trim() === '永久移除' && !button.disabled))`)
  await mouseClick(running.cdp, '.dialog-content button', '永久移除')
  await waitForExpression(running.cdp, `!document.querySelector('.dialog-content')`, 30_000)
  await waitForExpression(running.cdp, `![...document.querySelectorAll('.member-list-copy strong')]
    .some((node) => node.textContent === '绮露')`)
  const qiluAfterRemoval = await historicalProfile(
    join(freshDataDir, 'rovai.sqlite'),
    'agent-qilu'
  )
  const activeAfterRemoval = await request(running.cdp, 'agents.list')
  assert(
    qiluAfterRemoval.presence === 'removed'
      && qiluAfterRemoval.removedAt
      && qiluAfterRemoval.displayName === qiluBeforeRemoval.displayName
      && qiluAfterRemoval.roleTitle === qiluBeforeRemoval.roleTitle
      && qiluAfterRemoval.avatarRef === qiluBeforeRemoval.avatarRef
      && qiluAfterRemoval.runtimeInstallationId
        === qiluBeforeRemoval.runtimePreference.installationId
      && qiluAfterRemoval.selectedRuntimeAdapterKind
        === qiluBeforeRemoval.runtimeSelection.adapterKind
      && !activeAfterRemoval.some((profile) => profile.id === 'agent-qilu'),
    `Permanent removal did not retain identity/Runtime or hide the active Profile: ${JSON.stringify(qiluAfterRemoval)}`
  )
  snapshot = await request(running.cdp, 'camps.snapshot', { campId })
  const historicQilu = snapshot.members.find((member) => member.agentProfileId === 'agent-qilu')
  assert(
    historicQilu?.profilePresence === 'removed'
      && historicQilu.displayName === qiluBeforeRemoval.displayName
      && historicQilu.avatarRef === qiluBeforeRemoval.avatarRef,
    `Historical Camp identity did not retain the removed member: ${JSON.stringify(historicQilu)}`
  )

  for (const agentProfileId of ['agent-luoke', 'agent-muwa', 'agent-mianzhi']) {
    await setPresence(running.cdp, agentProfileId, 'away')
  }
  await reloadRenderer(running.cdp)
  await openCamp(running.cdp, campTitle)
  snapshot = await request(running.cdp, 'camps.snapshot', { campId })
  assert(
    snapshot.camp.defaultLeadAgentId === null
      && snapshot.members.filter((member) => member.profilePresence === 'present').length === 0,
    `Camp reconciliation did not persist a null Lead: ${JSON.stringify(snapshot.camp)}`
  )
  await waitForExpression(running.cdp,
    `document.querySelector('#camp-message') && !document.querySelector('#camp-message').disabled`)
  await focusAndInsertText(running.cdp, '#camp-message', '没有可继承成员也保留草稿')
  await mouseClick(running.cdp, '.composer .composer-send')
  await waitForText(running.cdp, '.app-toast', '当前无可用成员。')
  await assertDraftAndFocus(running.cdp, '#camp-message', '没有可继承成员也保留草稿')
  await setTheme(running.cdp, 'night')
  await setViewport(running.cdp, 1040, 700)
  await assertNoHorizontalOverflow(running.cdp, 'Camp with no successor at 1040×700 Night')
  captures.freshCampNoSuccessor = join(
    outputDir,
    'fresh-camp-no-successor-night-1040x700.png'
  )
  await capture(running.cdp, captures.freshCampNoSuccessor)

  await setPresence(running.cdp, 'agent-muwa', 'present')
  await reloadRenderer(running.cdp)
  await openCamp(running.cdp, campTitle)
  snapshot = await request(running.cdp, 'camps.snapshot', { campId })
  assert(
    snapshot.camp.defaultLeadAgentId === 'agent-muwa',
    `Camp did not inherit the first present member by Member Order: ${JSON.stringify(snapshot.camp)}`
  )
  assert(
    snapshot.members.find((member) => member.agentProfileId === 'agent-muwa')
      ?.profilePresence === 'present',
    'Inherited Lead is not present in the Camp snapshot'
  )
  await setTheme(running.cdp, 'day')
  await setViewport(running.cdp, 1440, 920)
  captures.freshCampInheritedLead = join(
    outputDir,
    'fresh-camp-inherited-lead-day-1440x920.png'
  )
  await capture(running.cdp, captures.freshCampInheritedLead)
  await closeApp(running)
  running = null

  running = await launchApp(freshDataDir, firstPort + 2, 1440, 920)
  await openCamp(running.cdp, campTitle)
  snapshot = await request(running.cdp, 'camps.snapshot', { campId })
  assert(
    snapshot.camp.defaultLeadAgentId === 'agent-muwa'
      && !((await request(running.cdp, 'agents.list'))
        .some((profile) => profile.id === 'agent-qilu'))
      && (await historicalProfile(
        join(freshDataDir, 'rovai.sqlite'),
        'agent-qilu'
      )).presence === 'removed',
    'Fresh restart did not preserve inherited Lead and terminal removal'
  )
  await closeApp(running)
  running = null

  running = await launchApp(upgradeDataDir, firstPort + 3, 1040, 700)
  await closeApp(running)
  running = null
  await simulateV14Database(join(upgradeDataDir, 'rovai.sqlite'))

  running = await launchApp(upgradeDataDir, firstPort + 4, 1440, 920)
  const upgradedProfiles = await request(running.cdp, 'agents.list')
  const upgradedById = new Map(upgradedProfiles.map((profile) => [profile.id, profile]))
  assert(
    upgradedById.get('agent-luoke')?.presence === 'present'
      && upgradedById.get('agent-muwa')?.presence === 'away'
      && upgradedById.get('agent-mianzhi')?.presence === 'present'
      && upgradedById.get('agent-qilu')?.presence === 'away'
      && upgradedById.get('agent-luoke')?.displayName === '升级洛可'
      && upgradedById.get('agent-luoke')?.runtimeSelection === null
      && upgradedById.get('agent-qilu')?.runtimeSelection === null
      && upgradedById.get('agent-luoke')?.runtimePreference === null
      && upgradedById.get('agent-qilu')?.runtimePreference === null,
    `v41 did not delete every legacy member Runtime configuration: ${JSON.stringify(upgradedProfiles)}`
  )
  assert(
    await migrationApplied(join(upgradeDataDir, 'rovai.sqlite'), 41),
    'v0.14 fixture did not apply the member Runtime reset Migration v41'
  )
  await openMembers(running.cdp)
  await selectMember(running.cdp, '升级洛可')
  Object.assign(captures, await captureThemeMatrix(
    running.cdp,
    'upgrade-v014-members',
    '升级洛可',
    outputDir
  ))
  await selectMember(running.cdp, '绮露')
  await waitForText(running.cdp, '.member-status-actions', '暂离')
  await closeApp(running)
  running = null

  running = await launchApp(upgradeDataDir, firstPort + 5, 1040, 700)
  const restartedUpgrade = await request(running.cdp, 'agents.list')
  assert(
    restartedUpgrade.find((profile) => profile.id === 'agent-luoke')?.presence === 'present'
      && restartedUpgrade.find((profile) => profile.id === 'agent-muwa')?.presence === 'away'
      && restartedUpgrade.find((profile) => profile.id === 'agent-qilu')?.presence === 'away'
      && restartedUpgrade.find((profile) => profile.id === 'agent-luoke')?.displayName === '升级洛可',
    `v0.14 migration state did not survive restart: ${JSON.stringify(restartedUpgrade)}`
  )

  console.log(JSON.stringify({
    ok: true,
    app: basename(appPath),
    fixtureRoot,
    outputDir,
    verified: {
      freshSchemaV41: true,
      v14MemberRuntimeResetOnSchemaV41: true,
      mentionComposerUsesMemberName: true,
      contextSettingsDestinationRemoved: true,
      summaryModelAdvancedSettingsFoldedAndSaved: true,
      memberHandlesHiddenAndDuplicateNameBlocked: true,
      userMessageSelectableAndCopyable: true,
      freshNoRuntimeComposerToastAndDraft: true,
      leaveByMouseAndRejoinByKeyboard: true,
      themeSwitchPreservesDialogDraftAndFocus: true,
      radixEscapeAndFocusReturn: true,
      runtimeClearDoesNotChangePresence: true,
      memberRuntimeParametersFoldDraftDiscardAndAtomicSave: true,
      removalRetainsIdentityAvatarRuntimeAndHistory: true,
      removedHiddenFromActiveRoster: true,
      noSuccessorLeadNullComposerToastAndDraft: true,
      memberOrderLeadInheritance: 'agent-muwa',
      restartPersistence: true,
      dayAndNightPreferenceDayWideCompactMatrix: true,
      runtimeSettingsNineProductsAndAdvancedPathBoundary: true,
      horizontalOverflow: false
    },
    captures
  }, null, 2))
} finally {
  if (running) await closeApp(running).catch(() => undefined)
}

async function captureThemeMatrix(cdp, prefix, selectedName, directory) {
  const result = {}
  for (const [width, height] of [[1440, 920], [1040, 700]]) {
    for (const theme of ['day', 'night']) {
      await setViewport(cdp, width, height)
      await setTheme(cdp, theme)
      await waitForExpression(cdp,
        `document.querySelector('.member-profile-heading h3')?.textContent === ${JSON.stringify(selectedName)}`)
      await waitForExpression(cdp,
        `[...document.querySelectorAll('.member-avatar img, .member-portrait img')]
          .every((image) => image.complete && image.naturalWidth > 0)`)
      await assertNoHorizontalOverflow(
        cdp,
        `${prefix} ${theme} ${width}×${height}`
      )
      await evaluate(cdp, `(() => {
        const content = document.querySelector('.content')
        if (content) content.scrollTop = 0
      })()`)
      const key = `${prefix}-${theme}-${width}x${height}`
      const path = join(directory, `${key}.png`)
      await capture(cdp, path)
      result[key] = path
    }
  }
  return result
}

async function installAcceptanceRuntime(databasePath, agentProfileIds) {
  const modelCatalog = sqlLiteral(acceptanceModelCatalog)
  const permissionOptions = sqlLiteral(acceptancePermissionOptions)
  const ids = agentProfileIds.map(sqlLiteral).join(', ')
  await runSql(databasePath, `
    INSERT INTO adapter_installation(
      id, adapter_kind, executable_path, command_name,
      installation_class, source, auth_scope, enabled,
      generation, path_state, version, created_at, updated_at
    ) VALUES (
      'adapter-lifecycle-accept', 'codex-cli', '${acceptanceExecutablePath}',
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
      'adapter-lifecycle-accept', 'acceptance', '${acceptanceExecutableFingerprint}',
      'authenticated', 'ready', 1, 'sha256:acceptance-permissions', '[]', '[]',
      ${modelCatalog}, ${permissionOptions},
      datetime('now'), datetime('now'), datetime('now'), NULL, NULL,
      'codex-app-server-v2'
    );
    UPDATE agent_profile
    SET selected_runtime_adapter_kind = 'codex-cli',
        default_runtime_installation_id = 'adapter-lifecycle-accept',
        default_model_selection_json = '{"mode":"runtime_default"}',
        default_permission_config_json =
          '{"adapterKind":"codex-cli","schemaVersion":1,"values":{"sandbox_mode":"workspace-write","approval_policy":"on-request"}}'
    WHERE id IN (${ids});
  `)
}

async function createCampFixture(databasePath, id, title, projectPath) {
  await runSql(databasePath, `
    INSERT INTO camp(
      id, title, project_binding_kind, project_path, default_lead_agent_id, status,
      last_message_sequence, version, created_at, updated_at
    ) VALUES (
      ${sqlLiteral(id)}, ${sqlLiteral(title)}, 'quick_chat', ${sqlLiteral(projectPath)},
      'agent-luoke', 'active', 1, 1, datetime('now'), datetime('now')
    );
    INSERT INTO camp_member(
      camp_id, agent_profile_id, status, capability_overrides_json,
      version, joined_at
    )
    SELECT ${sqlLiteral(id)}, id, 'active', '{}', 1, datetime('now')
    FROM agent_profile
    WHERE id IN ('agent-luoke', 'agent-muwa', 'agent-mianzhi', 'agent-qilu');
    INSERT INTO conversation(
      id, camp_id, agent_profile_id, version, created_at, updated_at
    )
    SELECT 'conversation-lifecycle-' || handle, ${sqlLiteral(id)}, id,
           1, datetime('now'), datetime('now')
    FROM agent_profile
    WHERE id IN ('agent-luoke', 'agent-muwa', 'agent-mianzhi', 'agent-qilu');
    INSERT INTO camp_message(
      id, camp_id, sequence, author_type, author_id, body, address_mode,
      addressed_agent_profile_ids_json, version, created_at, updated_at
    ) VALUES (
      'message-lifecycle-user', ${sqlLiteral(id)}, 1, 'user', 'local-user',
      '@luoke 验证用户消息复制', 'explicit', '["agent-luoke"]',
      1, datetime('now'), datetime('now')
    );
  `)
}

async function simulateV14Database(databasePath) {
  await installAcceptanceRuntime(databasePath, ['agent-luoke', 'agent-qilu'])
  await runSql(databasePath, `
    DROP TRIGGER IF EXISTS agent_profile_presence_insert_guard;
    DROP TRIGGER IF EXISTS agent_profile_presence_update_guard;
    DELETE FROM schema_migration WHERE version = 26;
    DELETE FROM schema_migration WHERE version = 41;
    UPDATE agent_profile
    SET profile_status = 'active', removed_at = NULL,
        display_name = '升级洛可', role_title = '升级 Lead'
    WHERE id = 'agent-luoke';
    UPDATE agent_profile
    SET profile_status = 'disabled', removed_at = NULL
    WHERE id = 'agent-muwa';
    UPDATE agent_profile
    SET profile_status = 'active', removed_at = NULL
    WHERE id = 'agent-mianzhi';
    UPDATE agent_profile
    SET profile_status = 'archived', archived_at = 'v0.14-archived', removed_at = NULL
    WHERE id = 'agent-qilu';
  `)
}

async function setPresence(cdp, agentProfileId, presence) {
  const profile = await request(cdp, 'agents.get', { agentProfileId })
  const result = await request(cdp, 'agents.presence.set', {
    commandId: crypto.randomUUID(),
    command: {
      agentProfileId,
      expectedVersion: profile.version,
      presence
    }
  })
  assert(result.status === 'applied',
    `Could not set ${agentProfileId} Presence to ${presence}: ${JSON.stringify(result)}`)
}

async function waitForProfile(cdp, agentProfileId, predicate, timeoutMs = 30_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const profile = await request(cdp, 'agents.get', { agentProfileId })
    if (predicate(profile)) return profile
    await wait(100)
  }
  throw new Error(`AgentProfile ${agentProfileId} did not reach the expected state`)
}

async function openNewConversation(cdp) {
  await waitForExpression(cdp,
    `Boolean(document.querySelector('.unified-sidebar button[aria-label="新对话"]:not(:disabled)'))`,
    45_000)
  await mouseClick(cdp, '.unified-sidebar button[aria-label="新对话"]')
  await waitForSelector(cdp, '.new-camp-dialog', 30_000)
  await waitForExpression(cdp,
    `document.activeElement?.classList.contains('new-camp-picker-trigger') === true`,
    30_000)
}

async function openMembers(cdp) {
  if (await evaluate(cdp, `Boolean(document.querySelector('.settings-sidebar-back'))`)) {
    await mouseClick(cdp, '.settings-sidebar-back', '返回 App', true)
    await waitForSelector(cdp, '.unified-primary-nav', 30_000)
  }
  await mouseClick(cdp, '.unified-sidebar button[aria-label="成员"]')
  await waitForSelector(cdp, '.member-workbench', 30_000)
}

async function openCamp(cdp, title) {
  await waitForSelector(cdp, '.unified-sidebar', 30_000)
  await waitForExpression(cdp, `(() => {
    const title = ${JSON.stringify(title)}
    return [...document.querySelectorAll('.camp-nav-open')]
      .some((button) => button.textContent?.includes(title))
  })()`, 30_000)
  await mouseClick(cdp, '.camp-nav-open', title, true)
  await waitForSelector(cdp, '.camp-workspace', 30_000)
}

async function selectMember(cdp, displayName) {
  await mouseClick(cdp, '.member-list-item', displayName, true)
  await waitForExpression(cdp,
    `document.querySelector('.member-profile-heading h3')?.textContent === ${JSON.stringify(displayName)}`)
}

async function focusAndInsertText(cdp, selector, text) {
  await waitForExpression(cdp,
    `Boolean(document.querySelector(${JSON.stringify(selector)})
      && !document.querySelector(${JSON.stringify(selector)}).disabled)`,
    30_000)
  const focused = await evaluate(cdp, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element || element.disabled) return false
    element.focus()
    return document.activeElement === element
  })()`)
  assert(focused, `Could not focus enabled input ${selector}`)
  await cdp.send('Input.insertText', { text })
  await waitForExpression(cdp,
    `document.querySelector(${JSON.stringify(selector)})?.value === ${JSON.stringify(text)}`)
}

async function replaceInputValue(cdp, selector, value) {
  const changed = await evaluate(cdp, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)})
    if (!input || input.disabled) return false
    input.focus()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  assert(changed, `Could not replace input value for ${selector}`)
  await waitForExpression(cdp,
    `document.querySelector(${JSON.stringify(selector)})?.value === ${JSON.stringify(value)}`)
}

async function replaceTextareaValue(cdp, selector, value) {
  const changed = await evaluate(cdp, `(() => {
    const textarea = document.querySelector(${JSON.stringify(selector)})
    if (!textarea || textarea.disabled) return false
    textarea.focus()
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(textarea, ${JSON.stringify(value)})
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  assert(changed, `Could not replace textarea value for ${selector}`)
  await waitForExpression(cdp,
    `document.querySelector(${JSON.stringify(selector)})?.value === ${JSON.stringify(value)}`)
}

async function selectFieldValue(cdp, scopeSelector, label, value, sectionHeading = null) {
  const changed = await evaluate(cdp, `(() => {
    const scopes = [...document.querySelectorAll(${JSON.stringify(scopeSelector)})]
    const scope = ${sectionHeading === null
      ? 'scopes[0]'
      : `scopes.find((candidate) =>
          candidate.querySelector('.member-section-heading h3')?.textContent?.trim()
            === ${JSON.stringify(sectionHeading)})`}
    const field = [...(scope?.querySelectorAll('.field-label') ?? [])]
      .find((candidate) => candidate.childNodes[0]?.textContent?.trim()
        === ${JSON.stringify(label)})
    const select = field?.querySelector('select')
    if (!select || select.disabled) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    setter?.call(select, ${JSON.stringify(value)})
    select.dispatchEvent(new Event('change', { bubbles: true }))
    return select.value === ${JSON.stringify(value)}
  })()`)
  assert(changed, `Could not select ${value} for ${label}`)
  await waitForExpression(cdp, `(() => {
    const scopes = [...document.querySelectorAll(${JSON.stringify(scopeSelector)})]
    const scope = ${sectionHeading === null
      ? 'scopes[0]'
      : `scopes.find((candidate) =>
          candidate.querySelector('.member-section-heading h3')?.textContent?.trim()
            === ${JSON.stringify(sectionHeading)})`}
    const field = [...(scope?.querySelectorAll('.field-label') ?? [])]
      .find((candidate) => candidate.childNodes[0]?.textContent?.trim()
        === ${JSON.stringify(label)})
    return field?.querySelector('select')?.value === ${JSON.stringify(value)}
  })()`)
}

async function runtimeParameterValues(cdp) {
  return evaluate(cdp, `(() => {
    const fields = [...document.querySelectorAll(
      '.member-runtime-parameters .field-label'
    )]
    const value = (label) => fields
      .find((field) => field.childNodes[0]?.textContent?.trim() === label)
      ?.querySelector('select')?.value
    return {
      modelMode: value('模型策略'),
      sandboxMode: value('文件系统访问'),
      approvalPolicy: value('审批策略')
    }
  })()`)
}

async function waitForSummaryVersion(cdp, previousVersion) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const config = await request(cdp, 'context.summaryModel.get')
    if (config.version > previousVersion) return config
    await delay(100)
  }
  throw new Error(`Summary model version did not advance beyond ${previousVersion}`)
}

async function assertDraftAndFocus(cdp, selector, value) {
  await waitForExpression(cdp, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    return element?.value === ${JSON.stringify(value)}
      && document.activeElement === element
  })()`, 5_000)
  const state = await evaluate(cdp, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    return { value: element?.value, focused: document.activeElement === element }
  })()`)
  assert(
    state.value === value && state.focused,
    `Composer draft or focus was lost: ${JSON.stringify(state)}`
  )
}

async function focusElement(cdp, selector, text = null, includes = false) {
  const focused = await evaluate(cdp, `(() => {
    const candidates = [...document.querySelectorAll(${JSON.stringify(selector)})]
    const element = ${text === null
      ? 'candidates[0]'
      : `candidates.find((candidate) => ${includes
        ? `candidate.textContent?.includes(${JSON.stringify(text)})`
        : `candidate.textContent?.trim() === ${JSON.stringify(text)}`})`}
    if (!element || element.disabled) return false
    element.focus()
    return document.activeElement === element
  })()`)
  assert(focused, `Could not focus ${selector}${text ? ` containing ${text}` : ''}`)
}

async function mouseClick(cdp, selector, text = null, includes = false) {
  const point = await evaluate(cdp, `(() => {
    const candidates = [...document.querySelectorAll(${JSON.stringify(selector)})]
    const element = ${text === null
      ? 'candidates[0]'
      : `candidates.find((candidate) => ${includes
        ? `candidate.textContent?.includes(${JSON.stringify(text)})`
        : `candidate.textContent?.trim() === ${JSON.stringify(text)}`})`}
    if (!element || element.disabled) return null
    element.scrollIntoView({ block: 'center', inline: 'center' })
    const rect = element.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  assert(point, `Could not click ${selector}${text ? ` containing ${text}` : ''}`)
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1
  })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1
  })
}

async function pressKey(cdp, key, { meta = false } = {}) {
  const code = key === 'a' ? 'KeyA' : key
  const virtualKey = key === 'Enter' ? 13 : key === 'Escape' ? 27 : key.toUpperCase().charCodeAt(0)
  const params = {
    key,
    code,
    modifiers: meta ? 4 : 0,
    windowsVirtualKeyCode: virtualKey,
    nativeVirtualKeyCode: virtualKey,
    ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {})
  }
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...params })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params })
}

async function request(cdp, method, params = {}) {
  return evaluate(
    cdp,
    `window.rovai.request(${JSON.stringify(method)}, ${JSON.stringify(params)})`,
    true
  )
}

async function setTheme(cdp, preference) {
  await evaluate(
    cdp,
    `window.rovai.appearance.setPreference(${JSON.stringify(preference)})`,
    true
  )
  await waitForExpression(cdp, `document.documentElement.dataset.theme === 'day'`)
}

async function setViewport(cdp, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false
  })
  await waitForExpression(cdp,
    `window.innerWidth === ${width} && window.innerHeight === ${height}`)
}

async function assertNoHorizontalOverflow(cdp, context) {
  const state = await evaluate(cdp, `({
    documentOverflow: document.documentElement.scrollWidth > window.innerWidth,
    surfaces: [...document.querySelectorAll('.content, .member-workbench, .member-detail, .camp-workspace')]
      .filter((node) => node.scrollWidth > node.clientWidth + 1)
      .map((node) => ({
        className: node.className,
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth
      }))
  })`)
  assert(
    !state.documentOverflow && state.surfaces.length === 0,
    `${context} has horizontal overflow: ${JSON.stringify(state)}`
  )
}

async function assertExecutionEngineProductCopy(cdp) {
  const state = await evaluate(cdp, `(() => {
    const text = document.body.innerText
    const forbidden = [
      'Adapter Installation',
      '默认 Runtime',
      '注入 Runtime',
      '未配置 Runtime',
      '不选择 Runtime',
      'Runtime Ready',
      'Runtime 未就绪'
    ]
    return {
      hasExecutionEngineLabel: text.includes('执行引擎'),
      forbiddenHits: forbidden.filter((term) => text.includes(term))
    }
  })()`)
  assert(
    state.hasExecutionEngineLabel && state.forbiddenHits.length === 0,
    `Execution engine product copy is stale: ${JSON.stringify(state)}`
  )
}

async function reloadRenderer(cdp) {
  await cdp.send('Page.reload', { ignoreCache: true })
  await waitForExpression(cdp,
    `Boolean(window.rovai && document.querySelector('.app-shell'))`, 45_000)
  await waitForExpression(cdp,
    `Boolean(document.querySelector('.unified-sidebar button[aria-label="成员"]:not(:disabled)'))`,
    45_000)
}

async function launchApp(dataDir, port, width, height) {
  const stderr = []
  const launcher = spawn('/usr/bin/open', [
    '-na',
    appPath,
    '--args',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dataDir}`
  ], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'pipe']
  })
  launcher.stderr.on('data', (chunk) => stderr.push(String(chunk)))
  const target = await waitForTarget(port, stderr)
  const cdp = await connectCdp(target.webSocketDebuggerUrl)
  await cdp.send('Page.enable')
  await cdp.send('Page.bringToFront')
  await setViewport(cdp, width, height)
  await waitForExpression(cdp,
    `Boolean(window.rovai && document.querySelector('.app-shell'))`, 45_000)
  await waitForExpression(cdp,
    `Boolean(document.querySelector('.unified-sidebar button[aria-label="成员"]:not(:disabled)'))`,
    45_000)
  return { cdp, port, stderr }
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
      return
    }
    await wait(100)
  }
  throw new Error(`Isolated packaged App did not close on debug port ${app.port}`)
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
  await waitForExpression(
    cdp,
    `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
    timeoutMs
  )
}

async function waitForText(cdp, selector, text) {
  await waitForExpression(cdp, `[...document.querySelectorAll(${JSON.stringify(selector)})]
    .some((node) => node.textContent?.includes(${JSON.stringify(text)}))`, 30_000)
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
    for (const request of pending.values()) {
      request.reject(new Error('CDP connection closed'))
    }
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

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function runSql(databasePath, sql) {
  return runProcess('/usr/bin/sqlite3', [databasePath, sql])
}

async function migrationApplied(databasePath, version) {
  const output = await runProcess('/usr/bin/sqlite3', [
    databasePath,
    `SELECT COUNT(*) FROM schema_migration WHERE version = ${Number(version)}`
  ])
  return Number(output.trim()) === 1
}

async function historicalProfile(databasePath, agentProfileId) {
  const output = await runProcess('/usr/bin/sqlite3', [
    '-json',
    databasePath,
    `
      SELECT profile_status AS presence,
             removed_at AS removedAt,
             display_name AS displayName,
             role_title AS roleTitle,
             avatar_ref AS avatarRef,
             selected_runtime_adapter_kind AS selectedRuntimeAdapterKind,
             default_runtime_installation_id AS runtimeInstallationId
      FROM agent_profile
      WHERE id = ${sqlLiteral(agentProfileId)}
    `
  ])
  const [profile] = JSON.parse(output)
  assert(profile, `Historical Profile ${agentProfileId} was not retained`)
  return profile
}

function runProcess(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(String(chunk)))
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
    child.once('error', rejectRun)
    child.once('close', (code, signal) => {
      if (code === 0) resolveRun(stdout.join(''))
      else rejectRun(
        new Error(`${command} exited with ${code ?? signal}: ${stderr.join('')}`)
      )
    })
  })
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))
}
