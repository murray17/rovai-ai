const assert = require('node:assert/strict')
const { mkdirSync } = require('node:fs')
const { isAbsolute, join } = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')

const [preload, userData] = process.argv.slice(2)
assert.ok(isAbsolute(preload) && isAbsolute(userData), 'The bridge test requires isolated absolute paths')
mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)
app.setPath('sessionData', join(userData, 'session'))

const failures = [
  { kind: 'domain_rejection', code: 'camp_not_open', retryable: false },
  { kind: 'infrastructure_failure', code: 'core_request_superseded', retryable: true },
  { kind: 'full_core_unavailable', code: 'full_core_unavailable', retryable: true },
  { kind: 'shutdown', code: 'desktop_shutdown', retryable: false }
].map((failure, index) => ({
  ...failure,
  message: `Structured failure ${index}: 工作区暂不可用`,
  generation: index + 1,
  details: { method: 'navigation.snapshot', nested: { retained: true }, values: [index, null] }
}))
ipcMain.handle('rovai:request', (_event, _method, params) => params?.kind === 'value'
  ? { kind: 'value', value: { unchanged: true, values: [1, null, 'ok'] } }
  : { kind: 'failure', failure: failures[params.index] })

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false }
  })
  try {
    await window.loadURL('data:text/html,<html><body>Isolated contextBridge regression</body></html>')
    const observations = await window.webContents.executeJavaScript(`(async () => {
      const value = await window.rovai.request('navigation.snapshot', { kind: 'value' })
      const failures = []
      for (let index = 0; index < 4; index++) {
        const pending = window.rovai.request('navigation.snapshot', { index })
        if (!(pending instanceof Promise)) throw new Error('Public API must remain Promise<T>')
        try {
          await pending
          throw new Error('Expected request rejection')
        } catch (failure) {
          failures.push(Object.fromEntries(
            ['kind', 'code', 'message', 'retryable', 'generation', 'details']
              .map(key => [key, failure[key] ?? null])
          ))
        }
      }
      return { value, failures }
    })()`)
    assert.deepEqual(observations.value, { unchanged: true, values: [1, null, 'ok'] })
    assert.deepEqual(observations.failures, failures, 'Renderer must receive every structured failure field')
    console.log(JSON.stringify({
      ok: true,
      electron: process.versions.electron,
      contextIsolation: window.webContents.getLastWebPreferences().contextIsolation,
      failureKinds: failures.length
    }))
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
}).catch(error => { console.error(error); app.exit(1) })
