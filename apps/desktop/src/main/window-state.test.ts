import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  defaultWindowBounds,
  readWindowStateFile,
  resetWindowBounds,
  sanitizeWindowState,
  windowResetCapability,
  writeWindowStateFile
} from './window-state'

const primary = { x: 0, y: 0, width: 2560, height: 1415 }
const displays = [primary]
const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('window state', () => {
  it('keeps a valid size and clamps the full window into its display work area', () => {
    expect(sanitizeWindowState({
      schemaVersion: 1,
      width: 2100.4,
      height: 1300,
      x: 1200,
      y: 600
    }, displays, 1040, 700, primary)).toEqual({ width: 2100, height: 1300, x: 460, y: 115 })
  })

  it('chooses the display with the largest intersection, including negative coordinates', () => {
    const left = { x: -1920, y: -180, width: 1920, height: 1080 }
    expect(sanitizeWindowState({
      schemaVersion: 1,
      width: 1440,
      height: 920,
      x: -1700,
      y: -120
    }, [primary, left], 1040, 700, primary)).toEqual({
      width: 1440,
      height: 920,
      x: -1700,
      y: -120
    })
  })

  it('uses constrained default bounds centered on primary for invalid or removed displays', () => {
    const expected = defaultWindowBounds(primary, 1040, 700)
    expect(sanitizeWindowState({ width: 900, height: 800 }, displays, 1040, 700, primary)).toEqual(expected)
    expect(sanitizeWindowState({
      schemaVersion: 1,
      width: 1440,
      height: 920,
      x: 9000,
      y: 40
    }, displays, 1040, 700, primary)).toEqual(expected)
    expect(sanitizeWindowState(null, displays, 1040, 700, primary)).toEqual(expected)
  })

  it('constrains the default and oversized saved bounds to a small work area', () => {
    const small = { x: 80, y: 40, width: 1200, height: 760 }
    expect(defaultWindowBounds(small, 1040, 700)).toEqual({
      width: 1200,
      height: 760,
      x: 80,
      y: 40
    })
    expect(sanitizeWindowState({
      schemaVersion: 1,
      width: 4000,
      height: 3000,
      x: 90,
      y: 50
    }, [small], 1040, 700, small)).toEqual({ width: 1200, height: 760, x: 80, y: 40 })
  })

  it('persists atomically with private permissions and restores through the reader', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rovai-window-'))
    cleanup.push(directory)
    const filePath = join(directory, 'window-state.json')

    await writeWindowStateFile(filePath, { width: 1800, height: 1100, x: 40, y: 30 })

    expect(sanitizeWindowState(readWindowStateFile(filePath), displays, 1040, 700, primary))
      .toEqual({ width: 1800, height: 1100, x: 40, y: 30 })
    expect(JSON.parse(await readFile(filePath, 'utf8')).schemaVersion).toBe(1)
    expect(readWindowStateFile(join(directory, 'missing.json'))).toBeNull()
  })

  it('resets to exact centered defaults on the current display', async () => {
    let applied = null
    let persisted = null
    const result = await resetWindowBounds({
      isFullScreen: () => false,
      setBounds: (bounds) => { applied = bounds }
    }, primary, 1040, 700, async (bounds) => { persisted = bounds })
    expect(result).toEqual({ performed: true, reason: null })
    expect(applied).toEqual(defaultWindowBounds(primary, 1040, 700))
    expect(persisted).toEqual(applied)
    expect(windowResetCapability(false)).toEqual({ canReset: true, reason: null })
  })

  it('does not apply or queue a reset while fullscreen', async () => {
    let mutations = 0
    const result = await resetWindowBounds({
      isFullScreen: () => true,
      setBounds: () => { mutations += 1 }
    }, primary, 1040, 700, async () => { mutations += 1 })
    expect(result).toEqual({ performed: false, reason: 'fullscreen' })
    expect(windowResetCapability(true)).toEqual({ canReset: false, reason: 'fullscreen' })
    expect(mutations).toBe(0)
  })
})
