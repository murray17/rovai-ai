import type { AppearancePreferences, ThemePreference } from '@contracts'

export const DEFAULT_APPEARANCE: Readonly<AppearancePreferences> = Object.freeze({
  preference: 'system',
  chatFontSize: 13,
  documentFontSize: 15,
  codeFontSize: 14,
  readingDensity: 'standard',
  motionPreference: 'system',
  zoomPercentage: 100
})

export const MIN_READING_FONT_SIZE = 12
export const MAX_READING_FONT_SIZE = 24
export const APPEARANCE_ZOOM_OPTIONS = [80, 90, 100, 110, 125, 150, 175, 200]

export function appearancePreferencesEqual(a: AppearancePreferences, b: AppearancePreferences): boolean {
  return (Object.keys(DEFAULT_APPEARANCE) as Array<keyof AppearancePreferences>)
    .every((key) => a[key] === b[key])
}

export const MIN_PAGE_ZOOM_PERCENTAGE = 10
export const MAX_PAGE_ZOOM_PERCENTAGE = 500

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
