import { DEFAULT_STORED_GENERAL_PREFERENCES, storedGeneralPreferences, resolveInterfaceLanguage } from '../shared/general-preferences-model'
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
  it('matches the first supported device language, normalizes tags and falls back to English', () => {
    for (const [tags, expected] of [
      [['fr-FR', 'EN_gb', 'zh-CN'], 'en'], [['ZH_hant_TW', 'en'], 'zh-CN'],
      [['zh-HK'], 'zh-CN'], [['zh'], 'zh-CN'], [['en-AU'], 'en'], [['ja-JP', 'fr'], 'en'], [[], 'en']
    ] as const) expect(resolveInterfaceLanguage('system', tags)).toBe(expected)
    expect(resolveInterfaceLanguage('zh-CN', ['en'])).toBe('zh-CN')
    expect(resolveInterfaceLanguage('en', ['zh'])).toBe('en')
  })

  it('preserves schema 5–6 languages and keeps only the preference on disk across system changes', async () => {
    const file = join(await temporaryDirectory(), 'general.json')
    const { interfaceLanguagePreference: _preference, newConversationTeamId: _team, executionConsoleAutoOpen: _autoOpen, ...common } = DEFAULT_STORED_GENERAL_PREFERENCES
    for (const language of ['zh-CN', 'en'] as const) {
      await writeFile(file, JSON.stringify({ ...common, schemaVersion: 5, interfaceLanguage: language }))
      const store = await GeneralPreferencesStore.load(file, () => ['zh-Hant'])
      expect(store.get()).toMatchObject({ interfaceLanguagePreference: language, interfaceLanguage: language })
    }
    for (const preference of ['system', 'zh-CN', 'en'] as const) {
      await writeFile(file, JSON.stringify({ ...common, schemaVersion: 6, interfaceLanguagePreference: preference }))
      const store = await GeneralPreferencesStore.load(file, () => ['zh-Hant'])
      expect(store.get()).toMatchObject({ schemaVersion: 8, interfaceLanguagePreference: preference, newConversationTeamId: null, readError: null })
    }
    expect(parseGeneralPreferences({ ...DEFAULT_STORED_GENERAL_PREFERENCES, newConversationTeamId: 'team-a', oneClickNewConversationEnabled: true }))
      .toMatchObject({ newConversationDefaults: null, newConversationTeamId: 'team-a', oneClickNewConversationEnabled: true })
    expect(parseGeneralPreferences({ ...DEFAULT_STORED_GENERAL_PREFERENCES, newConversationTeamId: 123 })).toBeNull()
    await rm(file)
    let tags = ['zh-CN', 'en']
    const store = await GeneralPreferencesStore.load(file, () => tags)
    expect(store.get()).toMatchObject({ interfaceLanguagePreference: 'system', interfaceLanguage: 'zh-CN' })
    await store.setInterfaceLanguagePreference('system')
    const raw = await readFile(file, 'utf8')
    tags = ['fr', 'en', 'zh']
    store.refreshInterfaceLanguage()
    expect(store.get().interfaceLanguage).toBe('en')
    expect(await readFile(file, 'utf8')).toBe(raw)
    expect(JSON.parse(raw)).not.toHaveProperty('interfaceLanguage')
    expect(parseGeneralPreferences({ ...JSON.parse(raw), interfaceLanguage: 'en' })).toBeNull()
    await store.setInterfaceLanguagePreference('zh-CN')
    tags = []
    expect(store.get().interfaceLanguage).toBe('zh-CN')
  })

  it('recovers an invalid file only after a successful read, without overwriting it through other setters', async () => {
    const file = join(await temporaryDirectory(), 'general.json')
    await writeFile(file, '{broken')
    const store = await GeneralPreferencesStore.load(file, () => ['zh-HK'])
    expect(store.get()).toMatchObject({ interfaceLanguagePreference: 'system', interfaceLanguage: 'zh-CN' })
    await expect(store.setLastSettingsSection('runtime')).rejects.toMatchObject({ code: 'general_preferences_unreadable' })
    expect(await readFile(file, 'utf8')).toBe('{broken')
    await writeFile(file, JSON.stringify({ ...DEFAULT_STORED_GENERAL_PREFERENCES, interfaceLanguagePreference: 'en' }))
    expect(await store.getInterfaceLanguage()).toMatchObject({ interfaceLanguagePreference: 'en', interfaceLanguage: 'en', readError: null })
    await store.setLastSettingsSection('runtime')
  })
  it('defaults a new profile to the timeline and preserves a malformed source file for recovery', async () => {
    const directory = await temporaryDirectory()
    const filePath = join(directory, 'general-preferences.json')
    expect(DEFAULT_GENERAL_PREFERENCES.worldMapEnabled).toBe(false)
    expect(await readGeneralPreferences(filePath)).toEqual({
      ...DEFAULT_GENERAL_PREFERENCES,
      executionConsolePlacement: 'inspector'
    })
    const malformed = '{broken'
    await writeFile(filePath, malformed)
    expect(await readGeneralPreferences(filePath)).toEqual(DEFAULT_GENERAL_PREFERENCES)
    const store = await GeneralPreferencesStore.load(filePath)
    expect(store.get()).toEqual({ ...DEFAULT_GENERAL_PREFERENCES, readError: store.loadDegradation })
    await expect(store.setInterfaceLanguagePreference('en')).rejects.toMatchObject({ code: 'general_preferences_unreadable' })
    expect(store.loadDegradation?.code).toBe('general_preferences_unreadable')
    expect(await readFile(filePath, 'utf8')).toBe(malformed)
  })

  it('accepts only the exact schema and finite enums', () => {
    expect(parseGeneralPreferences({
      ...DEFAULT_STORED_GENERAL_PREFERENCES,
      interfaceLanguagePreference: 'en'
    })?.interfaceLanguagePreference).toBe('en')
    expect(parseGeneralPreferences({
      ...DEFAULT_STORED_GENERAL_PREFERENCES,
      interfaceLanguagePreference: 'fr'
    })).toBeNull()
    expect(parseGeneralPreferences({
      schemaVersion: 4,
      startupLocationMode: 'last_location',
      lastSettingsSection: 'about',
      executionConsolePlacement: 'bottom',
      newConversationDefaults: null,
      newConversationDefaultsRequireConfirmation: false,
      oneClickNewConversationEnabled: false,
      worldMapEnabled: false
    })).toEqual({
      ...DEFAULT_STORED_GENERAL_PREFERENCES,
      interfaceLanguagePreference: 'zh-CN',
      lastSettingsSection: 'about',
      executionConsolePlacement: 'bottom',
      worldMapEnabled: false
    })
    expect(parseGeneralPreferences({
      schemaVersion: 4,
      startupLocationMode: 'last_location',
      lastSettingsSection: 'general',
      executionConsolePlacement: 'right',
      newConversationDefaults: null,
      newConversationDefaultsRequireConfirmation: false,
      oneClickNewConversationEnabled: false,
      worldMapEnabled: true
    })).toEqual({
      ...DEFAULT_STORED_GENERAL_PREFERENCES,
      interfaceLanguagePreference: 'zh-CN',
      executionConsolePlacement: 'right',
      worldMapEnabled: true
    })
    expect(parseGeneralPreferences({
      schemaVersion: 1,
      startupLocationMode: 'quick_chat',
      lastSettingsSection: 'diagnostics'
    })).toEqual({
      schemaVersion: 8,
      executionConsoleAutoOpen: false,
      newConversationTeamId: null,
      interfaceLanguagePreference: 'zh-CN',
      startupLocationMode: 'quick_chat',
      lastSettingsSection: 'diagnostics',
      executionConsolePlacement: 'inspector',
      newConversationDefaults: null,
      newConversationDefaultsRequireConfirmation: false,
      oneClickNewConversationEnabled: false,
      worldMapEnabled: true
    })
    expect(parseGeneralPreferences({
      schemaVersion: 3,
      startupLocationMode: 'last_location',
      lastSettingsSection: 'channels',
      executionConsolePlacement: 'bottom',
      newConversationDefaults: null,
      newConversationDefaultsRequireConfirmation: false,
      oneClickNewConversationEnabled: false
    })).toEqual({
      ...DEFAULT_STORED_GENERAL_PREFERENCES,
      interfaceLanguagePreference: 'zh-CN',
      lastSettingsSection: 'channels',
      executionConsolePlacement: 'bottom',
      worldMapEnabled: true
    })
    expect(parseGeneralPreferences({
      schemaVersion: 2,
      startupLocationMode: 'quick_chat',
      lastSettingsSection: 'diagnostics',
      newConversationDefaults: {
        memberAgentIds: ['agent-a', 'agent-b'],
        defaultLeadAgentId: 'agent-a'
      },
      newConversationDefaultsRequireConfirmation: true,
      oneClickNewConversationEnabled: true
    })).toEqual({
      schemaVersion: 8,
      executionConsoleAutoOpen: false,
      newConversationTeamId: null,
      interfaceLanguagePreference: 'zh-CN',
      startupLocationMode: 'quick_chat',
      lastSettingsSection: 'diagnostics',
      executionConsolePlacement: 'inspector',
      newConversationDefaults: {
        memberAgentIds: ['agent-a', 'agent-b'],
        defaultLeadAgentId: 'agent-a'
      },
      newConversationDefaultsRequireConfirmation: true,
      oneClickNewConversationEnabled: true,
      worldMapEnabled: true
    })
    expect(parseGeneralPreferences({
      schemaVersion: 3,
      startupLocationMode: 'last_location',
      lastSettingsSection: 'general',
      executionConsolePlacement: 'inspector',
      newConversationDefaults: null,
      newConversationDefaultsRequireConfirmation: false,
      oneClickNewConversationEnabled: false
    })).toEqual({
      ...DEFAULT_STORED_GENERAL_PREFERENCES,
      interfaceLanguagePreference: 'zh-CN',
      executionConsolePlacement: 'inspector',
      worldMapEnabled: true
    })
    expect(parseGeneralPreferences({
      schemaVersion: 1,
      startupLocationMode: 'restore_everything',
      lastSettingsSection: 'diagnostics'
    })).toBeNull()
    expect(parseGeneralPreferences({
      schemaVersion: 3,
      startupLocationMode: 'last_location',
      lastSettingsSection: 'general',
      executionConsolePlacement: 'sidebar',
      newConversationDefaults: null,
      newConversationDefaultsRequireConfirmation: false,
      oneClickNewConversationEnabled: false
    })).toEqual({
      ...DEFAULT_STORED_GENERAL_PREFERENCES,
      interfaceLanguagePreference: 'zh-CN',
      worldMapEnabled: true
    })
    expect(parseGeneralPreferences({
      schemaVersion: 3,
      startupLocationMode: 'last_location',
      lastSettingsSection: 'general',
      newConversationDefaults: null,
      newConversationDefaultsRequireConfirmation: false,
      oneClickNewConversationEnabled: false
    })).toEqual({
      ...DEFAULT_STORED_GENERAL_PREFERENCES,
      interfaceLanguagePreference: 'zh-CN',
      worldMapEnabled: true
    })
    expect(parseGeneralPreferences({
      schemaVersion: 2,
      startupLocationMode: 'last_location',
      lastSettingsSection: 'general',
      newConversationDefaults: null,
      newConversationDefaultsRequireConfirmation: false,
      oneClickNewConversationEnabled: false,
      unexpectedField: true
    })).toBeNull()
    expect(parseGeneralPreferences({
      schemaVersion: 2,
      startupLocationMode: 'last_location',
      lastSettingsSection: 'general',
      newConversationDefaults: {
        memberAgentIds: ['agent-a'],
        defaultLeadAgentId: 'agent-b'
      },
      newConversationDefaultsRequireConfirmation: false,
      oneClickNewConversationEnabled: false
    })).toBeNull()
  })

  it('migrates schema 7 with auto-open disabled and persists explicit changes across reloads', async () => {
    const file = join(await temporaryDirectory(), 'general.json')
    const { executionConsoleAutoOpen: _autoOpen, ...legacy } = DEFAULT_STORED_GENERAL_PREFERENCES
    await writeFile(file, JSON.stringify({ ...legacy, schemaVersion: 7, executionConsolePlacement: 'right', worldMapEnabled: true, newConversationTeamId: 'team-a', oneClickNewConversationEnabled: true }))
    const store = await GeneralPreferencesStore.load(file)
    expect(store.get()).toMatchObject({ executionConsoleAutoOpen: false, executionConsolePlacement: 'right', worldMapEnabled: true, newConversationTeamId: 'team-a', oneClickNewConversationEnabled: true })
    await store.setExecutionConsoleAutoOpen(true)
    const reloaded = await GeneralPreferencesStore.load(file)
    expect(reloaded.get().executionConsoleAutoOpen).toBe(true)
    await reloaded.setExecutionConsoleAutoOpen(false)
    expect((await GeneralPreferencesStore.load(file)).get().executionConsoleAutoOpen).toBe(false)
    expect(parseGeneralPreferences({ ...DEFAULT_STORED_GENERAL_PREFERENCES, executionConsoleAutoOpen: 'true' })).toBeNull()
    await expect(store.setExecutionConsoleAutoOpen('true' as unknown as boolean)).rejects.toThrow('Invalid execution console')
  })

  it('serializes concurrent mutations in call order and writes a private exact snapshot', async () => {
    const directory = await temporaryDirectory()
    const filePath = join(directory, 'general-preferences.json')
    const store = await GeneralPreferencesStore.load(filePath)

    await Promise.all([
      store.setStartupLocationMode('quick_chat'),
      store.setLastSettingsSection('toolbox'),
      store.setExecutionConsolePlacement('bottom'),
      store.setExecutionConsoleAutoOpen(true),
      store.setWorldMapEnabled(false),
      store.setInterfaceLanguagePreference('en'),
      store.setStartupLocationMode('last_location')
    ])

    expect(store.get()).toEqual({
      schemaVersion: 8,
      executionConsoleAutoOpen: true,
      newConversationTeamId: null,
      interfaceLanguagePreference: 'en', interfaceLanguage: 'en', systemLanguage: 'en', languageRevision: 7, readError: null,
      startupLocationMode: 'last_location',
      lastSettingsSection: 'toolbox',
      executionConsolePlacement: 'bottom',
      newConversationDefaults: null,
      newConversationDefaultsRequireConfirmation: false,
      oneClickNewConversationEnabled: false,
      worldMapEnabled: false
    })
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual(storedGeneralPreferences(store.get()))
    expect(storedGeneralPreferences((await GeneralPreferencesStore.load(filePath)).get())).toEqual(storedGeneralPreferences(store.get()))
    if (process.platform !== 'win32') {
      expect((await stat(filePath)).mode & 0o777).toBe(0o600)
    }
  })

  it('atomically saves defaults, latches invalidation, and never silently disables one-click creation', async () => {
    const directory = await temporaryDirectory()
    const filePath = join(directory, 'general-preferences.json')
    const store = await GeneralPreferencesStore.load(filePath)

    await expect(store.setOneClickNewConversationEnabled(true)).rejects.toThrow()
    await store.setNewConversationDefaults({
      memberAgentIds: ['agent-a', 'agent-b'],
      defaultLeadAgentId: 'agent-a'
    })
    await store.setOneClickNewConversationEnabled(true)
    await store.invalidateNewConversationDefaults()

    expect(store.get()).toMatchObject({
      oneClickNewConversationEnabled: true,
      newConversationDefaultsRequireConfirmation: true,
      newConversationDefaults: {
        memberAgentIds: ['agent-a', 'agent-b'],
        defaultLeadAgentId: 'agent-a'
      }
    })
    await expect(store.setOneClickNewConversationEnabled(true)).rejects.toThrow()
    await store.setNewConversationDefaults({
      memberAgentIds: ['agent-b'],
      defaultLeadAgentId: 'agent-b'
    })
    expect(store.get()).toMatchObject({
      oneClickNewConversationEnabled: true,
      newConversationDefaultsRequireConfirmation: false,
      newConversationDefaults: {
        memberAgentIds: ['agent-b'],
        defaultLeadAgentId: 'agent-b'
      }
    })
  })

  it('saves the selected team and enables one-click together, preserving other preferences', async () => {
    const directory = await temporaryDirectory()
    const filePath = join(directory, 'general-preferences.json')
    const store = await GeneralPreferencesStore.load(filePath)
    const defaults = { memberAgentIds: ['agent-a', 'agent-b'], defaultLeadAgentId: 'agent-b' }
    const saving = store.setNewConversationDefaults(defaults, true)
    defaults.memberAgentIds.push('agent-c')
    await Promise.all([saving, store.setLastSettingsSection('runtime')])

    expect(store.get()).toEqual({
      ...DEFAULT_GENERAL_PREFERENCES,
      languageRevision: 2,
      lastSettingsSection: 'runtime',
      newConversationDefaults: { memberAgentIds: ['agent-a', 'agent-b'], defaultLeadAgentId: 'agent-b' },
      oneClickNewConversationEnabled: true
    })
    expect(storedGeneralPreferences((await GeneralPreferencesStore.load(filePath)).get())).toEqual(storedGeneralPreferences(store.get()))
    await store.setNewConversationDefaults({ memberAgentIds: ['agent-a'], defaultLeadAgentId: 'agent-a' }, false)
    expect(store.get().oneClickNewConversationEnabled).toBe(true)
  })

  it('rejects invalid atomic updates without enabling one-click or changing the team', async () => {
    const directory = await temporaryDirectory()
    const store = await GeneralPreferencesStore.load(join(directory, 'general-preferences.json'))
    await expect(store.setNewConversationDefaults({ memberAgentIds: ['agent-a'], defaultLeadAgentId: 'agent-b' }, true)).rejects.toThrow()
    await expect(store.setNewConversationDefaults(
      { memberAgentIds: ['agent-a'], defaultLeadAgentId: 'agent-a' },
      'true' as unknown as boolean
    )).rejects.toThrow()
    expect(store.get()).toEqual(DEFAULT_GENERAL_PREFERENCES)
    expect(await readdir(directory)).toEqual([])
  })

  it('keeps both saved team and one-click flag when an atomic save fails, then allows retry', async () => {
    const directory = await temporaryDirectory()
    const filePath = join(directory, 'general-preferences.json')
    const store = await GeneralPreferencesStore.load(filePath)
    await store.setNewConversationDefaults({ memberAgentIds: ['agent-a'], defaultLeadAgentId: 'agent-a' })
    const previous = store.get()
    await rm(filePath)
    await mkdir(filePath)
    const nextTeam = { memberAgentIds: ['agent-b'], defaultLeadAgentId: 'agent-b' }
    await expect(store.setNewConversationDefaults(nextTeam, true)).rejects.toMatchObject({ code: 'general_preferences_unreadable' })
    expect(storedGeneralPreferences(store.get())).toEqual(storedGeneralPreferences(previous))
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([])
    await rm(filePath, { recursive: true })
    await store.setNewConversationDefaults(nextTeam, true)
    expect((await GeneralPreferencesStore.load(filePath)).get()).toMatchObject({
      newConversationDefaults: nextTeam,
      oneClickNewConversationEnabled: true
    })
  })

  it('keeps the last successful value and cleans the temporary file when rename fails', async () => {
    const directory = await temporaryDirectory()
    const filePath = join(directory, 'general-preferences.json')
    await mkdir(filePath)
    const store = await GeneralPreferencesStore.load(filePath)

    await expect(store.setExecutionConsolePlacement('bottom')).rejects.toMatchObject({ code: 'general_preferences_unreadable' })
    expect(store.get()).toEqual({ ...DEFAULT_GENERAL_PREFERENCES, readError: store.loadDegradation })
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})
