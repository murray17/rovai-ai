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
    // Keep the Linux fixture mapped in Xvfb so native rendering runs in the foreground.
    show: process.platform === 'linux',
    width: 1000,
    height: 700,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false }
  })
  async function complete(promise, operation) {
    let timeout
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error(`Composer fixture timed out: ${operation}`)), 5_000)
        })
      ])
    } finally {
      clearTimeout(timeout)
    }
  }
  const evaluate = source => {
    trace(`Composer Renderer step: ${source.replace(/\s+/g, ' ').slice(0, 200)}`)
    return complete(window.webContents.executeJavaScript(source, true), source)
  }
  const frames = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const command = (method, params) => {
    const operation = `${method} ${JSON.stringify(params)}`
    trace(`Composer input step: ${operation}`)
    return complete(window.webContents.debugger.sendCommand(method, params), operation)
  }
  const cases = []
  const failures = []
  async function reset(text) {
    if (!(await evaluate('Boolean(document.getElementById("composer"))'))) {
      await window.loadFile(renderer)
      await frames()
    }
    await evaluate(`window.composerTest.reset(${JSON.stringify(text)})`)
    await frames()
    await evaluate('window.composerTest.focusEnd()')
  }
  async function insert(text) {
    await command('Input.insertText', { text })
    await frames()
  }
  async function key(key, windowsVirtualKeyCode, modifiers = 0) {
    const event = { key, code: key, windowsVirtualKeyCode, modifiers }
    await command('Input.dispatchKeyEvent', { type: 'keyDown', ...event })
    await command('Input.dispatchKeyEvent', { type: 'keyUp', ...event })
    await frames()
  }
  async function expectText(expected, options = {}) {
    const state = await evaluate('window.composerTest.state()')
    assert.deepEqual(state.errors, [], 'A native edit must not throw and blank the Renderer')
    assert.equal(state.text, expected, 'Visible text must contain exactly the user edit')
    assert.deepEqual(state.content, expected ? [{ kind: 'text', text: expected }] : [],
      'The saved value must agree with visible text')
    assert.equal(state.focused, true, 'Editing must retain focus')
    if (options.sameEditor) assert.equal(state.sameEditor, true, 'Simple native text edits must not reset the host')
  }
  async function expectSkills(expected) {
    const state = await evaluate('window.composerTest.state()')
    assert.deepEqual(state.errors, [])
    assert.equal(state.menuKind, expected === null ? null : 'skill')
    if (expected !== null) assert.deepEqual(state.skillOptions, expected)
    return state
  }
  async function controlledInput(text) {
    await evaluate(`window.composerTest.controlledInput(${JSON.stringify(text)})`)
    await frames()
  }
  async function selectText(text, anchor, focus = anchor) {
    await evaluate(`window.composerTest.selectText(${JSON.stringify(text)}, ${anchor}, ${focus})`)
    await frames()
  }
  async function expectContent(expected) {
    const state = await evaluate('window.composerTest.state()')
    assert.deepEqual(state.errors, [])
    assert.deepEqual(state.content, expected)
    assert.equal(state.focused, true)
    assert.equal(state.menuKind, null)
  }
  async function run(name, callback) {
    trace(`Composer fixture: ${name}`)
    try {
      await callback()
      cases.push(name)
    } catch (error) {
      trace(`Composer fixture failed (${name}): ${error.stack}`)
      failures.push({ name, message: error.message })
    }
  }
  try {
    trace('Composer fixture: loading Renderer')
    await window.loadFile(renderer)
    trace('Composer fixture: attaching debugger')
    window.webContents.debugger.attach('1.3')
    await command('Emulation.setFocusEmulationEnabled', { enabled: true })
    trace('Composer fixture: waiting for initial frames')
    await frames()

    await run('IME replaces a newline without blanking the page', async () => {
      await reset('a\nb')
      await command('Input.imeSetComposition', {
        text: ' ', selectionStart: 1, selectionEnd: 1, replacementStart: 1, replacementEnd: 2
      })
      await insert(' ')
      await expectText('a b')
    })

    await run('split native text does not duplicate on subsequent input', async () => {
      await reset('ab')
      await evaluate(`(() => {
        document.getElementById('composer').firstChild.firstChild.splitText(1)
        window.composerTest.focusEnd()
      })()`)
      await insert('x')
      await expectText('abx')
      await insert('y')
      await expectText('abxy')
    })

    await run('a same-shaped native text replacement remains editable', async () => {
      await reset('ab')
      await evaluate(`(() => {
        const editor = document.getElementById('composer')
        const text = editor.firstChild.firstChild
        text.replaceWith(document.createTextNode(text.textContent))
        window.composerTest.focusEnd()
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }))
      })()`)
      await frames()
      await key('Backspace', 8)
      await expectText('a')
    })

    await run('a same-shaped native line break can be deleted safely', async () => {
      await reset('a\nb')
      await evaluate(`(() => {
        const editor = document.getElementById('composer')
        const lineBreak = editor.querySelector('br')
        lineBreak.replaceWith(lineBreak.cloneNode(true))
        window.composerTest.focusEnd()
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }))
      })()`)
      await frames()
      await key('Backspace', 8)
      await key('Backspace', 8)
      await expectText('a')
    })

    await run('an equal parent refresh cannot adopt unowned composing nodes', async () => {
      await reset('ab')
      await evaluate(`(() => {
        const editor = document.getElementById('composer')
        editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        editor.firstChild.firstChild.splitText(1)
        window.composerTest.refresh()
        window.composerTest.focusEnd()
      })()`)
      await frames()
      await evaluate(`document.getElementById('composer').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'b' }))`)
      await frames()
      await insert('x')
      await expectText('abx')
    })

    await run('normal typing, numbered newlines and IME keep their text and focus', async () => {
      await reset('')
      await evaluate('window.composerTest.captureEditor()')
      await insert('1')
      await expectText('1', { sameEditor: true })
      await reset('')
      await evaluate(`(() => {
        const emptySegment = document.getElementById('composer').firstChild
        window.getSelection().setBaseAndExtent(emptySegment, 0, emptySegment, 0)
      })()`)
      await evaluate('window.composerTest.captureEditor()')
      await command('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 })
      await insert('你')
      await expectText('你', { sameEditor: true })
      await reset('1、第一项\n2、第二项')
      await evaluate('window.composerTest.captureEditor()')
      await insert('x')
      await expectText('1、第一项\n2、第二项x', { sameEditor: true })
      await key('Enter', 13, 8)
      await insert('3、')
      await command('Input.imeSetComposition', { text: 'lingwai', selectionStart: 7, selectionEnd: 7 })
      await insert('另外')
      await expectText('1、第一项\n2、第二项x\n3、另外')
    })

    await run('controlled slash input filters and replaces only the current query', async () => {
      const prefix = '请先检查模块，然后 '
      await reset(`${prefix}再继续`)
      await selectText(prefix, prefix.length)
      await controlledInput('/')
      let state = await evaluate('window.composerTest.state()')
      assert.equal(state.menuKind, 'skill')
      assert.equal(state.skillOptions.length, 18)
      await controlledInput('wor')
      await expectSkills(['worktree'])
      await key('Enter', 13)
      await expectContent([
        { kind: 'text', text: prefix },
        { kind: 'skill_mention', skillId: 'skill-worktree', nameAtSend: 'worktree' },
        { kind: 'text', text: ' 再继续' }
      ])
      await insert('先')
      state = await evaluate('window.composerTest.state()')
      assert.equal(state.content.at(-1).text, ' 先再继续', 'The caret must stay in the writable gap')
    })

    await run('native text input and paste use the same boundaries and preserve suffix whitespace', async () => {
      await reset('请分析， 再继续')
      await selectText('请分析，', '请分析，'.length)
      await insert('/work')
      await expectSkills(['worktree'])
      await key('Tab', 9)
      await expectContent([
        { kind: 'text', text: '请分析，' },
        { kind: 'skill_mention', skillId: 'skill-worktree', nameAtSend: 'worktree' },
        { kind: 'text', text: ' 再继续' }
      ])
      await reset('请完成以下工作：\n')
      await evaluate('window.composerTest.paste("/agent")')
      await frames()
      await expectSkills(['analyze-agent-codebase'])
      await expectText('请完成以下工作：\n/agent')
      await key('Escape', 27)
      await expectSkills(null)
    })

    await run('native fallback recomputes after replacement, deletion, undo and redo without event data', async () => {
      for (const inputType of ['insertReplacementText', 'deleteContentBackward', 'historyUndo', 'historyRedo']) {
        await reset('已有正文')
        await evaluate(`window.composerTest.nativeText('已有正文 /work', ${JSON.stringify(inputType)})`)
        await frames()
        await expectText('已有正文 /work')
        await expectSkills(['worktree'])
      }
      for (const text of ['打开 https://github.com', '检查 src/components/chat', 'foo/bar', '请使用/worktree', '请 /work\n']) {
        await evaluate(`window.composerTest.nativeText(${JSON.stringify(text)}, 'insertReplacementText')`)
        await frames()
        await expectSkills(null)
      }
    })

    await run('deletion and selected-text replacement derive from the edited content', async () => {
      await reset('请 旧文本 再继续')
      await selectText('旧文本', 5, 2)
      await controlledInput('/work')
      await expectSkills(['worktree'])
      await key('Backspace', 8)
      await expectText('请 /wor 再继续')
      await expectSkills(['worktree'])
      await selectText('/wor', 2)
      await expectSkills(null)
      await key('Delete', 46)
      await expectText('请 wor 再继续')
      await expectSkills(null)
      await reset('请 /work ')
      await key('Backspace', 8)
      await expectSkills(['worktree'])
      await insert('/')
      await expectSkills(null)
      await reset('请 ')
      await insert('/work')
      await insert('@')
      const state = await evaluate('window.composerTest.state()')
      assert.equal(state.menuKind, 'mention', '@ must dismiss Skill suggestions without breaking member mentions')
      await key('ArrowDown', 40)
      await key('Tab', 9)
      await expectContent([
        { kind: 'text', text: '请 /work' },
        { kind: 'member_mention', agentId: 'agent-a' },
        { kind: 'text', text: ' ' }
      ])
    })

    await run('selection, caret movement, Escape and parent replacement dismiss the Skill menu', async () => {
      await reset('请 ')
      await insert('/work')
      await selectText('/work', 3, 7)
      await expectSkills(null)
      await controlledInput('work')
      await expectSkills(['worktree'])
      await key('ArrowLeft', 37)
      await expectSkills(['worktree'])
      await key('ArrowRight', 39)
      await expectSkills(['worktree'])
      await selectText('/work', 0)
      await expectSkills(null)
      await evaluate('window.composerTest.focusEnd()')
      await key('Backspace', 8)
      await expectSkills(['worktree'])
      await key('Escape', 27)
      await evaluate('window.composerTest.refresh()')
      await frames()
      await expectSkills(null)
      await insert('k')
      await expectSkills(['worktree'])
      await evaluate('window.composerTest.replaceContent([{ kind: "text", text: "另一份草稿" }])')
      await frames()
      await expectSkills(null)
      await expectText('另一份草稿')
    })

    await run('structured tokens block adjoining queries and survive a separate Skill insertion', async () => {
      const tokens = [
        { kind: 'member_mention', agentId: 'agent-a' },
        { kind: 'all_members_mention' },
        { kind: 'skill_mention', skillId: 'skill-analyze', nameAtSend: 'analyze-agent-codebase' }
      ]
      for (const token of tokens) {
        await reset([token])
        await insert(' /work')
        await expectSkills(['worktree'])
        await key('Tab', 9)
        await expectContent([
          token,
          { kind: 'text', text: ' ' },
          { kind: 'skill_mention', skillId: 'skill-worktree', nameAtSend: 'worktree' },
          { kind: 'text', text: ' ' }
        ])
        await reset([token])
        await insert('/work')
        await expectSkills(null)
        await insert(' /work')
        await expectSkills(['worktree'])
        await key('Tab', 9)
        await expectContent([
          token,
          { kind: 'text', text: '/work ' },
          { kind: 'skill_mention', skillId: 'skill-worktree', nameAtSend: 'worktree' },
          { kind: 'text', text: ' ' }
        ])
        await reset([token, { kind: 'text', text: ' 再继续' }])
        await evaluate(`(() => {
          const editor = document.getElementById('composer')
          const nativeText = document.createTextNode(' /work')
          editor.insertBefore(nativeText, editor.lastChild)
          window.getSelection().setBaseAndExtent(nativeText, 6, nativeText, 6)
          editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ' /work' }))
        })()`)
        await frames()
        await expectSkills(['worktree'])
        await key('Tab', 9)
        await expectContent([
          token,
          { kind: 'text', text: ' ' },
          { kind: 'skill_mention', skillId: 'skill-worktree', nameAtSend: 'worktree' },
          { kind: 'text', text: ' 再继续' }
        ])
      }
      await reset([{ kind: 'text', text: '请 /wo' }, tokens[0]])
      await insert('rk')
      await expectSkills(null)
    })

    await run('native member input immediately after a token replaces the typed trigger', async () => {
      const token = { kind: 'skill_mention', skillId: 'skill-worktree', nameAtSend: 'worktree' }
      await reset([token])
      await insert('@')
      const state = await evaluate('window.composerTest.state()')
      assert.equal(state.menuKind, 'mention')
      await key('ArrowDown', 40)
      await key('Tab', 9)
      await expectContent([
        token,
        { kind: 'member_mention', agentId: 'agent-a' },
        { kind: 'text', text: ' ' }
      ])
    })

    for (const dismiss of ['blur', 'Escape']) {
      await run(`pending composition reconciliation cannot reopen a query after ${dismiss}`, async () => {
        await reset('请 ')
        await insert('/work')
        await expectSkills(['worktree'])
        await evaluate(`(() => {
          const editor = document.getElementById('composer')
          editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
          editor.firstChild.firstChild.textContent += 'tree'
          window.composerTest.focusEnd()
          editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'tree' }))
          ${dismiss === 'blur' ? 'editor.blur()' : `editor.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true
          }))`}
        })()`)
        await frames()
        const state = await expectSkills(null)
        assert.equal(state.text, '请 /worktree')
        assert.deepEqual(state.content, [{ kind: 'text', text: '请 /worktree' }])
        assert.equal(state.focused, dismiss !== 'blur')
        await evaluate('window.composerTest.focusEnd()')
        await insert(' /work')
        await expectSkills(['worktree'])
      })
    }

    await run('Shift+Enter and IME do not choose or submit a Skill', async () => {
      await reset('请 ')
      await insert('/work')
      await expectSkills(['worktree'])
      await key('Enter', 13, 8)
      await expectText('请 /work\n')
      await expectSkills(null)
      await insert('/work')
      await expectSkills(['worktree'])
      await command('Input.imeSetComposition', { text: 'shu', selectionStart: 3, selectionEnd: 3 })
      await frames()
      await expectSkills(null)
      await evaluate(`document.getElementById('composer').dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true, bubbles: true, cancelable: true
      }))`)
      await insert('树')
      await expectText('请 /work\n/work树')
      await expectSkills([])
    })

    await run('keyboard navigation scrolls the active option and clamps after catalog changes', async () => {
      await reset('请 ')
      await insert('/')
      await key('ArrowUp', 38)
      let state = await evaluate('window.composerTest.state()')
      assert.equal(state.activeSkill, 'fixture-15')
      assert.equal(state.activeVisible, true, 'Keyboard navigation must reveal the option')
      assert.ok(state.menuScrollTop > 0)
      assert.equal(state.focused, true)
      await key('ArrowDown', 40)
      state = await evaluate('window.composerTest.state()')
      assert.equal(state.activeSkill, 'worktree')
      assert.equal(state.activeVisible, true)
      await key('ArrowUp', 38)
      await evaluate('window.composerTest.limitSkills(1)')
      await frames()
      state = await expectSkills(['worktree'])
      assert.equal(state.activeCount, 1)
      assert.equal(state.activeSkill, 'worktree')
      assert.equal(state.activeId, state.selectedId)
      await key('Enter', 13)
      await expectContent([
        { kind: 'text', text: '请 ' },
        { kind: 'skill_mention', skillId: 'skill-worktree', nameAtSend: 'worktree' },
        { kind: 'text', text: ' ' }
      ])
    })

    console.log(JSON.stringify({ ok: failures.length === 0, electron: process.versions.electron, cases, failures }))
    app.exit(failures.length === 0 ? 0 : 1)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
}).catch(error => { console.error(error); app.exit(1) })
