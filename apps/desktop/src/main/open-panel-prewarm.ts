import { createRequire } from 'node:module'
import { join } from 'node:path'

interface OpenPanelPrewarmerModule {
  prewarm: () => number
}

interface OpenPanelPrewarmOptions {
  platform: NodeJS.Platform
  isPackaged: boolean
  resourcesPath: string
  appPath: string
  load?: (path: string) => unknown
}

export type OpenPanelPrewarmResult =
  | { status: 'skipped' }
  | {
      status: 'warmed'
      addonPath: string
      elapsedMs: number
      nativeElapsedMs: number
    }
  | { status: 'failed'; addonPath: string; error: unknown }

const require = createRequire(import.meta.url)

export function resolveOpenPanelPrewarmerPath(
  options: Pick<OpenPanelPrewarmOptions, 'isPackaged' | 'resourcesPath' | 'appPath'>
): string {
  return options.isPackaged
    ? join(options.resourcesPath, 'native', 'open-panel-prewarm.node')
    : join(options.appPath, 'resources', 'native', 'open-panel-prewarm.node')
}

export function prewarmMacOpenPanel(options: OpenPanelPrewarmOptions): OpenPanelPrewarmResult {
  if (options.platform !== 'darwin') return { status: 'skipped' }

  const addonPath = resolveOpenPanelPrewarmerPath(options)
  const startedAt = performance.now()
  try {
    const addon = (options.load ?? require)(addonPath) as Partial<OpenPanelPrewarmerModule>
    if (typeof addon.prewarm !== 'function') {
      throw new TypeError('macOS open-panel prewarmer does not export prewarm()')
    }
    const nativeElapsedMs = addon.prewarm()
    if (!Number.isFinite(nativeElapsedMs) || nativeElapsedMs < 0) {
      throw new TypeError('macOS open-panel prewarmer returned an invalid duration')
    }
    return {
      status: 'warmed',
      addonPath,
      elapsedMs: performance.now() - startedAt,
      nativeElapsedMs
    }
  } catch (error) {
    return { status: 'failed', addonPath, error }
  }
}
