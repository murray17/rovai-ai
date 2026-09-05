import { readFileSync } from 'node:fs'
// Keep JSX explicit so this suite remains within the repository's discovered `.test.ts` pattern.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AgentRunExecutionEvidenceView, CampMemberView, SingleChatRunView } from '@contracts'
import {
  SingleChatPanel,
  formatSingleChatDuration,
  singleChatEvidenceForRun,
  singleChatRunSummary
} from './SingleChatPanel'

const source = readFileSync(new URL('./SingleChatPanel.tsx', import.meta.url), 'utf8')

function run(overrides: Partial<SingleChatRunView> = {}): SingleChatRunView {
  return {
    id: 'run-1',
    triggerConversationMessageId: 'message-1',
    status: 'succeeded',
    version: 2,
    executionEpoch: 3,
    cancelRequestedAt: null,
    lastErrorCode: null,
    createdAt: '2026-09-03T10:00:00.000Z',
    startedAt: '2026-09-03T10:00:00.000Z',
    endedAt: '2026-09-03T10:39:17.000Z',
    finalConversationMessageId: 'message-2',
    executionEvidenceCount: 0,
    ...overrides
  }
}

function evidence(id: string, agentRunId: string, executionEpoch: number, sequence: number): AgentRunExecutionEvidenceView {
  return {
    id,
    agentRunId,
    executionEpoch,
    sequence,
    eventType: 'agent.text.delta',
    kind: 'narration',
    phase: 'updated',
    payload: { delta: id },
    contentBlobId: null,
    contentByteCount: id.length,
    isTruncated: false,
    occurredAt: '2026-09-03T10:00:00.000Z',
    canonical: null
  }
}

const member: CampMemberView = {
  agentId: 'agent-1',
  displayName: '雾切响子',
  avatarRef: null,
  teamRole: '超高校级的侦探',
  accent: '#6f7990',
  membershipStatus: 'active',
  leaveRequestedAt: null,
  profilePresence: 'present',
  memberOrder: 0,
  isDefaultLead: true,
  version: 1
}

describe('Single Chat presentation', () => {
  it('uses the confirmed Chinese terminal summaries', () => {
    expect(formatSingleChatDuration(
      '2026-09-03T10:00:00.000Z',
      '2026-09-03T10:39:17.000Z'
    )).toBe('39 分 17 秒')
    expect(singleChatRunSummary(run(), '2026-09-03T11:00:00.000Z'))
      .toBe('工作了 39 分 17 秒')
    expect(singleChatRunSummary(run({
      status: 'cancelled',
      endedAt: '2026-09-03T10:05:38.000Z',
      finalConversationMessageId: null
    }), '2026-09-03T11:00:00.000Z')).toBe('你在 5 分 38 秒后停止了运行')
  })

  it('strictly fences rendered evidence by run id and execution epoch', () => {
    const selected = singleChatEvidenceForRun([
      evidence('later', 'run-1', 3, 9),
      evidence('old-epoch', 'run-1', 2, 2),
      evidence('other-run', 'run-2', 3, 3),
      evidence('earlier', 'run-1', 3, 4)
    ], run())
    expect(selected.map((item) => item.id)).toEqual(['earlier', 'later'])
  })

  it('puts avatars in the selector trigger while keeping the transcript avatar-free', () => {
    const markup = renderToStaticMarkup(createElement(SingleChatPanel, {
      campId: 'rvcamp_01m1jkkpkzfvgraw1p4r9zfb7v',
      members: [member],
      visible: true,
      onOpen: () => undefined,
      onClose: () => undefined
    }))
    expect(markup).toContain('single-chat-target-trigger')
    expect(markup).toContain('member-avatar')
    expect(source).not.toMatch(/single-chat-(?:user-message|agent-response)[\s\S]{0,180}<MemberAvatar/)
  })

  it('keeps the agreed direct end action and confirmation copy', () => {
    expect(source).toContain('className="single-chat-end-button"')
    expect(source).toContain('这段对话将被删除且无法回复。')
    expect(source).toContain('不再询问')
    expect(source).not.toContain('aria-label="更多')
    expect(source).not.toContain('recovery_blocked')
  })

  it('uses the Camp composer contract and keeps agent output unboxed', () => {
    expect(source).toContain('className="composer single-chat-composer"')
    expect(source).toContain('composer-box single-chat-composer-box')
    expect(source).toContain('className="composer-attachment-button"')
    expect(source).toContain('Enter 发送，Shift+Enter 换行')
    expect(source).toContain('shouldSubmitStructuredComposerOnEnter({')
    expect(source).toContain('shiftKey: event.shiftKey')
    expect(source).toContain('event.nativeEvent.isComposing')
    expect(source).toContain('draftRevision: current.draft.revision')
    expect(source).toContain('<AttachmentCard')
    expect(source).not.toContain('preparedAttachments')
    expect(source).toContain('className="single-chat-agent-response"')
    expect(source).not.toContain('single-chat-agent-bubble')
  })
})
