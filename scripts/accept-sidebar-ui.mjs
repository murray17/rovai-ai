import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const root = resolve(import.meta.dirname, '..')
const appPath = resolve(process.argv[2] ?? join(root, 'dist', 'mac-arm64', 'Rovai-ai.app'))
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
await writeFile(join(workspaceDir, 'README.md'), '# Sidebar UI acceptance\n')

const fixture = await createFixtureCamps()
let desktopApp = null
let compactApp = null

try {
  desktopApp = await launchApp(firstPort, 1440, 920, false)
  await setTheme(desktopApp.cdp, 'day')
  await assertSidebarContract(desktopApp.cdp, '1440×920')
  await wait(2_500)
  await assertLongTitleIsTruncated(desktopApp.cdp, fixture.longTitleCampId)

  const desktopCapture = join(outputDir, 'sidebar-day-1440x920.png')
  await capture(desktopApp.cdp, desktopCapture)

  const projectTarget = await firstProjectTarget(desktopApp.cdp)
  await openMenuByKeyboard(desktopApp.cdp, projectTarget)
  await assertOpenMenu(desktopApp.cdp, projectTarget, ['置顶项目'], 0, '置顶项目')
  const projectMenuCapture = join(outputDir, 'project-menu-day-1440x920.png')
  await capture(desktopApp.cdp, projectMenuCapture)
  await pressKey(desktopApp.cdp, 'Escape')
  await assertMenuClosedWithFocus(desktopApp.cdp, projectTarget)

  await openMenuByKeyboard(desktopApp.cdp, projectTarget)
  await pressKey(desktopApp.cdp, 'Enter')
  await assertTargetMoved(desktopApp.cdp, projectTarget, '.pinned-navigation')
  await openMenuByKeyboard(desktopApp.cdp, projectTarget)
  await assertOpenMenu(desktopApp.cdp, projectTarget, ['取消置顶项目'], 0, '取消置顶项目')
  await pressKey(desktopApp.cdp, 'Enter')
  await assertTargetMoved(desktopApp.cdp, projectTarget, '.navigation-projects')

  const campTarget = `camp:${fixture.actionCampId}`
  await openMenuByKeyboard(desktopApp.cdp, campTarget)
  await assertOpenMenu(desktopApp.cdp, campTarget, ['置顶', '重命名', '删除'], 1, '置顶')
  await pressKey(desktopApp.cdp, 'End')
  await assertHighlightedItem(desktopApp.cdp, '删除')
  await pressKey(desktopApp.cdp, 'Home')
  await assertHighlightedItem(desktopApp.cdp, '置顶')
  await pressKey(desktopApp.cdp, 'ArrowDown')
  await assertHighlightedItem(desktopApp.cdp, '重命名')
  await pressKey(desktopApp.cdp, 'ArrowDown')
  await assertHighlightedItem(desktopApp.cdp, '删除')
  await pressKey(desktopApp.cdp, 'Escape')
  await assertMenuClosedWithFocus(desktopApp.cdp, campTarget)

  await openMenuByKeyboard(desktopApp.cdp, campTarget)
  await pressKey(desktopApp.cdp, 'Enter')
  await assertTargetMoved(desktopApp.cdp, campTarget, '.pinned-navigation')
  await openMenuByKeyboard(desktopApp.cdp, campTarget)
  await assertOpenMenu(desktopApp.cdp, campTarget, ['取消置顶', '重命名', '删除'], 1, '取消置顶')
  const pinnedCampMenuCapture = join(outputDir, 'camp-menu-pinned-day-1440x920.png')
  await capture(desktopApp.cdp, pinnedCampMenuCapture)
  await pressKey(desktopApp.cdp, 'Enter')
  await assertTargetMoved(desktopApp.cdp, campTarget, '.navigation-projects')

  await renameCampFromMenu(desktopApp.cdp, campTarget)
  await assertClickOutsideClosesMenu(desktopApp.cdp, campTarget)

  const deleteTarget = `camp:${fixture.deleteCampId}`
  await openDeleteDialog(desktopApp.cdp, deleteTarget)
  const deleteDialogCapture = join(outputDir, 'delete-dialog-day-1440x920.png')
  await capture(desktopApp.cdp, deleteDialogCapture)
  await pressKey(desktopApp.cdp, 'Escape')
  await waitForExpression(desktopApp.cdp, `!document.querySelector('.camp-action-dialog')`)
  await waitForTargetFocus(desktopApp.cdp, deleteTarget)
  await openDeleteDialog(desktopApp.cdp, deleteTarget)
  await clickButton(desktopApp.cdp, '.camp-action-dialog .danger-button', '永久删除')
  await waitForExpression(desktopApp.cdp, `(() => {
    const target = ${JSON.stringify(deleteTarget)}
    return ![...document.querySelectorAll('[data-sidebar-menu-target]')]
      .some((element) => element.dataset.sidebarMenuTarget === target)
      && !document.querySelector('.camp-action-dialog')
  })()`, 15_000)
  await assertHoverAndFocusVisibility(desktopApp.cdp, campTarget)

  await closeApp(desktopApp)
  desktopApp = null
  await wait(500)

  compactApp = await launchApp(firstPort + 1, 1040, 700, true)
  await setTheme(compactApp.cdp, 'day')
  await compactApp.cdp.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 1
  })
  await wait(100)
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
  await assertOpenMenu(compactApp.cdp, compactTarget, ['置顶', '重命名', '删除'], 1, '置顶')
  const compactMenuCapture = join(outputDir, 'camp-menu-compact-1040x700-reduced-motion.png')
  await capture(compactApp.cdp, compactMenuCapture)
  await pressKey(compactApp.cdp, 'Escape')
  await assertMenuClosedWithFocus(compactApp.cdp, compactTarget)

  const persistedPins = await evaluate(
    compactApp.cdp,
    'window.rovai.navigationPins.get()',
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
      projectAndShowAllCountsHidden: true,
      hoverFocusOpenAndCoarsePointerVisibility: true,
      arrowHomeEndEscapeAndOutsideClick: true,
      projectAndCampPinMigrationWithFocus: true,
      renameAndDeleteDialogs: true,
      permanentDelete: true,
      restartPersistence: true,
      menuViewportCollision: true,
      longTitleTruncation: true,
      reducedMotion: true,
      desktopAndCompactHorizontalOverflow: false
    },
    captures: {
      desktop: desktopCapture,
      projectMenu: projectMenuCapture,
      pinnedCampMenu: pinnedCampMenuCapture,
      deleteDialog: deleteDialogCapture,
      compactMenu: compactMenuCapture
    }
  }, null, 2))
} finally {
  if (desktopApp) await closeApp(desktopApp)
  if (compactApp) await closeApp(compactApp)
}

