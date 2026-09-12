import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NavigationCampItem, NavigationSnapshot, NavigationSnapshotRequest } from '@contracts'
import { CampNavigation, activateProjectNavigationRow, navigationPaginationControls } from './CampNavigation'
import { createNavigationWindowReader, type NavigationGroupLimits } from './navigation-window-reader'

function camp(index: number, marker: NavigationCampItem['marker'] = 'none'): NavigationCampItem {
  return {
    id: `camp-${index}`, title: `对话 ${index}`, activationState: 'active',
    projectBindingKind: 'directory', projectPath: '/repo', defaultLead: null, marker,
    lastActivityAt: '2026-09-12T00:00:00Z', lastActivityGlobalSequence: index,
    latestCompletionGlobalSequence: 0, version: 1
  }
}

function snapshot(rows: NavigationCampItem[], limits: NavigationGroupLimits = {}): NavigationSnapshot {
  return {
    schemaVersion: 3, throughGlobalSequence: 1,
    quickChat: {
      totalCount: rows.length,
      recentCamps: rows.slice(0, limits['quick-chat'] ?? 5).map(row => ({
        ...row, id: `quick-${row.id}`, projectBindingKind: 'quick_chat', projectPath: ''
      }))
    },
    projects: [{
      projectKey: 'directory:/repo', projectPath: '/repo', name: 'repo',
      lastActivityAt: '', lastActivityGlobalSequence: 1, totalCount: rows.length,
      recentCamps: rows.slice(0, limits['directory:/repo'] ?? 5)
    }]
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function harness() {
  let rows = Array.from({ length: 18 }, (_, index) => camp(index + 1))
  let current: NavigationSnapshot | null = null
  let limits: NavigationGroupLimits = {}
  const read = vi.fn(async (request: NavigationSnapshotRequest) => snapshot(rows, request.groupLimits))
  const commit = vi.fn((next: NavigationSnapshot, nextLimits: NavigationGroupLimits) => {
    current = next
    limits = nextLimits
  })
  const reader = createNavigationWindowReader(read, commit)
  return {
    reader, read, commit,
    visibleRows: () => current?.projects[0].recentCamps.slice(0, limits['directory:/repo'] ?? 5) ?? [],
    setRows: (next: NavigationCampItem[]) => { rows = next },
    rows: () => rows,
    markup: (pinned = false) => renderToStaticMarkup(createElement(CampNavigation, {
      view: 'compose', state: 'ready', navigation: current, groupLimits: limits,
      activeCampId: null, pendingMemoryCount: 0,
      pins: pinned ? [{ kind: 'project', targetKey: 'directory:/repo', pinnedAt: '' }] : [],
      onGroupLimitChange: reader.resizeGroup,
      onNewConversation() {}, onMembers() {}, onMemory() {}, onSettings() {}, onOpenProject() {},
      onCamp() {}, onError() {}, async onRemoveProject() {}, async onRename() {}, async onDelete() {}
    }))
  }
}

afterEach(() => vi.useRealTimers())

describe('authoritative Camp navigation windows', () => {
  it('immediately reads the full prefix, keeping five visible until the sixth Camp is fresh', async () => {
    const h = harness()
    h.setRows(h.rows().map(row => ({ ...row, marker: 'loading' })))
    await h.reader.refresh('explicit')
    const next = deferred<NavigationSnapshot>()
    h.read.mockImplementationOnce(() => next.promise)
    h.setRows(h.rows().map(row => ({ ...row, marker: 'none' })))
    const expanding = h.reader.resizeGroup('directory:/repo', 15)
    expect(h.read).toHaveBeenLastCalledWith({ groupLimits: { 'directory:/repo': 15 } })
    expect(h.visibleRows()).toHaveLength(5)
    next.resolve(snapshot(h.rows(), { 'directory:/repo': 15 }))
    await expanding
    expect(h.visibleRows()).toHaveLength(15)
    expect(h.visibleRows()[5].marker).toBe('none')
    expect(h.markup()).not.toContain('camp-marker-loading')
    expect(h.markup(true)).toContain('对话 15')
    h.reader.dispose()
  })

  it('never resurrects loading when a notified terminal falls out of the recent five; polls replace all fields', async () => {
    vi.useFakeTimers()
    const h = harness()
    h.setRows([camp(1, 'loading'), ...h.rows().slice(1)])
    await h.reader.resizeGroup('directory:/repo', 15)
    h.setRows(h.rows().map(row => ({ ...row, marker: 'unread_completed' })))
    const notified = h.reader.refresh('invalidation')
    await vi.advanceTimersByTimeAsync(80)
    await notified
    expect(h.visibleRows()[0].marker).toBe('unread_completed')
    // Missed events: completion/read acknowledgements, rename, deletion and reorder.
    h.setRows([
      ...h.rows().slice(2, 8), { ...camp(1), title: '新的名称' }, ...h.rows().slice(8)
    ].map(row => ({ ...row, marker: 'none' })))
    const polled = h.reader.refresh('poll')
    await vi.advanceTimersByTimeAsync(80)
    await polled
    expect(h.visibleRows()).toEqual(h.rows().slice(0, 15))
    expect(h.visibleRows()[6]).toMatchObject({ id: 'camp-1', title: '新的名称', marker: 'none' })
    expect(h.visibleRows().map(row => row.id)).not.toContain('camp-2')
    expect(h.markup()).not.toMatch(/camp-marker-(loading|unread_completed)/)
    h.reader.dispose()
  })

  it('collapses immediately and re-reads every expansion, including Quick Chat and a short final window', async () => {
    const h = harness()
    await h.reader.resizeGroup('directory:/repo', 15)
    await h.reader.resizeGroup('quick-chat', 15)
    expect(h.read).toHaveBeenLastCalledWith({ groupLimits: { 'directory:/repo': 15, 'quick-chat': 15 } })
    const shrinking = h.reader.resizeGroup('directory:/repo', 5)
    expect(h.visibleRows()).toHaveLength(5)
    await shrinking
    h.setRows(h.rows().map(row => ({ ...row, title: `新 ${row.title}` })))
    const before = h.read.mock.calls.length
    await h.reader.resizeGroup('directory:/repo', 15)
    expect(h.read).toHaveBeenCalledTimes(before + 1)
    expect(h.visibleRows()[5].title).toBe('新 对话 6')
    await h.reader.resizeGroup('directory:/repo', 25)
    expect(h.visibleRows()).toHaveLength(18)
    expect(navigationPaginationControls(18, 18)).toEqual({ showMore: false, showCollapse: true })
    h.reader.dispose()
  })

  it('fences an in-flight five-row response and drains the newest window before resolving', async () => {
    const h = harness()
    await h.reader.refresh('explicit')
    const old = deferred<NavigationSnapshot>()
    h.read.mockImplementationOnce(() => old.promise)
    const refresh = h.reader.refresh('explicit')
    const expanding = h.reader.resizeGroup('directory:/repo', 15)
    expect(h.read).toHaveBeenCalledTimes(2)
    old.resolve(snapshot(h.rows().map(row => ({ ...row, marker: 'loading' }))))
    await Promise.all([refresh, expanding])
    expect(h.commit).toHaveBeenCalledTimes(2)
    expect(h.visibleRows()).toHaveLength(15)
    expect(h.visibleRows().every(row => row.marker === 'none')).toBe(true)
    h.reader.dispose()
  })

  it('fences a pending expansion after collapse, including obsolete failures', async () => {
    for (const fail of [false, true]) {
      const h = harness()
      await h.reader.resizeGroup('directory:/repo', 15)
      const old = deferred<NavigationSnapshot>()
      h.read.mockImplementationOnce(() => old.promise)
      const expanding = h.reader.resizeGroup('directory:/repo', 25)
      const collapsing = h.reader.resizeGroup('directory:/repo', 5)
      expect(h.visibleRows()).toHaveLength(5)
      if (fail) old.reject(new Error('obsolete request failed'))
      else old.resolve(snapshot(h.rows(), { 'directory:/repo': 25 }))
      await Promise.all([expanding, collapsing])
      expect(h.visibleRows()).toHaveLength(5)
      expect(h.commit.mock.calls.every(([, limits]) => limits['directory:/repo'] !== 25)).toBe(true)
      h.reader.dispose()
    }
  })

  it('keeps the visible window on failure, retries freshness without surprise expansion, and allows manual retry', async () => {
    vi.useFakeTimers()
    const h = harness()
    await h.reader.refresh('explicit')
    h.read.mockRejectedValueOnce(new Error('temporary Core failure'))
    await expect(h.reader.resizeGroup('directory:/repo', 15)).rejects.toThrow('temporary Core failure')
    expect(h.visibleRows()).toHaveLength(5)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(h.read).toHaveBeenLastCalledWith({ groupLimits: { 'directory:/repo': 5 } })
    expect(h.visibleRows()).toHaveLength(5)
    await h.reader.resizeGroup('directory:/repo', 15)
    expect(h.visibleRows()).toHaveLength(15)
    h.reader.dispose()
  })

  it('coalesces simultaneous groups and preserves their canonical windows on foreground refresh', async () => {
    const h = harness()
    await Promise.all([
      h.reader.resizeGroup('directory:/repo', 15),
      h.reader.resizeGroup('quick-chat', 15)
    ])
    await h.reader.refresh('foreground')
    expect(h.read).toHaveBeenLastCalledWith({ groupLimits: { 'directory:/repo': 15, 'quick-chat': 15 } })
    expect(h.markup(true)).toContain('对话 15')
    expect(h.markup()).toContain('对话 15')
    h.reader.dispose()
  })

  it('does not commit a late response after disposal', async () => {
    const h = harness()
    const late = deferred<NavigationSnapshot>()
    h.read.mockImplementationOnce(() => late.promise)
    const loading = h.reader.refresh('explicit')
    h.reader.dispose()
    late.resolve(snapshot(h.rows()))
    await loading
    await Promise.resolve()
    expect(h.commit).not.toHaveBeenCalled()
  })

  it('selects before disclosure and shows only applicable pagination controls', () => {
    const calls: string[] = []
    activateProjectNavigationRow(() => calls.push('select'), () => calls.push('toggle'))
    expect(calls).toEqual(['select', 'toggle'])
    expect(navigationPaginationControls(5, 18)).toEqual({ showMore: true, showCollapse: false })
    expect(navigationPaginationControls(15, 18)).toEqual({ showMore: true, showCollapse: true })
    expect(navigationPaginationControls(5, 5)).toEqual({ showMore: false, showCollapse: false })
    expect(navigationPaginationControls(0, 0)).toEqual({ showMore: false, showCollapse: false })
  })
})
