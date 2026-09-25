import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { assertUserDataIsIsolated, seedCompletedOnboardingForAcceptance } from './lib/dev-desktop.mjs'

const appPath = process.argv[2]
const outputDirectory = process.argv[3] && resolve(process.argv[3])
if (!appPath || !outputDirectory) {
  throw new Error('Usage: ROVAI_CAPTURE_USER_DATA_DIR=<isolated path> node scripts/accept-rebuilt-skills-ui.mjs <Rovai AI.app> <output-directory>')
}
const userDataDirectory = assertUserDataIsIsolated(process.env.ROVAI_CAPTURE_USER_DATA_DIR)
const theme = process.env.ROVAI_CAPTURE_THEME ?? 'day'
const zoom = Number(process.env.ROVAI_CAPTURE_ZOOM_FACTOR ?? 1)
if (!['day', 'night'].includes(theme) || ![1, 2].includes(zoom)) {
  throw new Error('ROVAI_CAPTURE_THEME must be day or night and ROVAI_CAPTURE_ZOOM_FACTOR must be 1 or 2')
}
const width = Number(process.env.ROVAI_CAPTURE_WIDTH ?? 1440)
const height = Number(process.env.ROVAI_CAPTURE_HEIGHT ?? 920)
if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1040 || height < 700) {
  throw new Error('ROVAI_CAPTURE_WIDTH/HEIGHT must be valid desktop viewport dimensions')
}
const fixtureHome = join(dirname(userDataDirectory), 'native-home')
const nativeSkill = join(fixtureHome, '.codex', 'skills', 'acceptance-demo')
const nativePage = pageExpression('skills', 'Skills')
const toolboxPage = pageExpression('toolbox', '工具箱')
await mkdir(nativeSkill, { recursive: true })
await mkdir(join(nativeSkill, 'references'), { recursive: true })
await mkdir(outputDirectory, { recursive: true, mode: 0o700 })
await writeFile(join(nativeSkill, 'SKILL.md'), '---\nname: acceptance-demo\ndescription: Isolated Skills acceptance fixture\n---\n\n# Acceptance demo\n\nA local read-only discovery fixture.\n')
await writeFile(join(nativeSkill, 'references', 'example.md'), '# Reference file\n\nThe file switcher opened this document.\n')
for (const [directory, name] of [['.agents', 'shared-user-skill'], ['.qoder', 'qoder-user-skill']]) {
  const path = join(fixtureHome, directory, 'skills', name)
  await mkdir(path, { recursive: true })
  await writeFile(join(path, 'SKILL.md'), `---\nname: ${name}\ndescription: Isolated shared discovery fixture\n---\n\n# ${name}\n`)
}
seedCompletedOnboardingForAcceptance(userDataDirectory)

