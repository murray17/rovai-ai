const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { isAbsolute, join, dirname } = require('node:path')
const { app, BrowserWindow } = require('electron')
const [renderer, userData] = process.argv.slice(2)
assert.ok(isAbsolute(renderer) && isAbsolute(userData))
mkdirSync(userData, { recursive: true })
mkdirSync(join(userData, 'managed-skill-library'), { recursive: true })
app.setPath('userData', userData)
app.setPath('sessionData', join(userData, 'session'))

app.whenReady().then(async () => {
  console.error('settings fixture: Electron ready')
  const window = new BrowserWindow({ show: process.platform === 'linux', width: 1440, height: 920, useContentSize: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } })
  // Hidden Windows windows throttle animation frames despite backgroundThrottling:false.
  if (process.platform === 'win32') window.showInactive()
  window.webContents.on('console-message', event => console.error(event.message))
  const run = async code => {
    const started = Date.now()
    if (process.env.ROVAI_UI_FIXTURE_TRACE === '1') console.error('settings run: ' + code)
    let timer
    try {
      return await Promise.race([
        window.webContents.executeJavaScript(code, true),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Renderer did not settle: ' + code)), 12_000) })
      ])
    } finally {
      clearTimeout(timer)
      if (process.env.ROVAI_UI_FIXTURE_TRACE === '1') console.error(`settings done (${Date.now() - started}ms)`)
    }
  }
  const settle = () => run('window.settingsTest.settle()')
  const waitFor = async expression => {
    for(let attempt=0;attempt<40;attempt++){
      if(await run(`Boolean(${expression})`)) return
      await new Promise(resolve=>setTimeout(resolve,50))
    }
    throw Error('UI did not settle: '+expression)
  }
  const navigate = async (page, scenario = 'normal') => {
    console.error('settings fixture: ' + page)
    await run(`window.settingsTest.navigate(${JSON.stringify(page)},${JSON.stringify(scenario)})`)
    await settle()
  }
  const key = async keyCode => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode })
    await settle()
  }
  const click = async selector => {
    const point = await run(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)})
      if (!node) throw Error('Missing control: ' + ${JSON.stringify(selector)})
      node.scrollIntoView({block:'center'})
      const r = node.getBoundingClientRect(), hit = document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)
      if (!node.contains(hit)) throw Error('Covered control: ' + ${JSON.stringify(selector)})
      return {x:r.x+r.width/2,y:r.y+r.height/2}
    })()`)
    const zoom = window.webContents.getZoomFactor()
    point.x = Math.round(point.x * zoom); point.y = Math.round(point.y * zoom)
    window.webContents.sendInputEvent({ type: 'mouseMove', ...point })
    window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
    window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 })
    await settle()
  }
  const capture = async name => {
    if (process.env.ROVAI_SETTINGS_SCENARIO === 'channel-delete') {
      await run(`Promise.race([
        Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))),
        new Promise(resolve => setTimeout(resolve, 1000))
      ])`)
      await settle()
    }
    writeFileSync(join(dirname(userData), `${name}.png`), (await window.webContents.capturePage()).toPNG())
  }
  const noOverflow = async label => {
    assert.equal(await run(`(() => {
      const panel=document.querySelector('.settings-panel')
      const overflow = panel.scrollWidth > panel.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1
      if(overflow) console.log(JSON.stringify([...panel.querySelectorAll('*')].filter(n=>n.getBoundingClientRect().right>innerWidth).slice(0,12).map(n=>({tag:n.tagName,class:n.className,width:n.clientWidth,scroll:n.scrollWidth}))))
      return overflow
    })()`), false, label + ' must contain horizontal overflow')
  }
  const selectMonitoringRange = async range => {
    await run(`(() => {
      const select = document.querySelector('.monitoring-filters select')
      select.value = ${JSON.stringify(range)}
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    await settle()
    await waitFor(`!document.querySelector('.monitoring-filters select').disabled && window.settingsTest.requests.some(r => r.method === 'monitoring.snapshot' && r.params.range === ${JSON.stringify(range)})`)
  }
  const costHistoryFits = async label => {
    const bounds = await run(`(() => {
      const page = document.querySelector('.runtime-monitoring')
      const cost = document.querySelector('.monitoring-trend-cost')
      return { pageWidth: page.clientWidth, pageScrollWidth: page.scrollWidth,
        costWidth: cost.clientWidth, costScrollWidth: cost.scrollWidth,
        dates: cost.querySelectorAll('time').length }
    })()`)
    assert.equal(bounds.dates, 30, label + ' retains every daily cost')
    assert.ok(bounds.pageScrollWidth <= bounds.pageWidth + 1, label + ' page must fit: ' + JSON.stringify(bounds))
    assert.ok(bounds.costScrollWidth <= bounds.costWidth + 1, label + ' costs must fit without horizontal scrolling: ' + JSON.stringify(bounds))
    await noOverflow(label)
  }
  try {
    await window.loadFile(renderer); console.error('settings fixture: renderer loaded'); await settle()
    // Keep native DOM focus events available without depending on the active desktop window.
    window.webContents.debugger.attach('1.3')
    await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
    if (process.env.ROVAI_SETTINGS_SCENARIO === 'channel-delete') {
      // Only the narrow renderer API is mocked. Every action below uses Chromium input events.
      // Reject accidental external navigation; this fixture must never contact a real Bot.
      window.webContents.setWindowOpenHandler(() => { throw Error('Unexpected external navigation') })
      window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }))
      await navigate('channels')
      const original = await run('structuredClone(window.settingsTest.state.channels.channels[0])')
      const bot = original.memberBots[0]
      const row = '.channel-member-bot-row:first-child'
      const deleteButton = row + ' .channel-row-action.is-danger'
      const dialog = '[role=dialog]'
      const confirm = dialog + ' .danger-button'
      const cancel = dialog + ' .app-dialog-footer .quiet-button'
      const deleteRequests = () => run("window.settingsTest.requests.filter(r=>r.method==='channels.deleteMemberBot')")
      const assertPublished = async () => assert.equal(await run("document.querySelector('.channel-member-bot-row:first-child .channel-publication-status > span').textContent"), '已发布')
      const assertDialog = async () => {
        await waitFor("document.querySelector('[role=dialog] .channel-dialog-fact code')")
        assert.equal(await run("document.querySelector('[role=dialog] .channel-dialog-fact code').textContent"), bot.appId)
        assert.equal(await run("document.querySelector('[role=dialog] .channel-dialog-fact strong').textContent"), bot.botDisplayName)
        assert.ok(await run("document.querySelector('[role=dialog]').textContent.includes('不删除飞书 Bot、队员或聊天记录')"))
      }
      const assertActionsFit = async () => {
        const layout = await run(`(() => {
          const row = document.querySelector('.channel-member-bot-row')
          const actions = [...row.querySelectorAll('.channel-row-action')]
          return actions.map(node => {
            const r = node.getBoundingClientRect(), range = document.createRange()
            range.selectNodeContents(node)
            return { text: node.textContent, x:r.x, y:r.y, right:r.right, width:r.width, height:r.height,
              textLines:new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size,
              inside:r.right <= innerWidth && r.left >= 0, unclipped:r.right <= row.getBoundingClientRect().right + 1 }
          })
        })()`)
        assert.equal(layout.length, 2)
        for (const action of layout) {
          assert.ok(action.inside && action.unclipped, 'action must remain visible: ' + JSON.stringify(layout))
          assert.equal(action.textLines, 1, 'button text must not wrap vertically: ' + JSON.stringify(layout))
        }
        assert.ok(Math.abs(layout[0].y - layout[1].y) <= 2, 'management and delete remain beside each other')
        return layout
      }
      const evidence = [], layoutFailures = []
      for (const theme of ['day', 'night']) for (const width of [1040, 600]) {
        window.webContents.setZoomFactor(1); window.setContentSize(width, 760)
        await run(`document.documentElement.dataset.theme=` + JSON.stringify(theme))
        await run(`window.settingsTest.updateChannel('feishu', ` + JSON.stringify(original) + ')')
        await navigate('channels')
        const name = 'channel-delete-' + theme + '-' + width
        const before = (await deleteRequests()).length
        assert.equal(await run("document.querySelector('.channel-member-bot-row:first-child a.channel-row-action').textContent"), '飞书管理')
        assert.equal(await run(`document.querySelector(` + JSON.stringify(deleteButton) + ').disabled'), false)
        await capture(name + '-published')
        let layout
        try { await noOverflow(name); layout = await assertActionsFit() }
        catch (error) { layoutFailures.push({ name, error: error.message }) }
        await click(deleteButton); await assertDialog()
        await capture(name + '-confirm')
        await click(cancel)
        await waitFor("!document.querySelector('[role=dialog]')")
        assert.equal((await deleteRequests()).length, before, 'Cancel makes zero delete calls')
        await assertPublished()
        await click(deleteButton); await key('Escape')
        await waitFor("!document.querySelector('[role=dialog]')")
        assert.equal((await deleteRequests()).length, before, 'Escape makes zero delete calls')
        await click(deleteButton); await assertDialog()
        await run("window.settingsTest.fail('channels.deleteMemberBot')")
        await click(confirm)
        await waitFor("document.querySelector('[role=dialog] [role=alert]')")
        await assertDialog(); await assertPublished()
        assert.equal(await run(`document.querySelector(` + JSON.stringify(confirm) + ').disabled'), false)
        assert.equal((await deleteRequests()).length, before + 1)
        await capture(name + '-failed')
        // Disabling the pending action can move focus; use real Tab/Space input to retry.
        for (let tab = 0; tab < 5 && !await run("document.activeElement.matches('[role=dialog] .danger-button')"); tab++) await key('Tab')
        assert.ok(await run("document.activeElement.matches('[role=dialog] .danger-button')"))
        await key('Space')
        await waitFor("!document.querySelector('[role=dialog]')")
        assert.equal(await run("document.querySelector('.channel-member-bot-row:first-child .channel-publication-status > span').textContent"), '未发布')
        assert.equal(await run("document.querySelector('.channel-member-bot-row:first-child .channel-row-action').textContent"), '发布')
        assert.equal(await run("document.querySelector('.channel-member-bot-row:first-child .channel-row-action').disabled"), false)
        assert.equal(await run(`document.querySelector(` + JSON.stringify(deleteButton) + ')'), null)
        assert.equal((await deleteRequests()).length, before + 2)
        assert.deepEqual((await deleteRequests()).at(-1).params, { agentId: bot.agentId, expectedAppId: bot.appId, kind: 'feishu' })
        try { await noOverflow(name + '/unpublished') }
        catch (error) { layoutFailures.push({ name: name + '/unpublished', error: error.message }) }
        await capture(name + '-unpublished')
        // Simulate a snapshot arriving while confirmation is open. Main's CAS rejection
        // is modeled here; the production Renderer must still submit the frozen old ID.
        await run(`window.settingsTest.updateChannel('feishu', ` + JSON.stringify(original) + ')')
        await settle(); await click(deleteButton); await assertDialog()
        const replacement = { ...bot, appId: 'sample-replacement-app' }
        await run(`window.settingsTest.updateChannel('feishu', ` + JSON.stringify({ memberBots: [replacement] }) + ')')
        await settle(); await assertDialog(); await click(confirm)
        await waitFor("document.querySelector('[role=dialog] [role=alert]')?.textContent.includes('绑定已变化')")
        assert.equal((await deleteRequests()).length, before + 3)
        assert.equal((await deleteRequests()).at(-1).params.expectedAppId, bot.appId)
        assert.equal(await run('window.settingsTest.state.channels.channels[0].memberBots[0].appId'), replacement.appId)
        await assertPublished(); await capture(name + '-conflict')
        await key('Escape'); await waitFor("!document.querySelector('[role=dialog]')")
        evidence.push({ theme, width, layout, cases: ['visible-adjacent', 'cancel-no-delete', 'escape-no-delete', 'failure-retained', 'keyboard-retry-success', 'frozen-app-conflict'] })
      }
      console.log(JSON.stringify({ ok:layoutFailures.length === 0, matrices:evidence.length, interactionCases:evidence.length * 6, screenshots:evidence.length * 5, evidence, layoutFailures }))
      assert.deepEqual(layoutFailures, [], 'channel delete layouts must pass at every tested width')
      app.exit(0); return
    }
    // Runtime editor regression: a selected program path saves directly, failure
    // preserves the draft, and clean/dirty transitions keep both actions visible.
    window.webContents.setZoomFactor(1); window.setContentSize(1280, 850)
    await navigate('runtime')
    const codexRow = '.runtime-product-row:has(.runtime-product-settings[aria-label="Codex CLI 启动设置"])'
    for (const [outcome, label] of [['stable_failure', '本次检查未通过'], ['deferred', '检查未完成']]) {
      await run(`window.settingsTest.state.checkOutcome=${JSON.stringify(outcome)}`)
      await click(`${codexRow} .runtime-product-check`)
      await waitFor(`document.querySelector(${JSON.stringify(codexRow + ' .runtime-guide-feedback')})?.textContent.includes(${JSON.stringify(label)})`)
      assert.equal(await run(`document.querySelector(${JSON.stringify(codexRow + ' .runtime-product-status')}).textContent`), '可用')
    }
    await run("window.settingsTest.state.holdRuntimeKind='codex-cli'; window.settingsTest.state.checkOutcome='stable_failure'")
    await click(`${codexRow} .runtime-product-check`)
    await waitFor(`document.querySelector(${JSON.stringify(codexRow + ' .runtime-product-check')}).disabled`)
    assert.equal(await run("document.querySelector('.runtime-product-settings[aria-label=\"GitHub Copilot 启动设置\"]').disabled"), false)
    await click('.runtime-guide-trigger[aria-label="GitHub Copilot 登录指南"]')
    await click('.runtime-install-guide .primary-button')
    assert.equal(await run("window.settingsTest.requests.filter(r=>r.method==='runtime.product.check').at(-1).params.runtimeKind"), 'copilot-cli')
    assert.equal(await run("window.settingsTest.requests.filter(r=>r.method==='runtime.discovery.rescan').length"), 0)
    await waitFor("document.querySelector('.runtime-install-guide .runtime-guide-feedback')?.textContent.includes('本次检查未通过')")
    assert.equal(await run(`document.querySelector(${JSON.stringify(codexRow + ' .runtime-product-check')}).disabled`), true)
    await run("window.settingsTest.finishRuntimeCheck('codex-cli', {ready:false, outcome:'deferred'}); window.settingsTest.state.holdRuntimeKind=null")
    await waitFor(`document.querySelector(${JSON.stringify(codexRow + ' .runtime-guide-feedback')})?.textContent.includes('检查未完成')`)
    assert.equal(await run("document.querySelector('.runtime-install-guide .runtime-guide-feedback').textContent.includes('本次检查未通过')"), true)
    // A completed check remains retryable when its final refresh fails and the
    // last server snapshot still says checking. Keep that status and row error.
    await run("window.settingsTest.setRuntimeChecking('codex-cli', true); window.settingsTest.state.holdRuntimeKind='codex-cli'")
    await settle()
    await click(`${codexRow} .runtime-product-check`)
    await waitFor(`document.querySelector(${JSON.stringify(codexRow + ' .runtime-product-check')}).disabled`)
    await run("window.settingsTest.fail('runtime.reload'); window.settingsTest.finishRuntimeCheck('codex-cli', {ready:true, outcome:'ready'})")
    await waitFor(`document.querySelector(${JSON.stringify(codexRow + ' .runtime-guide-feedback')})?.textContent.includes('暂时无法完成')`)
    assert.equal(await run(`document.querySelector(${JSON.stringify(codexRow + ' .runtime-product-status')}).textContent`), '正在检查…')
    assert.equal(await run(`document.querySelector(${JSON.stringify(codexRow + ' .runtime-product-check')}).disabled`), false)
    assert.equal(await run(`document.querySelector(${JSON.stringify(codexRow + ' .runtime-product-settings')}).disabled`), false)
    const beforeRetry = await run("window.settingsTest.requests.filter(r => r.method === 'runtime.product.check').length")
    await click(`${codexRow} .runtime-product-check`)
    assert.equal(await run("window.settingsTest.requests.filter(r => r.method === 'runtime.product.check').length"), beforeRetry + 1)
    assert.equal(await run(`document.querySelector(${JSON.stringify(codexRow + ' .runtime-product-check')}).disabled`), true)
    assert.equal(await run(`document.querySelector(${JSON.stringify(codexRow + ' .runtime-guide-feedback')})`), null)
    assert.equal(await run("document.querySelector('.runtime-install-guide .runtime-guide-feedback').textContent.includes('本次检查未通过')"), true)
    await run("window.settingsTest.setRuntimeChecking('codex-cli', false); window.settingsTest.finishRuntimeCheck('codex-cli', {ready:true, outcome:'ready'}); window.settingsTest.state.holdRuntimeKind=null")
    await waitFor(`!document.querySelector(${JSON.stringify(codexRow + ' .runtime-product-check')}).disabled`)
    await click('.runtime-product-settings[aria-label="Codex CLI 启动设置"]')
    await waitFor("document.querySelector('.runtime-startup-form') && !document.querySelector('.runtime-startup-page').getAttribute('aria-busy').includes('true')")
    assert.equal(await run("[...document.querySelectorAll('.runtime-startup-actions button')].filter(b => b.disabled).length"), 2)
    assert.equal(await run("getComputedStyle(document.querySelector('.runtime-startup-actions')).display"), 'flex')
    assert.equal(await run("document.querySelectorAll('.runtime-custom-api, .runtime-connection-choice, .runtime-api-model-row').length"), 0)
    assert.equal(await run("window.settingsTest.requests.filter(r => r.method==='runtime.startup.observe').length"), 0)

    await click('.runtime-startup-path button')
    await waitFor("!document.querySelector('.runtime-startup-actions button[type=submit]').disabled")
    await run("window.settingsTest.state.failure='runtime.startup.save'")
    await click('.runtime-startup-actions button[type=submit]')
    await waitFor("document.querySelector('.runtime-startup-form .inline-error')")
    assert.equal(await run("document.querySelector('.runtime-startup-path input').value"), '/sample/custom/codex')
    assert.equal(await run("document.querySelector('.runtime-startup-actions button[type=submit]').disabled"), false)
    const beforeLocalSave = await run('window.settingsTest.requests.length')
    await click('.runtime-startup-actions button[type=submit]')
    await waitFor("document.querySelector('.runtime-startup-actions button[type=submit]').disabled")
    assert.deepEqual(await run('window.settingsTest.requests.slice('+beforeLocalSave+').map(r => r.method)'), ['runtime.startup.save'])
    assert.equal(await run("document.querySelector('.runtime-startup-actions [role=status]').textContent"), '已保存')
    assert.equal(await run("window.settingsTest.requests.filter(r => r.method==='runtime.startup.check').length"), 0)
    assert.equal(await run("window.settingsTest.state.startup['codex-cli'].configuration.programPath"), '/sample/custom/codex')
    await click('.runtime-startup-section-heading > button')
    await click('.runtime-startup-actions button[type=button]')
    assert.equal(await run("document.querySelector('.runtime-startup-path input').value"), '/sample/custom/codex')
    assert.equal(await run("document.querySelector('.runtime-startup-actions button[type=submit]').disabled"), true)
    await click('.runtime-startup-inspection .quiet-button')
    await waitFor("document.querySelector('.runtime-startup-result').textContent.includes('认证未通过，请检查登录状态或凭据配置')")
    await click('.runtime-startup-section-heading > button')
    await click('.runtime-startup-actions button[type=submit]')
    await waitFor("document.querySelector('.runtime-startup-actions button[type=submit]').disabled")
    // Restore-auto uses fresh private preview, not a formal rescan or implicit save.
    await click('.runtime-startup-path button')
    await waitFor("!document.querySelector('.runtime-startup-actions button[type=submit]').disabled")
    await click('.runtime-startup-actions button[type=submit]')
    await waitFor("document.querySelector('.runtime-startup-actions button[type=submit]').disabled")
    await run("window.settingsTest.state.previewVersion='0.200.0'")
    await click('.runtime-startup-section-heading > button')
    await waitFor("document.querySelector('.runtime-startup-version')?.textContent==='0.200.0'")
    assert.equal(await run("document.querySelector('.runtime-startup-path input').value"), '/sample/bin/codex')
    assert.equal(await run("window.settingsTest.state.startup['codex-cli'].configuration.programPath"), '/sample/custom/codex')
    assert.equal(await run("window.settingsTest.requests.filter(r=>r.method==='runtime.discovery.rescan').length"), 0)
    await click('.runtime-startup-actions button[type=button]')
    await run("window.settingsTest.fail('runtime.startup.inspect')")
    await click('.runtime-startup-section-heading > button')
    await waitFor("document.querySelector('.runtime-startup-form .inline-error')")
    assert.equal(await run("document.querySelector('.runtime-startup-path input').value"), '')
    assert.equal(await run("document.querySelector('.runtime-startup-result').textContent"), '')
    await click('.runtime-startup-actions button[type=button]')
    await run("window.settingsTest.state.deferStartupInspection=true")
    await click('.runtime-startup-inspection .quiet-button')
    await navigate('general'); await navigate('runtime')
    await click('.runtime-product-settings[aria-label="Codex CLI 启动设置"]')
    await waitFor("document.querySelector('.runtime-startup-form')")
    await run("window.settingsTest.finishStartupInspection({status:'ready', executablePath:'/old',reportedVersion:'OUTDATED'})")
    await settle()
    assert.equal(await run("document.querySelector('.runtime-startup-page').textContent.includes('OUTDATED')"), false)
    for (const theme of ['day', 'night']) {
      await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
      await noOverflow(`startup/${theme}/1280`); await capture(`runtime-startup-${theme}`)
      window.webContents.setZoomFactor(2)
      await noOverflow(`startup/${theme}/200%`); await capture(`runtime-startup-${theme}-200`)
      window.webContents.setZoomFactor(1)
    }

    await click('.runtime-startup-back')
    await click('.runtime-product-settings[aria-label="Claude Code 启动设置"]')
    await waitFor("document.querySelector('.runtime-startup-form') && document.querySelector('.runtime-startup-page').getAttribute('aria-busy')==='false'")
    assert.equal(await run("document.querySelectorAll('.runtime-custom-api, .runtime-connection-choice, .runtime-api-model-row').length"), 0)
    assert.equal(await run("document.querySelector('.runtime-startup-form').textContent.includes('API Key')"), false)
    for (const theme of ['day', 'night']) {
      await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
      window.setContentSize(1040, 700)
      await noOverflow(`claude/${theme}/1040`); await capture(`claude-startup-${theme}`)
      window.webContents.setZoomFactor(2)
      await noOverflow(`claude/${theme}/200%`)
      window.webContents.setZoomFactor(1)
    }
    await navigate('general')
    window.setContentSize(1440, 920)
    await navigate('runtime')
    assert.equal(await run("document.querySelectorAll('.runtime-product-settings[aria-label=\"Cline 启动设置\"]').length"), 0)
    assert.equal(await run("document.querySelectorAll('.runtime-product-settings[aria-label=\"Cursor Agent 启动设置\"]').length"), 0)
    await navigate('general')
    window.setContentSize(1440, 920)
    console.error('settings fixture: runtime regression passed')
    await run("document.documentElement.dataset.theme='day'")
    assert.equal(await run("document.querySelectorAll('.general-save-row .dialog-glyph').length"), 1)
    assert.equal(await run("document.querySelectorAll('.general-save-state').length"), 0)
    await click('[aria-label="一键创建新对话"]')
    await click('.one-click-confirm-dialog .primary-button')
    await waitFor('!!document.querySelector(".general-effective-summary")')
    await capture('general-defaults-summary')
    await click('[aria-label="一键创建新对话"]')
    await click('.hub-member-trigger')
    await waitFor("!!document.querySelector('.hub-member-menu')")
    assert.equal(await run("document.querySelectorAll('.hub-member-options .compact-option').length"), 24)
    assert.ok(await run("document.querySelector('.hub-member-options').clientHeight <= 280"))
    await capture('general-many-day')
    await key('Escape')
    await waitFor("!document.querySelector('.hub-member-menu')")
    await click('.general-lead-trigger')
    assert.equal(await run("document.querySelectorAll('.general-lead-option').length"), 12)
    assert.equal(await run("document.querySelectorAll('.general-lead-option .member-avatar').length"), 12)
    assert.ok(await run("document.querySelector('.general-lead-popover').getBoundingClientRect().bottom <= innerHeight"))
    await capture('general-lead-open')
    await click('.general-lead-search input')
    await run("document.execCommand('insertText',false,'林舟')"); await settle()
    assert.equal(await run("document.querySelectorAll('.general-lead-option').length"), 1)
    await key('Enter')
    assert.ok(await run("document.querySelector('.general-lead-trigger').textContent.includes('林舟')"))
    await run("window.settingsTest.fail('newConversationDefaults')")
    await click('.general-save-row button')
    assert.ok(await run("document.querySelector('.general-inline-status[role=alert]').textContent.includes('暂时无法完成')"))
    await click('.general-save-row button')
    assert.equal(await run("window.settingsTest.state.preferences.newConversationDefaults.defaultLeadAgentId"), 'sample-extra-1')
    await waitFor("!document.querySelector('.general-lead-trigger').disabled")
    await run("document.querySelector('.general-lead-trigger').focus()"); await settle()
    await key('Down')
    await waitFor("!!document.querySelector('.general-lead-popover')")
    await key('Home')
    await waitFor("document.querySelector('.general-lead-option.is-active')?.textContent.includes('叮叮')")
    await key('Enter')
    assert.ok(await run("document.querySelector('.general-lead-trigger').textContent.includes('叮叮')"), 'Home chooses the first eligible Lead')
    assert.equal(await run("document.querySelectorAll('.general-lead-popover').length"), 0)
    await click('.general-save-row button')
    await run('window.settingsTest.unavailableLead()'); await settle()
    assert.ok(await run("document.querySelector('.general-lead-trigger').textContent.includes('已失效')"))
    assert.equal(await run("document.querySelector('.general-save-row button').disabled"), true)

    await navigate('remote')
    await run("window.settingsTest.state.holdHostStatus = true; dispatchEvent(new Event('focus'))")
    await settle()
    await click('[aria-label="远程访问"]')
    await run('window.settingsTest.releaseHostStatus()'); await settle()
    assert.equal(await run("document.querySelector('#remote-token').type"), 'password')
    assert.equal(await run("document.querySelector('#remote-token').value"), 'fixture-token-1')
    assert.ok(await run("document.querySelector('[aria-label=\"远程访问\"]').checked"), 'late status must not undo start')
    await capture('host-web-enabled-day')
    assert.equal(await run("document.querySelectorAll('.remote-token-actions button').length"), 2)
    await click('[aria-label="远程访问"]')
    assert.equal(await run("document.querySelector('[role=dialog]')===null"), true)
    assert.equal(await run("document.querySelector('#remote-token').value"), 'fixture-token-1')
    await run('window.settingsTest.state.loseHostStartReply = true')
    await click('[aria-label="远程访问"]')
    assert.ok(await run("document.querySelector('[aria-label=\"远程访问\"]').checked"))
    assert.equal(await run("window.settingsTest.requests.filter(r => r.method === 'hostWeb.start').length"), 2, 'unknown reply must query status without repeating start')
    await navigate('general'); await navigate('remote')
    assert.equal(await run("document.querySelector('#remote-token').value"), 'fixture-token-1', 'remount rereads the current Host credential without rotating')
    await click('[aria-label="远程访问"]')
    assert.equal(await run("document.querySelector('[role=dialog]')===null"), true)

    await navigate('appearance')
    assert.deepEqual(await run("[...document.querySelector('#appearance-zoom').options].map(o=>Number(o.value))"), [25,33,50,67,75,80,90,100,110,125,150,175,200,250,300,400,500])
    assert.equal(await run("document.querySelectorAll('.motion-example').length"), 0)
    await run('window.settingsTest.resetZoom(121)'); await settle()
    assert.equal(await run("document.querySelector('#appearance-zoom').value"), '121')
    await navigate('notifications')
    assert.equal(await run("document.querySelectorAll('input[role=switch]').length"), 8)

    await navigate('monitoring', 'partial')
    assert.equal(await run("document.querySelectorAll('.monitoring-coverage').length"), 0)
    assert.equal(await run("document.querySelectorAll('.monitoring-keyline > div').length"), 8)
    await run("document.querySelector('.monitoring-chart-svg').focus()"); await key('Home')
    assert.ok(await run("document.querySelector('[role=tooltip]').innerText.includes('—')"))
    await key('End'); await key('Escape')
    assert.equal(await run("document.querySelectorAll('[role=tooltip]').length"), 0)
    await click('.monitoring-chart-legend button:nth-child(3)')
    assert.equal(await run("document.querySelector('.monitoring-chart-legend button:nth-child(3)').getAttribute('aria-pressed')"), 'false')
    await navigate('monitoring', 'empty')
    assert.equal(await run("document.querySelectorAll('.monitoring-chart-svg').length"), 0)

    await navigate('monitoring')
    await selectMonitoringRange('30d')
    await costHistoryFits('monitoring/30d/1440')
    await capture('monitoring-30d-day-1440')

    await navigate('diagnostics')
    await run("window.settingsTest.fail('mcp.config.repairPermissions')")
    await click('.diagnostics-issue-action button')
    assert.ok(await run("document.querySelector('.diagnostics-notice.is-attention').innerText.includes('暂时无法完成')"))
    await click('.diagnostics-issue-action button')
    assert.ok(await run("document.querySelector('.health-score').innerText.includes('无需修复')"))
    assert.ok(await run("document.querySelector('#diagnostics-summary-title').innerText.includes('暂时无法确认')"))
    await run("window.settingsTest.fail('diagnostics.check')")
    await click('.diagnostics-center .settings-page-heading .primary-button')
    assert.ok(await run("document.querySelector('.diagnostics-summary').innerText.includes('最近一次成功')"))
    await capture('diagnostics-recovery')

    await navigate('about')
    await click('.about-history > summary')
    assert.ok(await run("document.querySelector('.about-facts').innerText.includes('手动')"))
    await run('window.settingsTest.updateError()'); await settle()
    assert.equal(await run("document.querySelector('#about-update-status').classList.contains('about-status-quiet')"), false)
    await capture('about-download-error')

    await navigate('about', 'server_download_failed')
    const serverReleaseLink = 'https://github.com/murray17/rovai-ai/releases/tag/v0.0.7'
    assert.equal(await run("document.querySelector('.about-update-fallback a').href"), serverReleaseLink)
    await click('[data-app-update-release-tab="current"]')
    assert.equal(await run("document.querySelector('.about-release-section').dataset.appUpdateReleaseVersion"), '0.0.6')
    assert.equal(await run("document.querySelector('.about-update-fallback a').href"), serverReleaseLink)
    await navigate('about', 'server_no_candidate')
    assert.equal(await run("document.querySelector('.about-update-fallback a').href"), 'https://github.com/murray17/rovai-ai/releases')

    await navigate('channels')
    await waitFor('document.hasFocus()')
    const trigger = '.channel-connection-trigger'
    const menu = '.channel-connection-menu'
    const savedAccount = await run('window.settingsTest.state.channels.channels[0].connection.account')
    const savedBots = await run('JSON.stringify(window.settingsTest.state.channels.channels.map(c => c.memberBots))')
    const updateChannel = async (kind, patch) => {
      await run(`window.settingsTest.updateChannel(${JSON.stringify(kind)}, ${JSON.stringify(patch)})`)
      await settle()
    }
    const menuClosed = async () => assert.equal(await run(`document.querySelector(${JSON.stringify(menu)}) === null`), true)
    const channelRequests = () => run("window.settingsTest.requests.filter(r => r.method.startsWith('channels.'))")
    const finishChannelAction = async error => {
      await run(`window.settingsTest.finishChannelAction(${JSON.stringify(error)})`)
      await settle()
    }
    for (const kind of ['feishu', 'dingtalk']) {
      const account = { ...savedAccount, accountId: `sample-${kind}`, brand: kind }
      const connected = { status: 'connected', sessionStatus: 'valid', account }
      const tab = `.channel-provider-tab:has(.channel-mark-${kind})`
      await updateChannel(kind, { connection: connected })
      await click(tab)
      assert.equal(await run("document.querySelectorAll('.channel-connection-actions button').length"), 1)
      assert.equal(await run("document.querySelector('.channel-account-heading .channel-connection-status').textContent"), '登录有效')
      await updateChannel(kind, { connection: { status: 'connected', account } })
      assert.equal(await run("document.querySelector('.channel-connection-status').textContent"), '登录态待校验')
      await updateChannel(kind, { connection: { ...connected, sessionStatus: 'unavailable' } })
      assert.equal(await run("document.querySelector('.channel-connection-status').textContent"), '登录态暂不可用')
      assert.equal(await run('JSON.stringify(window.settingsTest.state.channels.channels.map(c => c.memberBots))'), savedBots)
      await updateChannel(kind, { connection: connected })
      const requestCount = (await channelRequests()).length
      await run(`document.querySelector(${JSON.stringify(trigger)}).focus()`)
      await key('Enter')
      assert.ok(await run("document.activeElement.matches('[role=menuitem]') && document.activeElement.textContent.startsWith('切换账号')"))
      await key('Down')
      assert.ok(await run("document.activeElement.matches('[role=menuitem]') && document.activeElement.textContent.startsWith('断开连接')"))
      await key('Up')
      assert.ok(await run("document.activeElement.matches('[role=menuitem]') && document.activeElement.textContent.startsWith('切换账号')"))
      await key('Escape'); await menuClosed()
      await click(trigger); await click('#channel-connection-heading'); await menuClosed()
      assert.equal((await channelRequests()).length, requestCount, 'dismissing the menu never submits an action')

      await run(`document.querySelector(${JSON.stringify(trigger)}).focus()`)
      await key('Space'); await key('Enter')
      await waitFor("document.querySelector('.channel-qr-dialog') !== null")
      assert.deepEqual((await channelRequests()).at(-1), { method: 'channels.connect', params: { kind } })
      await menuClosed()
      assert.ok(await run("document.querySelector('.channel-connection-trigger').disabled"))
      assert.equal(await run("document.querySelector('.channel-account-heading strong').textContent"), savedAccount.userName)
      await key('Escape')
      await waitFor("document.querySelector('.channel-qr-dialog') === null && !document.querySelector('.channel-connection-trigger').disabled")
      assert.equal(await run("document.querySelector('.channel-account-heading .channel-connection-status').textContent"), '登录有效')
      assert.equal(await run("document.querySelector('.channel-settings [role=alert]')"), null)

      await click(trigger); await click(`${menu} [role=menuitem]:first-child`)
      await waitFor("document.querySelector('.channel-qr-dialog') !== null")
      await finishChannelAction(`${kind}_connection_error`)
      assert.equal(await run("document.querySelector('.channel-account-heading strong').textContent"), savedAccount.userName)
      assert.equal(await run("document.querySelector('.channel-connection-status').textContent"), '登录有效')
      assert.ok(await run("document.querySelector('.channel-settings [role=alert]') !== null"))
      await click(trigger); await click(`${menu} [role=menuitem]:first-child`)
      await finishChannelAction(null)
      assert.equal(await run("document.querySelector('.channel-account-heading strong').textContent"), '新账号')
      await updateChannel(kind, { connection: connected })

      await click(trigger); await click(`${menu} .is-danger`)
      assert.deepEqual((await channelRequests()).at(-1), { method: 'channels.disconnect', params: { kind } })
      await menuClosed()
      assert.equal(await run("document.querySelector('.channel-connection-status').textContent"), '断开中…')
      assert.ok(await run("document.querySelector('.channel-connection-trigger').disabled"))
      const disconnectCount = (await channelRequests()).length
      await click(trigger)
      assert.equal((await channelRequests()).length, disconnectCount, 'busy state prevents duplicate disconnect')
      await finishChannelAction(`${kind}_connection_error`)
      assert.equal(await run("document.querySelector('.channel-connection-status').textContent"), '登录有效')
      await click(trigger); await click(`${menu} .is-danger`)
      await finishChannelAction(null)
      assert.equal(await run("document.querySelector('.channel-connection-actions button').textContent"), kind === 'feishu' ? '登录开放平台' : '连接钉钉')
      assert.equal(await run('JSON.stringify(window.settingsTest.state.channels.channels.map(c => c.memberBots))'), savedBots)

      await updateChannel(kind, { connection: { status: 'session_expired', account } })
      assert.equal(await run("document.querySelector('.channel-connection-actions button').textContent"), '重新连接')
      assert.equal(await run("document.querySelector('.channel-connection-status').textContent"), '登录已失效')
      assert.equal(await run("document.querySelector('.channel-account-heading strong').textContent"), savedAccount.userName)
      await click('.channel-connection-actions button')
      assert.deepEqual((await channelRequests()).at(-1), { method: 'channels.connect', params: { kind } })
      await key('Escape')
      await updateChannel(kind, { connection: { status: 'session_expired', account: null } })
      assert.equal(await run("document.querySelector('.channel-connection-actions button').textContent"), '重新连接')
      assert.ok(await run("document.querySelector('.channel-account-empty').textContent.includes('登录已失效')"))

      await updateChannel(kind, { connection: connected })
      await click(trigger)
      await updateChannel(kind, { hostStatus: 'unavailable' })
      await menuClosed()
      assert.ok(await run("document.querySelector('.channel-connection-trigger').disabled"))
      assert.equal(await run("document.querySelector('.channel-connection-status').textContent"), '登录有效')
      await updateChannel(kind, { hostStatus: 'ready' }); await menuClosed()
      await click(trigger)
      await click(`.channel-provider-tab:has(.channel-mark-${kind === 'feishu' ? 'dingtalk' : 'feishu'})`)
      await menuClosed()
    }

    for (const theme of ['day', 'night']) {
      await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
      for (const [width, height, zoom] of [[1440, 920, 1], [1040, 700, 1], [1440, 920, 2], [1040, 700, 2]]) {
        window.setContentSize(width, height); window.webContents.setZoomFactor(zoom)
        for (const kind of ['feishu', 'dingtalk']) {
          await updateChannel(kind, { connection: { status: 'connected', account: {
            ...savedAccount, accountId: `sample-${kind}`, brand: kind,
            userName: zoom === 2 ? 'Murray / 渠道开发与应用发布负责人' : savedAccount.userName,
            email: zoom === 2 ? 'developer-account-with-a-long-name@example.com' : 'murray@example.com',
            tenantName: zoom === 2 ? 'Rovai 智能协作与开放平台应用研发工作室' : savedAccount.tenantName
          } } })
          await click(`.channel-provider-tab:has(.channel-mark-${kind})`)
          const alignment = await run(`(() => {
            const button = document.querySelector('.channel-connection-trigger')
            const label = button.querySelector('span').getBoundingClientRect()
            const icon = button.querySelector('svg').getBoundingClientRect()
            return { delta: Math.abs(label.y + label.height / 2 - icon.y - icon.height / 2), gap: icon.x - label.right, iconWidth: icon.width }
          })()`)
          assert.ok(alignment.delta < .1 && Math.abs(alignment.gap - 6) < .1 && alignment.iconWidth === 16, JSON.stringify(alignment))
          assert.ok(await run(`(() => {
            const row = document.querySelector('.channel-connection-row'), bounds = row.getBoundingClientRect()
            return row.scrollWidth <= row.clientWidth + 1 && [...row.querySelectorAll('strong, small, button, .channel-connection-status')]
              .every(node => node.scrollWidth <= node.clientWidth + 1 && node.getBoundingClientRect().right <= Math.min(innerWidth, bounds.right) + 1)
          })()`), `connection row fits ${kind}/${theme}/${width}/${zoom}`)
          // At 520 CSS px, the existing Bot table owns a separate overflow limitation.
          if (width / zoom >= 720) await noOverflow(`${kind}/${theme}/${width}/${zoom}`)
          await click(trigger)
          await waitFor("getComputedStyle(document.querySelector('.channel-connection-trigger svg')).transform === 'matrix(-1, 0, 0, -1, 0, 0)'")
          assert.ok(await run(`(() => {
            const menu = document.querySelector('.channel-connection-menu').getBoundingClientRect()
            return menu.left >= 0 && menu.right <= innerWidth && menu.top >= 0 && menu.bottom <= innerHeight
          })()`), 'menu stays inside the viewport')
          await capture(`connection-${kind}-${theme}-${width}-${zoom}`)
          await key('Escape')
        }
      }
    }
    await run("document.documentElement.dataset.motionPreference='reduce'")
    await click(trigger)
    assert.equal(await run("getComputedStyle(document.querySelector('.channel-connection-trigger svg')).transitionDuration"), '0s')
    await key('Escape')
    await run("delete document.documentElement.dataset.motionPreference")
    await run(`window.settingsTest.state.channels.channels.forEach(channel => window.settingsTest.updateChannel(channel.kind, {
      connection: { status: 'connected', account: { ...${JSON.stringify(savedAccount)}, accountId: 'sample-' + channel.kind, brand: channel.kind } }
    }))`)

    for (const theme of ['day', 'night']) {
      await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
      window.setContentSize(1040, 700); window.webContents.setZoomFactor(1)
      for (const page of ['general','remote','appearance','notifications','runtime','channels','monitoring','diagnostics','about']) {
        await navigate(page); await noOverflow(`${page}/${theme}/1040`); await capture(`${page}-${theme}-1040`)
        if (page === 'monitoring') {
          await selectMonitoringRange('30d'); await costHistoryFits(`${page}/30d/${theme}/1040`)
          await capture(`${page}-30d-${theme}-1040`)
        }
      }
      for (const page of ['general','monitoring','diagnostics','about']) {
        window.webContents.setZoomFactor(2); await navigate(page)
        await noOverflow(`${page}/${theme}/200%`)
        if(page === 'monitoring') {
          await selectMonitoringRange('30d'); await costHistoryFits(`${page}/30d/${theme}/200%`)
          assert.equal(await run("getComputedStyle(document.querySelector('.monitoring-keyline')).gridTemplateColumns.split(' ').length"), 1)
          await run("document.querySelector('.monitoring-keyline').scrollIntoView()"); await settle()
        }
        await capture(`${page}-${theme}-200`)
      }
    }
    console.log(JSON.stringify({ ok: true }))
    app.exit(0)
  } catch (error) {
    console.error(error)
    await capture('failure')
    console.error(error); app.exit(1)
  }
})
