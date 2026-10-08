import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadMessageAroundSnapshot, ThreadMessageView, ThreadUserAnchorIndex, ThreadUserAnchorPreview } from '@contracts'
import type { ThreadClient } from './camp-client'
import { mergeNavigationMessages, ThreadUserAnchorNavigation } from './thread-user-anchor-navigation'
const threadId = 'thread-fixture'
function message(id: string, sequence: number, patch: Partial<ThreadMessageView> = {}): ThreadMessageView {
  return { id, sequence, authorType: 'user', authorId: 'local_user', body: id, content: [], attachments: [], quotes: [],
    addressMode: 'default', addressedAgentIds: [], sourceAgentRunId: null, replyToThreadMessageId: null,
    threadTurnId: null, timelineGlobalSequence: null, presentation: null, withdrawn: false, canWithdraw: false,
    version: 1, createdAt: '2026-10-01T00:00:00Z', ...patch }
}
const index = (sequence = 10, ids = ['old', 'latest']): ThreadUserAnchorIndex => ({ schemaVersion: 1, threadId,
  throughGlobalSequence: sequence, totalCount: ids.length, items: ids.map((id, n) => ({ messageId: id, sequence: n + 1, title: id, messageVersion: 1 })) })
const windowAt = (id: string, sequence = 10): ThreadMessageAroundSnapshot => ({ schemaVersion: 1, threadId,
  throughGlobalSequence: sequence, anchorMessageId: id, sourceAvailable: true, messages: [message(id, 1)], nextMessageSequence: 2 })
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { resolve, reject, promise }
}
afterEach(() => vi.useRealTimers())

