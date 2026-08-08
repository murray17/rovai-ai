import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_GENERAL_PREFERENCES,
  GeneralPreferencesStore,
  parseGeneralPreferences,
  readGeneralPreferences
} from './general-preferences'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'rovai-general-preferences-'))
  cleanup.push(directory)
  return directory
}

describe('general preferences', () => {
  it('uses last location and General when the file is missing or malformed', async () => {
    const directory = await temporaryDirectory()
    const filePath = join(directory, 'general-preferences.json')
    expect(await readGeneralPreferences(filePath)).toEqual(DEFAULT_GENERAL_PREFERENCES)
    await writeFile(filePath, '{broken')
    expect(await readGeneralPreferences(filePath)).toEqual(DEFAULT_GENERAL_PREFERENCES)
  })

  it('accepts only the exact schema and finite enums', () => {
    expect(parseGeneralPreferences({
      schemaVersion: 1,
      startupLocationMode: 'quick_chat',
      lastSettingsSection: 'diagnostics'
    })).toEqual({
      schemaVersion: 1,
      startupLocationMode: 'quick_chat',
      lastSettingsSection: 'diagnostics'
    })
    expect(parseGeneralPreferences({
      schemaVersion: 2,
      startupLocationMode: 'quick_chat',
      lastSettingsSection: 'diagnostics'
    })).toBeNull()
    expect(parseGeneralPreferences({
      schemaVersion: 1,
      startupLocationMode: 'restore_everything',
      lastSettingsSection: 'diagnostics'
    })).toBeNull()
    expect(parseGeneralPreferences({
      schemaVersion: 1,
      startupLocationMode: 'last_location',
      lastSettingsSection: 'general',
      loginItemEnabled: true
    })).toBeNull()
  })

  it('serializes concurrent mutations in call order and writes a private exact snapshot', async () => {
    const directory = await temporaryDirectory()
    const filePath = join(directory, 'general-preferences.json')
    const store = await GeneralPreferencesStore.load(filePath)

    await Promise.all([
      store.setStartupLocationMode('quick_chat'),
      store.setLastSettingsSection('runtime'),
      store.setStartupLocationMode('last_location')
    ])

    expect(store.get()).toEqual({
      schemaVersion: 1,
      startupLocationMode: 'last_location',
      lastSettingsSection: 'runtime'
    })
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual(store.get())
    expect((await stat(filePath)).mode & 0o777).toBe(0o600)
  })

  it('keeps the last successful value and cleans the temporary file when rename fails', async () => {
    const directory = await temporaryDirectory()
    const filePath = join(directory, 'general-preferences.json')
    await mkdir(filePath)
    const store = await GeneralPreferencesStore.load(filePath)

    await expect(store.setStartupLocationMode('quick_chat')).rejects.toBeInstanceOf(Error)
    expect(store.get()).toEqual(DEFAULT_GENERAL_PREFERENCES)
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})
