import { access, chmod, mkdir, mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const appPath = resolve(process.argv[2] ?? join(root, 'dist', 'mac-arm64', 'Rovai-ai.app'))
const fixtureRoot = process.env.ROVAI_DIAGNOSTICS_ACCEPT_FIXTURE_ROOT
  ?? await mkdtemp(join(tmpdir(), 'rovai-diagnostics-ui-accept-'))
const outputDir = process.env.ROVAI_DIAGNOSTICS_ACCEPT_OUTPUT_DIR
  ?? await mkdtemp(join(tmpdir(), 'rovai-diagnostics-ui-captures-'))
const firstPort = Number(process.env.ROVAI_DIAGNOSTICS_ACCEPT_DEBUG_PORT ?? 9491)

await mkdir(outputDir, { recursive: true })

const desktopFixture = await createFixture('desktop', true)
const compactFixture = await createFixture('compact', false)
let desktopApp = null
let compactApp = null

try {
  desktopApp = await launchApp(firstPort, 1440, 920, false, desktopFixture)
  await setTheme(desktopApp.cdp, 'day')
  await openDiagnostics(desktopApp.cdp)
  await assertDiagnosticsReport(desktopApp.cdp, {
    attention: 1,
    unknown: 0,
    issueCount: 1,
    context: '1440 attention'
  })
  const desktopAttentionCapture = join(outputDir, 'diagnostics-attention-1440x920.png')
  await capture(desktopApp.cdp, desktopAttentionCapture)

  const beforeFullCheck = await mcpEvidence(desktopFixture.mcpPath)
  await clickButton(desktopApp.cdp, '.settings-page-heading button', '运行完整自检')
  await waitForExpression(desktopApp.cdp,
    `document.querySelector('.diagnostics-notice strong')?.textContent === '完整自检已完成'`)
  const afterFullCheck = await mcpEvidence(desktopFixture.mcpPath)
  assert(afterFullCheck.mode === 0o644,
    `Read-only full check changed MCP mode to ${afterFullCheck.mode.toString(8)}`)
  assert(afterFullCheck.content.equals(beforeFullCheck.content),
    'Read-only full check changed MCP JSON bytes')
  await assertDiagnosticsReport(desktopApp.cdp, {
    attention: 1,
    unknown: 0,
    issueCount: 1,
    context: '1440 after full check'
  })

  await selectFilter(desktopApp.cdp, '需要处理')
  await waitForExpression(desktopApp.cdp,
    `document.querySelectorAll('.diagnostics-result-row').length === 1`)
  await selectFilter(desktopApp.cdp, '全部')
  await scrollResultsIntoView(desktopApp.cdp)
  const desktopResultsCapture = join(outputDir, 'diagnostics-results-1440x920.png')
  await capture(desktopApp.cdp, desktopResultsCapture)

  const exported = await request(desktopApp.cdp, 'diagnostics.export')
  assertV5Export(exported, desktopFixture)

  await scrollToTop(desktopApp.cdp)
  await clickButton(desktopApp.cdp, '.diagnostics-issue button', '修复文件权限')
  await waitForExpression(desktopApp.cdp,
    `document.querySelector('.diagnostics-summary-counts .is-attention dd')?.textContent === '0'
      && document.querySelector('.diagnostics-notice strong')?.textContent === 'MCP 权限已修复'`)
  const afterRepair = await mcpEvidence(desktopFixture.mcpPath)
  assert(afterRepair.mode === 0o600,
    `Explicit MCP repair left mode ${afterRepair.mode.toString(8)}`)
  assert(afterRepair.content.equals(beforeFullCheck.content),
    'Explicit MCP permission repair changed JSON bytes')
  await assertDiagnosticsReport(desktopApp.cdp, {
    attention: 0,
    unknown: 0,
    issueCount: 0,
    context: '1440 repaired success'
  })
  const desktopSuccessCapture = join(outputDir, 'diagnostics-success-1440x920.png')
  await capture(desktopApp.cdp, desktopSuccessCapture)

  await closeApp(desktopApp)
  desktopApp = null

  compactApp = await launchApp(firstPort + 1, 1040, 700, true, compactFixture)
  await setTheme(compactApp.cdp, 'day')
  await openDiagnostics(compactApp.cdp)
  await assertDiagnosticsReport(compactApp.cdp, {
    attention: 0,
    unknown: 0,
    issueCount: 0,
    context: '1040 clean'
  })
  assert(!(await exists(compactFixture.mcpPath)),
    'Opening Diagnostics initialized the missing MCP file')
  await clickButton(compactApp.cdp, '.settings-page-heading button', '运行完整自检')
  await waitForExpression(compactApp.cdp,
    `document.querySelector('.diagnostics-notice strong')?.textContent === '完整自检已完成'`)
  assert(!(await exists(compactFixture.mcpPath)),
    'Read-only full check initialized the missing MCP file')
  const compactCapture = join(outputDir, 'diagnostics-clean-1040x700.png')
  await capture(compactApp.cdp, compactCapture)
  await selectFilter(compactApp.cdp, '暂时无法确认')
  await waitForExpression(compactApp.cdp,
    `Boolean(document.querySelector('.diagnostics-results-empty'))`)
  await selectFilter(compactApp.cdp, '全部')
  await scrollResultsIntoView(compactApp.cdp)
  const compactResultsCapture = join(outputDir, 'diagnostics-results-1040x700.png')
  await capture(compactApp.cdp, compactResultsCapture)

  console.log(JSON.stringify({
    ok: true,
    app: basename(appPath),
    fixtureRoot,
    outputDir,
    verified: {
      packagedRendererToCoreDiagnostics: true,
      strictReadOnlyFullCheck: true,
      missingMcpRemainsMissing: true,
      explicitMcpPermissionRepairAndRecheck: true,
      repairPreservesMcpJsonBytes: true,
      allNineRuntimesVisibleWithoutUnusedIssues: true,
      attentionAndUnknownFilters: true,
      v5CentralRedactionAndNoV4: true,
      dayDesktopAndCompactReducedMotionLayouts: true,
      horizontalOverflow: false
    },
    captures: {
      desktopAttention: desktopAttentionCapture,
      desktopResults: desktopResultsCapture,
      desktopSuccess: desktopSuccessCapture,
      compact: compactCapture,
      compactResults: compactResultsCapture
    }
  }, null, 2))
} finally {
  if (desktopApp) await closeApp(desktopApp)
  if (compactApp) await closeApp(compactApp)
}

async function createFixture(name, withPermissionIssue) {
  const fixture = join(fixtureRoot, name)
  const dataDir = join(fixture, 'user-data')
  const homeDir = join(fixture, 'home')
  const mcpDirectory = join(homeDir, '.rovai')
  const mcpPath = join(mcpDirectory, 'mcp.json')
  await mkdir(dataDir, { recursive: true })
  await mkdir(homeDir, { recursive: true })
  if (withPermissionIssue) {
    await mkdir(mcpDirectory, { recursive: true, mode: 0o700 })
    await writeFile(mcpPath, `${JSON.stringify({
      mcpServers: {},
      _rovai: { schemaVersion: 2, servers: {}, assignments: [] }
    }, null, 2)}\n`, { mode: 0o644 })
    await chmod(mcpPath, 0o644)
  }
  return { fixture, dataDir, homeDir, mcpPath }
}

async function assertDiagnosticsReport(cdp, expected) {
  await waitForExpression(cdp,
    `Boolean(document.querySelector('.diagnostics-summary')
      && document.querySelectorAll('.diagnostics-result-row').length === 15)`, 20_000)
  const state = await evaluate(cdp, `({
    attention: Number(document.querySelector('.diagnostics-summary-counts .is-attention dd')?.textContent),
    unknown: Number(document.querySelector('.diagnostics-summary-counts .is-unknown dd')?.textContent),
    issues: document.querySelectorAll('.diagnostics-issue').length,
    rows: document.querySelectorAll('.diagnostics-result-row').length,
    runtimes: document.querySelectorAll('.diagnostics-result-group:last-child .diagnostics-result-row').length,
    prototypeSwitcher: document.body.textContent?.includes('交互稿状态切换器'),
    repairAll: document.body.textContent?.includes('修复全部'),
    documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    centerOverflow: (() => {
      const node = document.querySelector('.diagnostics-center')
      return node ? node.scrollWidth > node.clientWidth + 1 : true
    })(),
    body: document.querySelector('.diagnostics-center')?.textContent ?? ''
  })`)
  assert(state.attention === expected.attention,
    `${expected.context} attention was ${state.attention}`)
  assert(state.unknown === expected.unknown,
    `${expected.context} unknown was ${state.unknown}`)
  assert(state.issues === expected.issueCount,
    `${expected.context} issue count was ${state.issues}`)
  assert(state.rows === 15 && state.runtimes === 9,
    `${expected.context} did not render 15 checks / 9 Runtimes: ${JSON.stringify(state)}`)
  assert(!state.prototypeSwitcher && !state.repairAll,
    `${expected.context} rendered a prototype or repair-all control`)
  assert(!state.documentOverflow && !state.centerOverflow,
    `${expected.context} overflowed horizontally: ${JSON.stringify(state)}`)
  assert(!state.body.includes(fixtureRoot),
    `${expected.context} rendered an absolute fixture path`)
}

function assertV5Export(exported, fixture) {
  assert(exported?.format === 'rovai-diagnostics-v5',
    `Diagnostics export format was ${JSON.stringify(exported?.format)}`)
  assert(exported?.diagnostics?.schemaVersion === 1,
    'Diagnostics export omitted the typed report')
  assert(Array.isArray(exported?.diagnostics?.checks)
      && exported.diagnostics.checks.length === 15,
  'Diagnostics export did not contain all checks')
  const serialized = JSON.stringify(exported)
  assert(!serialized.includes('rovai-diagnostics-v4'), 'Diagnostics export retained v4')
  for (const path of [fixture.fixture, fixture.dataDir, fixture.homeDir, fixture.mcpPath]) {
    assert(!serialized.includes(path), `Diagnostics export leaked ${path}`)
  }
  const absoluteStrings = []
  visitStrings(exported, (value) => {
    if (value.startsWith('/')
        || value.startsWith('file://')
        || /^[A-Za-z]:[\\/]/.test(value)) absoluteStrings.push(value)
  })
  assert(absoluteStrings.length === 0,
    `Diagnostics export contained absolute paths: ${JSON.stringify(absoluteStrings)}`)
}

function visitStrings(value, visit) {
  if (typeof value === 'string') visit(value)
  else if (Array.isArray(value)) value.forEach((item) => visitStrings(item, visit))
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => visitStrings(item, visit))
}

