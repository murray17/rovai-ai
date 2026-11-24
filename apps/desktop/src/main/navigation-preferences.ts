import { isThreadId } from '@contracts'
import { EMPTY_SNAPSHOT, sanitizeSnapshot, isProjectTargetKey, isTimestamp, isNavigationThreadReadState, moveNavigationProject, registerNavigationProjects, sourceMatchesSupportedSnapshot } from '../shared/navigation-preferences-model'
import { readFile } from 'node:fs/promises'
import type {
  NavigationPin,
  NavigationPreferencesSnapshot,
  NavigationProjectMove,
  NavigationThreadReadState,
  RemovedNavigationProject,
  StructuredError
} from '@contracts'
import { writePrivateJson } from './general-preferences'
import { normalizeProjectDisplayName, projectDisplayNameError } from '../shared/project-display-name'

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

export class NavigationPreferencesStore {
  readonly #filePath: string
  readonly #now: () => string
  #snapshot: NavigationPreferencesSnapshot
  loadDegradation: StructuredError | null
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
    return { ...structuredClone(this.#snapshot), ...(this.loadDegradation ? { readError: this.loadDegradation.message } : {}) }
  }

  reload(): Promise<NavigationPreferencesSnapshot> {
    return this.#enqueue(async () => this.get())
  }

  registerProjects(paths: string[], completeLegacy = false): Promise<NavigationPreferencesSnapshot> {
    return this.#enqueue(async () => {
      await this.#commit(registerNavigationProjects(this.#snapshot, paths, completeLegacy))
      return this.get()
    })
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

  moveProject(move: NavigationProjectMove): Promise<NavigationPreferencesSnapshot> {
    return this.#enqueue(async () => {
      await this.#commit(moveNavigationProject(this.#snapshot, move))
      return this.get()
    })
  }

  setThreadReadState(threadId: string, state: NavigationThreadReadState | null): Promise<NavigationPreferencesSnapshot> {
    if (!isThreadId(threadId) || (state !== null && !isNavigationThreadReadState(state))) {
      return Promise.reject(new Error('Invalid Thread read state'))
    }
    return this.#enqueue(async () => {
      const threadReadStates = { ...this.#snapshot.threadReadStates }
      if (state === null) delete threadReadStates[threadId]
      else threadReadStates[threadId] = {
        manualUnread: state.manualUnread,
        readThroughGlobalSequence: Math.max(state.readThroughGlobalSequence,
          threadReadStates[threadId]?.readThroughGlobalSequence ?? 0)
      }
      await this.#commit({ ...this.#snapshot, threadReadStates })
      return this.get()
    })
  }

  setProjectName(targetKey: string, name: string | null): Promise<NavigationPreferencesSnapshot> {
    if (!isProjectTargetKey(targetKey)) {
      return Promise.reject(new Error('Unsupported Project navigation key'))
    }
    if (name !== null && (typeof name !== 'string' || projectDisplayNameError(name))) {
      return Promise.reject(new Error(typeof name === 'string'
        ? projectDisplayNameError(name)!
        : 'Invalid Project display name'))
    }
    return this.#enqueue(async () => {
      const projectNames = { ...this.#snapshot.projectNames }
      if (name === null) delete projectNames[targetKey]
      else projectNames[targetKey] = normalizeProjectDisplayName(name)
      await this.#commit({ ...this.#snapshot, projectNames })
      return this.get()
    })
  }

  removeProject(
    targetKey: string,
    relatedThreadIds: string[]
  ): Promise<NavigationPreferencesSnapshot> {
    if (!isProjectTargetKey(targetKey)) {
      return Promise.reject(new Error('Unsupported Project navigation key'))
    }
    if (!Array.isArray(relatedThreadIds) || !relatedThreadIds.every(isThreadId)) {
      return Promise.reject(new Error('Related Thread IDs are invalid'))
    }
    return this.#enqueue(async () => {
      const relatedThreadIdSet = new Set(relatedThreadIds)
      const existing = this.#snapshot.removedProjects.find(
        (project) => project.targetKey === targetKey
      )
      const next = sanitizeSnapshot({
        ...this.#snapshot,
        pins: this.#snapshot.pins.filter((pin) => !(
          (pin.kind === 'project' && pin.targetKey === targetKey)
          || (pin.kind === 'camp' && relatedThreadIdSet.has(pin.targetKey))
        )),
        registeredProjects: this.#snapshot.registeredProjects.filter(path => `directory:${path}` !== targetKey),
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
        registeredProjects: [...new Set([...this.#snapshot.registeredProjects, targetKey.slice('directory:'.length)])],
        projectOrder: [...new Set([...(this.#snapshot.projectOrder ?? []), targetKey])],
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
        registeredProjects: this.#snapshot.registeredProjects.filter(path => `directory:${path}` !== project.targetKey),
        projectOrder: this.#snapshot.projectOrder?.filter(key => key !== project.targetKey) ?? null,
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
    if (this.loadDegradation) throw new Error(this.loadDegradation.message)
    if (JSON.stringify(next) === JSON.stringify(this.#snapshot)) return
    await writePrivateJson(this.#filePath, next)
    this.#snapshot = next
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const update = async (): Promise<T> => {
      const latest = await readNavigationPreferencesResult(this.#filePath)
      this.loadDegradation = latest.degradation
      if (!latest.degradation) this.#snapshot = latest.snapshot
      return operation()
    }
    const result = this.#writeTail.then(update, update)
    this.#writeTail = result.then(() => undefined, () => undefined)
    return result
  }
}

function navigationDegradation(code: string, message: string): StructuredError {
  return { code, message, retryable: true, details: {} }
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT'
}
