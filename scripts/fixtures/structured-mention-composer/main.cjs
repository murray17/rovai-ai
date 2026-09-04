const assert = require('node:assert/strict')
const { mkdirSync } = require('node:fs')
const { isAbsolute, join } = require('node:path')
const { app, BrowserWindow } = require('electron')

const [renderer, userData] = process.argv.slice(2)
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

  async function reset(value) {
    await evaluate(`window.composerTest.reset(${JSON.stringify(value)})`)
    await frames()
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
      assert.equal((await state(false)).menuKind, 'mention')
      await key('Enter', 13)
      const current = await expectSegments([
        { kind: 'text', text: '请 ' },
        { kind: 'atom', atom: { type: 'member', agentId: 'agent-a', labelFallback: '队员甲' } },
        { kind: 'text', text: ' ' }
      ])
      assert.deepEqual(current.atomTypes, ['member'])
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
      const copied = await evaluate('window.composerTest.copyAll()')
      assert.equal(copied.plain, '请 @队员甲 用 /worktree')
      assert.deepEqual(JSON.parse(copied.structured), document)
      assert.match(copied.html, /white-space: pre-wrap/)
    })

    await run('structured paste restores valid references and visibly degrades missing ones', async () => {
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
        { kind: 'text', text: ' @离队成员 /old-skill' }
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

    await run('catalog presentation refresh does not dirty or save the Draft', async () => {
      await reset({
        version: 2,
        segments: [{
          kind: 'atom',
          atom: { type: 'member', agentId: 'agent-a', labelFallback: '旧名字' }
        }]
      })
      const before = await state(true)
      await evaluate('window.composerTest.renameMember("新名字")')
      await frames()
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
