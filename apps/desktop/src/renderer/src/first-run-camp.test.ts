import { describe, expect, it } from 'vitest'
import { firstRunCampStarters, initialCampConversationView } from './CampWorkspace'

describe('first-run Camp starters', () => {
  it('provides three concrete draft-only tasks without product-concept teaching', () => {
    const starters = firstRunCampStarters()

    expect(starters.map((starter) => starter.title)).toEqual(['创建一位新队员', '创建一个定时任务', '做一个实用小工具'])
    expect(starters[0].prompt).toBe('我想创建一个新的队员，请用 member-studio 帮我开始。')
    expect(starters[1].prompt).toContain('请先问我想做什么、多久执行一次、在什么时间执行')
    expect(starters[2].prompt).toContain('独立 HTML 文件')
    expect(starters.every((starter) => !starter.prompt.includes('Camp'))).toBe(true)
  })

  it('opens the first-run welcome in conversation view without changing generic Camp defaults', () => {
    expect(initialCampConversationView('world', true)).toBe('conversation')
    expect(initialCampConversationView('conversation', false)).toBe('conversation')
    expect(initialCampConversationView('world', false)).toBe('world')
    expect(initialCampConversationView(null, false)).toBe('world')
    expect(initialCampConversationView('world', false, false)).toBe('conversation')
  })
})
