import type { NavigationSnapshot, NavigationSnapshotRequest } from '@contracts'
import {
  createNavigationRefreshCoordinator,
  type NavigationRefreshCoordinator,
  type NavigationRefreshCoordinatorOptions
} from './navigation-refresh-coordinator'

export const NAVIGATION_INITIAL_VISIBLE_CAMPS = 5
export const NAVIGATION_MORE_CAMPS_STEP = 10
export type NavigationGroupLimits = Readonly<Record<string, number>>

export interface NavigationWindowReader extends NavigationRefreshCoordinator {
  resizeGroup(groupKey: string, limit: number): Promise<void>
}

/** Owns read scope and presentation counts, never retained pages of Camp objects. */
export function createNavigationWindowReader(
  read: (request: NavigationSnapshotRequest) => Promise<NavigationSnapshot>,
  commit: (snapshot: NavigationSnapshot, groupLimits: NavigationGroupLimits) => void,
  options: NavigationRefreshCoordinatorOptions & { onError?(error: unknown): void } = {}
): NavigationWindowReader {
  let requested: NavigationGroupLimits = {}
  let displayed: NavigationGroupLimits = {}
  let snapshot: NavigationSnapshot | null = null
  let disposed = false
  const resizeTokens = new Map<string, symbol>()

  const coordinator = createNavigationRefreshCoordinator(async () => {
    const scope = requested
    try {
      const next = await read({ groupLimits: { ...scope } })
      // A resize requests a trailing generation. Neither an old five-row response nor
      // an obsolete expansion may overwrite the newest requested window.
      if (disposed || scope !== requested) return
      if (next.schemaVersion !== 3) throw new Error('会话列表数据版本不兼容。')
      snapshot = next
      displayed = scope
      commit(next, displayed)
    } catch (error) {
      if (disposed || scope !== requested) return
      options.onError?.(error)
      throw error
    }
  }, options)

  return {
    ...coordinator,
    async resizeGroup(groupKey, limit) {
      if (disposed) throw new Error('Navigation window reader is disposed')
      if (!Number.isSafeInteger(limit) || limit < NAVIGATION_INITIAL_VISIBLE_CAMPS) {
        throw new Error('Navigation window requires a safe integer of at least five')
      }
      const token = Symbol(groupKey)
      resizeTokens.set(groupKey, token)
      requested = { ...requested, [groupKey]: limit }
      // Shrinking is presentation-only and immediate. Expanding is published only
      // together with a successful authoritative read of the entire new prefix.
      if (snapshot && limit < (displayed[groupKey] ?? NAVIGATION_INITIAL_VISIBLE_CAMPS)) {
        displayed = { ...displayed, [groupKey]: limit }
        commit(snapshot, displayed)
      }
      try {
        await coordinator.refresh('explicit')
      } catch (error) {
        if (resizeTokens.get(groupKey) === token) {
          // Keep the last successful display on failure. The coordinator's existing
          // retry retains freshness intent, not an unconfirmed expansion.
          requested = {
            ...requested,
            [groupKey]: displayed[groupKey] ?? NAVIGATION_INITIAL_VISIBLE_CAMPS
          }
        }
        throw error
      } finally {
        if (resizeTokens.get(groupKey) === token) resizeTokens.delete(groupKey)
      }
    },
    dispose() {
      disposed = true
      coordinator.dispose()
    }
  }
}
