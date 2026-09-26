import assert from 'node:assert/strict'
import { access, cp, mkdtemp, mkdir, realpath, readFile, writeFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { buildHostWebParity } from '../review-host-web-parity.mjs'
import { launchHost, within } from './host-test-client.mjs'
import { launchAcceptanceBrowser } from './host-web-browser.mjs'
import { coreDataDirectoryArguments, removeEphemeralRuntimeCampFilesRoot } from './runtime-camp-files-root.mjs'

const repository = resolve(import.meta.dirname, '../..')
const executable = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

test('phone navigation keeps hierarchy geometry while status stays in a 12px trailing slot', async () => {
  const [desktopCss, mobileCss] = await Promise.all([
    readFile(join(repository, 'apps/desktop/src/renderer/src/styles.css'), 'utf8'),
    readFile(join(repository, 'apps/web/src/mobile.css'), 'utf8')
  ])
  assert.match(desktopCss, /\.camp-status-slot\s*\{[^}]*width: var\(--nav-status-slot\)[^}]*height: var\(--nav-status-slot\)[^}]*place-items: center/s)
  assert.match(desktopCss, /\.camp-status-slot > \.camp-unread-dot\s*\{[^}]*width: var\(--nav-unread-size\)[^}]*height: var\(--nav-unread-size\)/s)
  assert.match(mobileCss, /\.unified-sidebar\s*\{[^}]*--nav-child-indent: 28px;[^}]*--nav-unread-size: 6px;/s)
  assert.match(mobileCss, /\.camp-nav-open\s*\{[^}]*padding: 0 12px;/s)
  assert.match(mobileCss, /\.camp-group-children\s*\{[^}]*padding-left: var\(--nav-child-indent\)/s)
  assert.match(mobileCss, /\.pinned-navigation > \.camp-nav-row > \.camp-nav-open > \.pinned-camp-icon\s*\{[^}]*flex: 0 0 20px;[^}]*width: 20px;[^}]*height: 20px;/s)
  assert.match(mobileCss, /\.pinned-camp-icon > svg\s*\{[^}]*width: 20px;[^}]*height: 20px;[^}]*flex: none;/s)
  assert.doesNotMatch(mobileCss, /mobile-bottom-navigation/)
  assert.doesNotMatch(mobileCss, /camp-marker-slot/)
})

test('phone system message copy control aligns with its message surface', async () => {
  const mobileCss = await readFile(join(repository, 'apps/web/src/mobile.css'), 'utf8')
  assert.match(mobileCss, /\.conversation-bubble\.system \.message-actions\s*\{[^}]*margin-left: 0;/s)
  assert.match(mobileCss, /\.conversation-bubble\.agent \.message-actions\s*\{[^}]*margin-left: -4px;/s)
})

