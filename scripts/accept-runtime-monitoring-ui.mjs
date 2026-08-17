import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { seedCompletedOnboardingForAcceptance } from './lib/dev-desktop.mjs'

const root = resolve(import.meta.dirname, '..')
const appPath = resolve(process.argv[2] ?? join(root, 'dist', 'mac-arm64', 'Rovai-ai.app'))
const fixtureRoot = process.env.ROVAI_MONITORING_ACCEPT_FIXTURE_ROOT
  ?? await mkdtemp(join(tmpdir(), 'rovai-monitoring-ui-accept-'))
const dataDir = join(fixtureRoot, 'user-data')
const homeDir = join(fixtureRoot, 'home')
const outputDir = process.env.ROVAI_MONITORING_ACCEPT_OUTPUT_DIR
  ?? await mkdtemp(join(tmpdir(), 'rovai-monitoring-ui-captures-'))
const port = Number(process.env.ROVAI_MONITORING_ACCEPT_DEBUG_PORT ?? 9501)

await mkdir(dataDir, { recursive: true })
await mkdir(homeDir, { recursive: true })
await mkdir(outputDir, { recursive: true })
seedCompletedOnboardingForAcceptance(dataDir)

let isolatedApp = null
try {
  isolatedApp = await launchApp(1440, 920)
  await setTheme(isolatedApp.cdp, 'day')
  await openMonitoring(isolatedApp.cdp)
  await assertEmptyMonitoring(isolatedApp.cdp, 'day desktop')
  const dayCapture = join(outputDir, 'runtime-monitoring-empty-day-1440x920.png')
  await capture(isolatedApp.cdp, dayCapture)

  for (const label of ['用量与成本', '性能与可靠性', '概览']) {
    await clickButton(isolatedApp.cdp, '.monitoring-tabs button', label)
    await waitForExpression(isolatedApp.cdp, '!document.querySelector(\'.monitoring-loading\')')
  }

  await isolatedApp.cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1040,
    height: 700,
    deviceScaleFactor: 1,
    mobile: false
  })
  await isolatedApp.cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  })
  await setTheme(isolatedApp.cdp, 'night')
  await assertEmptyMonitoring(isolatedApp.cdp, 'night compact')
  const nightCapture = join(outputDir, 'runtime-monitoring-empty-night-1040x700.png')
  await capture(isolatedApp.cdp, nightCapture)

  await isolatedApp.cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 720,
    height: 460,
    deviceScaleFactor: 1,
    mobile: false
  })
  await wait(150)
  await assertNoHorizontalOverflow(isolatedApp.cdp, '1440x920 at 200% layout equivalent')

  const filter = { range: '24h' }
  const snapshot = await request(isolatedApp.cdp, 'monitoring.snapshot', filter)
  const { summary, usage, reliability } = snapshot
  assert(snapshot?.schemaVersion === 1, 'Snapshot did not return schemaVersion 1')
  assert(snapshot?.collection?.collectionEpoch, 'Snapshot omitted collectionEpoch')
  for (const [name, view] of Object.entries({ summary, usage, reliability })) {
    assert(view?.schemaVersion === 1, name + ' did not return schemaVersion 1')
    assert(view?.collection?.schemaVersion === 1, name + ' omitted its collection boundary')
    assert(view?.collection?.collectionEpoch, name + ' omitted collectionEpoch')
  }
  assert(summary.runs.value === null && summary.runs.eligibleCount === 0,
    'clean-break Summary manufactured historical Runs')
  assert(usage.inputTokens.value === null,
    'clean-break Usage manufactured Token data')
  assert(reliability.endToEndP95Millis.value === null,
    'clean-break Reliability manufactured latency')

  console.log(JSON.stringify({
    ok: true,
    app: basename(appPath),
    fixtureRoot,
    outputDir,
    verified: {
      isolatedPackagedApplication: true,
      rendererToCoreMonitoring: true,
      cleanBreakEmptyState: true,
      noHistoricalBackfill: true,
      threeTabsAndPersistentFilters: true,
      dayAndNightLayouts: true,
      compactReducedMotionLayout: true,
      twoHundredPercentLayout: true,
      horizontalOverflow: false
    },
    captures: { day: dayCapture, night: nightCapture }
  }, null, 2))
} finally {
  if (isolatedApp) await closeApp(isolatedApp)
}

