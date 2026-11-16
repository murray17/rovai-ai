import assert from 'node:assert/strict'
import test from 'node:test'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { launchAcceptanceBrowser } from './host-web-browser.mjs'

test('production attachment downloads preserve preview, ownership, input and theme behavior', { timeout: 120_000 }, async () => {
  const root = resolve(import.meta.dirname, '../..')
  const fixture = await mkdtemp(join(tmpdir(), 'rovai-attachment-download-'))
  let browser
  let server
  let passed = false
  try {
    await build({ configFile: false, root: join(root, 'scripts/fixtures/attachment-download'), base: './', logLevel: 'error',
      plugins: [react()], resolve: { alias: { '@contracts': join(root, 'packages/contracts/src/index.ts') } },
      build: { outDir: join(fixture, 'renderer'), minify: false } })
    const rendererRoot = join(fixture, 'renderer')
    server = createServer(async (request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      const path = resolve(rendererRoot, '.' + (pathname === '/' ? '/index.html' : decodeURIComponent(pathname)))
      if (!path.startsWith(rendererRoot + '/')) { response.writeHead(404).end(); return }
      try {
        response.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[extname(path)] ?? 'application/octet-stream')
        response.end(await readFile(path))
      } catch { response.writeHead(404).end() }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    browser = await launchAcceptanceBrowser({ executable: process.env.ROVAI_TEST_CHROME ?? (process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/chromium'),
      args: ['--headless=new', `--user-data-dir=${join(fixture, 'browser')}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', 'about:blank'] })
    await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` })
    await browser.wait("document.querySelectorAll('.attachment-download-action').length===2")
    const first = "document.querySelector('.attachment-download-action')"
    const row = "document.querySelector('.agent-timeline')"
    const both = "[...document.querySelectorAll('.attachment-download-action')]"
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 300 })
    await browser.wait(`${both}.every(e=>getComputedStyle(e).opacity==='0')`)
    const bounds = await browser.evaluate(`${row}.getBoundingClientRect().toJSON()`)
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bounds.x + 60, y: bounds.y + 28 })
    await browser.wait(`getComputedStyle(${first}).opacity==='1'`)
    assert.deepEqual(await browser.evaluate(`${row}.getBoundingClientRect().toJSON()`), bounds)
    assert.equal(await browser.evaluate(`getComputedStyle(document.querySelectorAll('.attachment-download-action')[1]).opacity`), '0')
    const hit = await browser.evaluate(`(()=>{const r=${first}.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...hit })
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...hit, button: 'left', clickCount: 1 })
    assert.equal(await browser.evaluate(`(()=>{const r=${first}.getBoundingClientRect();return r.y+r.height/2===${hit.y}})()`), true)
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...hit, button: 'left', clickCount: 1 })
    await browser.wait(`${first}.disabled && window.downloadQA.pending.length===1`)
    await browser.evaluate(`${first}.click()`)
    assert.equal(await browser.evaluate('window.downloadQA.pending.length'), 1)
    assert.equal(await browser.evaluate('window.downloadQA.opened.length'), 0)
    await browser.evaluate("window.downloadQA.complete(0,'cancel')")
    await browser.wait(`${first}.dataset.downloadState==='idle'`)
    assert.equal(await browser.evaluate(`${row}.querySelector('[role=status]').textContent`), '')
    await browser.click(first)
    await browser.wait('window.downloadQA.pending.length===2')
    await browser.evaluate("window.downloadQA.complete(1,'error')")
    await browser.wait(`${first}.dataset.downloadState==='error'`)
    assert.match(await browser.evaluate(`${first}.getAttribute('aria-label')`), /重试/)
    await browser.click(first)
    await browser.wait('window.downloadQA.pending.length===3')
    await browser.evaluate("window.downloadQA.complete(2,'success')")
    await browser.wait(`${row}.querySelector('[role=status]').textContent.includes('已保存')`)
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 300 })
    await browser.evaluate("document.querySelectorAll('.agent-timeline')[1].querySelector('.attachment-open').focus()")
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    assert.equal(await browser.evaluate("document.activeElement===document.querySelectorAll('.attachment-download-action')[1]"), true)
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await browser.wait('window.downloadQA.pending.length===4')
    assert.equal(await browser.evaluate('window.downloadQA.pending[3].locator.attachmentRefId'), 'long-file')
    await browser.evaluate("window.downloadQA.complete(3,'success')")
    await browser.click(`${row}.querySelector('.attachment-open')`)
    await browser.wait('window.downloadQA.opened.length===1')
    assert.equal(await browser.evaluate('window.downloadQA.opened[0].locator.attachmentRefId'), 'review-attachment')
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bounds.x + 60, y: bounds.y + 28 })
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: bounds.x + 60, y: bounds.y + 28, button: 'right', clickCount: 1 })
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bounds.x + 60, y: bounds.y + 28, button: 'right', clickCount: 1 })
    await browser.wait("!!document.querySelector('.attachment-context-menu')")
    assert.equal(await browser.evaluate("document.querySelector('.attachment-context-menu').textContent.includes('在 Finder 中显示')"), true)
    await browser.key('Escape')
    await browser.wait("!document.querySelector('.attachment-context-menu')")
    await browser.click(first)
    await browser.wait('window.downloadQA.pending.length===5')
    await browser.evaluate("window.downloadQA.setMode('web')")
    await browser.wait(`${first}.dataset.downloadState==='idle'`)
    await browser.evaluate("window.downloadQA.complete(4,'error')")
    assert.equal(await browser.evaluate(`${first}.dataset.downloadState`), 'idle')
    await browser.click(first)
    await browser.wait('window.downloadQA.pending.length===6')
    assert.equal(await browser.evaluate('window.downloadQA.pending[5].mode'), 'web')
    await browser.evaluate("window.downloadQA.complete(5,'success')")
    await browser.wait(`${row}.querySelector('[role=status]').textContent.includes('浏览器')`)
    await browser.click(first)
    await browser.wait('window.downloadQA.pending.length===7')
    await browser.evaluate('window.downloadQA.replace()')
    await browser.wait(`${first}.dataset.downloadState==='idle'`)
    await browser.evaluate("window.downloadQA.complete(6,'missing')")
    assert.equal(await browser.evaluate(`${row}.textContent.includes('不可用')`), false)
    await browser.evaluate('window.downloadQA.setDisabled(true)')
    await browser.wait(`${first}.disabled`)
    await browser.evaluate(`${first}.click()`)
    assert.equal(await browser.evaluate('window.downloadQA.pending.length'), 7)
    await browser.evaluate('window.downloadQA.setDisabled(false)')
    await browser.evaluate("window.downloadQA.language('en')")
    await browser.wait(`${first}.title==='Download file'`)
    await browser.evaluate('document.activeElement.blur()')
    for (const theme of ['day', 'night', 'horizon', 'classic-red', 'ember']) {
      await browser.evaluate(`window.downloadQA.theme('${theme}')`)
      await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bounds.x + 60, y: bounds.y + 28 })
      await browser.wait(`getComputedStyle(${first}).opacity==='1' && getComputedStyle(${first}).color===getComputedStyle(${row}.querySelector('strong')).color`)
      await browser.capture(join(fixture, `${theme}.png`))
    }
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false })
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true })
    await browser.wait(`${both}.every(e=>getComputedStyle(e).opacity==='1' && e.getBoundingClientRect().width===44 && e.getBoundingClientRect().height===44)`)
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth'), true)
    await browser.capture(join(fixture, 'touch.png'))
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await browser.wait(`getComputedStyle(${first}).transitionDuration.split(',').every(value=>parseFloat(value)<=.001)`)
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: false })
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 920, deviceScaleFactor: 1, mobile: false })
    await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/?virtual` })
    await browser.wait(`!!${first} && document.querySelectorAll('[data-timeline-key]').length<40`)
    await browser.click(first)
    await browser.wait('window.downloadQA.pending.length===1')
    await browser.evaluate("document.getElementById('virtual-outside').focus();const v=document.getElementById('virtual-viewport');v.scrollTop=v.scrollHeight")
    await browser.wait("!document.querySelector('[data-message-id=virtual-0]')")
    assert.equal(await browser.evaluate('window.downloadQA.pending.length'), 1)
    await browser.evaluate("document.getElementById('virtual-viewport').scrollTop=0")
    await browser.wait(`!!${first} && ${first}.disabled && ${first}.dataset.downloadState==='preparing'`)
    await browser.evaluate(`${first}.click()`)
    assert.equal(await browser.evaluate('window.downloadQA.pending.length'), 1, 'Returning to the virtual row must not open another native save dialog')
    await browser.evaluate("window.downloadQA.complete(0,'success')")
    await browser.wait(`${first}.dataset.downloadState==='idle'`)
    assert.equal(await browser.evaluate('document.activeElement.id'), 'virtual-outside')
    await browser.click(first)
    await browser.wait('window.downloadQA.pending.length===2')
    await browser.evaluate("window.downloadQA.complete(1,'cancel');window.downloadQA.setMode('web')")
    await browser.wait(`${first}.dataset.downloadState==='idle'`)
    await browser.click(first)
    await browser.wait('window.downloadQA.pending.length===3')
    await browser.evaluate('window.downloadQA.setMounted(false)')
    await browser.wait(`!${first}`)
    await browser.evaluate('window.downloadQA.setMounted(true)')
    await browser.wait(`!!${first} && ${first}.disabled`)
    await browser.evaluate(`${first}.click()`)
    assert.equal(await browser.evaluate('window.downloadQA.pending.length'), 3, 'Web downloads also survive a full list unmount without duplicate requests')
    await browser.evaluate("window.downloadQA.complete(2,'error')")
    await browser.wait(`${first}.dataset.downloadState==='error'`)
    await browser.click(first)
    await browser.wait('window.downloadQA.pending.length===4')
    await browser.evaluate('window.downloadQA.setMounted(false)')
    await browser.wait(`!${first}`)
    await browser.evaluate('window.downloadQA.reject(3)')
    await browser.evaluate('window.downloadQA.setMounted(true)')
    await browser.wait(`!!${first} && ${first}.dataset.downloadState==='idle'`)
    await browser.click(first)
    await browser.wait('window.downloadQA.pending.length===5')
    await browser.evaluate("window.downloadQA.complete(4,'cancel')")
    await browser.wait(`${first}.dataset.downloadState==='idle'`)
    assert.equal(await browser.evaluate('window.downloadQA.opened.length'), 0)
    assert.deepEqual(browser.errors, [])
    passed = true
    const report = { commit: process.env.GITHUB_SHA ?? null, platform: process.platform, native: 'cancel, retry, duplicate guard', web: 'source download', keyboard: 'Tab/Enter', stale: 'client and attachment', virtualization: '160 rows; scroll unmount/return; full unmount/return; no duplicate request; retry after settle', themes: 5, touch: '44px', errors: browser.errors }
    await writeFile(join(fixture, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
  } catch (error) {
    await browser?.capture(join(fixture, 'failure.png')).catch(() => undefined)
    throw error
  } finally {
    await browser?.close()
    if (server) await new Promise(resolve => server.close(resolve))
    if (process.env.ROVAI_ATTACHMENT_DOWNLOAD_ARTIFACTS) {
      const out = join(resolve(process.env.ROVAI_ATTACHMENT_DOWNLOAD_ARTIFACTS), 'renderer')
      await mkdir(out, { recursive: true })
      for (const name of ['report.json', 'day.png', 'night.png', 'horizon.png', 'classic-red.png', 'ember.png', 'touch.png', 'failure.png']) {
        await copyFile(join(fixture, name), join(out, name)).catch(() => undefined)
      }
    }
    if (!passed || process.env.ROVAI_KEEP_ATTACHMENT_DOWNLOAD_FIXTURE === '1') console.log(`Attachment download fixture: ${fixture}`)
    else await rm(fixture, { recursive: true, force: true })
  }
})
