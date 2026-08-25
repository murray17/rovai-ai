import { spawnSync } from 'node:child_process'
import {
  existsSync,
  renameSync,
  rmSync
} from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { verifyMacosApp } from './macos-app-verification.mjs'

function copyAppWithDitto(sourcePath, destinationPath) {
  const result = spawnSync('/usr/bin/ditto', [sourcePath, destinationPath], {
    encoding: 'utf8'
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`ditto failed (${result.status}): ${output}`)
}

export function installMacosDaily({
  sourcePath,
  targetPath,
  backupPath,
  arch,
  root = process.cwd(),
  verifyApp = (candidate) => verifyMacosApp(candidate, arch, { root }),
  copyApp = copyAppWithDitto
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
  if (!existsSync(source)) throw new Error(`signed source App does not exist: ${source}`)
  if (existsSync(backup)) throw new Error(`backup path already exists: ${backup}`)

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

    if (existsSync(target)) {
      renameSync(target, backup)
      originalMoved = true
    }
    renameSync(stage, target)
    newInstalled = true
    verifyApp(target)

    return {
      sourcePath: source,
      targetPath: target,
      backupPath: originalMoved ? backup : null
    }
  } catch (error) {
    const rollbackNotes = []
    try {
      if (newInstalled && existsSync(target)) {
        renameSync(target, failed)
        rollbackNotes.push(`failed candidate retained at ${failed}`)
      }
      if (originalMoved && existsSync(backup) && !existsSync(target)) {
        renameSync(backup, target)
        rollbackNotes.push('original installation restored')
      }
      if (existsSync(stage)) rmSync(stage, { recursive: true })
    } catch (rollbackError) {
      rollbackNotes.push(
        `rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
      )
    }
    const message = error instanceof Error ? error.message : String(error)
    const suffix = rollbackNotes.length > 0 ? `; ${rollbackNotes.join('; ')}` : ''
    throw new Error(`daily macOS install failed: ${message}${suffix}`, { cause: error })
  }
}

export function defaultDailyBackupPath(targetPath, now = new Date()) {
  const stamp = now.toISOString().replaceAll(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const name = basename(targetPath, '.app')
  return join(dirname(targetPath), `${name}.backup-before-${stamp}.app`)
}
