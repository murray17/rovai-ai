import { describe, expect, it } from 'vitest'
import type { AutomationView } from '@contracts'
import { changeAutomationList, emptyAutomationList } from './automation-list'
import { automationPlanState, defaultDraft } from './automation-workspace-model'

function task(id: string, overrides: Partial<AutomationView> = {}): AutomationView {
  return { ...defaultDraft('member'), automationId: id, name: id, version: 1, enabled: true, nextRunAt: null,
    lastRun: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...overrides }
}
const work = task('work')
const later = '2026-02-02T00:00:00Z'
const paused = task('paused', { enabled: false })
const manual = task('manual', { schedule: { kind: 'manual' } })
const initial = changeAutomationList(emptyAutomationList(), { type: 'loaded', tasks: [work, paused, manual] })

describe('scheduled task list membership', () => {
  it('preserves the current rows as definitions change in either direction', () => {
    const closed = changeAutomationList(initial, { type: 'criteria', filter: 'closed', query: '' })
    const tasks = [task('work', { enabled: false, updatedAt: later }), task('paused', { enabled: true }), manual]
    const refreshed = changeAutomationList(closed, { type: 'loaded', tasks })
    expect(refreshed.visibleIds).toEqual(['paused'])
    expect(refreshed.records.get('paused')?.enabled).toBe(true)
    const all = changeAutomationList(refreshed, { type: 'criteria', filter: 'all', query: '' })
    expect(changeAutomationList(all, { type: 'criteria', filter: 'closed', query: '' }).visibleIds).toEqual(['work'])
  })

  it('uses the receipt for the next sort even before a new list response, breaking ties by descending ID', () => {
    const saved = changeAutomationList(initial, { type: 'saved', task: { ...paused, version: 2, enabled: true, updatedAt: later } })
    expect(saved.visibleIds).toEqual(initial.visibleIds)
    expect(changeAutomationList(saved, { type: 'criteria', filter: 'enabled', query: '' }).visibleIds).toEqual(['paused', 'work'])
    const old = changeAutomationList(saved, { type: 'saved', task: paused })
    expect(old.records.get('paused')?.enabled).toBe(true)
    expect(initial.visibleIds).toEqual(['work', 'paused', 'manual'])
  })

  it('prepends new definitions outside the search once and removes deleted definitions immediately', () => {
    const search = changeAutomationList(initial, { type: 'criteria', filter: 'enabled', query: 'work' })
    const created = task('other', { schedule: { kind: 'manual' }, updatedAt: later })
    const receipt = changeAutomationList(search, { type: 'created', task: created })
    expect(receipt.visibleIds).toEqual(['other', 'work'])
    const refreshed = changeAutomationList(receipt, { type: 'loaded', tasks: [created, work, paused, manual] })
    expect(refreshed.visibleIds).toEqual(receipt.visibleIds)
    const removed = changeAutomationList(refreshed, { type: 'deleted', id: 'work' })
    expect(removed.visibleIds).toEqual(['other'])
    expect(changeAutomationList(removed, { type: 'saved', task: work }).records.has('work')).toBe(false)
    expect(changeAutomationList(removed, { type: 'criteria', filter: 'enabled', query: '' }).visibleIds).toEqual([])
  })

  it('handles external creation before its receipt and a creation during the initial read', () => {
    const closed = changeAutomationList(initial, { type: 'criteria', filter: 'closed', query: '' })
    const created = task('other')
    const external = changeAutomationList(closed, { type: 'loaded', tasks: [created, work, manual] })
    expect(external.visibleIds).toEqual(['other'])
    expect(changeAutomationList(external, { type: 'created', task: created }).visibleIds).toEqual(['other'])
    const starting = changeAutomationList(emptyAutomationList(), { type: 'criteria', filter: 'closed', query: '' })
    const beforeRead = changeAutomationList(starting, { type: 'created', task: created })
    expect(changeAutomationList(beforeRead, { type: 'loaded', tasks: [created, work, paused] }).visibleIds).toEqual(['other', 'paused'])
  })

  it('keeps manual tasks out of both automatic filters and distinguishes ended from paused once schedules', () => {
    for (const enabled of [true, false]) {
      const all = changeAutomationList(emptyAutomationList(), { type: 'loaded', tasks: [{ ...manual, enabled }] })
      for (const filter of ['enabled', 'closed'] as const) {
        expect(changeAutomationList(all, { type: 'criteria', filter, query: '' }).visibleIds).toEqual([])
      }
    }
    const once = task('once', { schedule: { kind: 'once', date: '2000-01-01', at: '12:30' }, enabled: false })
    expect(automationPlanState(once)).toBe('ended')
    expect(automationPlanState({ ...once, schedule: { kind: 'once', date: '2099-01-01', at: '12:30' } })).toBe('scheduled')
    expect(automationPlanState(manual)).toBe('manual')
  })
})
