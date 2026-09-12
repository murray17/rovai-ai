const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { dirname, isAbsolute, join } = require('node:path')
const { app, BrowserWindow } = require('electron')

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
    await waitFor("Boolean(document.querySelector('.single-chat-final'))")
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
    assert.match(state.groupLabel, /完成了 3 个步骤/)

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

    assert.equal(composerEnter.state.sendFeedback, '连接中')
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
    assert.equal(composerEnter.state.sendFeedback, '连接中')
    await run('window.singleChatTest.releaseSend()')
    await waitFor("window.singleChatTest.state().liveText.includes('连接中')")
    state = await settle()
    assert.equal(state.sendFeedback, '')
    assert.equal(state.liveSummaryVisible, false)
    assert.equal(state.liveOpen, true)
    assert.match(state.publicText, /连接中/)
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
            && [...surface.querySelectorAll('.process-action.current')].some(node => /Thinking|思考中|连接中/.test(node.textContent))) {
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
        assert.doesNotMatch(state.liveText + state.publicText, /Thinking|思考中|连接中/)
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
    assert.match(state.liveGroupLabel, /执行中.*pnpm run accept:single-chat-ui/)
    assert.doesNotMatch(state.liveText + state.publicText, /Thinking|思考中|连接中|工作了|正在工作/)
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
    assert.match(state.liveGroupLabel, /执行中/)
    assert.doesNotMatch(state.liveText + state.publicText, /Thinking|思考中|连接中|工作了|正在工作/)
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
      assert.match(row.tracks, /^16px [\d.]+px 16px 20px$/)
    }
    state = await phase('continuation')
    assert.match(state.liveGroupLabel, /完成了 1 个步骤/)
    assert.doesNotMatch(state.liveText + state.publicText, /Thinking|思考中|连接中/)
    assert.deepEqual(await run('window.feedbackOverlaps'), [])
    await run('window.feedbackObserver.disconnect()')
    assert.equal(await run(`document.querySelector('${singleLive} .tool-group-state').hasAttribute('role')`), false)
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
    assert.doesNotMatch(state.liveText, /Thinking|思考中|连接中/)
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
