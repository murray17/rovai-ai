import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ResolvedTheme, StructuredError, ThemePreference } from '@contracts'

const THEME_PREFERENCES = new Set<ThemePreference>(['system', 'day', 'night'])

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && THEME_PREFERENCES.has(value as ThemePreference)
}

export function readThemePreference(filePath: string): ThemePreference {
  return readThemePreferenceResult(filePath).preference
}

export function readThemePreferenceResult(filePath: string): {
  preference: ThemePreference
  degradation: StructuredError | null
} {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object') return invalidThemePreferenceResult()
    const preference = (parsed as { themePreference?: unknown }).themePreference
    return isThemePreference(preference)
      ? { preference, degradation: null }
      : invalidThemePreferenceResult()
  } catch (error) {
    if (isMissingPathError(error)) return { preference: 'system', degradation: null }
    return {
      preference: 'system',
      degradation: {
        code: 'appearance_preferences_unreadable',
        message: 'Appearance preferences could not be read; the system theme is active in memory and the original file was not changed.',
        retryable: true,
        details: {}
      }
    }
  }
}

function invalidThemePreferenceResult(): {
  preference: ThemePreference
  degradation: StructuredError
} {
  return {
    preference: 'system',
    degradation: {
      code: 'appearance_preferences_invalid',
      message: 'Appearance preferences are invalid; the system theme is active in memory and the original file was not changed.',
      retryable: true,
      details: {}
    }
  }
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT'
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
  preference: ThemePreference
): 'system' | 'light' | 'dark' {
  if (preference === 'day') return 'light'
  if (preference === 'night') return 'dark'
  return 'system'
}

export function resolvedTheme(shouldUseDarkColors: boolean): ResolvedTheme {
  return shouldUseDarkColors ? 'night' : 'day'
}

export function themeBackground(theme: ResolvedTheme): string {
  return theme === 'night' ? '#0D1114' : '#F2F4F1'
}
