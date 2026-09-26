const assert = require('node:assert/strict')
const { mkdirSync } = require('node:fs')
const { isAbsolute, join } = require('node:path')
const { app, BrowserWindow } = require('electron')

const [renderer, userData] = process.argv.slice(2)
assert.ok(isAbsolute(renderer) && isAbsolute(userData))
mkdirSync(join(userData, 'managed-skill-library'), { recursive: true })
app.setPath('userData', userData)
app.setPath('sessionData', join(userData, 'session'))

const pause = (milliseconds = 25) => new Promise(resolve => setTimeout(resolve, milliseconds))

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    title: 'Rovai 通知执行定位 · 隔离验收',
    width: 1040,
    height: 700,
    useContentSize: true,
    show: process.platform === 'linux',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  window.webContents.on('console-message', event => console.error(event.message))
  const run = code => window.webContents.executeJavaScript(code, true)
  const state = () => run('window.executionNotificationTest.state()')
  const waitFor = async (predicate, description) => {
    for (let attempt = 0; attempt < 160; attempt++) {
      const current = await state()
      if (predicate(current)) return current
      await pause()
    }
    throw new Error(`${description}: ${JSON.stringify(await state())}`)
  }

  try {
    await window.loadFile(renderer)
    window.webContents.focus()
    await run("Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => true }); window.dispatchEvent(new Event('focus'))")
    await run('window.executionNotificationTest.configureRight()')
    await pause()
    await run('window.executionNotificationTest.openExecution()')
    for (let attempt = 0; attempt < 160; attempt++) {
      if (await run("Boolean(document.querySelector('.run-pulse-right [data-agent-id=\"agent-1\"]'))")) break
      if (attempt === 159) throw new Error('The right-side Agent entry did not render')
      await pause()
    }
    await run("document.querySelector('.run-pulse-right [data-agent-id=\"agent-1\"]').click()")
    let current = await waitFor(
      value => value.paneVisible
        && value.activeTabKind === 'execution'
        && value.targetVisible
        && value.visibleRunIds.includes('run-agent-1'),
      'The visible right-side Run was not reported'
    )
    assert.equal(current.compact, true, 'The regression must exercise compact file-preview layout')
    assert.equal(current.targetInsideWorkspace, false, 'The right execution stage must remain Portal-rendered')
    assert.equal(current.previewHidden, false)

    await run('window.executionNotificationTest.hideExecution()')
    await waitFor(value => !value.paneVisible && !value.targetVisible, 'The right execution pane did not close')
    await run('window.executionNotificationTest.focusRun(101)')
    current = await waitFor(
      value => value.paneVisible
        && value.activeTabKind === 'execution'
        && value.targetVisible
        && value.targetFocused
        && value.presentedRequests.includes(101),
      'Notification navigation did not reopen and focus the right-side Run'
    )
    assert.equal(current.previewHidden, false, 'Compact notification navigation must retain the execution pane')
    assert.deepEqual(current.visibleRunIds, ['run-agent-1'])

    await run("window.executionNotificationTest.focusSubject('task', 102)")
    await waitFor(value => value.focusedTask === 'task-rail' && value.presentedRequests.includes(102), 'Task notification did not open and focus its exact detail')
    await run("window.executionNotificationTest.focusSubject('mission', 103)")
    await waitFor(value => value.focusedMission === 'mission-rail' && value.presentedRequests.includes(103), 'Mission notification did not focus its exact introduction')

    console.log(JSON.stringify({
      ok: true,
      cases: [
        'right-side Portal Run contributes visible source identity',
        'closed right execution pane reopens for exact notification navigation',
        'compact layout retains and focuses the notification target',
        'Task and Mission notifications focus their exact subject'
      ]
    }))
    window.destroy()
    app.quit()
  } catch (error) {
    console.error(error)
    window.destroy()
    app.exit(1)
  }
}).catch(error => {
  console.error(error)
  app.exit(1)
})

app.on('window-all-closed', () => app.quit())
