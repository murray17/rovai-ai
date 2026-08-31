const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { isAbsolute, join, dirname } = require('node:path')
const { app, BrowserWindow } = require('electron')

const [renderer, userData] = process.argv.slice(2)
assert.ok(isAbsolute(renderer) && isAbsolute(userData), 'The startup fixture requires isolated absolute paths')
mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)
app.setPath('sessionData', join(userData, 'session'))

// Production Renderer with a controlled local API. No Core, SQLite, Skill Library,
// Runtime, network content, or daily App is started or accessed by this fixture.
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: process.platform === 'linux',
    width: 1040,
    height: 700,
    useContentSize: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false }
  })
  window.webContents.on('console-message', event => console.error(event.message))
  await window.loadFile(renderer)
  const report = await window.webContents.executeJavaScript('window.startupTest.run()', true)
  for (const theme of ['day', 'night']) {
    for (const state of ['loading', 'blocked', 'local-error']) {
      await window.webContents.executeJavaScript(`window.startupTest.capture(${JSON.stringify(theme)}, ${JSON.stringify(state)})`, true)
      const capture = await window.webContents.capturePage()
      writeFileSync(join(dirname(userData), `startup-${state}-${theme}-1040x700.png`), capture.toPNG())
    }
  }
  window.webContents.debugger.attach('1.3')
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
  console.log(JSON.stringify(report))
  app.exit(report.ok ? 0 : 1)
}).catch(error => { console.error(error); app.exit(1) })
