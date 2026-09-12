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
// Chromium desktop presets, including the exact factors behind the rounded 33% and 67% labels.
// https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/common/page/page_zoom.cc
export const APPEARANCE_ZOOM_FACTORS = [
  0.25, 1 / 3, 0.5, 2 / 3, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5
]
export const APPEARANCE_ZOOM_OPTIONS = APPEARANCE_ZOOM_FACTORS.map((factor) => Math.round(factor * 100))

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