// Real Host + production Web entry. No Electron profile, Runtime, or daily data.
test('phone workbench uses shared navigation, schedules and per-tab drafts', { timeout: 180_000 }, async t => {
  if (process.platform !== 'darwin' || !await access(executable).then(() => true, () => false)) { t.skip('Requires macOS Chrome; does not qualify real phones or other OSes'); return }
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-mobile-web-')))
  const dataDir = join(fixture, 'core')
  const output = process.env.ROVAI_MOBILE_OUTPUT ?? join(fixture, 'evidence')
  await mkdir(output, { recursive: true })
  console.log(JSON.stringify({ channel: 'automatic_acceptance', dataDir, skillLibraryRoot: join(dataDir, 'skills'), mcpConfigPath: join(dataDir, 'mcp.json'), chromeProfile: join(fixture, 'chrome'), runtime: false }))
  const host = launchHost(process.env.ROVAI_HOST_BIN ?? join(repository, 'target/debug/rovai-host'), [
    ...coreDataDirectoryArguments(dataDir), '--skill-library-root', join(dataDir, 'skills'), '--mcp-config-path', join(dataDir, 'mcp.json')
  ], { cwd: repository })
  let browser
  const checks = []
  let stage = 'startup'
  try {
    await within(host.ready)
    const profiles = await host.request('members.list')
    const member = profiles[0]
    for (let index = 1; index <= 10; index++) await host.request('camps.create', { commandId: crypto.randomUUID(), name: `分页会话 ${index}`, workspace: null, memberAgentIds: [member.agentId], defaultLeadAgentId: member.agentId, collaborationMode: 'peer' })
    const result = await host.request('camps.create', { commandId: crypto.randomUUID(), name: 'Mobile 验收对话', workspace: null, memberAgentIds: [member.agentId], defaultLeadAgentId: member.agentId, collaborationMode: 'peer' })
    assert.equal(result.status, 'applied')
    const campId = result.payload.campId
    const uiDirectory = join(fixture, 'web')
    await cp(process.env.ROVAI_WEB_UI ?? join(repository, 'out/web'), uiDirectory, { recursive: true })
    const service = await host.request('host.web.start', { listen: '127.0.0.1:0', uiDirectory })
    browser = await launchAcceptanceBrowser({ executable, args: ['--headless=new', `--user-data-dir=${join(fixture, 'chrome')}`, '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', 'about:blank'] })
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true })
    const element = (label, scope = 'document') => `[...${scope}.querySelectorAll('button')].find(e=>e.getClientRects().length>0 && (e.textContent.trim()===${JSON.stringify(label)} || e.matches('[data-setting]') && e.querySelector('span')?.textContent===${JSON.stringify(label)}))`
    const click = async label => {
      const target = element(label)
      if (['队员', '记忆', '设置', '定时任务', '使命板'].includes(label) && !await browser.evaluate(`Boolean(${target})`)) {
        await browser.click(`[...document.querySelectorAll('[aria-label="打开主菜单"]')].find(e=>e.getClientRects().length>0)`)
        await browser.wait(`!!document.querySelector('#mobile-app-menu[data-state="open"]')`)
      }
      await browser.wait(`Boolean(${target}) && !(${target}).disabled`); await browser.click(target)
      if (['队员', '记忆', '设置', '定时任务', '使命板'].includes(label)) await browser.wait(`!document.querySelector('#mobile-app-menu')`)
    }
    const openSecondary = async label => {
      await browser.click(`document.querySelector('.mobile-camp-more')`)
      await browser.wait(`document.querySelector('.mobile-camp-menu [role=menuitem]')!==null`)
      await browser.click(`[...document.querySelectorAll('.mobile-camp-menu [role=menuitem]')].find(e=>e.textContent.trim()===${JSON.stringify(label)})`)
    }
    const byLabel = label => `[...document.querySelectorAll('[aria-label=${JSON.stringify(label)}]')].find(e=>e.getClientRects().length>0)`
    const fill = async (selector, value) => { await browser.click(`document.querySelector(${JSON.stringify(selector)})`); await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).select()`); await browser.send('Input.insertText', { text: value }) }
    const capture = async name => {
      await browser.wait(`!document.getAnimations().some(animation=>animation.playState==='running' && Number.isFinite(animation.effect.getTiming().iterations))`)
      await browser.capture(join(output, `${name}.png`))
      const geometry = await browser.evaluate(`({ width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth, shell: document.querySelector('.app-shell').getBoundingClientRect().toJSON(), errors: [...document.querySelectorAll('[role=alert]')].filter(e=>e.getClientRects().length>0).map(e=>e.textContent) })`)
      assert.equal(geometry.overflow, false, `${name}: viewport overflow`)
      checks.push({ name, geometry })
    }
    await browser.send('Page.navigate', { url: service.origin })
    await browser.wait(`document.querySelector('#administrator-token')!==null`)
    await verifyInitialLogin(browser, 'desktop', output)
    await fill('#administrator-token', service.administratorToken)
    await browser.click(`document.querySelector('.web-login button[type=submit]')`)
    await browser.wait(`document.documentElement.dataset.mobileWeb==='true' && document.querySelector('[aria-label="打开主菜单"]')!==null`)
    await browser.click(byLabel('打开主菜单'))
    await browser.wait(`document.querySelector('.camp-nav-open')!==null`)
    assert.equal(await browser.evaluate('document.title'), 'Rovai AI')
    stage = 'wide Web pinned navigation'
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 920, deviceScaleFactor: 1, mobile: false })
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: false })
    await browser.wait(`document.documentElement.dataset.mobileWeb===undefined && document.querySelector('.camp-group-children .camp-nav-row .camp-menu-trigger')!==null`)
    await browser.evaluate(`document.querySelector('.camp-group-children .camp-nav-row .camp-menu-trigger').focus()`)
    await browser.key('Enter')
    await browser.wait(`[...document.querySelectorAll('[role=menuitem]')].some(item=>item.textContent.trim()==='置顶')`)
    await browser.click(`[...document.querySelectorAll('[role=menuitem]')].find(item=>item.textContent.trim()==='置顶')`)
    await browser.wait(`document.querySelector('.pinned-navigation .pinned-camp-icon')?.getClientRects().length>0`)
    const pinnedAlignment = await browser.evaluate(`(()=>{
      const pinned=document.querySelector('.pinned-navigation .camp-nav-row')
      const ordinary=document.querySelector('.navigation-projects .camp-group-children .camp-nav-row')
      const icon=pinned?.querySelector('.pinned-camp-icon')
      const pinnedTitle=pinned?.querySelector('.truncate')?.getBoundingClientRect()
      const ordinaryTitle=ordinary?.querySelector('.truncate')?.getBoundingClientRect()
      return pinned&&ordinary&&icon&&pinnedTitle&&ordinaryTitle?{
        icon:icon.getBoundingClientRect().toJSON(),
        iconDisplay:getComputedStyle(icon).display,
        titleDelta:Math.abs(pinnedTitle.left-ordinaryTitle.left)
      }:null
    })()`)
    assert.ok(pinnedAlignment, 'pinned and ordinary Web conversation rows are visible')
    assert.ok(['flex', 'inline-flex'].includes(pinnedAlignment.iconDisplay), 'Web pinned conversation shows its bubble icon')
    assert.equal(pinnedAlignment.icon.width, 17, 'Web bubble icon uses the shared navigation glyph slot')
    assert.ok(pinnedAlignment.titleDelta < 1, 'Web pinned and project conversation titles share one text baseline')
    await capture('web-pinned-conversation')
    await browser.evaluate(`document.querySelector('.pinned-navigation .camp-nav-row .camp-menu-trigger').focus()`)
    await browser.key('Enter')
    await browser.wait(`[...document.querySelectorAll('[role=menuitem]')].some(item=>item.textContent.trim()==='取消置顶')`)
    await browser.click(`[...document.querySelectorAll('[role=menuitem]')].find(item=>item.textContent.trim()==='取消置顶')`)
    await browser.wait(`document.querySelector('.pinned-navigation')===null`)
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true })
    await browser.wait(`document.documentElement.dataset.mobileWeb==='true' && document.querySelector('[aria-label="打开主菜单"]')!==null`)
    stage = 'conversation list'
    await capture('conversations')
    assert.equal(await browser.evaluate(`document.querySelectorAll('#mobile-app-menu .camp-marker-slot').length`), 0, 'phone navigation has no leading status marker')
    const rowAlignment = await browser.evaluate(`([...document.querySelectorAll('.camp-group-children .camp-nav-row')].filter(row=>row.getClientRects().length>0).map(row=>{const status=row.querySelector('.camp-status-slot').getBoundingClientRect();const title=row.querySelector('.truncate').getBoundingClientRect();const box=row.getBoundingClientRect();return {rowCenter:box.top+box.height/2,statusCenter:status.top+status.height/2,titleCenter:title.top+title.height/2,titleLeft:title.left,statusWidth:status.width,statusHeight:status.height,x:box.x,width:box.width}}))`)
    assert.ok(rowAlignment.length > 0, 'conversation rows are visible')
    for (const row of rowAlignment) {
      assert.ok(Math.abs(row.rowCenter - row.statusCenter) < 1, 'status slot is vertically centered in its row')
      assert.ok(Math.abs(row.titleCenter - row.statusCenter) < 1, 'status slot is vertically aligned with the title')
      assert.ok(Math.abs(row.titleLeft - 48) < 1, 'project conversation titles keep the 48px phone text axis')
      assert.equal(row.statusWidth, 12, 'status slot width is 12px')
      assert.equal(row.statusHeight, 12, 'status slot height is 12px')
    }
    await browser.click(byLabel('选择工作目录'))
    await browser.wait(`document.querySelector('.web-workspace-picker')?.textContent.includes('选择项目目录') && !document.querySelector('.web-workspace-list[aria-busy=true]')`)
    assert.equal(await browser.evaluate(`document.querySelector('.web-workspace-picker').textContent.includes('Host')`), false, 'project picker does not expose Host terminology')
    assert.equal(await browser.evaluate(`document.querySelector('#host-workspace-path')===null`), true, 'complete path input stays folded')
    await browser.click(byLabel('输入完整路径'))
    await browser.wait(`document.querySelector('#host-workspace-path:not(:disabled)')!==null`)
    await fill('#host-workspace-path', fixture)
    await click('前往')
    await browser.wait(`!document.querySelector('#host-workspace-path') && !(${element('使用此目录')}).disabled`)
    const primaryColor = await browser.evaluate(`getComputedStyle(${element('使用此目录')}).backgroundColor`)
    const rgb = primaryColor.match(/[\d.]+/g).slice(0, 3).map(Number)
    assert.ok(rgb.every(channel => channel < 80) && Math.max(...rgb) - Math.min(...rgb) < 20, 'directory action is neutral black')
    await capture('workspace-picker')
    await click('取消')
    await browser.wait(`!document.querySelector('.web-workspace-picker')`)
    await browser.click(byLabel('打开主菜单'))
    await browser.wait(`!!document.querySelector('#mobile-app-menu')`)
    assert.deepEqual(await browser.evaluate(`[...document.querySelectorAll('#mobile-app-menu .unified-primary-nav .rail-label')].map(e=>e.textContent)`), ['新对话','队员','记忆','使命板','定时任务'])
    assert.equal(await browser.evaluate(`document.querySelectorAll('.camp-nav-open').length`), 5)
    await click('查看更多'); await browser.wait(`document.querySelectorAll('.camp-nav-open').length===10`)
    await click('查看更多'); await browser.wait(`document.querySelectorAll('.camp-nav-open').length===11`)
    await capture('conversations-expanded')
    await click('收起'); await browser.wait(`document.querySelectorAll('.camp-nav-open').length===5`)
    await browser.click(byLabel('新对话'))
    await browser.wait(`document.querySelector('.new-camp-quick-setting')!==null`)
    assert.equal(await browser.evaluate(`document.querySelector('#new-camp-name')===null`), true, 'optional name stays folded')
    assert.equal(await browser.evaluate(`document.querySelector('#new-camp-lead-label')?.textContent`), '队长', 'conversation Lead is presented as 队长')
    assert.equal(await browser.evaluate(`document.querySelector('#new-camp-lead-value')?.textContent`), '暂无可选队长', 'empty Lead state uses the 队长 term')
    await capture('new-conversation')
    await browser.click(byLabel('关闭新对话'))
    await browser.click(byLabel('打开主菜单'))
    await click('Mobile 验收对话')
    await browser.wait(`document.querySelector('[contenteditable=true]')!==null && document.querySelector('.mobile-empty-camp-welcome')!==null`)
    assert.equal(await browser.evaluate(`document.querySelector('.mobile-empty-camp-welcome .empty-camp-mark')===null && document.querySelector('.mobile-empty-camp-welcome .empty-camp-context')===null`), true, 'phone empty Camp omits the logo and configuration tags')
    assert.equal(await browser.evaluate(`document.querySelector('.mobile-starter-toggle').getAttribute('aria-expanded')`), 'false')
    await capture('camp-empty')
    await click('起步建议')
    await browser.wait(`document.querySelectorAll('.mobile-starter-list > button').length===3`)
    assert.deepEqual(await browser.evaluate(`[...document.querySelectorAll('.mobile-starter-list > button')].map(button=>button.textContent.trim())`), ['先了解项目', '整理成任务', '检查工作区'])
    assert.equal(await browser.evaluate(`document.querySelector('.mobile-starter-list').textContent.includes('读取项目结构')`), false, 'phone suggestions only show concise titles')
    await capture('camp-empty-suggestions')
    await click('起步建议')
    await browser.wait(`document.querySelector('.mobile-starter-list')===null`)
    stage = 'draft and Camp tabs'
    await browser.click(byLabel('会话更多操作'))
    await browser.wait(`document.querySelector('.mobile-camp-menu [role=menuitem]')!==null`)
    assert.deepEqual(await browser.evaluate(`[...document.querySelectorAll('.mobile-camp-menu [role=menuitem]')].map(e=>e.textContent.trim())`), ['任务','队员','单聊'])
    await capture('camp-more-menu')
    await browser.key('Escape')
    await browser.wait(`document.querySelector('.mobile-camp-menu')===null`)
    const editor = '.conversation-controls [contenteditable=true]'
    await browser.wait(`document.querySelector('.structured-mention-placeholder')!==null`)
    const placeholder = await browser.evaluate(`(()=>{const p=document.querySelector('.structured-mention-placeholder');const e=document.querySelector('.structured-mention-editor');const s=getComputedStyle(e);return {x:p.getBoundingClientRect().left-e.getBoundingClientRect().left-parseFloat(s.paddingLeft),y:p.getBoundingClientRect().top-e.getBoundingClientRect().top-parseFloat(s.paddingTop),font:getComputedStyle(p).fontSize,editorFont:s.fontSize}})()`)
    assert.ok(Math.abs(placeholder.x)<1 && Math.abs(placeholder.y)<1, 'placeholder starts at the same position as typed text')
    assert.ok(parseFloat(placeholder.font) <= parseFloat(placeholder.editorFont))
    assert.ok(parseFloat(placeholder.editorFont) >= 16, 'editing avoids iOS focus zoom')
    await browser.click(`document.querySelector(${JSON.stringify(editor)})`)
    await browser.send('Input.insertText', { text: '手机标签页草稿' })
    await openSecondary('任务')
    const taskControls = await browser.evaluate(`[...document.querySelectorAll('.task-status-filter,.task-new-button')].map(e=>({height:e.getBoundingClientRect().height,font:getComputedStyle(e).fontSize}))`)
    assert.deepEqual(taskControls, [{height:36,font:'12px'},{height:36,font:'12px'}])
    await capture('camp-tasks')
    await browser.click(`document.querySelector('.task-new-button')`)
    await browser.wait(`document.querySelector('.task-editor-dialog')!==null`)
    assert.deepEqual(await browser.evaluate(`[...document.querySelectorAll('.task-editor-dialog .task-field > span')].map(e=>e.textContent)`), ['标题', '责任范围与要求', '负责人'])
    await capture('new-task')
    await fill('.task-editor-dialog input', '手机任务创建验收')
    await browser.evaluate(`(()=>{const s=document.querySelector('.task-editor-dialog select');s.value=${JSON.stringify(member.agentId)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await browser.click(`document.querySelector('.task-editor-dialog .task-submit')`)
    await browser.wait(`document.querySelector('.task-editor-dialog')===null`)
    await browser.wait(`document.querySelector('.task-panel')?.textContent.includes('手机任务创建验收')`)
    await capture('camp-task-created')
    await browser.click(byLabel('收起会话详情'))
    await click('执行'); await capture('camp-execution-empty')
    await openSecondary('任务')
    assert.equal(await browser.evaluate(`document.querySelector('.mobile-camp-tabs').hidden`), true)
    await browser.click(byLabel('收起会话详情'))
    assert.equal(await browser.evaluate(`document.querySelector('.camp-detail-popover[data-detail=execution]')?.hidden`), false, 'closing tasks restores execution')
    await openSecondary('队员')
    await browser.key('Escape')
    assert.equal(await browser.evaluate(`document.querySelector('.camp-detail-popover[data-detail=execution]')?.hidden`), false, 'closing members restores execution')
    await openSecondary('单聊')
    await browser.wait(`document.querySelector('.single-chat-popover')?.hidden===false`)
    await browser.click(byLabel('收起单聊'))
    assert.equal(await browser.evaluate(`document.querySelector('.camp-detail-popover[data-detail=execution]')?.hidden`), false, 'closing private chat restores execution')
    await browser.click(byLabel('收起会话详情'))
    assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(editor)}).textContent`), '手机标签页草稿')
    await capture('camp')
    await openSecondary('任务')
    await browser.click(byLabel('打开主菜单'))
    await browser.wait(`document.querySelector('.mobile-conversation-drawer')!==null`)
    await browser.wait(`getComputedStyle(document.querySelector('.mobile-conversation-drawer')).opacity==='1'`)
    assert.equal(await browser.evaluate(`document.querySelector('.app-shell').dataset.mobileView`), 'camp', 'the current conversation remains mounted under its drawer')
    await capture('conversation-drawer')
    const selectedRow = await browser.evaluate(`(()=>{const drawer=document.querySelector('.mobile-conversation-drawer');const selected=drawer.querySelector('.camp-group-children .camp-nav-row.selected');const peer=drawer.querySelector('.camp-group-children .camp-nav-row:not(.selected)');if(!selected||!peer)return null;const a=selected.getBoundingClientRect();const b=peer.getBoundingClientRect();return {selected:{x:a.x,width:a.width,background:getComputedStyle(selected).backgroundColor},peer:{x:b.x,width:b.width}}})()`)
    assert.ok(selectedRow, 'selected conversation remains visible in the list')
    assert.ok(Math.abs(selectedRow.selected.x - selectedRow.peer.x) < 1 && Math.abs(selectedRow.selected.width - selectedRow.peer.width) < 1, 'selected background shares the complete conversation row')
    assert.notEqual(selectedRow.selected.background, 'rgba(0, 0, 0, 0)', 'selected conversation keeps its gray surface')
    await click('Mobile 验收对话')
    await browser.wait(`document.querySelector('.mobile-conversation-drawer')===null`)
    await browser.wait(`document.querySelector(${JSON.stringify(editor)})?.textContent==='手机标签页草稿'`)
    if (await browser.evaluate(`document.querySelector('[aria-label="收起会话详情"]')?.getClientRects().length>0`)) {
      await browser.click(byLabel('收起会话详情'))
    }
    await browser.wait(`document.querySelector(${JSON.stringify(editor)})?.getClientRects().length>0`)
    await browser.evaluate('window.mobileAcceptanceReloadMarker=true')
    await browser.send('Page.reload')
    await browser.wait(`window.mobileAcceptanceReloadMarker!==true && document.querySelector(${JSON.stringify(editor)})?.textContent==='手机标签页草稿' && document.querySelector(${JSON.stringify(editor)})?.getClientRects().length>0`)
    assert.equal(await browser.evaluate(`document.querySelector('.web-login-overlay')===null`), true)
    stage = 'phone return key'
    const messagesBeforeReturn = (await host.request('camps.snapshot', { campId })).messages.length
    await browser.click(`document.querySelector(${JSON.stringify(editor)})`)
    await browser.key('Enter')
    await browser.wait(`document.querySelector(${JSON.stringify(editor)})?.innerHTML.includes('<br')`)
    assert.equal((await host.request('camps.snapshot', { campId })).messages.length, messagesBeforeReturn, 'phone Return inserts a line break; only Send submits')
    await browser.click(byLabel('提及队员'))
    await browser.wait(`document.querySelector('.structured-mention-menu [role=option]')!==null`)
    await capture('mention-picker')
    await browser.click(`document.querySelector('.structured-mention-menu [role=option]')`)
    await browser.wait(`document.querySelector('.structured-mention-menu')===null`)
    await browser.wait(`document.activeElement===document.querySelector(${JSON.stringify(editor)})`)
    const publicDraft = await browser.evaluate(`document.querySelector(${JSON.stringify(editor)}).textContent`)
    stage = 'private editor'
    await openSecondary('单聊')
    await browser.wait(`document.querySelector('.single-chat-popover')?.hidden===false`)
    await browser.click(`document.querySelector('.single-chat-target-trigger')`)
    await browser.click(`document.querySelector('.single-chat-target-option')`)
    await browser.wait(`document.querySelector('.single-chat-composer textarea')?.disabled===false`)
    assert.equal(await browser.evaluate(`document.querySelector('.conversation-controls').getClientRects().length`), 0, 'only the private Composer is shown')
    await browser.click(`document.querySelector('.single-chat-composer textarea')`)
    await browser.send('Input.insertText', { text: '独立私聊草稿' })
    // Native textarea editing needs the text-bearing Return event; the shared
    // helper sends only key events, sufficient for Lexical's command handler.
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' })
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await browser.wait(`document.querySelector('.single-chat-composer textarea').value.endsWith('\\n')`)
    const privateId = await browser.evaluate(`document.querySelector('.single-chat-popover').dataset.singleChatOwner`)
    const privateSnapshot = await host.request('singleChat.get', { conversationId: privateId })
    assert.equal(privateSnapshot.messages.length, 0)
    assert.equal(privateSnapshot.agentRuns.length, 0, 'phone Return never dispatches a private Run')
    await capture('private-chat')
    await browser.click(byLabel('收起单聊'))
    assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(editor)}).textContent`), publicDraft)
    await openSecondary('队员')
    await browser.wait(`document.querySelector('.camp-detail-popover[data-detail=members]')?.hidden===false`)
    assert.equal(await browser.evaluate(`document.querySelector('.camp-detail-popover[data-detail=members] .camp-member-action-button')===null`), true, 'mobile Camp members do not expose Runtime editing')
    await capture('camp-members')
    await browser.click(byLabel('收起会话详情'))
    await browser.click(byLabel('打开主菜单'))
    await browser.wait(`document.querySelector('.mobile-conversation-drawer')!==null`)
    stage = 'members'
    await click('队员')
    await browser.wait(`document.querySelector('.mobile-conversation-drawer')===null`)
    await browser.wait(`document.querySelector('.member-sidebar-select')!==null`)
    await capture('members')
    await browser.click(`document.querySelector('.member-sidebar-select')`)
    await browser.wait(`document.querySelector('.member-editor-view[data-mobile-detail]')!==null`)
    await capture('member-detail')
    await browser.evaluate(`document.querySelector('.member-editor-runtime').scrollIntoView({block:'start'})`)
    await capture('member-runtime')
    await browser.click(byLabel('返回队员列表'))
    stage = 'memory'
    await click('记忆')
    await browser.wait(`document.querySelector('.memory-library')!==null`)
    assert.equal(await browser.evaluate(`document.querySelector('.mobile-memory-overview').getAttribute('aria-expanded')`), 'false')
    assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('.memory-summary-strip')).display`), 'none', 'memory summary starts folded')
    await click('概览')
    assert.notEqual(await browser.evaluate(`getComputedStyle(document.querySelector('.memory-summary-strip')).display`), 'none')
    await click('概览')
    await click('新增记忆')
    await fill('.memory-body-field textarea', '手机端真实记忆验收。')
    await fill('.memory-body-field input', '手机端验收')
    await click('保存记忆')
    await browser.wait(`document.querySelector('.app-dialog')===null && document.querySelectorAll('.memory-catalog-item').length===1`)
    await browser.click(`document.querySelector('.memory-catalog-item')`)
    await browser.wait(`document.querySelector('.memory-library[data-mobile-detail]')!==null`)
    assert.ok((await host.request('memory.list')).memories.some(item => item.currentBody === '手机端真实记忆验收。'))
    assert.equal(await browser.evaluate(`document.querySelector('details.memory-revisions')?.open`), false)
    await capture('memory-detail')
    await browser.click(`document.querySelector('.memory-revisions > summary')`)
    await browser.wait(`document.querySelector('details.memory-revisions').open`)
    await capture('memory-versions')
    await browser.click(byLabel('返回记忆列表'))
    await browser.wait(`!document.querySelector('.memory-library[data-mobile-detail]') && document.querySelector('.memory-catalog-item')?.getClientRects().length>0`)
    // Exercise a populated library, including re-entry and a second selection.
    await click('新增记忆')
    await fill('.memory-body-field textarea', '第二条手机记忆：正文和治理操作都可以独立打开。')
    await fill('.memory-body-field input', '第二条')
    await click('保存记忆')
    await browser.wait(`document.querySelector('.app-dialog')===null && document.querySelectorAll('.memory-catalog-item').length===2`)
    await browser.click(`[...document.querySelectorAll('.memory-catalog-item')].find(e=>e.textContent.includes('第二条手机记忆'))`)
    await browser.wait(`document.querySelector('.memory-library[data-mobile-detail]')!==null`)
    await browser.click(byLabel('返回记忆列表'))
    await browser.wait(`!document.querySelector('.memory-library[data-mobile-detail]') && document.querySelectorAll('.memory-catalog-item').length===2`)
    await click('队员'); await click('记忆')
    await browser.wait(`!document.querySelector('.memory-library[data-mobile-detail]') && document.querySelectorAll('.memory-catalog-item').length===2`)
    await browser.click(`[...document.querySelectorAll('.memory-catalog-item')].find(e=>e.textContent.includes('手机端真实记忆验收。'))`)
    await browser.wait(`document.querySelector('.memory-detail h3')?.textContent==='手机端真实记忆验收。'`)
    await click('修订')
    await fill('.memory-body-field textarea', '手机端真实记忆验收，已修订。')
    await click('保存修订')
    await browser.wait(`document.querySelector('.app-dialog')===null && document.querySelector('.memory-detail h3')?.textContent==='手机端真实记忆验收，已修订。'`)
    await browser.click(byLabel('返回记忆列表'))
    await browser.wait(`!document.querySelector('.memory-library[data-mobile-detail]')`)
    await capture('memory-list')
    stage = 'settings'
    await click('设置')
    await browser.wait(`document.querySelector('.mobile-settings-workspace')?.dataset.settingsSection==='index'`)
    assert.equal(await browser.evaluate(`document.querySelector('.mobile-settings-index input')===null`), true, 'settings overview has no search')
    assert.equal(await browser.evaluate(`document.querySelectorAll('[data-setting]').length`), 12, 'Desktop Host exposes all twelve settings categories')
    await capture('settings')
    await click('关于与更新')
    await browser.wait(`document.querySelector('.about-updates-settings')!==null`)
    await browser.wait(`/版本 v?\\d+\\.\\d+/.test(document.querySelector('.about-identity').textContent)`)
    assert.equal(await browser.evaluate(`document.querySelector('.about-update-actions')===null`), true, 'Desktop-hosted mobile has no updater')
    await capture('desktop-about')
    await browser.click(byLabel('返回设置'))
    await click('外观')
    await browser.wait(`document.querySelector('.mobile-font-slider input')!==null`)
    await capture('appearance')
    await browser.click(byLabel('增大会话字号'))
    await browser.wait(`document.querySelector('.mobile-font-slider output')?.textContent==='14'`)
    await browser.click(byLabel('返回设置'))
    assert.equal(await browser.evaluate(`[...document.querySelectorAll('.settings-index-rows button')].some(e=>e.querySelector('span')?.textContent==='远程连接')`), true, 'Desktop Host keeps remote connection settings available')
    for (const [label, section] of [['通用', 'general'], ['提醒', 'notifications'], ['Skills', 'skills'], ['工具箱', 'toolbox'], ['MCP', 'mcp'], ['运行时', 'runtime'], ['远程连接', 'remote'], ['渠道', 'channels'], ['运行监控', 'monitoring'], ['诊断与修复', 'diagnostics']]) {
      await click(label)
      // The Runtime page has its own status-dependent content; the shared settings panel is stable.
      await browser.wait(`document.querySelector('.settings-panel-${section}')!==null`)
      await browser.wait(`document.querySelector('.settings-panel-${section}').innerText.trim().length>15`)
      if (label === 'Skills') await browser.wait(`!document.querySelector('.settings-panel').innerText.includes('正在读取')`)
      if (label === 'MCP') await browser.wait(`document.querySelector('.mcp-first-connection')!==null`)
      if (label === '运行时') {
        const rows = await browser.evaluate(`[...document.querySelectorAll('.runtime-product-row')].map(row=>{
          const nodes=['.runtime-product-logo','.runtime-product-copy','.runtime-product-status','.runtime-product-settings'].map(selector=>row.querySelector(selector)).filter(Boolean)
          const centers=nodes.map(node=>{const box=node.getBoundingClientRect();return box.top+box.height/2})
          return {delta:Math.max(...centers)-Math.min(...centers),gear:row.querySelector('.runtime-product-settings')?.getBoundingClientRect().height}
        })`)
        assert.ok(rows.length>0 && rows.every(row=>row.delta<1 && row.gear>=44), JSON.stringify(rows))
      }
      await capture(`settings-${label}`)
      await browser.click(byLabel('返回设置'))
    }
    stage = 'automation schedules'
    await click('定时任务')
    await browser.wait(`Boolean(${element('新建')})`)
    await capture('automations')
    await click('新建')
    await browser.wait(`document.querySelector('[aria-label="重复频率"]')!==null`)
    await browser.click(byLabel('重复频率'))
    assert.deepEqual(await browser.evaluate(`[...document.querySelectorAll('[role=menuitemradio]')].map(e=>e.textContent.trim())`), ['每天', '工作日', '每周', '仅一次', '自定义', '手动触发'])
    await browser.click(`[...document.querySelectorAll('[role=menuitemradio]')].find(e=>e.textContent.trim()==='仅一次')`)
    await browser.click(`document.querySelector('.automation-schedule-value[aria-label^="日期："]')`)
    await browser.wait(`document.querySelector('.mobile-schedule-sheet')!==null`)
    assert.equal(await browser.evaluate(`document.querySelectorAll('.automation-calendar-day').length`), 42)
    assert.ok(await browser.evaluate(`document.querySelector('.automation-calendar-day').getBoundingClientRect().height>=44`))
    await capture('automation-date')
    await browser.click(byLabel('下个月'))
    await browser.click(`document.querySelector('.automation-calendar-day:not(.outside)')`)
    await browser.click(`document.querySelector('.automation-schedule-value[aria-label^="时间："]')`)
    await browser.wait(`document.querySelector('.mobile-schedule-sheet')!==null`)
    await capture('automation-time')
    await click('17:30')
    assert.match(await browser.evaluate(`document.querySelector('.automation-schedule-value[aria-label^="时间："]').textContent`), /17:30/)
    await capture('automation-form')
    await fill('.automation-name-input', '手机定时验收')
    await fill('.automation-prompt-input', '仅保存手动计划，不执行。')
    await browser.click(byLabel('重复频率'))
    await browser.click(`[...document.querySelectorAll('[role=menuitemradio]')].find(e=>e.textContent.trim()==='手动触发')`)
    await click('保存')
    await browser.wait(`document.querySelector('.automation-editor-toolbar')?.textContent.includes('已保存')`)
    const saved = (await host.request('automations.list', { status: 'all', limit: 50 })).automations.find(item => item.name === '手机定时验收')
    assert.equal(saved?.schedule.kind, 'manual')

    stage = 'mission board and conversation'
    const createdMission = await host.request('missions.create', { commandId: crypto.randomUUID(), command: {
      title: '手机使命验收', description: '验证使命板和会话返回，不启动 Runtime。', projectPath: '', projectBindingKind: 'quick_chat',
      memberAgentIds: [member.agentId], defaultLeadAgentId: member.agentId, tags: ['手机验收']
    } })
    assert.equal(createdMission.status, 'applied', JSON.stringify(createdMission))
    const mission = createdMission.payload
    await click('使命板')
    await browser.wait(`document.querySelector('.mobile-mission-board:not([hidden])')!==null`)
    const statusTab = label => `[...document.querySelectorAll('.mission-status-tabs button')].find(e=>e.textContent.includes(${JSON.stringify(label)}))`
    await browser.click(statusTab('未开始'))
    await browser.wait(`document.querySelector('.mobile-mission-list .mission-card-open')?.textContent==='手机使命验收'`)
    for (const width of [375, 390, 430]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true })
      await capture(`mission-board-${width}`)
      const geometry = await browser.evaluate(`[...document.querySelectorAll('.mission-status-tabs button')].map(e=>({height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width,overflow:e.scrollWidth>e.clientWidth}))`)
      assert.ok(geometry.every(e=>e.height>=44 && !e.overflow), JSON.stringify(geometry))
    }
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    await browser.click(byLabel('搜索使命'))
    await fill('input[aria-label="搜索使命"]', '没有的标题')
    await browser.wait(`document.querySelector('.mission-mobile-empty h2')?.textContent==='没有匹配的使命'`)
    await click('取消')
    await browser.click(`document.querySelector('.mobile-mission-list .mission-card-open')`)
    await browser.wait(`!!document.querySelector('.mission-full .camp-workspace') && !!document.querySelector('[aria-label="返回使命板"]')`)
    await browser.click(`document.querySelector(${JSON.stringify(editor)})`)
    await browser.send('Input.insertText', { text: '使命会话保留的草稿' })
    await capture('mission-conversation')
    await browser.click(byLabel('会话更多操作'))
    await browser.wait(`!!document.querySelector('.mobile-camp-menu')`)
    assert.deepEqual(await browser.evaluate(`[...document.querySelectorAll('.mobile-camp-menu [role=menuitem]')].map(e=>e.textContent.trim())`), ['任务','队员','单聊','活动'])
    await browser.click(`[...document.querySelectorAll('.mobile-camp-menu [role=menuitem]')].find(e=>e.textContent.trim()==='活动')`)
    await browser.wait(`!!document.querySelector('[aria-label="返回对话"]')`)
    await capture('mission-activity')
    await browser.click(byLabel('返回对话'))
    await browser.wait(`!!document.querySelector('[aria-label="返回使命板"]')`)
    assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(editor)}).textContent`), '使命会话保留的草稿')
    await browser.click(byLabel('返回使命板'))
    await browser.wait(`!!document.querySelector('.mobile-mission-board:not([hidden])')`)
    assert.match(await browser.evaluate(`document.querySelector('.mission-status-tabs [aria-pressed=true]').textContent`), /^未开始/)
    await browser.click(`document.querySelector('.mobile-mission-list .mission-card-open')`)
    await browser.wait(`document.querySelector(${JSON.stringify(editor)})?.textContent==='使命会话保留的草稿'`)
    await browser.evaluate('history.back()')
    await browser.wait(`!!document.querySelector('.mobile-mission-board:not([hidden])')`)

    stage = 'mission long press and editing'
    const touch = await browser.evaluate(`(()=>{const r=document.querySelector('.mission-board-card').getBoundingClientRect();return {x:r.left+30,y:r.top+24,id:1}})()`)
    await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] })
    await browser.wait(`!!document.querySelector('.mission-action-menu')`)
    await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    assert.equal(await browser.evaluate(`document.querySelector('.mission-full')===null`), true, 'long press opens actions without opening the conversation')
    await capture('mission-actions')
    await browser.click(`[...document.querySelectorAll('.mission-action-menu [role=menuitem]')].find(e=>e.textContent.trim()==='状态')`)
    await browser.wait(`!!document.querySelector('.mission-action-submenu')`)
    await capture('mission-status-menu')
    await browser.click(`[...document.querySelectorAll('.mission-action-submenu [role=menuitemradio]')].find(e=>e.textContent.includes('需要你'))`)
    await browser.wait(`!document.querySelector('.mission-action-menu') && !document.querySelector('.mobile-mission-list .mission-card-open')`)
    await browser.click(statusTab('需要你'))
    await browser.wait(`document.querySelector('.mobile-mission-list .mission-card-open')?.textContent==='手机使命验收'`)
    assert.equal((await host.request('missions.get', { missionId: mission.missionId })).status, 'needs_you')
    await browser.evaluate(`document.querySelector('.mission-board-card .mobile-context-trigger').focus()`)
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' })
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await browser.wait(`!!document.querySelector('.mission-action-menu')`)
    await browser.click(`[...document.querySelectorAll('.mission-action-menu [role=menuitem]')].find(e=>e.textContent.trim()==='编辑')`)
    await browser.wait(`!!document.querySelector('.mission-edit-dialog')`)
    await fill('.mission-edit-dialog .mission-editor-title', '手机使命已编辑')
    await capture('mission-edit')
    await browser.click(`document.querySelector('.mission-edit-dialog button[type=submit]')`)
    await browser.wait(`!document.querySelector('.mission-edit-dialog') && document.querySelector('.mission-card-open')?.textContent==='手机使命已编辑'`)
    assert.equal((await host.request('missions.get', { missionId: mission.missionId })).title, '手机使命已编辑')
    // Configure only this isolated member. Creating a Mission must never start a Run.
    const freshMember = await host.request('members.get', { agentId: member.agentId })
    const configured = await host.request('members.runtime.set', { commandId: crypto.randomUUID(), command: {
      agentId: member.agentId, expectedVersion: freshMember.version, adapterKind: 'codex-cli',
      model: { mode: 'runtime_default' },
      permissions: { adapterKind: 'codex-cli', schemaVersion: 1, values: { sandbox_mode: 'danger-full-access', approval_policy: 'never' } }
    } })
    assert.equal(configured.status, 'applied', JSON.stringify(configured))
    await browser.click(`document.querySelector('.mission-new-entry')`)
    await browser.wait(`!!document.querySelector('.mission-create-dialog')`)
    await fill('.mission-create-dialog .mission-editor-title', '新使命草稿')
    await capture('mission-create')
    await browser.click(byLabel('关闭新使命'))
    await browser.click(`document.querySelector('.mission-new-entry')`)
    await browser.wait(`document.querySelector('.mission-create-dialog .mission-editor-title')?.value==='新使命草稿'`)
    await browser.click(`document.querySelector('.mission-editor-team-property')`)
    await browser.wait(`!!document.querySelector('.mission-editor-team-member:not(:disabled)')`)
    if (!await browser.evaluate(`!!document.querySelector('.mission-editor-team-member:not(:disabled) .is-checked')`)) await browser.click(`document.querySelector('.mission-editor-team-member:not(:disabled)')`)
    await browser.click(`document.querySelector('.mission-editor-lead-choice:not(:disabled)')`)
    await browser.click(`document.querySelector('.mission-editor-team-footer .compact-primary')`)
    await browser.click(`document.querySelector('.mission-create-dialog button[type=submit]')`)
    await browser.wait(`!document.querySelector('.mission-create-dialog')`)
    const uiCreated = (await host.request('missions.list')).find(item=>item.title==='新使命草稿')
    assert.ok(uiCreated, 'the production Mission form creates a real record')
    assert.equal(uiCreated.status, 'not_started')
    assert.equal((await host.request('camps.snapshot', { campId: uiCreated.campId })).agentRuns.length, 0)
    assert.equal((await host.request('camps.snapshot', { campId: mission.campId })).agentRuns.length, 0)

    stage = 'mission night and landscape navigation'
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }] })
    await browser.wait(`document.documentElement.dataset.theme==='night'`)
    await capture('mission-board-night')
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true })
    await browser.wait(`document.documentElement.dataset.mobileWeb==='true' && innerWidth===844`)
    await capture('mission-board-landscape')
    await browser.click(byLabel('打开主菜单'))
    await browser.wait(`!!document.querySelector('#mobile-app-menu')`)
    assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('#mobile-app-menu')).animationName`), 'none', 'reduced motion disables the drawer transition')
    await capture('app-menu-landscape-night')
    await browser.key('Escape')
    await browser.wait(`!document.querySelector('#mobile-app-menu') && document.activeElement?.getAttribute('aria-label')==='打开主菜单'`)

    assert.deepEqual(browser.errors, [])
    assert.equal((await host.request('camps.snapshot', { campId })).agentRuns.length, 0)
    await writeFile(join(output, 'validation.json'), JSON.stringify({
      productionEntry: true,
      realHost: true,
      runtimeExecution: false,
      realPhone: false,
      assertions: [
        'conversation-reminder-and-title-share-vertical-center',
        'selected-conversation-uses-complete-row',
        'project-picker-hides-host-terminology-and-path-input-by-default',
        'mobile-empty-camp-hides-brand-and-configuration-tags',
        'mobile-starter-suggestions-are-collapsed-and-title-only',
        'mission-create-edit-status-use-real-host-without-starting-runtime',
        'mission-conversation-and-preview-return-retain-draft-and-board-status',
        'mission-long-press-and-keyboard-actions-stay-inside-phone-viewport',
        'settings-12-categories-no-index-search-and-runtime-row-alignment',
        'app-drawer-landscape-reduced-motion-and-focus-return'
      ],
      checks
    }, null, 2))
  } catch (error) {
    console.log(JSON.stringify({ failedStage: stage, message: error.message }))
    if (browser) { await browser.capture(join(output, 'failure.png')).catch(() => {}); console.log(await browser.evaluate('document.body.innerText.slice(-4500)').catch(() => 'browser unavailable')) }
    throw error
  } finally {
    await browser?.close(); await host.close()
    await removeEphemeralRuntimeCampFilesRoot(dataDir, { temporaryDirectory: fixture })
    await rm(fixture, { recursive: true, force: true })
  }
})

test('phone execution shares Desktop evidence, wraps avatars and retains Run disclosures', { timeout: 120_000 }, async t => {
  if (process.platform !== 'darwin' || !await access(executable).then(() => true, () => false)) { t.skip('Requires macOS Chrome'); return }
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-mobile-execution-')))
  const output = process.env.ROVAI_MOBILE_OUTPUT ?? join(fixture, 'evidence')
  await mkdir(output, { recursive: true })
  console.log(JSON.stringify({ channel: 'component_fixture', chromeProfile: join(fixture, 'chrome'), host: false, runtime: false }))
  const { productPath } = await buildHostWebParity(join(fixture, 'product'))
  const browser = await launchAcceptanceBrowser({ executable, args: ['--headless=new', `--user-data-dir=${join(fixture, 'chrome')}`, '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', 'about:blank'] })
  try {
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true })
    for (const theme of ['day', 'night']) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
      const url = pathToFileURL(productPath); url.search = new URLSearchParams({ surface: 'web', scenario: 'mobile-running', theme }).toString()
      await browser.send('Page.navigate', { url: url.href })
      await browser.wait(`document.querySelector('.mobile-camp-tabs')!==null`)
      assert.equal(await browser.evaluate(`document.querySelectorAll('.mobile-camp-tabs button').length`), 2)
      assert.equal(await browser.evaluate(`document.querySelectorAll('.mobile-execution-face .member-avatar').length`), 2)
      assert.equal(await browser.evaluate(`document.querySelector('.mobile-execution-face .camp-execution-overflow').textContent`), '+8')
      assert.equal(await browser.evaluate(`document.querySelectorAll('.mobile-execution-face .camp-execution-orbits rect').length`), 2)
      await browser.evaluate(`document.documentElement.style.setProperty('--chat-font-size','20px')`)
      const reading = await browser.evaluate(`({prose:getComputedStyle(document.querySelector('.conversation-bubble .message-bubble')).fontSize,editor:getComputedStyle(document.querySelector('.structured-mention-editor')).fontSize})`)
      assert.deepEqual(reading, {prose:'19.5px',editor:'20px'}, 'compact phone reading still follows the user font setting')
      await browser.evaluate(`document.documentElement.style.removeProperty('--chat-font-size')`)
      await browser.send('Emulation.setEmulatedMedia', { features: [{name:'prefers-reduced-motion',value:'reduce'}] })
      assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('.camp-execution-orbits rect')).animationName`), 'none')
      await browser.send('Emulation.setEmulatedMedia', { features: [] })
      await browser.capture(join(output, `messages-${theme}.png`))
      await browser.click(`document.querySelector('.mobile-camp-tabs [data-detail=execution]')`)
      await browser.wait(`document.querySelectorAll('.run-pulse-chip').length===11`)
      const sheet = await browser.evaluate(`(()=>{const panel=document.querySelector('.camp-detail-popover[data-detail=execution]').getBoundingClientRect();const stage=document.querySelector('.camp-conversation-stage').getBoundingClientRect();const composer=document.querySelector('.conversation-controls').getBoundingClientRect();return {header:document.querySelector('.camp-topbar').getBoundingClientRect().height,panel:panel.toJSON(),stage:stage.toJSON(),composer:composer.toJSON()}})()`)
      assert.equal(sheet.header, 52, 'conversation header uses one compact row')
      assert.ok(sheet.panel.height < sheet.stage.height && sheet.panel.bottom <= sheet.stage.bottom + 1, 'execution opens as a sheet over the timeline')
      assert.ok(sheet.composer.height > 0 && sheet.composer.top >= sheet.stage.bottom, 'Composer remains available while execution is open')
      await browser.click(`document.querySelector('.mobile-execution-expand')`)
      await browser.wait(`document.querySelector('.camp-workspace').hasAttribute('data-mobile-execution-maximized')`)
      await browser.click(`document.querySelector('.mobile-execution-expand')`)
      await browser.wait(`!document.querySelector('.camp-workspace').hasAttribute('data-mobile-execution-maximized')`)
      await browser.click(`document.querySelectorAll('.run-pulse-chip')[1]`)
      await browser.wait(`document.querySelectorAll('.execution-process-stage').length===3`)
      const alignment = await browser.evaluate(`[...document.querySelectorAll('.execution-process-stage')].flatMap(e=>{const node=e.querySelector('.execution-process-node');const header=e.querySelector('.execution-run-card-header');if(!node?.getClientRects().length||!header?.getClientRects().length)return [];const a=node.getBoundingClientRect(),b=header.getBoundingClientRect();return [Math.abs((a.top+a.bottom-b.top-b.bottom)/2)]})`)
      assert.ok(alignment.length > 0 && alignment.every(delta=>delta<2), `timeline nodes align with Run summary centers: ${JSON.stringify(alignment)}`)
      const running = await browser.evaluate(`(()=>{const run=document.querySelector('.execution-process-stage.status-running');return {label:run.getAttribute('aria-label'),expanded:run.querySelector('.execution-run-toggle').getAttribute('aria-expanded'),stop:!!run.querySelector('.execution-run-operations .is-danger')}})()`)
      assert.match(running.label, /执行中/)
      assert.equal(running.expanded, 'true', 'current Run starts expanded')
      assert.equal(running.stop, true, 'current Run exposes its own stop action')

      assert.equal(await browser.evaluate(`document.querySelectorAll('.run-pulse-chip').length`), 11)
      const rail = await browser.evaluate(`(()=>{const e=document.querySelector('.run-pulse-list');return {scroll:e.scrollWidth,width:e.clientWidth,rows:[...new Set([...e.children].map(c=>c.getBoundingClientRect().top))].length}})()`)
      assert.equal(rail.scroll, rail.width); assert.ok(rail.rows > 1)
      await browser.capture(join(output, `execution-${theme}.png`))
      await browser.click(`document.querySelector('.execution-process-stage.status-running .execution-run-toggle')`)
      await browser.wait(`document.querySelector('.execution-process-stage.status-running .execution-run-toggle').getAttribute('aria-expanded')==='false'`)
      await browser.click(`document.querySelector('.execution-process-stage.status-running .execution-run-toggle')`)
      await browser.wait(`document.querySelector('.execution-process-stage.status-running .execution-run-toggle').getAttribute('aria-expanded')==='true'`)
      await browser.click(`document.querySelectorAll('.run-pulse-chip')[2]`)
      await browser.click(`document.querySelectorAll('.run-pulse-chip')[1]`)
      await browser.wait(`document.querySelectorAll('.execution-process-stage').length===3 && document.querySelector('.execution-process-stage.status-running .execution-run-toggle').getAttribute('aria-expanded')==='true'`)
      for (const width of [360, 375, 430, 844]) {
        await browser.send('Emulation.setDeviceMetricsOverride', { width, height: width === 844 ? 390 : 844, deviceScaleFactor: 1, mobile: true })
        await browser.wait(`document.documentElement.dataset.mobileWeb==='true'`)
        const size = await browser.evaluate(`({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,body:document.querySelector('.execution-drawer-body').getBoundingClientRect().toJSON()})`)
        assert.equal(size.overflow, false)
        assert.ok(size.body.height > 40, `execution remains readable after rotating the phone: ${JSON.stringify(size)}`)
        await browser.capture(join(output, `execution-${theme}-${width}.png`))
      }
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
      url.search = new URLSearchParams({ surface: 'web', scenario: 'approval', theme }).toString()
      await browser.send('Page.navigate', { url: url.href })
      const allowButton = `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Allow once')`
      await browser.wait(`Boolean(${allowButton}) && !(${allowButton}).disabled`)
      assert.equal(await browser.evaluate(`document.querySelector('.mobile-camp-tabs .camp-execution-orbits')===null`), true, 'waiting for approval does not claim a running member')
      await browser.evaluate(`(${allowButton}).scrollIntoView({block:'nearest'})`)
      const approval = await browser.evaluate(`(${allowButton}).getBoundingClientRect().toJSON()`)
      assert.ok(approval.left >= 0 && approval.right <= 390 && approval.height >= 44, 'native approval option is usable in the phone conversation')
      await browser.capture(join(output, `approval-${theme}.png`))
      await browser.click(allowButton)
      await browser.wait(`!${allowButton}`)
    }
    assert.deepEqual(browser.errors, [])
    await writeFile(join(output, 'execution-validation.json'), JSON.stringify({ productionComponents: true, simulatedEvidence: true, realRuntime: false, widths: [360, 375, 390, 430, 844], themes: ['day', 'night'], checks: ['single-row-header-and-execution-sheet', 'composer-remains-available', 'execution-expand-and-restore', 'two-entry-avatars-plus-overflow', 'reading-font-preference', 'reduced-motion', '11-chip-avatar-wrap', '3-run-cards', 'run-expansion-retained-across-member-switch', 'rotation'] }, null, 2))
  } catch (error) { await browser.capture(join(output, 'execution-failure.png')).catch(() => {}); throw error }
  finally { await browser.close(); await rm(fixture, { recursive: true, force: true }) }
})

