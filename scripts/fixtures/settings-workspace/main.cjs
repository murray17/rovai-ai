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
  const window = new BrowserWindow({ show: process.platform === 'linux', width: 1440, height: 920, useContentSize: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } })
  window.webContents.on('console-message', event => console.error(event.message))
  const run = code => window.webContents.executeJavaScript(code, true)
  const settle = () => run('window.settingsTest.settle()')
  const waitFor = async expression => {
    for(let attempt=0;attempt<40;attempt++){
      if(await run(expression)) return
      await new Promise(resolve=>setTimeout(resolve,50))
    }
    throw Error('UI did not settle: '+expression)
  }
  const navigate = async (page, scenario = 'normal') => {
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
  const capture = async name => writeFileSync(join(dirname(userData), `${name}.png`), (await window.webContents.capturePage()).toPNG())
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
    await window.loadFile(renderer); await settle()
    // Keep native DOM focus events available without depending on the active desktop window.
    window.webContents.debugger.attach('1.3')
    await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
    assert.equal(await run("document.querySelectorAll('.general-save-row .dialog-glyph').length"), 1)
    assert.equal(await run("document.querySelectorAll('.general-save-state').length"), 0)
    await click('.general-default-member-picker > summary')
    assert.equal(await run("document.querySelectorAll('.general-default-member').length"), 24)
    assert.ok(await run("document.querySelector('.general-default-member-list').clientHeight <= 280"))
    await capture('general-many-day')
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
    await click('.remote-start-row .primary-button')
    await run('window.settingsTest.releaseHostStatus()'); await settle()
    assert.equal(await run("document.querySelector('#remote-token').type"), 'password')
    assert.equal(await run("document.querySelector('#remote-token').value"), 'fixture-token-1')
    assert.ok(await run("document.querySelector('.remote-state').textContent.includes('已开启')"), 'late status must not undo start')
    await capture('host-web-enabled-day')
    await click('.remote-section-heading button'); await click('[role=dialog] .primary-button')
    assert.equal(await run("document.querySelector('#remote-token').value"), 'fixture-token-2')
    await click('[aria-label="开启浏览器访问"]'); await click('[role=dialog] .primary-button')
    assert.equal(await run("document.querySelectorAll('#remote-token').length"), 0)
    await run('window.settingsTest.state.loseHostStartReply = true')
    await click('.remote-start-row .primary-button')
    assert.ok(await run("document.querySelector('.remote-state').textContent.includes('已开启')"))
    assert.equal(await run("window.settingsTest.requests.filter(r => r.method === 'hostWeb.start').length"), 2, 'unknown reply must query status without repeating start')
    await navigate('general'); await navigate('remote')
    assert.equal(await run("document.querySelector('#remote-token').value"), 'fixture-token-2', 'remount rereads the current Host credential without rotating')
    await click('[aria-label="开启浏览器访问"]'); await click('[role=dialog] .primary-button')

    await navigate('appearance')
    assert.deepEqual(await run("[...document.querySelector('#appearance-zoom').options].map(o=>Number(o.value))"), [25,33,50,67,75,80,90,100,110,125,150,175,200,250,300,400,500])
    assert.equal(await run("document.querySelectorAll('.motion-example').length"), 0)
    await run('window.settingsTest.resetZoom(121)'); await settle()
    assert.equal(await run("document.querySelector('#appearance-zoom').value"), '121')
    await navigate('notifications')
    assert.equal(await run("document.querySelectorAll('input[role=switch]').length"), 5)

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
      const connected = { status: 'connected', account }
      const tab = `.channel-provider-tab:has(.channel-mark-${kind})`
      await updateChannel(kind, { connection: connected })
      await click(tab)
      assert.equal(await run("document.querySelectorAll('.channel-connection-actions button').length"), 1)
      assert.equal(await run("document.querySelector('.channel-account-heading .channel-connection-status').textContent"), '已连接')
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
      assert.equal(await run("document.querySelector('.channel-account-heading .channel-connection-status').textContent"), '已连接')
      assert.equal(await run("document.querySelector('.channel-settings [role=alert]')"), null)

      await click(trigger); await click(`${menu} [role=menuitem]:first-child`)
      await waitFor("document.querySelector('.channel-qr-dialog') !== null")
      await finishChannelAction(`${kind}_connection_error`)
      assert.equal(await run("document.querySelector('.channel-account-heading strong').textContent"), savedAccount.userName)
      assert.equal(await run("document.querySelector('.channel-connection-status').textContent"), '已连接')
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
      assert.equal(await run("document.querySelector('.channel-connection-status').textContent"), '已连接')
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
      assert.equal(await run("document.querySelector('.channel-connection-status').textContent"), '已连接')
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
    await capture('failure')
    console.error(error); app.exit(1)
  }
})
