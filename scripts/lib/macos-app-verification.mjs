import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import {
  MACOS_SIGNING_POLICY,
  assertAdhocMacosSignature
} from './macos-signing-policy.mjs'

const EXPECTED_ARCHITECTURES = Object.freeze({
  arm64: 'arm64',
  x64: 'x86_64'
})

const EXPECTED_DINGTALK_DWS_SHA256 = Object.freeze({
  arm64: '5998d83346839048f555c3abe4ff7207191317759dd720ba46e883cefe4bf777',
  x64: 'fd66b021f83ea0468e39470b4b9d9736e6b7cac8f2158e09cd9a65da0bad3347'
})

function defaultRun(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${basename(command)} failed (${result.status}): ${output}`)
  }
  return output
}

export function verifyAdhocMacosApp(appPath, arch, options = {}) {
  const expectedArchitecture = EXPECTED_ARCHITECTURES[arch]
  if (!expectedArchitecture) throw new Error(`unsupported macOS architecture: ${arch}`)

  const root = resolve(options.root ?? process.cwd())
  const resolvedAppPath = resolve(appPath)
  const run = options.run ?? defaultRun
  const packageMetadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const productName = packageMetadata.build.productName
  const executableName = packageMetadata.build.mac.executableName ?? productName
  const targets = [
    {
      label: 'App',
      path: resolvedAppPath,
      binaryPath: join(resolvedAppPath, 'Contents', 'MacOS', executableName),
      deep: true
    },
    {
      label: 'rovai-core',
      path: join(resolvedAppPath, 'Contents', 'Resources', 'bin', 'rovai-core'),
      binaryPath: join(resolvedAppPath, 'Contents', 'Resources', 'bin', 'rovai-core')
    },
    {
      label: 'rovai',
      path: join(resolvedAppPath, 'Contents', 'Resources', 'bin', 'rovai'),
      binaryPath: join(resolvedAppPath, 'Contents', 'Resources', 'bin', 'rovai')
    }
  ]

  for (const target of targets) {
    if (!existsSync(target.binaryPath)) {
      throw new Error(`${target.label} binary is missing: ${target.binaryPath}`)
    }
    const verifyArgs = ['--verify']
    if (target.deep) verifyArgs.push('--deep')
    verifyArgs.push('--strict', '--verbose=2', target.path)
    run('/usr/bin/codesign', verifyArgs, root)

    const architectures = run('/usr/bin/lipo', ['-archs', target.binaryPath], root)
      .split(/\s+/)
      .filter(Boolean)
    if (architectures.length !== 1 || architectures[0] !== expectedArchitecture) {
      throw new Error(
        `${target.label} architecture is ${architectures.join(' ')}, expected only ${expectedArchitecture}`
      )
    }

    const details = run('/usr/bin/codesign', ['-d', '--verbose=4', target.path], root)
    const requirementOutput = run('/usr/bin/codesign', ['-d', '-r-', target.path], root)
    const designatedRequirement = requirementOutput
      .split('\n')
      .map((line) => line.trim().replace(/^#\s*/, ''))
      .find((line) => line.startsWith('designated =>'))
    if (!designatedRequirement) {
      throw new Error(`${target.label} has no designated requirement`)
    }
    assertAdhocMacosSignature(target.label, {
      details,
      designatedRequirement
    })
  }

  const dwsPath = join(resolvedAppPath, 'Contents', 'Resources', 'bin', 'dws')
  if (existsSync(dwsPath)) {
    throw new Error(`DingTalk DWS must not be packaged as executable code: ${dwsPath}`)
  }
  const dwsArchivePath = `${dwsPath}.gz`
  if (!existsSync(dwsArchivePath)) {
    throw new Error(`DingTalk DWS packaged resource is missing: ${dwsArchivePath}`)
  }
  let dwsBytes
  try {
    dwsBytes = gunzipSync(readFileSync(dwsArchivePath))
  } catch {
    throw new Error(`DingTalk DWS packaged resource is invalid: ${dwsArchivePath}`)
  }
  const expectedDwsSha256 = options.dwsExpectedSha256 ?? EXPECTED_DINGTALK_DWS_SHA256[arch]
  const actualDwsSha256 = createHash('sha256').update(dwsBytes).digest('hex')
  if (actualDwsSha256 !== expectedDwsSha256) {
    throw new Error(
      `DingTalk DWS SHA-256 is ${actualDwsSha256}, expected ${expectedDwsSha256}`
    )
  }

  const bundleId = run('/usr/bin/plutil', [
    '-extract',
    'CFBundleIdentifier',
    'raw',
    '-o',
    '-',
    join(resolvedAppPath, 'Contents', 'Info.plist')
  ], root)
  if (bundleId !== MACOS_SIGNING_POLICY.appId) {
    throw new Error(`Bundle ID is ${bundleId}, expected ${MACOS_SIGNING_POLICY.appId}`)
  }

  return {
    appPath: resolvedAppPath,
    architecture: arch,
    signature: 'ad-hoc'
  }
}
