import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { configureProductRuntime } from './configure-product-runtime.mjs'
import { createConfiguredCampAndSend } from './lib/create-configured-camp.mjs'

const root = resolve(import.meta.dirname, '..')
const appPath = resolve(process.argv[2] ?? join(root, 'dist', 'mac-arm64', 'Rovai-ai.app'))
const fixtureRoot = process.env.ROVAI_PLANNED_SHUTDOWN_ACCEPT_FIXTURE_ROOT
  ?? await mkdtemp(join(tmpdir(), 'rovai-planned-shutdown-accept-'))
const outputDir = process.env.ROVAI_PLANNED_SHUTDOWN_ACCEPT_OUTPUT_DIR
  ?? await mkdtemp(join(tmpdir(), 'rovai-planned-shutdown-captures-'))
const dataDir = join(fixtureRoot, 'user-data')
const projectRoot = join(fixtureRoot, 'project')
const databasePath = join(dataDir, 'rovai.sqlite')
const runtimeTempDir = process.env.ROVAI_PLANNED_SHUTDOWN_ACCEPT_RUNTIME_TMP ?? tmpdir()
const agentId = 'agent_1'
const runtimeKind = 'claude-code-cli'
const shutdownDeadlineMs = 10_000
const reportPath = join(outputDir, 'planned-shutdown-acceptance.json')

let firstApp = null
let recoveredApp = null
let failed = true

