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
    const beforeTerminal = (await requests()).length
    await run('window.fastTest.metricsTerminal()')
    await run('window.fastTest.settle()')
    if (await run('document.querySelector(".execution-history-toggle")?.getAttribute("aria-expanded") === "false"')) {
      await click('.execution-history-toggle')
    }
    await waitFor(`window.fastTest.metricsRequests().slice(${beforeTerminal}).some(request => request.params.agentRunIds.includes('run-agent-0') && request.params.agentRunIds.includes('metric-history-0'))`, 'Terminal history visibility did not refresh before measuring stable reads')
    await wait(4_500) // The finite terminal tail has completed.
    const beforeStable = (await requests()).length
    await wait(10_500)
    assert.equal((await requests()).length, beforeStable, 'Stable terminal data still polled')
    assert.ok(await run('!!document.querySelector("[data-agent-run-id=run-agent-0] .execution-duration-trigger")'))
    await run('window.fastTest.metricsCommit(1000, 2, false, 55000)')
    await waitFor('document.querySelector("[data-agent-run-id=run-agent-0] .execution-usage-trigger")?.textContent === "55K"', 'Core projection was gated by partial quality or replaced with raw buckets')
    assert.equal(await run('document.querySelector(".execution-context-value")?.textContent'), '32.0%')
    for (const status of ['running', 'waiting']) {
      await run(`window.fastTest.metricsStatus('${status}')`)
      await waitFor('!!document.querySelector("[data-agent-run-id=run-agent-0] .execution-run-metric") && !document.querySelector("[data-agent-run-id=run-agent-0] .execution-usage-trigger")', `${status}: Known usage replaced elapsed time`)
      assert.match(await run('document.querySelector("[data-agent-run-id=run-agent-0] .execution-run-metric")?.textContent'), /^\d+(?:时 \d+分|分 \d{2}秒)$/)
      assert.equal(await run('!!document.querySelector("[data-agent-run-id=run-agent-0] .execution-duration-trigger")'), false, `${status}: Live elapsed time became a clock button`)
    }
    for (const status of ['failed', 'cancelled', 'succeeded']) {
      await run(`window.fastTest.metricsStatus('${status}')`)
      await run('window.fastTest.settle()')
      if (await run('document.querySelector(".execution-history-toggle")?.getAttribute("aria-expanded") === "false"')) {
        await click('.execution-history-toggle')
      }
      await waitFor('document.querySelector("[data-agent-run-id=run-agent-0] .execution-usage-trigger")?.textContent === "55K"', `Missing known terminal usage for ${status}`)
      assert.equal(await run('!!document.querySelector("[data-agent-run-id=run-agent-0] .execution-duration-trigger")'), false, `${status}: Known usage must replace the clock`)
    }
    await wait(4_500) // Let the status-change terminal tail settle before measuring a detail click.
    const usageNode = await run(`(() => {
      const value = document.querySelector('[data-agent-run-id="run-agent-0"] .execution-usage-trigger')
      return { tag: value.tagName, clock: Boolean(value.parentElement.querySelector('.execution-duration-trigger')) }
    })()`)
    assert.deepEqual(usageNode, { tag: 'BUTTON', clock: false }, 'Known usage must retain the original clickable entry without a clock')
    const beforeDetails = (await requests()).length
    await click('[data-agent-run-id="run-agent-0"] .execution-usage-trigger')
    const usageRows = await run(`[...document.querySelectorAll('.execution-metric-popover dl > div')]
      .map(row => [row.querySelector('dt')?.textContent, row.querySelector('dd')?.textContent])`)
    assert.deepEqual(usageRows.slice(0, 4), [
      ['Input Token', '1k'], ['Output Token', '0k'], ['Cache Read', '—'], ['Cache Write', '0k']
    ], 'The original details must preserve reported values, zero and unknown')
    assert.equal(usageRows[4]?.[0], '执行耗时')
    assert.match(usageRows[4]?.[1], /分 \d{2}秒$/)
    assert.equal((await requests()).length, beforeDetails, 'Opening details issued an extra usage query')
    assert.equal(await run('document.querySelector(".execution-metric-popover")?.textContent.match(/部分|完整|≥|≈/)'), null)
    await click('[data-agent-run-id="run-agent-0"] .execution-usage-trigger')
    await run('window.fastTest.metricsCommit(1000, 2, false, 0)')
    await waitFor('document.querySelector("[data-agent-run-id=run-agent-0] .execution-usage-trigger")?.textContent === "0K"', 'Explicit zero was hidden')
    await run('window.fastTest.metricsCommit(1000, 2, false, null)')
    await waitFor('!document.querySelector("[data-agent-run-id=run-agent-0] .execution-usage-trigger")', 'Unknown projection fell back to raw Input/Output')
    assert.ok(await run('!!document.querySelector("[data-agent-run-id=run-agent-0] .execution-duration-trigger")'))
    await run('window.fastTest.metricsCommit(1000, 2, false, 55000)')
    await waitFor('document.querySelector("[data-agent-run-id=run-agent-0] .execution-usage-trigger")?.textContent === "55K"', 'Late projection did not update')
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
      assert.equal(await run('!!document.querySelector("[data-agent-run-id=run-agent-0] .execution-duration-trigger")'), false, `${theme}: Clock appeared beside known usage`)
      await click('[data-agent-run-id="run-agent-0"] .execution-usage-trigger')
      assert.equal(await run('document.querySelectorAll(".execution-metric-popover dl > div").length'), 5, `${theme}: Original usage details were missing`)
      writeFileSync(join(dirname(userData), `metrics-${theme}.png`), (await window.webContents.capturePage()).toPNG())
      await click('[data-agent-run-id="run-agent-0"] .execution-usage-trigger')
    }
    assert.equal(themeTokens.size, 5, 'Registered palettes did not all apply their production tokens')
    assert.ok((await requests()).every(request => request.method === 'monitoring.execution'), 'Unexpected metrics polling')
    assert.equal(await run('document.querySelectorAll(".execution-header-metrics > *").length'), 1, 'Header must contain only the Context entry')
    const report = { ok: true, cases: ['visible collapsed history', '500 Run scoped reads', 'scroll and expansion',
      'hidden panel and page', 'immediate visibility refresh', 'stable terminal', 'late post-tail Usage', 'Core projection independent of raw buckets and quality', 'live elapsed time despite known usage', 'terminal failure/cancelled/success totals', 'explicit zero and unknown', 'usage/clock priority and original details without extra reads', 'Session replacement/removal'],
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
