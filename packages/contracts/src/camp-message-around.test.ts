import { describe, expect, it } from 'vitest'
import type { CampMessageAroundParams, CampMessageAroundSnapshot, CoreMethod } from './index'

const CAMP_ID = 'rvcamp_01h47kvsy5fk1shh6w1g60eecf'

describe('Camp message anchored read contract', () => {
  it('keeps the closed method and unavailable response shape explicit', () => {
    const method: CoreMethod = 'camp.messages.around'
    const params: CampMessageAroundParams = {
      campId: CAMP_ID,
      messageId: 'message-1'
    }
    const unavailable: CampMessageAroundSnapshot = {
      schemaVersion: 1,
      throughGlobalSequence: 42,
      campId: CAMP_ID,
      anchorMessageId: 'message-1',
      sourceAvailable: false,
      messages: []
    }

    expect(method).toBe('camp.messages.around')
    expect(params).toEqual({ campId: CAMP_ID, messageId: 'message-1' })
    expect(unavailable).toEqual({
      schemaVersion: 1,
      throughGlobalSequence: 42,
      campId: CAMP_ID,
      anchorMessageId: 'message-1',
      sourceAvailable: false,
      messages: []
    })
  })
})
