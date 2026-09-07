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
  await tab.playwright.getByRole('button', { name: '保存', exact: true }).waitFor({ state: 'visible', timeoutMs: 1500 })
  assert.equal(await tab.playwright.getByRole('button', { name: '保存', exact: true }).isEnabled(), false, 'An empty prompt cannot be submitted')
  assert.equal(await tab.playwright.getByRole('button', { name: '返回定时任务总览', exact: true }).count(), 1, 'Only the editor close action returns to the overview')
  await tab.playwright.getByRole('textbox', { name: '定时任务名称', exact: true }).fill('新建入口回归')
  await tab.playwright.getByRole('textbox', { name: '执行内容', exact: true }).fill('整理当前项目中需要关注的改动。')
  await tab.playwright.getByRole('button', { name: '保存', exact: true }).click()
  await tab.playwright.getByRole('status').filter({ hasText: '定时任务已保存' }).waitFor({ state: 'visible', timeoutMs: 1500 })
  assert.equal(await tab.playwright.getByRole('button', { name: '保存', exact: true }).count(), 0, 'Creation must enter the persisted task')
  return 'PASS: detail New is clickable, opens an empty draft, and submits it successfully'
}
