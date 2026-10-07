// Opt-in acceptance transport: real packaged Renderer -> preload -> Core IPC.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { realpath, writeFile } from 'node:fs/promises'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
export async function startPackagedHubAcceptance({ app, data, cwd, onNotification }) {
  const reservation = createServer()
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const port = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  const child = spawn(join(app, 'Contents/MacOS/Rovai AI'), [
    `--user-data-dir=${data}`, `--remote-debugging-port=${port}`
  ], { cwd, env: { ...process.env, ROVAI_ALLOW_ISOLATED_INSTANCE: '1', ROVAI_DISABLE_AUTO_UPDATE_CHECKS: '1' },
    stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = '', socket, sequence = 0
  const pending = new Map()
  child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-16_384) })
  const stop = async () => {
    if (socket?.readyState === WebSocket.OPEN) {
      try { await Promise.race([send('Browser.close'), sleep(1500)]) } catch { /* closing tears down CDP */ }
      socket.close()
    }
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(5000)])
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
        await new Promise(resolve => child.once('exit', resolve))
      }
    }
    return { code: child.exitCode, signal: child.signalCode, stderrTail: stderr }
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 60_000)
    pending.set(id, { resolve, reject, timer })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error('Packaged Renderer evaluation failed: ' + JSON.stringify(result.exceptionDetails))
    return result.result?.value
  }
  try {
    let target
    for (let i = 0; i < 200 && !target; i++) {
      try { target = (await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json())).find(t => t.type === 'page') } catch { /* startup */ }
      if (!target) await sleep(100)
    }
    assert(target, 'packaged App did not expose its Renderer')
    socket = new WebSocket(target.webSocketDebuggerUrl)
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(String(data))
      if (message.method === 'Runtime.bindingCalled' && message.params.name === 'rovaiAcceptanceEvent') {
        onNotification?.(JSON.parse(message.params.payload))
      }
      const entry = pending.get(message.id)
      if (!entry) return
      pending.delete(message.id); clearTimeout(entry.timer)
      if (message.error) entry.reject(new Error(message.error.message))
      else entry.resolve(message.result)
    })
    socket.addEventListener('close', () => {
      for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('CDP closed')) }
      pending.clear()
    })
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', reject, { once: true })
    })
    await send('Runtime.enable'); await send('Page.enable')
    let ready = false
    for (let i = 0; i < 450 && !ready; i++) {
      ready = await evaluate('Boolean(window.rovai && document.querySelector(".app-shell"))')
      if (!ready) await sleep(100)
    }
    assert(ready, 'packaged App shell is not ready')
    await send('Runtime.addBinding', { name: 'rovaiAcceptanceEvent' })
    await evaluate('window.rovai.onEvent(event => window.rovaiAcceptanceEvent(JSON.stringify(event))); true')
    const request = (method, params = {}) => evaluate(`window.rovai.request(${JSON.stringify(method)}, ${JSON.stringify(params)})`)
    let health
    for (let i = 0; i < 600 && !health; i++) {
      const result = await evaluate('window.rovai.request("health.check").then(value => ({ok:true,value}), error => ({ok:false,error}))')
      if (result.ok) health = result.value
      else if (result.error?.code !== 'full_core_unavailable') throw new Error('Packaged Core startup: ' + JSON.stringify(result.error))
      if (!health) await sleep(100)
    }
    assert(health, 'packaged full Core did not become ready')
    assert.equal(await realpath(health.database.path), await realpath(join(data, 'rovai.sqlite')))
    return { pid: child.pid, request, stop,
      async capture(path) {
        await evaluate('(() => { const item = [...document.querySelectorAll("button")].find(node => node.textContent?.includes("Native Hub isolated product acceptance")); item?.click(); return Boolean(item) })()')
        await sleep(1000)
        const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
        await writeFile(path, Buffer.from(image.data, 'base64'), { mode: 0o600 })
      }
    }
  } catch (error) { await stop(); throw error }
}
