import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { seedCompletedOnboardingForAcceptance } from './lib/dev-desktop.mjs'

const root = resolve(import.meta.dirname, '..')
const appPath = resolve(
  process.argv[2] ?? join(root, 'dist', 'mac-arm64', 'Rovai AI.app')
)
const fixtureRoot = process.env.ROVAI_MEMBER_LIFECYCLE_ACCEPT_DATA_DIR
  ?? await mkdtemp(join(tmpdir(), 'rovai-member-lifecycle-ui-accept-'))
const freshDataDir = join(fixtureRoot, 'fresh')
const upgradeDataDir = join(fixtureRoot, 'upgrade-v014')
const outputDir = process.env.ROVAI_MEMBER_LIFECYCLE_ACCEPT_OUTPUT_DIR
  ?? await mkdtemp(join(tmpdir(), 'rovai-member-lifecycle-ui-captures-'))
const firstPort = Number(process.env.ROVAI_MEMBER_LIFECYCLE_ACCEPT_DEBUG_PORT ?? 9471)
const fallbackAcceptanceExecutablePath = '/usr/bin/true'
const fallbackAcceptanceExecutableFingerprint = `sha256:${createHash('sha256')
  .update(await readFile(fallbackAcceptanceExecutablePath))
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
const fallbackAcceptanceRuntime = {
  executablePath: fallbackAcceptanceExecutablePath,
  commandName: 'codex',
  executableFingerprint: fallbackAcceptanceExecutableFingerprint,
  permissionSchemaDigest: canonicalJsonDigest(JSON.parse(acceptancePermissionOptions)),
  permissionOptions: JSON.parse(acceptancePermissionOptions)
}

await mkdir(freshDataDir, { recursive: true })
await mkdir(upgradeDataDir, { recursive: true })
await mkdir(outputDir, { recursive: true })
seedCompletedOnboardingForAcceptance(freshDataDir)
seedCompletedOnboardingForAcceptance(upgradeDataDir)

let running = null
let campId = null
let campTitle = null
let projectCampId = null
let projectCampTitle = null
let projectCampPath = null
let membershipCampId = null
let membershipCampTitle = null
const captures = {}

try {
  running = await launchApp(freshDataDir, firstPort, 1440, 920)
  await setTheme(running.cdp, 'day')
  const freshProfiles = await request(running.cdp, 'members.list')
  assert(
    freshProfiles.length === 4
      && freshProfiles.every((profile) =>
        profile.presence === 'present'
        && profile.runtimeConfiguration === null
        && profile.runtimeConfiguration === null
        && profile.runtimeReadiness.status === 'runtime_not_configured'),
    `Fresh Profile state is not present/no-Runtime: ${JSON.stringify(freshProfiles)}`
  )
  assert(
    await migrationApplied(join(freshDataDir, 'rovai.sqlite'), 41),
    'Fresh database did not record schema Migration v41'
  )
  assert(
    await migrationApplied(join(freshDataDir, 'rovai.sqlite'), 110),
    'Fresh database did not record dynamic Camp membership Migration v110'
  )

  await openNewConversation(running.cdp)
  const freshPreflight = await request(running.cdp, 'camps.creationPreflight')
  const freshLead = freshPreflight.presentMembers.find(
    (member) => member.agentId === freshPreflight.initialLeadAgentId
  )
  assert(
    freshPreflight.admissible
      && freshPreflight.initialLeadAgentId === 'agent_1'
      && freshLead
      && freshPreflight.presentMembers.length === 4
      && freshPreflight.presentMembers.every((member) => !member.runtimeConfigured),
    `Fresh no-Runtime preflight is unexpected: ${JSON.stringify(freshPreflight)}`
  )
  const freshDialog = await evaluate(running.cdp, `({
    createEnabled: document.querySelector('.new-camp-dialog .primary-button')?.disabled === false,
    memberSummary: document.querySelector('.new-camp-picker-trigger.member-trigger strong')?.textContent,
    lead: document.querySelector('.new-camp-lead-trigger strong')?.textContent,
    collaborationRemoved: !document.querySelector('.new-camp-dialog')?.textContent?.includes('协作方式')
  })`)
  assert(
    freshDialog.createEnabled
      && freshDialog.memberSummary === '已选择 4 位队员'
      && freshDialog.lead === freshLead.displayName
      && freshDialog.collaborationRemoved,
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
    hasWindowDragStrip: Boolean(document.querySelector('.window-drag-strip-members')),
    dragStripTop: document.querySelector('.window-drag-strip-members')?.getBoundingClientRect().top,
    dragStripLeft: document.querySelector('.window-drag-strip-members')?.getBoundingClientRect().left,
    dragStripWidth: document.querySelector('.window-drag-strip-members')?.getBoundingClientRect().width,
    dragStripHeight: document.querySelector('.window-drag-strip-members')?.getBoundingClientRect().height,
    dragStripRegion: getComputedStyle(document.querySelector('.window-drag-strip-members'))
      .getPropertyValue('-webkit-app-region'),
    contentTop: document.querySelector('.content.members-content')?.getBoundingClientRect().top,
    contentWidth: document.querySelector('.content.members-content')?.getBoundingClientRect().width,
    workspaceTop: document.querySelector('.members-workspace')?.getBoundingClientRect().top,
    headerTop: document.querySelector('.member-detail-header')?.getBoundingClientRect().top,
    headerRegion: getComputedStyle(document.querySelector('.member-detail-header'))
      .getPropertyValue('-webkit-app-region'),
    workspaceTopBorder: getComputedStyle(document.querySelector('.members-view')).borderTopWidth,
    sidebarWidth: document.querySelector('.unified-sidebar')?.getBoundingClientRect().width,
    hasRoster: Boolean(document.querySelector('.member-sidebar')),
    rosterWidth: document.querySelector('.member-sidebar')?.getBoundingClientRect().width,
    hasReturnControl: Boolean(document.querySelector('.member-context-return')),
    detailBackground: getComputedStyle(document.querySelector('.members-view')).backgroundColor,
    detailBackgroundImage: getComputedStyle(document.querySelector('.members-view')).backgroundImage,
    hasProjectNavigation: Boolean(document.querySelector('.navigation-projects')),
    duplicateRoster: Boolean(document.querySelector('.member-list, .member-workbench')),
    sidebarActionClickable: (() => {
      const target = document.querySelector('.member-sidebar-actions button')
      const bounds = target?.getBoundingClientRect()
      const hit = bounds ? document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2) : null
      return Boolean(target && hit && (hit === target || target.contains(hit)))
    })(),
    detailActionClickable: (() => {
      const target = document.querySelector('.member-detail-actions button, .member-detail-actions summary')
      const bounds = target?.getBoundingClientRect()
      const hit = bounds ? document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2) : null
      return Boolean(target && hit && (hit === target || target.contains(hit)))
    })(),
    tabs: [...document.querySelectorAll('.member-tabs [role="tab"]')]
      .map((tab) => tab.textContent?.trim()),
    initialMember: document.querySelector('.member-detail-heading h1')?.textContent,
    headerControls: (() => {
      const presence = document.querySelector('.member-detail-statuses > span')
      const runtime = document.querySelector('.member-header-runtime')
      const presenceBounds = presence?.getBoundingClientRect()
      const runtimeBounds = runtime?.getBoundingClientRect()
      return {
        presenceHeight: presenceBounds?.height,
        runtimeHeight: runtimeBounds?.height,
        presenceBackground: presence ? getComputedStyle(presence).backgroundColor : null,
        runtimeBackground: runtime ? getComputedStyle(runtime).backgroundColor : null,
        runtimeBorderWidth: runtime ? getComputedStyle(runtime).borderWidth : null,
        runtimeArrow: Boolean(runtime?.querySelector('.member-runtime-entry-arrow')),
        runtimeTitle: runtime?.getAttribute('title')
      }
    })()
  })`)
  assert(
    memberWorkbenchStructure.hasWindowDragStrip
      && Math.abs(memberWorkbenchStructure.dragStripTop) <= 0.5
      && Math.abs(memberWorkbenchStructure.dragStripLeft - 270) <= 0.5
      && Math.abs(memberWorkbenchStructure.dragStripWidth - memberWorkbenchStructure.contentWidth) <= 0.5
      && Math.abs(memberWorkbenchStructure.dragStripHeight - 50) <= 0.5
      && memberWorkbenchStructure.dragStripRegion === 'drag'
      && Math.abs(memberWorkbenchStructure.contentTop) <= 0.5
      && Math.abs(memberWorkbenchStructure.workspaceTop) <= 0.5
      && Math.abs(memberWorkbenchStructure.headerTop - 30) <= 0.75
      && memberWorkbenchStructure.headerRegion !== 'drag'
      && memberWorkbenchStructure.workspaceTopBorder === '0px'
      && memberWorkbenchStructure.sidebarWidth === 270
      && memberWorkbenchStructure.hasRoster
      && memberWorkbenchStructure.rosterWidth === 236
      && !memberWorkbenchStructure.hasReturnControl
      && memberWorkbenchStructure.detailBackgroundImage === 'none'
      && memberWorkbenchStructure.hasProjectNavigation
      && !memberWorkbenchStructure.duplicateRoster
      && memberWorkbenchStructure.sidebarActionClickable
      && memberWorkbenchStructure.detailActionClickable
      && JSON.stringify(memberWorkbenchStructure.tabs) === JSON.stringify(['身份', '运行配置'])
      && memberWorkbenchStructure.initialMember === '叮叮'
      && memberWorkbenchStructure.headerControls.presenceHeight < 20
      && memberWorkbenchStructure.headerControls.runtimeHeight < 20
      && memberWorkbenchStructure.headerControls.presenceBackground === 'rgba(0, 0, 0, 0)'
      && memberWorkbenchStructure.headerControls.runtimeBackground === 'rgba(0, 0, 0, 0)'
      && memberWorkbenchStructure.headerControls.runtimeBorderWidth === '0px'
      && memberWorkbenchStructure.headerControls.runtimeArrow
      && memberWorkbenchStructure.headerControls.runtimeTitle === '打开运行配置',
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
      && memberPortraitGeometry.portraitLabel === '更换叮叮的角色图片'
      && memberPortraitGeometry.portraitTitle === '更换角色图片'
      && memberPortraitGeometry.width === 220
      && memberPortraitGeometry.height === 275
      && memberPortraitGeometry.contained
      && Math.abs(memberPortraitGeometry.topGap - memberPortraitGeometry.bottomGap) <= 4,
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
    if (width === 820) {
      await mouseClick(running.cdp, '.member-sidebar-actions button[aria-label="折叠队员名册"]')
      await waitForExpression(running.cdp,
        `document.querySelector('.member-sidebar')?.getBoundingClientRect().width === 76`)
    }
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
  await mouseClick(running.cdp, '.member-sidebar-actions button[aria-label="展开队员名册"]')
  await waitForExpression(running.cdp,
    `document.querySelector('.member-sidebar')?.getBoundingClientRect().width === 236`)

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
  await mouseClick(running.cdp, '.unified-sidebar button[aria-label="记忆"]')
  await waitForSelector(running.cdp, '.memory-library', 30_000)
  await openMembers(running.cdp)
  assert(
    !await evaluate(running.cdp, `Boolean(document.querySelector('.member-context-return'))`),
    'Member page still exposed a dedicated return control'
  )
  const initialMemberOrder = (await request(running.cdp, 'members.list'))
    .map((profile) => profile.agentId)
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
  const runtimeShortcutState = await evaluate(running.cdp, `({
    glyphs: [...document.querySelectorAll('.member-runtime-shortcut > span')]
      .map((node) => node.textContent?.trim()),
    hasProductIcon: Boolean(document.querySelector('.member-runtime-shortcut svg'))
  })`)
  assert(
    runtimeShortcutState.glyphs.length === 4
      && runtimeShortcutState.glyphs.every((glyph) => ['✓', '!', '…'].includes(glyph))
      && !runtimeShortcutState.hasProductIcon,
    `Member Runtime shortcuts are unexpected: ${JSON.stringify(runtimeShortcutState)}`
  )
  await mouseClick(running.cdp, '.member-sidebar-actions button[aria-label="折叠队员名册"]')
  await waitForExpression(running.cdp,
    `document.querySelector('.member-sidebar')?.getBoundingClientRect().width === 76`)
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
  await mouseClick(running.cdp, '.member-sidebar-actions button[aria-label="展开队员名册"]')
  await waitForExpression(running.cdp,
    `document.querySelector('.member-sidebar')?.getBoundingClientRect().width === 236`)
  await selectMember(running.cdp, '叮叮')
  await openMemberRuntimeTab(running.cdp)
  const removedSummarySettings = await evaluate(running.cdp, `({
    advancedSettings: Boolean(document.querySelector('.member-advanced-settings')),
    summarySettings: Boolean(document.querySelector('.summary-model-settings')),
    text: document.querySelector('#member-runtime-panel')?.textContent
  })`)
  assert(
    !removedSummarySettings.advancedSettings
      && !removedSummarySettings.summarySettings
      && !removedSummarySettings.text?.includes('对话压缩模型')
      && !removedSummarySettings.text?.includes('Camp 共享摘要模型'),
    `Removed summary settings are still visible: ${JSON.stringify(removedSummarySettings)}`
  )
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
  await replaceInputValue(running.cdp, '.member-dialog input', '芝士')
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
    (await request(running.cdp, 'members.get', { agentId: 'agent_1' })).displayName === '叮叮',
    'Escaping the identity dialog persisted an unsaved theme-switch draft'
  )
  await waitForExpression(running.cdp, `!document.querySelector('.app-toast')`, 5_000)

  Object.assign(captures, await captureThemeMatrix(
    running.cdp,
    'fresh-members',
    '叮叮',
    outputDir
  ))
  await mouseClick(running.cdp, '.unified-sidebar button[aria-label="设置"]')
  await waitForSelector(running.cdp, '.settings-sidebar-menu')
  await mouseClick(running.cdp, '.settings-sidebar-menu button', 'Agent 运行时', true)
  await waitForSelector(running.cdp, '.runtime-installations')
  const runtimeSettingsState = await evaluate(running.cdp, `(() => {
    const panel = document.querySelector('.runtime-installations')
    const productRows = panel?.querySelectorAll(
      ':scope > .runtime-product-list > .runtime-product-row'
    )
    const labels = [...(productRows ?? [])]
      .map((row) => row.querySelector('strong')?.textContent)
    const pendingRows = [...(productRows ?? [])]
      .filter((row) => row.textContent?.includes('待支持'))
    const advanced = panel?.querySelector('.runtime-advanced-diagnostics')
    return {
      rowCount: productRows?.length ?? 0,
      labels,
      pendingCount: pendingRows.length,
      pendingActionsDisabled: pendingRows.every(
        (row) => row.querySelector('button')?.disabled === true
      ),
      hasAdvancedDiagnostics: Boolean(advanced),
      explainsShell: panel?.textContent?.includes('交互式登录 Shell 初始化'),
      exposesMemberPathPicker: Boolean(
        panel?.querySelector(':scope > input, :scope > .path-field')
      )
    }
  })()`)
  assert(
    runtimeSettingsState.rowCount === 13
      && runtimeSettingsState.labels.includes('Codex CLI')
      && runtimeSettingsState.labels.includes('Antigravity')
      && runtimeSettingsState.labels.includes('TRAE CLI')
      && runtimeSettingsState.labels.includes('DeepSeek Harness')
      && runtimeSettingsState.pendingCount === 1
      && runtimeSettingsState.pendingActionsDisabled
      && !runtimeSettingsState.hasAdvancedDiagnostics
      && !runtimeSettingsState.explainsShell
      && !runtimeSettingsState.exposesMemberPathPicker,
    `Runtime settings did not preserve twelve managed products plus one pending preview: ${JSON.stringify(runtimeSettingsState)}`
  )
  await setViewport(running.cdp, 1040, 700)
  await setTheme(running.cdp, 'night')
  await assertNoHorizontalOverflow(running.cdp, 'Runtime settings at 1040×700 Night')
  captures.runtimeSettings = join(
    outputDir,
    'runtime-settings-twelve-products-one-preview-night-1040x700.png'
  )
  await capture(running.cdp, captures.runtimeSettings)
  const discoveredCodex = (await request(running.cdp, 'runtime.installations.list'))
    .find((installation) => installation.adapterKind === 'codex-cli'
      && installation.installationClass === 'managed_default'
      && installation.pathState === 'valid'
      && installation.snapshot?.executableFingerprint
      && installation.snapshot?.permissionSchemaDigest
      && installation.snapshot?.permissionOptions?.length > 0)
  const acceptanceRuntime = discoveredCodex
    ? {
        executablePath: discoveredCodex.executablePath,
        commandName: discoveredCodex.commandName,
        executableFingerprint: discoveredCodex.snapshot.executableFingerprint,
        permissionSchemaDigest: discoveredCodex.snapshot.permissionSchemaDigest,
        permissionOptions: discoveredCodex.snapshot.permissionOptions
      }
    : fallbackAcceptanceRuntime
  const fixtureMemberAgentIds = freshPreflight.presentMembers.map((member) => member.agentId)
  campTitle = 'Camp 生命周期验收'
  const createdQuickChatCamp = await request(running.cdp, 'camps.create', {
    commandId: randomUUID(),
    name: campTitle,
    workspace: null,
    memberAgentIds: fixtureMemberAgentIds,
    defaultLeadAgentId: freshPreflight.initialLeadAgentId,
    collaborationMode: 'peer',
    activationState: 'active'
  })
  campId = createdQuickChatCamp.payload?.campId
  assert(
    createdQuickChatCamp.status === 'applied' && campId,
    `Could not create lifecycle acceptance Camp through Core: ${JSON.stringify(createdQuickChatCamp)}`
  )
  projectCampTitle = '项目会话返回验收 · 一个用于确认成员名册单行截断的超长对话标题'
  projectCampPath = join(fixtureRoot, 'project-return')
  await mkdir(projectCampPath, { recursive: true })
  const createdProjectCamp = await request(running.cdp, 'camps.create', {
    commandId: randomUUID(),
    name: projectCampTitle,
    workspace: { projectPath: projectCampPath },
    memberAgentIds: fixtureMemberAgentIds,
    defaultLeadAgentId: freshPreflight.initialLeadAgentId,
    collaborationMode: 'peer',
    activationState: 'active'
  })
  projectCampId = createdProjectCamp.payload?.campId
  assert(
    createdProjectCamp.status === 'applied' && projectCampId,
    `Could not create project-return acceptance Camp through Core: ${JSON.stringify(createdProjectCamp)}`
  )
  membershipCampTitle = 'Camp 动态队员验收'
  const createdMembershipCamp = await request(running.cdp, 'camps.create', {
    commandId: randomUUID(),
    name: membershipCampTitle,
    workspace: null,
    memberAgentIds: ['agent_1'],
    defaultLeadAgentId: 'agent_1',
    collaborationMode: 'peer',
    activationState: 'active'
  })
  membershipCampId = createdMembershipCamp.payload?.campId
  assert(
    createdMembershipCamp.status === 'applied' && membershipCampId,
    `Could not create dynamic membership acceptance Camp: ${JSON.stringify(createdMembershipCamp)}`
  )
  await closeApp(running)
  running = null

  await installAcceptanceRuntime(
    join(freshDataDir, 'rovai.sqlite'),
    ['agent_1', 'agent_3', 'agent_4'],
    acceptanceRuntime
  )
  await seedCampFixtureContent(join(freshDataDir, 'rovai.sqlite'), campId)
  await seedCampFixtureContent(join(freshDataDir, 'rovai.sqlite'), projectCampId)
  running = await launchApp(freshDataDir, firstPort + 1, 1040, 700)
  const configuredPreflight = await request(running.cdp, 'camps.creationPreflight')
  assert(
    configuredPreflight.admissible
      && configuredPreflight.initialLeadAgentId === 'agent_1'
      && configuredPreflight.presentMembers.length === 4,
    `Configured Runtime did not select the first present Profile for a new Camp: ${JSON.stringify(configuredPreflight)}`
  )

  const membershipCandidate = freshProfiles.find((profile) => profile.agentId === 'agent_2')
  const membershipLead = freshProfiles.find((profile) => profile.agentId === 'agent_1')
  assert(membershipCandidate && membershipLead,
    `Dynamic membership fixture profiles are missing: ${JSON.stringify(freshProfiles)}`)
  await openCamp(running.cdp, membershipCampTitle)
  await mouseClick(running.cdp, '.activity-tabs [role="tab"]', '队员', true)
  await waitForExpression(running.cdp,
    `document.querySelector('.camp-members-panel')?.getAttribute('data-state') === 'active'`)

  const memberActionPresentation = await evaluate(running.cdp, `(() => {
    const trigger = document.querySelector(
      '.camp-member-action-button[aria-label=${JSON.stringify(`${membershipLead.displayName}的队员操作`)}]'
    )
    if (!(trigger instanceof HTMLElement)) return null
    const rect = trigger.getBoundingClientRect()
    const style = getComputedStyle(trigger)
    return {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      borderTopWidth: style.borderTopWidth,
      dotPositions: [...trigger.querySelectorAll('circle')]
        .map((circle) => circle.getAttribute('cx'))
        .join(',')
    }
  })()`)
  assert(
    memberActionPresentation?.width === 28
      && memberActionPresentation?.height === 28
      && memberActionPresentation?.borderTopWidth === '0px'
      && memberActionPresentation?.dotPositions === '3,8,13',
    `Member action trigger is unexpected: ${JSON.stringify(memberActionPresentation)}`
  )

  await focusElement(
    running.cdp,
    `.camp-member-action-button[aria-label=${JSON.stringify(`${membershipLead.displayName}的队员操作`)}]`
  )
  await pressKey(running.cdp, 'Enter')
  await waitForSelector(running.cdp, '.camp-member-menu')
  const lastMemberMenu = await evaluate(running.cdp, `(() => {
    const items = [...document.querySelectorAll('.camp-member-menu-item')]
    const model = items.find((item) => item.textContent?.includes('查看模型信息'))
    const remove = items.find((item) => item.textContent?.includes('移出当前会话'))
    return {
      modelEnabled: Boolean(model && !model.hasAttribute('data-disabled')),
      modelCopy: model?.textContent?.trim(),
      removeDisabled: Boolean(remove?.hasAttribute('data-disabled')),
      removeCopy: remove?.textContent?.trim()
    }
  })()`)
  assert(
    lastMemberMenu.modelEnabled
      && lastMemberMenu.modelCopy?.includes('Codex')
      && lastMemberMenu.modelCopy?.includes('可用')
      && lastMemberMenu.removeDisabled
      && lastMemberMenu.removeCopy?.includes('会话至少保留 1 位队员'),
    `Single-member overflow menu is unexpected: ${JSON.stringify(lastMemberMenu)}`
  )
  captures.campMembershipLastMemberMenu = join(
    outputDir,
    'camp-membership-last-member-menu-day-1040x700.png'
  )
  await capture(running.cdp, captures.campMembershipLastMemberMenu)
  await focusElement(running.cdp, '.camp-member-menu-item', '查看模型信息', true)
  await pressKey(running.cdp, 'Enter')
  await waitForExpression(running.cdp, `(() => {
    const detail = document.querySelector('.camp-inspector-runtime-detail')
    return detail?.textContent?.includes('Agent 运行时默认')
      && detail?.textContent?.includes('跟随 Agent 运行时默认')
      && detail?.getAttribute('aria-label') === ${JSON.stringify(`${membershipLead.displayName}的当前模型配置`)}
  })()`)

  await mouseClick(running.cdp, '.camp-add-member-button', '添加', true)
  await waitForSelector(running.cdp, '.camp-member-dialog')
  await waitForExpression(running.cdp,
    `document.activeElement === document.querySelector('.camp-member-search-field input')`)
  const addDialogState = await evaluate(running.cdp, `(() => ({
    title: document.querySelector('.camp-member-dialog h2')?.textContent?.trim(),
    candidateCount: document.querySelectorAll('.camp-member-candidate-row').length,
    hasRejoinCopy: /重新加入|已离开成员/.test(document.querySelector('.camp-member-dialog')?.textContent ?? '')
  }))()`)
  assert(
    addDialogState.title === '添加队员'
      && addDialogState.candidateCount === 3
      && !addDialogState.hasRejoinCopy,
    `Add-member dialog is unexpected: ${JSON.stringify(addDialogState)}`
  )
  await selectCampMemberCandidate(running.cdp, membershipCandidate.displayName)
  await evaluate(running.cdp,
    `document.querySelector('.camp-member-dialog .primary-button')?.click()`)
  try {
    await waitForExpression(running.cdp,
      `document.querySelectorAll('.camp-inspector-member-row').length === 2
        && !document.querySelector('.camp-member-dialog')`, 30_000)
  } catch (error) {
    const addFailureState = await evaluate(running.cdp, `(() => ({
      rows: document.querySelectorAll('.camp-inspector-member-row').length,
      checked: [...document.querySelectorAll('.camp-member-candidate-row input')]
        .filter((input) => input.checked).length,
      buttonText: document.querySelector('.camp-member-dialog .primary-button')?.textContent?.trim(),
      buttonDisabled: document.querySelector('.camp-member-dialog .primary-button')?.disabled,
      alert: document.querySelector('.camp-member-dialog-alert')?.textContent?.trim(),
      candidateError: document.querySelector('.camp-member-candidate-error')?.textContent?.trim()
    }))()`)
    throw new Error(`Add-member submission did not settle: ${JSON.stringify(addFailureState)}`, {
      cause: error
    })
  }
  await waitForText(running.cdp, '.app-toast', '已添加 1 位队员')

  await focusElement(
    running.cdp,
    `.camp-member-action-button[aria-label=${JSON.stringify(`${membershipCandidate.displayName}的队员操作`)}]`
  )
  await pressKey(running.cdp, 'Enter')
  await waitForSelector(running.cdp, '.camp-member-menu')
  const removalEnabled = await evaluate(running.cdp, `(() => {
    const item = [...document.querySelectorAll('.camp-member-menu-item')]
      .find((candidate) => candidate.textContent?.includes('移出当前会话'))
    return Boolean(item && !item.hasAttribute('data-disabled'))
  })()`)
  assert(removalEnabled, 'A non-final member could not be removed from the overflow menu')
  await pressKey(running.cdp, 'ArrowDown')
  await waitForExpression(running.cdp,
    `document.activeElement?.textContent?.includes('移出当前会话') === true`)
  await mouseClick(running.cdp, '.camp-member-menu-item', '移出当前会话', true)
  await waitForSelector(running.cdp, '.camp-member-removal-dialog')
  await waitForExpression(running.cdp,
    `Boolean(document.querySelector('.camp-member-removal-dialog .danger-button:not(:disabled)'))`,
    30_000)
  const removalPreview = await evaluate(running.cdp, `(() => {
    const dialog = document.querySelector('.camp-member-removal-dialog')
    return {
      title: dialog?.querySelector('h2')?.textContent?.trim(),
      description: dialog?.querySelector('.app-dialog-description')?.textContent?.trim(),
      hasBody: Boolean(dialog?.querySelector('.app-dialog-body')),
      hasImpactList: Boolean(dialog?.querySelector('.app-dialog-impact-list')),
      hasPlaceholderImpactCopy: /没有需要收拢|没有需要释放|没有待结算/.test(dialog?.textContent ?? ''),
      keepsHistory: dialog?.textContent?.includes('历史消息、执行证据与审计记录不会删除'),
      immediateFence: dialog?.textContent?.includes('立即阻止该队员的新消息与工具写入')
    }
  })()`)
  assert(
    removalPreview.title === `移出${membershipCandidate.displayName}？`
      && removalPreview.description?.includes(`${membershipCandidate.displayName}将不再接收这里的新工作`)
      && !removalPreview.hasBody
      && !removalPreview.hasImpactList
      && !removalPreview.hasPlaceholderImpactCopy
      && !removalPreview.keepsHistory
      && removalPreview.immediateFence,
    `Removal preview is unexpected: ${JSON.stringify(removalPreview)}`
  )
  await setTheme(running.cdp, 'night')
  await assertNoHorizontalOverflow(running.cdp, 'Dynamic membership removal at 1040×700 Night')
  captures.campMembershipRemoval = join(
    outputDir,
    'camp-membership-removal-night-1040x700.png'
  )
  await capture(running.cdp, captures.campMembershipRemoval)
  await mouseClick(running.cdp, '.camp-member-removal-dialog .danger-button', '移出当前会话')
  await waitForExpression(running.cdp,
    `document.querySelectorAll('.camp-inspector-member-row').length === 1
      && !document.querySelector('.camp-member-removal-dialog')`, 30_000)
  await waitForText(running.cdp, '.app-toast', `已将${membershipCandidate.displayName}移出当前会话`)

  await mouseClick(running.cdp, '.camp-add-member-button', '添加', true)
  await waitForSelector(running.cdp, '.camp-member-dialog')
  const ordinaryAddCopy = await evaluate(running.cdp,
    `document.querySelector('.camp-member-dialog')?.textContent ?? ''`)
  assert(
    ordinaryAddCopy.includes(membershipCandidate.displayName)
      && !/重新加入|恢复旧工作|已离开成员/.test(ordinaryAddCopy),
    `A previous membership was exposed as a product-level rejoin: ${ordinaryAddCopy}`
  )
  await selectCampMemberCandidate(running.cdp, membershipCandidate.displayName)
  await mouseClick(running.cdp, '.camp-member-dialog .primary-button', '添加队员', true)
  await waitForExpression(running.cdp,
    `document.querySelectorAll('.camp-inspector-member-row').length === 2
      && !document.querySelector('.camp-member-dialog')`, 30_000)
  await waitForText(running.cdp, '.app-toast', '已添加 1 位队员')
  const membershipSnapshot = await request(running.cdp, 'camps.snapshot', {
    campId: membershipCampId
  })
  assert(
    membershipSnapshot.membershipReconciliations.length === 0
      && membershipSnapshot.camp.membershipGeneration === 4
      && membershipSnapshot.members.find((member) => member.agentId === 'agent_2')?.version === 3,
    `Dynamic membership revisions did not remain monotonic: ${JSON.stringify(membershipSnapshot.camp)}`
  )
  await setTheme(running.cdp, 'day')

  await openMembers(running.cdp)
  await selectMember(running.cdp, '咕咕')
  await openMemberRuntimeTab(running.cdp)
  const runtimeBeforeDraft = await request(running.cdp, 'members.get', {
    agentId: 'agent_3'
  })
  const runtimeParametersState = await evaluate(running.cdp, `(() => {
    const parameters = document.querySelector('.member-runtime-parameters')
    const style = parameters ? getComputedStyle(parameters) : null
    const summary = document.querySelector('.runtime-installation-summary')
    const summaryStyle = summary ? getComputedStyle(summary) : null
    return {
      tagName: parameters?.tagName,
      visible: Boolean(parameters && parameters.getBoundingClientRect().height > 0),
      bodyVisible: Boolean(parameters?.querySelector('.member-runtime-parameters-body')
        ?.getBoundingClientRect().height > 0),
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
      && runtimeParametersState.bodyVisible
      && runtimeParametersState.background === 'rgba(0, 0, 0, 0)'
      && runtimeParametersState.leftBorder === '0px'
      && runtimeParametersState.rightBorder === '0px'
      && runtimeParametersState.bottomBorder === '0px'
      && runtimeParametersState.topBorder === '1px'
      && runtimeParametersState.summaryBackground === 'rgba(0, 0, 0, 0)'
      && runtimeParametersState.summaryBorderWidth === '0px'
      && !runtimeParametersState.exposesInstallation,
    `Member Runtime parameters were not directly visible with an inline status: ${JSON.stringify(runtimeParametersState)}`
  )
  await waitForText(running.cdp, '.member-runtime-parameters', '模型策略')
  await selectFieldValue(
    running.cdp,
    '.member-runtime-section',
    'Agent 运行时',
    'qoder-cli'
  )
  await waitForExpression(running.cdp, `(() => {
    const text = document.querySelector('.member-runtime-parameters')?.textContent ?? ''
    return text.includes('当前还没有可编辑的能力快照') || text.includes('模型策略')
  })()`)
  await selectFieldValue(
    running.cdp,
    '.member-runtime-section',
    'Agent 运行时',
    'codex-cli'
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
    JSON.stringify(runtimeActionLabels) === JSON.stringify(['放弃更改', '保存运行配置']),
    `Runtime actions did not expose discard and save: ${JSON.stringify(runtimeActionLabels)}`
  )
  await selectRuntimeModel(running.cdp, 'Lifecycle Acceptance Runtime')
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
  const runtimeControlGeometry = await evaluate(running.cdp, `(() => {
    const controls = [...document.querySelectorAll(
      '.member-runtime-parameters .runtime-model-picker-trigger, '
        + '.member-runtime-parameters .field-label > select, '
        + '.member-runtime-parameters .runtime-parameter-switch'
    )]
    const fields = [...document.querySelectorAll(
      '.member-runtime-parameters .runtime-parameter-form > .field-label'
    )]
    const form = document.querySelector('.member-runtime-parameters .runtime-parameter-form')
    const formStyle = form ? getComputedStyle(form) : null
    return {
      heights: controls.map((control) => control.getBoundingClientRect().height),
      fieldMargins: fields.map((field) => getComputedStyle(field).marginTop),
      rowGap: formStyle?.rowGap,
      columnGap: formStyle?.columnGap
    }
  })()`)
  assert(
    runtimeControlGeometry.heights.length === 4
      && runtimeControlGeometry.heights.every((height) => Math.abs(height - 44) <= 0.5)
      && runtimeControlGeometry.fieldMargins.every((margin) => margin === '0px')
      && runtimeControlGeometry.rowGap === '14px'
      && runtimeControlGeometry.columnGap === '14px',
    `Member Runtime controls are not aligned to the 44px field contract: ${JSON.stringify(runtimeControlGeometry)}`
  )
  await mouseClick(running.cdp, '.unified-sidebar button[aria-label="记忆"]')
  await waitForSelector(running.cdp, '.member-leave-dialog')
  await waitForExpression(running.cdp,
    `Boolean(document.querySelector('.member-leave-dialog'))
      && Boolean(document.querySelector('.members-view'))`)
  await focusElement(running.cdp, '.member-leave-dialog button', '继续编辑')
  await pressKey(running.cdp, 'Enter')
  await waitForExpression(running.cdp,
    `!document.querySelector('.member-leave-dialog')
      && document.querySelector('.member-detail-heading h1')?.textContent === '咕咕'`)
  assert(
    (await runtimeParameterValues(running.cdp)).modelMode === 'explicit',
    'Continuing a dirty Runtime edit lost the current member draft'
  )
  captures.memberRuntimeParameters = join(
    outputDir,
    'member-runtime-parameters-day-1040x700.png'
  )
  await capture(running.cdp, captures.memberRuntimeParameters)
  await mouseClick(running.cdp, '.member-form-actions button', '保存运行配置')
  await waitForText(running.cdp, '.app-toast', 'Codex CLI 已保存。')
  const configuredRuntime = await waitForProfile(
    running.cdp,
    'agent_3',
    (profile) => profile.version > runtimeBeforeDraft.version
      && profile.runtimeReadiness.status === 'ready'
  )
  assert(
    configuredRuntime.runtimeConfiguration?.model.mode === 'explicit'
      && configuredRuntime.runtimeConfiguration.model.modelId === 'gpt-lifecycle-accept'
      && configuredRuntime.runtimeConfiguration.model.options.reasoning_effort === 'high'
      && configuredRuntime.runtimeConfiguration.permissions.values.sandbox_mode
        === 'danger-full-access'
      && configuredRuntime.runtimeConfiguration.permissions.values.approval_policy === 'never',
    `Member Runtime configuration was not saved atomically: ${JSON.stringify(configuredRuntime.runtimeConfiguration)}`
  )
  await waitForExpression(running.cdp, `(() => {
    const section = document.querySelector('.member-runtime-section')
    const save = [...(section?.querySelectorAll('.member-form-actions button') ?? [])]
      .find((button) => button.textContent?.trim() === '保存运行配置')
    return section?.querySelector('.field-label select')?.disabled === false
      && save?.disabled === true
      && section?.querySelector('.member-runtime-save-state')?.textContent?.trim()
        === '当前配置已保存'
      && !section?.querySelector('.member-runtime-conflict')
      && !section?.querySelector('.inline-error')
  })()`)
  await selectFieldValue(
    running.cdp,
    '.member-runtime-parameters',
    '审批策略',
    'on-request'
  )
  await mouseClick(running.cdp, '.member-sidebar-select', '叮叮', true)
  await waitForSelector(running.cdp, '.member-leave-dialog')
  await focusElement(running.cdp, '.member-leave-dialog button', '放弃更改')
  await pressKey(running.cdp, 'Enter')
  await waitForExpression(running.cdp,
    `!document.querySelector('.member-leave-dialog')
      && document.querySelector('.member-detail-heading h1')?.textContent === '叮叮'`)
  await selectMember(running.cdp, '咕咕')
  await openMemberRuntimeTab(running.cdp)
  await waitForText(running.cdp, '.member-runtime-parameters', '审批策略')
  assert(
    (await runtimeParameterValues(running.cdp)).approvalPolicy === 'never',
    'Discarding a dirty Runtime edit changed the persisted configuration'
  )
  await selectFieldValue(
    running.cdp,
    '.member-runtime-section',
    'Agent 运行时',
    ''
  )
  await mouseClick(running.cdp, '.member-form-actions button', '保存运行配置')
  await waitForText(running.cdp, '.app-toast', 'Agent 运行时已清除。')
  await waitForProfile(running.cdp, 'agent_3',
    (profile) => profile.presence === 'present'
      && profile.runtimeConfiguration === null
      && profile.runtimeConfiguration === null)

  await openCamp(running.cdp, campTitle)
  await waitForSelector(running.cdp, '.conversation-bubble.user .message-copy-button')
  const campColorState = await evaluate(running.cdp, `(() => {
    const color = (selector, property) => {
      const node = document.querySelector(selector)
      return node ? getComputedStyle(node)[property] : null
    }
    return {
      theme: document.documentElement.dataset.theme,
      conversation: color('.timeline-pane', 'backgroundColor'),
      controls: color('.conversation-controls', 'backgroundColor'),
      inspector: color('.activity-pane', 'backgroundColor'),
      divider: color('.activity-pane', 'borderLeftColor'),
      rail: color('.unified-sidebar', 'backgroundColor'),
      userMessage: color('.conversation-bubble.user .message-bubble', 'backgroundColor')
    }
  })()`)
  const expectedCampColors = campColorState.theme === 'night'
    ? {
        conversation: 'rgb(24, 29, 33)',
        controls: 'rgb(24, 29, 33)',
        inspector: 'rgb(23, 29, 33)',
        divider: 'rgb(83, 97, 107)',
        rail: 'rgb(17, 22, 26)'
      }
    : {
        conversation: 'rgb(255, 255, 255)',
        controls: 'rgb(255, 255, 255)',
        inspector: 'rgb(255, 255, 255)',
        divider: 'rgb(199, 207, 214)',
        rail: 'rgb(243, 244, 244)'
      }
  assert(
    campColorState.conversation === expectedCampColors.conversation
      && campColorState.controls === expectedCampColors.controls
      && campColorState.inspector === expectedCampColors.inspector
      && campColorState.divider === expectedCampColors.divider
      && campColorState.rail === expectedCampColors.rail
      && campColorState.userMessage === 'rgba(0, 0, 0, 0)',
    `Camp color scope drifted: ${JSON.stringify(campColorState)}`
  )
  const userMessageCopyState = await evaluate(running.cdp, `(() => {
    const article = document.querySelector('.conversation-bubble.user')
    const body = article?.querySelector('.message-body')
    const button = article?.querySelector('.message-copy-button')
    const bodyRect = body?.getBoundingClientRect()
    const buttonRect = button?.getBoundingClientRect()
    return {
      selectable: article ? getComputedStyle(article).userSelect === 'text' : false,
      label: button?.getAttribute('aria-label'),
      insideContent: Boolean(article?.querySelector('.message-surface > .message-copy-button')),
      absentFromMetadata: !article?.querySelector('.bubble-meta .message-copy-button'),
      top: button ? getComputedStyle(button).top : null,
      right: button ? getComputedStyle(button).right : null,
      topOffset: bodyRect && buttonRect ? buttonRect.top - bodyRect.top : null,
      rightOffset: bodyRect && buttonRect ? bodyRect.right - buttonRect.right : null
    }
  })()`)
  assert(
    userMessageCopyState.selectable
      && userMessageCopyState.label === '复制这条消息'
      && userMessageCopyState.insideContent
      && userMessageCopyState.absentFromMetadata
      && userMessageCopyState.top === '-2px'
      && userMessageCopyState.right === '0px'
      && Math.abs(userMessageCopyState.rightOffset) <= 0.75,
    `User message is not selectable/copyable: ${JSON.stringify(userMessageCopyState)}`
  )
  await mouseClick(running.cdp, '.conversation-bubble.user .message-copy-button')
  let snapshot = await request(running.cdp, 'camps.snapshot', { campId })
  assert(
    snapshot.camp.defaultLeadAgentId === 'agent_1'
      && snapshot.members.length === 4,
    `Fresh Camp did not include every present member with 叮叮 as Lead: ${JSON.stringify(snapshot.camp)}`
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
      && mentionMenuState.options.some((option) => option?.includes('叮叮')),
    `Camp @ mention menu is clipped or incomplete: ${JSON.stringify(mentionMenuState)}`
  )
  captures.campMentionMenu = join(outputDir, 'camp-mention-menu-day-1440x920.png')
  await capture(running.cdp, captures.campMentionMenu)
  const selectedMention = await evaluate(running.cdp, `(() => {
    const option = [...document.querySelectorAll('.structured-mention-menu [role="option"]')]
      .find((candidate) => candidate.querySelector('strong')?.textContent?.trim() === '叮叮')
    option?.click()
    return Boolean(option)
  })()`)
  assert(selectedMention, 'Could not select 叮叮 from the Camp mention menu')
  await waitForExpression(running.cdp,
    `(() => {
      const editor = document.querySelector('#camp-message')
      const token = editor?.querySelector(
        '.structured-mention-token.member-mention[data-agent-id="agent_1"]'
      )
      return editor?.textContent?.includes('@叮叮')
        && token?.textContent?.includes('叮叮')
        && token?.getAttribute('contenteditable') === 'false'
        && !document.querySelector('.structured-mention-menu')
    })()`
  )
  await replaceContenteditableText(running.cdp, '#camp-message', '')

  await openMembers(running.cdp)
  const quickChatRosterState = await evaluate(running.cdp, `({
    hasReturnControl: Boolean(document.querySelector('.member-context-return')),
    hasProjectNavigation: Boolean(document.querySelector('.navigation-projects')),
    rosterWidth: document.querySelector('.member-sidebar')?.getBoundingClientRect().width,
    selectedMember: document.querySelector('.member-detail-heading h1')?.textContent
  })`)
  assert(
    !quickChatRosterState.hasReturnControl
      && quickChatRosterState.hasProjectNavigation
      && quickChatRosterState.rosterWidth === 236,
    `Member content roster did not coexist with global navigation: ${JSON.stringify(quickChatRosterState)}`
  )
  await evaluate(running.cdp,
    `document.querySelector('.unified-sidebar button[aria-label="设置"]')?.click()`)
  await waitForSelector(running.cdp, '.settings-sidebar-menu', 30_000)
  await mouseClick(running.cdp, '.settings-sidebar-back', '返回 App', true)
  await waitForSelector(running.cdp, '.members-view', 30_000)
  await waitForText(running.cdp, '.member-detail-heading h1', quickChatRosterState.selectedMember)
  captures.memberContentRoster = join(
    outputDir,
    'member-content-roster-day-1440x920.png'
  )
  await capture(running.cdp, captures.memberContentRoster)
  await openCamp(running.cdp, campTitle)
  await openMembers(running.cdp)
  await selectMember(running.cdp, '小兔')
  const qiluBeforeRemoval = await request(running.cdp, 'members.get', {
    agentId: 'agent_4'
  })
  assert(
    qiluBeforeRemoval.runtimeConfiguration?.adapterKind === 'codex-cli'
      && qiluBeforeRemoval.runtimeConfiguration !== null,
    'Removal retention fixture did not configure a Runtime for 小兔'
  )
  await openMemberMenuAction(running.cdp, '永久移除队员')
  await waitForSelector(running.cdp, '.dialog-content')
  await waitForExpression(running.cdp,
    `document.activeElement === document.querySelector('.dialog-content input')`)
  await running.cdp.send('Input.insertText', { text: '小兔' })
  await waitForExpression(running.cdp,
    `Boolean([...document.querySelectorAll('.dialog-content button')]
      .find((button) => button.textContent?.trim() === '永久移除队员' && !button.disabled))`)
  await mouseClick(running.cdp, '.dialog-content button', '永久移除队员')
  await waitForExpression(running.cdp, `!document.querySelector('.dialog-content')`, 30_000)
  await waitForExpression(running.cdp, `![...document.querySelectorAll('.member-sidebar-copy strong')]
    .some((node) => node.textContent === '小兔')`)
  const qiluAfterRemoval = await historicalProfile(
    join(freshDataDir, 'rovai.sqlite'),
    'agent_4'
  )
  const activeAfterRemoval = await request(running.cdp, 'members.list')
  assert(
    qiluAfterRemoval.presence === 'removed'
      && qiluAfterRemoval.removedAt
      && qiluAfterRemoval.displayName === qiluBeforeRemoval.displayName
      && qiluAfterRemoval.teamRole === qiluBeforeRemoval.teamRole
      && qiluAfterRemoval.avatarRef === qiluBeforeRemoval.avatarRef
      && qiluAfterRemoval.runtimeInstallationId
      && qiluAfterRemoval.selectedRuntimeAdapterKind
        === qiluBeforeRemoval.runtimeConfiguration.adapterKind
      && !activeAfterRemoval.some((profile) => profile.agentId === 'agent_4'),
    `Permanent removal did not retain identity/Runtime or hide the active Profile: ${JSON.stringify(qiluAfterRemoval)}`
  )
  snapshot = await request(running.cdp, 'camps.snapshot', { campId })
  const historicQilu = snapshot.members.find((member) => member.agentId === 'agent_4')
  assert(
    historicQilu?.profilePresence === 'removed'
      && historicQilu.displayName === qiluBeforeRemoval.displayName
      && historicQilu.avatarRef === qiluBeforeRemoval.avatarRef,
    `Historical Camp identity did not retain the removed member: ${JSON.stringify(historicQilu)}`
  )

  for (const agentId of ['agent_1', 'agent_2', 'agent_3']) {
    await setPresence(running.cdp, agentId, 'away')
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
    snapshot.members.find((member) => member.agentId === 'agent_2')
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
  await openCamp(running.cdp, projectCampTitle)
  await openMembers(running.cdp)
  const projectNavigationState = await evaluate(running.cdp, `(() => {
    const button = [...document.querySelectorAll('.camp-nav-open')]
      .find((candidate) => candidate.getAttribute('title')?.startsWith(${JSON.stringify(projectCampTitle)}))
    const title = button?.querySelector('.truncate')
    const titleStyle = title ? getComputedStyle(title) : null
    return {
      hasReturnControl: Boolean(document.querySelector('.member-context-return')),
      title: title?.textContent,
      titleOverflows: Boolean(title && title.scrollWidth > title.clientWidth),
      titleOverflow: titleStyle?.overflow,
      titleTextOverflow: titleStyle?.textOverflow,
      titleWhiteSpace: titleStyle?.whiteSpace
    }
  })()`)
  assert(
    !projectNavigationState.hasReturnControl
      && projectNavigationState.title === projectCampTitle
      && projectNavigationState.titleOverflows
      && projectNavigationState.titleOverflow === 'hidden'
      && projectNavigationState.titleTextOverflow === 'ellipsis'
      && projectNavigationState.titleWhiteSpace === 'nowrap',
    `Directory Camp was not preserved in global navigation: ${JSON.stringify(projectNavigationState)}`
  )
  await assertNoHorizontalOverflow(running.cdp, 'Member workspace with a long directory Camp title')
  captures.memberProjectNavigation = join(
    outputDir,
    'member-project-navigation-day-1440x920.png'
  )
  await capture(running.cdp, captures.memberProjectNavigation)
  await openCamp(running.cdp, projectCampTitle)
  const projectSnapshot = await request(running.cdp, 'camps.snapshot', {
    campId: projectCampId
  })
  await openMembers(running.cdp)
  const deletedProjectCamp = await request(running.cdp, 'camps.delete', {
    commandId: crypto.randomUUID(),
    command: {
      campId: projectCampId,
      expectedVersion: projectSnapshot.camp.version
    }
  })
  assert(
    deletedProjectCamp.status === 'applied',
    `Could not delete the project Camp fixture: ${JSON.stringify(deletedProjectCamp)}`
  )
  await openCamp(running.cdp, campTitle)
  await closeApp(running)
  running = null

  running = await launchApp(freshDataDir, firstPort + 2, 1440, 920)
  await openCamp(running.cdp, campTitle)
  snapshot = await request(running.cdp, 'camps.snapshot', { campId })
  assert(
    snapshot.camp.defaultLeadAgentId === 'agent_2'
      && !((await request(running.cdp, 'members.list'))
        .some((profile) => profile.agentId === 'agent_4'))
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
  const upgradedProfiles = await request(running.cdp, 'members.list')
  const upgradedById = new Map(upgradedProfiles.map((profile) => [profile.agentId, profile]))
  assert(
    upgradedById.get('agent_1')?.presence === 'present'
      && upgradedById.get('agent_2')?.presence === 'away'
      && upgradedById.get('agent_3')?.presence === 'present'
      && upgradedById.get('agent_4')?.presence === 'away'
      && upgradedById.get('agent_1')?.displayName === '升级小狐狸'
      && upgradedById.get('agent_1')?.runtimeConfiguration === null
      && upgradedById.get('agent_4')?.runtimeConfiguration === null
      && upgradedById.get('agent_1')?.runtimeConfiguration === null
      && upgradedById.get('agent_4')?.runtimeConfiguration === null,
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
  const restartedUpgrade = await request(running.cdp, 'members.list')
  assert(
    restartedUpgrade.find((profile) => profile.agentId === 'agent_1')?.presence === 'present'
      && restartedUpgrade.find((profile) => profile.agentId === 'agent_2')?.presence === 'away'
      && restartedUpgrade.find((profile) => profile.agentId === 'agent_4')?.presence === 'away'
      && restartedUpgrade.find((profile) => profile.agentId === 'agent_1')?.displayName === '升级小狐狸',
    `v0.14 migration state did not survive restart: ${JSON.stringify(restartedUpgrade)}`
  )

  const report = {
    ok: true,
    app: basename(appPath),
    fixtureRoot,
    outputDir,
    reportPath: join(outputDir, 'member-lifecycle-acceptance.json'),
    verified: {
      freshSchemaV41: true,
      freshSchemaV110DynamicCampMembership: true,
      v14MemberRuntimeResetOnSchemaV41: true,
      mentionComposerUsesMemberName: true,
      contextSettingsDestinationRemoved: true,
      contentMemberRosterAndTabs: true,
      globalNavigationPreservedOnMembers: true,
      dedicatedMemberReturnRemoved: true,
      rosterExpanded236Collapsed76: true,
      compactRuntimeShortcutSymbols: true,
      settingsRoundTripPreservesMemberSelection: true,
      longCampTitleEllipsisInGlobalNavigation: true,
      sharedFullWidthWindowDragStrip: true,
      campComposerMentionMenuVisibleAndKeyboardSelectable: true,
      inlineHeaderStatusAndRuntimeArrow: true,
      manualMemberTabsArrowHomeEndKeyboard: true,
      memoryTrackSwitchLocalSaveAndReducerRollback: true,
      clickableMemberPortraitAndSymmetricIdentitySpacing: true,
      memberPortraitResponsive1120_820_640NoOverflow: true,
      memberOrderDedicatedModeKeyboardRoundTrip: true,
      effective200PercentZoomReducedMotionAndForcedColors: true,
      summaryModelAdvancedSettingsRemoved: true,
      memberHandlesHiddenAndDuplicateNameBlocked: true,
      campThemeSurfacesStrongDividerAndPreservedRailMessageColors: true,
      userMessageSelectableAndCopyEntry: true,
      freshNoRuntimeComposerToastAndDraft: true,
      leaveByMouseAndRejoinByKeyboard: true,
      themeSwitchPreservesDialogDraftAndFocus: true,
      radixEscapeAndFocusReturn: true,
      runtimeClearDoesNotChangePresence: true,
      memberRuntimeParametersExpandedDiscardSaveAndAtomicClear: true,
      dirtyRuntimeGuardContinueAndDiscard: true,
      removalRetainsIdentityAvatarRuntimeAndHistory: true,
      removedHiddenFromActiveRoster: true,
      noSuccessorLeadNullComposerToastAndDraft: true,
      memberOrderLeadInheritance: 'agent_2',
      restartPersistence: true,
      dayAndNightWideCompactMatrix: true,
      runtimeSettingsTwelveProductsAndPendingPreviewBoundary: true,
      campLastMemberRemovalVisibleAndDisabled: true,
      campRuntimeDetailsExpandableFromOverflowMenu: true,
      campAddRemoveAndOrdinaryReadd: true,
      campMemberActionUsesFramelessHorizontalOverflow: true,
      campRemovalPreviewShowsOnlyActualImpact: true,
      campMembershipGenerationAndLifetimeMonotonic: true,
      horizontalOverflow: false
    },
    captures
  }
  await writeFile(report.reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
} finally {
  if (running) await closeApp(running).catch(() => undefined)
}

async function captureThemeMatrix(cdp, prefix, selectedName, directory) {
  const result = {}
  for (const [width, height] of [[1440, 920], [1040, 700]]) {
    for (const theme of ['day', 'night']) {
      await setViewport(cdp, width, height)
      await setTheme(cdp, theme)
      // Startup route restoration can land after the first renderer paint for an
      // upgraded profile. Re-open the workbench before each visual capture so the
      // matrix measures the requested surface instead of that transient route.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (!await evaluate(cdp, `Boolean(document.querySelector('.members-view'))`)) {
          await openMembers(cdp)
        }
        if (!await evaluate(cdp,
          `document.querySelector('.member-detail-heading h1')?.textContent === ${JSON.stringify(selectedName)}`)) {
          await selectMember(cdp, selectedName)
        }
        await wait(500)
        if (await evaluate(cdp,
          `document.querySelector('.member-detail-heading h1')?.textContent === ${JSON.stringify(selectedName)}`)) {
          break
        }
      }
      await waitForExpression(cdp,
        `document.querySelector('.member-detail-heading h1')?.textContent === ${JSON.stringify(selectedName)}`)
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

async function installAcceptanceRuntime(
  databasePath,
  agentIds,
  runtimeIdentity = fallbackAcceptanceRuntime
) {
  const modelCatalog = sqlLiteral(acceptanceModelCatalog)
  const permissionOptions = sqlLiteral(JSON.stringify(runtimeIdentity.permissionOptions))
  const executablePath = sqlLiteral(runtimeIdentity.executablePath)
  const commandName = sqlLiteral(runtimeIdentity.commandName)
  const executableFingerprint = sqlLiteral(runtimeIdentity.executableFingerprint)
  const permissionSchemaDigest = sqlLiteral(runtimeIdentity.permissionSchemaDigest)
  const observedAt = sqlLiteral(new Date().toISOString())
  const ids = agentIds.map(sqlLiteral).join(', ')
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
      'adapter-lifecycle-accept', 'codex-cli', ${executablePath},
      ${commandName}, 'managed_default', 'known_location', 'default', 1,
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
      'adapter-lifecycle-accept', 'acceptance', ${executableFingerprint},
      'authenticated', 'ready', 1, ${permissionSchemaDigest}, '[]', '[]',
      ${modelCatalog}, ${permissionOptions},
      ${observedAt}, ${observedAt}, ${observedAt}, NULL, NULL,
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

function canonicalJsonDigest(value) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalizeJson(value)))
    .digest('hex')
}

function canonicalizeJson(value) {
  if (Array.isArray(value)) return value.map(canonicalizeJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonicalizeJson(entry)])
  )
}

async function seedCampFixtureContent(databasePath, id) {
  const conversationPrefix = `${id}-conversation-`
  const messageId = `${id}-message-user`
  await runSql(databasePath, `
    UPDATE camp
    SET last_message_sequence = 1, updated_at = datetime('now')
    WHERE id = ${sqlLiteral(id)};
    INSERT INTO conversation(
      id, camp_id, agent_id, version, created_at, updated_at
    )
    SELECT ${sqlLiteral(conversationPrefix)} || handle, ${sqlLiteral(id)}, id,
           1, datetime('now'), datetime('now')
    FROM agent_profile
    WHERE id IN ('agent_1', 'agent_2', 'agent_3', 'agent_4');
    INSERT INTO camp_message(
      id, camp_id, sequence, author_type, author_id, body,
      structured_content_json, address_mode,
      addressed_agent_ids_json, version, created_at, updated_at
    ) VALUES (
      ${sqlLiteral(messageId)}, ${sqlLiteral(id)}, 1, 'user', 'local_user',
      '@luoke 验证用户消息复制',
      '[{"kind":"text","text":"@luoke 验证用户消息复制"}]',
      'explicit', '["agent_1"]',
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

async function setPresence(cdp, agentId, presence) {
  const profile = await request(cdp, 'members.get', { agentId })
  const result = await request(cdp, 'members.presence.set', {
    commandId: crypto.randomUUID(),
    command: {
      agentId,
      expectedVersion: profile.version,
      presence
    }
  })
  assert(result.status === 'applied',
    `Could not set ${agentId} Presence to ${presence}: ${JSON.stringify(result)}`)
}

async function waitForProfile(cdp, agentId, predicate, timeoutMs = 30_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const profile = await request(cdp, 'members.get', { agentId })
    if (predicate(profile)) return profile
    await wait(100)
  }
  throw new Error(`AgentProfile ${agentId} did not reach the expected state`)
}

async function waitForAgentOrder(cdp, expectedIds, timeoutMs = 30_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const ids = (await request(cdp, 'members.list')).map((profile) => profile.agentId)
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
    await replaceInputValue(cdp, '.command-palette-input', title)
    await waitForExpression(cdp, `(() => {
      const items = [...document.querySelectorAll('.command-palette-item')]
      return items.length === 1
        && items[0].textContent?.includes(${JSON.stringify(title)})
    })()`)
    await focusElement(cdp, '.command-palette-input')
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
    `document.querySelector('.member-detail-heading h1')?.textContent === ${JSON.stringify(displayName)}`)
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
    const modelField = fields
      .find((field) => field.childNodes[0]?.textContent?.trim() === '模型策略')
    const modelLabel = modelField
      ?.querySelector('.runtime-model-picker-trigger strong')?.textContent?.trim()
    const value = (label) => fields
      .find((field) => field.childNodes[0]?.textContent?.trim() === label)
      ?.querySelector('select')?.value
    return {
      modelMode: modelLabel === '跟随 Agent 运行时默认'
        ? 'runtime_default'
        : modelLabel ? 'explicit' : undefined,
      modelLabel,
      sandboxMode: value('文件系统访问'),
      approvalPolicy: value('审批策略')
    }
  })()`)
}

async function selectRuntimeModel(cdp, label) {
  await focusElement(cdp, '.runtime-model-picker-trigger')
  await pressKey(cdp, 'Enter')
  await waitForSelector(cdp, '.runtime-model-picker-menu')
  await focusElement(cdp, '.runtime-model-picker-item[role="menuitemradio"]', label, true)
  await pressKey(cdp, 'Enter')
  await waitForExpression(cdp, `(() => {
    const trigger = document.querySelector('.runtime-model-picker-trigger')
    return trigger?.querySelector('strong')?.textContent?.trim() === ${JSON.stringify(label)}
      && !document.querySelector('.runtime-model-picker-menu')
      && document.activeElement === trigger
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

async function selectCampMemberCandidate(cdp, displayName) {
  const selected = await evaluate(cdp, `(() => {
    const row = [...document.querySelectorAll('.camp-member-candidate-row')]
      .find((candidate) => candidate.textContent?.includes(${JSON.stringify(displayName)}))
    const input = row?.querySelector('input[type="checkbox"]')
    if (!input || input.disabled) return false
    if (!input.checked) input.click()
    return input.checked
  })()`)
  assert(selected, `Could not select Camp member candidate ${displayName}`)
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
  const code = key === 'a' ? 'KeyA' : key === ' ' ? 'Space' : key
  const virtualKey = ({
    Enter: 13,
    Escape: 27,
    ArrowDown: 40,
    ArrowUp: 38,
    Home: 36,
    End: 35,
    ' ': 32
  })[key] ?? key.toUpperCase().charCodeAt(0)
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
  const acceptanceOnlyFlags = process.env.ROVAI_MEMBER_LIFECYCLE_ACCEPT_NO_SANDBOX === '1'
    ? ['--no-sandbox']
    : []
  const child = spawn(join(appPath, 'Contents', 'MacOS', 'Rovai AI'), [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dataDir}`,
    ...acceptanceOnlyFlags
  ], {
    cwd: root,
    env: { ...process.env, ROVAI_ALLOW_ISOLATED_INSTANCE: '1' },
    stdio: ['ignore', 'ignore', 'pipe']
  })
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
  let cdp = null
  try {
    const target = await waitForTarget(port, stderr)
    cdp = await connectCdp(target.webSocketDebuggerUrl, stderr)
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
    const closeRequest = app.cdp.send('Browser.close').catch(() => undefined)
    await Promise.race([closeRequest, wait(1_000)])
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
  await waitForCoreProcessExit(app.dataDir)
}

async function waitForCoreProcessExit(dataDir, timeoutMs = 15_000) {
  const lockPath = join(dataDir, '.rovai-core-instance.lock')
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    let processId = null
    try {
      const owner = JSON.parse(await readFile(lockPath, 'utf8'))
      processId = Number.isSafeInteger(owner.processId) ? owner.processId : null
    } catch {
      return
    }
    if (processId === null || !processIsAlive(processId)) return
    await wait(100)
  }
  throw new Error(`Isolated rovai-core did not exit for ${dataDir}`)
}

function processIsAlive(processId) {
  try {
    process.kill(processId, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
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

async function connectCdp(url, stderr = []) {
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
    const processDetail = stderr.join('').trim()
    for (const request of pending.values()) {
      request.reject(new Error(
        `CDP connection closed${processDetail ? `. Electron stderr: ${processDetail}` : ''}`
      ))
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

async function historicalProfile(databasePath, agentId) {
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
      WHERE id = ${sqlLiteral(agentId)}
    `
  ])
  const [profile] = JSON.parse(output)
  assert(profile, `Historical Profile ${agentId} was not retained`)
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
