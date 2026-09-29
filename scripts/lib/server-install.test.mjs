import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { archiveServerPackage } from './server-archive.mjs'
import { hostServerTargetKey } from './sidecar-targets.mjs'

const repository = resolve(import.meta.dirname, '../..')
const windows = process.platform === 'win32'
const target = hostServerTargetKey()

test('Native installer verifies before switching, safely repeats, retains data, and configures PATH once', { timeout: 120_000 }, () => {
  const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'rovai-server-installer-')))
  const account = join(fixture, 'account'), prefix = join(fixture, 'installation'), bin = join(account, '.local/bin')
  const payload = join(fixture, 'payload'), release = join(fixture, 'release')
  const version = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')).version
  const program = windows ? 'rovai-server.exe' : 'rovai-server'
  const data = join(account, '.rovai-server')
  mkdirSync(join(payload, 'web-ui'), { recursive: true }); mkdirSync(data, { recursive: true })
  writeFileSync(join(data, 'sentinel'), 'existing business data')
  writeFileSync(join(payload, 'web-ui/index.html'), 'first matching UI')
  mkdirSync(join(payload, 'skills/cli-operations'), { recursive: true })
  writeFileSync(join(payload, 'skills/cli-operations/SKILL.md'), '---\nname: cli-operations\ndescription: Fixture.\n---\n')
  writeFileSync(join(payload, 'package-info'), `schema=1\nversion=${version}\ntarget=${target}\n`)
  // On Unix the package/installer seam uses a tiny native-shell executable;
  // actual Rust/Core/data lifecycle is independently owned by server-entry.
  if (windows) copyFileSync(process.env.ROVAI_SERVER_BIN ?? join(repository, 'target/debug', program), join(payload, program))
  else { writeFileSync(join(payload, program), `#!/bin/sh\nprintf '%s\\n' 'rovai-server ${version}'\n`); chmodSync(join(payload, program), 0o755) }
  const install = () => windows
    ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', join(repository, 'scripts/install-server.ps1'), '-Version', version, '-FromDirectory', release, '-InstallDirectory', prefix, '-NoModifyPath'], { encoding: 'utf8' })
    : spawnSync('/bin/sh', [join(repository, 'scripts/install-server.sh'), '--version', version, '--from-dir', release, '--prefix', prefix, '--bin-dir', bin], { cwd: fixture, env: { ...process.env, HOME: account, ZDOTDIR: account, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }, encoding: 'utf8' })
  const success = () => { const result = install(); assert.equal(result.status, 0, result.stdout + result.stderr) }
  try {
    const first = archiveServerPackage(payload, release, { version, target })
    success()
    const installed = join(prefix, 'current', program)
    assert.equal(execFileSync(installed, ['--version'], { encoding: 'utf8' }).trim(), `rovai-server ${version}`)
    const initialLocation = realpathSync(installed)
    success()
    if (!windows) {
      assert.equal(realpathSync(installed), initialLocation)
      assert.equal(realpathSync(join(bin, program)), initialLocation)
      for (const name of ['.profile', '.bashrc', '.bash_profile', '.zshrc']) assert.equal(readFileSync(join(account, name), 'utf8').split('# rovai-server PATH').length - 1, 1)
    }
    const valid = readFileSync(first.archive)
    writeFileSync(first.archive, Buffer.concat([valid, Buffer.from('corrupted')]))
    const corrupt = install(); assert.notEqual(corrupt.status, 0); assert.match(corrupt.stderr, /checksum mismatch/i)
    assert.equal(readFileSync(join(prefix, 'current/web-ui/index.html'), 'utf8'), 'first matching UI')
    rmSync(join(payload, 'skills/cli-operations/SKILL.md'))
    archiveServerPackage(payload, release, { version, target })
    const missingSkill = install(); assert.notEqual(missingSkill.status, 0); assert.match(missingSkill.stderr, /Incomplete package|bundled Skills mismatch/i)
    assert.equal(readFileSync(join(prefix, 'current/web-ui/index.html'), 'utf8'), 'first matching UI')
    writeFileSync(join(payload, 'skills/cli-operations/SKILL.md'), '---\nname: cli-operations\ndescription: Fixture.\n---\n')
    writeFileSync(join(payload, 'web-ui/index.html'), 'replacement matching UI')
    archiveServerPackage(payload, release, { version, target }); success()
    assert.equal(readFileSync(join(prefix, 'current/web-ui/index.html'), 'utf8'), 'replacement matching UI')
    if (!windows) assert.equal(readFileSync(join(initialLocation, '../web-ui/index.html'), 'utf8'), 'first matching UI')
    // Package coordinates are checked after checksum and before installation.
    writeFileSync(join(payload, 'package-info'), `schema=1\nversion=${version}\ntarget=wrong-platform\n`)
    archiveServerPackage(payload, release, { version, target })
    const mismatch = install(); assert.notEqual(mismatch.status, 0); assert.match(mismatch.stderr, /target mismatch|target, WebUI, or bundled Skills mismatch/i)
    assert.equal(readFileSync(join(prefix, 'current/web-ui/index.html'), 'utf8'), 'replacement matching UI')
    if (!windows) {
      // Even a correctly checksummed archive cannot install symlink members.
      const evil = join(fixture, 'evil'); mkdirSync(join(evil, 'rovai-server'), { recursive: true })
      symlinkSync(data, join(evil, 'rovai-server/escape'))
      execFileSync('tar', ['-czf', first.archive, '-C', evil, 'rovai-server'])
      writeFileSync(join(release, 'SHA256SUMS'), `${createHash('sha256').update(readFileSync(first.archive)).digest('hex')}  ${first.archive.split('/').at(-1)}\n`)
      const unsafe = install(); assert.notEqual(unsafe.status, 0); assert.match(unsafe.stderr, /links or special files/)
    }
    assert.equal(readFileSync(join(data, 'sentinel'), 'utf8'), 'existing business data')
    assert.deepEqual(readdirSync(data), ['sentinel'])
    assert.equal(existsSync(join(account, '.rovai')), false)
  } finally { rmSync(fixture, { recursive: true, force: true }) }
})
