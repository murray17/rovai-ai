const assert = require('node:assert/strict')
const { mkdirSync } = require('node:fs')
const { createServer } = require('node:http')
const { isAbsolute, join } = require('node:path')
const { app, BrowserWindow, shell } = require('electron')

const [renderer, userData, linkHandlerPath] = process.argv.slice(2)
const { webLinkWindowHandler } = require(linkHandlerPath)
assert.ok(isAbsolute(renderer) && isAbsolute(userData), 'The Composer test requires isolated absolute paths')
mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)
app.setPath('sessionData', join(userData, 'session'))

app.whenReady().then(async () => {
  const startedAt = Date.now()
  const trace = message => console.error(`[${Date.now() - startedAt}ms] ${message}`)
  const window = new BrowserWindow({
    show: process.platform === 'linux',
    width: 1000,
    height: 700,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })

  const webOpens = []
  const launchFailures = []
  let systemBrowserTarget = null
  window.webContents.setWindowOpenHandler(webLinkWindowHandler(async url => {
    webOpens.push(url)
    if (url === systemBrowserTarget) await shell.openExternal(url)
  }, async () => { launchFailures.push(systemBrowserTarget) }))

  async function complete(promise, operation) {
    let timeout
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`Composer fixture timed out: ${operation}`)),
            7_000
          )
        })
      ])
    } finally {
      clearTimeout(timeout)
    }
  }

  const evaluate = source => complete(window.webContents.executeJavaScript(source, true), source)
  const frames = () => evaluate(
    'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
  )
  const command = (method, params) => complete(
    window.webContents.debugger.sendCommand(method, params),
    `${method} ${JSON.stringify(params)}`
  )
  const cases = []
  const failures = []
  const firstMention = { kind: 'atom', atom: { type: 'member', agentId: 'agent-a' } }
  const secondMention = { kind: 'atom', atom: { type: 'member', agentId: 'agent-b' } }

  async function reset(value) {
    await evaluate(`window.composerTest.reset(${JSON.stringify(value)})`)
    await frames()
  }

  async function resetMentionPair(gap = ' ') {
    await reset({ version: 2, segments: [
      firstMention, ...(gap ? [{ kind: 'text', text: gap }] : []), secondMention, { kind: 'text', text: ' ' }
    ] })
    await evaluate(`window.composerTest.setMembers([
      { agentId: 'agent-a', displayName: '队员甲', mentionable: true },
      { agentId: 'agent-b', displayName: '队员乙', mentionable: true }
    ])`)
    await frames()
  }

  async function selectLastMention() {
    await key('ArrowLeft', 37)
    await key('ArrowLeft', 37)
    const selected = await state(false)
    assert.equal(selected.selectionKind, 'node')
    assert.equal(selected.caret.color, 'rgba(0, 0, 0, 0)', 'NodeSelection must not show a stale text caret')
  }

  async function expectEditableCaret() {
    const current = await state(false)
    assert.equal(current.focused, true)
    assert.equal(current.selectionKind, 'range')
    assert.equal(current.caret.count, 1)
    assert.equal(current.caret.collapsed, true)
    assert.equal(current.caret.insideEditor, true)
    assert.equal(current.caret.insideAtom, false)
    assert.notEqual(current.caret.color, 'rgba(0, 0, 0, 0)')
  }

  async function insert(text) {
    await command('Input.insertText', { text })
    await frames()
  }

  async function key(key, windowsVirtualKeyCode, modifiers = 0, code = key) {
    const event = { key, code, windowsVirtualKeyCode, modifiers }
    await command('Input.dispatchKeyEvent', { type: 'keyDown', ...event })
    await command('Input.dispatchKeyEvent', { type: 'keyUp', ...event })
    await frames()
  }

  async function state(flush = true) {
    const current = await evaluate(`window.composerTest.state(${flush})`)
    assert.deepEqual(current.errors, [], 'Composer must not throw or blank the Renderer')
    return current
  }

  async function expectSegments(expected) {
    const current = await state(true)
    assert.deepEqual(current.content, { version: 2, segments: expected })
    return current
  }

  async function run(name, callback) {
    trace(`Composer fixture: ${name}`)
    try {
      await callback()
      cases.push(name)
    } catch (error) {
      failures.push({ name, message: error.stack ?? error.message })
    }
  }

  try {
    await window.loadFile(renderer)
    window.webContents.debugger.attach('1.3')
    await command('Emulation.setFocusEmulationEnabled', { enabled: true })
    await frames()


    const webState = () => evaluate('window.composerTest.webState()')
    const settleLinks = () => evaluate('new Promise(resolve => setTimeout(resolve, 180))')
    const primary = process.platform === 'darwin' ? 4 : 2
    const mouse = async (point, modifiers = 0, clickCount = 1) => {
      await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount, modifiers })
      await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount, modifiers })
      await frames()
    }
    const clickText = async (text, selector = '#composer', modifiers = 0) =>
      mouse(await evaluate('window.composerTest.webPoint(' + JSON.stringify(text) + ', 2,' + JSON.stringify(selector) + ')'), modifiers)
    const button = async (label) => {
      const point = await evaluate('(() => { const b = [...document.querySelectorAll(".composer-web-link-actions button")].find(b => b.textContent === ' + JSON.stringify(label) + '); const r = b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()')
      await mouse(point)
    }
    if (process.env.ROVAI_TEST_SYSTEM_BROWSER === '1') await run('desktop click launches the system browser through the production window handler', async () => {
      let resolveRequest
      const received = new Promise(resolve => { resolveRequest = resolve })
      const server = createServer((request, response) => {
        response.setHeader('Content-Type', 'text/html; charset=utf-8')
        response.end('<title>Rovai link verification</title><p>Desktop link opened successfully.</p>')
        if (request.url.startsWith('/opened?')) resolveRequest(request.url)
      })
      try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
        systemBrowserTarget = 'http://127.0.0.1:' + server.address().port + '/opened?x=1&y=2#part'
        await reset(systemBrowserTarget)
        const before = webOpens.length
        await clickText(systemBrowserTarget)
        await button('打开链接')
        assert.equal(await complete(received, 'system browser request'), '/opened?x=1&y=2')
        assert.equal(webOpens.length, before + 1)
        assert.equal(webOpens.at(-1), systemBrowserTarget)
        assert.deepEqual(launchFailures, [])
        trace('System browser opened ' + systemBrowserTarget)
      } finally {
        systemBrowserTarget = null
        server.closeAllConnections()
        await new Promise(resolve => server.close(resolve))
      }
    })
    await run('web-link display, popup, copy and open preserve draft versions and selection', async () => {
      const url = 'http://localhost:8766/a?x=1&y=2#part'
      await reset('前 ' + url + ' 后')
      const before = await state(false)
      const opened = webOpens.length
      await settleLinks()
      assert.deepEqual((await webState()).highlights, [url])
      await clickText(url)
      assert.equal((await webState()).popup, url)
      assert.equal((await state(false)).focused, true)
      assert.equal((await state(false)).caret.collapsed, true)
      await button('复制链接')
      assert.equal((await webState()).copied.at(-1), url)
      await button('打开链接')
      assert.equal(webOpens.length, opened + 1)
      assert.equal(webOpens.at(-1), url)
      const after = await state(false)
      assert.equal(after.localVersion, before.localVersion)
      assert.equal(after.saveCount, before.saveCount)
      assert.equal(after.linkCount, 0)
      await key('Escape', 27)
      assert.equal((await webState()).popup, null)
      await clickText(url, '#composer', primary)
      assert.equal(webOpens.length, opened + 2)
    })
    await run('native code/Atom exclusions and cross-link user quotes preserve literal source', async () => {
      const url = 'http://localhost:8766/a'
      await reset('~~~txt\n' + url + '\n~~~\n\u0060' + url + '\u0060\n' + url)
      await settleLinks()
      assert.deepEqual((await webState()).highlights, [url])
      await evaluate('window.composerTest.selectText(' + JSON.stringify(url) + ',' + url.length + ')')
      await insert('extra')
      await settleLinks()
      assert.deepEqual((await webState()).highlights, [url])
      await reset({version:2, segments:[{kind:'atom',atom:{type:'member',agentId:'agent-a'}},{kind:'text',text:' ' + url}]})
      await evaluate('window.composerTest.renameMember("http://hidden-label")')
      await settleLinks()
      assert.deepEqual((await webState()).highlights, [url])
      const from = await evaluate('window.composerTest.webPoint("前 [标题](", 0, "#web-user")')
      const to = await evaluate('window.composerTest.webPoint(") 后", 2, "#web-user")')
      const before = webOpens.length
      window.webContents.sendInputEvent({type:'mouseMove',x:Math.round(from.x),y:Math.round(from.y)})
      window.webContents.sendInputEvent({type:'mouseDown',x:Math.round(from.x),y:Math.round(from.y),button:'left',clickCount:1})
      for (let step=1;step<=8;step++) {
        window.webContents.sendInputEvent({type:'mouseMove',x:Math.round(from.x+(to.x-from.x)*step/8),y:Math.round(to.y),button:'left',modifiers:['leftButtonDown']})
        await new Promise(resolve=>setTimeout(resolve,16))
      }
      window.webContents.sendInputEvent({type:'mouseUp',x:Math.round(to.x),y:Math.round(to.y),button:'left',clickCount:1})
      await frames()
      const quote = await evaluate('window.composerTest.quoteWebSelection()')
      assert.ok(quote, JSON.stringify(await evaluate('({selected:window.getSelection().toString(), anchor:window.getSelection().anchorNode?.parentElement?.outerHTML,focus:window.getSelection().focusNode?.parentElement?.outerHTML,body:document.querySelector("#web-user").outerHTML})')))
      const selected = await evaluate('window.getSelection().toString()')
      assert.equal(quote.text, selected)
      assert.deepEqual(Object.keys(quote).sort(), ['messageId', 'text'])
      assert.equal(webOpens.length, before)
      for (const result of await evaluate('window.composerTest.comparePartialWebQuotes()')) {
        assert.deepEqual(result.linked, result.plain)
        assert.equal(result.linked.text, result.expected, 'Unselected URL characters and Markdown symbols must stay out of quotes')
      }
      await clickText(url, '#web-agent')
      assert.equal(webOpens.length, before + 1)
      await evaluate('document.querySelector("#web-user a").focus()')
      await key('Enter', 13)
      assert.equal(webOpens.length, before + 2)
    })
    await run('URL edit, undo/redo, saved draft restore, send and historical open stay literal', async () => {
      const first = 'http://localhost:8766/old?q=1#part'
      const second = 'http://localhost:8766/new?q=1#part'
      await reset('')
      await insert(first)
      await state(true)
      await evaluate('window.composerTest.selectText("old",0,3)')
      await insert('new')
      await clickText(second)
      const edited = await state(false)
      await button('复制链接')
      assert.equal((await state(false)).localVersion, edited.localVersion)
      await key('z', 90, primary, 'KeyZ')
      assert.equal((await state()).text, first)
      await key('z', 90, primary | 8, 'KeyZ')
      assert.equal((await state()).text, second)
      await evaluate('window.composerTest.restoreSaved()')
      await frames()
      assert.equal((await state()).text, second)
      await evaluate('window.composerTest.captureNextSend(); window.composerTest.focusEnd()')
      await key('Enter', 13)
      await frames()
      assert.deepEqual((await webState()).sent, {version:2,segments:[{kind:'text',text:second}]})
      const before = webOpens.length
      await clickText(second, '#web-history')
      assert.equal(webOpens.length, before + 1)
      assert.equal(webOpens.at(-1), second)
    })
    await run('composition, dragging and thread changes close the URL popup without stale targets', async () => {
      const url = 'https://example.com/a'
      await reset(url)
      await clickText(url)
      await command('Input.imeSetComposition', { text:'中', selectionStart:1, selectionEnd:1 })
      assert.equal((await webState()).popup, null)
      await insert('中文')
      await reset(url)
      await clickText(url)
      await evaluate('window.composerTest.switchDraft("另一个会话")')
      await frames()
      assert.equal((await webState()).popup, null)
      const before = webOpens.length
      await reset(url)
      const from = await evaluate('window.composerTest.webPoint(' + JSON.stringify(url) + ',1)')
      const to = await evaluate('window.composerTest.webPoint(' + JSON.stringify(url) + ',12)')
      await command('Input.dispatchMouseEvent', {type:'mousePressed',...from,button:'left',clickCount:1})
      await command('Input.dispatchMouseEvent', {type:'mouseMoved',...to,button:'left',buttons:1})
      await command('Input.dispatchMouseEvent', {type:'mouseReleased',...to,button:'left',clickCount:1})
      await frames()
      assert.equal((await webState()).popup, null)
      assert.equal(webOpens.length, before)
    })
    await run('unsupported range highlighting retains URL operations', async () => {
      await evaluate('window.fixtureHighlights = CSS.highlights; CSS.highlights.delete("rovai-composer-web-link"); Object.defineProperty(CSS,"highlights",{configurable:true,value:undefined}); true')
      try {
        const url = 'http://localhost:8766/fallback'
        await reset(url)
        const before = webOpens.length
        await clickText(url)
        assert.equal((await webState()).popup, url)
        await button('打开链接')
        assert.equal(webOpens.length, before + 1)
        await clickText(url, '#composer', primary)
        assert.equal(webOpens.length, before + 2)
      } finally {
        await evaluate('Object.defineProperty(CSS,"highlights",{configurable:true,value:window.fixtureHighlights}); true')
      }
    })


    await run('same-node edits keep existing links through the first frame before settled projection', async () => {
      const url = 'https://example.com/a'
      await reset('prefix ' + url + ' trailing')
      await settleLinks()
      for (const [before, after] of [['trailing', 'trailing edited'], ['prefix', 'longer prefix'],
        ['longer prefix ', ''], ['trailing edited', '中文说明']]) {
        const observed = await evaluate(`(async () => {
          const range = CSS.highlights.get('rovai-composer-web-link').values().next().value;
          window.composerTest.replaceText(${JSON.stringify(before)}, ${JSON.stringify(after)});
          const immediate = range.toString();
          await new Promise(requestAnimationFrame);
          return { immediate, firstFrame: range.toString(), retained: CSS.highlights.get('rovai-composer-web-link').has(range),
            offset: range.startOffset, expectedOffset: range.startContainer.textContent.indexOf(${JSON.stringify(url)}) };
        })()`)
        assert.equal(observed.immediate, url)
        assert.equal(observed.firstFrame, url)
        assert.equal(observed.retained, true)
        assert.equal(observed.offset, observed.expectedOffset)
      }
      const edited = await state(true)
      await settleLinks()
      assert.equal((await state(false)).localVersion, edited.localVersion)
      assert.equal((await state(false)).saveCount, edited.saveCount)
    })

    await run('repeated URLs retain both ranges when shifted onto previous offsets', async () => {
      const url = 'https://example.com/a'
      await reset(url + ' ' + url + ' tail')
      await settleLinks()
      const observed = await evaluate(`(async () => {
        const original = [...CSS.highlights.get('rovai-composer-web-link')];
        window.composerTest.replaceText(${JSON.stringify(url)}, ${JSON.stringify('x'.repeat(url.length) + ' ' + url)});
        const immediate = original.map(range => range.toString());
        await new Promise(resolve => setTimeout(resolve, 180));
        const current = [...CSS.highlights.get('rovai-composer-web-link')];
        return { immediate, retained: original.every(range => current.includes(range)), count: current.length };
      })()`)
      assert.deepEqual(observed.immediate, [url, url])
      assert.equal(observed.retained, true)
      assert.equal(observed.count, 2)
      await reset('')
      assert.deepEqual((await webState()).highlights, [], 'Removed nodes release all owned ranges')
    })

    await run('native typing and IME preserve unaffected links on every sampled frame in both themes', async () => {
      const url = 'https://example.com/a'
      for (const theme of ['day', 'night']) {
        await evaluate('document.documentElement.dataset.theme=' + JSON.stringify(theme))
        await reset('prefix ' + url + ' tail ')
        await settleLinks()
        await evaluate(`window.linkFrames = []; window.recordLinkFrames = true;
          requestAnimationFrame(function record() {
            window.linkFrames.push(window.composerTest.webState().highlights);
            if (window.recordLinkFrames) requestAnimationFrame(record);
          }); true`)
        try {
          for (const character of 'abcdef') await insert(character)
          for (const composition of ['zh', '中文', '中文输入']) {
            await command('Input.imeSetComposition', { text:composition, selectionStart:composition.length, selectionEnd:composition.length })
            await frames()
          }
          await insert('中文输入')
          await evaluate('window.composerTest.selectText("prefix",0)')
          for (const composition of ['qian', '前面']) {
            await command('Input.imeSetComposition', { text:composition, selectionStart:composition.length, selectionEnd:composition.length })
            await frames()
          }
          await insert('前面')
        } finally { await evaluate('window.recordLinkFrames = false; true') }
        const sampled = await evaluate('window.linkFrames')
        assert.ok(sampled.length >= 10)
        for (const highlights of sampled) assert.deepEqual(highlights, [url], theme + ': existing link survives each input frame')
        assert.equal((await state()).submitCount, 0)
      }
    })

    await run('URL edits invalidate only affected links and gestures revalidate targets immediately', async () => {
      const first = 'https://example.com/a', edited = 'https://example.com/b', second = 'https://other.example/path'
      await reset(first + ' gap ' + second + ' tail')
      await settleLinks()
      const immediate = await evaluate('window.composerTest.replaceText(' + JSON.stringify(first) + ',' + JSON.stringify(edited) + '); window.composerTest.webState().highlights')
      assert.deepEqual(immediate, [second])
      await clickText(edited)
      assert.equal((await webState()).popup, edited)
      await button('复制链接')
      assert.equal((await webState()).copied.at(-1), edited)
      await evaluate('window.composerTest.selectText(' + JSON.stringify(edited) + ',' + edited.length + ')')
      await insert('x')
      assert.deepEqual((await webState()).highlights, [second], 'URL-tail insertion waits for semantic recognition')
      await settleLinks()
      assert.deepEqual((await webState()).highlights.sort(), [edited + 'x', second].sort())
      await evaluate('window.composerTest.switchDraft("fresh draft")')
      await frames()
      assert.deepEqual((await webState()).highlights, [], 'Switching drafts releases old display caches')
    })

    await run('node splits, merges and cross-line Markdown fall back to settled recognition', async () => {
      const url = 'https://example.com/a'
      await reset('prefix ' + url + ' tail')
      await settleLinks()
      await evaluate('window.composerTest.selectText(' + JSON.stringify(url) + ',0)')
      await key('Enter', 13, 8)
      await settleLinks()
      assert.deepEqual((await webState()).highlights, [url])
      await key('Backspace', 8)
      await settleLinks()
      assert.deepEqual((await webState()).highlights, [url])
      await reset('before\n' + url + '\nafter')
      await settleLinks()
      await evaluate('window.composerTest.selectText("before",0)')
      await evaluate('window.composerTest.paste(' + JSON.stringify('```\n') + ')')
      await frames()
      assert.equal((await state()).text, '```\nbefore\n' + url + '\nafter')
      await settleLinks()
      assert.deepEqual((await webState()).highlights, [])
      await key('z', 90, primary, 'KeyZ')
      await settleLinks()
      assert.deepEqual((await webState()).highlights, [url])
    })

    await run('ordinary long-draft edits retain unrelated ranges and multiline Markdown targets', async () => {
      const lines = Array.from({length:800},(_,index)=>'line ' + index + ' https://example.com/' + index)
      await reset(lines.join('\n'))
      await settleLinks()
      await evaluate('window.firstLinkRange=CSS.highlights.get("rovai-composer-web-link").values().next().value; true')
      await evaluate('window.composerTest.focusEnd()')
      const started = Date.now()
      await insert('changed')
      assert.ok(Date.now()-started<1000,'A single edit in a long draft must remain responsive')
      await settleLinks()
      assert.equal(await evaluate('CSS.highlights.get("rovai-composer-web-link").has(window.firstLinkRange)'),true,'Unchanged URL ranges are retained')
      assert.equal((await webState()).highlights.length,800)
      const target = 'https://example.com/?q=中文，参数'
      await reset('[标题](\n' + target + '\n)')
      await evaluate('window.composerTest.selectText(' + JSON.stringify(target) + ','+target.length+')')
      await insert('新')
      await settleLinks()
      assert.deepEqual((await webState()).highlights,[target+'新'])
      await clickText(target+'新')
      assert.equal((await webState()).popup,target+'新')
    })

    await run('restored paragraph indentation keeps the same links after edits and another restore', async () => {
      const url = 'https://example.com/a'
      const source = '说明\n    ' + url
      await reset('')
      await insert(source)
      await state(true)
      await evaluate('window.composerTest.restoreSaved()')
      await settleLinks()
      assert.deepEqual((await webState()).highlights, [url])
      await evaluate('window.composerTest.focusEnd()')
      await insert('x')
      const edited = await state(true)
      await settleLinks()
      assert.deepEqual((await webState()).highlights, [url + 'x'])
      assert.equal((await state(false)).localVersion, edited.localVersion)
      assert.equal((await state(false)).saveCount, edited.saveCount)
      await clickText(url + 'x')
      assert.equal((await webState()).popup, url + 'x')
      await evaluate('window.composerTest.restoreSaved()')
      await settleLinks()
      assert.equal((await state()).text, source + 'x')
      assert.deepEqual((await webState()).highlights, [url + 'x'])
      // Changing the paragraph boundary must also invalidate the later URL.
      await evaluate('window.composerTest.selectText("说明",2)')
      await insert('\n')
      await settleLinks()
      assert.deepEqual((await webState()).highlights, [])
      await key('z', 90, primary, 'KeyZ')
      await settleLinks()
      assert.deepEqual((await webState()).highlights, [url + 'x'])
    })

    for (const [name, source] of [
      ['long single line', 'ordinary text '.repeat(8000) + 'https://example.com/end edit here '],
      ['Markdown symbol burst', Array.from({length:800},(_,i)=>'line '+i+' https://example.com/'+i).join('\n') + '\nedit here ']
    ]) await run(name + ' defers and coalesces URL projection outside typing', async () => {
      await reset(source)
      await settleLinks()
      await evaluate('window.composerTest.focusEnd(); window.linkPaints=0; window.originalHighlightSet=CSS.highlights.set; CSS.highlights.set=function(...args){window.linkPaints++; return window.originalHighlightSet.apply(this,args)}; true')
      const timings = []
      try {
        for (const character of '([])\\*') {
          const started = Date.now()
          await insert(character)
          timings.push(Date.now() - started)
        }
        assert.equal(await evaluate('window.linkPaints'),0,'Continuous typing must not parse or repaint the whole draft on each key')
        const edited = await state(false)
        await settleLinks()
        assert.equal(await evaluate('window.linkPaints'),1,'One settled projection for the editing burst')
        assert.equal((await state(false)).localVersion,edited.localVersion)
        assert.ok(Math.max(...timings)<250,'Native insert plus two frames must remain responsive: '+timings)
        assert.equal((await state()).text, source + '([])\\*')
        trace('Link timing '+JSON.stringify({name,characters:source.length,inputAndFramesMs:timings}))
      } finally { await evaluate('CSS.highlights.set=window.originalHighlightSet; true') }
    })

    await run('ordinary typing stays local to the same Lexical host', async () => {
      await reset('')
      await evaluate('window.composerTest.captureEditor()')
      await insert('本地输入')
      const current = await expectSegments([{ kind: 'text', text: '本地输入' }])
      assert.equal(current.sameEditor, true)
      assert.equal(current.focused, true)
    })

    await run('Markdown-looking input remains plain text', async () => {
      const markdown = '# title\n**bold**\n- list\n[link](url)'
      await reset('')
      await evaluate(`window.composerTest.paste(${JSON.stringify(markdown)})`)
      await frames()
      const current = await expectSegments([{ kind: 'text', text: markdown }])
      assert.equal(current.headingCount, 0)
      assert.equal(current.boldCount, 0)
      assert.equal(current.listCount, 0)
      assert.equal(current.linkCount, 0)
    })

    await run('Shift Enter creates one domain newline inside one Paragraph', async () => {
      await reset('第一行')
      await key('Enter', 13, 8)
      await insert('第二行')
      const current = await expectSegments([{ kind: 'text', text: '第一行\n第二行' }])
      assert.equal(current.paragraphCount, 1)
      assert.equal(current.lineBreakCount, 1)
    })

    await run('IME composition commits CJK text without submitting', async () => {
      await reset('')
      await command('Input.imeSetComposition', {
        text: 'ni', selectionStart: 2, selectionEnd: 2
      })
      await insert('你')
      const current = await expectSegments([{ kind: 'text', text: '你' }])
      assert.equal(current.submitCount, 0)
    })

    await run('Member Typeahead replaces only the local query with one Atom', async () => {
      await reset('请 ')
      await insert('@甲')
      const open = await state(false)
      assert.equal(open.menuKind, 'mention')
      assert.ok(open.options.some((option) => option.endsWith('\n队员甲\n系统架构师')), JSON.stringify(open))
      await key('Enter', 13)
      const current = await expectSegments([
        { kind: 'text', text: '请 ' },
        { kind: 'atom', atom: { type: 'member', agentId: 'agent-a', labelFallback: '队员甲' } },
        { kind: 'text', text: ' ' }
      ])
      assert.deepEqual(current.atomTypes, ['member'])
    })

    await run('invite layer inserts an outsider Atom without changing the draft until selection', async () => {
      await reset('')
      await evaluate('window.composerTest.includeOutsideMember()')
      await frames()
      await insert('@')
      const root = await state(false)
      assert.equal(root.menuKind, 'mention')
      assert.ok(root.options.some((option) => option.includes('邀请其他队员')), JSON.stringify(root))
      await key('ArrowDown', 40)
      await key('ArrowDown', 40)
      await key('Enter', 13)
      const layer = await state(false)
      assert.ok(layer.options.some((option) => option.includes('返回本会话')), JSON.stringify(layer))
      assert.deepEqual(layer.atomTypes, [])
      assert.deepEqual(layer.localStatus.memberAgentIds, [])
      await key('ArrowDown', 40)
      await key('Enter', 13)
      const selected = await expectSegments([
        { kind: 'atom', atom: { type: 'member', agentId: 'agent-outside', labelFallback: '爱丽丝' } },
        { kind: 'text', text: ' ' }
      ])
      assert.deepEqual(selected.localStatus.memberAgentIds, ['agent-outside'])
      assert.equal(selected.submitCount, 0)
    })

    await run('repeated outsider mentions remain in text while the last deletion clears pending identity', async () => {
      const atom = { kind: 'atom', atom: { type: 'member', agentId: 'agent-outside', labelFallback: '爱丽丝' } }
      await reset({ version: 2, segments: [atom, atom] })
      await evaluate('window.composerTest.includeOutsideMember()')
      await frames()
      assert.deepEqual((await state(false)).localStatus.memberAgentIds, ['agent-outside'])
      await key('Backspace', 8)
      const one = await state(true)
      assert.deepEqual(one.atomTypes, ['member'])
      assert.deepEqual(one.localStatus.memberAgentIds, ['agent-outside'])
      await key('Backspace', 8)
      const none = await expectSegments([])
      assert.deepEqual(none.localStatus.memberAgentIds, [])
    })

    await run('All Members Typeahead creates the broadcast Atom', async () => {
      await reset('')
      await insert('@所有')
      await key('Enter', 13)
      const current = await expectSegments([
        { kind: 'atom', atom: { type: 'all_members' } },
        { kind: 'text', text: ' ' }
      ])
      assert.equal(current.localStatus.hasExplicitRecipient, true)
    })

    await run('Skill Typeahead stores skillId and nameAtSend', async () => {
      await reset('')
      await insert('/')
      await key('ArrowUp', 38)
      const keyboard = await state(true)
      assert.equal(keyboard.activeOption, keyboard.options.at(-1), JSON.stringify(keyboard))
      assert.ok(keyboard.menuOverflows && keyboard.menuScrollTop > 0, JSON.stringify(keyboard))
      assert.ok(keyboard.activeVisible && keyboard.activeDescendantMatches, JSON.stringify(keyboard))
      await key('Escape', 27)
      await reset('请 ')
      await insert('/work')
      const open = await state(false)
      assert.equal(open.menuKind, 'skill', JSON.stringify(open))
      assert.deepEqual(open.options, ['worktree'])
      await key('Enter', 13)
      await expectSegments([
        { kind: 'text', text: '请 ' },
        {
          kind: 'atom',
          atom: { type: 'skill', skillId: 'skill-worktree', nameAtSend: 'worktree' }
        },
        { kind: 'text', text: ' ' }
      ])
    })

    await run('Typeahead consumes Enter synchronously while the Skill Catalog is loading', async () => {
      await reset('请 ')
      await insert('/work')
      await evaluate("window.composerTest.setSkillCatalogStatus('loading')")
      await frames()
      await key('Enter', 13)
      const loading = await state(false)
      assert.equal(loading.submitCount, 0)
      assert.deepEqual(loading.atomTypes, [])
      assert.equal(loading.text, '请 /work')

      await evaluate("window.composerTest.setSkillCatalogStatus('ready')")
      await frames()
      await key('Enter', 13)
      assert.deepEqual((await state(true)).atomTypes, ['skill'])
    })

    await run('Shift Enter keeps Typeahead text and inserts a plain line break', async () => {
      await reset('请 ')
      await insert('@甲')
      await key('Enter', 13, 8)
      const current = await expectSegments([{ kind: 'text', text: '请 @甲\n' }])
      assert.equal(current.submitCount, 0)
      assert.deepEqual(current.atomTypes, [])
    })

    await run('imperative interaction lock blocks edits before a React render', async () => {
      await reset('')
      await evaluate('window.composerTest.setInteractionLocked(true)')
      assert.equal((await state(false)).disabled, true)
      await insert('不得写入')
      assert.deepEqual((await state(true)).content, { version: 2, segments: [] })

      await evaluate('window.composerTest.setInteractionLocked(false)')
      await insert('可以写入')
      await expectSegments([{ kind: 'text', text: '可以写入' }])
    })

    await run('Skill trigger rejects URLs, paths and ordinary word suffixes', async () => {
      for (const text of [
        'https://example.com/a/work',
        'src/components/a/work',
        'ordinary/work'
      ]) {
        await reset(text)
        assert.equal((await state(false)).menuKind, null, text)
      }
      await reset('请，')
      await insert('/work')
      const allowed = await state(false)
      assert.equal(allowed.menuKind, 'skill', JSON.stringify(allowed))
    })

    await run('Typeahead query scanning stops at the 128 character limit', async () => {
      await reset(' ')
      await insert(`/${'a'.repeat(129)}`)
      assert.equal((await state(false)).menuKind, null)
    })

    await run('Atom insertion reuses existing right-side whitespace', async () => {
      await reset('请 /work 后续')
      await evaluate('window.composerTest.selectText("/work", 5)')
      await frames()
      const open = await state(false)
      assert.equal(open.menuKind, 'skill', JSON.stringify(open))
      await key('Enter', 13)
      await expectSegments([
        { kind: 'text', text: '请 ' },
        {
          kind: 'atom',
          atom: { type: 'skill', skillId: 'skill-worktree', nameAtSend: 'worktree' }
        },
        { kind: 'text', text: ' 后续' }
      ])
    })

    await run('Backspace deletes an inline Decorator Atom as one unit', async () => {
      await reset({
        version: 2,
        segments: [{ kind: 'atom', atom: { type: 'member', agentId: 'agent-a' } }]
      })
      await key('Backspace', 8)
      const current = await expectSegments([])
      assert.deepEqual(current.atomTypes, [])
    })

    await run('arrow navigation restores the caret between consecutive mentions in both directions', async () => {
      for (const gap of [' ', '']) {
        await resetMentionPair(gap)
        await selectLastMention()
        const highlighted = await evaluate(`getComputedStyle(document.querySelectorAll('[data-composer-atom]')[1]).backgroundColor`)
        assert.notEqual(highlighted, 'rgba(0, 0, 0, 0)', 'Keyboard-selected Atom must be visible')
        await key('ArrowLeft', 37)
        await expectEditableCaret()
        const navigated = await state(false)
        assert.equal(navigated.localVersion, 0, 'Moving the caret must not edit the draft')
        assert.equal(navigated.dirty, false)
        await insert('中间')
        await expectSegments([firstMention, { kind: 'text', text: `${gap}中间` }, secondMention, { kind: 'text', text: ' ' }])

        await resetMentionPair(gap)
        await evaluate('window.composerTest.focusStart()')
        await key('ArrowRight', 39)
        assert.equal((await state(false)).selectionKind, 'node')
        await key('ArrowRight', 39)
        await expectEditableCaret()
        await insert('中间')
        await expectSegments([firstMention, { kind: 'text', text: `中间${gap}` }, secondMention, { kind: 'text', text: ' ' }])
      }
    })

    await run('clicking the gap between mentions restores an editable caret after Atom selection', async () => {
      await resetMentionPair()
      await selectLastMention()
      const point = await evaluate(`(() => {
        const atoms = document.querySelectorAll('[data-composer-atom]')
        const a = atoms[0].getBoundingClientRect()
        const b = atoms[1].getBoundingClientRect()
        return { x: (a.right + b.left) / 2, y: (a.top + a.bottom) / 2 }
      })()`)
      await command('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
      await command('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
      await frames()
      await expectEditableCaret()
      await insert('点击')
      const current = await state(true)
      assert.deepEqual(current.content.segments.filter(segment => segment.kind === 'atom'), [firstMention, secondMention])
      assert.equal(current.content.segments[1].text.trim(), '点击')
      assert.equal(current.activatedAtom, null, 'Clicking the gap must not activate a member')
    })

    await run('keyboard-selected mentions support deletion, text, IME and paste replacement', async () => {
      const actions = [
        { name: 'Backspace', text: '', run: () => key('Backspace', 8) },
        { name: 'Delete', text: '', run: () => key('Delete', 46) },
        { name: 'typing', text: '替换', run: () => insert('替换') },
        { name: 'IME', text: '你', run: async () => {
          await command('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 })
          await insert('你')
        } },
        { name: 'paste', text: '粘贴', run: () => evaluate('window.composerTest.paste("粘贴")') },
        { name: 'Shift Enter', text: '\n', run: () => key('Enter', 13, 8) }
      ]
      for (const action of actions) {
        await resetMentionPair()
        await selectLastMention()
        const copied = await evaluate('window.composerTest.copySelection()')
        assert.equal(copied.plain, '@队员乙', action.name)
        await action.run()
        await frames()
        await expectSegments([firstMention, { kind: 'text', text: ` ${action.text} ` }])
        await expectEditableCaret()
        assert.equal((await state(false)).submitCount, 0)
      }
    })

    await run('Shift Arrow extends a selected mention and Undo restores text replacement', async () => {
      await resetMentionPair()
      await selectLastMention()
      await key('ArrowLeft', 37, 8)
      const selected = await evaluate('window.composerTest.copySelection()')
      assert.equal(selected.plain, ' @队员乙')
      await insert('替换')
      await expectSegments([firstMention, { kind: 'text', text: '替换 ' }])
      await key('z', 90, process.platform === 'darwin' ? 4 : 2, 'KeyZ')
      await expectSegments([firstMention, { kind: 'text', text: ' ' }, secondMention, { kind: 'text', text: ' ' }])
    })

    await run('Undo and redo include Atom insertion in native history', async () => {
      await reset('')
      await insert('/work')
      await key('Enter', 13)
      assert.deepEqual((await state(true)).atomTypes, ['skill'])
      const primaryModifier = process.platform === 'darwin' ? 4 : 2
      await key('z', 90, primaryModifier, 'KeyZ')
      assert.deepEqual((await state(true)).atomTypes, [])
      await key('z', 90, primaryModifier | 8, 'KeyZ')
      assert.deepEqual((await state(true)).atomTypes, ['skill'])
    })

    await run('copy writes text/plain and Rovai Composer JSON', async () => {
      const document = {
        version: 2,
        segments: [
          { kind: 'text', text: '请 ' },
          { kind: 'atom', atom: { type: 'member', agentId: 'agent-a' } },
          { kind: 'text', text: ' 用 ' },
          { kind: 'atom', atom: { type: 'skill', skillId: 'skill-worktree', nameAtSend: 'worktree' } }
        ]
      }
      await reset(document)
      await key('a', 65, process.platform === 'darwin' ? 4 : 2, 'KeyA')
      const copied = await evaluate('window.composerTest.copySelection()')
      assert.equal(copied.plain, '请 @队员甲 用 /worktree')
      assert.deepEqual(JSON.parse(copied.structured), document)
      assert.match(copied.html, /white-space: pre-wrap/)
    })

    await run('structured paste degrades missing members and preserves missing Skill source identity', async () => {
      const pasted = {
        version: 2,
        segments: [
          { kind: 'atom', atom: { type: 'member', agentId: 'agent-a' } },
          { kind: 'text', text: ' ' },
          { kind: 'atom', atom: { type: 'member', agentId: 'missing', labelFallback: '离队成员' } },
          { kind: 'text', text: ' ' },
          { kind: 'atom', atom: { type: 'skill', skillId: 'missing-skill', nameAtSend: 'old-skill' } }
        ]
      }
      await reset('')
      await evaluate(`window.composerTest.paste('', ${JSON.stringify(JSON.stringify(pasted))})`)
      await frames()
      await expectSegments([
        { kind: 'atom', atom: { type: 'member', agentId: 'agent-a' } },
        { kind: 'text', text: ' @离队成员 ' },
        { kind: 'atom', atom: { type: 'skill', skillId: 'missing-skill', nameAtSend: 'old-skill' } }
      ])
    })

    await run('external HTML is pasted only as ordinary text', async () => {
      const url = 'https://example.test/page'
      await reset('')
      await evaluate(`window.composerTest.paste(${JSON.stringify(url)}, '', ${JSON.stringify(`<a href="${url}">${url}</a>`)})`)
      await frames()
      const current = await expectSegments([{ kind: 'text', text: url }])
      assert.equal(current.linkCount, 0)
    })

    await run('HTML-only clipboard input degrades to visible plain text', async () => {
      await reset('')
      await evaluate(`window.composerTest.paste('', '', '<b>普通</b><br>文本')`)
      await frames()
      const current = await state(true)
      assert.deepEqual(current.atomTypes, [])
      assert.equal(current.boldCount, 0)
      assert.match(current.text, /普通.*文本/s)
    })

    await run('file paste is delegated before clipboard text insertion', async () => {
      await reset('保留')
      await evaluate('window.composerTest.pasteFile()')
      await frames()
      const current = await expectSegments([{ kind: 'text', text: '保留' }])
      assert.equal(current.pastedFileCount, 1)
    })

    await run('catalog presentation refresh preserves outside focus and does not save the Draft', async () => {
      await reset({
        version: 2,
        segments: [{
          kind: 'atom',
          atom: { type: 'member', agentId: 'agent-a', labelFallback: '旧名字' }
        }]
      })
      const before = await state(true)
      await evaluate(`(() => { const button = document.createElement('button'); button.id = 'outside-composer'; button.textContent = '主菜单'; document.body.append(button); button.focus() })()`)
      await evaluate('window.composerTest.renameMember("新名字")')
      await frames()
      assert.equal(await evaluate('document.activeElement.id'), 'outside-composer')
      await evaluate('document.getElementById("outside-composer").remove()')
      const after = await state(false)
      assert.deepEqual(after.atomLabels, ['@新名字'])
      assert.equal(after.localVersion, before.localVersion)
      assert.equal(after.saveCount, before.saveCount)
      assert.equal(after.dirty, false)
    })

    await run('same-Draft React prop refresh preserves the editor instance', async () => {
      await reset('继续')
      await evaluate('window.composerTest.captureEditor()')
      await evaluate('window.composerTest.rerender()')
      await frames()
      assert.equal((await state(false)).sameEditor, true)
    })

    await run('draftIdentity replacement creates a fresh editor context', async () => {
      await reset('旧草稿')
      await evaluate('window.composerTest.captureEditor()')
      await evaluate('window.composerTest.switchDraft("新草稿")')
      await frames()
      const current = await state(true)
      assert.equal(current.sameEditor, false)
      assert.deepEqual(current.content, {
        version: 2,
        segments: [{ kind: 'text', text: '新草稿' }]
      })
    })

    await run('Enter never submits during composition and submits after it ends', async () => {
      await reset('正文')
      await evaluate('window.composerTest.compositionStart()')
      await key('Enter', 13)
      assert.equal((await state(false)).submitCount, 0)
      await evaluate('window.composerTest.compositionEnd()')
      await frames()
      await key('Enter', 13)
      assert.equal((await state(false)).submitCount, 1)
    })

    await run('plain paste never infers Member or Skill identity', async () => {
      const text = '@队员甲 /worktree'
      await reset('')
      await evaluate(`window.composerTest.paste(${JSON.stringify(text)})`)
      await frames()
      const current = await expectSegments([{ kind: 'text', text }])
      assert.deepEqual(current.atomTypes, [])
    })

    await run('click activation reads Atom identity without editing content', async () => {
      await reset({
        version: 2,
        segments: [{ kind: 'atom', atom: { type: 'member', agentId: 'agent-a' } }]
      })
      const before = await state(true)
      await evaluate('window.composerTest.clickFirstAtom()')
      await frames()
      const after = await state(false)
      assert.equal(after.activatedAtom, 'member:agent-a')
      assert.equal(after.localVersion, before.localVersion)
      assert.equal(after.dirty, false)
    })

    if (failures.length > 0) {
      throw new Error(`Composer regressions failed:\n${failures.map(failure =>
        `${failure.name}: ${failure.message}`).join('\n')}`)
    }
    console.log(JSON.stringify({ ok: true, cases }))
  } catch (error) {
    console.error(error.stack ?? error)
    process.exitCode = 1
  } finally {
    if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach()
    window.destroy()
    app.quit()
  }
})
