import { readFile } from 'node:fs/promises'
import { isCampId } from '@contracts'
import type {
  NavigationPin,
  NavigationPreferencesSnapshot,
  RemovedNavigationProject,
  StructuredError
} from '@contracts'
import { writePrivateJson } from './general-preferences'

const EMPTY_SNAPSHOT: NavigationPreferencesSnapshot = {
  schemaVersion: 3,
  pins: [],
  removedProjects: [],
  projectOrder: null
}

export async function readNavigationPreferences(
  filePath: string
): Promise<NavigationPreferencesSnapshot> {
  return (await readNavigationPreferencesResult(filePath)).snapshot
}

async function readNavigationPreferencesResult(filePath: string): Promise<{
  snapshot: NavigationPreferencesSnapshot
  degradation: StructuredError | null
}> {
  let source: unknown
  try {
    source = JSON.parse(await readFile(filePath, 'utf8')) as unknown
  } catch (error) {
    return {
      snapshot: structuredClone(EMPTY_SNAPSHOT),
      degradation: isMissingPathError(error)
        ? null
        : navigationDegradation(
            'navigation_preferences_unreadable',
            'Navigation preferences could not be read; in-memory defaults are active and the original file was not changed.'
          )
    }
  }

  const snapshot = sanitizeSnapshot(source)
  const changed = !sourceMatchesSupportedSnapshot(source, snapshot)
  return {
    snapshot,
    degradation: changed
      ? navigationDegradation(
          'navigation_preferences_invalid',
          'Navigation preferences required in-memory normalization; the original file was not changed.'
        )
      : null
  }
}

function sourceMatchesSupportedSnapshot(
  source: unknown,
  snapshot: NavigationPreferencesSnapshot
): boolean {
  if (!isRecord(source)) return false
  if (source.schemaVersion === 2) {
    return JSON.stringify(source) === JSON.stringify({
      schemaVersion: 2,
      pins: snapshot.pins,
      removedProjects: snapshot.removedProjects
    })
  }
  return JSON.stringify(source) === JSON.stringify(snapshot)
}

export class NavigationPreferencesStore {
  readonly #filePath: string
  readonly #now: () => string
  #snapshot: NavigationPreferencesSnapshot
  readonly loadDegradation: StructuredError | null
  #writeTail: Promise<void> = Promise.resolve()

  private constructor(
    filePath: string,
    snapshot: NavigationPreferencesSnapshot,
    now: () => string,
    loadDegradation: StructuredError | null = null
  ) {
    this.#filePath = filePath
    this.#snapshot = snapshot
    this.#now = now
    this.loadDegradation = loadDegradation
  }

  static async load(
    filePath: string,
    now: () => string = () => new Date().toISOString()
  ): Promise<NavigationPreferencesStore> {
    const result = await readNavigationPreferencesResult(filePath)
    return new NavigationPreferencesStore(
      filePath,
      result.snapshot,
      now,
      result.degradation
    )
  }

  static defaults(
    filePath: string,
    now: () => string = () => new Date().toISOString()
  ): NavigationPreferencesStore {
    return new NavigationPreferencesStore(filePath, structuredClone(EMPTY_SNAPSHOT), now)
  }

