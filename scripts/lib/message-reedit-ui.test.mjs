import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createServer } from 'node:http'
import { launchAcceptanceBrowser, pause } from './host-web-browser.mjs'

test('withdrawn text recovery uses production storage, expiry and composer interactions', { timeout: 120_000 }, async () => {
  const out = resolve(process.env.ROVAI_REEDIT_OUTPUT ?? 'docs/prototypes/withdraw-reedit-v4')
  await mkdir(out, { recursive: true })
  await promisify(execFile)(process.execPath, [resolve('scripts/fixtures/message-reedit/build.mjs'), out])
  const html = await readFile(join(out, 'rovai-withdraw-reedit.html'))
  const server = createServer((request, response) => {
    if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(html)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/`
  const profile = await mkdtemp(join(out, 'browser-'))
  const b = await launchAcceptanceBrowser({ executable: process.env.ROVAI_TEST_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--headless=new', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-popup-blocking', '--remote-debugging-port=0', 'about:blank'] })
  const checks = []
  const click = selector => b.click(`document.querySelector(${JSON.stringify(selector)})`)
  const text = () => b.evaluate('document.querySelector(".structured-mention-editor").innerText')
  const state = () => b.evaluate('window.__withdrawReview.get()')
  const count = () => b.evaluate('document.querySelectorAll(".message-reedit-action").length')
  const capture = name => b.capture(join(out, name + '.png'))
  const scenario = async name => { await b.evaluate(`window.__withdrawReview.scenario(${JSON.stringify(name)})`); await pause(250) }
  const check = async (name, run) => { await run(); checks.push(name); console.log('PASS ' + name) }
  const withdraw = async () => {
    await click('[aria-label="撤回这条消息"]'); await click('[aria-label="确认撤回消息"]'); await pause(550)
  }
  const key = async (key, code) => {
    await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code })
    await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code }); await pause(120)
  }
  const original = '把重新编辑入口放在撤回提示旁。\n输入框已有内容时，先确认替换，取消保留草稿。'
  const existing = '还有一点：历史撤回消息没有原文时，不显示重新编辑入口。'
  try {
    await b.send('Page.navigate', { url }); await b.wait('!!window.__withdrawReview?.editorRef?.current'); await pause(650)
    await check('Existing draft requires confirmation; cancel leaves it untouched', async () => {
      assert.equal(await count(), 1); assert.equal(await text(), existing)
      await capture('01-ready')
      await click('.message-reedit-action'); await pause(160)
      assert.equal(await text(), existing)
      await capture('02-replace-confirmation')
      await click('.message-reedit-dialog .quiet-button'); await pause(160)
      assert.equal(await text(), existing)
    })
    await check('Confirmed replacement restores only authored text and survives expiry as a draft', async () => {
      const before = (await state()).messages
      await click('.message-reedit-action'); await click('.message-reedit-dialog .primary-button'); await pause(200)
      assert.equal(await text(), original)
      assert.deepEqual((await state()).messages, before)
      assert.equal(await b.evaluate('document.querySelectorAll(".structured-mention-editor [data-composer-atom=member]").length'), 0)
      await capture('03-restored')
      await b.evaluate('window.__withdrawReview.advance(120000)'); await pause(100)
      assert.equal(await count(), 0); assert.equal(await text(), original)
      await b.evaluate('window.__withdrawReview.editorRef.current.flush()')
      await b.send('Page.reload'); await b.wait('!!window.__withdrawReview?.editorRef?.current'); await pause(500)
      assert.equal(await count(), 0); assert.equal(await text(), original)
    })
    await check('An empty editor fills directly; resend gets a display-only default recipient', async () => {
      await scenario('empty'); await click('.message-reedit-action'); await pause(150)
      assert.equal(await text(), original)
      assert.equal(await b.evaluate('!!document.querySelector(".message-reedit-dialog")'), false)
      await click('.composer-primary-action.is-send:not(:disabled)'); await pause(450)
      const sent = (await state()).messages.at(-1)
      assert.equal(sent.body, original); assert.equal(sent.addressMode, 'default')
      assert.equal(await b.evaluate(`document.querySelectorAll('[data-message-id="${sent.id}"] .default-recipient-mention-prefix').length`), 1)
    })
    await check('Explicit mentions retain their identity on replacement', async () => {
      await scenario('explicit'); await click('.message-reedit-action'); await click('.message-reedit-dialog .primary-button'); await pause(160)
      assert.equal(await text(), '@爱丽丝 ' + original)
      assert.equal(await b.evaluate('document.querySelectorAll(".structured-mention-editor [data-composer-atom=member]").length'), 1)
    })
    await check('Restart keeps the original deadline; a confirmation crossing it cannot replace the draft', async () => {
      await scenario('withdrawn'); await b.evaluate('window.__withdrawReview.advance(60000)')
      await b.send('Page.reload'); await b.wait('!!window.__withdrawReview?.editorRef?.current'); await pause(300)
      assert.equal(await count(), 1)
      await b.evaluate('window.__withdrawReview.advance(58000)')
      await click('.message-reedit-action'); await b.evaluate('window.__withdrawReview.advance(7000)')
      await click('.message-reedit-dialog .primary-button'); await pause(100)
      assert.equal(await text(), existing)
      assert.match(await b.evaluate('document.querySelector(".message-reedit-dialog [role=alert]").innerText'), /已过期/)
      await capture('04-expired-confirmation')
      await click('.message-reedit-dialog .quiet-button')
    })
    await check('Withdrawal is accepted even when initial/ready storage or projection refresh fails', async () => {
      for (const name of ['storage-failure', 'ready-storage-failure', 'refresh-failure']) {
        await scenario(name); await withdraw()
        assert.equal((await state()).messages[3].withdrawn, true, name)
        assert.equal(await count(), name === 'refresh-failure' ? 1 : 0, name)
        assert.equal(await text(), existing)
        assert.equal(await b.evaluate('!!document.querySelector(".message-withdraw-dialog")'), false)
        await capture(name)
      }
    })
    await check('Definite rejection discards the copy; a lost receipt is reconciled with the old request', async () => {
      await scenario('failure'); await withdraw()
      assert.equal((await state()).messages[3].withdrawn, false)
      assert.equal(await count(), 0)
      await click('.message-withdraw-dialog [aria-label="取消"]')
      await scenario('unknown'); await withdraw()
      assert.equal(await count(), 0)
      await click('.message-withdraw-dialog [aria-label="取消"]')
      await b.evaluate('window.__withdrawReview.recover()'); await pause(250)
      assert.equal(await count(), 1)
    })
    await check('Withdrawal and expiry leave an existing arrow-key history round unchanged', async () => {
      await scenario('pending'); await b.evaluate('window.__withdrawReview.editorRef.current.focus("start")')
      await key('ArrowUp', 38); assert.equal(await text(), original)
      await withdraw(); assert.equal(await text(), original)
      await b.evaluate('window.__withdrawReview.advance(120000)'); assert.equal(await text(), original)
      await b.evaluate('window.__withdrawReview.editorRef.current.focus("start")'); await key('Escape', 27)
      assert.equal(await text(), existing)
      await key('ArrowUp', 38)
      assert.equal(await text(), '撤回以后，我希望能接着修改消息，输入框里正在写的内容也要保留。')
    })
    await check('Cancel preserves a history preview; confirmed reedit adopts an ordinary draft', async () => {
      await scenario('pending'); await b.evaluate('window.__withdrawReview.editorRef.current.focus("start")')
      await key('ArrowUp', 38); await withdraw()
      await click('.message-reedit-action'); await click('.message-reedit-dialog .quiet-button')
      assert.equal(await text(), original)
      await b.evaluate('window.__withdrawReview.editorRef.current.focus("start")'); await key('Escape', 27)
      assert.equal(await text(), existing)
      await key('ArrowUp', 38)
      await click('.message-reedit-action'); await click('.message-reedit-dialog .primary-button'); await pause(150)
      assert.equal(await text(), original)
      await key('Escape', 27)
      assert.equal(await text(), original)
      await b.evaluate('window.__withdrawReview.editorRef.current.flush()')
      await b.send('Page.reload'); await b.wait('!!window.__withdrawReview?.editorRef?.current'); await pause(300)
      assert.equal(await text(), original)
    })
    await check('Another window deleting a copy updates this window through storage events', async () => {
      await scenario('withdrawn')
      await b.evaluate('window.__other = window.open(location.href, "reedit-other"); true')
      await b.wait('!!window.__other?.__withdrawReview?.editorRef?.current')
      await b.evaluate('window.__other.__withdrawReview.reeditStore.deleteThread("rvcamp_01m5kph2p7e40bbftscc7jy7ap")')
      await b.wait('document.querySelectorAll(".message-reedit-action").length === 0')
      await b.evaluate('window.__other.close(); true')
    })
    await check('Day/night preserve blue un-underlined actions and compact layout', async () => {
      for (const theme of ['day', 'night']) {
        await scenario('withdrawn'); await b.evaluate(`window.__withdrawReview.setTheme('${theme}')`); await pause(150)
        assert.equal(await b.evaluate('getComputedStyle(document.querySelector(".message-reedit-action")).textDecorationLine'), 'none')
        await b.send('Emulation.setDeviceMetricsOverride', { width: 1040, height: 700, deviceScaleFactor: 1, mobile: false }); await pause(150)
        assert.equal(await b.evaluate('document.documentElement.scrollWidth > innerWidth'), false)
        assert.equal(await b.evaluate('!!document.querySelector(".withdrawn-message-event .message-more-button")'), false)
        assert.equal(await b.evaluate('getComputedStyle(document.querySelector(".withdrawn-message-event time")).paddingTop'), '2px')
        await capture(`05-${theme}`)
      }
      assert.deepEqual(b.errors, [])
    })
  } catch (error) { await capture('failure').catch(() => {}); throw error }
  finally {
    await writeFile(join(out, 'verification.json'), JSON.stringify({ checks, errors: b.errors, at: new Date().toISOString() }, null, 2))
    await b.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(profile, { recursive: true, force: true })
  }
})
