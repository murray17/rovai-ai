import { describe, expect, it } from 'vitest'
import { localizeExecutionEngineTerms } from './product-copy'
import { changeInterfaceLanguage } from './interface-language'
import { DEFAULT_GENERAL_PREFERENCES } from '../../shared/general-preferences-model'
import type { GeneralPreferencesApi } from '@contracts'

describe('execution engine product copy', () => {
  it('keeps internal Runtime and Adapter terms out of user-visible messages', () => {
    expect(localizeExecutionEngineTerms('Adapter Installation')).toBe('智能体')
    expect(localizeExecutionEngineTerms('Agent Runtime')).toBe('智能体')
    expect(localizeExecutionEngineTerms('Runtime Adapter')).toBe('智能体适配器')
    expect(localizeExecutionEngineTerms('Adapter diagnostic')).toBe('适配器 diagnostic')
  })

  it('does not inject Chinese terms into English error text', async () => {
    const languageApi = {
      setInterfaceLanguage: async (interfaceLanguage: 'zh-CN' | 'en') =>
        ({ ...DEFAULT_GENERAL_PREFERENCES, interfaceLanguage })
    } as GeneralPreferencesApi
    await changeInterfaceLanguage(languageApi, 'en')
    try {
      expect(localizeExecutionEngineTerms('Runtime Adapter diagnostic')).toBe('Runtime Adapter diagnostic')
    } finally {
      await changeInterfaceLanguage(languageApi, 'zh-CN')
    }
  })
})
