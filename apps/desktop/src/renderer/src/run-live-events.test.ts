import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CoreEvent } from '@contracts'
import { EMPTY_RUN_LIVE_EVENTS, RunLiveEvents } from './run-live-events'

afterEach(() => vi.useRealTimers())
const key = { threadId: 'thread', id: 'run', executionEpoch: 2 }
function fixture() {
  const listeners = new Set<(event: CoreEvent) => void>()
  const source = { onEvent: vi.fn((fn: (event: CoreEvent) => void) => { listeners.add(fn); return () => listeners.delete(fn) }) }
  const store = new RunLiveEvents(source)
  return { store, source, listeners, emit: (event: CoreEvent) => { for (const listener of listeners) listener(event) } }
}
function block(revision: number, params = {}): CoreEvent {
  return { method: 'agent.text.block', params: { threadId: 'thread', agentRunId: 'run', executionEpoch: 2,
    evidenceId: 'text', revision, sequence: 1, changeSequence: revision,
    payload: { blockId: 'text', status: 'streaming', text: `batch ${revision}` }, ...params } }
}
describe('Run live previews', () => {
  it('notifies only the subscribed Run, retains stable snapshots, and ignores stale identity', () => {
    vi.useFakeTimers()
    const { store, emit } = fixture(), changed = vi.fn(), other = vi.fn()
    const stop = store.subscribe(key, changed), stopOther = store.subscribe({ ...key, id: 'other' }, other)
    emit(block(1, { agentRunId: 'unsubscribed' }))
    emit(block(1, { executionEpoch: 1 }))
    emit(block(1, { threadId: 'other-thread' }))
    vi.advanceTimersByTime(32)
    expect(store.getSnapshot(key)).toBe(EMPTY_RUN_LIVE_EVENTS)
    expect(changed).not.toHaveBeenCalled()
    emit(block(2)); emit(block(3))
    vi.advanceTimersByTime(31)
    expect(changed).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    const snapshot = store.getSnapshot(key)
    expect(snapshot[0].revision).toBe(3)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(other).not.toHaveBeenCalled()
    emit(block(2)); vi.advanceTimersByTime(32)
    expect(store.getSnapshot(key)).toBe(snapshot)
    expect(changed).toHaveBeenCalledTimes(1)
    stop(); stopOther()
  })
  it('shares one source listener and flushes arrived text before terminal without a late timer', () => {
    vi.useFakeTimers()
    const { store, emit, listeners, source } = fixture(), changed = vi.fn(), second = vi.fn()
    const stop = store.subscribe(key, changed), stopSecond = store.subscribe(key, second)
    expect(source.onEvent).toHaveBeenCalledTimes(1)
    emit(block(1))
    emit({ method: 'agent_run.terminal', params: { agentRunId: 'run', executionEpoch: 2 } })
    expect(store.getSnapshot(key)[0].revision).toBe(1)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    emit(block(2)); vi.runAllTimers()
    expect(changed).toHaveBeenCalledTimes(1)
    stop(); expect(listeners.size).toBe(1)
    stopSecond(); expect(listeners.size).toBe(0)
    expect(store.getSnapshot(key)).toBe(EMPTY_RUN_LIVE_EVENTS)
  })
  it('releases pending work and never revives a prior editing epoch', () => {
    vi.useFakeTimers()
    const { store, emit } = fixture(), old = vi.fn(), next = vi.fn()
    const stop = store.subscribe(key, old)
    emit(block(1)); stop()
    const stopNext = store.subscribe({ ...key, executionEpoch: 3 }, next)
    emit(block(2)); vi.runAllTimers()
    expect(old).not.toHaveBeenCalled(); expect(next).not.toHaveBeenCalled()
    emit(block(3, { executionEpoch: 3 })); vi.advanceTimersByTime(32)
    expect(next).toHaveBeenCalledTimes(1)
    stopNext()
  })
  it('bounds preview retention and excludes private reasoning through the existing reducer', () => {
    vi.useFakeTimers()
    const { store, emit } = fixture()
    const stop = store.subscribe(key, () => {})
    for (let n = 0; n < 150; n++) {
      emit(block(n, { evidenceId: `text-${n}`, payload: { blockId: `text-${n}`, text: `${n}` } }))
      vi.advanceTimersByTime(32)
    }
    const before = store.getSnapshot(key)
    expect(before).toHaveLength(96)
    emit({ method: 'agent.thought.delta', params: { agentRunId: 'run', payload: { delta: 'private' } } })
    vi.advanceTimersByTime(32)
    expect(store.getSnapshot(key)).toBe(before)
    stop()
  })
})
