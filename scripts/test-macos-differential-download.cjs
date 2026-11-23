const { app, autoUpdater } = require('electron')
const { mkdirSync, realpathSync } = require('node:fs')
const { isAbsolute, join } = require('node:path')

const data = app.commandLine.getSwitchValue('user-data-dir')
if (process.platform !== 'darwin' || process.env.ROVAI_ALLOW_ISOLATED_INSTANCE !== '1' || !isAbsolute(data)) {
  throw new Error('Run this macOS Electron test with an isolated --user-data-dir')
}
const userData = realpathSync(data)
realpathSync(join(userData, 'managed-skill-library'))
const sessionData = join(userData, 'session')
mkdirSync(sessionData, { recursive: true })
app.setPath('userData', userData)
app.setPath('sessionData', sessionData)
app.setAppLogsPath(join(userData, 'logs'))
app.dock?.hide()
// Each case creates a MacUpdater with two listeners on Electron's singleton.
autoUpdater.setMaxListeners(0)

const deadline = setTimeout(() => {
  console.error('macOS differential download tests timed out')
  app.exit(1)
}, 60_000)
app.whenReady().then(async () => {
  const { checkDifferentialDownloads } = await import('./lib/differential-update.test.mjs')
  await checkDifferentialDownloads(async (name, check) => {
    await check()
    console.log('PASS', name)
  })
  clearTimeout(deadline)
  app.exit(0)
}).catch(error => {
  console.error(error)
  app.exit(1)
})
