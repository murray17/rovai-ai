import { useEffect, useRef, useState, type RefObject } from 'react'
import type { RuntimeExecutionMetricsSnapshot } from '@contracts'
import type { ThreadClient } from './camp-client'
import { ExecutionMetricsReader, type ExecutionMetricsScope } from './execution-metrics-reader'

/** Observe actual clipped cards, including collapsed cards with a visible token entry. */
export function useExecutionMetricsVisibility(panelRef: RefObject<HTMLElement | null>): {
  visible: boolean
  visibleRunIds: ReadonlySet<string>
} {
  const [visibility, setVisibility] = useState({ visible: false, visibleRunIds: new Set<string>() })
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    let panelVisible = false
    const visibleIds = new Set<string>()
    const observed = new Set<Element>()
    const publish = (): void => {
      const visible = panelVisible && !document.hidden
      setVisibility(old => old.visible === visible && old.visibleRunIds.size === visibleIds.size
        && [...visibleIds].every(id => old.visibleRunIds.has(id))
        ? old : { visible, visibleRunIds: new Set(visibleIds) })
    }
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.target === panel) panelVisible = entry.isIntersecting
        else if (observed.has(entry.target)) {
          const id = entry.target.getAttribute('data-agent-run-id')
          if (id) { if (entry.isIntersecting) visibleIds.add(id); else visibleIds.delete(id) }
        }
      }
      publish()
    })
    observer.observe(panel)
    const reconcile = (): void => {
      const cards = new Set(panel.querySelectorAll('[data-agent-run-id]'))
      for (const element of observed) {
        if (cards.has(element)) continue
        observer.unobserve(element)
        observed.delete(element)
        const id = element.getAttribute('data-agent-run-id')
        if (id) visibleIds.delete(id)
      }
      for (const element of cards) {
        if (observed.has(element)) continue
        observed.add(element)
        observer.observe(element)
      }
      publish()
    }
    const mutation = new MutationObserver(records => {
      // Text, speed and Evidence changes do not change the set of Run cards.
      if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node =>
        node instanceof Element && (node.matches('[data-agent-run-id]') || node.querySelector('[data-agent-run-id]'))
      ))) reconcile()
    })
    mutation.observe(panel, { childList: true, subtree: true })
    reconcile()
    document.addEventListener('visibilitychange', publish)
    return () => {
      observer.disconnect()
      mutation.disconnect()
      document.removeEventListener('visibilitychange', publish)
    }
  }, [panelRef])
  return visibility
}

export function useExecutionMetrics(
  client: Pick<ThreadClient, 'request' | 'onEvent' | 'onInvalidated'>,
  threadId: string,
  agentId: string,
  scope: ExecutionMetricsScope
): RuntimeExecutionMetricsSnapshot | null {
  const owner = `${threadId}\u0000${agentId}`
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const readerRef = useRef<ExecutionMetricsReader | null>(null)
  const [state, setState] = useState<{ client: typeof client; owner: string; snapshot: RuntimeExecutionMetricsSnapshot } | null>(null)
  useEffect(() => {
    const reader = new ExecutionMetricsReader(ids => client.request('monitoring.execution', {
      threadId, agentRunIds: ids
    }), snapshot => setState({ client, owner, snapshot }))
    readerRef.current = reader
    reader.setScope(scopeRef.current)
    const unsubscribe = client.onEvent?.(event => {
      if (event.method === 'monitoring.changed' || event.method === 'agent_run.terminal') reader.invalidate()
      if (event.method === 'runtime.state'
        && (event.params as { status?: string } | null)?.status === 'ready') reader.invalidate(true)
    })
    const unlisten = client.onInvalidated?.(() => reader.invalidate())
    const onFocus = (): void => reader.invalidate(true)
    window.addEventListener('focus', onFocus)
    return () => {
      reader.dispose()
      unsubscribe?.()
      unlisten?.()
      window.removeEventListener('focus', onFocus)
      if (readerRef.current === reader) readerRef.current = null
    }
  }, [client, threadId, owner])
  useEffect(() => { readerRef.current?.setScope(scope) }, [scope.visible, scope.runs, scope.visibleRunIds, scope.expandedRunIds])
  return state?.client === client && state.owner === owner ? state.snapshot : null
}
