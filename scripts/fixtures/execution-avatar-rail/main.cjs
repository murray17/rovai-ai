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
    show: process.platform === 'linux' || preview || process.env.ROVAI_SHOW_EXECUTION_AVATAR_FIXTURE === '1',
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
    const allChips = [...(rail?.querySelectorAll('.run-pulse-chip') ?? [])]
    const chips = allChips.filter(chip => chip.dataset.agentId !== '__execution_overview__')
    const overview = allChips.find(chip => chip.dataset.agentId === '__execution_overview__')
    const viewport = rail?.getBoundingClientRect()
    const rect = node => node?.getBoundingClientRect().toJSON() ?? null
    const title = document.querySelector('.run-pulse-title')
    const count = document.querySelector('.run-pulse-count')
    const selected = allChips.find(chip => chip.getAttribute('aria-pressed') === 'true')
    const dock = document.querySelector('.run-pulse-inspector')
    const placement = dock?.querySelector('.execution-placement-control')
    return {
      left: rail?.scrollLeft ?? 0, maximum: rail ? rail.scrollWidth - rail.clientWidth : 0,
      count: chips.length, ids: chips.map(chip => chip.dataset.agentId),
      overviewCount: overview ? 1 : 0,
      visible: chips.filter(chip => { const r = chip.getBoundingClientRect(); return r.left >= viewport.left + 32 && r.right <= viewport.right - 32 }).map(chip => chip.dataset.agentId),
      rects: chips.map(rect), rail: rect(rail), selected: selected?.dataset.agentId, selectedRect: rect(selected),
      focused: document.activeElement?.getAttribute('data-agent-id'),
      leftEnabled: !!document.querySelector('.run-pulse-avatar-scroll.is-left:not(:disabled)'),
      rightEnabled: !!document.querySelector('.run-pulse-avatar-scroll.is-right:not(:disabled)'),
      title: rect(title), countRect: rect(count), tooltip: document.querySelector('[role="tooltip"]')?.textContent?.trim() ?? null,
      tooltipRect: rect(document.querySelector('[role="tooltip"]')),
      header: document.querySelector('.execution-drawer-header')?.textContent,
      dock: rect(dock), placement: rect(placement),
      panel: rect(document.querySelector('.camp-detail-popover')), composer: rect(document.querySelector('.conversation-controls .composer-box')),
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
  const openDetail = async tab => {
    const selector = `.camp-detail-entry[data-detail="${tab}"]`
    const expanded = await run(`document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-expanded') === 'true'
      && document.querySelector('.camp-detail-popover')?.hidden === false`)
    return expanded ? state() : click(selector)
  }
  const focusWindow = async () => {
    // Hidden macOS fixtures accept native WebContents input without stealing desktop focus.
    if (!window.isVisible()) {
      window.webContents.focus()
      return
    }
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
    assert.equal(value.title, null, 'The execution popover does not repeat the execution-console title')
    assert.equal(value.countRect, null, 'The avatar rail does not repeat a second execution count')
    assert.equal(value.overviewCount, 1, 'The avatar rail keeps one explicit overview entry')
    assert.ok(value.dock.left >= value.panel.left - 1 && value.dock.right <= value.panel.right + 1,
      'The one-row execution rail stays inside the popover')
    assert.ok(Math.abs((value.rail.top + value.rail.height / 2)
      - (value.placement.top + value.placement.height / 2)) <= 1,
    'The avatar rail and placement control share one vertical center')
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
      // Inline-code decoration can extend into card padding without clipping prose.
      // Check the containing surfaces for overflow, then measure every text fragment below.
      const boxes = [body, ...body.querySelectorAll('.execution-process-timeline, .execution-process-card, .tool-group-items')]
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
    const entryState = () => run(`(() => {
      const entry = document.querySelector('.camp-execution-entry')
      const rect = entry.getBoundingClientRect()
      const arcs = [...entry.querySelectorAll('.camp-execution-orbits rect')]
      return { text: entry.textContent, label: entry.getAttribute('aria-label'), expanded: entry.getAttribute('aria-expanded'),
        memberText: document.querySelector('.camp-detail-entry[data-detail="members"]')?.textContent ?? null,
        portraits: [...entry.querySelectorAll('.member-avatar')].map(avatar => avatar.getBoundingClientRect().width),
        overflow: entry.querySelector('.camp-execution-overflow')?.textContent ?? null,
        totalBadge: !!entry.querySelector('small'), nestedButtons: entry.querySelectorAll('button').length,
        height: rect.height, fits: rect.left >= 0 && rect.right <= innerWidth,
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
        arcs: arcs.map(arc => ({ length: arc.getTotalLength(), pathLength: arc.getAttribute('pathLength'),
          dash: getComputedStyle(arc).strokeDasharray, width: getComputedStyle(arc).strokeWidth,
          stroke: getComputedStyle(arc).stroke, period: getComputedStyle(arc).animationDuration,
          animations: arc.getAnimations().length })),
        expectedColors: ['--brand', '--ember'].map(name => getComputedStyle(document.documentElement).getPropertyValue(name).trim()),
        tooltip: document.querySelector('.camp-execution-tooltip')?.textContent ?? null }
    })()`)
    const entryCount = async count => {
      await run(`(() => { const select = document.querySelector('[data-entry-running-count]');
        select.value = '${count}'; select.dispatchEvent(new Event('change', { bubbles: true })) })()`)
      await settle()
      return entryState()
    }
    for (const count of [0, 1, 2, 3, 5]) {
      const entry = await entryCount(count)
      assert.equal(entry.portraits.length, Math.min(count, 3), 'One avatar per running member, capped at three')
      assert.ok(entry.portraits.every(width => width === 20))
      assert.equal(entry.overflow, count > 3 ? `+${count - 3}` : null)
      assert.equal(entry.totalBadge, count === 0, 'Idle execution restores the executed-member count')
      assert.equal(entry.nestedButtons, 0)
      assert.equal(entry.height, 28)
      assert.equal(entry.fits, true)
      assert.equal(entry.arcs.length, count > 0 ? 2 : 0)
      if (count) {
        assert.ok(entry.label.includes(`${count} 位队员正在执行`))
        assert.equal(entry.arcs[0].length, entry.arcs[1].length)
        assert.ok(entry.arcs.every(arc => arc.pathLength === '100' && arc.dash === '24px, 76px'
          && arc.width === '1.65px' && arc.period === '4.8s'))
      } else {
        assert.equal(entry.text, '执行12')
        assert.equal(entry.memberText, '队员13', 'Execution history count stays independent from the roster count')
        assert.ok(entry.label.includes('共 12 位队员有执行记录'))
      }
      await capture(`execution-entry-${count}-day`)
    }
    await click('.camp-detail-heading button[aria-label="收起会话详情"]')
    assert.equal((await entryState()).arcs.length, 2, 'Closing the popover does not end the running indicator')
    await run("document.querySelector('.camp-execution-entry').blur(); document.querySelector('.camp-execution-entry').focus()")
    await settle()
    assert.ok((await entryState()).tooltip.includes('言川'), 'Keyboard focus exposes names beyond the three displayed avatars')
    await key('Escape')
    assert.equal((await entryState()).tooltip, null)
    await key('Enter')
    assert.equal((await entryState()).expanded, 'true')
    assert.equal(await run("document.activeElement === document.querySelector('.camp-detail-popover')"), true)
    assert.equal((await entryCount(0)).text, '执行12', 'Ending the last run restores the executed-member count')
    await click('.camp-detail-heading button[aria-label="收起会话详情"]')
    await key('Enter')
    assert.equal((await entryState()).expanded, 'true', 'Idle execution entry still opens history')
    await entryCount(5)
    await click('[data-theme-toggle]')
    const nightEntry = await entryState()
    assert.deepEqual(nightEntry.arcs.map(arc => arc.stroke), nightEntry.expectedColors.map(hex =>
      `rgb(${[1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16)).join(', ')})`))
    const orbitOffsets = async milliseconds => {
      await run(`(() => {
        document.querySelectorAll('.camp-execution-orbits rect').forEach(arc => {
          const animation = arc.getAnimations()[0]; animation.pause(); animation.currentTime = ${milliseconds}
        })
      })()`)
      await settle()
      return run("[...document.querySelectorAll('.camp-execution-orbits rect')].map(arc => parseFloat(getComputedStyle(arc).strokeDashoffset))")
    }
    const startOffsets = await orbitOffsets(0)
    const quarterOffsets = await orbitOffsets(1200)
    assert.deepEqual(startOffsets, [0, 50])
    assert.deepEqual(quarterOffsets, [-25, 25], 'Both arcs advance equally around the outline, half a loop apart')
    await capture('execution-entry-5-night')
    window.webContents.debugger.attach('1.3')
    for (const [width, height] of [[1040, 700], [720, 460]]) {
      await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      await settle()
      const entry = await entryState()
      assert.ok(entry.fits && !entry.pageOverflow)
      await capture(`execution-entry-night-${width}`)
    }
    await window.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride')
    window.webContents.setZoomFactor(2)
    await settle()
    assert.ok((await entryState()).fits && !(await entryState()).pageOverflow, 'Entry fits at actual 200% zoom')
    await capture('execution-entry-night-200-percent')
    window.webContents.setZoomFactor(1)
    await settle()
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await settle()
    assert.ok((await entryState()).arcs.every(arc => arc.animations === 0), 'Reduced motion keeps stationary arcs')
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] })
    await settle()
    assert.ok((await entryState()).arcs.every(arc => arc.animations === 0), 'Forced colors keeps stationary arcs')
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] })
    await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1440, height: 920, deviceScaleFactor: 1, mobile: false })
    await settle()
    await click('[data-theme-toggle]')
    await entryCount('mixed')
    let value = await state()
    if (value.panel.height === 0) value = await click('.camp-detail-entry[data-detail="execution"]')
    value = await waitForState(value => value.panel.height > 0 && value.rail.height > 0, 'the initial execution popover')
    assert.equal(value.count, 12)
    assert.equal(value.selected, '__execution_overview__', 'Workspace entry selects the execution overview')
    const entryRunSelection = await run(`(() => {
      const stage = document.querySelector('.execution-process-stage[aria-current="step"]')
      return { id: stage?.dataset.agentRunId ?? null,
        expanded: stage?.querySelector('.execution-run-toggle')?.getAttribute('aria-expanded') ?? null }
    })()`)
    assert.deepEqual(entryRunSelection, { id: 'run-agent-3', expanded: 'true' },
      'The overview preserves the exact latest running Run target')
    assertLayout(value)
    await assertExecutionWidth()

    value = await click('.conversation-controls .composer-box')
    assert.ok(value.panel.height > 0, 'Outside pointer interaction keeps the execution popover open')
    await run("document.querySelector('.conversation-controls .structured-mention-editor').focus({ preventScroll: true })")
    await settle()
    value = await state()
    assert.ok(value.panel.height > 0, 'Moving focus outside keeps the execution popover open')
    value = await key('Escape')
    assert.equal(value.panel.height, 0, 'Escape closes the execution popover')
    value = await click('.camp-detail-entry[data-detail="execution"]')
    assert.ok(value.panel.height > 0, 'The execution entry reopens the popover')
    await run("document.querySelector('.conversation-controls .structured-mention-editor').focus({ preventScroll: true })")
    await settle()
    value = await key('Escape')
    assert.equal(value.panel.height, 0, 'Escape closes a manually opened execution popover')
    assert.equal(await run("document.activeElement === document.querySelector('.camp-detail-entry[data-detail=\"execution\"]')"), true,
      'Escape returns focus to the execution entry after a manual open')
    value = await click('.camp-detail-entry[data-detail="execution"]')
    value = await click('.camp-detail-heading button[aria-label="收起会话详情"]')
    assert.equal(value.panel.height, 0, 'The explicit close button closes the execution popover')
    assert.equal(await run("document.activeElement === document.querySelector('.camp-detail-entry[data-detail=\"execution\"]')"), true,
      'The explicit close button returns focus to the execution entry')
    value = await click('.camp-detail-entry[data-detail="execution"]')
    assert.ok(value.panel.height > 0, 'The execution popover reopens after explicit dismissal')
    if (process.argv.includes('--dismissal-only')) {
      console.log(JSON.stringify({ ok: true, cases: [
        'persistent outside pointer/focus',
        'explicit close and Escape focus return'
      ] }))
      window.destroy()
      app.quit()
      return
    }

    await click('.run-pulse-avatar-rail [data-agent-id="agent-1"]')
    const runInputSelector = '[data-agent-run-id="run-agent-1"] .execution-batch-count'
    const runInputTrigger = await run(`(() => {
      const button = document.querySelector(${JSON.stringify(runInputSelector)})
      const icon = button?.querySelector('svg')
      return { label: button?.getAttribute('aria-label'), nested: !!button?.closest('.execution-run-toggle'),
        iconViewBox: icon?.getAttribute('viewBox'), iconPath: icon?.querySelector('path')?.getAttribute('d'),
        fontSize: button ? getComputedStyle(button).fontSize : null,
        fontWeight: button ? getComputedStyle(button).fontWeight : null }
    })()`)
    assert.equal(runInputTrigger.label, '查看本次执行的 3 条输入')
    assert.equal(runInputTrigger.nested, false, 'The Run input count is an independent button')
    assert.equal(runInputTrigger.iconViewBox, '0 0 24 24')
    assert.equal(runInputTrigger.iconPath, 'm12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 17l10 5 10-5')
    assert.equal(runInputTrigger.fontSize, '10.5px')
    assert.equal(runInputTrigger.fontWeight, '400')
    await run(`document.querySelector(${JSON.stringify(runInputSelector)}).scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})`)
    await settle()
    await click(runInputSelector)
    let inputPopover = await run(`(() => {
      const popup = document.querySelector('.execution-input-popover')
      return { items: popup?.querySelectorAll('.execution-input-list > li').length ?? 0,
        text: popup?.textContent ?? '', focused: !!popup?.contains(document.activeElement),
        locateIcons: popup?.querySelectorAll('.execution-input-locate-icon').length ?? 0 }
    })()`)
    assert.equal(inputPopover.items, 3)
    assert.equal(inputPopover.locateIcons, 3)
    assert.ok(inputPopover.text.includes('第 1 条合批输入') && inputPopover.text.includes('第 3 条合批输入'))
    assert.equal(inputPopover.focused, true, 'Keyboard focus enters the input popover')
    await capture('run-input-popover-day')
    await key('Escape')
    assert.equal(await run(`document.activeElement === document.querySelector(${JSON.stringify(runInputSelector)})`), true,
      'Closing the Run input popover returns focus to its count button')

    await click('.run-pulse-avatar-rail [data-agent-id="__execution_overview__"]')
    const cardGeometry = await run(`(() => {
      const stage = document.querySelector('[data-agent-run-id="run-agent-1"]')
      const node = stage.querySelector('.execution-process-node').getBoundingClientRect()
      const header = stage.querySelector('.execution-run-card-header').getBoundingClientRect()
      const card = stage.querySelector('.execution-process-card').getBoundingClientRect()
      const lastOperation = stage.querySelector('.execution-run-operations button:last-child').getBoundingClientRect()
      const avatars = [...document.querySelectorAll('.execution-run-toggle .member-avatar')]
        .filter(avatar => avatar.checkVisibility())
        .map(avatar => avatar.getBoundingClientRect().toJSON())
      return { centerDelta: Math.abs(node.y + node.height / 2 - (header.y + header.height / 2)),
        rightInset: card.right - lastOperation.right, avatars }
    })()`)
    assert.ok(cardGeometry.centerDelta <= 1, `Run status node is not centered: ${JSON.stringify(cardGeometry)}`)
    assert.ok(cardGeometry.rightInset >= 9, `Run actions need a 9px right inset: ${JSON.stringify(cardGeometry)}`)
    assert.ok(cardGeometry.avatars.length > 0
      && cardGeometry.avatars.every(rect => rect.width === 20 && rect.height === 20),
    `Overview avatars must stay square: ${JSON.stringify(cardGeometry)}`)
    await capture('execution-overview-geometry-day')

    await click('[data-recipient-count="1"]')
    await click('.run-pulse-avatar-rail [data-agent-id="agent-2"]')
    const deliveryInputSelector = '[data-delivery-queue-agent-id="agent-2"] .execution-batch-count'
    const deliveryQueue = await run(`(() => {
      const card = document.querySelector('[data-delivery-queue-agent-id="agent-2"]')
      const button = card?.querySelector('.execution-batch-count')
      return { present: !!card, label: button?.getAttribute('aria-label'),
        nested: !!button?.closest('.execution-run-toggle'), stopButtons: card?.querySelectorAll('.is-danger').length ?? 0 }
    })()`)
    assert.equal(deliveryQueue.present, true, 'Waiting Deliveries appear in the execution console')
    assert.equal(deliveryQueue.label, '查看排队消息的 2 条输入')
    assert.equal(deliveryQueue.nested, false, 'The waiting-message count is an independent button')
    assert.equal(deliveryQueue.stopButtons, 0, 'A waiting Delivery is not presented as a stoppable AgentRun')
    assert.equal(await run("document.querySelectorAll('.conversation-bubble.user .message-delivery-footer').length"), 0,
      'Human Delivery inputs stay available to queue cards without an Agent handoff footer')
    await run(`document.querySelector(${JSON.stringify(deliveryInputSelector)}).scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})`)
    await settle()
    await click(deliveryInputSelector)
    inputPopover = await run(`(() => {
      const popup = document.querySelector('.execution-input-popover')
      return { items: popup?.querySelectorAll('.execution-input-list > li').length ?? 0,
        text: popup?.textContent ?? '', focused: !!popup?.contains(document.activeElement) }
    })()`)
    assert.equal(inputPopover.items, 2)
    assert.ok(inputPopover.text.includes('第 2 条合批输入') && inputPopover.text.includes('第 3 条合批输入'))
    assert.equal(inputPopover.focused, true)
    await capture('delivery-queue-popover-day')
    await key('Escape')
    await click('[data-recipient-count="0"]')
    await click('.run-pulse-avatar-rail [data-agent-id="agent-1"]')

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
    value = await openDetail('execution')
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
    assert.equal(value.focused, '__execution_overview__')
    assert.equal(value.left, 0)
    await wheel(-60, 0)
    value = await key('Home')
    assert.equal(value.left, 0, 'Home reveals an already-focused first avatar after manual scrolling')
    value = await key('Right')
    assert.equal(value.focused, 'agent-1')
    value = await key('Left')
    assert.equal(value.focused, '__execution_overview__')
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
    await click('.camp-detail-heading button[aria-label="收起会话详情"]')
    value = await openDetail('execution')
    assert.deepEqual(value.ids, order, 'Status refresh must not reorder members')
    assert.equal(value.left, scrolled, 'Refresh and reopening preserve scroll position')
    assert.ok(value.sameNode)

    // Use the actual Task -> related execution route, including repeating the same target request.
    for (let attempt = 0; attempt < 2; attempt++) {
      await focusAvatar('agent-1')
      await key('Home')
      await openDetail('tasks')
      if (!await run("Boolean(document.querySelector('.task-related-runs button'))")) await click('.task-list-row')
      value = await click('.task-related-runs button')
      value = await waitForState(value => value.panel.height > 0 && value.selected === 'agent-20' && value.left > 0,
        'the related execution in the visible popover')
      assert.equal(value.selected, 'agent-20')
      assertVisibleSelection(value)
      assert.ok(value.left > 0 && value.sameNode)
    }

    await click('[data-count="8"]')
    value = await openDetail('execution')
    assert.ok(value.maximum > 0 && (value.leftEnabled || value.rightEnabled),
      'Eight members plus overview remain scrollable when the placement control shares the row')
    assertLayout(value)
    await capture('avatar-rail-eight-members')

    await click('[data-count="12"]')
    await click('[data-theme-toggle]')
    await openDetail('execution')
    await click('.run-pulse-avatar-rail [data-agent-id="agent-3"]')
    await assertExecutionWidth()
    await capture('avatar-rail-night-1440')
    if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach('1.3')
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
    value = await key('End')
    assert.equal(value.left, value.maximum)
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] })
    assert.equal(await run("getComputedStyle(document.querySelector('.run-pulse-avatar-rail .run-pulse-list')).maskImage"), 'none')
    await capture('avatar-rail-forced-colors')
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] })
    await key('Home')
    await key('Right')
    await key('Enter')
    await click('.run-pulse-inspector .execution-placement-button')
    await click('.execution-placement-option[data-placement="bottom"]')
    assert.equal(await run("document.querySelectorAll('.run-pulse-bottom .run-pulse-chip-copy').length"), 13,
      'The bottom dock keeps Overview plus all twelve member cards')
    assert.equal(await run("document.querySelector('.run-pulse-bottom').getBoundingClientRect().height"), 55,
      'The hidden horizontal scrollbar does not make the restored bottom rail taller')
    assert.equal(await run("document.querySelector('.run-pulse-avatar-rail') === null"), true)
    assert.equal(await run(`(() => {
      const placement = document.querySelector('.run-pulse-bottom .execution-placement-button').getBoundingClientRect()
      const collapse = document.querySelector('.run-pulse-bottom .execution-bottom-collapse-button').getBoundingClientRect()
      return placement.width >= 30 && placement.right <= collapse.left
    })()`), true, 'Bottom placement and collapse controls keep separate hit targets')

    // Collaboration recipients are a separate identity row, not the process-selection rail.
    const recipients = () => run(`(() => {
      const row = document.querySelector('[data-agent-run-id="run-agent-1"] .execution-run-recipients')
      const avatars = [...(row?.querySelectorAll('[data-recipient-id]') ?? [])]
      const overflow = row?.querySelector('.execution-recipient-overflow')
      const popup = document.querySelector('.execution-recipient-popover')
      return { row: row?.getBoundingClientRect().toJSON() ?? null,
        ids: avatars.map(node => node.dataset.recipientId),
        names: avatars.map(node => node.getAttribute('aria-label')),
        rects: [...avatars, ...(overflow ? [overflow] : [])].map(node => node.getBoundingClientRect().toJSON()),
        portraits: avatars.map(node => node.querySelector('.member-avatar').getBoundingClientRect().width),
        hidden: Number(overflow?.textContent.slice(1) ?? 0),
        popupNames: [...(popup?.querySelectorAll('li > span:last-child') ?? [])].map(node => node.textContent),
        popup: popup?.getBoundingClientRect().toJSON() ?? null,
        tooltip: document.querySelector('.execution-recipient-tooltip')?.textContent ?? null,
        focused: document.activeElement?.className,
        drawer: Boolean(document.querySelector('.execution-drawer')),
        pageOverflow: document.documentElement.scrollWidth > innerWidth }
    })()`)
    const assertRecipients = async total => {
      const value = await recipients()
      assert.equal(value.ids.length + value.hidden, total)
      assert.equal(new Set(value.ids).size, value.ids.length, 'Repeated sends occupy one avatar')
      assert.ok(!value.ids.includes('agent-1'), 'Incoming deliveries are not owned by the receiving run')
      assert.ok(value.rects.every(rect => Math.abs(rect.y - value.rects[0].y) < 1), 'Recipients remain on one line')
      assert.ok(value.rects.every(rect => rect.left >= value.row.left && rect.right <= value.row.right), 'No partial avatars')
      assert.ok(value.portraits.every(width => width === 24))
      assert.equal(value.pageOverflow, false)
      return value
    }
    const revealRecipients = async () => {
      await run("document.querySelector('.execution-run-recipients')?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})")
      await settle()
    }
    await click('[data-recipient-count="2"]')
    if (!await run("document.querySelector('.execution-history-toggle')?.getAttribute('aria-expanded') === 'true'")) {
      await click('.execution-history-toggle')
    }
    await revealRecipients()
    assert.deepEqual((await assertRecipients(2)).ids, ['agent-2', 'agent-3'])
    await capture('delivery-avatars-bottom-night')
    await click('[data-recipient-count="0"]')
    assert.equal((await recipients()).row, null, 'No empty collaboration label')
    await click('[data-recipient-count="1"]')
    await assertRecipients(1)
    await click('[data-recipient-count="48"]')
    await revealRecipients()
    assert.ok((await assertRecipients(48)).hidden > 0, 'Bottom dock also uses overflow disclosure')
    await click('.execution-recipient-overflow')
    let recipientState = await recipients()
    assert.equal(recipientState.popupNames.length, recipientState.hidden)
    assert.equal(recipientState.focused, 'execution-recipient-close')
    await key('Tab')
    assert.equal((await recipients()).focused, 'execution-recipient-list')
    await key('PageDown')
    assert.equal(await run("document.querySelector('.execution-recipient-list').scrollTop > 0"), true)
    await key('Escape')
    recipientState = await recipients()
    assert.ok(recipientState.drawer && !recipientState.popup)
    assert.equal(recipientState.focused, 'execution-recipient-overflow')
    await run("document.querySelector('.execution-recipient-avatar').focus({preventScroll:true})")
    await settle()
    assert.equal((await recipients()).tooltip, '沐瓦')
    await key('Escape')
    assert.ok((await recipients()).drawer && !(await recipients()).tooltip, 'Name Escape preserves execution detail')

    await run("window.deliveryDrawer = document.querySelector('.execution-drawer')")
    await click('.run-pulse-bottom .execution-placement-button')
    await click('.execution-placement-option[data-placement="inspector"]')
    assert.equal(await run("window.deliveryDrawer === document.querySelector('.execution-drawer')"), true)
    await click('[data-recipient-count="16"]')
    await click('[data-theme-toggle]')
    await openDetail('execution')
    await revealRecipients()
    await assertRecipients(16)
    await capture('delivery-avatars-popover-day')
    await click('.execution-recipient-overflow')
    await capture('delivery-overflow-list-day')
    await click('.execution-recipient-close')
    assert.ok((await recipients()).drawer && !(await recipients()).popup)
    await click('[data-theme-toggle]')
    await openDetail('execution')
    for (const [width, height] of [[1040, 700], [720, 460], [1440, 920]]) {
      await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      await settle()
      await revealRecipients()
      await assertRecipients(16)
      if (width === 1040) await capture('delivery-avatars-popover-night-1040')
    }
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await assertRecipients(16)
    await capture('delivery-avatars-popover-night-1440')

    await key('Escape')
    await click('[data-recipient-count="1"]')
    await click('[data-title-scenario]')
    await openDetail('execution')
    const titleStage = '[data-agent-run-id="run-agent-3"]'
    const hoverTitle = async () => {
      const point = await run(`(() => { const r = document.querySelector('${titleStage} .execution-run-card-header').getBoundingClientRect();
        return { x: Math.round(r.x + 30), y: Math.round(r.y + r.height / 2) } })()`)
      const zoom = window.webContents.getZoomFactor()
      window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(point.x * zoom), y: Math.round(point.y * zoom) })
      await settle()
    }
    const hoverBody = async () => {
      const point = await run(`(() => { const r = document.querySelector('${titleStage} .execution-run-card-header').getBoundingClientRect();
        return { x: Math.round(r.x + 30), y: Math.round(r.bottom + 15) } })()`)
      const zoom = window.webContents.getZoomFactor()
      window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(point.x * zoom), y: Math.round(point.y * zoom) })
      await settle()
    }
    const titleGeometry = () => run(`(() => {
      const body = document.querySelector('.execution-drawer-body')
      const stage = document.querySelector('${titleStage}')
      const header = stage.querySelector('.execution-run-card-header')
      const stop = header.querySelector('.is-danger')
      const rect = element => element.getBoundingClientRect().toJSON()
      const button = rect(stop)
      return { body: rect(body), header: rect(header), card: rect(stage.querySelector('article')),
        stop: button, stopVisible: stop.contains(document.elementFromPoint(button.x + button.width / 2, button.y + button.height / 2)),
        heading: !!header.querySelector('h3 .execution-run-toggle'),
        weight: getComputedStyle(header.querySelector('.execution-run-summary')).fontWeight,
        operationsOpacity: getComputedStyle(header.querySelector('.execution-run-operations')).opacity,
        metricOpacity: getComputedStyle(header.querySelector('.execution-run-metric')).opacity,
        metricDisplay: getComputedStyle(header.querySelector('.execution-run-metric')).display,
        summary: rect(header.querySelector('.execution-run-summary')),
        background: getComputedStyle(header).backgroundColor,
        canvas: getComputedStyle(document.querySelector('.execution-drawer')).backgroundColor,
        cardBackground: getComputedStyle(stage.querySelector('article')).backgroundColor,
        stopColor: getComputedStyle(stop).color,
        danger: getComputedStyle(document.documentElement).getPropertyValue('--danger').trim(),
        collapseBorder: getComputedStyle(header.querySelector('.execution-run-operations button')).borderTopWidth,
        overflow: body.scrollWidth > body.clientWidth, scrollTop: body.scrollTop }
    })()`)
    for (const placement of ['inspector', 'right', 'bottom']) {
      if (await run("document.querySelector('.execution-drawer')?.dataset.placement") !== placement) {
        await click('.run-pulse .execution-placement-button')
        await click(`.execution-placement-option[data-placement="${placement}"]`)
      }
      for (const theme of ['day', 'night']) {
        await run(`document.documentElement.dataset.theme = '${theme}'`)
        for (const [width, height] of [[1440, 920], [1040, 700]]) {
          await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
          await settle()
          await click('.run-pulse [data-agent-id="__execution_overview__"]')
          const overview = await run(`(() => {
            const mark = document.querySelector('.execution-overview-mark')
            const title = document.querySelector('#execution-drawer-title').getBoundingClientRect()
            const r = mark.getBoundingClientRect()
            return { centerDelta: Math.abs(r.y + r.height / 2 - title.y - title.height / 2),
              marks: [...document.querySelectorAll('.run-pulse-overview-mark, .execution-overview-mark')]
                .filter(el => el.checkVisibility()).map(el => ({ rects: el.querySelectorAll('svg rect').length,
                  radius: getComputedStyle(el).borderRadius, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })) }
          })()`)
          assert.ok(overview.centerDelta <= 1, `Overview is vertically centered: ${JSON.stringify(overview)}`)
          assert.equal(overview.marks.length, 2)
          assert.ok(overview.marks.every(mark => mark.rects === 4 && mark.radius === '6px' && mark.width === mark.height))
          await run(`(() => {
            const stage = document.querySelector('${titleStage}')
            const toggle = stage.querySelector('.execution-run-toggle')
            if (toggle.getAttribute('aria-expanded') !== 'true') toggle.click()
          })()`)
          await settle()
          await run(`(() => {
            const body = document.querySelector('.execution-drawer-body')
            const stage = document.querySelector('${titleStage}')
            body.scrollTop += stage.getBoundingClientRect().top - body.getBoundingClientRect().top + 220
          })()`)
          await settle()
          await run('document.activeElement?.blur()')
          await hoverBody()
          const idle = await titleGeometry()
          assert.equal(idle.operationsOpacity, '0', 'Body hover leaves actions hidden')
          assert.equal(idle.metricOpacity, '1', 'Elapsed is visible by default, including narrow panels')
          assert.notEqual(idle.metricDisplay, 'none')
          assert.equal(idle.background, idle.canvas, 'Every title shares the conversation surface')
          assert.equal(idle.cardBackground, idle.canvas, 'Running cards have no tinted fill')
          await hoverTitle()
          const geometry = await titleGeometry()
          assert.ok(Math.abs(geometry.header.top - geometry.body.top) <= 1, `Title pins to its scrollport: ${JSON.stringify(geometry)}`)
          assert.ok(geometry.stopVisible && geometry.heading && geometry.weight === '600' && !geometry.overflow, JSON.stringify(geometry))
          assert.equal(geometry.operationsOpacity, '1', 'Title hover reveals stop and collapse')
          assert.equal(geometry.metricOpacity, '0', 'Title hover replaces elapsed')
          assert.equal(geometry.collapseBorder, '1px', 'Collapse retains its V15 border')
          assert.equal(geometry.summary.width, idle.summary.width, 'Hover does not reflow the title')
          assert.equal(await run(`(() => { const probe = document.createElement('span'); probe.style.color = 'var(--danger)'; document.body.append(probe);
            const color = getComputedStyle(probe).color; probe.remove(); return color })()`), geometry.stopColor, 'Stop is red before button hover')
          assert.ok(geometry.card.right - geometry.stop.right >= 9, 'Sticky actions retain the right inset')
          // The same identity path/stroke is used in the entry, receipt and the active placement.
          const icons = await run(`(() => {
            const selectors = ['.camp-execution-entry > svg:not(.camp-execution-orbits)', '.user-message-receipt.is-progress svg',
              '${placement === 'right' ? '.file-preview-execution-icon' : placement === 'bottom' ? '.run-pulse-bottom-caption svg' : '.camp-detail-heading > svg'}']
            return selectors.map(selector => document.querySelector(selector)).filter(Boolean).map(icon => ({
              viewBox: icon.getAttribute('viewBox'), path: icon.querySelector('path')?.getAttribute('d'), stroke: getComputedStyle(icon).strokeWidth }))
          })()`)
          assert.ok(icons.length === (placement === 'bottom' ? 2 : 3) && icons.every(icon => icon.viewBox === '0 0 24 24'
            && icon.path === 'M3 12h4l3-8 4 16 3-8h4' && icon.stroke === '1.65px'), JSON.stringify(icons))
          await capture(`title-${placement}-${theme}-${width}`)
        }
      }
      await click('.run-pulse [data-agent-id="agent-3"]')
      await run(`(() => { const body = document.querySelector('.execution-drawer-body');
        const stage = document.querySelector('${titleStage}');
        body.scrollTop += stage.getBoundingClientRect().top - body.getBoundingClientRect().top + 220 })()`)
      await settle()
      await hoverTitle()
      const single = await titleGeometry()
      assert.ok(single.stopVisible && Math.abs(single.header.top - single.body.top) <= 1, 'Single-member view shares the sticky title')
      await capture(`title-${placement}-single-member`)
      await window.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride')
      window.webContents.setZoomFactor(2)
      await settle()
      await run(`(() => { const body = document.querySelector('.execution-drawer-body');
        const stage = document.querySelector('${titleStage}');
        body.scrollTop += stage.getBoundingClientRect().top - body.getBoundingClientRect().top + 220 })()`)
      await settle()
      await hoverTitle()
      const zoom = await titleGeometry()
      assert.ok(zoom.stopVisible && !zoom.overflow && Math.abs(zoom.header.top - zoom.body.top) <= 1, `Sticky controls fit at actual 200% zoom: ${JSON.stringify(zoom)}`)
      await capture(`title-${placement}-200-percent`)
      window.webContents.setZoomFactor(1)
      await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1040, height: 700, deviceScaleFactor: 1, mobile: false })
      await settle()
      await click('.run-pulse [data-agent-id="__execution_overview__"]')
      await hoverBody()
      await run(`document.querySelector('${titleStage} .execution-run-toggle').focus()`)
      await key('Tab')
      assert.equal((await titleGeometry()).operationsOpacity, '1', 'Keyboard focus reveals header operations')
      // Natural keyboard focus must reveal content below the sticky title.
      await run(`(() => {
        const body = document.querySelector('.execution-drawer-body')
        const target = document.querySelector('${titleStage} .tool-group-summary')
        body.scrollTop += target.getBoundingClientRect().top - body.getBoundingClientRect().top - 20
        target.focus()
      })()`)
      await settle()
      const focusClear = await run(`(() => {
        const focused = document.activeElement.getBoundingClientRect()
        const header = document.querySelector('${titleStage} .execution-run-card-header').getBoundingClientRect()
        const body = document.querySelector('.execution-drawer-body').getBoundingClientRect()
        return focused.top >= header.bottom && focused.bottom <= body.bottom
      })()`)
      assert.equal(focusClear, true, 'Keyboard focus is not obscured by the title')
      await run(`(() => {
        const next = document.querySelector('[data-agent-run-id="run-agent-2"] .execution-run-toggle')
        if (next.getAttribute('aria-expanded') !== 'true') next.click()
      })()`)
      await settle()
      await run(`(() => {
        const body = document.querySelector('.execution-drawer-body')
        const card = document.querySelector('${titleStage} article')
        body.scrollTop += card.getBoundingClientRect().bottom - body.getBoundingClientRect().top - 20
      })()`)
      await settle()
      const boundary = await titleGeometry()
      assert.ok(boundary.header.bottom <= boundary.card.bottom + 1, 'The title never escapes its own Run')
      assert.ok(boundary.header.top < boundary.body.top, `The next card pushes the prior title out: ${JSON.stringify(boundary)}`)
    }
    await run(`(() => { const body = document.querySelector('.execution-drawer-body');
      const stage = document.querySelector('${titleStage}');
      body.scrollTop += stage.getBoundingClientRect().top - body.getBoundingClientRect().top + 220 })()`)
    await settle()
    await click(`${titleStage} .execution-run-operations .is-danger`)
    assert.equal(await run("document.querySelector('[data-stopped-runs]').textContent"), 'run-agent-3', 'Sticky stop targets only its exact Run')
    assert.equal(await run("document.querySelectorAll('[data-delivery-queue-agent-id] .is-danger').length"), 0)
    await run(`document.querySelector('.execution-history-toggle[aria-expanded="false"]')?.click()`)
    await settle()
    await run(`(() => { const toggle = document.querySelector('${titleStage} .execution-run-toggle');
      if (toggle?.getAttribute('aria-expanded') !== 'true') toggle?.click() })()`)
    await settle()
    const terminal = await run(`(() => { const stage = document.querySelector('${titleStage}'); return {
      cancelled: stage?.classList.contains('status-cancelled'), text: stage?.textContent,
      groupCount: stage?.querySelectorAll('.tool-activity-group').length,
      stopCount: stage?.querySelectorAll('.is-danger').length } })()`)
    assert.ok(terminal.cancelled && terminal.groupCount > 0, JSON.stringify(terminal))
    assert.ok(!terminal.text.includes('正在停止') && !terminal.text.includes('等待执行结束'), JSON.stringify(terminal))
    assert.equal(terminal.stopCount, 0, 'Terminal Run cannot be stopped again')

    await run('window.configureRunInterruption()')
    window.setContentSize(1440, 920)
    await settle()
    const interruption = '[data-interrupted-run-id="run-agent-1"] .run-interruption-trigger'
    for (const theme of ['day', 'night']) {
      await run(`document.documentElement.dataset.theme = '${theme}'`)
      await settle()
      const marker = await run(`(() => {
        const button = document.querySelector('${interruption}')
        const row = button.parentElement.getBoundingClientRect()
        const card = button.closest('.run-artifact-output').querySelector('.run-file-changes-card').getBoundingClientRect()
        const rect = button.getBoundingClientRect(), style = getComputedStyle(button)
        return { count: document.querySelectorAll('.run-interruption-trigger').length, text: button.textContent,
          centered: Math.abs(rect.x + rect.width / 2 - card.x - card.width / 2) < 1,
          gap: row.top - card.bottom, height: rect.height, fontSize: style.fontSize,
          square: button.querySelector('svg rect').getAttribute('width'),
          overflow: document.documentElement.scrollWidth > innerWidth }
      })()`)
      assert.equal(marker.count, 1)
      assert.equal(marker.text, '你已中断')
      assert.ok(marker.centered && !marker.overflow && marker.height >= 24, JSON.stringify(marker))
      assert.equal(marker.gap, 8)
      assert.equal(marker.fontSize, '11.5px')
      assert.equal(marker.square, '4')
      await capture(`interruption-d3-${theme}`)
    }
    for (const placement of ['inspector', 'bottom', 'right']) {
      await click(interruption)
      if (await run("document.querySelector('.execution-drawer')?.dataset.placement") !== placement) {
        await click('.execution-placement-button')
        await click(`.execution-placement-option[data-placement="${placement}"]`)
      }
      if (placement === 'right') await run('window.executionNotificationTest.hideExecution()')
      else await key('Escape')
      await run(`document.querySelector('${interruption}').focus()`)
      await key('Enter')
      await settle()
      const focused = await run(`({ runId: document.activeElement?.getAttribute('data-agent-run-id'),
        expanded: document.querySelector('[data-agent-run-id="run-agent-1"] .execution-run-toggle')?.getAttribute('aria-expanded') })`)
      assert.equal(focused.runId, 'run-agent-1', 'The marker targets the stopped Run even with a running successor')
      assert.equal(focused.expanded, 'true')
      if (placement === 'bottom') {
        await key('Escape')
        assert.equal(await run(`document.activeElement === document.querySelector('${interruption}')`), true,
          'Closing bottom execution detail restores marker focus')
        assert.equal(await run(`getComputedStyle(document.querySelector('${interruption}')).outlineWidth`), '2px')
      }
    }

    console.log(JSON.stringify({ ok: true, cases: ['0/1/2/3/5 running entry members and duplicate runs', 'two equal brand orbits',
      'idle history with executed member count', 'entry names and keyboard focus', 'collapsed running state',
      '12/20-member overflow', '176px steps and overlap', 'mouse wheel/trackpad', 'keyboard and long-name tooltip',
      'persistent outside pointer/focus', 'explicit close and Escape focus return',
      'selection and node retention', 'status refresh/reopen', 'Task navigation/repeated target', '8-member no overflow',
      'long prose containment', 'single-line command and full expanded output',
      'waiting Delivery queue cards', 'independent multi-input popovers', 'Run card geometry and square overview avatars',
      'Day/Night', '1040/1440/2560/200% layout', 'reduced motion', 'forced colors', 'bottom dock unchanged',
      '0/1/2/16/48 delivery recipients', 'source attribution and deduplication', 'single-line complete avatars',
      'overflow list keyboard scrolling and focus return', 'nested Escape', 'recipient resize and placement preservation',
      'four-grid overview and centering in three placements', 'shared execution icon geometry',
      'sticky title in three placements and two themes/sizes', 'default elapsed/title-only hover/bordered controls/red stop',
      'terminal cancellation precedence', 'focus not obscured', 'Run-bounded sticky and exact stop',
      'D3 interruption geometry in Day/Night', 'interrupted Run with a running successor in three placements',
      'interruption keyboard activation and bottom detail focus return'] }))
    window.destroy()
    app.quit()
  } catch (error) {
    console.error(await state())
    await capture('failure')
    throw error
  }
}).catch(error => { console.error(error); app.exit(1) })
app.on('window-all-closed', () => app.quit())
