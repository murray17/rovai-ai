import { useSyncExternalStore } from 'react'
import type { GeneralPreferencesApi, GeneralPreferencesSnapshot, InterfaceLanguage } from '@contracts'
import englishCopy from './locales/en.json'

const english: Readonly<Record<string, string>> = englishCopy
const listeners = new Set<() => void>()
let currentLanguage: InterfaceLanguage = 'zh-CN'
let savedLanguage: InterfaceLanguage = 'zh-CN'
let initialized = false
let requestNumber = 0
let lastSavedRequest = 0
let pendingRequests = 0
let latestRequestFailed = false

function publish(language: InterfaceLanguage): void {
  if (currentLanguage === language) return
  currentLanguage = language
  if (typeof document !== 'undefined') document.documentElement.lang = language
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getInterfaceLanguage(): InterfaceLanguage {
  return currentLanguage
}

export function useInterfaceLanguage(): InterfaceLanguage {
  return useSyncExternalStore(subscribe, getInterfaceLanguage, getInterfaceLanguage)
}

/** Apply the first persisted snapshot without letting a late read undo a user's choice. */
export function initializeInterfaceLanguage(snapshot: Pick<GeneralPreferencesSnapshot, 'interfaceLanguage'>): void {
  if (initialized || pendingRequests > 0) return
  initialized = true
  savedLanguage = snapshot.interfaceLanguage
  publish(snapshot.interfaceLanguage)
}

/** Optimistic display; serialized persistence in the preference store makes the last choice win. */
export async function changeInterfaceLanguage(
  api: GeneralPreferencesApi,
  language: InterfaceLanguage,
  onSaved?: (snapshot: GeneralPreferencesSnapshot) => void
): Promise<void> {
  const request = ++requestNumber
  pendingRequests += 1
  latestRequestFailed = false
  publish(language)
  try {
    const snapshot = await api.setInterfaceLanguage(language)
    if (request > lastSavedRequest) {
      lastSavedRequest = request
      savedLanguage = snapshot.interfaceLanguage
      initialized = true
      onSaved?.(snapshot)
    }
    if (request === requestNumber) {
      latestRequestFailed = false
      publish(snapshot.interfaceLanguage)
    }
  } catch (error) {
    if (request === requestNumber) {
      latestRequestFailed = true
      publish(savedLanguage)
    }
    throw error
  } finally {
    pendingRequests -= 1
    if (pendingRequests === 0 && latestRequestFailed) publish(savedLanguage)
  }
}

/** Only app-owned copy enters this catalog. User data and Runtime output stay untouched. */
export function translateUi(language: InterfaceLanguage, chinese: string, ...values: Array<string | number>): string {
  const key = chinese.trim()
  const prefix = chinese.slice(0, chinese.indexOf(key))
  const suffix = chinese.slice(chinese.indexOf(key) + key.length)
  const template = language === 'en' ? english[key] ?? key : key
  const formatted = template.replace(/\{(\d+)\}/g, (match, index: string) => {
    const value = values[Number(index)]
    return value === undefined ? match : String(value)
  })
  return prefix + formatted + suffix
}

export function useUiText(): (chinese: string, ...values: Array<string | number>) => string {
  const language = useInterfaceLanguage()
  return (chinese, ...values) => translateUi(language, chinese, ...values)
}

export function UiText({ zh }: { zh: string }): string {
  const language = useInterfaceLanguage()
  return translateUi(language, zh)
}

export function uiAttribute(chinese: string, ...values: Array<string | number>): string {
  return translateUi(currentLanguage, chinese, ...values)
}
