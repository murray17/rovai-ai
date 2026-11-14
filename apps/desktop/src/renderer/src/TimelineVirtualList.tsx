import { useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState,
  type ReactNode, type RefObject } from 'react'

export const PUBLIC_TIMELINE_VIRTUAL_THRESHOLD = 100
export interface TimelineVirtualListHandle {
  virtual: boolean
  /** Resolve after the row and any data-timeline-pending content are mounted. */
  ensureMounted(id: string): Promise<HTMLElement | null>
  rememberAnchor(): void
  restoreAnchor(): void
}
type Anchor = { id: string; offset: number }
type PendingMount = { id: string; resolve(node: HTMLElement | null): void }
const readingSurface = (row: HTMLElement): HTMLElement => row.matches('[data-message-id], [data-presence-run]')
  ? row : row.querySelector<HTMLElement>('[data-message-id], [data-presence-run]') ?? row
const selectionTouches = (element: HTMLElement, selection: Selection | null): boolean => {
  if (!selection) return false
  if (element.contains(selection.anchorNode) || element.contains(selection.focusNode)) return true
  // A selection can cross the history with both endpoints outside it. Read
  // DOM range boundaries here: Selection.isCollapsed can reconcile layout,
  // even for a composer caret whose history ownership never changed.
  for (let index = 0; index < selection.rangeCount; index++) {
    const range = selection.getRangeAt(index)
    if (!range.collapsed && range.intersectsNode(element)) return true
  }
  return false
}

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
  const interaction = useRef({ selection: false, focus: false })
  const virtual = items.length > PUBLIC_TIMELINE_VIRTUAL_THRESHOLD
  const committedVirtual = useRef(virtual)
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
      if (!virtual) heights.current.set(id, row.getBoundingClientRect().height)
      if (bounds.bottom <= top || bounds.top >= top + viewport.clientHeight) continue
      const next = { id, offset: bounds.top - top }
      if (surface.dataset.messageId) { anchor.current = next; return }
      fallback ??= next
    }
    anchor.current = fallback
  }, [viewportRef, virtual])
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
    interaction.current = { selection: selectionTouches(element, selection), focus: element.contains(document.activeElement) }
    if (interaction.current.selection && selection && !selection.isCollapsed) {
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
      if (mounted && !mounted.querySelector('[data-timeline-pending]')
        || !indexesById.has(id) || !virtual && !mounted) return Promise.resolve(mounted)
      pendingMount.current?.resolve(null)
      setTarget(id)
      return new Promise(resolve => { pendingMount.current = { id, resolve } })
    }
  }), [virtual, indexesById, findNode, restoreAnchor, rememberAnchor])

  useLayoutEffect(() => {
    if (!items.length) return
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
      if (dirty && virtual) {
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
    const onSelectionChange = () => {
      const inside = selectionTouches(element, document.getSelection())
      if (inside || interaction.current.selection) schedule()
      interaction.current.selection = inside
    }
    const onFocusIn = (event: FocusEvent) => {
      const inside = event.target instanceof Node && element.contains(event.target)
      if (inside || interaction.current.focus) schedule()
      interaction.current.focus = inside
    }
    const onFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && element.contains(event.relatedTarget)) return
      interaction.current.focus = false
      schedule()
    }
    const mutation = new MutationObserver(records => {
      // Navigation waits for deferred row content, including a short timeline
      // whose new content happens to keep the same height. Ordinary child-list
      // mutations do not schedule another geometry pass.
      const pending = pendingMount.current, node = pending && findNode(pending.id)
      if (node && !node.querySelector('[data-timeline-pending]')) measured(value => value + 1)
      if (records.some(record => record.type === 'attributes')) schedule()
    })
    mutation.observe(element, { childList: true, attributes: true, subtree: true, attributeFilter: ['aria-expanded', 'data-state', 'data-timeline-pending'] })
    viewport.addEventListener('scroll', onScroll, { passive: true })
    viewport.addEventListener('wheel', onWheel, { passive: true })
    viewport.addEventListener('touchstart', cancelTarget, { passive: true })
    viewport.addEventListener('touchmove', onTouchMove, { passive: true })
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('focusin', onFocusIn)
    element.addEventListener('focusout', onFocusOut)
    schedule()
    return () => {
      observe.disconnect(); mutation.disconnect()
      viewport.removeEventListener('scroll', onScroll); viewport.removeEventListener('wheel', onWheel)
      viewport.removeEventListener('touchstart', cancelTarget)
      viewport.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('focusin', onFocusIn); element.removeEventListener('focusout', onFocusOut)
    }
  }, [virtual, viewportRef, range.start, range.end, retained, target, items, schedule, findNode])
  useLayoutEffect(() => {
    if (virtual) {
      // Reconcile newly mounted rows before remembering a new reading position.
      // Their real height can move a still-focused message before ResizeObserver
      // delivers its first entries; recording that intermediate offset loses it.
      let dirty = false
      if (viewportRef.current?.clientHeight) for (const row of root.current?.querySelectorAll<HTMLElement>(':scope > [data-timeline-key]') ?? []) {
        const height = row.getBoundingClientRect().height, id = row.dataset.timelineKey!
        if (Math.abs(height - (heights.current.get(id) ?? 160)) < .5) continue
        heights.current.set(id, height); dirty = true
      }
      if (dirty) {
        if (!userScrollPending.current) pendingAnchor.current ??= current.current.followingLatest() ? 'latest' : anchor.current
        measured(value => value + 1)
        return
      }
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
    }
    const pending = pendingMount.current
    if (pending) {
      const node = findNode(pending.id)
      if (node && !node.querySelector('[data-timeline-pending]')) requestAnimationFrame(() => requestAnimationFrame(() => {
        if (pendingMount.current !== pending) return
        const settled = findNode(pending.id)
        if (settled?.querySelector('[data-timeline-pending]')) return
        pendingMount.current = null
        pending.resolve(settled)
      }))
    }
    if (virtual) { rememberAnchor(); schedule() }
  }, [virtual, measurement, items, target, range, retained, findNode, rememberAnchor, schedule, viewportRef])
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

  // Capture interaction owners before the first windowed commit can remove
  // them; focus/selection events may arrive in the same frame as a 50-row page.
  const transitionRetained: string[] = []
  if (virtual && !committedVirtual.current && root.current) {
    const selection = document.getSelection()
    for (const row of root.current.querySelectorAll<HTMLElement>(':scope > [data-timeline-key]')) {
      if (row.contains(document.activeElement)
        || row.querySelector('[aria-expanded="true"], [data-state="open"]')
        || selection && !selection.isCollapsed && (row.contains(selection.anchorNode)
          || row.contains(selection.focusNode) || selection.containsNode(row, true))) {
        transitionRetained.push(row.dataset.timelineKey!)
      }
    }
  }
  useLayoutEffect(() => {
    if (transitionRetained.length) setRetained(previous => {
      const next = [...new Set([...previous, ...transitionRetained])].sort()
      return previous.length === next.length && previous.every((id, index) => id === next[index]) ? previous : next
    })
    committedVirtual.current = virtual
  }, [virtual])

  if (!items.length) return null
  // Keep the same keyed wrappers below and above the threshold. A threshold
  // crossing must not remount focused/selected messages or moving Run rows.
  const start = virtual ? range.key ? indexesById.get(range.key) ?? range.start : range.start : 0
  const end = virtual ? Math.min(items.length, start + range.end - range.start) : items.length
  const indexes = new Set<number>()
  for (let index = start; index < end; index++) indexes.add(index)
  for (const id of [...retained, ...transitionRetained, ...(target ? [target] : [])]) {
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
  return <div ref={root} className="timeline-virtual-list"
    data-retained-count={[...indexes].filter(index => index < start || index >= end).length}
    style={{ overflowAnchor: 'none' }}>{rows}</div>
}
