import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const LEGACY_APP_NAMES = ['Horizonward', 'Horizonward AI', 'Lumen AI'] as const

export function legacyUserDataPath(
  appDataPath: string,
  currentAppName: string,
  hasExplicitUserDataPath: boolean,
  pathExists: (path: string) => boolean = existsSync
): string | null {
  if (hasExplicitUserDataPath) return null

  const currentPath = join(appDataPath, currentAppName)
  if (pathExists(currentPath)) return null

  for (const legacyAppName of LEGACY_APP_NAMES) {
    const legacyPath = join(appDataPath, legacyAppName)
    if (currentPath !== legacyPath && pathExists(legacyPath)) return legacyPath
  }
  return null
}
