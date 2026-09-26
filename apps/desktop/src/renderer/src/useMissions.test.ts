import { describe, expect, it } from 'vitest'
import { shouldRefreshMissionsForEvent, unreadMissionCount } from './useMissions'

describe('unreadMissionCount', () => {
  it('counts unread Mission replies independently of Mission status', () => {
    expect(unreadMissionCount([
      { status: 'needs_you', hasUnread: false },
      { status: 'running', hasUnread: true },
      { status: 'completed', hasUnread: true }
    ])).toBe(2)
  })
})

it('ignores ordinary Camp switching and refreshes only known Mission changes', () => {
  const ids = new Set(['mission-camp'])
  for (const reason of ['camps.enter', 'navigation.campViewed', 'agent_run.terminal']) {
    expect(shouldRefreshMissionsForEvent({ method: 'navigation.invalidated', params: { reason, campId: 'ordinary-camp' } }, ids)).toBe(false)
  }
  expect(shouldRefreshMissionsForEvent({ method: 'navigation.invalidated', params: { reason: 'agent_run.terminal', campId: 'mission-camp' } }, ids)).toBe(true)
  expect(shouldRefreshMissionsForEvent({ method: 'missions.invalidated', params: {} }, ids)).toBe(true)
  expect(shouldRefreshMissionsForEvent({ method: 'events.batch', params: { events: [{ eventType: 'camp_message.sent', campId: 'ordinary-camp' }] } }, ids)).toBe(false)
})
