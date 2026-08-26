import { spawnSync } from 'node:child_process'
import {
  lstatSync,
  renameSync,
  rmSync
} from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { verifyAdhocMacosApp } from './macos-app-verification.mjs'

const DAILY_APP_NAME = 'Rovai AI.app'
const DEFAULT_FILE_SYSTEM = Object.freeze({
  pathEntry: noFollowPathEntry,
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
  verifyApp = (candidate) => verifyAdhocMacosApp(candidate, arch, { root }),
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
  if (fileSystem.pathEntry(source) === 'absent') {
    throw new Error(`ad-hoc source App does not exist: ${source}`)
  }
  if (fileSystem.pathEntry(backup) !== 'absent') {
    throw new Error(`backup path already exists: ${backup}`)
  }
  const initialTargetEntry = fileSystem.pathEntry(target)
  if (initialTargetEntry === 'symbolic_link') {
    throw new Error('daily install canonical target path entry must not be a symbolic link')
  }

  const installDirectory = dirname(target)
  const nonce = `${process.pid}-${randomUUID()}`
  const stage = join(installDirectory, `.${basename(target)}.installing-${nonce}`)
  const failed = join(installDirectory, `.${basename(target)}.failed-${nonce}`)
  let originalMoved = false
  let originalPresent = initialTargetEntry === 'present'
  let newInstalled = false

  try {
    verifyApp(source)
    copyApp(source, stage)
    verifyApp(stage)

    if (fileSystem.pathEntry(backup) !== 'absent') {
      throw new Error(`backup path already exists: ${backup}`)
    }
    const targetEntryBeforeSwap = fileSystem.pathEntry(target)
    if (targetEntryBeforeSwap === 'symbolic_link') {
      throw new Error('daily install canonical target path entry must not be a symbolic link')
    }
    if (targetEntryBeforeSwap === 'present') {
      originalPresent = true
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
      originalPresent,
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
  originalPresent,
  stage,
  target
}) {
  const errors = []
  let failedCandidate = 'not_present'
  let originalInstallation = originalMoved
    ? 'preserved_in_backup'
    : originalPresent
      ? 'unchanged_at_canonical_path'
      : 'not_applicable'
  let stageCleanup = 'not_needed'

  if (newInstalled && fileSystem.pathEntry(target) !== 'absent') {
    try {
      fileSystem.rename(target, failed)
      failedCandidate = 'retained_outside_canonical_path'
    } catch (error) {
      failedCandidate = 'still_at_canonical_path'
      errors.push(`failed candidate move: ${errorMessage(error)}`)
    }
  }

  const backupEntry = originalMoved ? fileSystem.pathEntry(backup) : 'absent'
  if (originalMoved && backupEntry === 'absent') {
    originalInstallation = 'backup_missing'
    errors.push('original restore failed because the backup path entry is missing')
  } else if (originalMoved) {
    if (backupEntry === 'symbolic_link') {
      originalInstallation = 'backup_path_replaced'
      errors.push('original restore blocked because the backup path entry is a symbolic link')
    } else if (fileSystem.pathEntry(target) !== 'absent') {
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

  if (fileSystem.pathEntry(stage) !== 'absent') {
    try {
      fileSystem.remove(stage)
      stageCleanup = 'removed'
    } catch (error) {
      stageCleanup = 'retained'
      errors.push(`stage cleanup: ${errorMessage(error)}`)
    }
  }

  const canonicalEntry = fileSystem.pathEntry(target)
  let canonicalTarget
  if (originalInstallation === 'restored_to_canonical_path') {
    canonicalTarget = 'original_restored'
  } else if (
    originalInstallation === 'unchanged_at_canonical_path'
    && canonicalEntry === 'present'
  ) {
    canonicalTarget = 'original_unchanged'
  } else {
    canonicalTarget = canonicalEntry === 'absent' ? 'missing' : 'unverified_candidate_present'
  }
  let summary
  if (canonicalTarget === 'original_restored') {
    summary = 'canonical target restored to the original installation'
  } else if (canonicalTarget === 'original_unchanged') {
    summary = 'original installation remains unchanged at the canonical target'
  } else if (canonicalTarget === 'unverified_candidate_present') {
    summary = `canonical target still contains the unverified candidate; original backup state: ${originalInstallation}`
  } else {
    summary = `canonical target is missing; original backup state: ${originalInstallation}`
  }

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

function noFollowPathEntry(path) {
  try {
    return lstatSync(path).isSymbolicLink() ? 'symbolic_link' : 'present'
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 'absent'
    throw error
  }
}
