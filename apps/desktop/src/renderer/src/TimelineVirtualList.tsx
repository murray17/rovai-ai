import { useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState,
  type ReactNode, type RefObject } from 'react'

export const PUBLIC_TIMELINE_VIRTUAL_THRESHOLD = 100
export interface TimelineVirtualListHandle {
  virtual: boolean
  ensureMounted(id: string): Promise<HTMLElement | null>
  rememberAnchor(): void
  restoreAnchor(): void
}
type Anchor = { id: string; offset: number }
type PendingMount = { id: string; resolve(node: HTMLElement | null): void }
const readingSurface = (row: HTMLElement): HTMLElement => row.matches('[data-message-id], [data-presence-run]')
  ? row : row.querySelector<HTMLElement>('[data-message-id], [data-presence-run]') ?? row

/** Public history owns its viewport, dynamic heights, selection retention and explicit-target mounting. */
export function TimelineVirtualList<T extends { id: string }>({ items, viewportRef, controllerRef,
  followingLatest, preserveReadingPosition, children }: {
  items: readonly T[]
  viewportRef: RefObject<HTMLElement | null>
  controllerRef: RefObject<TimelineVirtualListHandle | null>
  followingLatest(): boolean
  preserveReadingPosition(): boolean
  children(item: T, index: number): ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  const heights = useRef(new Map<string, number>())
  const [measurement, measured] = useState(0)
  const [range, setRange] = useState(() => ({ start: Math.max(0, items.length - 12), end: items.length,
    key: items[Math.max(0, items.length - 12)]?.id }))
  const [retained, setRetained] = useState<readonly string[]>([])
  const [target, setTarget] = useState<string | null>(null)
  const anchor = useRef<Anchor | null>(null)
  const pendingAnchor = useRef<Anchor | 'latest' | null>(null)
  const pendingMount = useRef<PendingMount | null>(null)
  const frame = useRef(0)
  const userScrollPending = useRef(false)
  const virtual = items.length > PUBLIC_TIMELINE_VIRTUAL_THRESHOLD
  const current = useRef({ followingLatest, preserveReadingPosition })
  current.current = { followingLatest, preserveReadingPosition }
  const previousItems = useRef(items)
  if (previousItems.current !== items) {
    pendingAnchor.current = virtual && !userScrollPending.current ? followingLatest() ? 'latest' : anchor.current : null
    previousItems.current = items
  }
  const indexesById = useMemo(() => new Map(items.map((item, index) => [item.id, index])), [items])
  const positions = useMemo(() => {
    const positions = [0]
    for (const item of items) positions.push(positions.at(-1)! + (heights.current.get(item.id) ?? 160))
    return positions
  }, [items, measurement])
  const positionsRef = useRef(positions)
  positionsRef.current = positions
  const findNode = useCallback((id: string): HTMLElement | null => (root.current ?? viewportRef.current)?.querySelector<HTMLElement>(
    `[data-message-id="${CSS.escape(id)}"]`) ?? null, [viewportRef])

  const rememberAnchor = useCallback(() => {
    const viewport = viewportRef.current
    // A prepend may briefly leave the old anchor outside the mounted range.
    // Keep that pending anchor until its row is mounted and restored.
    if (!viewport || !viewport.clientHeight || pendingAnchor.current) return
    const top = viewport.getBoundingClientRect().top
    // An explicitly revealed message keeps keyboard focus while surrounding
    // rows settle their heights. Preserve that destination, including when
    // regrouping changes the height of another visible row above it.
    const focused = document.activeElement?.closest<HTMLElement>('[data-timeline-key]')
    if (focused && root.current?.contains(focused)) {
      const bounds = readingSurface(focused).getBoundingClientRect()
      if (bounds.bottom > top && bounds.top < top + viewport.clientHeight) {
        anchor.current = { id: focused.dataset.timelineKey!, offset: bounds.top - top }
        return
      }
    }
    const rows = root.current?.querySelectorAll<HTMLElement>(':scope > [data-timeline-key]')
      ?? viewport.querySelectorAll<HTMLElement>('[data-message-id], [data-presence-run]')
    let fallback: Anchor | null = null
    for (const row of rows) {
      const surface = readingSurface(row)
      const bounds = surface.getBoundingClientRect()
      const id = row.dataset.timelineKey ?? row.dataset.messageId ?? `run-presence:${row.dataset.presenceRun}`
      if (!root.current) heights.current.set(id, bounds.height + 14)
      if (bounds.bottom <= top || bounds.top >= top + viewport.clientHeight) continue
      const next = { id, offset: bounds.top - top }
      if (surface.dataset.messageId) { anchor.current = next; return }
      fallback ??= next
    }
    anchor.current = fallback
  }, [viewportRef])
  const restoreAnchor = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport || !root.current || !current.current.preserveReadingPosition()) return
    if (current.current.followingLatest()) viewport.scrollTop = viewport.scrollHeight
    else if (anchor.current) {
      const row = root.current.querySelector<HTMLElement>(`[data-timeline-key="${CSS.escape(anchor.current.id)}"]`)
      if (row) viewport.scrollTop += readingSurface(row).getBoundingClientRect().top - viewport.getBoundingClientRect().top - anchor.current.offset
    }
  }, [viewportRef])
  const update = useCallback(() => {
    const viewport = viewportRef.current, element = root.current
    if (!viewport || !element || !viewport.clientHeight) return
    const pos = positionsRef.current
    const offset = viewport.getBoundingClientRect().top - element.getBoundingClientRect().top
    const overscan = Math.max(300, viewport.clientHeight * .75)
    const lower = Math.max(0, offset - overscan), upper = offset + viewport.clientHeight + overscan
    // Binary search avoids scanning the full history on scroll.
    const at = (value: number): number => {
      let low = 0, high = pos.length - 1
      while (low < high) { const middle = Math.floor((low + high + 1) / 2); if (pos[middle] <= value) low = middle; else high = middle - 1 }
      return low
    }
    const start = Math.max(0, at(lower) - 1), end = Math.min(pos.length - 1, at(upper) + 2)
    const key = items[start]?.id
    setRange(previous => previous.start === start && previous.end === end && previous.key === key ? previous : { start, end, key })
    const pinned = new Set<string>()
    const owner = (node: Node | null): string | undefined => (node instanceof Element ? node : node?.parentElement)
      ?.closest<HTMLElement>('[data-timeline-key]')?.dataset.timelineKey
    const focus = owner(document.activeElement)
    if (focus && element.contains(document.activeElement)) pinned.add(focus)
    for (const trigger of element.querySelectorAll<HTMLElement>('[aria-expanded="true"], [data-state="open"]')) {
      const key = owner(trigger); if (key) pinned.add(key)
    }
    const selection = document.getSelection()
    if (selection && !selection.isCollapsed) {
      const first = indexesById.get(owner(selection.anchorNode) ?? ''), last = indexesById.get(owner(selection.focusNode) ?? '')
      if (first !== undefined && last !== undefined) for (let index = Math.min(first, last); index <= Math.max(first, last); index++) pinned.add(items[index].id)
      else for (const node of [selection.anchorNode, selection.focusNode]) { const key = owner(node); if (key) pinned.add(key) }
      for (const row of element.querySelectorAll<HTMLElement>(':scope > [data-timeline-key]')) {
        if (selection.containsNode(row, true)) pinned.add(row.dataset.timelineKey!)
      }
    }
    const next = [...pinned].sort()
    setRetained(previous => previous.length === next.length && previous.every((key, index) => key === next[index]) ? previous : next)
    rememberAnchor()
  }, [viewportRef, indexesById, items, rememberAnchor])
  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; update() })
  }, [update])

  useImperativeHandle(controllerRef, () => ({ virtual, restoreAnchor,
    rememberAnchor() { pendingAnchor.current = null; rememberAnchor() },
    ensureMounted(id) {
      const mounted = findNode(id)
      if (mounted || !virtual || !indexesById.has(id)) return Promise.resolve(mounted)
      pendingMount.current?.resolve(null)
      setTarget(id)
      return new Promise(resolve => { pendingMount.current = { id, resolve } })
    }
  }), [virtual, indexesById, findNode, restoreAnchor, rememberAnchor])

  useLayoutEffect(() => {
    if (virtual) return
    const viewport = viewportRef.current
    rememberAnchor()
    viewport?.addEventListener('scroll', rememberAnchor, { passive: true })
    return () => viewport?.removeEventListener('scroll', rememberAnchor)
  }, [virtual, viewportRef, items, rememberAnchor])

  useLayoutEffect(() => {
    if (!virtual) return
    const viewport = viewportRef.current, element = root.current
    if (!viewport || !element) return
    const observe = new ResizeObserver(entries => {
      if (!viewport.clientHeight || !viewport.clientWidth) return
      let dirty = false
      for (const entry of entries) {
        const row = entry.target as HTMLElement, id = row.dataset.timelineKey
        if (!id) continue
        const height = row.getBoundingClientRect().height
        if (Math.abs(height - (heights.current.get(id) ?? 160)) < .5) continue
        heights.current.set(id, height); dirty = true
      }
      if (dirty) {
        if (!userScrollPending.current) pendingAnchor.current ??= current.current.followingLatest() ? 'latest' : anchor.current
        measured(value => value + 1)
      }
      schedule()
    })
    observe.observe(viewport)
    for (const row of element.querySelectorAll<HTMLElement>(':scope > [data-timeline-key]')) observe.observe(row)
    const cancelTarget = () => {
      pendingAnchor.current = null
      setTarget(null); pendingMount.current?.resolve(null); pendingMount.current = null
    }
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) userScrollPending.current = true
      cancelTarget()
    }
    const onTouchMove = () => { userScrollPending.current = true; cancelTarget() }
    const onScroll = () => { userScrollPending.current = false; schedule() }
    const mutation = new MutationObserver(schedule)
    mutation.observe(element, { attributes: true, subtree: true, attributeFilter: ['aria-expanded', 'data-state'] })
    viewport.addEventListener('scroll', onScroll, { passive: true })
    viewport.addEventListener('wheel', onWheel, { passive: true })
    viewport.addEventListener('touchstart', cancelTarget, { passive: true })
    viewport.addEventListener('touchmove', onTouchMove, { passive: true })
    document.addEventListener('selectionchange', schedule)
    document.addEventListener('focusin', schedule)
    schedule()
    return () => {
      observe.disconnect(); mutation.disconnect()
      viewport.removeEventListener('scroll', onScroll); viewport.removeEventListener('wheel', onWheel)
      viewport.removeEventListener('touchstart', cancelTarget)
      viewport.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('selectionchange', schedule); document.removeEventListener('focusin', schedule)
    }
  }, [virtual, viewportRef, range.start, range.end, retained, target, items, schedule])
  useLayoutEffect(() => {
    if (!virtual) return
    const viewport = viewportRef.current, saved = pendingAnchor.current
    if (saved && saved !== 'latest' && current.current.preserveReadingPosition()
      && indexesById.has(saved.id) && !root.current?.querySelector(`[data-timeline-key="${CSS.escape(saved.id)}"]`)) {
      setTarget(saved.id)
      return
    }
    pendingAnchor.current = null
    if (viewport && saved && current.current.preserveReadingPosition()) {
      if (saved === 'latest') {
        if (current.current.followingLatest()) viewport.scrollTop = viewport.scrollHeight
      }
      else {
        const row = root.current?.querySelector<HTMLElement>(`[data-timeline-key="${CSS.escape(saved.id)}"]`)
        if (row) viewport.scrollTop += readingSurface(row).getBoundingClientRect().top - viewport.getBoundingClientRect().top - saved.offset
      }
    }
    const pending = pendingMount.current
    if (pending) {
      const node = findNode(pending.id)
      if (node) requestAnimationFrame(() => requestAnimationFrame(() => {
        if (pendingMount.current !== pending) return
        pendingMount.current = null
        pending.resolve(findNode(pending.id))
      }))
    }
    rememberAnchor()
    schedule()
  }, [virtual, measurement, items, target, findNode, rememberAnchor, schedule, viewportRef])
  useLayoutEffect(() => {
    const keys = new Set(items.map(item => item.id))
    for (const id of heights.current.keys()) if (!keys.has(id)) heights.current.delete(id)
    if (anchor.current && !keys.has(anchor.current.id)) anchor.current = null
    const pending = pendingMount.current
    if (pending && !keys.has(pending.id)) { pending.resolve(null); pendingMount.current = null; setTarget(null) }
  }, [items])
  useLayoutEffect(() => () => {
    cancelAnimationFrame(frame.current)
    pendingMount.current?.resolve(null)
    pendingMount.current = null
  }, [])

  if (!virtual) return <>{items.map(children)}</>
  const start = range.key ? indexesById.get(range.key) ?? range.start : range.start
  const end = Math.min(items.length, start + range.end - range.start)
  const indexes = new Set<number>()
  for (let index = start; index < end; index++) indexes.add(index)
  for (const id of [...retained, ...(target ? [target] : [])]) {
    const index = indexesById.get(id)
    if (index !== undefined) for (let neighbor = Math.max(0, index - 1); neighbor <= Math.min(items.length - 1, index + 1); neighbor++) indexes.add(neighbor)
  }
  const rows: ReactNode[] = []
  let cursor = 0
  for (const index of [...indexes].sort((a, b) => a - b)) {
    const item = items[index]
    if (index > cursor) rows.push(<div key={`space:${item.id}`} aria-hidden="true" style={{ height: positions[index] - positions[cursor] }} />)
    rows.push(<div className="timeline-virtual-row" key={item.id} data-timeline-key={item.id}
      data-first={index === 0 ? 'true' : undefined} data-retained={index < start || index >= end ? 'true' : undefined}>
      {children(item, index)}
    </div>)
    cursor = index + 1
  }
  if (cursor < items.length) rows.push(<div key="space:end" aria-hidden="true" style={{ height: positions.at(-1)! - positions[cursor] }} />)
  return <div ref={root} className="timeline-virtual-list" data-retained-count={retained.length} style={{ overflowAnchor: 'none' }}>{rows}</div>
}
