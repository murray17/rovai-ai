const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const { mkdir, writeFile } = require('node:fs/promises')
const { join } = require('node:path')
app.setPath('userData', process.argv[3])
app.commandLine.appendSwitch('disable-background-networking')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1440, height: 920, useContentSize: true, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  const errors=[]
  window.webContents.on('console-message', (_event, _level, message) => { if(message.includes('Uncaught'))errors.push(message) })
  const run = async expression => {
    try { return await window.webContents.executeJavaScript(expression, true) }
    catch (error) { throw new Error(`Renderer evaluation failed: ${expression}`, {cause:error}) }
  }
  const wait = async expression => {
    for(let i=0;i<160;i++) { if(await run(expression))return;await pause(50) }
    throw new Error(`Timed out: ${expression}\n${await run('document.body.innerText.slice(-2500)')}`)
  }
  const click = async expression => {
    const point=await run(`(()=>{const e=${expression};if(!e)throw Error('Missing target');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
    window.webContents.sendInputEvent({type:'mouseMove',...point});await pause(40)
    window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point})
    window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});await pause(60)
  }
  const key=async (keyCode,modifiers=[])=>{window.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});if(keyCode==='Return')window.webContents.sendInputEvent({type:'char',keyCode:'\r',modifiers});window.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await pause(60)}
  const active=()=>run('document.querySelector(".camp-nav-open[aria-current=page]")?.closest("[data-thread-id]")?.dataset.threadId')
  const row=id=>click(`document.querySelector('[data-thread-id="${id}"] .camp-nav-open')`)
  const menu=async()=>{await click('document.querySelector("[data-message-id=review-message-2] .message-more-button")');await wait('!!document.querySelector(".message-action-menu")');await pause(140)}
  const select=()=>click('document.querySelector(".message-action-menu [role=menuitem]")')
  const fork=async()=>{await run('forkQA.hold()');await menu();await select();await wait('!!document.querySelector(".app-toast-spinner")')}
  const quiet=()=>wait('!document.querySelector(".app-toast")')
  const count=()=>run('forkQA.calls.filter(c=>c.method==="threads.fork").length')
  const screenshots=[]
  const output=process.argv[4]
  try {
    await window.loadFile(process.argv[2]);await wait('!!document.querySelector("[data-message-id=review-message-2] .message-more-button")')
    // Quick completion never flashes a loading toast. Visible loading lasts 600ms
    // while the actual copy/navigation can complete independently.
    await run('forkQA.trackLoading()');await menu();await select()
    await wait('(document.querySelector(".camp-nav-open[aria-current=page]")?.closest("[data-thread-id]")?.dataset.threadId??"").startsWith("copy-")')
    await pause(250);assert.deepEqual(await run('forkQA.loadingEvents'),[]);await quiet()
    await row('source');await run('forkQA.trackLoading()');await fork();await run('forkQA.release()')
    await wait('(document.querySelector(".camp-nav-open[aria-current=page]")?.closest("[data-thread-id]")?.dataset.threadId??"").startsWith("copy-")')
    assert(await run('!!document.querySelector(".app-toast-spinner")'))
    await quiet()
    const loadingTiming=await run('forkQA.loadingEvents')
    assert.equal(loadingTiming.length,2);assert.equal(loadingTiming[0].visible,true);assert.equal(loadingTiming[1].visible,false)
    assert(loadingTiming[1].time-loadingTiming[0].time>=575,JSON.stringify(loadingTiming))
    await row('source')
    // Real mounted Composer continues to accept editing while the command waits.
    await fork();await click('document.querySelector("[data-thread-id=source] .camp-menu-trigger")');await wait('!!document.querySelector(".sidebar-action-menu:not(.message-action-menu)")');
    assert(await run('[...document.querySelectorAll(".sidebar-action-menu-item")].some(e=>e.textContent.trim()==="分叉"&&e.hasAttribute("data-disabled"))'));await key('Escape');await click('document.querySelector("[contenteditable=true]")');await window.webContents.insertText('保留源草稿')
    await run('forkQA.release()');await wait('document.querySelector(".camp-nav-open[aria-current=page]")?.closest("[data-thread-id]")?.dataset.threadId.startsWith("copy-")')
    assert.equal(await run('document.querySelector("[contenteditable=true]").textContent'),'')
    await quiet()
    // Exercise the real ThreadWorkspace locator with the normalized API shape:
    // one copied source is navigable; the omitted source retains text and author.
    const quotedCopy=await active()
    const copiedQuoteTarget=await run(`forkQA.threads.get(${JSON.stringify(quotedCopy)}).messages[0].id`)
    await click('document.querySelector(".message-quotes-trigger")');await wait('!!document.querySelector(".message-quotes-popover")')
    assert.deepEqual(await run('[...document.querySelectorAll(".message-quote-jump")].map(e=>e.getAttribute("aria-disabled"))'),['false','true'])
    assert((await run('document.querySelector(".message-quotes-popover").textContent')).includes('引用作者快照'))
    await click('document.querySelectorAll(".message-quote-jump")[1]')
    assert.equal(await active(),quotedCopy)
    assert((await run('document.querySelector(".message-quotes-popover").textContent')).includes('范围外仍保留的选文'))
    assert.equal(await run('!!document.querySelector(".message-quotes-popover-footer [role=alert]")'),false)
    await mkdir(output,{recursive:true});await writeFile(join(output,'quotes-after-fork.png'),(await window.webContents.capturePage()).toPNG());screenshots.push('quotes-after-fork.png')
    await click('document.querySelectorAll(".message-quote-jump")[0]')
    await wait(`document.activeElement?.getAttribute('data-message-quote-body')===${JSON.stringify(copiedQuoteTarget)}`)
    assert.equal(await run('document.activeElement.getAttribute("data-quote-owner")'),`thread:${quotedCopy}`)
    assert.equal(await run('!!document.querySelector(".message-quote-error")'),false);await key('Escape')
    await row('source');await wait('document.querySelector("[contenteditable=true]")?.textContent==="保留源草稿"')
    const initialRequests=await count()
    await fork();await row('other');await run('forkQA.release()');await quiet()
    assert.equal(await active(),'other');assert.equal(await count(),initialRequests+1)
    await row('source');await fork();await row('other');await row('source');await run('forkQA.release()');await quiet()
    assert.equal(await active(),'source')
    assert.equal(await run('!!document.querySelector(".app-toast-action")'),false)
    // Known-target open failures stay quiet. The ordinary sidebar still opens
    // that copy once its full projection is available, with no repeated fork.
    await run('forkQA.failOpen()');await fork();await run('forkQA.release()');await quiet()
    assert.equal(await active(),'source')
    const failedTarget=await run('[...forkQA.receipts.values()].at(-1).payload.threadId'),attempts=await count()
    await run('forkQA.failOpen(false)')
    if(!await run(`!!document.querySelector('[data-thread-id="${failedTarget}"] .camp-nav-open')`))await click('document.querySelector(".show-more-camps")')
    await wait(`!!document.querySelector('[data-thread-id="${failedTarget}"] .camp-nav-open')`);await row(failedTarget)
    await wait(`document.querySelector('.camp-nav-open[aria-current=page]')?.closest('[data-thread-id]')?.dataset.threadId===${JSON.stringify(failedTarget)}`)
    assert.equal(await count(),attempts)
    // Draft persistence failure does not repeat the copy or introduce feedback.
    await row('source');await run('forkQA.failDraft()');await click('document.querySelector("[contenteditable=true]")');await window.webContents.insertText(' 尚未保存')
    await fork();await run('forkQA.release()');await quiet();assert.equal(await active(),'source')
    const afterSaveFailure=await count();await run('forkQA.failDraft(false)');await pause(100);assert.equal(await count(),afterSaveFailure)
    if(await run('!!document.querySelector(".error-banner")'))await click('document.querySelector(".error-banner .icon-button")')
    // An uncertain command keeps one explicit retry; receipt recovery does not
    // create another copy or restore the removed completion/opening prompt.
    await run('forkQA.lose()');await menu();await select();await wait('document.querySelector(".app-toast")?.textContent.includes("尚未确认")')
    await mkdir(output,{recursive:true});await writeFile(join(output,'fork-unknown-retry.png'),(await window.webContents.capturePage()).toPNG());screenshots.push('fork-unknown-retry.png')
    const uncertainAttempts=await count();await pause(3300)
    assert(await run('document.querySelector(".app-toast")?.textContent.includes("尚未确认")'))
    await click('document.querySelector(".app-toast-action")');await quiet()
    assert.equal(await count(),uncertainAttempts)
    await row('source');await run('forkQA.lose()');await menu();await select();await wait('document.querySelector(".app-toast")?.textContent.includes("尚未确认")')
    const copies=await run('forkQA.receipts.size');await window.webContents.reload()
    await wait('!!document.querySelector("[data-message-id=review-message-2]") && forkQA.calls.some(c=>c.method==="commands.reconcile")');await quiet()
    assert.equal(await count(),0);assert.equal(await run('forkQA.receipts.size'),copies)
    // Known deleted targets stay quiet; rejected commands auto-dismiss normally.
    await run('forkQA.dropTarget()');await menu();await select();await quiet();assert.equal(await active(),'source')
    const deletedAttempts=await count();await pause(250);assert.equal(await count(),deletedAttempts)
    await run('forkQA.reject()');await menu();await select();await wait('document.querySelector(".app-toast")?.textContent.includes("无法从这里分叉")')
    await quiet();assert.equal(await active(),'source')
    // The actual attachment queue retains newer navigation intent, even A→B→A.
    await run('forkQA.addAttachment()');await wait('forkQA.attachmentPending()');await fork();await run('forkQA.release()');await pause(120)
    await row('other');await row('source');await run('forkQA.releaseAttachment()');await quiet();assert.equal(await active(),'source')
    // Production Radix menus and AppToast across the agreed visual matrix.
    const geometry=[]
    await mkdir(output,{recursive:true})
    for(const language of ['zh-CN','en'])for(const theme of ['day','night','horizon','classic-red','ember'])for(const size of [[1040,700],[1440,920],[2560,1440]]) {
      window.setContentSize(...size);await run(`forkQA.language(${JSON.stringify(language)});forkQA.theme(${JSON.stringify(theme)})`);await pause(80)
      assert.deepEqual(await run('[innerWidth,innerHeight]'),size)
      await wait('!!document.querySelector(".public-agent-message.joins-next-message .message-actions.has-fork")')
      const grouped=await run(`(()=>{const e=document.querySelector('.public-agent-message.joins-next-message'),a=e.querySelector('.message-actions.has-fork'),c=e.querySelector('[data-message-quote-body]'),s=getComputedStyle(a),r=a.getBoundingClientRect(),b=c.getBoundingClientRect();return {position:s.position,below:r.top>=b.bottom-1,visible:s.opacity==='1',transform:s.transform}})()`)
      assert.equal(grouped.position,'static',JSON.stringify(grouped));assert(grouped.below&&grouped.visible,JSON.stringify(grouped))
      await menu()
      const measured=await run(`(()=>{const m=document.querySelector('.message-action-menu'),r=m.getBoundingClientRect(),items=[...m.querySelectorAll('[role=menuitem]')];return {labels:items.map(i=>i.textContent),width:r.width,inside:r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight,minWidth:getComputedStyle(m).minWidth,items:items.map(i=>{const icon=i.querySelector('svg').getBoundingClientRect(),span=i.querySelector('span').getBoundingClientRect();return {icon:icon.width,delta:Math.abs(icon.y+icon.height/2-span.y-span.height/2)}})}})()`)
      assert.deepEqual(measured.labels,language==='en'?['Fork chat from here','Export']:['从此处分叉','导出']);assert(measured.inside);assert.equal(measured.minWidth,'0px');assert(measured.items.every(i=>i.icon===16&&i.delta<1),JSON.stringify(measured))
      const name=`${language}-${theme}-${size.join('x')}.png`;await writeFile(join(output,name),(await window.webContents.capturePage()).toPNG());screenshots.push(name);geometry.push({language,theme,size,grouped,...measured});await key('Escape')
      await click('document.querySelector("[data-thread-id=source] .camp-menu-trigger")');await wait('!!document.querySelector(".sidebar-action-menu:not(.message-action-menu)")');await pause(140)
      const labels=await run('[...document.querySelectorAll(".sidebar-action-menu:not(.message-action-menu) [role=menuitem]")].map(e=>e.textContent.trim())')
      assert(labels.includes(language==='en'?'Fork':'分叉')&&labels.includes(language==='en'?'Export':'导出'))
      const sidebar=`sidebar-${name}`;await writeFile(join(output,sidebar),(await window.webContents.capturePage()).toPNG());screenshots.push(sidebar);await key('Escape')
    }
    // 200% page zoom, keyboard trigger and reduced motion remain real browser behavior.
    window.setContentSize(1440,920);window.webContents.setZoomFactor(2);await pause(100)
    await run('document.querySelector("[data-message-id=review-message-2] .message-more-button").focus()');await key('Return');await wait('!!document.querySelector(".message-action-menu")');await pause(140)
    assert(await run('(()=>{const r=document.querySelector(".message-action-menu").getBoundingClientRect();return r.right<=innerWidth&&r.bottom<=innerHeight})()'))
    await writeFile(join(output,'zoom-200-keyboard.png'),(await window.webContents.capturePage()).toPNG());screenshots.push('zoom-200-keyboard.png');await key('Escape');window.webContents.setZoomFactor(1);await wait('innerWidth>1000');await pause(200)
    await run('forkQA.hold()');await menu();await select();await wait('!!document.querySelector(".app-toast-spinner")')
    const center=await run('(()=>{const r=document.querySelector(".app-toast").getBoundingClientRect(),a=document.querySelector(".navigation-shell").getBoundingClientRect();return Math.abs(r.x+r.width/2-a.x-a.width/2)})()');assert(center<1)
    await click('document.querySelector(".navigation-chrome-controls > .navigation-collapse-button")');await pause(180)
    assert(await run('(()=>{const r=document.querySelector(".app-toast").getBoundingClientRect();return Math.abs(r.x+r.width/2-innerWidth/2)<1})()'))
    window.setContentSize(1040,700);await pause(120);assert(await run('(()=>{const r=document.querySelector(".app-toast").getBoundingClientRect();return Math.abs(r.x+r.width/2-innerWidth/2)<1})()'))
    await window.webContents.debugger.attach('1.3');await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
    assert.equal(await run('getComputedStyle(document.querySelector(".app-toast-spinner")).animationName'),'none')
    await window.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1})
    const point=await run('(()=>{const e=document.querySelector("[data-message-id=review-message-2] .message-more-button");e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()')
    await window.webContents.debugger.sendCommand('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,id:0,radiusX:2,radiusY:2,force:1}]})
    await window.webContents.debugger.sendCommand('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait('!!document.querySelector(".message-action-menu")');await key('Escape')
    await writeFile(join(output,'loading-reduced-motion.png'),(await window.webContents.capturePage()).toPNG());screenshots.push('loading-reduced-motion.png')
    await run('forkQA.release()');await pause(100)
    await wait('!document.querySelector(".app-toast")')
    // Shared production portals stack independent owners and clean up in StrictMode.
    const toastGeometry=[]
    for(const language of ['zh-CN','en'])for(const theme of ['day','night','horizon','classic-red','ember']) {
      window.setContentSize(1040,700)
      await run(`forkQA.language(${JSON.stringify(language)});forkQA.theme(${JSON.stringify(theme)})`)
      await run('forkQA.showToasts()')
      await wait('document.querySelectorAll(".app-toast").length===2')
      const measured=await run(`(()=>{
        const host=document.querySelector('.app-toast-viewport'),shell=document.querySelector('.app-shell'),toasts=[...host.querySelectorAll('.app-toast')];
        const sample=document.createElement('div');sample.style.cssText='color:var(--ink);background:var(--surface)';shell.append(sample);
        const normal=getComputedStyle(sample);const colors={ink:normal.color,surface:normal.backgroundColor};const dangerSample=document.createElement('div');dangerSample.style.cssText='color:var(--danger)';shell.append(dangerSample);colors.danger=getComputedStyle(dangerSample).color;sample.remove();dangerSample.remove();
        const bounds=shell.getBoundingClientRect(),rows=toasts.map(t=>{const r=t.getBoundingClientRect(),message=t.querySelector('.app-toast-message').getBoundingClientRect(),action=t.querySelector('.app-toast-action'),a=action.getBoundingClientRect(),close=t.querySelector('.app-toast-close'),c=close.getBoundingClientRect(),style=getComputedStyle(t);return {top:r.top,bottom:r.bottom,center:Math.abs(r.x+r.width/2-bounds.x-bounds.width/2),inside:r.left>=bounds.left&&r.right<=bounds.right,aligned:Math.max(Math.abs(message.y+message.height/2-a.y-a.height/2),Math.abs(c.y+c.height/2-a.y-a.height/2)),actionBackground:getComputedStyle(action).backgroundColor,actionHeight:a.height,closeWidth:c.width,closeHeight:c.height,svg:!!close.querySelector('svg'),closeText:close.textContent,role:t.getAttribute('role'),live:t.getAttribute('aria-live'),color:style.color,background:style.backgroundColor,pointer:style.pointerEvents}});
        return {hosts:document.querySelectorAll('.app-toast-viewport').length,parent:host.parentElement===shell,top:rows[0].top-bounds.top,gap:rows[1].top-rows[0].bottom,rows,colors,pointer:getComputedStyle(host).pointerEvents};
      })()`)
      assert.equal(measured.hosts,1);assert(measured.parent);assert.equal(measured.top,10);assert.equal(measured.gap,8);assert.equal(measured.pointer,'none')
      assert(measured.rows.every(r=>r.center<1&&r.inside&&r.aligned<1&&r.actionHeight>=28&&r.closeWidth===28&&r.closeHeight===28&&r.svg&&r.closeText===''&&r.pointer==='auto'&&r.actionBackground==='rgba(0, 0, 0, 0)'),JSON.stringify(measured))
      assert.equal(measured.rows[0].role,'status');assert.equal(measured.rows[0].live,'polite');assert.equal(measured.rows[1].role,'alert');assert.equal(measured.rows[1].live,'assertive')
      assert.equal(measured.rows[0].color,measured.colors.ink);assert.equal(measured.rows[0].background,measured.colors.surface);assert.equal(measured.rows[1].color,measured.colors.danger)
      await run(`document.querySelector('.app-toast.is-danger .app-toast-action').focus()`);await key('Tab');await key('Tab',['shift'])
      assert.equal(await run(`getComputedStyle(document.querySelector('.app-toast.is-danger .app-toast-action')).backgroundColor`),'rgba(0, 0, 0, 0)')
      assert.equal(await run(`getComputedStyle(document.querySelector('.app-toast.is-danger .app-toast-action > span')).textDecorationLine`),'underline')
      assert.equal(await run(`document.activeElement===document.querySelector('.app-toast.is-danger .app-toast-action')`),true)
      await key('Return');assert.deepEqual(await run('forkQA.probeActions'),['retry']);assert.equal(await run('document.querySelectorAll(".app-toast").length'),2)
      const name=`toast-${language}-${theme}.png`;await writeFile(join(output,name),(await window.webContents.capturePage()).toPNG());screenshots.push(name);toastGeometry.push({language,theme,...measured})
      await click(`document.querySelector('.app-toast.is-danger .app-toast-close')`);await wait('document.querySelectorAll(".app-toast").length===1')
      await click(`document.querySelector('.app-toast-action')`);await wait('!document.querySelector(".app-toast-viewport")')
      assert.deepEqual(await run('forkQA.probeActions'),['retry','close:danger','close:neutral','retry-neutral'])
    }
    window.webContents.setZoomFactor(2)
    await run(`forkQA.showToasts('A long conversation title '.repeat(8))`)
    await wait('document.querySelectorAll(".app-toast").length===2')
    const zoomed=await run(`[...document.querySelectorAll('.app-toast')].every(t=>{const r=t.getBoundingClientRect(),m=t.querySelector('.app-toast-message'),a=t.querySelector('.app-toast-action').getBoundingClientRect();return r.left>=16&&r.right<=innerWidth-16&&m.scrollWidth<=m.clientWidth+1&&Math.abs(r.y+r.height/2-a.y-a.height/2)<1})`)
    assert(zoomed)
    await writeFile(join(output,'toast-zoom-200-long.png'),(await window.webContents.capturePage()).toPNG());screenshots.push('toast-zoom-200-long.png')
    await run('forkQA.clearToasts()');await wait('!document.querySelector(".app-toast-viewport")');window.webContents.setZoomFactor(1)
    assert.deepEqual(await run('forkQA.errors'),[]);assert.deepEqual(errors,[])
    const report={ok:true,channel:'automatic_acceptance',adapter:'controlled transport; real BusinessApp/Composer/Radix/AppToast',userData:process.argv[3],core:false,runtime:false,geometry,toastGeometry,loadingTiming,screenshots,verified:['editing during fork','empty copy Composer','copied quote locates the current Thread message','source-less quote retains text and captured author','source draft preserved','A→B','A→B→A','no completion prompt after leaving source','no opening-failure prompt','ordinary sidebar opens known copy without refork','deleted target stays quiet','fork rejection auto-dismisses','quick fork never flashes loading','visible fork loading lasts at least 600ms without delaying navigation','async attachment save and newer navigation','draft save failure','lost response and refresh receipt','same-author grouped actions below message','five themes','Chinese/English','three window sizes','200% keyboard menu','native touch menu','App-centered loading across sidebar/resize','reduced motion','shared toast stack and StrictMode cleanup','aligned transparent actions and SVG close','toast keyboard actions','200% zoom long message containment','neutral/danger colors in five palettes']}
    await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:true,output,verified:report.verified}));app.exit(0)
  }catch(error){console.error(error.stack??error);console.error(await run('JSON.stringify(forkQA.calls.slice(-12))').catch(()=>''));app.exit(1)}
})