async function openMonitoring(cdp) {
  const opened = await evaluate(cdp, "(() => { const button = document.querySelector('.unified-sidebar-footer button[aria-label=\"设置\"]'); button?.click(); return Boolean(button) })()")
  assert(opened, 'Could not open Settings')
  await waitForSelector(cdp, '.settings-sidebar-menu')
  const selected = await evaluate(cdp, "(() => { const button = [...document.querySelectorAll('.settings-sidebar-menu button')].find((candidate) => candidate.textContent?.includes('运行监控')); button?.click(); return Boolean(button) })()")
  assert(selected, 'Runtime Monitoring Settings entry was unavailable')
  await waitForSelector(cdp, '.runtime-monitoring')
  await waitForSelector(cdp, '.monitoring-state.is-empty', 20_000)
}

async function assertEmptyMonitoring(cdp, context) {
  const state = await evaluate(cdp, "({ heading: document.querySelector('.runtime-monitoring h1')?.textContent ?? '', description: document.querySelector('.runtime-monitoring .settings-page-heading-copy > p:last-child')?.textContent ?? '', hasBoundaryNotice: Boolean(document.querySelector('.monitoring-boundary-note')), empty: document.querySelector('.monitoring-state.is-empty')?.textContent ?? '', tabs: [...document.querySelectorAll('.monitoring-tabs button')].map((button) => button.textContent?.trim()), filters: document.querySelectorAll('.monitoring-filters select').length, exportLabel: [...document.querySelectorAll('.settings-page-heading button')].some((button) => button.textContent?.includes('导出 JSON')), documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 1, surfaceOverflow: (() => { const node = document.querySelector('.runtime-monitoring'); return node ? node.scrollWidth > node.clientWidth + 1 : true })() })")
  assert(state.heading === '运行监控', context + ' omitted its heading')
  assert(state.description === '查看 AgentRun 的状态、用量、成本与可靠性。',
    context + ' did not use the concise page description')
  assert(!state.hasBoundaryNotice, context + ' retained the collection boundary notice')
  assert(state.empty.includes('暂无运行数据') && state.empty.includes('当前范围内暂无 AgentRun。'),
    context + ' did not render the real empty state')
  assert(!/(Clean break|历史 Run 不补算|当前采集边界|采集从)/.test(state.description + state.empty),
    context + ' retained redundant cutover copy')
  assert(JSON.stringify(state.tabs) === JSON.stringify(['概览', '用量与成本', '性能与可靠性']),
    context + ' tabs were incomplete: ' + JSON.stringify(state.tabs))
  assert(state.filters === 4, context + ' did not render all persistent filters')
  assert(state.exportLabel, context + ' omitted explicit JSON export')
  assert(!state.documentOverflow && !state.surfaceOverflow,
    context + ' overflowed horizontally: ' + JSON.stringify(state))
}

async function assertNoHorizontalOverflow(cdp, context) {
  const state = await evaluate(cdp, "({ documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 1, surfaceOverflow: (() => { const node = document.querySelector('.runtime-monitoring'); return node ? node.scrollWidth > node.clientWidth + 1 : true })() })")
  assert(!state.documentOverflow && !state.surfaceOverflow,
    context + ' overflowed horizontally: ' + JSON.stringify(state))
}

