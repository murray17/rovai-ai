import { isCampId } from '@contracts'
import type { NavigationPin, NavigationPreferencesSnapshot, RemovedNavigationProject } from '@contracts'
import { normalizeProjectDisplayName, projectDisplayNameError } from './project-display-name'

export const EMPTY_SNAPSHOT: NavigationPreferencesSnapshot = {
  schemaVersion: 4,
  pins: [],
  removedProjects: [],
  projectOrder: null,
  projectNames: {}
}

export function sanitizeSnapshot(source: unknown): NavigationPreferencesSnapshot {
  if (!isRecord(source)) return structuredClone(EMPTY_SNAPSHOT)
  const pins = sanitizePins(source)
  const removedProjects = source.schemaVersion === 2 || source.schemaVersion === 3 || source.schemaVersion === 4
    ? sanitizeRemovedProjects(source.removedProjects)
    : []
  const projectOrder = source.schemaVersion === 3 || source.schemaVersion === 4
    ? sanitizeProjectOrder(source.projectOrder)
    : null
  const projectNames = source.schemaVersion === 4 ? sanitizeProjectNames(source.projectNames) : {}
  return { schemaVersion: 4, pins, removedProjects, projectOrder, projectNames }
}

export function sanitizePins(source: Record<string, unknown>): NavigationPin[] {
  if (
    (source.schemaVersion !== 1 && source.schemaVersion !== 2 && source.schemaVersion !== 3 && source.schemaVersion !== 4)
    || !Array.isArray(source.pins)
  ) return []
  const seen = new Set<string>()
  const pins: NavigationPin[] = []
  for (const candidate of source.pins) {
    if (!isRecord(candidate)) continue
    const kind = candidate.kind
    const targetKey = candidate.targetKey
    if (
      (kind !== 'camp' && kind !== 'project')
      || typeof targetKey !== 'string'
      || (kind === 'camp'
        ? !isCampId(targetKey)
        : !isProjectTargetKey(targetKey))
      || !isTimestamp(candidate.pinnedAt)
    ) continue
    const key = `${kind}:${targetKey}`
    if (seen.has(key)) continue
    seen.add(key)
    pins.push({
      kind,
      targetKey,
      pinnedAt: candidate.pinnedAt
    })
  }
  return pins.sort((left, right) =>
    left.pinnedAt.localeCompare(right.pinnedAt)
      || left.kind.localeCompare(right.kind)
      || left.targetKey.localeCompare(right.targetKey)
  )
}

export function sanitizeProjectOrder(source: unknown): string[] | null {
  if (source === null) return null
  if (!Array.isArray(source)) return null
  const seen = new Set<string>()
  const projectOrder: string[] = []
  for (const projectKey of source) {
    if (!isProjectTargetKey(projectKey) || seen.has(projectKey)) continue
    seen.add(projectKey)
    projectOrder.push(projectKey)
  }
  return projectOrder
}

export function sanitizeProjectNames(source: unknown): Record<string, string> {
  if (!isRecord(source)) return {}
  return Object.fromEntries(Object.entries(source).flatMap(([key, name]) =>
    isProjectTargetKey(key) && typeof name === 'string' && !projectDisplayNameError(name)
      ? [[key, normalizeProjectDisplayName(name)]]
      : []
  ))
}

export function sanitizeRemovedProjects(source: unknown): RemovedNavigationProject[] {
  if (!Array.isArray(source)) return []
  const seen = new Set<string>()
  const projects: RemovedNavigationProject[] = []
  for (const candidate of source) {
    if (
      !isRecord(candidate)
      || !isProjectTargetKey(candidate.targetKey)
      || !isTimestamp(candidate.removedAt)
      || seen.has(candidate.targetKey)
    ) continue
    seen.add(candidate.targetKey)
    projects.push({
      targetKey: candidate.targetKey,
      removedAt: candidate.removedAt
    })
  }
  return projects.sort((left, right) =>
    left.removedAt.localeCompare(right.removedAt)
      || left.targetKey.localeCompare(right.targetKey)
  )
}

export function isProjectTargetKey(value: unknown): value is string {
  return isStableId(value) && value.startsWith('directory:')
}

export function isStableId(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= 8_192
}

export function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
