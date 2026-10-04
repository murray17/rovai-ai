import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeExecutionMetricsSnapshot } from '@contracts'
import { ExecutionMetricsReader, mergeExecutionMetrics, executionUsageTotal, type ExecutionMetricRun, type ExecutionMetricsScope } from './execution-metrics-reader'

const run = (id: string, status: ExecutionMetricRun['status'] = 'succeeded', executionEpoch = 1): ExecutionMetricRun =>
  ({ id, status, executionEpoch })
const row = (id: string, value: number | null = 100): RuntimeExecutionMetricsSnapshot['runs'][number] => ({
  agentRunId: id, executionEpoch: 1, promptInputTotalTokens: value, outputTokens: 20,
  cacheReadTokens: null, cacheWriteTokens: 0, finalizedAt: 'final', lastObservedAt: 'observed', inputOutputComplete: true
})
const session: RuntimeExecutionMetricsSnapshot['sessions'][number] = {
  conversationId: 'conversation', agentId: 'agent', sessionGeneration: 1, runtimeKind: 'qoder-cli',
  modelKey: 'model', usedTokens: null, windowTokens: null, nativeRatio: 0.25,
  source: 'native', dialectId: 'fixture', observedAt: 'first'
}
const snapshot = (ids: string[], value: number | null = 100): RuntimeExecutionMetricsSnapshot =>
  ({ schemaVersion: 1, runs: ids.map(id => row(id, value)), sessions: [session] })
const scope = (runs: ExecutionMetricRun[], visible = ['r1'], expanded: string[] = [], shown = true): ExecutionMetricsScope =>
  ({ runs, visible: shown, visibleRunIds: new Set(visible), expandedRunIds: new Set(expanded) })

describe('execution metric structural sharing', () => {
  it('keeps equal snapshots and unaffected rows, while preserving null, zero and unformatted precision', () => {
    const owned = [run('r1'), run('r2')]
    const initial = mergeExecutionMetrics(null, snapshot(['r1', 'r2']), ['r1', 'r2'], owned)
    expect(mergeExecutionMetrics(initial, snapshot(['r2', 'r1']), ['r2', 'r1'], owned)).toBe(initial)
    const changed = mergeExecutionMetrics(initial, snapshot(['r1'], 101), ['r1'], owned)
    expect(changed).not.toBe(initial)
    expect(changed.runs[1]).toBe(initial.runs[1])
    expect(changed.sessions[0]).toBe(initial.sessions[0])
    const missing = mergeExecutionMetrics(changed, snapshot(['r1'], null), ['r1'], owned)
    expect(missing.runs[0].promptInputTotalTokens).toBeNull()
    const zero = mergeExecutionMetrics(missing, snapshot(['r1'], 0), ['r1'], owned)
    expect(zero.runs[0].promptInputTotalTokens).toBe(0)
    expect(zero).not.toBe(missing)
  })

  it('removes omitted requested rows and old epochs, and replaces rather than stitches Session observations', () => {
    const initial = mergeExecutionMetrics(null, snapshot(['r1', 'r2']), ['r1', 'r2'], [run('r1'), run('r2')])
    const empty = mergeExecutionMetrics(initial, { schemaVersion: 1, runs: [], sessions: [] }, ['r1'], [run('r1'), run('r2')])
    expect(empty.runs.map(item => item.agentRunId)).toEqual(['r2'])
    expect(empty.sessions).toEqual([])
    const fresh = mergeExecutionMetrics(initial, {
      schemaVersion: 1, runs: [row('foreign')],
      sessions: [{ ...session, sessionGeneration: 2, modelKey: 'new-model', nativeRatio: null, windowTokens: 200, observedAt: 'later' }]
    }, ['r1'], [run('r1', 'running', 2), run('r2')])
    expect(fresh.runs.map(item => item.agentRunId)).toEqual(['r2'])
    expect(fresh.sessions[0]).toMatchObject({ usedTokens: null, windowTokens: 200, nativeRatio: null, sessionGeneration: 2 })
    const renewed = mergeExecutionMetrics(initial, { ...initial, sessions: [{ ...session, observedAt: 'later' }] }, [], [run('r1'), run('r2')])
    expect(renewed).toBe(initial)
  })
})

describe('execution usage total qualification', () => {
  it('keeps the synthetic partial 70 + 15 unknown and exposes only complete succeeded totals', () => {
    const partial = { ...row('r1', 70), outputTokens: 15, inputOutputComplete: false }
    expect(executionUsageTotal(run('r1'), partial)).toBeNull()
    const complete = { ...row('r1', 200), outputTokens: 18, cacheReadTokens: 20 }
    expect(executionUsageTotal(run('r1'), complete)).toBe(218)
    expect(executionUsageTotal(run('r1'), { ...complete, inputOutputComplete: undefined })).toBeNull()
    for (const status of ['running', 'failed', 'cancelled'] as const) {
      expect(executionUsageTotal(run('r1', status), complete)).toBeNull()
    }
    expect(executionUsageTotal(run('r1'), { ...complete, finalizedAt: null })).toBeNull()
    expect(executionUsageTotal(run('r1'), { ...complete, outputTokens: null })).toBeNull()
    expect(executionUsageTotal(run('r1'), { ...row('r1', 0), outputTokens: 0 })).toBe(0)
    const initial = { ...snapshot(['r1', 'r2']), runs: [{ ...partial, inputOutputComplete: true }, row('r2')] }
    const next = { ...initial, runs: [partial, initial.runs[1]] }
    const merged = mergeExecutionMetrics(initial, next, ['r1', 'r2'], [run('r1'), run('r2')])
    expect(merged.runs[0]).not.toBe(initial.runs[0])
    expect(merged.runs[1]).toBe(initial.runs[1])
  })
})

