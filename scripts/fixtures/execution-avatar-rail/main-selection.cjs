const assert = require('node:assert/strict')
const { mkdirSync } = require('node:fs')
const { isAbsolute, join } = require('node:path')
const { app, BrowserWindow } = require('electron')

const [renderer, userData] = process.argv.slice(2)
assert.ok(isAbsolute(renderer) && isAbsolute(userData))
mkdirSync(join(userData, 'managed-skill-library'), { recursive: true })
app.setPath('userData', userData)
app.setPath('sessionData', join(userData, 'session'))

app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1440, height: 920, show: process.platform === 'linux',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } })
  const errors = []
  window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) })
  const run = code => window.webContents.executeJavaScript(code, true)
  const state = () => run(`(() => ({
    selected: document.querySelector('.run-pulse-chip.is-selected')?.dataset.agentId ?? null,
    visible: !!document.querySelector('.execution-drawer')?.checkVisibility(),
    historyOpen: document.querySelector('.execution-history-toggle')?.getAttribute('aria-expanded') === 'true',
    focusedRun: document.querySelector('.execution-process-stage.is-focused')?.dataset.agentRunId ?? null,
    focusedInDrawer: !!document.activeElement?.closest('.execution-drawer'),
    fileActive: document.querySelector('.file-preview-tab-activate[aria-selected="true"]')?.textContent.includes('selection.txt') ?? false,
    emptySelection: !!document.querySelector('.execution-preview-empty')?.checkVisibility(),
    replyExecutionVisible: !!document.querySelector('.reply-execution-popover')?.checkVisibility(),
    replyRunAvailable: !!document.querySelector('.reply-detail-run .run-presence-open')?.checkVisibility()
  }))()`)
  const wait = async (predicate, label) => {
    for (let i = 0; i < 160; i++) {
      const current = await state()
      if (predicate(current)) return current
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    throw new Error(`${label}: ${JSON.stringify(await state())}`)
  }
  const configure = async (threadId, options = {}) => {
    await run(`window.executionSelectionTest.configure(${JSON.stringify({ threadId, ...options })})`)
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  }
  const click = selector => run(`(() => {
    const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find(node => node.checkVisibility())
    if (!node) throw new Error('Missing visible control: ' + ${JSON.stringify(selector)})
    node.click()
  })()`)
  const nativeClick = async selector => {
    const point = await run(`(() => {
      const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find(node => node.checkVisibility())
      if (!node) throw new Error('Missing visible control: ' + ${JSON.stringify(selector)})
      const rect = node.getBoundingClientRect()
      const x = Math.round(rect.x + rect.width / 2), y = Math.round(rect.y + rect.height / 2)
      return { x, y, reachable: node.contains(document.elementFromPoint(x, y)) }
    })()`)
    assert.equal(point.reachable, true, `${selector} must be reachable through normal pointer input`)
    const { x, y } = point
    window.webContents.sendInputEvent({ type: 'mouseMove', x, y })
    window.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    window.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  }
  const select = agentId => click(`.run-pulse-chip[data-agent-id="${agentId}"]`)
  const overview = '__execution_overview__'
  const report = []
  try {
    await window.loadFile(renderer)
    await configure('selection-a')
    assert.equal((await state()).visible, false, 'Terminal history must not automatically open execution')
    await run('window.executionSelectionTest.openExecution()')
    await wait(s => s.visible && s.selected === overview && !s.emptySelection, 'Fresh visible execution defaults to overview')
    await select('agent-2')
    await wait(s => s.selected === 'agent-2' && s.historyOpen, 'Member history follows existing default')
    await click('.execution-history-toggle')
    assert.equal((await state()).historyOpen, false)
    await configure('selection-b')
    await configure('selection-a')
    await wait(s => s.visible && s.selected === 'agent-2' && !s.emptySelection, 'Terminal Thread returns to its member Tab')
    assert.equal((await state()).historyOpen, true, 'Only the Tab is restored; history disclosure uses the existing default')
    assert.equal((await state()).focusedInDrawer, false, 'Returning does not move keyboard focus into execution')
    report.push('terminal-return-member-only')

    await run('window.executionSelectionTest.openFile()')
    await wait(s => s.fileActive && !s.visible, 'File preview opens')
    await configure('selection-b')
    await configure('selection-a', { running: true })
    await wait(s => s.fileActive && !s.visible, 'A running Run does not replace the restored file')
    await click('.file-preview-tab-activate[aria-label="执行"]')
    await wait(s => s.visible && s.selected === 'agent-2', 'Raw execution Tab activation restores its member')
    report.push('protected-file-return-with-running-run')

    await configure('selection-b')
    await configure('selection-a', { running: true })
    await wait(s => s.visible && s.selected === 'agent-2', 'Running entry restores the Tab while preserving automatic opening')
    await configure('selection-a')
    await run('window.executionSelectionTest.hideExecution()')
    await configure('selection-b')
    await configure('selection-a')
    assert.equal((await state()).visible, false, 'A remembered member does not reopen a hidden terminal pane')
    await click('.camp-detail-entry[data-detail="execution"]')
    await wait(s => s.visible && s.selected === 'agent-2', 'The top Execution entry restores its member too')
    report.push('running-entry-and-header-open')

    await configure('selection-a', { missingAgent: 'agent-2' })
    await wait(s => s.visible && s.selected === overview && !s.emptySelection, 'Unavailable member falls back to overview')
    await select('agent-4')
    await configure('selection-b')
    await configure('selection-a')
    await wait(s => s.selected === 'agent-4' && s.visible, 'Each Thread keeps its own Tab')
    await run("window.executionNotificationTest.focusRun(101, 'run-agent-1')")
    await wait(s => s.selected === 'agent-1' && s.focusedRun === 'run-agent-1', 'Exact Run navigation overrides remembered Tab')
    await select(overview)
    await configure('selection-b')
    await configure('selection-a')
    await wait(s => s.selected === overview && s.visible, 'Explicit overview selection is retained too')
    report.push('stale-fallback-and-explicit-navigation')

    for (const placement of ['inspector', 'bottom']) {
      const threadId = `selection-${placement}`
      const openSelector = placement === 'bottom' ? '.execution-bottom-collapse-button' : '.camp-detail-entry[data-detail="execution"]'
      await configure(threadId, { placement })
      assert.equal((await state()).visible, false, `${placement}: saved Tab does not open execution`)
      await click(openSelector)
      await wait(s => s.visible && s.selected === overview, `${placement}: empty selection opens overview`)
      await select('agent-2')
      await configure('selection-b')
      await configure(threadId, { placement })
      assert.equal((await state()).visible, false, `${placement}: terminal execution stays closed on return`)
      await click(openSelector)
      await wait(s => s.visible && s.selected === 'agent-2', `${placement}: reopening restores its member`)
      if (placement === 'bottom') {
        await run(`(() => {
          const stage = document.querySelector('.execution-process-stage.is-focused')
          stage.focus()
          stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        })()`)
        await wait(s => !s.visible, 'Bottom Escape still closes execution')
        assert.equal(await run(`document.activeElement === document.querySelector('.execution-bottom-collapse-button')`),
          true, 'Bottom Escape returns focus to the original expand button')
      }
      report.push(`${placement}-closed-return`)
    }
    await configure('selection-reply', { placement: 'bottom', running: true, reply: true })
    await nativeClick('.reply-parent-quote')
    await wait(s => s.replyRunAvailable, 'Reply chain loads its running execution')
    await nativeClick('.reply-detail-run .run-presence-open')
    await wait(s => s.visible && s.replyExecutionVisible && s.selected === 'agent-1', 'Reply details opens the exact execution')
    await nativeClick('.execution-bottom-collapse-button')
    await wait(s => !s.visible && s.replyExecutionVisible && s.selected === null, 'Explicit close stays cleared while its reply host remains visible')
    await configure('selection-reply', { placement: 'bottom', running: true, reply: true })
    assert.equal((await state()).selected, null, 'A fresh snapshot cannot undo explicit close')
    await click('.reply-detail-run .run-presence-open')
    await wait(s => s.visible && s.selected === 'agent-1', 'Explicit Run navigation can open after close')
    await click('.execution-bottom-collapse-button')
    await wait(s => !s.visible && s.selected === null, 'The second explicit close remains cleared too')
    await click('.reply-execution-popover .camp-detail-collapse')
    await wait(s => !s.replyExecutionVisible && !s.visible, 'Reply execution can still be dismissed')
    await configure('selection-reply', { placement: 'right', running: true, reply: true })
    await run('window.executionSelectionTest.openExecution()')
    await wait(s => s.visible && s.selected === 'agent-1', 'A newly visible execution surface restores its Tab after close')
    report.push('reply-host-explicit-close')
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ ok: true, report }))
    window.destroy()
    app.quit()
  } catch (error) {
    console.error(error.stack ?? error)
    console.error(JSON.stringify({ state: await state(), errors }))
    app.exit(1)
  }
})
