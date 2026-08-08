import { randomUUID } from 'node:crypto'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface StoredWindowState {
  width: number
  height: number
  x: number
  y: number
}

export interface DisplayArea {
  x: number
  y: number
  width: number
  height: number
}

export const DEFAULT_WINDOW_WIDTH = 1440
export const DEFAULT_WINDOW_HEIGHT = 920

export interface ResettableWindow {
  isFullScreen(): boolean
  setBounds(bounds: StoredWindowState): void
}

export function sanitizeWindowState(
  raw: unknown,
  displays: DisplayArea[],
  minWidth: number,
  minHeight: number,
  primaryDisplay: DisplayArea | null = displays[0] ?? null
): StoredWindowState {
  const fallbackDisplay = primaryDisplay ?? displays[0] ?? null
  const parsed = parseWindowState(raw, minWidth, minHeight)
  if (!parsed || displays.length === 0 || !fallbackDisplay) {
    return defaultWindowBounds(fallbackDisplay, minWidth, minHeight)
  }

  const target = displayWithLargestIntersection(parsed, displays)
  if (!target) return defaultWindowBounds(fallbackDisplay, minWidth, minHeight)
  return clampWindowBounds(parsed, target, minWidth, minHeight)
}

export function defaultWindowBounds(
  display: DisplayArea | null,
  minWidth: number,
  minHeight: number
): StoredWindowState {
  if (!display) {
    return { width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT, x: 0, y: 0 }
  }
  const width = constrainedDimension(DEFAULT_WINDOW_WIDTH, display.width, minWidth)
  const height = constrainedDimension(DEFAULT_WINDOW_HEIGHT, display.height, minHeight)
  return {
    width,
    height,
    x: Math.round(display.x + (display.width - width) / 2),
    y: Math.round(display.y + (display.height - height) / 2)
  }
}

export function displayWithLargestIntersection(
  bounds: StoredWindowState,
  displays: DisplayArea[]
): DisplayArea | null {
  let best: DisplayArea | null = null
  let bestArea = 0
  for (const display of displays) {
    const area = intersectionArea(bounds, display)
    if (area > bestArea) {
      bestArea = area
      best = display
    }
  }
  return best
}

export function clampWindowBounds(
  bounds: StoredWindowState,
  display: DisplayArea,
  minWidth: number,
  minHeight: number
): StoredWindowState {
  const width = constrainedDimension(bounds.width, display.width, minWidth)
  const height = constrainedDimension(bounds.height, display.height, minHeight)
  return {
    width,
    height,
    x: clamp(Math.round(bounds.x), display.x, display.x + display.width - width),
    y: clamp(Math.round(bounds.y), display.y, display.y + display.height - height)
  }
}

export function windowResetCapability(isFullScreen: boolean): {
  canReset: boolean
  reason: 'fullscreen' | null
} {
  return isFullScreen
    ? { canReset: false, reason: 'fullscreen' }
    : { canReset: true, reason: null }
}

export async function resetWindowBounds(
  window: ResettableWindow,
  display: DisplayArea,
  minWidth: number,
  minHeight: number,
  persist: (bounds: StoredWindowState) => Promise<void>
): Promise<{ performed: boolean; reason: 'fullscreen' | null }> {
  if (window.isFullScreen()) return { performed: false, reason: 'fullscreen' }
  const bounds = defaultWindowBounds(display, minWidth, minHeight)
  window.setBounds(bounds)
  await persist(bounds)
  return { performed: true, reason: null }
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
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  await mkdir(dirname(filePath), { recursive: true })
  try {
    await writeFile(tempPath, `${JSON.stringify({ schemaVersion: 1, ...state }, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx'
    })
    await rename(tempPath, filePath)
  } catch (error) {
    await unlink(tempPath).catch(() => undefined)
    throw error
  }
}

function parseWindowState(
  value: unknown,
  minWidth: number,
  minHeight: number
): StoredWindowState | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const expected = ['height', 'schemaVersion', 'width', 'x', 'y']
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return null
  if (record.schemaVersion !== 1) return null
  if (!finiteAtLeast(record.width, minWidth) || !finiteAtLeast(record.height, minHeight)) return null
  if (!finiteNumber(record.x) || !finiteNumber(record.y)) return null
  return {
    width: Math.round(record.width),
    height: Math.round(record.height),
    x: Math.round(record.x),
    y: Math.round(record.y)
  }
}

function intersectionArea(bounds: StoredWindowState, display: DisplayArea): number {
  const width = Math.max(0, Math.min(bounds.x + bounds.width, display.x + display.width) - Math.max(bounds.x, display.x))
  const height = Math.max(0, Math.min(bounds.y + bounds.height, display.y + display.height) - Math.max(bounds.y, display.y))
  return width * height
}

function constrainedDimension(value: number, available: number, minimum: number): number {
  const upper = Math.max(1, Math.round(available))
  const lower = Math.min(Math.round(minimum), upper)
  return clamp(Math.round(value), lower, upper)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function finiteAtLeast(value: unknown, minimum: number): value is number {
  return finiteNumber(value) && value >= minimum
}
