import { describe, expect, it } from 'vitest'
import { memberBotAppDescription, memberBotWelcomeCopy } from './channel-member-bot-copy'

describe('member Bot application copy', () => {
  it('uses the same Feishu description for publishing and the local preview', () => {
    expect(memberBotAppDescription('feishu', '代码审阅')).toBe('Rovai AI Teammate · 代码审阅')
  })

  it.each(['', null, undefined])('preserves the fallback role for %s', (role) => {
    expect(memberBotAppDescription('feishu', role)).toBe('Rovai AI Teammate · 协作者')
  })

  it('uses the same teammate prefix for DingTalk', () => {
    expect(memberBotAppDescription('dingtalk', '鉴定士')).toBe('Rovai AI Teammate · 鉴定士')
    expect(memberBotAppDescription('dingtalk', '')).toBe('Rovai AI Teammate · 协作者')
  })

  it('welcomes the Owner as the newly published teammate', () => {
    expect(memberBotWelcomeCopy('爱丽丝')).toEqual({
      title: '爱丽丝 · 已发布',
      body: '我已经在这里就绪。你可以直接发消息给我；在群聊中使用时，请先把我加入群聊并 @我。'
    })
  })
})
