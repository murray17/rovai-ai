import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  hostSidecarTargetKey,
  sidecarExecutableName,
  sidecarTarget,
  stagedSidecarDirectory
} from './lib/sidecar-targets.mjs'

const root = resolve(import.meta.dirname, '..')
const release = process.argv.includes('--release')
const profile = release ? 'release' : 'debug'
const args = ['build', '--package', 'rovai-core']
const targetOption = process.argv.indexOf('--target-key')
const targetKey = targetOption === -1
  ? hostSidecarTargetKey()
  : process.argv[targetOption + 1]
if (!targetKey || targetKey.startsWith('--')) {
  throw new Error('--target-key requires a shipped target key')
}
const target = sidecarTarget(targetKey)

if (release) args.push('--release')
if (targetOption !== -1) args.push('--target', target.rustTarget)

const result = spawnSync('cargo', args, {
  cwd: root,
  stdio: 'inherit'
})

if (result.status !== 0) process.exit(result.status ?? 1)

const sourceDir = targetOption === -1
  ? resolve(root, 'target', profile)
  : resolve(root, 'target', target.rustTarget, profile)
const destinationDir = stagedSidecarDirectory(root, targetKey)
rmSync(destinationDir, { recursive: true, force: true })
mkdirSync(destinationDir, { recursive: true })

for (const binary of ['rovai-core', 'rovai']) {
  const executable = sidecarExecutableName(binary, targetKey)
  const source = resolve(sourceDir, executable)
  const destination = resolve(destinationDir, executable)
  if (!existsSync(source)) {
    throw new Error(`Rust binary not found at ${source}`)
  }
  copyFileSync(source, destination)
  if (target.platform === 'darwin') chmodSync(destination, 0o755)
  console.log(`Staged ${targetKey} ${profile} Rust binary at ${destination}`)
}