async function clickButton(cdp, selector, label) {
  const expression = "(() => { const button = [...document.querySelectorAll(" + JSON.stringify(selector) + ")].find((candidate) => candidate.textContent?.trim() === " + JSON.stringify(label) + "); if (!button || button.disabled) return false; button.click(); return true })()"
  assert(await evaluate(cdp, expression), 'Could not click ' + label)
}

async function request(cdp, method, params = {}) {
  return evaluate(cdp, 'window.rovai.request(' + JSON.stringify(method) + ', ' + JSON.stringify(params) + ')', true)
}

async function setTheme(cdp, preference) {
  await evaluate(cdp, 'window.rovai.appearance.setPreference(' + JSON.stringify(preference) + ')', true)
  const expected = preference === 'night' ? 'night' : 'day'
  await waitForExpression(cdp, 'document.documentElement.dataset.theme === ' + JSON.stringify(expected))
}

async function launchApp(width, height) {
  const executable = join(appPath, 'Contents', 'MacOS', 'Rovai-ai')
  const stderr = []
  const child = spawn(executable, [
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + dataDir
  ], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      HOME: homeDir,
      ROVAI_ALLOW_ISOLATED_INSTANCE: '1'
    }
  })
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
  let cdp = null
  try {
    const target = await waitForTarget(stderr)
    cdp = await connectCdp(target.webSocketDebuggerUrl)
    await cdp.send('Page.enable')
    await cdp.send('Page.bringToFront')
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false
    })
    await waitForExpression(cdp, "Boolean(window.rovai && document.querySelector('.app-shell'))", 45_000)
    const health = await request(cdp, 'health.check')
    assert(await realpath(health.database.path) === await realpath(join(dataDir, 'rovai.sqlite')),
      'isolated Application opened the wrong database')
    return { cdp, child }
  } catch (error) {
    cdp?.close()
    await terminateChild(child)
    throw error
  }
}

async function closeApp(app) {
  try {
    await Promise.race([app.cdp.send('Browser.close'), wait(1_000)])
  } catch {
    // The isolated Application may already have exited.
  }
  app.cdp.close()
  await terminateChild(app.child)
}

async function terminateChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    wait(3_000)
  ])
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
}

async function capture(cdp, path) {
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true
  })
  await writeFile(path, Buffer.from(result.result.data, 'base64'))
}

async function evaluate(cdp, expression, awaitPromise = false) {
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true
  })
  if (response.result?.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.exception?.description
      ?? response.result.exceptionDetails.text
      ?? 'Evaluation failed: ' + expression)
  }
  return response.result?.result?.value
}

async function waitForSelector(cdp, selector, timeoutMs = 10_000) {
  await waitForExpression(cdp, 'Boolean(document.querySelector(' + JSON.stringify(selector) + '))', timeoutMs)
}

async function waitForExpression(cdp, expression, timeoutMs = 10_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await evaluate(cdp, expression)) return
    await wait(100)
  }
  throw new Error('Expression did not become true within ' + timeoutMs + 'ms: ' + expression)
}

async function waitForTarget(stderr) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 20_000) {
    try {
      const targets = await fetch('http://127.0.0.1:' + port + '/json').then((response) => response.json())
      const target = targets.find((candidate) => candidate.type === 'page')
      if (target) return target
    } catch {
      // Electron is still starting.
    }
    await wait(150)
  }
  throw new Error('Electron DevTools target did not appear. ' + stderr.join(''))
}

async function connectCdp(url) {
  const socket = new WebSocket(url)
  const pending = new Map()
  let nextId = 1
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true })
    socket.addEventListener('error', rejectOpen, { once: true })
  })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (!message.id) return
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message)
  })
  socket.addEventListener('close', () => {
    for (const request of pending.values()) request.reject(new Error('CDP connection closed'))
    pending.clear()
  })
  return {
    send(method, params = {}) {
      return new Promise((resolveSend, rejectSend) => {
        const id = nextId++
        pending.set(id, { resolve: resolveSend, reject: rejectSend })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
    close() {
      socket.close()
    }
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))
}
