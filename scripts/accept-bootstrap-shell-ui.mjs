import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { assertUserDataIsIsolated } from './lib/dev-desktop.mjs'

if (process.platform !== 'darwin') {
  throw new Error('Bootstrap Shell packaged UI acceptance currently requires macOS')
}

const root = resolve(import.meta.dirname, '..')
const appPath = resolve(process.argv[2] ?? join(root, 'dist', 'mac-arm64', 'Rovai AI.app'))
const fixtureRoot = resolve(process.env.ROVAI_BOOTSTRAP_ACCEPT_FIXTURE_ROOT
  ?? await mkdtemp(join(tmpdir(), 'rovai-bootstrap-shell-ui-accept-')))
const dataDir = assertUserDataIsIsolated(join(fixtureRoot, 'user-data'))
const outputDir = resolve(process.env.ROVAI_BOOTSTRAP_ACCEPT_OUTPUT_DIR
  ?? join(fixtureRoot, 'captures'))
const port = Number(process.env.ROVAI_BOOTSTRAP_ACCEPT_DEBUG_PORT ?? 9531)
const databasePath = join(dataDir, 'rovai.sqlite')
const retainedAuthority = Buffer.from('retained unknown authority\n', 'utf8')

await mkdir(dataDir, { recursive: true })
await mkdir(outputDir, { recursive: true })
await writeFile(databasePath, retainedAuthority, { flag: 'wx', mode: 0o600 })

let running = null
try {
  running = await launchApp()
  await waitForSelector(running.cdp, '.bootstrap-shell', 45_000)
  await waitForExpression(running.cdp, `window.rovai.supervisor.getSnapshot()
    .then((snapshot) => snapshot.fullCoreState === 'blocked')`, 45_000)

  const initial = await inspectBootstrap(running.cdp)
  assertBootstrapState(initial, 'initial blocked shell')
  assert(Buffer.compare(await readFile(databasePath), retainedAuthority) === 0,
    'Core modified the unknown authority while entering Bootstrap Shell')

  await setTheme(running.cdp, 'day')
  const dayCapture = join(outputDir, 'bootstrap-blocked-day-1040x700.png')
  await capture(running.cdp, dayCapture)

  const retried = await evaluate(running.cdp, `window.rovai.supervisor.getSnapshot().then(
    async (before) => {
      await window.rovai.supervisor.retryFullCore()
      return before.generation
    })`, true)
  await waitForExpression(running.cdp, `window.rovai.supervisor.getSnapshot().then(
    (snapshot) => snapshot.generation > ${Number(retried)}
      && snapshot.fullCoreState === 'blocked'
      && snapshot.restartAttempt === 0)`, 45_000)
  assert(Buffer.compare(await readFile(databasePath), retainedAuthority) === 0,
    'Explicit retry modified the unknown authority')

  await running.cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 520,
    height: 350,
    deviceScaleFactor: 2,
    mobile: false
  })
  await running.cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  })
  await setTheme(running.cdp, 'night')
  const compact = await inspectBootstrap(running.cdp)
  assertBootstrapState(compact, 'compact reduced-motion shell')
  assert(compact.viewport[0] === 520 && compact.viewport[1] === 350,
    `Compact viewport was not applied: ${JSON.stringify(compact.viewport)}`)
  assert(compact.reducedMotionTransitionSeconds <= 0.00001,
    `Reduced motion did not suppress transitions: ${compact.reducedMotionTransitionSeconds}`)
  const nightCapture = join(
    outputDir,
    'bootstrap-blocked-night-1040x700-200-percent-reduced-motion.png'
  )
  await capture(running.cdp, nightCapture)

  process.stdout.write(`${JSON.stringify({
    ok: true,
    app: basename(appPath),
    fixtureRoot,
    dataDir,
    outputDir,
    verified: {
      isolatedPackagedApplication: true,
      unknownAuthorityRetainedByteForByte: true,
      bootstrapOnlyCapabilityGate: true,
      noAuthoritativeWorkspaceTree: true,
      explicitRetryWithoutCrashBudget: true,
      localThemeControls: true,
      diagnosticsCapability: true,
      dayAndNightLayouts: true,
      narrowTwoHundredPercentEquivalentLayout: true,
      reducedMotion: true,
      horizontalOverflow: false
    },
    captures: { day: dayCapture, nightCompact: nightCapture }
  }, null, 2)}\n`)
} finally {
  if (running) await closeApp(running)
}

