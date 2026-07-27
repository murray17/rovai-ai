import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  readWindowStateFile,
  sanitizeWindowState,
  writeWindowStateFile
} from './window-state'

const displays = [{ x: 0, y: 0, width: 2560, height: 1415 }]
const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('window state', () => {
  it('keeps a valid size and an on-screen position', () => {
    expect(sanitizeWindowState({ width: 2100.4, height: 1300, x: 120, y: 60 }, displays, 1040, 700))
      .toEqual({ width: 2100, height: 1300, x: 120, y: 60 })
  })

  it('rejects sizes below the window minimum and malformed payloads', () => {
    expect(sanitizeWindowState({ width: 900, height: 800 }, displays, 1040, 700)).toBeNull()
    expect(sanitizeWindowState({ width: 1440, height: 200 }, displays, 1040, 700)).toBeNull()
    expect(sanitizeWindowState('{}', displays, 1040, 700)).toBeNull()
    expect(sanitizeWindowState(null, displays, 1040, 700)).toBeNull()
  })

  it('drops an off-screen position but keeps the size', () => {
    expect(sanitizeWindowState({ width: 1440, height: 920, x: 9000, y: 40 }, displays, 1040, 700))
      .toEqual({ width: 1440, height: 920 })
  })

  it('persists atomically and restores through the reader', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rovai-window-'))
    cleanup.push(directory)
    const filePath = join(directory, 'window-state.json')

    await writeWindowStateFile(filePath, { width: 1800, height: 1100, x: 40, y: 30 })

    expect(sanitizeWindowState(readWindowStateFile(filePath), displays, 1040, 700))
      .toEqual({ width: 1800, height: 1100, x: 40, y: 30 })
    expect(JSON.parse(await readFile(filePath, 'utf8')).schemaVersion).toBe(1)
    expect(readWindowStateFile(join(directory, 'missing.json'))).toBeNull()
  })
})
