import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ResolvedTheme, ThemePreference } from '@contracts'

const THEME_PREFERENCES = new Set<ThemePreference>(['system', 'day', 'night'])

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && THEME_PREFERENCES.has(value as ThemePreference)
}

export function readThemePreference(filePath: string): ThemePreference {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object') return 'system'
    const preference = (parsed as { themePreference?: unknown }).themePreference
    return isThemePreference(preference) ? preference : 'system'
  } catch {
    return 'system'
  }
}

export async function writeThemePreference(
  filePath: string,
  preference: ThemePreference
): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await mkdir(dirname(filePath), { recursive: true })
  try {
    await writeFile(tempPath, `${JSON.stringify({
      schemaVersion: 1,
      themePreference: preference
    }, null, 2)}\n`, { mode: 0o600 })
    await rename(tempPath, filePath)
  } catch (error) {
    await unlink(tempPath).catch(() => undefined)
    throw error
  }
}

export function nativeThemeSource(
  _preference: ThemePreference
): 'light' {
  return 'light'
}

export function resolvedTheme(_shouldUseDarkColors: boolean): ResolvedTheme {
  return 'day'
}

export function themeBackground(_theme: ResolvedTheme): string {
  return '#F2F4F1'
}
