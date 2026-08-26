import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..', '..')
const installerIncludePath = join(root, 'build', 'installer.nsh')
const coordinatorPath = join(root, 'build', 'installer-process-coordinator.ps1')
const acceptancePath = join(root, 'scripts', 'accept-windows-installer-shutdown.mjs')
const installationAcceptancePath = join(root, 'scripts', 'accept-windows-installation.mjs')

test('Windows installer grants Planned Shutdown its full budget before bounded force close', async () => {
  const [installerInclude, coordinator, acceptance, installationAcceptance] = await Promise.all([
    readFile(installerIncludePath, 'utf8'),
    readFile(coordinatorPath, 'utf8'),
    readFile(acceptancePath, 'utf8'),
    readFile(installationAcceptancePath, 'utf8')
  ])
  const pollMs = nsisDefineNumber(installerInclude, 'ROVAI_SHUTDOWN_POLL_MS')
  const gracefulMs = nsisDefineNumber(installerInclude, 'ROVAI_GRACEFUL_SHUTDOWN_MS')
  const forceMs = nsisDefineNumber(installerInclude, 'ROVAI_FORCE_SHUTDOWN_MS')
  const gracefulTicks = nsisDefineNumber(installerInclude, 'ROVAI_GRACEFUL_SHUTDOWN_TICKS')
  const forceTicks = nsisDefineNumber(installerInclude, 'ROVAI_FORCE_SHUTDOWN_TICKS')

  assert.equal(gracefulMs, 20_000)
  assert.equal(forceMs, 5_000)
  assert.equal(pollMs * gracefulTicks, 20_000)
  assert.equal(pollMs * forceTicks, 5_000)
  assert.match(installerInclude, /!macro customCheckAppRunning/u)
  assert.match(installerInclude, /ROVAI_REQUEST_GRACEFUL_CLOSE/u)
  assert.match(installerInclude, /ROVAI_WAIT_FOR_QUIESCENCE \$\{ROVAI_GRACEFUL_SHUTDOWN_MS\} \$\{ROVAI_GRACEFUL_SHUTDOWN_TICKS\}/u)
  assert.match(
    installerInclude,
    /\$rovaiShutdownTicks >= \$\{TICKS\}[\s\S]+Sleep \$\{ROVAI_SHUTDOWN_POLL_MS\}[\s\S]+IntOp \$rovaiShutdownTicks \$rovaiShutdownTicks \+ 1/u
  )
  assert.match(installerInclude, /ROVAI_FORCE_CLOSE/u)
  assert.match(installerInclude, /!macro customUnInstallCheck/u)
  assert.match(installerInclude, /previous uninstaller may have failed/u)
  assert.match(installerInclude, /Refusing to force-close a process whose installation path could not be verified/u)
  assert.doesNotMatch(installerInclude, /!insertmacro KILL_PROCESS/u)

  assert.match(coordinator, /\[ValidateSet\('Status', 'RequestClose', 'WaitForExit', 'ForceClose'\)\]/u)
  assert.match(coordinator, /System\.Diagnostics\.Stopwatch/u)
  assert.match(coordinator, /\.CloseMainWindow\(\)/u)
  assert.match(coordinator, /Stop-Process -Id \$processId -Force/u)
  assert.match(coordinator, /Test-ManagedProcessIdentity -ProcessInfo \$current/u)
  assert.match(coordinator, /GetFullPath\(\$CandidatePath\)/u)
  assert.match(coordinator, /StringComparison\]::OrdinalIgnoreCase/u)
  assert.doesNotMatch(coordinator, /StartsWith\(\$normalizedInstallDirectory/u)

  assert.match(acceptance, /--prepare-windows-data-root/u)
  assert.match(acceptance, /runCoordinator\('RequestClose'\)/u)
  assert.match(acceptance, /shutdown\?\.report\?\.status !== 'completed'/u)
  assert.match(acceptance, /runCoordinator\('WaitForExit', 20_000\)/u)

  assert.match(installationAcceptance, /ROVAI_WINDOWS_UPGRADE_BASE_INSTALLER/u)
  assert.match(installationAcceptance, /compareReleaseVersions\(baselineVersion, packageMetadata\.version\) >= 0/u)
  assert.match(installationAcceptance, /running-App upgrade did not observe a natural Planned Shutdown/u)
})

