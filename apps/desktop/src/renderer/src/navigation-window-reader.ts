import type { NavigationThreadItem, NavigationThreadRows, NavigationSnapshot, NavigationSnapshotRequest } from '@contracts'
import {
  createNavigationRefreshCoordinator,
  type NavigationRefreshCoordinator,
  type NavigationRefreshCoordinatorOptions,
  type NavigationRefreshTrigger
} from './navigation-refresh-coordinator'

export const NAVIGATION_INITIAL_VISIBLE_CAMPS = 5
export const NAVIGATION_MORE_CAMPS_STEP = 10
export type NavigationGroupLimits = Readonly<Record<string, number>>
export interface NavigationInvalidation {
  scope?: 'camp' | 'group' | 'all'
  threadId?: string
  groupKeys?: string[]
}
export interface NavigationWindowReader extends NavigationRefreshCoordinator {
  resizeGroup(groupKey: string, limit: number): Promise<void>
  refreshThreads(threadIds: string[], trigger?: NavigationRefreshTrigger): Promise<void>
  refreshGroups(groupKeys: string[], trigger?: NavigationRefreshTrigger): Promise<void>
  invalidate(change: NavigationInvalidation): Promise<void>
  acceptRows(rows: NavigationThreadRows): void
}

export function navigationGroupKey(thread: Pick<NavigationThreadItem, 'projectBindingKind' | 'projectPath'>): string {
  return thread.projectBindingKind === 'directory' ? `directory:${thread.projectPath}` : 'quick-chat'
}

interface PendingRead { all: boolean; threads: Set<string>; groups: Set<string>; groupThreads: Set<string> }
const emptyRead = (): PendingRead => ({ all: false, threads: new Set(), groups: new Set(), groupThreads: new Set() })

