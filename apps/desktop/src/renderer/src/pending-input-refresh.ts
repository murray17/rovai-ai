import type { CampPendingInputsView, CoreEvent } from '@contracts'

export function shouldRefreshPendingInputs(event: CoreEvent, campId: string): boolean {
  const params = event.params as Record<string, unknown> | null
  if (event.method === 'runtime.state') return params?.status === 'ready'
  if (params?.campId !== campId) return false
  if (event.method === 'camp.pendingInputs.changed') return true
  // Execution state is part of the queue projection. These existing commit
  // notifications also cover an empty queue becoming idle after Stop.
  return event.method === 'navigation.invalidated'
    && typeof params?.reason === 'string'
    && /^(agent_run\.|agentRuns\.|campTurns\.|camp\.messages\.send$)/u.test(params.reason)
}

/** A private projection reader: one request in flight, with a trailing read if
 * a commit arrives during it. No timer, polling, optimistic state or edit lease. */
export function createPendingInputsRefresh(
  load: () => Promise<CampPendingInputsView>,
  commit: (queue: CampPendingInputsView) => void
): { refresh(): Promise<void>; dispose(): void } {
  let inFlight: Promise<void> | null = null
  let dirty = false
  let disposed = false
  let previous: string | null = null
  return {
    refresh() {
      if (disposed) return Promise.resolve()
      dirty = true
      if (inFlight) return inFlight
      inFlight = Promise.resolve().then(async () => {
        let lastError: unknown = null
        do {
          dirty = false
          try {
            const next = await load()
            if (disposed) return
            // An invalidation received during the read may make it stale.
            if (!dirty) {
              const serialized = JSON.stringify(next)
              if (serialized !== previous) {
                previous = serialized
                commit(next)
              }
            }
            lastError = null
          } catch (error) {
            lastError = error
          }
        } while (dirty && !disposed)
        if (!disposed && lastError !== null) throw lastError
      }).finally(() => { inFlight = null })
      return inFlight
    },
    dispose() { disposed = true }
  }
}
