import { stat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
  it('keeps v6 read-only until a real move, preserves pinned slots, and restores order after restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rovai-project-order-'))
    cleanup.push(directory)
    const file = join(directory, 'navigation.json')
    const paths = ['/one/app', '/pinned', '/two/app', '/c']
    const [a, p, b, c] = paths.map(path => `directory:${path}`)
    const legacy = { schemaVersion: 6, registeredProjects: paths, legacyProjectsSynced: true,
      projectOrder: [a, p, b, c], pins: [{ kind: 'project', targetKey: p, pinnedAt: '2026-10-01T00:00:00Z' }],
      projectNames: { [a]: 'app', [b]: 'app' }, removedProjects: [], threadReadStates: {} }
    const original = JSON.stringify(legacy)
    await writeFile(file, original)
    const store = await NavigationPreferencesStore.load(file)
    expect(store.loadDegradation).toBeNull()
    await store.moveProject({ section: 'projects', projectKey: a, beforeProjectKey: b })
    expect(await readFile(file, 'utf8')).toBe(original)
    const move = { section: 'projects' as const, projectKey: c, beforeProjectKey: a }
    await Promise.all([store.registerProjects(['/added']), store.moveProject(move)])
    const saved = { ...legacy, schemaVersion: 7, pinnedProjectOrder: [], registeredProjects: [...paths, '/added'],
      projectOrder: [c, p, a, b, 'directory:/added'] }
    expect((await NavigationPreferencesStore.load(file)).get()).toEqual(saved)
    const inode = (await stat(file)).ino
    await store.moveProject(move)
    await store.moveProject({ ...move, beforeProjectKey: p })
    await store.moveProject({ ...move, projectKey: 'directory:/gone' })
    expect((await stat(file)).ino).toBe(inode)
  })

  it('moves pinned folders independently and appends a re-pinned folder in pin-time order', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rovai-project-pins-'))
    cleanup.push(directory)
    const file = join(directory, 'navigation.json')
    const store = NavigationPreferencesStore.defaults(file)
    const paths = ['/a', '/b', '/c']
    const keys = paths.map(path => `directory:${path}`)
    const [a, b, c] = keys
    const pins = keys.map((targetKey, i) => ({ kind: 'project' as const, targetKey, pinnedAt: `2026-10-01T00:00:0${i}Z` }))
    await store.registerProjects(paths)
    await store.replacePins(pins)
    const partial = JSON.stringify({ ...store.get(), pinnedProjectOrder: [a, 'directory:/gone', a] })
    await writeFile(file, partial)
    const reloaded = await NavigationPreferencesStore.load(file)
    expect(reloaded.loadDegradation).toBeNull()
    expect(reloaded.get().pinnedProjectOrder).toEqual([a])
    expect(await readFile(file, 'utf8')).toBe(partial)
    await store.moveProject({ section: 'pinned', projectKey: c, beforeProjectKey: a })
    expect((await NavigationPreferencesStore.load(file)).get()).toMatchObject({ projectOrder: keys, pinnedProjectOrder: [c, a, b], pins })
    await store.replacePins(pins.slice(0, 2))
    await store.replacePins([...pins.slice(0, 2), { ...pins[2], pinnedAt: '2026-11-01T00:00:00Z' }])
    expect(store.get().pinnedProjectOrder).toEqual([a, b])
    await store.moveProject({ section: 'pinned', projectKey: c, beforeProjectKey: b })
    await store.removeProject(a, [])
    expect(store.get().pinnedProjectOrder).toEqual([c, b])
  })

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
    expect(store.get()).toEqual({ schemaVersion: 7, pinnedProjectOrder: [], registeredProjects: [], legacyProjectsSynced: false, pins: [], removedProjects: [], projectOrder: ['directory:/a/frontend'], projectNames: {}, threadReadStates: {} })
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
      store.registerProjects(['/a/frontend', '/b/frontend'])
    ])
    const names = { [first]: '官网 前端', [second]: '后台前端' }
    expect(store.get()).toMatchObject({ projectNames: names, pins, projectOrder: [first, second] })
    await store.removeProject(first, [])
    await store.restoreProject(first)
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
      schemaVersion: 7, pinnedProjectOrder: [], registeredProjects: [], legacyProjectsSynced: false,
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
    expect(store.get()).toMatchObject(snapshot)
    expect(store.get().readError).toBeTruthy()
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
    await store.registerProjects(['/work/a', '/work/b'])

    const snapshot = await store.removeProject('directory:/work/a', [CAMP_A])

    expect(snapshot).toEqual({
      schemaVersion: 7, pinnedProjectOrder: [], registeredProjects: ['/work/b'], legacyProjectsSynced: false,
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
      schemaVersion: 7, pinnedProjectOrder: [], registeredProjects: ['/work/a'], legacyProjectsSynced: false,
      projectNames: {},
      threadReadStates: {},
      pins: [{ kind: 'camp', targetKey: CAMP_B, pinnedAt: '2026-08-11T07:03:00Z' }],
      removedProjects: [],
      projectOrder: ['directory:/work/b', 'directory:/work/a']
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
      schemaVersion: 7, pinnedProjectOrder: [], registeredProjects: [], legacyProjectsSynced: false,
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

  it('retains legacy order and changes membership only through directory operations', async () => {
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

    const initialized = await store.registerProjects(['/work/b', '/work/a'], true)
    expect(initialized.projectOrder).toEqual([
      'directory:/work/b',
      'directory:/work/a'
    ])
    const initializedBytes = await readFile(filePath, 'utf8')

    const activitySynchronized = await store.registerProjects(['/work/a', '/work/b'], true)
    expect(activitySynchronized.projectOrder).toEqual([
      'directory:/work/b',
      'directory:/work/a'
    ])
    expect(await readFile(filePath, 'utf8')).toBe(initializedBytes)

    const discovered = await store.registerProjects(['/work/c'])
    expect(discovered.projectOrder).toEqual([
      'directory:/work/b',
      'directory:/work/a',
      'directory:/work/c'
    ])

    const synchronized = await store.removeProject('directory:/work/b', [])
    expect(synchronized).toEqual({
      schemaVersion: 7, pinnedProjectOrder: [], registeredProjects: ['/work/a', '/work/c'], legacyProjectsSynced: true,
      projectNames: {},
      threadReadStates: {},
      pins: [],
      removedProjects: [{ targetKey: 'directory:/work/b', removedAt: expect.any(String) }],
      projectOrder: ['directory:/work/a', 'directory:/work/c']
    })
    await expect(readNavigationPreferences(filePath)).resolves.toEqual(synchronized)
  })

  it('deduplicates canonical directories and rejects invalid paths without changing the saved order', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rovai-navigation-preferences-'))
    cleanup.push(directory)
    const filePath = join(directory, 'navigation.json')
    const store = await NavigationPreferencesStore.load(filePath)
    await store.registerProjects(['/work/a', '/work/a'])
    await expect(store.registerProjects(['quick-chat'])).rejects.toThrow('Invalid project directories')
    await expect(store.registerProjects(['/work/../a'])).rejects.toThrow('Invalid project directories')
    expect(store.get().registeredProjects).toEqual(['/work/a'])
    expect(store.get().projectOrder).toEqual(['directory:/work/a'])
  })
})

