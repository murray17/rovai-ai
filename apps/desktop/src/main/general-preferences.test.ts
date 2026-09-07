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
    expect(store.get()).toEqual(DEFAULT_GENERAL_PREFERENCES)
    expect(store.loadDegradation?.code).toBe('general_preferences_unreadable')
    expect(await readFile(filePath, 'utf8')).toBe(malformed)
  })

  it('accepts only the exact schema and finite enums', () => {
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
      ...DEFAULT_GENERAL_PREFERENCES,
      lastSettingsSection: 'about',
      executionConsolePlacement: 'bottom',
      worldMapEnabled: false
    })
    expect(parseGeneralPreferences({
      schemaVersion: 1,
      startupLocationMode: 'quick_chat',
      lastSettingsSection: 'diagnostics'
    })).toEqual({
      schemaVersion: 4,
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
      ...DEFAULT_GENERAL_PREFERENCES,
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
      schemaVersion: 4,
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
      ...DEFAULT_GENERAL_PREFERENCES,
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
      ...DEFAULT_GENERAL_PREFERENCES,
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
      ...DEFAULT_GENERAL_PREFERENCES,
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

  it('serializes concurrent mutations in call order and writes a private exact snapshot', async () => {
    const directory = await temporaryDirectory()
    const filePath = join(directory, 'general-preferences.json')
    const store = await GeneralPreferencesStore.load(filePath)

    await Promise.all([
      store.setStartupLocationMode('quick_chat'),
      store.setLastSettingsSection('runtime'),
      store.setExecutionConsolePlacement('bottom'),
      store.setWorldMapEnabled(false),
      store.setStartupLocationMode('last_location')
    ])

    expect(store.get()).toEqual({
      schemaVersion: 4,
      startupLocationMode: 'last_location',
      lastSettingsSection: 'runtime',
      executionConsolePlacement: 'bottom',
      newConversationDefaults: null,
      newConversationDefaultsRequireConfirmation: false,
      oneClickNewConversationEnabled: false,
      worldMapEnabled: false
    })
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual(store.get())
    expect((await GeneralPreferencesStore.load(filePath)).get()).toEqual(store.get())
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
      lastSettingsSection: 'runtime',
      newConversationDefaults: { memberAgentIds: ['agent-a', 'agent-b'], defaultLeadAgentId: 'agent-b' },
      oneClickNewConversationEnabled: true
    })
    expect((await GeneralPreferencesStore.load(filePath)).get()).toEqual(store.get())
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
    await expect(store.setNewConversationDefaults(nextTeam, true)).rejects.toBeInstanceOf(Error)
    expect(store.get()).toEqual(previous)
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

    await expect(store.setExecutionConsolePlacement('bottom')).rejects.toBeInstanceOf(Error)
    expect(store.get()).toEqual(DEFAULT_GENERAL_PREFERENCES)
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})
