import { describe, expect, it, vi } from 'vitest'
import { restoreProjectAccessFailClosed } from './project-access-restore'

describe('removed Project access restoration', () => {
  it('keeps a queued Run suspended until the restored preference is durable', async () => {
    let durablePreference: 'removed' | 'active' = 'removed'
    let coreAccess: 'removed' | 'active' = 'removed'
    const queuedRunObservations: string[] = []
    const events: string[] = []

    const snapshot = await restoreProjectAccessFailClosed({
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
      persistRemovedPreference: async () => ({ removedProjects: ['directory:/Downloads'] }),
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

    await expect(restoreProjectAccessFailClosed({
      persistRestoredPreference: async () => {
        queuedRunObservations.push(coreAccess)
        throw new Error('preference failed')
      },
      activateExecutionRoot: async () => { coreAccess = 'active' },
      suspendExecutionRoot: vi.fn(),
      persistRemovedPreference: vi.fn(),
      publishRemovedRoots
    })).rejects.toThrow('preference failed')

    queuedRunObservations.push(coreAccess)
    expect(queuedRunObservations).toEqual(['removed', 'removed'])
    expect(publishRemovedRoots).not.toHaveBeenCalled()
  })

  it('re-suspends Core before rolling back a failed activation', async () => {
    const events: string[] = []

    await expect(restoreProjectAccessFailClosed({
      persistRestoredPreference: async () => {
        events.push('preference:restore')
        return { removedProjects: [] }
      },
      activateExecutionRoot: async () => {
        events.push('core:activate')
        throw new Error('activation failed')
      },
      suspendExecutionRoot: async () => { events.push('core:suspend') },
      persistRemovedPreference: async () => {
        events.push('preference:rollback')
        return { removedProjects: ['directory:/Downloads'] }
      },
      publishRemovedRoots: () => { events.push('launch-args:publish') }
    })).rejects.toThrow('activation failed')

    expect(events).toEqual([
      'preference:restore',
      'core:activate',
      'core:suspend',
      'preference:rollback',
      'launch-args:publish'
    ])
  })
})
