import { describe, expect, it } from 'vitest'
import type { CampChannelSource } from '@contracts'
import { formatCampTitle } from './camp-title'

describe('Camp display titles', () => {
  const sources: [CampChannelSource, string][] = [
    [{ provider: 'feishu', conversationKind: 'p2p' }, '飞书私聊'],
    [{ provider: 'feishu', conversationKind: 'group' }, '飞书群聊'],
    [{ provider: 'feishu', conversationKind: 'topic' }, '飞书话题'],
    [{ provider: 'dingtalk', conversationKind: 'p2p' }, '钉钉私聊'],
    [{ provider: 'dingtalk', conversationKind: 'group' }, '钉钉群聊']
  ]

  it.each(sources)('decorates %j without changing the title being edited', (channelSource, label) => {
    const camp = { title: '修复登录态恢复问题', channelSource }
    expect(formatCampTitle(camp)).toBe(`【${label}】修复登录态恢复问题`)
    expect(camp.title).toBe('修复登录态恢复问题')
    camp.title = 'OAuth 登录问题'
    expect(formatCampTitle(camp)).toBe(`【${label}】OAuth 登录问题`)
    expect(camp.title).toBe('OAuth 登录问题')
  })

  it('keeps local, legacy and unknown-source titles unchanged', () => {
    const title = '修复登录态恢复问题'
    expect(formatCampTitle({ title })).toBe(title)
    expect(formatCampTitle({ title, channelSource: null })).toBe(title)
    for (const channelSource of [
      { provider: 'future', conversationKind: 'p2p' },
      { provider: 'dingtalk', conversationKind: 'topic' }
    ]) {
      expect(formatCampTitle({ title, channelSource: channelSource as CampChannelSource })).toBe(title)
    }
  })

  it('does not infer or strip a source from user-supplied text', () => {
    expect(formatCampTitle({ title: '【飞书私聊】我手写的名字' })).toBe('【飞书私聊】我手写的名字')
    expect(formatCampTitle({
      title: 'Murray · 快速对话',
      channelSource: { provider: 'feishu', conversationKind: 'p2p' }
    })).toBe('【飞书私聊】Murray · 快速对话')
  })
})
