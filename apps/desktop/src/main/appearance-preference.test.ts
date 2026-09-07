import { DEFAULT_APPEARANCE } from '../shared/appearance'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AppearancePreferencesStore,
  parseAppearancePatch,
  readAppearancePreferences,
  isThemePreference,
  nativeThemeSource,
  readThemePreference,
  readThemePreferenceResult,
  resolvedTheme,
  themeBackground,
  writeThemePreference
} from './appearance-preference'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('appearance preference', () => {
  it('validates the three public preference values', () => {
    expect(['system', 'day', 'night'].map(isThemePreference)).toEqual([true, true, true])
    expect(isThemePreference('dark')).toBe(false)
    expect(isThemePreference(null)).toBe(false)
  })

  it('maps preferences and system colors deterministically', () => {
    expect(nativeThemeSource('system')).toBe('system')
    expect(nativeThemeSource('day')).toBe('light')
    expect(nativeThemeSource('night')).toBe('dark')
    expect(resolvedTheme(false)).toBe('day')
    expect(resolvedTheme(true)).toBe('night')
    expect(themeBackground('day')).toBe('#F2F4F1')
    expect(themeBackground('night')).toBe('#0D1114')
  })

  it('persists a valid preference atomically and restores it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rovai-appearance-'))
    cleanup.push(directory)
    const filePath = join(directory, 'appearance.json')

    await writeThemePreference(filePath, 'night')

    expect(readThemePreference(filePath)).toBe('night')
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual({
      schemaVersion: 2,
      themePreference: 'night',
      chatFontSize: 13, documentFontSize: 15, codeFontSize: 14,
      readingDensity: 'standard', motionPreference: 'system', zoomPercentage: 100
    })
  })

  it('discards missing, malformed, and obsolete values', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rovai-appearance-'))
    cleanup.push(directory)
    const filePath = join(directory, 'appearance.json')

    expect(readThemePreference(filePath)).toBe('system')
    await writeFile(filePath, '{invalid', 'utf8')
    expect(readThemePreference(filePath)).toBe('system')
    expect(readThemePreferenceResult(filePath).degradation?.code).toBe(
      'appearance_preferences_unreadable'
    )
    expect(await readFile(filePath, 'utf8')).toBe('{invalid')
    await writeFile(filePath, JSON.stringify({ themePreference: 'dark' }), 'utf8')
    expect(readThemePreference(filePath)).toBe('system')
    expect(readThemePreferenceResult(filePath).degradation?.code).toBe(
      'appearance_preferences_invalid'
    )
  })
})


describe('appearance reading preferences', () => {
  async function fixture(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'rovai-appearance-reading-'))
    cleanup.push(directory)
    return join(directory, 'appearance.json')
  }

  it('loads legacy theme choices with reading defaults without rewriting the source', async () => {
    const path = await fixture()
    const legacy = JSON.stringify({ schemaVersion: 1, themePreference: 'night' })
    await writeFile(path, legacy)
    expect(new AppearancePreferencesStore(path).get()).toEqual({ ...DEFAULT_APPEARANCE, preference: 'night' })
    expect(await readFile(path, 'utf8')).toBe(legacy)
  })

  it('serializes rapid patches, restores all values, and preserves them through the theme-only API', async () => {
    const path = await fixture()
    const store = new AppearancePreferencesStore(path)
    await Promise.all([
      store.update({ chatFontSize: 18 }),
      store.update({ documentFontSize: 20, readingDensity: 'relaxed' }),
      store.update({ chatFontSize: 24, codeFontSize: 16, motionPreference: 'reduce', zoomPercentage: 150 })
    ])
    await writeThemePreference(path, 'night')
    expect(new AppearancePreferencesStore(path).get()).toEqual({
      preference: 'night', chatFontSize: 24, documentFontSize: 20, codeFontSize: 16,
      readingDensity: 'relaxed', motionPreference: 'reduce', zoomPercentage: 150
    })
    const restored = new AppearancePreferencesStore(path)
    await restored.update(DEFAULT_APPEARANCE)
    expect(readAppearancePreferences(path).preferences).toEqual(DEFAULT_APPEARANCE)
  })

  it('rejects invalid bridge values before touching the saved file', async () => {
    const path = await fixture()
    const store = new AppearancePreferencesStore(path)
    await store.update({ preference: 'day' })
    const before = await readFile(path, 'utf8')
    for (const patch of [null, [], { chatFontSize: 11 }, { documentFontSize: 25 }, { codeFontSize: 14.5 }, { chatFontSize: NaN }, { zoomPercentage: 501 }, { zoomPercentage: 0 }, { zoomPercentage: '120' }, { readingDensity: 'compact' }, { motionPreference: 'always' }, { resolvedTheme: 'night' }, { unknown: true }]) {
      expect(() => parseAppearancePatch(patch)).toThrow()
    }
    expect(await readFile(path, 'utf8')).toBe(before)
  })

  it('does not report a failed write as saved and permits a later retry', async () => {
    const path = await fixture()
    const store = new AppearancePreferencesStore(path)
    await mkdir(path)
    await expect(store.update({ chatFontSize: 22 })).rejects.toThrow()
    expect(store.get()).toEqual(DEFAULT_APPEARANCE)
    expect(await readdir(join(path, '..'))).toEqual(['appearance.json'])
    await rm(path, { recursive: true })
    await store.update({ documentFontSize: 18 })
    expect(readAppearancePreferences(path).preferences).toEqual({ ...DEFAULT_APPEARANCE, documentFontSize: 18 })
  })

  it('preserves invalid schema-2 source bytes while using safe in-memory defaults', async () => {
    const path = await fixture()
    const invalid = JSON.stringify({ schemaVersion: 2, themePreference: 'night', chatFontSize: 300 })
    await writeFile(path, invalid)
    const loaded = readAppearancePreferences(path)
    expect(loaded.preferences).toEqual(DEFAULT_APPEARANCE)
    expect(loaded.degradation?.code).toBe('appearance_preferences_invalid')
    expect(await readFile(path, 'utf8')).toBe(invalid)
  })
})
