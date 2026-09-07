import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AppearancePreferences, ResolvedTheme, StructuredError, ThemePreference } from '@contracts'
import { DEFAULT_APPEARANCE, MIN_READING_FONT_SIZE, MAX_READING_FONT_SIZE } from '../shared/appearance'
import { MIN_PAGE_ZOOM_PERCENTAGE, MAX_PAGE_ZOOM_PERCENTAGE } from './page-zoom'

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'day' || value === 'night'
}

export function parseAppearancePatch(value: unknown): Partial<AppearancePreferences> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid appearance preferences')
  }
  const patch = value as Record<string, unknown>
  for (const [key, field] of Object.entries(patch)) {
    let valid = false
    if (key === 'preference') valid = isThemePreference(field)
    if (key === 'readingDensity') valid = field === 'standard' || field === 'relaxed'
    if (key === 'motionPreference') valid = field === 'system' || field === 'reduce'
    if (['chatFontSize', 'documentFontSize', 'codeFontSize'].includes(key)) {
      valid = typeof field === 'number' && Number.isInteger(field)
        && field >= MIN_READING_FONT_SIZE && field <= MAX_READING_FONT_SIZE
    }
    if (key === 'zoomPercentage') {
      valid = typeof field === 'number' && Number.isInteger(field)
        && field >= MIN_PAGE_ZOOM_PERCENTAGE && field <= MAX_PAGE_ZOOM_PERCENTAGE
    }
    if (!valid) throw new Error('Invalid appearance preference value')
  }
  return { ...patch } as Partial<AppearancePreferences>
}

export function readAppearancePreferences(filePath: string): {
  preferences: AppearancePreferences
  degradation: StructuredError | null
} {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || !isThemePreference(parsed.themePreference)) throw new Error('Invalid appearance file')
    if (parsed.schemaVersion === 1 || parsed.schemaVersion === undefined) {
      return { preferences: { ...DEFAULT_APPEARANCE, preference: parsed.themePreference }, degradation: null }
    }
    if (parsed.schemaVersion !== 2) throw new Error('Unsupported appearance schema')
    const { schemaVersion: _schema, themePreference, ...reading } = parsed
    const patch = parseAppearancePatch({ ...reading, preference: themePreference })
    if (Object.keys(patch).length !== Object.keys(DEFAULT_APPEARANCE).length) {
      throw new Error('Incomplete appearance preferences')
    }
    return { preferences: { ...DEFAULT_APPEARANCE, ...patch }, degradation: null }
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined
    if (code === 'ENOENT') return { preferences: { ...DEFAULT_APPEARANCE }, degradation: null }
    return {
      preferences: { ...DEFAULT_APPEARANCE },
      degradation: {
        code: code || error instanceof SyntaxError ? 'appearance_preferences_unreadable' : 'appearance_preferences_invalid',
        message: 'Appearance preferences could not be loaded; defaults are active in memory and the original file was not changed.',
        retryable: true,
        details: {}
      }
    }
  }
}

async function writeAppearancePreferences(filePath: string, preferences: AppearancePreferences): Promise<void> {
  const tempPath = `${filePath}.${randomUUID()}.tmp`
  const { preference, ...reading } = preferences
  await mkdir(dirname(filePath), { recursive: true })
  try {
    await writeFile(tempPath, `${JSON.stringify({ schemaVersion: 2, themePreference: preference, ...reading }, null, 2)}\n`, { mode: 0o600 })
    await rename(tempPath, filePath)
  } catch (error) {
    await unlink(tempPath).catch(() => undefined)
    throw error
  }
}

/** Serialize writes and merge patches against the last successfully persisted state. */
export class AppearancePreferencesStore {
  private preferences: AppearancePreferences
  private queue: Promise<unknown> = Promise.resolve()
  private loadDegradation: StructuredError | null

  get degradation(): StructuredError | null { return this.loadDegradation }

  constructor(private readonly filePath: string) {
    const loaded = readAppearancePreferences(filePath)
    this.preferences = loaded.preferences
    this.loadDegradation = loaded.degradation
  }

  get(): AppearancePreferences { return { ...this.preferences } }

  update(value: unknown): Promise<AppearancePreferences> {
    const patch = parseAppearancePatch(value)
    const operation = this.queue.then(async () => {
      const next = { ...this.preferences, ...patch }
      await writeAppearancePreferences(this.filePath, next)
      this.preferences = next
      this.loadDegradation = null
      return this.get()
    })
    this.queue = operation.catch(() => undefined)
    return operation
  }
}

export function readThemePreference(filePath: string): ThemePreference {
  return readAppearancePreferences(filePath).preferences.preference
}

export function readThemePreferenceResult(filePath: string): { preference: ThemePreference; degradation: StructuredError | null } {
  const loaded = readAppearancePreferences(filePath)
  return { preference: loaded.preferences.preference, degradation: loaded.degradation }
}

export async function writeThemePreference(filePath: string, preference: ThemePreference): Promise<void> {
  await new AppearancePreferencesStore(filePath).update({ preference })
}

export function nativeThemeSource(preference: ThemePreference): 'system' | 'light' | 'dark' {
  return preference === 'day' ? 'light' : preference === 'night' ? 'dark' : 'system'
}

export function resolvedTheme(shouldUseDarkColors: boolean): ResolvedTheme {
  return shouldUseDarkColors ? 'night' : 'day'
}

export function themeBackground(theme: ResolvedTheme): string {
  return theme === 'night' ? '#0D1114' : '#F2F4F1'
}
