import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { seedCompletedOnboardingForAcceptance } from './lib/dev-desktop.mjs'

const root = resolve(import.meta.dirname, '..')
const appPath = resolve(process.argv[2] ?? join(root, 'dist', 'mac-arm64', 'Rovai AI.app'))
const fixtureRoot = process.env.ROVAI_APP_UPDATES_ACCEPT_FIXTURE_ROOT
  ?? await mkdtemp(join(tmpdir(), 'rovai-app-updates-ui-accept-'))
const dataDir = join(fixtureRoot, 'user-data')
const outputDir = process.env.ROVAI_APP_UPDATES_ACCEPT_OUTPUT_DIR
  ?? await mkdtemp(join(tmpdir(), 'rovai-app-updates-ui-captures-'))
const port = Number(process.env.ROVAI_APP_UPDATES_ACCEPT_DEBUG_PORT ?? 9521)

await mkdir(dataDir, { recursive: true })
await mkdir(outputDir, { recursive: true })
seedCompletedOnboardingForAcceptance(dataDir)

let isolatedApp = null
try {
  isolatedApp = await launchApp(1440, 920)
  await setTheme(isolatedApp.cdp, 'day')
  await openAboutUpdates(isolatedApp.cdp)
  await assertAboutUpdates(isolatedApp.cdp, 'day desktop')
  const dayCapture = join(outputDir, 'about-updates-idle-day-1440x920.png')
  await capture(isolatedApp.cdp, dayCapture)

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
  await assertAboutUpdates(isolatedApp.cdp, 'night compact')
  const nightCapture = join(outputDir, 'about-updates-idle-night-1040x700.png')
  await capture(isolatedApp.cdp, nightCapture)

  await isolatedApp.cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 720,
    height: 460,
    deviceScaleFactor: 1,
    mobile: false
  })
  await wait(100)
  await assertNoHorizontalOverflow(isolatedApp.cdp, '200% layout equivalent')

  console.log(JSON.stringify({
    ok: true,
    app: basename(appPath),
    fixtureRoot,
    outputDir,
    verified: {
      isolatedPackagedApplication: true,
      packagedVersion: '0.0.2',
      typedIdleUpdaterSnapshot: true,
      productAndBundleName: 'Rovai AI',
      existingSettingsVisualWorld: true,
      noVerticalHeadingRules: true,
      noReleaseNotesOrExternalHandoff: true,
      keyboardFocus: true,
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

async function openAboutUpdates(cdp) {
  const opened = await evaluate(cdp, `(() => {
    const button = document.querySelector('.unified-sidebar-footer button[aria-label="设置"]')
    button?.click()
    return Boolean(button)
  })()`)
  assert(opened, 'Could not open Settings')
  await waitForSelector(cdp, '.settings-sidebar-menu')
  const selected = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.settings-sidebar-menu button')]
      .find((candidate) => candidate.textContent?.includes('关于与更新'))
    button?.click()
    return Boolean(button)
  })()`)
  assert(selected, 'About & Updates Settings entry was unavailable')
  await waitForSelector(cdp, '.about-updates-settings')
  await waitForExpression(cdp,
    `document.querySelector('.about-version-value code')?.textContent === 'v0.0.2'`)
}

async function assertAboutUpdates(cdp, context) {
  const updaterSnapshot = await evaluate(cdp, 'window.rovai.appUpdates.get()', true)
  assert(updaterSnapshot?.currentVersion === '0.0.2' && updaterSnapshot.status === 'idle',
    `${context} returned the wrong updater snapshot: ${JSON.stringify(updaterSnapshot)}`)

  const state = await evaluate(cdp, `(() => {
    const surface = document.querySelector('.about-updates-settings')
    const action = document.querySelector('.about-update-control > button')
    const headingCopy = document.querySelector('.about-updates-settings .settings-page-heading-copy')
    const sectionHeading = document.querySelector('.about-updates-settings .section-heading')
    action?.focus()
    return {
      heading: surface?.querySelector('h1')?.textContent ?? '',
      description: surface?.querySelector('.settings-page-heading-copy > p:last-child')?.textContent ?? '',
      product: surface?.querySelector('.about-product-name strong')?.textContent ?? '',
      version: surface?.querySelector('.about-version-value code')?.textContent ?? '',
      action: action?.textContent?.trim() ?? '',
      actionTag: action?.tagName ?? '',
      actionFocused: document.activeElement === action,
      statusRole: surface?.querySelector('.about-update-status')?.getAttribute('role'),
      source: surface?.querySelector('.about-update-source')?.textContent ?? '',
      progressVisible: Boolean(surface?.querySelector('progress')),
      forbiddenCopy: /Release Notes 摘要|在 GitHub 查看|校验 hash|等待当前任务/.test(surface?.textContent ?? ''),
      headingRule: headingCopy ? getComputedStyle(headingCopy, '::before').content : 'missing',
      sectionRule: sectionHeading ? getComputedStyle(sectionHeading, '::before').content : 'missing',
      documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      surfaceOverflow: surface ? surface.scrollWidth > surface.clientWidth + 1 : true
    }
  })()`)
  assert(state.heading === '关于与更新', `${context} omitted the page heading`)
  assert(state.description === '查看当前版本，检查并安装 Rovai AI 更新。',
    `${context} used the wrong description`)
  assert(state.product === 'Rovai AI' && state.version === 'v0.0.2',
    `${context} used the wrong product/version: ${JSON.stringify(state)}`)
  assert(state.action === '检查更新' && state.actionTag === 'BUTTON' && state.actionFocused,
    `${context} did not expose a keyboard-focusable check action`)
  assert(state.statusRole === 'status' && state.source.includes('GitHub Release'),
    `${context} omitted updater status/source evidence`)
  assert(!state.progressVisible && !state.forbiddenCopy,
    `${context} rendered download or removed handoff controls while idle`)
  assert(state.headingRule === 'none' && state.sectionRule === 'none',
    `${context} restored vertical heading rules: ${JSON.stringify(state)}`)
  assert(!state.documentOverflow && !state.surfaceOverflow,
    `${context} overflowed horizontally: ${JSON.stringify(state)}`)
}

async function assertNoHorizontalOverflow(cdp, context) {
  const state = await evaluate(cdp, `({
    documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    surfaceOverflow: (() => {
      const node = document.querySelector('.about-updates-settings')
      return node ? node.scrollWidth > node.clientWidth + 1 : true
    })()
  })`)
  assert(!state.documentOverflow && !state.surfaceOverflow,
    `${context} overflowed horizontally: ${JSON.stringify(state)}`)
}

async function setTheme(cdp, preference) {
  await evaluate(cdp, `window.rovai.appearance.setPreference(${JSON.stringify(preference)})`, true)
  const expected = preference === 'night' ? 'night' : 'day'
  await waitForExpression(cdp,
    `document.documentElement.dataset.theme === ${JSON.stringify(expected)}`)
}

async function launchApp(width, height) {
  const executable = join(appPath, 'Contents', 'MacOS', 'Rovai AI')
  const stderr = []
  const child = spawn(executable, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dataDir}`
  ], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
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
    await waitForExpression(cdp,
      `Boolean(window.rovai && document.querySelector('.app-shell'))`, 45_000)
    const health = await evaluate(cdp, "window.rovai.request('health.check', {})", true)
    assert(await realpath(health.database.path) === await realpath(join(dataDir, 'rovai.sqlite')),
      `Isolated App opened the wrong database: ${JSON.stringify(health.database.path)}`)
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
    // The isolated App may already have exited.
  }
  app.cdp.close()
  await terminateChild(app.child)
}

async function terminateChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    wait(15_000)
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
  await waitForExpression(cdp, `Boolean(document.querySelector(${JSON.stringify(selector)}))`, timeoutMs)
}

async function waitForExpression(cdp, expression, timeoutMs = 10_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await evaluate(cdp, expression)) return
    await wait(100)
  }
  throw new Error(`Expression did not become true within ${timeoutMs}ms: ${expression}`)
}

async function waitForTarget(stderr) {
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
