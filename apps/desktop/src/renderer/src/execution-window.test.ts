import { describe, expect, it, vi } from 'vitest'
import type { AgentRunExecutionEvidenceView as Evidence, AgentRunExecutionBlock, AgentRunExecutionBlockPage } from '@contracts'
import { ExecutionWindow, ExecutionWindowCache, executionWindowCacheFor, executionWindowPageSize, type ExecutionChangesRequest, type ExecutionWindowRequest } from './execution-window'

function evidence(sequence: number): Evidence {
  return { id: `e-${sequence}`, agentRunId: 'run', executionEpoch: 1, sequence,
    operationId: null, revision: 1, changeSequence: sequence,
    eventType: 'agent.text.block', kind: 'narration', phase: 'completed',
    payload: { text: `text ${sequence}` }, contentBlobId: null, contentByteCount: 10,
    isTruncated: false, occurredAt: '2026-09-12T00:00:00Z' }
}
function block(item: Evidence): AgentRunExecutionBlock {
  return { key: `item:${item.sequence}`, kind: 'item', sequence: item.sequence, lastSequence: item.sequence,
    changeSequence: item.changeSequence ?? item.sequence, toolCount: 0,
    counts: { completed: 0, failed: 0, stopped: 0, recorded: 0, running: 0, waiting: 0 }, evidence: [item] }
}
function source(initial = 100) {
  const state = { through: initial, offline: false, refreshed: [] as Evidence[] }
  const request = vi.fn<ExecutionWindowRequest>(async params => {
    if (state.offline) throw new Error('offline')
    const start = params.afterSequence === undefined
      ? Math.max(1, Math.min(state.through, (params.beforeSequence ?? state.through + 1) - 1) - params.limit + 1)
      : params.afterSequence + 1
    const end = params.afterSequence === undefined ? Math.min(state.through, (params.beforeSequence ?? state.through + 1) - 1)
      : Math.min(state.through, start + params.limit - 1)
    const hasMore = params.afterSequence === undefined ? start > 1 : end < state.through
    return { schemaVersion: 3, threadId: 'camp', agentRunId: 'run', requestedBeforeSequence: params.beforeSequence,
      requestedAfterSequence: params.afterSequence, nextAfterSequence: params.afterSequence !== undefined && hasMore ? end : null,
      nextBeforeSequence: params.afterSequence === undefined && hasMore ? start : null,
      throughSequence: state.through, throughChangeSequence: state.through, hasMore,
      blocks: Array.from({ length: Math.max(0, end - start + 1) }, (_, offset) => block(evidence(start + offset))) }
  })
  const changes = vi.fn<ExecutionChangesRequest>(async params => {
    if (state.offline) throw new Error('offline')
    const end = Math.min(state.through, params.afterChangeSequence + params.limit)
    return { schemaVersion: 3, threadId: 'camp', agentRunId: 'run', requestedAfterChangeSequence: params.afterChangeSequence,
      nextAfterChangeSequence: end, throughSequence: state.through, throughChangeSequence: state.through,
      hasMore: end < state.through,
      blocks: [...Array.from({ length: end - params.afterChangeSequence }, (_, offset) => block(evidence(params.afterChangeSequence + offset + 1))),
        ...state.refreshed.map(item => block({ ...item, changeSequence: state.through }))] }
  })
  return { state, request, changes }
}

