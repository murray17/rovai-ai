import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { installMacosDaily } from './install-macos-daily.mjs'

test('installs only after source and same-volume stage verification', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'rovai-daily-install-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const source = join(directory, 'source.app')
  const target = join(directory, 'target.app')
  const backup = join(directory, 'backup.app')
  writeFileSync(source, 'new')
  writeFileSync(target, 'old')
  const verified = []

  const result = installMacosDaily({
    sourcePath: source,
    targetPath: target,
    backupPath: backup,
    arch: 'arm64',
    verifyApp(candidate) { verified.push(candidate) },
    copyApp(from, to) { cpSync(from, to) }
  })

  assert.equal(readFileSync(source, 'utf8'), 'new')
  assert.equal(readFileSync(target, 'utf8'), 'new')
  assert.equal(readFileSync(backup, 'utf8'), 'old')
  assert.equal(result.backupPath, backup)
  assert.equal(verified.length, 3)
  assert.equal(verified[0], source)
  assert.equal(verified[2], target)
})

test('refuses an unverified source before changing the daily installation', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'rovai-daily-reject-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const source = join(directory, 'source.app')
  const target = join(directory, 'target.app')
  const backup = join(directory, 'backup.app')
  writeFileSync(source, 'adhoc')
  writeFileSync(target, 'old')

  assert.throws(() => installMacosDaily({
    sourcePath: source,
    targetPath: target,
    backupPath: backup,
    arch: 'arm64',
    verifyApp() { throw new Error('App uses an ad-hoc signature') },
    copyApp() { throw new Error('copy must not run') }
  }), /ad-hoc signature/)

  assert.equal(readFileSync(target, 'utf8'), 'old')
  assert.equal(existsSync(backup), false)
})

test('restores the original target when installed verification fails', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'rovai-daily-rollback-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const source = join(directory, 'source.app')
  const target = join(directory, 'target.app')
  const backup = join(directory, 'backup.app')
  writeFileSync(source, 'new')
  writeFileSync(target, 'old')
  let verificationCount = 0

  assert.throws(() => installMacosDaily({
    sourcePath: source,
    targetPath: target,
    backupPath: backup,
    arch: 'arm64',
    verifyApp() {
      verificationCount += 1
      if (verificationCount === 3) throw new Error('installed verification failed')
    },
    copyApp(from, to) { cpSync(from, to) }
  }), /original installation restored/)

  assert.equal(readFileSync(target, 'utf8'), 'old')
  assert.equal(existsSync(backup), false)
  assert.equal(
    existsSync(join(directory, 'source.app')),
    true
  )
})
