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
    await wait(4_500) // The finite terminal tail has completed.
    const beforeStable = (await requests()).length
    await wait(10_500)
    assert.equal((await requests()).length, beforeStable, 'Stable terminal data still polled')
    assert.ok(await run('!!document.querySelector("[data-agent-run-id=run-agent-0] .execution-duration-trigger")'))
    await run('window.fastTest.metricsCommit(1000, 2, false)')
    await waitFor('document.querySelector("[data-agent-run-id=run-agent-0] .execution-usage-trigger")?.textContent === "—"', 'Partial Input/Output was shown as a complete total')
    // Unchanged numbers with new completeness evidence must refresh this row.
    await run('window.fastTest.metricsCommit(1000, 2)')
    await waitFor('document.querySelector("[data-agent-run-id=run-agent-0] .execution-usage-trigger")?.textContent === "1k"', 'Usage landing after terminal/tail did not replace the clock')
    assert.equal(await run('document.querySelector(".execution-context-value")?.textContent'), '32.0%')
    await click('[data-agent-run-id="run-agent-0"] .execution-usage-trigger')
    assert.equal(await run('document.querySelectorAll(".execution-metric-popover dl > div").length'), 5)
    assert.ok(await run('document.querySelector(".execution-metric-popover")?.textContent.includes("执行耗时")'))
    await click('[data-agent-run-id="run-agent-0"] .execution-usage-trigger')
    await run('window.fastTest.metricsRemoveContext()')
    await waitFor('document.querySelector(".execution-context-value")?.textContent === "—"', 'Invalid current Session Context was retained')
    assert.equal(await run('document.documentElement.scrollWidth > innerWidth'), false)
    for (const theme of ['day', 'night']) {
      await run(`document.documentElement.dataset.theme = '${theme}'`)
      await run('window.fastTest.settle()')
      writeFileSync(join(dirname(userData), `metrics-${theme}.png`), (await window.webContents.capturePage()).toPNG())
    }
    assert.ok((await requests()).every(request => request.method === 'monitoring.execution'), 'Unexpected metrics polling')
    assert.equal(await run('document.querySelectorAll(".execution-header-metrics > *").length'), 1, 'Header must contain only the Context entry')
    const report = { ok: true, cases: ['visible collapsed history', '500 Run scoped reads', 'scroll and expansion',
      'hidden panel and page', 'immediate visibility refresh', 'stable terminal', 'late post-tail Usage', 'partial total and completeness-only refresh', 'Session replacement/removal'],
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
