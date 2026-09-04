import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  NavigationPreferencesStore,
  readNavigationPreferences
} from './navigation-preferences'

const cleanup: string[] = []
const CAMP_A = 'rvcamp_01h47kvsy5fk1shh6w1g60eec0'
const CAMP_B = 'rvcamp_01h47kvsy5fk1shh6w1g60eec1'

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('navigation preferences', () => {
  it('normalizes legacy pins in memory without overwriting the source file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rovai-navigation-preferences-'))
    cleanup.push(directory)
    const filePath = join(directory, 'navigation.json')
    const persisted = {
      schemaVersion: 1,
      pins: [
        { kind: 'project', targetKey: 'directory:/work/b', pinnedAt: '2026-07-30T12:00:00Z' },
        { kind: 'camp', targetKey: CAMP_A, pinnedAt: '2026-07-30T10:00:00Z' }
      ]
    }
    await writeFile(filePath, JSON.stringify(persisted))

    const snapshot = await readNavigationPreferences(filePath)

    expect(snapshot).toEqual({
      schemaVersion: 3,
      pins: [
        { kind: 'camp', targetKey: CAMP_A, pinnedAt: '2026-07-30T10:00:00Z' },
        { kind: 'project', targetKey: 'directory:/work/b', pinnedAt: '2026-07-30T12:00:00Z' }
      ],
      removedProjects: [],
      projectOrder: null
    })
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual(persisted)
    const store = await NavigationPreferencesStore.load(filePath)
    expect(store.get()).toEqual(snapshot)
    expect(store.loadDegradation?.code).toBe('navigation_preferences_invalid')
  })

  it('removes one project locally and atomically clears its Project and Camp pins', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rovai-navigation-preferences-'))
    cleanup.push(directory)
    const filePath = join(directory, 'navigation.json')
    const store = await NavigationPreferencesStore.load(
      filePath,
      () => '2026-08-11T08:00:00.000Z'
    )
    await store.replacePins([
      { kind: 'project', targetKey: 'directory:/work/a', pinnedAt: '2026-08-11T07:00:00Z' },
      { kind: 'project', targetKey: 'directory:/work/b', pinnedAt: '2026-08-11T07:01:00Z' },
      { kind: 'camp', targetKey: CAMP_A, pinnedAt: '2026-08-11T07:02:00Z' },
      { kind: 'camp', targetKey: CAMP_B, pinnedAt: '2026-08-11T07:03:00Z' }
    ])
    await store.synchronizeProjectOrder(['directory:/work/a', 'directory:/work/b'])

    const snapshot = await store.removeProject('directory:/work/a', [CAMP_A])

    expect(snapshot).toEqual({
      schemaVersion: 3,
      pins: [
        { kind: 'project', targetKey: 'directory:/work/b', pinnedAt: '2026-08-11T07:01:00Z' },
        { kind: 'camp', targetKey: CAMP_B, pinnedAt: '2026-08-11T07:03:00Z' }
      ],
      removedProjects: [{
        targetKey: 'directory:/work/a',
        removedAt: '2026-08-11T08:00:00.000Z'
      }],
      projectOrder: ['directory:/work/b']
    })
    await expect(readNavigationPreferences(filePath)).resolves.toEqual(snapshot)
  })

  it('restores a removed project without changing the surviving pins', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rovai-navigation-preferences-'))
    cleanup.push(directory)
    const filePath = join(directory, 'navigation.json')
    await writeFile(filePath, JSON.stringify({
      schemaVersion: 3,
      pins: [{ kind: 'camp', targetKey: CAMP_B, pinnedAt: '2026-08-11T07:03:00Z' }],
      removedProjects: [{
        targetKey: 'directory:/work/a',
        removedAt: '2026-08-11T08:00:00.000Z'
      }],
      projectOrder: ['directory:/work/b']
    }))
    const store = await NavigationPreferencesStore.load(filePath)

    const snapshot = await store.restoreProject('directory:/work/a')

    expect(snapshot).toEqual({
      schemaVersion: 3,
      pins: [{ kind: 'camp', targetKey: CAMP_B, pinnedAt: '2026-08-11T07:03:00Z' }],
      removedProjects: [],
      projectOrder: ['directory:/work/b']
    })
    await expect(readNavigationPreferences(filePath)).resolves.toEqual(snapshot)
  })

  it('reinstates the exact removed record when a Core restore transaction rolls back', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rovai-navigation-preferences-'))
    cleanup.push(directory)
    const filePath = join(directory, 'navigation.json')
    const removedProject = {
      targetKey: 'directory:/work/a',
      removedAt: '2026-08-11T08:00:00.000Z'
    }
    await writeFile(filePath, JSON.stringify({
      schemaVersion: 3,
      pins: [{ kind: 'camp', targetKey: CAMP_B, pinnedAt: '2026-08-11T07:03:00Z' }],
      removedProjects: [removedProject],
      projectOrder: ['directory:/work/b']
    }))
    const store = await NavigationPreferencesStore.load(
      filePath,
      () => '2026-08-25T09:00:00.000Z'
    )

    await store.restoreProject(removedProject.targetKey)
    const snapshot = await store.reinstateRemovedProject(removedProject)

    expect(snapshot).toEqual({
      schemaVersion: 3,
      pins: [{ kind: 'camp', targetKey: CAMP_B, pinnedAt: '2026-08-11T07:03:00Z' }],
      removedProjects: [removedProject],
      projectOrder: ['directory:/work/b']
    })
    await expect(readNavigationPreferences(filePath)).resolves.toEqual(snapshot)
  })

  it('cleans malformed records in memory and leaves recovery evidence untouched', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rovai-navigation-preferences-'))
    cleanup.push(directory)
    const filePath = join(directory, 'navigation.json')
    const persisted = {
      schemaVersion: 3,
      pins: [
        { kind: 'camp', targetKey: CAMP_A, pinnedAt: '2026-07-30T10:00:00Z' },
        { kind: 'camp', targetKey: CAMP_A, pinnedAt: '2026-07-30T11:00:00Z' },
        { kind: 'project', targetKey: '', pinnedAt: 'invalid' }
      ],
      removedProjects: [
        { targetKey: 'quick-chat', removedAt: '2026-08-11T08:00:00Z' },
        { targetKey: 'directory:/work/a', removedAt: '2026-08-11T08:01:00Z' },
        { targetKey: 'directory:/work/a', removedAt: '2026-08-11T08:02:00Z' }
      ],
      projectOrder: [
        'directory:/work/b',
        'invalid',
        'directory:/work/b',
        'directory:/work/a'
      ]
    }
    await writeFile(filePath, JSON.stringify(persisted))

    const snapshot = await readNavigationPreferences(filePath)

    expect(snapshot.pins).toHaveLength(1)
    expect(snapshot.removedProjects).toEqual([
      { targetKey: 'directory:/work/a', removedAt: '2026-08-11T08:01:00Z' }
    ])
    expect(snapshot.projectOrder).toEqual(['directory:/work/b', 'directory:/work/a'])
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual(persisted)
    const store = await NavigationPreferencesStore.load(filePath)
    expect(store.loadDegradation?.code).toBe('navigation_preferences_invalid')
  })

  it('freezes the legacy Project order once and later only synchronizes membership', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rovai-navigation-preferences-'))
    cleanup.push(directory)
    const filePath = join(directory, 'navigation.json')
    await writeFile(filePath, JSON.stringify({
      schemaVersion: 2,
      pins: [],
      removedProjects: []
    }))
    const store = await NavigationPreferencesStore.load(filePath)
    expect(store.loadDegradation).toBeNull()

    const initialized = await store.synchronizeProjectOrder([
      'directory:/work/b',
      'directory:/work/a'
    ])
    expect(initialized.projectOrder).toEqual([
      'directory:/work/b',
      'directory:/work/a'
    ])
    const initializedBytes = await readFile(filePath, 'utf8')

    const activitySynchronized = await store.synchronizeProjectOrder([
      'directory:/work/a',
      'directory:/work/b'
    ])
    expect(activitySynchronized.projectOrder).toEqual([
      'directory:/work/b',
      'directory:/work/a'
    ])
    expect(await readFile(filePath, 'utf8')).toBe(initializedBytes)

    const discovered = await store.synchronizeProjectOrder([
      'directory:/work/a',
      'directory:/work/b',
      'directory:/work/c'
    ])
    expect(discovered.projectOrder).toEqual([
      'directory:/work/b',
      'directory:/work/a',
      'directory:/work/c'
    ])

    const synchronized = await store.synchronizeProjectOrder([
      'directory:/work/a',
      'directory:/work/c'
    ])
    expect(synchronized).toEqual({
      schemaVersion: 3,
      pins: [],
      removedProjects: [],
      projectOrder: ['directory:/work/a', 'directory:/work/c']
    })
    await expect(readNavigationPreferences(filePath)).resolves.toEqual(synchronized)
  })

  it('rejects duplicate or non-Project keys without changing the saved order', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rovai-navigation-preferences-'))
    cleanup.push(directory)
    const filePath = join(directory, 'navigation.json')
    const store = await NavigationPreferencesStore.load(filePath)
    await store.synchronizeProjectOrder(['directory:/work/a'])

    await expect(store.synchronizeProjectOrder([
      'directory:/work/a',
      'directory:/work/a'
    ])).rejects.toThrow('Project navigation keys are invalid')
    await expect(store.synchronizeProjectOrder(['quick-chat']))
      .rejects.toThrow('Project navigation keys are invalid')
    expect(store.get().projectOrder).toEqual(['directory:/work/a'])
  })
})
