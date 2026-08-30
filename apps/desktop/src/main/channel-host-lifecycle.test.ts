import { describe, expect, it, vi } from 'vitest'
import { ChannelHostLifecycle } from './channel-host-lifecycle'

const ready = (generation: number) => ({
  generation,
  fullCoreState: 'ready' as const,
  capabilities: { authoritativeWorkspace: true, coreRequests: true }
})
const blocked = (generation: number) => ({
  generation,
  fullCoreState: 'blocked' as const,
  capabilities: { authoritativeWorkspace: false, coreRequests: false }
})

function fixture() {
  const host = { start: vi.fn(async (): Promise<void> => {}), stop: vi.fn(async (): Promise<void> => {}) }
  return { host, lifecycle: new ChannelHostLifecycle(host) }
}

describe('channel authority lifecycle', () => {
  it('waits for authority, starts once per generation, and reconnects after Core recovery', async () => {
    const { host, lifecycle } = fixture()
    await lifecycle.update(blocked(1))
    await lifecycle.update({ ...ready(1), capabilities: { authoritativeWorkspace: true, coreRequests: false } })
    expect(host.start).not.toHaveBeenCalled()
    await lifecycle.update(ready(1))
    await lifecycle.update(ready(1))
    expect(host.start).toHaveBeenCalledTimes(1)
    await lifecycle.update(blocked(1))
    expect(host.stop).toHaveBeenCalledTimes(1)
    await lifecycle.update(ready(2))
    expect(host.start).toHaveBeenCalledTimes(2)
    await lifecycle.stop()
    expect(host.stop).toHaveBeenCalledTimes(2)
    await lifecycle.update(ready(3))
    expect(host.start).toHaveBeenCalledTimes(2)
  })

  it('cleans a late startup before starting the latest generation, skipping superseded ones', async () => {
    const { host, lifecycle } = fixture()
    let finishStartup!: () => void
    let startupEntered!: () => void
    const entered = new Promise<void>((resolve) => { startupEntered = resolve })
    host.start.mockImplementationOnce(() => {
      startupEntered()
      return new Promise<void>((resolve) => { finishStartup = resolve })
    })
    const first = lifecycle.update(ready(1))
    await entered
    const lost = lifecycle.update(blocked(1))
    const superseded = lifecycle.update(ready(2))
    const latest = lifecycle.update(ready(3))
    expect(host.stop).not.toHaveBeenCalled()
    finishStartup()
    await Promise.all([first, lost, superseded, latest])
    expect(host.start).toHaveBeenCalledTimes(2)
    expect(host.stop).toHaveBeenCalledTimes(1)
    expect(host.stop.mock.invocationCallOrder[0]).toBeLessThan(host.start.mock.invocationCallOrder[1])
    await lifecycle.stop()
  })

  it('does not restart after shutdown while a startup is still pending', async () => {
    const { host, lifecycle } = fixture()
    let finishStartup!: () => void
    let startupEntered!: () => void
    const entered = new Promise<void>((resolve) => { startupEntered = resolve })
    host.start.mockImplementationOnce(() => {
      startupEntered()
      return new Promise<void>((resolve) => { finishStartup = resolve })
    })
    const first = lifecycle.update(ready(1))
    await entered
    const closing = lifecycle.stop()
    const late = lifecycle.update(ready(2))
    finishStartup()
    await Promise.all([first, closing, late])
    expect(host.start).toHaveBeenCalledTimes(1)
    expect(host.stop).toHaveBeenCalledTimes(1)
  })

  it('contains startup failures and can recover on a new authoritative generation', async () => {
    const { host, lifecycle } = fixture()
    host.start.mockRejectedValueOnce(new Error('fixture-startup-failed'))
    await expect(lifecycle.update(ready(1))).rejects.toThrow('fixture-startup-failed')
    expect(host.stop).toHaveBeenCalledTimes(1)
    await lifecycle.update(blocked(1))
    await lifecycle.update(ready(2))
    expect(host.start).toHaveBeenCalledTimes(2)
    await lifecycle.stop()
  })
})
