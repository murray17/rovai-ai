import { spawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  acquireDevelopmentLaunchLock,
  assertDevelopmentUserDataIsIsolated,
  defaultDevelopmentUserDataDirectory
} from './lib/dev-desktop.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requestedUserDataDirectory = process.env.ROVAI_DEV_USER_DATA_DIR
  ?? defaultDevelopmentUserDataDirectory({ repositoryRoot })
const userDataDirectory = assertDevelopmentUserDataIsIsolated(requestedUserDataDirectory)
const electronViteCli = join(repositoryRoot, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')

accessSync(electronViteCli, constants.R_OK)

if (process.argv.includes('--print-config')) {
  console.log(JSON.stringify({
    appChannel: 'development',
    repositoryRoot,
    userDataDirectory,
    dailyUserDataIsolated: true
  }, null, 2))
  process.exit(0)
}

const releaseLock = acquireDevelopmentLaunchLock(userDataDirectory)
console.log(`[rovai-dev] isolated userData: ${userDataDirectory}`)
const electronViteArguments = process.argv.slice(2).filter((argument) => argument !== '--print-config')

const child = spawn(process.execPath, [
  electronViteCli,
  'dev',
  ...electronViteArguments,
  '--',
  `--user-data-dir=${userDataDirectory}`
], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    ROVAI_ALLOW_ISOLATED_INSTANCE: '1',
    ROVAI_DEV_USER_DATA_DIR: userDataDirectory
  },
  stdio: 'inherit'
})

let forwardedSignal = null
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    forwardedSignal = signal
    if (!child.killed) child.kill(signal)
  })
}

try {
  const result = await new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit)
    child.once('exit', (code, signal) => resolveExit({ code, signal }))
  })
  if (result.code !== 0 && !forwardedSignal) {
    throw new Error(
      result.signal
        ? `electron-vite was terminated by ${result.signal}`
        : `electron-vite failed with exit code ${result.code ?? 'unknown'}`
    )
  }
} finally {
  releaseLock()
}
