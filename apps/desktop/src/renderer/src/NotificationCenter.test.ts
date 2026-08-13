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
  applyNotificationChanges,
  enqueueNotificationHeadsUps,
  episodeHasActiveHeadsUpReason,
  episodeHasActiveHeadsUpSignal,
  notificationBadgeLabel,
  notificationHeadsUpPresentation,
  notificationPresentation,
  readNotificationChangePages
} from './NotificationCenter'
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
    action: action(item.id, semantic === 'approval_pending'
      ? 'open_approval'
      : semantic === 'user_mention'
        ? 'open_camp_message'
        : 'open_camp_turn'),
    mention: semantic === 'user_mention' ? item.mention : null
  }
}

describe('Notification Episode presentation', () => {
  it('uses distinct closed copy for all attention semantics', () => {
    expect(notificationPresentation(episode('approval_pending'))).toEqual({
      label: '待审批',
      message: '有操作等待你确认'
    })
    expect(notificationPresentation(episode('turn_completed'))).toEqual({
      label: '等待你的下一步',
      message: '本轮协作已经完成'
    })
    expect(notificationPresentation(episode('turn_failed'))).toEqual({
      label: '执行失败',
      message: '本轮协作失败，请返回查看'
    })
    expect(notificationPresentation(episode('turn_incomplete'))).toEqual({
      label: '执行未完成',
      message: '本轮协作未能证明完成，请返回查看'
    })
    expect(notificationPresentation(episode('user_mention'))).toEqual({
      label: '提到你',
      message: '@你 请确认方案'
    })
  })

  it('keeps resolved approval and unavailable mention copy honest', () => {
    expect(notificationPresentation(episode('approval_pending', { resolved: true }))).toEqual({
      label: '待审批 · 已处理',
      message: '相关操作已经处理'
    })
    expect(notificationPresentation(episode('user_mention', {
      mention: {
        messageId: 'message-1',
        authorId: 'agent-1',
        authorDisplayName: null,
        summary: null,
        available: false
      }
    }))).toEqual({ label: '提到你', message: '原消息来源不可用' })
  })

  it('caps the visual badge while preserving exact small counts', () => {
    expect(notificationBadgeLabel(0)).toBe('0')
    expect(notificationBadgeLabel(1)).toBe('1')
    expect(notificationBadgeLabel(99)).toBe('99')
    expect(notificationBadgeLabel(100)).toBe('99+')
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
    const initial = enqueueNotificationHeadsUps([], [change(first, 1)])
    const next = enqueueNotificationHeadsUps(initial.entries, [
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
    expect(episodeHasActiveHeadsUpReason(acknowledgedMention, 'user_mention')).toBe(false)
    const inactiveChange = change(acknowledgedMention, 2, null)
    expect(enqueueNotificationHeadsUps([], [inactiveChange]).entries).toEqual([])
  })

  it('reconciles a queued signal by exact acknowledgement identity', () => {
    const current = episode('user_mention')
    const stale = headsUpSignal(current, 'user_mention')
    stale.action.acknowledgementId = 'occurrence-old'
    expect(episodeHasActiveHeadsUpSignal(current, stale)).toBe(false)
    stale.action.acknowledgementId = current.primaryAction.acknowledgementId
    expect(episodeHasActiveHeadsUpSignal(current, stale)).toBe(true)
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
    const queued = enqueueNotificationHeadsUps([], [{
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
        schemaVersion: 5,
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
      schemaVersion: 5,
      requestedAfterChangeSequence: cursor,
      nextChangeSequence: 2,
      throughChangeSequence: 2,
      resetRequired: false,
      hasMore: false,
      changes: [change(first, 1)]
    }))
    expect(retried.nextChangeSequence).toBe(2)
  })

  it('hydrates upserts and removes by Episode identity', () => {
    const first = episode('user_mention')
    const second = episode('turn_completed', { id: 'episode-2' })
    const updated = { ...first, episodeVersion: 2, primarySemantic: 'turn_failed' as const }
    const remove: NotificationEpisodeChange = {
      ...change(second, 3, null),
      operation: 'remove',
      changeCause: 'cleared',
      episode: null
    }
    expect(applyNotificationChanges(
      [first, second],
      [change(updated, 2, 'turn_failed'), remove]
    )).toEqual([updated])
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
