const assert = require('node:assert/strict')
const { writeFileSync } = require('node:fs')
const { dirname, join } = require('node:path')

module.exports = async ({ window, userData, waitFor, click: nativeClick }) => {
  const evaluate = expression => window.webContents.executeJavaScript(expression, true)
  const frames = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const click = async selector => { await nativeClick(selector); await frames() }
  const key = async keyCode => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode })
    await frames()
  }
  const fillTitle = title => evaluate(`(() => {
    const input = document.querySelector('#mission-editor-title');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(title)});
    input.dispatchEvent(new Event('input', {bubbles:true}));
  })()`)
  let checkedSourceKeyboard = false
  const source = async id => {
    await click('[data-change-source]')
    await waitFor("!!document.querySelector('.mission-team-source-list')", 'Source chooser opens')
    assert.equal(await evaluate("document.querySelector('.mission-team-source-list button').dataset.teamId"), 'custom')
    if (!checkedSourceKeyboard) {
      await key('Up')
      assert.equal(await evaluate('document.activeElement.dataset.teamId'), 'team-beta', 'Up from search focuses last source')
      await key('Home')
      assert.equal(await evaluate('document.activeElement.dataset.teamId'), 'custom', 'Home focuses Custom without choosing it')
      checkedSourceKeyboard = true
    }
    await click(`[data-team-id="${id}"]`)
    await waitFor("!!document.querySelector('.mission-team-heading')", 'Source choice returns to roster')
  }
  const openPicker = async () => {
    await click('.mission-editor-team-property')
    await waitFor("!!document.querySelector('.mission-team-picker')", 'Team picker opens')
  }
  const closePicker = async () => {
    await click('.mission-editor-team-footer .compact-primary')
    await waitFor("!document.querySelector('.mission-team-picker')", 'Team picker closes')
  }
  const submit = async () => { await click('.mission-create-split > .compact-primary'); await frames() }
  const createCalls = "window.missionQA.calls.filter(c=>c.method==='missions.create')"
  await waitFor("!!document.querySelector('.mission-board-card') && window.missionQA.calls.some(c=>c.method==='teams.list')", 'Production Mission board and initial Team read load')
  await click('.mission-new-entry')
  await waitFor("!!document.querySelector('.mission-create-dialog')", 'New Mission opens while Team read remains pending')
  await fillTitle('Keep the Mission draft')
  assert(await evaluate("document.querySelector('.mission-create-split > .compact-primary').disabled"), 'Explicit unloaded Team blocks submission')
  // The Promise is released only after the dialog and edited draft exist.
  await evaluate('window.missionQA.resolveTeams()')
  await waitFor("document.querySelector('.mission-team-chip-name')?.textContent==='日常开发' && !document.querySelector('.mission-create-split > .compact-primary').disabled", 'Late Team completes initial selection')
  assert.equal(await evaluate("document.querySelector('#mission-editor-title').value"), 'Keep the Mission draft')
  await openPicker()
  assert.equal(await evaluate("document.querySelectorAll('.mission-team-member-readonly').length"), 6)
  assert.equal(await evaluate("document.querySelectorAll('.mission-team-picker [role=checkbox]').length"), 0)
  assert.equal(await evaluate("document.querySelectorAll('.mission-team-picker input[type=checkbox]').length"), 0)
  await click('.mission-team-guidance-toggle')
  await waitFor("!!document.querySelector('.mission-team-guidance-full-link')", 'Long guidance offers full reader')
  assert(await evaluate("document.querySelector('.mission-team-guidance-preview-text').clientHeight <= 105"))
  await click('.mission-team-guidance-full-link')
  await waitFor("!!document.querySelector('.mission-team-reader-body')", 'Full guidance opens')
  assert(await evaluate("document.querySelector('.mission-team-reader-body').textContent===window.missionQA.missionTeams[0].guidance"), 'Full reader retains all original paragraphs')
  await key('PageDown')
  await waitFor("document.querySelector('.mission-team-reader-body').scrollTop>0", 'Keyboard scrolls reader')
  await key('End')
  await waitFor("(() => {const b=document.querySelector('.mission-team-reader-body');return b.scrollTop+b.clientHeight>=b.scrollHeight-1})()", 'Full reader reaches last paragraph')
  assert(await evaluate("(() => {const b=document.querySelector('.mission-team-reader-body');return b.scrollTop+b.clientHeight>=b.scrollHeight-1})()"))
  writeFileSync(join(dirname(userData), 'mission-team-guidance-desktop.png'), (await window.webContents.capturePage()).toPNG())
  await key('Escape')
  await waitFor("!document.querySelector('.mission-team-reader-body') && !!document.querySelector('.mission-team-heading') && !!document.querySelector('.mission-create-dialog')", 'Escape returns to roster without dismissing Mission')
  await source('team-beta')
  await click('.mission-team-guidance-toggle')
  assert.equal(await evaluate("document.querySelector('.mission-team-guidance-preview-text').textContent"), '先验证，再回报。')
  assert.equal(await evaluate("!!document.querySelector('.mission-team-guidance-full-link')"), false)
  await source('custom')
  const ids = await evaluate('window.missionQA.profiles.slice(0,3).map(p=>p.agentId)')
  assert.equal(await evaluate("document.querySelectorAll('.mission-editor-team-member[aria-checked=true]').length"), 2)
  await click(`[data-member="${ids[2]}"]`)
  await click(`[data-lead="${ids[2]}"]`)
  await source('team-alpha')
  await source('custom')
  assert.equal(await evaluate("document.querySelectorAll('.mission-editor-team-member[aria-checked=true]').length"), 3)
  assert.equal(await evaluate(`document.querySelector('[data-lead="${ids[2]}"]').getAttribute('aria-pressed')`), 'true')
  assert.equal(await evaluate("document.querySelector('#mission-editor-title').value"), 'Keep the Mission draft')
  for (const theme of ['day', 'night', 'horizon', 'classic-red', 'ember']) {
    await evaluate(`window.missionQA.setTheme(${JSON.stringify(theme)})`)
    await frames()
    assert(await evaluate(`(() => {
      const selected=document.querySelector('.mission-editor-team-check.is-checked');
      const probe=document.createElement('span');probe.style.backgroundColor='var(--conversation-action)';
      selected.parentElement.append(probe);
      const matches=getComputedStyle(selected).backgroundColor===getComputedStyle(probe).backgroundColor;
      probe.remove();return matches;
    })()`), `${theme}: checkbox uses current action token inside the production Portal`)
    assert.equal(await evaluate(`document.querySelector('[data-lead="${ids[2]}"]').getAttribute('aria-pressed')`), 'true')
  }
  await evaluate("window.missionQA.setTheme('day')")
  await source('team-alpha')
  await closePicker()
  await evaluate('window.missionQA.upgradeTeam(); window.missionQA.failMissionCreate("team.conflict")')
  await submit()
  await waitFor(`${createCalls}.length===1 && !!document.querySelector('.compact-inline-error')`, 'Version conflict leaves Mission draft open')
  assert.deepEqual(await evaluate(`${createCalls}[0].p.command.team`), { teamId: 'team-alpha', expectedVersion: 1 })
  await openPicker()
  await source('team-alpha')
  await closePicker()
  await evaluate('window.missionQA.failMissionCreate("transport")')
  await submit()
  await waitFor(`${createCalls}.length===2 && !!document.querySelector('.compact-inline-note')`, 'Unknown outcome retains recoverable command')
  assert.deepEqual(await evaluate(`${createCalls}[1].p.command.team`), { teamId: 'team-alpha', expectedVersion: 2 })
  await openPicker()
  await source('custom')
  await closePicker()
  await fillTitle('Changed after uncertain outcome')
  await click('.compact-inline-note .mission-source-link')
  await waitFor("document.querySelector('.mission-team-chip-name').textContent==='日常开发'", 'Recovery restores original Team snapshot')
  assert.equal(await evaluate("document.querySelector('#mission-editor-title').value"), 'Keep the Mission draft')
  await submit()
  await waitFor(`${createCalls}.length===3 && !document.querySelector('.mission-create-dialog')`, 'Exact retry succeeds')
  assert.deepEqual(await evaluate(`${createCalls}[2].p`), await evaluate(`${createCalls}[1].p`), 'Recovery repeats identical command ID and payload')
  assert.equal(await evaluate("window.missionQA.calls.filter(c=>c.method.startsWith('preferences.set')).length"), 0, 'Mission never writes global creation defaults')

  await click('.rail-button[aria-label="团队"]')
  await waitFor("!!document.querySelector('.team-row-action [data-navigation-icon=crown]')", 'Team roster has a Make lead action')
  assert.deepEqual(await evaluate(`(() => {
    const { width, height } = document.querySelector('.team-row-action [data-navigation-icon=crown]').getBoundingClientRect()
    return [width, height]
  })()`), [14, 14], 'The shared crown keeps the Team member action size')
  await click('.rail-button[aria-label^="使命板"]')
  await waitFor("!!document.querySelector('.rail-button[aria-label^=使命板][aria-current=page]')", 'Return to the Mission board')

  // An explicitly selected Custom remains usable through a pending/failed Team
  // refresh; releasing that Promise cannot replace the user's source choice.
  await evaluate('window.missionQA.holdTeamRefresh()')
  await click('.mission-new-entry')
  await waitFor("!!document.querySelector('.mission-create-dialog')", 'Second Mission opens during refresh')
  await fillTitle('Independent Custom')
  await openPicker()
  await source('custom')
  await evaluate('window.missionQA.resolveTeams()')
  await frames()
  assert.equal(await evaluate("document.querySelector('.mission-team-chip-name').textContent"), '自定义')
  await evaluate('window.missionQA.failTeamRefresh()')
  await click('[data-change-source]')
  await waitFor("!!document.querySelector('.mission-team-list-error')", 'Team error is visible in chooser')
  await click('[data-team-id="custom"]')
  await closePicker()
  await submit()
  await waitFor(`${createCalls}.length===4 && !document.querySelector('.mission-create-dialog')`, 'Custom succeeds despite Team failure')
  assert.equal(await evaluate(`${createCalls}[3].p.command.team`), undefined)

  // Shared production layout at narrow dimensions, including long text.
  await click('.mission-new-entry')
  await openPicker()
  await evaluate('window.missionQA.resolveTeams()')
  // Recover the list by an explicit refresh after the fixture failure is cleared.
  await evaluate('window.missionQA.restoreTeams()')
  await source('team-alpha')
  await click('.mission-team-guidance-toggle')
  await click('.mission-team-guidance-full-link')
  window.setContentSize(390, 844)
  await waitFor('window.innerWidth===390', 'Mobile viewport applies')
  await frames()
  assert(await evaluate("(() => {const r=document.querySelector('.mission-team-picker').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.height>250})()"), 'Mobile reader stays within viewport')
  writeFileSync(join(dirname(userData), 'mission-team-guidance-mobile.png'), (await window.webContents.capturePage()).toPNG())
  await evaluate("window.missionQA.setLanguage('en')")
  await waitFor("document.querySelector('.mission-team-reader-heading strong')?.textContent==='Team guidelines'", 'Full reader changes language without resetting draft')
  assert.equal(await evaluate("document.querySelector('.mission-team-back').getAttribute('aria-label')"), 'Back to members')
  assert.deepEqual(await evaluate('window.missionQA.errors'), [])
}
