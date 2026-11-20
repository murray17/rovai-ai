const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { isAbsolute, join, dirname } = require('node:path')
const { app, BrowserWindow } = require('electron')

const [renderer, userData] = process.argv.slice(2)
assert.ok(isAbsolute(renderer) && isAbsolute(userData), 'The startup fixture requires isolated absolute paths')
mkdirSync(userData, { recursive: true })
mkdirSync(join(userData, 'managed-skill-library'), { recursive: true })
app.setPath('userData', userData)
app.setPath('sessionData', join(userData, 'session'))

// Production Renderer with a controlled local API. No Core, SQLite, Skill Library,
// Runtime, network content, or daily App is started or accessed by this fixture.
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: process.platform === 'linux' || process.platform === 'win32',
    width: 1040,
    height: 700,
    useContentSize: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false }
  })
  window.webContents.on('console-message', event => console.error(event.message))
  await window.loadFile(renderer)
  if (process.env.ROVAI_PROJECT_DIRECTORIES_ONLY === '1') {
    const report = await window.webContents.executeJavaScript('window.startupTest.runProjects()', true)
    writeFileSync(join(dirname(userData), 'project-save-failure.png'), (await window.webContents.capturePage()).toPNG())
    console.log(JSON.stringify(report)); app.exit(0); return
  }
  const projects = await window.webContents.executeJavaScript('window.startupTest.runProjects()', true)
  writeFileSync(join(dirname(userData), 'project-save-failure.png'), (await window.webContents.capturePage()).toPNG())
  const report = await window.webContents.executeJavaScript('window.startupTest.run()', true)
  report.cases.push(...projects.cases)
  for (const theme of ['day', 'night']) {
    for (const collapsed of [false, true]) {
      const alignment = await window.webContents.executeJavaScript(`window.startupTest.captureNavigation(${JSON.stringify(theme)}, ${collapsed})`, true)
      // Compare at one Chromium layout unit, retaining the approved 1px offset
      // while ignoring smaller fractional text-baseline measurements.
      const layoutAlignment = Object.fromEntries(Object.entries(alignment).map(([key, value]) => [key, Math.round(value * 64) / 64]))
      assert.deepEqual(layoutAlignment, { control: 20, title: 19, actions: 19 }, 'Preserve the approved 1px offset from the original Camp header')
      writeFileSync(join(dirname(userData), `navigation-camp-${theme}-${collapsed ? 'collapsed' : 'expanded'}.png`), (await window.webContents.capturePage()).toPNG())
    }
    await window.webContents.executeJavaScript(`window.startupTest.captureStoppedThread(${JSON.stringify(theme)})`, true)
    writeFileSync(join(dirname(userData), `navigation-stopped-${theme}.png`), (await window.webContents.capturePage()).toPNG())
  }
  for (const theme of ['day', 'night']) {
    for (const state of ['loading', 'blocked', 'local-error']) {
      await window.webContents.executeJavaScript(`window.startupTest.capture(${JSON.stringify(theme)}, ${JSON.stringify(state)})`, true)
      const capture = await window.webContents.capturePage()
      writeFileSync(join(dirname(userData), `startup-${state}-${theme}-1040x700.png`), capture.toPNG())
    }
  }
  for (const theme of ['day', 'night']) {
    for (const state of ['members', 'help', 'empty']) {
      await window.webContents.executeJavaScript(`window.startupTest.captureNewConversation(${JSON.stringify(theme)}, ${JSON.stringify(state)})`, true)
      writeFileSync(join(dirname(userData), `new-conversation-${state}-${theme}.png`), (await window.webContents.capturePage()).toPNG())
    }
  }
  window.webContents.debugger.attach('1.3')
  await window.webContents.executeJavaScript('window.startupTest.prepareNavigationSearch()', true)
  for (const [width, height] of [[1040, 700], [1440, 920]]) {
    await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    for (const theme of ['day', 'night', 'horizon', 'classic-red', 'ember']) {
      const layout = await window.webContents.executeJavaScript(`window.startupTest.layoutNavigationSearch(${JSON.stringify(theme)})`, true)
      assert.deepEqual(layout, { width, height })
      writeFileSync(join(dirname(userData), `navigation-search-${theme}-${width}x${height}.png`), (await window.webContents.capturePage()).toPNG())
    }
  }
  await window.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride')
  report.cases.push('Navigation search fits five themes at compact and large desktop sizes')
  await window.webContents.executeJavaScript('window.startupTest.exhaustNavigationSearchPages()', true)
  const searchKey = async (key, windowsVirtualKeyCode, modifiers = 0, text) => {
    const command = (type, extra) => window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
      type, key, code: key, windowsVirtualKeyCode, modifiers, ...extra
    })
    await command('keyDown', text ? { text, unmodifiedText: text } : {})
    await command('keyUp')
  }
  const searchFocus = selector => window.webContents.executeJavaScript(`document.activeElement.matches(${JSON.stringify(selector)})`)
  await searchKey('Tab', 9)
  assert.equal(await searchFocus('.search-status-action'), true)
  await searchKey('Tab', 9, 8)
  assert.equal(await searchFocus('.command-palette-input'), true)
  await searchKey('Tab', 9)
  await searchKey('Enter', 13, 0, '\r')
  assert.equal(await searchFocus('.command-palette-input'), true)
  assert.equal(await window.webContents.executeJavaScript('!!document.querySelector(".search-status-action")'), false)
  report.cases.push('Navigation search continuation supports native keyboard focus and activation')
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  })
  window.webContents.setZoomFactor(2)
  const compact = await window.webContents.executeJavaScript('window.startupTest.capture("night")', true)
  assert.equal(compact.width, 520)
  assert.equal(compact.height, 350)
  assert.equal(compact.reducedMotion, true)
  assert.equal(compact.animation, 'none')
  writeFileSync(join(dirname(userData), 'startup-night-200-percent-reduced-motion.png'), (await window.webContents.capturePage()).toPNG())
  for (const state of ['blocked', 'local-error']) {
    await window.webContents.executeJavaScript(`window.startupTest.capture("night", ${JSON.stringify(state)})`, true)
    writeFileSync(join(dirname(userData), `startup-${state}-night-200-percent.png`), (await window.webContents.capturePage()).toPNG())
  }
  await window.webContents.executeJavaScript('window.startupTest.captureNewConversation("night", "help")', true)
  writeFileSync(join(dirname(userData), 'new-conversation-help-200-percent.png'), (await window.webContents.capturePage()).toPNG())
  console.log(JSON.stringify(report))
  app.exit(report.ok ? 0 : 1)
}).catch(error => { console.error(error); app.exit(1) })
