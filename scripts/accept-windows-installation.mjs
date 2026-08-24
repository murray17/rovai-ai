import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Windows installer acceptance requires a native Windows x64 host')
}

const root = resolve(import.meta.dirname, '..')
const packageMetadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const executableName = packageMetadata.build.win.executableName ?? packageMetadata.build.productName
const installer = join(
  root,
  'dist',
  packageMetadata.build.win.artifactName
    .replaceAll('${productName}', packageMetadata.build.productName)
    .replaceAll('${name}', packageMetadata.name)
    .replaceAll('${version}', packageMetadata.version)
    .replaceAll('${arch}', 'x64')
    .replaceAll('${ext}', 'exe')
)
if (!existsSync(installer)) throw new Error(`Windows installer is missing: ${installer}`)

const preexisting = installedRovaiEntries()
if (preexisting.length > 0) {
  throw new Error(`refusing to replace an existing Rovai installation: ${JSON.stringify(preexisting)}`)
}

const programRoot = join(process.env.LOCALAPPDATA ?? '', 'Programs')
const installCandidates = [
  join(programRoot, packageMetadata.build.productName),
  join(programRoot, packageMetadata.name),
  join(programRoot, 'Rovai AI')
]
if (installCandidates.some((candidate) => existsSync(candidate))) {
  throw new Error('refusing to replace a pre-existing Rovai program directory')
}

const fixtureRoot = await mkdtemp(join(tmpdir(), 'rovai-windows-install-accept-'))
const outputRoot = join(root, 'dist', 'windows-installation-acceptance')
const reportPath = join(outputRoot, 'installation-report.json')
await mkdir(outputRoot, { recursive: true })
const report = {
  schemaVersion: 1,
  installer,
  fixtureRoot,
  outputRoot,
  cleanInstall: false,
  onboarding: 'not_run',
  upgrade: false,
  defaultUninstallRetainedData: false,
  installedFiles: {},
  result: 'running'
}
let installDirectory = null

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    ...options
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
    throw new Error(`${basename(command)} failed (${result.status}): ${output}`)
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
}

function installedRovaiEntries() {
  const script = [
    "$entries = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue",
    "$entries = @($entries | Where-Object { $_.DisplayName -like '*Rovai*' } | Select-Object DisplayName, DisplayVersion, InstallLocation, UninstallString)",
    '$entries | ConvertTo-Json -Compress'
  ].join('; ')
  const output = run('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script
  ], { env: windowsPowerShellEnvironment() })
  if (!output) return []
  const parsed = JSON.parse(output)
  return Array.isArray(parsed) ? parsed : [parsed]
}

function windowsPowerShellEnvironment() {
  const environment = { ...process.env }
  for (const key of Object.keys(environment)) {
    if (key.toLowerCase() === 'psmodulepath') delete environment[key]
  }
  return environment
}

async function sha256(path) {
  const hash = createHash('sha256')
  await new Promise((resolveHash, rejectHash) => {
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .once('error', rejectHash)
      .once('end', resolveHash)
  })
  return hash.digest('hex')
}

async function locateInstallation() {
  const registryDirectory = installedRovaiEntries()
    .map((entry) => entry.InstallLocation)
    .find((value) => typeof value === 'string' && value.length > 0)
  const candidates = registryDirectory ? [registryDirectory, ...installCandidates] : installCandidates
  return candidates.find((candidate) => (
    existsSync(join(candidate, `${executableName}.exe`))
  )) ?? null
}

async function installedFileEvidence(directory) {
  const files = {
    app: join(directory, `${executableName}.exe`),
    core: join(directory, 'resources', 'bin', 'rovai-core.exe'),
    cli: join(directory, 'resources', 'bin', 'rovai.exe')
  }
  const unpacked = {
    app: join(root, 'dist', 'win-unpacked', `${executableName}.exe`),
    core: join(root, 'dist', 'win-unpacked', 'resources', 'bin', 'rovai-core.exe'),
    cli: join(root, 'dist', 'win-unpacked', 'resources', 'bin', 'rovai.exe')
  }
  const evidence = {}
  for (const [name, path] of Object.entries(files)) {
    if (!existsSync(path)) throw new Error(`installed ${name} is missing: ${path}`)
    const installedHash = await sha256(path)
    const unpackedHash = await sha256(unpacked[name])
    if (installedHash !== unpackedHash) throw new Error(`installed ${name} differs from verified unpacked payload`)
    evidence[name] = { path, bytes: (await stat(path)).size, sha256: installedHash }
  }
  const version = run(files.cli, ['--version'])
  if (!version.includes('contract-v20 ipc-v2')) throw new Error(`installed CLI is incompatible: ${version}`)
  return evidence
}

