import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
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
      && freshPreflight.initialLeadAgentProfileId === 'agent_1'
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
      && freshDialog.lead === 'agent_1'
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
  const memberWorkbenchStructure = await evaluate(running.cdp, `({
    sidebarWidth: document.querySelector('.unified-sidebar')?.getBoundingClientRect().width,
    hasRoster: Boolean(document.querySelector('.member-sidebar')),
    homeButton: (() => {
      const button = document.querySelector('.member-sidebar-home')
      const bounds = button?.getBoundingClientRect()
      return {
        width: bounds?.width,
        height: bounds?.height,
        ariaLabel: button?.getAttribute('aria-label'),
        title: button?.getAttribute('title'),
        precedesTitle: button?.nextElementSibling?.textContent === '队员'
      }
    })(),
    detailBackground: getComputedStyle(document.querySelector('.members-view')).backgroundColor,
    hasProjectNavigation: Boolean(document.querySelector('.navigation-projects')),
    duplicateRoster: Boolean(document.querySelector('.member-list, .member-workbench')),
    tabs: [...document.querySelectorAll('.member-tabs [role="tab"]')]
      .map((tab) => tab.textContent?.trim()),
    initialMember: document.querySelector('.member-detail-heading h2')?.textContent,
    headerControls: (() => {
      const presence = document.querySelector('.member-detail-statuses > span')
      const runtime = document.querySelector('.member-header-runtime')
      const presenceBounds = presence?.getBoundingClientRect()
      const runtimeBounds = runtime?.getBoundingClientRect()
      return {
        presenceHeight: presenceBounds?.height,
        runtimeHeight: runtimeBounds?.height,
        runtimeArrow: Boolean(runtime?.querySelector('.member-runtime-entry-arrow')),
        runtimeTitle: runtime?.getAttribute('title')
      }
    })(),
    memorySwitch: (() => {
      const label = document.querySelector('.member-memory-switch')
      const input = label?.querySelector('[role="switch"]')
      const bounds = input?.getBoundingClientRect()
      const style = label ? getComputedStyle(label) : null
      return {
        exists: Boolean(input),
        width: bounds?.width,
        height: bounds?.height,
        labelBorderWidth: style?.borderWidth,
        labelBackground: style?.backgroundColor,
        hasIndependentSaveCopy: document.querySelector('.member-memory-settings')
          ?.textContent?.includes('独立保存，只影响之后创建的 Run。')
      }
    })()
  })`)
  assert(
    memberWorkbenchStructure.sidebarWidth === 270
      && memberWorkbenchStructure.hasRoster
      && memberWorkbenchStructure.homeButton.width === 28
      && memberWorkbenchStructure.homeButton.height === 28
      && memberWorkbenchStructure.homeButton.ariaLabel === '返回首页'
      && memberWorkbenchStructure.homeButton.title === '返回首页'
      && memberWorkbenchStructure.homeButton.precedesTitle
      && memberWorkbenchStructure.detailBackground === 'rgb(255, 255, 255)'
      && !memberWorkbenchStructure.hasProjectNavigation
      && !memberWorkbenchStructure.duplicateRoster
      && JSON.stringify(memberWorkbenchStructure.tabs) === JSON.stringify(['身份', '运行配置'])
      && memberWorkbenchStructure.initialMember === '小狐狸'
      && memberWorkbenchStructure.headerControls.presenceHeight === 28
      && memberWorkbenchStructure.headerControls.runtimeHeight === 28
      && memberWorkbenchStructure.headerControls.runtimeArrow
      && memberWorkbenchStructure.headerControls.runtimeTitle === '打开运行配置'
      && memberWorkbenchStructure.memorySwitch.exists
      && memberWorkbenchStructure.memorySwitch.width === 36
      && memberWorkbenchStructure.memorySwitch.height === 20
      && memberWorkbenchStructure.memorySwitch.labelBorderWidth === '0px'
      && memberWorkbenchStructure.memorySwitch.labelBackground === 'rgba(0, 0, 0, 0)'
      && memberWorkbenchStructure.memorySwitch.hasIndependentSaveCopy,
    `v0.29 member workbench structure is unexpected: ${JSON.stringify(memberWorkbenchStructure)}`
  )
  const memberPortraitGeometry = await evaluate(running.cdp, `(() => {
    const section = document.querySelector('.member-identity-section')?.getBoundingClientRect()
    const portrait = document.querySelector('.member-portrait-button')?.getBoundingClientRect()
    return {
      headerAvatarIsStatic: !document.querySelector('.member-detail-avatar-button'),
      hasPortraitButton: Boolean(portrait),
      portraitLabel: document.querySelector('.member-portrait-button')?.getAttribute('aria-label'),
      portraitTitle: document.querySelector('.member-portrait-button')?.getAttribute('title'),
      width: portrait?.width,
      height: portrait?.height,
      contained: Boolean(section && portrait
        && portrait.left >= section.left - 1
        && portrait.right <= section.right + 1),
      topGap: section && portrait ? Math.round((portrait.top - section.top) * 10) / 10 : null,
      bottomGap: section && portrait ? Math.round((section.bottom - portrait.bottom) * 10) / 10 : null
    }
  })()`)
  assert(
    memberPortraitGeometry.headerAvatarIsStatic
      && memberPortraitGeometry.hasPortraitButton
      && memberPortraitGeometry.portraitLabel === '更换小狐狸的角色图片'
      && memberPortraitGeometry.portraitTitle === '更换角色图片'
      && memberPortraitGeometry.width === 288
      && memberPortraitGeometry.height === 360
      && memberPortraitGeometry.contained
      && Math.abs(memberPortraitGeometry.topGap - memberPortraitGeometry.bottomGap) <= 1,
    `Member portrait control or identity spacing is unexpected: ${JSON.stringify(memberPortraitGeometry)}`
  )

  await focusElement(running.cdp, '#member-identity-tab')
  await pressKey(running.cdp, 'ArrowRight')
  await waitForExpression(running.cdp,
    `document.activeElement === document.querySelector('#member-runtime-tab')
      && document.querySelector('#member-identity-panel')?.hidden === false`)
  await pressKey(running.cdp, 'Enter')
  await waitForExpression(running.cdp,
    `document.querySelector('#member-runtime-panel')?.hidden === false`)
  await pressKey(running.cdp, 'Home')
  await waitForExpression(running.cdp,
    `document.activeElement === document.querySelector('#member-identity-tab')`)
  await pressKey(running.cdp, 'End')
  await waitForExpression(running.cdp,
    `document.activeElement === document.querySelector('#member-runtime-tab')`)
  await pressKey(running.cdp, 'ArrowLeft')
  await waitForExpression(running.cdp,
    `document.activeElement === document.querySelector('#member-identity-tab')`)
  await pressKey(running.cdp, 'Enter')
  await waitForExpression(running.cdp,
    `document.querySelector('#member-identity-panel')?.hidden === false`)

  for (const [width, expectedPortraitWidth, stacked] of [
    [1120, 240, false],
    [820, 288, true],
    [640, 288, true]
  ]) {
    await setViewport(running.cdp, width, 700)
    await assertNoHorizontalOverflow(running.cdp, `Member identity at ${width}px`)
    const responsiveState = await evaluate(running.cdp, `(() => {
      const copy = document.querySelector('.member-identity-copy')?.getBoundingClientRect()
      const appearance = document.querySelector('.member-identity-appearance')?.getBoundingClientRect()
      const portrait = document.querySelector('.member-portrait-button')?.getBoundingClientRect()
      const container = document.querySelector('.member-detail-scroll')?.getBoundingClientRect()
      return {
        portraitWidth: Math.round(portrait?.width ?? 0),
        stacked: Boolean(copy && appearance && appearance.top >= copy.bottom - 1),
        contained: Boolean(container && portrait
          && portrait.left >= container.left - 1
          && portrait.right <= container.right + 1)
      }
    })()`)
    assert(
      responsiveState.portraitWidth <= expectedPortraitWidth
        && responsiveState.stacked === stacked
        && responsiveState.contained,
      `Member identity responsive layout is unexpected at ${width}px: ${JSON.stringify(responsiveState)}`
    )
  }
  await setViewport(running.cdp, 1440, 920)

  const memoryBaseline = await request(running.cdp, 'agents.get', {
    agentProfileId: 'agent_1'
  })
  const memoryInitiallyEnabled = memoryBaseline.defaultCapabilities.includes('memory.write')
  await mouseClick(running.cdp, '.member-memory-switch input')
  await waitForProfile(running.cdp, 'agent_1', (profile) => (
    profile.defaultCapabilities.includes('memory.write') !== memoryInitiallyEnabled
  ))
  await waitForExpression(running.cdp,
    `document.querySelector('.member-memory-switch input')?.disabled === false`)
  await mouseClick(running.cdp, '.member-memory-switch input')
  await waitForProfile(running.cdp, 'agent_1', (profile) => (
    profile.defaultCapabilities.includes('memory.write') === memoryInitiallyEnabled
  ))

  captures.memberIdentityRefinement = join(
    outputDir,
    'member-identity-refinement-day-1440x920.png'
  )
  await capture(running.cdp, captures.memberIdentityRefinement)

  await mouseClick(running.cdp, '.member-portrait-button')
  await waitForSelector(running.cdp, '.member-avatar-dialog', 30_000)
  await pressKey(running.cdp, 'Escape')
  await waitForExpression(running.cdp,
    `!document.querySelector('.member-avatar-dialog')
      && document.activeElement === document.querySelector('.member-portrait-button')`)
  await mouseClick(running.cdp, '.member-sidebar-home')
  await waitForSelector(running.cdp, '.new-conversation-workspace', 30_000)
  await mouseClick(running.cdp, '.unified-sidebar button[aria-label="记忆"]')
  await waitForSelector(running.cdp, '.memory-library', 30_000)
  await openMembers(running.cdp)
  await mouseClick(running.cdp, '.member-sidebar-home')
  await waitForSelector(running.cdp, '.new-conversation-workspace', 30_000)
  await openMembers(running.cdp)
  const initialMemberOrder = (await request(running.cdp, 'agents.list'))
    .map((profile) => profile.id)
  await mouseClick(running.cdp, '.member-sidebar-actions button[aria-label="调整队员顺序"]')
  await waitForSelector(running.cdp, '[data-member-order-handle="agent_1"]')
  assert(
    !await evaluate(running.cdp, `Boolean(document.querySelector('.member-runtime-shortcut'))`),
    'Runtime shortcuts remained visible in Member Order mode'
  )
  await focusElement(running.cdp, '[data-member-order-handle="agent_1"]')
  await pressKey(running.cdp, 'ArrowDown')
  await waitForAgentOrder(running.cdp, [
    initialMemberOrder[1],
    initialMemberOrder[0],
    ...initialMemberOrder.slice(2)
  ])
  await waitForExpression(running.cdp,
    `document.querySelector('[data-member-order-handle="agent_1"]')?.disabled === false`)
  await focusElement(running.cdp, '[data-member-order-handle="agent_1"]')
  await pressKey(running.cdp, 'ArrowUp')
  await waitForAgentOrder(running.cdp, initialMemberOrder)
  await waitForExpression(running.cdp,
    `document.querySelector('[data-member-order-handle="agent_1"]')?.disabled === false`)
  await mouseClick(running.cdp, '.member-sidebar-actions button[aria-label="完成调整队员顺序"]')
  await waitForSelector(running.cdp, '.member-runtime-shortcut')
  await setViewport(running.cdp, 720, 460)
  await running.cdp.send('Emulation.setEmulatedMedia', {
    media: 'screen',
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  })
  await assertNoHorizontalOverflow(running.cdp, 'Member identity at effective 200% Zoom')
  const compactAccessibilityState = await evaluate(running.cdp, `(() => {
    const copy = document.querySelector('.member-identity-copy')?.getBoundingClientRect()
    const portrait = document.querySelector('.member-identity-appearance')?.getBoundingClientRect()
    const shortcut = document.querySelector('.member-runtime-shortcut')
    return {
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      stacked: Boolean(copy && portrait && portrait.top >= copy.bottom - 1),
      shortcutAnimation: shortcut ? getComputedStyle(shortcut).animationName : null
    }
  })()`)
  assert(
    compactAccessibilityState.reducedMotion
      && compactAccessibilityState.stacked
      && compactAccessibilityState.shortcutAnimation === 'none',
    `Compact/reduced-motion member layout is unexpected: ${JSON.stringify(compactAccessibilityState)}`
  )
  await running.cdp.send('Emulation.setEmulatedMedia', {
    media: 'screen',
    features: [{ name: 'forced-colors', value: 'active' }]
  })
  assert(
    await evaluate(running.cdp, `matchMedia('(forced-colors: active)').matches`),
    'Forced Colors emulation did not activate for the member workbench'
  )
  await assertNoHorizontalOverflow(running.cdp, 'Member identity in Forced Colors')
  await running.cdp.send('Emulation.setEmulatedMedia', { media: 'screen', features: [] })
  await setViewport(running.cdp, 1440, 920)
  await selectMember(running.cdp, '小狐狸')
  await openMemberRuntimeTab(running.cdp)
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
  await waitForText(running.cdp, '.summary-model-settings', '选择模型')
  await waitForText(running.cdp, '.summary-model-settings', '当前队员的 Agent 运行时默认模型')
  const summaryModelControls = await evaluate(running.cdp, `({
    selectCount: document.querySelectorAll('.summary-model-settings select').length,
    labels: [...document.querySelectorAll('.summary-model-settings .field-label')]
      .map((node) => node.childNodes[0]?.textContent?.trim()),
    options: [...document.querySelectorAll('.summary-model-settings option')]
      .map((option) => option.textContent?.trim()),
    sourceBox: Boolean(document.querySelector('.summary-model-settings .runtime-empty')),
    saveDisabled: document.querySelector('.summary-model-settings button')?.disabled,
    text: document.querySelector('.summary-model-settings')?.textContent
  })`)
  assert(
    summaryModelControls.selectCount === 1
      && summaryModelControls.labels.length === 1
      && summaryModelControls.labels[0] === '模型'
      && JSON.stringify(summaryModelControls.options) === JSON.stringify([
        '选择模型',
        '当前队员的 Agent 运行时默认模型'
      ])
      && !summaryModelControls.sourceBox
      && summaryModelControls.saveDisabled === true
      && !summaryModelControls.text?.includes('自动回退')
      && !summaryModelControls.text?.includes('模型来源')
      && !summaryModelControls.text?.includes('尚未配置')
      && !summaryModelControls.text?.includes('这是所有 Camp 共享摘要使用的模型配置'),
    `Summary model controls were not simplified: ${JSON.stringify(summaryModelControls)}`
  )
  captures.summaryModelSimplified = join(
    outputDir,
    'summary-model-simplified-day-1440x920.png'
  )
  await capture(running.cdp, captures.summaryModelSimplified)
  await assertExecutionEngineProductCopy(running.cdp)
  await setTheme(running.cdp, 'day')
  await openMemberMenuAction(running.cdp, '暂时离队')
  await waitForProfile(running.cdp, 'agent_1', (profile) => profile.presence === 'away')
  await waitForText(running.cdp, '.app-toast', '已暂离')
  await openMemberMenuAction(running.cdp, '归队')
  await waitForProfile(running.cdp, 'agent_1', (profile) => profile.presence === 'present')
  await waitForText(running.cdp, '.app-toast', '已归队')

  await focusElement(running.cdp, '.member-detail-actions > .quiet-button', '编辑身份')
  await pressKey(running.cdp, 'Enter')
  await waitForSelector(running.cdp, '.member-dialog')
  await waitForExpression(running.cdp, `document.activeElement?.closest('.member-dialog') !== null`)
  const hiddenHandleState = await evaluate(running.cdp, `({
    dialogExposesHandle: document.querySelector('.member-dialog')?.textContent?.includes('@handle'),
    rosterExposesHandle: [...document.querySelectorAll('.member-sidebar-copy small')]
      .some((node) => node.textContent?.includes('@'))
  })`)
  assert(
    hiddenHandleState.dialogExposesHandle === false
      && hiddenHandleState.rosterExposesHandle === false,
    `Member configuration still exposes an internal handle: ${JSON.stringify(hiddenHandleState)}`
  )
  await replaceInputValue(running.cdp, '.member-dialog input', '小河狸')
  await mouseClick(running.cdp, '.member-dialog button', '保存身份')
  await waitForText(running.cdp, '.member-dialog .inline-error', '该名称已被其他队员使用')
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
    (await request(running.cdp, 'agents.get', { agentProfileId: 'agent_1' })).displayName === '小狐狸',
    'Escaping the identity dialog persisted an unsaved theme-switch draft'
  )
  await waitForExpression(running.cdp, `!document.querySelector('.app-toast')`, 5_000)

  Object.assign(captures, await captureThemeMatrix(
    running.cdp,
    'fresh-members',
    '小狐狸',
    outputDir
  ))
  await mouseClick(running.cdp, '.unified-sidebar button[aria-label="设置"]')
  await waitForSelector(running.cdp, '.settings-sidebar-menu')
  await mouseClick(running.cdp, '.settings-sidebar-menu button', 'Agent 运行时', true)
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
    ['agent_1', 'agent_3', 'agent_4']
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
      && configuredPreflight.initialLeadAgentProfileId === 'agent_1'
      && configuredPreflight.presentMembers.length === 4,
    `Configured Runtime did not select the first present Profile for a new Camp: ${JSON.stringify(configuredPreflight)}`
  )

  await openMembers(running.cdp)
  await selectMember(running.cdp, '咕咕')
  await openMemberRuntimeTab(running.cdp)
  const runtimeBeforeDraft = await request(running.cdp, 'agents.get', {
    agentProfileId: 'agent_3'
  })
  const runtimeParametersState = await evaluate(running.cdp, `(() => {
    const parameters = document.querySelector('.member-runtime-parameters')
    const style = parameters ? getComputedStyle(parameters) : null
    const summary = document.querySelector('.runtime-installation-summary')
    const summaryStyle = summary ? getComputedStyle(summary) : null
    return {
      tagName: parameters?.tagName,
      visible: Boolean(parameters && parameters.getBoundingClientRect().height > 0),
      background: style?.backgroundColor,
      leftBorder: style?.borderLeftWidth,
      rightBorder: style?.borderRightWidth,
      bottomBorder: style?.borderBottomWidth,
      topBorder: style?.borderTopWidth,
      summaryBackground: summaryStyle?.backgroundColor,
      summaryBorderWidth: summaryStyle?.borderWidth,
      exposesInstallation: parameters?.textContent?.includes('Installation ID')
    }
  })()`)
  assert(
    runtimeParametersState.tagName === 'SECTION'
      && runtimeParametersState.visible
      && runtimeParametersState.background === 'rgba(0, 0, 0, 0)'
      && runtimeParametersState.leftBorder === '0px'
      && runtimeParametersState.rightBorder === '0px'
      && runtimeParametersState.bottomBorder === '0px'
      && runtimeParametersState.topBorder === '1px'
      && runtimeParametersState.summaryBackground === 'rgba(0, 0, 0, 0)'
      && runtimeParametersState.summaryBorderWidth === '0px'
      && !runtimeParametersState.exposesInstallation,
    `Member Runtime parameters were not a direct plain section: ${JSON.stringify(runtimeParametersState)}`
  )
  await waitForText(running.cdp, '.member-runtime-parameters', '模型策略')
  await selectFieldValue(
    running.cdp,
    '.member-section',
    'Agent 运行时',
    'qoder-cli',
    'Agent 运行时'
  )
  await waitForText(running.cdp, '.member-runtime-parameters', '当前还没有可编辑的能力快照')
  await selectFieldValue(
    running.cdp,
    '.member-section',
    'Agent 运行时',
    'codex-cli',
    'Agent 运行时'
  )
  const switchedRuntimeDefaults = await runtimeParameterValues(running.cdp)
  const codexRuntimeLabels = await evaluate(running.cdp,
    `[...document.querySelectorAll('.member-runtime-parameters .field-label')]
      .map((field) => field.childNodes[0]?.textContent?.trim())`)
  assert(
    switchedRuntimeDefaults.modelMode === 'runtime_default'
      && switchedRuntimeDefaults.sandboxMode === 'danger-full-access'
      && switchedRuntimeDefaults.approvalPolicy === 'never'
      && codexRuntimeLabels.includes('文件系统访问')
      && codexRuntimeLabels.includes('审批策略'),
    `Switching back to Codex did not preserve defaults and independent permission fields: ${JSON.stringify({ switchedRuntimeDefaults, codexRuntimeLabels })}`
  )
  const runtimeActionLabels = await evaluate(running.cdp,
    `[...document.querySelectorAll('.member-form-actions button')]
      .map((button) => button.textContent?.trim())`)
  assert(
    JSON.stringify(runtimeActionLabels) === JSON.stringify(['保存运行时']),
    `Runtime actions were not consolidated into one save button: ${JSON.stringify(runtimeActionLabels)}`
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
  await mouseClick(running.cdp, '.member-sidebar-home')
  await waitForSelector(running.cdp, '.member-leave-dialog')
  await focusElement(running.cdp, '.member-leave-dialog button', '继续编辑')
  await pressKey(running.cdp, 'Enter')
  await waitForExpression(running.cdp,
    `!document.querySelector('.member-leave-dialog')
      && document.querySelector('.member-detail-heading h2')?.textContent === '咕咕'`)
  assert(
    (await runtimeParameterValues(running.cdp)).modelMode === 'explicit',
    'Continuing a dirty Runtime edit lost the current member draft'
  )
  captures.memberRuntimeParameters = join(
    outputDir,
    'member-runtime-parameters-day-1040x700.png'
  )
  await capture(running.cdp, captures.memberRuntimeParameters)
  await mouseClick(running.cdp, '.member-form-actions button', '保存运行时')
  await waitForText(running.cdp, '.app-toast', 'Codex CLI 已保存。')
  const configuredRuntime = await waitForProfile(
    running.cdp,
    'agent_3',
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
  await waitForExpression(running.cdp, `(() => {
    const section = [...document.querySelectorAll('.member-section')]
      .find((candidate) =>
        candidate.querySelector('.member-section-heading h3')?.textContent?.trim() === 'Agent 运行时')
    const save = [...(section?.querySelectorAll('.member-form-actions button') ?? [])]
      .find((button) => button.textContent?.trim() === '保存运行时')
    return section?.querySelector('.field-label select')?.disabled === false
      && save?.disabled === true
  })()`)
  await selectFieldValue(
    running.cdp,
    '.member-runtime-parameters',
    '审批策略',
    'on-request'
  )
  await mouseClick(running.cdp, '.member-sidebar-select', '小狐狸', true)
  await waitForSelector(running.cdp, '.member-leave-dialog')
  await focusElement(running.cdp, '.member-leave-dialog button', '放弃更改')
  await pressKey(running.cdp, 'Enter')
  await waitForExpression(running.cdp,
    `!document.querySelector('.member-leave-dialog')
      && document.querySelector('.member-detail-heading h2')?.textContent === '小狐狸'`)
  await selectMember(running.cdp, '咕咕')
  await openMemberRuntimeTab(running.cdp)
  await waitForText(running.cdp, '.member-runtime-parameters', '审批策略')
  assert(
    (await runtimeParameterValues(running.cdp)).approvalPolicy === 'never',
    'Discarding a dirty Runtime edit changed the persisted configuration'
  )
  await selectFieldValue(
    running.cdp,
    '.member-section',
    'Agent 运行时',
    '',
    'Agent 运行时'
  )
  await mouseClick(running.cdp, '.member-form-actions button', '保存运行时')
  await waitForText(running.cdp, '.app-toast', 'Agent 运行时已清除。')
  await waitForProfile(running.cdp, 'agent_3',
    (profile) => profile.presence === 'present'
      && profile.runtimeSelection === null
      && profile.runtimePreference === null)

  await openCamp(running.cdp, campTitle)
  await waitForSelector(running.cdp, '.conversation-bubble.user .message-copy-button')
  const campColorState = await evaluate(running.cdp, `(() => {
    const color = (selector, property) => {
      const node = document.querySelector(selector)
      return node ? getComputedStyle(node)[property] : null
    }
    return {
      conversation: color('.timeline-pane', 'backgroundColor'),
      controls: color('.conversation-controls', 'backgroundColor'),
      inspector: color('.activity-pane', 'backgroundColor'),
      divider: color('.activity-pane', 'borderLeftColor'),
      rail: color('.unified-sidebar', 'backgroundColor'),
      userMessage: color('.conversation-bubble.user .message-bubble', 'backgroundColor')
    }
  })()`)
  assert(
    campColorState.conversation === 'rgb(255, 255, 255)'
      && campColorState.controls === 'rgb(255, 255, 255)'
      && campColorState.inspector === 'rgb(255, 255, 255)'
      && campColorState.divider === 'rgb(203, 209, 200)'
      && campColorState.rail === 'rgb(246, 247, 243)'
      && campColorState.userMessage === 'rgb(236, 238, 248)',
    `Camp color scope drifted: ${JSON.stringify(campColorState)}`
  )
  const userMessageCopyState = await evaluate(running.cdp, `({
    selectable: getComputedStyle(document.querySelector('.conversation-bubble.user')).userSelect === 'text',
    label: document.querySelector('.conversation-bubble.user .message-copy-button')?.getAttribute('aria-label'),
    insideContent: Boolean(document.querySelector('.conversation-bubble.user .message-surface > .message-copy-button')),
    absentFromMetadata: !document.querySelector('.conversation-bubble.user .bubble-meta .message-copy-button')
  })`)
  assert(
    userMessageCopyState.selectable
      && userMessageCopyState.label === '复制这条消息'
      && userMessageCopyState.insideContent
      && userMessageCopyState.absentFromMetadata,
    `User message is not selectable/copyable: ${JSON.stringify(userMessageCopyState)}`
  )
  await mouseClick(running.cdp, '.conversation-bubble.user .message-copy-button')
  await waitForText(running.cdp, '.conversation-bubble.user .copy-feedback', '已复制')
  let snapshot = await request(running.cdp, 'camps.snapshot', { campId })
  assert(
    snapshot.camp.defaultLeadAgentId === 'agent_1'
      && snapshot.members.length === 4,
    `Fresh Camp did not include every present member with 小狐狸 as Lead: ${JSON.stringify(snapshot.camp)}`
  )
  await focusContenteditableAndInsertText(running.cdp, '#camp-message', '@')
  await waitForSelector(running.cdp, '.structured-mention-menu')
  const mentionMenuState = await evaluate(running.cdp, `(() => {
    const menu = document.querySelector('.structured-mention-menu')
    const composer = document.querySelector('.composer-box')
    const bounds = menu?.getBoundingClientRect()
    const hit = bounds
      ? document.elementFromPoint(bounds.left + 12, bounds.top + 12)
      : null
    return {
      composerOverflow: composer ? getComputedStyle(composer).overflow : null,
      menuHeight: bounds?.height ?? 0,
      hitVisibleMenu: Boolean(hit?.closest('.structured-mention-menu')),
      options: [...(menu?.querySelectorAll('[role="option"]') ?? [])]
        .map((option) => option.textContent?.trim())
    }
  })()`)
  assert(
    mentionMenuState.composerOverflow === 'visible'
      && mentionMenuState.menuHeight > 0
      && mentionMenuState.hitVisibleMenu
      && mentionMenuState.options.length === 5
      && mentionMenuState.options.some((option) => option?.includes('小狐狸')),
    `Camp @ mention menu is clipped or incomplete: ${JSON.stringify(mentionMenuState)}`
  )
  captures.campMentionMenu = join(outputDir, 'camp-mention-menu-day-1440x920.png')
  await capture(running.cdp, captures.campMentionMenu)
  await pressKey(running.cdp, 'ArrowDown')
  await waitForExpression(running.cdp,
    `document.querySelector('.structured-mention-menu [role="option"][aria-selected="true"] strong')
      ?.textContent?.trim() === '小狐狸'`)
  await pressKey(running.cdp, 'Enter')
  await waitForExpression(running.cdp,
    `(() => {
      const editor = document.querySelector('#camp-message')
      const token = editor?.querySelector(
        '.structured-mention-token.member-mention[data-agent-profile-id="agent_1"]'
      )
      return editor?.textContent === '@小狐狸 '
        && token?.textContent === '@小狐狸'
        && token?.getAttribute('contenteditable') === 'false'
        && !document.querySelector('.structured-mention-menu')
    })()`
  )
  await replaceContenteditableText(running.cdp, '#camp-message', '')

  await openMembers(running.cdp)
  await selectMember(running.cdp, '小兔')
  const qiluBeforeRemoval = await request(running.cdp, 'agents.get', {
    agentProfileId: 'agent_4'
  })
  assert(
    qiluBeforeRemoval.runtimeSelection?.adapterKind === 'codex-cli'
      && qiluBeforeRemoval.runtimePreference !== null,
    'Removal retention fixture did not configure a Runtime for 小兔'
  )
  await openMemberMenuAction(running.cdp, '永久移除队员')
  await waitForSelector(running.cdp, '.dialog-content')
  await waitForExpression(running.cdp,
    `document.activeElement === document.querySelector('.dialog-content input')`)
  await running.cdp.send('Input.insertText', { text: '小兔' })
  await waitForExpression(running.cdp,
    `Boolean([...document.querySelectorAll('.dialog-content button')]
      .find((button) => button.textContent?.trim() === '永久移除' && !button.disabled))`)
  await mouseClick(running.cdp, '.dialog-content button', '永久移除')
  await waitForExpression(running.cdp, `!document.querySelector('.dialog-content')`, 30_000)
  await waitForExpression(running.cdp, `![...document.querySelectorAll('.member-sidebar-copy strong')]
    .some((node) => node.textContent === '小兔')`)
  const qiluAfterRemoval = await historicalProfile(
    join(freshDataDir, 'rovai.sqlite'),
    'agent_4'
  )
  const activeAfterRemoval = await request(running.cdp, 'agents.list')
  assert(
    qiluAfterRemoval.presence === 'removed'
      && qiluAfterRemoval.removedAt
      && qiluAfterRemoval.displayName === qiluBeforeRemoval.displayName
      && qiluAfterRemoval.teamRole === qiluBeforeRemoval.teamRole
      && qiluAfterRemoval.avatarRef === qiluBeforeRemoval.avatarRef
      && qiluAfterRemoval.runtimeInstallationId
        === qiluBeforeRemoval.runtimePreference.installationId
      && qiluAfterRemoval.selectedRuntimeAdapterKind
        === qiluBeforeRemoval.runtimeSelection.adapterKind
      && !activeAfterRemoval.some((profile) => profile.id === 'agent_4'),
    `Permanent removal did not retain identity/Runtime or hide the active Profile: ${JSON.stringify(qiluAfterRemoval)}`
  )
  snapshot = await request(running.cdp, 'camps.snapshot', { campId })
  const historicQilu = snapshot.members.find((member) => member.agentProfileId === 'agent_4')
  assert(
    historicQilu?.profilePresence === 'removed'
      && historicQilu.displayName === qiluBeforeRemoval.displayName
      && historicQilu.avatarRef === qiluBeforeRemoval.avatarRef,
    `Historical Camp identity did not retain the removed member: ${JSON.stringify(historicQilu)}`
  )

  for (const agentProfileId of ['agent_1', 'agent_2', 'agent_3']) {
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
    `document.querySelector('#camp-message')?.getAttribute('contenteditable') === 'true'
      && document.querySelector('#camp-message')?.getAttribute('aria-disabled') !== 'true'`)
  await focusContenteditableAndInsertText(running.cdp, '#camp-message', '没有可继承队员也保留草稿')
  await mouseClick(running.cdp, '.composer .composer-send')
  await waitForText(running.cdp, '.app-toast', '当前无可用队员。')
  await assertContenteditableDraftAndFocus(running.cdp, '#camp-message', '没有可继承队员也保留草稿')
  await setTheme(running.cdp, 'night')
  await setViewport(running.cdp, 1040, 700)
  await assertNoHorizontalOverflow(running.cdp, 'Camp with no successor at 1040×700 Night')
  captures.freshCampNoSuccessor = join(
    outputDir,
    'fresh-camp-no-successor-night-1040x700.png'
  )
  await capture(running.cdp, captures.freshCampNoSuccessor)

  await setPresence(running.cdp, 'agent_2', 'present')
  await reloadRenderer(running.cdp)
  await openCamp(running.cdp, campTitle)
  snapshot = await request(running.cdp, 'camps.snapshot', { campId })
  assert(
    snapshot.camp.defaultLeadAgentId === 'agent_2',
    `Camp did not inherit the first present member by Member Order: ${JSON.stringify(snapshot.camp)}`
  )
  assert(
    snapshot.members.find((member) => member.agentProfileId === 'agent_2')
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
    snapshot.camp.defaultLeadAgentId === 'agent_2'
      && !((await request(running.cdp, 'agents.list'))
        .some((profile) => profile.id === 'agent_4'))
      && (await historicalProfile(
        join(freshDataDir, 'rovai.sqlite'),
        'agent_4'
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
    upgradedById.get('agent_1')?.presence === 'present'
      && upgradedById.get('agent_2')?.presence === 'away'
      && upgradedById.get('agent_3')?.presence === 'present'
      && upgradedById.get('agent_4')?.presence === 'away'
      && upgradedById.get('agent_1')?.displayName === '升级小狐狸'
      && upgradedById.get('agent_1')?.runtimeSelection === null
      && upgradedById.get('agent_4')?.runtimeSelection === null
      && upgradedById.get('agent_1')?.runtimePreference === null
      && upgradedById.get('agent_4')?.runtimePreference === null,
    `v41 did not delete every legacy member Runtime configuration: ${JSON.stringify(upgradedProfiles)}`
  )
  assert(
    await migrationApplied(join(upgradeDataDir, 'rovai.sqlite'), 41),
    'v0.14 fixture did not apply the member Runtime reset Migration v41'
  )
  await openMembers(running.cdp)
  await selectMember(running.cdp, '升级小狐狸')
  Object.assign(captures, await captureThemeMatrix(
    running.cdp,
    'upgrade-v014-members',
    '升级小狐狸',
    outputDir
  ))
  await selectMember(running.cdp, '小兔')
  await waitForText(running.cdp, '.member-detail-statuses', '暂离')
  await closeApp(running)
  running = null

  running = await launchApp(upgradeDataDir, firstPort + 5, 1040, 700)
  const restartedUpgrade = await request(running.cdp, 'agents.list')
  assert(
    restartedUpgrade.find((profile) => profile.id === 'agent_1')?.presence === 'present'
      && restartedUpgrade.find((profile) => profile.id === 'agent_2')?.presence === 'away'
      && restartedUpgrade.find((profile) => profile.id === 'agent_4')?.presence === 'away'
      && restartedUpgrade.find((profile) => profile.id === 'agent_1')?.displayName === '升级小狐狸',
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
      contextualMemberSidebarAndTabs: true,
      campComposerMentionMenuVisibleAndKeyboardSelectable: true,
      memberFixedReturnHomeAndHomeWhiteSurface: true,
      equalHeaderStatusControlsAndRuntimeArrow: true,
      manualMemberTabsArrowHomeEndKeyboard: true,
      memoryTrackSwitchLocalSaveAndReducerRollback: true,
      clickableMemberPortraitAndSymmetricIdentitySpacing: true,
      memberPortraitResponsive1120_820_640NoOverflow: true,
      memberOrderDedicatedModeKeyboardRoundTrip: true,
      effective200PercentZoomReducedMotionAndForcedColors: true,
      summaryModelAdvancedSettingsFoldedAndSimplified: true,
      memberHandlesHiddenAndDuplicateNameBlocked: true,
      campWhiteSurfacesStrongDividerAndPreservedRailMessageColors: true,
      userMessageSelectableAndCopyable: true,
      freshNoRuntimeComposerToastAndDraft: true,
      leaveByMouseAndRejoinByKeyboard: true,
      themeSwitchPreservesDialogDraftAndFocus: true,
      radixEscapeAndFocusReturn: true,
      runtimeClearDoesNotChangePresence: true,
      memberRuntimeParametersDirectPlainSingleSaveAndAtomicClear: true,
      dirtyRuntimeGuardContinueAndDiscard: true,
      removalRetainsIdentityAvatarRuntimeAndHistory: true,
      removedHiddenFromActiveRoster: true,
      noSuccessorLeadNullComposerToastAndDraft: true,
      memberOrderLeadInheritance: 'agent_2',
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
        `document.querySelector('.member-detail-heading h2')?.textContent === ${JSON.stringify(selectedName)}`)
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
      'agent_1', 'active', 1, 1, datetime('now'), datetime('now')
    );
    INSERT INTO camp_member(
      camp_id, agent_profile_id, status, capability_overrides_json,
      version, joined_at
    )
    SELECT ${sqlLiteral(id)}, id, 'active', '{}', 1, datetime('now')
    FROM agent_profile
    WHERE id IN ('agent_1', 'agent_2', 'agent_3', 'agent_4');
    INSERT INTO conversation(
      id, camp_id, agent_profile_id, version, created_at, updated_at
    )
    SELECT 'conversation-lifecycle-' || handle, ${sqlLiteral(id)}, id,
           1, datetime('now'), datetime('now')
    FROM agent_profile
    WHERE id IN ('agent_1', 'agent_2', 'agent_3', 'agent_4');
    INSERT INTO camp_message(
      id, camp_id, sequence, author_type, author_id, body, address_mode,
      addressed_agent_profile_ids_json, version, created_at, updated_at
    ) VALUES (
      'message-lifecycle-user', ${sqlLiteral(id)}, 1, 'user', 'local-user',
      '@luoke 验证用户消息复制', 'explicit', '["agent_1"]',
      1, datetime('now'), datetime('now')
    );
  `)
}

async function simulateV14Database(databasePath) {
  await installAcceptanceRuntime(databasePath, ['agent_1', 'agent_4'])
  await runSql(databasePath, `
    DROP TRIGGER IF EXISTS agent_profile_presence_insert_guard;
    DROP TRIGGER IF EXISTS agent_profile_presence_update_guard;
    DELETE FROM schema_migration WHERE version = 26;
    DELETE FROM schema_migration WHERE version = 41;
    UPDATE agent_profile
    SET profile_status = 'active', removed_at = NULL,
        display_name = '升级小狐狸', team_role = '升级 Lead'
    WHERE id = 'agent_1';
    UPDATE agent_profile
    SET profile_status = 'disabled', removed_at = NULL
    WHERE id = 'agent_2';
    UPDATE agent_profile
    SET profile_status = 'active', removed_at = NULL
    WHERE id = 'agent_3';
    UPDATE agent_profile
    SET profile_status = 'archived', archived_at = 'v0.14-archived', removed_at = NULL
    WHERE id = 'agent_4';
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

async function waitForAgentOrder(cdp, expectedIds, timeoutMs = 30_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const ids = (await request(cdp, 'agents.list')).map((profile) => profile.id)
    if (JSON.stringify(ids) === JSON.stringify(expectedIds)) return
    await wait(100)
  }
  throw new Error(`Member Order did not become ${JSON.stringify(expectedIds)}`)
}

async function openNewConversation(cdp) {
  await waitForExpression(cdp,
    `Boolean(document.querySelector('.unified-sidebar button[aria-label="新对话"]:not(:disabled)'))`,
    45_000)
  await mouseClick(cdp, '.unified-sidebar button[aria-label="新对话"]')
  await waitForSelector(cdp, '.new-camp-dialog', 30_000)
  await waitForExpression(cdp,
    `Boolean(document.activeElement?.closest('.new-camp-dialog'))`,
    30_000)
}

async function openMembers(cdp) {
  if (await evaluate(cdp, `Boolean(document.querySelector('.settings-sidebar-back'))`)) {
    await mouseClick(cdp, '.settings-sidebar-back', '返回 App', true)
    await waitForSelector(cdp, '.unified-primary-nav', 30_000)
  }
  await mouseClick(cdp, '.unified-sidebar button[aria-label="队员"]')
  await waitForSelector(cdp, '.members-view', 30_000)
}

async function openCamp(cdp, title) {
  await waitForSelector(cdp, '.unified-sidebar', 30_000)
  if (await evaluate(cdp, `Boolean(document.querySelector('.members-view'))`)) {
    await mouseClick(cdp, '.conversation-jump')
    await waitForSelector(cdp, '.command-palette')
    await focusElement(cdp, '.command-palette-item', title, true)
    await pressKey(cdp, 'Enter')
    await waitForSelector(cdp, '.camp-workspace', 30_000)
    return
  }
  await waitForExpression(cdp, `(() => {
    const title = ${JSON.stringify(title)}
    return [...document.querySelectorAll('.camp-nav-open')]
      .some((button) => button.textContent?.includes(title))
  })()`, 30_000)
  await mouseClick(cdp, '.camp-nav-open', title, true)
  await waitForSelector(cdp, '.camp-workspace', 30_000)
}

async function selectMember(cdp, displayName) {
  await mouseClick(cdp, '.member-sidebar-select', displayName, true)
  await waitForExpression(cdp,
    `document.querySelector('.member-detail-heading h2')?.textContent === ${JSON.stringify(displayName)}`)
}

async function openMemberRuntimeTab(cdp) {
  await mouseClick(cdp, '#member-runtime-tab', '运行配置')
  await waitForExpression(cdp,
    `document.querySelector('#member-runtime-panel')?.hidden === false`)
}

async function openMemberMenuAction(cdp, label) {
  await mouseClick(cdp, '.member-detail-menu > summary')
  await waitForExpression(cdp,
    `document.querySelector('.member-detail-menu')?.open === true`)
  await mouseClick(cdp, '.member-detail-menu button', label)
}

async function focusContenteditableAndInsertText(cdp, selector, text) {
  await waitForExpression(cdp,
    `document.querySelector(${JSON.stringify(selector)})?.getAttribute('contenteditable') === 'true'
      && document.querySelector(${JSON.stringify(selector)})
        ?.getAttribute('aria-disabled') !== 'true'`,
    30_000)
  const focused = await evaluate(cdp, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element
        || element.getAttribute('contenteditable') !== 'true'
        || element.getAttribute('aria-disabled') === 'true') return false
    element.focus()
    return document.activeElement === element
  })()`)
  assert(focused, `Could not focus editable composer ${selector}`)
  await cdp.send('Input.insertText', { text })
  await waitForExpression(cdp,
    `document.querySelector(${JSON.stringify(selector)})?.textContent === ${JSON.stringify(text)}`)
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

async function replaceContenteditableText(cdp, selector, value) {
  const selected = await evaluate(cdp, `(() => {
    const editor = document.querySelector(${JSON.stringify(selector)})
    if (!editor
        || editor.getAttribute('contenteditable') !== 'true'
        || editor.getAttribute('aria-disabled') === 'true') return false
    editor.focus()
    const range = document.createRange()
    range.selectNodeContents(editor)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    return document.activeElement === editor
  })()`)
  assert(selected, `Could not select contenteditable value for ${selector}`)
  if (value) await cdp.send('Input.insertText', { text: value })
  else await pressKey(cdp, 'Backspace')
  await waitForExpression(cdp,
    `document.querySelector(${JSON.stringify(selector)})?.textContent === ${JSON.stringify(value)}`)
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

async function assertContenteditableDraftAndFocus(cdp, selector, value) {
  await waitForExpression(cdp, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    return element?.textContent === ${JSON.stringify(value)}
      && document.activeElement === element
  })()`, 5_000)
  const state = await evaluate(cdp, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    return { value: element?.textContent, focused: document.activeElement === element }
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
    surfaces: [...document.querySelectorAll('.content, .members-view, .member-detail-scroll, .member-sidebar-scroll-body, .camp-workspace')]
      .filter((node) => node.scrollWidth > node.clientWidth + 1)
      .map((node) => ({
        className: node.className,
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth
      })),
    overflowingMemberChildren: (() => {
      const container = document.querySelector('.member-detail-scroll')
      if (!container) return []
      const right = container.getBoundingClientRect().right
      return [...container.querySelectorAll('*')]
        .filter((node) => {
          const rect = node.getBoundingClientRect()
          return rect.width > 0 && rect.right > right + 1
        })
        .slice(0, 12)
        .map((node) => ({
          tag: node.tagName,
          className: node.className,
          width: Math.round(node.getBoundingClientRect().width),
          right: Math.round(node.getBoundingClientRect().right),
          text: node.textContent?.trim().slice(0, 60)
        }))
    })()
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
      'Runtime 未就绪',
      '已找到',
      '尚未检查',
      '已检查',
      '正在检测'
    ]
    return {
      hasExecutionEngineLabel: text.includes('Agent 运行时'),
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
    `Boolean(document.querySelector('.unified-sidebar button[aria-label="队员"]:not(:disabled)'))`,
    45_000)
}

