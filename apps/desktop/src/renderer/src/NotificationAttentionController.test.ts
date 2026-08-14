import { describe, expect, it } from 'vitest'
import type {
  NotificationActionView,
  NotificationEpisodeChange,
  NotificationEpisodeChangeBatch,
  NotificationEpisodeView,
  NotificationHeadsUpSignal,
  NotificationSemantic
} from '@contracts'
import {
  NOTIFICATION_RECOVERY_INTERVAL_MS,
  applyNotificationHeadsUpChanges,
  promoteNotificationHeadsUpOverflow,
  notificationHeadsUpPresentation,
  readNotificationChangePages,
  shouldPollForNotificationEvent
} from './NotificationAttentionController'
import { preferenceFromUnknown } from './NotificationSettings'

function action(
  episodeId: string,
  kind: NotificationActionView['kind'] = 'open_camp_turn'
): NotificationActionView {
  return {
    actionId: `${episodeId}:${kind}`,
    kind,
    available: true,
    campId: 'camp-1',
    campTurnId: kind === 'open_camp_turn' ? 'turn-1' : null,
    messageId: kind === 'open_camp_message' ? 'message-1' : null,
    approvalId: kind === 'open_approval' ? 'approval-1' : null,
    acknowledgementId: `occurrence:${episodeId}`,
    observedEpisodeVersion: 1
  }
}

function episode(
  semantic: NotificationSemantic,
  overrides: Partial<NotificationEpisodeView> = {}
): NotificationEpisodeView {
  const id = overrides.id ?? 'episode-1'
  return {
    id,
    kind: semantic === 'approval_pending' ? 'approval' : 'collaboration',
    episodeVersion: 1,
    attentionRevision: 1,
    changeSequence: 1,
    camp: { id: 'camp-1', title: 'Current title' },
    campTurnId: semantic === 'approval_pending' ? null : 'turn-1',
    primarySemantic: semantic,
    unread: true,
    resolved: false,
    satisfied: false,
    pendingApprovalCount: semantic === 'approval_pending' ? 1 : 0,
    mentionCount: semantic === 'user_mention' ? 1 : 0,
    unacknowledgedMentionCount: semantic === 'user_mention' ? 1 : 0,
    mention: semantic === 'user_mention'
      ? {
        messageId: 'message-1',
        authorId: 'agent-1',
        authorDisplayName: '洛克',
        summary: '@你 请确认方案',
        available: true
      }
      : null,
    reasons: [{
      semantic,
      occurrenceCount: 1,
      unacknowledgedCount: 1,
      state: semantic === 'approval_pending'
        ? 'pending'
        : semantic === 'turn_completed'
          ? 'unsatisfied'
          : 'unacknowledged'
    }],
    primaryAction: action(
      id,
      semantic === 'approval_pending'
        ? 'open_approval'
        : semantic === 'user_mention'
          ? 'open_camp_message'
          : 'open_camp_turn'
    ),
    secondaryActions: [],
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...overrides
  }
}

function change(
  item: NotificationEpisodeView,
  sequence: number,
  reason: NotificationSemantic | null = item.primarySemantic
): NotificationEpisodeChange {
  const signal = reason ? headsUpSignal(item, reason) : null
  return {
    changeSequence: sequence,
    episodeId: item.id,
    episodeVersion: item.episodeVersion,
    attentionRevision: item.attentionRevision,
    operation: 'upsert',
    changeCause: 'occurrence_admitted',
    headsUpSignal: signal,
    headsUpInvalidation: null,
    changedAt: item.updatedAt,
    episode: item
  }
}

function headsUpSignal(
  item: NotificationEpisodeView,
  semantic: NotificationSemantic
): NotificationHeadsUpSignal {
  return {
    semantic,
    admittedAttentionRevision: item.attentionRevision,
    action: action(item.id, semantic === 'approval_pending'
      ? 'open_approval'
      : semantic === 'user_mention'
        ? 'open_camp_message'
        : 'open_camp_turn'),
    mention: semantic === 'user_mention' ? item.mention : null
  }
}

