import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
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
      schemaVersion: 1,
      themePreference: 'night'
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
