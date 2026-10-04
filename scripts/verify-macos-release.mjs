import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import {
  MACOS_SIGNING_POLICY,
  assertStableMacosSignature
} from './lib/macos-signing-policy.mjs'
import {
  assertUpdateInfoReleaseNotes,
  configuredReleaseNotesFile
} from './lib/release-notes.mjs'

const EXPECTED_APP_ID = MACOS_SIGNING_POLICY.appId
const EXPECTED_TEAM_ID = process.env.MAC_RELEASE_TEAM_ID
const EXPECTED_CERT_SHA256 = process.env.MAC_RELEASE_CERT_SHA256
const EXPECTED_AUTHORITY = MACOS_SIGNING_POLICY.authorityPrefix
const EXPECTED_ARCHITECTURES = {
  arm64: 'arm64',
  x64: 'x86_64'
}

const arch = process.argv[2]
if (!(arch in EXPECTED_ARCHITECTURES)) {
  console.error('Usage: node scripts/verify-macos-release.mjs <arm64|x64>')
  process.exit(2)
}

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const distDir = join(root, 'dist')
const reportPath = join(distDir, `signing-report-${arch}.txt`)
const packageMetadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const productName = packageMetadata.build.productName
const executableName = packageMetadata.build.mac.executableName ?? productName
const appName = `${productName}.app`
const expectedArchitecture = EXPECTED_ARCHITECTURES[arch]
const mountPoint = mkdtempSync(join(tmpdir(), `rovai-release-${arch}-`))
let zipExtractDirectory = null
const report = [
  'Rovai macOS signing verification',
  `Architecture: ${arch}`,
  `Expected Mach-O architecture: ${expectedArchitecture}`
]