const port = await freePort()
const app = spawn(join(appPath, 'Contents', 'MacOS', 'Rovai AI'), [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDirectory}`
], {
  stdio: ['ignore', 'ignore', 'pipe'],
  env: {
    ...process.env,
    HOME: fixtureHome,
    CODEX_HOME: join(fixtureHome, '.codex'),
    QODER_CONFIG_DIR: join(fixtureHome, '.qoder'),
    ROVAI_ALLOW_ISOLATED_INSTANCE: '1'
  }
})
const stderr = []
app.stderr.on('data', (chunk) => stderr.push(String(chunk)))
let cdp
try {
  cdp = await connectCdp(await waitForTarget(port, stderr))
  await cdp.send('Page.bringToFront')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: width / zoom,
    height: height / zoom,
    deviceScaleFactor: zoom,
    mobile: false,
    screenWidth: width,
    screenHeight: height
  })
  await waitFor(cdp, `window.innerWidth === ${width / zoom} && window.innerHeight === ${height / zoom}`, 5_000)
  await waitFor(cdp, `Boolean(document.querySelector('.unified-primary-nav button[aria-label="新对话"]:not(:disabled)')) && !document.querySelector('.startup-gate')`, 45_000)
  await evaluate(cdp, `window.rovai.appearance.setPreference(${JSON.stringify(theme)})`)
  await waitFor(cdp, `document.documentElement.dataset.theme === ${JSON.stringify(theme)}`, 5_000)
  await evaluate(cdp, `(() => {
    const button = document.querySelector('.unified-sidebar-footer .sidebar-settings-main')
    button.click()
    return true
  })()`)
  await waitFor(cdp, `Boolean(document.querySelector('.settings-sidebar-menu'))`, 5_000)

  await openSection(cdp, 'Skills')
  await waitFor(cdp, `Boolean((${nativePage})?.querySelector('.rebuilt-skill-row strong'))`, 30_000)
  await waitFor(cdp, `(${nativePage})?.querySelector('.rebuilt-skills-content')?.textContent?.includes('A local read-only discovery fixture.')`, 5_000)
  const skills = await evaluate(cdp, `(() => {
    const panel = ${nativePage}
    const rows = [...panel.querySelectorAll('.rebuilt-skill-row strong')].map((item) => item.textContent.trim())
    return { rows, body: panel.querySelector('.rebuilt-skills-content')?.textContent ?? '',
      error: panel.querySelector('[role="alert"]')?.textContent ?? null,
      narrow: getComputedStyle(panel.querySelector('.rebuilt-skills-back')).display !== 'none',
      available: panel.querySelector('.rebuilt-skills-columns').getBoundingClientRect().width,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1 }
  })()`)
  if (skills.rows.join(',') !== 'acceptance-demo,shared-user-skill' ||
      !skills.body.includes('A local read-only discovery fixture.') || skills.error || skills.overflow ||
      skills.narrow !== (skills.available < 620)) {
    throw new Error(`Native Skills view did not match its isolated source: ${JSON.stringify(skills)}`)
  }
  const skillsSplitter = await exerciseSplitter(cdp, nativePage, 'rovai.native-skills-list-width.v1')
  const refreshAction = await checkAction(cdp, nativePage, '刷新')
  if (skills.narrow) await selectFirstRow(cdp, nativePage)
  await waitFor(cdp, `!document.querySelector('.page-zoom-indicator')`, 5_000)
  await evaluate(cdp, `(${nativePage}).querySelector('button.skill-file-current')?.click()`)
  await waitFor(cdp, `Boolean((${nativePage}).querySelector('.skill-file-directory'))`, 5_000)
  const fileMenu = await evaluate(cdp, `(() => {
    const page = ${nativePage}
    const element = page.querySelector('.skill-file-directory')
    const menu = element?.getBoundingClientRect()
    const bounds = page.getBoundingClientRect()
    return { top: menu?.top, bottom: menu?.bottom, width: menu?.width,
      pageTop: bounds.top, pageBottom: bounds.bottom,
      visibleAtCenter: menu ? element.contains(document.elementFromPoint(menu.left + menu.width / 2, menu.top + menu.height / 2)) : false }
  })()`)
  if (fileMenu.width < 200 || fileMenu.top < fileMenu.pageTop - 1 || fileMenu.bottom > fileMenu.pageBottom + 1 || !fileMenu.visibleAtCenter) {
    throw new Error(`Skill file menu is outside the visible settings area: ${JSON.stringify(fileMenu)}`)
  }
  await capture(cdp, join(outputDirectory, 'skills-file-menu.png'))
  await evaluate(cdp, `([...(${nativePage}).querySelectorAll('.skill-file-entry')].find((button) => button.getAttribute('aria-label') === 'references/example.md'))?.click()`)
  await waitFor(cdp, `(${nativePage}).querySelector('.rebuilt-skills-content')?.textContent?.includes('The file switcher opened this document.')`, 5_000)
  await evaluate(cdp, `(${nativePage}).querySelector('button.skill-file-current')?.click()`)
  await evaluate(cdp, `([...(${nativePage}).querySelectorAll('.skill-file-entry')].find((button) => button.getAttribute('aria-label') === 'SKILL.md'))?.click()`)
  await waitFor(cdp, `(${nativePage}).querySelector('.rebuilt-skills-content')?.textContent?.includes('A local read-only discovery fixture.')`, 5_000)
  await waitFor(cdp, `!document.querySelector('.page-zoom-indicator')`, 5_000)
  await capture(cdp, join(outputDirectory, 'skills.png'))
  const runtimeTrigger = await evaluate(cdp, `(() => {
    const rect = (${nativePage}).querySelector('.rebuilt-runtime-trigger').getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...runtimeTrigger, button: 'left', buttons: 1, clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...runtimeTrigger, button: 'left', buttons: 0, clickCount: 1 })
  await waitFor(cdp, `Boolean([...document.querySelectorAll('[role="menuitemradio"]')].find((item) => item.querySelector('strong')?.textContent.trim() === 'Qoder'))`, 5_000)
  const runtimeMenu = await evaluate(cdp, `(() => {
    const menu = document.querySelector('.runtime-model-picker-menu.member-runtime-menu')
    const scroll = menu?.querySelector('.runtime-picker-scroll')
    const items = [...(scroll?.querySelectorAll('[role="menuitemradio"]') ?? [])]
    if (!menu || !scroll || !items.length) return null
    scroll.scrollTop = scroll.scrollHeight
    const menuBounds = menu.getBoundingClientRect()
    const lastBounds = items.at(-1).getBoundingClientRect()
    return { count: items.length, scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight,
      scrollTop: scroll.scrollTop, lastLabel: items.at(-1).textContent.trim(),
      lastVisible: lastBounds.top >= menuBounds.top && lastBounds.bottom <= menuBounds.bottom }
  })()`)
  if (!runtimeMenu || runtimeMenu.count < 10 || runtimeMenu.scrollHeight <= runtimeMenu.clientHeight + 40 ||
      runtimeMenu.scrollTop <= 40 || !runtimeMenu.lastVisible) {
    throw new Error(`Skills Runtime menu cannot scroll to its last choice: ${JSON.stringify(runtimeMenu)}`)
  }
  await evaluate(cdp, `[...document.querySelectorAll('[role="menuitemradio"]')].find((item) => item.querySelector('strong')?.textContent.trim() === 'Qoder').click()`)
  await waitFor(cdp, `(${nativePage}).querySelector('.rebuilt-skills-list')?.textContent.includes('qoder-user-skill')`, 5_000)
  const qoderSources = await evaluate(cdp, `[...(${nativePage}).querySelectorAll('.rebuilt-skill-row strong')].map((item) => item.textContent.trim()).sort()`)
  if (qoderSources.join(',') !== 'qoder-user-skill,shared-user-skill') throw new Error(`Qoder shared user source is missing: ${JSON.stringify(qoderSources)}`)
  if (skills.narrow) await evaluate(cdp, `(${nativePage}).querySelector('.rebuilt-skills-back').click()`)
  await capture(cdp, join(outputDirectory, 'qoder-skills.png'))

  await openSection(cdp, '工具箱')
  await waitFor(cdp, `((${toolboxPage})?.querySelectorAll('.rebuilt-skill-row').length ?? 0) === 5`, 30_000)
  const toolbox = await evaluate(cdp, `(async () => {
    const views = await window.rovai.request('toolbox.list')
    const panel = ${toolboxPage}
    return { names: views.map((entry) => entry.name).sort(),
      defaults: views.map((entry) => [entry.name, entry.memberIds.length]),
      rows: panel.querySelectorAll('.rebuilt-skill-row').length,
      narrow: getComputedStyle(panel.querySelector('.rebuilt-skills-back')).display !== 'none',
      available: panel.querySelector('.rebuilt-skills-columns').getBoundingClientRect().width,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      error: document.querySelector('.error-banner')?.textContent ?? null }
  })()`)
  const expected = ['campfire', 'grill-duo', 'grill-duo-with-docs', 'member-studio', 'review-duo']
  if (toolbox.names.join(',') !== expected.join(',') || toolbox.rows !== 5 || toolbox.overflow || toolbox.error ||
      toolbox.narrow !== (toolbox.available < 620) ||
      toolbox.defaults.some(([name, count]) => name === 'member-studio' ? count !== 4 : count !== 0)) {
    throw new Error(`Toolbox defaults or layout changed: ${JSON.stringify(toolbox)}`)
  }
  const helpAnchor = await evaluate(cdp, `(() => {
    const rect = (${toolboxPage}).querySelector('.rebuilt-toolbox-help button')?.getBoundingClientRect()
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null
  })()`)
  if (!helpAnchor) throw new Error('Toolbox help trigger is missing')
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...helpAnchor, button: 'none', buttons: 0 })
  const help = await evaluate(cdp, `(() => {
    const trigger = (${toolboxPage}).querySelector('.rebuilt-toolbox-help button')
    const tip = (${toolboxPage}).querySelector('.rebuilt-toolbox-help-popover')
    const bounds = tip?.getBoundingClientRect()
    return { describedBy: trigger?.getAttribute('aria-describedby') === tip?.id,
      text: tip?.textContent, visibleOnHover: tip && getComputedStyle(tip).visibility === 'visible',
      insideViewport: bounds && bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight }
  })()`)
  if (!help.describedBy || !help.text?.includes('单次选用') || !help.visibleOnHover || !help.insideViewport) {
    throw new Error(`Toolbox help copy is not visible on hover: ${JSON.stringify(help)}`)
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1, button: 'none', buttons: 0 })
  const visibleOnFocus = await evaluate(cdp, `(() => {
    const trigger = (${toolboxPage}).querySelector('.rebuilt-toolbox-help button')
    trigger.focus()
    return getComputedStyle((${toolboxPage}).querySelector('.rebuilt-toolbox-help-popover')).visibility === 'visible'
  })()`)
  if (!visibleOnFocus) throw new Error('Toolbox help copy is not visible on keyboard focus')
  await evaluate(cdp, `(${toolboxPage}).querySelector('.rebuilt-toolbox-help button').blur()`)
  const toolboxSplitter = await exerciseSplitter(cdp, toolboxPage, 'rovai.toolbox-list-width.v1')
  if (Math.abs(toolbox.available - skills.available) > 1) throw new Error('Toolbox has extra outer padding compared with Skills')
  const descriptionAction = await checkAction(cdp, toolboxPage, '查看说明')
  if (toolbox.narrow) await selectFirstRow(cdp, toolboxPage)
  await waitFor(cdp, `!document.querySelector('.page-zoom-indicator')`, 5_000)
  await capture(cdp, join(outputDirectory, 'toolbox.png'))
  await evaluate(cdp, `(${toolboxPage}).querySelector('.rebuilt-toolbox-heading button')?.click()`)
  await waitFor(cdp, `document.querySelector('.rebuilt-description-body')?.textContent?.includes('篝火讨论')`, 5_000)
  const dialogState = await evaluate(cdp, `(() => {
    const dialog = document.querySelector('.rebuilt-description-dialog')
    const rect = dialog?.getBoundingClientRect()
    return { state: dialog?.getAttribute('data-state'), width: rect?.width, height: rect?.height,
      position: dialog && getComputedStyle(dialog).position, display: dialog && getComputedStyle(dialog).display }
  })()`)
  await capture(cdp, join(outputDirectory, 'toolbox-description.png'))
  if (dialogState.state !== 'open' || dialogState.width < 500 || dialogState.height < 200 || dialogState.position !== 'fixed') {
    throw new Error(`Toolbox description content did not open as a visible dialog: ${JSON.stringify(dialogState)}`)
  }
  await evaluate(cdp, `document.querySelector('.rebuilt-description-dialog button[aria-label="关闭说明"]')?.click()`)

  await evaluate(cdp, `(() => {
    const row = [...(${toolboxPage}).querySelectorAll('.rebuilt-skill-row')]
      .find((item) => item.querySelector('strong')?.textContent === 'campfire')
    row?.focus()
    row?.click()
    return Boolean(row) && document.activeElement === row
  })()`)
  await waitFor(cdp, `Boolean((${toolboxPage}).querySelector('.rebuilt-toolbox-member input'))`, 5_000)
  await evaluate(cdp, `(${toolboxPage}).querySelector('.rebuilt-toolbox-member input').click()`)
  await waitFor(cdp, `(async () => (await window.rovai.request('toolbox.list')).find((item) => item.name === 'campfire')?.memberIds.length === 1)()`, 8_000)
  await waitFor(cdp, `!(${toolboxPage}).querySelector('.rebuilt-skills-status')`, 5_000)
  await evaluate(cdp, `(${toolboxPage}).querySelector('.rebuilt-toolbox-member input').click()`)
  await waitFor(cdp, `(async () => (await window.rovai.request('toolbox.list')).find((item) => item.name === 'campfire')?.memberIds.length === 0)()`, 8_000)
  await openSection(cdp, 'Skills')
  await waitFor(cdp, `Boolean((${nativePage})?.querySelector('.rebuilt-skills-columns'))`, 5_000)
  if (!skillsSplitter.compact) {
    await waitFor(cdp, `Math.abs((${nativePage}).querySelector('.rebuilt-skills-list').getBoundingClientRect().width - ${skillsSplitter.savedWidth}) < 1`, 5_000)
  }
  await writeFile(join(outputDirectory, 'report.json'), `${JSON.stringify({
    schemaVersion: 1,
    theme,
    zoom,
    userDataDirectory,
    nativeSkillNames: skills.rows,
    qoderSkillNames: qoderSources,
    runtimeMenu,
    toolboxHelp: help,
    actions: { refresh: refreshAction, description: descriptionAction },
    splitters: { skills: skillsSplitter, toolbox: toolboxSplitter },
    toolboxDefaults: toolbox.defaults,
    toolboxToggleRestored: true,
    screenshots: ['skills-file-menu.png', 'skills.png', 'qoder-skills.png', 'toolbox.png', 'toolbox-description.png']
  }, null, 2)}\n`, { mode: 0o600 })
  process.stdout.write(`${join(outputDirectory, 'report.json')}\n`)
} catch (error) {
  if (cdp) await capture(cdp, join(outputDirectory, 'failure.png')).catch(() => {})
  throw error
} finally {
  cdp?.close()
  app.kill('SIGTERM')
  await Promise.race([new Promise((done) => app.once('close', done)), sleep(2_000)])
  if (app.exitCode === null) app.kill('SIGKILL')
}

