const assert = require('node:assert/strict')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')

module.exports = async ({ evaluate, wait, key, click, window, evidence }) => {
  const checks = []
  const command = (method, params) => window.webContents.debugger.sendCommand(method, params)
  const insert = text => command('Input.insertText', { text })
  const state = () => evaluate('invitationTest.state()')
  const ready = async () => {
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await wait("document.querySelector('.ref-options')?.getAttribute('aria-busy') === 'false'")
  }
  const candidate = () => wait("!!document.querySelector('[role=option][data-agent-id=outside]')")
  const reset = async pending => {
    await evaluate('pasteTest.reset(' + pending + ')')
    await wait("document.querySelector('#camp-message[contenteditable=true]') && invitationTest.state().text === ''")
    await evaluate('invitationTest.focus()')
  }
  const expectSelection = async (count = 1) => {
    await wait('invitationTest.state().atoms === ' + count)
    await wait('invitationTest.state().draft?.content.segments.filter(s => s.kind === "atom").length === ' + count)
    const current = await state()
    assert.deepEqual(current.draft.content.segments.filter(s => s.kind === 'atom').map(s => s.atom),
      Array.from({ length: count }, () => ({ type: 'member', agentId: 'outside', labelFallback: '爱丽丝' })))
    assert.equal(current.submissions.length, 0, 'Choosing a candidate must not send')
    assert.equal(current.calls.some(call => call.startsWith('add:')), false, 'Choosing a candidate must not invite')
    assert.deepEqual(current.memberIds, ['lead'])
    assert.equal(current.invite, true)
    assert.deepEqual(current.errors, [])
    return current
  }

  for (const pending of [false, true]) {
    await reset(pending)
    await insert('@aili')
    await candidate(); await ready()
    assert.equal(await evaluate("document.querySelector('.ref-filters [aria-selected=true]').textContent"), '队员')
    writeFileSync(join(evidence, 'pinyin-' + (pending ? 'pending' : 'public') + '.png'), (await window.webContents.capturePage()).toPNG())
    await key('Enter', 13)
    assert.equal((await expectSelection()).text, '@爱丽丝 ')
    // Native typing after selection proves the caret is after the trailing space.
    await insert('@als')
    await candidate(); await ready()
    for (const category of ['对话', '使命', '队员']) {
      await key('Tab', 9)
      await wait(`document.querySelector('.ref-filters [aria-selected=true]').textContent === '${category}'`)
      await ready()
      assert.equal((await state()).atoms, 1, 'Tab changes category without inserting')
    }
    await key('Enter', 13)
    assert.equal((await expectSelection(2)).text, '@爱丽丝 @爱丽丝 ')
    await insert('完成')
    await wait("invitationTest.state().text === '@爱丽丝 @爱丽丝 完成'")
    checks.push((pending ? 'Pending' : 'Public') + ': pinyin Enter, Tab categories, repeat identity, caret, pending invitation and no send')
  }

  for (const pending of [false, true]) {
    for (const query of ['cod', 'CODEX']) {
      await reset(pending)
      await insert('@' + query)
      await candidate(); await ready()
      assert.deepEqual(await evaluate("[...document.querySelectorAll('.ref-options [data-agent-id]')].map(node => node.dataset.agentId)"), ['lead', 'outside'])
      writeFileSync(join(evidence, 'runtime-' + query + '-' + (pending ? 'pending' : 'public') + '.png'), (await window.webContents.capturePage()).toPNG())
      await key('ArrowDown', 40)
      await key('Enter', 13)
      assert.equal((await expectSelection()).text, '@爱丽丝 ')
      checks.push((pending ? 'Pending' : 'Public') + ': Runtime ' + query + ', roster priority, identity selection and pending invitation')
    }
  }

  for (const query of ['AILI', 'ＡＩＬＩ', '爱li', 'ai丽']) {
    await reset(false)
    await insert('前文 @' + query + ' 结尾')
    // Place the real caret immediately after the original query, before existing whitespace.
    for (let i = 0; i < 3; i++) await key('ArrowLeft', 37)
    await candidate(); await ready()
    await key('Enter', 13)
    assert.equal((await expectSelection()).text, '前文 @爱丽丝 结尾')
    await insert('完成')
    await wait("invitationTest.state().text === '前文 @爱丽丝 完成结尾'")
    checks.push(query + ': original replacement range and existing space')
  }

  await reset(false)
  await insert('@')
  await command('Input.imeSetComposition', { text: 'aili', selectionStart: 4, selectionEnd: 4 })
  await key('Enter', 13); await key('Tab', 9)
  assert.equal((await state()).atoms, 0)
  assert.equal((await state()).submissions.length, 0)
  // Tab may already have committed the native composition. Cancel only an
  // outstanding composition before committing its final query once.
  await command('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 })
  const committed = await state()
  if (committed.text === '@') await insert('aili')
  else assert.equal(committed.text, '@aili')
  await evaluate('invitationTest.focus()')
  await candidate(); await ready()
  await key('Enter', 13)
  assert.equal((await expectSelection()).text, '@爱丽丝 ')
  checks.push('native Chromium composition blocks selection/send and recomputes after commit')

  for (const label of ['对话', '使命']) {
    await reset(false)
    await insert('@')
    await ready()
    await click('.ref-filters [role=tab]', label)
    await ready()
    await insert('aili')
    await ready()
    assert.equal(await evaluate("document.querySelector('.ref-filters [aria-selected=true]').textContent"), label)
    assert.equal(await evaluate("document.querySelectorAll('.ref-options [role=option]').length"), 0)
    // Change the query in the same @ invocation; manual classification must remain pinned.
    for (let i = 0; i < 4; i++) await key('Backspace', 8)
    await insert('爱丽')
    await ready()
    assert.equal(await evaluate("document.querySelector('.ref-filters [aria-selected=true]').textContent"), label)
    assert.equal(await evaluate("document.querySelector('.ref-thread-option strong')?.textContent"), '爱丽丝的' + (label === '对话' ? '会话' : '使命'))
    checks.push(label + ': manual category survives member pinyin, title remains literal')
  }
  for (const [query, label] of [['会话', '对话'], ['使命', '使命']]) {
    await reset(false); await insert('@' + query)
    await wait("!!document.querySelector('.ref-thread-option strong')"); await ready()
    assert.equal(await evaluate("document.querySelector('.ref-filters [aria-selected=true]').textContent"), label)
    assert.ok(await evaluate("[...document.querySelectorAll('.ref-thread-option strong')].some(node => node.textContent.includes(" + JSON.stringify(query) + "))"))
  }
  checks.push('automatic title category still matches original Chinese text')
  await reset(false); await insert('/sheji')
  await wait("!!document.querySelector('.structured-skill-menu .structured-mention-empty')")
  assert.equal(await evaluate("document.querySelectorAll('.structured-skill-menu [role=option]').length"), 0)
  await reset(false); await insert('/review')
  await wait("!!document.querySelector('[data-skill-name=review-code]')")
  checks.push('Skill keeps literal search without pinyin')
  await reset(false); await insert('@ai li')
  await wait("invitationTest.state().text === '@ai li'")
  assert.equal(await evaluate("document.querySelectorAll('.structured-mention-menu').length"), 0)
  checks.push('space tolerance does not expand the editor trigger')

  await reset(true)
  await evaluate('invitationTest.mission(true)')
  await wait("!!document.querySelector('#mission-editor-description[contenteditable=true]')")
  await click('#mission-editor-description')
  await insert('@aili')
  await wait("!!document.querySelector('.structured-mention-menu [data-agent-id=outside]')")
  assert.equal(await evaluate("document.querySelectorAll('.ref-filters, [data-option-kind=all_members]').length"), 0)
  writeFileSync(join(evidence, 'pinyin-mission.png'), (await window.webContents.capturePage()).toPNG())
  await key('Enter', 13)
  await wait("document.querySelector('#mission-editor-description').textContent === '@爱丽丝 '")
  await insert('@als')
  await wait("!!document.querySelector('.structured-mention-menu [data-agent-id=outside]')")
  await key('Tab', 9)
  await insert('完成')
  const mission = await evaluate('invitationTest.missionContent()')
  assert.deepEqual(mission, [
    { kind: 'member_mention', agentId: 'outside' }, { kind: 'text', text: ' ' },
    { kind: 'member_mention', agentId: 'outside' }, { kind: 'text', text: ' 完成' }
  ])
  assert.equal((await state()).submissions.length, 0)
  assert.deepEqual((await state()).memberIds, ['lead'])
  checks.push('production mission editor: pinyin Enter, initials Tab, repeat mention and caret')
  await insert(' @cod')
  await wait("!!document.querySelector('.structured-mention-menu [data-agent-id=outside]')")
  assert.deepEqual((await evaluate("[...document.querySelectorAll('.structured-mention-menu [data-agent-id]')].map(node => node.dataset.agentId)")).slice(0, 2), ['lead', 'outside'])
  await key('ArrowDown', 40)
  await key('Enter', 13)
  const runtimeMission = await evaluate('invitationTest.missionContent()')
  assert.deepEqual(runtimeMission.slice(-2), [{ kind: 'member_mention', agentId: 'outside' }, { kind: 'text', text: ' ' }])
  assert.equal(runtimeMission.filter(segment => segment.kind === 'member_mention').length, 3)
  assert.equal((await state()).submissions.length, 0)
  checks.push('production mission editor: Runtime prefix, roster order and concrete member identity')
  await evaluate('invitationTest.mission(false)')
  await reset(true)
  writeFileSync(join(evidence, 'member-search.json'), JSON.stringify({ ok: true, checks }, null, 2) + '\n')
  return checks
}
