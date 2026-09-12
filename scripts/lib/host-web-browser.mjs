import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'

export const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

// Used only by the real Host acceptance commands. Each caller owns an isolated
// profile and process; this helper never attaches to a user's existing browser.
export async function launchAcceptanceBrowser({ executable, args, env = process.env }) {
  const child = spawn(executable, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
  const closed = new Promise(resolve => child.once('close', resolve))
  let log = ''
  const collect = chunk => { log = (log + chunk).slice(-65_000) }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  let socket
  const close = async () => {
    socket?.close()
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 15_000)
    try { await closed } finally { clearTimeout(timer) }
  }
  try {
    let port
    for (let i = 0; i < 150; i++) {
      port = log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/)?.[1]
      if (port) break
      if (child.exitCode !== null) throw Error(log.slice(-2000))
      await pause(100)
    }
    assert.ok(port, log.slice(-2000))
    let target
    for (let i = 0; i < 100; i++) {
      target = (await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json())).find(t => t.type === 'page')
      if (target) break
      await pause(100)
    }
    assert.ok(target)
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', reject, { once: true })
    })
    let id = 0
    const pending = new Map()
    const errors = []
    const responses = []
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data))
      const request = pending.get(message.id)
      if (request) {
        pending.delete(message.id)
        clearTimeout(request.timer)
        message.error ? request.reject(message.error) : request.resolve(message.result)
      }
      if (message.method === 'Runtime.exceptionThrown') {
        errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
      }
      if (message.method === 'Network.responseReceived') {
        const { response, requestId } = message.params
        const path = new URL(response.url).pathname
        if (path.startsWith('/api/')) responses.push({ requestId, path, status: response.status })
      }
    })
    socket.addEventListener('close', () => {
      for (const request of pending.values()) {
        clearTimeout(request.timer)
        request.reject(Error('Acceptance browser closed'))
      }
      pending.clear()
    })
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const requestId = ++id
      const timer = setTimeout(() => { pending.delete(requestId); reject(Error(`CDP timed out: ${method}`)) }, 20_000)
      pending.set(requestId, { resolve, reject, timer })
      socket.send(JSON.stringify({ id: requestId, method, params }))
    })
    await send('Page.enable')
    await send('Runtime.enable')
    await send('Network.enable')
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 920, deviceScaleFactor: 1, mobile: false })
    const evaluate = async expression => {
      const reply = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (reply.exceptionDetails) throw Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text)
      return reply.result.value
    }
    return {
      send, evaluate, errors, responses, close,
      async key(key) {
        const params = { key, code: key, windowsVirtualKeyCode: key === 'Enter' ? 13 : 27 }
        await send('Input.dispatchKeyEvent', { type: 'keyDown', ...params })
        await send('Input.dispatchKeyEvent', { type: 'keyUp', ...params })
      },
      async click(expression) {
        const point = await evaluate(`(() => { const e = ${expression}; if (!e) throw Error('Click target missing: ' + ${JSON.stringify(expression)}); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 } })()`)
        // Native pointers enter the target before pressing. This also reveals
        // production hover controls whose pointer-events are otherwise disabled.
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
        await evaluate('new Promise(resolve => requestAnimationFrame(() => resolve(true)))')
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
      },
      async wait(expression, timeout = 12_000) {
        const deadline = Date.now() + timeout
        while (Date.now() < deadline) {
          if (await evaluate(expression)) return
          if (errors.length) throw Error(errors.join('\n'))
          await pause(100)
        }
        throw Error(`Timed out: ${expression}\n${await evaluate('document.body.innerText.slice(-4000)')}`)
      },
      async setFiles(selector, files) {
        const { root } = await send('DOM.getDocument')
        const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector })
        assert.ok(nodeId, `Missing file input: ${selector}`)
        await send('DOM.setFileInputFiles', { nodeId, files })
      },
      async capture(path) {
        const reply = await send('Page.captureScreenshot', { format: 'png' })
        await writeFile(path, Buffer.from(reply.data, 'base64'))
      }
    }
  } catch (error) {
    await close()
    throw error
  }
}
