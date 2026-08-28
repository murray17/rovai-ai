import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createNavigationRefreshCoordinator,
  NAVIGATION_REFRESH_DEBOUNCE_MS
} from './navigation-refresh-coordinator'

function deferred(): { promise: Promise<void>; resolve(): void; reject(error: unknown): void } {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('NavigationRefreshCoordinator', () => {
  it('debounces an invalidation burst into one authoritative read', async () => {
    vi.useFakeTimers()
    const readAndCommit = vi.fn().mockResolvedValue(undefined)
    const coordinator = createNavigationRefreshCoordinator(readAndCommit)

    const first = coordinator.refresh()
    const second = coordinator.refresh()
    const third = coordinator.refresh()

    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(readAndCommit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(NAVIGATION_REFRESH_DEBOUNCE_MS)
    await first
    expect(readAndCommit).toHaveBeenCalledTimes(1)
  })

  it('keeps one in-flight read and makes every joined caller await the trailing read', async () => {
    const firstRead = deferred()
    const trailingRead = deferred()
    const readAndCommit = vi.fn()
      .mockImplementationOnce(() => firstRead.promise)
      .mockImplementationOnce(() => trailingRead.promise)
    const coordinator = createNavigationRefreshCoordinator(readAndCommit)

    const first = coordinator.refresh('explicit')
    expect(readAndCommit).toHaveBeenCalledTimes(1)
    const second = coordinator.refresh()
    const third = coordinator.refresh()
    expect(second).toBe(first)
    expect(third).toBe(first)

    firstRead.resolve()
    await Promise.resolve()
    expect(readAndCommit).toHaveBeenCalledTimes(2)
    let settled = false
    void first.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    trailingRead.resolve()
    await first
    expect(settled).toBe(true)
  })

  it('rejects the shared drain when its trailing read fails and observes the retry cycle', async () => {
    vi.useFakeTimers()
    const firstRead = deferred()
    const trailingFailure = new Error('trailing read failed')
    const readAndCommit = vi.fn()
      .mockImplementationOnce(() => firstRead.promise)
      .mockRejectedValueOnce(trailingFailure)
      .mockResolvedValue(undefined)
    const coordinator = createNavigationRefreshCoordinator(readAndCommit)

    const drain = coordinator.refresh('explicit')
    expect(coordinator.refresh()).toBe(drain)
    firstRead.resolve()
    await expect(drain).rejects.toBe(trailingFailure)
    expect(readAndCommit).toHaveBeenCalledTimes(2)

    const retry = coordinator.refresh()
    await vi.advanceTimersByTimeAsync(1_000)
    await retry
    expect(readAndCommit).toHaveBeenCalledTimes(3)
  })

  it('rejects a failed drain, retains the generation, and retries with bounded backoff', async () => {
    vi.useFakeTimers()
    const failure = new Error('Core unavailable')
    const readAndCommit = vi.fn()
      .mockRejectedValueOnce(failure)
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(undefined)
    const coordinator = createNavigationRefreshCoordinator(readAndCommit, { debounceMs: 0 })

    const first = coordinator.refresh('explicit')
    await expect(first).rejects.toBe(failure)
    expect(readAndCommit).toHaveBeenCalledTimes(1)

    const retry = coordinator.refresh()
    await vi.advanceTimersByTimeAsync(999)
    expect(readAndCommit).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(retry).rejects.toBe(failure)
    expect(readAndCommit).toHaveBeenCalledTimes(2)

    const secondRetry = coordinator.refresh()
    await vi.advanceTimersByTimeAsync(1_999)
    expect(readAndCommit).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    await secondRetry
    expect(readAndCommit).toHaveBeenCalledTimes(3)
  })

  it('does not let ordinary invalidations bypass an active retry delay', async () => {
    vi.useFakeTimers()
    const readAndCommit = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined)
    const coordinator = createNavigationRefreshCoordinator(readAndCommit)

    await expect(coordinator.refresh('explicit')).rejects.toThrow('offline')
    const joinedRetry = coordinator.refresh('invalidation')
    coordinator.refresh('poll').catch(() => undefined)
    await vi.advanceTimersByTimeAsync(999)
    expect(readAndCommit).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await joinedRetry
    expect(readAndCommit).toHaveBeenCalledTimes(2)
  })

  it('lets a foreground refresh bypass backoff and resets the failure sequence after success', async () => {
    vi.useFakeTimers()
    const readAndCommit = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('offline again'))
      .mockResolvedValue(undefined)
    const coordinator = createNavigationRefreshCoordinator(readAndCommit)

    await expect(coordinator.refresh('explicit')).rejects.toThrow('offline')
    await coordinator.refresh('foreground')
    expect(readAndCommit).toHaveBeenCalledTimes(2)

    await expect(coordinator.refresh('explicit')).rejects.toThrow('offline again')
    const retry = coordinator.refresh()
    await vi.advanceTimersByTimeAsync(999)
    expect(readAndCommit).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1)
    await retry
    expect(readAndCommit).toHaveBeenCalledTimes(4)
  })

  it('pauses background work while hidden and refreshes immediately when visible again', async () => {
    vi.useFakeTimers()
    const readAndCommit = vi.fn().mockResolvedValue(undefined)
    const coordinator = createNavigationRefreshCoordinator(readAndCommit, {
      initiallyVisible: false
    })

    const refresh = coordinator.refresh('invalidation')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(readAndCommit).not.toHaveBeenCalled()

    coordinator.setVisible(true)
    await vi.advanceTimersByTimeAsync(NAVIGATION_REFRESH_DEBOUNCE_MS)
    await refresh
    expect(readAndCommit).toHaveBeenCalledTimes(1)
  })

  it('pauses a dirty trailing read if the App becomes hidden during the in-flight read', async () => {
    vi.useFakeTimers()
    const firstRead = deferred()
    const readAndCommit = vi.fn()
      .mockImplementationOnce(() => firstRead.promise)
      .mockResolvedValue(undefined)
    const coordinator = createNavigationRefreshCoordinator(readAndCommit)

    const refresh = coordinator.refresh('explicit')
    coordinator.refresh('invalidation').catch(() => undefined)
    coordinator.setVisible(false)
    firstRead.resolve()
    await Promise.resolve()
    expect(readAndCommit).toHaveBeenCalledTimes(1)

    coordinator.setVisible(true)
    await vi.advanceTimersByTimeAsync(NAVIGATION_REFRESH_DEBOUNCE_MS)
    await refresh
    expect(readAndCommit).toHaveBeenCalledTimes(2)
  })
})