async function waitForUninstall(directory, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!existsSync(join(directory, `${executableName}.exe`))
        && installedRovaiEntries().length === 0) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 200))
  }
  throw new Error('per-user uninstall did not finish within the acceptance timeout')
}

try {
  run(installer, ['/S'])
  installDirectory = await locateInstallation()
  if (!installDirectory) throw new Error('clean install did not create the expected per-user program directory')
  report.installedFiles = await installedFileEvidence(installDirectory)
  report.cleanInstall = true

  const onboarding = spawnSync(process.execPath, [
    join(root, 'scripts', 'accept-onboarding-ui.mjs'),
    join(installDirectory, `${executableName}.exe`)
  ], {
    cwd: root,
    env: {
      ...process.env,
      ROVAI_ONBOARDING_ACCEPT_FIXTURE_ROOT: fixtureRoot,
      ROVAI_ONBOARDING_ACCEPT_OUTPUT_DIR: outputRoot,
      ROVAI_ONBOARDING_ACCEPT_DEBUG_PORT: '9589',
      ROVAI_ONBOARDING_ALLOW_PLATFORM_BLOCKED: '1'
    },
    stdio: 'inherit'
  })
  if (onboarding.error) throw onboarding.error
  if (onboarding.status !== 0) throw new Error(`installed App onboarding acceptance failed (${onboarding.status})`)
  const onboardingReport = JSON.parse(await readFile(join(outputRoot, 'report.json'), 'utf8'))
  report.onboarding = onboardingReport.runtime?.platformBlocked
    ? 'blocked_by_runtime_platform_admission'
    : 'completed'

  const persistedOnboarding = join(fixtureRoot, 'user-data', 'Electron', 'User Data', 'onboarding.json')
  if (!existsSync(persistedOnboarding)) throw new Error('installed App did not persist isolated onboarding state')
  const persistedBeforeUpgrade = await sha256(persistedOnboarding)
  run(installer, ['/S'])
  const upgradedDirectory = await locateInstallation()
  if (upgradedDirectory !== installDirectory) throw new Error('upgrade changed the per-user install directory')
  report.installedFiles = await installedFileEvidence(installDirectory)
  if (await sha256(persistedOnboarding) !== persistedBeforeUpgrade) {
    throw new Error('upgrade mutated the isolated onboarding state while the App was closed')
  }
  report.upgrade = true

  const uninstallers = (await readdir(installDirectory))
    .filter((name) => /^Uninstall .+\.exe$/i.test(name))
  if (uninstallers.length !== 1) throw new Error(`expected one uninstaller, found ${uninstallers.length}`)
  run(join(installDirectory, uninstallers[0]), ['/currentuser', '/S'])
  await waitForUninstall(installDirectory)
  if (existsSync(join(installDirectory, `${executableName}.exe`))) {
    throw new Error('default uninstall left the application executable installed')
  }
  if (installedRovaiEntries().length > 0) throw new Error('default uninstall left its HKCU uninstall registration')
  if (!existsSync(persistedOnboarding)) throw new Error('default uninstall deleted isolated user data')
  report.defaultUninstallRetainedData = true
  report.result = 'passed'
} catch (error) {
  report.result = 'failed'
  report.error = error instanceof Error ? error.stack ?? error.message : String(error)
  process.exitCode = 1
} finally {
  if (installDirectory && existsSync(installDirectory)) {
    const remaining = await readdir(installDirectory).catch(() => [])
    const uninstaller = remaining.find((name) => /^Uninstall .+\.exe$/i.test(name))
    if (uninstaller) {
      spawnSync(join(installDirectory, uninstaller), ['/currentuser', '/S'])
      await waitForUninstall(installDirectory).catch(() => undefined)
    }
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  if (report.result === 'passed') await rm(fixtureRoot, { recursive: true, force: true })
}

if (process.exitCode) console.error(`Windows installation acceptance failed; report: ${reportPath}`)
else console.log(`Windows installation acceptance passed; report: ${reportPath}`)
