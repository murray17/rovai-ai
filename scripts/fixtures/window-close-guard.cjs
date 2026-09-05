const assert = require('node:assert/strict')
const { once } = require('node:events')
const { mkdirSync } = require('node:fs')
const { isAbsolute, join } = require('node:path')
const { app, BrowserWindow } = require('electron')

const [handlerPath, userData] = process.argv.slice(2)
assert.ok(isAbsolute(handlerPath) && isAbsolute(userData))
mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)
app.setPath('sessionData', join(userData, 'session'))
const { createWindowCloseHandler } = require(handlerPath)
let quitRequests = 0
app.on('before-quit', () => { quitRequests += 1 })
// Exercise macOS close-only semantics on every fixture host; do not quit on last close.
app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  await window.loadURL('data:text/html,<p>Unsaved Draft fixture</p>')
  let prepareCount = 0
  let release
  let reject
  let failed
  const failureReported = new Promise(resolve => { failed = resolve })
  window.on('close', createWindowCloseHandler(window, () => {
    prepareCount += 1
    return new Promise((resolve, fail) => { release = resolve; reject = fail })
  }, failed))

  window.close()
  window.close()
  assert.equal(prepareCount, 1)
  assert.equal(window.isDestroyed(), false, 'Renderer must survive pending preparation')
  reject(new Error('Draft save failed'))
  assert.equal((await failureReported).message, 'Draft save failed')
  assert.equal(window.isDestroyed(), false, 'failed save must keep the window open')

  const closed = once(window, 'closed')
  window.close()
  assert.equal(prepareCount, 2, 'native close must retry failed preparation')
  release()
  await closed
  assert.equal(prepareCount, 2, 'prepared close must not recurse into another save')
  assert.equal(quitRequests, 0, 'standalone window close must not request App quit')

  const reopened = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  await reopened.loadURL('data:text/html,<p>Reopened window</p>')
  assert.equal(reopened.isDestroyed(), false)
  console.log(JSON.stringify({ ok: true, prepareCount, quitRequests }))
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
