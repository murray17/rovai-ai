const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { dirname, isAbsolute, join } = require('node:path')
const { app, BrowserWindow } = require('electron')

const [renderer, userData] = process.argv.slice(2)
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
  await window.loadFile(renderer)
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
      const rect = node.getBoundingClientRect()
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

  try {
    await waitFor("Boolean(document.querySelector('.single-chat-final'))")
    let state = await settle()
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

    state = await click('.single-chat-run-history.is-terminal > summary')
    assert.equal(state.terminalOpen, true)
    assert.match(state.groupLabel, /已执行 3 项操作/)

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
    composerEnter = await dispatchComposerEnter(false)
    assert.equal(composerEnter.defaultPrevented, true)
    assert.equal(composerEnter.state.sendRequests, 1)

    await run("document.documentElement.dataset.theme = 'night'; window.singleChatTest.setMode('running')")
    await wait(950)
    state = await settle()
    assert.equal(state.liveOpen, true)
    assert.equal(state.liveExecutionBackground, 'rgba(0, 0, 0, 0)')
    assert.equal(state.liveExecutionBorderWidth, '0px')
    assert.equal(state.composerDisabled, true)
    assert.equal(state.stopVisible, true)
    assert.match(state.body, /正在工作/)
    assert.equal(state.pageOverflow, false)
    const nightRunning = await capture('single-chat-night-running-1180x800')

    state = await click('.single-chat-composer .composer-actions .danger-button')
    assert.equal(state.cancelRequests, 1)
    assert.match(state.body, /你在 3 分 12 秒后停止了运行/)
    assert.match(state.body, /单聊正文不会进入 Camp 公屏/)

    window.webContents.debugger.attach('1.3')
    await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: 1040, height: 700, deviceScaleFactor: 1, mobile: false
    })
    state = await settle()
    assert.equal(state.pageOverflow, false)
    assert.ok(state.panel.right <= 1040 && state.panel.bottom <= 700)
    const compact = await capture('single-chat-night-compact-1040x700')

    console.log(JSON.stringify({
      ok: true,
      verified: {
        selectorTriggerAndOptionAvatars: true,
        transcriptAvatarFree: true,
        rightUserLeftAgentLayout: true,
        chineseTerminalDuration: true,
        terminalExecutionAutoCollapse: true,
        groupedCommands: 3,
        finalMessageExpanded: true,
        directEndConfirmation: true,
        campComposerParity: true,
        composerKeyboardSemantics: true,
        privateAttachments: true,
        agentMessagesWithoutFill: true,
        runningStopAndComposerGate: true,
        dayAndNight: true,
        compactNoOverflow: true
      },
      captures: { dayMenu, dayDialog, nightRunning, compact }
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
