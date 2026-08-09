import { describe, expect, it } from 'vitest'
import type { NavigationCampItem, NavigationCampPage } from '@contracts'
import {
  NAVIGATION_INITIAL_VISIBLE_CAMPS,
  activateProjectNavigationRow,
  appendUniqueNavigationCamps,
  collapseNavigationGroupPagination,
  navigationGroupPagination,
  navigationPaginationControls,
  removeNavigationCampFromPagination,
  revealMoreNavigationCamps
} from './CampNavigation'

function camp(index: number): NavigationCampItem {
  return {
    id: `camp-${index}`,
    title: `对话 ${index}`,
    activationState: 'active',
    projectBindingKind: 'directory',
    projectPath: '/repo',
    defaultLead: null,
    marker: 'none',
    lastActivityAt: `2026-08-09T00:00:${String(index).padStart(2, '0')}Z`,
    lastActivityGlobalSequence: index,
    latestCompletionGlobalSequence: 0,
    version: 1
  }
}

function page(camps: NavigationCampItem[], totalCount: number, nextOffset: number | null): NavigationCampPage {
  return {
    schemaVersion: 3,
    throughGlobalSequence: 1,
    projectPath: '/repo',
    totalCount,
    nextOffset,
    camps
  }
}

describe('Camp navigation pagination', () => {
  it('starts from the five Camps supplied by the Navigation Snapshot', () => {
    const state = navigationGroupPagination(Array.from({ length: 5 }, (_, index) => camp(index + 1)), 18)

    expect(state.visibleCount).toBe(NAVIGATION_INITIAL_VISIBLE_CAMPS)
    expect(state.serverOffset).toBe(5)
    expect(state.camps).toHaveLength(5)
    expect(navigationPaginationControls(state.visibleCount, 18)).toEqual({
      showMore: true,
      showCollapse: false
    })
  })

  it('loads ten Camps at a time with monotonically increasing server offsets', async () => {
    const requests: Array<{ offset: number; limit: number }> = []
    let state = navigationGroupPagination(Array.from({ length: 5 }, (_, index) => camp(index + 1)), 18)

    state = await revealMoreNavigationCamps(state, 18, async (offset, limit) => {
      requests.push({ offset, limit })
      return page(Array.from({ length: 10 }, (_, index) => camp(index + 6)), 18, 15)
    })
    expect(requests).toEqual([{ offset: 5, limit: 10 }])
    expect(state.visibleCount).toBe(15)
    expect(state.camps).toHaveLength(15)
    expect(navigationPaginationControls(state.visibleCount, 18)).toEqual({
      showMore: true,
      showCollapse: true
    })

    state = await revealMoreNavigationCamps(state, 18, async (offset, limit) => {
      requests.push({ offset, limit })
      return page(Array.from({ length: 3 }, (_, index) => camp(index + 16)), 18, null)
    })
    expect(requests).toEqual([
      { offset: 5, limit: 10 },
      { offset: 15, limit: 10 }
    ])
    expect(state.visibleCount).toBe(18)
    expect(navigationPaginationControls(state.visibleCount, 18)).toEqual({
      showMore: false,
      showCollapse: true
    })
  })

  it('deduplicates appended pages by Camp ID without disturbing the existing order', () => {
    const merged = appendUniqueNavigationCamps(
      [camp(1), camp(2), camp(3)],
      [camp(3), camp(4), camp(2), camp(5)]
    )
    expect(merged.map((item) => item.id)).toEqual(['camp-1', 'camp-2', 'camp-3', 'camp-4', 'camp-5'])
  })

  it('collapses to five while retaining the cache and restores from it without another request', async () => {
    const expanded = {
      camps: Array.from({ length: 15 }, (_, index) => camp(index + 1)),
      visibleCount: 15,
      serverOffset: 15
    }
    const collapsed = collapseNavigationGroupPagination(expanded, 18)
    let requested = false
    const restored = await revealMoreNavigationCamps(collapsed, 18, async () => {
      requested = true
      throw new Error('The retained cache should satisfy this expansion')
    })

    expect(collapsed.visibleCount).toBe(5)
    expect(collapsed.camps).toHaveLength(15)
    expect(restored.visibleCount).toBe(15)
    expect(requested).toBe(false)
  })

  it('leaves the existing state untouched when the next page request fails', async () => {
    const state = navigationGroupPagination(Array.from({ length: 5 }, (_, index) => camp(index + 1)), 18)

    await expect(revealMoreNavigationCamps(state, 18, async () => {
      throw new Error('temporary Core failure')
    })).rejects.toThrow('temporary Core failure')
    expect(state).toEqual({
      camps: Array.from({ length: 5 }, (_, index) => camp(index + 1)),
      visibleCount: 5,
      serverOffset: 5
    })
  })

  it('evicts a deleted Camp from retained pages and rewinds the server offset', () => {
    const state = {
      camps: Array.from({ length: 15 }, (_, index) => camp(index + 1)),
      visibleCount: 15,
      serverOffset: 15
    }
    const next = removeNavigationCampFromPagination(state, 'camp-7')

    expect(next.camps.map((item) => item.id)).not.toContain('camp-7')
    expect(next.camps).toHaveLength(14)
    expect(next.visibleCount).toBe(14)
    expect(next.serverOffset).toBe(14)
    expect(removeNavigationCampFromPagination(next, 'missing')).toBe(next)
  })

  it('uses the same pagination state shape for ordinary, pinned, and Quick Chat groups', () => {
    const sharedState = navigationGroupPagination(Array.from({ length: 5 }, (_, index) => camp(index + 1)), 18)
    const byCanonicalGroupKey = {
      'directory:/repo': sharedState,
      'quick-chat': sharedState
    }

    expect(byCanonicalGroupKey['directory:/repo']).toBe(sharedState)
    expect(byCanonicalGroupKey['quick-chat']).toBe(sharedState)
    expect(Object.keys(byCanonicalGroupKey)).not.toContain('pinned-directory:/repo')
  })

  it('selects the project before toggling the whole-row disclosure', () => {
    const calls: string[] = []
    activateProjectNavigationRow(
      () => calls.push('select'),
      () => calls.push('toggle')
    )
    expect(calls).toEqual(['select', 'toggle'])
  })

  it('hides both controls when no more than five Camps exist', () => {
    expect(navigationPaginationControls(5, 5)).toEqual({ showMore: false, showCollapse: false })
    expect(navigationPaginationControls(0, 0)).toEqual({ showMore: false, showCollapse: false })
  })
})
