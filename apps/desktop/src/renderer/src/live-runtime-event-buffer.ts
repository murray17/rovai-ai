import type { LiveRuntimeEvent } from './ui-model'

const TEXT_EVENTS = new Set(['agent.text.delta', 'agent.thought.delta', 'agent.reasoning.summary.delta',
  'agent.text.block', 'agent.thought.block', 'agent.reasoning.summary.block'])
const LIVE_TEXT_LIMIT = 8 * 1024 * 1024

/** New Core blocks retain one live entry at their first position, not every transport frame.
 * Legacy events without block identity remain untouched. Tools keep all their real facts. */
export function appendLiveRuntimeEventBatch(current: LiveRuntimeEvent[], batch: LiveRuntimeEvent[]): LiveRuntimeEvent[] {
  const result = [...current]
  const positions = new Map<string, number>()
  const payload = (event: LiveRuntimeEvent): Record<string, unknown> =>
    event.payload !== null && typeof event.payload === 'object' ? event.payload as Record<string, unknown> : {}
  const key = (event: LiveRuntimeEvent): string | null => {
    const blockId = payload(event).blockId
    return TEXT_EVENTS.has(event.eventType) && typeof blockId === 'string'
      ? `${event.agentRunId}\0${event.eventType.replace(/\.(delta|block)$/, '')}\0${blockId}`
      : null
  }
  result.forEach((event, index) => { const id = key(event); if (id) positions.set(id, index) })
  for (const event of batch) {
    const id = key(event)
    const index = id === null ? undefined : positions.get(id)
    if (index !== undefined) {
      const previous = result[index]
      const old = payload(previous)
      const next = payload(event)
      if (event.eventType.endsWith('.block')) {
        result[index] = { ...event, createdAt: previous.createdAt }
        continue
      }
      if (previous.eventType.endsWith('.block') && old.status !== 'streaming') continue
      if (typeof old.delta === 'string' && typeof next.delta === 'string'
        && typeof old.textOffset === 'number' && typeof next.textOffset === 'number'
        && next.textOffset >= old.textOffset && next.textOffset <= old.textOffset + old.delta.length) {
        const joined = old.delta + next.delta.slice(old.textOffset + old.delta.length - next.textOffset)
        result[index] = { ...previous, payload: { ...old, delta: joined.slice(0, LIVE_TEXT_LIMIT) } }
        continue
      }
      // Once bounded, no more frames need to be retained; the authoritative block replaces it.
      if (typeof old.delta === 'string' && old.delta.length >= LIVE_TEXT_LIMIT) continue
    }
    if (id !== null) positions.set(id, result.length)
    result.push(event)
  }
  return result
}

/** Keep the full ordered evidence stream, but only wake React for visible
 * progress. Thought events still delimit anonymous narration and must survive. */
export function createLiveRuntimeEventBuffer(append: (events: LiveRuntimeEvent[]) => void): {
  push(event: LiveRuntimeEvent): void
  flush(): void
  dispose(): void
} {
  let pending: LiveRuntimeEvent[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  const flush = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    if (pending.length === 0) return
    const batch = pending
    pending = []
    append(batch)
  }
  return {
    push(event) {
      if (disposed) return
      pending = appendLiveRuntimeEventBatch(pending, [event])
      if (event.eventType === 'agent.thought.delta' || event.eventType === 'agent.reasoning.summary.delta') return
      if (timer === null) timer = setTimeout(flush, 32)
    },
    flush,
    dispose() {
      disposed = true
      // Effect resubscriptions must not drop a pending narration boundary.
      flush()
    }
  }
}
