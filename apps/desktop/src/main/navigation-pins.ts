import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { NavigationPin, NavigationPinsSnapshot } from '@contracts'

const EMPTY_SNAPSHOT: NavigationPinsSnapshot = { schemaVersion: 1, pins: [] }

export async function readNavigationPins(filePath: string): Promise<NavigationPinsSnapshot> {
  let source: unknown
  try {
    source = JSON.parse(await readFile(filePath, 'utf8')) as unknown
  } catch (error) {
    if (isMissingPathError(error)) return EMPTY_SNAPSHOT
    if (error instanceof SyntaxError) {
      await writeNavigationPins(filePath, [])
      return EMPTY_SNAPSHOT
    }
    throw error
  }

  const pins = sanitizePins(source)
  const snapshot = { schemaVersion: 1 as const, pins }
  if (JSON.stringify(source) !== JSON.stringify(snapshot)) {
    await writeNavigationPins(filePath, pins)
  }
  return snapshot
}

export async function writeNavigationPins(
  filePath: string,
  pins: NavigationPin[]
): Promise<NavigationPinsSnapshot> {
  const snapshot = { schemaVersion: 1 as const, pins: sanitizePins({ schemaVersion: 1, pins }) }
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await mkdir(dirname(filePath), { recursive: true })
  try {
    await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx'
    })
    await rename(temporaryPath, filePath)
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
  return snapshot
}

function sanitizePins(source: unknown): NavigationPin[] {
  if (!isRecord(source) || source.schemaVersion !== 1 || !Array.isArray(source.pins)) return []
  const seen = new Set<string>()
  const pins: NavigationPin[] = []
  for (const candidate of source.pins) {
    if (
      !isRecord(candidate)
      || (candidate.kind !== 'camp' && candidate.kind !== 'project')
      || typeof candidate.targetKey !== 'string'
      || !candidate.targetKey.trim()
      || typeof candidate.pinnedAt !== 'string'
      || !Number.isFinite(Date.parse(candidate.pinnedAt))
    ) continue
    const key = `${candidate.kind}:${candidate.targetKey}`
    if (seen.has(key)) continue
    seen.add(key)
    pins.push({
      kind: candidate.kind,
      targetKey: candidate.targetKey,
      pinnedAt: candidate.pinnedAt
    })
  }
  return pins.sort((left, right) =>
    left.pinnedAt.localeCompare(right.pinnedAt)
      || left.kind.localeCompare(right.kind)
      || left.targetKey.localeCompare(right.targetKey)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT'
}
