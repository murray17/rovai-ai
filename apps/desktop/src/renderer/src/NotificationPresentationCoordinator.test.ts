import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNotificationPresentationCoordinator } from './NotificationPresentationCoordinator'

afterEach(() => {
  vi.useRealTimers()
})

describe('notification presentation coordinator', () => {
  it('waits for the owning surface to report presentation instead of assuming a frame boundary', async () => {
    vi.useFakeTimers()
    const coordinator = createNotificationPresentationCoordinator(1_500)
    const result = coordinator.waitFor(7)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(coordinator.complete(7)).toBe(true)
    await expect(result).resolves.toBe(true)
  })

  it('fails closed after a bounded timeout when the target never presents', async () => {
    vi.useFakeTimers()
    const coordinator = createNotificationPresentationCoordinator(1_500)
    const result = coordinator.waitFor(8)

    await vi.advanceTimersByTimeAsync(1_500)
    await expect(result).resolves.toBe(false)
    expect(coordinator.complete(8)).toBe(false)
  })

  it('ignores stale completion after a newer navigation replaces the pending request', async () => {
    vi.useFakeTimers()
    const coordinator = createNotificationPresentationCoordinator(1_500)
    const first = coordinator.waitFor(9)
    const second = coordinator.waitFor(10)

    await expect(first).resolves.toBe(false)
    expect(coordinator.complete(9)).toBe(false)
    expect(coordinator.complete(10)).toBe(true)
    await expect(second).resolves.toBe(true)
  })
})