async function checkAction(cdp, page, text) {
  const result = await evaluate(cdp, `(() => {
    const button = [...(${page}).querySelectorAll('.rebuilt-skill-action')].find((item) => item.textContent.trim() === ${JSON.stringify(text)})
    const icon = button?.querySelector('svg[aria-hidden="true"]')
    return { fontSize: button && getComputedStyle(button).fontSize, fontWeight: button && getComputedStyle(button).fontWeight,
      iconWidth: icon && getComputedStyle(icon).width, iconHeight: icon && getComputedStyle(icon).height }
  })()`)
  if (result.fontSize !== '12px' || result.fontWeight !== '500' || result.iconWidth !== '15px' || result.iconHeight !== '15px') {
    throw new Error(`${text} differs from the prototype: ${JSON.stringify(result)}`)
  }
  return result
}

async function exerciseSplitter(cdp, page, storageKey) {
  const state = () => evaluate(cdp, `(() => {
    const root = (${page}).querySelector('.rebuilt-skills-columns')
    const divider = root.querySelector('[role="separator"]')
    const bounds = root.getBoundingClientRect(), handle = divider.getBoundingClientRect()
    return { compact: root.dataset.compact === 'true', left: bounds.left, available: bounds.width,
      x: handle.left + handle.width / 2, y: handle.top + handle.height / 2,
      width: root.querySelector('.rebuilt-skills-list').getBoundingClientRect().width,
      detailWidth: root.querySelector('.rebuilt-skills-detail').getBoundingClientRect().width,
      separatorHidden: getComputedStyle(divider.parentElement).display === 'none',
      hitClass: document.elementFromPoint(handle.left + handle.width / 2, handle.top + handle.height / 2)?.className,
      resizing: root.hasAttribute('data-resizing'), ariaWidth: Number(divider.getAttribute('aria-valuenow')),
      savedWidth: Number(localStorage.getItem(${JSON.stringify(storageKey)})) }
  })()`)
  const initial = await state()
  if (initial.compact) {
    if (!initial.separatorHidden) throw new Error('Compact view still exposes a splitter')
    return { compact: true }
  }
  const max = Math.max(240, Math.min(560, Math.floor(initial.available - 391)))
  const expectWidth = async (expected) => {
    await waitFor(cdp, `Math.abs((${page}).querySelector('.rebuilt-skills-list').getBoundingClientRect().width - ${expected}) <= 1`, 5_000)
    const result = await state()
    if (Math.abs(result.width - expected) > 1 || result.ariaWidth !== Math.round(result.width) || result.detailWidth < 389) {
      throw new Error(`Splitter layout/ARIA is outside MCP bounds: ${JSON.stringify({ expected, result })}`)
    }
    return result
  }
  const mouse = (type, x, y, pressed = false, clickCount = 1) => cdp.send('Input.dispatchMouseEvent', {
    type, x, y, button: type === 'mouseMoved' && !pressed ? 'none' : 'left', buttons: pressed ? 1 : 0,
    ...(type === 'mouseMoved' ? {} : { clickCount })
  })
  const key = async (value, shift = false) => {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: value, modifiers: shift ? 8 : 0 })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: value })
  }
  for (const [x, expected] of [[initial.left + 10, 240], [initial.left + initial.available - 10, max]]) {
    const start = await state()
    await mouse('mouseMoved', start.x, start.y)
    await mouse('mousePressed', start.x, start.y, true)
    await mouse('mouseMoved', x, start.y, true)
    if (!(await state()).resizing) throw new Error(`Pointer drag did not start: ${JSON.stringify({ start, after: await state() })}`)
    await mouse('mouseReleased', x, start.y)
    await expectWidth(expected)
  }
  await key('Home')
  await expectWidth(240)
  await key('ArrowRight')
  await expectWidth(Math.min(max, 248))
  await key('ArrowRight', true)
  await expectWidth(Math.min(max, 272))
  await key('End')
  await expectWidth(max)
  const cancelStart = await state()
  await mouse('mousePressed', cancelStart.x, cancelStart.y, true)
  await mouse('mouseMoved', initial.left + 10, cancelStart.y, true)
  await key('Escape')
  await mouse('mouseReleased', initial.left + 10, cancelStart.y)
  await expectWidth(max)
  const resetWidth = Math.min(max, width / zoom >= 2300 ? 400 : width / zoom >= 1600 ? 360 : 320)
  const resetStart = await state()
  await mouse('mousePressed', resetStart.x, resetStart.y, true, 2)
  await mouse('mouseReleased', resetStart.x, resetStart.y, false, 2)
  await expectWidth(resetWidth)
  await key('ArrowRight')
  await key('Enter')
  await expectWidth(resetWidth)
  await key('ArrowRight')
  const saved = await expectWidth(Math.min(max, resetWidth + 8))
  if (saved.resizing || saved.savedWidth !== saved.width) throw new Error('Splitter did not persist the finished width')
  return { compact: false, min: 240, max, available: initial.available, savedWidth: saved.width,
    pointer: true, keyboard: true, cancel: true, reset: true }
}

