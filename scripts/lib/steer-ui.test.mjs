import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchAcceptanceBrowser, pause } from './host-web-browser.mjs'

test('production composer uses Core per-target eligibility and honest receipt labels', { timeout: 120_000 }, async () => {
  const root = process.env.ROVAI_STEER_UI_OUTPUT ?? await mkdtemp(join(tmpdir(), 'rovai-steer-ui-'))
  await mkdir(root, { recursive: true })
  await promisify(execFile)(process.execPath, [resolve('scripts/fixtures/run-presence/build.mjs'), root])
  const chrome = process.env.ROVAI_TEST_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  const browser = await launchAcceptanceBrowser({ executable: chrome, args: ['--headless=new', `--user-data-dir=${await mkdtemp(join(root, 'browser-'))}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', 'about:blank'] })
  const click = selector => browser.click(`document.querySelector(${JSON.stringify(selector)})`)
  const closeMenu = () => browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  const report = []
  try {
    for (const kind of ['empty', 'attachment', 'idle', 'other-member', 'ready', 'mixed', 'incompatible', 'not-ready', 'unknown', 'accepted', 'queued', 'ended']) {
      // Each case has its own draft-client cache, including the single-recipient cases.
      await browser.evaluate('try { localStorage.clear(); sessionStorage.clear() } catch {} delete window.__presence')
      await browser.send('Page.navigate', { url: pathToFileURL(join(root, 'rovai-teammate-presence.html')).href + `?pure=1&case=${kind}` })
      await browser.wait('!!window.__presence && !!document.querySelector(".composer-box")')
      await browser.evaluate(`__presence.showSteerCase('${kind}')`); await pause(300)
      const eligible = ['attachment', 'ready', 'not-ready', 'mixed', 'accepted'].includes(kind)
      assert.equal(await browser.evaluate('!!document.querySelector(".steer-send-choice")'), eligible, kind)
      const actionLabel = await browser.evaluate('document.querySelector(".composer:not(.single-chat-composer) .composer-actions .composer-primary-action").getAttribute("aria-label")')
      assert.equal(actionLabel, eligible ? kind === 'mixed' ? '优先插话' : '插话'
        : ['empty','idle','other-member','ended'].includes(kind) ? '发送消息' : '排队发送', kind)
      let rows = []
      if (eligible) {
        await click('.steer-send-choice'); await pause(100)
        rows = await browser.evaluate('[...document.querySelectorAll(".steer-recipient-plan")].map(e=>e.innerText)')
        if (kind === 'mixed') {
          assert.equal(rows.length, 3)
          assert.match(rows[0], /插话/); assert.match(rows[1], /排队/); assert.match(rows[2], /发送/)
          assert.match(rows[1], /版本.*回执要求/)
        }
        await closeMenu(); await pause(100)
      } else if (kind === 'incompatible') {
        assert.match(await browser.evaluate('document.querySelector(".steer-send-action").title'), /版本.*回执要求/)
      }
      for (const theme of ['day', 'night']) {
        await browser.evaluate(`__presence.setTheme('${theme}')`)
        await browser.send('Emulation.setDeviceMetricsOverride', { width: 1040, height: 760, deviceScaleFactor: 1, mobile: false }); await pause(100)
        assert.equal(await browser.evaluate('document.documentElement.scrollWidth > innerWidth'), false)
        await browser.capture(join(root, `${kind}-${theme}.png`))
      }
      if (kind === 'ready') {
        // The same mounted composer returns to ordinary send without a toast or lost draft.
        await browser.evaluate('__presence.finishSteerRuns()'); await pause(100)
        assert.equal(await browser.evaluate('!!document.querySelector(".steer-send-choice")'), false)
        assert.equal(await browser.evaluate('document.querySelector(".composer:not(.single-chat-composer) .composer-actions .composer-primary-action").getAttribute("aria-label")'), '发送消息')
      }
      if (kind === 'empty') {
        // Typing and clearing use the live editor; the same active Run is unchanged.
        await browser.evaluate('document.querySelector("#camp-message").focus()')
        await browser.send('Input.insertText', { text: '这条更正' })
        await browser.wait('!!document.querySelector(".steer-send-choice")')
        await browser.evaluate(`(() => { const e = document.querySelector('#camp-message'); const r = document.createRange(); r.selectNodeContents(e); const s = getSelection(); s.removeAllRanges(); s.addRange(r); e.focus() })()`)
        await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
        await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
        await browser.wait('!document.querySelector(".steer-send-choice")')
        assert.equal(await browser.evaluate('document.querySelector(".composer:not(.single-chat-composer) .composer-actions .composer-primary-action").getAttribute("aria-label")'), '发送消息')
        await click('#camp-message')
        await browser.send('Input.insertText', { text: '@' })
        await browser.send('Input.insertText', { text: '奥黛丽' })
        await browser.wait('[...document.querySelectorAll("button[role=option]")].some(e => e.textContent.includes("奥黛丽"))')
        await browser.click('[...document.querySelectorAll("button[role=option]")].find(e => e.textContent.includes("奥黛丽"))')
        await pause(100)
        assert.equal(await browser.evaluate('document.querySelector(".composer:not(.single-chat-composer) .composer-actions .composer-primary-action").getAttribute("aria-label")'), '发送消息', 'live mention immediately replaces the busy default lead')
        await browser.capture(join(root, 'live-mention.png'))
        await browser.send('Input.insertText', { text: ' @' })
        await browser.wait('[...document.querySelectorAll("button[role=option]")].some(e => e.textContent.includes("所有队员"))')
        await browser.click('[...document.querySelectorAll("button[role=option]")].find(e => e.textContent.includes("所有队员"))')
        await pause(100)
        assert.equal(await browser.evaluate('document.querySelector(".composer:not(.single-chat-composer) .composer-actions .composer-primary-action").getAttribute("aria-label")'), '优先插话', 'all-members overrides the individual mention immediately')
        await browser.evaluate(`(() => { const e = document.querySelector('#camp-message'); const r = document.createRange(); r.selectNodeContents(e); const s = getSelection(); s.removeAllRanges(); s.addRange(r); e.focus() })()`)
        await browser.send('Input.insertText', { text: '恢复发给队长' })
        await pause(100)
        assert.equal(await browser.evaluate('document.querySelector(".composer:not(.single-chat-composer) .composer-actions .composer-primary-action").getAttribute("aria-label")'), '插话', 'removing all recipient atoms immediately restores the default target')
      }
      if (['empty', 'attachment', 'idle', 'other-member', 'ready', 'not-ready'].includes(kind)) { report.push({ kind, actionLabel }); continue }
      const selector = '[data-message-id="steer-example"] .user-message-receipt'
      const summary = await browser.evaluate(`document.querySelector('${selector}').innerText`)
      assert.match(summary, kind === 'unknown' ? /待核对/ : kind === 'queued' ? /待处理/ : /已插话/)
      if (kind === 'mixed') assert.equal(summary, '已插话 1 · 待处理 1 · 待核对 1')
      assert.equal(await browser.evaluate('!!document.querySelector("[data-message-id=steer-example] .user-message-withdraw")'), kind === 'queued')
      await click(selector); await pause(100)
      const receipt = await browser.evaluate('document.querySelector(".user-message-receipt-menu").innerText')
      if (kind !== 'queued') assert.match(receipt, kind === 'unknown' ? /是否送达待核对/ : /运行时已接收/)
      assert.equal(receipt.includes('撤回消息'), kind === 'queued', 'accepted and unknown input cannot be withdrawn, even with a stale message flag')
      assert.doesNotMatch(receipt, /已消费|已加入当前执行/)
      await browser.capture(join(root, `${kind}-receipt.png`))
      report.push({ kind, actionLabel, rows, summary, receipt })
      await closeMenu()
    }
    const receiptCases = [
      { routes: ['steer'], label: '已插话', appearance: 'is-confirmed' },
      { routes: ['steer-pending'], label: '待插话', appearance: 'is-queued' },
      { routes: ['steer-sending'], label: '发送中', appearance: 'is-sending' },
      { routes: ['steer', 'steer-pending', 'steer-sending'], label: '已插话 1 · 待插话 1 · 发送中 1', appearance: 'is-sending' },
      { routes: ['running', 'running'], label: '处理中 2', appearance: 'is-progress' },
      { routes: ['steer', 'running'], label: '已插话 1 · 处理中 1', appearance: 'is-progress' },
      { routes: ['failed'], label: '执行失败', appearance: 'is-failed' },
      { routes: ['cancelled'], label: '已停止', appearance: 'is-stopped' },
      { routes: ['cancelled-before-run'], label: '已停止', appearance: 'is-stopped' },
      { routes: ['cancelled', 'cancelled'], label: '已停止 2', appearance: 'is-stopped' },
      { routes: ['cancelled', 'failed'], label: '已停止 1 · 执行失败 1', appearance: 'is-failed' },
      { routes: ['cancelled', 'running'], label: '处理中 1 · 已停止 1', appearance: 'is-progress' },
      { routes: ['cancelled', 'succeeded'], label: '已停止 1', appearance: 'is-stopped' },
      { routes: ['steer-cancelled'], label: '已插话', appearance: 'is-confirmed' },
      { routes: ['unknown-cancelled'], label: '待核对 1', appearance: 'is-unknown' },
      { routes: ['steer', 'failed'], label: '已插话 1 · 执行失败 1', appearance: 'is-failed' },
      { routes: ['steer', 'cancelled'], label: '已插话 1 · 已停止 1', appearance: 'is-stopped' },
      { routes: ['steer-failed', 'failed-before-run', 'cancelled-before-run', 'unknown'], label: '已插话 1 · 待核对 1 · 已停止 1 · 执行失败 1', appearance: 'is-unknown' },
      { routes: ['steer', 'running', 'waiting', 'failed'], label: '已插话 1 · 处理中 1 · 待处理 1 · 执行失败 1', appearance: 'is-failed' },
      { routes: ['running', 'waiting'], label: '处理中 1 · 待处理 1', appearance: 'is-progress' },
      { routes: ['steer', 'running', 'waiting', 'unknown'], label: '已插话 1 · 处理中 1 · 待处理 1 · 待核对 1', appearance: 'is-unknown' },
      { routes: ['waiting', 'waiting'], label: '待处理 2', appearance: 'is-queued' }
    ]
    const receiptSelector = '[data-message-id="receipt-example"] .user-message-receipt'
    const receiptGeometry = () => browser.evaluate(`(() => {
      const m = document.querySelector('[data-message-id="receipt-example"]');
      const r = m.querySelector('.user-message-receipt').getBoundingClientRect();
      const c = m.querySelector('.message-copy-button').getBoundingClientRect();
      return { left:r.left, right:r.right, y:r.y, copyRight:c.right,
        bubbleRight:m.querySelector('.message-bubble').getBoundingClientRect().right,
        receiptOpacity:getComputedStyle(m.querySelector('.user-message-receipt')).opacity,
        copyOpacity:getComputedStyle(m.querySelector('.message-actions')).opacity };
    })()`)
    for (const theme of ['day', 'night']) {
      await browser.evaluate(`__presence.setTheme('${theme}')`)
      for (const width of [1440, 1040]) {
        await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 920, deviceScaleFactor: 1, mobile: false })
        for (const { routes, label, appearance } of receiptCases) {
          await browser.evaluate(`__presence.showReceiptCase(${JSON.stringify(routes)})`)
          await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 10 }); await pause(180)
          assert.equal(await browser.evaluate(`document.querySelector('${receiptSelector}').textContent`), label)
          assert.equal(await browser.evaluate(`document.querySelector('${receiptSelector}').classList.contains('${appearance}')`), true, 'the icon reflects all targets')
          assert.equal(await browser.evaluate(`document.querySelector('${receiptSelector}').getAttribute('aria-label')`), `查看消息处理状态，${label}`)
          if (appearance === 'is-stopped') {
            assert.equal(await browser.evaluate(`!!document.querySelector('${receiptSelector} > svg > circle') && !!document.querySelector('${receiptSelector} > svg > rect')`), true, 'stopped uses the shared circle-and-square status glyph')
          }
          if (label.includes('执行失败')) {
            assert.equal(await browser.evaluate(`(() => {const r=document.querySelector('${receiptSelector}');return getComputedStyle(r.querySelector('.user-message-receipt-failure')).color !== getComputedStyle(r).color})()`), true, 'only the failure segment uses the danger color')
          }
          const before = await receiptGeometry()
          assert.equal(before.copyOpacity, '0')
          assert.equal(before.receiptOpacity, routes.every(route => route === 'running') ? '0' : '1')
          assert.ok(before.copyRight < before.left, 'copy precedes the unified receipt')
          assert.ok(Math.abs(before.right - before.bubbleRight) < 1, 'receipt owns the bubble right edge')
          assert.equal(await browser.evaluate('document.documentElement.scrollWidth > innerWidth'), false)
          const point = await browser.evaluate(`(() => { const r=document.querySelector('${receiptSelector}').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2} })()`)
          await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point }); await pause(150)
          const hovered = await receiptGeometry()
          assert.equal(hovered.copyOpacity, '1'); assert.equal(hovered.receiptOpacity, '1')
          assert.deepEqual([hovered.left, hovered.right, hovered.y], [before.left, before.right, before.y], 'hover never shifts receipt')
          if (routes.length === 2 && routes[0] === 'steer') await browser.capture(join(root, `receipt-mixed-${routes[1]}-${theme}-${width}.png`))
          if (routes[0] === 'cancelled') await browser.capture(join(root, `receipt-stopped-${routes.join('-')}-${theme}-${width}.png`))
          await click(receiptSelector); await pause(60)
          const detail = await browser.evaluate('document.querySelector(".user-message-receipt-menu").innerText')
          if (routes.some(route => ['steer', 'steer-failed', 'steer-cancelled'].includes(route))) assert.match(detail, /运行时已接收/)
          if (routes.includes('steer-pending')) assert.match(detail, /待插话/)
          if (routes.includes('steer-sending')) assert.match(detail, /发送中/)
          if (routes.includes('running')) assert.match(detail, /处理中/)
          if (routes.some(route => route.startsWith('unknown'))) assert.match(detail, /是否送达待核对/)
          if (routes.some(route => route.startsWith('failed'))) assert.match(detail, /执行失败/)
          if (routes.some(route => route.startsWith('cancelled'))) assert.match(detail, /已停止/)
          assert.equal(detail.includes('撤回消息'), routes.every(route => route === 'waiting'))
          assert.equal(await browser.evaluate('document.querySelectorAll(".user-message-receipt-recipient").length'), routes.length)
          await closeMenu(); await pause(60)
          report.push({ kind: 'receipt', theme, width, routes, label, before, hovered, detail })
        }
      }
    }
    await browser.evaluate('__presence.showReceiptCase(["steer", "running"])'); await pause(120)
    await browser.evaluate('document.querySelector("[data-message-id=receipt-example] .message-copy-button").focus()')
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    assert.equal(await browser.evaluate('document.activeElement === document.querySelector("[data-message-id=receipt-example] .message-select-button")'), true)
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    assert.equal(await browser.evaluate(`document.activeElement === document.querySelector('${receiptSelector}')`), true)
    await browser.key('Enter'); await browser.wait('!!document.querySelector(".user-message-receipt-menu")'); await closeMenu()
    await click('[data-message-id=receipt-example] .message-copy-button')
    await browser.wait('document.querySelector("[data-message-id=receipt-example] .message-copy-button").getAttribute("aria-label") === "已复制这条消息"')
    assert.equal(await browser.evaluate(`document.querySelector('${receiptSelector}').textContent`), '已插话 1 · 处理中 1')
    await browser.evaluate('__presence.showReceiptCase(["steer", "running"], true)'); await pause(120)
    assert.equal(await browser.evaluate(`document.querySelector('${receiptSelector}').textContent`), '已插话 1')
    await browser.evaluate('__presence.showReceiptCase(["running"], true)'); await pause(120)
    assert.equal(await browser.evaluate(`!!document.querySelector('${receiptSelector}')`), false)
    await browser.evaluate('__presence.setLanguage("en"); __presence.showReceiptCase(["cancelled", "failed"])')
    await browser.wait(`document.querySelector('${receiptSelector}')?.textContent === 'Stopped 1 · Execution failed 1'`)
    await browser.evaluate('__presence.showReceiptCase(["cancelled"])')
    await browser.wait(`document.querySelector('${receiptSelector}')?.textContent === 'Stopped'`)
    await browser.evaluate('__presence.setLanguage("zh-CN")')
    await browser.wait(`document.querySelector('${receiptSelector}')?.textContent === '已停止'`)
    // Real ThreadWorkspace + command disclosure, including a source outside the loaded message window.
    await browser.evaluate('__presence.showSteerTimeline(true)'); await pause(180)
    await click('.run-presence-open')
    await browser.wait('!!document.querySelector(".run-input-row")')
    await pause(250)
    const row = '.run-input-row'
    assert.equal(await browser.evaluate(`document.querySelector('${row}').closest('.tool-activity-group') === null`), true)
    assert.equal(await browser.evaluate(`document.querySelector('${row} > summary').getBoundingClientRect().height`), 28)
    assert.equal(await browser.evaluate('document.querySelectorAll(".tool-group-summary").length'), 2)
    assert.equal(await browser.evaluate(`document.querySelector('${row}').querySelectorAll('button').length`), 0)
    await browser.evaluate(`window.savedInputRow = document.querySelector('${row}'); document.querySelector('${row} > summary').focus()`)
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await browser.wait('!!document.querySelector(".run-input-row [role=region]")')
    assert.equal(await browser.evaluate(`document.querySelector('${row} [role=region]').textContent.endsWith('正文末尾。')`), true)
    assert.deepEqual(await browser.evaluate(`Array.from(document.querySelectorAll('${row} button')).map(e => e.getAttribute('aria-label'))`), ['查看原消息'])
    assert.equal(await browser.evaluate(`document.querySelector('${row}').textContent.includes('补充说明.txt')`), false)
    assert.equal(await browser.evaluate('__presence.controls.executionReads.some(r => r.method === "thread.messages.around" && r.messageId === "steer-example")'), true)
    await browser.evaluate(`document.querySelector('${row} [role=region]').focus()`)
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
    assert.equal(await browser.evaluate(`document.querySelector('${row} [role=region]').scrollTop > 0`), true)
    await browser.key('Escape')
    assert.equal(await browser.evaluate(`document.activeElement === document.querySelector('${row} > summary')`), true)
    for (const status of ['sending', 'accepted', 'delivery_unknown', 'not_accepted', 'queued']) {
      await browser.evaluate(`__presence.updateSteerTimeline('${status}')`); await pause(80)
      assert.equal(await browser.evaluate(`document.querySelector('${row}') === window.savedInputRow`), true)
      assert.equal(await browser.evaluate(`document.querySelector('${row}').open`), true)
      assert.equal(await browser.evaluate('document.querySelectorAll(".tool-group-summary").length'), 2)
    }
    assert.match(await browser.evaluate(`document.querySelector('${row} > summary').textContent`), /已转排队/)
    for (const theme of ['day', 'night']) {
      await browser.evaluate(`__presence.setTheme('${theme}')`)
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 1040, height: 760, deviceScaleFactor: 1, mobile: false }); await pause(80)
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth > innerWidth'), false)
      await browser.capture(join(root, `run-input-${theme}.png`))
    }
    await click('.run-input-source')
    await browser.wait('document.activeElement?.getAttribute("data-message-id") === "steer-example"')
    assert.equal(await browser.evaluate('document.querySelector(".run-input-row")?.getClientRects().length ?? 0'), 0, 'source navigation closes the covering execution inspector')
    report.push({ kind: 'run-input', rowHeight: 28, retainedAfterReceipt: true, historySource: true, onlyOriginalMessageLink: true, keyboard: true })
    assert.deepEqual(browser.errors, [])
    await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2))
    console.log(`Steer UI evidence: ${root}`)
  } finally { await browser.close() }
})