try {
  await mkdir(projectRoot, { recursive: true })
  await mkdir(dataDir, { recursive: true })
  await mkdir(outputDir, { recursive: true })
  await writeFile(join(projectRoot, 'README.md'), '# Planned shutdown acceptance fixture\n')
  await runProcess('git', ['init', '-b', 'main'], { cwd: projectRoot })
  await runProcess('git', ['config', 'user.name', 'Rovai-ai Planned Shutdown Acceptance'], {
    cwd: projectRoot
  })
  await runProcess('git', ['config', 'user.email', 'planned-shutdown@rovai.local'], {
    cwd: projectRoot
  })
  await runProcess('git', ['add', 'README.md'], { cwd: projectRoot })
  await runProcess('git', ['commit', '-m', 'fixture'], { cwd: projectRoot })

  firstApp = await launchApp(await availablePort(), 1040, 700)
  await setTheme(firstApp.cdp, 'day')
  const request = (method, params = {}) => appRequest(firstApp.cdp, method, params)
  const workspace = await request('workspaces.inspect', { path: projectRoot })
  const installation = await configureProductRuntime(request, runtimeKind, [agentId])
  const sent = await createConfiguredCampAndSend(request, {
    commandId: crypto.randomUUID(),
    name: 'Planned shutdown real Runtime acceptance',
    workspace,
    memberAgentIds: [agentId],
    defaultLeadAgentId: agentId,
    address: { mode: 'explicit', agentIds: [agentId] },
    body: [
      'This is a controlled planned-shutdown acceptance run.',
      'Do not call tools, execute commands, inspect files, or modify the workspace.',
      'Write a detailed 4000-word explanation of why process exit alone cannot prove a distributed task was cancelled.',
      'Stay within this one response and do not send messages through any external tool.'
    ].join(' '),
    purpose: 'Keep one real Runtime turn active while Rovai performs a controlled shutdown.'
  })
  const campId = sent.payload?.campId
  const agentRunId = sent.payload?.agentRunIds?.[0]
  assert(sent.status === 'accepted' && campId && agentRunId,
    `Real Runtime AgentRun was not accepted: ${JSON.stringify(sent)}`)

  const acceptedSnapshot = await waitFor(async () => {
    const snapshot = await request('camps.snapshot', { campId })
    const run = snapshot.agentRuns.find((candidate) => candidate.id === agentRunId)
    if (['succeeded', 'failed', 'cancelled'].includes(run?.status)) {
      throw new Error(`Real Runtime completed before shutdown could begin: ${JSON.stringify(run)}`)
    }
    const delivery = snapshot.contextManifests
      .find((manifest) => manifest.agentRunId === agentRunId)?.delivery
    return run?.status === 'running' && delivery?.status === 'accepted'
      ? snapshot
      : null
  }, 'real Runtime input acceptance', 180_000, 40)
  await openCamp(firstApp.cdp, campId)

  const liveDescendantPids = await descendantProcessIds(firstApp.child.pid)
  assert(liveDescendantPids.length >= 3,
    `Packaged App did not own the expected Core/Runtime process tree: ${liveDescendantPids.join(', ')}`)

  const shutdownStartedAt = Date.now()
  const browserClose = firstApp.cdp.send('Browser.close').catch(() => undefined)
  await waitForExpression(firstApp.cdp, `Boolean(document.querySelector('.shutdown-scrim'))`, 3_000, 20)

  const dayOverlay = await collectShutdownOverlay(firstApp.cdp, 'day', 1040, 700, 1)
  const dayCapture = join(outputDir, 'planned-shutdown-day-1040x700.png')
  await capture(firstApp.cdp, dayCapture)

  await evaluate(firstApp.cdp, `window.rovai.appearance.setPreference('night')`, true)
  await waitForExpression(firstApp.cdp, `document.documentElement.dataset.theme === 'night'`, 2_000, 20)
  const nightOverlay = await collectShutdownOverlay(firstApp.cdp, 'night', 1040, 700, 1)
  const nightCapture = join(outputDir, 'planned-shutdown-night-1040x700.png')
  await capture(firstApp.cdp, nightCapture)

  await firstApp.cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 520,
    height: 350,
    deviceScaleFactor: 2,
    mobile: false,
    screenWidth: 1040,
    screenHeight: 700
  })
  await waitForExpression(firstApp.cdp,
    `innerWidth === 520 && innerHeight === 350 && Math.abs(devicePixelRatio - 2) < 0.01`,
    2_000,
    20)
  const zoomOverlay = await collectShutdownOverlay(firstApp.cdp, 'night', 520, 350, 2)
  const zoomCapture = join(outputDir, 'planned-shutdown-night-1040x700-zoom-200.png')
  await capture(firstApp.cdp, zoomCapture)

  const firstExit = await waitForChildExit(firstApp.child, 18_000)
  const shutdownElapsedMs = Date.now() - shutdownStartedAt
  await browserClose
  firstApp.cdp.close()
  firstApp = null
  assert(firstExit.code === 0 && firstExit.signal === null,
    `Packaged App did not exit naturally after controlled shutdown: ${JSON.stringify(firstExit)}`)
  assert(shutdownElapsedMs >= shutdownDeadlineMs - 1_000 && shutdownElapsedMs < 18_000,
    `Controlled shutdown did not honor its bounded Core deadline: ${shutdownElapsedMs}ms`)
  await assertProcessesExited(liveDescendantPids)

  const afterShutdown = await readRunFacts(agentRunId)
  assert(afterShutdown.run
    && ['running', 'waiting'].includes(afterShutdown.run.status)
    && afterShutdown.run.cancel_requested_at === null
    && afterShutdown.run.terminal_resolution_source === null
    && afterShutdown.run.terminal_reason_code === null
    && afterShutdown.run.ended_at === null,
  `Process interruption fabricated an AgentRun terminal: ${JSON.stringify(afterShutdown.run)}`)
  assert(afterShutdown.delivery?.status === 'accepted',
    `Controlled shutdown changed accepted input evidence: ${JSON.stringify(afterShutdown.delivery)}`)
  assert(afterShutdown.turn?.cancel_requested_at === null
    && afterShutdown.turn?.status !== 'cancelled',
  `Planned shutdown leaked into CampTurn cancellation: ${JSON.stringify(afterShutdown.turn)}`)

  recoveredApp = await launchApp(await availablePort(), 1040, 700)
  const recoveredRequest = (method, params = {}) => appRequest(recoveredApp.cdp, method, params)
  const recoveredSnapshot = await waitFor(async () => {
    const snapshot = await recoveredRequest('camps.snapshot', { campId })
    const run = snapshot.agentRuns.find((candidate) => candidate.id === agentRunId)
    return run?.status === 'waiting' && run.waitReason === 'recovery_blocked'
      ? snapshot
      : null
  }, 'accepted-input recovery blocker after restart', 45_000, 100)
  const recoveredRun = recoveredSnapshot.agentRuns.find((candidate) => candidate.id === agentRunId)
  assert(recoveredRun?.executionEpoch === 1
    && recoveredRun.terminalResolutionSource === null
    && recoveredRun.terminalReasonCode === null,
  `Restart changed the unresolved execution identity or terminal proof: ${JSON.stringify(recoveredRun)}`)
  await openCamp(recoveredApp.cdp, campId)
  await openAgentProcess(recoveredApp.cdp, agentId)
  const blocker = await collectRecoveryBlocker(recoveredApp.cdp)
  const blockerCapture = join(outputDir, 'planned-shutdown-recovery-blocker.png')
  await capture(recoveredApp.cdp, blockerCapture)

  const recoveredDescendantPids = await descendantProcessIds(recoveredApp.child.pid)
  const recoveredShutdownStartedAt = Date.now()
  const recoveredClose = recoveredApp.cdp.send('Browser.close').catch(() => undefined)
  const recoveredExit = await waitForChildExit(recoveredApp.child, 18_000)
  const recoveredShutdownElapsedMs = Date.now() - recoveredShutdownStartedAt
  await recoveredClose
  recoveredApp.cdp.close()
  recoveredApp = null
  assert(recoveredExit.code === 0 && recoveredExit.signal === null,
    `Recovered packaged App did not exit naturally: ${JSON.stringify(recoveredExit)}`)
  assert(recoveredShutdownElapsedMs < 18_000,
    `Recovered packaged App exceeded its outer shutdown window: ${recoveredShutdownElapsedMs}ms`)
  await assertProcessesExited(recoveredDescendantPids)

  const finalFacts = await readRunFacts(agentRunId)
  assert(finalFacts.run?.status === 'waiting'
    && finalFacts.run.wait_reason === 'recovery_blocked'
    && finalFacts.run.last_error_code === 'accepted_input_outcome_unknown'
    && finalFacts.run.cancel_requested_at === null
    && finalFacts.run.terminal_resolution_source === null
    && finalFacts.run.terminal_reason_code === null,
  `Restart did not preserve the accepted-input recovery blocker: ${JSON.stringify(finalFacts.run)}`)

  const report = {
    ok: true,
    mode: 'packaged-app-real-claude-runtime',
    app: basename(appPath),
    runtime: {
      adapterKind: runtimeKind,
      reportedVersion: installation.snapshot?.reportedVersion ?? null,
      agentRunId,
      inputStatusBeforeShutdown: acceptedSnapshot.contextManifests
        .find((manifest) => manifest.agentRunId === agentRunId)?.delivery?.status ?? null
    },
    shutdown: {
      elapsedMs: shutdownElapsedMs,
      recoveredElapsedMs: recoveredShutdownElapsedMs,
      naturalExit: true,
      observedDescendantProcesses: liveDescendantPids.length,
      terminalFabricated: false,
      campTurnCancellationWritten: false
    },
    recovery: {
      status: recoveredRun.status,
      waitReason: recoveredRun.waitReason,
      executionEpoch: recoveredRun.executionEpoch,
      blocker
    },
    overlays: {
      day: dayOverlay,
      night: nightOverlay,
      zoom200: zoomOverlay
    },
    captures: {
      day: dayCapture,
      night: nightCapture,
      zoom200: zoomCapture,
      recoveryBlocker: blockerCapture
    }
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ ...report, reportPath }, null, 2))
  failed = false
} finally {
  if (firstApp) await terminateIsolatedApp(firstApp)
  if (recoveredApp) await terminateIsolatedApp(recoveredApp)
  if (!failed && process.env.ROVAI_KEEP_PLANNED_SHUTDOWN_FIXTURE !== '1') {
    await rm(fixtureRoot, { recursive: true, force: true })
  } else if (failed) {
    process.stderr.write(`Preserved planned shutdown fixture: ${fixtureRoot}\n`)
    process.stderr.write(`Preserved planned shutdown captures: ${outputDir}\n`)
  }
}

