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
export const APPEARANCE_ZOOM_OPTIONS = [80, 90, 100, 110, 125, 150, 175, 200]

export function appearancePreferencesEqual(a: AppearancePreferences, b: AppearancePreferences): boolean {
  return (Object.keys(DEFAULT_APPEARANCE) as Array<keyof AppearancePreferences>)
    .every((key) => a[key] === b[key])
}
