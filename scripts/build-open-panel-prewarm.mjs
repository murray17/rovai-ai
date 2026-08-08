import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

if (process.platform !== 'darwin') {
  console.log('Skipping macOS NSOpenPanel prewarmer build on non-macOS host')
  process.exit(0)
}

const root = resolve(import.meta.dirname, '..')
const source = join(root, 'apps', 'desktop', 'native', 'open-panel-prewarm.mm')
const outputDirectory = join(root, 'resources', 'native')
const output = join(outputDirectory, 'open-panel-prewarm.node')
const configuredNodeRoot = process.env.npm_config_nodedir
const nodeRoot = configuredNodeRoot || dirname(dirname(process.execPath))
const nodeHeaders = join(nodeRoot, 'include', 'node')

if (!existsSync(join(nodeHeaders, 'node_api.h'))) {
  throw new Error(`Node.js headers not found at ${nodeHeaders}`)
}

const xcrun = spawnSync('xcrun', ['--find', 'clang++'], { encoding: 'utf8' })
if (xcrun.status !== 0 || !xcrun.stdout.trim()) {
  throw new Error('Xcode Command Line Tools are required to build the macOS prewarmer')
}
const sdk = spawnSync('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { encoding: 'utf8' })
if (sdk.status !== 0 || !sdk.stdout.trim()) {
  throw new Error('The macOS SDK is required to build the macOS prewarmer')
}

mkdirSync(outputDirectory, { recursive: true })
const architecture = process.env.npm_config_arch || process.arch
const result = spawnSync(xcrun.stdout.trim(), [
  '-std=c++20',
  '-fobjc-arc',
  '-fvisibility=hidden',
  '-DNAPI_VERSION=9',
  '-bundle',
  '-undefined',
  'dynamic_lookup',
  '-arch',
  architecture,
  '-isysroot',
  sdk.stdout.trim(),
  '-mmacosx-version-min=14.0',
  '-I',
  nodeHeaders,
  '-framework',
  'AppKit',
  source,
  '-o',
  output
], {
  cwd: root,
  stdio: 'inherit'
})

if (result.status !== 0) process.exit(result.status ?? 1)
console.log(`Built macOS NSOpenPanel prewarmer at ${output}`)
