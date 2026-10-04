import { withHostConversationPreferences } from '../../desktop/src/shared/host-general-preferences'
import type { ConsoleClient } from './client'
import type { AppearanceSnapshot, CurrentUserProfileApi, GeneralPreferencesSnapshot, NavigationPreferencesSnapshot } from '@contracts'
import { DEFAULT_CURRENT_USER_PROFILE, currentUserNameError, isThreadId } from '@contracts'
import type { BusinessEnvironment } from '../../desktop/src/renderer/src/business-environment'
import { DEFAULT_APPEARANCE, parseAppearancePatch } from '../../desktop/src/shared/appearance'
import { DEFAULT_GENERAL_PREFERENCES, parseGeneralPreferences } from '../../desktop/src/shared/general-preferences-model'
import { sanitizeSnapshot, isNavigationThreadReadState } from '../../desktop/src/shared/navigation-preferences-model'
import { normalizeProjectDisplayName, projectDisplayNameError } from '../../desktop/src/shared/project-display-name'

/** Browser presentation preferences only. No drafts, domain facts or credentials enter storage. */
export function browserPreferences(scope: string, transport: ConsoleClient): {
  preferences: BusinessEnvironment['preferences']; profile: CurrentUserProfileApi
} {
  const key = `rovai.presentation:${scope}`
  const read = <T>(name: string, fallback: T): T => {
    try { return JSON.parse(localStorage.getItem(`${key}:${name}`) ?? 'null') as T ?? fallback }
    catch { return fallback }
  }
  const write = (name: string, value: unknown): void => localStorage.setItem(`${key}:${name}`, JSON.stringify(value))
  let general = { ...(parseGeneralPreferences(read('general', DEFAULT_GENERAL_PREFERENCES)) ?? structuredClone(DEFAULT_GENERAL_PREFERENCES)), newConversationDefaults: null, newConversationDefaultsRequireConfirmation: false, oneClickNewConversationEnabled: false } as GeneralPreferencesSnapshot
  let navigation = sanitizeSnapshot(read('navigation', null))
  const navigationListeners = new Set<(snapshot: NavigationPreferencesSnapshot) => void>()
  const publishNavigation = (): void => { for (const listener of navigationListeners) listener(structuredClone(navigation)) }
  const refreshNavigation = (): void => { navigation = sanitizeSnapshot(read('navigation', null)) }
  const storageChanged = (event: StorageEvent): void => {
    if (event.storageArea !== localStorage || event.key !== `${key}:navigation`) return
    refreshNavigation(); publishNavigation()
  }
  const commitGeneral = async (patch: Partial<GeneralPreferencesSnapshot>): Promise<GeneralPreferencesSnapshot> => {
    const next = parseGeneralPreferences({ ...general, ...patch })
    if (!next) throw new Error('界面偏好无效。')
    write('general', next); general = next
    return structuredClone(next)
  }
  const commitNavigation = async (patch: Partial<NavigationPreferencesSnapshot>): Promise<NavigationPreferencesSnapshot> => {
    refreshNavigation()
    const next = sanitizeSnapshot({ ...navigation, ...patch })
    write('navigation', next); navigation = next; publishNavigation()
    return structuredClone(next)
  }
  const media = matchMedia('(prefers-color-scheme: dark)')
  let appearance = { ...DEFAULT_APPEARANCE }
  try { appearance = { ...appearance, ...parseAppearancePatch(read('appearance', {})) } } catch { /* Invalid persisted presentation stays untouched until an explicit edit. */ }
  const appearanceListeners = new Set<(snapshot: AppearanceSnapshot) => void>()
  const snapshot = (): AppearanceSnapshot => ({ ...appearance, resolvedTheme: appearance.preference === 'system' ? media.matches ? 'night' : 'day' : appearance.preference })
  const publish = (): void => { for (const listener of appearanceListeners) listener(snapshot()) }
  const commitAppearance = async (patch: unknown): Promise<AppearanceSnapshot> => {
    const next = { ...appearance, ...parseAppearancePatch(patch) }
    write('appearance', next); appearance = next; publish(); return snapshot()
  }
  let profile = read('profile', DEFAULT_CURRENT_USER_PROFILE)
  return {
    profile: {
      get: async () => structuredClone(profile),
      save: async next => {
        const error = currentUserNameError(next.displayName)
        if (error) throw new Error(error)
        write('profile', next); profile = structuredClone(next)
        return structuredClone(profile)
      }
    },
    preferences: {
      appearance: {
        get: async () => snapshot(),
        setPreference: preference => commitAppearance({ preference }),
        updatePreferences: commitAppearance,
        onChanged: listener => {
          appearanceListeners.add(listener)
          if (appearanceListeners.size === 1) media.addEventListener('change', publish)
          return () => { appearanceListeners.delete(listener); if (!appearanceListeners.size) media.removeEventListener('change', publish) }
        }
      },
      generalPreferences: withHostConversationPreferences({
        get: async () => structuredClone(general),
        setInterfaceLanguage: interfaceLanguage => commitGeneral({ interfaceLanguage }),
        setStartupLocationMode: startupLocationMode => commitGeneral({ startupLocationMode }),
        setLastSettingsSection: lastSettingsSection => commitGeneral({ lastSettingsSection }),
        setExecutionConsolePlacement: executionConsolePlacement => commitGeneral({ executionConsolePlacement }),
        setNewConversationDefaults: (newConversationDefaults, enableOneClick = false) => commitGeneral({ newConversationDefaults, newConversationDefaultsRequireConfirmation: false, oneClickNewConversationEnabled: enableOneClick || general.oneClickNewConversationEnabled }),
        setOneClickNewConversationEnabled: oneClickNewConversationEnabled => commitGeneral({ oneClickNewConversationEnabled }),
        setWorldMapEnabled: worldMapEnabled => commitGeneral({ worldMapEnabled }),
        invalidateNewConversationDefaults: () => commitGeneral({ newConversationDefaultsRequireConfirmation: general.newConversationDefaults !== null })
      }, (method, params) => transport.request(method, params)),
      navigationPreferences: {
        get: async () => { refreshNavigation(); return structuredClone(navigation) },
        onChanged: listener => {
          navigationListeners.add(listener)
          if (navigationListeners.size === 1) window.addEventListener('storage', storageChanged)
          return () => {
            navigationListeners.delete(listener)
            if (!navigationListeners.size) window.removeEventListener('storage', storageChanged)
          }
        },
        setThreadReadState: (threadId, state) => {
          if (!isThreadId(threadId) || (state !== null && !isNavigationThreadReadState(state))) return Promise.reject(new Error('Invalid Thread read state'))
          refreshNavigation()
          const threadReadStates = { ...navigation.threadReadStates }
          if (state === null) delete threadReadStates[threadId]
          else threadReadStates[threadId] = { manualUnread: state.manualUnread,
            readThroughGlobalSequence: Math.max(state.readThroughGlobalSequence, threadReadStates[threadId]?.readThroughGlobalSequence ?? 0) }
          return commitNavigation({ threadReadStates })
        },
        replacePins: pins => commitNavigation({ pins }),
        synchronizeProjectOrder: projectKeys => commitNavigation({ projectOrder: [...new Set([...(navigation.projectOrder ?? []).filter(key => projectKeys.includes(key)), ...projectKeys])] }),
        setProjectName: (key, name) => {
          if (name !== null && projectDisplayNameError(name)) return Promise.reject(new Error(projectDisplayNameError(name)!))
          const names = { ...navigation.projectNames }
          if (name === null) delete names[key]; else names[key] = normalizeProjectDisplayName(name)
          return commitNavigation({ projectNames: names })
        },
        removeProject: (key, threadIds) => commitNavigation({ pins: navigation.pins.filter(pin => !(pin.kind === 'project' ? pin.targetKey === key : threadIds.includes(pin.targetKey))), removedProjects: [...navigation.removedProjects.filter(p => p.targetKey !== key), { targetKey: key, removedAt: new Date().toISOString() }] }),
        restoreProject: key => commitNavigation({ removedProjects: navigation.removedProjects.filter(p => p.targetKey !== key) })
      }
    }
  }
}
