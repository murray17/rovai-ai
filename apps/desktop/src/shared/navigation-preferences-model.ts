import { isThreadId } from '@contracts'
import type { NavigationPin, NavigationPreferencesSnapshot, NavigationProjectMove, NavigationThreadReadState, RemovedNavigationProject } from '@contracts'
import { normalizeProjectDisplayName, projectDisplayNameError } from './project-display-name'

export const EMPTY_SNAPSHOT: NavigationPreferencesSnapshot = {
  schemaVersion: 7,
  registeredProjects: [],
  legacyProjectsSynced: false,
  pins: [],
  removedProjects: [],
  projectOrder: null,
  pinnedProjectOrder: [],
  projectNames: {},
  threadReadStates: {}
}

function isSupportedVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= EMPTY_SNAPSHOT.schemaVersion
}

export function sanitizeSnapshot(source: unknown): NavigationPreferencesSnapshot {
  if (!isRecord(source) || !isSupportedVersion(source.schemaVersion)) return structuredClone(EMPTY_SNAPSHOT)
  const version = source.schemaVersion
  const pins = sanitizePins(source)
  const removedProjects = version >= 2 ? sanitizeRemovedProjects(source.removedProjects) : []
  const projectOrder = version >= 3 ? sanitizeProjectOrder(source.projectOrder) : null
  const projectNames = version >= 4 ? sanitizeProjectNames(source.projectNames) : {}
  const threadReadStates = version >= 5 ? sanitizeThreadReadStates(source.threadReadStates) : {}
  const registeredProjects = version >= 6 && Array.isArray(source.registeredProjects)
    ? [...new Set(source.registeredProjects.filter(isProjectPath))] : []
  const legacyProjectsSynced = version >= 6 && source.legacyProjectsSynced === true
  const pinned = new Set(pins.filter(pin => pin.kind === 'project').map(pin => pin.targetKey))
  const pinnedProjectOrder = version >= 7 ? (sanitizeProjectOrder(source.pinnedProjectOrder) ?? []).filter(key => pinned.has(key)) : []
  return { schemaVersion: 7, registeredProjects, legacyProjectsSynced, pins, removedProjects, projectOrder, pinnedProjectOrder, projectNames, threadReadStates }
}

export function sanitizePins(source: Record<string, unknown>): NavigationPin[] {
  if (
    !isSupportedVersion(source.schemaVersion)
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
        ? !isThreadId(targetKey)
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

export function isNavigationThreadReadState(value: unknown): value is NavigationThreadReadState {
  return isRecord(value) && typeof value.manualUnread === 'boolean'
    && Number.isSafeInteger(value.readThroughGlobalSequence)
    && (value.readThroughGlobalSequence as number) >= 0
}

export function sanitizeThreadReadStates(source: unknown): Record<string, NavigationThreadReadState> {
  if (!isRecord(source)) return {}
  return Object.fromEntries(Object.entries(source).flatMap(([id, state]) =>
    isThreadId(id) && isNavigationThreadReadState(state)
      ? [[id, { manualUnread: state.manualUnread, readThroughGlobalSequence: state.readThroughGlobalSequence }]]
      : []
  ))
}

export function isProjectPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 8192
    && !value.includes('\0') && (/^\//.test(value) || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value))
    && !value.split(/[\\/]/).some(part => part === '.' || part === '..')
}

export function registerNavigationProjects(snapshot: NavigationPreferencesSnapshot, paths: string[], completeLegacy = false): NavigationPreferencesSnapshot {
  if (!Array.isArray(paths) || !paths.every(isProjectPath)) throw new Error('Invalid project directories')
  // A delayed startup result can only fill gaps; it never undoes a user removal.
  if (completeLegacy && snapshot.legacyProjectsSynced) return snapshot
  const removed = new Set(snapshot.removedProjects.map(project => project.targetKey))
  const registered = [...new Set([...snapshot.registeredProjects, ...paths.filter(path => !removed.has(`directory:${path}`))])]
  const order = snapshot.projectOrder ?? []
  return { ...snapshot,
    projectOrder: [...new Set([...order, ...registered.map(path => `directory:${path}`)])],
    registeredProjects: registered,
    legacyProjectsSynced: snapshot.legacyProjectsSynced || completeLegacy }
}

export function sourceMatchesSupportedSnapshot(source: unknown, snapshot: NavigationPreferencesSnapshot): boolean {
  if (!isRecord(source) || !isSupportedVersion(source.schemaVersion)) return false
  const version = source.schemaVersion
  const expected: Record<string, unknown> = { schemaVersion: version, pins: snapshot.pins }
  if (version >= 2) expected.removedProjects = snapshot.removedProjects
  if (version >= 3) expected.projectOrder = snapshot.projectOrder
  if (version >= 4) expected.projectNames = snapshot.projectNames
  if (version >= 5) expected.threadReadStates = snapshot.threadReadStates
  if (version >= 6) {
    expected.registeredProjects = snapshot.registeredProjects
    expected.legacyProjectsSynced = snapshot.legacyProjectsSynced
  }
  if (version >= 7) {
    // Pins own membership. Stale or repeated display-order entries can be skipped on read.
    if (!Array.isArray(source.pinnedProjectOrder)) return false
    expected.pinnedProjectOrder = source.pinnedProjectOrder
  }
  return Object.keys(source).length === Object.keys(expected).length
    && Object.entries(expected).every(([key, value]) => JSON.stringify(source[key]) === JSON.stringify(value))
}

export function orderedPinnedProjects(pins: readonly NavigationPin[], order: readonly string[]): string[] {
  const pinned = new Set(pins.filter(pin => pin.kind === 'project').map(pin => pin.targetKey))
  return [...new Set([...order.filter(key => pinned.has(key)), ...pinned])]
}

export function moveNavigationProject(snapshot: NavigationPreferencesSnapshot, move: NavigationProjectMove): NavigationPreferencesSnapshot {
  if (!move || (move.section !== 'projects' && move.section !== 'pinned') || !isProjectTargetKey(move.projectKey)
    || (move.beforeProjectKey !== null && !isProjectTargetKey(move.beforeProjectKey))) throw new Error('Invalid project move')
  const { section, projectKey, beforeProjectKey } = move
  const registered = new Set(snapshot.registeredProjects.map(path => `directory:${path}`))
  for (const removed of snapshot.removedProjects) registered.delete(removed.targetKey)
  const pins = new Set(orderedPinnedProjects(snapshot.pins, snapshot.pinnedProjectOrder))
  const base = section === 'pinned' ? [...pins] : [...new Set([...(snapshot.projectOrder ?? []), ...registered])]
  const eligible = (key: string): boolean => registered.has(key) && pins.has(key) === (section === 'pinned')
  const rows = base.filter(eligible)
  const from = rows.indexOf(projectKey)
  if (from < 0 || beforeProjectKey === projectKey || (rows[from + 1] ?? null) === beforeProjectKey
    || (beforeProjectKey !== null && !rows.includes(beforeProjectKey))) return snapshot
  rows.splice(from, 1)
  rows.splice(beforeProjectKey === null ? rows.length : rows.indexOf(beforeProjectKey), 0, projectKey)
  // Only replace this section's slots. Unpinning later restores the underlying project position.
  let index = 0
  const order = base.map(key => eligible(key) ? rows[index++] : key)
  return section === 'pinned' ? { ...snapshot, pinnedProjectOrder: order } : { ...snapshot, projectOrder: order }
}
