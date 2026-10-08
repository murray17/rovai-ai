const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { dirname, isAbsolute, join } = require('node:path')
const { app, BrowserWindow } = require('electron')
const [renderer, userData, mode = 'standard'] = process.argv.slice(2)
let stage = 'startup'
assert(isAbsolute(renderer) && isAbsolute(userData))
mkdirSync(userData, { recursive: true })
app.setPath('userData', userData); app.setPath('sessionData', join(userData, 'session'))
// In-memory Renderer projections only. No Core, SQLite, Skill Library or Runtime.
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: process.platform === 'linux', width: 1440, height: 920, useContentSize: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } })
  await window.loadFile(renderer, mode === 'large-diff'
    ? { query: { largeDiff: '1' } }
    : mode === 'editor-pointer' ? { query: { pointerCatalog: '1' } } : undefined)
  const waitFor = async (expression, message, timeout = 6000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await window.webContents.executeJavaScript(expression, true)) return
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    throw new Error(message)
  }
  const pointFor = async selector => window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element) return null
    const bounds = element.getBoundingClientRect()
    return { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) }
  })()`, true)
  const click = async selector => {
    const point = await pointFor(selector)
    assert(point, `No pointer target for ${selector}`)
    window.webContents.sendInputEvent({ type: 'mouseMove', ...point })
    window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
    window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 })
  }
  const wheel = async selector => {
    const point = await pointFor(selector)
    assert(point, `No wheel target for ${selector}`)
    await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY: 1000 })
  }
  const settle = () => window.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 250))', true)
  if (mode === 'editor-pointer') {
    window.webContents.debugger.attach('1.3')
    window.setContentSize(1040, 700)
    await waitFor('window.innerWidth === 1040 && window.innerHeight === 700', 'Mission editor pointer fixture did not resize')
    await waitFor("!!document.querySelector('.mission-board-card')", 'Mission board did not load for editor pointer acceptance')
    await click('.mission-new-entry')
    await waitFor("!!document.querySelector('.mission-create-dialog')", 'Pointer click did not open Mission creation', 1500)
    await settle()

    await click('.mission-create-dialog .mission-editor-project-property')
    await waitFor("!!document.querySelector('.mission-editor-project-popover')", 'Pointer click did not open the project picker', 1500)
    await settle()
    await wheel('.mission-editor-project-list')
    await waitFor("document.querySelector('.mission-editor-project-list')?.scrollTop > 0 && document.querySelector('.mission-create-dialog')?.contains(document.querySelector('.mission-editor-project-popover'))", 'Project picker did not remain in the Mission dialog and scroll under wheel input', 1500)
    await click('.mission-editor-project-list .compact-option:last-of-type')
    await waitFor("!!document.querySelector('.mission-create-dialog') && !document.querySelector('.mission-editor-project-popover') && document.querySelector('.mission-editor-project-property')?.textContent?.includes('示例项目 14')", 'Project pointer selection did not commit inside the Mission dialog', 1500)
    await settle()

    await click('.mission-create-dialog .mission-editor-team-property')
    await waitFor("!!document.querySelector('.mission-editor-team-popover')", 'Pointer click did not open the team picker', 1500)
    await settle()
    await waitFor("document.querySelector('.mission-create-dialog')?.contains(document.querySelector('.mission-editor-team-popover'))", 'Team picker escaped or closed after pointer input', 1500)
    await wheel('.mission-editor-team-list')
    await waitFor("document.querySelector('.mission-editor-team-list')?.scrollTop > 0 && !!document.querySelector('.mission-editor-team-popover')", 'Team picker did not remain open and scroll under wheel input', 1500)
    await click('.mission-editor-team-list .mission-editor-team-row:last-child .mission-editor-team-member')
    await waitFor("!!document.querySelector('.mission-create-dialog') && !!document.querySelector('.mission-editor-team-popover') && document.querySelector('.mission-editor-team-count')?.textContent?.includes('已选 19 / 20')", 'Team pointer selection closed the picker or failed to toggle', 1500)
    await click('.mission-editor-team-footer .compact-primary')
    await waitFor("!!document.querySelector('.mission-create-dialog') && !document.querySelector('.mission-editor-team-popover')", 'Team completion did not return to the Mission dialog', 1500)
    await settle()

    await click('.mission-create-dialog .mission-editor-tag-property')
    await waitFor("!!document.querySelector('.mission-editor-tag-popover')", 'Pointer click did not open the tag picker', 1500)
    await settle()
    await wheel('.mission-tag-options')
    await waitFor("document.querySelector('.mission-tag-options')?.scrollTop > 0 && document.querySelector('.mission-create-dialog')?.contains(document.querySelector('.mission-editor-tag-popover'))", 'Tag picker did not remain in the Mission dialog and scroll under wheel input', 1500)
    await click('.mission-editor-tag-option:last-of-type')
    await waitFor("!!document.querySelector('.mission-create-dialog') && !!document.querySelector('.mission-editor-tag-popover') && !!document.querySelector('.mission-editor-tag-option[aria-checked=true]')", 'Tag pointer selection closed the picker or failed to toggle', 1500)
    console.log(JSON.stringify({ ok: true, cases: ['project/team/tag wheel input and pointer selection remain inside the Mission editor'] }))
    app.exit(0)
    return
  }
  if (mode === 'wide-direct-expand') {
    window.setContentSize(2560, 1440)
    window.webContents.setZoomFactor(1)
    await waitFor("document.querySelector('.navigation-shell')?.clientWidth >= 2500", 'Wide Mission fixture did not resize')
    await waitFor("!!document.querySelector('.mission-board-card')", 'Wide Mission board did not load')
    await window.webContents.executeJavaScript(`(() => {
      localStorage.setItem('rovai.mission-drawer-width', '1906')
      document.querySelector('.mission-board-card').click()
    })()`, true)
    await waitFor("!!document.querySelector('.mission-drawer .mission-drawer-resize-handle')", 'Wide Mission drawer did not open')
    const point = await window.webContents.executeJavaScript(`(() => {
      const handle = document.querySelector('.mission-drawer-resize-handle')
      const drawer = document.querySelector('.mission-drawer')
      const shell = document.querySelector('.navigation-shell')
      const handleBounds = handle.getBoundingClientRect()
      const drawerBounds = drawer.getBoundingClientRect()
      const shellBounds = shell.getBoundingClientRect()
      const rail = parseFloat(getComputedStyle(shell).getPropertyValue('--rail-width')) || 0
      const scale = shellBounds.width / shell.clientWidth
      return {
        x: Math.round(handleBounds.x + handleBounds.width / 2),
        y: Math.round(handleBounds.y + 96),
        snapX: Math.round(shellBounds.left + (rail + 48) * scale),
        logicalWidth: Number(handle.getAttribute('aria-valuenow')),
        renderedWidth: drawerBounds.width
      }
    })()`, true)
    assert(point.logicalWidth > 1400, 'Wide acceptance must begin above the ordinary content cap')
    assert(Math.abs(point.renderedWidth - point.logicalWidth) <= 2,
      `Wide Mission drawer rendered ${point.renderedWidth}px for a ${point.logicalWidth}px logical width`)
    window.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y })
    window.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    const expandX = point.snapX - 8
    window.webContents.sendInputEvent({ type: 'mouseMove', x: expandX, y: point.y, button: 'left' })
    await waitFor("!!document.querySelector('.mission-full')", 'Direct wide drag did not expand before release')
    const full = await window.webContents.executeJavaScript(`(() => ({
      width: document.querySelector('.mission-full').getBoundingClientRect().width,
      available: document.querySelector('.mission-active-content').getBoundingClientRect().width
    }))()`, true)
    assert(Math.abs(full.width - full.available) <= 2,
      `Expanded Mission rendered ${full.width}px in a ${full.available}px workspace`)
    window.webContents.sendInputEvent({ type: 'mouseUp', x: expandX, y: point.y, button: 'left', clickCount: 1 })
    console.log(JSON.stringify({ ok: true, cases: [], layouts: {
      wideDrawerLogicalWidth: point.logicalWidth,
      wideDrawerRenderedWidth: Math.round(point.renderedWidth),
      wideFullWidth: Math.round(full.width),
      wideDirectExpandedBeforeRelease: true
    } }))
    app.exit(0)
    return
  }
  let narrowLayout = null
  if (mode === 'standard') {
    await waitFor("!!document.querySelector('.mission-board-card')", 'Mission board did not load for narrow-window acceptance', 15000)
    for (const theme of ['day', 'night']) {
      await window.webContents.executeJavaScript(`document.documentElement.dataset.theme = '${theme}'`, true)
      await settle()
      writeFileSync(join(dirname(userData), `mission-board-${theme}.png`), (await window.webContents.capturePage()).toPNG())
    }
    await window.webContents.executeJavaScript("document.documentElement.dataset.theme = 'day'", true)
    stage = 'narrow resize'
    window.setContentSize(820, 700)
    await waitFor('window.innerWidth === 820 && window.innerHeight === 700', 'Narrow Mission fixture did not resize')
    try {
      await waitFor("(() => { const nav = document.querySelector('.mission-lane-nav'); const host = document.querySelector('.mission-board-scroll'); return !!nav && !!host && getComputedStyle(nav).display === 'flex' && host.scrollWidth > host.clientWidth })()", 'Narrow Mission board did not expose horizontal lane navigation')
    } catch (error) {
      const diagnostic = await window.webContents.executeJavaScript(`(() => {
        const nav = document.querySelector('.mission-lane-nav'), host = document.querySelector('.mission-board-scroll')
        return { innerWidth, innerHeight, nav: nav ? getComputedStyle(nav).display : null, view: host?.dataset.view ?? null, clientWidth: host?.clientWidth ?? null, scrollWidth: host?.scrollWidth ?? null, columns: document.querySelectorAll('.mission-column').length }
      })()`, true)
      throw new Error(`${error.message}: ${JSON.stringify(diagnostic)}`)
    }
    const narrow = await window.webContents.executeJavaScript(`(() => {
      const host = document.querySelector('.mission-board-scroll')
      const widths = [...document.querySelectorAll('.mission-column')].map(column => column.getBoundingClientRect().width)
      return { minimumLaneWidth: Math.min(...widths), hostWidth: host.clientWidth, boardWidth: host.scrollWidth }
    })()`, true)
    assert(narrow.minimumLaneWidth >= 277, `Narrow Mission lanes collapsed to ${narrow.minimumLaneWidth}px`)
    stage = 'narrow lane navigation'
    await window.webContents.executeJavaScript("document.querySelector('.mission-lane-nav button:last-child')?.click()", true)
    await settle()
    await waitFor("(() => { const host = document.querySelector('.mission-board-scroll'); const button = document.querySelector('.mission-lane-nav button:last-child'); return !!host && !!button && host.scrollLeft > 20 && button.getAttribute('aria-pressed') === 'true' })()", 'Narrow status control did not move the horizontal board viewport')
    narrowLayout = { narrowLaneWidth: Math.round(narrow.minimumLaneWidth), narrowBoardScrollable: narrow.boardWidth > narrow.hostWidth }
    stage = 'desktop restore'
    window.setContentSize(1440, 920)
    await waitFor('window.innerWidth === 1440 && window.innerHeight === 920', 'Mission fixture did not restore its desktop size')
    await window.webContents.executeJavaScript("document.querySelector('.mission-board-scroll')?.scrollTo({ left: 0, behavior: 'auto' })", true)
  }
  const acceptance = mode === 'mentions' ? 'window.missionQA.runMentions()' : mode === 'large-diff'
    ? 'window.missionQA.runLargeDiff()'
    : mode === 'checkout-view' ? 'window.missionQA.runCheckoutView()'
      : mode === 'delete-trace' ? 'window.missionQA.runDeleteTrace()' : 'window.missionQA.run()'
  stage = 'renderer acceptance'
  const report = await window.webContents.executeJavaScript(`Promise.resolve().then(() => ${acceptance}).catch(error => ({ ok: false, error: error?.stack ?? String(error) }))`, true)
  if (!report.ok) {
    console.error(report.error ?? 'Mission acceptance failed without an error detail')
    console.log(JSON.stringify(report))
    app.exit(1)
    return
  }
  if (mode === 'mentions') {
    for (const theme of ['day', 'night']) {
      await window.webContents.executeJavaScript(`document.documentElement.dataset.theme = '${theme}'`, true)
      await settle()
      writeFileSync(join(dirname(userData), `mission-mentions-${theme}.png`), (await window.webContents.capturePage()).toPNG())
    }
  }
  if (mode === 'mentions' || mode === 'large-diff' || mode === 'checkout-view' || mode === 'delete-trace') {
    console.log(JSON.stringify(report)); app.exit(report.ok ? 0 : 1); return
  }
  report.layouts = narrowLayout
  stage = 'drawer reopen'
  await window.webContents.executeJavaScript(`(() => {
    localStorage.setItem('rovai.mission-drawer-width', '1040')
    document.querySelector('.mission-board-card')?.click()
  })()`, true)
  await waitFor("!!document.querySelector('.mission-drawer .mission-drawer-resize-handle') && !!document.querySelector('.file-preview-retained-host:not([hidden])')", 'Mission drawer did not reopen for pointer acceptance')
  const geometry = async () => window.webContents.executeJavaScript(`(() => {
    const handle = document.querySelector('.mission-drawer-resize-handle').getBoundingClientRect()
    const drawer = document.querySelector('.mission-drawer').getBoundingClientRect()
    const shell = document.querySelector('.navigation-shell').getBoundingClientRect()
    const rail = parseFloat(getComputedStyle(document.querySelector('.navigation-shell')).getPropertyValue('--rail-width')) || 0
    return { x: Math.round(handle.x + handle.width / 2), y: Math.round(handle.y + 96), right: drawer.right, snapX: shell.left + rail + 48 }
  })()`, true)
  let point = await geometry()
  window.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y })
  window.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 })
  const narrowX = Math.round(point.right - 640)
  window.webContents.sendInputEvent({ type: 'mouseMove', x: narrowX, y: point.y, button: 'left' })
  await waitFor("!document.querySelector('.file-preview-retained-host:not([hidden])') && getComputedStyle(document.querySelector('.mission-drawer .timeline-pane')).display !== 'none'", 'Pointer shrink did not preserve the message area before release')
  window.webContents.sendInputEvent({ type: 'mouseUp', x: narrowX, y: point.y, button: 'left', clickCount: 1 })

  point = await geometry()
  window.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y })
  window.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 })
  const expandX = Math.round(point.snapX - 8)
  window.webContents.sendInputEvent({ type: 'mouseMove', x: expandX, y: point.y, button: 'left' })
  await waitFor("!!document.querySelector('.mission-full')", 'Pointer drag did not expand before release')
  window.webContents.sendInputEvent({ type: 'mouseUp', x: expandX, y: point.y, button: 'left', clickCount: 1 })
  report.layouts = { ...report.layouts, pointerShrinkPreservedMessages: true, pointerExpandedBeforeRelease: true }
  console.log(JSON.stringify(report)); app.exit(report.ok ? 0 : 1)
}).catch(error => { console.error(`Mission fixture failed during ${stage}:`, error); app.exit(1) })