test('standalone Server phone settings expose update controls, initial login and hide channels', { timeout: 60_000 }, async t => {
  if (process.platform !== 'darwin' || !await access(executable).then(() => true, () => false)) { t.skip('Requires macOS Chrome'); return }
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-mobile-server-')))
  const dataDir = join(fixture, 'server')
  const output = process.env.ROVAI_MOBILE_OUTPUT ?? join(fixture, 'evidence')
  await mkdir(output, { recursive: true })
  console.log(JSON.stringify({ channel: 'automatic_acceptance', dataDir, skillLibraryRoot: join(dataDir, 'skills'), mcpConfigPath: join(dataDir, 'mcp.json'), chromeProfile: join(fixture, 'chrome'), runtime: false }))
  const uiDirectory = join(fixture, 'web')
  await cp(process.env.ROVAI_WEB_UI ?? join(repository, 'out/web'), uiDirectory, { recursive: true })
  const child = spawn(process.env.ROVAI_SERVER_BIN ?? join(repository, 'target/debug/rovai-server'), ['--data-dir', dataDir, '--web-ui', uiDirectory, '--listen', '127.0.0.1:0'], { cwd: fixture, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''; let readyResolve, readyReject
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject })
  const collect = data => { log = (log + data).slice(-16000); if (log.includes('· Ready')) readyResolve() }
  child.stdout.on('data', collect); child.stderr.on('data', collect)
  const closed = new Promise(resolve => { child.once('error', error => { readyReject(error); resolve() }); child.once('close', () => { readyReject(new Error('Isolated Server exited before ready')); resolve() }) })
  let browser
  try {
    await within(ready)
    const origin = /Address  (http:\/\/127\.0\.0\.1:\d+)/.exec(log)?.[1]
    assert.ok(origin)
    const token = (await readFile(join(dataDir, 'server-token'), 'utf8')).trim()
    const update = (body, session, headers = {}) => fetch(`${origin}/api/v1/updates`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session}` } : {}), ...headers }, body: JSON.stringify(body) })
    assert.equal((await update({ operation: 'get' })).status, 401)
    const session = await (await fetch(`${origin}/api/v1/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 4, administratorToken: token }) })).json()
    assert.equal(session.channels, 'unsupported', 'standalone Server does not advertise Desktop channels')
    assert.equal((await update({ operation: 'get' }, session.token, { Origin: 'http://other-device.invalid' })).status, 403)
    for (const body of [{ operation: 'exec' }, { operation: 'get', url: 'https://other-device.invalid/package' }, { operation: 'install', version: '999.0.0', path: '/tmp/package' }]) {
      assert.equal((await update(body, session.token)).status, 400)
    }
    assert.equal((await update({ operation: 'install', version: '999.0.0' }, session.token)).status, 409)
    assert.match((await (await update({ operation: 'get' }, session.token)).json()).result.currentVersion, /^\d+\.\d+\.\d+$/)
    await fetch(`${origin}/api/v1/logout`, { method: 'POST', headers: { Authorization: `Bearer ${session.token}` } })
    browser = await launchAcceptanceBrowser({ executable, args: ['--headless=new', `--user-data-dir=${join(fixture, 'chrome')}`, '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', 'about:blank'] })
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    await browser.send('Page.navigate', { url: origin })
    await browser.wait(`document.querySelector('#administrator-token')!==null`)
    await verifyInitialLogin(browser, 'server', output)
    await browser.click(`document.querySelector('#administrator-token')`)
    await browser.send('Input.insertText', { text: token })
    await browser.click(`document.querySelector('.web-login button[type=submit]')`)
    await browser.wait(`document.querySelector('[aria-label="打开主菜单"]')!==null`)
    await browser.click(`[...document.querySelectorAll('[aria-label="打开主菜单"]')].find(e=>e.getClientRects().length>0)`)
    await browser.click(`document.querySelector('#mobile-app-menu [aria-label="设置"]')`)
    await browser.wait(`!!document.querySelector('.mobile-settings-index')`)
    await browser.wait(`!document.querySelector('#mobile-app-menu')`)
    assert.equal(await browser.evaluate(`[...document.querySelectorAll('.settings-index-rows button')].some(e=>e.querySelector('span')?.textContent==='渠道')`), false)
    assert.equal(await browser.evaluate(`[...document.querySelectorAll('.settings-index-rows button')].some(e=>e.querySelector('span')?.textContent==='远程连接')`), true, 'Server browsers can still manage their own connection and login')
    await browser.click(`[...document.querySelectorAll('.settings-index-rows button')].find(e=>e.querySelector('span')?.textContent==='远程连接')`)
    await browser.wait(`document.querySelector('.remote-connection-page')!==null`)
    await browser.click(`document.querySelector('[aria-label="返回设置"]')`)
    await browser.click(`[...document.querySelectorAll('.settings-index-rows button')].find(e=>e.querySelector('span')?.textContent==='关于与更新')`)
    await browser.wait(`document.querySelector('.about-update-actions')!==null`)
    await browser.wait(`/版本 v?\\d+\\.\\d+/.test(document.querySelector('.about-identity').textContent)`)
    assert.match(await browser.evaluate(`document.querySelector('.about-identity').textContent`), /Server/)
    assert.ok(await browser.evaluate(`document.querySelector('.about-update-actions button')!==null`))
    assert.match(await browser.evaluate(`document.querySelector('.about-update-source').textContent`), /Server GitHub Release/)
    await browser.capture(join(output, 'server-about.png'))
    await browser.click(`document.querySelector('[aria-label="返回设置"]')`)
    assert.deepEqual(browser.errors, [])
    await writeFile(join(output, 'server-validation.json'), JSON.stringify({ realServer: true, actualUpdateInstall: false, runtime: false, checks: ['server-hides-channels', 'server-keeps-browser-connection', 'server-update-controls', 'update-auth-and-closed-operations', 'host-specific-login', 'real-version'] }, null, 2))
  } finally {
    await browser?.close()
    child.kill('SIGINT'); const deadline = setTimeout(() => child.kill('SIGKILL'), 5000)
    await closed; clearTimeout(deadline)
    await rm(fixture, { recursive: true, force: true })
  }
})

async function verifyInitialLogin(browser, kind, output) {
  const expected = kind === 'desktop' ? '在 Desktop「设置 → 能力 → 远程连接」中查看。' : '在 Server 启动终端中查看。'
  assert.equal(await browser.evaluate(`document.querySelector('#web-login-help').textContent`), expected)
  for (const theme of ['light', 'dark']) {
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] })
    for (const [width, height] of [[375, 812], [844, 390], [1440, 900]]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 1040 })
      assert.equal(await browser.evaluate(`document.documentElement.scrollWidth > innerWidth`), false)
      await browser.capture(join(output, `login-${kind}-${theme}-${width}.png`))
    }
  }
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
}