async function launchApp(port, width, height) {
  const executable = join(appPath, 'Contents', 'MacOS', 'Rovai-ai')
  const stderr = []
  const child = spawn(executable, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dataDir}`
  ], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, ROVAI_ALLOW_ISOLATED_INSTANCE: '1', TMPDIR: runtimeTempDir }
  })
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
  let cdp = null
  try {
    const target = await waitForTarget(port, stderr)
    cdp = await connectCdp(target.webSocketDebuggerUrl)
    await cdp.send('Page.enable')
    await cdp.send('Page.bringToFront')
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false
    })
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
    })
    await waitForExpression(cdp, `Boolean(window.rovai && document.querySelector('.app-shell'))`, 45_000)
    const health = await appRequest(cdp, 'health.check')
    assert(await realpath(health.database.path) === await realpath(databasePath),
      `Isolated packaged App opened the wrong database: ${health.database.path}`)
    return { cdp, child, stderr }
  } catch (error) {
    cdp?.close()
    await terminateProcessTree(child)
    throw error
  }
}

async function appRequest(cdp, method, params = {}) {
  return evaluate(
    cdp,
    `window.rovai.request(${JSON.stringify(method)}, ${JSON.stringify(params)})`,
    true
  )
}

async function setTheme(cdp, preference) {
  await evaluate(cdp, `window.rovai.appearance.setPreference(${JSON.stringify(preference)})`, true)
  await waitForExpression(cdp,
    `document.documentElement.dataset.theme === ${JSON.stringify(preference)}`)
}

async function openCamp(cdp, campId) {
  await waitForExpression(cdp, `(() => {
    const target = ${JSON.stringify(`camp:${campId}`)}
    return [...document.querySelectorAll('[data-sidebar-menu-target]')]
      .some((element) => element.dataset.sidebarMenuTarget === target)
  })()`, 30_000)
  const opened = await evaluate(cdp, `(() => {
    const target = ${JSON.stringify(`camp:${campId}`)}
    const menu = [...document.querySelectorAll('[data-sidebar-menu-target]')]
      .find((element) => element.dataset.sidebarMenuTarget === target)
    const button = menu?.closest('.camp-nav-row')?.querySelector('.camp-nav-open')
    button?.click()
    return Boolean(button)
  })()`)
  assert(opened, `Could not open Camp ${campId}`)
  await waitForExpression(cdp, `Boolean(document.querySelector('.camp-workspace'))`, 30_000)
}

async function openAgentProcess(cdp, targetAgentId) {
  const opened = await evaluate(cdp, `(() => {
    const chip = document.querySelector(${JSON.stringify(`.run-pulse-chip[data-agent-id="${targetAgentId}"]`)})
    chip?.click()
    return Boolean(chip)
  })()`)
  assert(opened, `Could not open the recovered process for ${targetAgentId}`)
  await waitForExpression(cdp, `Boolean(document.querySelector('.process-recovery-blocker'))`, 10_000)
}

async function collectShutdownOverlay(cdp, theme, viewportWidth, viewportHeight, deviceScaleFactor) {
  const overlay = await evaluate(cdp, `(() => {
    const scrim = document.querySelector('.shutdown-scrim')
    const card = scrim?.querySelector('.shutdown-card')
    const progress = scrim?.querySelector('.shutdown-progress i')
    const cardRect = card?.getBoundingClientRect()
    const progressStyle = progress ? getComputedStyle(progress) : null
    return scrim && card && cardRect ? {
      theme: document.documentElement.dataset.theme,
      role: scrim.getAttribute('role'),
      modal: scrim.getAttribute('aria-modal'),
      labelledBy: scrim.getAttribute('aria-labelledby'),
      describedBy: scrim.getAttribute('aria-describedby'),
      title: scrim.querySelector('h2')?.textContent?.trim() ?? null,
      description: scrim.querySelector('#controlled-shutdown-description')?.textContent?.trim() ?? null,
      actionCount: scrim.querySelectorAll('button, a, input, select, textarea').length,
      card: { left: cardRect.left, top: cardRect.top, right: cardRect.right, bottom: cardRect.bottom },
      viewport: { width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio },
      documentScrollWidth: document.documentElement.scrollWidth,
      documentScrollHeight: document.documentElement.scrollHeight,
      reducedMotionAnimationIterations: progressStyle?.animationIterationCount ?? null,
      reducedMotionAnimationDuration: progressStyle?.animationDuration ?? null
    } : null
  })()`)
  assert(overlay
    && overlay.theme === theme
    && overlay.role === 'dialog'
    && overlay.modal === 'true'
    && overlay.labelledBy === 'controlled-shutdown-title'
    && overlay.describedBy === 'controlled-shutdown-description'
    && overlay.title === '正在停止运行并关闭 Rovai…'
    && overlay.description.includes('Runtime 返回可靠终态')
    && overlay.description.includes('无法确认的执行会保留现场')
    && overlay.actionCount === 0
    && overlay.viewport.width === viewportWidth
    && overlay.viewport.height === viewportHeight
    && Math.abs(overlay.viewport.deviceScaleFactor - deviceScaleFactor) < 0.01
    && overlay.card.left >= 0
    && overlay.card.top >= 0
    && overlay.card.right <= viewportWidth
    && overlay.card.bottom <= viewportHeight
    && overlay.documentScrollWidth <= viewportWidth + 1
    && overlay.documentScrollHeight <= viewportHeight + 1
    && overlay.reducedMotionAnimationIterations === '1',
  `Controlled shutdown overlay failed ${theme} ${viewportWidth}x${viewportHeight} @${deviceScaleFactor}: ${JSON.stringify(overlay)}`)
  return overlay
}

async function collectRecoveryBlocker(cdp) {
  const blocker = await evaluate(cdp, `(() => {
    const value = document.querySelector('.process-recovery-blocker')
    return value ? {
      heading: value.querySelector('strong')?.textContent?.trim() ?? null,
      text: value.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
      button: value.querySelector('button')?.textContent?.trim() ?? null,
      spinnerCount: value.querySelectorAll('.spinner, [aria-busy="true"]').length
    } : null
  })()`)
  assert(blocker
    && blocker.heading === '无法安全自动恢复'
    && blocker.text.includes('原请求不会自动重发')
    && blocker.button === '结束此运行'
    && blocker.spinnerCount === 0,
  `Recovered Run did not show the honest blocker: ${JSON.stringify(blocker)}`)
  return blocker
}

async function readRunFacts(agentRunId) {
  const run = (await runSqlJson(`
    SELECT id, status, wait_reason, cancel_requested_at, terminal_resolution_source,
           terminal_reason_code, last_error_code, execution_epoch, ended_at
    FROM agent_run WHERE id = ${sqlLiteral(agentRunId)};
  `))[0] ?? null
  const delivery = (await runSqlJson(`
    SELECT agent_run_id, execution_epoch, status, native_input_id, accepted_at, resolved_at
    FROM runtime_input_delivery WHERE agent_run_id = ${sqlLiteral(agentRunId)};
  `))[0] ?? null
  const turn = (await runSqlJson(`
    SELECT id, status, cancel_requested_at, aggregate_reason_code, ended_at
    FROM camp_turn WHERE id = (
      SELECT camp_turn_id FROM agent_run WHERE id = ${sqlLiteral(agentRunId)}
    );
  `))[0] ?? null
  return { run, delivery, turn }
}

async function runSqlJson(sql) {
  const raw = await runProcess('/usr/bin/sqlite3', ['-json', databasePath, sql])
  return JSON.parse(raw || '[]')
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

async function waitForExpression(cdp, expression, timeoutMs = 10_000, intervalMs = 80) {
  return waitFor(
    async () => await evaluate(cdp, expression) ? true : null,
    expression,
    timeoutMs,
    intervalMs
  )
}

async function waitFor(probe, label, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await probe()
    if (result) return result
    await wait(intervalMs)
  }
  const finalResult = await probe()
  if (finalResult) return finalResult
  throw new Error(`Timed out waiting for ${label}`)
}

async function waitForTarget(port, stderr) {
  return waitFor(async () => {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json())
      return targets.find((candidate) => candidate.type === 'page') ?? null
    } catch {
      return null
    }
  }, `Electron DevTools target on ${port}. ${stderr.join('')}`, 25_000, 120)
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
    close() { socket.close() }
  }
}

async function availablePort() {
  const server = createServer()
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : null
  await new Promise((resolveClose, rejectClose) => server.close((error) =>
    error ? rejectClose(error) : resolveClose()))
  if (!port) throw new Error('Could not allocate an isolated DevTools port')
  return port
}

async function descendantProcessIds(parentPid) {
  const discovered = []
  const queue = [parentPid]
  while (queue.length > 0) {
    const parent = queue.shift()
    const raw = await runProcess('/usr/bin/pgrep', ['-P', String(parent)], { allowFailure: true })
    const children = raw.split(/\s+/).filter(Boolean).map(Number).filter(Number.isFinite)
    for (const child of children) {
      if (discovered.includes(child)) continue
      discovered.push(child)
      queue.push(child)
    }
  }
  return discovered
}

async function assertProcessesExited(processIds) {
  await waitFor(async () => processIds.every((pid) => !processExists(pid)) ? true : null,
    `isolated descendants to exit: ${processIds.join(', ')}`, 3_000, 50)
}

function processExists(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    throw error
  }
}

function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode })
  }
  return new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit)
      rejectExit(new Error(`Packaged App did not exit within ${timeoutMs}ms`))
    }, timeoutMs)
    const onExit = (code, signal) => {
      clearTimeout(timer)
      resolveExit({ code, signal })
    }
    child.once('exit', onExit)
  })
}

async function terminateIsolatedApp(app) {
  app.cdp?.close()
  await terminateProcessTree(app.child)
}

async function terminateProcessTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const descendants = await descendantProcessIds(child.pid)
  child.kill('SIGTERM')
  for (const pid of descendants.reverse()) {
    try { process.kill(pid, 'SIGTERM') } catch (error) {
      if (error?.code !== 'ESRCH') throw error
    }
  }
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    wait(2_000)
  ])
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGKILL')
  for (const pid of descendants) {
    try { process.kill(pid, 'SIGKILL') } catch (error) {
      if (error?.code !== 'ESRCH') throw error
    }
  }
}

function runProcess(command, args, { cwd = root, allowFailure = false } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(String(chunk)))
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
    child.once('error', rejectRun)
    child.once('close', (code, signal) => {
      if (code === 0 || allowFailure) resolveRun(stdout.join(''))
      else rejectRun(new Error(`${command} exited with ${code ?? signal}: ${stderr.join('')}`))
    })
  })
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))
}