test('Windows installer coordinator targets an exact installation tree', {
  skip: process.platform !== 'win32'
}, async (context) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'rovai-installer-process-'))
  const installDirectory = join(fixtureRoot, 'Rovai AI')
  const siblingDirectory = join(fixtureRoot, 'Rovai AI-old')
  await Promise.all([
    mkdir(installDirectory),
    mkdir(siblingDirectory)
  ])

  const systemPing = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'ping.exe')
  const installedExecutable = join(installDirectory, 'Rovai-ai.exe')
  const unrelatedExecutable = join(installDirectory, 'unrelated.exe')
  const siblingExecutable = join(siblingDirectory, 'Rovai-ai.exe')
  await Promise.all([
    copyFile(systemPing, installedExecutable),
    copyFile(systemPing, unrelatedExecutable),
    copyFile(systemPing, siblingExecutable)
  ])

  const installedProcess = spawn(installedExecutable, ['-t', '127.0.0.1'], {
    windowsHide: true,
    stdio: 'ignore'
  })
  const unrelatedProcess = spawn(unrelatedExecutable, ['-t', '127.0.0.1'], {
    windowsHide: true,
    stdio: 'ignore'
  })
  const siblingProcess = spawn(siblingExecutable, ['-t', '127.0.0.1'], {
    windowsHide: true,
    stdio: 'ignore'
  })

  context.after(async () => {
    for (const child of [installedProcess, unrelatedProcess, siblingProcess]) {
      if (isProcessAlive(child.pid)) {
        spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore'
        })
      }
    }
    await waitForProcessExit(installedProcess.pid, 5_000).catch(() => undefined)
    await waitForProcessExit(unrelatedProcess.pid, 5_000).catch(() => undefined)
    await waitForProcessExit(siblingProcess.pid, 5_000).catch(() => undefined)
    await rm(fixtureRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  await waitForCoordinatorStatus(installDirectory, 10)
  await waitForCoordinatorStatus(siblingDirectory, 10)

  const waiting = runCoordinator('WaitForExit', installDirectory, 100)
  assert.equal(waiting.status, 10, combinedOutput(waiting))

  const forced = runCoordinator('ForceClose', installDirectory)
  assert.equal(forced.status, 0, combinedOutput(forced))
  await waitForProcessExit(installedProcess.pid, 5_000)
  assert.equal(isProcessAlive(unrelatedProcess.pid), true, 'same-directory unrelated process was force-closed')
  assert.equal(isProcessAlive(siblingProcess.pid), true, 'prefix-sibling process was force-closed')

  await waitForCoordinatorStatus(installDirectory, 0)
  await waitForCoordinatorStatus(siblingDirectory, 10)
})

function nsisDefineNumber(source, name) {
  const match = source.match(new RegExp(`^!define ${name} (\\d+)$`, 'mu'))
  assert.ok(match, `missing NSIS numeric define ${name}`)
  return Number(match[1])
}

function runCoordinator(action, installDirectory, timeoutMilliseconds = null) {
  const arguments_ = [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-File',
    coordinatorPath,
    '-Action',
    action,
    '-InstallDirectory',
    `${installDirectory}\\.`,
    '-ExecutableName',
    'Rovai-ai.exe',
    '-ExcludeProcessId',
    '0'
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

async function waitForCoordinatorStatus(installDirectory, expectedStatus, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  let result = null
  while (Date.now() < deadline) {
    result = runCoordinator('Status', installDirectory)
    if (!result.error && result.status === expectedStatus) return
    await delay(100)
  }
  if (result?.error) throw result.error
  assert.equal(result?.status, expectedStatus, combinedOutput(result))
}

async function waitForProcessExit(processId, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isProcessAlive(processId)) return
    await delay(50)
  }
  throw new Error(`process ${processId} did not exit within ${timeoutMs}ms`)
}

function isProcessAlive(processId) {
  if (!processId) return false
  try {
    process.kill(processId, 0)
    return true
  } catch {
    return false
  }
}

function combinedOutput(result) {
  return `${result?.stdout ?? ''}${result?.stderr ?? ''}`.trim()
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}
