import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AdaptiveChannelHostPump,
  CHANNEL_HOST_EVENT_DEBOUNCE_MS,
  CHANNEL_HOST_WATCHDOG_MS,
  CHANNEL_TERMINAL_QUIET_WAKE_MS
} from './channel-host-pump'

afterEach(() => vi.useRealTimers())

describe('AdaptiveChannelHostPump', () => {
  it('does one startup recovery probe and stays dormant after a clean result', async () => {
    vi.useFakeTimers()
    const run = vi.fn(async () => false)
    const pump = new AdaptiveChannelHostPump({ run, onError: vi.fn() })

    pump.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(CHANNEL_HOST_WATCHDOG_MS * 2)
    expect(run).toHaveBeenCalledOnce()
    pump.stop()
  })

  it('debounces live events, crosses the terminal quiet window, then disarms', async () => {
    vi.useFakeTimers()
    const run = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    const pump = new AdaptiveChannelHostPump({ run, onError: vi.fn() })
    pump.start()
    await vi.advanceTimersByTimeAsync(0)

    pump.handleCoreEvent({ method: 'runtime.action', params: { agentRunId: 'run-1' } })
    pump.handleCoreEvent({ method: 'runtime.plan.delta', params: { agentRunId: 'run-1' } })
    await vi.advanceTimersByTimeAsync(CHANNEL_HOST_EVENT_DEBOUNCE_MS - 1)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(2)

    pump.handleCoreEvent({ method: 'agent_run.terminal', params: { agentRunId: 'run-1' } })
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(CHANNEL_TERMINAL_QUIET_WAKE_MS)
    expect(run).toHaveBeenCalledTimes(4)

    await vi.advanceTimersByTimeAsync(CHANNEL_HOST_WATCHDOG_MS)
    expect(run).toHaveBeenCalledTimes(4)
    pump.stop()
  })

  it('coalesces a wake received while a pump is still running', async () => {
    vi.useFakeTimers()
    let finishFirst!: (value: boolean) => void
    const first = new Promise<boolean>((resolve) => { finishFirst = resolve })
    const run = vi.fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce(false)
    const pump = new AdaptiveChannelHostPump({ run, onError: vi.fn() })

    pump.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledOnce()
    pump.wake()
    finishFirst(true)
    await vi.advanceTimersByTimeAsync(0)

    expect(run).toHaveBeenCalledTimes(2)
    pump.stop()
  })

  it('invalidates an in-flight result on stop and preserves a restarted recovery probe', async () => {
    vi.useFakeTimers()
    let rejectFirst!: (error: Error) => void
    const first = new Promise<boolean>((_resolve, reject) => { rejectFirst = reject })
    const onError = vi.fn()
    const run = vi.fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce(false)
    const pump = new AdaptiveChannelHostPump({ run, onError })

    pump.start()
    await vi.advanceTimersByTimeAsync(0)
    pump.stop()
    pump.start()
    rejectFirst(new Error('retired Core generation'))
    await vi.advanceTimersByTimeAsync(0)

    expect(run).toHaveBeenCalledTimes(2)
    expect(onError).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    pump.stop()
  })

  it('wakes at a retry settlement availableAt instead of waiting for the watchdog', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'))
    const run = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    const pump = new AdaptiveChannelHostPump({ run, onError: vi.fn() })
    pump.start()
    await vi.advanceTimersByTimeAsync(0)

    pump.wake()
    pump.wakeAt('2026-09-01T00:00:02Z')
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1_999)
    expect(run).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)

    expect(run).toHaveBeenCalledTimes(3)
    pump.stop()
  })
})
