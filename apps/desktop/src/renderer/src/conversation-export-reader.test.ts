import { describe, expect, it, vi } from 'vitest'
import type { ThreadMessagePage, ThreadMessageView, ThreadOpenProjection, ThreadReadInvalidation } from '@contracts'
import type { ThreadClient } from './camp-client'
import { ConversationExportReader } from './conversation-export-reader'

const message = (sequence: number): ThreadMessageView => ({ id: `m${sequence}`, sequence, authorType: 'user', body: `body ${sequence}`, withdrawn: false } as ThreadMessageView)
const fixture = (count: number) => {
  let messages = Array.from({ length: count }, (_, i) => message(i + 1))
  let watermark = 10000
  let invalidated!: (change?: ThreadReadInvalidation) => void
  const tail = (id: string): ThreadOpenProjection => {
    const rows = messages.slice(-20)
    return { schemaVersion: 9, thread: { id, title: id }, throughGlobalSequence: watermark, messages: structuredClone(rows),
      coverage: { messages: { oldestLoadedSequence: rows[0]?.sequence ?? null, newestLoadedSequence: rows.at(-1)?.sequence ?? null, hasEarlier: messages.length > 20 } } } as ThreadOpenProjection
  }
  const page = (params: { threadId: string; beforeSequence: number; throughGlobalSequence: number }): ThreadMessagePage => {
    const earlier = messages.filter(m => m.sequence < params.beforeSequence)
    const rows = earlier.slice(-100), hasMore = earlier.length > rows.length
    return { schemaVersion: 1, threadId: params.threadId, throughGlobalSequence: params.throughGlobalSequence,
      requestedBeforeSequence: params.beforeSequence, messages: structuredClone(rows), hasMore, nextBeforeSequence: hasMore ? rows[0].sequence : null }
  }
  const request = vi.fn(async (method: string, params: any): Promise<unknown> => method === 'threads.open' ? tail(params.threadId) : page(params))
  const reader = new ConversationExportReader({ request, onInvalidated: (listener: typeof invalidated) => { invalidated = listener; return () => undefined } } as unknown as ThreadClient)
  reader.start()
  return { reader, request, tail, page, invalidate: (change?: ThreadReadInvalidation) => invalidated(change),
    replace: (rows: ThreadMessageView[]) => { messages = rows; watermark++ }, rows: () => messages }
}
async function settle(reader: ConversationExportReader) {
  await vi.waitFor(() => expect(reader.getSnapshot().status).not.toBe('loading'))
  return reader.getSnapshot()
}
const deferred = <T,>() => {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('complete conversation export ownership', () => {
  it.each([0, 500, 1240])('exhausts authoritative pages for %i messages, independently of any browsing window', async count => {
    const { reader, request } = fixture(count)
    reader.open({ id: 'unopened', title: 'Other conversation' })
    const state = await settle(reader)
    expect(state.status).toBe('ready')
    expect(state.messages?.map(m => m.sequence)).toEqual(Array.from({ length: count }, (_, i) => i + 1))
    expect(state.upperSequence).toBe(count)
    expect(request.mock.calls[0][0]).toBe('threads.open')
    const pages = request.mock.calls.filter(call => call[0] === 'thread.messages.page')
    expect(pages.length).toBe(Math.ceil(Math.max(0, count - 20) / 100))
    if (count > 20) expect(pages[0][1]).toMatchObject({ beforeSequence: count - 19, limit: 100 })
    expect(request.mock.calls.some(call => call[0].includes('snapshot') || call[0].includes('enter'))).toBe(false)
  })
  it('excludes new arrivals while reading and preserves the initial upper bound on removal/resync rereads', async () => {
    const f = fixture(500)
    const pending = deferred<ThreadMessagePage>()
    f.request.mockImplementationOnce(async (_, params) => f.tail(params.threadId)).mockImplementationOnce(() => pending.promise)
    f.reader.open({ id: 't', title: 't' })
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(2))
    f.replace([...f.rows(), ...Array.from({ length: 35 }, (_, i) => message(501 + i))])
    f.invalidate({ messages: [{ threadId: 't', indexChanged: true, throughGlobalSequence: 10001 }] })
    expect(f.reader.getSnapshot().upperSequence).toBe(500)
    pending.resolve(f.page(f.request.mock.calls[1][1]))
    expect((await settle(f.reader)).messages).toHaveLength(500)
    f.replace(f.rows().map(m => m.id === 'm5' ? { ...m, withdrawn: true, body: '' } : m).filter(m => m.id !== 'm6'))
    f.invalidate({ messages: [{ threadId: 't', indexChanged: true, unavailableMessageIds: ['m5', 'm6'], throughGlobalSequence: 10002 }] })
    expect(f.reader.getSnapshot()).toMatchObject({ status: 'loading', messages: null, upperSequence: 500 })
    const state = await settle(f.reader)
    expect(state.messages?.at(-1)?.sequence).toBe(500)
    expect(state.messages?.find(m => m.id === 'm5')?.withdrawn).toBe(true)
    expect(state.messages?.some(m => m.id === 'm6')).toBe(false)
    f.invalidate({ resync: true })
    expect((await settle(f.reader)).upperSequence).toBe(500)
    f.reader.retry()
    expect((await settle(f.reader)).upperSequence).toBe(535)
  })
  it('rejects partial results, retries from a fresh tail and does not retain failed pages', async () => {
    const f = fixture(500)
    f.request.mockImplementationOnce(async (_, params) => f.tail(params.threadId)).mockRejectedValueOnce(new Error('offline'))
    f.reader.open({ id: 't', title: 't' })
    expect(await settle(f.reader)).toMatchObject({ status: 'error', messages: null, projection: null })
    f.replace([message(700)])
    f.reader.retry()
    expect((await settle(f.reader)).messages?.map(m => m.sequence)).toEqual([700])
  })
  it('resolves grouping for old messages whose Run is outside the bounded tail metadata', async () => {
    const f = fixture(2)
    f.replace(f.rows().map(m => ({ ...m, authorType: 'agent', authorId: 'alice', sourceAgentRunId: `old-run-${m.sequence}`,
      createdAt: new Date(Date.UTC(2026, 10, 4, 1, 0, m.sequence)).toISOString(), threadTurnId: null })))
    f.request.mockImplementation(async (method, params) => method === 'threads.open' ? f.tail(params.threadId)
      : { agentRunId: params.agentRunId, threadId: 't', threadTurnId: 'same-old-turn' })
    f.reader.open({ id: 't', title: 't' })
    expect((await settle(f.reader)).messages?.map(m => m.threadTurnId)).toEqual(['same-old-turn', 'same-old-turn'])
    expect(f.request.mock.calls.filter(call => call[0] === 'agentRuns.diagnostic.get')).toHaveLength(2)
  })
  it('cannot publish a cancelled tail, a late page or a previous task failure into a different conversation', async () => {
    const f = fixture(50), oldTail = deferred<ThreadOpenProjection>()
    f.request.mockImplementationOnce(() => oldTail.promise)
    f.reader.open({ id: 'old', title: 'old' }); f.reader.close()
    oldTail.resolve(f.tail('old')); await Promise.resolve()
    expect(f.reader.getSnapshot().status).toBe('idle')
    const oldPage = deferred<ThreadMessagePage>()
    f.request.mockImplementationOnce(async (_, params) => f.tail(params.threadId)).mockImplementationOnce(() => oldPage.promise)
    f.reader.open({ id: 'old', title: 'old' })
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(3))
    f.reader.open({ id: 'new', title: 'new' }); await settle(f.reader)
    const ready = f.reader.getSnapshot()
    oldPage.reject(new Error('late error')); await Promise.resolve(); await Promise.resolve()
    expect(f.reader.getSnapshot()).toBe(ready)
    expect(ready.target?.id).toBe('new')
  })
  it('invalidates a removed message even if its in-flight page has not been collected yet', async () => {
    const f = fixture(50), oldPage = deferred<ThreadMessagePage>()
    f.request.mockImplementationOnce(async (_, params) => f.tail(params.threadId)).mockImplementationOnce(() => oldPage.promise)
    f.reader.open({ id: 't', title: 't' })
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(2))
    const stale = f.page(f.request.mock.calls[1][1])
    f.replace(f.rows().filter(m => m.id !== 'm1'))
    f.reader.changed({ threadId: 't', throughGlobalSequence: 10001, indexChanged: false, unavailableMessageIds: ['m1'] })
    const ready = await settle(f.reader)
    oldPage.resolve(stale); await Promise.resolve(); await Promise.resolve()
    expect(f.reader.getSnapshot()).toBe(ready)
    expect(ready.messages?.some(m => m.id === 'm1')).toBe(false)
  })
  it.each(['wrong owner', 'nondecreasing cursor', 'wrong watermark', 'unordered rows'])('fails closed on an invalid page: %s', async kind => {
    const f = fixture(500)
    f.request.mockImplementationOnce(async (_, params) => f.tail(params.threadId)).mockImplementationOnce(async (_, params) => {
      const page = f.page(params)
      if (kind === 'wrong owner') page.threadId = 'other'
      if (kind === 'nondecreasing cursor') page.nextBeforeSequence = params.beforeSequence
      if (kind === 'wrong watermark') page.throughGlobalSequence++
      if (kind === 'unordered rows') page.messages.reverse()
      return page
    })
    f.reader.open({ id: 't', title: 't' })
    expect(await settle(f.reader)).toMatchObject({ status: 'error', messages: null })
  })
})
