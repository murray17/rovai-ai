import { execFileSync, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { assertUserDataIsIsolated, seedCompletedOnboardingForAcceptance } from './lib/dev-desktop.mjs'
import { startQualificationCore } from './lib/qualification-core.mjs'
import { removeEphemeralRuntimeCampFilesRoot } from './lib/runtime-camp-files-root.mjs'

if (process.platform !== 'darwin') {
  throw new Error('Bootstrap Shell packaged UI acceptance currently requires macOS')
}

const root = resolve(import.meta.dirname, '..')
const appPath = resolve(process.argv[2] ?? join(root, 'dist', 'mac-arm64', 'Rovai AI.app'))
const requestedFixtureRoot = resolve(process.env.ROVAI_BOOTSTRAP_ACCEPT_FIXTURE_ROOT
  ?? await mkdtemp(join(tmpdir(), 'rovai-bootstrap-shell-ui-accept-')))
await mkdir(requestedFixtureRoot, { recursive: true })
// Core rejects symlink components in managed roots; macOS /tmp and /var are aliases.
const fixtureRoot = await realpath(requestedFixtureRoot)
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

  await closeApp(running)
  running = null
  const recovery = await verifyCoreCrashRecovery()
  const optionalSubsystem = await verifyOptionalSubsystemRecovery()

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
      horizontalOverflow: false,
      automaticCoreCrashRecovery: true,
      interruptedWriteRolledBack: true,
      committedStatePreserved: true,
      structuredCrashFailureInRenderer: true,
      workspaceRemounted: true,
      optionalSubsystemDoesNotUnmountWorkspace: true,
      optionalSubsystemRetryWithoutCoreRestart: true
    },
    recovery,
    optionalSubsystem,
    captures: { day: dayCapture, nightCompact: nightCapture, recovered: recovery.capture }
  }, null, 2)}\n`)
} finally {
  if (running) await closeApp(running)
}

async function verifyCoreCrashRecovery() {
  const recoveryDataDir = assertUserDataIsIsolated(join(fixtureRoot, 'crash-recovery-user-data'))
  await mkdir(recoveryDataDir, { recursive: false })
  const coreExecutable = await realpath(join(appPath, 'Contents', 'Resources', 'bin', 'rovai-core'))
  const core = startQualificationCore({
    coreExecutable,
    dataDirectory: recoveryDataDir,
    workingDirectory: root,
    runtimeCacheDirectory: join(fixtureRoot, 'runtime-cache'),
    mcpConfigPath: join(recoveryDataDir, 'mcp.json')
  })
  let application = null
  try {
    // Initialize with the real Core, then close it before installing test-only
    // tables/triggers. Both the data dir and managed Skill Library are isolated.
    try {
      await core.request('members.list')
    } finally {
      const stopped = await core.stop()
      assert(stopped.code === 0, `Fixture Core failed: ${JSON.stringify(stopped)}`)
    }
    const recoveryDatabase = join(recoveryDataDir, 'rovai.sqlite')
    const fixture = new DatabaseSync(recoveryDatabase)
    try {
      assert(fixture.prepare('PRAGMA journal_mode').get().journal_mode === 'wal',
        'A newly initialized production database must use WAL')
      fixture.exec(`
        CREATE TABLE acceptance_crash_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
        WITH RECURSIVE rows(id) AS (
          VALUES(1) UNION ALL SELECT id + 1 FROM rows WHERE id < 1024
        ) INSERT INTO acceptance_crash_probe
          SELECT id, 'committed-' || hex(zeroblob(8192)) FROM rows;
        CREATE TRIGGER acceptance_pause_write AFTER UPDATE OF display_name ON agent_profile
        WHEN NEW.id = 'agent_1' AND NEW.display_name = 'recovery-uncommitted'
        BEGIN
          UPDATE acceptance_crash_probe SET value = 'uncommitted-' || hex(zeroblob(8192));
          SELECT sum(value) FROM (
            WITH RECURSIVE delay(value) AS (
              VALUES(0) UNION ALL SELECT value + 1 FROM delay WHERE value < 100000000
            ) SELECT value FROM delay
          );
        END;
      `)
    } finally {
      fixture.close()
    }

    application = await launchApp(recoveryDataDir)
    await waitForExpression(application.cdp, `window.rovai.supervisor.getSnapshot()
      .then(snapshot => snapshot.fullCoreState === 'ready')`, 45_000)
    await waitForSelector(application.cdp, '.app-shell', 45_000)
    await evaluate(application.cdp,
      "void (window.__workspaceBeforeCrash = document.querySelector('.app-shell'))")
    const before = await evaluate(application.cdp, 'window.rovai.supervisor.getSnapshot()', true)
    const member = await evaluate(application.cdp,
      `window.rovai.request('members.get', { agentId: 'agent_1' })`, true)
    const walPath = `${recoveryDatabase}-wal`
    const walBefore = await stat(walPath).then(metadata => metadata.size)

    await evaluate(application.cdp, `(() => {
      const member = ${JSON.stringify(member)}
      window.__crashWriteSettled = false
      window.__crashWrite = window.rovai.request('members.update', {
        commandId: crypto.randomUUID(),
        command: {
          agentId: member.agentId, expectedVersion: member.version,
          displayName: 'recovery-uncommitted', teamRole: member.teamRole,
          professionalResponsibilities: member.professionalResponsibilities,
          personalityTraits: member.personalityTraits,
          workingPrinciples: member.workingPrinciples, growthTopic: member.growthTopic
        }
      }).then(value => {
        window.__crashWriteSettled = true
        return { value }
      }, failure => {
        window.__crashWriteSettled = true
        return { failure }
      })
    })()`)

    // Wait for dirty pages to spill, not merely for a request to be enqueued.
    // The fixture trigger keeps the real Core's transaction open until SIGKILL.
    const deadline = Date.now() + 20_000
    let walBytes = walBefore
    while (walBytes < walBefore + 4 * 1024 * 1024 && Date.now() < deadline) {
      if (await evaluate(application.cdp, 'window.__crashWriteSettled')) {
        throw new Error(`Write settled before interruption: ${JSON.stringify(await evaluate(
          application.cdp, 'window.__crashWrite', true))}`)
      }
      await wait(25)
      walBytes = await stat(walPath).then(metadata => metadata.size)
    }
    assert(walBytes >= walBefore + 4 * 1024 * 1024, 'Core did not spill an active write to WAL')
    const killedPid = await killIsolatedCore(application, recoveryDataDir, coreExecutable)
    const interrupted = await evaluate(application.cdp, 'window.__crashWrite', true)
    const failure = interrupted?.failure
    assert(failure?.kind === 'infrastructure_failure'
      && failure.code === 'core_process_exited'
      && failure.retryable === true
      && failure.generation === before.generation
      && typeof failure.message === 'string'
      && failure.details?.signal === 'SIGKILL',
    `Renderer lost structured crash failure fields: ${JSON.stringify(interrupted)}`)

    await waitForExpression(application.cdp, `window.rovai.supervisor.getSnapshot().then(
      snapshot => snapshot.generation > ${before.generation}
        && snapshot.fullCoreState === 'ready'
        && snapshot.capabilities.authoritativeWorkspace
        && snapshot.capabilities.coreRequests)`, 45_000)
    await waitForSelector(application.cdp, '.app-shell', 45_000)
    assert(await evaluate(application.cdp, `!window.__workspaceBeforeCrash.isConnected
      && window.__workspaceBeforeCrash !== document.querySelector('.app-shell')`),
    'The authoritative workspace tree was not unmounted and rebuilt for the new generation')
    const after = await evaluate(application.cdp, 'window.rovai.supervisor.getSnapshot()', true)
    const recoveredMember = await evaluate(application.cdp,
      `window.rovai.request('members.get', { agentId: 'agent_1' })`, true)
    assert(recoveredMember.displayName === member.displayName
      && recoveredMember.version === member.version,
    'The interrupted member update was committed or replayed')
    // Only inspect after the restarted Core is ready; the acceptance harness
    // must not be the process that performs SQLite recovery.
    const recovered = new DatabaseSync(recoveryDatabase, { readOnly: true })
    try {
      assert(recovered.prepare(`SELECT count(*) AS count FROM acceptance_crash_probe
        WHERE value LIKE 'committed-%'`).get().count === 1024,
      'Previously committed data was not preserved')
      assert(recovered.prepare('PRAGMA quick_check').get().quick_check === 'ok',
        'Recovered SQLite database failed quick_check')
      assert(recovered.prepare('PRAGMA journal_mode').get().journal_mode === 'wal',
        'Recovered Core did not keep WAL enabled')
    } finally {
      recovered.close()
    }
    const capturePath = join(outputDir, 'bootstrap-core-crash-recovered-workspace.png')
    await capture(application.cdp, capturePath)
    return {
      dataDir: recoveryDataDir,
      killedPid,
      generationBefore: before.generation,
      generationAfter: after.generation,
      uncommittedWalBytesObserved: walBytes - walBefore,
      committedRows: 1024,
      capture: capturePath
    }
  } finally {
    if (application) await closeApp(application)
    await removeEphemeralRuntimeCampFilesRoot(recoveryDataDir, { temporaryDirectory: fixtureRoot })
  }
}

async function verifyOptionalSubsystemRecovery() {
  const optionalDataDir = assertUserDataIsIsolated(join(fixtureRoot, 'optional-subsystem-user-data'))
  await mkdir(optionalDataDir)
  const seed = startQualificationCore({
    coreExecutable: await realpath(join(appPath, 'Contents', 'Resources', 'bin', 'rovai-core')),
    dataDirectory: optionalDataDir,
    workingDirectory: root,
    runtimeCacheDirectory: join(fixtureRoot, 'runtime-cache'),
    mcpConfigPath: join(optionalDataDir, 'mcp.json')
  })
  let application = null
  try {
    try {
      await seed.request('members.list')
      await seed.request('runtime.subsystems.retry')
    } finally {
      assert((await seed.stop()).code === 0, 'Fixture Core did not stop cleanly')
    }
    seedCompletedOnboardingForAcceptance(optionalDataDir)
    const fault = join(optionalDataDir, 'managed-skill-library', '.staging')
    await rename(fault, `${fault}.original`)
    await writeFile(fault, 'retained test obstruction', { flag: 'wx', mode: 0o600 })
    application = await launchApp(optionalDataDir)
    await waitForExpression(application.cdp, `window.rovai.supervisor.getSnapshot().then(snapshot =>
      snapshot.fullCoreState === 'ready'
      && snapshot.coreSubsystems.some(subsystem => subsystem.id === 'skills' && subsystem.state === 'degraded')
      && snapshot.coreSubsystems.every(subsystem => subsystem.state !== 'initializing'))`, 45_000)
    await waitForSelector(application.cdp, '.app-shell:not(.onboarding-app-shell)', 45_000)
    await waitForSelector(application.cdp, '.core-subsystem-notice', 45_000)
    const before = await evaluate(application.cdp, 'window.rovai.supervisor.getSnapshot()', true)
    assert((await evaluate(application.cdp, `window.rovai.request('members.list')`, true)).length > 0,
      'Member authority is unavailable while Skill Library is degraded')
    await evaluate(application.cdp, 'window.rovai.request("navigation.snapshot")', true)
    const blocked = await evaluate(application.cdp,
      `window.rovai.request('skills.list').then(() => null, failure => failure)`, true)
    assert(blocked.code === 'subsystem_unavailable' && blocked.details.subsystem === 'skills'
      && blocked.generation === before.generation && blocked.retryable,
    'Renderer lost the structured feature failure across contextBridge')
    await evaluate(application.cdp, `(() => {
      window.__authorityBeforeFeatureRetry = document.querySelector('.app-shell')
      document.querySelector('.core-subsystem-notice details').open = true
      document.querySelector('.core-subsystem-notice button').focus()
    })()`)
    await setTheme(application.cdp, 'day')
    const dayCapture = join(outputDir, 'core-skill-degraded-day-1040x700.png')
    await capture(application.cdp, dayCapture)
    await application.cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 520, height: 350, deviceScaleFactor: 2, mobile: false
    })
    await application.cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
    })
    await setTheme(application.cdp, 'night')
    assert(await evaluate(application.cdp, `(() => {
      const notice = document.querySelector('.core-subsystem-notice')
      const button = notice.querySelector('button')
      return !button.disabled && document.activeElement === button
        && notice.scrollWidth <= notice.clientWidth + 1
        && notice.getBoundingClientRect().bottom <= window.innerHeight + 1
    })()`), 'The compact feature notice overflows or loses keyboard recovery')
    const nightCapture = join(outputDir, 'core-skill-degraded-night-200-percent.png')
    await capture(application.cdp, nightCapture)
    await rename(fault, `${fault}.obstruction`)
    await evaluate(application.cdp, `document.querySelector('.core-subsystem-notice button').click()`)
    await waitForExpression(application.cdp, `window.rovai.supervisor.getSnapshot().then(snapshot =>
      snapshot.coreSubsystems.find(subsystem => subsystem.id === 'skills')?.state === 'ready'
      && !document.querySelector('.core-subsystem-notice'))`, 45_000)
    const after = await evaluate(application.cdp, 'window.rovai.supervisor.getSnapshot()', true)
    assert(after.generation === before.generation && after.restartAttempt === 0
      && after.capabilities.authoritativeWorkspace && after.capabilities.coreRequests,
    'Feature retry restarted or blocked Full Core')
    assert(await evaluate(application.cdp,
      'window.__authorityBeforeFeatureRetry === document.querySelector(".app-shell")'),
    'Feature retry remounted the authority workspace')
    assert((await evaluate(application.cdp, 'window.rovai.request("skills.list")', true)).length > 0,
      'Skill Library did not recover')
    return { generation: after.generation, dataDir: optionalDataDir, captures: { day: dayCapture, night: nightCapture } }
  } finally {
    if (application) await closeApp(application)
    await removeEphemeralRuntimeCampFilesRoot(optionalDataDir, { temporaryDirectory: fixtureRoot })
  }
}

async function killIsolatedCore(application, recoveryDataDir, coreExecutable) {
  const owner = JSON.parse(await readFile(join(recoveryDataDir, '.rovai-core-instance.lock'), 'utf8'))
  assert(Number.isSafeInteger(owner.processId) && owner.processId > 1,
    'The isolated Core lock has no valid process ID')
  assert(await realpath(owner.executablePath) === coreExecutable,
    'Refusing to kill a Core outside this packaged acceptance build')
  const processInfo = execFileSync('/bin/ps', [
    '-p', String(owner.processId), '-o', 'ppid=,command='
  ], { encoding: 'utf8' }).trim()
  const match = processInfo.match(/^(\d+)\s+(.+)$/)
  const canonicalDataDir = await realpath(recoveryDataDir)
  assert(match && Number(match[1]) === application.child.pid
    && match[2].startsWith(`${coreExecutable} `)
    && [canonicalDataDir, recoveryDataDir].some(path => match[2].includes(`--data-dir ${path} `)),
  `Refusing to kill a process not owned by this isolated App: ${processInfo}`)
  process.kill(owner.processId, 'SIGKILL')
  return owner.processId
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
  assert(state.title === '暂时无法打开会话' && !state.authoritativeTree,
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

async function launchApp(userData = dataDir) {
  const executable = join(appPath, 'Contents', 'MacOS', 'Rovai AI')
  const stderr = []
  const child = spawn(executable, [
    '--no-sandbox',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userData}`
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
