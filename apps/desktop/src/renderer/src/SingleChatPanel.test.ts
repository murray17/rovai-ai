import { readFileSync } from 'node:fs'
// Keep JSX explicit so this suite remains within the repository's discovered `.test.ts` pattern.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentRunExecutionEvidenceView,
  CampMemberView,
  CoreEvent,
  SingleChatRunView,
  SingleChatSnapshot
} from '@contracts'
import {
  SINGLE_CHAT_POLL_INTERVAL_MS,
  SingleChatPanel,
  formatSingleChatDuration,
  singleChatChangeRefreshTarget,
  singleChatConversationReady,
  singleChatEndCommand,
  singleChatEndTargetFromSnapshot,
  singleChatEvidenceForRun,
  singleChatRunSummary,
  singleChatSnapshotNeedsPolling,
  singleChatTargetRequestIsCurrent,
  startSingleChatPolling
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

function snapshot({
  runs = [],
  pendingStates = []
}: {
  runs?: SingleChatRunView[]
  pendingStates?: Array<'queued' | 'needs_repair'>
} = {}): SingleChatSnapshot {
  return {
    conversation: {
      id: 'conversation-1',
      campId: 'camp-1',
      agentId: 'agent-1',
      version: 1,
      status: 'active',
      lastMessageSequence: 0,
      lastAcceptedPublicBoundarySequence: 0,
      activeAgentRunId: runs.find((item) => ['queued', 'running', 'waiting'].includes(item.status))?.id ?? null,
      createdAt: '2026-09-03T10:00:00.000Z',
      updatedAt: '2026-09-03T10:00:00.000Z',
      endedAt: null
    },
    messages: [],
    draft: { revision: 0, attachments: [], updatedAt: null },
    pendingInputs: {
      executionActive: runs.some((item) => ['queued', 'running', 'waiting'].includes(item.status)),
      items: pendingStates.map((state, index) => ({
        id: `pending-${index}`,
        conversationId: 'conversation-1',
        enqueueSequence: index + 1,
        revision: 1,
        state,
        body: 'next',
        lastAttemptErrorCode: null,
        attachments: []
      })),
      editSession: null
    },
    agentRuns: runs,
    executionEvidence: []
  }
}

function changed(params: Record<string, unknown>): CoreEvent {
  return { method: 'single_chat.changed', params }
}

afterEach(() => {
  vi.useRealTimers()
})

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

  it('rejects stale target loads and disables conversation actions until the selected target is ready', async () => {
    const firstRequest = { agentId: 'agent-2', sequence: 4 }
    expect(singleChatTargetRequestIsCurrent(firstRequest, 4, 'agent-2')).toBe(true)
    expect(singleChatTargetRequestIsCurrent(firstRequest, 5, 'agent-3')).toBe(false)
    expect(singleChatTargetRequestIsCurrent(firstRequest, 4, 'agent-3')).toBe(false)

    let sequence = 4
    let selectedAgentId = 'agent-2'
    let releaseFirst!: (value: string) => void
    const acceptWhenCurrent = async (
      request: { agentId: string; sequence: number },
      value: Promise<string>
    ): Promise<string | null> => {
      const resolved = await value
      return singleChatTargetRequestIsCurrent(request, sequence, selectedAgentId)
        ? resolved
        : null
    }
    const firstResult = acceptWhenCurrent(firstRequest, new Promise((resolve) => { releaseFirst = resolve }))
    sequence = 5
    selectedAgentId = 'agent-3'
    const secondResult = acceptWhenCurrent(
      { agentId: 'agent-3', sequence },
      Promise.resolve('conversation-3')
    )
    releaseFirst('conversation-2')
    expect(await secondResult).toBe('conversation-3')
    expect(await firstResult).toBeNull()

    const firstSnapshot = snapshot()
    expect(singleChatConversationReady(null, 'agent-1', false)).toBe(true)
    expect(singleChatConversationReady(null, null, false)).toBe(false)
    expect(singleChatConversationReady(firstSnapshot, 'agent-1', false)).toBe(true)
    expect(singleChatConversationReady(firstSnapshot, 'agent-2', false)).toBe(false)
    expect(singleChatConversationReady(firstSnapshot, 'agent-1', true)).toBe(false)

    const chooseTargetStart = source.indexOf('const chooseTarget = async')
    const chooseTargetEnd = source.indexOf('\n  const prepareFiles =', chooseTargetStart)
    const chooseTargetSource = source.slice(chooseTargetStart, chooseTargetEnd)
    expect(chooseTargetSource).toContain('targetRequestSequenceRef')
    expect(chooseTargetSource).toContain('snapshotRef.current = null')
    expect(chooseTargetSource).toContain('setSnapshot(null)')
    expect(chooseTargetSource).toContain('singleChatTargetRequestIsCurrent')
    expect(source).toContain('disabled={!snapshot || !currentTargetReady || ending}')
    expect(source).toContain('disabled={!currentTargetReady || cancelling}')
    expect(source).toContain('!selectedMember || !currentTargetReady || sending || ending')
  })

  it('pins the end command to the conversation shown when confirmation opens', () => {
    const firstSnapshot = snapshot()
    const target = singleChatEndTargetFromSnapshot(firstSnapshot, '雾切响子')
    const laterSnapshot = {
      ...firstSnapshot,
      conversation: {
        ...firstSnapshot.conversation,
        id: 'conversation-2',
        agentId: 'agent-2',
        version: 9
      }
    }

    expect(laterSnapshot.conversation.id).toBe('conversation-2')
    expect(singleChatEndCommand('camp-1', target)).toEqual({
      campId: 'camp-1',
      conversationId: 'conversation-1',
      expectedConversationVersion: 1
    })
    expect(source).toContain('endConversation(endTarget)')
    expect(source).toContain('singleChatEndCommand(campId, target)')
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

  it('polls only while the selected conversation can still advance automatically', () => {
    expect(singleChatSnapshotNeedsPolling(snapshot())).toBe(false)
    expect(singleChatSnapshotNeedsPolling(snapshot({
      runs: [run({ status: 'running', endedAt: null, finalConversationMessageId: null })]
    }))).toBe(true)
    expect(singleChatSnapshotNeedsPolling(snapshot({ pendingStates: ['queued'] }))).toBe(true)
    expect(singleChatSnapshotNeedsPolling(snapshot({ pendingStates: ['needs_repair'] }))).toBe(false)
    expect(singleChatSnapshotNeedsPolling(snapshot({
      runs: [run({ status: 'succeeded' })],
      pendingStates: ['needs_repair']
    }))).toBe(false)
  })

  it('stops the run loop on the first terminal snapshot and cancels it with the panel', async () => {
    vi.useFakeTimers()
    const refresh = vi.fn<(conversationId: string) => Promise<SingleChatSnapshot | null>>()
      .mockResolvedValueOnce(snapshot({
        runs: [run({ status: 'running', endedAt: null, finalConversationMessageId: null })]
      }))
      .mockResolvedValueOnce(snapshot({ runs: [run()] }))
    const stop = startSingleChatPolling(
      'conversation-1',
      refresh,
      (callback, delayMs) => setTimeout(callback, delayMs),
      (timer) => clearTimeout(timer)
    )

    await vi.advanceTimersByTimeAsync(SINGLE_CHAT_POLL_INTERVAL_MS)
    expect(refresh).toHaveBeenCalledExactlyOnceWith('conversation-1')
    await vi.advanceTimersByTimeAsync(SINGLE_CHAT_POLL_INTERVAL_MS)
    expect(refresh).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(SINGLE_CHAT_POLL_INTERVAL_MS * 2)
    expect(refresh).toHaveBeenCalledTimes(2)

    stop()
    const cancelledRefresh = vi.fn<(conversationId: string) => Promise<SingleChatSnapshot | null>>()
      .mockResolvedValue(snapshot())
    const cancelBeforeFirstRead = startSingleChatPolling(
      'conversation-1',
      cancelledRefresh,
      (callback, delayMs) => setTimeout(callback, delayMs),
      (timer) => clearTimeout(timer)
    )
    cancelBeforeFirstRead()
    await vi.advanceTimersByTimeAsync(SINGLE_CHAT_POLL_INTERVAL_MS)
    expect(cancelledRefresh).not.toHaveBeenCalled()

    let release!: (next: SingleChatSnapshot | null) => void
    const inFlightRefresh = vi.fn<(conversationId: string) => Promise<SingleChatSnapshot | null>>()
      .mockImplementation(() => new Promise((resolve) => { release = resolve }))
    const stopInFlight = startSingleChatPolling(
      'conversation-1',
      inFlightRefresh,
      (callback, delayMs) => setTimeout(callback, delayMs),
      (timer) => clearTimeout(timer)
    )
    await vi.advanceTimersByTimeAsync(SINGLE_CHAT_POLL_INTERVAL_MS)
    expect(inFlightRefresh).toHaveBeenCalledTimes(1)
    stopInFlight()
    release(snapshot({
      runs: [run({ status: 'running', endedAt: null, finalConversationMessageId: null })]
    }))
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(SINGLE_CHAT_POLL_INTERVAL_MS * 2)
    expect(inFlightRefresh).toHaveBeenCalledTimes(1)
  })

  it('routes Single Chat changes to the narrowest visible-panel read', () => {
    expect(singleChatChangeRefreshTarget(
      changed({ campId: 'camp-1', conversationId: 'conversation-1' }),
      'camp-1',
      'conversation-1'
    )).toBe('current-conversation')
    expect(singleChatChangeRefreshTarget(
      changed({ campId: 'camp-1', conversationId: 'conversation-2' }),
      'camp-1',
      'conversation-1'
    )).toBe('none')
    expect(singleChatChangeRefreshTarget(changed({ campId: 'other' }), 'camp-1', 'conversation-1'))
      .toBe('none')
    expect(singleChatChangeRefreshTarget({ method: 'agent.text.delta', params: { campId: 'camp-1' } }, 'camp-1', 'conversation-1'))
      .toBe('none')

    for (const code of ['single_chat.opened', 'single_chat.ended']) {
      expect(singleChatChangeRefreshTarget(changed({
        campId: 'camp-1',
        result: { code, payload: { conversationId: 'conversation-1' } }
      }), 'camp-1', 'conversation-1')).toBe('conversation-list')
    }
    expect(singleChatChangeRefreshTarget(changed({
      campId: 'camp-1',
      result: {
        code: 'single_chat.reply_queued',
        payload: { conversationId: 'conversation-1' }
      }
    }), 'camp-1', 'conversation-1')).toBe('current-conversation')
    expect(singleChatChangeRefreshTarget(changed({
      campId: 'camp-1',
      result: {
        code: 'single_chat.reply_queued',
        payload: { conversationId: 'conversation-2' }
      }
    }), 'camp-1', 'conversation-1')).toBe('conversation-list')
    expect(singleChatChangeRefreshTarget(changed({
      campId: 'camp-1',
      conversationId: 'conversation-2',
      reason: 'pending_input_published'
    }), 'camp-1', 'conversation-1')).toBe('conversation-list')
  })

  it('keeps list reads out of the 800ms run loop and gates all reads on panel visibility', () => {
    expect(source.match(/'singleChat\.list'/gu)).toHaveLength(1)
    expect(source.match(/'singleChat\.get'/gu)).toHaveLength(1)
    const pollStart = source.indexOf('const pollingRequired = singleChatSnapshotNeedsPolling(currentSnapshot)')
    const pollEnd = source.indexOf('if (!visible || !activeRun) return', pollStart)
    const pollingEffect = source.slice(pollStart, pollEnd)
    expect(pollStart).toBeGreaterThan(-1)
    expect(pollEnd).toBeGreaterThan(pollStart)
    expect(pollingEffect).toContain('if (!visible || !conversationId || !pollingRequired) return')
    expect(pollingEffect).toContain('startSingleChatPolling(')
    expect(pollingEffect).toContain('refreshCurrentConversation,')
    expect(pollingEffect).not.toContain('singleChat.list')
    expect(SINGLE_CHAT_POLL_INTERVAL_MS).toBe(800)
    expect(source).toContain("if (!visible) return\n    return window.rovai.onEvent")
  })
})
