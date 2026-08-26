import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  createReadStream
} from 'node:fs'
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { release, tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { parse as parseYaml } from 'yaml'
import { inspectPortableExecutable } from './lib/windows-pe.mjs'
import { coreDataDirectoryArguments } from './lib/runtime-camp-files-root.mjs'

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Windows release verification requires a native Windows x64 host')
}

const root = resolve(import.meta.dirname, '..')
const dist = join(root, 'dist')
const packageMetadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const requireSigned = process.argv.includes('--require-signed')
const unpackedOnly = process.argv.includes('--unpacked-only')
const appDirectory = join(dist, 'win-unpacked')
const executableName = packageMetadata.build.win.executableName ?? packageMetadata.build.productName
const appExecutable = join(appDirectory, `${executableName}.exe`)
const coreExecutable = join(appDirectory, 'resources', 'bin', 'rovai-core.exe')
const cliExecutable = join(appDirectory, 'resources', 'bin', 'rovai.exe')
const installer = join(
  dist,
  artifactName('exe')
)
const installerBlockmap = `${installer}.blockmap`
const updateInfoPath = join(dist, 'latest.yml')
const installerIncludePath = join(root, 'build', 'installer.nsh')
const installerCoordinatorPath = join(root, 'build', 'installer-process-coordinator.ps1')
const reportPath = join(dist, 'windows-verification-report.txt')
const manifestPath = join(dist, 'windows-release-manifest.json')
const report = ['Rovai AI Windows x64 verification']
let isolatedParent = null
let core = null

