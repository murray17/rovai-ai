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
      executionConsolePlacement: 'bottom',
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
      lastSettingsSection: 'channels'
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
      executionConsolePlacement: 'bottom',
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
      executionConsolePlacement: 'inspector'
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
    })).toEqual(DEFAULT_GENERAL_PREFERENCES)
    expect(parseGeneralPreferences({
      schemaVersion: 3,
      startupLocationMode: 'last_location',
      lastSettingsSection: 'general',
      newConversationDefaults: null,
      newConversationDefaultsRequireConfirmation: false,
      oneClickNewConversationEnabled: false
    })).toEqual(DEFAULT_GENERAL_PREFERENCES)
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
      store.setExecutionConsolePlacement('inspector'),
      store.setWorldMapEnabled(false),
      store.setStartupLocationMode('last_location')
    ])

    expect(store.get()).toEqual({
      schemaVersion: 4,
      startupLocationMode: 'last_location',
      lastSettingsSection: 'runtime',
      executionConsolePlacement: 'inspector',
      newConversationDefaults: null,
      newConversationDefaultsRequireConfirmation: false,
      oneClickNewConversationEnabled: false,
      worldMapEnabled: false
    })
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual(store.get())
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

  it('keeps the last successful value and cleans the temporary file when rename fails', async () => {
    const directory = await temporaryDirectory()
    const filePath = join(directory, 'general-preferences.json')
    await mkdir(filePath)
    const store = await GeneralPreferencesStore.load(filePath)

    await expect(store.setExecutionConsolePlacement('inspector')).rejects.toBeInstanceOf(Error)
    expect(store.get()).toEqual(DEFAULT_GENERAL_PREFERENCES)
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})
