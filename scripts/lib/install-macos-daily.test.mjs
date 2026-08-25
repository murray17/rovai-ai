import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  DailyMacosInstallError,
  assertAdmittedDailyInstallTarget,
  installMacosDaily,
  installMacosDailyTransactionForTest
} from './install-macos-daily.mjs'

test('installs only after source and same-volume stage verification', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'rovai-daily-install-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const source = join(directory, 'source.app')
  const target = join(directory, 'target.app')
  const backup = join(directory, 'backup.app')
  writeFileSync(source, 'new')
  writeFileSync(target, 'old')
  const verified = []

  const result = installMacosDailyTransactionForTest({
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

  assert.throws(() => installMacosDailyTransactionForTest({
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

test('rejects a non-App destructive target before verification or copy', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'rovai-daily-target-guard-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const source = join(directory, 'source.app')
  const target = join(directory, 'Applications')
  const backup = join(directory, 'Applications.backup.app')
  writeFileSync(source, 'new')
  writeFileSync(target, 'must-not-move')
  let verificationCount = 0
  let copyCount = 0

  assert.throws(() => installMacosDaily({
    sourcePath: source,
    targetPath: target,
    backupPath: backup,
    arch: 'arm64',
    verifyApp() { verificationCount += 1 },
    copyApp(from, to) {
      copyCount += 1
      cpSync(from, to)
    }
  }), /admitted daily App target/)

  assert.equal(readFileSync(target, 'utf8'), 'must-not-move')
  assert.equal(existsSync(backup), false)
  assert.equal(verificationCount, 0)
  assert.equal(copyCount, 0)
  assert.equal(
    assertAdmittedDailyInstallTarget('/Applications/Rovai AI.app'),
    '/Applications/Rovai AI.app'
  )
  assert.throws(() => assertAdmittedDailyInstallTarget('/'), /admitted daily App target/)
  assert.throws(() => assertAdmittedDailyInstallTarget('/Applications'), /admitted daily App target/)
  assert.throws(
    () => assertAdmittedDailyInstallTarget(join(directory, 'dist', 'Rovai AI.app')),
    /admitted daily App target/
  )
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

  assert.throws(() => installMacosDailyTransactionForTest({
    sourcePath: source,
    targetPath: target,
    backupPath: backup,
    arch: 'arm64',
    verifyApp() {
      verificationCount += 1
      if (verificationCount === 3) throw new Error('installed verification failed')
    },
    copyApp(from, to) { cpSync(from, to) }
  }), (error) => {
    assert.ok(error instanceof DailyMacosInstallError)
    assert.equal(error.recovery.canonicalTarget, 'original_restored')
    assert.equal(error.recovery.failedCandidate, 'retained_outside_canonical_path')
    assert.equal(error.recovery.originalInstallation, 'restored_to_canonical_path')
    assert.match(error.message, /canonical target restored to the original installation/)
    return true
  })

  assert.equal(readFileSync(target, 'utf8'), 'old')
  assert.equal(existsSync(backup), false)
  assert.equal(
    existsSync(join(directory, 'source.app')),
    true
  )
})

test('reports an occupied canonical target when the failed candidate cannot be moved', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'rovai-daily-candidate-stuck-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const source = join(directory, 'source.app')
  const target = join(directory, 'target.app')
  const backup = join(directory, 'backup.app')
  writeFileSync(source, 'new')
  writeFileSync(target, 'old')
  let verificationCount = 0

  assert.throws(() => installMacosDailyTransactionForTest({
    sourcePath: source,
    targetPath: target,
    backupPath: backup,
    arch: 'arm64',
    verifyApp() {
      verificationCount += 1
      if (verificationCount === 3) throw new Error('installed verification failed')
    },
    copyApp(from, to) { cpSync(from, to) },
    fileSystem: {
      exists: existsSync,
      remove(path) { rmSync(path, { recursive: true }) },
      rename(from, to) {
        if (from === target && to.includes('.failed-')) throw new Error('candidate move denied')
        renameSync(from, to)
      }
    }
  }), (error) => {
    assert.ok(error instanceof DailyMacosInstallError)
    assert.equal(error.recovery.canonicalTarget, 'unverified_candidate_present')
    assert.equal(error.recovery.failedCandidate, 'still_at_canonical_path')
    assert.equal(error.recovery.originalInstallation, 'preserved_in_backup')
    assert.match(error.message, /canonical target still contains the unverified candidate/)
    return true
  })

  assert.equal(readFileSync(target, 'utf8'), 'new')
  assert.equal(readFileSync(backup, 'utf8'), 'old')
})

test('reports a missing canonical target when restoring the backup fails', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'rovai-daily-restore-stuck-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const source = join(directory, 'source.app')
  const target = join(directory, 'target.app')
  const backup = join(directory, 'backup.app')
  writeFileSync(source, 'new')
  writeFileSync(target, 'old')
  let verificationCount = 0

  assert.throws(() => installMacosDailyTransactionForTest({
    sourcePath: source,
    targetPath: target,
    backupPath: backup,
    arch: 'arm64',
    verifyApp() {
      verificationCount += 1
      if (verificationCount === 3) throw new Error('installed verification failed')
    },
    copyApp(from, to) { cpSync(from, to) },
    fileSystem: {
      exists: existsSync,
      remove(path) { rmSync(path, { recursive: true }) },
      rename(from, to) {
        if (from === backup && to === target) throw new Error('restore denied')
        renameSync(from, to)
      }
    }
  }), (error) => {
    assert.ok(error instanceof DailyMacosInstallError)
    assert.equal(error.recovery.canonicalTarget, 'missing')
    assert.equal(error.recovery.failedCandidate, 'retained_outside_canonical_path')
    assert.equal(error.recovery.originalInstallation, 'preserved_in_backup')
    assert.match(error.message, /canonical target is missing/)
    return true
  })

  assert.equal(existsSync(target), false)
  assert.equal(readFileSync(backup, 'utf8'), 'old')
})
