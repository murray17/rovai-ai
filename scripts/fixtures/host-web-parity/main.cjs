const { app, BrowserWindow } = require('electron')
const { resolve } = require('node:path')
const profile = resolve(process.argv[2])
app.setPath('userData', profile)
app.setPath('sessionData', profile)
app.commandLine.appendSwitch('remote-debugging-port', '0')
app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 1440, height: 920, useContentSize: true, show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } })
  window.loadURL('about:blank')
})
app.on('window-all-closed', () => app.quit())