describe('continuous execution history', () => {
  it('appends the thirteenth live record without hiding the first twelve or shifting the history cursor', async () => {
    const { state, request, changes } = source(12)
    const current = new ExecutionWindow('camp', 'run', 12, request, () => {}, changes)
    await current.latest()
    state.through = 13
    await current.refresh()
    expect(current.evidence.map(item => item.sequence)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1))
    expect(current.hasEarlier).toBe(false)
    state.through = 240
    await current.refresh()
    expect(current.evidence.map(item => item.sequence)).toEqual(Array.from({ length: 240 }, (_, i) => i + 1))
    expect(request).toHaveBeenCalledTimes(1)
    expect(changes.mock.calls.map(([params]) => params.afterChangeSequence)).toEqual([12, 13, 109, 205])
    state.through = 10_000
    await current.refresh()
    expect(current.evidence.at(-1)?.sequence).toBe(10_000)
    expect(current.evidence.length).toBeLessThanOrEqual(2048)
    expect(changes).toHaveBeenCalledTimes(5)
    expect(request.mock.calls.filter(([params]) => params.beforeSequence === null)).toHaveLength(2)
  })

  it('updates an unfinished row in place while preserving older history and a stable prefetch boundary', async () => {
    const { state, request, changes } = source()
    const current = new ExecutionWindow('camp', 'run', 12, request, () => {}, changes)
    await current.latest()
    await current.earlier()
    const first = current.evidence[0].sequence
    current.evidence[0].phase = 'updated'
    current.evidence[0].revision = null
    state.refreshed = [{ ...current.evidence[0], phase: 'completed', payload: { text: 'complete body' } }]
    state.through = 102
    await current.refresh(() => false)
    expect(current.evidence[0].sequence).toBe(first)
    expect(current.evidence[0].payload).toEqual({ text: 'complete body' })
    expect(current.evidence.at(-1)?.sequence).toBe(102)
    expect(changes.mock.calls[0][0].refreshEvidenceIds).toEqual([`e-${first}`])
    expect(request.mock.calls.map(([params]) => params.beforeSequence)).toEqual([null, 89, 77])
  })

  it('refreshes a streaming block without a durable change or a new display position', async () => {
    const { request, changes } = source(1)
    const streaming: Evidence = { ...evidence(1), phase: 'updated', payload: { status: 'streaming', text: 'hello' } }
    const current = new ExecutionWindow('camp', 'run', 12, async params => ({ ...await request(params), blocks: [block(streaming)] }), () => {},
      async params => {
        expect(params.refreshEvidenceIds).toEqual(['e-1'])
        return { ...await changes(params), refreshedBlocks: [block({ ...streaming, payload: { status: 'streaming', text: 'hello world' } })] }
      })
    await current.latest()
    await current.refresh()
    expect(current.blocks).toHaveLength(1)
    expect(current.evidence[0].payload).toEqual({ status: 'streaming', text: 'hello world' })
    expect(current.blocks[0].changeSequence).toBe(1)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('reads larger historical batches, prefetches one neighbor and revisits loaded data offline', async () => {
    const { state, request, changes } = source(1000)
    const current = new ExecutionWindow('camp', 'run', 12, request, () => {}, changes)
    await current.latest()
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    expect(current.evidence).toHaveLength(12)
    expect(request.mock.calls.map(([params]) => params.limit)).toEqual([12, 12])
    await current.earlier(); await current.earlier(); await current.earlier()
    expect(current.evidence).toHaveLength(48)
    const count = request.mock.calls.length
    state.offline = true
    await current.latest(); await current.newer()
    expect(current.error).toBeNull()
    expect(current.evidence).toHaveLength(48)
    expect(current.evidence.at(-1)?.sequence).toBe(1000)
    expect(request).toHaveBeenCalledTimes(count)
    expect(executionWindowPageSize(300)).toBeLessThan(executionWindowPageSize(900))
    expect(executionWindowPageSize(4000)).toBe(24)
  })

  it('keeps successful data on failure, retries the same direction and validates Thread/cursor boundaries', async () => {
    const { state, request, changes } = source(1000)
    state.offline = true
    const current = new ExecutionWindow('camp', 'run', 12, request, () => {}, changes)
    await current.latest()
    expect(current.error).toBe('offline')
    state.offline = false; await current.retry()
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3))
    await current.earlier()
    state.offline = true
    await current.earlier(); await current.earlier()
    const retained = current.evidence
    expect(current.error).toBe('offline')
    expect(current.direction).toBe('earlier')
    state.offline = false; await current.retry()
    expect(current.error).toBeNull()
    expect(current.evidence.length).toBeGreaterThan(retained.length)
    const invalid = new ExecutionWindow('camp', 'run', 12, async params => ({ ...await request(params), threadId: 'other' }), () => {}, changes)
    await invalid.latest()
    expect(invalid.error).toContain('不兼容')
    expect(invalid.evidence).toEqual([])
  })

  it('bounds retained records and bytes while preserving the reading viewport and reloads evicted forward ranges', async () => {
    const { state, request, changes } = source(1000)
    const current = new ExecutionWindow('camp', 'run', 12, request, () => {}, changes, { maxItems: 24, maxBytes: 100_000 })
    await current.latest(); await current.earlier()
    current.setViewport(978, 980)
    await current.earlier()
    expect(current.evidence.length).toBeLessThanOrEqual(24)
    expect(current.evidence.some(item => item.sequence === 978)).toBe(true)
    expect(current.hasNewer).toBe(true)
    const requests = request.mock.calls.length
    state.through = 1100
    await current.refresh(() => false)
    expect(request).toHaveBeenCalledTimes(requests)
    current.setViewport(984, 986)
    await current.newer()
    expect(request.mock.calls.some(([params]) => params.afterSequence !== undefined)).toBe(true)
    expect(current.evidence.length).toBeLessThanOrEqual(24)
    await current.latest()
    expect(current.evidence.at(-1)?.sequence).toBe(1100)
    expect(current.byteSize).toBeLessThan(100_000)
    const bytes = new ExecutionWindow('camp', 'run', 12, request, () => {}, changes, { maxItems: 2048, maxBytes: 1500 })
    await bytes.latest()
    expect(bytes.evidence.length).toBeLessThan(12)
  })

  it('fences late responses after unmount and reuses a released Run cache across Thread switches', async () => {
    const { request, changes } = source()
    let resolve!: (value: AgentRunExecutionBlockPage) => void
    const changed = vi.fn()
    const late = new ExecutionWindow('camp', 'run', 12, () => new Promise(done => { resolve = done }), changed, changes)
    const loading = late.latest(); late.dispose(); changed.mockClear()
    resolve(await request({ threadId: 'camp', agentRunId: 'run', beforeSequence: null, limit: 12 }))
    await loading
    expect(late.evidence).toEqual([]); expect(changed).not.toHaveBeenCalled()
    const cache = new ExecutionWindowCache(2)
    const create = vi.fn((notify: () => void) => new ExecutionWindow('camp', 'run', 12, request, notify, changes))
    const a = cache.acquire('a', create, changed); await a.window.latest(); a.release()
    const b = cache.acquire('b', create, changed); await b.window.latest(); b.release()
    const calls = request.mock.calls.length
    const returned = cache.acquire('a', create, changed); await returned.window.latest()
    expect(returned.window).toBe(a.window); expect(request).toHaveBeenCalledTimes(calls)
    returned.release()
    const c = cache.acquire('c', create, changed); c.release()
    const old = cache.acquire('b', create, changed)
    expect(old.window).not.toBe(b.window); old.release()
    // Identical Run IDs on a replacement Host/client must load through the new
    // transport, while revisiting a Thread on the same client still hits cache.
    const firstClient = {}, nextClient = {}
    const firstSource = source(3), nextSource = source(7)
    const first = executionWindowCacheFor(firstClient).acquire('same-run', notify => new ExecutionWindow('camp', 'run', 12, firstSource.request, notify, firstSource.changes), changed)
    await first.window.latest(); first.release()
    const same = executionWindowCacheFor(firstClient).acquire('same-run', create, changed)
    expect(same.window).toBe(first.window); same.release()
    const next = executionWindowCacheFor(nextClient).acquire('same-run', notify => new ExecutionWindow('camp', 'run', 12, nextSource.request, notify, nextSource.changes), changed)
    expect(next.window.evidence).toEqual([])
    await next.window.latest()
    expect(next.window.evidence.at(-1)?.sequence).toBe(7)
    expect(firstSource.request).toHaveBeenCalledTimes(1)
    expect(nextSource.request).toHaveBeenCalledTimes(1)
    next.release()
  })
})
