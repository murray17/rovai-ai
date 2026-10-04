import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
  it('upgrades valid schema 4 without a degradation or rewriting the old file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rovai-navigation-read-'))
    cleanup.push(directory)
    const path = join(directory, 'navigation.json')
    const original = JSON.stringify({ schemaVersion: 4, pins: [], removedProjects: [], projectOrder: [], projectNames: {} })
    await writeFile(path, original)
    const store = await NavigationPreferencesStore.load(path)
    expect(store.loadDegradation).toBeNull()
    expect(store.get().threadReadStates).toEqual({})
    expect(await readFile(path, 'utf8')).toBe(original)
  })

  it('persists manual reminders, merges concurrent pin writes and keeps read boundaries monotonic', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rovai-navigation-read-'))
    cleanup.push(directory)
    const path = join(directory, 'navigation.json')
    const store = NavigationPreferencesStore.defaults(path)
    await Promise.all([
      store.setThreadReadState(CAMP_A, { manualUnread: true, readThroughGlobalSequence: 20 }),
      store.replacePins([{ kind: 'camp', targetKey: CAMP_A, pinnedAt: '2026-10-01T00:00:00Z' }]),
      store.setThreadReadState(CAMP_B, { manualUnread: false, readThroughGlobalSequence: 12 })
    ])
    const restarted = await NavigationPreferencesStore.load(path)
    expect(restarted.loadDegradation).toBeNull()
    expect(restarted.get().threadReadStates[CAMP_A].manualUnread).toBe(true)
    expect(restarted.get().pins).toHaveLength(1)
    await restarted.setThreadReadState(CAMP_A, { manualUnread: false, readThroughGlobalSequence: 3 })
    expect(restarted.get().threadReadStates[CAMP_A]).toEqual({ manualUnread: false, readThroughGlobalSequence: 20 })
    await restarted.setThreadReadState(CAMP_B, null)
    expect(restarted.get().threadReadStates[CAMP_B]).toBeUndefined()
  })

  it('rejects invalid read state and retains the previous snapshot when saving fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rovai-navigation-read-'))
    cleanup.push(directory)
    const path = join(directory, 'navigation.json')
    const store = NavigationPreferencesStore.defaults(path)
    for (const sequence of [-1, NaN, Infinity, 1.5]) {
      await expect(store.setThreadReadState(CAMP_A, { manualUnread: true, readThroughGlobalSequence: sequence })).rejects.toThrow()
    }
    await expect(store.setThreadReadState('invalid', { manualUnread: true, readThroughGlobalSequence: 0 })).rejects.toThrow()
    await mkdir(path)
    await expect(store.setThreadReadState(CAMP_A, { manualUnread: true, readThroughGlobalSequence: 0 })).rejects.toThrow()
    expect(store.get().threadReadStates).toEqual({})
    await rm(path, { recursive: true })
    await store.setThreadReadState(CAMP_A, { manualUnread: true, readThroughGlobalSequence: 0 })
    expect((await readNavigationPreferences(path)).threadReadStates[CAMP_A].manualUnread).toBe(true)
  })

  it('upgrades valid schema 3 without a degradation or rewriting the old file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rovai-project-name-'))
    cleanup.push(directory)
    const filePath = join(directory, 'navigation.json')
    const source = JSON.stringify({ schemaVersion: 3, pins: [], removedProjects: [], projectOrder: ['directory:/a/frontend'] })
    await writeFile(filePath, source)
    const store = await NavigationPreferencesStore.load(filePath)
    expect(store.loadDegradation).toBeNull()
    expect(store.get()).toEqual({ schemaVersion: 5, pins: [], removedProjects: [], projectOrder: ['directory:/a/frontend'], projectNames: {}, threadReadStates: {} })
    expect(await readFile(filePath, 'utf8')).toBe(source)
  })

  it('serializes independent names with pin and order writes and retains names across removal', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rovai-project-name-'))
    cleanup.push(directory)
    const filePath = join(directory, 'navigation.json')
    const store = await NavigationPreferencesStore.load(filePath)
    const first = 'directory:/a/frontend', second = 'directory:/b/frontend'
    const pins = [{ kind: 'camp' as const, targetKey: CAMP_A, pinnedAt: '2026-09-10T00:00:00Z' }]
    await Promise.all([
      store.setProjectName(first, '  官网  前端  '),
      store.replacePins(pins),
      store.setProjectName(second, '后台前端'),
      store.synchronizeProjectOrder([first, second])
    ])
    const names = { [first]: '官网 前端', [second]: '后台前端' }
    expect(store.get()).toMatchObject({ projectNames: names, pins, projectOrder: [first, second] })
    await store.removeProject(first, [])
    await store.restoreProject(first)
    await store.synchronizeProjectOrder([first, second])
    const reloaded = await NavigationPreferencesStore.load(filePath)
    expect(reloaded.loadDegradation).toBeNull()
    expect(reloaded.get().projectNames).toEqual(names)
    expect(reloaded.get().pins).toEqual(pins)
    await reloaded.setProjectName(first, null)
    expect((await readNavigationPreferences(filePath)).projectNames).toEqual({ [second]: '后台前端' })
  })

  it('rejects invalid names and counts Unicode scalars while permitting duplicate display names', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rovai-project-name-'))
    cleanup.push(directory)
    const filePath = join(directory, 'navigation.json')
    const store = await NavigationPreferencesStore.load(filePath)
    await expect(store.setProjectName('quick-chat', '名称')).rejects.toThrow()
    await expect(store.setProjectName('directory:/a', '   ')).rejects.toThrow('请输入项目名称')
    await expect(store.setProjectName('directory:/a', '🌻'.repeat(81))).rejects.toThrow('80')
    await store.setProjectName('directory:/a', '🌻'.repeat(80))
    await store.setProjectName('directory:/b', '🌻'.repeat(80))
    expect(Object.values((await readNavigationPreferences(filePath)).projectNames)).toEqual(['🌻'.repeat(80), '🌻'.repeat(80)])
  })

  it('keeps the previous snapshot on a write failure and allows a later retry', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rovai-project-name-'))
    cleanup.push(directory)
    const filePath = join(directory, 'navigation.json')
    const store = NavigationPreferencesStore.defaults(filePath)
    await mkdir(filePath)
    await expect(store.setProjectName('directory:/a', '新名称')).rejects.toThrow()
    expect(store.get().projectNames).toEqual({})
    await rm(filePath, { recursive: true })
    await store.setProjectName('directory:/a', '新名称')
    expect((await readNavigationPreferences(filePath)).projectNames).toEqual({ 'directory:/a': '新名称' })
  })

  it('normalizes damaged name records only in memory and preserves other preferences', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rovai-project-name-'))
    cleanup.push(directory)
    const filePath = join(directory, 'navigation.json')
    const source = JSON.stringify({ schemaVersion: 4, pins: [], removedProjects: [], projectOrder: ['directory:/a'],
      projectNames: { 'directory:/a': '  项目  A ', 'quick-chat': '非法', 'directory:/b': '', 'directory:/c': 3 } })
    await writeFile(filePath, source)
    const store = await NavigationPreferencesStore.load(filePath)
    expect(store.loadDegradation?.code).toBe('navigation_preferences_invalid')
    expect(store.get().projectNames).toEqual({ 'directory:/a': '项目 A' })
    expect(store.get().projectOrder).toEqual(['directory:/a'])
    expect(await readFile(filePath, 'utf8')).toBe(source)
  })

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
      schemaVersion: 5,
      projectNames: {},
      threadReadStates: {},
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

  it('removes one project locally and atomically clears its Project and Thread pins', async () => {
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
      schemaVersion: 5,
      projectNames: {},
      threadReadStates: {},
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
      schemaVersion: 5,
      projectNames: {},
      threadReadStates: {},
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
      schemaVersion: 5,
      projectNames: {},
      threadReadStates: {},
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
      schemaVersion: 5,
      projectNames: {},
      threadReadStates: {},
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
