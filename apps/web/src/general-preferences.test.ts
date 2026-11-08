import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_STORED_GENERAL_PREFERENCES } from '../../desktop/src/shared/general-preferences-model'
import { browserGeneralPreferences } from './general-preferences'

vi.mock('./auth-storage', () => {
  let tail = Promise.resolve()
  return { withBrowserPreferenceWrite: (_scope: string, operation: () => unknown) => {
    const result = tail.then(operation)
    tail = result.then(() => undefined, () => undefined)
    return result
  } }
})
afterEach(() => vi.unstubAllGlobals())

function browser() {
  const entries = new Map<string, string>()
  const events = new EventTarget()
  const storage = { getItem: vi.fn((key: string) => entries.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { entries.set(key, value) }) }
  const navigator = { languages: ['fr', 'en-US', 'zh'], language: 'zh-CN' }
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('window', events)
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))
  vi.stubGlobal('navigator', navigator)
  return { entries, events, storage, navigator }
}

describe('browser-local language preference', () => {
  it('uses the visitor language list, supplements it, and keeps client scopes separate', async () => {
    const { navigator, entries } = browser()
    const first = browserGeneralPreferences('host/user-a')
    expect(await first.getInterfaceLanguage()).toMatchObject({ interfaceLanguagePreference: 'system', interfaceLanguage: 'en' })
    navigator.languages = ['ja']
    expect(await first.getInterfaceLanguage()).toMatchObject({ interfaceLanguage: 'zh-CN' })
    await first.setInterfaceLanguagePreference('en')
    expect(await browserGeneralPreferences('host/user-b').getInterfaceLanguage()).toMatchObject({ interfaceLanguagePreference: 'system', interfaceLanguage: 'zh-CN' })
    expect(JSON.parse(entries.get('rovai.presentation:host/user-a:general')!)).toEqual({ ...DEFAULT_STORED_GENERAL_PREFERENCES, interfaceLanguagePreference: 'en' })
  })

  it('preserves schema 5 values while missing storage alone gets the system default', async () => {
    const { entries } = browser()
    const { interfaceLanguagePreference: _preference, newConversationTeamId: _team, executionConsoleAutoOpen: _autoOpen, ...common } = DEFAULT_STORED_GENERAL_PREFERENCES
    for (const language of ['zh-CN', 'en'] as const) {
      entries.set('rovai.presentation:owner:general', JSON.stringify({ ...common, schemaVersion: 5, interfaceLanguage: language }))
      const api = browserGeneralPreferences('owner')
      expect(await api.getInterfaceLanguage()).toMatchObject({ interfaceLanguagePreference: language, interfaceLanguage: language })
      await api.setLastSettingsSection('runtime')
      expect(JSON.parse(entries.get('rovai.presentation:owner:general')!)).toMatchObject({ schemaVersion: 8, interfaceLanguagePreference: language })
    }
  })

  it('keeps execution auto-open local, migrates disabled and preserves the saved value on write failure', async () => {
    const { entries, storage } = browser()
    const { executionConsoleAutoOpen: _autoOpen, ...legacy } = DEFAULT_STORED_GENERAL_PREFERENCES
    entries.set('rovai.presentation:owner:general', JSON.stringify({ ...legacy, schemaVersion: 7, executionConsolePlacement: 'bottom' }))
    const api = browserGeneralPreferences('owner')
    expect(await api.get()).toMatchObject({ executionConsoleAutoOpen: false, executionConsolePlacement: 'bottom' })
    await api.setExecutionConsoleAutoOpen(true)
    expect(await browserGeneralPreferences('owner').get()).toMatchObject({ executionConsoleAutoOpen: true })
    expect(await browserGeneralPreferences('another-owner').get()).toMatchObject({ executionConsoleAutoOpen: false })
    storage.setItem.mockImplementationOnce(() => { throw new Error('quota') })
    await expect(api.setExecutionConsoleAutoOpen(false)).rejects.toThrow('quota')
    expect(await api.get()).toMatchObject({ executionConsoleAutoOpen: true })
  })

  it('retains valid memory and the damaged record until a successful retry, then survives a write failure', async () => {
    const { entries, storage } = browser()
    const api = browserGeneralPreferences('owner')
    await api.setInterfaceLanguagePreference('zh-CN')
    entries.set('rovai.presentation:owner:general', '{damaged')
    expect(await api.getInterfaceLanguage()).toMatchObject({ interfaceLanguagePreference: 'zh-CN', interfaceLanguage: 'zh-CN', readError: { retryable: true } })
    await expect(api.setLastSettingsSection('runtime')).rejects.toMatchObject({ code: 'general_preferences_unreadable' })
    expect(entries.get('rovai.presentation:owner:general')).toBe('{damaged')
    entries.set('rovai.presentation:owner:general', JSON.stringify(DEFAULT_STORED_GENERAL_PREFERENCES))
    expect(await api.getInterfaceLanguage()).toMatchObject({ interfaceLanguagePreference: 'system', readError: null })
    storage.setItem.mockImplementationOnce(() => { throw new Error('quota') })
    await expect(api.setInterfaceLanguagePreference('zh-CN')).rejects.toThrow('quota')
    expect(await api.getInterfaceLanguage()).toMatchObject({ interfaceLanguagePreference: 'system', interfaceLanguage: 'en' })
  })

  it('refreshes system language on browser events, keeps manual selection and cleans up subscriptions', async () => {
    const { events, navigator, entries } = browser()
    const api = browserGeneralPreferences('owner')
    await api.setInterfaceLanguagePreference('system')
    const raw = entries.get('rovai.presentation:owner:general')
    const seen = vi.fn()
    const unsubscribe = api.onInterfaceLanguageChanged(seen)
    navigator.languages = ['zh_Hant_TW']
    events.dispatchEvent(new Event('languagechange'))
    expect(seen.mock.lastCall?.[0]).toMatchObject({ interfaceLanguagePreference: 'system', interfaceLanguage: 'zh-CN' })
    expect(entries.get('rovai.presentation:owner:general')).toBe(raw)
    await api.setInterfaceLanguagePreference('en')
    navigator.languages = ['zh-HK']
    events.dispatchEvent(new Event('focus'))
    expect(await api.getInterfaceLanguage()).toMatchObject({ interfaceLanguagePreference: 'en', interfaceLanguage: 'en' })
    unsubscribe()
    seen.mockClear()
    navigator.languages = ['en']
    events.dispatchEvent(new Event('languagechange'))
    expect(seen).not.toHaveBeenCalled()
  })
})
