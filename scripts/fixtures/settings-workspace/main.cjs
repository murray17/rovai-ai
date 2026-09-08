const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { isAbsolute, join, dirname } = require('node:path')
const { app, BrowserWindow } = require('electron')
const [renderer, userData] = process.argv.slice(2)
assert.ok(isAbsolute(renderer) && isAbsolute(userData))
mkdirSync(userData, { recursive: true })
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
  try {
    await window.loadFile(renderer); await settle()
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

    await navigate('appearance')
    assert.deepEqual(await run("[...document.querySelector('#appearance-zoom').options].map(o=>Number(o.value))"), [80,90,100,110,125,150,175,200])
    assert.equal(await run("document.querySelectorAll('.motion-example').length"), 0)
    await run('window.settingsTest.resetZoom(250)'); await settle()
    assert.equal(await run("document.querySelector('#appearance-zoom').value"), '250')
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

    for (const theme of ['day', 'night']) {
      await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
      window.setContentSize(1040, 700); window.webContents.setZoomFactor(1)
      for (const page of ['general','appearance','notifications','runtime','channels','monitoring','diagnostics','about']) {
        await navigate(page); await noOverflow(`${page}/${theme}/1040`); await capture(`${page}-${theme}-1040`)
      }
      for (const page of ['general','monitoring','diagnostics','about']) {
        window.webContents.setZoomFactor(2); await navigate(page)
        await noOverflow(`${page}/${theme}/200%`)
        if(page === 'monitoring') {
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
