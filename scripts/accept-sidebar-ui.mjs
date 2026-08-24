import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { seedCompletedOnboardingForAcceptance } from './lib/dev-desktop.mjs'

const root = resolve(import.meta.dirname, '..')
const appPath = resolve(process.argv[2] ?? join(root, 'dist', 'mac-arm64', 'Rovai AI.app'))
const fixtureRoot = process.env.ROVAI_SIDEBAR_ACCEPT_FIXTURE_ROOT
  ?? await mkdtemp(join(tmpdir(), 'rovai-sidebar-ui-accept-'))
const dataDir = join(fixtureRoot, 'user-data')
const workspaceDir = join(fixtureRoot, 'workspace')
// The Core owns Unix sockets below TMPDIR; keep this path short enough for SUN_LEN.
const runtimeTempDir = process.env.ROVAI_SIDEBAR_ACCEPT_RUNTIME_TMP
  ?? await mkdtemp('/tmp/rv-side-')
const outputDir = process.env.ROVAI_SIDEBAR_ACCEPT_OUTPUT_DIR
  ?? await mkdtemp(join(tmpdir(), 'rovai-sidebar-ui-captures-'))
const databasePath = join(dataDir, 'rovai.sqlite')
const firstPort = Number(process.env.ROVAI_SIDEBAR_ACCEPT_DEBUG_PORT ?? 9491)
const renamedTitle = '侧栏操作验收已重命名'

await mkdir(dataDir, { recursive: true })
await mkdir(workspaceDir, { recursive: true })
await mkdir(outputDir, { recursive: true })
seedCompletedOnboardingForAcceptance(dataDir)
await writeFile(join(workspaceDir, 'README.md'), '# Sidebar UI acceptance\n')

let fixture = null
let desktopApp = null
let compactApp = null

try {
  desktopApp = await launchApp(firstPort, 1440, 920, false)
  fixture = await createFixtureCamps(desktopApp.cdp)
  await setTheme(desktopApp.cdp, 'day')
  await assertSidebarContract(desktopApp.cdp, '1440×920')
  await assertProjectActionsReveal(desktopApp.cdp)
  await assertCampActionsReveal(desktopApp.cdp)
  await wait(2_500)
  await assertLongTitleIsTruncated(desktopApp.cdp, fixture.longTitleCampId)
  await assertProjectRowAndPagination(desktopApp.cdp)
  await assertQuickChatPagination(desktopApp.cdp)

  const desktopCapture = join(outputDir, 'sidebar-day-1440x920.png')
  await capture(desktopApp.cdp, desktopCapture)

  const projectTarget = await firstProjectTarget(desktopApp.cdp)
  await openMenuByKeyboard(desktopApp.cdp, projectTarget)
  await assertOpenMenu(desktopApp.cdp, projectTarget, ['置顶项目', '移除项目'], 1, '置顶项目')
  const projectMenuCapture = join(outputDir, 'project-menu-day-1440x920.png')
  await capture(desktopApp.cdp, projectMenuCapture)
  await pressKey(desktopApp.cdp, 'Escape')
  await assertMenuClosedWithFocus(desktopApp.cdp, projectTarget)

  await openMenuByKeyboard(desktopApp.cdp, projectTarget)
  await pressKey(desktopApp.cdp, 'Enter')
  await assertTargetMoved(desktopApp.cdp, projectTarget, '.pinned-navigation')
  await assertProjectPaginationCount(desktopApp.cdp, '.pinned-navigation', 15)
  await openMenuByKeyboard(desktopApp.cdp, projectTarget)
  await assertOpenMenu(desktopApp.cdp, projectTarget, ['取消置顶项目', '移除项目'], 1, '取消置顶项目')
  await pressKey(desktopApp.cdp, 'Enter')
  await assertTargetMoved(desktopApp.cdp, projectTarget, '.navigation-projects')
  await assertProjectPaginationCount(desktopApp.cdp, '.navigation-projects', 15)

  const campTarget = `camp:${fixture.actionCampId}`
  await openMenuByKeyboard(desktopApp.cdp, campTarget)
  await assertOpenMenu(desktopApp.cdp, campTarget, ['置顶', '重命名', '复制会话 ID', '删除'], 1, '置顶')
  await pressKey(desktopApp.cdp, 'End')
  await assertHighlightedItem(desktopApp.cdp, '删除')
  await pressKey(desktopApp.cdp, 'Home')
  await assertHighlightedItem(desktopApp.cdp, '置顶')
  await pressKey(desktopApp.cdp, 'ArrowDown')
  await assertHighlightedItem(desktopApp.cdp, '重命名')
  await pressKey(desktopApp.cdp, 'ArrowDown')
  await assertHighlightedItem(desktopApp.cdp, '复制会话 ID')
  await pressKey(desktopApp.cdp, 'ArrowDown')
  await assertHighlightedItem(desktopApp.cdp, '删除')
  await pressKey(desktopApp.cdp, 'Escape')
  await assertMenuClosedWithFocus(desktopApp.cdp, campTarget)
  await assertCampIdCopy(desktopApp.cdp, campTarget, fixture.actionCampId)

  await openMenuByKeyboard(desktopApp.cdp, campTarget)
  await pressKey(desktopApp.cdp, 'Enter')
  await assertTargetMoved(desktopApp.cdp, campTarget, '.pinned-navigation')
  await openMenuByKeyboard(desktopApp.cdp, campTarget)
  await assertOpenMenu(desktopApp.cdp, campTarget, ['取消置顶', '重命名', '复制会话 ID', '删除'], 1, '取消置顶')
  const pinnedCampMenuCapture = join(outputDir, 'camp-menu-pinned-day-1440x920.png')
  await capture(desktopApp.cdp, pinnedCampMenuCapture)
  await pressKey(desktopApp.cdp, 'Enter')
  await assertTargetMoved(desktopApp.cdp, campTarget, '.navigation-projects')

  await renameCampFromMenu(desktopApp.cdp, campTarget)
  await assertClickOutsideClosesMenu(desktopApp.cdp, campTarget)

  const deleteTarget = `camp:${fixture.deleteCampId}`
  await openDeleteDialog(desktopApp.cdp, deleteTarget)
  const deleteDialogCapture = join(outputDir, 'delete-dialog-day-1440x920.png')
  await wait(200)
  await capture(desktopApp.cdp, deleteDialogCapture)
  await pressKey(desktopApp.cdp, 'Escape')
  await waitForExpression(desktopApp.cdp, `!document.querySelector('.camp-action-dialog')`)
  await waitForTargetFocus(desktopApp.cdp, deleteTarget)
  await openDeleteDialog(desktopApp.cdp, deleteTarget)
  await clickButton(desktopApp.cdp, '.camp-action-dialog .danger-button', '永久删除对话')
  await waitForExpression(desktopApp.cdp, `(() => {
    const target = ${JSON.stringify(deleteTarget)}
    return ![...document.querySelectorAll('[data-sidebar-menu-target]')]
      .some((element) => element.dataset.sidebarMenuTarget === target)
      && !document.querySelector('.camp-action-dialog')
  })()`, 15_000)
  await assertHoverAndFocusVisibility(desktopApp.cdp, campTarget)
  await assertQuestionMarkHelpHoverOnly(desktopApp.cdp)

  // Exercise removal only after all ordinary project/camp actions have run. Pin
  // both the Project and a Camp first so the acceptance also proves removal
  // clears local pins without touching Core-owned navigation data.
  await openMenuByKeyboard(desktopApp.cdp, projectTarget)
  await assertOpenMenu(desktopApp.cdp, projectTarget, ['置顶项目', '移除项目'], 1, '置顶项目')
  await pressKey(desktopApp.cdp, 'Enter')
  await assertTargetMoved(desktopApp.cdp, projectTarget, '.pinned-navigation')
  await openMenuByKeyboard(desktopApp.cdp, campTarget)
  await pressKey(desktopApp.cdp, 'Enter')
  await assertTargetMoved(desktopApp.cdp, campTarget, '.pinned-navigation')
  const projectRemoval = await removeAndRestoreProject(desktopApp.cdp, projectTarget, campTarget)

  await closeApp(desktopApp)
  desktopApp = null
  await wait(500)

  compactApp = await launchApp(firstPort + 1, 1040, 700, true)
  await setTheme(compactApp.cdp, 'night')
  await compactApp.cdp.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 1
  })
  await wait(100)
  await assertRemovedProjectPersists(compactApp.cdp, projectRemoval.projectTarget)
  await restoreRemovedProject(compactApp.cdp, projectRemoval.projectTarget)
  await waitForExpression(compactApp.cdp, `(() => [...document.querySelectorAll('[data-sidebar-menu-target]')]
    .some((element) => element.dataset.sidebarMenuTarget === ${JSON.stringify(projectRemoval.projectTarget)}))()`, 15_000)
  await assertSidebarContract(compactApp.cdp, '1040×700')
  await wait(2_500)
  await assertCompactPointerAndMotion(compactApp.cdp)
  await assertLongTitleIsTruncated(compactApp.cdp, fixture.longTitleCampId)

  const compactTarget = `camp:${fixture.compactCampId}`
  await evaluate(compactApp.cdp, `(() => {
    const target = ${JSON.stringify(compactTarget)}
    const trigger = [...document.querySelectorAll('[data-sidebar-menu-target]')]
      .find((element) => element.dataset.sidebarMenuTarget === target)
    trigger?.scrollIntoView({ block: 'end' })
    return Boolean(trigger)
  })()`)
  await openMenuByKeyboard(compactApp.cdp, compactTarget)
  await assertOpenMenu(compactApp.cdp, compactTarget, ['置顶', '重命名', '复制会话 ID', '删除'], 1, '置顶')
  const compactMenuCapture = join(outputDir, 'camp-menu-compact-1040x700-reduced-motion.png')
  await capture(compactApp.cdp, compactMenuCapture)
  await pressKey(compactApp.cdp, 'Escape')
  await assertMenuClosedWithFocus(compactApp.cdp, compactTarget)

  const persistedPins = await evaluate(
    compactApp.cdp,
    'window.rovai.navigationPreferences.get()',
    true
  )
  assert(persistedPins.pins.length === 0,
    `Pin/unpin acceptance left unexpected persisted pins: ${JSON.stringify(persistedPins)}`)

  console.log(JSON.stringify({
    ok: true,
    app: basename(appPath),
    fixtureRoot,
    outputDir,
    verified: {
      packagedRendererToCoreIpc: true,
      campAndProjectMenus: true,
      quickChatProjectMenuAbsent: true,
      projectAndPaginationCountsHidden: true,
      projectRowSelectsAndTogglesDisclosure: true,
      fiveThenTenCampPagination: true,
      paginationCacheSurvivesCollapseAndPinMigration: true,
      projectAndCampActionsHiddenUntilHoverOrFocus: true,
      hoverFocusOpenAndCoarsePointerVisibility: true,
      questionMarkHelpIsHoverOnly: true,
      arrowHomeEndEscapeAndOutsideClick: true,
      copiesExactCampId: true,
      projectAndCampPinMigrationWithFocus: true,
      projectRemoveConfirmationAndRestore: true,
      projectRemovalPreservesCoreData: projectRemoval.coreDataPreserved,
      projectRemovalPersistsAcrossRestart: true,
      renameAndDeleteDialogs: true,
      permanentDelete: true,
      restartPersistence: true,
      menuViewportCollision: true,
      longTitleTruncation: true,
      reducedMotion: true,
      dayAndNightPreferencesResolveWithoutLayoutDrift: true,
      desktopAndCompactHorizontalOverflow: false
    },
    captures: {
      desktop: desktopCapture,
      projectMenu: projectMenuCapture,
      pinnedCampMenu: pinnedCampMenuCapture,
      deleteDialog: deleteDialogCapture,
      projectRemovalDialog: projectRemoval.dialogCapture,
      compactMenu: compactMenuCapture
    }
  }, null, 2))
} finally {
  if (desktopApp) await closeApp(desktopApp)
  if (compactApp) await closeApp(compactApp)
}