describe('Thread user navigation owns asynchronous identity, never body pagination', () => {
  it('coalesces relevant invalidations and rejects a stale index while preserving confirmed public inputs', async () => {
    vi.useFakeTimers()
    const stale = deferred<ThreadUserAnchorIndex>()
    const request = vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValue(index(20, ['latest', 'confirmed']))
    const navigation = new ThreadUserAnchorNavigation(threadId, { request } as unknown as ThreadClient)
    const stop = navigation.start()
    navigation.observe([], [message('confirmed', 30)], value => value.body)
    expect(navigation.getSnapshot().anchors.map(anchor => anchor.id)).toEqual(['confirmed'])
    navigation.changed({ threadId: 'other', indexChanged: true, throughGlobalSequence: 99 })
    navigation.changed({ threadId, indexChanged: true, throughGlobalSequence: 20 })
    navigation.changed({ threadId, indexChanged: true, throughGlobalSequence: 20 })
    stale.resolve(index())
    await Promise.resolve()
    expect(navigation.getSnapshot().index).toBeNull()
    await vi.advanceTimersByTimeAsync(100)
    expect(request).toHaveBeenCalledTimes(2)
    expect(navigation.getSnapshot().anchors.map(anchor => anchor.id)).toEqual(['latest', 'confirmed'])
    navigation.changed({ threadId, indexChanged: false, throughGlobalSequence: 21 })
    await vi.advanceTimersByTimeAsync(200)
    expect(request).toHaveBeenCalledTimes(2)
    stop()
  })

  it('keeps receipt caches across Thread switches and removes a withdrawn receipt before directory takeover', async () => {
    vi.useFakeTimers()
    const cached = index(10, ['old'])
    const request = vi.fn().mockResolvedValueOnce(cached)
    const navigation = new ThreadUserAnchorNavigation(threadId, { request } as unknown as ThreadClient)
    const stop = navigation.start(); await navigation.refresh()
    const receipts = [message('withdrawn', 2), message('kept', 3)]
    navigation.observe([], receipts, value => value.body)
    const anchors = navigation.getSnapshot().anchors
    stop()
    expect(navigation.getSnapshot().index).toBe(cached)
    expect(navigation.getSnapshot().anchors).toBe(anchors)
    await vi.advanceTimersByTimeAsync(200)
    expect(request).toHaveBeenCalledTimes(1)

    // Returning body arrives before start(), while the send receipt can still be stale.
    navigation.observe([message('withdrawn', 2, { version: 2, withdrawn: true })], receipts, value => value.body)
    expect(navigation.getSnapshot().anchors.map(anchor => anchor.id)).toEqual(['old', 'kept'])
    request.mockResolvedValueOnce(index(20, ['old', 'kept']))
    const stopAgain = navigation.start(); await navigation.refresh()
    navigation.observe([], receipts, value => value.body)
    await vi.advanceTimersByTimeAsync(200)
    expect(navigation.getSnapshot().anchors.map(anchor => anchor.id)).toEqual(['old', 'kept'])
    expect(request).toHaveBeenCalledTimes(2)
    await expect(navigation.locate('withdrawn', new Map([['withdrawn', receipts[0]]]))).rejects.toThrow('不可用')
    expect(request).toHaveBeenCalledTimes(2)
    stopAgain()
  })

  it('removes only unavailable receipts on a message change and prevents stale receipts from returning', async () => {
    vi.useFakeTimers()
    const request = vi.fn().mockResolvedValueOnce(index(10, ['old'])).mockResolvedValue(index(20, ['old', 'kept']))
    const navigation = new ThreadUserAnchorNavigation(threadId, { request } as unknown as ThreadClient)
    const stop = navigation.start(); await navigation.refresh()
    const receipts = [message('deleted', 2), message('kept', 3)]
    navigation.observe([], receipts, value => value.body)
    navigation.changed({ threadId, indexChanged: true, throughGlobalSequence: 20, unavailableMessageIds: ['deleted'] })
    expect(navigation.getSnapshot().anchors.map(anchor => anchor.id)).toEqual(['old', 'kept'])
    navigation.observe([], receipts, value => value.body)
    await vi.advanceTimersByTimeAsync(100)
    expect(request).toHaveBeenCalledTimes(2)
    expect(navigation.getSnapshot().anchors.map(anchor => anchor.id)).toEqual(['old', 'kept'])
    stop()
  })

  it('only lets a successful authoritative directory retire pre-request receipts, preserving preview caches', async () => {
    vi.useFakeTimers()
    const preview: ThreadUserAnchorPreview = { schemaVersion: 1, threadId, messageId: 'old',
      throughGlobalSequence: 10, sourceAvailable: true, firstReply: null }
    const request = vi.fn().mockResolvedValueOnce(index(10, ['old'])).mockResolvedValueOnce(preview)
      .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(index(20, ['old', 'kept']))
    const navigation = new ThreadUserAnchorNavigation(threadId, { request } as unknown as ThreadClient)
    const stop = navigation.start(); await navigation.refresh()
    await navigation.readPreview('old')
    const previews = navigation.getSnapshot().previews
    const receipts = [message('missing', 2), message('kept', 3)]
    navigation.observe([], receipts, value => value.body)
    await navigation.refresh()
    expect(navigation.getSnapshot().status).toBe('error')
    expect(navigation.getSnapshot().anchors.map(anchor => anchor.id)).toEqual(['old', 'missing', 'kept'])
    await navigation.refresh()
    expect(navigation.getSnapshot().status).toBe('ready')
    expect(navigation.getSnapshot().anchors.map(anchor => anchor.id)).toEqual(['old', 'kept'])
    expect(navigation.getSnapshot().previews).toBe(previews)
    navigation.observe([], receipts, value => value.body)
    await navigation.readPreview('old')
    await vi.advanceTimersByTimeAsync(200)
    expect(navigation.getSnapshot().anchors.map(anchor => anchor.id)).toEqual(['old', 'kept'])
    expect(request).toHaveBeenCalledTimes(4)
    await expect(navigation.locate('missing', new Map([['missing', receipts[0]]]))).rejects.toThrow('不可用')
    expect(request).toHaveBeenCalledTimes(4)
    stop()
  })

  it('preserves newer receipts when an older directory response arrives', async () => {
    vi.useFakeTimers()
    const stale = deferred<ThreadUserAnchorIndex>()
    const fresh = deferred<ThreadUserAnchorIndex>()
    const request = vi.fn().mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise)
    const navigation = new ThreadUserAnchorNavigation(threadId, { request } as unknown as ThreadClient)
    const early = message('early', 2)
    const late = message('late', 3)
    navigation.observe([], [early], value => value.body)
    const stop = navigation.start()
    const reading = navigation.refresh()
    navigation.observe([], [early, late], value => value.body)
    stale.resolve(index(10, ['old'])); await reading
    expect(navigation.getSnapshot().index).toBeNull()
    expect(navigation.getSnapshot().anchors.map(anchor => anchor.id)).toEqual(['early', 'late'])
    await vi.advanceTimersByTimeAsync(100)
    const refreshing = navigation.refresh()
    fresh.resolve(index(20, ['old', 'late'])); await refreshing
    expect(navigation.getSnapshot().anchors.map(anchor => anchor.id)).toEqual(['old', 'late'])
    expect(request).toHaveBeenCalledTimes(2)
    stop()
  })

  it('starts once after the body is ready, shares refreshes and ignores version-only recallability changes', async () => {
    vi.useFakeTimers()
    const pending = deferred<ThreadUserAnchorIndex>()
    const request = vi.fn().mockReturnValueOnce(pending.promise)
    const navigation = new ThreadUserAnchorNavigation(threadId, { request } as unknown as ThreadClient)
    expect(request).not.toHaveBeenCalled()
    const stop = navigation.start()
    const first = navigation.refresh()
    expect(navigation.refresh()).toBe(first)
    expect(request).toHaveBeenCalledTimes(1)
    pending.resolve(index(20)); await first
    navigation.observe([message('latest', 2)], [], value => value.body)
    navigation.observe([message('latest', 2, { version: 2 })], [], value => value.body)
    await vi.advanceTimersByTimeAsync(200)
    expect(request).toHaveBeenCalledTimes(1)
    stop()
  })

  it('keeps old titles visible but immediately fences cached locating and pre-resync responses', async () => {
    vi.useFakeTimers()
    const request = vi.fn().mockResolvedValueOnce(index())
    const navigation = new ThreadUserAnchorNavigation(threadId, { request } as unknown as ThreadClient)
    const stop = navigation.start(); await Promise.resolve()
    const displayed = new Map([['old', message('old', 1)]])
    await navigation.locate('old', displayed)
    expect(request).toHaveBeenCalledTimes(1)
    navigation.resync()
    expect(navigation.getSnapshot().anchors).toHaveLength(2)
    request.mockResolvedValueOnce(windowAt('old'))
    await navigation.locate('old', displayed)
    expect(request).toHaveBeenLastCalledWith('thread.messages.around', { threadId, messageId: 'old' })
    const stale = deferred<ThreadUserAnchorIndex>()
    request.mockReturnValueOnce(stale.promise)
    await vi.advanceTimersByTimeAsync(100)
    navigation.resync()
    stale.resolve(index()); await Promise.resolve()
    request.mockRejectedValueOnce(new Error('offline'))
    await vi.advanceTimersByTimeAsync(100)
    expect(navigation.getSnapshot().status).toBe('error')
    request.mockResolvedValueOnce(windowAt('old'))
    await navigation.locate('old', displayed)
    expect(request).toHaveBeenLastCalledWith('thread.messages.around', { threadId, messageId: 'old' })
    // Once a current index is in flight, a click waits for it rather than duplicating validation.
    const fresh = deferred<ThreadUserAnchorIndex>()
    request.mockReturnValueOnce(fresh.promise)
    const refreshing = navigation.refresh()
    const count = request.mock.calls.length
    const locating = navigation.locate('old', displayed)
    fresh.resolve(index()); await refreshing; await locating
    expect(request).toHaveBeenCalledTimes(count)
    await navigation.locate('old', displayed)
    expect(request).toHaveBeenCalledTimes(count)
    navigation.resync()
    const around = deferred<ThreadMessageAroundSnapshot>()
    request.mockReturnValueOnce(around.promise).mockResolvedValueOnce(index())
    const pendingLocation = navigation.locate('old', displayed)
    await vi.advanceTimersByTimeAsync(100)
    around.resolve(windowAt('old'))
    expect(await pendingLocation).not.toBeNull() // starting the queued read isn't another invalidation
    stop()
  })

  it('deduplicates delayed previews, distinguishes empty/error/unrequested and re-reads after reply invalidation', async () => {
    vi.useFakeTimers()
    const reply = deferred<ThreadUserAnchorPreview>()
    const request = vi.fn().mockResolvedValueOnce(index()).mockReturnValueOnce(reply.promise)
    const navigation = new ThreadUserAnchorNavigation(threadId, { request } as unknown as ThreadClient)
    const stop = navigation.start()
    await Promise.resolve()
    navigation.preview('old'); navigation.preview('latest'); navigation.preview(null)
    await vi.advanceTimersByTimeAsync(200)
    expect(request).toHaveBeenCalledTimes(1)
    const first = navigation.readPreview('old')
    expect(navigation.readPreview('old')).toBe(first)
    expect(navigation.getSnapshot().previews.get('old')?.status).toBe('loading')
    reply.resolve({ schemaVersion: 1, threadId, messageId: 'old', throughGlobalSequence: 10, sourceAvailable: true, firstReply: null })
    await first
    expect(navigation.getSnapshot().previews.get('old')).toMatchObject({ status: 'ready', value: { firstReply: null } })
    await navigation.readPreview('old')
    expect(request).toHaveBeenCalledTimes(2)
    navigation.changed({ threadId, indexChanged: false, throughGlobalSequence: 11 })
    expect(navigation.getSnapshot().previews.has('old')).toBe(false)
    request.mockRejectedValueOnce(new Error('offline'))
    await navigation.readPreview('old')
    expect(navigation.getSnapshot().previews.get('old')?.status).toBe('error')
    request.mockResolvedValueOnce({ schemaVersion: 1, threadId, messageId: 'old', throughGlobalSequence: 11, sourceAvailable: true,
      firstReply: { messageId: 'reply', sequence: 3, summary: 'Core selected first reply', messageVersion: 1 } })
    await navigation.readPreview('old')
    expect(navigation.getSnapshot().previews.get('old')).toMatchObject({ status: 'ready', value: { firstReply: { messageId: 'reply' } } })
    stop()
  })

  it('lets only the last click locate, replaces its window, validates cached withdrawal and fences a closed Thread', async () => {
    const old = deferred<ThreadMessageAroundSnapshot>()
    const request = vi.fn().mockResolvedValueOnce(index()).mockReturnValueOnce(old.promise).mockResolvedValueOnce(windowAt('latest'))
    const navigation = new ThreadUserAnchorNavigation(threadId, { request } as unknown as ThreadClient)
    const stop = navigation.start()
    await Promise.resolve()
    const first = navigation.locate('old', new Map())
    const second = await navigation.locate('latest', new Map())
    old.resolve(windowAt('old'))
    expect(await first).toBeNull()
    expect(navigation.currentNavigation(second!)).toBe(true)
    expect(navigation.getSnapshot().window?.anchorMessageId).toBe('latest')
    navigation.observe([message('latest', 2)], [], value => value.body)
    const count = request.mock.calls.length
    await navigation.locate('latest', new Map([['latest', message('latest', 2)]]))
    expect(request).toHaveBeenCalledTimes(count)
    expect(navigation.getSnapshot().window?.anchorMessageId).toBe('latest')
    navigation.observe([message('latest', 2, { version: 2, withdrawn: true })], [], value => value.body)
    await expect(navigation.locate('latest', new Map([['latest', message('latest', 2)]]))).rejects.toThrow('不可用')
    const closed = deferred<ThreadMessageAroundSnapshot>()
    request.mockReturnValueOnce(closed.promise)
    const pending = navigation.locate('old', new Map())
    stop(); closed.resolve(windowAt('old'))
    expect(await pending).toBeNull()
    expect(navigation.getSnapshot().window).toBeNull()
  })

  it('rejects wrong identities and ineligible around targets even when sourceAvailable is true', async () => {
    const request = vi.fn().mockResolvedValueOnce(index())
    const navigation = new ThreadUserAnchorNavigation(threadId, { request } as unknown as ThreadClient)
    const stop = navigation.start(); await Promise.resolve()
    for (const value of [
      { ...windowAt('old'), threadId: 'another' },
      { ...windowAt('old'), anchorMessageId: 'another' },
      { ...windowAt('old'), messages: [message('old', 1, { withdrawn: true })] },
    ]) {
      request.mockResolvedValueOnce(value)
      await expect(navigation.locate('old', new Map())).rejects.toThrow('不可用')
    }
    stop()
    const fresh = message('old', 1, { version: 3, withdrawn: true })
    expect(mergeNavigationMessages([fresh], [message('old', 1)])).toEqual([fresh])
  })
})
