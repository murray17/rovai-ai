import { describe, expect, it } from 'vitest'
import type { ThreadMessageAroundParams, ThreadMessageAroundSnapshot, CoreMethod } from './index'

const CAMP_ID = 'rvcamp_01h47kvsy5fk1shh6w1g60eecf'

describe('Thread message anchored read contract', () => {
  it('keeps the closed method and unavailable response shape explicit', () => {
    const method: CoreMethod = 'thread.messages.around'
    const params: ThreadMessageAroundParams = {
      threadId: CAMP_ID,
      messageId: 'message-1'
    }
    const unavailable: ThreadMessageAroundSnapshot = {
      schemaVersion: 1,
      throughGlobalSequence: 42,
      threadId: CAMP_ID,
      anchorMessageId: 'message-1',
      sourceAvailable: false,
      messages: []
    }

    expect(method).toBe('thread.messages.around')
    expect(params).toEqual({ threadId: CAMP_ID, messageId: 'message-1' })
    expect(unavailable).toEqual({
      schemaVersion: 1,
      throughGlobalSequence: 42,
      threadId: CAMP_ID,
      anchorMessageId: 'message-1',
      sourceAvailable: false,
      messages: []
    })
  })
})
