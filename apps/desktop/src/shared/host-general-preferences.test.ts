import type { GeneralPreferencesSnapshot } from '@contracts'
import { describe, expect, it } from 'vitest'
import { DEFAULT_GENERAL_PREFERENCES } from './general-preferences-model'
import { creationPreferences, withHostConversationPreferences } from './host-general-preferences'

function localPreferences(initial: GeneralPreferencesSnapshot) {
  let snapshot = structuredClone(initial)
  const commit = async (patch: Partial<GeneralPreferencesSnapshot>): Promise<GeneralPreferencesSnapshot> => {
    snapshot = { ...snapshot, ...patch }
    return structuredClone(snapshot)
  }
  return {
    get: async () => structuredClone(snapshot),
    setInterfaceLanguage: (interfaceLanguage: GeneralPreferencesSnapshot['interfaceLanguage']) => commit({ interfaceLanguage }),
    setStartupLocationMode: (startupLocationMode: GeneralPreferencesSnapshot['startupLocationMode']) => commit({ startupLocationMode }),
    setLastSettingsSection: (lastSettingsSection: GeneralPreferencesSnapshot['lastSettingsSection']) => commit({ lastSettingsSection }),
    setExecutionConsolePlacement: (executionConsolePlacement: GeneralPreferencesSnapshot['executionConsolePlacement']) => commit({ executionConsolePlacement }),
    setWorldMapEnabled: (worldMapEnabled: boolean) => commit({ worldMapEnabled }),
    setNewConversationDefaults: async () => structuredClone(snapshot),
    setOneClickNewConversationEnabled: async () => structuredClone(snapshot),
    invalidateNewConversationDefaults: async () => structuredClone(snapshot)
  }
}

describe('Host-backed general preferences', () => {
  it('does not block local presentation changes on a second Host read', async () => {
    const local = localPreferences(DEFAULT_GENERAL_PREFERENCES)
    const shared = creationPreferences(DEFAULT_GENERAL_PREFERENCES)
    let hostReads = 0
    const preferences = withHostConversationPreferences(local, async <T>() => {
      hostReads += 1
      if (hostReads > 1) throw new Error('Host read is unavailable')
      return structuredClone(shared) as T
    })

    await preferences.get()
    const updated = await preferences.setExecutionConsolePlacement('bottom')

    expect(updated.executionConsolePlacement).toBe('bottom')
    expect(hostReads).toBe(1)
  })

  it('loads Host-owned creation preferences before the first local presentation change returns', async () => {
    const local = localPreferences(DEFAULT_GENERAL_PREFERENCES)
    const shared = creationPreferences({
      ...DEFAULT_GENERAL_PREFERENCES,
      newConversationDefaults: { memberAgentIds: ['agent-a'], defaultLeadAgentId: 'agent-a' },
      oneClickNewConversationEnabled: true
    })
    let hostReads = 0
    const preferences = withHostConversationPreferences(local, async <T>() => {
      hostReads += 1
      return structuredClone(shared) as T
    })

    const updated = await preferences.setWorldMapEnabled(false)

    expect(updated).toMatchObject({
      worldMapEnabled: false,
      newConversationDefaults: shared.newConversationDefaults,
      oneClickNewConversationEnabled: true
    })
    expect(hostReads).toBe(1)
  })
})