async function createFixtureCamps() {
  const core = startCore(dataDir)
  try {
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
    for (let index = 1; index <= 6; index += 1) {
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
  } finally {
    await core.stop()
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
      projectMenus: projectGroups.reduce((count, group) => count + group.querySelectorAll('.group-menu-trigger').length, 0),
      quickChatProjectMenus: quickChat?.querySelectorAll('.group-menu-trigger').length ?? -1,
      quickChatFolder: Boolean(quickChat?.querySelector('.project-folder-glyph')),
      legacyDirectPins: document.querySelectorAll('.group-pin-button, .row-pin-button').length,
      legacyMenus: document.querySelectorAll('.camp-row-menu').length,
      projectCounts: document.querySelectorAll('.camp-group-count').length,
      showAllLabels: [...document.querySelectorAll('.show-all-camps')].map((button) => button.textContent?.trim()),
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
  assert(state.legacyDirectPins === 0 && state.legacyMenus === 0 && state.projectCounts === 0,
    `${context} retained a legacy sidebar action/count control: ${JSON.stringify(state)}`)
  assert(state.showAllLabels.includes('查看全部')
      && state.showAllLabels.every((label) => label === '查看全部' || label === '收起'),
  `${context} show-all labels exposed counts: ${JSON.stringify(state.showAllLabels)}`)
  assert(!state.sidebarOverflow && !state.documentOverflow,
    `${context} sidebar overflowed horizontally: ${JSON.stringify(state)}`)
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
  await clickButton(cdp, '.camp-action-dialog button', '保存')
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
      .some((button) => button.textContent?.trim() === '永久删除')
  })`)
  assert(state.title.includes('永久删除')
      && state.description.includes('此操作不能撤销')
      && state.dangerButton,
  `Delete confirmation semantics were incomplete: ${JSON.stringify(state)}`)
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

async function request(cdp, method, params = {}) {
  return evaluate(cdp,
    `window.rovai.request(${JSON.stringify(method)}, ${JSON.stringify(params)})`, true)
}

async function setTheme(cdp, preference) {
  await evaluate(cdp, `window.rovai.appearance.setPreference(${JSON.stringify(preference)})`, true)
  await waitForExpression(cdp, `document.documentElement.dataset.theme === 'day'`)
}

async function launchApp(port, width, height, reducedMotion) {
  const executable = join(appPath, 'Contents', 'MacOS', 'Rovai-ai')
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

function startCore(dataDirectory) {
  const child = spawn(join(root, 'resources', 'bin', 'rovai-core'), ['--data-dir', dataDirectory], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, TMPDIR: runtimeTempDir }
  })
  child.stderr.pipe(process.stderr)
  const pending = new Map()
  let nextId = 1
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line)
    if (message.method) return
    const request = pending.get(message.id)
    if (!request) return
    clearTimeout(request.timer)
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  })
  const request = (method, params = {}) => new Promise((resolveRequest, rejectRequest) => {
    const id = nextId++
    const timer = setTimeout(() => {
      pending.delete(id)
      rejectRequest(new Error(`Timed out waiting for ${method}`))
    }, 30_000)
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer })
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  })
  const stop = async () => {
    if (child.killed || child.exitCode !== null) return
    child.stdin.end()
    await Promise.race([
      new Promise((resolveClose) => child.once('close', resolveClose)),
      wait(3_000)
    ])
    if (child.exitCode === null) child.kill('SIGTERM')
  }
  return { request, stop }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))
}
