import assert from 'node:assert/strict'
import { access, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { serveAutomationFixture } from '../fixtures/automation-workspace/serve.mjs'
import { launchAcceptanceBrowser } from './host-web-browser.mjs'

const chrome = process.env.ROVAI_TEST_CHROME ?? ({
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  win32: join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe')
}[process.platform] ?? '/usr/bin/google-chrome')
const select = css => `document.querySelector(${JSON.stringify(css)})`
const label = name => select(`[aria-label="${name}"]`)
const byText = (css, text) => `[...document.querySelectorAll(${JSON.stringify(css)})].find(el => el.textContent === ${JSON.stringify(text)})`
const row = name => `${byText('.automation-list-copy strong', name)}.closest('.automation-list-item')`
const rows = "[...document.querySelectorAll('.automation-list-copy strong')].map(el => el.textContent)"
const menuItems = "[...document.querySelectorAll('[role=menuitem]')].map(el => el.textContent)"
const api = 'window.automationWorkspaceFixture'

test('scheduled task interactions use the production Renderer on desktop and mobile', { timeout: 120_000 }, async t => {
  try { await access(chrome) } catch { return t.skip(`定时任务 Chrome 验收未运行。请通过 ROVAI_TEST_CHROME 指定可执行文件（当前路径 ${chrome}）。`) }
  const profile = await realpath(await mkdtemp(join(tmpdir(), 'rovai-scheduled-list-chrome-')))
  let server, browser
  t.after(async () => {
    try { await browser?.close() } finally {
      try { await server?.close() } finally { await rm(profile, { recursive: true, force: true }) }
    }
  })
  server = await serveAutomationFixture(0)
  const url = new URL('/scripts/fixtures/automation-workspace/?list-cases', server.resolvedUrls.local[0])
  console.log(`Automatic acceptance: Chrome profile ${profile}, in-memory RPC`)
  browser = await launchAcceptanceBrowser({ executable: chrome, args: ['--headless=new', '--no-first-run',
    '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'] })
  const { click, wait, evaluate } = browser
  const tab = name => click(byText('.automation-filter-tabs button', name))
  const open = name => click(`${row(name)}.querySelector('.automation-task-open')`)
  const toggle = name => click(label(name + '自动运行'))
  const matches = names => wait(`JSON.stringify(${rows}) === ${JSON.stringify(JSON.stringify(names))}`)
  const edit = async (name, value) => {
    await evaluate(`(${label(name)}).select()`)
    await browser.send('Input.insertText', { text: value })
  }
  const load = async mobile => {
    await browser.send('Emulation.setDeviceMetricsOverride', { width: mobile ? 390 : 1440, height: mobile ? 844 : 920, deviceScaleFactor: 1, mobile })
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: mobile })
    await browser.send('Page.navigate', { url: url.href + (mobile ? '&mobile' : '') })
    await wait(`document.readyState === 'complete' && ${rows}.length === 5 && !!document.documentElement.dataset.mobileWeb === ${mobile}`)
  }
  const issue = 'Issue / PR 巡检', weekly = '每周周报总结', manual = '新版更新说明', paused = '暂停巡检', ended = '单次复盘'
  const original = [issue, weekly, manual, paused, ended]

  await t.test('toggles, edits and page transitions preserve the correct rows while reads are pending', async () => {
    await load(false)
    await matches(original)
    const memberColumn = await evaluate("[...document.querySelectorAll('.automation-row-member')].map(el => el.getBoundingClientRect().left)")
    assert.equal(new Set(memberColumn).size, 1)
    await evaluate(`${api}.holdLists()`)
    await toggle(paused)
    await matches(original)
    await tab('开启')
    await matches([paused, issue, weekly])
    await evaluate(`${api}.releaseLists()`)
    await toggle(issue)
    await toggle(issue)
    await matches([paused, issue, weekly])
    assert.equal(await evaluate(`${label(issue + '自动运行')}.getAttribute('aria-checked')`), 'true')
    await open(paused)
    await tab('关闭')
    await matches([ended])
    await click(label('自动运行'))
    await matches([ended])
    await click(label('返回定时任务总览'))
    await matches([ended])
    await tab('全部')
    await open(weekly)
    const before = await evaluate(rows)
    await edit('定时任务名称', '周报改名')
    await click(label('返回定时任务总览'))
    await matches(before.map(name => name === weekly ? '周报改名' : name))
    await click(label('定时任务'))
    await wait(`${rows}[0] === '周报改名'`)
    await edit('搜索定时任务', '周报改名')
    await matches(['周报改名'])
    await click(byText('.automation-page-header button', '新建'))
    await edit('定时任务名称', '不匹配的任务')
    await edit('执行内容', '单独创建')
    await click(select('.automation-create-actions button'))
    await matches(['不匹配的任务', '周报改名'])
    await click(label('不匹配的任务的操作'))
    await click(byText('[role=menuitem]', '删除'))
    await click(byText('[role=menuitem]', '确认删除任务'))
    await matches(['周报改名'])
  })

  await t.test('closed schedules omit the next run, and running an ended task leaves its schedule closed', async () => {
    await load(false)
    assert.ok(await evaluate(`${row(issue)}.querySelector('.automation-row-timing').textContent.startsWith('下次')`))
    assert.equal(await evaluate(`!!${row(paused)}.querySelector('.automation-row-timing')`), false)
    assert.equal(await evaluate(`${label(paused + '自动运行')}.getAttribute('aria-checked')`), 'false')
    assert.doesNotMatch(await evaluate(`${label(paused + '自动运行')}.title`), /不会自动运行/)
    await open(paused)
    assert.equal(await evaluate(`!!${select('.automation-next-run')}`), false)
    await click(label(ended + '的操作'))
    assert.deepEqual(await evaluate(menuItems), ['运行一次', '删除'])
    await browser.key('Escape')
    await open(manual)
    assert.equal(await evaluate(`!!${select('.automation-editor [role=switch]')}`), false)
    await click(byText('.automation-editor-toolbar button', '运行一次'))
    await wait(`${api}.commands().some(c => c.method === 'automations.run' && c.command.automationId === 'release-notes')`)
    await open(ended)
    assert.match(await evaluate(`${select('.automation-editor')}.innerText`), /计划已结束/)
    assert.doesNotMatch(await evaluate(`${select('.automation-editor')}.innerText`), /重新安排|确认并开启|不会再?自动运行/)
    assert.equal(await evaluate(`!!${select('.automation-editor [role=switch]')}`), false)
    await click(byText('.automation-editor-toolbar button', '运行一次'))
    await wait(`!!${select('.automation-history-row')}`)
    const record = `${api}.definitions().find(task => task.automationId === 'ended')`
    assert.equal(await evaluate(`${record}.enabled`), false)
    assert.equal(await evaluate(`${record}.nextRunAt`), null)
    assert.deepEqual(await evaluate(`${record}.schedule`), { kind: 'once', date: '2000-01-01', at: '10:30' })
    assert.equal(await evaluate(`${api}.saveCount()`), 0)
  })

  await t.test('external creates respect both criteria while a local manual task stays visible until the next filter', async () => {
    await load(false)
    await tab('开启')
    await edit('搜索定时任务', '巡检')
    await matches([issue])
    // Issue the same RPC from outside the workspace. Only its update event reaches the list.
    await evaluate(`(async () => {
      const { memberId, projectRef, threadNaming, notifyChannels } = ${api}.definitions()[0]
      for (const [name, schedule] of [
        ['外部手动巡检', { kind: 'manual' }],
        ['外部日报', { kind: 'daily', at: '09:00' }],
        ['外部定时巡检', { kind: 'daily', at: '09:00' }]
      ]) {
        await window.rovai.request('automations.create', { commandId: crypto.randomUUID(),
          command: { name, prompt: '检查', schedule, memberId, projectRef, threadNaming, notifyChannels } })
      }
    })()`)
    await matches(['外部定时巡检', issue])
    await click(select('.automation-template-library .automation-template-card.release-notes'))
    await edit('定时任务名称', '本窗口的手动任务')
    await click(select('.automation-create-actions button'))
    await matches(['本窗口的手动任务', '外部定时巡检', issue])
    await tab('关闭')
    await tab('开启')
    await matches(['外部定时巡检', issue])
    await tab('全部')
    await edit('搜索定时任务', '本窗口')
    await matches(['本窗口的手动任务'])
  })

  await t.test('desktop pointer and keyboard menus and phone long press act on the intended row', async () => {
    await load(false)
    const button = `${row(issue)}.querySelector('.automation-task-open')`
    const point = await evaluate(`(()=>{const r=${button}.getBoundingClientRect();return {x:r.left+35,y:r.top+13}})()`)
    for (const type of ['mousePressed', 'mouseReleased']) await browser.send('Input.dispatchMouseEvent', { type, ...point, button: 'right', clickCount: 1 })
    await wait(`!!${select('[role=menu]')}`)
    assert.equal(await evaluate(`${select('[role=menu]')}.getAttribute('aria-label')`), issue + '的操作')
    const menuPoint = await evaluate(`(()=>{const r=${select('[role=menu]')}.getBoundingClientRect();return {x:r.left,y:r.top}})()`)
    assert.ok(Math.abs(menuPoint.x - point.x) < 8 && Math.abs(menuPoint.y - point.y) < 8)
    await browser.key('Escape')
    await wait(`document.activeElement === ${button}`)
    for (const type of ['keyDown', 'keyUp']) await browser.send('Input.dispatchKeyEvent', { type, key: 'F10', code: 'F10', modifiers: 8, windowsVirtualKeyCode: 121 })
    await wait(`!!${select('[role=menu]')}`)
    await browser.key('Escape')
    await load(true)
    await tab('开启')
    await toggle(weekly)
    await matches([issue, weekly])
    const target = await evaluate(`(()=>{const r=${label(weekly + '自动运行')}.getBoundingClientRect();return [r.width,r.height]})()`)
    assert.ok(target.every(n => n >= 44))
    await open(issue)
    await click(label('返回定时任务总览'))
    await matches([issue, weekly])
    await tab('全部')
    await tab('开启')
    await matches([issue])
    await tab('关闭')
    const endedButton = `${row(ended)}.querySelector('.automation-task-open')`
    await evaluate(`${endedButton}.scrollIntoView({ block: 'center', behavior: 'instant' })`)
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    const touch = await evaluate(`(() => {
      const rect = ${endedButton}.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    })()`)
    assert.ok(await evaluate(`${endedButton}.contains(document.elementFromPoint(${touch.x}, ${touch.y}))`))
    await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] })
    await wait(`${select('[role=menu]')}?.getAttribute('aria-label') === ${JSON.stringify(ended + '的操作')}`)
    await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await wait(`!!${select('[role=menu]')} && !!${select('.automation-workspace.overview')}`)
    assert.deepEqual(await evaluate(menuItems), ['运行一次', '删除'])
    await browser.key('Escape')
    await open(ended)
    await click(byText('.automation-schedule-value', '10:30'))
    await wait(`!!${select('[role=dialog].mobile-schedule-sheet')}`)
    await click(byText('.automation-time-presets button', '17:30'))
    const record = `${api}.definitions().find(task => task.automationId === 'ended')`
    await wait(`${record}.schedule.at === '17:30'`)
    assert.equal(await evaluate(`${record}.enabled`), false)
    assert.deepEqual(browser.errors, [])
  })
})
