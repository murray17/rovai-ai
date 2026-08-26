import { describe, expect, it, vi } from 'vitest'
import { AppQuitCoordinator } from './app-quit-coordinator'

describe('AppQuitCoordinator', () => {
  it('freezes an update quit, drains once, and only then finishes', async () => {
    const events: string[] = []
    let releaseDrain!: () => void
    const drain = vi.fn(() => new Promise<void>((resolve) => {
      releaseDrain = resolve
    }))
    let updatePending = true
    const coordinator = new AppQuitCoordinator({
      updateInstallPending: () => updatePending,
      beforeDrain: (reason) => events.push(`before:${reason}`),
      drain: async () => {
        events.push('drain')
        await drain()
      },
      finish: (reason) => events.push(`finish:${reason}`),
      reportFailure: vi.fn()
    })
    const firstEvent = { preventDefault: vi.fn() }
    const repeatedEvent = { preventDefault: vi.fn() }

    coordinator.handleBeforeQuit(firstEvent)
    updatePending = false
    coordinator.handleBeforeQuit(repeatedEvent)

    expect(firstEvent.preventDefault).toHaveBeenCalledOnce()
    expect(repeatedEvent.preventDefault).toHaveBeenCalledOnce()
    expect(drain).toHaveBeenCalledOnce()
    expect(events).toEqual(['before:update_install', 'drain'])

    releaseDrain()
    await vi.waitFor(() => expect(events).toEqual([
      'before:update_install',
      'drain',
      'finish:update_install'
    ]))
  })

  it('reports a drain failure and still completes the bounded exit', async () => {
    const reportFailure = vi.fn()
    const finish = vi.fn()
    const coordinator = new AppQuitCoordinator({
      updateInstallPending: () => false,
      beforeDrain: vi.fn(),
      drain: async () => { throw new Error('core unavailable') },
      finish,
      reportFailure
    })

    coordinator.handleBeforeQuit({ preventDefault: vi.fn() })

    await vi.waitFor(() => expect(finish).toHaveBeenCalledWith('normal'))
    expect(reportFailure).toHaveBeenCalledOnce()
  })
})