async function createFixtureCamps(cdp) {
  const core = { request: (method, params = {}) => request(cdp, method, params) }
  await core.request('health.check')
  const preflight = await core.request('camps.creationPreflight')
  const workspace = await core.request('workspaces.inspect', { path: workspaceDir })
  const memberAgentIds = preflight.presentMembers.map((member) => member.agentId)
  const common = {
    memberAgentIds,
    defaultLeadAgentId: preflight.initialLeadAgentId,
    collaborationMode: 'peer'
  }
  const projectCampIds = []
  for (let index = 1; index <= 18; index += 1) {
    projectCampIds.push(await createCamp(core, {
      ...common,
      name: `侧栏验收项目对话 ${index}`,
      workspace: { projectPath: workspace.projectPath }
    }))
  }
  const longTitleCampId = await createCamp(core, {
    ...common,
    name: '这是一个用于验证紧凑侧栏省略号与菜单可达性的超长对话标题',
    workspace: { projectPath: workspace.projectPath }
  })
  for (let index = 1; index <= 16; index += 1) {
    await createCamp(core, {
      ...common,
      name: `快速对话分页验收 ${index}`,
      workspace: null
    })
  }
  const compactCampId = await createCamp(core, {
    ...common,
    name: '保留的快速对话验收目标',
    workspace: null
  })
  const deleteCampId = await createCamp(core, {
    ...common,
    name: '待删除的快速对话验收目标',
    workspace: null
  })
  return {
    actionCampId: projectCampIds.at(-1),
    longTitleCampId,
    compactCampId,
    deleteCampId
  }
}

async function createCamp(core, input) {
  const created = await core.request('camps.create', {
    commandId: crypto.randomUUID(),
    ...input
  })
  assert(created.status === 'applied' && created.payload?.campId,
    `Could not create sidebar fixture Camp: ${JSON.stringify(created)}`)
  return created.payload.campId
}

