import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface StoredWindowState {
  width: number
  height: number
  x?: number
  y?: number
}

export interface DisplayArea {
  x: number
  y: number
  width: number
  height: number
}

export function sanitizeWindowState(
  raw: unknown,
  displays: DisplayArea[],
  minWidth: number,
  minHeight: number
): StoredWindowState | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const width = record.width
  const height = record.height
  if (typeof width !== 'number' || !Number.isFinite(width) || width < minWidth) return null
  if (typeof height !== 'number' || !Number.isFinite(height) || height < minHeight) return null
  const state: StoredWindowState = {
    width: Math.round(width),
    height: Math.round(height)
  }
  const x = record.x
  const y = record.y
  if (
    typeof x === 'number' && Number.isFinite(x)
    && typeof y === 'number' && Number.isFinite(y)
    && displays.some((display) =>
      x + 80 > display.x && x + 80 < display.x + display.width
      && y + 20 > display.y && y + 40 < display.y + display.height
    )
  ) {
    state.x = Math.round(x)
    state.y = Math.round(y)
  }
  return state
}

export function readWindowStateFile(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as unknown
  } catch {
    return null
  }
}

export async function writeWindowStateFile(
  filePath: string,
  state: StoredWindowState
): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await mkdir(dirname(filePath), { recursive: true })
  try {
    await writeFile(tempPath, `${JSON.stringify({ schemaVersion: 1, ...state }, null, 2)}\n`, { mode: 0o600 })
    await rename(tempPath, filePath)
  } catch (error) {
    await unlink(tempPath).catch(() => undefined)
    throw error
  }
}
