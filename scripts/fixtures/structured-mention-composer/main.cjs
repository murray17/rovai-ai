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
  const window = new BrowserWindow({
    show: false,
    width: 1000,
    height: 700,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false }
  })
  const evaluate = source => window.webContents.executeJavaScript(source, true)
  const frames = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const command = (method, params) => window.webContents.debugger.sendCommand(method, params)
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
  async function run(name, callback) {
    try {
      await callback()
      cases.push(name)
    } catch (error) {
      failures.push({ name, message: error.message })
    }
  }
  try {
    await window.loadFile(renderer)
    window.webContents.debugger.attach('1.3')
    await command('Emulation.setFocusEmulationEnabled', { enabled: true })
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

    console.log(JSON.stringify({ ok: failures.length === 0, electron: process.versions.electron, cases, failures }))
    app.exit(failures.length === 0 ? 0 : 1)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
}).catch(error => { console.error(error); app.exit(1) })