describe('execution metric refresh lifecycle', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('reads visible collapsed history once, avoids 500 stable rows, and fetches new expansion on demand', async () => {
    const reads: string[][] = []
    const publish = vi.fn()
    const reader = new ExecutionMetricsReader(async ids => { reads.push(ids); return snapshot(ids) }, publish)
    const runs = Array.from({ length: 500 }, (_, index) => run(`r${index + 1}`))
    reader.setScope(scope(runs, ['r1', 'r2']))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(reads).toEqual([['r1', 'r2']])
    reader.setScope(scope(runs, ['r1', 'r2'], ['r500']))
    await vi.advanceTimersByTimeAsync(0)
    expect(reads.at(-1)).toEqual(['r1', 'r2', 'r500'])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(reads).toHaveLength(2)
    reader.invalidate()
    await vi.advanceTimersByTimeAsync(80)
    expect(reads.at(-1)).toEqual(['r1', 'r2'])
    expect(publish).toHaveBeenCalledTimes(2)
    reader.dispose()
  })

  it('polls only active runs, pauses hidden reads, and refreshes immediately when visible again', async () => {
    const read = vi.fn(async (ids: string[]) => snapshot(ids))
    const reader = new ExecutionMetricsReader(read, vi.fn())
    const runs = [run('r1', 'running'), run('r2'), run('queued', 'queued')]
    reader.setScope(scope(runs, ['r2']))
    await vi.advanceTimersByTimeAsync(0)
    expect(read.mock.calls[0][0]).toEqual(['r1', 'r2'])
    await vi.advanceTimersByTimeAsync(4_001)
    expect(read.mock.calls[1][0]).toEqual(['r1'])
    reader.setScope(scope(runs, ['r2'], [], false))
    reader.invalidate()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(read).toHaveBeenCalledTimes(2)
    reader.setScope(scope(runs, ['r2']))
    await vi.advanceTimersByTimeAsync(0)
    expect(read).toHaveBeenCalledTimes(3)
    reader.dispose()
  })

  it('keeps a trailing invalidation during a request, coalesces bursts, and suppresses identical publications', async () => {
    let finish!: (value: RuntimeExecutionMetricsSnapshot) => void
    const read = vi.fn<(ids: string[]) => Promise<RuntimeExecutionMetricsSnapshot>>()
    read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    read.mockImplementation(async ids => snapshot(ids, 200))
    const publish = vi.fn()
    const reader = new ExecutionMetricsReader(read, publish)
    reader.setScope(scope([run('r1')]))
    await vi.advanceTimersByTimeAsync(0)
    for (let i = 0; i < 10; i++) reader.invalidate()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(read).toHaveBeenCalledTimes(1)
    finish(snapshot(['r1']))
    await vi.advanceTimersByTimeAsync(0)
    expect(read).toHaveBeenCalledTimes(2)
    expect(publish.mock.calls.at(-1)![0].runs[0].promptInputTotalTokens).toBe(200)
    for (let i = 0; i < 10; i++) reader.invalidate()
    await vi.advanceTimersByTimeAsync(80)
    expect(read).toHaveBeenCalledTimes(3)
    expect(publish).toHaveBeenCalledTimes(2)
    reader.dispose()
  })

  it('bounds terminal tail reads and accepts a Usage/Context commit after the tail has stopped', async () => {
    let value = 100
    const read = vi.fn(async (ids: string[]) => snapshot(ids, value))
    const publish = vi.fn()
    const reader = new ExecutionMetricsReader(read, publish)
    reader.setScope(scope([run('r1', 'waiting')]))
    await vi.advanceTimersByTimeAsync(0)
    reader.setScope(scope([run('r1')]))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(read).toHaveBeenCalledTimes(5) // initial, terminal transition, three bounded tails
    value = 400
    reader.invalidate()
    await vi.advanceTimersByTimeAsync(80)
    expect(publish.mock.calls.at(-1)![0].runs[0].promptInputTotalTokens).toBe(400)
    expect(read).toHaveBeenCalledTimes(6)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(read).toHaveBeenCalledTimes(6)
    reader.dispose()
  })

  it('fences old in-flight ranges and epochs without starting concurrent reads', async () => {
    let finish!: (value: RuntimeExecutionMetricsSnapshot) => void
    const publish = vi.fn()
    const read = vi.fn<(ids: string[]) => Promise<RuntimeExecutionMetricsSnapshot>>()
    read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    read.mockImplementation(async ids => ({ ...snapshot(ids), runs: ids.map(id => ({ ...row(id), executionEpoch: 2 })) }))
    const reader = new ExecutionMetricsReader(read, publish)
    reader.setScope(scope([run('r1', 'running')]))
    await vi.advanceTimersByTimeAsync(0)
    reader.setScope(scope([run('r1', 'running', 2)], [], [], false))
    finish(snapshot(['r1']))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(publish).not.toHaveBeenCalled()
    expect(read).toHaveBeenCalledTimes(1)
    reader.setScope(scope([run('r1', 'running', 2)]))
    await vi.advanceTimersByTimeAsync(0)
    expect(publish.mock.calls[0][0].runs[0].executionEpoch).toBe(2)
    reader.dispose()
  })

  it('bounds optional-read retries and disposal rejects late callbacks', async () => {
    const read = vi.fn(async (): Promise<RuntimeExecutionMetricsSnapshot> => { throw new Error('unavailable') })
    const reader = new ExecutionMetricsReader(read, vi.fn())
    reader.setScope(scope([run('r1')]))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(read).toHaveBeenCalledTimes(4)
    reader.invalidate(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(read).toHaveBeenCalledTimes(5)
    reader.dispose()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(read).toHaveBeenCalledTimes(5)
  })
})
