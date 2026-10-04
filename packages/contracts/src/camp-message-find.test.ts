import { describe, expect, it } from 'vitest'
import type { ThreadMessageFindParams, ThreadMessageFindSnapshot, CoreMethod } from './index'

const CAMP_ID = 'rvcamp_01h47kvsy5fk1shh6w1g60eecf'

describe('Thread conversation find contract', () => {
  it('keeps exact traversal bounded to one selected match', () => {
    const method: CoreMethod = 'thread.messages.find'
    const params: ThreadMessageFindParams = {
      threadId: CAMP_ID,
      query: 'needle',
      selectedMatchIndex: 2,
      anchorMessageId: 'message-7'
    }
    const snapshot: ThreadMessageFindSnapshot = {
      schemaVersion: 1,
      throughGlobalSequence: 42,
      threadId: CAMP_ID,
      query: 'needle',
      totalMatchCount: 4,
      selectedMatchIndex: 2,
      match: {
        messageId: 'message-7',
        messageSequence: 7,
        occurrenceIndex: 0,
        startOffset: 3,
        endOffset: 9
      }
    }

    expect(method).toBe('thread.messages.find')
    expect(params.selectedMatchIndex).toBe(2)
    expect(snapshot.match?.messageId).toBe('message-7')
    expect(snapshot.totalMatchCount).toBe(4)
  })
})
