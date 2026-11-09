import type { GeneralPreferencesApi, GeneralPreferencesSnapshot, GeneralPreferencesStorage, InterfaceLanguageSnapshot, StructuredError } from '@contracts'
import { DEFAULT_STORED_GENERAL_PREFERENCES, isInterfaceLanguagePreference, parseGeneralPreferences, resolveGeneralPreferences } from '../../desktop/src/shared/general-preferences-model'
import { withBrowserPreferenceWrite } from './auth-storage'

export function browserLanguages(): string[] {
  try { return [...new Set([...(navigator.languages ?? []), navigator.language].filter(Boolean))] }
  catch { return [] }
}

/** A null scope is the unauthenticated, memory-only login preview. */
export function browserGeneralPreferences(scope: string | null): Omit<GeneralPreferencesApi, 'setNewConversationTeam'> {
  const key = scope === null ? null : `rovai.presentation:${scope}:general`
  let stored = structuredClone(DEFAULT_STORED_GENERAL_PREFERENCES)
  let error: StructuredError | null = null
  let revision = 0
  let current = resolveGeneralPreferences(stored, browserLanguages())
  const listeners = new Set<(snapshot: InterfaceLanguageSnapshot) => void>()
  let tail = Promise.resolve()
  const publish = (): GeneralPreferencesSnapshot => {
    const next = resolveGeneralPreferences(stored, browserLanguages(), revision, error)
    if (JSON.stringify(next) !== JSON.stringify(current)) {
      current = { ...next, languageRevision: ++revision }
      for (const listener of listeners) listener(structuredClone(current))
    }
    return structuredClone(current)
  }
  const read = (): GeneralPreferencesSnapshot => {
    if (key !== null) {
      try {
        const raw = localStorage.getItem(key)
        const parsed = raw === null ? structuredClone(DEFAULT_STORED_GENERAL_PREFERENCES) : parseGeneralPreferences(JSON.parse(raw))
        if (!parsed) throw new Error('Invalid preferences')
        // Shared creation choices belong to the Host, never this presentation record.
        stored = { ...parsed, newConversationTeamId: null, newConversationDefaults: null, newConversationDefaultsRequireConfirmation: false, oneClickNewConversationEnabled: false }
        error = null
      } catch {
        error = { code: 'general_preferences_unreadable', message: '语言偏好暂时无法读取，原记录已保留。', retryable: true, details: {} }
      }
    }
    return publish()
  }
  read()
  const commit = (patch: Partial<GeneralPreferencesStorage>): Promise<GeneralPreferencesSnapshot> => {
    const operation = async (): Promise<GeneralPreferencesSnapshot> => {
      const update = (): GeneralPreferencesSnapshot => {
        read()
        if (error) throw error
        const next = parseGeneralPreferences({ ...stored, ...patch })
        if (!next) throw new Error('界面偏好无效。')
        if (key !== null) localStorage.setItem(key, JSON.stringify(next))
        stored = next
        return publish()
      }
      return key === null ? update() : withBrowserPreferenceWrite(`rovai.presentation:${scope}`, update)
    }
    const result = tail.then(operation)
    tail = result.then(() => undefined, () => undefined)
    return result
  }
  const refresh = (): void => { read() }
  const storageChanged = (event: StorageEvent): void => {
    if (event.key === key && event.storageArea === localStorage) read()
  }
  const visible = (): void => { if (document.visibilityState === 'visible') read() }
  return {
    get: async () => read(),
    getInterfaceLanguage: async () => read(),
    onInterfaceLanguageChanged: listener => {
      listeners.add(listener)
      if (listeners.size === 1) {
        window.addEventListener('languagechange', refresh)
        window.addEventListener('focus', refresh)
        window.addEventListener('storage', storageChanged)
        document.addEventListener('visibilitychange', visible)
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          window.removeEventListener('languagechange', refresh)
          window.removeEventListener('focus', refresh)
          window.removeEventListener('storage', storageChanged)
          document.removeEventListener('visibilitychange', visible)
        }
      }
    },
    setInterfaceLanguagePreference: interfaceLanguagePreference => {
      if (!isInterfaceLanguagePreference(interfaceLanguagePreference)) return Promise.reject(new Error('Unsupported interface language preference'))
      return commit({ interfaceLanguagePreference })
    },
    setStartupLocationMode: startupLocationMode => commit({ startupLocationMode }),
    setLastSettingsSection: lastSettingsSection => commit({ lastSettingsSection }),
    setExecutionConsolePlacement: executionConsolePlacement => commit({ executionConsolePlacement }),
    setExecutionConsoleAutoOpen: executionConsoleAutoOpen => commit({ executionConsoleAutoOpen }),
    setWorldMapEnabled: worldMapEnabled => commit({ worldMapEnabled }),
    setNewConversationDefaults: newConversationDefaults => commit({ newConversationDefaults }),
    setOneClickNewConversationEnabled: oneClickNewConversationEnabled => commit({ oneClickNewConversationEnabled }),
    invalidateNewConversationDefaults: () => commit({ newConversationDefaultsRequireConfirmation: stored.newConversationDefaults !== null })
  }
}
