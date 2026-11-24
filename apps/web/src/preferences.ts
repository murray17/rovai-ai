import { browserGeneralPreferences } from './general-preferences'
import { withBrowserPreferenceWrite } from './auth-storage'
import { withHostConversationPreferences } from '../../desktop/src/shared/host-general-preferences'
import type { ConsoleClient } from './client'
import type { AppearanceSnapshot, CurrentUserProfileApi, NavigationPreferencesSnapshot } from '@contracts'
import { DEFAULT_CURRENT_USER_PROFILE, currentUserNameError, isThreadId } from '@contracts'
import type { BusinessEnvironment } from '../../desktop/src/renderer/src/business-environment'
import { DEFAULT_APPEARANCE, parseAppearancePatch, resolveThemeMode } from '../../desktop/src/shared/appearance'
import { EMPTY_SNAPSHOT, sanitizeSnapshot, sourceMatchesSupportedSnapshot, registerNavigationProjects, moveNavigationProject, isNavigationThreadReadState } from '../../desktop/src/shared/navigation-preferences-model'
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
  let navigation = sanitizeSnapshot(read('navigation', null))
  const navigationListeners = new Set<(snapshot: NavigationPreferencesSnapshot) => void>()
  const publishNavigation = (): void => { for (const listener of navigationListeners) listener(structuredClone(navigation)) }
  const refreshNavigation = (): void => {
    try {
      const raw = localStorage.getItem(`${key}:navigation`)
      const source = raw === null ? EMPTY_SNAPSHOT : JSON.parse(raw)
      const next = sanitizeSnapshot(source)
      navigation = { ...next, ...(!sourceMatchesSupportedSnapshot(source, next)
        ? { readError: '导航偏好暂时无法保存，原记录已保留。' } : {}) }
    } catch { navigation = { ...navigation, readError: '导航偏好暂时无法读取，原记录已保留。' } }
  }
  const storageChanged = (event: StorageEvent): void => {
    if (event.storageArea !== localStorage || event.key !== `${key}:navigation`) return
    refreshNavigation(); publishNavigation()
  }
  const commitNavigation = async (update: (current: NavigationPreferencesSnapshot) => Partial<NavigationPreferencesSnapshot>): Promise<NavigationPreferencesSnapshot> => {
    await withBrowserPreferenceWrite(key, () => {
      refreshNavigation()
      if (navigation.readError) throw new Error(navigation.readError)
      const next = sanitizeSnapshot({ ...navigation, ...update(navigation) })
      if (JSON.stringify(next) !== JSON.stringify(navigation)) write('navigation', next)
      navigation = next
    })
    // A storage event may already have supplied a newer snapshot while the lock was released.
    publishNavigation()
    return structuredClone(navigation)
  }
  const media = matchMedia('(prefers-color-scheme: dark)')
  let appearance = { ...DEFAULT_APPEARANCE }
  try { appearance = { ...appearance, ...parseAppearancePatch(read('appearance', {})) } } catch { /* Invalid persisted presentation stays untouched until an explicit edit. */ }
  const appearanceListeners = new Set<(snapshot: AppearanceSnapshot) => void>()
  const snapshot = (): AppearanceSnapshot => ({ ...appearance, resolvedTheme: resolveThemeMode(appearance.preference, media.matches ? 'night' : 'day') })
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
      generalPreferences: withHostConversationPreferences(browserGeneralPreferences(scope), (method, params) => transport.request(method, params)),
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
        registerProjects: (paths, completeLegacy = false) => commitNavigation(current => registerNavigationProjects(current, paths, completeLegacy)),
        moveProject: move => commitNavigation(current => moveNavigationProject(current, move)),
        setThreadReadState: (threadId, state) => {
          if (!isThreadId(threadId) || (state !== null && !isNavigationThreadReadState(state))) return Promise.reject(new Error('Invalid Thread read state'))
          return commitNavigation(current => {
            const threadReadStates = { ...current.threadReadStates }
            if (state === null) delete threadReadStates[threadId]
            else threadReadStates[threadId] = { manualUnread: state.manualUnread,
              readThroughGlobalSequence: Math.max(state.readThroughGlobalSequence, threadReadStates[threadId]?.readThroughGlobalSequence ?? 0) }
            return { threadReadStates }
          })
        },
        replacePins: pins => commitNavigation(() => ({ pins })),
        setProjectName: (key, name) => {
          if (name !== null && projectDisplayNameError(name)) return Promise.reject(new Error(projectDisplayNameError(name)!))
          return commitNavigation(current => {
            const names = { ...current.projectNames }
            if (name === null) delete names[key]; else names[key] = normalizeProjectDisplayName(name)
            return { projectNames: names }
          })
        },
        removeProject: (key, threadIds) => commitNavigation(current => ({
          pins: current.pins.filter(pin => !(pin.kind === 'project' ? pin.targetKey === key : threadIds.includes(pin.targetKey))),
          registeredProjects: current.registeredProjects.filter(path => `directory:${path}` !== key),
          projectOrder: current.projectOrder?.filter(item => item !== key) ?? null,
          removedProjects: [...current.removedProjects.filter(p => p.targetKey !== key), { targetKey: key, removedAt: new Date().toISOString() }]
        })),
        restoreProject: key => commitNavigation(current => ({
          registeredProjects: [...new Set([...current.registeredProjects, key.slice('directory:'.length)])],
          projectOrder: [...new Set([...(current.projectOrder ?? []), key])],
          removedProjects: current.removedProjects.filter(p => p.targetKey !== key)
        }))
      }
    }
  }
}
