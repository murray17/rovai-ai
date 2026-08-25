import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  defaultDailyBackupPath,
  installMacosDaily
} from './lib/install-macos-daily.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

try {
  const options = parseArguments(process.argv.slice(2))
  const sourcePath = resolve(options.source ?? `${root}/dist/mac-arm64/Rovai AI.app`)
  const targetPath = resolve(options.target ?? '/Applications/Rovai AI.app')
  const backupPath = resolve(options.backup ?? defaultDailyBackupPath(targetPath))
  const arch = options.arch ?? 'arm64'
  const result = installMacosDaily({
    sourcePath,
    targetPath,
    backupPath,
    arch,
    root
  })
  console.log('Stable-signed daily macOS App installed')
  console.log(`Source retained: ${result.sourcePath}`)
  console.log(`Installed: ${result.targetPath}`)
  console.log(`Backup: ${result.backupPath ?? 'none (target did not previously exist)'}`)
  console.log('A currently running old process was not restarted; reopen from the canonical path when ready.')
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

function parseArguments(args) {
  const options = {}
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    if (!['--source', '--target', '--backup', '--arch'].includes(flag)) {
      throw new Error(
        'Usage: node scripts/install-macos-daily.mjs '
        + '[--source app] [--target app] [--backup app] [--arch arm64|x64]'
      )
    }
    const value = args[index + 1]
    if (!value) throw new Error(`missing value for ${flag}`)
    options[flag.slice(2)] = value
    index += 1
  }
  if (options.arch && options.arch !== 'arm64' && options.arch !== 'x64') {
    throw new Error(`unsupported macOS architecture: ${options.arch}`)
  }
  return options
}