async function assertSidebarContract(cdp, context) {
  await waitForExpression(cdp, `(() => {
    const project = document.querySelector('.navigation-projects .camp-nav-group:not([data-group="quick-chat"])')
    const quickChat = document.querySelector('.camp-nav-group[data-group="quick-chat"]')
    return Boolean(project?.querySelector('.group-menu-trigger')
      && project.querySelectorAll('.camp-menu-trigger').length >= 5
      && quickChat?.querySelector('.camp-menu-trigger'))
  })()`, 15_000)
  const state = await evaluate(cdp, `(() => {
    const projectGroups = [...document.querySelectorAll('.navigation-projects .camp-nav-group:not([data-group="quick-chat"])')]
    const quickChat = document.querySelector('.camp-nav-group[data-group="quick-chat"]')
    return {
      projectGroups: projectGroups.length,
      campGroups: document.querySelectorAll('.camp-nav-group').length,
      projectMenus: projectGroups.reduce((count, group) => count + group.querySelectorAll('.group-menu-trigger').length, 0),
      quickChatProjectMenus: quickChat?.querySelectorAll('.group-menu-trigger').length ?? -1,
      quickChatFolder: Boolean(quickChat?.querySelector('.project-folder-glyph')),
      legacyDirectPins: document.querySelectorAll('.group-pin-button, .row-pin-button').length,
      legacyMenus: document.querySelectorAll('.camp-row-menu').length,
      projectDisclosures: document.querySelectorAll('.project-disclosure-button').length,
      projectCounts: document.querySelectorAll('.camp-group-count').length,
      paginationLabels: [...document.querySelectorAll('.show-more-camps, .collapse-camps')]
        .map((button) => button.textContent?.trim()),
      projectRowSemantics: projectGroups.every((group) => {
        const select = group.querySelector('.project-select-row')
        const content = group.querySelector('.camp-group-children')
        return select?.getAttribute('aria-controls') === content?.id
          && select?.getAttribute('aria-expanded') === String(!content?.hidden)
      }),
      projectRowFont: projectGroups[0]
        ? getComputedStyle(projectGroups[0].querySelector('.project-select-row')).fontSize
        : null,
      projectMenuOpacity: projectGroups[0]
        ? Number(getComputedStyle(projectGroups[0].querySelector('.group-menu-trigger')).opacity)
        : -1,
      projectCreateOpacity: projectGroups[0]
        ? Number(getComputedStyle(projectGroups[0].querySelector('.group-create-button')).opacity)
        : -1,
      campMenuOpacity: projectGroups[0]
        ? Number(getComputedStyle(projectGroups[0].querySelector('.camp-menu-trigger')).opacity)
        : -1,
      campMenuPointerEvents: projectGroups[0]
        ? getComputedStyle(projectGroups[0].querySelector('.camp-menu-trigger')).pointerEvents
        : null,
      coarsePointer: matchMedia('(pointer: coarse)').matches || matchMedia('(hover: none)').matches,
      campRowFont: projectGroups[0]
        ? getComputedStyle(projectGroups[0].querySelector('.camp-nav-open')).fontSize
        : null,
      campRowHeight: (() => {
        const row = projectGroups[0]?.querySelector('.camp-nav-row')
        return row?.getBoundingClientRect().height ?? null
      })(),
      campRowPitch: (() => {
        const rows = projectGroups[0]?.querySelectorAll('.camp-nav-row') ?? []
        if (rows.length < 2) return null
        return rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top
      })(),
      sectionFont: getComputedStyle(document.querySelector('#projects-heading')).fontSize,
      plusCenterDelta: (() => {
        const sectionPlus = document.querySelector('.navigation-section-title .section-create-button')
        const projectPlus = projectGroups[0]?.querySelector('.group-create-button')
        if (!sectionPlus || !projectPlus) return null
        const sectionRect = sectionPlus.getBoundingClientRect()
        const projectRect = projectPlus.getBoundingClientRect()
        return Math.abs((sectionRect.left + sectionRect.width / 2) - (projectRect.left + projectRect.width / 2))
      })(),
      sidebarOverflow: (() => {
        const sidebar = document.querySelector('.unified-sidebar')
        return sidebar ? sidebar.scrollWidth > sidebar.clientWidth + 1 : true
      })(),
      documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      viewport: [window.innerWidth, window.innerHeight]
    }
  })()`)
  assert(state.projectGroups === 1 && state.projectMenus === 1,
    `${context} did not expose exactly one pinnable Project menu: ${JSON.stringify(state)}`)
  assert(state.quickChatProjectMenus === 0 && state.quickChatFolder,
    `${context} Quick Chat Project semantics were incorrect: ${JSON.stringify(state)}`)
  assert(state.legacyDirectPins === 0
      && state.legacyMenus === 0
      && state.projectDisclosures === 0
      && state.projectCounts === 0,
    `${context} retained a legacy sidebar action/count control: ${JSON.stringify(state)}`)
  assert(state.paginationLabels.includes('查看更多')
      && state.paginationLabels.every((label) => label === '查看更多' || label === '收起'),
  `${context} pagination labels exposed counts or legacy copy: ${JSON.stringify(state.paginationLabels)}`)
  assert(state.projectRowSemantics,
    `${context} project row disclosure semantics were incomplete: ${JSON.stringify(state)}`)
  assert(state.sectionFont === '14px' && state.projectRowFont === '12.5px' && state.campRowFont === '12px',
    `${context} sidebar type hierarchy drifted: ${JSON.stringify(state)}`)
  assert(state.campRowHeight !== null && Math.abs(state.campRowHeight - 28) < 0.6
      && state.campRowPitch !== null && Math.abs(state.campRowPitch - 28) < 0.6,
  `${context} Camp rows did not keep the approved 28px pitch: ${JSON.stringify(state)}`)
  assert(state.coarsePointer
      ? state.projectMenuOpacity > 0.95 && state.projectCreateOpacity > 0.95
        && state.campMenuOpacity > 0.95 && state.campMenuPointerEvents === 'auto'
      : state.projectMenuOpacity < 0.05 && state.projectCreateOpacity < 0.05
        && state.campMenuOpacity < 0.05 && state.campMenuPointerEvents === 'none',
  `${context} Project actions did not follow hover/touch visibility: ${JSON.stringify(state)}`)
  assert(state.plusCenterDelta !== null && state.plusCenterDelta < 0.6,
    `${context} Project create action columns were misaligned: ${JSON.stringify(state)}`)
  assert(!state.sidebarOverflow && !state.documentOverflow,
    `${context} sidebar overflowed horizontally: ${JSON.stringify(state)}`)
}

async function assertCampActionsReveal(cdp) {
  const selector = '.navigation-projects .camp-nav-group:not([data-group="quick-chat"]) .camp-nav-row'
  await evaluate(cdp, `document.activeElement instanceof HTMLElement && document.activeElement.blur()`)
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: 20,
    y: 80
  })
  await wait(180)
  const initial = await evaluate(cdp, `(() => {
    const trigger = document.querySelector(${JSON.stringify(selector)})?.querySelector('.camp-menu-trigger')
    return trigger ? {
      opacity: Number(getComputedStyle(trigger).opacity),
      pointerEvents: getComputedStyle(trigger).pointerEvents
    } : null
  })()`)
  assert(initial?.opacity < 0.05 && initial.pointerEvents === 'none',
    `Camp action was not hidden by default: ${JSON.stringify(initial)}`)

  await forcePseudoState(cdp, selector, ['hover'])
  await wait(180)
  const hovered = await evaluate(cdp, `(() => {
    const trigger = document.querySelector(${JSON.stringify(selector)})?.querySelector('.camp-menu-trigger')
    return trigger ? {
      opacity: Number(getComputedStyle(trigger).opacity),
      pointerEvents: getComputedStyle(trigger).pointerEvents
    } : null
  })()`)
  assert(hovered?.opacity > 0.95 && hovered.pointerEvents === 'auto',
    `Camp action was hidden while its row was hovered: ${JSON.stringify(hovered)}`)
  await forcePseudoState(cdp, selector, [])

  const focused = await evaluate(cdp, `(() => {
    const trigger = document.querySelector(${JSON.stringify(selector)})?.querySelector('.camp-menu-trigger')
    trigger?.focus()
    return Boolean(trigger && document.activeElement === trigger)
  })()`)
  assert(focused, 'Could not focus the Camp action trigger')
  await wait(180)
  const focusedState = await evaluate(cdp, `(() => {
    const trigger = document.querySelector(${JSON.stringify(selector)})?.querySelector('.camp-menu-trigger')
    return trigger ? {
      opacity: Number(getComputedStyle(trigger).opacity),
      pointerEvents: getComputedStyle(trigger).pointerEvents
    } : null
  })()`)
  assert(focusedState?.opacity > 0.95 && focusedState.pointerEvents === 'auto',
    `Camp action was hidden during focus-within: ${JSON.stringify(focusedState)}`)

  await evaluate(cdp, `document.activeElement instanceof HTMLElement && document.activeElement.blur()`)
  await wait(180)
  const restored = await evaluate(cdp, `(() => {
    const trigger = document.querySelector(${JSON.stringify(selector)})?.querySelector('.camp-menu-trigger')
    return trigger ? Number(getComputedStyle(trigger).opacity) : null
  })()`)
  assert(restored !== null && restored < 0.05,
    `Camp action stayed visible after hover and focus left the row: ${restored}`)
}