function artifactName(extension) {
  return packageMetadata.build.win.artifactName
    .replaceAll('${productName}', packageMetadata.build.productName)
    .replaceAll('${name}', packageMetadata.name)
    .replaceAll('${version}', packageMetadata.version)
    .replaceAll('${arch}', 'x64')
    .replaceAll('${ext}', extension)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    ...options
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${basename(command)} failed (${result.status}): ${output}`)
  }
  return output
}

async function sha256(path) {
  return fileHash(path, 'sha256', 'hex')
}

async function sha512(path) {
  return fileHash(path, 'sha512', 'base64')
}

async function fileHash(path, algorithm, encoding) {
  const hash = createHash(algorithm)
  await new Promise((resolveHash, rejectHash) => {
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .once('error', rejectHash)
      .once('end', resolveHash)
  })
  return hash.digest(encoding)
}

async function verifyUpdateArtifacts() {
  const packagedUpdateInfoPath = join(appDirectory, 'resources', 'app-update.yml')
  if (!existsSync(packagedUpdateInfoPath)) {
    throw new Error(`packaged app-update.yml is missing: ${packagedUpdateInfoPath}`)
  }
  const packagedUpdateInfo = parseYaml(await readFile(packagedUpdateInfoPath, 'utf8'))
  if (packagedUpdateInfo?.provider !== 'github'
      || packagedUpdateInfo.owner !== 'murray17'
      || packagedUpdateInfo.repo !== 'rovai-ai') {
    throw new Error('packaged app-update.yml does not target the official GitHub release channel')
  }
  report.push('Packaged updater channel: github/murray17/rovai-ai')
  if (unpackedOnly) return null

  if (!existsSync(installerBlockmap)) {
    throw new Error(`NSIS updater blockmap is missing: ${installerBlockmap}`)
  }
  if (!existsSync(updateInfoPath)) {
    throw new Error(`Windows latest.yml is missing: ${updateInfoPath}`)
  }
  const updateInfo = parseYaml(await readFile(updateInfoPath, 'utf8'))
  if (!updateInfo || updateInfo.version !== packageMetadata.version) {
    throw new Error('latest.yml has the wrong version')
  }
  const installerName = basename(installer)
  const installerEntry = Array.isArray(updateInfo.files)
    ? updateInfo.files.find((entry) => entry?.url === installerName)
    : null
  if (!installerEntry || installerEntry.sha512 !== await sha512(installer)) {
    throw new Error(`latest.yml has the wrong sha512 for ${installerName}`)
  }
  if (Number(installerEntry.size) !== (await stat(installer)).size) {
    throw new Error(`latest.yml has the wrong size for ${installerName}`)
  }
  const blockmapSize = (await stat(installerBlockmap)).size
  if (blockmapSize <= 0) throw new Error('NSIS updater blockmap is empty')
  report.push('latest.yml: version, sha512 and size passed')
  report.push(`NSIS updater blockmap: ${relative(root, installerBlockmap)}`)
  return {
    updateInfo: {
      path: relative(root, updateInfoPath).replaceAll('\\', '/'),
      bytes: (await stat(updateInfoPath)).size,
      sha256: await sha256(updateInfoPath)
    },
    blockmap: {
      path: relative(root, installerBlockmap).replaceAll('\\', '/'),
      bytes: blockmapSize,
      sha256: await sha256(installerBlockmap)
    }
  }
}

function authenticode(path) {
  const script = [
    "$signature = Get-AuthenticodeSignature -LiteralPath $env:ROVAI_VERIFY_TARGET",
    "$signer = if ($null -eq $signature.SignerCertificate) { $null } else { $signature.SignerCertificate.GetCertHashString('SHA256') }",
    "$timestamp = if ($null -eq $signature.TimeStamperCertificate) { $null } else { $signature.TimeStamperCertificate.GetCertHashString('SHA256') }",
    '[pscustomobject]@{ Status = [string]$signature.Status; SignerSha256 = $signer; TimestampSha256 = $timestamp } | ConvertTo-Json -Compress'
  ].join('; ')
  const output = run('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script
  ], { env: windowsPowerShellEnvironment({ ROVAI_VERIFY_TARGET: path }) })
  try {
    return JSON.parse(output)
  } catch (error) {
    throw new Error(
      `Authenticode probe returned invalid JSON for ${basename(path)}: ${JSON.stringify(output)}`,
      { cause: error }
    )
  }
}

function windowsPowerShellEnvironment(overrides = {}) {
  const environment = { ...process.env, ...overrides }
  for (const key of Object.keys(environment)) {
    if (key.toLowerCase() === 'psmodulepath') delete environment[key]
  }
  return environment
}

function verifySignature(label, path) {
  const signature = authenticode(path)
  if (!requireSigned) {
    if (signature.Status !== 'NotSigned') {
      throw new Error(`${label} unsigned artifact has unexpected Authenticode status ${signature.Status}`)
    }
    return signature
  }
  if (signature.Status !== 'Valid' || !signature.SignerSha256 || !signature.TimestampSha256) {
    throw new Error(`${label} does not have a valid timestamped Authenticode signature`)
  }
  const allowlist = (process.env.ROVAI_WINDOWS_SIGNER_SHA256 ?? '')
    .split(',')
    .map((value) => value.replace(/\s|:/g, '').toUpperCase())
    .filter(Boolean)
  if (allowlist.length === 0) throw new Error('ROVAI_WINDOWS_SIGNER_SHA256 allowlist is required')
  if (!allowlist.includes(signature.SignerSha256.toUpperCase())) {
    throw new Error(`${label} signer certificate is not in ROVAI_WINDOWS_SIGNER_SHA256`)
  }
  return signature
}

async function verifyInstallerConfiguration() {
  const nsis = packageMetadata.build?.nsis
  const expected = {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    packElevateHelper: false,
    allowToChangeInstallationDirectory: true,
    include: 'build/installer.nsh'
  }
  for (const [key, value] of Object.entries(expected)) {
    if (nsis?.[key] !== value) {
      throw new Error(`NSIS ${key} must be ${value} for the selectable per-user installer`)
    }
  }
  const [installerInclude, coordinator] = await Promise.all([
    readFile(installerIncludePath, 'utf8'),
    readFile(installerCoordinatorPath, 'utf8')
  ])
  const pollMs = nsisDefineNumber(installerInclude, 'ROVAI_SHUTDOWN_POLL_MS')
  const gracefulMs = nsisDefineNumber(installerInclude, 'ROVAI_GRACEFUL_SHUTDOWN_MS')
  const forceMs = nsisDefineNumber(installerInclude, 'ROVAI_FORCE_SHUTDOWN_MS')
  const gracefulTicks = nsisDefineNumber(installerInclude, 'ROVAI_GRACEFUL_SHUTDOWN_TICKS')
  const forceTicks = nsisDefineNumber(installerInclude, 'ROVAI_FORCE_SHUTDOWN_TICKS')
  if (gracefulMs !== 20_000
      || forceMs !== 5_000
      || pollMs * gracefulTicks !== gracefulMs
      || pollMs * forceTicks !== forceMs) {
    throw new Error('NSIS running-App shutdown budgets must remain 20s graceful plus 5s forced')
  }
  for (const required of [
    '!macro customCheckAppRunning',
    'ROVAI_REQUEST_GRACEFUL_CLOSE',
    'ROVAI_WAIT_FOR_QUIESCENCE ${ROVAI_GRACEFUL_SHUTDOWN_MS} ${ROVAI_GRACEFUL_SHUTDOWN_TICKS}',
    'Refusing to force-close a process whose installation path could not be verified',
    '!macro customUnInstallCheck'
  ]) {
    if (!installerInclude.includes(required)) {
      throw new Error(`NSIS running-App coordinator is missing ${required}`)
    }
  }
  if (installerInclude.includes('!insertmacro KILL_PROCESS')) {
    throw new Error('NSIS running-App fallback must not force-close a path-unverified process')
  }
  for (const required of [
    "[ValidateSet('Status', 'RequestClose', 'WaitForExit', 'ForceClose')]",
    '[System.Diagnostics.Stopwatch]::StartNew()',
    '.CloseMainWindow()',
    'Stop-Process -Id $processId -Force',
    'Test-ManagedProcessIdentity -ProcessInfo $current',
    '[System.StringComparison]::OrdinalIgnoreCase'
  ]) {
    if (!coordinator.includes(required)) {
      throw new Error(`installer process coordinator is missing ${required}`)
    }
  }

  report.push('NSIS configuration: assisted per-user install, selectable destination, 20s controlled shutdown and bounded force close passed')
  return {
    assisted: true,
    perMachine: false,
    allowElevation: false,
    selectableInstallationDirectory: true,
    runningAppUpgrade: {
      gracefulShutdownMs: gracefulMs,
      forceCloseWaitMs: forceMs,
      exactInstallTree: true,
      oldUninstallerFailureSeparated: true
    }
  }
}

function nsisDefineNumber(source, name) {
  const match = source.match(new RegExp(`^!define ${name} (\\d+)$`, 'mu'))
  if (!match) throw new Error(`NSIS include is missing numeric define ${name}`)
  return Number(match[1])
}

async function verifyBinary(label, path) {
  if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`)
  const pe = await inspectPortableExecutable(path)
  if (pe.machine !== 0x8664) throw new Error(`${label} is ${pe.machineHex}, expected x64 0x8664`)
  for (const type of [3, 14, 16, 24]) {
    if (!pe.resourceTypes.includes(type)) throw new Error(`${label} is missing PE resource type ${type}`)
  }
  if (pe.manifests.length !== 1) {
    throw new Error(`${label} must contain exactly one application manifest`)
  }
  const applicationManifest = pe.manifests[0]
  if (!/<requestedExecutionLevel\b[^>]*\blevel=["']asInvoker["']/i.test(applicationManifest)) {
    throw new Error(`${label} manifest is not asInvoker`)
  }
  if (!/<longPathAware\b[^>]*>\s*true\s*<\/longPathAware>/i.test(applicationManifest)) {
    throw new Error(`${label} manifest is not longPathAware`)
  }
  if (!/<dpiAwareness\b[^>]*>\s*PerMonitorV2,PerMonitor\s*<\/dpiAwareness>/i.test(applicationManifest)) {
    throw new Error(`${label} manifest is not PerMonitorV2 aware`)
  }
  const signature = verifySignature(label, path)
  const file = {
    path: relative(root, path).replaceAll('\\', '/'),
    bytes: (await stat(path)).size,
    sha256: await sha256(path),
    machine: pe.machineHex,
    format: pe.format,
    resourceTypes: pe.resourceTypes,
    manifest: {
      requestedExecutionLevel: 'asInvoker',
      longPathAware: true,
      dpiAwareness: 'PerMonitorV2,PerMonitor'
    },
    authenticode: signature
  }
  report.push(`${label}: x64, manifest/resources passed, sha256=${file.sha256}`)
  return file
}

