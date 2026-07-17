import { describe, expect, it } from 'vitest'
import type { TimelineEvent } from '@contracts'
import { buildActivities, buildConversation } from './App'

function event(id: number, eventType: string, payload: unknown, nativeMethod: string | null = null): TimelineEvent {
  return {
    id,
    taskId: 'task-1',
    sequence: id,
    eventType,
    nativeMethod,
    payload,
    createdAt: `2026-07-17T10:00:0${id}Z`
  }
}

describe('task event projections', () => {
  it('coalesces streamed agent text by item', () => {
    const conversation = buildConversation([
      event(1, 'user.message', { text: '修复设置页' }),
      event(2, 'agent.text.delta', { turnId: 'turn-1', itemId: 'message-1', delta: '我先' }),
      event(3, 'agent.text.delta', { turnId: 'turn-1', itemId: 'message-1', delta: '检查。' })
    ])

    expect(conversation).toHaveLength(2)
    expect(conversation[1]?.text).toBe('我先检查。')
  })

  it('coalesces command output without hiding file activity', () => {
    const activities = buildActivities([
      event(1, 'command.output.delta', { itemId: 'command-1', delta: 'pass ' }),
      event(2, 'command.output.delta', { itemId: 'command-1', delta: '12 tests' }),
      event(3, 'file.change.updated', { itemId: 'patch-1' })
    ])

    expect(activities).toHaveLength(2)
    expect(activities[0]?.detail).toBe('pass 12 tests')
    expect(activities[1]?.kind).toBe('file')
  })

  it('surfaces recovery boundaries in the conversation', () => {
    const conversation = buildConversation([
      event(1, 'runtime.state', { status: 'recovering' }, 'application/restarted'),
      event(2, 'runtime.state', { sessionGeneration: 2 }, 'session/generation-changed')
    ])

    expect(conversation.map((item) => item.kind)).toEqual(['system', 'system'])
    expect(conversation[1]?.text).toContain('Session Generation')
  })
})