async function assertProjectActionsReveal(cdp) {
  await evaluate(cdp, `document.activeElement instanceof HTMLElement && document.activeElement.blur()`)
  const hoverPointer = await evaluate(cdp, `(() => {
    const row = document.querySelector('.navigation-projects .camp-nav-group:not([data-group="quick-chat"]) .project-heading-row')
    const rect = row?.getBoundingClientRect()
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null
  })()`)
  assert(hoverPointer, 'Could not resolve the Project row for hover visibility')
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hoverPointer.x, y: hoverPointer.y })
  await forcePseudoState(
    cdp,
    '.navigation-projects .camp-nav-group:not([data-group="quick-chat"]) .project-heading-row',
    ['hover']
  )
  await wait(180)
  const hovered = await evaluate(cdp, `(() => {
    const row = document.querySelector('.navigation-projects .camp-nav-group:not([data-group="quick-chat"]) .project-heading-row')
    const menu = row?.querySelector('.group-menu-trigger')
    const create = row?.querySelector('.group-create-button')
    return {
      menu: menu ? Number(getComputedStyle(menu).opacity) : -1,
      create: create ? Number(getComputedStyle(create).opacity) : -1
    }
  })()`)
  assert(hovered.menu > 0.95 && hovered.create > 0.95,
    `Project actions were hidden while the directory row was hovered: ${JSON.stringify(hovered)}`)
  await forcePseudoState(
    cdp,
    '.navigation-projects .camp-nav-group:not([data-group="quick-chat"]) .project-heading-row',
    []
  )

  const pointer = await evaluate(cdp, `(() => {
    const row = document.querySelector('.navigation-projects .camp-nav-group:not([data-group="quick-chat"]) .project-select-row')
    const rect = row?.getBoundingClientRect()
    return rect ? {
      x: rect.left + Math.min(80, rect.width / 2),
      y: rect.top + rect.height / 2,
      awayX: window.innerWidth - 20,
      awayY: 80
    } : null
  })()`)
  assert(pointer, 'Could not resolve the Project row pointer target')
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pointer.x, y: pointer.y })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: pointer.x,
    y: pointer.y,
    button: 'left',
    buttons: 1,
    clickCount: 1
  })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: pointer.x,
    y: pointer.y,
    button: 'left',
    buttons: 0,
    clickCount: 1
  })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: pointer.awayX,
    y: pointer.awayY
  })
  await waitForExpression(cdp, `(() => {
    const row = document.querySelector('.navigation-projects .camp-nav-group:not([data-group="quick-chat"]) .project-heading-row')
    const menu = row?.querySelector('.group-menu-trigger')
    const create = row?.querySelector('.group-create-button')
    return menu && create
      && Number(getComputedStyle(menu).opacity) < 0.05
      && Number(getComputedStyle(create).opacity) < 0.05
  })()`, 3_000)
  const afterPointerLeave = await evaluate(cdp, `(() => {
    const group = document.querySelector('.navigation-projects .camp-nav-group:not([data-group="quick-chat"])')
    const row = group?.querySelector('.project-select-row')
    const menu = group?.querySelector('.group-menu-trigger')
    const create = group?.querySelector('.group-create-button')
    return {
      rowRetainedPointerFocus: document.activeElement === row,
      focusVisible: row?.matches(':focus-visible') ?? false,
      expanded: row?.getAttribute('aria-expanded'),
      menu: menu ? Number(getComputedStyle(menu).opacity) : -1,
      create: create ? Number(getComputedStyle(create).opacity) : -1
    }
  })()`)
  assert(afterPointerLeave.rowRetainedPointerFocus
      && !afterPointerLeave.focusVisible
      && afterPointerLeave.menu < 0.05
      && afterPointerLeave.create < 0.05
      && afterPointerLeave.expanded === 'false',
  `Project actions lingered after pointer activation and leave: ${JSON.stringify(afterPointerLeave)}`)
  await evaluate(cdp, `document.querySelector('.navigation-projects .camp-nav-group:not([data-group="quick-chat"]) .project-select-row')?.click()`)
  await waitForExpression(cdp, `document.querySelector('.navigation-projects .camp-nav-group:not([data-group="quick-chat"]) .project-select-row')?.getAttribute('aria-expanded') === 'true'`)
}

async function assertQuestionMarkHelpHoverOnly(cdp) {
  const openedSettings = await evaluate(cdp, `(() => {
    const button = document.querySelector('button[aria-label="设置"]')
    button?.click()
    return Boolean(button)
  })()`)
  assert(openedSettings, 'Could not open Settings to verify question-mark help')
  await waitForSelector(cdp, '.settings-sidebar-group')
  const settingsNavigation = await evaluate(cdp, `(() => {
    const groups = [...document.querySelectorAll('.settings-sidebar-group')]
    return {
      groups: groups.map((group) => ({
        label: group.querySelector('.settings-sidebar-group-title')?.textContent?.trim(),
        items: [...group.querySelectorAll('button strong')].map((item) => item.textContent?.trim())
      })),
      labelled: groups.every((group) => {
        const heading = group.querySelector('.settings-sidebar-group-title')
        return Boolean(heading?.id && group.getAttribute('aria-labelledby') === heading.id)
      }),
      horizontalOverflow: (() => {
        const menu = document.querySelector('.settings-sidebar-menu')
        return menu ? menu.scrollWidth > menu.clientWidth + 1 : true
      })()
    }
  })()`)
  const expectedSettingsGroups = [
    { label: '应用', items: ['通用', '外观', '提醒'] },
    { label: '能力', items: ['Skills', 'MCP', 'Agent 运行时'] },
    { label: '支持', items: ['运行监控', '诊断与修复'] }
  ]
  assert(JSON.stringify(settingsNavigation.groups) === JSON.stringify(expectedSettingsGroups)
      && settingsNavigation.labelled
      && !settingsNavigation.horizontalOverflow,
  `Settings navigation groups do not match the eight-item contract: ${JSON.stringify(settingsNavigation)}`)
  await waitForSelector(cdp, '.general-help-mark')
  await assertHoverOnlyTooltip(cdp, '.general-help-mark', '.general-help-popover', 'General one-click help')

  const openedSkills = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.settings-sidebar-menu button')]
      .find((candidate) => candidate.querySelector('strong')?.textContent?.trim() === 'Skills')
    button?.click()
    return Boolean(button)
  })()`)
  assert(openedSkills, 'Could not open Skill Settings to verify the inline import explanation')
  await waitForSelector(cdp, '.skill-import-copy')
  const skillImportHelp = await evaluate(cdp, `({
    inlineCopy: document.querySelector('.skill-import-copy')?.textContent?.trim() ?? '',
    legacyQuestionMark: Boolean(document.querySelector('.skill-import-help'))
  })`)
  assert(skillImportHelp.inlineCopy.includes('先生成安全预览')
      && skillImportHelp.inlineCopy.includes('确认后复制完整内容')
      && !skillImportHelp.legacyQuestionMark,
  `Skill import help did not use the current inline explanation: ${JSON.stringify(skillImportHelp)}`)

  const returnedToApp = await evaluate(cdp, `(() => {
    const button = document.querySelector('.settings-sidebar-back')
    button?.click()
    return Boolean(button)
  })()`)
  assert(returnedToApp, 'Could not return from Settings after verifying question-mark help')
  await waitForSelector(cdp, '.navigation-projects')
}

async function assertHoverOnlyTooltip(cdp, markSelector, tooltipSelector, context) {
  await evaluate(cdp, `document.querySelector(${JSON.stringify(markSelector)})?.scrollIntoView({ block: 'center' })`)
  await wait(100)
  const initial = await evaluate(cdp, `(() => {
    const mark = document.querySelector(${JSON.stringify(markSelector)})
    const tooltip = document.querySelector(${JSON.stringify(tooltipSelector)})
    const rect = mark?.getBoundingClientRect()
    const style = tooltip ? getComputedStyle(tooltip) : null
    return {
      tagName: mark?.tagName,
      hasTabIndex: mark?.hasAttribute('tabindex') ?? true,
      role: tooltip?.getAttribute('role'),
      visibility: style?.visibility,
      opacity: style ? Number(style.opacity) : -1,
      point: rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null
    }
  })()`)
  assert(initial.tagName === 'SPAN' && !initial.hasTabIndex && initial.role === 'tooltip'
      && initial.visibility === 'hidden' && initial.opacity < 0.05 && initial.point,
  `${context} was not a non-clickable hidden tooltip mark: ${JSON.stringify(initial)}`)

  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: initial.point.x,
    y: initial.point.y
  })
  await forcePseudoState(cdp, markSelector, ['hover'])
  await wait(180)
  const hovered = await evaluate(cdp, `(() => {
    const mark = document.querySelector(${JSON.stringify(markSelector)})
    const tooltip = document.querySelector(${JSON.stringify(tooltipSelector)})
    const style = tooltip ? getComputedStyle(tooltip) : null
    const point = ${JSON.stringify(initial.point)}
    const hit = document.elementFromPoint(point.x, point.y)
    const anchor = mark?.closest('.general-help-anchor')
    return {
      visibility: style?.visibility,
      opacity: style ? Number(style.opacity) : -1,
      markHovered: mark?.matches(':hover') ?? false,
      anchorHovered: anchor?.matches(':hover') ?? false,
      sameAnchor: Boolean(anchor && tooltip && anchor.contains(tooltip)),
      adjacent: mark?.nextElementSibling === tooltip,
      markCount: document.querySelectorAll(${JSON.stringify(markSelector)}).length,
      tooltipCount: document.querySelectorAll(${JSON.stringify(tooltipSelector)}).length,
      hitTag: hit?.tagName,
      hitClass: hit?.className
    }
  })()`)
  assert(hovered.visibility === 'visible' && hovered.opacity > 0.95,
    `${context} did not appear on hover: ${JSON.stringify(hovered)}`)

  await forcePseudoState(cdp, markSelector, [])
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 20, y: 80 })
  await wait(180)
  const left = await evaluate(cdp, `(() => {
    const tooltip = document.querySelector(${JSON.stringify(tooltipSelector)})
    const style = tooltip ? getComputedStyle(tooltip) : null
    return { visibility: style?.visibility, opacity: style ? Number(style.opacity) : -1 }
  })()`)
  assert(left.visibility === 'hidden' && left.opacity < 0.05,
    `${context} remained visible after pointer leave: ${JSON.stringify(left)}`)
}

async function assertProjectRowAndPagination(cdp) {
  const selector = '.navigation-projects .camp-nav-group:not([data-group="quick-chat"])'
  const initial = await projectPaginationState(cdp, selector)
  assert(initial.campCount === 5
      && JSON.stringify(initial.labels) === JSON.stringify(['查看更多'])
      && initial.rowIsSiblingOfActions
      && initial.expanded,
  `Project group did not start from the five-Camp independent-control contract: ${JSON.stringify(initial)}`)

  await clickProjectControl(cdp, selector, '.show-more-camps')
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(selector)})?.querySelectorAll('.camp-nav-row').length === 15`)
  const expanded = await projectPaginationState(cdp, selector)
  assert(expanded.campCount === 15
      && JSON.stringify(expanded.labels) === JSON.stringify(['查看更多', '收起']),
  `First ten-Camp expansion was incorrect: ${JSON.stringify(expanded)}`)

  await clickProjectControl(cdp, selector, '.collapse-camps')
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(selector)})?.querySelectorAll('.camp-nav-row').length === 5`)
  const collapsedList = await projectPaginationState(cdp, selector)
  assert(JSON.stringify(collapsedList.labels) === JSON.stringify(['查看更多']),
    `Camp pagination collapse did not restore the initial state: ${JSON.stringify(collapsedList)}`)

  await clickProjectControl(cdp, selector, '.show-more-camps')
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(selector)})?.querySelectorAll('.camp-nav-row').length === 15`)

  await clickProjectControl(cdp, selector, '.project-select-row')
  const selected = await projectPaginationState(cdp, selector)
  assert(selected.current && !selected.expanded,
    `Project row did not select and collapse together: ${JSON.stringify(selected)}`)
  await clickProjectControl(cdp, selector, '.project-select-row')
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(selector)})?.querySelectorAll('.camp-nav-row').length === 15`)

  const menuTarget = await evaluate(cdp, `document.querySelector(${JSON.stringify(selector)})?.querySelector('.group-menu-trigger')?.dataset.sidebarMenuTarget ?? null`)
  const expandedBeforeActions = await projectPaginationState(cdp, selector)
  await openMenuByKeyboard(cdp, menuTarget)
  const expandedWithMenu = await projectPaginationState(cdp, selector)
  assert(expandedWithMenu.expanded === expandedBeforeActions.expanded,
    `Project menu unexpectedly toggled the directory row: ${JSON.stringify(expandedWithMenu)}`)
  await pressKey(cdp, 'Escape')
  await assertMenuClosedWithFocus(cdp, menuTarget)

  await clickProjectControl(cdp, selector, '.group-create-button')
  await waitForSelector(cdp, '.new-camp-dialog')
  const expandedWithDialog = await projectPaginationState(cdp, selector)
  assert(expandedWithDialog.expanded === expandedBeforeActions.expanded,
    `Project create action unexpectedly toggled the directory row: ${JSON.stringify(expandedWithDialog)}`)
  await pressKey(cdp, 'Escape')
  await waitForExpression(cdp, `!document.querySelector('.new-camp-dialog')`)

  const keyboardFocused = await evaluate(cdp, `(() => {
    const row = document.querySelector(${JSON.stringify(selector)})?.querySelector('.project-select-row')
    row?.focus()
    return document.activeElement === row && getComputedStyle(row).outlineStyle !== 'none'
  })()`)
  assert(keyboardFocused, 'Project select control did not expose a visible keyboard focus target')
  await pressKey(cdp, 'Enter')
  const keyboardSelected = await projectPaginationState(cdp, selector)
  assert(keyboardSelected.current && !keyboardSelected.expanded,
    `Keyboard Project row did not select and collapse together: ${JSON.stringify(keyboardSelected)}`)
  await evaluate(cdp, `document.querySelector(${JSON.stringify(selector)})?.querySelector('.project-select-row')?.focus()`)
  await pressKey(cdp, 'Enter')
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(selector)})?.querySelectorAll('.camp-nav-row').length === 15`)
}

