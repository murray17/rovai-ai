import type { CoreMethod, GeneralPreferencesApi, GeneralPreferencesSnapshot } from '@contracts'
import { parseGeneralPreferences } from './general-preferences-model'

type CreationPreferences = Pick<GeneralPreferencesSnapshot, 'newConversationDefaults' | 'newConversationDefaultsRequireConfirmation' | 'oneClickNewConversationEnabled'>
type Method = Extract<CoreMethod, `preferences.newConversation.${string}`>
type Request = <T>(method: Exclude<Method, 'preferences.newConversation.initialize'>, params?: unknown) => Promise<T>

export function creationPreferences(snapshot: GeneralPreferencesSnapshot): CreationPreferences {
  return {
    newConversationDefaults: snapshot.newConversationDefaults,
    newConversationDefaultsRequireConfirmation: snapshot.newConversationDefaultsRequireConfirmation,
    oneClickNewConversationEnabled: snapshot.oneClickNewConversationEnabled
  }
}

/** Presentation stays local; the Host owns only the shared creation choices. */
export function withHostConversationPreferences(local: Omit<GeneralPreferencesApi, 'get'> & { get(): GeneralPreferencesSnapshot | Promise<GeneralPreferencesSnapshot> }, request: Request): GeneralPreferencesApi {
  let observed: CreationPreferences | null = null
  const mergeSnapshot = (localSnapshot: GeneralPreferencesSnapshot, shared: CreationPreferences): GeneralPreferencesSnapshot => {
    if (!shared || Object.keys(shared).sort().join(',') !== 'newConversationDefaults,newConversationDefaultsRequireConfirmation,oneClickNewConversationEnabled') {
      throw new Error('Host 的默认队员设置不完整，请重试。')
    }
    const snapshot = parseGeneralPreferences({ ...localSnapshot, ...shared })
    if (!snapshot) throw new Error('Host 的默认队员设置无效，请重试。')
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
    setInterfaceLanguage: value => localChange(local.setInterfaceLanguage(value)),
    setStartupLocationMode: value => localChange(local.setStartupLocationMode(value)),
    setLastSettingsSection: value => localChange(local.setLastSettingsSection(value)),
    setExecutionConsolePlacement: value => localChange(local.setExecutionConsolePlacement(value)),
    setWorldMapEnabled: value => localChange(local.setWorldMapEnabled(value)),
    setNewConversationDefaults: async (defaults, enableOneClick = false) => merge(await request('preferences.newConversation.setDefaults', { defaults, enableOneClick })),
    setOneClickNewConversationEnabled: async enabled => merge(await request('preferences.newConversation.setOneClick', { enabled })),
    invalidateNewConversationDefaults: async expectedDefaults => {
      if (expectedDefaults === undefined && !observed) await get()
      return merge(await request('preferences.newConversation.invalidate', { expectedDefaults: expectedDefaults === undefined ? observed!.newConversationDefaults : expectedDefaults }))
    }
  }
}
