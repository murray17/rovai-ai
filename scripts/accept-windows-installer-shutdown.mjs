import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, openSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Windows installer shutdown acceptance requires a native Windows x64 host')
}

const root = resolve(import.meta.dirname, '..')
const packageMetadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const executableName = `${packageMetadata.build.win.executableName ?? packageMetadata.build.productName}.exe`
const executable = resolve(process.argv[2] ?? join(root, 'dist', 'win-unpacked', executableName))
const installDirectory = dirname(executable)
const core = join(installDirectory, 'resources', 'bin', 'rovai-core.exe')
const coordinator = join(root, 'build', 'installer-process-coordinator.ps1')
const fixtureRoot = await mkdtemp(join(tmpdir(), 'rovai-installer-shutdown-accept-'))
const dataRoot = join(fixtureRoot, 'user-data')
const outputDirectory = join(root, 'dist', 'windows-installer-shutdown-acceptance')
const reportPath = join(outputDirectory, 'report.json')
const stderrPath = join(fixtureRoot, 'packaged-app-stderr.log')
const stdoutPath = join(fixtureRoot, 'packaged-app-stdout.log')

for (const path of [executable, core, coordinator]) {
  if (!existsSync(path)) throw new Error(`Windows installer shutdown acceptance input is missing: ${path}`)
}
await mkdir(outputDirectory, { recursive: true })

const report = {
  schemaVersion: 1,
  executable,
  installDirectory,
  fixtureRoot,
  processCount: 0,
  elapsedMs: null,
  exitCode: null,
  shutdownStatus: null,
  forcedSignal: null,
  result: 'running'
}
let app = null

