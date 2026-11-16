const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { isAbsolute, dirname, join } = require('node:path')
const { app, BrowserWindow } = require('electron')
const [renderer, userData] = process.argv.slice(2)
assert.ok(isAbsolute(renderer) && isAbsolute(userData))
mkdirSync(join(userData, 'managed-skill-library'), { recursive: true })
app.setPath('userData', userData)
app.setPath('sessionData', join(userData, 'session'))

app.whenReady().then(async () => {
  // Keep panel visibility independent of unrelated desktop windows. Explicit
  // window.hide()/show() below still exercises the real page visibility gate.
  const window = new BrowserWindow({ show: true, alwaysOnTop: true, width: 1280, height: 720, useContentSize: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } })
  window.webContents.on('console-message', event => console.error(event.message))
  const run = code => window.webContents.executeJavaScript(code, true)
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const requests = () => run('window.fastTest.metricsRequests()')
  const waitFor = async (code, label) => {
    for (let i = 0; i < 100; i++) { if (await run(code)) return; await wait(50) }
    throw new Error(label)
  }
  const click = async selector => {
    await run(`document.querySelector(${JSON.stringify(selector)}).click()`)
    await run('window.fastTest.settle()')
    await wait(150)
  }
  try {
    await window.loadFile(renderer)
    app.focus({ steal: true })
    window.focus()
    await run('window.fastTest.showMetrics()')
    await run('window.fastTest.settle()')
    await click('.run-pulse-chip[data-agent-id="agent-0"]')
    await waitFor('document.querySelector(".execution-context-value")?.textContent === "25.0%"', 'Current Session ratio was not loaded')
    let reads = (await requests()).filter(request => request.method === 'monitoring.execution')
    assert.ok(reads.every(request => request.params.agentRunIds.length < 20), 'Initial reads queried hidden historical Runs')

    // A mounted but hidden panel must stop persisted metrics reads.
    await run('document.querySelector(".execution-drawer").style.display = "none"')
    await wait(250)
    const hiddenPanelReads = (await requests()).length
    await wait(4_500)
    assert.equal((await requests()).length, hiddenPanelReads, 'Hidden panel continued UI requests')
    await run('document.querySelector(".execution-drawer").style.display = ""')
    await waitFor(`window.fastTest.metricsRequests().length > ${hiddenPanelReads}`, 'Panel reopening did not immediately refresh')
    window.hide()
    await waitFor('document.hidden', 'Electron did not hide the page')
    await wait(250)
    const hiddenPageReads = (await requests()).length
    await wait(4_500)
    assert.equal((await requests()).length, hiddenPageReads, 'Hidden page continued UI requests')
    window.show()
    await waitFor('!document.hidden', 'Electron did not restore page visibility')
    await waitFor(`window.fastTest.metricsRequests().length > ${hiddenPageReads}`, 'Page restoration did not refresh')

    await click('.execution-history-toggle')
    await waitFor('window.fastTest.metricsRequests().some(r => r.method === "monitoring.execution" && r.params.agentRunIds.some(id => id.startsWith("metric-history-")))', 'Visible collapsed history never received token data')
    reads = (await requests()).filter(request => request.method === 'monitoring.execution')
    assert.ok(reads.every(request => request.params.agentRunIds.length < 20), 'Opening history fetched all 500 Runs')
    const beforeScroll = reads.length
    await run('document.querySelector(".execution-drawer-body").scrollTop = 10000')
    await waitFor(`window.fastTest.metricsRequests().filter(r => r.method === "monitoring.execution").length > ${beforeScroll}`, 'Newly visible history did not refresh')
    const target = await run(`(() => {
      const body = document.querySelector('.execution-drawer-body').getBoundingClientRect()
      return [...document.querySelectorAll('.execution-process-stage[data-agent-run-id]')].find(node => {
        const rect = node.getBoundingClientRect(); return rect.top >= body.top && rect.top < body.bottom - 30
      })?.dataset.agentRunId
    })()`)
    assert.ok(target && target.startsWith('metric-history-'))
    const beforeExpand = (await requests()).filter(request => request.method === 'monitoring.execution').length
    await click(`[data-agent-run-id="${target}"] .execution-run-toggle`)
    await waitFor(`window.fastTest.metricsRequests().filter(r => r.method === "monitoring.execution").length > ${beforeExpand}`, 'Cached Run expansion did not refresh on demand')

    await run('document.querySelector(".execution-drawer-body").scrollTop = 0')
    await run('window.fastTest.metricsTerminal()')
    await run('window.fastTest.settle()')
    if (await run('document.querySelector(".execution-history-toggle")?.getAttribute("aria-expanded") === "false"')) {
      await click('.execution-history-toggle')
    }
    await wait(4_500) // The finite terminal tail has completed.
    const beforeStable = (await requests()).length
    await wait(10_500)
    assert.equal((await requests()).length, beforeStable, 'Stable terminal data still polled')
    assert.ok(await run('!!document.querySelector("[data-agent-run-id=run-agent-0] .execution-duration-trigger")'))
    await run('window.fastTest.metricsCommit(1000, 2, false, 55000)')
    await waitFor('document.querySelector("[data-agent-run-id=run-agent-0] .execution-usage-value")?.textContent === "55K"', 'Core projection was gated by partial quality or replaced with raw buckets')
    assert.equal(await run('document.querySelector(".execution-context-value")?.textContent'), '32.0%')
    for (const status of ['running', 'waiting', 'failed', 'cancelled', 'succeeded']) {
      await run(`window.fastTest.metricsStatus('${status}')`)
      await waitFor('document.querySelector("[data-agent-run-id=run-agent-0] .execution-usage-value")?.textContent === "55K"', `Missing known usage for ${status}`)
      if (status === 'running') {
        const point = await run(`(() => {
          const rect = document.querySelector('[data-agent-run-id="run-agent-0"] .execution-duration-trigger').getBoundingClientRect()
          return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }
        })()`)
        window.webContents.sendInputEvent({ type: 'mouseMove', ...point })
        await wait(100)
        window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
        window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
        await waitFor('!!document.querySelector(".execution-duration-reading")', 'Live clock was covered by Run operations')
        await click('[data-agent-run-id="run-agent-0"] .execution-duration-trigger')
      }
    }
    const usageNode = await run(`(() => {
      const value = document.querySelector('[data-agent-run-id="run-agent-0"] .execution-usage-value')
      return { tag: value.tagName, interactive: Boolean(value.closest('button, a, [role="button"]')) || value.tabIndex >= 0,
        clock: Boolean(value.parentElement.querySelector('.execution-duration-trigger')) }
    })()`)
    assert.deepEqual(usageNode, { tag: 'SPAN', interactive: false, clock: true }, 'Token total must be read-only beside an independent clock')
    await click('[data-agent-run-id="run-agent-0"] .execution-usage-value')
    assert.equal(await run('document.querySelector(".execution-duration-reading")'), null, 'Clicking Token text opened elapsed time')
    await click('[data-agent-run-id="run-agent-0"] .execution-duration-trigger')
    assert.ok(await run('!!document.querySelector(".execution-duration-reading")'))
    assert.equal(await run('document.querySelector(".execution-metric-popover")?.textContent.match(/Input|Output|Cache|部分|完整|≥|≈|55K/)'), null)
    await click('[data-agent-run-id="run-agent-0"] .execution-duration-trigger')
    await run('window.fastTest.metricsCommit(1000, 2, false, 0)')
    await waitFor('document.querySelector("[data-agent-run-id=run-agent-0] .execution-usage-value")?.textContent === "0K"', 'Explicit zero was hidden')
    await run('window.fastTest.metricsCommit(1000, 2, false, null)')
    await waitFor('!document.querySelector("[data-agent-run-id=run-agent-0] .execution-usage-value")', 'Unknown projection fell back to raw Input/Output')
    assert.ok(await run('!!document.querySelector("[data-agent-run-id=run-agent-0] .execution-duration-trigger")'))
    await run('window.fastTest.metricsCommit(1000, 2, false, 55000)')
    await waitFor('document.querySelector("[data-agent-run-id=run-agent-0] .execution-usage-value")?.textContent === "55K"', 'Late projection did not update')
    await run('window.fastTest.metricsRemoveContext()')
    await waitFor('document.querySelector(".execution-context-value")?.textContent === "—"', 'Invalid current Session Context was retained')
    assert.equal(await run('document.documentElement.scrollWidth > innerWidth'), false)
    const themeTokens = new Set()
    for (const theme of ['day', 'night', 'horizon', 'classic-red', 'ember']) {
      await run(`document.documentElement.dataset.themeId = '${theme}';
        document.documentElement.dataset.theme = '${['night', 'ember'].includes(theme) ? 'night' : 'day'}';
        document.documentElement.style.colorScheme = '${['night', 'ember'].includes(theme) ? 'dark' : 'light'}'`)
      await run('window.fastTest.settle()')
      themeTokens.add(await run(`(() => {
        const style = getComputedStyle(document.documentElement)
        return ['--canvas', '--ink', '--conversation-action'].map(name => style.getPropertyValue(name).trim()).join('|')
      })()`))
      await click('[data-agent-run-id="run-agent-0"] .execution-usage-value')
      assert.equal(await run('document.querySelector(".execution-duration-reading")'), null, `${theme}: Token text opened a duration popover`)
      await click('[data-agent-run-id="run-agent-0"] .execution-duration-trigger')
      assert.ok(await run('!!document.querySelector(".execution-duration-reading")'), `${theme}: Clock did not open duration`)
      writeFileSync(join(dirname(userData), `metrics-${theme}.png`), (await window.webContents.capturePage()).toPNG())
      await click('[data-agent-run-id="run-agent-0"] .execution-duration-trigger')
    }
    assert.equal(themeTokens.size, 5, 'Registered palettes did not all apply their production tokens')
    assert.ok((await requests()).every(request => request.method === 'monitoring.execution'), 'Unexpected metrics polling')
    assert.equal(await run('document.querySelectorAll(".execution-header-metrics > *").length'), 1, 'Header must contain only the Context entry')
    const report = { ok: true, cases: ['visible collapsed history', '500 Run scoped reads', 'scroll and expansion',
      'hidden panel and page', 'immediate visibility refresh', 'stable terminal', 'late post-tail Usage', 'Core projection independent of raw buckets and quality', 'running/failure/cancelled totals', 'explicit zero and unknown', 'read-only Token text and independent duration button', 'Session replacement/removal'],
      maximumRequestedRuns: Math.max(...(await requests()).filter(request => request.method === 'monitoring.execution').map(request => request.params.agentRunIds.length)) }
    writeFileSync(join(dirname(userData), 'metrics-report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
    window.destroy()
    app.exit(0)
  } catch (error) {
    console.error(error.stack)
    console.error(JSON.stringify({ visible: window.isVisible(), focused: window.isFocused(), page: await run(`({
      hidden: document.hidden, visibility: document.visibilityState,
      panel: document.querySelector('.execution-drawer')?.getBoundingClientRect().toJSON(),
      panelDisplay: document.querySelector('.execution-drawer') && getComputedStyle(document.querySelector('.execution-drawer')).display,
      detailHidden: document.querySelector('.camp-detail-popover')?.hidden
    })`) }))
    console.error(JSON.stringify((await requests()).slice(-10)))
    writeFileSync(join(dirname(userData), 'metrics-failure.png'), (await window.webContents.capturePage()).toPNG())
    app.exit(1)
  }
}).catch(error => { console.error(error.stack); app.exit(1) })
