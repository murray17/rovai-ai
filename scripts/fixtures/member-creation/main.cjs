const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { dirname, isAbsolute, join } = require('node:path')
const { app, BrowserWindow } = require('electron')
const [renderer, userData] = process.argv.slice(2)
assert(isAbsolute(renderer) && isAbsolute(userData))
mkdirSync(userData, { recursive: true })
app.setPath('userData', userData); app.setPath('sessionData', join(userData, 'session'))
let stage = 'startup', window
app.whenReady().then(async () => {
  window = new BrowserWindow({ show: process.platform === 'linux', width: 1440, height: 920, useContentSize: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } })
  const run = expression => window.webContents.executeJavaScript(expression, true)
  const wait = async expression => {
    const until = Date.now() + 7000
    while (Date.now() < until) { if (await run(expression)) return; await new Promise(resolve => setTimeout(resolve, 30)) }
    throw new Error(`Timed out at ${stage}: ${expression}`)
  }
  const settle = () => run('new Promise(resolve => setTimeout(resolve, 160))')
  const point = selector => run(`(() => { const node=document.querySelector(${JSON.stringify(selector)}); if(!node)throw new Error('Missing '+${JSON.stringify(selector)}); const r=node.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)} })()`)
  const click = async selector => { const p = await point(selector); window.webContents.sendInputEvent({type:'mouseDown',...p,button:'left',clickCount:1}); window.webContents.sendInputEvent({type:'mouseUp',...p,button:'left',clickCount:1}); await settle() }
  const key = async (keyCode, modifiers=[]) => { window.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers}); window.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers}); await settle() }
  const type = async text => { await click('.structured-mention-editor'); await key('a',['meta']); await key('Backspace'); await window.webContents.insertText(text); await settle() }
  const capture = async name => writeFileSync(join(dirname(userData), `${name}.png`), (await window.webContents.capturePage()).toPNG())
  const checkResults = async expectedIndent => {
    const layout = await run(`(() => {
      const card = document.querySelector('.member-joined-card'), diff = document.querySelector('.run-file-changes-card');
      const stack = card.parentElement, output = stack.parentElement;
      const r = card.getBoundingClientRect(), d = diff.getBoundingClientRect(), o = output.getBoundingClientRect();
      const reply = output.querySelector('[data-message-id]').getBoundingClientRect();
      return { left: r.left - d.left, right: r.right - d.right, indent: r.left - o.left,
        width: r.width, parentWidth: o.width, replyGap: r.top - reply.bottom, gap: d.top - r.bottom,
        stack: stack.className, lastReply: output.querySelector('[data-message-id]').dataset.messageId };
    })()`)
    assert.equal(layout.stack, 'run-result-stack')
    assert.equal(layout.lastReply, 'review-message-3')
    for (const [key, value] of Object.entries({ left: 0, right: 0, indent: expectedIndent, replyGap: 14, gap: 12 })) {
      assert.ok(Math.abs(layout[key] - value) < 1, `${key}: ${JSON.stringify(layout)}`)
    }
    assert.ok(Math.abs(layout.width - Math.min(620, layout.parentWidth - expectedIndent)) < 1)
    console.log(JSON.stringify({ resultLayout: layout }))
  }
  await window.loadFile(renderer)
  await wait('!!document.querySelector(".member-add-split")')
  stage = 'AI entry and starter'
  const defaultZh = '帮我添加一位新队员。先聊聊我的需求，再一起确定角色、职责和性格。'
  const defaultEn = 'Help me add a new teammate. Let’s discuss what I need, then define their role, responsibilities, and personality.'
  await click('.member-add-split > button:first-child')
  await wait('document.querySelector(".structured-mention-editor")?.innerText === ' + JSON.stringify(defaultZh))
  const first = await run('[...window.memberCreationQA.threads.keys()][0]')
  assert.deepEqual(await run('window.memberCreationQA.calls.find(call=>call.method==="threads.create").params.memberAgentIds'), ['review-member-1'])
  assert.equal(await run('document.querySelectorAll(".camp-nav-row").length'), 1)
  assert.equal(await run('window.memberCreationQA.calls.filter(call=>call.method==="thread.messages.send").length'), 0)
  assert.equal(await run('document.activeElement.classList.contains("structured-mention-editor")'), true)
  await window.webContents.insertText('请偏向研究工作。'); await settle()
  const editedDefault = defaultZh + '请偏向研究工作。'
  assert.equal(await run('document.querySelector(".structured-mention-editor").innerText'), editedDefault)
  await run('window.memberCreationQA.language("en")'); await settle()
  assert.equal(await run('document.querySelector(".structured-mention-editor").innerText'), editedDefault)
  await run('window.memberCreationQA.language("zh-CN")'); await settle()
  await capture('desktop-prefilled-zh')
  await click('.camp-home-actions button:nth-child(2)')
  await wait('document.querySelectorAll(".camp-nav-row").length === 1')
  assert.equal(await run('document.querySelectorAll(".camp-draft-badge").length'), 1)
  assert.equal(await run('window.memberCreationQA.calls.filter(call=>call.method==="thread.messages.send").length'), 0)
  const draftText = await run('document.querySelector(".structured-mention-editor").innerText')
  assert.ok(draftText.includes('工作搭档'))
  stage = 'fresh drafts and switching'
  await click('.rail-button[aria-label="队员"]')
  await click('.member-add-split > button:first-child')
  await wait('document.querySelector(".structured-mention-editor")?.innerText === ' + JSON.stringify(defaultZh))
  assert.equal(await run('window.memberCreationQA.threads.size'), 2)
  assert.equal(await run('document.querySelectorAll(".camp-nav-row").length'), 2)
  await type('')
  await run('window.memberCreationQA.language("en")'); await settle()
  assert.equal(await run('document.querySelector(".structured-mention-editor").innerText.trim()'), '')
  await run('window.memberCreationQA.language("zh-CN")'); await settle()
  assert.equal(await run('document.querySelectorAll(".camp-nav-row").length'), 1)
  await click(`[data-thread-id="${first}"] .camp-nav-open`)
  await wait(`document.querySelector('.structured-mention-editor')?.innerText === ${JSON.stringify(draftText)}`)
  await type('请帮我创建一位研究搭档')
  stage = 'send rejection and acceptance'
  await run('window.memberCreationQA.rejectSend()')
  await click('.composer-primary-action.is-send')
  await wait('!!document.querySelector(".app-toast")')
  await click('.app-toast .icon-button')
  await wait('!document.querySelector(".composer-primary-action.is-send").disabled')
  assert.ok((await run('document.querySelector(".structured-mention-editor").innerText')).includes('研究搭档'))
  assert.equal(await run('document.querySelectorAll(".camp-draft-badge").length'), 1)
  await click('.composer-primary-action.is-send')
  await wait('document.querySelectorAll(".camp-draft-badge").length === 0')
  assert.equal(await run(`window.memberCreationQA.threads.get(${JSON.stringify(first)}).messages.length`), 1)
  stage = 'joined receipt waits for the creating Run to finish'
  await run(`window.memberCreationQA.join(${JSON.stringify(first)})`)
  await wait('!!document.querySelector("[data-message-id=review-message-2]")')
  assert.equal(await run('document.querySelectorAll(".member-joined-card").length'), 0)
  await run(`window.memberCreationQA.finish(${JSON.stringify(first)})`)
  await wait('document.querySelectorAll(".member-joined-card").length === 1')
  await checkResults(42)
  stage = 'static joined receipt and existing away settings'
  const card = await run('document.querySelector(".member-joined-card").innerText')
  await run('window.memberCreationQA.away()')
  await settle()
  assert.equal(await run('document.querySelector(".member-joined-card").innerText'), card)
  await capture('desktop-joined-zh')
  stage = 'narrow desktop result column'
  // Exercise the conversation container breakpoint independently of the mobile viewport.
  await run('document.querySelector(".timeline-pane").style.width = "440px"'); await settle()
  await checkResults(0)
  await capture('narrow-desktop-joined-zh')
  await run('document.querySelector(".timeline-pane").style.removeProperty("width")'); await settle()
  stage = 'existing away settings'
  await click('.member-joined-configure')
  await wait('!!document.querySelector(".member-editor-page:not([hidden]) .member-header-runtime")')
  assert.ok((await run('document.querySelector(".member-editor-page:not([hidden])").innerText')).includes('Nova renamed'))
  stage = 'manual fallback and split action'
  await run('window.memberCreationQA.unavailable(true)')
  const createdBefore = await run('window.memberCreationQA.calls.filter(call=>call.method==="threads.create").length')
  await click('.member-add-split > button:first-child')
  await wait('!!document.querySelector(".member-editor-draft-row")')
  assert.equal(await run('window.memberCreationQA.calls.filter(call=>call.method==="threads.create").length'), createdBefore)
  await run('window.memberCreationQA.unavailable(false)')
  stage = 'mobile English draft'
  window.setContentSize(390, 844); await settle()
  await click('.mobile-member-back .mobile-back')
  await run('window.memberCreationQA.language("en")')
  stage = 'mobile native touch reorder'
  window.webContents.debugger.attach('1.3')
  const from = await point('[data-member-id="review-member-0"] .member-reorder-avatar')
  const to = await point('[data-member-id="review-member-1"] .member-reorder-avatar')
  const touch = (type, p) => window.webContents.debugger.sendCommand('Input.dispatchTouchEvent', {
    type, touchPoints: p ? [{...p, id: 1, radiusX: 4, radiusY: 4, force: 1}] : []
  })
  await touch('touchStart', from)
  await touch('touchMove', { x: from.x, y: from.y + 10 }); await settle()
  await touch('touchMove', to); await settle()
  await touch('touchEnd')
  await wait('window.memberCreationQA.calls.some(call=>call.method==="members.reorder")')
  assert.deepEqual(await run('window.memberCreationQA.calls.find(call=>call.method==="members.reorder").params.command.orderedAgentIds'), ['review-member-1', 'review-member-0', 'new-teammate'])
  window.webContents.debugger.detach()
  await capture('mobile-roster-en')
  stage = 'mobile English draft'
  await click('.member-add-split > button:last-child')
  await wait('!!document.querySelector(".member-editor-menu")')
  assert.ok((await run('document.querySelector(".member-editor-menu").innerText')).includes('Create manually'))
  await key('Escape')
  await click('.member-add-split > button:first-child')
  await wait('!!document.querySelector(".member-leave-dialog")')
  await click('.member-leave-dialog .danger-button')
  await wait('!!document.querySelector(".mobile-starter-toggle")')
  await wait('document.querySelector(".structured-mention-editor")?.innerText === ' + JSON.stringify(defaultEn))
  await capture('mobile-prefilled-en')
  assert.equal(await run('document.querySelectorAll(".mobile-starter-list").length'), 0)
  await click('.mobile-starter-toggle')
  await click('.mobile-starter-list button:nth-child(3)')
  assert.ok((await run('document.querySelector(".structured-mention-editor").innerText')).includes('original companion'))
  await type('Create an original companion')
  const sends = await run('window.memberCreationQA.calls.filter(call=>call.method==="thread.messages.send").length')
  await key('Enter')
  assert.equal(await run('window.memberCreationQA.calls.filter(call=>call.method==="thread.messages.send").length'), sends)
  assert.ok(await run('parseFloat(getComputedStyle(document.querySelector(".structured-mention-editor")).fontSize) >= 16'))
  assert.equal(await run('document.documentElement.scrollWidth > innerWidth'), false)
  await capture('mobile-draft-en')
  await click('.composer-primary-action.is-send')
  await settle()
  const last = await run('[...window.memberCreationQA.threads.keys()].at(-1)')
  await run(`window.memberCreationQA.join(${JSON.stringify(last)})`)
  await wait('!!document.querySelector("[data-message-id=review-message-2]")')
  assert.equal(await run('document.querySelectorAll(".member-joined-card").length'), 0)
  await run(`window.memberCreationQA.finish(${JSON.stringify(last)})`)
  await wait('!!document.querySelector(".member-joined-card")')
  await checkResults(0)
  assert.ok((await run('document.querySelector(".member-joined-card").innerText')).includes('Configure an Agent'))
  assert.equal(await run('document.documentElement.scrollWidth > innerWidth'), false)
  await capture('mobile-joined-en')
  await run('window.memberCreationQA.theme("night")'); await settle(); await capture('mobile-joined-night-en')
  assert.deepEqual(await run('window.memberCreationQA.errors'), [])
  console.log(JSON.stringify({ok:true,cases:['single available helper','localized editable prefill without sending','caret appends to prefill','language changes preserve edits and cleared text','prefill appears in local sidebar','editable starters','fresh draft every time','window-local draft switching','rejected send retains draft','accepted send activates','receipt hidden until Run ends','last reply then receipt then diff','desktop/mobile shared result geometry','static receipt after rename/away','existing runtime settings link','automatic manual fallback','split manual action','mobile native touch reorder','mobile English prefill/starters and Return newline','mobile light/dark joined card']}))
  app.exit(0)
}).catch(async error => {
  if (window) {
    writeFileSync(join(dirname(userData),'failed.png'), (await window.webContents.capturePage()).toPNG())
    console.error(await window.webContents.executeJavaScript('({body:document.body.innerText,calls:window.memberCreationQA?.calls.slice(-10),errors:window.memberCreationQA?.errors})'))
  }
  console.error(stage,error); app.exit(1)
})
