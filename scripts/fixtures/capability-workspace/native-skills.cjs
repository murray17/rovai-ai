const assert = require('node:assert/strict')

module.exports = async ({ run, click, key, settle, capture, snapshot, window }) => {
  assert.ok((await snapshot()).text.includes('界面设计与实现'))
  assert.equal((await snapshot()).list.width, 320)
  assert.equal(await run("document.querySelectorAll('.rebuilt-skills-page button').length > 0"), true)
  assert.equal(await run("[...document.querySelectorAll('.rebuilt-skills-page button')].some(b => /导入|停用|删除 Skill/.test(b.textContent))"), false)
  await click('选择智能体，当前为 Codex CLI')
  const runtimes = await run("[...document.querySelectorAll('[role=menuitemradio]')].map(item => item.textContent)")
  assert.ok(runtimes.some(label => label.includes('Codex CLI')))
  assert.ok(runtimes.every(label => !label.includes('Hermes')))
  await key('Escape')
  await require('./file-navigation.cjs')({ run, click, key, settle, capture, window })
  await click('刷新')
  assert.equal(await run("window.capabilityTest.requests.filter(r => r.method === 'nativeSkills.list').at(-1).params.refresh"), true)
  // Metadata issues remain selectable; real failures keep their own labels.
  const diagnostics = [
    { kind: 'metadata', path: '/fixture/native/ui-ux-pro-max/SKILL.md', message: 'name must be a string', skillId: 'native-1' },
    { kind: 'file_read', path: '/fixture/native/blocked/SKILL.md', message: 'Permission denied' },
    { kind: 'directory_read', path: '/fixture/locked', message: 'Directory access denied' }
  ]
  await run(`window.capabilityTest.setNativeDiagnostics(${JSON.stringify(diagnostics)})`)
  await click('刷新')
  assert.equal(await run("document.querySelector('aside.rebuilt-skills-list').querySelectorAll('.rebuilt-skill-row').length"), 2)
  assert.ok(!(await snapshot()).text.includes('扫描结果不完整'))
  assert.ok(!(await snapshot()).text.includes('部分来源暂不可读'))
  await run("document.querySelector('aside .native-skill-diagnostics summary').click()")
  await click('复制诊断')
  const copied = await run('window.capabilityTest.copiedDiagnostic()')
  assert.ok(copied.includes('/fixture/locked') && copied.includes('Directory access denied'))
  assert.ok(await run("document.querySelector('.rebuilt-skills-detail .native-skill-diagnostics').textContent.includes('name must be a string')"))
  await capture('native-skills-diagnostics')
  await run('window.capabilityTest.setNativeDiagnostics([])')
  await click('刷新')
  assert.equal(await run("document.querySelectorAll('.native-skill-diagnostics').length"), 0)

  for (const [source, body] of [
    ['# Plain document', 'Plain document'],
    ['\uFEFF---\r\n---\r\n# Empty header', 'Empty header'],
    ['---\nname: [broken\n---\n# Bad YAML body', 'Bad YAML body'],
    ['---\nname: unclosed', 'name: unclosed']
  ]) {
    await run(`window.capabilityTest.setNativeContent(${JSON.stringify(source)})`)
    await click('刷新')
    await click('阅读')
    assert.ok(await run(`document.querySelector('.capability-reading').textContent.includes(${JSON.stringify(body)})`))
    if (source.includes('[broken')) assert.ok(!await run("document.querySelector('.capability-reading').textContent.includes('[broken')"))
    await click('源码')
    assert.equal(await run("document.querySelector('.capability-source-code').textContent"), source)
  }
  await run('window.capabilityTest.setNativeContent(null)')
  await click('阅读')
  // A refresh finishing after a Runtime switch cannot restore stale diagnostics.
  await run(`window.capabilityTest.setNativeDiagnostics(${JSON.stringify(diagnostics)}); window.capabilityTest.holdNativeList()`)
  await click('刷新')
  await run('window.capabilityTest.setNativeDiagnostics([])')
  await click('选择智能体，当前为 Codex CLI')
  await run("[...document.querySelectorAll('[role=menuitemradio]')].find(item => item.getAttribute('data-state') === 'unchecked').click()")
  await settle()
  await run('window.capabilityTest.releaseNativeList()')
  await settle()
  assert.equal(await run("document.querySelectorAll('.native-skill-diagnostics').length"), 0)
  await capture('native-skills-day-wide')

  await click('工具箱')
  assert.equal(await run("document.querySelectorAll('.rebuilt-toolbox-member input:checked').length"), 1)
  await run('window.capabilityTest.failToolboxSave()')
  await click('全选')
  assert.ok((await snapshot()).text.includes('暂时无法保存队员配置'))
  assert.equal(await run("document.querySelectorAll('.rebuilt-toolbox-member input:checked').length"), 1, 'A failed save restores the previous membership')
  const failedCommand = await run("window.capabilityTest.requests.filter(r => r.method === 'toolbox.setMembers').at(-1).params.commandId")
  await click('重试')
  assert.equal(await run("document.querySelectorAll('.rebuilt-toolbox-member input:checked').length"), 12)
  assert.equal(await run("window.capabilityTest.requests.filter(r => r.method === 'toolbox.setMembers').at(-1).params.commandId"), failedCommand, 'Retry keeps the uncertain command identity')
  await run("const n=document.querySelector('input[placeholder=\"搜索队员姓名或角色\"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'沐瓦'); n.dispatchEvent(new Event('input',{bubbles:true}))")
  await settle()
  await click('取消全选当前结果')
  assert.equal(await run("window.capabilityTest.requests.filter(r => r.method === 'toolbox.setMembers').at(-1).params.command.memberIds.length"), 11, 'Filtered bulk changes preserve other members')
  await click('查看说明')
  assert.ok(await run("document.querySelector('[role=dialog]').textContent.includes('先确认身份卡')"))
  await key('Escape')
  assert.equal((await snapshot()).dialogs, 0)
  await capture('toolbox-day-wide')
  assert.equal(await run("window.capabilityTest.requests.some(r => r.method.startsWith('skills.'))"), false, 'Current settings never call the retired Skill Library')

  await click('Skills')
  await click('ui-ux-pro-max')
  window.setContentSize(1040, 700)
  window.webContents.setZoomFactor(2)
  await run("document.documentElement.dataset.theme='night'")
  await settle()
  assert.equal((await snapshot()).compact, 'true')
  assert.equal((await snapshot()).overflow, false)
  await capture('native-skills-night-zoom')
  await click('返回列表')
  assert.ok((await snapshot()).list.width > 0)
  window.webContents.setZoomFactor(1)
  window.setContentSize(1440, 920)
  await run("document.documentElement.dataset.theme='day'")
  await settle()
}