async function openDiagnostics(cdp) {
  const opened = await evaluate(cdp, `(() => {
    const settings = document.querySelector('.unified-sidebar-footer button[aria-label="设置"]')
    settings?.click()
    return Boolean(settings)
  })()`)
  assert(opened, 'Could not open Settings')
  await waitForSelector(cdp, '.settings-sidebar-menu')
  const selected = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.settings-sidebar-menu button')]
      .find((candidate) => candidate.textContent?.includes('诊断'))
    button?.click()
    return Boolean(button)
  })()`)
  assert(selected, 'Diagnostics Settings entry was unavailable')
  await waitForSelector(cdp, '.diagnostics-center')
}

async function selectFilter(cdp, label) {
  await clickButton(cdp, '.diagnostics-filters button', label)
  await waitForExpression(cdp,
    `[...document.querySelectorAll('.diagnostics-filters button')]
      .some((button) => button.textContent?.trim() === ${JSON.stringify(label)}
        && button.getAttribute('aria-pressed') === 'true')`)
}

async function scrollResultsIntoView(cdp) {
  await evaluate(cdp,
    `document.querySelector('#diagnostics-results-heading')?.scrollIntoView({ block: 'start' })`)
  await wait(100)
}

async function scrollToTop(cdp) {
  await evaluate(cdp, `document.querySelector('.settings-panel')?.scrollTo({ top: 0 })`)
  await wait(100)
}

async function mcpEvidence(path) {
  return {
    content: await readFile(path),
    mode: (await stat(path)).mode & 0o777
  }
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function clickButton(cdp, selector, label) {
  const clicked = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)})
    if (!button || button.disabled) return false
    button.click()
    return true
  })()`)
  assert(clicked, `Could not click enabled button ${JSON.stringify(label)} within ${selector}`)
}

