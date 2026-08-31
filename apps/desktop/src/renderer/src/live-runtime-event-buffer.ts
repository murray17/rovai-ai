import type { LiveRuntimeEvent } from './ui-model'

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
      pending.push(event)
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