/** One owner for the window, three read scopes; no event replay or page cache. */
export function createNavigationWindowReader(
  read: (request: NavigationSnapshotRequest) => Promise<NavigationSnapshot>,
  commit: (snapshot: NavigationSnapshot, groupLimits: NavigationGroupLimits) => void,
  options: NavigationRefreshCoordinatorOptions & {
    readThreads(threadIds: string[]): Promise<NavigationThreadRows>
    getPinnedThreadIds?(): string[]
    onRows?(rows: NavigationThreadRows, requestedIds: string[]): void
    onError?(error: unknown): void
  }
): NavigationWindowReader {
  let requested: NavigationGroupLimits = {}
  let displayed: NavigationGroupLimits = {}
  let snapshot: NavigationSnapshot | null = null
  let pending = emptyRead()
  let disposed = false
  let rowRevision = 0
  const appliedRows = new Map<string, { sequence: number; seen: number; version: number }>()
  const resizeTokens = new Map<string, symbol>()
  const restore = (scope: PendingRead): void => {
    pending.all ||= scope.all
    for (const id of scope.threads) pending.threads.add(id)
    for (const key of scope.groups) pending.groups.add(key)
    for (const id of scope.groupThreads) pending.groupThreads.add(id)
  }
  const allRows = (): NavigationThreadItem[] => snapshot
    ? [...snapshot.quickChat.recentThreads, ...snapshot.projects.flatMap(group => group.recentThreads)] : []
  const rememberRows = (threads: NavigationThreadItem[], sequence: number): void => {
    for (const thread of threads) appliedRows.set(thread.id, {
      sequence, seen: thread.lastSeenGlobalSequence ?? 0, version: thread.version
    })
  }
  const applyRows = (rows: NavigationThreadRows, ids: string[]): boolean => {
    if (disposed) return false
    const received = new Map(rows.threads.map(thread => [thread.id, thread]))
    const acceptedIds = ids.filter(id => {
      const previous = appliedRows.get(id)
      const thread = received.get(id)
      // A newer C read says nothing about whether B's row was refreshed.
      return !previous || (rows.throughGlobalSequence >= previous.sequence
        && (!thread || ((thread.lastSeenGlobalSequence ?? 0) >= previous.seen && thread.version >= previous.version)))
    })
    if (acceptedIds.length === 0) return false
    const accepted = new Set(acceptedIds)
    const threads = rows.threads.filter(thread => accepted.has(thread.id))
    for (const id of acceptedIds) {
      const thread = received.get(id)
      if (thread) rememberRows([thread], rows.throughGlobalSequence)
      else {
        const previous = appliedRows.get(id)
        appliedRows.set(id, {
          sequence: rows.throughGlobalSequence, seen: previous?.seen ?? 0, version: previous?.version ?? 0
        })
      }
    }
    options.onRows?.({ ...rows, threads }, acceptedIds)
    if (!snapshot) return true
    const byId = new Map(threads.map(thread => [thread.id, thread]))
    // Row reads never infer membership, order or counts from an incomplete window.
    const replace = (threads: NavigationThreadItem[]) => threads.map(thread => byId.get(thread.id) ?? thread)
    snapshot = { ...snapshot, throughGlobalSequence: Math.max(snapshot.throughGlobalSequence, rows.throughGlobalSequence),
      quickChat: { ...snapshot.quickChat, recentThreads: replace(snapshot.quickChat.recentThreads) },
      projects: snapshot.projects.map(group => ({ ...group, recentThreads: replace(group.recentThreads) })) }
    commit(snapshot, displayed)
    return true
  }

  const coordinator = createNavigationRefreshCoordinator(async () => {
    const scope = pending
    pending = emptyRead()
    const windows = requested
    const beforeRows = rowRevision
    try {
      if (!snapshot) scope.all = true
      // Core resolves the current group; the displayed row supplies the old group
      // during a move/delete. Deletion notifications also carry the old group explicitly.
      let groupRows: NavigationThreadRows | undefined
      if (!scope.all && scope.groupThreads.size > 0) {
        groupRows = await options.readThreads([...scope.groupThreads])
        groupRows.groupKeys.forEach(key => scope.groups.add(key))
        allRows().filter(thread => scope.groupThreads.has(thread.id)).forEach(thread => scope.groups.add(navigationGroupKey(thread)))
        if (scope.groups.size === 0) scope.all = true
      }
      const keys = [...scope.groups]
      const next = scope.all || keys.length > 0
        ? await read({ groupLimits: { ...windows }, ...(scope.all ? {} : { groupKeys: keys }) })
        : undefined
      const ids = [...new Set([...scope.threads, ...(scope.all ? options.getPinnedThreadIds?.() ?? [] : [])])]
      // State-only Thread IDs must not expand a simultaneous group's read scope.
      const rows = ids.length > 0 ? await options.readThreads(ids) : undefined
      if (disposed) return
      if (windows !== requested || beforeRows !== rowRevision) {
        restore(scope)
        void coordinator.refresh('invalidation').catch(() => undefined)
        return
      }
      if (next) {
        if (next.schemaVersion !== 3) throw new Error('会话列表数据版本不兼容。')
        if (scope.all || !snapshot) {
          snapshot = next
          appliedRows.clear()
        } else snapshot = { ...snapshot, throughGlobalSequence: Math.max(snapshot.throughGlobalSequence, next.throughGlobalSequence),
          quickChat: scope.groups.has('quick-chat') ? next.quickChat : snapshot.quickChat,
          projects: [...snapshot.projects.filter(group => !scope.groups.has(group.projectKey)), ...next.projects] }
        rememberRows([next.quickChat.recentThreads, ...next.projects.map(group => group.recentThreads)].flat(), next.throughGlobalSequence)
        displayed = windows
        commit(snapshot, displayed)
      }
      if (groupRows) applyRows(groupRows, [...scope.groupThreads])
      if (rows) applyRows(rows, ids)
    } catch (error) {
      if (disposed) return
      restore(scope)
      if (windows !== requested || beforeRows !== rowRevision) {
        void coordinator.refresh('invalidation').catch(() => undefined)
        return
      }
      options.onError?.(error)
      throw error
    }
  }, options)
  const refreshGroups = (keys: string[], trigger: NavigationRefreshTrigger = 'invalidation'): Promise<void> => {
    keys.forEach(key => pending.groups.add(key))
    return coordinator.refresh(trigger)
  }
  const refreshThreads = (ids: string[], trigger: NavigationRefreshTrigger = 'invalidation'): Promise<void> => {
    ids.forEach(id => pending.threads.add(id))
    return coordinator.refresh(trigger)
  }
  return {
    ...coordinator,
    refresh(trigger) { pending.all = true; return coordinator.refresh(trigger) },
    refreshThreads,
    refreshGroups,
    invalidate(change) {
      if (change.scope === 'camp' && change.threadId) return refreshThreads([change.threadId])
      if (change.scope === 'group') {
        if (change.groupKeys?.length) return refreshGroups(change.groupKeys)
        if (change.threadId) { pending.groupThreads.add(change.threadId); return coordinator.refresh('invalidation') }
      }
      pending.all = true
      return coordinator.refresh('invalidation')
    },
    acceptRows(rows) { if (applyRows(rows, rows.threads.map(thread => thread.id))) rowRevision += 1 },
    async resizeGroup(groupKey, limit) {
      if (disposed) throw new Error('Navigation window reader is disposed')
      if (!Number.isSafeInteger(limit) || limit < NAVIGATION_INITIAL_VISIBLE_CAMPS) {
        throw new Error('Navigation window requires a safe integer of at least five')
      }
      const token = Symbol(groupKey)
      resizeTokens.set(groupKey, token)
      requested = { ...requested, [groupKey]: limit }
      if (snapshot && limit < (displayed[groupKey] ?? NAVIGATION_INITIAL_VISIBLE_CAMPS)) {
        displayed = { ...displayed, [groupKey]: limit }
        commit(snapshot, displayed)
        resizeTokens.delete(groupKey)
        return
      }
      try { await refreshGroups([groupKey], 'explicit') }
      catch (error) {
        if (resizeTokens.get(groupKey) === token) requested = { ...requested, [groupKey]: displayed[groupKey] ?? NAVIGATION_INITIAL_VISIBLE_CAMPS }
        throw error
      } finally { if (resizeTokens.get(groupKey) === token) resizeTokens.delete(groupKey) }
    },
    dispose() { disposed = true; coordinator.dispose() }
  }
}
