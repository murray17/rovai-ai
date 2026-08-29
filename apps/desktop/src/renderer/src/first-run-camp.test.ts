import { describe, expect, it } from 'vitest'
import { firstRunCampStarters, initialCampConversationView } from './CampWorkspace'

describe('first-run Camp starters', () => {
  it('provides three draft-only choices and a role-specific middle prompt', () => {
    const luoke = firstRunCampStarters('luoke', '洛克')
    const muwa = firstRunCampStarters('muwa', '木娃')

    expect(luoke).toHaveLength(3)
    expect(luoke[0].prompt).toBe('我想创建一个新的队员，请用 member-studio 帮我开始。')
    expect(luoke[1].title).toBe('和洛克开始一件事')
    expect(luoke[1].prompt).not.toBe(muwa[1].prompt)
    expect(luoke[2].prompt).toBe('先告诉我快速对话、Camp 和队员名册分别适合做什么。')
  })

  it('opens the first-run welcome in conversation view without changing generic Camp defaults', () => {
    expect(initialCampConversationView('world', true)).toBe('conversation')
    expect(initialCampConversationView('conversation', false)).toBe('conversation')
    expect(initialCampConversationView('world', false)).toBe('world')
    expect(initialCampConversationView(null, false)).toBe('world')
    expect(initialCampConversationView('world', false, false)).toBe('conversation')
  })
})
