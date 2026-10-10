const assert = require('node:assert/strict')
const { writeFileSync } = require('node:fs')
const { dirname, join } = require('node:path')

module.exports = async ({ window, userData, waitFor, click, wheel, settle }) => {
  const evaluate = expression => window.webContents.executeJavaScript(expression, true)
  window.webContents.debugger.attach('1.3')
  const key = async (keyCode, modifiers = []) => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  }
  const editor = '.mission-definition-dialog [contenteditable]'
  const menu = '.structured-mention-menu'
  const replaceDescription = async text => {
    await click(editor)
    await waitFor(`document.activeElement?.matches('${editor}')`, 'Description did not receive focus')
    await key('A', [process.platform === 'darwin' ? 'meta' : 'control'])
    await key('Backspace')
    await waitFor(`document.querySelector('${editor}')?.textContent === ''`, 'Description did not clear')
    if (text) await window.webContents.insertText(text)
    await settle()
  }
  const assertMenu = async label => {
    await waitFor(`!!document.querySelector('${menu} [role=option]')`, `${label}: candidates did not open`)
    await settle()
    const geometry = await evaluate(`(() => {
      const menu = document.querySelector('${menu}')
      const option = menu.querySelector('[aria-selected=true]')
      const bounds = menu.getBoundingClientRect(), optionBounds = option.getBoundingClientRect()
      const visible = [[bounds.left + 8, bounds.top + 8], [bounds.right - 8, bounds.bottom - 8]]
        .every(([x,y]) => menu.contains(document.elementFromPoint(x,y)))
      const hit = document.elementFromPoint(optionBounds.x + optionBounds.width / 2, optionBounds.y + optionBounds.height / 2)
      const caret = document.getSelection()?.getRangeAt(0).getBoundingClientRect()
      const root = document.querySelector('${editor}')
      return { menu: bounds.toJSON(), option: optionBounds.toJSON(), caret: caret?.toJSON(),
        viewport: { width: innerWidth, height: innerHeight }, side: menu.dataset.side,
        insideDialog: !!document.querySelector('.mission-definition-dialog')?.contains(menu),
        focused: document.activeElement === root, activeOption: root.getAttribute('aria-activedescendant') === option.id,
        selectable: option.contains(hit), visible }
    })()`)
    writeFileSync(join(dirname(userData), `mission-mention-${label}.png`), (await window.webContents.capturePage()).toPNG())
    assert(geometry.selectable && geometry.visible, `${label}: candidates clipped or obscured: ${JSON.stringify(geometry)}`)
    assert(geometry.insideDialog && geometry.focused && geometry.activeOption, `${label}: lost editor focus or active option: ${JSON.stringify(geometry)}`)
    assert(geometry.menu.left >= 0 && geometry.menu.top >= 0
      && geometry.menu.right <= geometry.viewport.width && geometry.menu.bottom <= geometry.viewport.height,
    `${label}: menu escaped the viewport: ${JSON.stringify(geometry)}`)
    assert(geometry.menu.top >= geometry.caret.bottom || geometry.menu.bottom <= geometry.caret.top,
      `${label}: menu covers the typing caret: ${JSON.stringify(geometry)}`)
    return geometry
  }
  const select = async (selector, method = 'pointer') => {
    const id = await evaluate(`document.querySelector('${selector}').dataset.agentId`)
    const count = await evaluate(`document.querySelectorAll('${editor} [data-composer-atom]').length`)
    if (method === 'pointer') await click(selector)
    else await key(method)
    await waitFor(`document.querySelectorAll('${editor} [data-composer-atom]').length === ${count + 1}
      && [...document.querySelectorAll('${editor} [data-composer-atom]')].at(-1)?.dataset.agentId === '${id}'
      && !document.querySelector('${menu}')`, `${method} did not insert the chosen identity`)
  }
  await waitFor("!!document.querySelector('.mission-board-card')", 'Mission board did not load')
  for (const scenario of [
    { name: 'create-minimum-day', kind: 'create', width: 1040, height: 700, expanded: false, theme: 'day' },
    { name: 'create-expanded-night', kind: 'create', width: 1440, height: 920, expanded: true, theme: 'night' },
    { name: 'edit-day', kind: 'edit', width: 1440, height: 920, expanded: false, theme: 'day' },
    { name: 'edit-expanded-wide-night', kind: 'edit', width: 2560, height: 1440, expanded: true, theme: 'night' },
    { name: 'create-zoom-200', kind: 'create', width: 2560, height: 1440, zoom: 2, expanded: false, theme: 'day' }
  ]) {
    window.setContentSize(scenario.width, scenario.height)
    window.webContents.setZoomFactor(scenario.zoom ?? 1)
    await waitFor(`innerWidth === ${scenario.width / (scenario.zoom ?? 1)}`, 'Mention fixture did not resize')
    await evaluate(`document.documentElement.dataset.theme = '${scenario.theme}'`)
    if (scenario.kind === 'create') await click('.mission-new-entry')
    else {
      await click('.mission-board-card .mission-card-open', 'right')
      await waitFor("!!document.querySelector('[role=menuitem]')", 'Mission context menu did not open')
      await evaluate("[...document.querySelectorAll('[role=menuitem]')].find(node => node.textContent.trim() === '编辑').dataset.mentionEdit = ''")
      await click('[data-mention-edit]')
    }
    await waitFor(`!!document.querySelector('.mission-${scenario.kind}-dialog')`, `${scenario.name}: editor did not open`)
    await settle()
    if (await evaluate("document.querySelector('.mission-definition-dialog').classList.contains('is-expanded')") !== scenario.expanded) {
      await click('.mission-editor-header-actions .mission-editor-icon-button')
      await settle()
    }
    await replaceDescription('@')
    await assertMenu(scenario.name)
    if (scenario.name === 'create-minimum-day' || scenario.name === 'edit-day') {
      const before = await evaluate(`document.querySelector('${editor}').textContent`)
      assert.equal(await evaluate(`document.querySelector('${menu}').innerText.includes('使命模型显示名')`), false)
      const icon = '.mention-runtime-trigger'
      assert(await evaluate(`(() => { const button=document.querySelector('${icon}'), r=button.getBoundingClientRect(); return button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); })()`), 'Agent icon is obscured')
      await click(icon)
      await waitFor("!!document.querySelector('.mention-runtime-popover')", 'Agent details did not open')
      assert.equal(await evaluate("document.querySelector('.mention-runtime-popover dd').textContent"), '使命模型显示名', 'Mission did not use the cached model label')
      assert.equal(await evaluate(`document.querySelector('${editor}').textContent`), before, 'Opening details changed the description')
      await click('.mention-runtime-heading button')
      await waitFor(`!document.querySelector('.mention-runtime-popover') && document.activeElement?.matches('${editor}')`, 'Closing details did not restore the description caret')
      await assertMenu(`${scenario.name}-details-closed`)
    }
    if (scenario.name === 'create-minimum-day') {
      window.setContentSize(1040, 780)
      await waitFor('innerHeight === 780', 'Open menu did not resize with the window')
      await assertMenu(`${scenario.name}-resized`)
      window.setContentSize(1040, 700)
      await waitFor('innerHeight === 700', 'Minimum viewport did not restore')
      await settle()
    }
    await select(`${menu} [data-agent-id]`)

    // The footer trigger keeps the caret; keyboard navigation scrolls only the candidate list.
    await click('.mission-editor-tools [aria-label="提及队员"]')
    await waitFor(`!!document.querySelector('${menu}')`, 'Footer mention button did not open candidates')
    const steps = Math.min(11, await evaluate(`document.querySelectorAll('${menu} [data-agent-id]').length - 1`))
    for (let i = 0; i < steps; i++) await key('Down')
    await assertMenu(`${scenario.name}-keyboard`)
    assert(await evaluate(`document.querySelector('${menu}').scrollTop > 0`), 'Keyboard navigation did not scroll candidates')
    await select(`${menu} [aria-selected=true]`, 'Enter')

    await replaceDescription('@')
    await waitFor(`!!document.querySelector('${menu}')`, 'Mention menu did not reopen')
    await window.webContents.insertText('木')
    await waitFor(`document.querySelectorAll('${menu} [data-agent-id]').length === 1`, 'Typing did not filter candidates')
    await assertMenu(`${scenario.name}-search`)
    await key('Tab')
    await waitFor(`!!document.querySelector('${editor} [data-composer-atom]') && !document.querySelector('${menu}')`, 'Tab did not select a candidate')

    if (scenario.kind === 'edit') {
      await replaceDescription('@')
      await waitFor(`!!document.querySelector('${menu}')`, 'Invite menu did not open')
      await wheel(menu)
      await waitFor(`document.querySelector('${menu}').scrollTop > 0`, 'Wheel did not scroll candidates inside the modal')
      await click(`${menu} [aria-label="邀请其他队员"]`)
      await waitFor(`!!document.querySelector('${menu} .is-invitable')`, 'Pointer did not open the invite layer')
      await assertMenu(`${scenario.name}-invitation`)
      await select(`${menu} .is-invitable`)
      await waitFor("!!document.querySelector('.mission-pending-member')", 'Outside member did not become pending')
    }

    // A long description scrolls its caret to the bottom; candidates flip when needed.
    await replaceDescription('Long mission description\n'.repeat(40) + '@')
    const lower = await assertMenu(`${scenario.name}-bottom`)
    if (lower.viewport.height - lower.caret.bottom - 19 < 280) {
      assert.equal(lower.side, 'top', `${scenario.name}: candidates did not flip above the lower caret`)
    }
    await select(`${menu} [data-agent-id]`)
    await click('.mission-editor-tools [aria-label="提及队员"]')
    await waitFor(`!!document.querySelector('${menu}')`, 'Menu did not reopen before Escape')
    await settle()
    await key('Escape')
    await waitFor(`!document.querySelector('${menu}') && !!document.querySelector('${editor}')`, 'Escape closed the Mission instead of its candidates')
    await click('.mission-definition-dialog .compact-cancel')
    await waitFor("!document.querySelector('.mission-definition-dialog')", 'Cancel did not close the editor')
    await settle()
  }
  assert.deepEqual(await evaluate('window.missionQA.errors'), [])
  assert.equal(await evaluate("window.missionQA.calls.some(call => ['missions.create', 'missions.createWithAttachments', 'missions.update', 'missions.updateWithAttachments', 'missions.start'].includes(call.method))"), false,
    'Selecting or cancelling candidates performed a Mission mutation')
}
