const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { isAbsolute, join, dirname } = require('node:path')
const { app, BrowserWindow } = require('electron')
const [renderer, userData] = process.argv.slice(2)
assert.ok(isAbsolute(renderer) && isAbsolute(userData))
mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)
app.setPath('sessionData', join(userData, 'session'))
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1040, height: 700, useContentSize: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } })
  window.webContents.on('console-message', event => console.error(event.message))
  try {
    await window.loadFile(renderer)
    const report = await window.webContents.executeJavaScript('window.quoteTest.run()', true)
    assert.equal(report.ok, true)
    for (const theme of ['day', 'night']) {
      assert.equal(await window.webContents.executeJavaScript(`window.quoteTest.theme('${theme}')`, true), true)
      writeFileSync(join(dirname(userData), `${theme}.png`), (await window.webContents.capturePage()).toPNG())
    }
    window.webContents.setZoomFactor(2)
    assert.equal(await window.webContents.executeJavaScript("window.quoteTest.theme('day')", true), true)
    console.log(JSON.stringify(report))
    app.exit(0)
  } catch (error) { console.error(error); app.exit(1) }
})
