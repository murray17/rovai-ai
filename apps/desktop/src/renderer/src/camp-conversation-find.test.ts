import { describe, expect, it } from 'vitest'
import {
  conversationFindRanges,
  nextConversationFindIndex,
  pendingConversationFindStatus
} from './camp-conversation-find'

describe('conversation find helpers', () => {
  it('finds case-insensitive, non-overlapping UTF-16 ranges for the DOM', () => {
    expect(conversationFindRanges('Needle NEEDLE', 'needle')).toEqual([
      { start: 0, end: 6 },
      { start: 7, end: 13 }
    ])
    expect(conversationFindRanges('aaaa', 'aa')).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 }
    ])
    expect(conversationFindRanges('İstanbul', 'i\u{307}')).toEqual([{ start: 0, end: 1 }])
    expect(conversationFindRanges('🙂a', 'a')).toEqual([{ start: 2, end: 3 }])
    expect(conversationFindRanges('无结果', '')).toEqual([])
  })

  it('wraps traversal in both directions', () => {
    expect(nextConversationFindIndex(3, 4, 1)).toBe(0)
    expect(nextConversationFindIndex(0, 4, -1)).toBe(3)
    expect(nextConversationFindIndex(null, 4, 1)).toBe(0)
    expect(nextConversationFindIndex(null, 4, -1)).toBe(3)
    expect(nextConversationFindIndex(null, 0, 1)).toBeNull()
  })

  it('enters a pending status synchronously when a ready query is edited', () => {
    expect(pendingConversationFindStatus('next query')).toBe('searching')
    expect(pendingConversationFindStatus('   ')).toBe('idle')
  })
})