function startCore(executable, dataDirectory) {
  const child = spawn(executable, [
    ...coreDataDirectoryArguments(dataDirectory),
    '--skill-library-root', join(dataDirectory, 'managed-skill-library')
  ], {
    cwd: appDirectory,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let nextId = 1
  let stderr = ''
  const pending = new Map()
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-16_384) })
  createInterface({ input: child.stdout }).on('line', (line) => {
    let message
    try {
      message = JSON.parse(line)
    } catch (error) {
      for (const request of pending.values()) request.reject(error)
      pending.clear()
      return
    }
    if (message.method) return
    const request = pending.get(message.id)
    if (!request) return
    clearTimeout(request.timer)
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  })
  return {
    request(method, params = {}) {
      return new Promise((resolveRequest, rejectRequest) => {
        const id = nextId++
        const timer = setTimeout(() => {
          pending.delete(id)
          rejectRequest(new Error(`timed out waiting for ${method}; stderr=${stderr}`))
        }, 30_000)
        pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer })
        child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
      })
    },
    async stop() {
      if (child.exitCode !== null) return
      child.stdin.end()
      await Promise.race([
        new Promise((resolveClose) => child.once('close', resolveClose)),
        new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000))
      ])
      if (child.exitCode === null) child.kill()
    }
  }
}