async function assertQuickChatPagination(cdp) {
  const selector = '.navigation-projects .camp-nav-group[data-group="quick-chat"]'
  const initial = await projectPaginationState(cdp, selector)
  assert(initial.campCount === 5
      && JSON.stringify(initial.labels) === JSON.stringify(['查看更多']),
  `Quick Chat did not start from the shared five-Camp pagination contract: ${JSON.stringify(initial)}`)

  await clickProjectControl(cdp, selector, '.show-more-camps')
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(selector)})?.querySelectorAll('.camp-nav-row').length === 15`)
  const expanded = await projectPaginationState(cdp, selector)
  assert(JSON.stringify(expanded.labels) === JSON.stringify(['查看更多', '收起']),
    `Quick Chat did not share the ten-Camp expansion controls: ${JSON.stringify(expanded)}`)

  await clickProjectControl(cdp, selector, '.collapse-camps')
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(selector)})?.querySelectorAll('.camp-nav-row').length === 5`)
  await clickProjectControl(cdp, selector, '.show-more-camps')
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(selector)})?.querySelectorAll('.camp-nav-row').length === 15`)
}

async function projectPaginationState(cdp, selector) {
  return evaluate(cdp, `(() => {
    const group = document.querySelector(${JSON.stringify(selector)})
    const row = group?.querySelector('.project-select-row')
    const menu = group?.querySelector('.group-menu-trigger')
    const create = group?.querySelector('.group-create-button')
    return {
      campCount: group?.querySelectorAll('.camp-nav-row').length ?? -1,
      labels: [...(group?.querySelectorAll('.show-more-camps, .collapse-camps') ?? [])]
        .map((button) => button.textContent?.trim()),
      expanded: row?.getAttribute('aria-expanded') === 'true',
      current: row?.getAttribute('aria-current') === 'true',
      rowIsSiblingOfActions: Boolean(row && menu && create
        && row.parentElement === menu.parentElement
        && row.parentElement === create.parentElement
        && !row.contains(menu)
        && !row.contains(create))
    }
  })()`)
}

async function clickProjectControl(cdp, groupSelector, controlSelector) {
  const clicked = await evaluate(cdp, `(() => {
    const control = document.querySelector(${JSON.stringify(groupSelector)})?.querySelector(${JSON.stringify(controlSelector)})
    if (!(control instanceof HTMLButtonElement) || control.disabled) return false
    control.click()
    return true
  })()`)
  assert(clicked, `Could not click Project control ${controlSelector}`)
}

async function assertProjectPaginationCount(cdp, containerSelector, expectedCount) {
  await waitForExpression(cdp, `(() => {
    const group = document.querySelector(${JSON.stringify(containerSelector)})
      ?.querySelector('.camp-nav-group:not([data-group="quick-chat"])')
    return group?.querySelectorAll('.camp-nav-row').length === ${expectedCount}
      && group.querySelector('.project-select-row')?.getAttribute('aria-expanded') === 'true'
  })()`)
}

async function assertLongTitleIsTruncated(cdp, campId) {
  const target = `camp:${campId}`
  const state = await evaluate(cdp, `(() => {
    const target = ${JSON.stringify(target)}
    const trigger = [...document.querySelectorAll('[data-sidebar-menu-target]')]
      .find((element) => element.dataset.sidebarMenuTarget === target)
    const title = trigger?.closest('.camp-nav-row')?.querySelector('.camp-nav-open .truncate')
    return title ? {
      clipped: title.scrollWidth > title.clientWidth,
      overflow: getComputedStyle(title).overflow,
      textOverflow: getComputedStyle(title).textOverflow
    } : null
  })()`)
  assert(state?.clipped && state.overflow === 'hidden' && state.textOverflow === 'ellipsis',
    `Long Camp title was not visibly truncated: ${JSON.stringify(state)}`)
}

async function firstProjectTarget(cdp) {
  const target = await evaluate(cdp,
    `document.querySelector('.navigation-projects .camp-nav-group:not([data-group="quick-chat"]) .group-menu-trigger')?.dataset.sidebarMenuTarget ?? null`)
  assert(target?.startsWith('project:'), `Could not resolve a Project menu target: ${JSON.stringify(target)}`)
  return target
}

async function assertHoverAndFocusVisibility(cdp, target) {
  await evaluate(cdp, `document.activeElement instanceof HTMLElement && document.activeElement.blur()`)
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  let hoveredOpacity = 0
  for (let attempt = 0; attempt < 3 && hoveredOpacity <= 0.95; attempt += 1) {
    const documentNode = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
    const rowNode = await cdp.send('DOM.querySelector', {
      nodeId: documentNode.result.root.nodeId,
      selector: `.camp-nav-row:has([data-sidebar-menu-target=${JSON.stringify(target)}])`
    })
    assert(rowNode.result.nodeId,
      `Could not resolve the Camp row node for hover target ${JSON.stringify(target)}`)
    await cdp.send('CSS.forcePseudoState', {
      nodeId: rowNode.result.nodeId,
      forcedPseudoClasses: ['hover']
    })
    await wait(180)
    hoveredOpacity = await targetOpacity(cdp, target)
    await cdp.send('CSS.forcePseudoState', {
      nodeId: rowNode.result.nodeId,
      forcedPseudoClasses: []
    }).catch(() => undefined)
  }
  assert(hoveredOpacity > 0.95,
    `Camp menu trigger was hidden while its row was hovered: ${hoveredOpacity}`)

  await focusTarget(cdp, target)
  await wait(180)
  const focusedOpacity = await targetOpacity(cdp, target)
  assert(focusedOpacity > 0.95, `Camp menu trigger was hidden during focus-within: ${focusedOpacity}`)
}

async function openMenuByKeyboard(cdp, target) {
  await focusTarget(cdp, target)
  await pressKey(cdp, 'ArrowDown')
  await waitForSelector(cdp, '.sidebar-action-menu[data-state="open"]')
  await waitForExpression(cdp,
    `document.activeElement?.classList.contains('sidebar-action-menu-item') === true`)
}

async function assertOpenMenu(cdp, target, labels, separators, highlighted) {
  let state = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await wait(180)
    state = await evaluate(cdp, `(() => {
    const target = ${JSON.stringify(target)}
    const menu = document.querySelector('.sidebar-action-menu[data-state="open"]')
    const rect = menu?.getBoundingClientRect()
    const trigger = [...document.querySelectorAll('.sidebar-menu-trigger')]
      .find((element) => element.dataset.sidebarMenuTarget === target)
    return {
      labels: [...(menu?.querySelectorAll('.sidebar-action-menu-item') ?? [])]
        .map((item) => item.textContent?.trim()),
      separators: menu?.querySelectorAll('.sidebar-action-menu-separator').length ?? -1,
      highlighted: document.activeElement?.textContent?.trim() ?? null,
      triggerOpacity: trigger ? Number(getComputedStyle(trigger).opacity) : 0,
      triggerState: trigger?.getAttribute('data-state') ?? null,
      role: menu?.getAttribute('role') ?? null,
      itemRoles: [...(menu?.querySelectorAll('.sidebar-action-menu-item') ?? [])]
        .map((item) => item.getAttribute('role')),
      bounds: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null,
      viewport: { width: window.innerWidth, height: window.innerHeight }
    }
  })()`)
    if (state.bounds) break
    if (attempt < 2) await openMenuByKeyboard(cdp, target)
  }
  assert(JSON.stringify(state.labels) === JSON.stringify(labels),
    `Sidebar menu labels/order were incorrect: ${JSON.stringify(state)}`)
  assert(state.separators === separators && state.highlighted === highlighted,
    `Sidebar menu separator or initial focus was incorrect: ${JSON.stringify(state)}`)
  assert(state.role === 'menu' && state.itemRoles.every((role) => role === 'menuitem'),
    `Sidebar menu roles were incorrect: ${JSON.stringify(state)}`)
  assert(state.triggerState === 'open' && state.triggerOpacity > 0.95,
    `Open sidebar menu trigger was hidden: ${JSON.stringify(state)}`)
  assert(state.bounds
      && state.bounds.left >= 7
      && state.bounds.top >= 7
      && state.bounds.right <= state.viewport.width - 7
      && state.bounds.bottom <= state.viewport.height - 7,
  `Sidebar menu escaped the viewport collision boundary: ${JSON.stringify(state)}`)
}

async function assertHighlightedItem(cdp, label) {
  await waitForExpression(cdp,
    `document.activeElement?.classList.contains('sidebar-action-menu-item')
      && document.activeElement.textContent?.trim() === ${JSON.stringify(label)}`)
}

async function assertMenuClosedWithFocus(cdp, target) {
  await wait(300)
  const menuStillOpen = await evaluate(cdp, `Boolean(document.querySelector('.sidebar-action-menu'))`)
  if (menuStillOpen) {
    const state = await evaluate(cdp, `({
      activeTag: document.activeElement?.tagName ?? null,
      activeClass: document.activeElement?.className ?? null,
      activeText: document.activeElement?.textContent?.trim() ?? null,
      activeRole: document.activeElement?.getAttribute('role') ?? null,
      menuState: document.querySelector('.sidebar-action-menu')?.getAttribute('data-state') ?? null,
      menuAnimation: document.querySelector('.sidebar-action-menu')
        ? getComputedStyle(document.querySelector('.sidebar-action-menu')).animationName
        : null,
      triggerStates: [...document.querySelectorAll('.sidebar-menu-trigger')]
        .filter((trigger) => trigger.getAttribute('data-state'))
        .map((trigger) => [trigger.dataset.sidebarMenuTarget, trigger.getAttribute('data-state')])
    })`)
    throw new Error(`Escape did not close the sidebar menu: ${JSON.stringify(state)}`)
  }
  await waitForTargetFocus(cdp, target)
}

async function assertCampIdCopy(cdp, target, expectedCampId) {
  const installed = await evaluate(cdp, `(() => {
    const clipboard = navigator.clipboard
    if (!clipboard || typeof clipboard.writeText !== 'function') return false
    window.__rovaiSidebarClipboardHadOwnWriteText = Object.prototype.hasOwnProperty.call(clipboard, 'writeText')
    window.__rovaiSidebarClipboardWriteTextDescriptor = Object.getOwnPropertyDescriptor(clipboard, 'writeText')
    window.__rovaiSidebarCopiedText = null
    try {
      Object.defineProperty(clipboard, 'writeText', {
        configurable: true,
        value: async (text) => { window.__rovaiSidebarCopiedText = text }
      })
      return true
    } catch {
      return false
    }
  })()`)
  assert(installed, 'Could not install the isolated clipboard spy')

  try {
    await openMenuByKeyboard(cdp, target)
    await assertHighlightedItem(cdp, '置顶')
    await pressKey(cdp, 'ArrowDown')
    await assertHighlightedItem(cdp, '重命名')
    await pressKey(cdp, 'ArrowDown')
    await assertHighlightedItem(cdp, '复制会话 ID')
    await pressKey(cdp, 'Enter')
    await waitForExpression(cdp, `document.querySelector('.app-toast')?.textContent?.includes('已复制会话 ID') === true`)
    await waitForTargetFocus(cdp, target)
    const state = await evaluate(cdp, `({
      copiedText: window.__rovaiSidebarCopiedText,
      menuOpen: Boolean(document.querySelector('.sidebar-action-menu[data-state="open"]')),
      toast: document.querySelector('.app-toast')?.textContent?.trim() ?? null
    })`)
    const copiedText = state.copiedText ?? execFileSync('/usr/bin/pbpaste', { encoding: 'utf8' })
    assert(copiedText === expectedCampId && !state.menuOpen && state.toast?.includes('已复制会话 ID'),
      `Camp ID copy semantics were incorrect: ${JSON.stringify({ ...state, copiedText })}`)
  } finally {
    await evaluate(cdp, `(() => {
      const clipboard = navigator.clipboard
      const hadOwn = window.__rovaiSidebarClipboardHadOwnWriteText
      const descriptor = window.__rovaiSidebarClipboardWriteTextDescriptor
      if (clipboard) {
        if (hadOwn && descriptor) Object.defineProperty(clipboard, 'writeText', descriptor)
        else delete clipboard.writeText
      }
      delete window.__rovaiSidebarClipboardHadOwnWriteText
      delete window.__rovaiSidebarClipboardWriteTextDescriptor
      delete window.__rovaiSidebarCopiedText
    })()`)
  }
}

async function assertTargetMoved(cdp, target, containerSelector) {
  await waitForExpression(cdp, `(() => {
    const target = ${JSON.stringify(target)}
    const container = document.querySelector(${JSON.stringify(containerSelector)})
    const triggers = [...(container?.querySelectorAll('[data-sidebar-menu-target]') ?? [])]
    return triggers.some((element) => element.dataset.sidebarMenuTarget === target)
      && document.querySelectorAll('[data-sidebar-menu-target="' + CSS.escape(target) + '"]').length === 1
  })()`, 15_000)
  try {
    await waitForTargetFocus(cdp, target)
  } catch {
    const state = await evaluate(cdp, `({
      activeTag: document.activeElement?.tagName ?? null,
      activeClass: document.activeElement?.className ?? null,
      activeTarget: document.activeElement?.dataset?.sidebarMenuTarget ?? null,
      targetConnected: [...document.querySelectorAll('[data-sidebar-menu-target]')]
        .some((element) => element.dataset.sidebarMenuTarget === ${JSON.stringify(target)})
    })`)
    throw new Error(`Migrated sidebar target did not recover focus: ${JSON.stringify(state)}`)
  }
}

async function renameCampFromMenu(cdp, target) {
  await openMenuByKeyboard(cdp, target)
  await pressKey(cdp, 'ArrowDown')
  await assertHighlightedItem(cdp, '重命名')
  await pressKey(cdp, 'Enter')
  await waitForSelector(cdp, '.camp-action-dialog #rename-camp-title')
  assert(await evaluate(cdp,
    `document.activeElement === document.querySelector('#rename-camp-title')`),
  'Rename Dialog did not autofocus its title input')
  await evaluate(cdp, `(() => {
    const input = document.querySelector('#rename-camp-title')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, ${JSON.stringify(renamedTitle)})
    input?.dispatchEvent(new Event('input', { bubbles: true }))
    return input?.value
  })()`)
  await clickButton(cdp, '.camp-action-dialog button', '保存名称')
  await waitForExpression(cdp, `!document.querySelector('.camp-action-dialog')`, 15_000)
  await waitForExpression(cdp, `(() => {
    const target = ${JSON.stringify(target)}
    const trigger = [...document.querySelectorAll('[data-sidebar-menu-target]')]
      .find((element) => element.dataset.sidebarMenuTarget === target)
    return trigger?.getAttribute('aria-label') === ${JSON.stringify(`管理“${renamedTitle}”`)}
  })()`, 15_000)
  await waitForTargetFocus(cdp, target)
}

async function assertClickOutsideClosesMenu(cdp, target) {
  await openMenuByKeyboard(cdp, target)
  await wait(100)
  const dispatched = await evaluate(cdp, `(() => {
    const content = document.querySelector('.content')
    if (!content) return false
    content.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      composed: true,
      pointerType: 'mouse',
      button: 0,
      buttons: 1
    }))
    content.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      composed: true,
      pointerType: 'mouse',
      button: 0
    }))
    content.click()
    return true
  })()`)
  assert(dispatched, 'Could not dispatch an outside click from the main content')
  await waitForExpression(cdp, `!document.querySelector('.sidebar-action-menu')`)
}

async function openDeleteDialog(cdp, target) {
  await openMenuByKeyboard(cdp, target)
  await pressKey(cdp, 'End')
  await assertHighlightedItem(cdp, '删除')
  await pressKey(cdp, 'Enter')
  await waitForSelector(cdp, '.camp-action-dialog')
  const state = await evaluate(cdp, `({
    title: document.querySelector('.camp-action-dialog h2')?.textContent ?? '',
    description: document.querySelector('.camp-action-dialog')?.textContent ?? '',
    dangerButton: [...document.querySelectorAll('.camp-action-dialog .danger-button')]
      .some((button) => button.textContent?.trim() === '永久删除对话')
  })`)
  assert(state.title.includes('永久删除')
      && state.description.includes('不可撤销')
      && state.description.includes('本地项目目录')
      && state.dangerButton,
  `Delete confirmation semantics were incomplete: ${JSON.stringify(state)}`)
}

async function removeAndRestoreProject(cdp, projectTarget, campTarget) {
  const targetKey = projectTarget.slice('project:'.length)
  const campId = campTarget.slice('camp:'.length)
  const beforeNavigation = await request(cdp, 'navigation.snapshot')
  const beforeProject = beforeNavigation.projects.find((project) => project.projectKey === targetKey)
  assert(beforeProject, `Could not resolve the Core Project before removal: ${JSON.stringify({ projectTarget, beforeNavigation })}`)
  const beforeCamp = await request(cdp, 'camps.snapshot', { campId })
  assert(beforeCamp?.camp?.id === campId,
    `Could not resolve the Core Camp before Project removal: ${JSON.stringify(beforeCamp)}`)

  await openMenuByKeyboard(cdp, projectTarget)
  await assertOpenMenu(cdp, projectTarget, ['取消置顶项目', '移除项目'], 1, '取消置顶项目')
  await pressKey(cdp, 'ArrowDown')
  await assertHighlightedItem(cdp, '移除项目')
  await pressKey(cdp, 'Enter')
  await waitForSelector(cdp, '.camp-action-dialog')
  const dialogState = await evaluate(cdp, `(() => {
    const dialog = document.querySelector('.camp-action-dialog')
    const primary = [...(dialog?.querySelectorAll('button') ?? [])]
      .find((button) => button.textContent?.trim() === '移除侧栏入口')
    return {
      title: dialog?.querySelector('h2')?.textContent?.trim() ?? '',
      description: dialog?.textContent?.trim() ?? '',
      primary: Boolean(primary),
      primaryClass: primary?.className ?? null,
      dangerButtons: dialog?.querySelectorAll('.danger-button').length ?? 0
    }
  })()`)
  assert(dialogState.title.includes('从侧栏移除')
      && dialogState.description.includes('继续保留')
      && dialogState.description.includes('本地目录')
      && dialogState.description.includes('会话')
      && dialogState.description.includes('运行记录')
      && dialogState.description.includes('重新选择同一工作目录')
      && dialogState.primary
      && dialogState.dangerButtons === 0,
  `Project removal confirmation semantics were incomplete: ${JSON.stringify(dialogState)}`)
  const dialogCapture = join(outputDir, 'project-removal-dialog-day-1440x920.png')
  await wait(200)
  await capture(cdp, dialogCapture)

  // Cancel once to prove the destructive-looking menu item is still reversible
  // before the confirmed path is exercised.
  await pressKey(cdp, 'Escape')
  await waitForExpression(cdp, `!document.querySelector('.camp-action-dialog')`)
  await waitForTargetFocus(cdp, projectTarget)

  await openMenuByKeyboard(cdp, projectTarget)
  await pressKey(cdp, 'ArrowDown')
  await assertHighlightedItem(cdp, '移除项目')
  await pressKey(cdp, 'Enter')
  await waitForSelector(cdp, '.camp-action-dialog')
  await clickButton(cdp, '.camp-action-dialog .primary-button', '移除侧栏入口')
  await waitForExpression(cdp, `(() => {
    const target = ${JSON.stringify(projectTarget)}
    return ![...document.querySelectorAll('[data-sidebar-menu-target]')]
      .some((element) => element.dataset.sidebarMenuTarget === target)
      && !document.querySelector('.camp-action-dialog')
  })()`, 15_000)
  await waitForExpression(cdp, `document.activeElement?.dataset.sidebarFocusTarget === 'project-row:quick-chat'`, 15_000)

  const afterPreferences = await evaluate(cdp, 'window.rovai.navigationPreferences.get()', true)
  assert(afterPreferences.removedProjects.some((project) => project.targetKey === targetKey),
    `Project removal was not persisted: ${JSON.stringify(afterPreferences)}`)
  assert(!afterPreferences.pins.some((pin) => (
    pin.targetKey === targetKey || pin.targetKey === campId
  )), `Project removal left a Project/Camp pin behind: ${JSON.stringify(afterPreferences)}`)

  const afterNavigation = await request(cdp, 'navigation.snapshot')
  const afterProject = afterNavigation.projects.find((project) => project.projectKey === targetKey)
  const afterCamp = await request(cdp, 'camps.snapshot', { campId })
  assert(afterProject
      && afterProject.totalCount === beforeProject.totalCount
      && afterCamp?.camp?.id === campId,
  `Project removal changed Core navigation data: ${JSON.stringify({ beforeProject, afterProject, beforeCamp, afterCamp })}`)

  return {
    projectTarget,
    targetKey,
    dialogCapture,
    coreDataPreserved: true
  }
}

async function assertRemovedProjectPersists(cdp, projectTarget) {
  const targetKey = projectTarget.slice('project:'.length)
  const state = await evaluate(cdp, `(async () => ({
    preferences: await window.rovai.navigationPreferences.get(),
    startup: await window.rovai.desktopSession.getStartupSnapshot(),
    visible: [...document.querySelectorAll('[data-sidebar-menu-target]')]
      .some((element) => element.dataset.sidebarMenuTarget === ${JSON.stringify(projectTarget)}),
    quickChatCurrent: document.querySelector('[data-sidebar-focus-target="project-row:quick-chat"]')
      ?.getAttribute('aria-current') === 'true'
  }))()`, true)
  assert(state.preferences.removedProjects.some((project) => project.targetKey === targetKey)
      && !state.visible
      && state.startup.restorableLocation?.kind === 'quick_chat'
      && state.quickChatCurrent,
  `Removed Project did not survive App restart: ${JSON.stringify({ projectTarget, state })}`)
}

async function restoreRemovedProject(cdp, projectTarget) {
  const targetKey = projectTarget.slice('project:'.length)
  const restored = await evaluate(cdp,
    `window.rovai.navigationPreferences.restoreProject(${JSON.stringify(targetKey)})`,
    true)
  assert(!restored.removedProjects.some((project) => project.targetKey === targetKey),
    `Project restore left a hidden-project record: ${JSON.stringify(restored)}`)
  await cdp.send('Page.reload', { ignoreCache: true })
  await waitForExpression(cdp,
    `Boolean(window.rovai && document.querySelector('.app-shell'))`, 45_000)
}

async function assertCompactPointerAndMotion(cdp) {
  const state = await evaluate(cdp, `(() => {
    const trigger = document.querySelector('.sidebar-menu-trigger')
    const duration = document.querySelector('.sidebar-action-menu')
    return {
      coarse: matchMedia('(pointer: coarse)').matches || matchMedia('(hover: none)').matches,
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
      triggerOpacity: trigger ? Number(getComputedStyle(trigger).opacity) : 0,
      triggerTransitionDuration: trigger ? getComputedStyle(trigger).transitionDuration : null,
      menuAnimationDuration: duration ? getComputedStyle(duration).animationDuration : null
    }
  })()`)
  assert(state.coarse && state.reduced && state.triggerOpacity > 0.95,
    `Compact touch/reduced-motion media state was not active: ${JSON.stringify(state)}`)
  assert(parseDurationMilliseconds(state.triggerTransitionDuration) <= 0.02,
    `Reduced motion did not minimize trigger transitions: ${JSON.stringify(state)}`)
}

function parseDurationMilliseconds(value) {
  if (!value) return Number.POSITIVE_INFINITY
  return Math.max(...value.split(',').map((part) => {
    const duration = part.trim()
    if (duration.endsWith('ms')) return Number.parseFloat(duration)
    if (duration.endsWith('s')) return Number.parseFloat(duration) * 1_000
    return Number.POSITIVE_INFINITY
  }))
}

async function focusTarget(cdp, target) {
  const focused = await evaluate(cdp, `(() => {
    const target = ${JSON.stringify(target)}
    const trigger = [...document.querySelectorAll('[data-sidebar-menu-target]')]
      .find((element) => element.dataset.sidebarMenuTarget === target)
    trigger?.focus()
    return document.activeElement === trigger
  })()`)
  assert(focused, `Could not focus sidebar menu target ${JSON.stringify(target)}`)
}

async function waitForTargetFocus(cdp, target) {
  await waitForExpression(cdp,
    `document.activeElement?.dataset.sidebarMenuTarget === ${JSON.stringify(target)}`)
  await wait(300)
  assert(await evaluate(cdp,
    `document.activeElement?.dataset.sidebarMenuTarget === ${JSON.stringify(target)}`),
  `Sidebar target ${JSON.stringify(target)} did not retain focus for 300ms`)
}

async function targetOpacity(cdp, target) {
  return evaluate(cdp, `(() => {
    const target = ${JSON.stringify(target)}
    const trigger = [...document.querySelectorAll('[data-sidebar-menu-target]')]
      .find((element) => element.dataset.sidebarMenuTarget === target)
    return trigger ? Number(getComputedStyle(trigger).opacity) : -1
  })()`)
}

async function clickButton(cdp, selector, label) {
  const clicked = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)})
    if (!button || button.disabled) return false
    button.click()
    return true
  })()`)
  assert(clicked, `Could not click enabled button ${JSON.stringify(label)} within ${selector}`)
}

