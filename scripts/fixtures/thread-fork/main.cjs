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
  const run = expression => window.webContents.executeJavaScript(expression, true)
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
  const key=async keyCode=>{window.webContents.sendInputEvent({type:'keyDown',keyCode});window.webContents.sendInputEvent({type:'keyUp',keyCode});await pause(60)}
  const active=()=>run('document.querySelector(".camp-nav-open[aria-current=page]")?.closest("[data-thread-id]")?.dataset.threadId')
  const row=id=>click(`document.querySelector('[data-thread-id="${id}"] .camp-nav-open')`)
  const menu=async()=>{await click('document.querySelector("[data-message-id=review-message-2] .message-more-button")');await wait('!!document.querySelector(".message-action-menu")');await pause(140)}
  const select=()=>click('document.querySelector(".message-action-menu [role=menuitem]")')
  const fork=async()=>{await run('forkQA.hold()');await menu();await select();await wait('!!document.querySelector(".app-toast-spinner")')}
  const open=()=>click('document.querySelector(".is-top-center .app-toast-action")')
  const dismiss=()=>click('document.querySelector(".is-top-center .icon-button")')
  const count=()=>run('forkQA.calls.filter(c=>c.method==="threads.fork").length')
  const screenshots=[]
  const output=process.argv[4]
  try {
    await window.loadFile(process.argv[2]);await wait('!!document.querySelector("[data-message-id=review-message-2] .message-more-button")')
    // Real mounted Composer continues to accept editing while the command waits.
    await fork();await click('document.querySelector("[data-thread-id=source] .camp-menu-trigger")');await wait('!!document.querySelector(".sidebar-action-menu:not(.message-action-menu)")');
    assert(await run('[...document.querySelectorAll(".sidebar-action-menu-item")].some(e=>e.textContent.trim()==="分叉"&&e.hasAttribute("data-disabled"))'));await key('Escape');await click('document.querySelector("[contenteditable=true]")');await window.webContents.insertText('保留源草稿')
    await run('forkQA.release()');await wait('document.querySelector(".camp-nav-open[aria-current=page]")?.closest("[data-thread-id]")?.dataset.threadId.startsWith("copy-")')
    assert.equal(await run('document.querySelector("[contenteditable=true]").textContent'),'')
    assert.equal(await run('!!document.querySelector(".is-top-center")'),false)
    await row('source');await wait('document.querySelector("[contenteditable=true]")?.textContent==="保留源草稿"')
    const initialRequests=await count()
    await fork();await row('other');await run('forkQA.release()');await wait('!!document.querySelector(".is-top-center .app-toast-action")')
    assert.equal(await active(),'other');await open();await wait('(document.querySelector(".camp-nav-open[aria-current=page]")?.closest("[data-thread-id]")?.dataset.threadId??"").startsWith("copy-")')
    assert.equal(await count(),initialRequests+1)
    await row('source');await fork();await row('other');await row('source');await run('forkQA.release()');await wait('!!document.querySelector(".is-top-center .app-toast-action")')
    assert.equal(await active(),'source');await dismiss()
    // A failed open retries only the saved target.
    await run('forkQA.failOpen()');await fork();await run('forkQA.release()');await wait('document.querySelector(".is-top-center")?.textContent.includes("暂时无法打开")')
    const attempts=await count();await open();assert.equal(await count(),attempts)
    await run('forkQA.failOpen(false)');await open();await wait('!document.querySelector(".is-top-center")')
    // Failed draft persistence stays on the source and must not repeat the copy.
    await row('source');await run('forkQA.failDraft()');await click('document.querySelector("[contenteditable=true]")');await window.webContents.insertText(' 尚未保存')
    await fork();await run('forkQA.release()');await wait('document.querySelector(".is-top-center")?.textContent.includes("暂时无法打开")')
    assert.equal(await active(),'source');const afterSaveFailure=await count();await run('forkQA.failDraft(false)');await open();await wait('!document.querySelector(".is-top-center")');assert.equal(await count(),afterSaveFailure)
    // The restored operation reads its receipt and offers an existing target.
    await row('source');await run('forkQA.lose()');await menu();await select();await wait('document.querySelector(".is-top-center")?.textContent.includes("尚未确认")')
    const copies=await run('forkQA.receipts.size');await window.webContents.reload();await wait('!!document.querySelector(".is-top-center .app-toast-action") && !!document.querySelector("[data-message-id=review-message-2]")')
    assert.equal(await count(),0);assert.equal(await run('forkQA.receipts.size'),copies);await dismiss()
    // A deleted result is an opening failure; it never falls back to a new copy.
    await run('forkQA.dropTarget()');await menu();await select();await wait('document.querySelector(".is-top-center")?.textContent.includes("暂时无法打开")');assert.equal(await active(),'source');const deletedAttempts=await count();await open();assert.equal(await count(),deletedAttempts);await dismiss()
    // The actual attachment queue keeps navigation pending. Later navigation
    // intent takes ownership before that queue settles, including a return to A.
    await run('forkQA.addAttachment()');await wait('forkQA.attachmentPending()');await fork();await run('forkQA.release()');await pause(120)
    await row('other');await row('source');await run('forkQA.releaseAttachment()');await wait('!!document.querySelector(".is-top-center .app-toast-action")');assert.equal(await active(),'source');await dismiss()
    // Production Radix menus and AppToast across the agreed visual matrix.
    const geometry=[]
    await mkdir(output,{recursive:true})
    for(const language of ['zh-CN','en'])for(const theme of ['day','night','horizon','classic-red','ember'])for(const size of [[1040,700],[1440,920],[2560,1440]]) {
      window.setContentSize(...size);await run(`forkQA.language(${JSON.stringify(language)});forkQA.theme(${JSON.stringify(theme)})`);await pause(80)
      assert.deepEqual(await run('[innerWidth,innerHeight]'),size)
      await menu()
      const measured=await run(`(()=>{const m=document.querySelector('.message-action-menu'),r=m.getBoundingClientRect(),items=[...m.querySelectorAll('[role=menuitem]')];return {labels:items.map(i=>i.textContent),width:r.width,inside:r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight,minWidth:getComputedStyle(m).minWidth,items:items.map(i=>{const icon=i.querySelector('svg').getBoundingClientRect(),span=i.querySelector('span').getBoundingClientRect();return {icon:icon.width,delta:Math.abs(icon.y+icon.height/2-span.y-span.height/2)}})}})()`)
      assert.deepEqual(measured.labels,language==='en'?['Fork chat from here','Export']:['从此处分叉','导出']);assert(measured.inside);assert.equal(measured.minWidth,'0px');assert(measured.items.every(i=>i.icon===16&&i.delta<1),JSON.stringify(measured))
      const name=`${language}-${theme}-${size.join('x')}.png`;await writeFile(join(output,name),(await window.webContents.capturePage()).toPNG());screenshots.push(name);geometry.push({language,theme,size,...measured});await key('Escape')
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
    const center=await run('(()=>{const r=document.querySelector(".is-top-center").getBoundingClientRect(),a=document.querySelector(".navigation-shell").getBoundingClientRect();return Math.abs(r.x+r.width/2-a.x-a.width/2)})()');assert(center<1)
    await click('document.querySelector(".navigation-chrome-controls > .navigation-collapse-button")');await pause(180)
    assert(await run('(()=>{const r=document.querySelector(".is-top-center").getBoundingClientRect();return Math.abs(r.x+r.width/2-innerWidth/2)<1})()'))
    window.setContentSize(1040,700);await pause(120);assert(await run('(()=>{const r=document.querySelector(".is-top-center").getBoundingClientRect();return Math.abs(r.x+r.width/2-innerWidth/2)<1})()'))
    await window.webContents.debugger.attach('1.3');await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
    assert.equal(await run('getComputedStyle(document.querySelector(".app-toast-spinner")).animationName'),'none')
    await window.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1})
    const point=await run('(()=>{const e=document.querySelector("[data-message-id=review-message-2] .message-more-button");e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()')
    await window.webContents.debugger.sendCommand('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,id:0,radiusX:2,radiusY:2,force:1}]})
    await window.webContents.debugger.sendCommand('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait('!!document.querySelector(".message-action-menu")');await key('Escape')
    await writeFile(join(output,'loading-reduced-motion.png'),(await window.webContents.capturePage()).toPNG());screenshots.push('loading-reduced-motion.png')
    await run('forkQA.release()');await pause(100)
    assert.deepEqual(await run('forkQA.errors'),[]);assert.deepEqual(errors,[])
    const report={ok:true,channel:'automatic_acceptance',adapter:'controlled transport; real BusinessApp/Composer/Radix/AppToast',userData:process.argv[3],core:false,runtime:false,geometry,screenshots,verified:['editing during fork','empty copy Composer','source draft preserved','A→B','A→B→A','open-only retry','deleted target remains opening failure','async attachment save and newer navigation','draft save failure','lost response and refresh receipt','five themes','Chinese/English','three window sizes','200% keyboard menu','native touch menu','App-centered loading across sidebar/resize','reduced motion']}
    await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:true,output,verified:report.verified}));app.exit(0)
  }catch(error){console.error(error.stack??error);console.error(await run('JSON.stringify(forkQA.calls.slice(-12))').catch(()=>''));app.exit(1)}
})