async function request(cdp, method, params = {}) {
  return evaluate(cdp,
    `window.rovai.request(${JSON.stringify(method)}, ${JSON.stringify(params)})`, true)
}

async function setTheme(cdp, preference) {
  await evaluate(cdp, `window.rovai.appearance.setPreference(${JSON.stringify(preference)})`, true)
  await waitForExpression(cdp, `document.documentElement.dataset.theme === 'day'`)
}

async function launchApp(port, width, height, reducedMotion, fixture) {
  const executable = join(appPath, 'Contents', 'MacOS', 'Rovai-ai')
  const stderr = []
  const child = spawn(executable, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${fixture.dataDir}`
  ], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      HOME: fixture.homeDir,
      ROVAI_ALLOW_ISOLATED_INSTANCE: '1'
    }
  })
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
  let cdp = null
  try {
    const target = await waitForTarget(port, stderr)
    cdp = await connectCdp(target.webSocketDebuggerUrl)
    await cdp.send('Page.enable')
    await cdp.send('Page.bringToFront')
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false
    })
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{
        name: 'prefers-reduced-motion',
        value: reducedMotion ? 'reduce' : 'no-preference'
      }]
    })
    await waitForExpression(cdp,
      `Boolean(window.rovai && document.querySelector('.app-shell'))`, 45_000)
    const health = await request(cdp, 'health.check')
    assert(await realpath(health.database.path) === await realpath(join(fixture.dataDir, 'rovai.sqlite')),
      `Isolated App opened the wrong database: ${JSON.stringify(health.database.path)}`)
    return { cdp, port, child }
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
    // The isolated App may already have exited.
  }
  app.cdp.close()
  const startedAt = Date.now()
  while (Date.now() - startedAt < 5_000) {
    try {
      await fetch(`http://127.0.0.1:${app.port}/json`)
    } catch {
      await terminateChild(app.child)
      return
    }
    await wait(100)
  }
  await terminateChild(app.child)
  throw new Error(`Isolated packaged App did not close on debug port ${app.port}`)
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
      ?? `Evaluation failed: ${expression}`)
  }
  return response.result?.result?.value
}

async function waitForSelector(cdp, selector, timeoutMs = 10_000) {
  await waitForExpression(cdp, `Boolean(document.querySelector(${JSON.stringify(selector)}))`, timeoutMs)
}

async function waitForExpression(cdp, expression, timeoutMs = 10_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await evaluate(cdp, expression)) return
    await wait(100)
  }
  if (await evaluate(cdp, expression)) return
  throw new Error(`Expression did not become true within ${timeoutMs}ms: ${expression}`)
}

async function waitForTarget(port, stderr) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 20_000) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json())
      const target = targets.find((candidate) => candidate.type === 'page')
      if (target) return target
    } catch {
      // Electron is still starting.
    }
    await wait(150)
  }
  throw new Error(`Electron DevTools target did not appear. ${stderr.join('')}`)
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
    const pendingRequest = pending.get(message.id)
    if (!pendingRequest) return
    pending.delete(message.id)
    if (message.error) pendingRequest.reject(new Error(message.error.message))
    else pendingRequest.resolve(message)
  })
  socket.addEventListener('close', () => {
    for (const pendingRequest of pending.values()) {
      pendingRequest.reject(new Error('CDP connection closed'))
    }
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
