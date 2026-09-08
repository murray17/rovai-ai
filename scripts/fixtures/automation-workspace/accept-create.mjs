import assert from 'node:assert/strict'

// Run through the CUA browser API against this fixture, including WindowDragStrip.
export async function acceptCreateFromDetail(tab) {
  await tab.reload()
  await tab.playwright.getByRole('heading', { name: '定时任务', exact: true }).waitFor({ state: 'visible', timeoutMs: 5000 })
  await tab.playwright.getByRole('button', { name: '已开启 Issue / PR 巡检 每天 09:00 洛克的头像', exact: true }).click()
  await tab.playwright.getByRole('region', { name: '定时任务详情', exact: true }).waitFor({ state: 'visible', timeoutMs: 1500 })
  const createEntry = tab.playwright.getByRole('button', { name: '新建', exact: true })
  const hit = await tab.playwright.evaluate(() => {
    const button = document.querySelector('.automation-list-navigation .primary-button')
    if (!button) return { reachable: false, blockedBy: 'missing New button', disabled: true }
    const rect = button.getBoundingClientRect()
    const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return { reachable: target === button || button.contains(target), blockedBy: target?.className, disabled: button.disabled }
  })
  assert.equal(hit.disabled, false, 'New must be enabled while the workspace is idle')
  assert.equal(hit.reachable, true, `New is covered by ${hit.blockedBy}`)
  await createEntry.click()
  const chooser = tab.playwright.getByRole('region', { name: '选择创建方式', exact: true })
  await chooser.waitFor({ state: 'visible', timeoutMs: 1500 })
  assert.equal(await chooser.getByRole('button').count(), 4, 'List New offers a blank task and all three templates')
  assert.equal(await tab.playwright.getByRole('region', { name: '定时任务详情', exact: true }).isVisible(), true, 'Opening choices keeps the current task visible')
  assert.equal(await createEntry.getAttribute('aria-expanded'), 'true')
  await createEntry.click()
  await chooser.waitFor({ state: 'hidden', timeoutMs: 1500 })
  await createEntry.press('Space')
  await chooser.waitFor({ state: 'visible', timeoutMs: 1500 })
  await chooser.getByRole('button').first().press('Escape')
  await chooser.waitFor({ state: 'hidden', timeoutMs: 1500 })
  assert.equal(await createEntry.evaluate(button => button === document.activeElement), true, 'Escape returns focus to New')
  await createEntry.click()
  await tab.playwright.getByRole('searchbox', { name: '搜索定时任务', exact: true }).click()
  await chooser.waitFor({ state: 'hidden', timeoutMs: 1500 })
  await createEntry.click()
  await tab.playwright.getByRole('button', { name: '已开启 每周周报总结 每周五 17:30 棉枝的头像', exact: true }).click()
  await chooser.waitFor({ state: 'hidden', timeoutMs: 1500 })
  assert.equal(await tab.playwright.getByRole('textbox', { name: '定时任务名称', exact: true }).evaluate(input => input.value), '每周周报总结', 'Outside dismissal must not move the clicked task before its click completes')
  await createEntry.click()
  await chooser.getByRole('button', { name: '从空白开始 自己填写执行内容与运行时间', exact: true }).click()
  await chooser.waitFor({ state: 'hidden', timeoutMs: 1500 })
  assert.equal(await tab.playwright.evaluate(() => document.activeElement?.matches('input, textarea')), false, 'Choosing blank must not focus a form field')
  await tab.playwright.getByRole('button', { name: '保存', exact: true }).waitFor({ state: 'visible', timeoutMs: 1500 })
  assert.equal(await tab.playwright.getByRole('button', { name: '保存', exact: true }).isEnabled(), false, 'An empty prompt cannot be submitted')
  assert.equal(await tab.playwright.getByRole('button', { name: '返回定时任务总览', exact: true }).count(), 1, 'Only the editor close action returns to the overview')
  await tab.playwright.getByRole('textbox', { name: '定时任务名称', exact: true }).fill('新建入口回归')
  await tab.playwright.getByRole('textbox', { name: '执行内容', exact: true }).fill('整理当前项目中需要关注的改动。')
  await tab.playwright.getByRole('button', { name: '保存', exact: true }).click()
  await tab.playwright.getByRole('status').filter({ hasText: '定时任务已保存' }).waitFor({ state: 'visible', timeoutMs: 1500 })
  assert.equal(await tab.playwright.getByRole('button', { name: '保存', exact: true }).count(), 0, 'Creation must enter the persisted task')
  for (const template of [
    { name: 'Issue / PR 巡检', frequency: '每天', time: '09:00', prompt: '检查当前项目新增和更新的 Issue、PR' },
    { name: '每周周报总结', frequency: '每周', time: '17:30', prompt: '汇总本周项目进展' },
    { name: '新版更新说明', frequency: '手动触发', prompt: '根据当前项目的变更和提交记录' }
  ]) {
    await createEntry.click()
    await chooser.getByRole('button', { name: new RegExp(`^${template.name} `) }).click()
    await chooser.waitFor({ state: 'hidden', timeoutMs: 1500 })
    assert.equal(await tab.playwright.evaluate(() => document.activeElement?.matches('input, textarea')), false, 'Choosing a template must not focus a form field')
    assert.equal(await tab.playwright.getByRole('textbox', { name: '定时任务名称', exact: true }).evaluate(input => input.value), template.name)
    assert.ok((await tab.playwright.getByRole('textbox', { name: '执行内容', exact: true }).evaluate(input => input.value)).startsWith(template.prompt))
    assert.equal(await tab.playwright.getByRole('button', { name: '重复频率', exact: true }).innerText(), template.frequency)
    if (template.time) assert.equal(await tab.playwright.getByRole('button', { name: `时间：${template.time}`, exact: true }).isVisible(), true)
    if (template.frequency === '每周') assert.ok((await tab.playwright.getByRole('region', { name: '运行时间', exact: true }).innerText()).includes('周五'))
    assert.equal(await tab.playwright.getByRole('button', { name: '保存', exact: true }).isEnabled(), true)
  }
  return 'PASS: list New expands four choices, supports toggle/outside/Escape dismissal, saves a blank draft, and prefills every template without focusing form fields'
}
