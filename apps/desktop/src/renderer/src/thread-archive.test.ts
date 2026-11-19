import type { ArchiveItem } from '@contracts'
import { expect, it } from 'vitest'
import { archiveView, normalizeArchiveText } from './thread-archive'

it('orders complete projects by their latest matching chat and keeps counts across filters', () => {
  const row = (threadId: string, projectKey: string, day: number | null, missionId: string | null = null): ArchiveItem => ({
    threadId, projectKey, title: 'Ｒｅｐｏｒｔ', missionId,
    lastMessageAt: day ? `2026-11-${day}T10:30:00Z` : null
  })
  const items = [row('f', 'P', null), row('b', 'Q', 14), row('c', 'P', 14), row('a', 'P', 14),
    row('d', 'S', null), row('mission-1', 'R', 19, 'm1'), row('other', 'Q', 13, 'm2')]
  const all = archiveView(items, 'chat', normalizeArchiveText('Report'), [])
  expect(all.groups.map(([key, rows]) => [key, rows.map(r => r.threadId)])).toEqual([
    ['P', ['a', 'c', 'f']], ['Q', ['b']], ['S', ['d']]
  ])
  expect(all.matchingCounts).toEqual({ chat: 5, mission: 2 })
  const selected = archiveView(items, 'mission', 'mission-1', ['Q', 'R', 'empty'])
  expect(selected.matchingCounts).toEqual({ chat: 0, mission: 1 })
  expect(selected.projects.get('Q')).toBe(1)
  expect(selected.projects.get('empty')).toBe(0)
  expect(selected.projects.get('P')).toBe(0)
})
