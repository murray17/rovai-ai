import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyAdhocMacosApp } from './macos-app-verification.mjs'

test('verifies an ad-hoc App, Core, and CLI with the expected architecture and bundle ID', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'rovai-adhoc-verification-'))
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
  for (const binary of [appBinary, join(resources, 'rovai-core'), join(resources, 'rovai')]) {
    writeFileSync(binary, 'binary')
  }

  const result = verifyAdhocMacosApp(appPath, 'arm64', {
    root,
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
