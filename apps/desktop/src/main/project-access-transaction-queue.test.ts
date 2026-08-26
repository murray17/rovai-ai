import { describe, expect, it } from 'vitest'
import {
  ProjectAccessTransactionCoordinator,
  removedProjectRootsFromSnapshot,
  restoreProjectAccessFailClosed
} from './project-access-restore'

describe('Project access transaction coordination', () => {
  it('serializes complete restore transactions before publishing the next restart fence', async () => {
    const coordinator = new ProjectAccessTransactionCoordinator()
    const events: string[] = []
    let releaseFirst!: () => void
    let markFirstStarted!: () => void
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve })
    let storedSnapshot = {
      removedProjects: [
        { targetKey: 'directory:/root-a', removedAt: 'removed-a' },
        { targetKey: 'directory:/root-b', removedAt: 'removed-b' }
      ]
    }

    const restore = (root: '/root-a' | '/root-b', gate?: Promise<void>): Promise<unknown> =>
      coordinator.run(async () => {
        const previousSnapshot = structuredClone(storedSnapshot)
        const removed = previousSnapshot.removedProjects.find(
          (project) => project.targetKey === `directory:${root}`
        )
        return restoreProjectAccessFailClosed({
          previousSnapshot,
          restorationRequired: Boolean(removed),
          persistRestoredPreference: async () => {
            events.push(`${root}:preference`)
            storedSnapshot = {
              removedProjects: storedSnapshot.removedProjects.filter(
                (project) => project.targetKey !== `directory:${root}`
              )
            }
            return structuredClone(storedSnapshot)
          },
          activateExecutionRoot: async () => {
            events.push(`${root}:core`)
            if (gate) {
              markFirstStarted()
              await gate
            }
          },
          suspendExecutionRoot: async () => undefined,
          persistPreviousPreference: async () => {
            storedSnapshot = previousSnapshot
            return structuredClone(storedSnapshot)
          },
          publishRemovedRoots: (snapshot) => {
            events.push(`${root}:publish:${removedProjectRootsFromSnapshot(snapshot).join(',')}`)
          }
        })
      })

    const first = restore('/root-a', firstGate)
    await firstStarted
    const second = restore('/root-b')
    await Promise.resolve()

    expect(events).toEqual(['/root-a:preference', '/root-a:core'])
    releaseFirst()
    await Promise.all([first, second])
    expect(events).toEqual([
      '/root-a:preference',
      '/root-a:core',
      '/root-a:publish:/root-b',
      '/root-b:preference',
      '/root-b:core',
      '/root-b:publish:'
    ])
  })

  it('derives Core restart fences from the committed transaction snapshot', () => {
    expect(removedProjectRootsFromSnapshot({
      schemaVersion: 2,
      pins: [],
      removedProjects: [
        { targetKey: 'directory:/root-b', removedAt: '2026-08-25T00:00:00.000Z' },
        { targetKey: 'settings', removedAt: '2026-08-25T00:00:01.000Z' }
      ]
    })).toEqual(['/root-b'])
  })
})