async function pressKey(cdp, key) {
  const keyMap = {
    ArrowDown: { code: 'ArrowDown', virtualKey: 40 },
    ArrowUp: { code: 'ArrowUp', virtualKey: 38 },
    End: { code: 'End', virtualKey: 35 },
    Enter: { code: 'Enter', virtualKey: 13, text: '\r' },
    Escape: { code: 'Escape', virtualKey: 27 },
    Home: { code: 'Home', virtualKey: 36 }
  }
  const entry = keyMap[key]
  assert(entry, `Unsupported acceptance key ${key}`)
  const params = {
    key,
    code: entry.code,
    windowsVirtualKeyCode: entry.virtualKey,
    nativeVirtualKeyCode: entry.virtualKey,
    ...(entry.text ? { text: entry.text, unmodifiedText: entry.text } : {})
  }
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...params })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params })
}

async function forcePseudoState(cdp, selector, forcedPseudoClasses) {
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  const document = await cdp.send('DOM.getDocument')
  const match = await cdp.send('DOM.querySelector', {
    nodeId: document.result.root.nodeId,
    selector
  })
  assert(match.result.nodeId, `Could not force pseudo state for ${selector}`)
  await cdp.send('CSS.forcePseudoState', {
    nodeId: match.result.nodeId,
    forcedPseudoClasses
  })
}

