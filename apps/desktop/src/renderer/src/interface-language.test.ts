import { describe, expect, it, vi } from 'vitest'
import type { GeneralPreferencesApi, GeneralPreferencesSnapshot, InterfaceLanguage } from '@contracts'
import { DEFAULT_GENERAL_PREFERENCES } from '../../shared/general-preferences-model'

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: Error): void } {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure })
  return { promise, resolve, reject }
}

describe('interface language', () => {
  it('uses a complete translated sentence while preserving interpolated member names', async () => {
    vi.resetModules()
    const { translateUi } = await import('./interface-language')
    expect(translateUi('en', '使用这台电脑上已安装的智能体，为{0}提供模型与工具。', 'Dingding'))
      .toBe('Choose an installed Agent to give Dingding access to models and tools.')
    expect(translateUi('zh-CN', '欢迎来到 Rovai')).toBe('欢迎来到 Rovai')
  })

  it('keeps the last saved choice after a newer save fails', async () => {
    vi.resetModules()
    const { changeInterfaceLanguage, getInterfaceLanguage, initializeInterfaceLanguage } = await import('./interface-language')
    initializeInterfaceLanguage(DEFAULT_GENERAL_PREFERENCES)
    const first = deferred<GeneralPreferencesSnapshot>()
    const second = deferred<GeneralPreferencesSnapshot>()
    const saves = [first, second]
    const api = {
      setInterfaceLanguage: (_language: InterfaceLanguage) => saves.shift()!.promise
    } as unknown as GeneralPreferencesApi

    const english = changeInterfaceLanguage(api, 'en')
    const chinese = changeInterfaceLanguage(api, 'zh-CN')
    first.resolve({ ...DEFAULT_GENERAL_PREFERENCES, interfaceLanguage: 'en' })
    await english
    second.reject(new Error('disk unavailable'))
    await expect(chinese).rejects.toThrow('disk unavailable')
    expect(getInterfaceLanguage()).toBe('en')
  })
})
