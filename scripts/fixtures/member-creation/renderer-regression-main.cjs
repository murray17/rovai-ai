const assert = require('node:assert/strict')
const { mkdirSync } = require('node:fs')
const { isAbsolute, join } = require('node:path')
const { app, BrowserWindow } = require('electron')
const [renderer, userData, flow] = process.argv.slice(2)
assert(isAbsolute(renderer) && isAbsolute(userData))
mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)
app.setPath('sessionData', join(userData, 'session'))
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } })
  for (const preview of flow === 'user-images' ? ['bytes', 'blob'] : ['']) {
    await window.loadFile(renderer, { query: { flow, preview } })
    const result = await window.webContents.executeJavaScript('window.regressionResult.catch(error => ({ok:false,error:error.stack}))', true)
    assert.equal(result?.ok, true, result?.error)
    console.log(JSON.stringify(result))
  }
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
