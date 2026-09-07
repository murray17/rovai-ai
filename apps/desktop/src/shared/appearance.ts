import type { AppearancePreferences } from '@contracts'

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
export const APPEARANCE_ZOOM_OPTIONS = Array.from({ length: 13 }, (_, index) => 80 + index * 10)

export function appearancePreferencesEqual(a: AppearancePreferences, b: AppearancePreferences): boolean {
  return (Object.keys(DEFAULT_APPEARANCE) as Array<keyof AppearancePreferences>)
    .every((key) => a[key] === b[key])
}