let mounted = false
let failure = null

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8'
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${basename(command)} failed (${result.status}): ${output}`)
  }
  return output
}

function findDmg() {
  if (!existsSync(distDir)) throw new Error('dist directory does not exist')

  const expectedName = artifactName('dmg')
  const exactPath = join(distDir, expectedName)
  if (existsSync(exactPath)) return exactPath

  const candidates = readdirSync(distDir)
    .filter((name) => name.endsWith(`-${arch}.dmg`))
    .map((name) => join(distDir, name))

  if (candidates.length !== 1) {
    throw new Error(`expected exactly one ${arch} DMG in dist, found ${candidates.length}`)
  }
  return candidates[0]
}

function verifyUpdateArtifacts() {
  const zipPath = join(distDir, artifactName('zip'))
  const updateInfoPath = join(distDir, 'latest-mac.yml')
  if (!existsSync(zipPath)) throw new Error(`macOS update ZIP is missing: ${zipPath}`)
  if (!existsSync(updateInfoPath)) throw new Error(`latest-mac.yml is missing: ${updateInfoPath}`)

  const updateInfo = parseYaml(readFileSync(updateInfoPath, 'utf8'))
  if (!updateInfo || updateInfo.version !== packageMetadata.version) {
    throw new Error('latest-mac.yml has the wrong version')
  }
  const releaseNotesPath = join(root, configuredReleaseNotesFile(packageMetadata))
  assertUpdateInfoReleaseNotes({
    updateInfo,
    releaseNotes: readFileSync(releaseNotesPath, 'utf8'),
    version: packageMetadata.version,
    manifestName: 'latest-mac.yml'
  })
  const zipName = basename(zipPath)
  const zipEntry = Array.isArray(updateInfo.files)
    ? updateInfo.files.find((entry) => entry?.url === zipName)
    : null
  if (!zipEntry || typeof zipEntry.sha512 !== 'string' || zipEntry.sha512.length < 80) {
    throw new Error(`latest-mac.yml has no complete entry for ${zipName}`)
  }
  if (Number(zipEntry.size) !== statSync(zipPath).size) {
    throw new Error(`latest-mac.yml has the wrong size for ${zipName}`)
  }
  const actualSha512 = Buffer.from(
    run('/usr/bin/shasum', ['-a', '512', zipPath]).split(/\s+/)[0],
    'hex'
  ).toString('base64')
  if (zipEntry.sha512 !== actualSha512) {
    throw new Error(`latest-mac.yml has the wrong SHA-512 for ${zipName}`)
  }
  report.push(`Update ZIP: ${relative(root, zipPath)}`)
  report.push('latest-mac.yml: version, release notes, actual sha512 and size passed')
  return zipPath
}

function artifactName(extension) {
  return packageMetadata.build.mac.artifactName
    .replaceAll('${productName}', productName)
    .replaceAll('${name}', packageMetadata.name)
    .replaceAll('${version}', packageMetadata.version)
    .replaceAll('${arch}', arch)
    .replaceAll('${ext}', extension)
}

function architectureOf(binaryPath) {
  return run('/usr/bin/lipo', ['-archs', binaryPath]).split(/\s+/).filter(Boolean)
}

function assertArchitecture(label, binaryPath) {
  const actual = architectureOf(binaryPath)
  if (actual.length !== 1 || actual[0] !== expectedArchitecture) {
    throw new Error(`${label} architecture is ${actual.join(' ')}, expected only ${expectedArchitecture}`)
  }
  report.push(`${label} architecture: ${actual[0]}`)
}

function findPackagedApp() {
  const preferredDirectories = arch === 'arm64'
    ? ['mac-arm64', 'mac']
    : ['mac', 'mac-x64']
  const candidates = preferredDirectories
    .map((directory) => join(distDir, directory, appName))
    .filter((candidate) => existsSync(candidate))

  const matching = candidates.filter((candidate) => {
    const executable = join(candidate, 'Contents', 'MacOS', executableName)
    try {
      const actual = architectureOf(executable)
      return actual.length === 1 && actual[0] === expectedArchitecture
    } catch {
      return false
    }
  })

  if (matching.length !== 1) {
    throw new Error(`expected exactly one unpacked ${arch} ${appName} in dist, found ${matching.length}`)
  }
  return matching[0]
}

function signatureDetails(label, targetPath, expectedIdentifier = null) {
  const details = run('/usr/bin/codesign', ['-d', '--verbose=4', targetPath])
  const requirementOutput = run('/usr/bin/codesign', ['-d', '-r-', targetPath])
  const designatedRequirement = requirementOutput
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('designated =>'))

  if (!designatedRequirement) throw new Error(`${label} has no designated requirement`)
  assertStableMacosSignature(label, {
    details,
    designatedRequirement,
    expectedIdentifier,
    expectedTeamId: EXPECTED_TEAM_ID
  })
  if (!/^[A-F0-9]{64}$/.test(EXPECTED_CERT_SHA256 ?? '')) {
    throw new Error('MAC_RELEASE_CERT_SHA256 must be the pinned certificate SHA-256')
  }
  const certificateDirectory = mkdtempSync(join(tmpdir(), 'rovai-signing-cert-'))
  try {
    const certificatePrefix = join(certificateDirectory, 'certificate')
    run('/usr/bin/codesign', [
      '-d', `--extract-certificates=${certificatePrefix}`, targetPath
    ])
    const actualSha256 = run('/usr/bin/shasum', [
      '-a', '256', `${certificatePrefix}0`
    ]).split(/\s+/)[0].toUpperCase()
    if (actualSha256 !== EXPECTED_CERT_SHA256) {
      throw new Error(`${label} uses a different Developer ID certificate`)
    }
  } finally {
    rmSync(certificateDirectory, { recursive: true })
  }

  report.push(`${label} authority: ${EXPECTED_AUTHORITY}`)
  report.push(`${label} Team ID: ${EXPECTED_TEAM_ID}`)
  report.push(`${label} certificate SHA-256: ${EXPECTED_CERT_SHA256}`)
  report.push(`${label} designated requirement: ${designatedRequirement}`)
  return { details, designatedRequirement }
}

function assertAppMetadata(label, appPath) {
  const infoPath = join(appPath, 'Contents', 'Info.plist')
  for (const [key, expected] of [
    ['CFBundleIdentifier', EXPECTED_APP_ID],
    ['CFBundleShortVersionString', packageMetadata.version]
  ]) {
    const actual = run('/usr/bin/plutil', [
      '-extract', key, 'raw', '-o', '-', infoPath
    ])
    if (actual !== expected) {
      throw new Error(`${label} ${key} is ${actual}, expected ${expected}`)
    }
  }
  report.push(`${label} Bundle ID and version: passed`)
}

function detachDmg() {
  if (!mounted) return

  const detached = spawnSync('/usr/bin/hdiutil', ['detach', mountPoint], {
    encoding: 'utf8'
  })
  if (detached.status === 0) {
    mounted = false
    return
  }

  const forced = spawnSync('/usr/bin/hdiutil', ['detach', '-force', mountPoint], {
    encoding: 'utf8'
  })
  if (forced.status !== 0) {
    throw new Error(`failed to detach DMG mounted at ${mountPoint}`)
  }
  mounted = false
}

try {
  const dmgPath = findDmg()
  const dmgSize = statSync(dmgPath).size
  if (dmgSize <= 0) throw new Error('DMG is empty')

  const packagedAppPath = findPackagedApp()
  const zipPath = verifyUpdateArtifacts()
  const updateConfiguration = parseYaml(readFileSync(
    join(packagedAppPath, 'Contents', 'Resources', 'app-update.yml'),
    'utf8'
  ))
  if (updateConfiguration?.provider !== 'github'
      || updateConfiguration.owner !== 'murray17'
      || updateConfiguration.repo !== 'rovai-ai') {
    throw new Error('packaged app-update.yml does not target the official GitHub release channel')
  }
  report.push('Packaged updater channel: github/murray17/rovai-ai')
  report.push(`DMG: ${relative(root, dmgPath)}`)
  report.push(`DMG size: ${dmgSize}`)
  report.push(`Unpacked app: ${relative(root, packagedAppPath)}`)

  run('/usr/bin/hdiutil', [
    'attach',
    '-nobrowse',
    '-readonly',
    '-mountpoint',
    mountPoint,
    dmgPath
  ])
  mounted = true

  const appPath = join(mountPoint, appName)
  if (!existsSync(appPath)) throw new Error(`${appName} is missing from the mounted DMG`)

  const appExecutable = join(appPath, 'Contents', 'MacOS', executableName)
  const corePath = join(appPath, 'Contents', 'Resources', 'bin', 'rovai-core')
  const hostPath = join(appPath, 'Contents', 'Resources', 'bin', 'rovai-host')
  const cliPath = join(appPath, 'Contents', 'Resources', 'bin', 'rovai')
  for (const requiredPath of [appExecutable, corePath, hostPath, cliPath]) {
    if (!existsSync(requiredPath)) throw new Error(`required binary is missing: ${requiredPath}`)
  }

  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
  run('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', corePath])
  run('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', hostPath])
  run('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', cliPath])
  report.push('App codesign verification: passed')
  report.push('rovai-core codesign verification: passed')
  report.push('rovai-host codesign verification: passed')
  report.push('rovai codesign verification: passed')

  assertArchitecture('App', appExecutable)
  assertArchitecture('rovai-core', corePath)
  assertArchitecture('rovai-host', hostPath)
  assertArchitecture('rovai', cliPath)

  assertAppMetadata('DMG App', appPath)

  signatureDetails('App', appPath, EXPECTED_APP_ID)
  signatureDetails('rovai-core', corePath)
  signatureDetails('rovai-host', hostPath)
  signatureDetails('rovai', cliPath)
  run('/usr/bin/xcrun', ['stapler', 'validate', appPath])
  run('/usr/bin/xcrun', ['stapler', 'validate', dmgPath])
  run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', appPath])
  report.push('App and DMG notarization tickets: valid')
  report.push('Gatekeeper app assessment: passed')

  zipExtractDirectory = mkdtempSync(join(tmpdir(), `rovai-update-${arch}-`))
  run('/usr/bin/ditto', ['-x', '-k', zipPath, zipExtractDirectory])
  const zipAppPath = join(zipExtractDirectory, appName)
  if (!existsSync(zipAppPath)) throw new Error(`${appName} is missing from the update ZIP`)
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', zipAppPath])
  signatureDetails('Update ZIP App', zipAppPath, EXPECTED_APP_ID)
  assertArchitecture('Update ZIP App', join(zipAppPath, 'Contents', 'MacOS', executableName))
  assertAppMetadata('Update ZIP App', zipAppPath)
  for (const binaryName of ['rovai-core', 'rovai-host', 'rovai']) {
    const binaryPath = join(zipAppPath, 'Contents', 'Resources', 'bin', binaryName)
    run('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', binaryPath])
    signatureDetails(`Update ZIP ${binaryName}`, binaryPath)
    assertArchitecture(`Update ZIP ${binaryName}`, binaryPath)
  }
  run('/usr/bin/xcrun', ['stapler', 'validate', zipAppPath])
  report.push('Update ZIP App signature and notarization ticket: valid')
  report.push('CDHash-only signature found: no')
  report.push('Result: passed')
} catch (error) {
  failure = error instanceof Error ? error : new Error(String(error))
  report.push(`Result: failed - ${failure.message}`)
} finally {
  try {
    detachDmg()
  } catch (error) {
    const detachError = error instanceof Error ? error : new Error(String(error))
    if (!failure) failure = detachError
    report.push(`DMG detach: failed - ${detachError.message}`)
  }

  if (!mounted) {
    try {
      rmdirSync(mountPoint)
    } catch {
      // The verification result already records any meaningful mount failure.
    }
  }
  if (zipExtractDirectory) {
    try {
      rmSync(zipExtractDirectory, { recursive: true, force: true })
    } catch (error) {
      if (!failure) failure = error instanceof Error ? error : new Error(String(error))
      report.push(`Update ZIP cleanup: failed - ${failure.message}`)
    }
  }

  mkdirSync(distDir, { recursive: true })
  writeFileSync(reportPath, `${report.join('\n')}\n`, { mode: 0o644 })
}

if (failure) {
  console.error(`macOS ${arch} signing verification failed: ${failure.message}`)
  process.exit(1)
}

console.log(`macOS ${arch} signing verification passed`)
console.log(`Report: ${reportPath}`)
