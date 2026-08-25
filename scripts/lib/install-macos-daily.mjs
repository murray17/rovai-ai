import { spawnSync } from 'node:child_process'
import {
  existsSync,
  renameSync,
  rmSync
} from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { verifyMacosApp } from './macos-app-verification.mjs'

const DAILY_APP_NAME = 'Rovai AI.app'
const DEFAULT_FILE_SYSTEM = Object.freeze({
  exists: existsSync,
  rename: renameSync,
  remove: (path) => rmSync(path, { recursive: true })
})

function copyAppWithDitto(sourcePath, destinationPath) {
  const result = spawnSync('/usr/bin/ditto', [sourcePath, destinationPath], {
    encoding: 'utf8'
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`ditto failed (${result.status}): ${output}`)
}

export function installMacosDaily(options) {
  assertAdmittedDailyInstallTarget(options.targetPath)
  return installMacosDailyTransactionForTest(options)
}

export function installMacosDailyTransactionForTest({
  sourcePath,
  targetPath,
  backupPath,
  arch,
  root = process.cwd(),
  verifyApp = (candidate) => verifyMacosApp(candidate, arch, { root }),
  copyApp = copyAppWithDitto,
  fileSystem = DEFAULT_FILE_SYSTEM
}) {
  const source = resolve(sourcePath)
  if (!isAbsolute(targetPath) || !isAbsolute(backupPath)) {
    throw new Error('daily install target and backup paths must be absolute')
  }
  const target = resolve(targetPath)
  const backup = resolve(backupPath)
  if (source === target || source === backup || target === backup) {
    throw new Error('daily install source, target, and backup paths must be distinct')
  }
  if (dirname(target) !== dirname(backup)) {
    throw new Error('daily install target and backup must use the same directory')
  }
  if (!fileSystem.exists(source)) throw new Error(`signed source App does not exist: ${source}`)
  if (fileSystem.exists(backup)) throw new Error(`backup path already exists: ${backup}`)

  const installDirectory = dirname(target)
  const nonce = `${process.pid}-${randomUUID()}`
  const stage = join(installDirectory, `.${basename(target)}.installing-${nonce}`)
  const failed = join(installDirectory, `.${basename(target)}.failed-${nonce}`)
  let originalMoved = false
  let newInstalled = false

  try {
    verifyApp(source)
    copyApp(source, stage)
    verifyApp(stage)

    if (fileSystem.exists(target)) {
      fileSystem.rename(target, backup)
      originalMoved = true
    }
    fileSystem.rename(stage, target)
    newInstalled = true
    verifyApp(target)

    return {
      sourcePath: source,
      targetPath: target,
      backupPath: originalMoved ? backup : null
    }
  } catch (error) {
    const recovery = recoverDailyInstallation({
      backup,
      failed,
      fileSystem,
      newInstalled,
      originalMoved,
      stage,
      target
    })
    const message = error instanceof Error ? error.message : String(error)
    throw new DailyMacosInstallError(
      `daily macOS install failed: ${message}; ${recovery.summary}`,
      recovery,
      { cause: error }
    )
  }
}

export function assertAdmittedDailyInstallTarget(targetPath) {
  if (typeof targetPath !== 'string' || !isAbsolute(targetPath)) {
    throw new Error('daily install target must be an admitted daily App target')
  }
  const target = resolve(targetPath)
  const admittedTarget = `/Applications/${DAILY_APP_NAME}`
  if (target !== admittedTarget) {
    throw new Error(
      `daily install target must be the admitted daily App target: ${admittedTarget}`
    )
  }
  return target
}

export class DailyMacosInstallError extends Error {
  constructor(message, recovery, options) {
    super(message, options)
    this.name = 'DailyMacosInstallError'
    this.recovery = recovery
  }
}

function recoverDailyInstallation({
  backup,
  failed,
  fileSystem,
  newInstalled,
  originalMoved,
  stage,
  target
}) {
  const errors = []
  let failedCandidate = 'not_present'
  let originalInstallation = originalMoved ? 'preserved_in_backup' : 'not_applicable'
  let stageCleanup = 'not_needed'

  if (newInstalled && fileSystem.exists(target)) {
    try {
      fileSystem.rename(target, failed)
      failedCandidate = 'retained_outside_canonical_path'
    } catch (error) {
      failedCandidate = 'still_at_canonical_path'
      errors.push(`failed candidate move: ${errorMessage(error)}`)
    }
  }

  if (originalMoved && fileSystem.exists(backup)) {
    if (fileSystem.exists(target)) {
      errors.push('original restore blocked because the canonical target is occupied')
    } else {
      try {
        fileSystem.rename(backup, target)
        originalInstallation = 'restored_to_canonical_path'
      } catch (error) {
        errors.push(`original restore: ${errorMessage(error)}`)
      }
    }
  }

  if (fileSystem.exists(stage)) {
    try {
      fileSystem.remove(stage)
      stageCleanup = 'removed'
    } catch (error) {
      stageCleanup = 'retained'
      errors.push(`stage cleanup: ${errorMessage(error)}`)
    }
  }

  const canonicalTarget = originalInstallation === 'restored_to_canonical_path'
    ? 'original_restored'
    : fileSystem.exists(target)
      ? 'unverified_candidate_present'
      : 'missing'
  const summary = canonicalTarget === 'original_restored'
    ? 'canonical target restored to the original installation'
    : canonicalTarget === 'unverified_candidate_present'
      ? `canonical target still contains the unverified candidate; original backup state: ${originalInstallation}`
      : `canonical target is missing; original backup state: ${originalInstallation}`

  return {
    canonicalTarget,
    errors,
    failedCandidate,
    originalInstallation,
    stageCleanup,
    summary
  }
}

export function defaultDailyBackupPath(targetPath, now = new Date()) {
  const stamp = now.toISOString().replaceAll(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const name = basename(targetPath, '.app')
  return join(dirname(targetPath), `${name}.backup-before-${stamp}.app`)
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
