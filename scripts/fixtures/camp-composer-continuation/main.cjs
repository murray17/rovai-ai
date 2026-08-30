const assert = require('node:assert/strict')
const { mkdirSync } = require('node:fs')
const { isAbsolute, join } = require('node:path')
const { app, BrowserWindow } = require('electron')

const [renderer, userData] = process.argv.slice(2)
assert.ok(isAbsolute(renderer) && isAbsolute(userData), 'The Composer fixture requires isolated absolute paths')
mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)
app.setPath('sessionData', join(userData, 'session'))

// Production Renderer with controlled Core projections. No Core, SQLite, Skill
// Library, Runtime, network content, or daily App is started or accessed here.
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: process.platform === 'linux', width: 1040, height: 700, useContentSize: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false }
  })
  window.webContents.on('console-message', event => console.error(event.message))
  await window.loadFile(renderer)
  const report = await window.webContents.executeJavaScript('window.continuationTest.run()', true)
  console.log(JSON.stringify(report))
  app.exit(report.ok ? 0 : 1)
}).catch(error => { console.error(error); app.exit(1) })
