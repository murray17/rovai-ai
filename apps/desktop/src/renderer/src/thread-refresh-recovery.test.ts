import { afterEach, expect, it, vi } from 'vitest'
import { createThreadRefreshRecovery } from './thread-refresh-recovery'

afterEach(() => vi.useRealTimers())

it('shares 1, 3 and 10 second retries and shows one notice until a refresh succeeds', async () => {
  vi.useFakeTimers()
  const read = vi.fn().mockRejectedValue(new Error('connection lost'))
  const onExhausted = vi.fn()
  const onClear = vi.fn()
  const recovery = createThreadRefreshRecovery({ isCurrent: () => true, onExhausted, onClear })
  const cycle = recovery.recover('thread', 'snapshot', read)
  expect(recovery.recover('thread', 'snapshot', read)).toBe(cycle)
  recovery.succeeded('thread', 'events')
  expect(recovery.isWaitingToRetry('thread')).toBe(true)
  await vi.advanceTimersByTimeAsync(999)
  expect(read).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(read).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(3_000)
  expect(read).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(10_000)
  await cycle
  expect(read).toHaveBeenCalledTimes(3)
  expect(onExhausted).toHaveBeenCalledTimes(1)
  await recovery.recover('thread', 'snapshot', read)
  await vi.advanceTimersByTimeAsync(14_000)
  expect(onExhausted).toHaveBeenCalledTimes(1)

  read.mockResolvedValueOnce(undefined)
  onExhausted.mock.calls[0][1]()
  await vi.advanceTimersByTimeAsync(0)
  expect(read).toHaveBeenCalledTimes(4)
  expect(onClear).toHaveBeenCalledExactlyOnceWith('thread')
})

it('drops a scheduled retry and its callback when the user leaves the thread', async () => {
  vi.useFakeTimers()
  let threadId = 'first'
  const onExhausted = vi.fn()
  const read = vi.fn().mockRejectedValue(new Error('connection lost'))
  const recovery = createThreadRefreshRecovery({ isCurrent: thread => thread === threadId, onExhausted, onClear: vi.fn() })
  const previous = recovery.recover('first', 'snapshot', read)
  threadId = 'second'
  recovery.clear()
  await previous
  await vi.advanceTimersByTimeAsync(14_000)
  expect(read).not.toHaveBeenCalled()
  expect(onExhausted).not.toHaveBeenCalled()
})
