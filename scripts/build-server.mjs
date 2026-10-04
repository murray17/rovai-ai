import { createHash } from 'node:crypto'
import { spawnSync, execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { hostServerTargetKey, serverTarget } from './lib/sidecar-targets.mjs'
import { archiveServerPackage } from './lib/server-archive.mjs'
import { inspectLinuxServerAbi } from './lib/linux-server-abi.mjs'

const repository = resolve(import.meta.dirname, '..')
const arguments_ = process.argv.slice(2)
const targetIndex = arguments_.indexOf('--target-key')
const key = targetIndex === -1 ? hostServerTargetKey() : arguments_[targetIndex + 1]
const target = serverTarget(key)
const debug = arguments_.includes('--debug')
const profile = debug ? 'debug' : 'release'
const outputIndex = arguments_.indexOf('--output-dir')
const customOutput = outputIndex === -1 ? null : arguments_[outputIndex + 1]
if (outputIndex !== -1 && (!customOutput || customOutput.startsWith('--'))) throw new Error('--output-dir requires a new directory')
const destination = customOutput ? resolve(customOutput) : join(repository, 'out/server', key)
if (customOutput && existsSync(destination)) throw new Error('--output-dir must not replace an existing installation')
const allowed = new Set(['--debug', '--target-key', key, '--output-dir', ...(customOutput ? [customOutput] : [])])
if (arguments_.some((argument) => !allowed.has(argument))) throw new Error('Unknown Server build option')
// Native verification owns the resulting executable; do not package a foreign
// binary as though this machine had run its platform acceptance.
if (target.key !== hostServerTargetKey()) throw new Error('Server packaging must run on its native platform and architecture')

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repository, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) throw new Error(`Server build step failed: ${command}`)
}
// A Desktop build may empty out/web while native Rust compilation runs.
// Own this UI build directory until the matching package has been copied.
const webBuildDirectory = mkdtempSync(join(tmpdir(), 'rovai-server-web-'))
try {
  run('pnpm', ['build:web', '--outDir', webBuildDirectory])
  run('cargo', ['build', '--locked', '-p', 'rovai-host', '-p', 'rovai-core', '--bin', 'rovai-host', '--bin', 'rovai-server', '--bin', 'rovai', ...(debug ? [] : ['--release'])])
  if (customOutput) {
    mkdirSync(dirname(destination), { recursive: true })
    mkdirSync(destination) // Refuse a concurrently created installation, too.
  } else {
    rmSync(destination, { recursive: true, force: true })
    mkdirSync(destination, { recursive: true })
  }
  for (const name of ['rovai-host', 'rovai-server', 'rovai']) {
    const executable = `${name}${target.executableSuffix}`
    copyFileSync(join(repository, 'target', profile, executable), join(destination, executable))
    if (target.platform !== 'win32') chmodSync(join(destination, executable), 0o755)
  }
  if (!existsSync(join(webBuildDirectory, 'index.html'))) throw new Error('Server WebUI build is missing index.html')
  cpSync(webBuildDirectory, join(destination, 'web-ui'), { recursive: true })
  // Managed Skills are runtime resources, not compile-time embeds. Keep them
  // beside the Server executables so a release works outside this checkout.
  cpSync(join(repository, 'skills'), join(destination, 'skills'), { recursive: true })
  copyFileSync(join(repository, 'LICENSE'), join(destination, 'LICENSE'))
  const version = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')).version
  writeFileSync(join(destination, 'package-info'), `schema=1\nversion=${version}\ntarget=${target.key}\n`)
  copyFileSync(join(repository, 'scripts', target.platform === 'win32' ? 'install-server.ps1' : 'install-server.sh'), join(destination, target.platform === 'win32' ? 'install-server.ps1' : 'install-server.sh'))
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim()
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: repository, encoding: 'utf8' }).trim().length > 0
  // The copied guide must also work outside a checkout. Keep its canonical
  // documentation links pinned to the package's recorded source revision.
  const guideBase = `https://github.com/murray17/rovai-ai/blob/${commit}/docs/development/server-preview.md`
  const guide = readFileSync(join(repository, 'docs/development/server-preview.md'), 'utf8')
    .replace(/\]\((?!https?:|#)([^)]+)\)/g, (_, target) => `](${new URL(target, guideBase).href})`)
  writeFileSync(join(destination, 'README.md'), guide)
  if (target.key === 'linux-x64') {
    writeFileSync(join(destination, 'linux-abi.json'), JSON.stringify(inspectLinuxServerAbi(destination), null, 2) + '\n')
  }
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
  execFileSync(join(destination, `rovai-server${target.executableSuffix}`), ['--version'], { stdio: 'inherit' })
  console.log(`Server preview staged at ${destination}`)
  const archive = archiveServerPackage(destination, customOutput ? `${destination}-release` : join(repository, 'out/server/releases', key), { version, target: key })
  console.log(`Unpublished Server archive: ${archive.archive}`)
} finally {
  rmSync(webBuildDirectory, { recursive: true, force: true })
}
