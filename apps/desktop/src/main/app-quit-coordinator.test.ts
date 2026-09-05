import { describe, expect, it, vi } from 'vitest'
import { AppQuitCoordinator } from './app-quit-coordinator'

describe('AppQuitCoordinator', () => {
  it('freezes an update quit, prepares the Renderer, drains once, and only then finishes', async () => {
    const events: string[] = []
    let releasePreparation!: () => void
    const prepareRenderer = vi.fn(() => new Promise<void>((resolve) => {
      releasePreparation = resolve
    }))
    let releaseDrain!: () => void
    const drain = vi.fn(() => new Promise<void>((resolve) => {
      releaseDrain = resolve
    }))
    let updatePending = true
    const coordinator = new AppQuitCoordinator({
      updateInstallPending: () => updatePending,
      beforeDrain: (reason) => events.push(`before:${reason}`),
      prepareRenderer: async () => {
        events.push('prepare')
        await prepareRenderer()
      },
      drain: async () => {
        events.push('drain')
        await drain()
      },
      finish: (reason) => events.push(`finish:${reason}`),
      reportPreparationFailure: vi.fn(),
      reportFailure: vi.fn()
    })
    const firstEvent = { preventDefault: vi.fn() }
    const repeatedEvent = { preventDefault: vi.fn() }

    coordinator.handleQuitRequest(firstEvent)
    updatePending = false
    coordinator.handleQuitRequest(repeatedEvent)

    expect(firstEvent.preventDefault).toHaveBeenCalledOnce()
    expect(repeatedEvent.preventDefault).toHaveBeenCalledOnce()
    expect(prepareRenderer).toHaveBeenCalledOnce()
    expect(drain).not.toHaveBeenCalled()
    expect(events).toEqual(['before:update_install', 'prepare'])

    releasePreparation()
    await vi.waitFor(() => expect(drain).toHaveBeenCalledOnce())
    expect(drain).toHaveBeenCalledOnce()
    expect(events).toEqual(['before:update_install', 'prepare', 'drain'])

    releaseDrain()
    await vi.waitFor(() => expect(events).toEqual([
      'before:update_install',
      'prepare',
      'drain',
      'finish:update_install'
    ]))
  })

  it('keeps the App running after Renderer preparation fails and retries on the next quit', async () => {
    const events: string[] = []
    const reportPreparationFailure = vi.fn()
    let preparationShouldFail = true
    const coordinator = new AppQuitCoordinator({
      updateInstallPending: () => false,
      beforeDrain: () => events.push('before'),
      prepareRenderer: async () => {
        events.push('prepare')
        if (preparationShouldFail) throw new Error('draft save failed')
      },
      drain: async () => { events.push('drain') },
      finish: () => events.push('finish'),
      reportPreparationFailure,
      reportFailure: vi.fn()
    })

    coordinator.handleBeforeQuit({ preventDefault: vi.fn() })

    await vi.waitFor(() => expect(reportPreparationFailure).toHaveBeenCalledOnce())
    expect(reportPreparationFailure).toHaveBeenCalledWith(expect.objectContaining({
      message: 'draft save failed'
    }))
    expect(events).toEqual(['before', 'prepare'])

    preparationShouldFail = false
    coordinator.handleQuitRequest({ preventDefault: vi.fn() })

    await vi.waitFor(() => expect(events).toEqual([
      'before',
      'prepare',
      'before',
      'prepare',
      'drain',
      'finish'
    ]))
  })

  it('reports a drain failure and still completes the bounded exit', async () => {
    const reportFailure = vi.fn()
    const finish = vi.fn()
    const coordinator = new AppQuitCoordinator({
      updateInstallPending: () => false,
      beforeDrain: vi.fn(),
      prepareRenderer: async () => undefined,
      drain: async () => { throw new Error('core unavailable') },
      finish,
      reportPreparationFailure: vi.fn(),
      reportFailure
    })

    coordinator.handleQuitRequest({ preventDefault: vi.fn() })

    await vi.waitFor(() => expect(finish).toHaveBeenCalledWith('normal'))
    expect(reportFailure).toHaveBeenCalledOnce()
  })
})
