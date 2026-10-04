import { describe, expect, it } from 'vitest'
import { samePublicMessageSegment } from './public-message-grouping'

const first = {
  authorType: 'agent' as const, authorId: 'alice', threadTurnId: 'turn-1',
  sourceAgentRunId: 'run-1', createdAt: '2026-09-08T10:00:00Z'
}

describe('adjacent public message identity', () => {
  it('groups the same member within a known turn and five-minute interval', () => {
    expect(samePublicMessageSegment(first, { ...first, createdAt: '2026-09-08T10:05:00Z' })).toBe(true)
    expect(samePublicMessageSegment(first, { ...first, createdAt: '2026-09-08T10:05:01Z' })).toBe(false)
    expect(samePublicMessageSegment(first, { ...first, createdAt: '2026-09-08T09:59:00Z' })).toBe(false)
  })

  it('keeps identity at speaker, turn, day and invalid timestamp boundaries', () => {
    expect(samePublicMessageSegment(first, { ...first, authorId: 'bob' })).toBe(false)
    expect(samePublicMessageSegment(first, { ...first, authorType: 'user' })).toBe(false)
    expect(samePublicMessageSegment(first, { ...first, threadTurnId: 'turn-2' })).toBe(false)
    const before = { ...first, createdAt: new Date(2026, 8, 8, 23, 59).toISOString() }
    const after = { ...first, createdAt: new Date(2026, 8, 9, 0, 0).toISOString() }
    expect(samePublicMessageSegment(before, after)).toBe(false)
    expect(samePublicMessageSegment(first, { ...first, createdAt: 'unknown' })).toBe(false)
  })

  it('uses a shared source Run only when both turn identities are absent', () => {
    const legacy = { ...first, threadTurnId: null }
    expect(samePublicMessageSegment(legacy, legacy)).toBe(true)
    expect(samePublicMessageSegment(legacy, first)).toBe(false)
    expect(samePublicMessageSegment(legacy, { ...legacy, sourceAgentRunId: 'run-2' })).toBe(false)
    const unknown = { ...legacy, sourceAgentRunId: null }
    expect(samePublicMessageSegment(unknown, unknown)).toBe(false)
  })

  it('retains a header when the model record changes within the same turn', () => {
    const message = { ...first, runtimeModel: { adapterKind: 'codex-cli', modelId: 'frozen', reasoningEffort: 'high' } }
    expect(samePublicMessageSegment(message, { ...message, sourceAgentRunId: 'run-2' })).toBe(true)
    for (const runtimeModel of [undefined, null,
      { ...message.runtimeModel, adapterKind: 'claude-code-cli' },
      { ...message.runtimeModel, modelId: 'other' },
      { ...message.runtimeModel, reasoningEffort: 'low' }
    ]) expect(samePublicMessageSegment(message, { ...message, runtimeModel })).toBe(false)
  })
})