try {
  const installerConfiguration = await verifyInstallerConfiguration()
  const updaterArtifacts = await verifyUpdateArtifacts()
  const binaries = {
    app: await verifyBinary('App', appExecutable),
    core: await verifyBinary('rovai-core', coreExecutable),
    cli: await verifyBinary('rovai', cliExecutable)
  }
  const cliVersion = run(cliExecutable, ['--version'])
  if (!cliVersion.includes(`rovai ${packageMetadata.version} contract-v20 ipc-v2`)) {
    throw new Error(`unexpected packaged CLI version: ${cliVersion}`)
  }
  report.push(`CLI: ${cliVersion}`)

  isolatedParent = await mkdtemp(join(tmpdir(), 'rovai-windows-verifier-'))
  const dataRoot = join(isolatedParent, 'data-root')
  const prepared = JSON.parse(run(coreExecutable, ['--prepare-windows-data-root', dataRoot]))
  if (resolve(prepared.root) !== resolve(dataRoot)) throw new Error('Core prepared the wrong isolated data root')
  core = startCore(coreExecutable, join(dataRoot, 'Core'))
  const health = await core.request('health.check')
  if (health?.core?.ok !== true
      || health.core.version !== packageMetadata.version
      || health.core.builtinToolContractVersion !== 20
      || health.core.builtinToolIpcProtocolVersion !== 2) {
    throw new Error(`packaged Core health is incompatible: ${JSON.stringify(health?.core)}`)
  }
  report.push('Packaged Core: isolated Windows data-root preparation and health.check passed')

  let installerFile = null
  if (!unpackedOnly) {
    if (!existsSync(installer)) throw new Error(`NSIS installer is missing: ${installer}`)
    installerFile = {
      path: relative(root, installer).replaceAll('\\', '/'),
      bytes: (await stat(installer)).size,
      sha256: await sha256(installer),
      authenticode: verifySignature('NSIS installer', installer)
    }
    report.push(`NSIS installer: sha256=${installerFile.sha256}`)
  }

  const gitCommit = run('git.exe', ['rev-parse', 'HEAD'])
  const gitDirty = run('git.exe', ['status', '--porcelain']).length > 0
  const releaseManifest = {
    schemaVersion: 1,
    verifierVersion: 1,
    createdAt: new Date().toISOString(),
    source: { commit: gitCommit, dirty: gitDirty },
    target: { platform: 'windows', arch: 'x64', rustTarget: 'x86_64-pc-windows-msvc' },
    package: { name: packageMetadata.name, productName: packageMetadata.build.productName, version: packageMetadata.version },
    toolchain: {
      node: process.version,
      pnpm: packageMetadata.packageManager,
      rustc: run('rustc.exe', ['-Vv']),
      windows: `${process.platform} ${release()}`
    },
    locks: {
      packageJsonSha256: await sha256(join(root, 'package.json')),
      pnpmLockSha256: await sha256(join(root, 'pnpm-lock.yaml'))
    },
    signedReleaseRequired: requireSigned,
    installerConfiguration,
    files: { ...binaries, installer: installerFile, updater: updaterArtifacts },
    packagedCoreSmoke: {
      isolatedDataRoot: true,
      healthCheck: true,
      builtinToolContractVersion: 20,
      builtinToolIpcProtocolVersion: 2
    }
  }
  await writeFile(manifestPath, `${JSON.stringify(releaseManifest, null, 2)}\n`, 'utf8')
  report.push(`Release manifest: ${relative(root, manifestPath)}`)
  report.push('Result: passed')
} catch (error) {
  report.push(`Result: failed - ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  if (core) await core.stop().catch(() => undefined)
  if (isolatedParent) await rm(isolatedParent, { recursive: true, force: true })
  await writeFile(reportPath, `${report.join('\n')}\n`, 'utf8')
}

if (process.exitCode) {
  console.error(`Windows verification failed; report: ${reportPath}`)
} else {
  console.log(`Windows verification passed; report: ${reportPath}`)
}
