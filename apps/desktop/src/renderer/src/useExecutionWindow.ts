import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AgentRunView, AgentRunExecutionWindowPage } from '@contracts'
import { ExecutionWindow, executionWindowPageSize } from './execution-window'

export const ExecutionReadingContext = createContext<((following: boolean) => void) | null>(null)

export function useExecutionWindow(enabled: boolean, campId: string, run: AgentRunView, liveRevision: unknown) {
  const root = useRef<HTMLDivElement>(null)
  const store = useRef<ExecutionWindow | null>(null)
  const [revision, changed] = useState(0)
  const anchor = useRef<{ key: string; top: number; host: HTMLElement } | null>(null)
  const followAfterLoad = useRef<false | 'live' | 'explicit'>(false)
  const pendingRefresh = useRef<number | null>(null)
  const lastScrollTop = useRef(0)
  const initialInvalidation = useRef(true)
  const readingHistory = useRef(false)
  const setFollowingLatest = useContext(ExecutionReadingContext)
  const scrollHost = (): HTMLElement | null => root.current?.closest<HTMLElement>('.execution-drawer-body') ?? null

  const move = async (direction: 'earlier' | 'newer' | 'latest' | 'retry'): Promise<void> => {
    const current = store.current
    if (!current || current.loading) return
    const host = scrollHost()
    setFollowingLatest?.(direction === 'latest')
    readingHistory.current = direction !== 'latest'
    if (host && direction !== 'latest') {
      const top = host.getBoundingClientRect().top
      const target = [...(root.current?.querySelectorAll<HTMLElement>('[data-execution-item-key]') ?? [])]
        .filter(element => !element.querySelector('[data-execution-item-key]'))
        .find(element => element.getBoundingClientRect().bottom > top + 4)
      if (target) anchor.current = { key: target.dataset.executionItemKey!, top: target.getBoundingClientRect().top, host }
    }
    if (direction === 'latest') followAfterLoad.current = 'explicit'
    await current[direction]()
  }

  useLayoutEffect(() => {
    if (!enabled) return undefined
    const host = scrollHost()
    const current = new ExecutionWindow(campId, run.id, executionWindowPageSize(host?.clientHeight ?? 500),
      params => window.rovai.request<AgentRunExecutionWindowPage>('agentRunExecution.page', params),
      () => changed(value => value + 1))
    store.current = current
    initialInvalidation.current = true
    followAfterLoad.current = 'live'
    // Wait for the drawer's initial focus/scroll before deciding which opened
    // stages intersect the viewport. Offscreen failed/history stages stay cold.
    let observer: IntersectionObserver | null = null
    const frame = requestAnimationFrame(() => {
      if (!host || !root.current) { void current.latest(); return }
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          observer?.disconnect()
          void current.latest()
        }
      }, { root: host, rootMargin: '80px 0px' })
      observer.observe(root.current)
    })
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      current.dispose()
      if (store.current === current) store.current = null
      if (pendingRefresh.current !== null) clearTimeout(pendingRefresh.current)
      pendingRefresh.current = null
      anchor.current = null
    }
  }, [enabled, campId, run.id])

  useEffect(() => {
    if (!enabled || !store.current || pendingRefresh.current !== null) return
    if (initialInvalidation.current) { initialInvalidation.current = false; return }
    pendingRefresh.current = window.setTimeout(() => {
      pendingRefresh.current = null
      const host = scrollHost()
      if (host?.dataset.followingLatest !== 'true') return
      followAfterLoad.current = 'live'
      void store.current?.refresh(() => scrollHost()?.dataset.followingLatest === 'true')
    }, 300)
  }, [enabled, run.updatedAt, run.executionEvidenceCount, run.status, liveRevision])

  useLayoutEffect(() => {
    const current = store.current
    if (!enabled || !current || current.loading) return
    const saved = anchor.current
    anchor.current = null
    if (saved) {
      const selector = `[data-execution-item-key="${CSS.escape(saved.key)}"], [data-execution-item-keys~="${CSS.escape(saved.key)}"]`
      const targets = [...(root.current?.querySelectorAll<HTMLElement>(selector) ?? [])]
      const target = targets.find(element => !element.querySelector('[data-execution-item-key]')) ?? targets[0]
      if (target) saved.host.scrollTop += target.getBoundingClientRect().top - saved.top
    } else if (followAfterLoad.current) {
      const host = scrollHost()
      if (host && (followAfterLoad.current === 'explicit' || host.dataset.followingLatest === 'true')) host.scrollTop = host.scrollHeight
    }
    followAfterLoad.current = false
    lastScrollTop.current = scrollHost()?.scrollTop ?? 0
  }, [enabled, revision])

  useEffect(() => {
    if (!enabled) return undefined
    const host = scrollHost()
    if (!host) return undefined
    const onScroll = (): void => {
      const previous = lastScrollTop.current
      lastScrollTop.current = host.scrollTop
      const current = store.current
      if (!current || current.loading || current.error || anchor.current) return
      const bounds = root.current?.getBoundingClientRect()
      if (!bounds) return
      const viewport = host.getBoundingClientRect()
      if (bounds.top >= viewport.bottom || bounds.bottom <= viewport.top) return
      if (host.scrollTop < previous) readingHistory.current = true
      // Direction is required: initial layout, resize and prefetched data never
      // trigger a chain of background loads through the whole Run.
      if (host.scrollTop < previous && bounds.top >= viewport.top - 120 && current.hasEarlier) void move('earlier')
      else if (host.scrollTop > previous && bounds.bottom <= viewport.bottom + 120 && current.hasNewer) void move('newer')
      else if (readingHistory.current && host.scrollTop > previous && !current.hasNewer && host.scrollHeight - host.clientHeight - host.scrollTop < 8) {
        readingHistory.current = false
        void current.refresh(() => scrollHost()?.dataset.followingLatest === 'true')
      }
    }
    host.addEventListener('scroll', onScroll, { passive: true })
    return () => host.removeEventListener('scroll', onScroll)
  }, [enabled, campId, run.id])

  const evidence = useMemo(() => store.current?.evidence ?? [], [revision, enabled, campId, run.id])
  return {
    root, evidence, loading: store.current?.loading ?? enabled,
    error: store.current?.error ?? null,
    hasEarlier: store.current?.hasEarlier ?? false,
    hasNewer: store.current?.hasNewer ?? false,
    move
  }
}
