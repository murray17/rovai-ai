import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const release = process.argv.includes('--release')
const profile = release ? 'release' : 'debug'
const args = ['build', '--package', 'rovai-core']

if (release) args.push('--release')

const result = spawnSync('cargo', args, {
  cwd: root,
  stdio: 'inherit'
})

if (result.status !== 0) process.exit(result.status ?? 1)

const destinationDir = resolve(root, 'resources', 'bin')
mkdirSync(destinationDir, { recursive: true })

for (const binary of ['rovai-core', 'rovai']) {
  const source = resolve(root, 'target', profile, binary)
  const destination = resolve(destinationDir, binary)
  if (!existsSync(source)) {
    throw new Error(`Rust binary not found at ${source}`)
  }
  copyFileSync(source, destination)
  chmodSync(destination, 0o755)
  console.log(`Copied ${profile} Rust binary to ${destination}`)
}