async function launchApp(dataDir, port, width, height) {
  const stderr = []
  const child = spawn(join(appPath, 'Contents', 'MacOS', 'Rovai-ai'), [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dataDir}`
  ], {
    cwd: root,
    env: { ...process.env, ROVAI_ALLOW_ISOLATED_INSTANCE: '1' },
    stdio: ['ignore', 'ignore', 'pipe']
  })
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
  let cdp = null
  try {
    const target = await waitForTarget(port, stderr)
    cdp = await connectCdp(target.webSocketDebuggerUrl)
    await cdp.send('Page.enable')
    await cdp.send('Page.bringToFront')
    await setViewport(cdp, width, height)
    await waitForExpression(cdp,
      `Boolean(window.rovai && document.querySelector('.app-shell'))`, 45_000)
    await waitForExpression(cdp,
      `Boolean(document.querySelector('.unified-sidebar button[aria-label="队员"]:not(:disabled)'))`,
      45_000)
    const health = await request(cdp, 'health.check')
    const expectedDatabasePath = await realpath(join(dataDir, 'rovai.sqlite'))
    const actualDatabasePath = await realpath(health.database.path)
    assert(
      actualDatabasePath === expectedDatabasePath,
      `Isolated App opened the wrong database: ${JSON.stringify({
        expected: expectedDatabasePath,
        actual: actualDatabasePath
      })}`
    )
    return { cdp, port, stderr, dataDir, child }
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
  let debugPortClosed = false
  while (Date.now() - startedAt < 5_000) {
    try {
      await fetch(`http://127.0.0.1:${app.port}/json`)
    } catch {
      debugPortClosed = true
      break
    }
    await wait(100)
  }
  if (!debugPortClosed) {
    await terminateChild(app.child)
    throw new Error(`Isolated packaged App did not close on debug port ${app.port}`)
  }
  await terminateChild(app.child)
}

async function terminateChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    wait(2_000)
  ])
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    wait(5_000)
  ])
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
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
             team_role AS teamRole,
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
