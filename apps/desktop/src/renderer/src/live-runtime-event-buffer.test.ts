import { afterEach, expect, it, vi } from 'vitest'
import { createLiveRuntimeEventBuffer } from './live-runtime-event-buffer'
import { buildLiveExecutionProgress, type LiveRuntimeEvent } from './ui-model'

afterEach(() => vi.useRealTimers())

function event(id: number, eventType = 'agent.text.delta'): LiveRuntimeEvent {
  return { id: `event-${id}`, agentRunId: 'run', eventType,
    payload: { delta: `${id}` }, createdAt: '2026-08-31T00:00:00Z' }
}

it('batches visible progress without a rolling count cap or losing any text delta', () => {
  vi.useFakeTimers()
  const append = vi.fn()
  const buffer = createLiveRuntimeEventBuffer(append)
  const events = Array.from({ length: 601 }, (_, index) => event(index))
  for (const next of events) buffer.push(next)
  expect(append).not.toHaveBeenCalled()
  vi.advanceTimersByTime(32)
  expect(append).toHaveBeenCalledExactlyOnceWith(events)
  expect(buildLiveExecutionProgress(append.mock.calls[0][0], 'run'))
    .toEqual(buildLiveExecutionProgress(events, 'run'))
  buffer.dispose()
})

it('does not wake React for hidden reasoning, and retains its narration boundary in order', () => {
  vi.useFakeTimers()
  const committed: LiveRuntimeEvent[] = []
  const append = vi.fn((batch: LiveRuntimeEvent[]) => committed.push(...batch))
  const buffer = createLiveRuntimeEventBuffer(append)
  buffer.push(event(1))
  vi.advanceTimersByTime(32)
  for (let id = 2; id <= 601; id += 1) buffer.push(event(id, 'agent.thought.delta'))
  vi.advanceTimersByTime(5_000)
  expect(append).toHaveBeenCalledTimes(1)
  buffer.push(event(602))
  vi.advanceTimersByTime(32)
  expect(append).toHaveBeenCalledTimes(2)
  expect(committed).toHaveLength(602)
  const progress = buildLiveExecutionProgress(committed, 'run')
  expect(progress).toEqual(buildLiveExecutionProgress([event(1), event(2, 'agent.thought.delta'), event(602)], 'run'))
  expect(progress.items.filter(item => item.kind === 'narration')).toHaveLength(2)
  buffer.dispose()
})

it('flushes pending events on terminal or resubscription and cancels scheduled work', () => {
  vi.useFakeTimers()
  const append = vi.fn()
  const buffer = createLiveRuntimeEventBuffer(append)
  buffer.push(event(1))
  buffer.push(event(2, 'agent.reasoning.summary.delta'))
  buffer.flush()
  expect(append).toHaveBeenCalledTimes(1)
  buffer.push(event(3, 'agent.thought.delta'))
  buffer.dispose()
  buffer.push(event(4))
  vi.runAllTimers()
  expect(append).toHaveBeenCalledTimes(2)
  expect(append.mock.calls[1][0]).toEqual([event(3, 'agent.thought.delta')])
})
