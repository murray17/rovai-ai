import { describe, expect, it } from 'vitest'
import type { ThreadChannelSource } from '@contracts'
import { formatThreadTitle } from './camp-title'
import { changeInterfaceLanguage } from './interface-language'
import { DEFAULT_GENERAL_PREFERENCES } from '../../shared/general-preferences-model'
import type { GeneralPreferencesApi } from '@contracts'

describe('Thread display titles', () => {
  const sources: [ThreadChannelSource, string][] = [
    [{ provider: 'feishu', conversationKind: 'p2p' }, '飞书私聊'],
    [{ provider: 'feishu', conversationKind: 'group' }, '飞书群聊'],
    [{ provider: 'feishu', conversationKind: 'topic' }, '飞书话题'],
    [{ provider: 'lark', conversationKind: 'p2p' }, 'Lark私聊'],
    [{ provider: 'lark', conversationKind: 'group' }, 'Lark群聊'],
    [{ provider: 'lark', conversationKind: 'topic' }, 'Lark话题'],
    [{ provider: 'dingtalk', conversationKind: 'p2p' }, '钉钉私聊'],
    [{ provider: 'dingtalk', conversationKind: 'group' }, '钉钉群聊']
  ]

  it.each(sources)('decorates %j without changing the title being edited', (channelSource, label) => {
    const thread = { title: '修复登录态恢复问题', channelSource }
    expect(formatThreadTitle(thread)).toBe(`【${label}】修复登录态恢复问题`)
    expect(thread.title).toBe('修复登录态恢复问题')
    thread.title = 'OAuth 登录问题'
    expect(formatThreadTitle(thread)).toBe(`【${label}】OAuth 登录问题`)
    expect(thread.title).toBe('OAuth 登录问题')
  })

  it('keeps local, legacy and unknown-source titles unchanged', () => {
    const title = '修复登录态恢复问题'
    expect(formatThreadTitle({ title })).toBe(title)
    expect(formatThreadTitle({ title, channelSource: null })).toBe(title)
    for (const channelSource of [
      { provider: 'future', conversationKind: 'p2p' },
      { provider: 'dingtalk', conversationKind: 'topic' }
    ]) {
      expect(formatThreadTitle({ title, channelSource: channelSource as ThreadChannelSource })).toBe(title)
    }
  })

  it('does not infer or strip a source from user-supplied text', () => {
    expect(formatThreadTitle({ title: '【飞书私聊】我手写的名字' })).toBe('【飞书私聊】我手写的名字')
    expect(formatThreadTitle({
      title: 'Murray · 快速对话',
      channelSource: { provider: 'feishu', conversationKind: 'p2p' }
    })).toBe('【飞书私聊】Murray · 快速对话')
  })

  it('localizes only the identified first-run default without changing saved titles', async () => {
    const languageApi = {
      setInterfaceLanguage: async (interfaceLanguage: 'zh-CN' | 'en') =>
        ({ ...DEFAULT_GENERAL_PREFERENCES, interfaceLanguage })
    } as GeneralPreferencesApi
    const firstRunThread = { id: 'camp-first', title: '初次集结' }
    expect(formatThreadTitle(firstRunThread, 'camp-first')).toBe('初次集结')
    await changeInterfaceLanguage(languageApi, 'en')
    try {
      expect(formatThreadTitle(firstRunThread, 'camp-first')).toBe('First Chat')
      expect(firstRunThread.title).toBe('初次集结')
      expect(formatThreadTitle(firstRunThread)).toBe('初次集结')
      expect(formatThreadTitle({ title: '初次集结' }, 'camp-first')).toBe('初次集结')
      expect(formatThreadTitle({ id: 'camp-user', title: '初次集结' }, 'camp-first')).toBe('初次集结')
      firstRunThread.title = '我的工作台'
      expect(formatThreadTitle(firstRunThread, 'camp-first')).toBe('我的工作台')
      expect(firstRunThread.title).toBe('我的工作台')
    } finally {
      await changeInterfaceLanguage(languageApi, 'zh-CN')
    }
    expect(formatThreadTitle({ ...firstRunThread, title: '初次集结' }, 'camp-first')).toBe('初次集结')
  })

  it('translates only the channel decoration in English', async () => {
    const languageApi = {
      setInterfaceLanguage: async (interfaceLanguage: 'zh-CN' | 'en') =>
        ({ ...DEFAULT_GENERAL_PREFERENCES, interfaceLanguage })
    } as GeneralPreferencesApi
    await changeInterfaceLanguage(languageApi, 'en')
    try {
      expect(formatThreadTitle({
        title: '【飞书私聊】我手写的名字',
        channelSource: { provider: 'feishu', conversationKind: 'p2p' }
      })).toBe('[Feishu DM] 【飞书私聊】我手写的名字')
      expect(formatThreadTitle({
        title: 'Plan',
        channelSource: { provider: 'dingtalk', conversationKind: 'group' }
      })).toBe('[DingTalk group] Plan')
    } finally {
      await changeInterfaceLanguage(languageApi, 'zh-CN')
    }
  })
})
