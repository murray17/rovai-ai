import type { CoreEvent } from '@contracts'
import { appendLiveRuntimeEventBatch, createLiveRuntimeEventBuffer } from './live-runtime-event-buffer'
import { liveRuntimeEventFromCore, type LiveRuntimeEvent } from './ui-model'

export const EMPTY_RUN_LIVE_EVENTS: LiveRuntimeEvent[] = []
const MAX_EVENTS = 96
const MAX_BYTES = 8 * 1024 * 1024
type Source = { onEvent?: (listener: (event: CoreEvent) => void) => () => void }
type RunKey = { threadId: string; id: string; executionEpoch: number }
type Entry = {
  key: RunKey
  events: LiveRuntimeEvent[]
  listeners: Set<() => void>
  terminal: boolean
  buffer: ReturnType<typeof createLiveRuntimeEventBuffer>
}

/** Ephemeral, subscribed Run previews only. Existing ExecutionWindow owns durable reads and recovery. */
export class RunLiveEvents {
  private runs = new Map<string, Map<string, Entry>>()
  private unlisten: (() => void) | undefined
  private serial = 0
  private sizes = new WeakMap<LiveRuntimeEvent, number>()

  constructor(private source: Source) {}

  getSnapshot(key: RunKey): LiveRuntimeEvent[] {
    return this.entry(key)?.events ?? EMPTY_RUN_LIVE_EVENTS
  }

  subscribe(key: RunKey, listener: () => void): () => void {
    let entry = this.entry(key)
    if (!entry) {
      let created: Entry
      const buffer = createLiveRuntimeEventBuffer(batch => {
        if (this.entry(key) !== created) return
        let next = appendLiveRuntimeEventBatch(created.events, batch)
        if (next.length === created.events.length && next.every((event, i) => event === created.events[i])) return
        next = next.slice(-MAX_EVENTS)
        let bytes = 0, start = next.length - 1
        for (; start >= 0; start--) {
          const event = next[start]
          let size = this.sizes.get(event)
          if (size === undefined) { size = JSON.stringify(event).length * 2; this.sizes.set(event, size) }
          if (bytes + size > MAX_BYTES && start < next.length - 1) break
          bytes += size
        }
        created.events = next.slice(start + 1)
        for (const notify of created.listeners) notify()
      })
      created = { key, events: EMPTY_RUN_LIVE_EVENTS, listeners: new Set(), terminal: false, buffer }
      entry = created
      let entries = this.runs.get(key.id)
      if (!entries) { entries = new Map(); this.runs.set(key.id, entries) }
      entries.set(this.identity(key), entry)
    }
    entry.listeners.add(listener)
    if (!this.unlisten) this.unlisten = this.source.onEvent?.(this.receive)
    const retained = entry
    return () => {
      retained.listeners.delete(listener)
      if (retained.listeners.size) return
      const entries = this.runs.get(key.id)
      entries?.delete(this.identity(key))
      if (!entries?.size) this.runs.delete(key.id)
      // Release the entry before disposal: no unmounted subscriber needs the pending local preview.
      retained.buffer.dispose()
      if (!this.runs.size) { this.unlisten?.(); this.unlisten = undefined }
    }
  }

  private identity(key: RunKey): string { return `${key.threadId}\0${key.executionEpoch}` }
  private entry(key: RunKey): Entry | undefined { return this.runs.get(key.id)?.get(this.identity(key)) }

  private receive = (event: CoreEvent): void => {
    const params = event.params !== null && typeof event.params === 'object'
      ? event.params as Record<string, unknown> : {}
    const entries = typeof params.agentRunId === 'string' ? this.runs.get(params.agentRunId) : undefined
    if (!entries) return
    const terminal = event.method === 'agent_run.terminal' || event.method === 'agent_run.cancelled'
    const live = terminal ? null : liveRuntimeEventFromCore(event, `run-live-${++this.serial}`)
    if (!terminal && !live) return
    for (const entry of entries.values()) {
      if (typeof params.threadId === 'string' && params.threadId !== entry.key.threadId) continue
      if (typeof params.executionEpoch === 'number' && params.executionEpoch !== entry.key.executionEpoch) continue
      if (terminal) { entry.buffer.flush(); entry.terminal = true }
      else if (!entry.terminal && live) entry.buffer.push(live)
    }
  }
}

const stores = new WeakMap<object, RunLiveEvents>()
export function runLiveEventsFor(source: Source): RunLiveEvents {
  let store = stores.get(source)
  if (!store) { store = new RunLiveEvents(source); stores.set(source, store) }
  return store
}
