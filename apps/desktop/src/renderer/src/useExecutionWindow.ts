import { useThreadClient } from './camp-client'
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AgentRunView, AgentRunExecutionBlockPage, AgentRunExecutionBlockChanges, AgentRunExecutionEvidenceView } from '@contracts'
import { ExecutionWindow, executionWindowPageSize, executionWindowCacheFor } from './execution-window'

export const ExecutionReadingContext = createContext<((following: boolean) => void) | null>(null)
export const ExecutionLatestContext = createContext<{
  runId: string | null
  request: number
  setHasNewer(hasNewer: boolean): void
} | null>(null)

const EXECUTION_READING_INTENT_MAX_AGE_MS = 1_500

function hasRecentExecutionReadingIntent(host: HTMLElement): boolean {
  const markedAt = Number(host.dataset.executionReadingIntent)
  return Number.isFinite(markedAt)
    && performance.now() - markedAt <= EXECUTION_READING_INTENT_MAX_AGE_MS
}

export function useExecutionWindow(enabled: boolean, threadId: string, run: AgentRunView, liveRevision: unknown, contentRevision: unknown) {
  const client = useThreadClient()
  const root = useRef<HTMLDivElement>(null)
  const store = useRef<ExecutionWindow | null>(null)
  const [revision, changed] = useState(0)
  const anchor = useRef<{ key: string; top: number; host: HTMLElement } | null>(null)
  const followAfterLoad = useRef<false | 'live' | 'explicit'>(false)
  const coldLoadStartedAt = useRef<number | null>(null)
  const pendingRefresh = useRef<number | null>(null)
  const lastScrollTop = useRef(0)
  const initialInvalidation = useRef(true)
  const readingHistory = useRef(false)
  const initialFillPages = useRef(0)
  const initialFillActive = useRef(true)
  const shownError = useRef<string | null>(null)
  const setFollowingLatest = useContext(ExecutionReadingContext)
  const latest = useContext(ExecutionLatestContext)
  const handledLatest = useRef(latest?.request ?? 0)
  const scrollHost = (): HTMLElement | null => root.current?.closest<HTMLElement>('.execution-drawer-body') ?? null

  const move = async (direction: 'earlier' | 'newer' | 'latest' | 'retry', automatic = false): Promise<void> => {
    const current = store.current
    if (!current || current.loading) return
    const action = direction === 'retry' ? current.direction : direction
    const host = scrollHost()
    if (!automatic) {
      setFollowingLatest?.(action === 'latest')
      readingHistory.current = action !== 'latest'
      initialFillActive.current = action === 'latest'
    }
    if (automatic && host?.dataset.followingLatest === 'true') followAfterLoad.current = 'live'
    if (host && action !== 'latest' && !automatic) {
      const top = host.getBoundingClientRect().top + 46
      const target = [...(root.current?.querySelectorAll<HTMLElement>('[data-execution-item-key]') ?? [])]
        .filter(element => !element.querySelector('[data-execution-item-key]'))
        .find(element => element.getBoundingClientRect().bottom > top + 4)
      if (target) {
        host.dataset.executionAnchorKey = target.dataset.executionItemKey!
        host.dataset.executionAnchorRun = run.id
      }
      if (target) anchor.current = { key: target.dataset.executionItemKey!, top: target.getBoundingClientRect().top, host }
    }
    if (action === 'latest') {
      followAfterLoad.current = 'explicit'
      if (host) delete host.dataset.executionAnchorKey
    }
    await current[direction]()
  }

  useLayoutEffect(() => {
    if (!enabled) return undefined
    const host = scrollHost()
    const retained = executionWindowCacheFor(client).acquire(`${threadId}:${run.id}:${run.executionEpoch}`,
      notify => new ExecutionWindow(threadId, run.id, executionWindowPageSize(host?.clientHeight || 500),
        params => client.request<AgentRunExecutionBlockPage>('agentRunExecution.page', { ...params, projection: 'blocks' }), notify,
        params => client.request<AgentRunExecutionBlockChanges>('agentRunExecution.changes', { ...params, projection: 'blocks' })),
      () => changed(value => value + 1))
    const current = retained.window
    const wasLoaded = current.loaded
    store.current = current
    initialInvalidation.current = true
    readingHistory.current = false
    initialFillPages.current = 0
    initialFillActive.current = true
    shownError.current = null
    followAfterLoad.current = 'live'
    // Wait for the drawer's initial focus/scroll before deciding which opened
    // stages intersect the viewport. Offscreen failed/history stages stay cold.
    let observer: IntersectionObserver | null = null
    const readLatest = (): void => {
      if (!wasLoaded && coldLoadStartedAt.current === null) {
        coldLoadStartedAt.current = performance.now()
        console.info(`[execution-window] method=agentRunExecution.page camp=${threadId} run=${run.id} stage=renderer_request`)
      }
      void current.latest().then(() => { if (wasLoaded) void current.refresh() })
    }
    const frame = requestAnimationFrame(() => {
      if (!host || !root.current) { readLatest(); return }
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          observer?.disconnect()
          readLatest()
        }
      }, { root: host, rootMargin: '80px 0px' })
      observer.observe(root.current)
    })
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      retained.release()
      if (store.current === current) store.current = null
      if (pendingRefresh.current !== null) clearTimeout(pendingRefresh.current)
      pendingRefresh.current = null
      anchor.current = null
    }
  }, [client, enabled, threadId, run.id, run.executionEpoch])

  useLayoutEffect(() => {
    if (!enabled || latest?.runId !== run.id || latest.request === handledLatest.current
      || !store.current || store.current.loading) return
    handledLatest.current = latest.request
    anchor.current = null
    void move('latest')
  }, [enabled, latest?.runId, latest?.request, revision])

  useEffect(() => {
    if (latest?.runId === run.id) latest.setHasNewer(Boolean(enabled && store.current?.hasNewer))
  }, [enabled, latest?.runId, latest?.setHasNewer, revision, run.id])
  useEffect(() => {
    if (latest?.runId !== run.id) return
    return () => latest.setHasNewer(false)
  }, [latest?.runId, latest?.setHasNewer, run.id])

  useEffect(() => {
    if (!enabled || !store.current || pendingRefresh.current !== null) return
    if (initialInvalidation.current) { initialInvalidation.current = false; return }
    pendingRefresh.current = window.setTimeout(() => {
      pendingRefresh.current = null
      const following = (): boolean => !readingHistory.current && scrollHost()?.dataset.followingLatest === 'true'
      if (following()) followAfterLoad.current = 'live'
      void store.current?.refresh(following)
    }, 300)
  }, [enabled, run.updatedAt, run.executionEvidenceChangeSequence, run.status, liveRevision])

  useLayoutEffect(() => {
    const current = store.current
    // The initial request starts after intersection/focus. Keep the follow intent
    // until an actual page has arrived, including a successfully empty page.
    if (!enabled || !current || current.loading) return
    if (!current.error) shownError.current = null
    if (current.error && current.error !== shownError.current) {
      shownError.current = current.error
      initialFillActive.current = false
      const host = scrollHost()
      const edge = root.current?.querySelector<HTMLElement>(':scope > .execution-history-loader.is-error')
      const header = root.current?.closest('.execution-process-card')?.querySelector('.execution-run-card-header')
      if (host && edge && edge.getBoundingClientRect().bottom >= host.getBoundingClientRect().top - 120) {
        setFollowingLatest?.(false)
        const top = Math.max(host.getBoundingClientRect().top, header?.getBoundingClientRect().bottom ?? 0) + 8
        host.scrollTop += edge.getBoundingClientRect().top - top
        host.dataset.executionAdjustedTop = String(host.scrollTop)
      }
      anchor.current = null; followAfterLoad.current = false
    }
    if (!current.loaded) {
      const coldStartedAt = coldLoadStartedAt.current
      if (current.error && coldStartedAt !== null) {
        coldLoadStartedAt.current = null
        console.info(
          `[execution-window] method=agentRunExecution.page camp=${threadId} run=${run.id} `
          + `stage=renderer_failed elapsed_ms=${Math.round(performance.now() - coldStartedAt)}`
        )
      }
      return
    }
    const coldStartedAt = coldLoadStartedAt.current
    if (coldStartedAt !== null) {
      coldLoadStartedAt.current = null
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (store.current !== current || !root.current) return
        console.info(
          `[execution-window] method=agentRunExecution.page camp=${threadId} run=${run.id} `
          + `stage=renderer_painted elapsed_ms=${Math.round(performance.now() - coldStartedAt)}`
        )
      }))
    }
    if (scrollHost()?.dataset.executionDisclosureAnchor === 'true') {
      anchor.current = null
      followAfterLoad.current = false
      return
    }
    const saved = anchor.current
    anchor.current = null
    if (saved) {
      const selector = `[data-execution-item-key="${CSS.escape(saved.key)}"], [data-execution-item-keys~="${CSS.escape(saved.key)}"]`
      const targets = [...(root.current?.querySelectorAll<HTMLElement>(selector) ?? [])]
      const target = targets.find(element => !element.querySelector('[data-execution-item-key]')) ?? targets[0]
      if (target) saved.host.scrollTop += target.getBoundingClientRect().top - saved.top
    } else if (followAfterLoad.current || (!readingHistory.current && !current.hasNewer)) {
      const host = scrollHost()
      if (host && (followAfterLoad.current === 'explicit' || host.dataset.followingLatest === 'true')) host.scrollTop = host.scrollHeight
    }
    followAfterLoad.current = false
    lastScrollTop.current = scrollHost()?.scrollTop ?? 0
    const adjustedHost = scrollHost()
    if (adjustedHost) adjustedHost.dataset.executionAdjustedTop = String(adjustedHost.scrollTop)
  }, [enabled, revision, contentRevision, threadId, run.id])

  // First paint can contain mostly folded groups and have no scrollbar at all.
  // Fill only a visible, short Run, with a separate bounded budget from history navigation.
  useEffect(() => {
    const host = scrollHost(), element = root.current, current = store.current
    if (!enabled || !host || !element || !current?.loaded || current.loading || current.error || !current.hasEarlier) return
    let frame = 0
    const check = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!initialFillActive.current || initialFillPages.current >= 3 || current !== store.current
          || current.loading || current.error || !current.hasEarlier) return
        const bounds = element.getBoundingClientRect(), viewport = host.getBoundingClientRect()
        if (bounds.bottom <= viewport.top || bounds.top >= viewport.bottom
          || host.dataset.executionDisclosureAnchor === 'true') return
        if (bounds.height < host.clientHeight - 46 + 80) {
          initialFillPages.current++
          void move('earlier', true)
        }
      })
    }
    const resize = new ResizeObserver(check); resize.observe(host); resize.observe(element); check()
    return () => { resize.disconnect(); cancelAnimationFrame(frame) }
  }, [client, enabled, revision, contentRevision, threadId, run.id])

  useEffect(() => {
    if (!enabled) return undefined
    const host = scrollHost()
    if (!host) return undefined
    const readEarlierAtBoundary = () => {
      initialFillActive.current = false
      const current = store.current, bounds = root.current?.getBoundingClientRect()
      if (!current || current.loading || current.error || !bounds || !current.hasEarlier) return
      const viewport = host.getBoundingClientRect()
      if (bounds.top >= viewport.top - 120 && bounds.top < viewport.bottom && bounds.bottom > viewport.top) void move('earlier')
    }
    const onWheel = (event: WheelEvent) => {
      if ((event.target as Element).closest('pre, .tool-call-result')) return
      if (event.deltaY < 0) readEarlierAtBoundary()
    }
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as Element).closest('pre, .tool-call-result, input, textarea')) return
      if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) readEarlierAtBoundary()
    }
    const onScroll = (): void => {
      if (host.dataset.executionDisclosureAnchor === 'true') {
        lastScrollTop.current = host.scrollTop
        return
      }
      const previous = lastScrollTop.current
      lastScrollTop.current = host.scrollTop
      const adjusted = host.dataset.executionAdjustedTop
      delete host.dataset.executionAdjustedTop
      if (adjusted !== undefined && Math.abs(Number(adjusted) - host.scrollTop) < 1) return
      delete host.dataset.executionAnchorKey
      if (!hasRecentExecutionReadingIntent(host)) return
      const current = store.current
      if (!current || current.loading || current.error || anchor.current) return
      const bounds = root.current?.getBoundingClientRect()
      if (!bounds) return
      const viewport = host.getBoundingClientRect()
      if (bounds.top >= viewport.bottom || bounds.bottom <= viewport.top) return
      if (host.scrollTop < previous && !readingHistory.current) {
        initialFillActive.current = false
        readingHistory.current = true
        changed(value => value + 1)
      }
      // Direction is required: initial layout, resize and prefetched data never
      // trigger a chain of background loads through the whole Run.
      if (host.scrollTop < previous && bounds.top >= viewport.top - 120 && current.hasEarlier) void move('earlier')
      else if (host.scrollTop > previous && bounds.bottom <= viewport.bottom + 120 && current.hasNewer) void move('newer')
      else if (readingHistory.current && host.scrollTop > previous && !current.hasNewer && host.scrollHeight - host.clientHeight - host.scrollTop < 8) {
        readingHistory.current = false
        void move('latest')
      }
    }
    host.addEventListener('scroll', onScroll, { passive: true })
    host.addEventListener('wheel', onWheel, { passive: true })
    host.addEventListener('keydown', onKey)
    return () => { host.removeEventListener('scroll', onScroll); host.removeEventListener('wheel', onWheel); host.removeEventListener('keydown', onKey) }
  }, [client, enabled, threadId, run.id])

  const evidence = useMemo(() => store.current?.threadId === threadId && store.current.agentRunId === run.id
    ? store.current.evidence : [], [revision, enabled, threadId, run.id])
  return {
    project: <T,>(input: AgentRunExecutionEvidenceView[], build: () => T): T => store.current?.project(input, build) ?? build(),
    contentCache: store.current?.content ?? null,
    setViewport: (first: number, last: number) => store.current?.setViewport(first, last),
    blocks: store.current?.blocks ?? [],
    root, evidence, runtimePhase: store.current?.runtimePhase,
    loading: enabled && (store.current?.loading || (!store.current?.loaded && !store.current?.error)),
    direction: store.current?.direction ?? 'latest',
    error: store.current?.error ?? null,
    hasEarlier: store.current?.hasEarlier ?? false,
    hasNewer: Boolean(store.current?.hasNewer || readingHistory.current),
    move
  }
}
