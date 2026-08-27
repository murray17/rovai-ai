import { describe, expect, it, vi } from 'vitest'
import { restoreProjectAccessFailClosed } from './project-access-restore'

describe('removed Project access restoration', () => {
  it('leaves an already-active root unchanged without entering a restore transaction', async () => {
    const previousSnapshot = { removedProjects: [] }
    const events: string[] = []

    const snapshot = await restoreProjectAccessFailClosed({
      previousSnapshot,
      restorationRequired: false,
      persistRestoredPreference: async () => {
        events.push('preference:restore')
        return { removedProjects: [] }
      },
      activateExecutionRoot: async () => {
        events.push('core:activate')
        throw new Error('transient activation failure')
      },
      suspendExecutionRoot: async () => { events.push('core:suspend') },
      persistPreviousPreference: async () => previousSnapshot,
      publishRemovedRoots: () => { events.push('launch-args:publish') }
    })

    expect(snapshot).toBe(previousSnapshot)
    expect(events).toEqual([])
  })

  it('keeps a queued Run suspended until the restored preference is durable', async () => {
    let durablePreference: 'removed' | 'active' = 'removed'
    let coreAccess: 'removed' | 'active' = 'removed'
    const queuedRunObservations: string[] = []
    const events: string[] = []
    const previousSnapshot = {
      removedProjects: [{ targetKey: 'directory:/Downloads', removedAt: 'removed-at' }]
    }

    const snapshot = await restoreProjectAccessFailClosed({
      previousSnapshot,
      restorationRequired: true,
      persistRestoredPreference: async () => {
        events.push('preference:restore')
        queuedRunObservations.push(`${durablePreference}:${coreAccess}`)
        durablePreference = 'active'
        return { removedProjects: [] }
      },
      activateExecutionRoot: async () => {
        events.push('core:activate')
        queuedRunObservations.push(`${durablePreference}:${coreAccess}`)
        coreAccess = 'active'
      },
      suspendExecutionRoot: async () => { coreAccess = 'removed' },
      persistPreviousPreference: async () => previousSnapshot,
      publishRemovedRoots: () => { events.push('launch-args:publish') }
    })

    expect(snapshot).toEqual({ removedProjects: [] })
    expect(events).toEqual([
      'preference:restore',
      'core:activate',
      'launch-args:publish'
    ])
    expect(queuedRunObservations).toEqual([
      'removed:removed',
      'active:removed'
    ])
  })

  it('keeps a queued Run suspended when the durable preference write fails', async () => {
    let coreAccess: 'removed' | 'active' = 'removed'
    const queuedRunObservations: string[] = []
    const publishRemovedRoots = vi.fn()
    const previousSnapshot = {
      removedProjects: [{ targetKey: 'directory:/Downloads', removedAt: 'removed-at' }]
    }

    await expect(restoreProjectAccessFailClosed({
      previousSnapshot,
      restorationRequired: true,
      persistRestoredPreference: async () => {
        queuedRunObservations.push(coreAccess)
        throw new Error('preference failed')
      },
      activateExecutionRoot: async () => { coreAccess = 'active' },
      suspendExecutionRoot: vi.fn(),
      persistPreviousPreference: vi.fn(),
      publishRemovedRoots
    })).rejects.toThrow('preference failed')

    queuedRunObservations.push(coreAccess)
    expect(queuedRunObservations).toEqual(['removed', 'removed'])
    expect(publishRemovedRoots).not.toHaveBeenCalled()
  })

  it('re-suspends Core before rolling back a failed activation', async () => {
    const events: string[] = []
    const previousSnapshot = {
      removedProjects: [{
        targetKey: 'directory:/Downloads',
        removedAt: '2026-08-25T00:00:00.000Z'
      }]
    }
    const publishedSnapshots: unknown[] = []

    await expect(restoreProjectAccessFailClosed({
      previousSnapshot,
      restorationRequired: true,
      persistRestoredPreference: async () => {
        events.push('preference:restore')
        return { removedProjects: [] }
      },
      activateExecutionRoot: async () => {
        events.push('core:activate')
        throw new Error('activation failed')
      },
      suspendExecutionRoot: async () => { events.push('core:suspend') },
      persistPreviousPreference: async () => {
        events.push('preference:rollback-exact')
        return previousSnapshot
      },
      publishRemovedRoots: (snapshot) => {
        events.push('launch-args:publish')
        publishedSnapshots.push(snapshot)
      }
    })).rejects.toThrow('activation failed')

    expect(events).toEqual([
      'preference:restore',
      'core:activate',
      'core:suspend',
      'preference:rollback-exact',
      'launch-args:publish'
    ])
    expect(publishedSnapshots).toEqual([previousSnapshot])
  })
})
