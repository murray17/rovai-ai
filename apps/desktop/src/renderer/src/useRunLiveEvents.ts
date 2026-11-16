import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { AgentRunView } from '@contracts'
import { useThreadClient } from './camp-client'
import { EMPTY_RUN_LIVE_EVENTS, runLiveEventsFor } from './run-live-events'
import { groupExecutionEventsByRunId } from './execution-events'
import type { LiveRuntimeEvent } from './ui-model'

/** A stable snapshot and subscription for one mounted Run/epoch, shared across its preview and details. */
export function useRunLiveEvents(threadId: string, run: Pick<AgentRunView, 'id' | 'executionEpoch'>,
  seed: LiveRuntimeEvent[] = EMPTY_RUN_LIVE_EVENTS): LiveRuntimeEvent[] {
  const client = useThreadClient()
  const store = runLiveEventsFor(client)
  const key = useMemo(() => ({ threadId, id: run.id, executionEpoch: run.executionEpoch }),
    [threadId, run.id, run.executionEpoch])
  const subscribe = useCallback((notify: () => void) => store.subscribe(key, notify), [store, key])
  const getSnapshot = useCallback(() => store.getSnapshot(key), [store, key])
  const live = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return useMemo(() => !live.length ? seed : groupExecutionEventsByRunId([run], [], [...seed, ...live]).get(run.id)
    ?? EMPTY_RUN_LIVE_EVENTS, [seed, live, run.id])
}

/** Only surfaces that actually show several Runs (the world map) subscribe to a Run set. */
export function useRunSetLiveEvents(threadId: string, runs: readonly Pick<AgentRunView, 'id' | 'executionEpoch'>[], enabled: boolean) {
  const store = runLiveEventsFor(useThreadClient())
  const identity = enabled ? runs.map(run => `${run.id}:${run.executionEpoch}`).join('\0') : ''
  const scope = useMemo(() => {
    const keys = enabled ? runs.map(run => ({ threadId, id: run.id, executionEpoch: run.executionEpoch })) : []
    let previous: LiveRuntimeEvent[][] = []
    let snapshot = new Map<string, LiveRuntimeEvent[]>()
    return {
      subscribe(notify: () => void) {
        const stops = keys.map(key => store.subscribe(key, notify))
        return () => stops.forEach(stop => stop())
      },
      getSnapshot() {
        const next = keys.map(key => store.getSnapshot(key))
        if (next.length !== previous.length || next.some((events, i) => events !== previous[i])) {
          previous = next
          snapshot = new Map(keys.map((key, i) => [key.id, next[i]]))
        }
        return snapshot
      }
    }
  }, [store, threadId, identity])
  return useSyncExternalStore(scope.subscribe, scope.getSnapshot, scope.getSnapshot)
}
