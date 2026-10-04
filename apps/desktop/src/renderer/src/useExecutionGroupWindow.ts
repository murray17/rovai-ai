import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { AgentRunExecutionBlock, AgentRunExecutionGroupPage, AgentRunExecutionWindowChanges } from '@contracts'
import { useThreadClient } from './camp-client'
import { ExecutionContentContext } from './ExecutionVirtualList'
import { ExecutionGroupWindow, type GroupSnapshot } from './execution-group-window'
import { ExecutionReadingContext } from './useExecutionWindow'

export function useExecutionGroupWindow(
  block: AgentRunExecutionBlock | undefined, threadId: string, runId: string,
  expanded: boolean, liveTail: boolean, root: RefObject<HTMLDetailsElement | null>
) {
  const client = useThreadClient(), cache = useContext(ExecutionContentContext)
  const setFollowing = useContext(ExecutionReadingContext)
  const [revision, changed] = useState(0)
  const before = useRef<HTMLDivElement>(null), after = useRef<HTMLDivElement>(null)
  const tail = useRef(liveTail); tail.current = liveTail
  const mounted = useRef(false), automaticPages = useRef(0)
  const anchor = useRef<{ element: HTMLElement; top: number; host: HTMLElement } | null>(null)
  const key = block ? `group-window:${runId}:${block.key}` : ''
  const window = useMemo(() => block ? new ExecutionGroupWindow(threadId, runId, block.sequence, () => tail.current,
    params => client.request<AgentRunExecutionGroupPage>('agentRunExecution.page', params),
    params => client.request<AgentRunExecutionWindowChanges>('agentRunExecution.changes', params),
    () => { if (mounted.current) changed(value => value + 1) }, cache?.get<GroupSnapshot>(key)) : null,
  [client, cache, key, threadId, runId])
  const host = () => root.current?.closest<HTMLElement>('.execution-drawer-body') ?? null
  const capture = () => {
    const viewport = host(), content = root.current
    if (!viewport || !content || viewport.dataset.executionDisclosureAnchor === 'true') return
    const top = viewport.getBoundingClientRect().top + 46
    const element = [...content.querySelectorAll<HTMLElement>('[data-execution-item-key]')]
      .filter(item => !item.querySelector('[data-execution-item-key]'))
      .find(item => item.getBoundingClientRect().bottom > top)
    if (element) anchor.current = { element, top: element.getBoundingClientRect().top, host: viewport }
  }
  const move = async (direction: 'initial' | 'earlier' | 'newer' | 'retry', automatic = false) => {
    if (!window || !block || window.loading) return
    capture()
    if (direction === 'earlier' && !automatic) setFollowing?.(false)
    if (direction === 'retry') await window.retry(block)
    else { await window.read(direction); await window.refresh(block) }
  }
  const current = useRef({ move, expanded, block }); current.current = { move, expanded, block }
  useEffect(() => {
    mounted.current = true; automaticPages.current = 0
    return () => { mounted.current = false; window?.dispose() }
  }, [window])
  useEffect(() => {
    if (!window || !expanded) { window?.dispose(); return }
    window.resume()
    void window.read().then(() => { if (current.current.expanded && current.current.block) void window.refresh(current.current.block) })
  }, [window, expanded])
  useEffect(() => {
    if (expanded && block && window?.state.initialized) {
      if (host()?.dataset.followingLatest !== 'true') capture()
      void window.refresh(block)
    }
  }, [window, expanded, block?.changeSequence])
  useLayoutEffect(() => {
    if (!window) return
    cache?.set(key, window.state)
    const saved = anchor.current
    if (!window.loading && saved?.element.isConnected && saved.host.dataset.executionDisclosureAnchor !== 'true') {
      saved.host.scrollTop += saved.element.getBoundingClientRect().top - saved.top
      saved.host.dataset.executionAdjustedTop = String(saved.host.scrollTop)
      anchor.current = null
    }
  }, [revision, window, cache, key])
  useEffect(() => {
    const viewport = host()
    if (!window || !expanded || !viewport) return
    const reading = (event: Event) => {
      automaticPages.current = 0
      if (event.target instanceof Element && event.target.closest('pre, textarea, input, [contenteditable=true]')) return
      const bounds = viewport.getBoundingClientRect()
      const visible = (element: HTMLElement | null) => element && element.getBoundingClientRect().bottom >= bounds.top
        && element.getBoundingClientRect().top <= bounds.bottom
      const upward = event instanceof WheelEvent ? event.deltaY < 0
        : event instanceof KeyboardEvent && ['ArrowUp', 'PageUp', 'Home'].includes(event.key)
      const downward = event instanceof WheelEvent ? event.deltaY > 0
        : event instanceof KeyboardEvent && ['ArrowDown', 'PageDown', 'End'].includes(event.key)
      if (upward && window.state.hasEarlier && visible(before.current)) void current.current.move('earlier')
      else if (downward && window.state.hasNewer && visible(after.current)) void current.current.move('newer')
    }
    viewport.addEventListener('wheel', reading, { passive: true })
    viewport.addEventListener('touchmove', reading, { passive: true })
    viewport.addEventListener('keydown', reading)
    return () => {
      viewport.removeEventListener('wheel', reading); viewport.removeEventListener('touchmove', reading); viewport.removeEventListener('keydown', reading)
    }
  }, [window, expanded])
  useEffect(() => {
    const viewport = host()
    if (!window || !expanded || !window.state.initialized || window.loading || window.error || !viewport) return
    const observer = new IntersectionObserver(entries => {
      if (automaticPages.current >= 3 || window.loading || window.error) return
      const entry = entries.find(entry => entry.isIntersecting)
      if (!entry) return
      automaticPages.current++
      void current.current.move(entry.target === before.current ? 'earlier' : 'newer', true)
    }, { root: viewport, rootMargin: '80px 0px' })
    if (window.state.hasEarlier && before.current) observer.observe(before.current)
    if (window.state.hasNewer && after.current) observer.observe(after.current)
    return () => observer.disconnect()
  }, [window, expanded, revision])
  return { window, before, after, move }
}