async function selectFirstRow(cdp, page) {
  await evaluate(cdp, `(${page})?.querySelector('.rebuilt-skill-row')?.click()`)
  await waitFor(cdp, `getComputedStyle((${page}).querySelector('.rebuilt-skills-detail')).display !== 'none'`, 5_000)
}

function pageExpression(section, heading) {
  return `[...document.querySelectorAll('.settings-panel-${section} .rebuilt-skills-page')]
    .find((page) => page.querySelector('h1')?.textContent?.trim() === ${JSON.stringify(heading)})`
}

async function openSection(cdp, label) {
  const focused = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.settings-sidebar-menu button')]
      .find((item) => item.textContent?.trim() === ${JSON.stringify(label)})
    button?.focus()
    button?.click()
    return Boolean(button) && document.activeElement === button
  })()`)
  if (!focused) throw new Error(`${label} settings entry is unavailable or not keyboard focusable`)
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.result?.exceptionDetails) throw new Error(result.result.exceptionDetails.text)
  return result.result?.result?.value
}

async function waitFor(cdp, expression, timeoutMs) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try { if (await evaluate(cdp, expression)) return }
    catch { /* Core may still be starting. */ }
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${expression}`)
}

async function capture(cdp, path) {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  await writeFile(path, Buffer.from(result.result.data, 'base64'))
}

async function freePort() {
  const server = createServer()
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const port = server.address().port
  await new Promise((done) => server.close(done))
  return port
}

async function waitForTarget(port, stderr) {
  const started = Date.now()
  while (Date.now() - started < 20_000) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json())
      const page = targets.find((target) => target.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch { /* Electron is starting. */ }
    await sleep(150)
  }
  throw new Error(`Electron DevTools target did not start: ${stderr.join('')}`)
}

async function connectCdp(url) {
  const socket = new WebSocket(url)
  const pending = new Map()
  let nextId = 1
  await new Promise((done, reject) => {
    socket.addEventListener('open', done, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message)
  })
  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = nextId++
        pending.set(id, { resolve, reject })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
    close() { socket.close() }
  }
}

function sleep(ms) { return new Promise((done) => setTimeout(done, ms)) }