  get(): NavigationPreferencesSnapshot {
    return structuredClone(this.#snapshot)
  }

  replacePins(pins: NavigationPin[]): Promise<NavigationPreferencesSnapshot> {
    return this.#enqueue(async () => {
      const next = sanitizeSnapshot({
        ...this.#snapshot,
        pins
      })
      await this.#commit(next)
      return this.get()
    })
  }

  synchronizeProjectOrder(projectKeys: string[]): Promise<NavigationPreferencesSnapshot> {
    if (
      !Array.isArray(projectKeys)
      || !projectKeys.every(isProjectTargetKey)
      || new Set(projectKeys).size !== projectKeys.length
    ) {
      return Promise.reject(new Error('Project navigation keys are invalid'))
    }
    return this.#enqueue(async () => {
      const currentProjectKeys = new Set(projectKeys)
      const retainedProjectKeys = this.#snapshot.projectOrder === null
        ? []
        : this.#snapshot.projectOrder.filter((projectKey) => currentProjectKeys.has(projectKey))
      const retainedProjectKeySet = new Set(retainedProjectKeys)
      const projectOrder = [
        ...retainedProjectKeys,
        ...projectKeys.filter((projectKey) => !retainedProjectKeySet.has(projectKey))
      ]
      const next = sanitizeSnapshot({
        ...this.#snapshot,
        projectOrder
      })
      await this.#commit(next)
      return this.get()
    })
  }

  removeProject(
    targetKey: string,
    relatedCampIds: string[]
  ): Promise<NavigationPreferencesSnapshot> {
    if (!isProjectTargetKey(targetKey)) {
      return Promise.reject(new Error('Unsupported Project navigation key'))
    }
    if (!Array.isArray(relatedCampIds) || !relatedCampIds.every(isCampId)) {
      return Promise.reject(new Error('Related Camp IDs are invalid'))
    }
    return this.#enqueue(async () => {
      const relatedCampIdSet = new Set(relatedCampIds)
      const existing = this.#snapshot.removedProjects.find(
        (project) => project.targetKey === targetKey
      )
      const next = sanitizeSnapshot({
        schemaVersion: 3,
        pins: this.#snapshot.pins.filter((pin) => !(
          (pin.kind === 'project' && pin.targetKey === targetKey)
          || (pin.kind === 'camp' && relatedCampIdSet.has(pin.targetKey))
        )),
        removedProjects: [
          ...this.#snapshot.removedProjects.filter(
            (project) => project.targetKey !== targetKey
          ),
          existing ?? { targetKey, removedAt: this.#now() }
        ],
        projectOrder: this.#snapshot.projectOrder?.filter(
          (projectKey) => projectKey !== targetKey
        ) ?? null
      })
      await this.#commit(next)
      return this.get()
    })
  }

  restoreProject(targetKey: string): Promise<NavigationPreferencesSnapshot> {
    if (!isProjectTargetKey(targetKey)) {
      return Promise.reject(new Error('Unsupported Project navigation key'))
    }
    return this.#enqueue(async () => {
      const next = {
        ...this.#snapshot,
        removedProjects: this.#snapshot.removedProjects.filter(
          (project) => project.targetKey !== targetKey
        )
      }
      await this.#commit(next)
      return this.get()
    })
  }

  reinstateRemovedProject(
    project: RemovedNavigationProject
  ): Promise<NavigationPreferencesSnapshot> {
    if (!isProjectTargetKey(project.targetKey) || !isTimestamp(project.removedAt)) {
      return Promise.reject(new Error('Removed Project rollback record is invalid'))
    }
    return this.#enqueue(async () => {
      const next = sanitizeSnapshot({
        ...this.#snapshot,
        pins: this.#snapshot.pins.filter((pin) => !(
          pin.kind === 'project' && pin.targetKey === project.targetKey
        )),
        removedProjects: [
          ...this.#snapshot.removedProjects.filter(
            (candidate) => candidate.targetKey !== project.targetKey
          ),
          project
        ]
      })
      await this.#commit(next)
      return this.get()
    })
  }

  async #commit(next: NavigationPreferencesSnapshot): Promise<void> {
    if (JSON.stringify(next) === JSON.stringify(this.#snapshot)) return
    await writePrivateJson(this.#filePath, next)
    this.#snapshot = next
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#writeTail.then(operation, operation)
    this.#writeTail = result.then(() => undefined, () => undefined)
    return result
  }
}

function navigationDegradation(code: string, message: string): StructuredError {
  return { code, message, retryable: true, details: {} }
}

function sanitizeSnapshot(source: unknown): NavigationPreferencesSnapshot {
  if (!isRecord(source)) return structuredClone(EMPTY_SNAPSHOT)
  const pins = sanitizePins(source)
  const removedProjects = source.schemaVersion === 2 || source.schemaVersion === 3
    ? sanitizeRemovedProjects(source.removedProjects)
    : []
  const projectOrder = source.schemaVersion === 3
    ? sanitizeProjectOrder(source.projectOrder)
    : null
  return { schemaVersion: 3, pins, removedProjects, projectOrder }
}

function sanitizePins(source: Record<string, unknown>): NavigationPin[] {
  if (
    (source.schemaVersion !== 1 && source.schemaVersion !== 2 && source.schemaVersion !== 3)
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

function sanitizeProjectOrder(source: unknown): string[] | null {
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

function sanitizeRemovedProjects(source: unknown): RemovedNavigationProject[] {
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

function isProjectTargetKey(value: unknown): value is string {
  return isStableId(value) && value.startsWith('directory:')
}

function isStableId(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= 8_192
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT'
}
