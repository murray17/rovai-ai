import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { RestorableLocation } from '@contracts'
import {
  RestorableLocationStore,
  parseRestorableLocation,
  readRestorableLocation
} from './restorable-location'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'rovai-restorable-location-'))
  cleanup.push(directory)
  return directory
}

describe('restorable location', () => {
  it.each<RestorableLocation>([
    { kind: 'quick_chat' },
    { kind: 'camp', campId: 'camp-1' },
    { kind: 'members', agentId: 'agent-1', tab: 'identity' },
    { kind: 'members', agentId: null, tab: 'runtime' },
    { kind: 'memory' }
  ])('accepts the stable location %j', (location) => {
    expect(parseRestorableLocation(location)).toEqual(location)
  })

  it('rejects settings, transient surfaces, unknown fields, invalid tabs, and unbounded IDs', () => {
    expect(parseRestorableLocation({ kind: 'settings' })).toBeNull()
    expect(parseRestorableLocation({ kind: 'notifications' })).toBeNull()
    expect(parseRestorableLocation({ kind: 'camp', campId: '' })).toBeNull()
    expect(parseRestorableLocation({ kind: 'camp', campId: 'a'.repeat(257) })).toBeNull()
    expect(parseRestorableLocation({ kind: 'memory', dialog: true })).toBeNull()
    expect(parseRestorableLocation({ kind: 'members', agentId: null, tab: 'activity' })).toBeNull()
  })

  it('distinguishes missing, damaged, and valid files without throwing', async () => {
    const directory = await temporaryDirectory()
    const filePath = join(directory, 'restorable-location.json')
    expect(await readRestorableLocation(filePath)).toEqual({ status: 'missing', location: null })
    await writeFile(filePath, '{broken')
    expect(await readRestorableLocation(filePath)).toEqual({ status: 'invalid', location: null })
    await writeFile(filePath, JSON.stringify({ schemaVersion: 1, location: { kind: 'memory' } }))
    expect(await readRestorableLocation(filePath)).toEqual({
      status: 'valid',
      location: { kind: 'memory' }
    })
  })

  it('serializes commits, persists the final stable target, and no-ops identical targets', async () => {
    const directory = await temporaryDirectory()
    const filePath = join(directory, 'restorable-location.json')
    const store = await RestorableLocationStore.load(filePath)

    await Promise.all([
      store.commit({ kind: 'camp', campId: 'camp-1' }),
      store.commit({ kind: 'members', agentId: 'agent-1', tab: 'runtime' }),
      store.commit({ kind: 'memory' })
    ])
    await store.commit({ kind: 'memory' })

    expect(store.get()).toEqual({ status: 'valid', location: { kind: 'memory' } })
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual({
      schemaVersion: 1,
      location: { kind: 'memory' }
    })
  })

  it('preserves the previous target and cleans temporary files when rename fails', async () => {
    const directory = await temporaryDirectory()
    const filePath = join(directory, 'restorable-location.json')
    await mkdir(filePath)
    const store = await RestorableLocationStore.load(filePath)

    await expect(store.commit({ kind: 'quick_chat' })).rejects.toBeInstanceOf(Error)
    expect(store.get()).toEqual({ status: 'invalid', location: null })
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})
