import { readFile } from 'node:fs/promises'
import { isCampId } from '@contracts'
import type {
  NavigationPin,
  NavigationPreferencesSnapshot,
  RemovedNavigationProject
} from '@contracts'
import { writePrivateJson } from './general-preferences'

const EMPTY_SNAPSHOT: NavigationPreferencesSnapshot = {
  schemaVersion: 2,
  pins: [],
  removedProjects: []
}

export async function readNavigationPreferences(
  filePath: string
): Promise<NavigationPreferencesSnapshot> {
  let source: unknown
  try {
    source = JSON.parse(await readFile(filePath, 'utf8')) as unknown
  } catch (error) {
    if (isMissingPathError(error)) return structuredClone(EMPTY_SNAPSHOT)
    if (error instanceof SyntaxError) {
      await writePrivateJson(filePath, EMPTY_SNAPSHOT)
      return structuredClone(EMPTY_SNAPSHOT)
    }
    throw error
  }

  const snapshot = sanitizeSnapshot(source)
  if (JSON.stringify(source) !== JSON.stringify(snapshot)) {
    await writePrivateJson(filePath, snapshot)
  }
  return snapshot
}

export class NavigationPreferencesStore {
  readonly #filePath: string
  readonly #now: () => string
  #snapshot: NavigationPreferencesSnapshot
  #writeTail: Promise<void> = Promise.resolve()

  private constructor(
    filePath: string,
    snapshot: NavigationPreferencesSnapshot,
    now: () => string
  ) {
    this.#filePath = filePath
    this.#snapshot = snapshot
    this.#now = now
  }

  static async load(
    filePath: string,
    now: () => string = () => new Date().toISOString()
  ): Promise<NavigationPreferencesStore> {
    return new NavigationPreferencesStore(
      filePath,
      await readNavigationPreferences(filePath),
      now
    )
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
        schemaVersion: 2,
        pins: this.#snapshot.pins.filter((pin) => !(
          (pin.kind === 'project' && pin.targetKey === targetKey)
          || (pin.kind === 'camp' && relatedCampIdSet.has(pin.targetKey))
        )),
        removedProjects: [
          ...this.#snapshot.removedProjects.filter(
            (project) => project.targetKey !== targetKey
          ),
          existing ?? { targetKey, removedAt: this.#now() }
        ]
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

function sanitizeSnapshot(source: unknown): NavigationPreferencesSnapshot {
  if (!isRecord(source)) return structuredClone(EMPTY_SNAPSHOT)
  const pins = sanitizePins(source)
  const removedProjects = source.schemaVersion === 2
    ? sanitizeRemovedProjects(source.removedProjects)
    : []
  return { schemaVersion: 2, pins, removedProjects }
}

function sanitizePins(source: Record<string, unknown>): NavigationPin[] {
  if (
    (source.schemaVersion !== 1 && source.schemaVersion !== 2)
    || !Array.isArray(source.pins)
  ) return []
  const seen = new Set<string>()
  const pins: NavigationPin[] = []
  for (const candidate of source.pins) {
    if (
      !isRecord(candidate)
      || (candidate.kind !== 'camp' && candidate.kind !== 'project')
      || (candidate.kind === 'camp'
        ? !isCampId(candidate.targetKey)
        : !isProjectTargetKey(candidate.targetKey))
      || !isTimestamp(candidate.pinnedAt)
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
