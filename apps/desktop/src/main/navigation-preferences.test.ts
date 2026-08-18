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
  it('migrates legacy pins into the current application-level navigation snapshot', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rovai-navigation-preferences-'))
    cleanup.push(directory)
    const filePath = join(directory, 'navigation.json')
    await writeFile(filePath, JSON.stringify({
      schemaVersion: 1,
      pins: [
        { kind: 'project', targetKey: 'directory:/work/b', pinnedAt: '2026-07-30T12:00:00Z' },
        { kind: 'camp', targetKey: CAMP_A, pinnedAt: '2026-07-30T10:00:00Z' }
      ]
    }))

    const snapshot = await readNavigationPreferences(filePath)

    expect(snapshot).toEqual({
      schemaVersion: 2,
      pins: [
        { kind: 'camp', targetKey: CAMP_A, pinnedAt: '2026-07-30T10:00:00Z' },
        { kind: 'project', targetKey: 'directory:/work/b', pinnedAt: '2026-07-30T12:00:00Z' }
      ],
      removedProjects: []
    })
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual(snapshot)
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

    const snapshot = await store.removeProject('directory:/work/a', [CAMP_A])

    expect(snapshot).toEqual({
      schemaVersion: 2,
      pins: [
        { kind: 'project', targetKey: 'directory:/work/b', pinnedAt: '2026-08-11T07:01:00Z' },
        { kind: 'camp', targetKey: CAMP_B, pinnedAt: '2026-08-11T07:03:00Z' }
      ],
      removedProjects: [{
        targetKey: 'directory:/work/a',
        removedAt: '2026-08-11T08:00:00.000Z'
      }]
    })
    await expect(readNavigationPreferences(filePath)).resolves.toEqual(snapshot)
  })

  it('restores a removed project without changing the surviving pins', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rovai-navigation-preferences-'))
    cleanup.push(directory)
    const filePath = join(directory, 'navigation.json')
    await writeFile(filePath, JSON.stringify({
      schemaVersion: 2,
      pins: [{ kind: 'camp', targetKey: CAMP_B, pinnedAt: '2026-08-11T07:03:00Z' }],
      removedProjects: [{
        targetKey: 'directory:/work/a',
        removedAt: '2026-08-11T08:00:00.000Z'
      }]
    }))
    const store = await NavigationPreferencesStore.load(filePath)

    const snapshot = await store.restoreProject('directory:/work/a')

    expect(snapshot).toEqual({
      schemaVersion: 2,
      pins: [{ kind: 'camp', targetKey: CAMP_B, pinnedAt: '2026-08-11T07:03:00Z' }],
      removedProjects: []
    })
    await expect(readNavigationPreferences(filePath)).resolves.toEqual(snapshot)
  })

  it('cleans malformed, duplicate and non-directory records', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rovai-navigation-preferences-'))
    cleanup.push(directory)
    const filePath = join(directory, 'navigation.json')
    await writeFile(filePath, JSON.stringify({
      schemaVersion: 2,
      pins: [
        { kind: 'camp', targetKey: CAMP_A, pinnedAt: '2026-07-30T10:00:00Z' },
        { kind: 'camp', targetKey: CAMP_A, pinnedAt: '2026-07-30T11:00:00Z' },
        { kind: 'project', targetKey: '', pinnedAt: 'invalid' }
      ],
      removedProjects: [
        { targetKey: 'quick-chat', removedAt: '2026-08-11T08:00:00Z' },
        { targetKey: 'directory:/work/a', removedAt: '2026-08-11T08:01:00Z' },
        { targetKey: 'directory:/work/a', removedAt: '2026-08-11T08:02:00Z' }
      ]
    }))

    const snapshot = await readNavigationPreferences(filePath)

    expect(snapshot.pins).toHaveLength(1)
    expect(snapshot.removedProjects).toEqual([
      { targetKey: 'directory:/work/a', removedAt: '2026-08-11T08:01:00Z' }
    ])
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual(snapshot)
  })
})