async function request(cdp, method, params = {}) {
  return evaluate(cdp,
    `window.rovai.request(${JSON.stringify(method)}, ${JSON.stringify(params)})`, true)
}

async function setTheme(cdp, preference) {
  await evaluate(cdp, `window.rovai.appearance.setPreference(${JSON.stringify(preference)})`, true)
  const expectedTheme = preference === 'night' ? 'night' : 'day'
  await waitForExpression(cdp,
    `document.documentElement.dataset.theme === ${JSON.stringify(expectedTheme)}`)
}

async function launchApp(port, width, height, reducedMotion) {
  const executable = join(appPath, 'Contents', 'MacOS', 'Rovai AI')
  const stderr = []
  const child = spawn(executable, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dataDir}`
  ], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      TMPDIR: runtimeTempDir,
      ROVAI_ALLOW_ISOLATED_INSTANCE: '1'
    }
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
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{
        name: 'prefers-reduced-motion',
        value: reducedMotion ? 'reduce' : 'no-preference'
      }]
    })
    await waitForExpression(cdp,
      `Boolean(window.rovai && document.querySelector('.app-shell'))`, 45_000)
    await evaluate(cdp, `(() => {
      const style = document.createElement('style')
      style.dataset.sidebarAcceptance = 'deterministic-hover'
      style.textContent = [
        '.group-menu-trigger, .group-create-button, .camp-menu-trigger, .general-help-popover {',
        '  transition: none !important;',
        '}'
      ].join('\\n')
      document.head.append(style)
    })()`)
    const health = await request(cdp, 'health.check')
    assert(await realpath(health.database.path) === await realpath(databasePath),
      `Isolated App opened the wrong database: ${JSON.stringify(health.database.path)}`)
    return { cdp, port, child }
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
  throw new Error(`Isolated packaged App did not close on debug port ${app.port}`)
}

async function terminateChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    wait(3_000)
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
  await waitForExpression(cdp, `Boolean(document.querySelector(${JSON.stringify(selector)}))`, timeoutMs)
}

async function waitForExpression(cdp, expression, timeoutMs = 10_000, awaitPromise = false) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await evaluate(cdp, expression, awaitPromise)) return
    await wait(100)
  }
  if (await evaluate(cdp, expression, awaitPromise)) return
  throw new Error(`Expression did not become true within ${timeoutMs}ms: ${expression}`)
}

async function waitForTarget(port, stderr) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 20_000) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json())
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

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))
}