// This owner exercises the real atomic file writer, not an in-memory substitute.
it('saves empty directories and the legacy marker once while preserving names, pins, ordering and removals', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rovai-directory-json-'))
  cleanup.push(directory)
  const path = join(directory, 'navigation.json')
  const original = { schemaVersion: 5, pins: [{ kind: 'project', targetKey: 'directory:/a', pinnedAt: '2026-10-01T00:00:00Z' }],
    removedProjects: [{ targetKey: 'directory:/removed', removedAt: '2026-10-01T00:00:00Z' }],
    projectOrder: ['directory:/b', 'directory:/a'], projectNames: { 'directory:/a': '官网', 'directory:/alias-only': '历史名称' },
    threadReadStates: { [CAMP_A]: { manualUnread: true, readThroughGlobalSequence: 22 } } }
  await writeFile(path, JSON.stringify(original))
  const store = await NavigationPreferencesStore.load(path)
  expect(store.get().legacyProjectsSynced).toBe(false)
  await Promise.all([store.registerProjects(['/a', '/empty']), store.removeProject('directory:/b', []), store.registerProjects(['/b', '/a', '/removed'], true)])
  let snapshot = (await NavigationPreferencesStore.load(path)).get()
  expect(snapshot.registeredProjects).toEqual(['/a', '/empty'])
  expect(snapshot.legacyProjectsSynced).toBe(true)
  expect(snapshot.projectNames).toEqual(original.projectNames)
  expect(snapshot.pins).toEqual(original.pins)
  expect(snapshot.threadReadStates).toEqual(original.threadReadStates)
  const timestamp = (await stat(path)).mtimeMs
  await store.registerProjects(['/a'])
  await store.registerProjects(['/late-legacy'], true)
  expect((await stat(path)).mtimeMs).toBe(timestamp)
  await store.registerProjects(['/new'])
  await store.restoreProject('directory:/b')
  snapshot = store.get()
  expect(snapshot.registeredProjects).toEqual(['/a', '/empty', '/new', '/b'])
  for (const project of snapshot.registeredProjects) await store.removeProject(`directory:${project}`, [])
  await store.registerProjects(['/a', '/empty'], true)
  expect((await NavigationPreferencesStore.load(path)).get()).toMatchObject({ registeredProjects: [], legacyProjectsSynced: true })
})

it('never completes or overwrites unreadable preferences and retries only an explicit write against repaired storage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rovai-directory-json-'))
  cleanup.push(directory)
  const path = join(directory, 'navigation.json')
  const corrupt = '{"projectNames": '
  await writeFile(path, corrupt)
  const store = await NavigationPreferencesStore.load(path)
  await expect(store.registerProjects(['/a'], true)).rejects.toThrow()
  await expect(store.setProjectName('directory:/a', 'new')).rejects.toThrow()
  expect(store.get()).toMatchObject({ legacyProjectsSynced: false, registeredProjects: [] })
  expect(await readFile(path, 'utf8')).toBe(corrupt)
  await rm(path)
  await store.registerProjects([], true)
  expect((await NavigationPreferencesStore.load(path)).get()).toMatchObject({ registeredProjects: [], legacyProjectsSynced: true })
  // A later save failure must not reopen migration or publish the unsaved path.
  await rm(path)
  await mkdir(path)
  await expect(store.registerProjects(['/later'])).rejects.toThrow()
  expect(store.get()).toMatchObject({ registeredProjects: [], legacyProjectsSynced: true })
})
