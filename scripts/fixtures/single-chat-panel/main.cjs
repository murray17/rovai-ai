const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { dirname, isAbsolute, join } = require('node:path')
const { app, BrowserWindow } = require('electron')
const assertReturnToLatest = require('../assert-return-to-latest.cjs')

const [renderer, userData, mode] = process.argv.slice(2)
assert.ok(isAbsolute(renderer) && isAbsolute(userData))
mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)
app.setPath('sessionData', join(userData, 'session'))

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: process.env.ROVAI_SHOW_SINGLE_CHAT_FIXTURE === '1',
    width: 1180,
    height: 800,
    useContentSize: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false }
  })
  window.webContents.on('console-message', (event) => console.error(event.message))
  const webOpens = []
  window.webContents.setWindowOpenHandler(({ url }) => { webOpens.push(url); return { action: 'deny' } })
  const query = mode === '--input-history' ? { inputHistory: '1' }
    : mode === '--entry-count' ? { entryCount: '1' } : undefined
  await window.loadFile(renderer, query ? { query } : undefined)
  const run = (code) => window.webContents.executeJavaScript(code, true)
  const settle = async (milliseconds = 40) => {
    await wait(milliseconds)
    await run('window.singleChatTest.settle()')
    return run('window.singleChatTest.state()')
  }
  const waitFor = async (expression, timeout = 10_000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await run(expression)) return
      await wait(50)
    }
    throw new Error(`Timed out waiting for ${expression}`)
  }
  const click = async (selector) => {
    const point = await run(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)})
      if (!node) throw new Error('Missing ' + ${JSON.stringify(selector)})
      node.scrollIntoView({ block: 'nearest' })
      // A wrapped inline link's union box can include non-clickable whitespace.
      const rect = node.getClientRects()[0] ?? node.getBoundingClientRect()
      return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }
    })()`)
    window.webContents.sendInputEvent({ type: 'mouseMove', ...point })
    window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
    window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 })
    return settle()
  }
  const key = async (keyCode, modifiers = []) => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    return settle()
  }
  const fillComposer = async (value) => {
    await run(`(() => {
      const node = document.querySelector('.single-chat-composer textarea')
      if (!node) throw new Error('Missing Single Chat composer')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(node, ${JSON.stringify(value)})
      node.dispatchEvent(new Event('input', { bubbles: true }))
      node.focus()
    })()`)
    return settle()
  }
  const dispatchComposerEnter = async (shiftKey) => {
    const defaultPrevented = await run(`(() => {
      const node = document.querySelector('.single-chat-composer textarea')
      if (!node) throw new Error('Missing Single Chat composer')
      const event = new KeyboardEvent('keydown', {
        key: 'Enter', shiftKey: ${Boolean(shiftKey)}, bubbles: true, cancelable: true
      })
      node.dispatchEvent(event)
      return event.defaultPrevented
    })()`)
    return { defaultPrevented, state: await settle() }
  }
  const capture = async (name) => {
    const path = join(dirname(userData), `${name}.png`)
    writeFileSync(path, (await window.webContents.capturePage()).toPNG())
    return path
  }
  const drag = async (type, selector = '.single-chat-composer textarea', files = true) => {
    const result = await run(`(() => {
      const dataTransfer = new DataTransfer()
      if (${files}) dataTransfer.items.add(new File(['private'], 'private.txt', { type: 'text/plain' }))
      else dataTransfer.setData('text/plain', 'text drag')
      const event = new DragEvent(${JSON.stringify(type)}, { dataTransfer, bubbles: true, cancelable: true })
      document.querySelector(${JSON.stringify(selector)}).dispatchEvent(event)
      return { defaultPrevented: event.defaultPrevented }
    })()`)
    return { ...result, state: await settle() }
  }

  try {
    if (mode === '--entry-count') {
      const state = () => run('window.singleChatTest.entryCountState()')
      await waitFor('window.singleChatTest?.entryCountState().count === "1"')
      const thread = (await state()).threadId
      const event = async (code, extra = {}) => {
        await run(`window.singleChatTest.entryEvent(${JSON.stringify({ threadId: thread,
          result: { code, payload: { conversationId: 'single-chat-fixture-conversation' } }, ...extra })})`)
      }
      const setConversations = (count, running = false, targetThread = thread) => run(
        `window.singleChatTest.setEntryConversations(${JSON.stringify(targetThread)}, ${count}, ${running})`
      )
      assert.equal((await state()).hidden, true, 'entry count loads before opening the panel')
      assert.equal((await state()).gets, 0, 'closed panel does not load a private transcript')
      assert.equal((await state()).lists.length, 1)
      await wait(1_000)
      assert.equal((await state()).lists.length, 1, 'entry count does not poll')

      await setConversations(2)
      await event('single_chat.opened')
      await waitFor('window.singleChatTest.entryCountState().count === "2"')
      await setConversations(1)
      await event('single_chat.ended')
      await waitFor('window.singleChatTest.entryCountState().count === "1"')
      await setConversations(2)
      await run('window.singleChatTest.invalidateEntryList()')
      await waitFor('window.singleChatTest.entryCountState().count === "2"')

      const reads = (await state()).lists.length
      await event('single_chat.opened', { threadId: 'unrelated-thread' })
      await settle()
      assert.equal((await state()).lists.length, reads, 'other Thread changes do not read this list')

      await click('[data-detail="single-chat"]')
      await waitFor("Boolean(document.querySelector('.single-chat-final'))")
      await click('[data-detail="single-chat"]')
      await setConversations(2, true)
      await event('single_chat.reply_queued')
      await waitFor('window.singleChatTest.entryCountState().running')
      await setConversations(2)
      await run(`window.singleChatTest.entryEvent(${JSON.stringify({ threadId: thread,
        conversationId: 'single-chat-fixture-conversation', reason: 'run_updated' })})`)
      await waitFor('!window.singleChatTest.entryCountState().running')
      const gets = (await state()).gets

      await run('window.singleChatTest.holdEntryListReads()')
      await setConversations(3)
      await event('single_chat.opened')
      await waitFor('window.singleChatTest.entryCountState().held === 1')
      await setConversations(1)
      await event('single_chat.ended')
      await run('window.singleChatTest.releaseEntryListReads()')
      await waitFor('window.singleChatTest.entryCountState().count === "1"')

      await run('window.singleChatTest.holdEntryListReads()')
      await setConversations(3)
      await event('single_chat.opened')
      await waitFor('window.singleChatTest.entryCountState().held === 1')
      await run('window.singleChatTest.switchThread("empty-thread")')
      await waitFor('window.singleChatTest.entryCountState().held === 2')
      await run('window.singleChatTest.releaseEntryListReads()')
      await waitFor('window.singleChatTest.entryCountState().count === "0"')
      await settle()
      assert.equal((await state()).count, '0', 'late reads cannot restore the previous Thread count')
      assert.equal((await state()).gets, gets, 'hidden list refreshes never read a transcript')
      console.log(JSON.stringify({ ok: true, verified: {
        initialCount: true, closedPanelEvents: true, invalidation: true,
        noIdlePolling: true, noHiddenTranscriptReads: true, runningState: true, lateReadFence: true
      } }))
      window.destroy(); app.quit()
      return
    }
    await waitFor("Boolean(document.querySelector('.single-chat-final'))")
    if (mode === '--input-history') {
      const input = '.single-chat-composer textarea'
      const webState = () => run('window.singleChatTest.webState()')
      const boundary = async end => {
        await run(`(() => {const node=document.querySelector('${input}'); node.focus();
          node.setSelectionRange(${end ? 'node.value.length' : '0'},${end ? 'node.value.length' : '0'})})()`)
        await settle()
      }
      const historyKey = async (key, extra = {}) => {
        const consumed = await run(`(() => {
          const event=new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true,cancelable:true,...${JSON.stringify(extra)}});
          document.querySelector('${input}').dispatchEvent(event); return event.defaultPrevented;
        })()`)
        await settle()
        return consumed
      }
      await fillComposer('原单聊草稿')
      await boundary(false)
      const writes = (await webState()).recoveryWrites
      assert.equal(await historyKey('ArrowUp', { isComposing: true }), false)
      assert.equal(await historyKey('ArrowUp', { shiftKey: true }), false)
      assert.equal(await historyKey('ArrowUp'), true)
      assert.equal((await webState()).value, 'private newest')
      assert.equal((await webState()).recoveryWrites, writes)
      await run('window.singleChatTest.publishHistoryPending()')
      await waitFor('window.singleChatTest.inputHistoryState().queue.length === 0')
      await settle()
      assert.equal((await webState()).value, 'private newest', 'publishing pending preserves this browsing round')
      await historyKey('ArrowUp')
      assert.equal((await webState()).value, 'private older')
      await boundary(true)
      await historyKey('ArrowDown')
      assert.equal((await webState()).value, 'private newest')
      assert.equal(await historyKey('Escape'), true)
      assert.equal((await webState()).value, '原单聊草稿')
      assert.equal((await webState()).recoveryWrites, writes, 'Esc restores the unchanged draft without saving it again')
      assert.ok(await run("Boolean(document.querySelector('.single-chat-popover:not([hidden])'))"), 'Esc restores without closing the panel')
      await boundary(false)
      await historyKey('ArrowUp')
      await boundary(true)
      assert.equal(await historyKey('ArrowDown'), true)
      assert.equal((await webState()).value, '原单聊草稿')
      assert.equal((await webState()).recoveryWrites, writes, 'Down past the latest input does not save the unchanged draft again')
      await boundary(false)
      await historyKey('ArrowUp')
      assert.equal((await webState()).value, 'private published', 'next round uses formal messages after publication')
      await run('window.singleChatTest.replaceHistoryPending("原单聊草稿")')
      await waitFor("Boolean(document.querySelector('.single-chat-pending-queue .pending-input-edit'))")
      await run("document.querySelector('.single-chat-pending-queue .pending-input-edit').click()")
      await waitFor('window.singleChatTest.webState().value === "原单聊草稿"')
      assert.equal((await webState()).value, '原单聊草稿', 'equal-text explicit replacement clears the old preview')
      await boundary(false)
      await historyKey('ArrowUp')
      await run('window.singleChatTest.restoreDraft()')
      await settle()
      assert.equal((await webState()).value, '原单聊草稿', 'remount recovers the real draft')
      assert.equal(await run('window.singleChatTest.inputHistoryState().reads'), 0)
      await run('window.singleChatTest.setMode("running", true)')
      await fillComposer('')
      await waitFor("document.querySelector('.single-chat-composer .composer-primary-action')?.getAttribute('aria-label') === '停止当前执行'")
      await boundary(false)
      await historyKey('ArrowUp')
      assert.equal(await run("document.querySelector('.single-chat-composer .composer-primary-action').getAttribute('type')"), 'submit')
      await dispatchComposerEnter(false)
      await waitFor('window.singleChatTest.webState().sends.length === 1')
      assert.equal((await webState()).sends[0].command.body, 'private newest')
      await waitFor('window.singleChatTest.webState().value === ""')
      assert.equal(await run('window.singleChatTest.inputHistoryState().reads'), 0)
      await boundary(false)
      await historyKey('ArrowUp')
      assert.equal((await webState()).value, 'private newest')
      await run('window.singleChatTest.showHistoryQuote()')
      await waitFor("Boolean(document.querySelector('.single-chat-composer .message-quotes-trigger'))")
      assert.equal((await webState()).value, 'private newest', 'ordinary draft metadata refresh preserves the preview')
      await run("document.querySelector('.single-chat-composer .message-quotes-trigger').click()")
      await waitFor("Boolean(document.querySelector('.message-quote-remove'))")
      await run("document.querySelector('.message-quote-remove').click()")
      await waitFor("!document.querySelector('.single-chat-composer .message-quotes-trigger')")
      await run('window.singleChatTest.restoreDraft()')
      await settle()
      assert.equal((await webState()).value, 'private newest', 'explicit quote changes adopt the preview into the real draft')
      await fillComposer('edited private history')
      assert.equal(await historyKey('Escape'), true, 'after editing, Escape resumes the ordinary panel-close behavior')
      assert.ok(await run("Boolean(document.querySelector('.single-chat-popover[hidden]'))"))
      assert.equal((await webState()).value, 'edited private history')
      console.log(JSON.stringify({ ok: true, verified: { inputHistory: true, previewSend: true, draftRecovery: true } }))
      window.destroy(); app.quit()
      return
    }
    if (mode === '--web-links') {
      window.webContents.debugger.attach('1.3')
      await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
      const url = 'http://localhost:8766/a?x=1&y=2#part'
      const input = '.single-chat-composer textarea'
      const webState = () => run('window.singleChatTest.webState()')
      const clickInput = async (modifiers = [], clickCount = 1, point = null) => {
        point ??= await run(`(() => {const n=document.querySelector('${input}'),r=n.getBoundingClientRect(),s=getComputedStyle(n);return {x:Math.round(r.left+parseFloat(s.paddingLeft)+14),y:Math.round(r.top+parseFloat(s.paddingTop)+parseFloat(s.lineHeight)/2)}})()`)
        window.webContents.sendInputEvent({type:'mouseMove',...point})
        window.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount,modifiers})
        window.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount,modifiers})
        await settle()
      }
      const shortUrl = 'https://example.com/a'
      await fillComposer(shortUrl)
      const blankBefore = await webState()
      const blanks = await run(`(() => {
        const n=document.querySelector('${input}'),r=n.getBoundingClientRect(),s=getComputedStyle(n)
        const y=Math.round(r.top+parseFloat(s.paddingTop)+parseFloat(s.lineHeight)/2)
        return [{name:'left padding',x:Math.round(r.left+1),y,offset:0},
          {name:'right blank',x:Math.round(r.right-2),y,offset:n.value.length},
          {name:'below text',x:Math.round(r.left+r.width/2),y:Math.round(r.bottom-2),offset:n.value.length}]
      })()`)
      for (const {name,x,y,offset} of blanks) for (const modifiers of [[],['meta']]) {
        await clickInput()
        assert.equal((await webState()).popup,shortUrl,'Interior clicks still activate the URL')
        await clickInput(modifiers,1,{x,y})
        const state = await webState()
        assert.equal(state.start,offset,name+' keeps native caret placement')
        assert.equal(state.end,offset)
        assert.equal(state.focused,true)
        assert.equal(state.popup,null,name+' must not show link actions')
        assert.equal(webOpens.length,0,name+' must not open a link')
        assert.equal(state.value,shortUrl)
        assert.equal(state.recoveryWrites,blankBefore.recoveryWrites)
      }
      await window.webContents.insertText('x')
      await settle()
      assert.equal((await webState()).value,shortUrl+'x','Typing after a blank click uses the native caret')
      window.webContents.undo()
      await settle()
      assert.equal((await webState()).value,shortUrl)
      await run('window.singleChatTest.showWebLinks('+JSON.stringify(url)+')')
      await waitFor('!!document.querySelector(".single-chat-user-bubble a")')
      assert.equal(await run('document.querySelector(".single-chat-user-bubble").textContent'), '前 [标题]('+url+') 后')
      await click('.single-chat-user-bubble a')
      await click('.single-chat-final a')
      assert.deepEqual(webOpens, [url, url])
      await fillComposer(url)
      const before = await webState()
      await clickInput()
      let state = await webState()
      assert.equal(state.popup, url)
      assert.equal(state.focused, true)
      assert.equal(state.start,state.end)
      assert.ok(state.start > 0 && state.start < url.length, 'Native click still positions the caret inside the URL')
      await click('.composer-web-link-buttons button:nth-child(2)')
      assert.equal((await webState()).copied.at(-1), url)
      assert.equal((await webState()).start, state.start)
      await click('.composer-web-link-buttons button:first-child')
      await clickInput(['meta'])
      assert.deepEqual(webOpens, [url,url,url,url])
      state = await webState()
      assert.equal(state.value,before.value)
      assert.equal(state.recoveryWrites,before.recoveryWrites)
      assert.equal(state.revision,before.revision)
      assert.equal(state.sends.length,0)
      await clickInput()
      await key('Escape')
      assert.equal((await webState()).popup,null)
      await clickInput([],2)
      assert.equal((await webState()).popup,null)
      state = await webState()
      assert.ok(state.end > state.start, 'Double click selects text')
      await key('Right')
      const dragPoint = await run(`(() => {const n=document.querySelector('${input}'),r=n.getBoundingClientRect(),s=getComputedStyle(n);return {x:Math.round(r.left+parseFloat(s.paddingLeft)+14),y:Math.round(r.top+parseFloat(s.paddingTop)+parseFloat(s.lineHeight)/2)}})()`)
      window.webContents.sendInputEvent({type:'mouseMove',...dragPoint})
      window.webContents.sendInputEvent({type:'mouseDown',...dragPoint,button:'left',clickCount:1})
      await settle()
      for (let step=1;step<=5;step++) {
        window.webContents.sendInputEvent({type:'mouseMove',x:dragPoint.x+step*10,y:dragPoint.y,button:'left',modifiers:['leftButtonDown']})
        await wait(16)
      }
      window.webContents.sendInputEvent({type:'mouseUp',x:dragPoint.x+50,y:dragPoint.y,button:'left',clickCount:1})
      await settle()
      state = await webState()
      assert.equal(state.popup,null)
      assert.ok(state.end > state.start, 'Dragging selects text without opening: '+JSON.stringify(state))
      assert.equal(webOpens.length,4)
      await fillComposer('`'+url+'`')
      await clickInput()
      assert.equal((await webState()).popup,null,'Inline code remains ordinary text')
      await fillComposer(url)
      await clickInput()
      await window.webContents.debugger.sendCommand('Input.imeSetComposition',{text:'中',selectionStart:1,selectionEnd:1})
      assert.equal((await webState()).popup,null)
      await window.webContents.insertText('中文')
      await settle()
      assert.ok((await webState()).value.includes('中文'))
      await fillComposer(url)
      await run('document.querySelector('+JSON.stringify(input)+').setSelectionRange('+url.length+','+url.length+')')
      await window.webContents.insertText('x')
      await settle()
      await clickInput()
      assert.equal((await webState()).popup,url+'x')
      await click('.composer-web-link-buttons button:nth-child(2)')
      window.webContents.undo()
      await settle()
      assert.equal((await webState()).value,url)
      assert.equal((await webState()).popup,null)
      window.webContents.redo()
      await settle()
      assert.equal((await webState()).value,url+'x')
      const saved = await webState()
      await run('window.singleChatTest.restoreDraft()')
      await waitFor('!!document.querySelector(".single-chat-composer textarea:not(:disabled)")')
      await settle()
      assert.equal((await webState()).value,saved.value)
      const restored = await webState()
      await clickInput()
      const count = webOpens.length
      await click('.composer-web-link-buttons button:first-child')
      assert.equal(webOpens.length,count+1)
      assert.equal(webOpens.at(-1),url+'x')
      assert.equal((await webState()).recoveryWrites,restored.recoveryWrites)
      // Closing the panel invalidates any visible action without changing the draft.
      await run('window.singleChatTest.showPanel(false)')
      await settle()
      assert.equal((await webState()).popup,null)
      await run('window.singleChatTest.showPanel(true)')
      await settle()
      await clickInput()
      const enter = async (shift = false) => {
        await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
          type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r',modifiers:shift?8:0
        })
        await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
          type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,modifiers:shift?8:0
        })
        await settle()
      }
      await enter(true)
      assert.equal((await webState()).sends.length,0)
      assert.ok((await webState()).value.includes('\n'))
      await fillComposer(url+'x')
      await enter()
      await waitFor('window.singleChatTest.webState().sends.length === 1')
      assert.equal((await webState()).sends[0].command.body,url+'x')
      console.log(JSON.stringify({ok:true,verified:{literalMessages:true,textareaLinks:true,blankAreaEditing:true,editingRecovery:true,noExtraWrites:true}}))
      window.destroy()
      app.quit()
      return
    }
    if (mode === '--pending-return') {
      await run('window.singleChatTest.showPendingQueue()')
      await waitFor('document.querySelectorAll(".single-chat-pending-queue .pending-input-row").length === 2')
      await fillComposer('私聊当前草稿')
      await run('window.singleChatTest.beginLeave()')
      await run('window.singleChatTest.beginLeave()')
      await run('window.singleChatTest.cancelLeave(); window.singleChatTest.repeatLeaveCancellation()')
      await settle()
      assert.equal(await run('document.querySelector(".single-chat-pending-queue .pending-input-edit").disabled'), true)
      await run('document.querySelector(".single-chat-pending-queue .pending-input-edit").click()')
      assert.equal(await run('window.singleChatTest.pendingState().commands.length'), 0, 'cancelling one navigation keeps the other leave lease active')
      await run('window.singleChatTest.cancelLeave()')
      await settle()
      await click('.single-chat-pending-queue .pending-input-edit')
      await waitFor('window.singleChatTest.pendingState().commands.length === 1')
      let pending = await run('window.singleChatTest.pendingState()')
      assert.equal(pending.text, '私聊当前草稿')
      assert.equal(pending.disabled, true)
      assert.match(await run('window.singleChatTest.tryLeave()'), /移回结果尚未确认/)
      await run('window.singleChatTest.releasePendingReturn()')
      await waitFor('Array.from(document.querySelectorAll("button")).some(button => button.textContent.includes("重试移回消息"))')
      pending = await run('window.singleChatTest.pendingState()')
      assert.deepEqual(pending.queue, ['private-pending-C'])
      assert.equal(pending.text, '私聊当前草稿', 'unknown receipt does not erase current input')
      assert.equal(pending.disabled, true)
      assert.match(await run('window.singleChatTest.tryLeave()'), /移回结果尚未确认/)
      await run('Array.from(document.querySelectorAll("button")).find(button => button.textContent.includes("重试移回消息")).click()')
      await waitFor('window.singleChatTest.pendingState().disabled === false')
      pending = await run('window.singleChatTest.pendingState()')
      assert.equal(pending.text, '私聊 B：移回后继续编辑。')
      assert.equal(pending.commands.length, 2)
      assert.deepEqual(pending.commands[0], pending.commands[1], 'retry replays the identical durable command')
      assert.deepEqual(pending.queue, ['private-pending-C'])
      assert.equal(pending.rowCount, 1)
      assert.equal(pending.editingCount, 0)
      assert.equal(await run('window.singleChatTest.tryLeave()'), null)
      for (const theme of ['day', 'night']) {
        await run('document.documentElement.dataset.theme = ' + JSON.stringify(theme))
        await settle()
        await capture(`single-chat-pending-return-${theme}`)
      }
      console.log(JSON.stringify({ ok: true, verified: { withdrawalRecovery: true, navigationFence: true, identicalCommandReplay: true } }))
      window.destroy()
      app.quit()
      return
    }
    let state = await settle()
    if (mode === '--return-latest') {
      await run('window.singleChatTest.appendReturnHistory(10)')
      await settle(350)
      await run('document.querySelector(".single-chat-viewport").scrollTop = 200')
      await settle()
      assert.equal(await run('document.querySelectorAll("[data-return-scope=single]").length'), 1)
      assert.equal(await run('document.querySelectorAll(".return-to-latest-dot").length'), 0)
      const top = await run('document.querySelector(".single-chat-viewport").scrollTop')
      await run('window.singleChatTest.appendReturnHistory(1)')
      await settle(350)
      assert.ok(Math.abs(await run('document.querySelector(".single-chat-viewport").scrollTop') - top) < 2)
      assert.equal(await run('document.querySelectorAll(".return-to-latest-dot").length'), 1)
      await capture('return-latest-single')
      await assertReturnToLatest(window, run, 'single')
      await settle()
      assert.equal(await run('document.querySelectorAll("[data-return-scope=single]").length'), 0)
      assert.ok(await run('(() => {const v=document.querySelector(".single-chat-viewport");return v.scrollHeight-v.clientHeight-v.scrollTop<2})()'))
      await run('document.querySelector(".single-chat-viewport").scrollTop = 200')
      await settle()
      await run('document.querySelector("[data-return-scope=single]").focus({preventScroll:true})')
      await key('Space')
      await settle()
      assert.equal(await run('document.querySelectorAll("[data-return-scope=single]").length'), 0)
      assert.equal(await run('document.activeElement.matches(".single-chat-viewport")'), true)
      await run('document.querySelector(".single-chat-viewport").scrollTop = 200')
      await settle()
      await run('document.querySelector("[data-return-scope=single]").focus({preventScroll:true}); const v=document.querySelector(".single-chat-viewport"); v.scrollTop=v.scrollHeight')
      await settle()
      assert.equal(await run('document.querySelectorAll("[data-return-scope=single]").length'), 0)
      assert.equal(await run('document.activeElement.matches(".single-chat-viewport")'), true,
        'scrolling to the bottom returns focus when the control disappears without a click')
      console.log(JSON.stringify({ ok: true, verified: { readingPosition: true, pressedGeometry: true, localReturn: true, keyboardReturn: true } }))
      app.quit()
      return
    }
    const collapseStyle = await run(`(() => {
      const b = document.querySelector('.single-chat-heading .camp-detail-collapse'), k = document.querySelector('.single-chat-footer kbd');
      const r = b.getBoundingClientRect(), s = getComputedStyle(k), p = b.closest('aside').getBoundingClientRect();
      return { text:b.textContent.trim(), width:r.width, height:r.height, top:r.top-p.top, right:p.right-r.right,
        keyBorder:s.borderWidth, keyPadding:s.padding, keyBackground:s.backgroundColor };
    })()`)
    assert.deepEqual(collapseStyle, { text:'收起', width:62, height:28, top:9, right:13,
      keyBorder:'0px', keyPadding:'0px', keyBackground:'rgba(0, 0, 0, 0)' })
    await fillComposer('收起后继续编辑的单聊草稿')
    await click('.single-chat-target-trigger')
    await key('Escape')
    assert.equal(await run('document.querySelector(".single-chat-popover").hidden'), false, 'Menu Escape keeps Single Chat open')
    await fillComposer('收起后继续编辑的单聊草稿')
    await run(`document.querySelector('.single-chat-composer textarea').dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', isComposing:true, bubbles:true, cancelable:true }))`)
    assert.equal(await run('document.querySelector(".single-chat-popover").hidden'), false, 'IME Escape cannot collapse the panel')
    await key('Escape')
    assert.equal(await run('document.querySelector(".single-chat-popover").hidden'), true)
    assert.equal(await run('document.querySelector(".single-chat-popover").contains(document.activeElement)'), false, 'No focus remains inside the hidden panel')
    await click('.camp-detail-entry[data-detail="single-chat"]')
    assert.equal(await run('document.querySelector(".single-chat-composer textarea").value'), '收起后继续编辑的单聊草稿')
    await fillComposer('')
    await click('.single-chat-heading .camp-detail-collapse')
    assert.equal(await run('document.querySelector(".single-chat-popover").hidden'), true)
    await click('.camp-detail-entry[data-detail="single-chat"]')
    state = await settle()
    assert.ok(state.panel && state.panel.width <= 441 && state.panel.height <= 701)
    assert.equal(state.pageOverflow, false)
    assert.equal(state.triggerAvatars, 1)
    assert.equal(state.transcriptAvatars, 0)
    assert.ok(state.userMessage && state.agentResponse)
    assert.ok(state.userMessage.left > state.agentResponse.left + 24)
    assert.ok(Math.abs(state.userMessage.right - state.agentResponse.right) <= 1)
    assert.equal(state.terminalOpen, false)
    assert.equal(state.finalVisible, true)
    assert.equal(state.attachmentButton, true)
    assert.match(state.composerHint, /发送.*换行/)
    assert.equal(state.composerResize, 'none')
    assert.ok(state.composer && state.attachmentButtonBounds && state.composerActionsBounds)
    assert.ok(state.attachmentButtonBounds.left < state.composerActionsBounds.left)
    assert.ok(Math.abs(state.composerActionsBounds.right - (state.composer.right - 8)) <= 1)
    assert.equal(state.messageAttachments, 1)
    assert.equal(state.agentBackground, 'rgba(0, 0, 0, 0)')
    assert.match(state.body, /工作了 39 分 17 秒/)
    assert.match(state.body, /你在 5 分 38 秒后停止了运行/)
    assert.doesNotMatch(state.body, /Working for|You stopped after/)

    // The panel is nested in the Camp drop surface in production. Its file events must stay private.
    let dragged = await drag('dragenter')
    assert.equal(dragged.state.attachmentDropVisible, true)
    assert.deepEqual(dragged.state.bubbledDragEvents, [])
    dragged = await drag('dragover', '.single-chat-transcript')
    assert.equal(dragged.defaultPrevented, true)
    assert.equal(dragged.state.attachmentDropVisible, true)
    assert.deepEqual(dragged.state.bubbledDragEvents, [])
    const dayDrop = await capture('single-chat-day-private-drop-1180x800')
    dragged = await drag('dragleave')
    assert.equal(dragged.state.attachmentDropVisible, false)
    assert.deepEqual(dragged.state.bubbledDragEvents, [])
    await drag('dragenter')
    dragged = await drag('drop')
    assert.equal(dragged.defaultPrevented, true)
    assert.equal(dragged.state.attachmentDropVisible, false)
    assert.deepEqual(dragged.state.bubbledDragEvents, [])

    // Public-surface and ordinary text drags still propagate normally.
    for (const type of ['dragenter', 'dragover', 'dragleave', 'drop']) {
      await drag(type, '.public-execution-fixture')
      dragged = await drag(type, '.single-chat-composer textarea', false)
      assert.equal(dragged.defaultPrevented, false)
      assert.equal(dragged.state.attachmentDropVisible, false)
    }
    assert.deepEqual(dragged.state.bubbledDragEvents, [
      'dragenter', 'dragenter', 'dragover', 'dragover', 'dragleave', 'dragleave', 'drop', 'drop'
    ])
    await run('window.singleChatTest.resetDragEvents()')

    state = await click('.single-chat-run-history.is-terminal > summary')
    assert.equal(state.terminalOpen, true)
    assert.match(state.groupLabel, /已完成 3 个步骤/)

    state = await click('.single-chat-target-trigger')
    assert.equal(state.optionAvatars, 3)
    assert.doesNotMatch(state.body, /已有单聊|新的单聊/)
    const dayMenu = await capture('single-chat-day-menu-1180x800')
    await key('Escape')

    state = await click('.single-chat-end-button')
    assert.match(state.dialog, /这段对话将被删除且无法回复。/)
    assert.match(state.dialog, /不再询问/)
    assert.equal(state.checkbox, true)
    assert.deepEqual(state.endButtons.filter(Boolean), ['取消', '结束'])
    const dayDialog = await capture('single-chat-day-end-dialog-1180x800')
    await key('Escape')

    state = await fillComposer('第一行')
    assert.equal(state.composerValue, '第一行')
    let composerEnter = await dispatchComposerEnter(true)
    assert.equal(composerEnter.defaultPrevented, false)
    assert.equal(composerEnter.state.sendRequests, 0)
    await run('window.singleChatTest.holdSend(true)')
    composerEnter = await dispatchComposerEnter(false)
    assert.equal(composerEnter.defaultPrevented, true)
    assert.equal(composerEnter.state.sendRequests, 1)

    assert.equal(composerEnter.state.sendFeedback, '准备中…')
    assert.equal(composerEnter.state.composerDisabled, true)
    for (const type of ['dragenter', 'dragover', 'dragleave', 'drop']) {
      dragged = await drag(type, '.single-chat-transcript')
      assert.equal(dragged.state.attachmentDropVisible, false)
      assert.deepEqual(dragged.state.bubbledDragEvents, [])
    }
    await run('window.singleChatTest.releaseSend()')
    await waitFor("window.singleChatTest.state().composerDisabled === false")
    state = await settle()
    assert.equal(state.sendFeedback, '')
    assert.equal(state.composerValue, '第一行')
    assert.match(state.body, /fixture.send_rejected/)

    await run('window.singleChatTest.holdSend()')
    composerEnter = await dispatchComposerEnter(false)
    assert.equal(composerEnter.state.sendFeedback, '准备中…')
    await run('window.singleChatTest.releaseSend()')
    await waitFor("window.singleChatTest.state().liveText.includes('启动中…')")
    state = await settle()
    assert.equal(state.sendFeedback, '')
    assert.equal(state.liveSummaryVisible, false)
    assert.equal(state.liveOpen, true)
    assert.match(state.publicText, /启动中…/)
    assert.doesNotMatch(state.liveText, /工作了|正在工作|等待开始|正在处理/)
    const dayQueued = await capture('single-chat-day-queued-1180x800')

    const phase = async (value, notify = true) => {
      await run(`window.singleChatTest.setMode(${JSON.stringify(value)}, ${notify})`)
      return settle(notify ? 80 : 950)
    }
    await run(`(() => {
      window.feedbackOverlaps = []
      window.feedbackObserver = new MutationObserver(() => {
        for (const selector of ['.single-chat-run-history.is-live', '.public-execution-fixture .process-content']) {
          const surface = document.querySelector(selector)
          if (surface?.querySelector('.single-chat-narration, .stream-narration')
            && [...surface.querySelectorAll('.process-action.current')].some(node => /Thinking|思考中|启动中/.test(node.textContent))) {
            window.feedbackOverlaps.push(selector)
          }
        }
      })
      window.feedbackObserver.observe(document.body, { childList: true, subtree: true, characterData: true })
    })()`)
    for (const value of ['thinking', 'narration']) {
      state = await phase(value, false)
      if (value === 'thinking') {
        assert.match(state.liveText, /思考中/)
        assert.match(state.publicText, /思考中/)
      } else {
        assert.match(state.liveText, /我正在检查双主题/)
        assert.doesNotMatch(state.liveText + state.publicText, /Thinking|思考中|准备中|启动中/)
        assert.deepEqual(await run('window.feedbackOverlaps'), [])
      }
      assert.equal(state.liveSummaryVisible, false)
      assert.doesNotMatch(state.liveText + state.publicText, /工作了|正在工作|正在处理|等待开始/)
    }
    state = await phase('running')
    assert.equal(state.liveExecutionBackground, 'rgba(0, 0, 0, 0)')
    assert.equal(state.liveExecutionBorderWidth, '0px')
    assert.equal(state.composerDisabled, false)
    assert.equal(state.stopVisible, true)
    assert.match(state.liveGroupAccessibleLabel, /执行中.*pnpm run accept:single-chat-ui/)
    assert.doesNotMatch(state.liveText + state.publicText, /Thinking|思考中|准备中|启动中|工作了|正在工作/)
    const singleLive = '.single-chat-run-history.is-live'
    const publicFixture = '.public-execution-fixture'
    await click(`${singleLive} .tool-group-summary`)
    await click(`${singleLive} .tool-call-summary`)
    await click(`${publicFixture} .tool-group-summary`)
    await click(`${publicFixture} .tool-call-summary`)
    await run(`window.fixtureNodes = {
      singleGroup: document.querySelector('${singleLive} .tool-activity-group'),
      singleTool: document.querySelector('${singleLive} .tool-call-disclosure'),
      publicGroup: document.querySelector('${publicFixture} .tool-activity-group'),
      publicTool: document.querySelector('${publicFixture} .tool-call-disclosure')
    }`)
    const dayTools = await capture('single-chat-day-tools-1180x800')
    await run("document.documentElement.dataset.theme = 'night'")
    state = await phase('returned')
    assert.match(state.liveGroupAccessibleLabel, /执行中/)
    assert.doesNotMatch(state.liveText + state.publicText, /Thinking|思考中|准备中|启动中|工作了|正在工作/)
    await waitFor("Boolean(document.querySelector('.single-chat-run-history.is-live .tool-result-retry'))")
    await click(`${singleLive} .tool-result-retry`)
    await waitFor("document.querySelector('.single-chat-run-history.is-live .tool-call-result-scroll')?.textContent.includes('PRIVATE_RESULT_END')")
    state = await settle()
    assert.equal(state.resultRequests, 2)
    const resultSelector = `${singleLive} .tool-call-result-scroll`
    await run(`document.querySelector('${resultSelector}').focus()`)
    await key('End')
    assert.equal(await run(`document.querySelector('${resultSelector}').scrollTop > 0`), true)
    await key('Escape')
    assert.equal(await run(`document.activeElement === document.querySelector('${singleLive} .tool-call-summary')`), true)
    assert.equal(await run(`document.querySelector('${singleLive} .tool-call-state').getAttribute('aria-label')`), '成功')
    const dimensions = await run(`['${singleLive}', '${publicFixture}'].map(selector => {
      const row = document.querySelector(selector + ' .tool-call-summary')
      const style = getComputedStyle(row)
      return { height: row.getBoundingClientRect().height, fontSize: style.fontSize,
        tracks: style.gridTemplateColumns, icon: row.querySelector('.tool-call-icon').dataset.iconDomain }
    })`)
    for (const row of dimensions) {
      assert.equal(row.height, 28)
      assert.equal(row.fontSize, '11.5px')
      assert.equal(row.icon, 'terminal')
      assert.match(row.tracks, /^16px [\d.]+px 20px$/)
    }
    state = await phase('continuation')
    assert.match(state.liveGroupLabel, /已完成 1 个步骤/)
    assert.doesNotMatch(state.liveText + state.publicText, /Thinking|思考中|准备中|启动中/)
    assert.deepEqual(await run('window.feedbackOverlaps'), [])
    await run('window.feedbackObserver.disconnect()')
    assert.equal(await run(`document.querySelector('${singleLive} .tool-group-state[role]') !== null`), false)
    assert.equal(await run(`document.querySelector('${singleLive} .tool-call-result-scroll').scrollTop > 0`), true)
    assert.equal(await run('Object.values(window.fixtureNodes).every(node => node.isConnected && node.open)'), true)
    assert.equal(state.resultRequests, 2)
    const nightRunning = await capture('single-chat-night-continuation-1180x800')

    state = await phase('complete')
    assert.equal(state.liveOpen, null)
    assert.equal(state.publicOpen, false)
    assert.match(state.publicText, /工作了 26 秒/)
    assert.equal(await run("[...document.querySelectorAll('.single-chat-run-history')].at(-1).open"), false)
    assert.equal(await run("[...document.querySelectorAll('.single-chat-final')].at(-1).getBoundingClientRect().height > 0"), true)
    assert.equal(await run('Object.values(window.fixtureNodes).every(node => node.isConnected && node.open)'), true)
    const nightComplete = await capture('single-chat-night-complete-1180x800')
    await run("[...document.querySelectorAll('.single-chat-run-history > summary')].at(-1).click()")
    state = await settle()
    assert.equal(state.resultRequests, 2)

    state = await phase('waiting')
    assert.match(state.liveGroupLabel, /等待审批/)
    assert.doesNotMatch(state.liveText, /Thinking|思考中|准备中|启动中/)
    state = await phase('failed')
    assert.equal(state.liveOpen, null)
    assert.match(state.body, /运行 26 秒后失败/)
    assert.equal(await run("document.querySelectorAll('.single-chat-final').length"), 1)
    state = await phase('running')

    state = await click('.single-chat-composer .composer-primary-action.is-stop')
    assert.equal(state.cancelRequests, 1)
    assert.match(state.body, /你在 3 分 12 秒后停止了运行/)
    assert.match(state.body, /单聊正文不会进入公屏/)

    window.webContents.debugger.attach('1.3')
    await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: 1040, height: 700, deviceScaleFactor: 1, mobile: false
    })
    state = await settle()
    assert.equal(state.pageOverflow, false)
    assert.ok(state.panel.right <= 1040 && state.panel.bottom <= 700)
    const compact = await capture('single-chat-night-compact-1040x700')

    // Notification navigation reads an exact existing conversation, never creating its successor.
    const opensBeforeNotification = state.openRequests
    await run("window.singleChatTest.notification('missing-ended-conversation')")
    await waitFor("window.singleChatTest.state().body.includes('原单聊已结束或来源不可用')")
    assert.equal((await settle()).openRequests, opensBeforeNotification)
    window.webContents.focus()
    await run("window.singleChatTest.notification('single-chat-fixture-conversation')")
    await waitFor('window.singleChatTest.state().notificationPresentations.length === 1')
    state = await settle()
    assert.equal(state.notificationFocusedRun, 'run-complete')
    assert.equal(state.openRequests, opensBeforeNotification)
    assert.equal(state.notificationGets.at(-1).conversationId, 'single-chat-fixture-conversation')

    console.log(JSON.stringify({
      ok: true,
      verified: {
        selectorTriggerAndOptionAvatars: true,
        transcriptAvatarFree: true,
        rightUserLeftAgentLayout: true,
        chineseTerminalDuration: true,
        terminalExecutionAutoCollapse: true,
        groupedCommands: 3,
        thinkingLifecycle: true,
        sendAcknowledgementAndRejection: true,
        sharedToolRows: true,
        liveTailAndNarrationBoundary: true,
        resultRetryKeyboardAndPersistence: true,
        consoleTerminalAutoCollapse: true,
        waitingAndFailureStates: true,
        finalMessageExpanded: true,
        directEndConfirmation: true,
        campComposerParity: true,
        composerKeyboardSemantics: true,
        privateAttachments: true,
        privateAttachmentDragBoundary: true,
        agentMessagesWithoutFill: true,
        runningStopAndQueueComposer: true,
        dayAndNight: true,
        compactNoOverflow: true
      },
      captures: { dayDrop, dayMenu, dayDialog, dayQueued, dayTools, nightRunning, nightComplete, compact }
    }))
    window.destroy()
    app.quit()
  } catch (error) {
    console.error(await settle())
    await capture('single-chat-failure')
    throw error
  }
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
