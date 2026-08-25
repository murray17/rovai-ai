import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

const EXPECTED_APP_ID = 'ai.rovai.desktop'
const EXPECTED_AUTHORITY = 'Rovai Release Signing'
const EXPECTED_CERTIFICATE_ROOT = '465802da7386e9676668078e7d44704cbbeadd1e'
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
  report.push(`Update ZIP: ${relative(root, zipPath)}`)
  report.push('latest-mac.yml: version, sha512 and size passed')
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

function signatureDetails(label, targetPath) {
  const details = run('/usr/bin/codesign', ['-d', '--verbose=4', targetPath])
  if (/^Signature=adhoc$/m.test(details)) {
    throw new Error(`${label} uses an ad-hoc signature`)
  }

  const authorities = [...details.matchAll(/^Authority=(.+)$/gm)].map((match) => match[1].trim())
  if (!authorities.includes(EXPECTED_AUTHORITY)) {
    throw new Error(`${label} is missing Authority=${EXPECTED_AUTHORITY}`)
  }

  const requirementOutput = run('/usr/bin/codesign', ['-d', '-r-', targetPath])
  const designatedRequirement = requirementOutput
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('designated =>'))

  if (!designatedRequirement) throw new Error(`${label} has no designated requirement`)
  if (/designated\s*=>\s*cdhash\b/i.test(designatedRequirement)) {
    throw new Error(`${label} uses a CDHash-only designated requirement`)
  }

  report.push(`${label} authority: ${EXPECTED_AUTHORITY}`)
  report.push(`${label} designated requirement: ${designatedRequirement}`)
  return { details, designatedRequirement }
}

function assertCertificateRoot(label, designatedRequirement) {
  const normalized = designatedRequirement.toLowerCase()
  const expected = `certificate root = h"${EXPECTED_CERTIFICATE_ROOT}"`
  if (!normalized.includes(expected)) {
    throw new Error(`${label} designated requirement has the wrong certificate root`)
  }
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
  verifyUpdateArtifacts()
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
  const cliPath = join(appPath, 'Contents', 'Resources', 'bin', 'rovai')
  for (const requiredPath of [appExecutable, corePath, cliPath]) {
    if (!existsSync(requiredPath)) throw new Error(`required binary is missing: ${requiredPath}`)
  }

  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
  run('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', corePath])
  run('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', cliPath])
  report.push('App codesign verification: passed')
  report.push('rovai-core codesign verification: passed')
  report.push('rovai codesign verification: passed')

  assertArchitecture('App', appExecutable)
  assertArchitecture('rovai-core', corePath)
  assertArchitecture('rovai', cliPath)

  const bundleId = run('/usr/bin/plutil', [
    '-extract',
    'CFBundleIdentifier',
    'raw',
    '-o',
    '-',
    join(appPath, 'Contents', 'Info.plist')
  ])
  if (bundleId !== EXPECTED_APP_ID) {
    throw new Error(`Bundle ID is ${bundleId}, expected ${EXPECTED_APP_ID}`)
  }
  report.push(`Bundle ID: ${bundleId}`)

  const appSignature = signatureDetails('App', appPath)
  const normalizedRequirement = appSignature.designatedRequirement.toLowerCase()
  if (!normalizedRequirement.includes(`identifier "${EXPECTED_APP_ID}"`)) {
    throw new Error('App designated requirement has the wrong identifier')
  }
  assertCertificateRoot('App', appSignature.designatedRequirement)

  const coreSignature = signatureDetails('rovai-core', corePath)
  assertCertificateRoot('rovai-core', coreSignature.designatedRequirement)

  const cliSignature = signatureDetails('rovai', cliPath)
  assertCertificateRoot('rovai', cliSignature.designatedRequirement)
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

  mkdirSync(distDir, { recursive: true })
  writeFileSync(reportPath, `${report.join('\n')}\n`, { mode: 0o644 })
}

if (failure) {
  console.error(`macOS ${arch} signing verification failed: ${failure.message}`)
  process.exit(1)
}

console.log(`macOS ${arch} signing verification passed`)
console.log(`Report: ${reportPath}`)
