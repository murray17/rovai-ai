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
    const modelCopy=await active()
    const copiedAgentId=await run(`forkQA.threads.get(${JSON.stringify(modelCopy)}).messages.find(m=>m.authorType==='agent').id`)
    const copiedMessage=`[data-message-id="${copiedAgentId}"]`
    for(const record of ['null','undefined']) {
      await run(`forkQA.threads.get(${JSON.stringify(modelCopy)}).messages.filter(m=>m.authorType==='agent').forEach(m=>{m.runtimeModel=${record}})`)
      await row('other');await row(modelCopy)
      await wait(`!!document.querySelector(${JSON.stringify(copiedMessage)})`)
      assert.equal(await active(),modelCopy)
      assert.equal(await run(`!!document.querySelector(${JSON.stringify(`${copiedMessage} .message-model-summary`)})`),false)
      assert.equal(await run('!!document.querySelector(".thread-model-popover")'),false)
    }
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
    const userRow = '[data-message-id=review-message-1]'
    await click(`document.querySelector('${userRow} .message-more-button')`)
    await wait('!!document.querySelector(".message-action-menu [role=separator]")')
    const userMenu = await run(`[...document.querySelectorAll('.message-action-menu [role=menuitem]')].map(item => ({
      label: item.textContent.trim(), icon: Boolean(item.querySelector('.sidebar-action-menu-icon')), danger: item.classList.contains('danger')
    }))`)
    assert.deepEqual(userMenu[0], { label: '编辑', icon: true, danger: false })
    assert.deepEqual(userMenu.at(-1), { label: '删除', icon: true, danger: true })
    await select()
    await wait(`!!document.querySelector('${userRow} .message-surface > .message-bubble > .revision-editor')`)
    const editing = await run(`(() => {
      const row = document.querySelector('${userRow}')
      const editor = row.querySelector('.revision-editor')
      const save = editor.querySelector('button[type=submit]')
      const time = row.querySelector('.message-action-time')
      const more = row.querySelector('.message-more-button .more-icon')
      const recipient = editor.querySelector('.revision-default-recipient')
      const mention = getComputedStyle(recipient.querySelector('strong'))
      const probe = document.createElement('span')
      probe.style.color = 'var(--mention-ink)'
      recipient.append(probe)
      const matchesMentionColor = mention.color === getComputedStyle(probe).color
      probe.remove()
      return {
        actions: !!row.querySelector('.message-action-line .message-copy-button'),
        timePadding: getComputedStyle(time).paddingTop,
        moreWidth: more.getBoundingClientRect().width,
        moreFill: getComputedStyle(more).fill === getComputedStyle(more).color,
        saveHeight: save.getBoundingClientRect().height,
        saveFont: getComputedStyle(save).fontSize,
        bubbleBorder: getComputedStyle(editor.parentElement).borderTopWidth,
        recipientBetweenEditorAndActions:
          editor.querySelector('.structured-mention-composer').getBoundingClientRect().bottom <= recipient.getBoundingClientRect().top &&
          recipient.getBoundingClientRect().bottom <= editor.querySelector('.revision-editor-actions').getBoundingClientRect().top,
        recipientFont: getComputedStyle(recipient).fontSize,
        mentionWeight: mention.fontWeight,
        matchesMentionColor
      }
    })()`)
    assert.deepEqual(editing, { actions: true, timePadding: '1px', moreWidth: 15, moreFill: true,
      saveHeight: 28, saveFont: '11.5px', bubbleBorder: '1px',
      recipientBetweenEditorAndActions: true, recipientFont: '11px', mentionWeight: '680', matchesMentionColor: true })
    await click(`document.querySelector('${userRow} .revision-editor .quiet-button')`)
    await wait('!document.querySelector(".revision-editor")')
    assert.equal(await run('document.querySelector("[contenteditable=true]").textContent'), '保留源草稿')
    await click(`document.querySelector('${userRow} .message-more-button')`)
    await wait('!!document.querySelector(".message-action-menu")')
    await select()
    await wait(`!!document.querySelector('${userRow} .revision-editor [contenteditable=true]')`)
    await click(`document.querySelector('${userRow} .revision-editor [contenteditable=true]')`)
    await window.webContents.insertText(' 更新')
    await mkdir(output, { recursive: true })
    await writeFile(join(output, 'inline-message-editor.png'), (await window.webContents.capturePage()).toPNG())
    screenshots.push('inline-message-editor.png')
    await click(`document.querySelector('${userRow} .revision-editor button[type=submit]')`)
    await wait('!document.querySelector(".revision-editor") && !!document.querySelector(".public-message-edited")')
    assert.equal(await run('forkQA.calls.find(c => c.method === "thread.messages.edit").params.command.expectedContentRevision'), 1)
    assert.match(await run(`document.querySelector('${userRow} .message-bubble').textContent`), /更新/)
    await run('forkQA.language("en")')
    await wait('document.querySelector(".public-message-edited")?.textContent === "(edited)"')
    assert.deepEqual(await run(`(() => {
      const styles = getComputedStyle(document.querySelector('.public-message-edited'))
      return [styles.fontSize, styles.fontWeight, styles.marginInlineStart]
    })()`), ['11px', '400', '2.42px'])
    await run('forkQA.language("zh-CN")')
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
    const attemptsBeforeExpiry = await count()
    await quiet()
    await menu()
    assert.equal(await run('document.querySelector(".message-action-menu [role=menuitem]").getAttribute("aria-disabled")'), null)
    await select()
    await quiet()
    assert.equal(await count(), attemptsBeforeExpiry, 'reopening the original entry reconciles the original request')
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
      assert.deepEqual(measured.labels,language==='en'?['Fork chat from here','Select messages','Delete']:['从此处分叉','多选','删除']);assert(measured.inside);assert.equal(measured.minWidth,'0px');assert(measured.items.every(i=>i.icon===16&&i.delta<1),JSON.stringify(measured))
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
    await window.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled',{enabled:false})
    await click('document.querySelector(".app-toast-close")')
    await quiet()
    await run('forkQA.release()');await pause(100)
    await quiet()
    // Shared production portals stack independent owners and clean up in StrictMode.
    const toastGeometry=[]
    for(const language of ['zh-CN','en'])for(const theme of ['day','night','horizon','classic-red','ember']) {
      window.setContentSize(1040,700)
      window.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 100 })
      await run(`forkQA.language(${JSON.stringify(language)});forkQA.theme(${JSON.stringify(theme)})`)
      await run('forkQA.showToasts()')
      await wait('document.querySelectorAll(".app-toast").length===2')
      const measured = await run(`(() => {
        const host = document.querySelector('.app-toast-viewport');
        const shell = document.querySelector('.app-shell');
        const bounds = shell.getBoundingClientRect();
        const sampleColors = (color, background) => {
          const sample = document.createElement('div');
          sample.style.color = color;
          sample.style.backgroundColor = background;
          shell.append(sample);
          const style = getComputedStyle(sample);
          const colors = { color: style.color, background: style.backgroundColor };
          sample.remove();
          return colors;
        };
        const colors = {
          surface: sampleColors('var(--ink)', 'var(--surface-raised)'),
          primary: sampleColors('var(--conversation-action-contrast)', 'var(--conversation-action)'),
          secondary: sampleColors('var(--ink)', 'var(--surface-muted)'),
          danger: sampleColors('var(--danger)', 'color-mix(in srgb, var(--danger) 7%, var(--surface-raised))'),
          dangerFocus: sampleColors('var(--danger)', 'color-mix(in srgb, var(--danger) 11%, var(--surface-raised))')
        };
        const rows = [...host.querySelectorAll('.app-toast')].map(toast => {
          const boundsOf = element => element.getBoundingClientRect();
          const box = boundsOf(toast);
          const message = boundsOf(toast.querySelector('.app-toast-message'));
          const close = toast.querySelector('.app-toast-close');
          const closeBox = boundsOf(close);
          const centerY = rect => rect.y + rect.height / 2;
          const style = getComputedStyle(toast);
          const actions = [...toast.querySelectorAll('.app-toast-action')].map(action => {
            const actionBox = boundsOf(action);
            const actionStyle = getComputedStyle(action);
            return {
              aligned: Math.max(Math.abs(centerY(message) - centerY(actionBox)), Math.abs(centerY(closeBox) - centerY(actionBox))),
              height: actionBox.height,
              border: actionStyle.borderTopWidth,
              colors: { color: actionStyle.color, background: actionStyle.backgroundColor }
            };
          });
          return {
            top: box.top, bottom: box.bottom, height: box.height,
            center: Math.abs(box.x + box.width / 2 - bounds.x - bounds.width / 2),
            inside: box.left >= bounds.left && box.right <= bounds.right,
            actions, appRegion: style.getPropertyValue('-webkit-app-region'),
            closeWidth: closeBox.width, closeHeight: closeBox.height, svg: !!close.querySelector('svg'), closeText: close.textContent,
            role: toast.getAttribute('role'), live: toast.getAttribute('aria-live'),
            color: style.color, background: style.backgroundColor, pointer: style.pointerEvents
          };
        });
        return {
          hosts: document.querySelectorAll('.app-toast-viewport').length, parent: host.parentElement === shell,
          top: rows[0].top - bounds.top, gap: rows[1].top - rows[0].bottom, rows, colors,
          pointer: getComputedStyle(host).pointerEvents
        };
      })()`)
      assert.equal(measured.hosts,1);assert(measured.parent);assert.equal(measured.top,58);assert.equal(measured.gap,8);assert.equal(measured.pointer,'none')
      assert(measured.rows.every(r=>r.center<1&&r.inside&&r.height===40&&r.closeWidth===26&&r.closeHeight===26&&r.svg&&r.closeText===''&&r.pointer==='auto'&&r.appRegion==='no-drag'),JSON.stringify(measured))
      assert(measured.rows.flatMap(row => row.actions).every(action => action.aligned < 1 && action.height === 26 && action.border === '0px'), JSON.stringify(measured))
      assert.deepEqual(measured.rows[0].actions.map(action => action.colors), [measured.colors.primary, measured.colors.secondary])
      assert.deepEqual(measured.rows[1].actions.map(action => action.colors), [measured.colors.danger])
      assert.equal(measured.rows[0].role,'status');assert.equal(measured.rows[0].live,'polite');assert.equal(measured.rows[1].role,'alert');assert.equal(measured.rows[1].live,'assertive')
      assert.equal(measured.rows[0].color,measured.colors.surface.color);assert.equal(measured.rows[0].background,measured.colors.surface.background);assert.equal(measured.rows[1].color,measured.colors.danger.color)
      for (let index = 0; index < 3; index++) {
        const button = `document.querySelectorAll('.app-toast-action')[${index}]`
        const point = await run(`(() => {
          const bounds = ${button}.getBoundingClientRect();
          return { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) };
        })()`)
        window.webContents.sendInputEvent({ type: 'mouseMove', ...point })
        window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
        try {
          await wait(`${button}.matches(':active')`)
          assert.equal(await run(`getComputedStyle(${button}).transform`), 'none')
        } finally {
          window.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 100 })
          window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: 1, y: 100 })
        }
      }
      await run(`document.querySelector('.app-toast.is-danger .app-toast-action').focus()`);await key('Tab');await key('Tab',['shift'])
      assert.equal(await run(`document.activeElement===document.querySelector('.app-toast.is-danger .app-toast-action')`),true)
      await wait(`getComputedStyle(document.activeElement).backgroundColor === ${JSON.stringify(measured.colors.dangerFocus.background)}`)
      const name=`toast-${language}-${theme}.png`;await writeFile(join(output,name),(await window.webContents.capturePage()).toPNG());screenshots.push(name);toastGeometry.push({language,theme,...measured})
      await key('Return')
      await wait('document.querySelectorAll(".app-toast").length===1')
      await click(`document.querySelector('.app-toast-action + .app-toast-action')`);await wait('!document.querySelector(".app-toast-viewport")')
      assert.deepEqual(await run('forkQA.probeActions'),['close:danger','retry','close:neutral','view'])
    }
    window.webContents.setZoomFactor(2)
    await run(`forkQA.showToasts('A long conversation title '.repeat(8))`)
    await wait('document.querySelectorAll(".app-toast").length===2')
    const zoomed=await run(`[...document.querySelectorAll('.app-toast')].every(t=>{const r=t.getBoundingClientRect(),m=t.querySelector('.app-toast-message'),a=t.querySelector('.app-toast-action').getBoundingClientRect();return r.left>=16&&r.right<=innerWidth-16&&m.scrollWidth<=m.clientWidth+1&&Math.abs(r.y+r.height/2-a.y-a.height/2)<1})`)
    assert(zoomed)
    await writeFile(join(output,'toast-zoom-200-long.png'),(await window.webContents.capturePage()).toPNG());screenshots.push('toast-zoom-200-long.png')
    await run('forkQA.clearToasts()');await wait('!document.querySelector(".app-toast-viewport")');window.webContents.setZoomFactor(1)
    window.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 100 })
    await run('forkQA.showTimedToasts()')
    await wait('document.querySelectorAll(".app-toast").length===2')
    await wait('forkQA.probeActions.includes("close:plain")')
    assert.deepEqual(await run('forkQA.probeActions'), ['close:plain'])
    await run('document.querySelector(".app-toast[role=alert] .app-toast-close").focus()')
    await pause(2100)
    assert.deepEqual(await run('forkQA.probeActions'), ['close:plain'], 'keyboard focus pauses the clock')
    const errorPoint = await run(`(() => {
      const bounds = document.querySelector('.app-toast[role=alert]').getBoundingClientRect()
      return { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) }
    })()`)
    window.webContents.sendInputEvent({ type: 'mouseMove', ...errorPoint })
    await wait('document.querySelector(".app-toast[role=alert]").matches(":hover")')
    await run('document.activeElement.blur()')
    await pause(2100)
    assert.deepEqual(await run('forkQA.probeActions'), ['close:plain'], 'hover still pauses after blur')
    window.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 100 })
    await pause(400)
    assert.deepEqual(await run('forkQA.probeActions'), ['close:plain'], 'leaving resumes the remaining time')
    await quiet()
    assert.deepEqual(await run('forkQA.probeActions'), ['close:plain', 'close:error'])

    await run('forkQA.showPersistentToasts()')
    await wait('document.querySelectorAll(".app-toast").length===2')
    await pause(5500)
    assert.equal(await run('document.querySelectorAll(".app-toast").length'), 2)
    assert.deepEqual(await run('forkQA.probeActions'), [])
    assert.equal(await run('document.querySelectorAll(".app-toast[role=status] button").length'), 1)
    assert.equal(await run('document.querySelectorAll(".app-toast[role=alert] button").length'), 1)
    assert.equal(await run('document.querySelector(".app-toast[role=status] .app-toast-close") === null'), true)

    await run(`(() => {
      const viewport = document.querySelector('.app-toast-viewport');
      window.toastFixture = { viewport, shell: viewport.parentElement, messages: [...viewport.children] };
      viewport.remove();
    })()`)
    const retained = `document.querySelector('.app-toast-viewport') === toastFixture.viewport
      && toastFixture.messages.every((toast, index) => toast === toastFixture.viewport.children[index])`
    await wait(`${retained} && toastFixture.viewport.parentElement === toastFixture.shell`)
    await run(`toastFixture.shell.classList.remove('app-shell'); toastFixture.viewport.remove()`)
    await wait(`${retained} && toastFixture.viewport.parentElement === document.body`)
    await run(`(() => {
      const wrapper = document.createElement('div');
      toastFixture.replacement = document.createElement('div');
      toastFixture.replacement.className = 'app-shell';
      wrapper.append(toastFixture.replacement);
      document.body.append(wrapper);
    })()`)
    await wait(`${retained} && toastFixture.viewport.parentElement === toastFixture.replacement`)
    await run('toastFixture.replacement.parentElement.hidden = true')
    await wait(`${retained} && toastFixture.viewport.parentElement === document.body`)
    await run(`toastFixture.shell.classList.add('app-shell'); toastFixture.replacement.parentElement.remove()`)
    await wait(`${retained} && toastFixture.viewport.parentElement === toastFixture.shell`)
    await click(`document.querySelector('.app-toast[role=status] .app-toast-action')`)
    assert.deepEqual(await run('forkQA.probeActions'), ['read-again'])
    assert.equal(await run(retained), true)
    await click(`document.querySelector('.app-toast[role=alert] .app-toast-close')`)
    await wait('document.querySelectorAll(".app-toast").length===1')
    assert.deepEqual(await run('forkQA.probeActions'), ['read-again', 'close:until-closed'])
    await run('forkQA.clearToasts()')
    await wait('!document.querySelector(".app-toast-viewport")')
    await run('forkQA.showPersistentToasts()')
    await wait('document.querySelector(".app-toast-viewport") === toastFixture.viewport')
    await run('forkQA.clearToasts()')
    await wait('!document.querySelector(".app-toast-viewport")')

    assert.deepEqual(await run('forkQA.errors'),[]);assert.deepEqual(errors,[])
    const report={ok:true,channel:'automatic_acceptance',adapter:'controlled transport; real BusinessApp/Composer/Radix/AppToast',userData:process.argv[3],core:false,runtime:false,geometry,toastGeometry,loadingTiming,screenshots,verified:['editing during fork','empty copy Composer','copied quote locates the current Thread message','source-less quote retains text and captured author','source draft preserved','A→B','A→B→A','no completion prompt after leaving source','no opening-failure prompt','ordinary sidebar opens known copy without refork','deleted target stays quiet','fork rejection auto-dismisses','quick fork never flashes loading','visible fork loading lasts at least 600ms without delaying navigation','async attachment save and newer navigation','draft save failure','lost response and refresh receipt','same-author grouped actions below message','five themes','Chinese/English','three window sizes','200% keyboard menu','native touch menu','App-centered loading across sidebar/resize','reduced motion','shared toast stack and StrictMode cleanup','solid primary, tonal secondary and danger actions','SVG close and no movement while pressed','persistent toasts stay until closed or resolved','retained portal follows replacement and hidden shells','hover and focus pause the remaining time','inline editor stays in the message bubble with its actions','toast keyboard actions','200% zoom long message containment','neutral/danger colors in five palettes']}
    await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:true,output,verified:report.verified}));app.exit(0)
  }catch(error){console.error(error.stack??error);console.error(await run('JSON.stringify(forkQA.calls.slice(-12))').catch(()=>''));app.exit(1)}
})