try {
  const initialStatus = runCoordinator('Status')
  if (initialStatus.status !== 0) {
    throw new Error(
      `refusing to share an unpacked App tree with another process: ${combinedOutput(initialStatus)}`
    )
  }

  run(core, ['--prepare-windows-data-root', dataRoot])
  app = launchApp()
  await waitForMainWindow(app.pid)
  const running = await waitForProcessTree(app.pid)
  report.processCount = running.processIds.length

  const shutdownStartedAt = Date.now()
  const requested = runCoordinator('RequestClose')
  if (requested.status !== 0) {
    throw new Error(`installer coordinator could not request graceful close: ${combinedOutput(requested)}`)
  }
  const request = parseCoordinatorOutput(requested.stdout)
  if (!request.processIds.includes(app.pid)) {
    throw new Error(`installer coordinator did not target the App main window: ${requested.stdout}`)
  }

  const waited = runCoordinator('WaitForExit', 20_000)
  if (waited.status !== 0) {
    throw new Error(`installer coordinator did not reach quiescence: ${combinedOutput(waited)}`)
  }
  await waitForProcessesExited(running.processIds, 1_000)
  report.elapsedMs = Date.now() - shutdownStartedAt
  report.exitCode = await waitForChildExit(app, 1_000)
  if (report.exitCode !== 0) {
    throw new Error(`packaged App did not exit naturally: ${report.exitCode}`)
  }

  const shutdown = parseShutdownResult(await readFile(stderrPath, 'utf8'))
  report.shutdownStatus = shutdown?.report?.status ?? null
  report.forcedSignal = shutdown?.forcedSignal ?? null
  if (shutdown?.forcedSignal !== null || shutdown?.report?.status !== 'completed') {
    throw new Error(`packaged App did not complete Planned Shutdown: ${JSON.stringify(shutdown)}`)
  }

  await waitForCoordinatorQuiescence()
  report.result = 'passed'
} catch (error) {
  report.result = 'failed'
  report.error = error instanceof Error ? error.stack ?? error.message : String(error)
  process.exitCode = 1
} finally {
  if (app?.pid && isProcessAlive(app.pid)) {
    runCoordinator('ForceClose')
    await waitForProcessesExited([app.pid], 5_000).catch(() => undefined)
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  if (report.result === 'passed') {
    await rm(fixtureRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  } else {
    process.stderr.write(`Preserved failed acceptance fixture: ${fixtureRoot}\n`)
  }
}

if (process.exitCode) {
  console.error(`Windows installer shutdown acceptance failed; report: ${reportPath}`)
} else {
  console.log(`Windows installer shutdown acceptance passed; report: ${reportPath}`)
}

function launchApp() {
  const stdoutHandle = openSync(stdoutPath, 'w')
  const stderrHandle = openSync(stderrPath, 'w')
  try {
    return spawn(executable, [`--user-data-dir=${dataRoot}`], {
      cwd: installDirectory,
      env: {
        ...process.env,
        ROVAI_ALLOW_ISOLATED_INSTANCE: '1'
      },
      stdio: ['ignore', stdoutHandle, stderrHandle]
    })
  } finally {
    closeSync(stdoutHandle)
    closeSync(stderrHandle)
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${basename(command)} failed (${result.status}): ${combinedOutput(result)}`)
  }
  return result
}

function runCoordinator(action, timeoutMilliseconds = null) {
  const arguments_ = [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    coordinator,
    '-Action',
    action,
    '-InstallDirectory',
    installDirectory,
    '-ExecutableName',
    executableName,
    '-ExcludeProcessId',
    String(process.pid)
  ]
  if (timeoutMilliseconds !== null) {
    arguments_.push('-TimeoutMilliseconds', String(timeoutMilliseconds))
  }
  return spawnSync('powershell.exe', arguments_, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true
  })
}

async function waitForMainWindow(processId, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  const script = [
    '$process = Get-Process -Id ([int]$env:ROVAI_ACCEPT_PID) -ErrorAction SilentlyContinue',
    'if ($null -ne $process -and $process.MainWindowHandle -ne 0) { exit 0 }',
    'exit 1'
  ].join('; ')
  while (Date.now() < deadline) {
    if (!isProcessAlive(processId)) throw new Error('packaged App exited before creating its main window')
    const result = spawnSync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script
    ], {
      cwd: root,
      env: { ...process.env, ROVAI_ACCEPT_PID: String(processId) },
      windowsHide: true,
      stdio: 'ignore'
    })
    if (!result.error && result.status === 0) return
    await delay(250)
  }
  throw new Error('packaged App did not create its main window')
}

async function waitForProcessTree(appProcessId, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let status = null
  while (Date.now() < deadline) {
    status = runCoordinator('Status')
    if (status.status === 10) {
      const event = parseCoordinatorOutput(status.stdout)
      if (event.processIds.includes(appProcessId) && event.processIds.length >= 4) return event
    } else if (status.status !== 0) {
      throw new Error(`installer coordinator could not identify the App tree: ${combinedOutput(status)}`)
    }
    await delay(250)
  }
  throw new Error(`packaged App process tree was not ready: ${combinedOutput(status)}`)
}

async function waitForCoordinatorQuiescence(timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  let status = null
  while (Date.now() < deadline) {
    status = runCoordinator('Status')
    if (status.status === 0) return
    if (status.status !== 10) {
      throw new Error(`installer coordinator could not prove quiescence: ${combinedOutput(status)}`)
    }
    await delay(50)
  }
  throw new Error(`installer coordinator did not reach quiescence: ${combinedOutput(status)}`)
}

function parseCoordinatorOutput(output) {
  const lines = String(output).trim().split(/\r?\n/u).filter(Boolean)
  if (lines.length !== 1) throw new Error(`invalid installer coordinator output: ${output}`)
  const event = JSON.parse(lines[0])
  if (!Array.isArray(event.processIds)) throw new Error(`invalid installer coordinator event: ${output}`)
  return event
}

function parseShutdownResult(log) {
  const prefix = '[rovai-core] controlled shutdown result '
  const line = log.split(/\r?\n/u).findLast((candidate) => candidate.includes(prefix))
  if (!line) return null
  try {
    return JSON.parse(line.slice(line.indexOf(prefix) + prefix.length))
  } catch {
    return null
  }
}

async function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null) return child.exitCode
  return Promise.race([
    new Promise((resolveExit) => child.once('exit', (code) => resolveExit(code))),
    delay(timeoutMs).then(() => {
      throw new Error('packaged App child exit event did not settle')
    })
  ])
}

async function waitForProcessesExited(processIds, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (processIds.every((processId) => !isProcessAlive(processId))) return
    await delay(50)
  }
  const remaining = processIds.filter(isProcessAlive)
  throw new Error(`packaged App left processes alive: ${remaining.join(', ')}`)
}

function isProcessAlive(processId) {
  if (!processId) return false
  try {
    process.kill(processId, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function combinedOutput(result) {
  return `${result?.stdout ?? ''}${result?.stderr ?? ''}`.trim()
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}
