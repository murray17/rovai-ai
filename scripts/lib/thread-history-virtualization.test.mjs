import assert from 'node:assert/strict'
import test from 'node:test'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { launchAcceptanceBrowser, pause } from './host-web-browser.mjs'

// This owner exercises DOM lifetime and real layout in the production workspace;
// a row-selection or prefix-height unit test cannot detect these regressions.
test('public history bounds mounting and preserves reading, selection, focus and navigation', { timeout: 120_000 }, async t => {
  const chrome = process.env.ROVAI_TEST_CHROME ?? (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : process.platform === 'win32'
      ? join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe') : '/usr/bin/google-chrome')
  if (!await access(chrome).then(() => true, () => false)) return t.skip('Chrome unavailable; history layout acceptance did not run')
  const root = await mkdtemp(join(tmpdir(), 'rovai-history-'))
  const out = process.env.ROVAI_HISTORY_UI_OUTPUT ?? join(root, 'screenshots')
  await mkdir(out, { recursive: true })
  let b
  const report = []
  try {
    await promisify(execFile)(process.execPath, [resolve(import.meta.dirname, '../fixtures/run-presence/build.mjs'), root])
    b = await launchAcceptanceBrowser({ executable: chrome, args: ['--headless=new', `--user-data-dir=${join(root, 'profile')}`,
      '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0',
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'] })
    await b.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    const click = selector => b.click(`document.querySelector(${JSON.stringify(selector)})`)
    let generation = 0
    const open = async (count, loaded = true, largeBody = false) => {
      const search = `?pure=1&virtualHistory=1&case=${++generation}`
      await b.send('Page.navigate', { url: pathToFileURL(join(root, 'rovai-teammate-presence.html')).href + search })
      await b.wait(`location.search === ${JSON.stringify(search)} && !!window.__presence && !!document.querySelector('[contenteditable=true]')`)
      await b.evaluate(`__presence.showReplyCase(true, ${loaded}, false, false, ${count}, ${largeBody}); __presence.showNarration('固定执行预览')`)
      await b.wait(`!!document.querySelector('[data-message-id=long-${count}]')`)
      await pause(200)
    }
    const wheel = async deltaY => {
      const point = await b.evaluate(`(() => { const r = document.querySelector('.timeline-scroll').getBoundingClientRect(); return { x:r.x+r.width/2,y:r.y+r.height/2 } })()`)
      await b.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY })
      await pause(250)
    }
    const anchor = () => b.evaluate(`(() => {
      const v = document.querySelector('.timeline-scroll'), r = v.getBoundingClientRect();
      const e = [...v.querySelectorAll('[data-message-id]')].find(e => {const b=e.getBoundingClientRect();return b.bottom>r.top&&b.top<r.bottom});
      return { id:e?.dataset.messageId, offset:e ? e.getBoundingClientRect().top-r.top : null };
    })()`)
    const offset = id => b.evaluate(`(() => {const v=document.querySelector('.timeline-scroll'),e=v.querySelector('[data-message-id=${id}]');return e ? e.getBoundingClientRect().top-v.getBoundingClientRect().top : null})()`)
    for (const count of [20, 200]) {
      for (const action of ['release', 'remove']) {
        await b.send('Page.navigate', { url: pathToFileURL(join(root, 'rovai-teammate-presence.html')).href + `?timelineReadiness=1&probeCount=${count}&case=${action}` })
        await b.wait('!!window.__timelineReadiness')
        await b.evaluate(`window.probeResult='pending';__timelineReadiness.mount('probe-0').then(value=>window.probeResult=value);true`)
        await pause(100)
        assert.equal(await b.evaluate('probeResult'), 'pending', 'row navigation must wait for content readiness')
        await b.evaluate(`__timelineReadiness.${action}()`)
        await b.wait(`window.probeResult !== 'pending'`)
        assert.equal(await b.evaluate('probeResult'), action === 'release' ? true : null)
      }
    }
    for (const count of [200, 1000]) {
      t.diagnostic(`mounted scale ${count}`)
      await open(count)
      const mounted = await b.evaluate('document.querySelectorAll(".timeline-scroll [data-message-id]").length')
      assert.ok(mounted > 0 && mounted < 45, `${count}: mounted ${mounted}`)
      await click('[contenteditable=true]')
      await b.evaluate('void (window.savedEditor=document.querySelector("[contenteditable=true]"))')
      await b.send('Input.insertText', { text: '快速输入后保留最后一个字。' })
      await b.evaluate('__presence.appendHistoryMessage()')
      await pause(250)
      assert.equal(await b.evaluate('window.savedEditor === document.querySelector("[contenteditable=true]")'), true)
      assert.match(await b.evaluate('window.savedEditor.textContent'), /最后一个字。$/)
      await wheel(-2200)
      const before = await anchor()
      assert.ok(before.id)
      await b.evaluate('__presence.appendHistoryMessage()')
      await pause(350)
      assert.ok(Math.abs((await offset(before.id)) - before.offset) < 2, 'new messages must preserve an older reading position')
      report.push({ count, mounted, anchor: before })
    }
    const imageAnchor = await anchor()
    await b.evaluate(`(() => {
      const v=document.querySelector('.timeline-scroll'),top=v.getBoundingClientRect().top;
      const row=[...v.querySelectorAll('[data-message-id]')].find(e=>e.getBoundingClientRect().bottom<top);
      if(!row) throw Error('a buffered row is required for image-height acceptance');
      const image=document.createElement('img');image.alt='异步图片夹具';
      image.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="180"><rect width="60" height="180" fill="green"/></svg>');
      row.querySelector('.message-surface').append(image);
    })()`)
    await pause(350)
    assert.ok(Math.abs((await offset(imageAnchor.id)) - imageAnchor.offset) < 2, 'image growth above the viewport must preserve the reading anchor')
    // Focus and a native DOM selection retain old rows while the viewport moves.
    const selected = await b.evaluate(`(() => {
      const v=document.querySelector('.timeline-scroll'), rows=[...v.querySelectorAll('[data-message-id^=long-]')];
      const first=rows[1], last=rows[2], range=document.createRange();
      range.setStartBefore(first.querySelector('.message-surface'));range.setEndAfter(last.querySelector('.message-surface'));
      getSelection().removeAllRanges();getSelection().addRange(range);first.focus({preventScroll:true});
      window.savedSelectedRows=[first,last];window.savedSelection=getSelection().toString();
      return { ids:[first.dataset.messageId,last.dataset.messageId],text:window.savedSelection };
    })()`)
    assert.ok(selected.text.length > 5)
    await wheel(100_000)
    assert.equal(await b.evaluate('savedSelectedRows.every(e=>e.isConnected) && getSelection().toString() === savedSelection'), true)
    assert.ok(await b.evaluate('Number(document.querySelector(".timeline-virtual-list").dataset.retainedCount)') >= 2)
    assert.equal(await b.evaluate(`(() => {
      const v=document.querySelector('.timeline-scroll'),r=v.getBoundingClientRect();
      const visible=new Set([...v.querySelectorAll('[data-message-id]')].filter(e=>{const b=e.getBoundingClientRect();return b.bottom>r.top&&b.top<r.bottom}).map(e=>e.dataset.messageId));
      const acknowledged=__presence.controls.visibleSources.at(-1)?.messageIds;
      return acknowledged?.length>0 && acknowledged.every(id=>visible.has(id));
    })()`), true, 'retained or buffered DOM must not acknowledge offscreen messages')
    await b.evaluate('getSelection().removeAllRanges(); document.activeElement.blur()')
    await pause(300)
    assert.equal(await b.evaluate('savedSelectedRows.every(e=>!e.isConnected)'), true, 'released rows must leave the DOM')
    report.push({ selection: selected.ids, released: true })

    await click('[data-message-id=long-999] .message-author-name-trigger')
    await b.wait('!!document.querySelector(".mention-profile-popover")')
    await b.evaluate('void (window.expandedHistoryRow=document.querySelector("[data-message-id=long-999]"))')
    await b.evaluate('document.querySelector(".timeline-scroll").scrollTop=0')
    await pause(250)
    assert.equal(await b.evaluate('expandedHistoryRow.isConnected'), true, 'an open profile must keep its owner mounted')
    await b.key('Escape')
    await click('[contenteditable=true]')
    await pause(250)
    assert.equal(await b.evaluate('expandedHistoryRow.isConnected'), false)

    // 50-message paging crosses the virtualization threshold without moving the old anchor.
    await open(200, false)
    for (const loaded of [62, 112, 162, 200]) {
      await b.evaluate('document.querySelector(".timeline-scroll").scrollTop=0')
      await pause(200)
      const before = await anchor()
      if (loaded === 112) await b.evaluate(`(() => {
        window.thresholdMessage=document.querySelector('[data-message-id=${before.id}]');thresholdMessage.focus({preventScroll:true});
        const range=document.createRange();range.selectNodeContents(thresholdMessage.querySelector('.message-surface'));
        getSelection().removeAllRanges();getSelection().addRange(range);window.thresholdSelection=getSelection().toString();
        if(document.activeElement !== thresholdMessage) throw Error('threshold fixture did not establish keyboard focus');
      })()`)
      await b.evaluate('document.querySelector(".camp-history-text-button").click()')
      await b.wait(`__presence.getState().snapshot.messages.length === ${loaded} && !document.querySelector('.camp-history-loader.is-loading')`)
      await pause(350)
      const after = await offset(before.id)
      const thresholdState = loaded === 112 ? await b.evaluate('({ sameNode:thresholdMessage === document.querySelector("[data-message-id="+thresholdMessage.dataset.messageId+"]"), focus:document.activeElement === thresholdMessage, text:getSelection().toString(), expected:thresholdSelection })') : null
      assert.ok(after !== null && Math.abs(after - before.offset) < 2, `${loaded}: prepending displaced ${before.id} from ${before.offset} to ${after}; ${JSON.stringify(thresholdState)}`)
      if (loaded === 112) {
        const retained = thresholdState
        assert.ok(retained.sameNode && retained.focus && retained.text === retained.expected,
          'crossing the threshold must retain selected DOM and focus: '+JSON.stringify(retained))
        await b.evaluate('getSelection().removeAllRanges();document.activeElement.blur()')
      }
      report.push({ loaded, anchor: before, after })
    }
    // Search waits for a newly mounted large body, then restores an old offset
    // inside another large body when the search window closes.
    await open(1000, true, true)
    await wheel(-2600)
    const beforeFind = await anchor()
    await b.send('Input.dispatchKeyEvent', { type:'keyDown', key:'f', code:'KeyF', windowsVirtualKeyCode:70, modifiers: process.platform === 'darwin' ? 4 : 2 })
    await b.send('Input.dispatchKeyEvent', { type:'keyUp', key:'f', code:'KeyF', windowsVirtualKeyCode:70 })
    await b.wait('!!document.querySelector(".conversation-find-surface input")')
    await click('.conversation-find-surface input')
    await b.send('Input.insertText', { text:'长链回复 321' })
    await b.wait('!!document.querySelector("[data-message-id=long-321].conversation-find-current-message")')
    await pause(350)
    assert.equal(await b.evaluate('document.querySelectorAll("[data-message-id=long-321] .markdown-code-frame").length'), 150)
    assert.equal(await b.evaluate('!!document.querySelector("[data-message-id=long-321] [data-timeline-pending]")'), false)
    const found = await offset('long-321')
    assert.ok(found >= 0 && found < 600, `search destination offscreen: ${found}`)
    await click('[aria-label="关闭会话查找"]')
    await pause(450)
    const restored = await offset(beforeFind.id)
    assert.ok(restored !== null && Math.abs(restored - beforeFind.offset) < 2,
      `closing distant search must restore ${beforeFind.id} at ${beforeFind.offset}; got ${restored}`)
    report.push({ searchReturn: beforeFind, restored })
    await b.capture(join(out, 'history-search.png'))
    assert.deepEqual(b.errors, [])
    await writeFile(join(out, 'verification.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ result:'passed', scenarios:report }))
  } catch (error) {
    if (b) {
      await b.capture(join(out, 'failure.png'))
      await writeFile(join(out, 'failure.json'), JSON.stringify(await b.evaluate(`(() => ({
        scroll:document.querySelector('.timeline-scroll')?.scrollTop,
        mounted:[...document.querySelectorAll('.timeline-scroll [data-message-id]')].map(e=>e.dataset.messageId),
        history:document.querySelector('.camp-history-loader')?.textContent,errors:${JSON.stringify(b.errors)}
      }))()`), null, 2))
    }
    throw error
  } finally { await b?.close(); await rm(root, { recursive:true, force:true }) }
})
