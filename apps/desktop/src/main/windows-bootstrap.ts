import { createHash } from 'node:crypto'
import { win32 } from 'node:path'
import type { StructuredError } from '@contracts'
import {
  bindWindowsDataRootBeforeReady,
  type ElectronPathBinder,
  type WindowsBootstrapLayout,
  type WindowsDataRootLayout
} from './windows-data-root'

export type WindowsBootstrapAssessment =
  | { kind: 'ready'; layout: WindowsDataRootLayout }
  | { kind: 'blocked'; error: StructuredError }
  | { kind: 'secondary' }
  | { kind: 'shell_storage_unavailable'; error: StructuredError }

type WindowsUpdateQuitRequest = { kind: 'quit-for-update'; executablePath: string }

export function windowsSecondInstanceAction(data: unknown, executablePath: string): 'restore' | 'quit' | 'ignore' {
  if (!data || typeof data !== 'object' || !('kind' in data) || data.kind !== 'quit-for-update') return 'restore'
  if (!('executablePath' in data) || typeof data.executablePath !== 'string' || !win32.isAbsolute(data.executablePath)) return 'ignore'
  return win32.normalize(data.executablePath).toLowerCase() === win32.normalize(executablePath).toLowerCase()
    ? 'quit' : 'ignore'
}

/** Stable before either successful or failed full-root preparation. Not an ACL/identity claim. */
export function windowsBootstrapInstanceKey(explicitRoot: string | null): string {
  const identity = explicitRoot === null ? 'daily' : `explicit:${win32.normalize(explicitRoot).toLowerCase()}`
  return createHash('sha256').update(identity).digest('hex').slice(0, 32)
}

/** Synchronous pre-ready composition. Authority preparation never escapes into Main module loading. */
export function assessWindowsDesktopBootstrap({
  electronApp,
  prepareShell,
  prepareAuthority,
  isolatedInstance = false,
  quitForUpdate
}: {
  electronApp: ElectronPathBinder & { requestSingleInstanceLock(data?: WindowsUpdateQuitRequest): boolean }
  prepareShell(): WindowsBootstrapLayout
  prepareAuthority(): WindowsDataRootLayout
  isolatedInstance?: boolean
  quitForUpdate?: WindowsUpdateQuitRequest
}): WindowsBootstrapAssessment {
  let shell: WindowsBootstrapLayout
  try {
    shell = prepareShell()
    bindWindowsDataRootBeforeReady(electronApp, shell)
    // Electron's lock uses userData. Every instance first binds the same private
    // bootstrap profile, even when a previous instance admitted the formal root.
    if (quitForUpdate) {
      electronApp.requestSingleInstanceLock(quitForUpdate)
      return { kind: 'secondary' }
    }
    if (!isolatedInstance && !electronApp.requestSingleInstanceLock()) return { kind: 'secondary' }
  } catch (error) {
    return { kind: 'shell_storage_unavailable', error: storageFailure('windows_bootstrap_storage_unavailable', error) }
  }
  try {
    const layout = prepareAuthority()
    bindWindowsDataRootBeforeReady(electronApp, layout)
    return { kind: 'ready', layout }
  } catch (error) {
    // setPath can fail partway through binding. Restore all shell paths before
    // ready; never launch Chromium against a partially admitted formal layout.
    try {
      bindWindowsDataRootBeforeReady(electronApp, shell)
    } catch (shellError) {
      return { kind: 'shell_storage_unavailable', error: storageFailure('windows_bootstrap_storage_unavailable', shellError) }
    }
    return { kind: 'blocked', error: storageFailure('windows_data_root_preparation_failed', error) }
  }
}

function storageFailure(code: string, error: unknown): StructuredError {
  return {
    code,
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
    details: { phase: 'preparing_windows_data_root' }
  }
}
