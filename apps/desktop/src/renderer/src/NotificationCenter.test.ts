import { describe, expect, it } from 'vitest'
import type { InAppNotificationView } from '@contracts'
import {
  notificationBadgeLabel,
  notificationInboxWithPendingReads,
  notificationPresentation
} from './NotificationCenter'
import { preferenceFromUnknown } from './NotificationSettings'

function notification(
  kind: InAppNotificationView['kind'],
  attentionState: InAppNotificationView['attentionState'] = null
): InAppNotificationView {
  return {
    id: 'notification-1',
    sequence: 1,
    kind,
    camp: { id: 'camp-1', title: 'Current title' },
    campTurnId: kind === 'runtime_permission_attention' ? null : 'turn-1',
    sourceAvailable: true,
    attentionState,
    readAt: null,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z'
  }
}

describe('In-App Notification presentation', () => {
  it('maps the closed notification kinds without exposing source content', () => {
    expect(notificationPresentation(notification(
      'runtime_permission_attention',
      'pending'
    ))).toEqual({ label: '待审批', message: '有操作等待你确认' })
    expect(notificationPresentation(notification(
      'runtime_permission_attention',
      'resolved'
    ))).toEqual({ label: '待审批 · 已处理', message: '相关操作已处理' })
    expect(notificationPresentation(notification('camp_turn_completed'))).toEqual({
      label: '执行完成',
      message: '一次协作已经完成'
    })
    expect(notificationPresentation(notification('camp_turn_incomplete'))).toEqual({
      label: '执行未完成',
      message: '一次协作未完成，请返回查看'
    })
  })

  it('caps the visual badge while preserving zero and exact small counts', () => {
    expect(notificationBadgeLabel(0)).toBe('0')
    expect(notificationBadgeLabel(1)).toBe('1')
    expect(notificationBadgeLabel(99)).toBe('99')
    expect(notificationBadgeLabel(100)).toBe('99+')
  })

  it('does not let an older inbox snapshot roll back an optimistic single-item read', () => {
    const first = notification('camp_turn_completed')
    const second = {
      ...notification('camp_turn_incomplete'),
      id: 'notification-2',
      sequence: 2
    }
    const inbox = {
      schemaVersion: 2 as const,
      throughSequence: 2,
      unreadCount: 2,
      items: [second, first],
      nextCursor: null
    }
    const pendingReads = new Map([[first.id, '2026-08-01T00:01:00Z']])

    const all = notificationInboxWithPendingReads(inbox, pendingReads, 'all')
    expect(all.unreadCount).toBe(1)
    expect(all.items.find((item) => item.id === first.id)?.readAt)
      .toBe('2026-08-01T00:01:00Z')
    expect(inbox.items[1].readAt).toBeNull()

    const unread = notificationInboxWithPendingReads(inbox, pendingReads, 'unread')
    expect(unread.items.map((item) => item.id)).toEqual([second.id])
  })

  it('does not subtract a pending read twice once Core reports it as read', () => {
    const read = {
      ...notification('camp_turn_completed'),
      readAt: '2026-08-01T00:01:00Z'
    }
    const inbox = {
      schemaVersion: 2 as const,
      throughSequence: 1,
      unreadCount: 0,
      items: [read],
      nextCursor: null
    }

    expect(notificationInboxWithPendingReads(
      inbox,
      new Map([[read.id, '2026-08-01T00:00:30Z']]),
      'all'
    )).toEqual(inbox)
  })

  it('fails closed when a preference snapshot is incomplete', () => {
    expect(preferenceFromUnknown({ headsUpEnabled: true })).toBeNull()
    expect(preferenceFromUnknown({
      headsUpEnabled: true,
      approvalHeadsUpEnabled: false,
      executionHeadsUpEnabled: true,
      version: 4,
      updatedAt: '2026-08-01T00:00:00Z'
    })).toEqual({
      headsUpEnabled: true,
      approvalHeadsUpEnabled: false,
      executionHeadsUpEnabled: true,
      version: 4,
      updatedAt: '2026-08-01T00:00:00Z'
    })
  })
})
