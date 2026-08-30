import { describe, expect, it } from 'vitest'
import { memberBotAppDescription } from './channel-member-bot-copy'

describe('member Bot application copy', () => {
  it('uses the same Feishu description for publishing and the local preview', () => {
    expect(memberBotAppDescription('feishu', '代码审阅')).toBe('Rovai AI Teammate · 代码审阅')
  })

  it.each(['', null, undefined])('preserves the fallback role for %s', (role) => {
    expect(memberBotAppDescription('feishu', role)).toBe('Rovai AI Teammate · 协作者')
  })

  it('keeps DingTalk copy unchanged', () => {
    expect(memberBotAppDescription('dingtalk', '鉴定士')).toBe('Rovai AI 队员 · 鉴定士')
    expect(memberBotAppDescription('dingtalk', '')).toBe('Rovai AI 队员 · 协作者')
  })
})