describe('Notification attention controller', () => {
  it('uses event-driven refresh with a low-frequency recovery poll', () => {
    expect(NOTIFICATION_RECOVERY_INTERVAL_MS).toBe(30_000)
    expect(shouldPollForNotificationEvent('notification_episode.changed')).toBe(true)
    expect(shouldPollForNotificationEvent('camp_message.sent')).toBe(false)
    expect(shouldPollForNotificationEvent('agent_run.succeeded')).toBe(false)
  })

  it('updates one visible heads-up in place for the same Episode', () => {
    const first = episode('user_mention')
    const updated = episode('turn_failed', {
      id: first.id,
      episodeVersion: 2,
      attentionRevision: 2,
      updatedAt: '2026-08-01T00:01:00Z'
    })
    const other = episode('turn_completed', { id: 'episode-2' })
    const initial = applyNotificationHeadsUpChanges(
      { entries: [], overflowEntries: [] },
      [change(first, 1)]
    )
    const next = applyNotificationHeadsUpChanges(initial, [
      change(updated, 2, 'turn_failed'),
      change(other, 3)
    ])

    expect(next.entries).toHaveLength(2)
    expect(next.entries[0]).toMatchObject({
      episode: { id: first.id, episodeVersion: 2 },
      signal: { semantic: 'turn_failed' },
      changeSequence: 2
    })
  })

  it('does not replay an admitted reason that became inactive before hydration', () => {
    const acknowledgedMention = episode('user_mention', {
      unread: true,
      reasons: [{
        semantic: 'user_mention',
        occurrenceCount: 1,
        unacknowledgedCount: 0,
        state: 'acknowledged'
      }, {
        semantic: 'turn_failed',
        occurrenceCount: 1,
        unacknowledgedCount: 1,
        state: 'unacknowledged'
      }]
    })
    const inactiveChange = change(acknowledgedMention, 2, null)
    expect(applyNotificationHeadsUpChanges(
      { entries: [], overflowEntries: [] },
      [inactiveChange]
    ).entries).toEqual([])
  })

  it('keeps the newest exact Mention signal across unrelated Episode changes', () => {
    const first = episode('user_mention')
    const firstChange = change(first, 1)
    firstChange.headsUpSignal!.action.acknowledgementId = 'mention-a'
    const second = episode('user_mention', {
      episodeVersion: 2,
      attentionRevision: 2,
      changeSequence: 2
    })
    const secondChange = change(second, 2)
    secondChange.headsUpSignal!.action.acknowledgementId = 'mention-b'
    const queued = applyNotificationHeadsUpChanges(
      { entries: [], overflowEntries: [] },
      [firstChange, secondChange]
    )
    const unrelated = change(episode('turn_completed', { id: 'episode-2' }), 3, null)

    const retained = applyNotificationHeadsUpChanges(queued, [unrelated])

    expect(retained.entries).toHaveLength(1)
    expect(retained.entries[0].signal.action.acknowledgementId).toBe('mention-b')
  })

  it('removes a pending Approval signal when its exact source state changes', () => {
    const approval = episode('approval_pending')
    const admitted = change(approval, 1)
    const acknowledgementId = admitted.headsUpSignal!.action.acknowledgementId as string
    const queued = applyNotificationHeadsUpChanges(
      { entries: [], overflowEntries: [] },
      [admitted]
    )
    const resolved: NotificationEpisodeChange = {
      ...change(episode('approval_pending', {
        resolved: true,
        primaryAction: {
          ...action(approval.id, 'acknowledge_only'),
          acknowledgementId
        }
      }), 2, null),
      changeCause: 'resolved',
      headsUpInvalidation: {
        kind: 'source_state_changed',
        acknowledgementId,
        throughAttentionRevision: null
      }
    }

    expect(applyNotificationHeadsUpChanges(queued, [resolved])).toEqual({
      entries: [],
      overflowEntries: []
    })
  })

  it('applies a Clear boundary before admitting a newer signal', () => {
    const first = episode('user_mention')
    const queued = applyNotificationHeadsUpChanges(
      { entries: [], overflowEntries: [] },
      [change(first, 1)]
    )
    const cleared: NotificationEpisodeChange = {
      ...change(first, 2, null),
      operation: 'remove',
      changeCause: 'cleared',
      episode: null,
      headsUpInvalidation: {
        kind: 'attention_cleared',
        acknowledgementId: null,
        throughAttentionRevision: 1
      }
    }
    const second = episode('user_mention', {
      episodeVersion: 3,
      attentionRevision: 2,
      changeSequence: 3
    })

    const next = applyNotificationHeadsUpChanges(queued, [cleared, change(second, 3)])

    expect(next.entries).toHaveLength(1)
    expect(next.entries[0].signal.admittedAttentionRevision).toBe(2)
  })

  it('invalidates exact signals retained in overflow', () => {
    const visible = episode('user_mention')
    const overflow = episode('approval_pending', { id: 'episode-2' })
    const overflowChange = change(overflow, 2)
    const acknowledgementId = overflowChange.headsUpSignal!.action.acknowledgementId as string
    const queued = applyNotificationHeadsUpChanges(
      { entries: [], overflowEntries: [] },
      [change(visible, 1), overflowChange],
      1
    )
    expect(queued.overflowEntries).toHaveLength(1)
    const resolved: NotificationEpisodeChange = {
      ...change(overflow, 3, null),
      changeCause: 'resolved',
      headsUpInvalidation: {
        kind: 'source_state_changed',
        acknowledgementId,
        throughAttentionRevision: null
      }
    }

    const next = applyNotificationHeadsUpChanges(queued, [resolved], 1)

    expect(next.entries).toHaveLength(1)
    expect(next.overflowEntries).toEqual([])
  })

  it('lets the user advance overflow reminders without a notification center', () => {
    const first = episode('user_mention')
    const second = episode('turn_completed', { id: 'episode-2' })
    const queued = applyNotificationHeadsUpChanges(
      { entries: [], overflowEntries: [] },
      [change(first, 1), change(second, 2)],
      1
    )

    const promoted = promoteNotificationHeadsUpOverflow({
      entries: [],
      overflowEntries: queued.overflowEntries
    }, 1)

    expect(promoted.entries[0].episode.id).toBe('episode-2')
    expect(promoted.overflowEntries).toEqual([])
  })

  it('presents and opens the exact signal rather than the Episode current primary state', () => {
    const current = episode('turn_completed', {
      mention: {
        messageId: 'message-new',
        authorId: 'agent-1',
        authorDisplayName: '洛克',
        summary: '第二条消息提到你',
        available: true
      },
      primaryAction: action('episode-1', 'open_camp_turn')
    })
    const signal = headsUpSignal(current, 'user_mention')
    signal.action.messageId = 'message-new'
    const queued = applyNotificationHeadsUpChanges({ entries: [], overflowEntries: [] }, [{
      ...change(current, 7, null),
      headsUpSignal: signal
    }])

    expect(queued.entries[0].signal.action.messageId).toBe('message-new')
    expect(notificationHeadsUpPresentation(queued.entries[0].signal)).toEqual({
      label: '提到你',
      message: '第二条消息提到你'
    })
  })

  it('does not commit a candidate cursor when a later page fails', async () => {
    const first = episode('user_mention')
    const requests: number[] = []
    const request = async (cursor: number): Promise<NotificationEpisodeChangeBatch> => {
      requests.push(cursor)
      if (cursor === 0) return {
        schemaVersion: 6,
        requestedAfterChangeSequence: 0,
        nextChangeSequence: 1,
        throughChangeSequence: 2,
        resetRequired: false,
        hasMore: true,
        changes: [change(first, 1)]
      }
      throw new Error('page two failed')
    }

    await expect(readNotificationChangePages(0, request)).rejects.toThrow('page two failed')
    expect(requests).toEqual([0, 1])
    const retried = await readNotificationChangePages(0, async (cursor) => ({
      schemaVersion: 6,
      requestedAfterChangeSequence: cursor,
      nextChangeSequence: 2,
      throughChangeSequence: 2,
      resetRequired: false,
      hasMore: false,
      changes: [change(first, 1)]
    }))
    expect(retried.nextChangeSequence).toBe(2)
  })

  it('fails closed when a preference snapshot is incomplete', () => {
    expect(preferenceFromUnknown({ headsUpEnabled: true })).toBeNull()
    const preference = {
      headsUpEnabled: true,
      approvalHeadsUpEnabled: false,
      userMentionHeadsUpEnabled: true,
      turnCompletedHeadsUpEnabled: true,
      turnIncompleteHeadsUpEnabled: false,
      version: 4,
      updatedAt: '2026-08-01T00:00:00Z'
    }
    expect(preferenceFromUnknown(preference)).toEqual(preference)
  })
})
