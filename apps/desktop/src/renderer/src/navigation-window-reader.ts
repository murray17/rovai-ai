import type { NavigationCampItem, NavigationCampRows, NavigationSnapshot, NavigationSnapshotRequest } from '@contracts'
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
  campId?: string
  groupKeys?: string[]
}
export interface NavigationWindowReader extends NavigationRefreshCoordinator {
  resizeGroup(groupKey: string, limit: number): Promise<void>
  refreshCamps(campIds: string[], trigger?: NavigationRefreshTrigger): Promise<void>
  refreshGroups(groupKeys: string[], trigger?: NavigationRefreshTrigger): Promise<void>
  invalidate(change: NavigationInvalidation): Promise<void>
  acceptRows(rows: NavigationCampRows): void
}

export function navigationGroupKey(camp: Pick<NavigationCampItem, 'projectBindingKind' | 'projectPath'>): string {
  return camp.projectBindingKind === 'directory' ? `directory:${camp.projectPath}` : 'quick-chat'
}

interface PendingRead { all: boolean; camps: Set<string>; groups: Set<string>; groupCamps: Set<string> }
const emptyRead = (): PendingRead => ({ all: false, camps: new Set(), groups: new Set(), groupCamps: new Set() })

/** One owner for the window, three read scopes; no event replay or page cache. */
export function createNavigationWindowReader(
  read: (request: NavigationSnapshotRequest) => Promise<NavigationSnapshot>,
  commit: (snapshot: NavigationSnapshot, groupLimits: NavigationGroupLimits) => void,
  options: NavigationRefreshCoordinatorOptions & {
    readCamps(campIds: string[]): Promise<NavigationCampRows>
    getPinnedCampIds?(): string[]
    onRows?(rows: NavigationCampRows, requestedIds: string[]): void
    onError?(error: unknown): void
  }
): NavigationWindowReader {
  let requested: NavigationGroupLimits = {}
  let displayed: NavigationGroupLimits = {}
  let snapshot: NavigationSnapshot | null = null
  let pending = emptyRead()
  let disposed = false
  let rowRevision = 0
  const resizeTokens = new Map<string, symbol>()
  const restore = (scope: PendingRead): void => {
    pending.all ||= scope.all
    for (const id of scope.camps) pending.camps.add(id)
    for (const key of scope.groups) pending.groups.add(key)
    for (const id of scope.groupCamps) pending.groupCamps.add(id)
  }
  const allRows = (): NavigationCampItem[] => snapshot
    ? [...snapshot.quickChat.recentCamps, ...snapshot.projects.flatMap(group => group.recentCamps)] : []
  const applyRows = (rows: NavigationCampRows, ids: string[]): void => {
    if (disposed) return
    if (snapshot && rows.throughGlobalSequence < snapshot.throughGlobalSequence) return
    options.onRows?.(rows, ids)
    if (!snapshot) return
    const byId = new Map(rows.camps.map(camp => [camp.id, camp]))
    // Row reads never infer membership, order or counts from an incomplete window.
    const replace = (camps: NavigationCampItem[]) => camps.map(camp => byId.get(camp.id) ?? camp)
    snapshot = { ...snapshot, throughGlobalSequence: rows.throughGlobalSequence,
      quickChat: { ...snapshot.quickChat, recentCamps: replace(snapshot.quickChat.recentCamps) },
      projects: snapshot.projects.map(group => ({ ...group, recentCamps: replace(group.recentCamps) })) }
    commit(snapshot, displayed)
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
      let groupRows: NavigationCampRows | undefined
      if (!scope.all && scope.groupCamps.size > 0) {
        groupRows = await options.readCamps([...scope.groupCamps])
        groupRows.groupKeys.forEach(key => scope.groups.add(key))
        allRows().filter(camp => scope.groupCamps.has(camp.id)).forEach(camp => scope.groups.add(navigationGroupKey(camp)))
        if (scope.groups.size === 0) scope.all = true
      }
      const keys = [...scope.groups]
      const next = scope.all || keys.length > 0
        ? await read({ groupLimits: { ...windows }, ...(scope.all ? {} : { groupKeys: keys }) })
        : undefined
      const ids = [...new Set([...scope.camps, ...(scope.all ? options.getPinnedCampIds?.() ?? [] : [])])]
      // State-only Camp IDs must not expand a simultaneous group's read scope.
      const rows = ids.length > 0 ? await options.readCamps(ids) : undefined
      if (disposed) return
      if (windows !== requested || beforeRows !== rowRevision) {
        restore(scope)
        void coordinator.refresh('invalidation').catch(() => undefined)
        return
      }
      if (next) {
        if (next.schemaVersion !== 3) throw new Error('会话列表数据版本不兼容。')
        if (scope.all || !snapshot) snapshot = next
        else snapshot = { ...snapshot, throughGlobalSequence: next.throughGlobalSequence,
          quickChat: scope.groups.has('quick-chat') ? next.quickChat : snapshot.quickChat,
          projects: [...snapshot.projects.filter(group => !scope.groups.has(group.projectKey)), ...next.projects] }
        displayed = windows
        commit(snapshot, displayed)
      }
      if (groupRows) applyRows(groupRows, [...scope.groupCamps])
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
  const refreshCamps = (ids: string[], trigger: NavigationRefreshTrigger = 'invalidation'): Promise<void> => {
    ids.forEach(id => pending.camps.add(id))
    return coordinator.refresh(trigger)
  }
  return {
    ...coordinator,
    refresh(trigger) { pending.all = true; return coordinator.refresh(trigger) },
    refreshCamps,
    refreshGroups,
    invalidate(change) {
      if (change.scope === 'camp' && change.campId) return refreshCamps([change.campId])
      if (change.scope === 'group') {
        if (change.groupKeys?.length) return refreshGroups(change.groupKeys)
        if (change.campId) { pending.groupCamps.add(change.campId); return coordinator.refresh('invalidation') }
      }
      pending.all = true
      return coordinator.refresh('invalidation')
    },
    acceptRows(rows) { rowRevision += 1; applyRows(rows, rows.camps.map(camp => camp.id)) },
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
