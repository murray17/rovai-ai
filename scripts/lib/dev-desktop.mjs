import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'

export function defaultDevelopmentUserDataDirectory({
  repositoryRoot,
  temporaryRoot = tmpdir()
}) {
  const repositoryKey = createHash('sha256')
    .update(resolve(repositoryRoot))
    .digest('hex')
    .slice(0, 12)
  return join(temporaryRoot, 'rovai-ai-development', repositoryKey, 'user-data')
}

export function knownDailyUserDataDirectories({
  homeDirectory = homedir(),
  platform = process.platform
} = {}) {
  if (platform === 'darwin') {
    const applicationSupport = join(homeDirectory, 'Library', 'Application Support')
    return ['Rovai-ai', 'lumen-ai', 'Lumen AI'].map((name) => join(applicationSupport, name))
  }
  if (platform === 'win32') {
    const applicationData = process.env.APPDATA
    return applicationData
      ? ['Rovai-ai', 'lumen-ai', 'Lumen AI'].map((name) => join(applicationData, name))
      : []
  }
  return ['Rovai-ai', 'lumen-ai', 'Lumen AI'].map((name) => join(homeDirectory, '.local', 'share', name))
}

export function assertDevelopmentUserDataIsIsolated(
  candidate,
  { dailyDirectories = knownDailyUserDataDirectories() } = {}
) {
  const resolvedCandidate = resolve(candidate)
  for (const dailyDirectory of dailyDirectories.map((path) => resolve(path))) {
    if (resolvedCandidate === dailyDirectory || resolvedCandidate.startsWith(`${dailyDirectory}${sep}`)) {
      throw new Error(
        `Development userData must not use the daily Rovai directory: ${resolvedCandidate}`
      )
    }
  }
  return resolvedCandidate
}

export function acquireDevelopmentLaunchLock(userDataDirectory, processId = process.pid) {
  mkdirSync(userDataDirectory, { recursive: true })
  const lockPath = join(userDataDirectory, '.development-instance.lock')
  if (existsSync(lockPath)) {
    const existingProcessId = Number.parseInt(readFileSync(lockPath, 'utf8').trim(), 10)
    if (Number.isInteger(existingProcessId) && processIsRunning(existingProcessId)) {
      throw new Error(
        `Development userData is already in use by process ${existingProcessId}: ${userDataDirectory}`
      )
    }
    unlinkSync(lockPath)
  }
  mkdirSync(dirname(lockPath), { recursive: true })
  writeFileSync(lockPath, `${processId}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  return () => {
    if (!existsSync(lockPath)) return
    const owner = readFileSync(lockPath, 'utf8').trim()
    if (owner === String(processId)) unlinkSync(lockPath)
  }
}

function processIsRunning(processId) {
  try {
    process.kill(processId, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}
