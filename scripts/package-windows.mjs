import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Windows packages must be built on a native Windows x64 host')
}

const target = process.argv[2]
if (!['dir', 'nsis'].includes(target)) {
  throw new Error('Usage: node scripts/package-windows.mjs <dir|nsis>')
}

const root = resolve(import.meta.dirname, '..')
const cli = resolve(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js')
if (!existsSync(cli)) throw new Error('electron-builder is not installed')

const releaseSigning = process.env.ROVAI_WINDOWS_RELEASE_SIGNING === '1'
if (releaseSigning && !process.env.CSC_LINK) {
  throw new Error('CSC_LINK is required for a signed Windows release')
}

const result = spawnSync(process.execPath, [
  cli,
  '--win',
  target,
  '--x64',
  '--publish',
  'never'
], {
  cwd: root,
  env: {
    ...process.env,
    ...(releaseSigning ? {} : { CSC_IDENTITY_AUTO_DISCOVERY: 'false' })
  },
  stdio: 'inherit'
})

process.exit(result.status ?? 1)
