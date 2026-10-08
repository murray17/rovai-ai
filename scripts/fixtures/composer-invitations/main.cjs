const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { isAbsolute, join } = require('node:path')
const { app, BrowserWindow } = require('electron')
const [renderer, userData, evidence] = process.argv.slice(2)
assert.ok([renderer, userData, evidence].every(isAbsolute))
mkdirSync(userData, { recursive: true }); mkdirSync(evidence, { recursive: true })
app.setPath('userData', userData); app.setPath('sessionData', join(userData, 'session'))
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1040, height: 700,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } })
  const evaluate = code => window.webContents.executeJavaScript(code, true)
  const wait = async predicate => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(predicate)) return
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    throw new Error(`Timed out: ${predicate}; state: ${JSON.stringify(await evaluate('invitationTest.state()'))}`)
  }
  const key = async (key, code) => {
    for (const type of ['keyDown', 'keyUp']) await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type, key, windowsVirtualKeyCode: code })
  }
  const mention = async () => {
    await evaluate('invitationTest.focus()')
    await window.webContents.debugger.sendCommand('Input.insertText', { text: '@爱丽丝' })
    await wait(`!!document.querySelector('.structured-mention-menu [role="option"]')`)
    await key('Enter', 13)
    await wait('invitationTest.state().invite && !invitationTest.state().button')
  }
  try {
    await window.loadFile(renderer)
    window.webContents.debugger.attach('1.3')
    await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
    await wait(`!!document.querySelector('#camp-message[contenteditable="true"]')`)
    await mention()
    await wait('invitationTest.state().stored.includes("outside")')
    assert.equal((await evaluate('invitationTest.state()')).calls.includes('add:outside'), false)
    await evaluate('invitationTest.submit()')
    await wait('invitationTest.state().submissions.length === 1 && !invitationTest.state().button')
    assert.equal((await evaluate('invitationTest.state()')).atoms, 1)
    assert.equal((await evaluate('invitationTest.state()')).invite, true)
    // Restore the saved Pending document, including its outsider identity.
    await evaluate('invitationTest.hide()')
    await wait(`!document.querySelector('#camp-message[contenteditable="true"]')`)
    await evaluate('invitationTest.show()')
    await wait('invitationTest.state().invite && !invitationTest.state().button')
    const geometry = await evaluate(`(() => {
      const form = document.getElementById('camp-message').closest('form').getBoundingClientRect()
      const button = document.querySelector('form.composer:has(#camp-message) button[type=submit]').getBoundingClientRect()
      return { width: form.width, left: button.left, right: button.right, viewport: innerWidth }
    })()`)
    assert.ok(geometry.width > 500 && geometry.left >= 0 && geometry.right <= geometry.viewport, JSON.stringify(geometry))
    for (const theme of ['day', 'night']) {
      await evaluate(`document.documentElement.dataset.theme = '${theme}'`)
      writeFileSync(join(evidence, `${theme}.png`), (await window.webContents.capturePage()).toPNG())
    }
    await evaluate('invitationTest.accept(); invitationTest.submit()')
    await wait('invitationTest.state().submissions.length === 2 && invitationTest.state().atoms === 0')
    let state = await evaluate('invitationTest.state()')
    assert.equal(state.calls.filter(call => call.startsWith('add:')).length, 0)
    assert.deepEqual(state.submissions[0].content, state.submissions[1].content)
    assert.deepEqual(state.draft.content.segments, [])
    assert.equal(state.draft.continuationIntent.recipient.agentId, 'outside')
    assert.deepEqual(state.errors, [])
    // The accepted receipt precedes the roster projection. Core now rejects
    // Pending presence, including during clear/restore, and must not be called.
    const presenceCalls = state.calls.filter(call => call === 'threads.pendingDraft.setPresence').length
    await evaluate('invitationTest.focus()')
    await window.webContents.debugger.sendCommand('Input.insertText', { text: '暂存' })
    await wait('invitationTest.state().draft.body.includes("暂存") && invitationTest.state().button')
    await key('Backspace', 8)
    await key('Backspace', 8)
    await wait('invitationTest.state().draft.body === ""')
    await evaluate('invitationTest.leave()')
    await wait(`!document.querySelector('#camp-message[contenteditable="true"]')`)
    await evaluate('invitationTest.show()')
    await wait(`!!document.querySelector('#camp-message[contenteditable="true"]')`)
    await evaluate('invitationTest.focus()')
    await window.webContents.debugger.sendCommand('Input.insertText', { text: '继续检查' })
    await wait('invitationTest.state().draft.body.includes("继续检查") && invitationTest.state().button')
    await evaluate('invitationTest.submit()')
    state = await evaluate('invitationTest.state()')
    assert.equal(state.submissions.length, 2)
    assert.equal(state.calls.includes('discard-pending'), false)
    assert.equal(state.calls.filter(call => call === 'threads.pendingDraft.setPresence').length, presenceCalls)
    await evaluate('invitationTest.projectActivation()')
    await wait('invitationTest.state().continuation && !invitationTest.state().button')
    await evaluate('invitationTest.submit()')
    await wait('invitationTest.state().submissions.length === 3 && invitationTest.state().text === ""')
    state = await evaluate('invitationTest.state()')
    assert.equal(state.submissions[2].content.segments[0].atom.agentId, 'outside')
    assert.deepEqual(state.errors, [])
    // Active still uses the existing add-then-send sequence.
    await evaluate('invitationTest.hide()')
    await wait(`!document.querySelector('#camp-message[contenteditable="true"]')`)
    await evaluate('invitationTest.active(); invitationTest.show()')
    await wait(`!!document.querySelector('#camp-message[contenteditable="true"]')`)
    await mention()
    await evaluate('invitationTest.submit()')
    await wait('invitationTest.state().submissions.length === 4 && invitationTest.state().atoms === 0')
    state = await evaluate('invitationTest.state()')
    assert.ok(state.calls.indexOf('add:outside') < state.calls.indexOf('send'))
    assert.deepEqual(state.errors, [])
    console.log(JSON.stringify({ ok: true, cases: ['pending invitation', 'rejected send preserves input', 'local restore', 'accepted send clears input', 'delayed activation clear and restore', 'follow-up keeps invited recipient', 'active add then send'], userData }))
    app.exit(0)
  } catch (error) { console.error(error); app.exit(1) }
})
