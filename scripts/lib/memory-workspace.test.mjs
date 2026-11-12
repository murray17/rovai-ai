import assert from 'node:assert/strict'
import test from 'node:test'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { launchAcceptanceBrowser, pause } from './host-web-browser.mjs'

test('Memory workspace: production components, mutations, notifications and responsive layout', { timeout: 300_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'rovai-memory-ui-'))
  const output = process.env.ROVAI_MEMORY_UI_OUTPUT ?? join(root, 'screenshots')
  await mkdir(output, { recursive: true })
  await promisify(execFile)(process.execPath, [resolve(import.meta.dirname, '../fixtures/memory-workspace/build.mjs'), root])
  const chrome = process.env.ROVAI_TEST_CHROME ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome')
  const b = await launchAcceptanceBrowser({ executable: chrome, args: ['--headless=new', `--user-data-dir=${join(root, 'profile')}`, '--no-first-run', '--disable-background-networking', '--remote-debugging-port=0', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'] })
  const report = { interactions: [], viewports: [], windowsReviewViewports: [] }
  const settle = () => pause(160)
  const click = async selector => { await b.click(`document.querySelector(${JSON.stringify(selector)})`); await settle() }
  const text = selector => b.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent`)
  const button = async (label, container = 'document') => {
    await b.click(`[...${container}.querySelectorAll('button,[role="menuitem"]')].find(e => e.textContent.trim() === ${JSON.stringify(label)})`); await settle()
  }
  const fill = async (selector, value) => { await b.evaluate(`(() => {const e = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('input', { bubbles: true }));})()`); await settle() }
  const navigate = async target => { await b.evaluate(`__memoryFixture.navigate(${JSON.stringify({ kind: 'memory', memoryId: null, ...target })})`); await settle() }
  const closeEditor = () => button('取消', 'document.querySelector(".memory-editor-dialog")')
  const choiceTrigger = label => `[...document.querySelectorAll('.memory-choice-field')].find(e => e.querySelector('label').textContent === ${JSON.stringify(label)}).querySelector('button')`
  const choiceKey = async (key, windowsVirtualKeyCode) => {
    await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode })
    await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode })
  }
  const choose = async (label, value) => {
    await b.click(choiceTrigger(label)); await b.wait('!!document.querySelector(".memory-choice-menu")')
    await b.click(`[...document.querySelectorAll('.memory-choice-option')].find(e => e.textContent === ${JSON.stringify(value)})`)
    await b.wait('!document.querySelector(".memory-choice-menu")'); await settle()
  }
  const viewport = async (width, height) => { await b.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await settle() }
  const geometry = () => b.evaluate(`(() => {
    const rect = e => { const r = e.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom } };
    const revise = document.querySelector('[data-memory-revise]'), more = document.querySelector('.memory-more-button'), dot = document.querySelector('.rail-badge-dot');
    const row = dot?.closest('button'), dialog = document.querySelector('.memory-editor-dialog');
    return { overflow: document.documentElement.scrollWidth > innerWidth,
      detailOverflow: [...document.querySelectorAll('.memory-detail,.memory-library,.memory-editor-dialog .app-dialog-body')].some(e => e.scrollWidth > e.clientWidth + 1),
      workspace: rect(document.querySelector('.memory-library')), add: rect(document.querySelector('.memory-header-actions .primary-button')),
      rail: document.querySelector('.unified-sidebar') && getComputedStyle(document.querySelector('.unified-sidebar')).getPropertyValue('--rail').trim(),
      globalRail: getComputedStyle(document.documentElement).getPropertyValue('--rail').trim(),
      revise: revise && rect(revise), more: more && rect(more), dot: dot && rect(dot), row: row && rect(row), dialog: dialog && rect(dialog),
      canvas: getComputedStyle(document.querySelector(".memory-content")).backgroundColor,
      primary: revise && getComputedStyle(revise).backgroundColor,
      selected: getComputedStyle(document.querySelector('.memory-catalog-item.selected') ?? document.querySelector('.memory-catalog-item')).backgroundColor
    };
  })()`)
  try {
    await b.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await viewport(1440, 920)
    await b.send('Page.navigate', { url: pathToFileURL(join(root, 'memory-workspace.html')).href })
    await b.wait('!!window.__memoryFixture && document.querySelectorAll(".memory-catalog-item").length === 7')
    assert.deepEqual(await b.evaluate('[...document.querySelectorAll(".memory-scope-tabs button")].map(e => e.textContent)'), ['全部', '共同', '队员', '队员间'])
    assert.match(await text('.memory-summary-strip'), /正在沿用6队员形成4待复核1/)
    assert.equal(await text('.memory-detail-body'), await b.evaluate('__memoryFixture.get().longBody'))
    assert.equal(await b.evaluate('!!document.querySelector(".memory-capacity-strip,.memory-governance-tabs")'), false)
    assert.equal(await b.evaluate('document.querySelector(".memory-detail-disclosure").open'), false)
    await click('.memory-detail-disclosure > summary'); await click('.memory-revisions > summary'); await click('.memory-revision > summary')
    assert.equal(await text('.memory-revision p'), await b.evaluate('__memoryFixture.get().longBody'))
    await click('.memory-detail-disclosure > summary')
    await navigate({ scope: 'all', governance: 'review' })
    assert.equal(await b.evaluate('document.querySelectorAll(".memory-catalog-item").length'), 7)
    await click('[data-memory-scope="companion"]'); assert.equal(await b.evaluate('document.querySelectorAll(".memory-catalog-item").length'), 2)
    await click('[data-memory-scope="all"]'); await fill('.memory-search input', '曾经')
    assert.match(await text('.memory-detail-body'), /曾经采用/)
    await fill('.memory-search input', '没有这个关键词'); assert.match(await text('.memory-catalog'), /没有找到/)
    await fill('.memory-search input', '')
    await click('.memory-notice-open'); assert.match(await text('.memory-detail-body'), /发送结果/)
    assert.equal(await b.evaluate('!!document.querySelector(".memory-change-notice")'), false)
    await b.evaluate('__memoryFixture.setNotice(true)'); await settle(); await click('.memory-notice-close')
    await navigate({ scope: 'all', memoryId: 'shared-1' }); await b.evaluate('__memoryFixture.setNotice(true)'); await settle()
    report.interactions.push('all scopes; legacy filter ignored; full content/history; search and retired record; truthful update notice view/dismiss')

    for (const [width, height] of [[2560,1440],[2048,1152],[1707,960],[1440,920],[1280,720],[1040,700],[375,812],[320,700],[740,390]]) for (const theme of ['day','night']) {
      await viewport(width,height); await b.evaluate(`__memoryFixture.setTheme('${theme}')`); await navigate({ scope: 'all', memoryId: width < 768 ? null : 'shared-1' })
      const list = await geometry(); assert.equal(list.overflow,false); assert.equal(list.detailOverflow,false)
      await b.capture(join(output, `memory-${theme}-${width}-list.png`))
      if (width < 768) await click('.memory-catalog-item')
      const g = await geometry(); assert.equal(g.overflow,false); assert.equal(g.detailOverflow,false)
      assert.ok(Math.abs(g.revise.y-g.more.y)<1); assert.equal(g.revise.height,g.more.height)
      if (width >= 768) {
        assert.ok(Math.abs(g.revise.right-g.add.right)<1, 'Add and Revise share the right edge')
        assert.equal(g.revise.height,g.add.height, 'Add and Revise share the control height')
        assert.equal(g.rail,g.globalRail, 'Memory must not override the shared rail theme')
      }
      if (width === 2560) assert.ok(g.workspace.width >= 1800 && g.workspace.width <= 1920, '2K uses the approved wider workspace')
      if (g.dot) assert.ok(Math.abs(g.dot.y+g.dot.height/2-g.row.y-g.row.height/2)<1, 'pending dot vertically centered')
      for (const color of [g.primary,g.canvas,g.selected]) { const channels = color.match(/\d+/g).map(Number); assert.equal(Math.max(...channels)-Math.min(...channels),0, 'achromatic memory surfaces and actions') }
      await b.capture(join(output, `memory-${theme}-${width}-detail.png`))
      await click('[data-memory-revise]'); const e = await geometry()
      assert.equal(e.overflow,false); assert.equal(e.detailOverflow,false)
      assert.ok(e.dialog.x >= 0 && e.dialog.right <= width && e.dialog.y >= 0 && e.dialog.bottom <= height)
      await b.capture(join(output, `memory-${theme}-${width}-editor.png`)); await closeEditor()
      if (width < 768) await click('.mobile-memory-back button')
      await click('.memory-review-entry'); await b.wait('!!document.querySelector(".memory-review-dialog")')
      const close = await b.evaluate(`(() => {
        const drawer = document.querySelector('.memory-review-dialog');
        const overlay = document.querySelector('.memory-review-overlay');
        const button = drawer.querySelector('button[aria-label="关闭共同记忆审核"]');
        const r = button.getBoundingClientRect();
        const points = [[r.x+6,r.y+6],[r.right-6,r.y+6],[r.x+6,r.bottom-6],[r.right-6,r.bottom-6],[r.x+r.width/2,r.y+r.height/2]];
        return { inViewport: r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
          unobscured: points.every(([x,y]) => button.contains(document.elementFromPoint(x,y))),
          drawerRegion: getComputedStyle(drawer).getPropertyValue('-webkit-app-region'),
          overlayRegion: getComputedStyle(overlay).getPropertyValue('-webkit-app-region') };
      })()`)
      assert.ok(close.inViewport && close.unobscured, 'review close button is fully visible and hit-testable')
      assert.equal(close.drawerRegion, 'no-drag', 'review drawer excludes the native titlebar drag region')
      assert.equal(close.overlayRegion, 'no-drag', 'modal backdrop blocks window dragging')
      await b.capture(join(output, `review-${theme}-${width}.png`))
      const footer = await b.evaluate(`(() => { const e = document.querySelector('.memory-review-return'), r = e.getBoundingClientRect(); return r.y>=0 && r.bottom<=innerHeight && e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); })()`)
      assert.ok(footer, 'Return remains visible and clickable at every viewport')
      await click('.memory-review-dialog button[aria-label="关闭共同记忆审核"]')
      await b.wait('!document.querySelector(".memory-review-dialog")')
      assert.ok(await b.evaluate('document.activeElement.matches(".memory-review-entry")'), 'closing restores the review trigger focus')
      assert.equal(await b.evaluate('__memoryFixture.get().reviews[0].status'), 'pending', 'closing does not resolve the review')
      await button('新增')
      const form = await b.evaluate(`(() => {
        const controls = [...document.querySelectorAll('.memory-choice-trigger')];
        const labels = [...document.querySelectorAll('.memory-choice-field > label,.memory-body-field > label,.memory-body-field > span')];
        const textarea = document.querySelector('textarea'), keys = document.querySelector('#memory-key-input');
        return { labels: labels.map(e => { const s = getComputedStyle(e); return [s.fontSize,s.fontWeight,s.lineHeight]; }),
          heights: controls.map(e => e.getBoundingClientRect().height),
          rowDelta: Math.abs(controls[0].getBoundingClientRect().y-controls[1].getBoundingClientRect().y),
          fieldGap: document.querySelector('.memory-body-field').getBoundingClientRect().y-document.querySelector('.memory-editor-grid').getBoundingClientRect().bottom,
          fonts: [controls[0],textarea,keys].map(e => getComputedStyle(e).fontFamily),
          overflow: document.querySelector('.app-dialog-body').scrollWidth > document.querySelector('.app-dialog-body').clientWidth + 1 };
      })()`)
      assert.deepEqual(form.labels, Array(4).fill(['12px','400','20px']), 'all form labels share a baseline and typography')
      assert.ok(form.heights.every(height => Math.abs(height - (width < 768 ? 44 : 40)) < 0.5), 'choice controls have equal desktop/touch heights')
      if (width > 360) assert.ok(form.rowDelta < 1, 'scope and kind controls align')
      assert.ok(Math.abs(form.fieldGap-20)<0.5, 'form sections retain the approved spacing')
      assert.equal(new Set(form.fonts).size, 1, 'body, keys and choices use the same platform font')
      assert.equal(form.overflow, false)
      await b.capture(join(output, `create-${theme}-${width}.png`))
      await b.click(choiceTrigger('范围')); await b.wait('!!document.querySelector(".memory-choice-menu")')
      const menu = await b.evaluate(`(() => { const e = document.querySelector('.memory-choice-menu'), r = e.getBoundingClientRect(); return { inside:r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight, color:getComputedStyle(e).backgroundColor, selected:e.querySelector('[aria-checked="true"]')?.textContent }; })()`)
      assert.ok(menu.inside, 'choice menu stays inside the viewport')
      assert.equal(menu.selected, '共同记忆')
      const channels = menu.color.match(/\d+/g).map(Number)
      assert.equal(Math.max(...channels)-Math.min(...channels),0, 'choice menu uses neutral surfaces')
      await b.capture(join(output, `create-menu-${theme}-${width}.png`))
      await b.key('Escape'); await b.wait('!document.querySelector(".memory-choice-menu")')
      assert.ok(await b.evaluate('!!document.querySelector(".memory-editor-dialog")'), 'Escape closes the menu before the form')
      await closeEditor()
      report.viewports.push({ width,height,theme,primary:g.primary,aligned:true,noOverflow:true })
    }
    await b.evaluate('__memoryFixture.setPlatform("win32")')
    await b.wait('document.documentElement.dataset.rovaiPlatform === "win32" && !!document.querySelector(".windows-application-menu")')
    for (const [width,height] of [[1440,920],[1040,700],[720,460]]) for (const theme of ['day','night']) {
      await viewport(width,height); await b.evaluate(`__memoryFixture.setTheme('${theme}')`); await navigate({ scope: 'all' })
      await click('.memory-review-entry'); await b.wait('!!document.querySelector(".memory-review-dialog")')
      const layout = await b.evaluate(`(() => {
        const titlebar = document.querySelector('.windows-application-menu').getBoundingClientRect();
        const drawer = document.querySelector('.memory-review-dialog').getBoundingClientRect();
        const close = document.querySelector('.memory-review-dialog button[aria-label="关闭共同记忆审核"]');
        const r = close.getBoundingClientRect();
        return { titlebarBottom: titlebar.bottom, drawerTop:drawer.top, drawerBottom:drawer.bottom,
          closeTop:r.top, closeBottom:r.bottom, viewportHeight:innerHeight,
          hit:close.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)) };
      })()`)
      assert.ok(layout.titlebarBottom > 0 && layout.drawerTop >= layout.titlebarBottom && layout.closeTop >= layout.titlebarBottom,
        `Windows review controls must clear the native title bar: ${JSON.stringify(layout)}`)
      assert.ok(layout.drawerBottom <= height && layout.closeBottom <= height && layout.hit)
      await b.capture(join(output, `review-windows-${theme}-${width}.png`))
      await click('.memory-review-dialog button[aria-label="关闭共同记忆审核"]'); await b.wait('!document.querySelector(".memory-review-dialog")')
      assert.equal(await b.evaluate('__memoryFixture.get().reviews[0].status'),'pending')
      report.windowsReviewViewports.push({ width,height,theme,...layout,nativeWindowsVerified:false })
    }
    await b.evaluate('__memoryFixture.setPlatform("darwin")')
    await viewport(1440,920); await b.evaluate('__memoryFixture.setTheme("day")'); await navigate({ scope: 'all', memoryId: 'shared-1' })
    await click('[data-memory-revise]'); await fill('textarea', '未提交的修订草稿。'); await closeEditor(); await click('[data-memory-revise]')
    assert.equal(await b.evaluate('document.querySelector("textarea").value'), '未提交的修订草稿。')
    await fill('textarea','长'.repeat(700)); assert.equal(await b.evaluate('document.querySelector(".memory-editor-dialog button[type=submit]").disabled'),true)
    await fill('textarea','最终修订正文。'); await b.evaluate('__memoryFixture.failNext()'); await button('保存修订')
    assert.match(await text('.memory-editor-error'),/连接中断/)
    await b.evaluate('__memoryFixture.conflict()'); await button('保存修订')
    assert.match(await text('.memory-editor-error'),/版本已经变化/)
    assert.equal(await b.evaluate('document.querySelector("textarea").value'),'最终修订正文。')
    await b.capture(join(output,'editor-conflict.png')); await button('保存修订')
    assert.equal(await text('.memory-detail-body'),'最终修订正文。')
    await click('[data-memory-revise]'); assert.equal(await b.evaluate('document.querySelector("textarea").value'),'最终修订正文。'); await closeEditor()
    report.interactions.push('draft survives close; byte limit; inline transport failure; version conflict refresh preserves draft; explicit retry with new authority succeeds')

    await click('[data-memory-scope="all"]'); await button('新增')
    assert.equal(await b.evaluate(`${choiceTrigger('范围')}.textContent`),'共同记忆')
    await fill('textarea','从全部新增的记忆。'); await fill('#memory-key-input','新建验证')
    await button('保存记忆'); await b.wait('!document.querySelector(".memory-editor-dialog")')
    assert.equal(await text('.memory-detail-body'),'从全部新增的记忆。')
    assert.deepEqual(await b.evaluate('__memoryFixture.get().calls.at(-1).command.retrievalKeys'),['新建验证'])
    assert.equal(await b.evaluate('__memoryFixture.get().calls.at(-1).command.scope'),'hearth')
    assert.equal(await b.evaluate('__memoryFixture.get().calls.at(-1).command.companionAgentId'),null)
    await click('.memory-more-button'); await b.key('Escape'); await settle()
    assert.equal(await b.evaluate('document.activeElement.matches(".memory-more-button")'),true)
    await click('.memory-more-button'); await button('停止沿用')
    assert.match(await text('.memory-detail-context'),/已停止/)
    await button('重新沿用'); await click('.memory-more-button'); await button('设置下次复核')
    await b.wait('!!document.querySelector(".memory-review-schedule-dialog")')
    await b.capture(join(output,'review-schedule.png')); await button('取消', 'document.querySelector(".memory-review-schedule-dialog")')
    await click('.memory-more-button'); await button('永久遗忘'); await b.wait('!!document.querySelector(".memory-confirm-dialog")')
    await button('取消', 'document.querySelector(".memory-confirm-dialog")')
    assert.ok(await b.evaluate('__memoryFixture.get().memories.some(m => m.currentBody === "从全部新增的记忆。" && m.lifecycle === "active")'))
    await click('.memory-review-entry'); await b.wait('!!document.querySelector(".memory-review-dialog")')
    await b.capture(join(output,'review-dialog.png')); await button('接受', 'document.querySelector(".memory-review-dialog")')
    assert.match(await text('.memory-review-entry'),/审核记录/)
    assert.equal(await b.evaluate('__memoryFixture.get().reviews[0].candidateBody'),null)
    report.interactions.push('create from all targets new identity and submits typed keys; retire/reactivate; schedule; forget cancel; review acceptance and body-free history')
    await click('.memory-review-dialog button[aria-label="关闭共同记忆审核"]')
    await click('[data-memory-scope="all"]'); await button('新增')
    await fill('textarea','成员范围验证。'); await fill('#memory-key-input','范围验证')
    await b.click(choiceTrigger('范围')); await b.wait('!!document.querySelector(".memory-choice-menu")')
    await choiceKey('Home',36)
    await b.wait('document.activeElement?.matches(".memory-choice-option") && document.activeElement.textContent === "共同记忆"')
    await choiceKey('ArrowDown',40)
    await b.wait('document.activeElement?.matches(".memory-choice-option") && document.activeElement.textContent === "队员记忆"')
    await choiceKey('Enter',13); await b.wait('!document.querySelector(".memory-choice-menu")'); await settle()
    assert.equal(await b.evaluate(`${choiceTrigger('范围')}.textContent`),'队员记忆', 'scope can be selected using the keyboard')
    assert.equal(await b.evaluate('document.querySelector("textarea").value'),'成员范围验证。', 'scope changes preserve the draft')
    await choose('队员','舟'); await choose('类型','经验'); await button('保存记忆')
    await b.wait('!document.querySelector(".memory-editor-dialog")')
    const companion = await b.evaluate('__memoryFixture.get().calls.at(-1).command')
    assert.equal(companion.scope,'companion'); assert.equal(companion.companionAgentId,'member-b'); assert.equal(companion.kind,'lesson')
    assert.deepEqual(companion.relationshipAgentIds,[])
    await click('[data-memory-scope="all"]'); await button('新增'); await choose('范围','队员间记忆')
    assert.equal(await b.evaluate(`${choiceTrigger('类型')}.textContent`),'约定')
    await b.click(choiceTrigger('类型')); await settle()
    assert.equal(await b.evaluate('[...document.querySelectorAll(".memory-choice-option")].some(e => e.textContent === "偏好")'),false)
    await b.key('Escape'); await settle(); await choose('方向','单向'); await choose('责任方','舟')
    await fill('textarea','队员间单向约定。'); await fill('#memory-key-input','单向约定')
    await choose('队员 A','舟')
    assert.equal(await b.evaluate('document.querySelector(".memory-editor-dialog button[type=submit]").disabled'),true, 'two distinct members remain required')
    await choose('队员 B','林'); await button('保存记忆'); await b.wait('!document.querySelector(".memory-editor-dialog")')
    const relationship = await b.evaluate('__memoryFixture.get().calls.at(-1).command')
    assert.equal(relationship.scope,'relationship'); assert.equal(relationship.companionAgentId,null)
    assert.deepEqual([...relationship.relationshipAgentIds].sort(),['member-a','member-b'])
    assert.equal(relationship.direction,'directed'); assert.equal(relationship.directedActorAgentId,'member-b')
    report.interactions.push('aligned neutral create form; pointer/keyboard menus; scope changes retain drafts; exact shared/member/relationship commands and participant constraints')
    // The review owner stays open while candidates change; only explicit commands mutate data.
    await navigate({ scope: 'hearth', search: '工作', memoryId: 'shared-2' })
    const originalTarget = await b.evaluate('__memoryFixture.get().target')
    await b.evaluate('__memoryFixture.seedReviews()'); await settle()
    await click('.memory-review-entry'); await b.wait('document.querySelectorAll(".memory-review-selection").length === 3')
    await button('编辑后接受', 'document.querySelector(".memory-review-dialog")')
    await fill('#memory-review-body-input', '长'.repeat(700))
    assert.ok(await b.evaluate('[...document.querySelectorAll(".memory-review-actions button")].find(e => e.textContent === "接受最终内容").disabled'))
    await fill('#memory-review-body-input', '审核中保留的最终草稿。')
    await button('返回记忆', 'document.querySelector(".memory-review-dialog")')
    assert.deepEqual(await b.evaluate('__memoryFixture.get().target'), originalTarget)
    await click('.memory-review-entry')
    assert.equal(await b.evaluate('document.querySelector("#memory-review-body-input").value'), '审核中保留的最终草稿。')
    await b.click('document.querySelectorAll(".memory-review-selection")[1]'); await settle()
    assert.match(await text('.memory-review-existing'), /工作完成后同步/)
    await b.click('document.querySelectorAll(".memory-review-selection")[0]'); await settle()
    assert.equal(await b.evaluate('document.querySelector("#memory-review-body-input").value'), '审核中保留的最终草稿。')
    const draftCommands = await b.evaluate('__memoryFixture.get().calls.length')
    await b.evaluate('__memoryFixture.setMemoryEnabled(false)')
    await b.wait('!document.querySelector(".memory-review-dialog,.memory-catalog")')
    const draftPausedReads = await b.evaluate('__memoryFixture.capabilityStats().memoryBusinessReads')
    await settle()
    assert.equal(await b.evaluate('__memoryFixture.capabilityStats().memoryBusinessReads'), draftPausedReads)
    await b.evaluate('__memoryFixture.setMemoryEnabled(true)')
    await b.wait('!!document.querySelector("#memory-review-body-input")')
    assert.equal(await b.evaluate('document.querySelector("#memory-review-body-input").value'), '审核中保留的最终草稿。', 'capability changes preserve the unsubmitted review draft')
    assert.equal(await b.evaluate('__memoryFixture.get().calls.length'), draftCommands, 'capability changes never submit a retained draft')
    await b.key('Escape'); await b.wait('!document.querySelector(".memory-review-dialog")')
    await click('.memory-review-entry')
    await b.send('Input.dispatchMouseEvent',{type:'mousePressed',x:5,y:100,button:'left',clickCount:1})
    await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:5,y:100,button:'left',clickCount:1})
    await b.wait('!document.querySelector(".memory-review-dialog")')
    await click('.memory-review-entry')
    await b.evaluate('__memoryFixture.conflictReview("review-2"); __memoryFixture.failReads()')
    await button('接受最终内容', 'document.querySelector(".memory-review-dialog")')
    assert.match(await text('.memory-review-error'), /无法确认最新审核状态/)
    assert.ok(await b.evaluate('[...document.querySelectorAll(".memory-review-actions button")].every(e => e.disabled)'))
    await button('刷新列表', 'document.querySelector(".memory-review-dialog")')
    assert.equal(await b.evaluate('document.querySelector("#memory-review-body-input").value'), '审核中保留的最终草稿。')
    await button('接受最终内容', 'document.querySelector(".memory-review-dialog")')
    const edited = await b.evaluate('__memoryFixture.get().calls.at(-1).command')
    assert.equal(edited.expectedReviewItemVersion,2)
    assert.equal(edited.finalBody,'审核中保留的最终草稿。')
    assert.deepEqual(edited.finalRetrievalKeys,['新增候选'])
    assert.equal(await text('.memory-review-detail .memory-detail-body'),'修订候选正文。')
    assert.deepEqual(await b.evaluate('__memoryFixture.get().target'),originalTarget,'acceptance keeps formal selection/scope/search')
    report.interactions.push('review inline validation; per-candidate draft survives selection/Return/Escape/backdrop/capability switch without submitting; conflict refresh recovery; explicit CAS retry; formal context preserved')

    // Acknowledged writes whose read fails must not be sent twice.
    await b.evaluate('__memoryFixture.failReviewRefresh()')
    await button('接受', 'document.querySelector(".memory-review-dialog")')
    assert.match(await text('.memory-review-error'),/处理已完成，但列表刷新失败/)
    const afterApplied = await b.evaluate('__memoryFixture.get().calls.length')
    assert.ok(await b.evaluate('[...document.querySelectorAll(".memory-review-actions button")].every(e => e.disabled)'))
    assert.equal(await b.evaluate('document.querySelector(".memory-review-dialog").textContent.includes("修订候选正文。")'),false)
    await button('返回记忆', 'document.querySelector(".memory-review-dialog")'); await click('.memory-review-entry')
    assert.match(await text('.memory-review-error'),/处理已完成/)
    await button('刷新列表', 'document.querySelector(".memory-review-dialog")')
    assert.equal(await b.evaluate('__memoryFixture.get().calls.length'),afterApplied, 'refresh is read-only')
    assert.deepEqual(await b.evaluate('[...document.querySelectorAll(".memory-review-actions button")].map(e=>e.textContent)'),['拒绝'],'stale revision has no accept/edit action')
    await b.evaluate('__memoryFixture.holdReview()')
    await button('拒绝', 'document.querySelector(".memory-review-dialog")')
    assert.equal(await b.evaluate('document.querySelector(".memory-review-dialog .app-dialog-close").disabled'),false)
    await click('.memory-review-dialog .app-dialog-close')
    await b.wait('!document.querySelector(".memory-review-dialog")')
    await b.evaluate('__memoryFixture.releaseReview()'); await settle()
    await click('.memory-review-entry')
    await b.wait('!!document.querySelector(".memory-review-complete")')
    assert.equal(await b.evaluate('__memoryFixture.get().reviews.every(r => r.status !== "pending" && r.candidateBody === null && r.candidateRetrievalKeys === null && r.candidateKind === null)'),true)
    assert.equal(await b.evaluate('/审核中保留的最终草稿|修订候选正文|已过时的候选正文/.test(document.querySelector(".memory-review-dialog").textContent)'),false,'terminal history never reconstructs content')
    await button('返回记忆', 'document.querySelector(".memory-review-dialog")')
    report.interactions.push('applied/refresh-failed blocks duplicate commands; stale reject only; exit during submission; next candidate and completion; terminal body/keys/kind cleared')

    // An external terminal event also clears a closed draft; a lost response requires a read first.
    await b.evaluate('__memoryFixture.seedReviews()'); await settle(); await click('.memory-review-entry')
    await button('编辑后接受', 'document.querySelector(".memory-review-dialog")')
    await fill('#memory-review-body-input','不应保留的失效草稿。')
    await button('返回记忆', 'document.querySelector(".memory-review-dialog")')
    await b.evaluate('__memoryFixture.invalidateReview("review-2")'); await settle(); await click('.memory-review-entry')
    assert.equal(await b.evaluate('!!document.querySelector("#memory-review-body-input")'),false)
    assert.equal(await b.evaluate('document.querySelector(".memory-review-dialog").textContent.includes("不应保留的失效草稿")'),false)
    await b.evaluate('__memoryFixture.failNext()'); await button('接受', 'document.querySelector(".memory-review-dialog")')
    assert.match(await text('.memory-review-error'),/无法确认最新审核状态/)
    await button('刷新列表', 'document.querySelector(".memory-review-dialog")')
    await button('拒绝', 'document.querySelector(".memory-review-dialog")')
    await button('拒绝', 'document.querySelector(".memory-review-dialog")')
    report.interactions.push('external invalidation clears retained draft; transport error requires read-only refresh before another explicit action')
    await button('返回记忆', 'document.querySelector(".memory-review-dialog")')
    await b.evaluate('__memoryFixture.seedReviews(); __memoryFixture.setLanguage("en")'); await settle()
    await viewport(320,700); await navigate({ scope: 'all' }); await click('.memory-review-entry')
    await button('Edit and accept', 'document.querySelector(".memory-review-dialog")')
    const english = await b.evaluate(`(() => {
      const dialog = document.querySelector('.memory-review-dialog');
      return {overflow: dialog.scrollWidth > dialog.clientWidth + 1 || [...dialog.querySelectorAll('.memory-review-actions,.memory-review-scroll')].some(e => e.scrollWidth > e.clientWidth + 1),
        title:dialog.querySelector('h2').textContent,
        footer:[...dialog.querySelectorAll('.memory-review-footer button')].map(e => { const r=e.getBoundingClientRect(); return r.x>=0 && r.right<=innerWidth && r.bottom<=innerHeight; })};
    })()`)
    assert.equal(english.overflow,false,'English inline editing fits narrow windows')
    assert.ok(english.footer.every(Boolean),'English review actions remain inside the viewport')
    assert.equal(english.title,'Shared Memory Review')
    await b.capture(join(output,'review-english-320-editor.png'))
    await b.key('Escape'); await b.wait('!document.querySelector(".memory-review-dialog")')
    report.interactions.push('English inline review on a 320px viewport')
    await b.evaluate('__memoryFixture.setLanguage("zh-CN")'); await viewport(1440,920); await click('.memory-review-entry')
    await b.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
    await b.capture(join(output,'review-history-reduced-motion.png'))
    await b.key('Escape'); await b.wait('!document.querySelector(".memory-review-dialog")')
    await b.evaluate('__memoryFixture.setMemoryEnabled(false)')
    await b.wait('document.querySelector(".memory-library").textContent.includes("Rovai 长期记忆已关闭")')
    assert.equal(await b.evaluate('!!document.querySelector(".memory-catalog,.memory-summary-strip,.memory-header-actions,.memory-review-dialog")'), false)
    const pausedReads = await b.evaluate('__memoryFixture.capabilityStats().memoryBusinessReads')
    await b.evaluate('__memoryFixture.navigate({kind:"memory",memoryId:"shared-1"}); __memoryFixture.setNotice(true)')
    await settle()
    assert.equal(await b.evaluate('__memoryFixture.capabilityStats().memoryBusinessReads'), pausedReads)
    assert.equal(await b.evaluate('!!document.querySelector(".memory-change-notice")'), false)
    await button('前往设置')
    assert.equal(await b.evaluate('window.__memorySettingsOpened'), true)
    await b.capture(join(output,'memory-disabled-day.png'))
    await b.evaluate('__memoryFixture.setTheme("night")'); await settle()
    await b.capture(join(output,'memory-disabled-night.png'))
    await b.evaluate('__memoryFixture.setMemoryEnabled(true)')
    await b.wait('!!document.querySelector(".memory-catalog")')
    await b.evaluate('__memoryFixture.failCapabilityRead()')
    await b.wait('document.querySelector(".memory-library").textContent.includes("状态暂不可用")')
    assert.equal(await b.evaluate('document.querySelector(".memory-library").textContent.includes("已关闭")'), false)
    assert.equal(await b.evaluate('!!document.querySelector(".memory-catalog")'), false)
    await button('重试'); await b.wait('!!document.querySelector(".memory-catalog")')
    await b.evaluate('__memoryFixture.holdCapabilityRead()')
    await b.wait('__memoryFixture.capabilityStats().capabilityReadWaiting')
    await b.evaluate('__memoryFixture.setMemoryEnabled(false)')
    await b.wait('document.querySelector(".memory-library").textContent.includes("已关闭")')
    await b.evaluate('__memoryFixture.releaseCapabilityRead()'); await settle()
    assert.equal(await b.evaluate('!!document.querySelector(".memory-catalog")'), false, 'late enabled snapshot cannot undo a newer disable')
    await b.evaluate('__memoryFixture.setMemoryEnabled(true)'); await b.wait('!!document.querySelector(".memory-catalog")')
    await b.evaluate('__memoryFixture.holdMemoryRead()'); await b.wait('__memoryFixture.capabilityStats().memoryReadWaiting')
    await b.evaluate('__memoryFixture.setMemoryEnabled(false)'); await b.wait('!document.querySelector(".memory-catalog")')
    const lateReads = await b.evaluate('__memoryFixture.capabilityStats().memoryBusinessReads')
    await b.evaluate('__memoryFixture.releaseMemoryRead()'); await settle()
    assert.equal(await b.evaluate('!!document.querySelector(".memory-catalog,.memory-change-notice")'), false)
    assert.equal(await b.evaluate('__memoryFixture.capabilityStats().memoryBusinessReads'), lateReads, 'late business response starts no follow-up query')
    await b.evaluate('__memoryFixture.setMemoryEnabled(true)'); await b.wait('!!document.querySelector(".memory-catalog")')
    report.interactions.push('Memory capability: disabled business zero queries, settings entry, unknown/retry, stale authority and late business responses fenced, re-enable restores management')
    await b.evaluate('__memoryFixture.seedReviews()'); await settle(); await click('.memory-review-entry')
    if (await b.evaluate('!!document.querySelector("#memory-review-body-input")')) await button('取消编辑', 'document.querySelector(".memory-review-dialog")')
    await b.evaluate('__memoryFixture.holdMutationReceipt()')
    await button('接受', 'document.querySelector(".memory-review-dialog")')
    await b.wait('__memoryFixture.capabilityStats().mutationReceiptWaiting')
    const committedReviewId = await b.evaluate('__memoryFixture.get().calls.at(-1).command.reviewItemId')
    assert.equal(await b.evaluate(`__memoryFixture.get().reviews.find(item => item.reviewItemId === ${JSON.stringify(committedReviewId)}).status`), 'accepted')
    await b.evaluate('__memoryFixture.setMemoryEnabled(false)'); await b.wait('!document.querySelector(".memory-catalog")')
    const receiptReads = await b.evaluate('__memoryFixture.capabilityStats().memoryBusinessReads')
    await b.evaluate('__memoryFixture.releaseMutationReceipt()'); await settle()
    assert.equal(await b.evaluate('__memoryFixture.capabilityStats().memoryBusinessReads'), receiptReads, 'late committed receipt does not start a disabled business refresh')
    await b.evaluate('__memoryFixture.setMemoryEnabled(true)'); await b.wait('!!document.querySelector(".memory-catalog")')
    assert.equal(await b.evaluate('!!document.querySelector(".memory-feedback,.memory-review-error")'), false, 'late success remains committed without a stale toast or refresh failure')
    assert.equal(await b.evaluate(`__memoryFixture.get().reviews.find(item => item.reviewItemId === ${JSON.stringify(committedReviewId)}).status`), 'accepted')
    report.interactions.push('committed management receipt arriving while off preserves success without another business query, stale notice or false refresh failure')

    assert.deepEqual(b.errors,[])
    await writeFile(join(output,'report.json'),JSON.stringify(report,null,2))
    console.log(`Memory acceptance: ${report.interactions.length} interaction groups, ${report.viewports.length} viewport/theme combinations. ${output}`)
  } catch (error) {
    await b.capture(join(output,'failure.png')).catch(()=>{})
    console.error(await b.evaluate('document.body.innerText').catch(()=>''))
    throw error
  } finally { await b.close(); await rm(root,{recursive:true,force:true}) }
})
