import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const release = process.argv.includes('--release')
const profile = release ? 'release' : 'debug'
const args = ['build', '--package', 'lumen-core']

if (release) args.push('--release')

const result = spawnSync('cargo', args, {
  cwd: root,
  stdio: 'inherit'
})

if (result.status !== 0) process.exit(result.status ?? 1)

const source = resolve(root, 'target', profile, 'lumen-core')
const destinationDir = resolve(root, 'resources', 'bin')
const destination = resolve(destinationDir, 'lumen-core')

if (!existsSync(source)) {
  throw new Error(`Rust Core binary not found at ${source}`)
}

mkdirSync(destinationDir, { recursive: true })
copyFileSync(source, destination)
chmodSync(destination, 0o755)
console.log(`Copied ${profile} Rust Core to ${destination}`)

