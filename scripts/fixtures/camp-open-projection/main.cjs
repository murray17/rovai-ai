const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { isAbsolute, join, dirname } = require('node:path')
const { app, BrowserWindow } = require('electron')
const [renderer, userData] = process.argv.slice(2)
assert.ok(isAbsolute(renderer) && isAbsolute(userData))
mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)
app.setPath('sessionData', join(userData, 'session'))
// Production CampWorkspace + adapter, with a closed draft/Skill API. No Core or daily data.
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: process.platform === 'linux', width: 1200, height: 800, useContentSize: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } })
  const errors = []
  window.webContents.on('console-message', event => {
    if (event.level === 'warning' || event.level === 'error' || event.level >= 2) errors.push(event.message)
  })
  await window.loadFile(renderer)
  const run = code => window.webContents.executeJavaScript(code, true)
  const state = async () => { await run('window.campOpenTest.settle()'); return run('window.campOpenTest.state()') }
  const capture = async name => writeFileSync(join(dirname(userData), `${name}.png`), (await window.webContents.capturePage()).toPNG())
  try {
    let current = await state()
    assert.equal(current.messages.length, 60, 'Earlier pages survive the initial bounded Open')
    assert.equal(current.timelineLength, 0)
    assert.equal(current.allEventSequencesNull, true)
    assert.deepEqual(current.cards, { task: 1, stop: 1, files: 1 })
    await run('window.campOpenTest.openTask()')
    current = await state()
    assert.ok(current.auditText.includes('业务状态原因'), 'Task business reasons remain available')
    assert.ok(!current.auditText.includes('审计原因'), 'No optional audit-event cause is inferred')
    await capture('business-cards')
    await run('window.campOpenTest.closeTask()')
    await state()
    await run('window.campOpenTest.bookmark()')
    const before = await state()
    assert.ok(before.scrollTop > 0 && before.bottomGap > 500, 'The fixture is reading older content')
    await run('window.campOpenTest.refresh(false)')
    const refreshed = await state()
    assert.deepEqual(refreshed.messages, before.messages, 'Refresh does not reorder or discard earlier messages')
    assert.equal(refreshed.sameAnchorNode, true)
    assert.ok(Math.abs(refreshed.anchorTop - before.anchorTop) <= 1, 'Refresh preserves the reading anchor')
    await run('window.campOpenTest.refresh(true)')
    const appended = await state()
    assert.deepEqual(appended.messages, [...before.messages, 'message-61'])
    assert.equal(appended.sameAnchorNode, true)
    assert.ok(Math.abs(appended.anchorTop - before.anchorTop) <= 1, 'A background message cannot steal the reading position')
    assert.deepEqual(appended.cards, before.cards)
    assert.equal(appended.allEventSequencesNull, true)
    await capture('refresh-day')
    await run("document.documentElement.dataset.theme = 'night'")
    await state()
    await capture('refresh-night')
    assert.deepEqual(errors, [], 'No React key, rendering or fixture API errors')
    console.log(JSON.stringify({ ok: true, messages: appended.messages.length,
      refreshAnchorDelta: refreshed.anchorTop - before.anchorTop,
      appendAnchorDelta: appended.anchorTop - before.anchorTop, cards: appended.cards }))
    window.destroy(); app.quit()
  } catch (error) {
    console.error(errors)
    await capture('failure')
    throw error
  }
}).catch(error => { console.error(error); app.exit(1) })
