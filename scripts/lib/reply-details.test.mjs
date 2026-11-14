import assert from 'node:assert/strict'
import test from 'node:test'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import electron from 'electron'
import { admitElectronIntegrationTest } from './electron-sandbox-capability.mjs'
import { launchAcceptanceBrowser, pause } from './host-web-browser.mjs'

async function runReplyDetails(t, splittersOnly = false) {
  if (!admitElectronIntegrationTest(t)) return
  const root = await mkdtemp(join(tmpdir(), 'rovai-reply-details-'))
  const out = process.env.ROVAI_REPLY_UI_OUTPUT ?? join(root, 'screenshots')
  await mkdir(out, { recursive: true })
  let b
  const results = []
  try {
    await promisify(execFile)(process.execPath, [resolve(import.meta.dirname, '../fixtures/run-presence/build.mjs'), root])
    const main = join(root, 'main.cjs')
    await writeFile(main, `const { app, BrowserWindow } = require('electron');
      app.setPath('userData', ${JSON.stringify(join(root, 'profile'))});
      let window;
      app.whenReady().then(() => {
        window = new BrowserWindow({ show: false, width: 1440, height: 920,
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
        window.loadURL('about:blank');
      });`)
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    b = await launchAcceptanceBrowser({ executable: electron, env, args: [main,
      '--remote-debugging-port=0', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])] })
    await b.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    const click = selector => b.click(`document.querySelector(${JSON.stringify(selector)})`)
    let scenarioNumber = 0
    const open = async ({ width = 1440, loaded = false, full = false, reduced = false, scrollAfterOpen = false, wrapped = false, grouped = false }) => {
      await b.send('Emulation.setDeviceMetricsOverride', { width, height: 920, deviceScaleFactor: 1, mobile: false })
      const search = `?pure=1&scenario=${++scenarioNumber}`
      await b.send('Page.navigate', { url: pathToFileURL(join(root, 'rovai-teammate-presence.html')).href + search })
      await b.wait(`location.search === ${JSON.stringify(search)} && !!window.__presence && !!document.querySelector("[contenteditable=true]")`)
      await b.evaluate(`__presence.showReplyCase(true, ${loaded}, ${wrapped}, ${grouped}); document.documentElement.dataset.motionPreference = '${reduced ? 'reduce' : 'full'}'`)
      await b.wait('!!document.querySelector("[data-message-id=long-120]")')
      await click('[contenteditable=true]')
      await b.send('Input.insertText', { text: '跳转时保留草稿。' })
      const draft = await b.evaluate('document.querySelector("[contenteditable=true]").textContent')
      if (scrollAfterOpen) {
        const point = await b.evaluate(`(() => { const e = document.querySelector('.timeline-scroll'), r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, deltaY: -e.scrollHeight } })()`)
        await b.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0 })
        if (scrollAfterOpen !== 'middle') for (let attempt = 0; attempt < 8; attempt++) {
          await pause(150)
          if (await b.evaluate('(() => { const e=document.querySelector(".timeline-scroll");return e.scrollHeight-e.clientHeight-e.scrollTop<2 })()')) break
          // New rows can replace estimated heights as a user scrolls. Continue
          // native scrolling until the measured tail is reached.
          const next = await b.evaluate(`(() => {const e=document.querySelector('.timeline-scroll'),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,deltaY:e.scrollHeight}})()`)
          await b.send('Input.dispatchMouseEvent', { type:'mouseWheel', ...next, deltaX:0 })
        }
        await b.wait('!!document.querySelector("[data-message-id=reply-b]") && document.querySelector(".timeline-scroll").scrollTop < 2')
      }
      await click(`[data-message-id=${scrollAfterOpen ? 'reply-b' : 'long-120'}] .reply-parent-quote`)
      await b.wait('!!document.querySelector("[data-reply-message-id=reply-a]")')
      if (full) await click('.reply-detail-expand')
      await pause(300)
      if (grouped) assert.equal(await b.evaluate('document.querySelectorAll("[data-message-id^=long-].is-group-continuation").length'), 0,
        'narrow long messages must start above the grouping height threshold')
      if (scrollAfterOpen) {
        const point = await b.evaluate(`(() => { const e = document.querySelector('.timeline-scroll'), r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, deltaY: ${scrollAfterOpen === 'middle' ? 1800 : 'e.scrollHeight'} } })()`)
        await b.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0 })
        await b.wait(`(() => { const e = document.querySelector('.timeline-scroll'); return ${scrollAfterOpen === 'middle' ? 'e.scrollTop >= 1800' : 'e.scrollHeight - e.clientHeight - e.scrollTop < 2'} })()`)
        await pause(300)
      }
      return draft
    }
    if (splittersOnly) {
      const splitterDraft = await open({ loaded: true })
      const replyGeometry = () => b.evaluate(`(() => {
        const h = document.querySelector('.reply-detail-resize'), r = h.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + 80), width: Number(h.getAttribute('aria-valuenow')) };
      })()`)
      const replyMouse = (type, point) => b.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y,
        button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 })
      let replyStart = await replyGeometry()
      await replyMouse('mousePressed', replyStart)
      await replyMouse('mouseReleased', { ...replyStart, x: replyStart.x + replyStart.width - 390 })
      await b.wait('document.querySelector(".reply-detail-resize").getAttribute("aria-valuenow") === "390"')
      replyStart = await replyGeometry()
      await replyMouse('mousePressed', replyStart)
      await replyMouse('mouseMoved', { ...replyStart, x: replyStart.x + replyStart.width - 280 })
      await b.wait('document.querySelector(".reply-detail-resize")?.dataset.foldState === "collapsed"')
      assert.equal((await replyGeometry()).width, 0, 'Further travel folds the detail while held')
      await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await replyMouse('mouseReleased', replyStart)
      assert.equal((await replyGeometry()).width, 390, 'Escape restores the previous reply width')
      replyStart = await replyGeometry()
      await replyMouse('mousePressed', replyStart)
      await replyMouse('mouseReleased', { ...replyStart, x: replyStart.x + replyStart.width - 280 })
      await b.wait('!document.querySelector(".reply-detail-panel")')
      assert.equal(await b.evaluate('document.querySelector("[contenteditable=true]").textContent'), splitterDraft,
        'Fast release closes the reply pane without changing the conversation draft')
      await click('[data-message-id=long-120] .reply-parent-quote')
      await b.wait('!!document.querySelector(".reply-detail-panel")')
      assert.equal((await replyGeometry()).width, 390, 'Reopening keeps the useful width, not the zero-width fold frame')
      await click('[aria-label="关闭回复详情"]')
      results.push({ name: 'reply minimum, cancellation and final-coordinate release' })
      console.log(JSON.stringify({ result: 'passed', scenarios: results.map(r => r.name) }))
      return
    }
    for (const scenario of [
      { width: 1920, full: false }, { width: 1440, full: true }, { width: 1040, full: false }
    ]) {
      await open({ ...scenario, loaded: true })
      for (const tab of ['execution', 'members']) {
        await click(`.camp-detail-entry[data-detail="${tab}"]`)
        await b.wait('!document.querySelector(".camp-detail-popover:not(.reply-execution-popover)").hidden')
        const bounds = await b.evaluate(`(() => {
          const panel = document.querySelector('.camp-detail-popover:not(.reply-execution-popover)'), button = panel.querySelector('.camp-detail-collapse');
          const p = panel.getBoundingClientRect(), r = button.getBoundingClientRect(), w = document.querySelector('.camp-workspace').getBoundingClientRect();
          return { panelTop:p.top, workspaceTop:w.top, panelRight:p.right, workspaceRight:w.right,
            x:Math.round(r.x+r.width/2), y:Math.ceil(r.top), width:r.width, height:r.height,
            hit:button.contains(document.elementFromPoint(r.x+r.width/2, r.y+r.height/2)) };
        })()`)
        assert.equal(bounds.panelTop, bounds.workspaceTop + 8, 'Reply details must anchor the inspector below the native titlebar')
        assert.ok(bounds.panelRight <= bounds.workspaceRight && bounds.hit)
        assert.ok(bounds.width >= 62 && bounds.height === 28)
        // Click the top edge through native input: pressing must not move this target.
        await b.send('Input.dispatchMouseEvent', { type:'mouseMoved', x:bounds.x, y:bounds.y })
        await b.send('Input.dispatchMouseEvent', { type:'mousePressed', x:bounds.x, y:bounds.y, button:'left', clickCount:1 })
        await pause(40)
        await b.send('Input.dispatchMouseEvent', { type:'mouseReleased', x:bounds.x, y:bounds.y, button:'left', clickCount:1 })
        await b.wait('document.querySelector(".camp-detail-popover:not(.reply-execution-popover)").hidden')
        assert.equal(await b.evaluate('!!document.querySelector(".reply-detail-panel")'), true)
        await click(`.camp-detail-entry[data-detail="${tab}"]`)
        await b.send('Input.dispatchKeyEvent', { type:'keyDown', key:'Escape', code:'Escape', windowsVirtualKeyCode:27 })
        await b.send('Input.dispatchKeyEvent', { type:'keyUp', key:'Escape', code:'Escape', windowsVirtualKeyCode:27 })
        await b.wait('document.querySelector(".camp-detail-popover:not(.reply-execution-popover)").hidden')
        assert.equal(await b.evaluate('!!document.querySelector(".reply-detail-panel")'), true, 'One Escape keeps the underlying reply tab open')
        results.push({ name:'reply-inspector-dismissal', ...scenario, tab, bounds })
      }
    }
    const geometry = messageId => b.evaluate(`(() => {
      const viewport = document.querySelector('.timeline-scroll'), target = viewport.querySelector('[data-message-id="${messageId}"]');
      const v = viewport.getBoundingClientRect(), r = target?.getBoundingClientRect();
      return { visible: v.height > 0 && !!r && r.top >= v.top - 1 && r.bottom <= v.bottom + 1,
        top: r?.top, bottom: r?.bottom, viewportTop: v.top, viewportBottom: v.bottom, scrollTop: viewport.scrollTop,
        focused: document.activeElement === target, detailClosed: !document.querySelector('.reply-detail-panel'),
        continuations: viewport.querySelectorAll('[data-message-id^=long-].is-group-continuation').length,
        draft: document.querySelector('[contenteditable=true]').textContent };
    })()`)
    for (const scenario of [
      { name: 'regroup-middle', loaded: true, scrollAfterOpen: 'middle', wrapped: true, grouped: true },
      { name: 'regroup-bottom', loaded: true, scrollAfterOpen: true, wrapped: true, grouped: true },
      { name: 'regroup-destination', loaded: true, scrollAfterOpen: true, wrapped: true, grouped: true, target: 'long-30' },
      { name: 'regroup-reduced-motion', loaded: true, scrollAfterOpen: true, wrapped: true, grouped: true, reduced: true },
      { name: 'scroll-middle-wrapped', loaded: true, scrollAfterOpen: 'middle', wrapped: true },
      { name: 'scroll-after-opening-wrapped', loaded: true, scrollAfterOpen: true, wrapped: true },
      { name: 'scroll-after-opening', loaded: true, scrollAfterOpen: true },
      { name: 'loaded-split', loaded: true, target: 'long-30' }, { name: 'history-split', target: 'long-30' },
      { name: 'loaded-full', loaded: true, full: true }, { name: 'history-full', full: true },
      { name: 'loaded-compact', loaded: true, width: 1040 }, { name: 'history-compact', width: 1040 },
      { name: 'reduced-motion', loaded: true, reduced: true }
    ]) {
      t.diagnostic('Reply scenario: ' + scenario.name)
      const expectedDraft = await open(scenario)
      const messageId = scenario.target ?? 'reply-a'
      await click(`[data-reply-message-id="${messageId}"] [aria-label="回到原文"]`)
      // Inspect settled geometry, not just focus: a focused offscreen row was the regression.
      await b.wait(`(() => {
        const v = document.querySelector('.timeline-scroll').getBoundingClientRect();
        const r = document.querySelector('.timeline-scroll [data-message-id="${messageId}"]')?.getBoundingClientRect();
        return v.height > 0 && r && r.top >= v.top - 1 && r.bottom <= v.bottom + 1;
      })()`)
      await pause(250)
      const afterReveal = await geometry(messageId)
      await b.capture(join(out, `${scenario.name}.png`))
      await b.send('Emulation.setDeviceMetricsOverride', { width: (scenario.width ?? 1440) + 40, height: 920, deviceScaleFactor: 1, mobile: false })
      await pause(400)
      const afterResize = await geometry(messageId)
      if (scenario.grouped) {
        // History outside the viewport is intentionally unmounted. Inspect a
        // visible Run segment before checking its width-dependent grouping.
        const point = await b.evaluate(`(() => { const e=document.querySelector('.timeline-scroll'),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,deltaY:e.scrollHeight} })()`)
        await b.send('Input.dispatchMouseEvent', { type:'mouseWheel', ...point, deltaX:0 })
        await b.wait('document.querySelectorAll("[data-message-id^=long-].is-group-continuation").length > 0')
      }
      results.push({ name: scenario.name, messageId, expectedDraft, afterReveal, afterResize })
    }
    await writeFile(join(out, 'verification.json'), JSON.stringify(results, null, 2))
    for (const { name, expectedDraft, afterReveal, afterResize } of results.filter(result => result.afterReveal)) {
      assert.equal(afterReveal.visible, true, `${name}: original must remain in the viewport: ${JSON.stringify(afterReveal)}`)
      assert.equal(afterReveal.focused, true, `${name}: original takes keyboard focus`)
      assert.equal(afterReveal.detailClosed, true)
      assert.equal(afterReveal.draft, expectedDraft)
      assert.equal(afterResize.visible, true, `${name}: subsequent resize must preserve the destination`)
    }
    await open({ loaded: true, wrapped: true, grouped: true })
    const beforeNavigation = await b.evaluate('document.querySelector(".timeline-scroll").scrollTop')
    await click('[data-reply-message-id=reply-a] [aria-label="回到原文"]')
    await b.wait(`(() => { const e = document.querySelector('.timeline-scroll'); return e.scrollTop > 800 && e.scrollTop < ${beforeNavigation} - 800 })()`)
    const point = await b.evaluate(`(() => { const r = document.querySelector('.timeline-scroll').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
    await b.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY: 600 })
    await pause(250)
    const afterManualScroll = await b.evaluate('document.querySelector(".timeline-scroll").scrollTop')
    await pause(700)
    assert.ok(afterManualScroll > 800, 'manual scrolling interrupts the original navigation')
    assert.ok(Math.abs(await b.evaluate('document.querySelector(".timeline-scroll").scrollTop') - afterManualScroll) <= 1,
      'a cancelled navigation must not move the user back later')
    await open({})
    await b.evaluate('__presence.controls.holdSourceRead = true')
    await click('[data-reply-message-id=reply-a] [aria-label="回到原文"]')
    await b.wait('__presence.controls.executionReads.some(r => r.method === "thread.messages.around" && r.messageId === "reply-a")')
    await click('[data-thread-id="demo-thread-0"] .camp-nav-open')
    await b.evaluate('__presence.controls.holdSourceRead = false')
    await pause(500)
    assert.equal(await b.evaluate('!!document.querySelector("[data-message-id=reply-a]")'), false, 'Late history cannot enter another Thread')
    assert.deepEqual(b.errors, [])
    console.log(JSON.stringify({ result: 'passed', scenarios: results.map(r => r.name), manualScroll: 'cancels', lateHistory: 'ignored' }))
  } catch (error) {
    if (b) {
      await b.capture(join(out, 'failure.png'))
      await writeFile(join(out, 'failure.json'), JSON.stringify(await b.evaluate(`(() => {
        const e = document.querySelector('.timeline-scroll');
        return { scrollTop: e?.scrollTop, scrollHeight: e?.scrollHeight, viewportHeight: e?.clientHeight,
          focused: document.activeElement?.getAttribute('data-message-id'),
          sampleHeight: e?.querySelector('[data-message-id=long-30] .message-surface')?.getBoundingClientRect().height,
          detailOpen: !!document.querySelector('.reply-detail-panel') };
      })()`), null, 2))
    }
    throw error
  } finally {
    await b?.close()
    await rm(root, { recursive: true, force: true })
  }
}

test('reply splitter folds while held and preserves width on reopen', { timeout: 60_000 }, t => runReplyDetails(t, true))
test('reply detail navigation reveals and retains the original after layout and history loading', { timeout: 120_000 }, t => runReplyDetails(t))
