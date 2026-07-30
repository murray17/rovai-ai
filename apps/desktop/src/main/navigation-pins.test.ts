import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readNavigationPins, writeNavigationPins } from './navigation-pins'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('navigation pins', () => {
  it('persists ordered application-level pins atomically', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rovai-navigation-pins-'))
    cleanup.push(directory)
    const filePath = join(directory, 'navigation.json')

    const snapshot = await writeNavigationPins(filePath, [
      { kind: 'project', targetKey: 'directory:/work/b', pinnedAt: '2026-07-30T12:00:00Z' },
      { kind: 'camp', targetKey: 'camp-a', pinnedAt: '2026-07-30T10:00:00Z' }
    ])

    expect(snapshot.pins.map((pin) => pin.targetKey)).toEqual(['camp-a', 'directory:/work/b'])
    await expect(readNavigationPins(filePath)).resolves.toEqual(snapshot)
  })

  it('removes malformed and duplicate records and persists the cleanup', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rovai-navigation-pins-'))
    cleanup.push(directory)
    const filePath = join(directory, 'navigation.json')
    await writeFile(filePath, JSON.stringify({
      schemaVersion: 1,
      pins: [
        { kind: 'camp', targetKey: 'camp-a', pinnedAt: '2026-07-30T10:00:00Z' },
        { kind: 'camp', targetKey: 'camp-a', pinnedAt: '2026-07-30T11:00:00Z' },
        { kind: 'project', targetKey: '', pinnedAt: 'invalid' }
      ]
    }))

    const snapshot = await readNavigationPins(filePath)

    expect(snapshot.pins).toHaveLength(1)
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual(snapshot)
  })
})
