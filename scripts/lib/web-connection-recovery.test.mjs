import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, extname } from 'node:path'
import test from 'node:test'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { launchAcceptanceBrowser, pause } from './host-web-browser.mjs'

// Owns real fetch/SSE + production recovery UI in a browser. It intentionally
// uses a fault-injection HTTP fixture; Core command idempotency is not claimed.
test('Web disconnect recovery blocks portals and shortcuts, preserves drafts and reuses lost submissions', { timeout: 120_000 }, async t => {
  const chrome = process.env.ROVAI_REVIEW_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  try { await access(chrome) } catch { t.skip('Requires a local Chrome binary'); return }
  const root = resolve(import.meta.dirname, '../..')
  const fixture = await mkdtemp(join(tmpdir(), 'rovai-web-recovery-'))
  const output = process.env.ROVAI_WEB_RECOVERY_OUTPUT ?? join(fixture, 'evidence')
  await mkdir(output, { recursive: true })
  let browser, server
  const streams = new Set()
  try {
    const dist = join(fixture, 'dist')
    await build({ configFile: false, root: join(root, 'scripts/fixtures/web-connection-recovery'), plugins: [react()],
      resolve: { alias: { '@contracts': join(root, 'packages/contracts/src/index.ts') } },
      logLevel: 'error', build: { outDir: dist, emptyOutDir: true } })
    let online = true, loss = null, rejectRetry = false, holdProbe = false, holdEvents = false, releaseProbe
    const dispatches = [], receipts = new Map()
    const identity = { protocolVersion: 7, token: 'a'.repeat(64), clientId: 'b'.repeat(64), editorProof: 'c'.repeat(64), ownerId: 'fixture' }
    server = createServer(async (request, response) => {
      const path = new URL(request.url, 'http://fixture').pathname
      const json = (value, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)) }
      if (!path.startsWith('/api/')) {
        try {
          const file = resolve(dist, `.${path === '/' ? '/index.html' : path}`)
          if (!file.startsWith(`${dist}/`)) return json({}, 404)
          response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(file)] ?? 'application/octet-stream')
          response.end(await readFile(file))
        } catch { json({}, 404) }
        return
      }
      if (!online) return json({ error: { code: 'core_unavailable' } }, 503)
      if (path.endsWith('/events')) {
        if (holdEvents) return json({ error: { code: 'connection_unavailable' } }, 503)
        response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.write(':connected\n\n')
        streams.add(response); request.on('close', () => streams.delete(response)); return
      }
      if (path.endsWith('/login') || path.endsWith('/session')) return json(identity)
      let data = ''
      for await (const chunk of request) data += chunk
      const body = JSON.parse(data)
      if (body.operation === 'app.info') {
        const finish = () => { holdEvents = false; json({ result: { name: 'fixture' } }) }
        if (holdProbe) { releaseProbe = finish; return }
        return finish()
      }
      if (body.operation === 'commands.reconcile') return json({ result: receipts.has(body.params.params.commandId)
        ? { state: 'recorded', result: receipts.get(body.params.params.commandId) } : { state: 'unknown' } })
      dispatches.push(body)
      const result = { id: body.params.commandId }
      if (loss) {
        if (loss === 'after') receipts.set(body.params.commandId, result)
        loss = null
        // Send headers before losing the body. A bare reset on a reused socket
        // lets Chrome transparently repeat even a POST below the fetch API.
        response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '1000', Connection: 'close' })
        response.end('{"result":'); return
      }
      if (rejectRetry) { rejectRetry = false; return json({ error: { code: 'draft_changed', message: '草稿已变化，请重试' } }) }
      receipts.set(body.params.commandId, result)
      json({ result })
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${server.address().port}/`
    browser = await launchAcceptanceBrowser({ executable: chrome, args: ['--headless=new', `--user-data-dir=${join(fixture, 'profile')}`, '--remote-debugging-port=0', '--remote-allow-origins=*', '--no-first-run', '--no-default-browser-check', 'about:blank'] })
    await browser.send('Page.navigate', { url })
    await browser.wait(`document.querySelector('#draft') && connectionFixture.transport.connectionState === 'live'`)
    const mounts = await browser.evaluate('connectionFixture.observations.mounts')
    const getDraft = () => browser.evaluate(`document.querySelector('#draft').value`)
    const retry = () => browser.click(`document.querySelector('.web-offline-retry')`)
    const stop = () => { online = false; holdEvents = true; for (const stream of streams) stream.end(); streams.clear() }
    const closed = () => browser.wait(`document.querySelector('.web-offline-dialog') === null`)
    const setDraft = async text => {
      await browser.click(`document.querySelector('#draft')`)
      await browser.evaluate(`document.querySelector('#draft').select()`)
      await browser.send('Input.insertText', { text })
    }

    // A preexisting portal must survive disconnect, Escape, page shortcuts and
    // clicks through the scrim. Both its edit and the page's draft remain mounted.
    await browser.click(`document.querySelector('#create')`)
    await browser.wait(`document.querySelector('#dialog-title') !== null`)
    stop()
    await browser.wait(`document.querySelector('.web-offline-dialog') !== null`)
    await browser.key('Escape'); await browser.key('F2')
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    assert.equal(await browser.evaluate(`document.activeElement === document.querySelector('.web-offline-retry')`), true)
    assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('.web-offline-retry')).outlineStyle`), 'none')
    await browser.evaluate(`connectionFixture.language('en')`)
    await browser.wait(`document.querySelector('.web-offline-title').textContent === 'Connection lost'`)
    assert.equal(await browser.evaluate(`document.querySelector('.web-offline-retry').textContent`), 'Reconnect and retry')
    assert.match(await browser.evaluate(`document.querySelector('.web-offline-description').textContent`), /Your page and drafts are preserved/)
    await browser.evaluate(`connectionFixture.language('zh-CN')`)
    assert.equal(await browser.evaluate('connectionFixture.observations.shortcuts'), 0)
    await browser.click(`document.querySelector('#create')`)
    assert.equal(await browser.evaluate(`document.querySelector('#dialog-title').value`), '尚未创建的对话')
    assert.equal(await getDraft(), '保留这段未发送的草稿')
    await retry()
    await browser.wait(`document.querySelector('.web-offline-title')?.textContent === '仍无法连接服务'`)
    await browser.evaluate(`connectionFixture.language('en')`)
    await browser.wait(`document.querySelector('.web-offline-title').textContent === 'Still unable to connect'`)
    assert.match(await browser.evaluate(`document.querySelector('.web-offline-description').textContent`), /Make sure the service is running/)
    await browser.evaluate(`connectionFixture.language('zh-CN')`)
    await browser.capture(join(output, 'offline-day.png'))

    for (const [theme, width, height] of [['day', 1440, 920], ['night', 1440, 920], ['day', 390, 844], ['night', 390, 844]]) {
      await browser.evaluate(`document.documentElement.dataset.theme = '${theme}'`)
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 })
      await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4 })
      await pause(200)
      const colors = await browser.evaluate(`(() => { const button = document.querySelector('.web-offline-retry'); const style = getComputedStyle(button); const rect = document.querySelector('.web-offline-dialog').getBoundingClientRect(); return { background: style.backgroundColor, color: style.color, overflow: document.documentElement.scrollWidth > innerWidth, fits: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight } })()`)
      assert.equal(colors.background, theme === 'day' ? 'rgb(43, 43, 44)' : 'rgb(229, 229, 231)')
      assert.equal(colors.overflow, false); assert.equal(colors.fits, true)
      await browser.capture(join(output, `offline-${theme}-${width}.png`))
    }
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 920, deviceScaleFactor: 1, mobile: false })
    online = true; holdProbe = true
    // Use the keyboard path, not only the click handler.
    await browser.evaluate(`document.querySelector('.web-offline-retry').focus()`)
    await browser.key('Enter')
    await browser.wait(`document.querySelector('.web-offline-retry')?.disabled === true`)
    await browser.evaluate(`connectionFixture.language('en')`)
    await browser.wait(`document.querySelector('.web-offline-title').textContent === 'Restoring connection…'`)
    assert.equal(await browser.evaluate(`document.querySelector('.web-offline-retry').textContent`), 'Recovering…')
    assert.match(await browser.evaluate(`document.querySelector('.web-offline-description').textContent`), /Recovering unfinished operations/)
    await browser.evaluate(`connectionFixture.language('zh-CN')`)
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    assert.equal(await browser.evaluate(`document.activeElement === document.querySelector('.web-offline-dialog')`), true, 'busy state retains focus inside the modal')
    await browser.evaluate(`document.documentElement.dataset.motionPreference = 'reduce'`)
    assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('.web-offline-retry .web-login-spinner')).animationName`), 'none')
    await browser.capture(join(output, 'recovering-night.png'))
    holdProbe = false; releaseProbe(); await closed()
    assert.equal(dispatches.length, 0, 'unsent draft never auto-submits')
    assert.equal(await browser.evaluate('connectionFixture.observations.mounts'), mounts)
    assert.equal(await getDraft(), '保留这段未发送的草稿')
    assert.equal(await browser.evaluate(`document.querySelector('#dialog-title').value`), '尚未创建的对话')
    await browser.key('Escape')
    await browser.wait(`document.querySelector('#dialog-title') === null`)

    loss = 'before'
    await browser.click(`document.querySelector('#send')`)
    await browser.wait(`document.querySelector('.web-offline-dialog') !== null`)
    const original = structuredClone(dispatches.at(-1))
    await retry(); await closed()
    assert.deepEqual(dispatches.slice(-2), [original, original], 'same frozen ID and payload after lost admission')
    assert.equal(await getDraft(), '')
    assert.equal(await browser.evaluate('connectionFixture.observations.results.length'), 1)

    await setDraft('响应丢失但服务已提交')
    loss = 'after'
    const before = dispatches.length
    await browser.click(`document.querySelector('#send')`)
    await browser.wait(`document.querySelector('.web-offline-dialog') !== null || connectionFixture.observations.results.length === 2`)
    if (await browser.evaluate(`document.querySelector('.web-offline-dialog') !== null`)) await retry()
    await closed()
    assert.equal(dispatches.length, before + 1, 'recorded receipt is never sent again')
    assert.equal(await getDraft(), '')

    await setDraft('业务拒绝后继续保留')
    loss = 'before'; rejectRetry = true
    await browser.click(`document.querySelector('#send')`)
    await browser.wait(`document.querySelector('.web-offline-dialog') !== null`)
    await retry(); await closed()
    assert.equal(await getDraft(), '业务拒绝后继续保留')
    assert.equal(await browser.evaluate('connectionFixture.transport.pendingCommandCount'), 0)
    assert.equal(await browser.evaluate(`document.querySelector('#send').disabled`), false)
    await browser.click(`document.querySelector('#send')`)
    await browser.wait(`document.querySelector('#draft').value === ''`)
    assert.equal(await browser.evaluate('connectionFixture.observations.mounts'), mounts)
    assert.deepEqual(browser.errors, [])
    await writeFile(join(output, 'verification.json'), JSON.stringify({ fixture: 'fault-injection HTTP + production ConsoleClient/WebConnectionRecovery/AppDialog', coreExecutionVerified: false,
      checks: ['SSE disconnect', 'failed reconnect', 'portal preservation', 'capture shortcut blocking', 'focus containment', 'busy focus containment', 'reduced motion', 'neutral day/night colors', 'mobile fit', 'keyboard recovery', 'unsent draft preservation', 'unknown exact retry', 'recorded no resend', 'definitive rejection releases lock', 'no remount', 'subsequent send'], dispatches: dispatches.length }, null, 2))
    console.log(`Recovery UI evidence: ${output}`)
  } finally {
    await browser?.close()
    for (const stream of streams) stream.end()
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
    await rm(fixture, { recursive: true, force: true })
  }
})