async function inspectBootstrap(cdp) {
  return evaluate(cdp, `window.rovai.supervisor.getSnapshot().then((snapshot) => {
    const shell = document.querySelector('.bootstrap-shell')
    const retry = document.querySelector('.bootstrap-actions .primary-button')
    const transitionDuration = getComputedStyle(retry ?? document.documentElement)
      .transitionDuration
    const transitionValue = Number.parseFloat(transitionDuration) || 0
    retry?.focus()
    return {
      snapshot,
      title: document.querySelector('.bootstrap-authority-card h1')?.textContent?.trim() ?? '',
      body: document.querySelector('.bootstrap-authority-card')?.textContent ?? '',
      authoritativeTree: Boolean(document.querySelector('.app-shell')),
      camps: document.querySelectorAll('.camp-nav-row').length,
      members: document.querySelectorAll('.member-sidebar-row').length,
      memory: document.querySelectorAll('.memory-library').length,
      retryFocused: document.activeElement === retry,
      retryDisabled: retry?.disabled ?? true,
      diagnosticsButton: Boolean(document.querySelector('.bootstrap-actions .quiet-button')),
      themeButtons: document.querySelectorAll('.bootstrap-theme-options button').length,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
        || (shell ? shell.scrollWidth > shell.clientWidth + 1 : true),
      viewport: [window.innerWidth, window.innerHeight],
      reducedMotionTransitionSeconds: transitionDuration.endsWith('ms')
        ? transitionValue / 1000
        : transitionValue
    }
  })`, true)
}

function assertBootstrapState(state, context) {
  assert(state.snapshot?.runtimeMode === 'bootstrap_only'
    && state.snapshot?.fullCoreState === 'blocked'
    && state.snapshot?.restartAttempt === 0,
  `${context} returned the wrong Supervisor state: ${JSON.stringify(state.snapshot)}`)
  assert(state.snapshot.capabilities.authoritativeWorkspace === false
    && state.snapshot.capabilities.coreRequests === false
    && state.snapshot.capabilities.localPreferences === true
    && state.snapshot.capabilities.supervisorStatus === true
    && state.snapshot.capabilities.diagnosticsExport === true
    && state.snapshot.capabilities.fullCoreRetry === true,
  `${context} returned the wrong capability matrix: ${JSON.stringify(state.snapshot.capabilities)}`)
  assert(state.title.includes('工作区') && !state.authoritativeTree,
    `${context} mounted the wrong root: ${JSON.stringify(state)}`)
  assert(state.camps === 0 && state.members === 0 && state.memory === 0,
    `${context} exposed authoritative business surfaces: ${JSON.stringify(state)}`)
  assert(state.retryFocused && !state.retryDisabled && state.diagnosticsButton,
    `${context} did not expose keyboard-operable recovery actions: ${JSON.stringify(state)}`)
  assert(state.themeButtons === 3 && !state.horizontalOverflow,
    `${context} omitted local theme controls or overflowed: ${JSON.stringify(state)}`)
}

async function setTheme(cdp, preference) {
  await evaluate(cdp,
    `window.rovai.appearance.setPreference(${JSON.stringify(preference)})`, true)
  await waitForExpression(cdp,
    `document.documentElement.dataset.theme === ${JSON.stringify(preference)}`)
}

async function launchApp() {
  const executable = join(appPath, 'Contents', 'MacOS', 'Rovai AI')
  const stderr = []
  const child = spawn(executable, [
    '--no-sandbox',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dataDir}`
  ], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      ROVAI_ALLOW_ISOLATED_INSTANCE: '1',
      ROVAI_DISABLE_AUTO_UPDATE_CHECKS: '1'
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
      width: 1040,
      height: 700,
      deviceScaleFactor: 1,
      mobile: false
    })
    return { cdp, child }
  } catch (error) {
    cdp?.close()
    await terminateChild(child)
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${stderr.join('')}`)
  }
}

async function closeApp(app) {
  try {
    await Promise.race([app.cdp.send('Browser.close'), wait(1_000)])
  } catch {
    // The isolated packaged App may already have exited.
  }
  app.cdp.close()
  await terminateChild(app.child)
}

async function terminateChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    wait(10_000)
  ])
  if (child.exitCode !== null || child.signalCode !== null) return
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
  await waitForExpression(cdp,
    `Boolean(document.querySelector(${JSON.stringify(selector)}))`, timeoutMs)
}

async function waitForExpression(cdp, expression, timeoutMs = 10_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await evaluate(cdp, expression, true)) return
    await wait(100)
  }
  throw new Error(`Expression did not become true within ${timeoutMs}ms: ${expression}`)
}

async function waitForTarget(stderr) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 30_000) {
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
