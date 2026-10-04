import { describe, expect, it } from 'vitest'
import type { AgentRunView, ThreadMessageView, ThreadTurnView } from '@contracts'
import { userAnchorStackHeight, userMessageAnchors } from './user-message-anchors'

function message(id: string, sequence: number, authorType: ThreadMessageView['authorType'],
  overrides: Partial<ThreadMessageView> = {}): ThreadMessageView {
  return { id, sequence, authorType, authorId: authorType === 'agent' ? 'teammate' : 'local_user',
    timelineGlobalSequence: null, sourceAgentRunId: null, body: id, content: [{ kind: 'text', text: id }],
    attachments: [], quotes: [], addressMode: 'default', addressedAgentIds: [], replyToThreadMessageId: null,
    threadTurnId: null, presentation: null, createdAt: '2026-09-30T00:00:00Z', withdrawn: false,
    canWithdraw: false, version: 1, ...overrides }
}
const run = (id: string, inputMessageIds: string[]): Pick<AgentRunView,
  'id' | 'inputMessageIds' | 'anchorMessageId' | 'threadTurnId'> => ({ id, inputMessageIds, threadTurnId: null })

describe('loaded user-message anchor projection', () => {
  it('indexes human inputs in sequence order, excluding withdrawn and mission-start content', () => {
    const anchors = userMessageAnchors([
      message('user-2', 8, 'external_principal'), message('agent', 3, 'agent'),
      message('user-1', 2, 'user'), message('withdrawn', 4, 'user', { withdrawn: true }),
      message('system', 5, 'system'), message('mission', 6, 'user', {
        missionStart: { missionId: 'm', title: 'm', description: 'm' }
      })
    ], [], [])
    expect(anchors.map(anchor => anchor.id)).toEqual(['user-1', 'user-2'])
  })

  it('keeps the first actual reply per user despite interleaving, refresh order and multiple teammates', () => {
    const anchors = userMessageAnchors([
      message('later-a', 8, 'agent', { replyToThreadMessageId: 'a' }),
      message('a', 1, 'user'), message('b', 2, 'user'),
      message('b-first', 3, 'agent', { replyToThreadMessageId: 'b' }),
      message('unrelated', 4, 'agent'),
      message('a-first', 5, 'agent', { replyToThreadMessageId: 'a' }),
      message('withdrawn-reply', 0, 'agent', { withdrawn: true, replyToThreadMessageId: 'a' })
    ], [], [])
    expect(anchors.map(anchor => anchor.firstReply)).toEqual(['a-first', 'b-first'])
  })

  it('uses authoritative Run inputs and Turn triggers when public output has no reply reference', () => {
    const turns: Pick<ThreadTurnView, 'id' | 'triggerType' | 'triggerId'>[] = [
      { id: 'turn', triggerType: 'camp_message', triggerId: 'c' }
    ]
    const anchors = userMessageAnchors([
      message('a', 1, 'user'), message('b', 2, 'user'), message('c', 3, 'user'),
      message('batch-first', 4, 'agent', { sourceAgentRunId: 'batch' }),
      message('turn-first', 5, 'agent', { threadTurnId: 'turn' }),
      message('explicit-b', 6, 'agent', { sourceAgentRunId: 'batch', replyToThreadMessageId: 'c' })
    ], [run('batch', ['a', 'b', 'unloaded-user'])], turns)
    expect(anchors.map(anchor => anchor.firstReply)).toEqual(['batch-first', 'batch-first', 'turn-first'])
  })

  it('does not attach an explicit reply to another message to a Run input or guess from adjacency', () => {
    const anchors = userMessageAnchors([
      message('a', 1, 'user'), message('b', 2, 'user'),
      message('reply-b', 3, 'agent', { sourceAgentRunId: 'run-a', replyToThreadMessageId: 'b' }),
      message('unlinked', 4, 'agent'),
      message('peer-reply', 5, 'agent', { sourceAgentRunId: 'run-a', replyToThreadMessageId: 'unlinked' })
    ], [run('run-a', ['a'])], [])
    expect(anchors.map(anchor => anchor.firstReply)).toEqual([null, 'reply-b'])
  })

  it('does not use earlier Run output as the reply to an input accepted later in that Run', () => {
    const anchors = userMessageAnchors([
      message('first-input', 1, 'user'),
      message('early-output', 2, 'agent', { sourceAgentRunId: 'continuing-run' }),
      message('later-input', 3, 'user'),
      message('later-output', 4, 'agent', { sourceAgentRunId: 'continuing-run' })
    ], [run('continuing-run', ['first-input', 'later-input'])], [])
    expect(anchors.map(anchor => anchor.firstReply)).toEqual(['early-output', 'later-output'])
  })

  it('keeps complete titles and normalizes projected mentions, with attachment names for textless inputs', () => {
    const body = `@爱丽丝\n  ${'完整消息正文 '.repeat(150)}`
    const anchors = userMessageAnchors([message('a', 1, 'user', { body }),
      message('b', 2, 'user', { body: '', attachments: [{ id: 'f', displayName: '设计稿.html', kind: 'file',
        fileCount: null, mediaType: 'text/html', byteSize: 1, previewKind: 'none', availability: 'available' }] })
    ], [], [], item => item.body)
    expect(anchors[0].title).toBe(body.trim().replace(/\s+/gu, ' '))
    expect(anchors[1].title).toBe('设计稿.html')
    expect(anchors[1].firstReply).toBeNull()
  })
})

it('bounds 240 individual anchors by the available stage height, on complete rows', () => {
  expect(userAnchorStackHeight(240, 900)).toBe(360)
  expect(userAnchorStackHeight(240, 500)).toBe(350)
  expect(userAnchorStackHeight(240, 301)).toBe(210)
  expect(userAnchorStackHeight(4, 900)).toBe(40)
  expect(userAnchorStackHeight(240, 10)).toBe(0)
})
