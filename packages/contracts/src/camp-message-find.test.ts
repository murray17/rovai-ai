import { describe, expect, it } from 'vitest'
import type { CampMessageFindParams, CampMessageFindSnapshot, CoreMethod } from './index'

const CAMP_ID = 'rvcamp_01h47kvsy5fk1shh6w1g60eecf'

describe('Camp conversation find contract', () => {
  it('keeps exact traversal bounded to one selected match', () => {
    const method: CoreMethod = 'camp.messages.find'
    const params: CampMessageFindParams = {
      campId: CAMP_ID,
      query: 'needle',
      selectedMatchIndex: 2,
      anchorMessageId: 'message-7'
    }
    const snapshot: CampMessageFindSnapshot = {
      schemaVersion: 1,
      throughGlobalSequence: 42,
      campId: CAMP_ID,
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

    expect(method).toBe('camp.messages.find')
    expect(params.selectedMatchIndex).toBe(2)
    expect(snapshot.match?.messageId).toBe('message-7')
    expect(snapshot.totalMatchCount).toBe(4)
  })
})
