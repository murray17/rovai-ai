import assert from 'node:assert/strict'
import test from 'node:test'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { launchAcceptanceBrowser, pause } from './host-web-browser.mjs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'

test('production conversation presence matches the divider design and durable retry recovery', {timeout:180_000}, async t => {
const chrome = process.env.ROVAI_TEST_CHROME ?? process.env.ROVAI_REVIEW_CHROME ?? (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : process.platform === 'win32'
    ? join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe') : '/usr/bin/google-chrome')
if (!await access(chrome).then(() => true, () => false)) {
  t.skip('Chrome is not installed; conversation presence acceptance did not run')
  return
}
const root = await mkdtemp(join(tmpdir(), 'rovai-run-presence-'))
const out = process.env.ROVAI_PRESENCE_UI_OUTPUT ?? join(root, 'screenshots')
await promisify(execFile)(process.execPath, [resolve(import.meta.dirname, '../fixtures/run-presence/build.mjs'), root])
await mkdir(out, { recursive:true })
const native = await launchAcceptanceBrowser({executable:chrome,
  args:['--headless=new',`--user-data-dir=${join(root,'profile')}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-crash-reporter','--disable-breakpad','--remote-debugging-port=0',...(process.platform==='linux'?['--no-sandbox']:[]),'about:blank']})
await native.send('Emulation.setFocusEmulationEnabled',{enabled:true})
const b = {...native,
  click:selector=>native.click(`document.querySelector(${JSON.stringify(selector)})`),
  async key(key) {await native.send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:key==='Enter'?13:27,...(key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})});await native.send('Input.dispatchKeyEvent',{type:'keyUp',key,code:key})}
}, report = { scenarios:[], interactions:[], viewports:[] }
const settle = () => pause(220)
const stage = async n => { await b.evaluate(`__presence.setStage(${n})`); await settle() }
const scenario = async (name,n) => { await b.evaluate(`__presence.setScenario(${JSON.stringify(name)});__presence.setStage(${n})`); await settle() }
const rest = async () => { await b.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:4,y:4});await b.evaluate('document.activeElement?.blur()');await settle() }
const row = '[data-presence-run="run-alice"]'
const identity = () => b.evaluate(`(() => {const row=document.querySelector('${row}');return {continuation:row.dataset.continuation,avatar:!!row.querySelector('.member-avatar'),after:Array.from(document.querySelectorAll('[data-message-id]')).filter(e=>Boolean(e.compareDocumentPosition(row)&Node.DOCUMENT_POSITION_FOLLOWING)).at(-1)?.dataset.messageId,top:row.getBoundingClientRect().top}})()`)
try {
  await b.send('Page.navigate',{url:pathToFileURL(join(root,'rovai-teammate-presence.html')).href})
  await b.wait('!!window.__presence && !!document.querySelector(".composer-box")')
  for (const [name,total] of Object.entries({stream:5,parallel:5,single:5,interleaved:6,same_member:5,followup:5,failed:3,silent:3})) {
    for(let n=0;n<total;n++) {
      await scenario(name,n)
      const result=await b.evaluate('__presence.verify()')
      for(const key of ['allMessagesPresent','messagesInOrder','uniqueMessages','slotsAreNotMessages','noQueuedPlaceholders','noCompletedRows','uniqueRuns','anchoredOrder','independentActivityRows','compactRows','identityMatchesRun','commandIconsMatchContent','retryOnlyOnFailure']) assert.equal(result[key],true,`${name}/${n}/${key}`)
      assert.equal(result.overflow,false)
      report.scenarios.push({name,stage:n,...result})
    }
    console.log(`PASS ${name}: ${total} stages`)
  }

  // A real incremental evidence stream, not a CSS animation of a completed body.
  await scenario('stream',0)
  await b.evaluate('window.savedRow=document.querySelector(".conversation-run-presence");window.savedMessageIds=__presence.getState().snapshot.messages.map(m=>m.id)')
  const sample=()=>b.evaluate(`(() => {const e=document.querySelector('.run-presence-preview'),row=e.closest('.conversation-run-presence'),run=__presence.getState().snapshot.executionEvidence.filter(e=>e.agentRunId==='run-alice').at(-1),range=document.createRange();range.setStart(e.firstChild,0);range.setEnd(e.firstChild,1);return {text:e.textContent,raw:run.payload.delta,height:row.getBoundingClientRect().height,top:row.getBoundingClientRect().top,scroll:e.scrollLeft,firstCharacterLeft:range.getBoundingClientRect().left,stopLeft:row.querySelector('.run-presence-stop').getBoundingClientRect().left,ellipsis:getComputedStyle(e).textOverflow,sameNode:row===window.savedRow,ids:__presence.getState().snapshot.messages.map(m=>m.id)}})()`)
  const first=await sample();await b.capture(join(out,'stream-start.png'));await pause(600);const second=await sample()
  assert.ok(second.text.length>first.text.length)
  assert.ok(second.raw.length>first.raw.length)
  assert.equal(second.text,second.raw.split(/\r\n?|\n/).findLast(line=>line.trim()).trim())
  assert.equal(first.height,second.height);assert.equal(first.top,second.top);assert.equal(second.sameNode,true);assert.deepEqual(second.ids,first.ids)
  await b.wait('document.querySelector(".run-presence-preview").scrollWidth>document.querySelector(".run-presence-preview").clientWidth')
  const overflow=await sample();assert.equal(overflow.height,first.height);assert.equal(overflow.top,first.top)
  assert.equal(overflow.scroll,0);assert.equal(overflow.ellipsis,'ellipsis');assert.equal(overflow.firstCharacterLeft,first.firstCharacterLeft);assert.equal(overflow.stopLeft,first.stopLeft)
  await pause(350);const laterOverflow=await sample();assert.ok(laterOverflow.text.length>overflow.text.length);assert.equal(laterOverflow.scroll,0);assert.equal(laterOverflow.firstCharacterLeft,first.firstCharacterLeft);assert.equal(laterOverflow.stopLeft,first.stopLeft)
  await b.capture(join(out,'stream-overflow.png'))
  report.interactions.push({streaming:'growing evidence; single-line ellipsis preserves beginning, first character and Stop position; no horizontal scrolling or vertical jump',samples:[first.text.length,second.text.length,overflow.text.length,laterOverflow.text.length],lineHeight:first.height})

  await scenario('stream',0)
  await b.click('.run-presence-open');await settle()
  assert.match(await b.evaluate('document.querySelector(".camp-detail-popover").innerText'),/执行/)
  const beforeDetail=await b.evaluate('document.querySelector(".camp-detail-popover").innerText')
  await pause(450)
  assert.notEqual(await b.evaluate('document.querySelector(".camp-detail-popover").innerText'),beforeDetail)
  await b.capture(join(out,'stream-detail.png'));await b.key('Escape');await settle()
  report.interactions.push('full production Run detail receives the same incremental narration')

  await scenario('stream',0)
  const lineGeometry = () => b.evaluate('(() => {const r=document.querySelector(".run-presence-line").getBoundingClientRect(),s=document.querySelector(".run-presence-stop").getBoundingClientRect();return [r.x,r.y,r.height,s.x,s.y]})()')
  const geometry = await lineGeometry()
  for (const [source, expected] of [['第一行正在输出','第一行正在输出'],['第一行正在输出\n','第一行正在输出'],
    ['第一行正在输出\n第二','第二'],['第一行正在输出\n第二行继续','第二行继续'],
    ['第一行正在输出\r\n第二行继续\r\n\r\n第三行','第三行']]) {
    await b.evaluate('__presence.showNarration(' + JSON.stringify(source) + ')'); await settle()
    assert.equal(await b.evaluate('document.querySelector(".run-presence-preview").textContent'),expected)
    assert.deepEqual(await lineGeometry(),geometry)
  }
  assert.equal(await b.evaluate('document.querySelectorAll(".run-presence-status.is-running").length'),0)
  assert.equal(await b.evaluate('getComputedStyle(document.querySelector(".run-presence-preview .running-text-highlight")).animationName'),'running-text-sweep')
  assert.equal(await b.evaluate('getComputedStyle(document.querySelector(".run-presence-preview .running-text-highlight")).animationDuration'),'4.8s')
  await b.click('.run-presence-open'); await settle()
  const complete = await b.evaluate('document.querySelector(".camp-detail-popover").textContent')
  for (const text of ['第一行正在输出','第二行继续','第三行']) assert.ok(complete.includes(text))
  await b.key('Escape'); await settle()
  report.interactions.push('original LF/CRLF and blank lines advance narration in the same fixed row; RunningText replaces the circle; details preserve the complete source')

  await b.evaluate('__presence.showStartupStatus("runtime_initializing")'); await settle()
  const startupGeometry = await lineGeometry()
  assert.equal(await b.evaluate('document.querySelector(".run-presence-preview").textContent'),'正在连接智能体…')
  await b.evaluate('__presence.showStartupStatus(null)'); await settle()
  assert.equal(await b.evaluate('document.querySelector(".run-presence-preview").textContent'),'正在处理你的请求…')
  assert.deepEqual(await lineGeometry(),startupGeometry)
  report.interactions.push('authoritative initialization changes to accepted-request fallback in the same row')

  await scenario('stream',1)
  const openContext = async () => {
    const point = await b.evaluate('(() => {const r=document.querySelector(".run-presence-open").getBoundingClientRect();return {x:r.x+80,y:r.y+r.height/2}})()')
    await b.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'right',clickCount:1})
    await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'right',clickCount:1})
    await b.wait('!!document.querySelector(".run-presence-menu")')
  }
  await openContext()
  assert.deepEqual(await b.evaluate('Array.from(document.querySelectorAll(".run-presence-menu [role=menuitem]")).map(e=>e.textContent)'),['查看执行过程','减少动态效果…'])
  assert.equal(await b.evaluate('Array.from(document.querySelectorAll(".camp-detail-popover,.run-presence-stop-dialog")).some(e=>e.getClientRects().length>0)'),false)
  await b.capture(join(out,'motion-context-day.png'))
  await b.key('Escape'); await settle()
  assert.equal(await b.evaluate('document.activeElement.matches(".run-presence-open")'),true)
  await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:'F10',code:'F10',windowsVirtualKeyCode:121,modifiers:8})
  await b.send('Input.dispatchKeyEvent',{type:'keyUp',key:'F10',code:'F10',windowsVirtualKeyCode:121,modifiers:8})
  await b.wait('!!document.querySelector(".run-presence-menu")')
  await b.click('.run-presence-menu [role=menuitem]'); await settle()
  assert.ok(await b.evaluate('document.querySelectorAll(".camp-detail-popover .running-text-highlight").length'))
  assert.equal(await b.evaluate('Array.from(document.querySelectorAll(".camp-detail-popover .running-text-highlight")).every(e=>getComputedStyle(e).animationDuration==="4.8s")'),true)
  await b.key('Escape'); await settle()
  report.interactions.push('right click and Shift+F10 open two actions, Escape restores row focus; left/detail action remains Run-specific and RunCard shares 4.8s')

  await b.click('[contenteditable=true]'); await b.send('Input.insertText',{text:'返回后继续写这条草稿'}); await settle()
  const motionDraft = await b.evaluate('document.querySelector("[contenteditable=true]").textContent')
  await openContext(); await b.click('.run-presence-menu [role=menuitem]:last-child')
  await b.wait('document.activeElement?.id === "appearance-motion"')
  assert.deepEqual(await b.evaluate('Array.from(document.querySelector("#appearance-motion").options).map(o=>o.text)'),['跟随系统','始终减少'])
  assert.equal(await b.evaluate('(() => {const r=document.activeElement.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()'),true)
  await b.capture(join(out,'motion-settings-focus.png'))
  await b.evaluate('(() => {const e=document.querySelector("#appearance-motion");e.value="reduce";e.dispatchEvent(new Event("change",{bubbles:true}))})()')
  await b.wait('document.documentElement.dataset.motionPreference === "reduce"')
  await b.click('.settings-sidebar-back'); await settle()
  assert.equal(await b.evaluate('document.querySelector("[contenteditable=true]").textContent'),motionDraft)
  assert.equal(await b.evaluate('getComputedStyle(document.querySelector(".run-presence-preview .running-text-highlight")).display'),'none')
  await b.click('.run-presence-open'); await settle()
  assert.equal(await b.evaluate('Array.from(document.querySelectorAll(".camp-detail-popover .running-text-highlight")).every(e=>getComputedStyle(e).display==="none")'),true)
  await b.key('Escape'); await settle()
  await openContext(); await b.click('.run-presence-menu [role=menuitem]:last-child')
  await b.wait('document.activeElement?.id === "appearance-motion"')
  await b.evaluate('(() => {const e=document.querySelector("#appearance-motion");e.value="system";e.dispatchEvent(new Event("change",{bubbles:true}))})()')
  await b.wait('document.documentElement.dataset.motionPreference === "system"')
  await b.click('.settings-sidebar-back'); await settle()
  assert.equal(await b.evaluate('getComputedStyle(document.querySelector(".run-presence-preview .running-text-highlight")).animationDuration'),'4.8s')
  report.interactions.push('menu reaches and focuses the actual Appearance select; app reduction hides row and RunCard highlights, returning preserves the fixture draft and switching back resumes 4.8s')

  // A stays below its own reply while B speaks; only another A send moves A.
  await scenario('interleaved',2)
  let before=await identity();assert.equal(before.continuation,'true');assert.equal(before.avatar,false);assert.equal(before.after,'reply-alice')
  await b.evaluate(`window.savedRow=document.querySelector('${row}');document.querySelector('${row} .run-presence-open').focus()`)
  await b.capture(join(out,'same-run-continuation.png'))
  await stage(3)
  let after=await identity();assert.equal(after.continuation,'true');assert.equal(after.avatar,false);assert.equal(after.after,'reply-alice');assert.equal(after.top,before.top)
  assert.equal(await b.evaluate(`document.querySelector('${row}')===window.savedRow`),true)
  assert.equal(await b.evaluate(`document.activeElement===document.querySelector('${row} .run-presence-open')`),true)
  await rest();await b.capture(join(out,'other-member-interrupts.png'))
  await b.evaluate('document.querySelector("[data-presence-run=run-alice] .run-presence-open").focus()')
  await stage(4)
  after=await identity();assert.equal(after.avatar,false);assert.equal(after.continuation,'true');assert.equal(after.after,'reply-alice-2')
  assert.equal(await b.evaluate('document.querySelector("[data-presence-run=run-alice]")===window.savedRow'),true)
  assert.equal(await b.evaluate('document.activeElement===document.querySelector("[data-presence-run=run-alice] .run-presence-open")'),true)
  await b.capture(join(out,'same-run-replies-again.png'))
  await stage(5);assert.equal(await b.evaluate('document.querySelectorAll(".conversation-run-presence").length'),0)
  report.interactions.push('A reply → B message → A reply: own anchor stays until next own send; live DOM and focus preserved')

  await scenario('same_member',1);assert.equal((await identity()).avatar,false)
  await stage(2);assert.equal((await identity()).avatar,false);assert.equal((await identity()).after,'reply-alice')
  await b.capture(join(out,'same-member-other-run.png'))
  await stage(3);assert.equal((await identity()).avatar,false)
  report.interactions.push('identity continuity uses Run ID, not member identity')

  await scenario('parallel',0);assert.equal(await b.evaluate('document.querySelectorAll(".conversation-run-presence").length'),0)
  await stage(1);assert.equal(await b.evaluate('__presence.getState().snapshot.agentRuns.some(r=>r.status==="queued")'),true)
  assert.equal(await b.evaluate('document.querySelectorAll(".conversation-run-presence").length'),1)
  await stage(2)
  assert.deepEqual(await b.evaluate('Array.from(document.querySelectorAll(".conversation-run-presence")).map(e=>[e.dataset.presenceRun,e.dataset.continuation])'),[['run-alice','false'],['run-audrey','true']])
  await b.capture(join(out,'parallel-live-tail.png'))
  await scenario('followup',2);assert.equal(await b.evaluate('document.querySelectorAll(".conversation-run-presence").length'),1);assert.equal((await identity()).after,'request-main')
  await scenario('silent',2);assert.equal(await b.evaluate('document.querySelectorAll(".conversation-run-presence").length'),0)
  report.interactions.push('queued inputs occupy no space; parallel rows retain individual anchors; silent completion leaves no completion row')

  // Compare the actual message-action styles with the unchanged production view.
  await scenario('interleaved',3);await rest()
  const actions=()=>b.evaluate(`Array.from(document.querySelectorAll('.public-agent-message .message-actions,.agent-message-output>.message-actions')).map(e=>({id:e.closest('[data-message-id]')?.dataset.messageId||e.parentElement.dataset.messageOutputId,opacity:getComputedStyle(e).opacity,pointer:getComputedStyle(e).pointerEvents,persistent:e.classList.contains('is-persistent')}))`)
  const proposal=await actions();assert.deepEqual(proposal.filter(e=>e.opacity==='1').map(e=>e.id),['reply-review'])
  await b.evaluate('__presence.setProposal(false)');await rest();assert.deepEqual(await actions(),proposal)
  await b.evaluate('__presence.setProposal(true)');await rest()
  const point=await b.evaluate(`(() => {const r=document.querySelector('[data-message-id=reply-alice] .message-bubble,[data-message-id=reply-alice] .final-copy').getBoundingClientRect();return {x:r.left+15,y:r.top+10}})()`)
  await b.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await settle();assert.equal((await actions()).find(e=>e.id==='reply-alice').opacity,'1')
  await rest();assert.equal((await actions()).find(e=>e.id==='reply-alice').opacity,'0')
  await b.evaluate('document.querySelector("[data-message-id=reply-alice] .message-copy-button").focus()');await settle();assert.equal((await actions()).find(e=>e.id==='reply-alice').opacity,'1')
  await rest();report.interactions.push({copyReplyVisibility:'production baseline, latest agent only; hover/focus retained',actions:proposal})

  // V2's lightweight Stop requires confirmation; cancel/Escape are harmless.
  await scenario('parallel',2);await rest()
  assert.equal(await b.evaluate(`getComputedStyle(document.querySelector('${row} .run-presence-stop')).opacity`),'1')
  for (const theme of ['day', 'night']) {
    await b.evaluate(`__presence.setTheme('${theme}')`); await rest()
    const colors = () => b.evaluate(`(() => { const e=document.querySelector('${row} .run-presence-stop'),s=getComputedStyle(e),probe=document.createElement('span');document.body.append(probe);const color=token=>{probe.style.color='var('+token+')';return getComputedStyle(probe).color};const result={color:s.color,background:s.backgroundColor,muted:color('--muted'),danger:color('--danger'),dangerSoft:color('--danger-soft')};probe.remove();return result })()`)
    const neutral = await colors()
    assert.equal(neutral.background, 'rgba(0, 0, 0, 0)')
    assert.equal(neutral.color,neutral.muted)
    const target = await b.evaluate(`(() => {const r=document.querySelector('${row} .run-presence-stop').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`)
    await b.send('Input.dispatchMouseEvent',{type:'mouseMoved',...target}); await settle()
    const hover = await colors()
    assert.equal(hover.color,hover.danger); assert.equal(hover.background,hover.dangerSoft)
    await b.capture(join(out,`stop-hover-${theme}.png`)); await rest()
    assert.deepEqual(await colors(), neutral)
  }
  await b.evaluate("__presence.setTheme('day')"); await rest()
  const publishedBeforeStop=await b.evaluate('__presence.getState().snapshot.messages.map(m=>m.id)')
  await b.click(`${row} .run-presence-stop`);await settle()
  assert.match(await b.evaluate('document.querySelector(".run-presence-stop-dialog").innerText'),/只停止爱丽丝/)
  assert.deepEqual(await b.evaluate('__presence.getState().snapshot.agentRuns.map(r=>r.status)'),['running','running'])
  await b.capture(join(out,'stop-confirm.png'))
  await b.click('.run-presence-stop-dialog .quiet-button');await settle()
  assert.equal(await b.evaluate('!!document.querySelector(".run-presence-stop-dialog")'),false)
  assert.equal(await b.evaluate(`document.activeElement===document.querySelector('${row} .run-presence-stop')`),true)
  assert.deepEqual(await b.evaluate('__presence.getState().snapshot.agentRuns.map(r=>r.status)'),['running','running'])
  await b.key('Enter');await settle();assert.equal(await b.evaluate('!!document.querySelector(".run-presence-stop-dialog")'),true)
  await b.key('Escape');await settle()
  assert.equal(await b.evaluate('!!document.querySelector(".run-presence-stop-dialog")'),false)
  assert.deepEqual(await b.evaluate('__presence.getState().snapshot.agentRuns.map(r=>r.status)'),['running','running'])
  await b.click(`${row} .run-presence-stop`);await b.click('.run-presence-stop-dialog .danger-button');await settle()
  assert.deepEqual(await b.evaluate('__presence.getState().snapshot.agentRuns.map(r=>[r.id,r.status])'),[['run-alice','cancelled'],['run-audrey','running']])
  assert.deepEqual(await b.evaluate('__presence.getState().snapshot.messages.map(m=>m.id)'),publishedBeforeStop)
  assert.equal(await b.evaluate(`!!document.querySelector('${row}')`),false)
  await scenario('single',2)
  await b.evaluate(`document.querySelector('${row} .run-presence-stop').focus()`);await b.key('Enter');await settle()
  await b.evaluate('document.querySelector(".run-presence-stop-dialog .danger-button").focus()');await b.key('Enter');await settle()
  assert.equal(await b.evaluate('__presence.getState().snapshot.agentRuns[0].status'),'cancelled')
  await stage(4)
  assert.deepEqual(await b.evaluate('__presence.getState().snapshot.messages.filter(m=>m.sourceAgentRunId==="run-alice").map(m=>m.id)'),['reply-alice'])
  await scenario('single',3);await b.click(`${row} .run-presence-stop`);await stage(4)
  assert.equal(await b.evaluate('!!document.querySelector(".run-presence-stop-dialog")'),false)
  assert.equal(await b.evaluate('__presence.getState().snapshot.agentRuns[0].status'),'succeeded')
  report.interactions.push('V2 confirmation with a shared console Stop glyph and neutral resting color; cancel/Escape restore focus without stopping; mouse/keyboard confirmation stops only its Run; published replies remain; natural completion dismisses stale confirmation')

  // The existing Run detail retains the same Stop behavior.
  await scenario('parallel',2);await b.click(`${row} .run-presence-open`);await settle()
  assert.equal(await b.evaluate('!!document.querySelector(".camp-detail-popover button[title=终止本次执行]")'),true)
  await b.click('.camp-detail-popover button[title="终止本次执行"]');await settle()
  assert.deepEqual(await b.evaluate('__presence.getState().snapshot.agentRuns.map(r=>[r.id,r.status])'),[['run-alice','cancelled'],['run-audrey','running']])
  assert.equal(await b.evaluate(`!!document.querySelector('${row}')`),false)
  await b.key('Escape');await settle();report.interactions.push('existing Run detail stops only the selected Run; preview disappears')

  await scenario('failed',2)
  assert.equal(await b.evaluate('document.querySelector(".conversation-run-presence").querySelectorAll("button").length'),2)
  assert.equal(await b.evaluate('document.querySelector(".run-presence-retry").textContent'),'重试')
  assert.equal(await b.evaluate('Array.from(document.querySelectorAll("button")).some(e=>e.textContent.includes("重新发送"))'),false)
  await b.capture(join(out,'failed.png'));await b.click('.run-presence-open');await settle()
  assert.match(await b.evaluate('document.querySelector(".camp-detail-popover").innerText'),/连接中断/)
  await b.key('Escape');await settle()
  await b.click('[contenteditable=true]');await b.send('Input.insertText',{text:'保留未发送的补充说明'})
  const beforeRetry=await b.evaluate('({messages:__presence.getState().snapshot.messages.map(m=>m.id),source:__presence.getState().snapshot.agentRuns[0],draft:document.querySelector("[contenteditable=true]").textContent})')
  await b.evaluate('__presence.controls.holdContinue=true')
  await b.click('.run-presence-retry')
  assert.equal(await b.evaluate('document.querySelector(".run-presence-retry").disabled'),true)
  assert.equal(await b.evaluate('document.querySelector(".run-presence-retry").getAttribute("aria-busy")'),'true')
  assert.equal(await b.evaluate('document.querySelector(".run-presence-retry").textContent'),'正在提交…')
  await b.evaluate('document.querySelector(".run-presence-retry").click()')
  assert.deepEqual(await b.evaluate('__presence.getState().snapshot.messages.map(m=>m.id)'),beforeRetry.messages)
  assert.equal(await b.evaluate('document.querySelectorAll(".conversation-run-presence").length'),1)
  assert.equal(await b.evaluate('document.querySelector(".conversation-run-presence").dataset.presenceState'),'failed')
  await b.capture(join(out,'retry-pending.png'))
  await b.evaluate('__presence.controls.holdContinue=false')
  await b.wait('__presence.getState().snapshot.prototypeRetries["run-alice"]?.status==="started"')
  const retryRunId=await b.evaluate('__presence.getState().snapshot.prototypeRetries["run-alice"].runId')
  const retryRuns=await b.evaluate('__presence.getState().snapshot.agentRuns')
  assert.equal(retryRuns.length,2);assert.equal(retryRuns[0].status,'failed')
  assert.deepEqual(retryRuns[1].inputMessageIds,beforeRetry.source.inputMessageIds)
  assert.equal(retryRuns[1].inputSummary,beforeRetry.source.inputSummary)
  assert.equal(retryRuns[1].agentId,beforeRetry.source.agentId)
  assert.equal(await b.evaluate('document.querySelectorAll(".conversation-run-presence").length'),1)
  assert.equal(await b.evaluate('document.querySelector(".conversation-run-presence").dataset.presenceRun'),retryRunId)
  assert.deepEqual(await b.evaluate('__presence.getState().snapshot.messages.map(m=>m.id)'),beforeRetry.messages)
  assert.equal(await b.evaluate('document.querySelector("[contenteditable=true]").textContent'),beforeRetry.draft)
  await b.capture(join(out,'retry-running.png'))
  await b.wait(`__presence.getState().snapshot.agentRuns.find(r=>r.id==='${retryRunId}').status==='succeeded'`)
  assert.equal(await b.evaluate('document.querySelectorAll(".conversation-run-presence").length'),0)
  assert.equal(await b.evaluate('__presence.getState().snapshot.agentRuns[0].status'),'failed')
  assert.deepEqual(await b.evaluate('__presence.getState().snapshot.messages.slice(0,-1).map(m=>m.id)'),beforeRetry.messages)
  assert.equal(await b.evaluate('__presence.getState().snapshot.messages.at(-1).sourceAgentRunId'),retryRunId)
  report.interactions.push('inline Retry: disabled while pending; no queued placeholder or duplicate user message; original inputs and draft retained; one fresh Run; failure history retained; success appends a reply and removes live row')

  // Hold the scheduler between accepted Delivery and successor Run. Re-entry
  // creates a fresh production component; reload also loses all module state.
  await scenario('failed',2)
  await b.evaluate('__presence.controls.holdDispatch=true;__presence.controls.persistServer=true')
  await b.click('.run-presence-retry'); await b.wait('!document.querySelector(".run-presence-retry")')
  const waiting = () => b.evaluate(`({runs:__presence.getState().snapshot.agentRuns.map(r=>({id:r.id,status:r.status,accepted:r.hasAcceptedContinuation})),deliveries:__presence.getState().snapshot.messageDeliveries.filter(d=>d.continuationRequest).map(d=>({id:d.id,status:d.status,target:d.targetAgentRunId}))})`)
  const accepted = await waiting()
  assert.deepEqual(accepted.runs,[{id:'run-alice',status:'failed',accepted:true}])
  assert.equal(accepted.deliveries.length,1);assert.equal(accepted.deliveries[0].status,'waiting');assert.equal(accepted.deliveries[0].target,null)
  const homeThread = await b.evaluate('__presence.getState().snapshot.thread.id')
  await b.click('[data-thread-id="demo-thread-0"] button'); await settle()
  assert.equal(await b.evaluate('document.querySelectorAll("[data-message-id]").length'),0)
  await b.evaluate('__presence.controls.holdEntrySnapshot=true')
  await b.click(`[data-thread-id="${homeThread}"] button`); await settle()
  assert.equal(await b.evaluate('document.querySelectorAll(".conversation-run-presence").length'),0)
  await b.evaluate('__presence.controls.holdEntrySnapshot=false;__presence.setStage(2)'); await settle()
  assert.equal(await b.evaluate('document.querySelectorAll(".conversation-run-presence").length'),0)
  assert.deepEqual(await waiting(),accepted)
  await b.evaluate('window.__presenceReloadPending = true')
  await b.send('Page.reload')
  await b.wait('!window.__presenceReloadPending && !!window.__presence && !!document.querySelector(".composer-box")')
  assert.equal(await b.evaluate('document.querySelectorAll(".conversation-run-presence").length'),0)
  assert.deepEqual(await waiting(),accepted)
  await b.capture(join(out,'accepted-retry-after-reload.png'))
  await b.evaluate('__presence.controls.holdDispatch=false')
  await b.wait('document.querySelector(".conversation-run-presence")?.dataset.presenceState === "running"')
  const successor = await b.evaluate('document.querySelector(".conversation-run-presence").dataset.presenceRun')
  assert.notEqual(successor,'run-alice')
  await b.evaluate(`__presence.failRun(${JSON.stringify(successor)});__presence.controls.holdDispatch=true`); await settle()
  assert.equal(await b.evaluate('document.querySelector(".conversation-run-presence").dataset.presenceRun'),successor)
  await b.click('.run-presence-retry'); await settle()
  assert.equal(await b.evaluate('__presence.controls.continueAttempts.at(-1).command.agentRunId'),successor)
  assert.equal(await b.evaluate('document.querySelectorAll(".conversation-run-presence").length'),0)
  assert.equal((await waiting()).deliveries.length,2)
  report.interactions.push('accepted Retry remains hidden while dispatch is held, through stale cached entry preview, sidebar navigation/remount and full reload; exactly one waiting Delivery; a failed successor retries only that new Run')

  // The history action is intentionally repeatable: each deliberate click is
  // a new authorization, even though the inline failure has been handled.
  await scenario('failed',2); await b.evaluate('__presence.controls.holdDispatch=true')
  await b.click('.run-presence-open'); await settle()
  const historyAttempts = await b.evaluate('__presence.controls.continueAttempts.length')
  for (let i=0;i<2;i++) { await b.click('.camp-detail-popover button[title="继续执行"]'); await settle() }
  const authorized = await b.evaluate(`__presence.controls.continueAttempts.slice(${historyAttempts})`)
  assert.equal(authorized.length,2);assert.notEqual(authorized[0].commandId,authorized[1].commandId)
  assert.equal((await waiting()).deliveries.length,2)
  await b.key('Escape'); await settle()
  await b.click('[data-thread-id="demo-thread-0"] button'); await settle()
  await b.click(`[data-thread-id="${homeThread}"] button`); await settle()
  assert.equal(await b.evaluate('document.querySelectorAll(".conversation-run-presence").length'),0)
  report.interactions.push('history RunCard can accept two explicit continuations; each creates a distinct Delivery; returning to the conversation does not revive its handled failure')

  // Retrying from either view shares the same accepted continuation and stop semantics.
  await scenario('failed',2);await b.click('.run-presence-open');await settle()
  await b.click('.camp-detail-popover button[title="继续执行"]');await b.key('Escape');await settle()
  await b.wait('__presence.getState().snapshot.prototypeRetries["run-alice"]?.status==="started"')
  const stoppedRetryId=await b.evaluate('__presence.getState().snapshot.prototypeRetries["run-alice"].runId')
  await b.click('.run-presence-stop');await b.click('.run-presence-stop-dialog .danger-button');await settle()
  await pause(3300)
  assert.equal(await b.evaluate(`__presence.getState().snapshot.agentRuns.find(r=>r.id==='${stoppedRetryId}').status`),'cancelled')
  assert.equal(await b.evaluate(`__presence.getState().snapshot.messages.some(m=>m.sourceAgentRunId==='${stoppedRetryId}')`),false)
  await scenario('failed',2);await b.evaluate('__presence.controls.holdContinue=true;document.querySelector(".run-presence-retry").focus()');await b.key('Enter')
  assert.equal(await b.evaluate('document.querySelector(".run-presence-retry").disabled'),true)
  await b.evaluate('__presence.controls.holdContinue=false');await b.wait('!document.querySelector(".run-presence-retry")');await scenario('silent',2);await pause(1300)
  assert.equal(await b.evaluate('__presence.getState().snapshot.agentRuns.some(r=>r.id.startsWith("retry-run-"))'),false)
  report.interactions.push('Run detail continuation shares retry state; confirmed stop prevents retry output; keyboard retry works; changing scenario cancels pending simulation')

  await scenario('failed',2);await b.evaluate('__presence.controls.continuationMode="reject"')
  const rejectionCount=await b.evaluate('__presence.controls.continueAttempts.length')
  await b.click('.run-presence-retry');await settle()
  assert.equal(await b.evaluate('document.querySelector(".run-presence-retry").disabled'),false)
  assert.match(await b.evaluate('document.querySelector(".prototype-toast").textContent'),/无法继续/)
  await b.evaluate('__presence.controls.continuationMode="response-lost";__presence.controls.holdContinuationProjection=true;__presence.controls.holdDispatch=true')
  await b.click('.run-presence-retry');await b.wait('document.querySelector(".run-presence-retry")?.textContent === "重试" && !document.querySelector(".run-presence-retry").disabled')
  await b.click('.run-presence-retry');await b.wait('!document.querySelector(".run-presence-retry")')
  const recovered=await b.evaluate('__presence.controls.continueAttempts.slice(-2)')
  assert.equal(recovered[0].commandId,recovered[1].commandId)
  assert.equal(recovered[0].command.agentRunId,'run-alice')
  assert.equal(await b.evaluate('__presence.controls.continueAttempts.length'),rejectionCount+3)
  await b.evaluate('__presence.controls.continuationMode="normal"')
  await scenario('single',2);await b.evaluate('__presence.controls.holdStop=true')
  const stopCount=await b.evaluate('__presence.controls.stopAttempts.length')
  await b.click('.run-presence-stop');await b.click('.run-presence-stop-dialog .danger-button')
  assert.equal(await b.evaluate('document.querySelector(".run-presence-stop-dialog .danger-button").disabled'),true)
  await b.evaluate('document.querySelector(".run-presence-stop-dialog .danger-button").click()')
  await b.key('Escape');assert.equal(await b.evaluate('!!document.querySelector(".run-presence-stop-dialog")'),true)
  assert.equal(await b.evaluate('__presence.controls.stopAttempts.length'),stopCount+1)
  assert.equal(await b.evaluate('document.querySelectorAll(\"[data-presence-run=run-alice] .running-text-highlight\").length'),0,'stop submission pauses the activity highlight')
  assert.deepEqual(await b.evaluate('__presence.controls.stopAttempts.at(-1)'),await b.evaluate('({id:"run-alice",version:__presence.getState().snapshot.agentRuns[0].version})'))
  await b.evaluate('__presence.controls.stopError=true;__presence.controls.holdStop=false')
  await b.wait('!document.querySelector(".run-presence-stop-dialog .danger-button").disabled')
  assert.match(await b.evaluate('document.querySelector(".prototype-toast").textContent'),/停止请求未成功/)
  assert.equal(await b.evaluate('__presence.getState().snapshot.agentRuns[0].status'),'running')
  await b.evaluate('__presence.controls.stopError=false');await b.click('.run-presence-stop-dialog .danger-button');await settle()
  assert.equal(await b.evaluate('__presence.getState().snapshot.agentRuns[0].status'),'cancelled')
  report.interactions.push('rejection retains Retry; lost receipt reconciles the same commandId; stop passes exact Run/version, blocks repeated submissions and recovers from failure')

  await scenario('stream',0);await b.click('[contenteditable=true]')
  await b.send('Input.insertText',{text:'@奥黛丽 看看运行中的占位。'});await pause(600)
  const draft=await b.evaluate('document.querySelector("[contenteditable=true]").textContent')
  await b.click('.prototype-compare');await settle();assert.equal(await b.evaluate('document.querySelector("[contenteditable=true]").textContent'),draft)
  await b.click('.prototype-compare');await b.click('[aria-label="切换夜间主题"]');await settle()
  assert.equal(await b.evaluate('document.querySelector("[contenteditable=true]").textContent'),draft)
  await b.click('[aria-label="收起导航侧栏"]');await settle();assert.equal(await b.evaluate('document.querySelector("[contenteditable=true]").textContent'),draft)
  await b.click('[aria-label="展开导航侧栏"]');await b.click('[contenteditable=true]');await b.key('Enter')
  await b.wait('document.querySelector("[contenteditable=true]").textContent.trim()===""')
  await b.wait('__presence.getState().snapshot.messages.some(m=>m.id.startsWith("local-")&&m.authorType==="agent")')
  assert.equal((await b.evaluate('__presence.verify()')).anchoredOrder,true)
  report.interactions.push('streaming, themes, comparison and navigation preserve draft; only successful own messages advance each live row')

  for(const theme of ['day','night']) {
    await b.evaluate(`__presence.setTheme('${theme}')`)
    for(const [width,height] of [[1040,700],[1440,920],[2560,1440]]) {
      await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false})
      await scenario('stream',1)
      const layout=await b.evaluate(`(() => {const rail=document.querySelector('.unified-sidebar').getBoundingClientRect(),head=document.querySelector('.camp-topbar').getBoundingClientRect(),bar=document.querySelector('.prototype-control-bar').getBoundingClientRect(),composer=document.querySelector('.composer-box').getBoundingClientRect(),line=document.querySelector('.run-presence-open');return {rail:rail.width,header:head.height,overflow:document.documentElement.scrollWidth>innerWidth,composerVisible:composer.bottom<=bar.top,lineHeight:line.getBoundingClientRect().height,controls:line.querySelectorAll('button').length,viewport:[innerWidth,innerHeight]}})()`)
      assert.equal(layout.rail,270);assert.equal(layout.header,38);assert.equal(layout.overflow,false);assert.equal(layout.composerVisible,true);assert.equal(layout.lineHeight,34)
      report.viewports.push({theme,...layout});await b.capture(join(out,`${theme}-${width}x${height}.png`))
    }
  }
  for (const [width,height] of [[520,350],[720,460]]) {
    await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:false,screenWidth:width*2,screenHeight:height*2})
    await scenario('stream',1)
    const zoom=await b.evaluate(`(() => {const timeline=document.querySelector('.camp-timeline'),row=document.querySelector('.run-presence-line'),stop=row.querySelector('.run-presence-stop'),r=row.getBoundingClientRect(),s=stop.getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,timelineOverflow:timeline.scrollWidth>timeline.clientWidth+1,lineHeight:r.height,inside:s.left>=r.left&&s.right<=r.right+1,stopWidth:s.width}})()`)
    assert.equal(zoom.overflow,false);assert.equal(zoom.timelineOverflow,false);assert.equal(zoom.lineHeight,36);assert.equal(zoom.inside,true);assert.equal(zoom.stopWidth,26)
    await b.capture(join(out,`zoom-200-${width*2}x${height*2}.png`))
    report.interactions.push({zoom200Equivalent:[width,height],...zoom})
  }
  await b.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1})
  await settle()
  assert.equal(await b.evaluate('matchMedia("(pointer:coarse)").matches'),true)
  assert.equal(await b.evaluate('document.querySelector(".run-presence-line").getBoundingClientRect().height'),48)
  assert.equal(await b.evaluate('document.querySelector(".run-presence-stop").getBoundingClientRect().width'),44)
  const touchPoint = await b.evaluate('(() => {const r=document.querySelector(".run-presence-open").getBoundingClientRect();return {x:r.x+60,y:r.y+r.height/2}})()')
  await b.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touchPoint]})
  await b.wait('!!document.querySelector(".run-presence-menu")')
  await b.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await settle()
  assert.equal(await b.evaluate('!!document.querySelector(".run-presence-menu")'),true)
  assert.equal(await b.evaluate('!!document.querySelector("#appearance-motion")'),false)
  await b.key('Escape'); await settle()
  await b.send('Emulation.setTouchEmulationEnabled',{enabled:false})
  report.interactions.push('coarse pointers retain a single line and 44px Stop target; long press opens the menu without selecting on release')
  await b.send('Emulation.setDeviceMetricsOverride',{width:1440,height:920,deviceScaleFactor:1,mobile:false})
  await scenario('stream',0);await b.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await settle()
  assert.equal(await b.evaluate('getComputedStyle(document.querySelector(".run-presence-preview .running-text-highlight")).display'),'none')
  const reducedBefore=await b.evaluate('document.querySelector(".run-presence-preview").textContent');await pause(300)
  assert.notEqual(await b.evaluate('document.querySelector(".run-presence-preview").textContent'),reducedBefore)
  report.interactions.push('reduced motion hides the RunCard highlight while real streamed text still updates')
  await b.send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});await settle()
  assert.equal(await b.evaluate('matchMedia("(prefers-reduced-motion: reduce)").matches'),false)
  assert.equal(await b.evaluate('getComputedStyle(document.querySelector(".run-presence-preview .running-text-highlight")).display'),'none')
  await b.send('Emulation.setEmulatedMedia',{features:[]});await settle()
  report.interactions.push('forced colors independently hides the highlight')
  await b.capture(join(out,'night-stream.png'))
  await b.click('[aria-label="设计说明与源码依据"]');await settle();await b.capture(join(out,'notes.png'));await b.key('Escape')

  // Real Thread open projections omit Evidence. Re-entry must restore the tail
  // from the same bounded block API as the drawer, before any new live event.
  const windowedUrl=pathToFileURL(join(root,'rovai-teammate-presence.html'));windowedUrl.search='windowed=1&scenario=stream&stage=1'
  await b.send('Page.navigate',{url:windowedUrl.href})
  await b.wait('!!window.__presence && document.querySelector(".run-presence-open")?.dataset.previewKind === "command"')
  assert.match(await b.evaluate('document.querySelector(".run-presence-preview").textContent'),/rg -n/)
  const reads=await b.evaluate('__presence.controls.executionReads')
  assert.ok(reads.some(r=>r.method==='agentRunExecution.page'&&r.limit===1&&r.projection==='blocks'))
  assert.equal(reads.some(r=>r.method==='agentRunEvidence.getContent'),false)
  await b.evaluate('__presence.controls.liveEvidence=true')
  await stage(3)
  await b.wait('document.querySelector(".run-presence-open")?.dataset.previewKind === "narration"')
  const restoredBody=await b.evaluate('document.querySelector(".run-presence-preview").textContent')
  await b.wait(`document.querySelector('.run-presence-preview').textContent.length > ${restoredBody.length}`)
  assert.equal(await b.evaluate('document.querySelector(".run-presence-preview").scrollLeft'),0)
  assert.equal(await b.evaluate('__presence.controls.executionReads.some(r=>r.method==="agentRunEvidence.getContent")'),false)
  await b.capture(join(out,'reentered-stream.png'))
  report.interactions.push('lightweight Thread re-entry restores the latest command through a one-block page, then follows streaming block changes without reading full blobs')

  const initialPages='__presence.controls.executionReads.filter(r=>r.method==="agentRunExecution.page"&&r.beforeSequence===null).length'
  const changeReads='__presence.controls.executionReads.filter(r=>r.method==="agentRunExecution.changes").length'
  windowedUrl.search='windowed=1&scenario=stream&stage=1&executionRead=fail'
  await b.send('Page.navigate',{url:windowedUrl.href})
  await b.wait(`!!window.__presence && ${initialPages} === 1 && document.querySelector('.run-presence-open')?.dataset.previewKind === 'status'`)
  await pause(500)
  assert.equal(await b.evaluate(initialPages),1,'a failed initial read does not poll itself')
  assert.equal(await b.evaluate('document.querySelectorAll(".run-presence-retry").length'),0,'read errors are not Run failures')
  await b.evaluate('__presence.resync()') // No new live evidence or Run scalar change.
  await b.wait('document.querySelector(".run-presence-open")?.dataset.previewKind === "command"')
  assert.equal(await b.evaluate(initialPages),2)
  assert.match(await b.evaluate('document.querySelector(".run-presence-preview").textContent'),/rg -n/)
  report.interactions.push('initial tail page failure recovers in place on connection resync with unchanged Run data; no polling or task-failure UI')

  for (const liveEvidence of [false,true]) {
    windowedUrl.search='windowed=1&scenario=stream&stage=1&executionRead=hold'
    await b.send('Page.navigate',{url:windowedUrl.href})
    await b.wait(`!!window.__presence && ${initialPages} === 1`)
    await b.evaluate(`__presence.controls.holdExecutionChanges=true; __presence.controls.liveEvidence=${liveEvidence}; __presence.setStage(3); __presence.getState().streamPaused=true`)
    await pause(500) // The update reaches refresh while the captured command page is still pending.
    if(liveEvidence) await b.wait('document.querySelector(".run-presence-open")?.dataset.previewKind === "narration"')
    const liveBody=await b.evaluate('document.querySelector(".run-presence-preview").textContent')
    await b.evaluate('__presence.controls.holdExecutionPage=false')
    await b.wait(`${changeReads} === 1`)
    await settle()
    if(liveEvidence) assert.equal(await b.evaluate('document.querySelector(".run-presence-preview").textContent'),liveBody,'late initial page must not regress newer live narration')
    else assert.equal(await b.evaluate('document.querySelector(".run-presence-open").dataset.previewKind'),'command')
    await b.evaluate('__presence.controls.holdExecutionChanges=false')
    await b.wait('document.querySelector(".run-presence-open")?.dataset.previewKind === "narration"')
    assert.equal(await b.evaluate(initialPages),1)
    assert.equal(await b.evaluate(changeReads),1,'one trailing refresh catches up without another notification')
  }
  report.interactions.push('slow initial page retains its invalidation and catches up once; newer live narration stays visible while both page and trailing changes are delayed')
  await b.send('Page.navigate',{url:pathToFileURL(join(root,'rovai-teammate-presence.html')).href})
  await b.wait('!!window.__presence && !!document.querySelector(".composer-box")')

  if (process.env.ROVAI_PRESENCE_REFERENCE_HTML) {
    const metrics=async (prefix,rootSelector) => b.evaluate(`(() => {
      const row=document.querySelector('${rootSelector}'),line=row.querySelector('${prefix}line'),preview=row.querySelector('${prefix}preview'),stop=row.querySelector('${prefix}stop'),rect=row.getBoundingClientRect();
      const offset=e=>{const r=e.getBoundingClientRect();return [Math.round((r.left-rect.left)*100)/100,Math.round((r.top-rect.top)*100)/100,r.width,r.height]};
      const font=getComputedStyle(preview);return {row:[rect.width,rect.height],line:offset(line),preview:offset(preview),stop:offset(stop),divider:offset(row.querySelector('.run-presence-guide')),font:[font.fontSize,font.fontFamily,font.fontWeight,font.whiteSpace,font.textOverflow],ink:font.color,stopBorder:getComputedStyle(stop).borderWidth}
    })()`)
    const actual=[]
    for(const theme of ['day','night']) for(const size of [[1040,700],[1440,920],[2560,1440]]) {
      await b.send('Emulation.setDeviceMetricsOverride',{width:size[0],height:size[1],deviceScaleFactor:1,mobile:false})
      await b.evaluate(`__presence.setTheme('${theme}')`);await scenario('stream',1)
      actual.push({theme,size,metrics:await metrics('.run-presence-','.conversation-run-presence')})
    }
    const referenceUrl = pathToFileURL(process.env.ROVAI_PRESENCE_REFERENCE_HTML); referenceUrl.search = 'row=divider'
    await b.send('Page.navigate',{url:referenceUrl.href})
    await b.wait('!!window.__presence && !!document.querySelector(".composer-box")')
    for(const expected of actual) {
      await b.send('Emulation.setDeviceMetricsOverride',{width:expected.size[0],height:expected.size[1],deviceScaleFactor:1,mobile:false})
      await b.evaluate(`__presence.setTheme('${expected.theme}')`);await scenario('stream',1)
      assert.deepEqual(expected.metrics,await metrics('.run-presence-','.conversation-run-presence'),`v10 divider reference ${expected.theme}/${expected.size}`)
    }
    report.reference={path:process.env.ROVAI_PRESENCE_REFERENCE_HTML,comparisons:actual}
  }

  assert.deepEqual(b.errors,[])
  Object.assign(report,{result:'passed',errors:b.errors})
  await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify({result:report.result,states:report.scenarios.length,viewports:report.viewports.length,interactions:report.interactions},null,2))
} catch(error) {
  await b.capture(join(out,'failure.png'))
  console.error(JSON.stringify({error:typeof error==='object'?{message:error.message,code:error.code}:String(error),stack:error.stack,body:await b.evaluate('document.body.innerText'),errors:b.errors},null,2));throw error
} finally {await b.close();await rm(root,{recursive:true,force:true})}
})
