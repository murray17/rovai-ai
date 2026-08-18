import { spawnSync } from 'node:child_process'
import { win32 } from 'node:path'

export type WindowsDataRootLayout = {
  root: string
  core: string
  electronUserData: string
  electronSessionData: string
  logs: string
  crashDumps: string
}

type DataRootPreparationResult = {
  status: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  error?: Error
}

type DataRootPreparer = (
  binary: string,
  arguments_: readonly string[]
) => DataRootPreparationResult

type ElectronPathBinder = {
  setPath(name: string, path: string): void
  setAppLogsPath(path: string): void
}

const WINDOWS_PREPARATION_TIMEOUT_MS = 15_000
const WINDOWS_PREPARATION_MAX_OUTPUT_BYTES = 64 * 1024

export function resolveWindowsDataRoot(
  explicitRoot: string | null,
  localAppData: string | undefined
): string {
  const candidate = explicitRoot !== null
    ? explicitRoot
    : localAppData
      ? win32.join(localAppData, 'Rovai AI')
      : ''
  if (!candidate) {
    throw new Error(
      'windows_storage.host_unsupported: LOCALAPPDATA is unavailable and no explicit user-data root was provided'
    )
  }
  if (candidate.includes('\0')) {
    throw new Error('windows_storage.host_unsupported: Windows data root contains NUL')
  }
  const native = candidate.replaceAll('/', '\\')
  const isDrivePath = /^(?:\\\\\?\\)?[a-z]:\\/i.test(native)
  if (!isDrivePath || !win32.isAbsolute(native)) {
    throw new Error(
      'windows_storage.not_local: Windows data root must be an absolute drive path; UNC and device paths are not admitted'
    )
  }
  if (native.split('\\').some((component) => component === '.' || component === '..')) {
    throw new Error(
      'windows_storage.host_unsupported: Windows data root must be normalized'
    )
  }
  const normalized = win32.normalize(native)
  if (normalized.toLowerCase() === win32.parse(normalized).root.toLowerCase()) {
    throw new Error(
      'windows_storage.path_outside_tested_envelope: a volume root cannot be used as the Rovai data root'
    )
  }
  return normalized
}

export function expectedWindowsDataRootLayout(root: string): WindowsDataRootLayout {
  return {
    root,
    core: win32.join(root, 'Core'),
    electronUserData: win32.join(root, 'Electron', 'User Data'),
    electronSessionData: win32.join(root, 'Electron', 'Session Data'),
    logs: win32.join(root, 'Logs'),
    crashDumps: win32.join(root, 'CrashDumps')
  }
}

export function bindWindowsDataRootBeforeReady(
  electronApp: ElectronPathBinder,
  layout: WindowsDataRootLayout
): void {
  electronApp.setPath('userData', layout.electronUserData)
  electronApp.setPath('sessionData', layout.electronSessionData)
  electronApp.setAppLogsPath(layout.logs)
  electronApp.setPath('crashDumps', layout.crashDumps)
}

export function prepareWindowsDataRoot(
  coreBinary: string,
  root: string,
  prepare: DataRootPreparer = runDataRootPreparer
): WindowsDataRootLayout {
  const result = prepare(coreBinary, ['--prepare-windows-data-root', root])
  if (result.error) {
    throw new Error(`Windows data-root preparer could not start: ${result.error.message}`)
  }
  if (result.status !== 0) {
    const diagnostic = result.stderr.trim() || `status=${result.status}, signal=${result.signal}`
    throw new Error(`Windows data-root preparation failed: ${diagnostic}`)
  }
  return parseWindowsDataRootLayout(root, result.stdout)
}

export function parseWindowsDataRootLayout(
  requestedRoot: string,
  output: string
): WindowsDataRootLayout {
  const lines = output.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length !== 1) {
    throw new Error('Windows data-root preparer returned an invalid response frame')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(lines[0])
  } catch {
    throw new Error('Windows data-root preparer returned invalid JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Windows data-root preparer returned an invalid layout')
  }
  const record = parsed as Record<string, unknown>
  const keys = [
    'root',
    'core',
    'electronUserData',
    'electronSessionData',
    'logs',
    'crashDumps'
  ] as const
  if (
    Object.keys(record).sort().join('\0') !== [...keys].sort().join('\0')
    || keys.some((key) => typeof record[key] !== 'string')
  ) {
    throw new Error('Windows data-root preparer returned an unknown layout shape')
  }

  const expected = expectedWindowsDataRootLayout(requestedRoot)
  for (const key of keys) {
    const actual = record[key] as string
    if (actual.toLowerCase() !== expected[key].toLowerCase()) {
      throw new Error(`Windows data-root preparer returned an unexpected ${key} path`)
    }
  }
  return expected
}

function runDataRootPreparer(
  binary: string,
  arguments_: readonly string[]
): DataRootPreparationResult {
  const result = spawnSync(binary, arguments_, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: WINDOWS_PREPARATION_TIMEOUT_MS,
    maxBuffer: WINDOWS_PREPARATION_MAX_OUTPUT_BYTES,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error
  }
}
