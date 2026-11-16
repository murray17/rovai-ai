import assert from 'node:assert/strict'
import test from 'node:test'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchAcceptanceBrowser, pause } from './host-web-browser.mjs'

test('later timeline actions supersede an unfinished search return', { timeout:120_000 }, async t => {
  const chrome = process.env.ROVAI_TEST_CHROME ?? (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : process.platform === 'win32'
      ? join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe') : '/usr/bin/google-chrome')
  if (!await access(chrome).then(() => true, () => false)) return t.skip('Chrome unavailable; search return acceptance did not run')
  const root = await mkdtemp(join(tmpdir(), 'rovai-search-return-'))
  const out = process.env.ROVAI_SEARCH_RETURN_OUTPUT ?? join(root, 'screenshots')
  await mkdir(out, { recursive:true })
  let b
  const report = []
  try {
    await promisify(execFile)(process.execPath, [resolve(import.meta.dirname, '../fixtures/run-presence/build.mjs'), root],
      { env:{ ...process.env, ROVAI_FIXTURE_READING_NAVIGATION:'1' } })
    b = await launchAcceptanceBrowser({ executable:chrome, args:['--headless=new', `--user-data-dir=${join(root,'profile')}`,
      '--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0',
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []),'about:blank'] })
    await b.send('Emulation.setFocusEmulationEnabled', { enabled:true })
    const click = selector => b.click(`document.querySelector(${JSON.stringify(selector)})`)
    const key = async (key, code, value, modifiers = 0) => {
      await b.send('Input.dispatchKeyEvent', { type:'keyDown', key, code, windowsVirtualKeyCode:value, modifiers })
      await b.send('Input.dispatchKeyEvent', { type:'keyUp', key, code, windowsVirtualKeyCode:value, modifiers })
    }
    const position = () => b.evaluate(`(()=>{const v=document.querySelector('.timeline-scroll');return{top:v.scrollTop,bottom:v.scrollHeight-v.clientHeight-v.scrollTop}})()`)
    for (const action of ['latest','send','wheel','keyboard','pending-latest']) await t.test(action, async () => {
      try {
        await b.send('Page.navigate', { url:pathToFileURL(join(root,'rovai-teammate-presence.html')).href+`?pure=1&virtualHistory=1&restore=${action}` })
        await b.wait('!!window.__presence && !!window.__timelineControllerRef?.current')
        await b.evaluate(`__presence.showReplyCase(true,true,false,false,1000);__presence.showNarration('固定进展');__presence.controls.steerReview=true`)
        await b.wait('!!document.querySelector("[data-message-id=long-1000]")')
        await pause(250)
        const point = await b.evaluate(`(()=>{const r=document.querySelector('.timeline-scroll').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
        await b.send('Input.dispatchMouseEvent', { type:'mouseWheel', ...point, deltaX:0, deltaY:-2600 })
        await pause(300)
        const before = await b.evaluate(`(()=>{const v=document.querySelector('.timeline-scroll'),top=v.getBoundingClientRect().top;const e=[...v.querySelectorAll('[data-message-id]')].find(e=>{const r=e.getBoundingClientRect();return r.bottom>top&&r.top<top+v.clientHeight});return{id:e.dataset.messageId,offset:e.getBoundingClientRect().top-top}})()`)
        await key('f','KeyF',70,process.platform === 'darwin' ? 4 : 2)
        await b.wait('!!document.querySelector(".conversation-find-surface input")')
        await click('.conversation-find-surface input')
        await b.send('Input.insertText', { text:'长链回复 321' })
        await b.wait('!!document.querySelector("[data-message-id=long-321].conversation-find-current-message")')
        await pause(180)
        // Hold completion *after* the real mount, preserving the production
        // caller and scroll behavior. The ref setter also wraps new handles
        // installed during search close. No delay enters production bundles.
        await b.evaluate(`(()=>{
          let handle=__timelineControllerRef.current;
          const gate=window.searchReturnGate={id:${JSON.stringify(before.id)},entered:false,released:false};
          gate.promise=new Promise(resolve=>gate.release=()=>{gate.released=true;resolve()});
          Object.defineProperty(__timelineControllerRef,'current',{configurable:true,get(){return handle&&new Proxy(handle,{get(target,name){
            if(name!=='ensureMounted')return Reflect.get(target,name);
            return async(...args)=>{
              const node=await target.ensureMounted(...args);
              if(args[0]===gate.id&&!gate.entered){
                gate.signal=args[1];
                if(${action === 'pending-latest'}){
                  const marker=document.createElement('span');marker.dataset.timelinePending='';node.append(marker);
                  gate.release=()=>{gate.released=true;marker.remove()};
                  const waiting=target.ensureMounted(...args);gate.entered=true;
                  const mounted=await waiting;gate.mountCancelled=mounted===null;return mounted;
                }
                gate.entered=true;await gate.promise;
              }
              return node;
            }
          }});},set(value){handle=value}});
        })()`)
        await click('[aria-label="关闭会话查找"]')
        await b.wait('searchReturnGate.entered')
        if (action.endsWith('latest')) await click('.return-to-latest[data-return-scope="camp"]')
        if (action === 'send') {
          await click('[contenteditable=true]')
          await b.send('Input.insertText', { text:'搜索关闭后立即发送，保留最后一字。' })
          await key('Enter','Enter',13)
          await b.wait(`__presence.getState().snapshot.messages.some(m=>m.body==='搜索关闭后立即发送，保留最后一字。')`)
          assert.equal(await b.evaluate('__presence.getState().snapshot.messages.length'),1001)
        }
        if (action === 'wheel') {
          await b.send('Input.dispatchMouseEvent', { type:'mouseWheel', ...point, deltaX:0, deltaY:-190 })
        }
        if (action === 'keyboard') {
          await b.evaluate(`document.querySelector('.timeline-scroll').focus({preventScroll:true})`)
          await key('PageUp','PageUp',33)
        }
        await pause(250)
        const chosen = await position()
        if (action === 'pending-latest') assert.equal(await b.evaluate('searchReturnGate.mountCancelled'),true,
          'later navigation must cancel the unresolved mount as well as the final scroll restore')
        await b.evaluate('searchReturnGate.release()')
        await pause(350)
        const settled = await position()
        report.push({ action, before, chosen, settled, signalAborted:await b.evaluate('searchReturnGate.signal?.aborted??false') })
        if (action.endsWith('latest') || action === 'send') {
          assert.ok(settled.bottom<2, `${action}: stale search return overrode the later action: ${JSON.stringify({chosen,settled})}`)
          await b.evaluate('__presence.appendHistoryMessage()')
          await pause(250)
          assert.ok((await position()).bottom<2, 'search return must not disable following after the later action')
        } else assert.ok(Math.abs(settled.top-chosen.top)<2,
          `${action}: stale search return displaced the user: ${JSON.stringify({chosen,settled})}`)
        await b.capture(join(out,`return-${action}.png`))
      } catch (error) { await b.capture(join(out,`failure-${action}.png`)); throw error }
    })
    await t.test('Tab and Shift+Tab cross virtual windows without losing visible focus', async () => {
      await b.send('Page.navigate', { url:pathToFileURL(join(root,'rovai-teammate-presence.html')).href+'?pure=1&virtualHistory=1&restore=tab' })
      await b.wait('!!window.__presence && !!window.__timelineControllerRef?.current')
      await b.evaluate(`__presence.showReplyCase(true,true,false,false,1000);__presence.showNarration('固定进展')`)
      await b.wait('!!document.querySelector("[data-message-id=long-1000]")')
      await b.evaluate(`__timelineControllerRef.current.ensureMounted('long-10').then(node=>!!node)`)
      await pause(150)
      assert.equal(await b.evaluate(`(()=>{const row=document.querySelector('[data-message-id=long-10]'),v=document.querySelector('.timeline-scroll');v.scrollTop+=row.getBoundingClientRect().top-v.getBoundingClientRect().top-20;const button=[...row.querySelectorAll('button')].find(b=>!b.disabled&&b.tabIndex>=0&&b.getClientRects().length);button.focus();return document.activeElement===button})()`),true)
      const traversal = { action:'tab-traversal' }
      for (const [name,modifiers] of [['tab',0],['shiftTab',8]]) {
        const entries = []
        for (let i=0;i<80;i++) {
          await key('Tab','Tab',9,modifiers); await pause(70)
          const entry = await b.evaluate(`(()=>{const e=document.activeElement,v=document.querySelector('.timeline-scroll'),r=v.getBoundingClientRect(),b=e.getBoundingClientRect();return{id:e.closest('[data-message-id]')?.dataset.messageId,inside:v.contains(e),visible:b.bottom>r.top&&b.top<r.bottom,key:document.querySelector('.timeline-virtual-list [data-timeline-key]')?.dataset.timelineKey}})()`)
          entries.push(entry)
          assert.ok(entry.inside&&entry.visible,`${name} lost usable focus before reaching the history boundary: ${JSON.stringify(entry)}`)
        }
        assert.ok(new Set(entries.map(e=>e.key)).size>1,`${name} did not cross a virtual window`)
        traversal[name] = { steps:entries.length, messages:[...new Set(entries.map(e=>e.id).filter(Boolean))], windows:new Set(entries.map(e=>e.key)).size }
      }
      report.push(traversal)
      await b.capture(join(out,'tab-traversal.png'))
    })
    assert.deepEqual(b.errors, [])
  } finally {
    await writeFile(join(out,'verification.json'), JSON.stringify(report,null,2))
    await b?.close(); await rm(root,{recursive:true,force:true})
  }
})
