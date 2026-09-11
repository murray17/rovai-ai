import { createHash } from 'node:crypto'
import { spawnSync, execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { hostServerTargetKey, serverTarget } from './lib/sidecar-targets.mjs'

const repository = resolve(import.meta.dirname, '..')
const arguments_ = process.argv.slice(2)
const targetIndex = arguments_.indexOf('--target-key')
const key = targetIndex === -1 ? hostServerTargetKey() : arguments_[targetIndex + 1]
const target = serverTarget(key)
const debug = arguments_.includes('--debug')
const profile = debug ? 'debug' : 'release'
const allowed = new Set(['--debug', '--target-key', key])
if (arguments_.some((argument) => !allowed.has(argument))) throw new Error('Unknown Server build option')
// Native verification owns the resulting executable; do not package a foreign
// binary as though this machine had run its platform acceptance.
if (target.key !== hostServerTargetKey()) throw new Error('Server packaging must run on its native platform and architecture')

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repository, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) throw new Error(`Server build step failed: ${command}`)
}
run('pnpm', ['build:web'])
run('cargo', ['build', '--locked', '-p', 'rovai-host', '-p', 'rovai-core', '--bin', 'rovai-host', '--bin', 'rovai', ...(debug ? [] : ['--release'])])
const destination = join(repository, 'out/server', key)
rmSync(destination, { recursive: true, force: true })
mkdirSync(destination, { recursive: true })
for (const name of ['rovai-host', 'rovai']) {
  const executable = `${name}${target.executableSuffix}`
  copyFileSync(join(repository, 'target', profile, executable), join(destination, executable))
  if (target.platform !== 'win32') chmodSync(join(destination, executable), 0o755)
}
cpSync(join(repository, 'out/web'), join(destination, 'web-ui'), { recursive: true })
copyFileSync(join(repository, 'LICENSE'), join(destination, 'LICENSE'))
copyFileSync(join(repository, 'docs/development/server-preview.md'), join(destination, 'README.md'))
const version = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')).version
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim()
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: repository, encoding: 'utf8' }).trim().length > 0
const files = {}
function hashTree(directory, prefix = '') {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = `${prefix}${entry.name}`
    if (entry.isDirectory()) hashTree(join(directory, entry.name), `${relative}/`)
    else if (entry.isFile()) files[relative] = createHash('sha256').update(readFileSync(join(directory, entry.name))).digest('hex')
    else throw new Error('Server package may contain only regular files and directories')
  }
}
hashTree(destination)
writeFileSync(join(destination, 'manifest.json'), JSON.stringify({
  schemaVersion: 1, version, commit, dirty, target: target.key, rustTarget: target.rustTarget,
  profile, qualification: 'development-preview', files
}, null, 2) + '\n')
execFileSync(join(destination, `rovai-host${target.executableSuffix}`), ['--version'], { stdio: 'inherit' })
console.log(`Server preview staged at ${destination}`)
