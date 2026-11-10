import type { CoreMethod, GeneralPreferencesApi, GeneralPreferencesSnapshot } from '@contracts'
import { parseGeneralPreferences, storedGeneralPreferences } from './general-preferences-model'

type CreationPreferences = Pick<GeneralPreferencesSnapshot, 'newConversationTeamId' | 'newConversationDefaults' | 'newConversationDefaultsRequireConfirmation' | 'oneClickNewConversationEnabled'>
type Method = Extract<CoreMethod, `preferences.newConversation.${string}`>
type Request = <T>(method: Exclude<Method, 'preferences.newConversation.initialize'>, params?: unknown) => Promise<T>

export function creationPreferences(snapshot: GeneralPreferencesSnapshot): CreationPreferences {
  return {
    newConversationDefaults: snapshot.newConversationDefaults,
    newConversationTeamId: snapshot.newConversationTeamId,
    newConversationDefaultsRequireConfirmation: snapshot.newConversationDefaultsRequireConfirmation,
    oneClickNewConversationEnabled: snapshot.oneClickNewConversationEnabled
  }
}

/** Presentation stays local; the Host owns only the shared creation choices. */
export function withHostConversationPreferences(local: Omit<GeneralPreferencesApi, 'get' | 'setNewConversationTeam'> & { get(): GeneralPreferencesSnapshot | Promise<GeneralPreferencesSnapshot> }, request: Request): GeneralPreferencesApi {
  let observed: CreationPreferences | null = null
  const mergeSnapshot = (localSnapshot: GeneralPreferencesSnapshot, shared: CreationPreferences): GeneralPreferencesSnapshot => {
    if (!shared || Object.keys(shared).sort().join(',') !== 'newConversationDefaults,newConversationDefaultsRequireConfirmation,newConversationTeamId,oneClickNewConversationEnabled') {
      throw new Error('Host 的默认队员设置不完整，请重试。')
    }
    const stored = parseGeneralPreferences({ ...storedGeneralPreferences(localSnapshot), ...shared })
    if (!stored) throw new Error('Host 的默认队员设置无效，请重试。')
    const snapshot = { ...localSnapshot, ...stored }
    observed = creationPreferences(snapshot)
    return snapshot
  }
  const merge = async (shared: CreationPreferences): Promise<GeneralPreferencesSnapshot> => mergeSnapshot(await local.get(), shared)
  const get = async (): Promise<GeneralPreferencesSnapshot> => merge(await request('preferences.newConversation.get'))
  const localChange = async (change: Promise<GeneralPreferencesSnapshot>): Promise<GeneralPreferencesSnapshot> => {
    const localSnapshot = await change
    return observed ? mergeSnapshot(localSnapshot, observed) : get()
  }
  return {
    get,
    getInterfaceLanguage: () => local.getInterfaceLanguage(),
    onInterfaceLanguageChanged: listener => local.onInterfaceLanguageChanged(listener),
    setInterfaceLanguagePreference: async value => {
      const snapshot = await local.setInterfaceLanguagePreference(value)
      // Preserve already-observed Host fields without turning a local save into a network request.
      return observed ? mergeSnapshot(snapshot, observed) : snapshot
    },
    setStartupLocationMode: value => localChange(local.setStartupLocationMode(value)),
    setLastSettingsSection: value => localChange(local.setLastSettingsSection(value)),
    setExecutionConsolePlacement: value => localChange(local.setExecutionConsolePlacement(value)),
    setExecutionConsoleAutoOpen: value => localChange(local.setExecutionConsoleAutoOpen(value)),
    setWorldMapEnabled: value => localChange(local.setWorldMapEnabled(value)),
    setNewConversationTeam: async (teamId, enableOneClick = false) => merge(await request('preferences.newConversation.setTeam', { teamId, enableOneClick })),
    setNewConversationDefaults: async (defaults, enableOneClick = false) => merge(await request('preferences.newConversation.setDefaults', { defaults, enableOneClick })),
    setOneClickNewConversationEnabled: async enabled => merge(await request('preferences.newConversation.setOneClick', { enabled })),
    invalidateNewConversationDefaults: async expected => merge(await request('preferences.newConversation.invalidate', expected))
  }
}
