import type { MemoryScopeKind, RestorableLocation, SettingsSection } from '@contracts'

export type MemoryNavigationTarget = {
  kind: 'memory'
  memoryId: string | null
  scope?: MemoryScopeKind
  governance?: 'all' | 'agent' | 'review' | 'stopped'
  search?: string
}

export type NavigationTarget = Exclude<RestorableLocation, { kind: 'memory' }>
  | MemoryNavigationTarget
  | { kind: 'settings'; section: SettingsSection; overview?: true }
  | { kind: 'automations' }
  | { kind: 'missions' }

export type NavigationState = { entries: readonly NavigationTarget[]; index: number }
/** Platform history stores page locators only; the shared coordinator owns leave guards. */
export interface NavigationHistory {
  initial: NavigationState | null
  write(state: NavigationState, mode: 'push' | 'replace' | 'repair'): NavigationState
  go(delta: number): Promise<boolean>
  listen(apply: (state: NavigationState) => Promise<NavigationState | null>): () => void
}
export const MAX_NAVIGATION_ENTRIES = 50

export function sameNavigationDestination(a: NavigationTarget, b: NavigationTarget): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'camp': return b.kind === 'camp' && a.campId === b.campId
    case 'settings': return b.kind === 'settings' && a.section === b.section && a.overview === b.overview
    case 'members': return b.kind === 'members' && a.agentId === b.agentId && a.tab === b.tab
    case 'memory': return b.kind === 'memory' && a.memoryId === b.memoryId
    default: return true
  }
}

export type NavigationTransaction = {
  isCurrent(): boolean
  /** Ends guarded waiting when a newer destination takes ownership. */
  superseded: Promise<void>
  /** Commit only after leave guards succeed, in the same turn as the page setters. */
  commit(target?: NavigationTarget): boolean
}

export type NavigationIntent = { isCurrent(): boolean }
type NavigationOperation =
  | { kind: 'push' | 'replace'; target: NavigationTarget }
  | { kind: 'traverse'; index: number; browserState?: NavigationState }

/** Only displayed entries are committed. Pending cursor moves never own another entries array. */
export function createDesktopNavigation<Context = undefined>(
  apply: (target: NavigationTarget, transaction: NavigationTransaction, context?: Context) => Promise<void>,
  history?: NavigationHistory
) {
  let state: NavigationState = { entries: [], index: -1 }
  let pending: NavigationOperation | { kind: 'reservation' } | null = null
  let generation = 0
  let entryRevision = 0
  let supersede: (() => void) | undefined
  const listeners = new Set<() => void>()
  const publish = (): void => { for (const listener of listeners) listener() }
  const invalidate = (): number => {
    ++generation
    supersede?.()
    supersede = undefined
    pending = null
    return generation
  }

  const navigate = async (operation: NavigationOperation, context?: Context): Promise<boolean> => {
    const request = invalidate()
    pending = operation
    const target = operation.kind === 'traverse' ? (operation.browserState ?? state).entries[operation.index] : operation.target
    const superseded = new Promise<void>(resolve => { supersede = resolve })
    let committed = false
    let committedRevision = -1
    const transaction: NavigationTransaction = {
      isCurrent: () => request === generation && (!committed || committedRevision === entryRevision),
      superseded,
      commit: (resolvedTarget = target) => {
        if (request !== generation || (committed && committedRevision !== entryRevision)) return false
        // Build from the latest committed entries so in-page repairs made during a slow
        // departure survive. A second commit (Camp preview -> full projection) replaces.
        let entries = [...(state.entries.length ? state.entries : operation.kind === 'traverse' ? operation.browserState?.entries ?? [] : [])]
        let index = state.index
        if (!committed && operation.kind === 'push') {
          const visited = [...entries.slice(0, index + 1), resolvedTarget]
          entries = history ? visited : visited.slice(-MAX_NAVIGATION_ENTRIES)
          index = entries.length - 1
        } else {
          if (!committed && operation.kind === 'traverse') index = operation.index
          index = Math.max(0, index)
          entries[index] = resolvedTarget
        }
        let next: NavigationState = { entries, index }
        if (history && operation.kind !== 'traverse') next = history.write(next, committed ? 'replace' : operation.kind)
        state = next
        pending = null
        committedRevision = ++entryRevision
        committed = true
        publish()
        return true
      }
    }
    try {
      await apply(target, transaction, context)
      return committed && transaction.isCurrent()
    } finally {
      if (request === generation) pending = null
    }
  }

  return {
    connect(): () => void {
      return history?.listen(async next => await navigate({ kind: 'traverse', index: next.index, browserState: next }) ? state : null) ?? (() => undefined)
    },
    restore(): Promise<boolean> {
      return history?.initial ? navigate({ kind: 'traverse', index: history.initial.index, browserState: history.initial }) : Promise.resolve(false)
    },
    getSnapshot: (): NavigationState => state,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    /** Reserve user intent before an async creation has produced a navigation target. */
    beginIntent(): NavigationIntent {
      const request = invalidate()
      pending = { kind: 'reservation' }
      return { isCurrent: () => request === generation }
    },
    /** In-page normalization owns this displayed revision, never a newer user request. */
    captureCurrentEntry() {
      const revision = entryRevision
      return {
        update(target: NavigationTarget): boolean {
          if (revision !== entryRevision || state.index < 0) return false
          const entries = [...state.entries]
          entries[state.index] = target
          state = { entries, index: state.index }
          history?.write(state, 'repair')
          ++entryRevision
          publish()
          return true
        }
      }
    },
    reset(target?: NavigationTarget): void {
      invalidate()
      ++entryRevision
      state = target ? { entries: [target], index: 0 } : { entries: [], index: -1 }
      if (target && history) state = history.write(state, 'replace')
      publish()
    },
    push(target: NavigationTarget, context?: Context): Promise<boolean> {
      const current = state.entries[state.index]
      if (current && sameNavigationDestination(current, target)) {
        return pending ? navigate({ kind: 'traverse', index: state.index }, context) : Promise.resolve(false)
      }
      return navigate({ kind: 'push', target }, context)
    },
    replace(target: NavigationTarget, context?: Context): Promise<boolean> {
      return navigate({ kind: 'replace', target }, context)
    },
    back(): Promise<boolean> {
      if (history) return history.go(-1)
      const index = pending?.kind === 'traverse' ? pending.index : state.index
      return index > 0 ? navigate({ kind: 'traverse', index: index - 1 }) : Promise.resolve(false)
    },
    forward(): Promise<boolean> {
      if (history) return history.go(1)
      const index = pending?.kind === 'traverse' ? pending.index : state.index
      return index < state.entries.length - 1
        ? navigate({ kind: 'traverse', index: index + 1 }) : Promise.resolve(false)
    }
  }
}

export type DesktopNavigation = ReturnType<typeof createDesktopNavigation>
