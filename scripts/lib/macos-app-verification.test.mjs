import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { verifyAdhocMacosApp } from './macos-app-verification.mjs'

test('verifies an ad-hoc App, Core, and CLI with the expected architecture and bundle ID', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'rovai-adhoc-verification-'))
  context.after(() => rmSync(root, { recursive: true, force: true }))
  const appPath = join(root, 'Rovai AI.app')
  const appBinary = join(appPath, 'Contents', 'MacOS', 'Rovai AI')
  const resources = join(appPath, 'Contents', 'Resources', 'bin')
  const dwsArchive = join(resources, 'dws.gz')

  mkdirSync(join(appPath, 'Contents', 'MacOS'), { recursive: true })
  mkdirSync(resources, { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    build: {
      productName: 'Rovai AI',
      mac: {}
    }
  }))
  for (const binary of [appBinary, join(resources, 'rovai-core'), join(resources, 'rovai')]) {
    writeFileSync(binary, 'binary')
  }
  writeFileSync(dwsArchive, gzipSync('reviewed-dws-binary'))

  const result = verifyAdhocMacosApp(appPath, 'arm64', {
    root,
    dwsExpectedSha256: createHash('sha256').update('reviewed-dws-binary').digest('hex'),
    run(command, args) {
      if (command === '/usr/bin/lipo') return 'arm64'
      if (command === '/usr/bin/plutil') return 'ai.rovai.desktop'
      if (command === '/usr/bin/codesign' && args[0] === '--verify') return ''
      if (command === '/usr/bin/codesign' && args.includes('--verbose=4')) {
        return 'Identifier=fixture\nSignature=adhoc\nTeamIdentifier=not set'
      }
      if (command === '/usr/bin/codesign' && args.includes('-r-')) {
        return '# designated => cdhash H"1234"'
      }
      throw new Error(`unexpected command: ${command} ${args.join(' ')}`)
    }
  })

  assert.deepEqual(result, {
    appPath,
    architecture: 'arm64',
    signature: 'ad-hoc'
  })
})

test('rejects a packaged DingTalk DWS whose bytes differ from the reviewed artifact', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'rovai-dws-verification-'))
  context.after(() => rmSync(root, { recursive: true, force: true }))
  const appPath = join(root, 'Rovai AI.app')
  const appBinary = join(appPath, 'Contents', 'MacOS', 'Rovai AI')
  const resources = join(appPath, 'Contents', 'Resources', 'bin')

  mkdirSync(join(appPath, 'Contents', 'MacOS'), { recursive: true })
  mkdirSync(resources, { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    build: {
      productName: 'Rovai AI',
      mac: {}
    }
  }))
  for (const binary of [
    appBinary,
    join(resources, 'rovai-core'),
    join(resources, 'rovai')
  ]) {
    writeFileSync(binary, 'tampered-binary')
  }
  writeFileSync(join(resources, 'dws.gz'), gzipSync('tampered-binary'))

  assert.throws(() => verifyAdhocMacosApp(appPath, 'arm64', {
    root,
    dwsExpectedSha256: createHash('sha256').update('reviewed-dws-binary').digest('hex'),
    run(command, args) {
      if (command === '/usr/bin/lipo') return 'arm64'
      if (command === '/usr/bin/plutil') return 'ai.rovai.desktop'
      if (command === '/usr/bin/codesign' && args[0] === '--verify') return ''
      if (command === '/usr/bin/codesign' && args.includes('--verbose=4')) {
        return 'Identifier=fixture\nSignature=adhoc\nTeamIdentifier=not set'
      }
      if (command === '/usr/bin/codesign' && args.includes('-r-')) {
        return '# designated => cdhash H"1234"'
      }
      throw new Error(`unexpected command: ${command} ${args.join(' ')}`)
    }
  }), /DingTalk DWS SHA-256/)
})
