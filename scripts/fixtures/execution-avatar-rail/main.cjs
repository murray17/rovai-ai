const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { dirname, isAbsolute, join } = require('node:path')
const { app, BrowserWindow } = require('electron')
const [renderer, userData] = process.argv.slice(2)
assert.ok(isAbsolute(renderer) && isAbsolute(userData))
mkdirSync(join(userData, 'managed-skill-library'), { recursive: true })
app.setPath('userData', userData)
app.setPath('sessionData', join(userData, 'session'))

app.whenReady().then(async () => {
  const preview = process.argv.includes('--preview')
  const window = new BrowserWindow({ title: 'Rovai 执行台 · 隔离验收', width: 1440, height: 920, useContentSize: true,
    show: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } })
  window.webContents.on('console-message', event => console.error(event.message))
  await window.loadFile(renderer)
  if (preview) return
  const run = code => window.webContents.executeJavaScript(code, true)
  const pause = () => new Promise(resolve => setTimeout(resolve, 25))
  const settle = async () => {
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    let prior = null
    let stable = 0
    for (let attempt = 0; attempt < 120; attempt++) {
      const value = await run("document.querySelector('.run-pulse-avatar-rail .run-pulse-list')?.scrollLeft ?? 0")
      stable = prior !== null && Math.abs(value - prior) < 0.2 ? stable + 1 : 0
      if (stable >= 4) return
      prior = value
      await pause()
    }
    throw new Error('Avatar rail did not settle')
  }
  const state = () => run(`(() => {
    const rail = document.querySelector('.run-pulse-avatar-rail .run-pulse-list')
    const chips = [...(rail?.querySelectorAll('.run-pulse-chip') ?? [])]
    const viewport = rail?.getBoundingClientRect()
    const rect = node => node?.getBoundingClientRect().toJSON() ?? null
    const title = document.querySelector('.run-pulse-title')
    const count = document.querySelector('.run-pulse-count')
    const selected = chips.find(chip => chip.getAttribute('aria-pressed') === 'true')
    return {
      left: rail?.scrollLeft ?? 0, maximum: rail ? rail.scrollWidth - rail.clientWidth : 0,
      count: chips.length, ids: chips.map(chip => chip.dataset.agentId),
      visible: chips.filter(chip => { const r = chip.getBoundingClientRect(); return r.left >= viewport.left + 32 && r.right <= viewport.right - 32 }).map(chip => chip.dataset.agentId),
      rects: chips.map(rect), rail: rect(rail), selected: selected?.dataset.agentId, selectedRect: rect(selected),
      focused: document.activeElement?.getAttribute('data-agent-id'),
      leftEnabled: !!document.querySelector('.run-pulse-avatar-scroll.is-left:not(:disabled)'),
      rightEnabled: !!document.querySelector('.run-pulse-avatar-scroll.is-right:not(:disabled)'),
      title: rect(title), countRect: rect(count), tooltip: document.querySelector('[role="tooltip"]')?.textContent?.trim() ?? null,
      tooltipRect: rect(document.querySelector('[role="tooltip"]')),
      header: document.querySelector('.execution-drawer-header')?.textContent,
      panel: rect(document.querySelector('.camp-detail-popover')), composer: rect(document.querySelector('.composer')),
      pageOverflow: document.documentElement.scrollWidth > innerWidth,
      timelineTop: document.querySelector('.camp-timeline')?.scrollTop,
      scrollbar: rail ? getComputedStyle(rail).scrollbarWidth : null,
      shapes: [...new Set(chips.map(chip => chip.querySelector('.run-pulse-chip-state')?.className))],
      stateIcons: chips.every(chip => chip.querySelector('.run-pulse-chip-state svg') && chip.querySelector('.run-pulse-chip-state').getAttribute('aria-label')),
      inlineNames: chips.some(chip => chip.querySelector('.run-pulse-chip-copy')),
      sameNode: !window.bookmarkedRail || window.bookmarkedRail === rail
    }
  })()`)
  const click = async (selector, waitForScroll = true) => {
    await focusWindow()
    const point = await run(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) throw new Error('Missing '+${JSON.stringify(selector)}); const r=node.getBoundingClientRect(); return { x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2) } })()`)
    window.webContents.sendInputEvent({ type: 'mouseMove', ...point })
    window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
    window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 })
    if (waitForScroll) await settle()
    return state()
  }
  const focusWindow = async () => {
    // Native keyboard input requires a focused window; DOM activeElement alone is not enough.
    if (window.isFocused() && await run('document.hasFocus()')) return
    if (!window.isFocused()) {
      app.focus({ steal: true })
      window.focus()
    }
    window.webContents.focus()
    for (let attempt = 0; attempt < 80; attempt++) {
      if (window.isFocused() && await run('document.hasFocus()')) return
      await pause()
    }
    throw new Error('Execution avatar rail fixture did not gain keyboard focus')
  }
  const key = async keyCode => {
    await focusWindow()
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode })
    if (keyCode === 'Enter') window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode })
    await settle()
    return state()
  }
  const focusAvatar = async agentId => {
    await focusWindow()
    await run(`document.querySelector('.run-pulse-avatar-rail [data-agent-id="${agentId}"]').focus({preventScroll:true})`)
    await settle()
  }
  const waitForState = async (predicate, description) => {
    for (let attempt = 0; attempt < 120; attempt++) {
      const value = await state()
      if (predicate(value)) return value
      await pause()
    }
    throw new Error(`Execution avatar rail did not reach ${description}`)
  }
  const capture = async name => writeFileSync(join(dirname(userData), `${name}.png`), (await window.webContents.capturePage()).toPNG())
  const assertVisibleSelection = value => {
    assert.ok(value.panel.height > 0 && value.rail.height > 0, 'The execution popover is visible')
    assert.ok(value.selectedRect.left >= value.rail.left - 1 && value.selectedRect.right <= value.rail.right + 1,
      `Selected avatar is clipped: ${JSON.stringify(value)}`)
  }
  const assertLayout = value => {
    assert.equal(value.pageOverflow, false)
    assert.ok(value.panel.bottom <= value.composer.top + 1, 'Popover does not cover Composer')
    assert.ok(value.title.top < value.countRect.bottom && value.countRect.top < value.title.bottom, 'Title and count stay on one line')
    assert.ok(value.rects.every(rect => Math.abs(rect.y - value.rects[0].y) < 1), 'All avatars stay on one row')
    assert.ok(value.rects.every(rect => Math.abs(rect.width - 38) < 1 && Math.abs(rect.height - 38) < 1))
    assert.equal(value.scrollbar, 'none')
    assert.equal(value.inlineNames, false)
    assert.equal(value.stateIcons, true)
  }
  const assertExecutionWidth = async () => {
    const widths = await run(`(() => {
      const body = document.querySelector('.execution-drawer-inspector .execution-drawer-body')
      const bounds = body.getBoundingClientRect()
      const boxes = [body, ...body.querySelectorAll('.execution-process-timeline, .execution-process-card, .execution-disclosure, .process-content, .process-copy, .tool-group-items')]
        .filter(node => node.checkVisibility() && node.getBoundingClientRect().height > 0)
        .map(node => ({ className: node.className, width: node.clientWidth, scrollWidth: node.scrollWidth }))
      const prose = [...body.querySelectorAll('.process-copy p, .process-copy pre')].filter(node => node.checkVisibility() && node.getBoundingClientRect().height > 0)
      const textRects = prose.flatMap(node => { const range = document.createRange(); range.selectNodeContents(node); return [...range.getClientRects()] })
      return { boxes, textFits: textRects.every(rect => rect.left >= bounds.left && rect.right <= bounds.right),
        completeProse: prose.some(node => node.textContent.endsWith('正文结束标记：完整可读。')) }
    })()`)
    assert.ok(widths.boxes.every(box => box.scrollWidth <= box.width + 1), `Execution content must fit the popover: ${JSON.stringify(widths)}`)
    assert.ok(widths.textFits, 'Long prose wraps inside the popover instead of being clipped')
    assert.ok(widths.completeProse, 'Wrapping preserves the full narration')
  }

  try {
    await focusWindow()
    await settle()
    let value = await state()
    if (value.panel.height === 0) value = await click('.camp-detail-entry[data-detail="execution"]')
    value = await waitForState(value => value.panel.height > 0 && value.rail.height > 0, 'the initial execution popover')
    assert.equal(value.count, 12)
    assertLayout(value)
    await assertExecutionWidth()
    await run("document.querySelector('.tool-group-summary').scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})")
    await settle()
    await click('.tool-group-summary')
    await assertExecutionWidth()
    await run("document.querySelector('.tool-call-summary').scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})")
    await settle()
    const command = await run(`(() => {
      const title = document.querySelector('.tool-call-title')
      return { text: title.textContent, title: title.title, width: title.clientWidth, scrollWidth: title.scrollWidth, height: title.clientHeight }
    })()`)
    assert.ok(command.width > 0 && command.scrollWidth > command.width && command.height === 28, 'Long command occupies one constrained title row')
    assert.equal(command.title, command.text, 'The full command remains available on hover and to assistive technology')
    assert.ok(command.text.startsWith('git show HEAD -- /fixture/workspace/') && command.text.endsWith('report.md'))
    await capture('execution-long-command')
    await click('.tool-call-summary')
    await assertExecutionWidth()
    assert.equal(await run(`(() => {
      const result = document.querySelector('.tool-call-result-scroll')
      return result?.textContent.startsWith('$ ' + document.querySelector('.tool-call-title').textContent)
        && result.textContent.endsWith('输出结束标记。') && result.scrollHeight > result.clientHeight
        && result.scrollWidth <= result.clientWidth + 1
    })()`), true, 'Expanded output preserves the full command and vertical scrolling without widening the popover')
    await capture('execution-long-output')
    await click('.tool-call-summary')
    assert.ok(value.rightEnabled && !value.leftEnabled)
    await focusWindow()
    value = await state()
    const hover = value.rects[0]
    window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(hover.x + hover.width / 2), y: Math.round(hover.y + hover.height / 2) })
    await waitForState(value => value.tooltip?.startsWith('洛可 · '), 'the hovered member tooltip')
    assert.ok((await state()).tooltip?.startsWith('洛可 · '), 'Hover exposes the member name and status')
    window.webContents.sendInputEvent({ type: 'mouseMove', x: 800, y: 400 })
    await capture('avatar-rail-day-1440')
    await click('[data-count="20"]')
    await click('.camp-detail-entry[data-detail="execution"]')
    value = await state()
    const order = value.ids
    const before = value.visible
    value = await click('.run-pulse-avatar-scroll.is-right')
    assert.equal(value.left, 176)
    assert.ok(value.visible.some(id => before.includes(id)), 'Adjacent views retain reference avatars')
    value = await click('.run-pulse-avatar-scroll.is-right')
    assert.equal(value.left, 352)
    value = await click('.run-pulse-avatar-scroll.is-left')
    assert.equal(value.left, 176)
    await click('.run-pulse-avatar-scroll.is-left')
    await click('.run-pulse-avatar-scroll.is-right', false)
    await click('.run-pulse-avatar-scroll.is-right', false)
    await settle()
    assert.equal((await state()).left, 352, 'Rapid clicks still advance four slots each')
    await click('.run-pulse-avatar-scroll.is-left')
    const wheel = async (deltaX, deltaY) => {
      const prior = await state()
      window.webContents.sendInputEvent({ type: 'mouseWheel', x: Math.round(prior.rail.x + prior.rail.width / 2),
        y: Math.round(prior.rail.y + 20), deltaX, deltaY, canScroll: true })
      await settle()
      const next = await state()
      assert.notEqual(next.left, prior.left)
      assert.equal(next.timelineTop, prior.timelineTop, 'Wheel only scrolls the avatar rail')
    }
    await wheel(0, -60)
    await wheel(-60, 0)

    const selectedBeforeKeyboard = (await state()).selected
    await focusAvatar('agent-8')
    value = await state()
    assert.ok(value.tooltip.includes('负责跨项目执行审查与回归验收的长名称队员'))
    assert.ok(value.tooltipRect.left >= value.rail.left - 1 && value.tooltipRect.right <= value.rail.right + 1)
    value = await key('Home')
    assert.equal(value.focused, 'agent-1')
    assert.equal(value.left, 0)
    await wheel(-60, 0)
    value = await key('Home')
    assert.equal(value.left, 0, 'Home reveals an already-focused first avatar after manual scrolling')
    value = await key('Right')
    assert.equal(value.focused, 'agent-2')
    value = await key('Left')
    assert.equal(value.focused, 'agent-1')
    value = await key('End')
    value = await waitForState(value => value.focused === 'agent-20' && value.left === value.maximum,
      'the last avatar and scroll boundary')
    assert.equal(value.focused, 'agent-20')
    assert.equal(value.left, value.maximum)
    assert.equal(value.selected, selectedBeforeKeyboard, 'Arrow navigation does not activate a different process')
    value = await key('Enter')
    assert.equal(value.selected, 'agent-20')
    assert.ok(value.header.includes('队员 20') && value.header.includes('claude-opus-4-6'))
    assertVisibleSelection(value)
    await run("window.bookmarkedRail = document.querySelector('.run-pulse-avatar-rail .run-pulse-list')")
    const scrolled = value.left
    value = await click('.run-pulse-avatar-rail [data-agent-id="agent-19"]')
    assert.equal(value.left, scrolled)
    assert.ok(value.sameNode)
    await click('[data-refresh]')
    value = await click('.camp-detail-entry[data-detail="execution"]')
    assert.deepEqual(value.ids, order, 'Status refresh must not reorder members')
    assert.equal(value.left, scrolled, 'Refresh and reopening preserve scroll position')
    assert.ok(value.sameNode)

    // Use the actual Task -> related execution route, including repeating the same target request.
    for (let attempt = 0; attempt < 2; attempt++) {
      await focusAvatar('agent-1')
      await key('Home')
      await click('.camp-detail-entry[data-detail="tasks"]')
      if (!await run("Boolean(document.querySelector('.task-related-runs button'))")) await click('.task-list-row')
      value = await click('.task-related-runs button')
      value = await waitForState(value => value.panel.height > 0 && value.selected === 'agent-20' && value.left > 0,
        'the related execution in the visible popover')
      assert.equal(value.selected, 'agent-20')
      assertVisibleSelection(value)
      assert.ok(value.left > 0 && value.sameNode)
    }

    await click('[data-count="8"]')
    value = await click('.camp-detail-entry[data-detail="execution"]')
    assert.equal(value.maximum, 0)
    assert.ok(!value.leftEnabled && !value.rightEnabled)
    assertLayout(value)
    await capture('avatar-rail-eight-members')

    await click('[data-count="12"]')
    await click('[data-theme-toggle]')
    await click('.camp-detail-entry[data-detail="execution"]')
    await click('.run-pulse-avatar-rail [data-agent-id="agent-1"]')
    await click('.execution-disclosure.worked > summary')
    await assertExecutionWidth()
    await capture('avatar-rail-night-1440')
    window.webContents.debugger.attach('1.3')
    for (const [width, height] of [[1040, 700], [2560, 1440], [720, 460]]) {
      await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      await settle()
      assertLayout(await state())
      await assertExecutionWidth()
      if (width === 1040) await capture('avatar-rail-night-1040')
    }
    await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1440, height: 920, deviceScaleFactor: 1, mobile: false })
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await focusAvatar('agent-1')
    await key('Home')
    value = await click('.run-pulse-avatar-scroll.is-right')
    assert.equal(value.left, value.maximum)
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] })
    assert.equal(await run("getComputedStyle(document.querySelector('.run-pulse-avatar-rail .run-pulse-list')).maskImage"), 'none')
    await capture('avatar-rail-forced-colors')
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] })
    await click('.run-pulse-inspector .execution-placement-button')
    assert.equal(await run("document.querySelectorAll('.run-pulse-bottom .run-pulse-chip-copy').length"), 12)
    assert.equal(await run("document.querySelector('.run-pulse-avatar-rail') === null"), true)

    console.log(JSON.stringify({ ok: true, cases: ['12/20-member overflow', '176px steps and overlap', 'mouse wheel/trackpad', 'keyboard and long-name tooltip',
      'selection and node retention', 'status refresh/reopen', 'Task navigation/repeated target', '8-member no overflow',
      'long prose containment', 'single-line command and full expanded output',
      'Day/Night', '1040/1440/2560/200% layout', 'reduced motion', 'forced colors', 'bottom dock unchanged'] }))
    window.destroy()
    app.quit()
  } catch (error) {
    console.error(await state())
    await capture('failure')
    throw error
  }
}).catch(error => { console.error(error); app.exit(1) })
app.on('window-all-closed', () => app.quit())
