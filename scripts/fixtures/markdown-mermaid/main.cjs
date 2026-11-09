const { app, BrowserWindow } = require('electron')
const { mkdirSync } = require('node:fs')
const { isAbsolute, join } = require('node:path')
const profile = app.commandLine.getSwitchValue('user-data-dir')
if (!profile || !isAbsolute(profile)) throw new Error('An isolated absolute user-data-dir is required')
app.setPath('userData', profile)
mkdirSync(join(profile, 'managed-skill-library'), { recursive: true })
app.whenReady().then(() => {
  const window = new BrowserWindow({ show: false, width: 1440, height: 920,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } })
  void window.loadFile(app.commandLine.getSwitchValue('mermaid-page'))
})
app.on('window-all-closed', () => app.quit())
