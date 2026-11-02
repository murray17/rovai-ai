import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NavigationThreadItem, NavigationSnapshot, NavigationSnapshotRequest } from '@contracts'
import { ThreadNavigation, activateProjectNavigationRow, navigationGroupWindow, navigationPaginationControls } from './ThreadNavigation'
import { createNavigationWindowReader, navigationGroupKey, type NavigationGroupLimits } from './navigation-window-reader'

function thread(index: number, marker: NavigationThreadItem['marker'] = 'none'): NavigationThreadItem {
  return {
    id: `camp-${index}`, title: `对话 ${index}`, activationState: 'active',
    projectBindingKind: 'directory', projectPath: '/repo', defaultLead: null, marker,
    lastActivityAt: '2026-09-12T00:00:00Z', lastActivityGlobalSequence: index,
    latestCompletionGlobalSequence: 0, version: 1
  }
}

function snapshot(rows: NavigationThreadItem[], limits: NavigationGroupLimits = {}): NavigationSnapshot {
  return {
    schemaVersion: 3, throughGlobalSequence: 1,
    quickChat: {
      totalCount: rows.length,
      recentThreads: rows.slice(0, limits['quick-chat'] ?? 5).map(row => ({
        ...row, id: `quick-${row.id}`, projectBindingKind: 'quick_chat', projectPath: ''
      }))
    },
    chatBot: {
      totalCount: rows.length,
      recentThreads: rows.slice(0, limits['chat-bot'] ?? 5).map(row => ({
        ...row, id: `bot-${row.id}`, navigationGroupKey: 'chat-bot'
      }))
    },
    projects: [{
      projectKey: 'directory:/repo', projectPath: '/repo', name: 'repo',
      lastActivityAt: '', lastActivityGlobalSequence: 1, totalCount: rows.length,
      recentThreads: rows.slice(0, limits['directory:/repo'] ?? 5)
    }]
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function harness(pinnedThreadIds: string[] = []) {
  let rows = Array.from({ length: 18 }, (_, index) => thread(index + 1))
  let current: NavigationSnapshot | null = null
  let limits: NavigationGroupLimits = {}
  const read = vi.fn(async (request: NavigationSnapshotRequest) => {
    const next = snapshot(rows, request.groupLimits)
    if (request.groupKeys) {
      next.projects = next.projects.filter(group => request.groupKeys?.includes(group.projectKey))
      if (!request.groupKeys.includes('quick-chat')) next.quickChat = { totalCount: 0, recentThreads: [] }
      if (!request.groupKeys.includes('chat-bot')) next.chatBot = { totalCount: 0, recentThreads: [] }
    }
    return next
  })
  const readThreads = vi.fn(async (ids: string[]) => {
    const full = snapshot(rows, { 'quick-chat': rows.length, 'chat-bot': rows.length })
    const threads = [...rows, ...full.quickChat.recentThreads, ...full.chatBot!.recentThreads]
      .filter(row => ids.includes(row.id))
    return { throughGlobalSequence: 1, groupKeys: [...new Set(threads.map(navigationGroupKey))], threads }
  })
  const commit = vi.fn((next: NavigationSnapshot, nextLimits: NavigationGroupLimits) => {
    current = next
    limits = nextLimits
  })
  const onRows = vi.fn()
  const reader = createNavigationWindowReader(read, commit, { readThreads, getPinnedThreadIds: () => pinnedThreadIds, onRows })
  return {
    reader, read, readThreads, commit, onRows,
    visibleRows: () => current ? navigationGroupWindow(current.projects[0], limits['directory:/repo'] ?? 5, new Set(pinnedThreadIds)).threads : [],
    groupWindow: (key = 'directory:/repo') => {
      if (!current) throw new Error('No navigation snapshot')
      const group = key === 'chat-bot' ? current.chatBot! : key === 'quick-chat' ? current.quickChat : current.projects.find(project => project.projectKey === key)!
      return navigationGroupWindow(group, limits[key] ?? 5, new Set(pinnedThreadIds))
    },
    setPins: (ids: string[]) => { pinnedThreadIds = ids; return reader.refreshPins() },
    setRows: (next: NavigationThreadItem[]) => { rows = next },
    rows: () => rows,
    markup: (pinned = false) => renderToStaticMarkup(createElement(ThreadNavigation, {
      view: 'compose', state: 'ready', navigation: current, groupLimits: limits,
      activeThreadId: null, pendingMemoryCount: 0,
      pins: [
        ...pinnedThreadIds.map(targetKey => ({ kind: 'camp' as const, targetKey, pinnedAt: '' })),
        ...(pinned ? [{ kind: 'project' as const, targetKey: 'directory:/repo', pinnedAt: '' }] : [])
      ],
      onGroupLimitChange: reader.resizeGroup,
      onNewConversation() {}, onMembers() {}, onMemory() {}, onSettings() {}, onOpenProject() {},
      onThread() {}, onError() {}, async onRemoveProject() {}, async onRename() {}, async onDelete() {}
    }))
  }
}

afterEach(() => vi.useRealTimers())

describe('authoritative Thread navigation windows', () => {
  const groupMarkup = (markup: string, key: string): string => {
    const group = markup.split(`data-group="${key}">`)[1]
    expect(group).toBeDefined()
    return group.split('</section>')[0]
  }

  it('fills five unpinned rows in ordinary projects, pinned projects and Quick Chat', async () => {
    const h = harness(['camp-3', 'camp-5', 'quick-camp-3', 'quick-camp-5', 'bot-camp-3', 'bot-camp-5'])
    await h.reader.refresh('explicit')
    expect(h.visibleRows().map(row => row.id)).toEqual(['camp-1', 'camp-2', 'camp-4', 'camp-6', 'camp-7'])
    for (const pinnedProject of [false, true]) {
      const markup = h.markup(pinnedProject)
      for (const key of ['directory:/repo', 'quick-chat', 'chat-bot']) {
        const group = groupMarkup(markup, key)
        expect(group.match(/data-thread-id=/g)).toHaveLength(5)
        expect(group).toContain('查看更多')
        expect(group).not.toContain('收起')
        expect(group).not.toMatch(/data-thread-id="(?:quick-)?camp-(3|5)"/)
      }
      expect(markup.match(/data-thread-id="camp-3"/g)).toHaveLength(1)
      expect(markup.match(/data-thread-id="quick-camp-5"/g)).toHaveLength(1)
    }
    h.reader.dispose()
  })

  it.each([0, 3, 5, 6])('only shows more when unpinned rows remain (%i unpinned)', async (count) => {
    const rows = Array.from({ length: count + 4 }, (_, index) => thread(index + 1))
    const pinIds = [rows[0], rows[1], ...rows.slice(-2)].map(row => row.id)
    const h = harness([...pinIds, ...pinIds.map(id => `quick-${id}`), ...pinIds.map(id => `bot-${id}`)])
    h.setRows(rows)
    await h.reader.refresh('explicit')
    for (const pinnedProject of [false, true]) {
      const markup = h.markup(pinnedProject)
      for (const key of ['directory:/repo', 'quick-chat', 'chat-bot']) {
        const group = groupMarkup(markup, key)
        expect(group.match(/data-thread-id=/g) ?? []).toHaveLength(Math.min(count, 5))
        expect(group.includes('查看更多')).toBe(count > 5)
        expect(group).not.toContain('收起')
      }
    }
    h.reader.dispose()
  })

  it('keeps Chat Bots in their authoritative group through pinning, paging, row updates and deletion', async () => {
    const h = harness()
    await h.reader.refresh('explicit')
    const botGroup = groupMarkup(h.markup(), 'chat-bot')
    expect(botGroup).toContain('聊天 Bot')
    expect(botGroup).not.toContain('group-create-button')
    expect(botGroup).not.toContain('group-menu-trigger')
    expect(navigationGroupKey({ ...thread(1), navigationGroupKey: 'chat-bot' })).toBe('chat-bot')
    h.read.mockClear()
    await h.setPins(['bot-camp-3'])
    expect(h.read).toHaveBeenLastCalledWith({ groupKeys: ['chat-bot'], groupLimits: { 'chat-bot': 6 } })
    expect(h.groupWindow('chat-bot').threads.map(row => row.id)).toEqual(['bot-camp-1', 'bot-camp-2', 'bot-camp-4', 'bot-camp-5', 'bot-camp-6'])
    await h.reader.resizeGroup('chat-bot', 15)
    expect(h.groupWindow('chat-bot').threads).toHaveLength(15)
    h.read.mockClear()
    h.setRows(h.rows().map(row => row.id === 'camp-2' ? { ...row, title: 'Bot renamed', marker: 'loading' } : row))
    await h.reader.refreshThreads(['bot-camp-2'], 'explicit')
    expect(h.read).not.toHaveBeenCalled()
    expect(h.groupWindow('chat-bot').threads[1]).toMatchObject({ title: 'Bot renamed', marker: 'loading' })
    expect(h.visibleRows()[1].title).toBe('对话 2')
    await h.reader.resizeGroup('chat-bot', 5)
    h.setRows(h.rows().filter(row => row.id !== 'camp-1'))
    await h.reader.refreshGroups(['chat-bot'], 'explicit')
    expect(h.groupWindow('chat-bot').threads.map(row => row.id)).toEqual(['bot-camp-2', 'bot-camp-4', 'bot-camp-5', 'bot-camp-6', 'bot-camp-7'])
    expect(h.visibleRows()[0].id).toBe('camp-1')
    h.reader.dispose()
  })

  it('refills only the affected group on pin changes and counts expansion/collapse by unpinned rows', async () => {
    const h = harness()
    await h.reader.refresh('explicit')
    h.read.mockClear()
    await h.setPins(['camp-3', 'camp-5'])
    expect(h.read).toHaveBeenCalledTimes(1)
    expect(h.read).toHaveBeenLastCalledWith({ groupKeys: ['directory:/repo'], groupLimits: { 'directory:/repo': 7 } })
    expect(h.visibleRows().map(row => row.id)).toEqual(['camp-1', 'camp-2', 'camp-4', 'camp-6', 'camp-7'])
    await h.reader.resizeGroup('directory:/repo', 15)
    expect(h.visibleRows()).toHaveLength(15)
    expect(h.groupWindow().hasMore).toBe(true)
    await h.setPins(['camp-3', 'camp-5', 'camp-18'])
    expect(h.visibleRows()).toHaveLength(15)
    expect(h.groupWindow().hasMore).toBe(false)
    expect(groupMarkup(h.markup(), 'directory:/repo')).toContain('收起')
    await h.reader.resizeGroup('directory:/repo', 5)
    expect(h.visibleRows()).toHaveLength(5)
    expect(groupMarkup(h.markup(), 'directory:/repo')).not.toContain('收起')
    await h.setPins([])
    expect(h.visibleRows().map(row => row.id)).toEqual(['camp-1', 'camp-2', 'camp-3', 'camp-4', 'camp-5'])
    h.reader.dispose()
  })

  it('fences an expansion whose pin membership changes while the read is in flight', async () => {
    const h = harness(['camp-3', 'camp-5'])
    await h.reader.refresh('explicit')
    const old = deferred<NavigationSnapshot>()
    h.read.mockImplementationOnce(() => old.promise)
    h.commit.mockClear()
    const expanding = h.reader.resizeGroup('directory:/repo', 15)
    const pinning = h.setPins(['camp-1', 'camp-3', 'camp-5'])
    old.resolve(snapshot(h.rows(), { 'directory:/repo': 17 }))
    await Promise.all([expanding, pinning])
    expect(h.visibleRows()).toHaveLength(15)
    expect(h.visibleRows().map(row => row.id)).not.toContain('camp-1')
    expect(h.groupWindow().hasMore).toBe(false)
    for (const [next, limits] of h.commit.mock.calls) {
      expect(navigationGroupWindow(next.projects[0], limits['directory:/repo'] ?? 5,
        new Set(['camp-1', 'camp-3', 'camp-5'])).threads).toHaveLength(15)
    }
    h.reader.dispose()
  })

  it('does not publish a short discovered project when its pin refill fails; recovery retries the full window', async () => {
    const h = harness(['camp-3', 'camp-5'])
    h.read.mockResolvedValueOnce(snapshot(h.rows()))
    h.read.mockRejectedValueOnce(new Error('refill failed'))
    await expect(h.reader.refresh('explicit')).rejects.toThrow('refill failed')
    expect(h.commit).not.toHaveBeenCalled()
    await h.reader.refresh('foreground')
    expect(h.visibleRows()).toHaveLength(5)
    h.reader.dispose()
  })

  it('immediately reads the full prefix, keeping five visible until the sixth Thread is fresh', async () => {
    const h = harness()
    h.setRows(h.rows().map(row => ({ ...row, marker: 'loading' })))
    await h.reader.refresh('explicit')
    const next = deferred<NavigationSnapshot>()
    h.read.mockImplementationOnce(() => next.promise)
    h.setRows(h.rows().map(row => ({ ...row, marker: 'none' })))
    const expanding = h.reader.resizeGroup('directory:/repo', 15)
    expect(h.read).toHaveBeenLastCalledWith({ groupKeys: ['directory:/repo'], groupLimits: { 'directory:/repo': 15 } })
    expect(h.visibleRows()).toHaveLength(5)
    next.resolve(snapshot(h.rows(), { 'directory:/repo': 15 }))
    await expanding
    expect(h.visibleRows()).toHaveLength(15)
    expect(h.visibleRows()[5].marker).toBe('none')
    expect(h.visibleRows().every(row => row.marker === 'none')).toBe(true)
    // The unrelated Quick Chat group retains its previous loading state.
    expect(h.markup()).toContain('camp-marker-loading')
    expect(h.markup(true)).toContain('对话 15')
    h.reader.dispose()
  })

  it('never resurrects loading when a notified terminal falls out of the recent five; polls replace all fields', async () => {
    vi.useFakeTimers()
    const h = harness()
    h.setRows([thread(1, 'loading'), ...h.rows().slice(1)])
    await h.reader.resizeGroup('directory:/repo', 15)
    h.setRows(h.rows().map(row => ({ ...row, marker: 'unread_completed' })))
    const notified = h.reader.refresh('invalidation')
    await vi.advanceTimersByTimeAsync(80)
    await notified
    expect(h.visibleRows()[0].marker).toBe('unread_completed')
    // Missed events: completion/read acknowledgements, rename, deletion and reorder.
    h.setRows([
      ...h.rows().slice(2, 8), { ...thread(1), title: '新的名称' }, ...h.rows().slice(8)
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
    expect(h.read).toHaveBeenLastCalledWith({ groupKeys: ['quick-chat'], groupLimits: { 'directory:/repo': 15, 'quick-chat': 15 } })
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
    expect(navigationPaginationControls(18, false)).toEqual({ showMore: false, showCollapse: true })
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
    expect(h.read).toHaveBeenLastCalledWith({ groupKeys: ['directory:/repo'], groupLimits: { 'directory:/repo': 5 } })
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

  it('switches and completes by row, coalesces known groups, and fills a deleted slot', async () => {
    vi.useFakeTimers()
    const h = harness(['camp-18'])
    await h.reader.refresh('explicit')
    expect(h.readThreads).toHaveBeenLastCalledWith(['camp-18'])
    h.read.mockClear()
    h.readThreads.mockClear()
    h.setRows(h.rows().map(row => row.id === 'camp-2' ? { ...row, marker: 'unread_completed' } : row))
    const switched = h.reader.refreshThreads(['camp-1'], 'explicit')
    const completed = h.reader.invalidate({ scope: 'camp', threadId: 'camp-2' })
    await Promise.all([switched, completed])
    expect(h.read).not.toHaveBeenCalled()
    expect(h.readThreads.mock.calls.flatMap(([ids]) => ids)).toEqual(['camp-1', 'camp-2'])
    expect(h.visibleRows().find(row => row.id === 'camp-2')?.marker).toBe('unread_completed')
    h.setRows(h.rows().filter(row => row.id !== 'camp-1'))
    const deletion = h.reader.invalidate({ scope: 'group', groupKeys: ['directory:/repo'] })
    h.reader.invalidate({ scope: 'group', groupKeys: ['directory:/repo'] })
    await vi.advanceTimersByTimeAsync(80)
    await deletion
    expect(h.read).toHaveBeenCalledTimes(1)
    expect(h.read).toHaveBeenLastCalledWith({ groupKeys: ['directory:/repo'], groupLimits: { 'directory:/repo': 6 } })
    expect(h.visibleRows().map(row => row.id)).toEqual(['camp-2', 'camp-3', 'camp-4', 'camp-5', 'camp-6'])
    // A simultaneous status notification must not expand a different group's read.
    h.read.mockClear()
    const reordered = h.reader.invalidate({ scope: 'group', threadId: 'camp-2' })
    const quickStatus = h.reader.invalidate({ scope: 'camp', threadId: 'quick-camp-1' })
    await vi.advanceTimersByTimeAsync(80)
    await Promise.all([reordered, quickStatus])
    expect(h.read).toHaveBeenCalledTimes(1)
    expect(h.read).toHaveBeenLastCalledWith({ groupKeys: ['directory:/repo'], groupLimits: { 'directory:/repo': 6 } })
    expect(h.readThreads).toHaveBeenLastCalledWith(['quick-camp-1'])
    await h.reader.refresh('foreground')
    expect(h.readThreads).toHaveBeenLastCalledWith(['camp-18'])
    h.reader.dispose()
  })

  it('does not let an in-flight snapshot undo an authoritative read acknowledgement', async () => {
    const h = harness()
    await h.reader.refresh('explicit')
    const old = deferred<NavigationSnapshot>()
    h.read.mockImplementationOnce(() => old.promise)
    const refresh = h.reader.refresh('explicit')
    h.reader.acceptRows({ throughGlobalSequence: 1, groupKeys: ['directory:/repo'], threads: [{ ...thread(1), lastSeenGlobalSequence: 1 }] })
    h.setRows([{ ...thread(1), lastSeenGlobalSequence: 1 }, ...h.rows().slice(1)])
    old.resolve(snapshot([{ ...thread(1), marker: 'unread_completed' }, ...h.rows().slice(1)]))
    await refresh
    expect(h.visibleRows()[0]).toMatchObject({ marker: 'none', lastSeenGlobalSequence: 1 })
    h.reader.dispose()
  })

  it('accepts B read acknowledgement after a newer C row while rejecting stale B results', async () => {
    const h = harness()
    const unreadB = { ...thread(1, 'unread_completed'), latestCompletionGlobalSequence: 90, lastSeenGlobalSequence: 0 }
    h.setRows([unreadB, ...h.rows().slice(1)])
    h.read.mockImplementationOnce(async () => ({ ...snapshot(h.rows()), throughGlobalSequence: 100 }))
    await h.reader.refresh('explicit')

    h.reader.acceptRows({
      throughGlobalSequence: 102, groupKeys: ['directory:/repo'],
      threads: [{ ...thread(2), title: 'C 已更新' }]
    })
    const readB = { ...unreadB, marker: 'none' as const, lastSeenGlobalSequence: 100 }
    h.reader.acceptRows({
      throughGlobalSequence: 101, groupKeys: ['directory:/repo'], threads: [readB, thread(2)]
    })
    expect(h.visibleRows()[0]).toMatchObject({ id: 'camp-1', marker: 'none', lastSeenGlobalSequence: 100 })
    expect(h.visibleRows()[1].title).toBe('C 已更新')
    expect(h.commit.mock.lastCall?.[0].throughGlobalSequence).toBe(102)
    expect(h.onRows.mock.lastCall?.[1]).toEqual(['camp-1'])

    h.reader.acceptRows({
      throughGlobalSequence: 100, groupKeys: ['directory:/repo'], threads: [unreadB]
    })
    h.reader.acceptRows({
      throughGlobalSequence: 101, groupKeys: ['directory:/repo'], threads: [unreadB]
    })
    expect(h.visibleRows()[0].marker).toBe('none')
    expect(h.onRows.mock.lastCall?.[1]).toEqual(['camp-1'])
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
    expect(navigationPaginationControls(5, true)).toEqual({ showMore: true, showCollapse: false })
    expect(navigationPaginationControls(15, true)).toEqual({ showMore: true, showCollapse: true })
    expect(navigationPaginationControls(5, false)).toEqual({ showMore: false, showCollapse: false })
    expect(navigationPaginationControls(0, false)).toEqual({ showMore: false, showCollapse: false })
  })
})
