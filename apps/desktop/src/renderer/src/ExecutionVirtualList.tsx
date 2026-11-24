import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { ExecutionContentCache } from './execution-content-cache'

export const ExecutionContentContext = createContext<ExecutionContentCache | null>(null)
export function useExecutionRetainedState<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const cache = useContext(ExecutionContentContext)
  const [value, setValue] = useState<T>(() => cache?.get<T>(key) ?? (typeof initial === 'function' ? (initial as () => T)() : initial))
  return [value, next => setValue(previous => {
    const resolved = typeof next === 'function' ? (next as (previous: T) => T)(previous) : next
    // In-flight work belongs to the mounted row and must restart after unmount.
    if (!(resolved && typeof resolved === 'object' && 'status' in resolved && resolved.status === 'loading')) cache?.set(key, resolved)
    return resolved
  })]
}

/** Measured variable-height rows; the native scroll space remains continuous. */
export function ExecutionVirtualList<T extends { key: string }>({ items, children, enabled = true, gap = 14, gapAfter, onVisible }: {
  items: T[]; children: (item: T) => ReactNode; enabled?: boolean; gap?: number; gapAfter?: (item: T, next: T) => number; onVisible?: (items: T[]) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const heights = useRef(new Map<string, number>())
  const [measurement, measure] = useState(0)
  const [range, setRange] = useState(() => ({ start: Math.max(0, items.length - 8), end: items.length, key: items[Math.max(0, items.length - 8)]?.key, focus: undefined as string | undefined, anchor: undefined as string | undefined }))
  const onVisibleRef = useRef(onVisible); onVisibleRef.current = onVisible
  const gaps = useMemo(() => items.map((item, index) => index === items.length - 1 ? 0
    : gapAfter?.(item, items[index + 1]) ?? gap), [items, gap, gapAfter])
  const positions = useMemo(() => {
    const result = [0]
    for (const [index, item] of items.entries()) result.push(result.at(-1)! + (heights.current.get(item.key) ?? 72) + gaps[index])
    return result
  }, [items, gaps, measurement])
  const virtual = enabled && items.length > 16
  const retainedIndex = range.key === undefined ? -1 : items.findIndex(item => item.key === range.key)
  const start = virtual ? Math.min(retainedIndex < 0 ? range.start : retainedIndex, Math.max(0, items.length - 1)) : 0
  const end = virtual ? Math.min(items.length, Math.max(start + 1, start + range.end - range.start)) : items.length

  useLayoutEffect(() => {
    const element = root.current
    const host = element?.closest<HTMLElement>('.execution-drawer-body')
    if (!element || !host || !enabled) return undefined
    // Row measurements change spacer heights on the next React commit.
    if (host.dataset.followingLatest === 'true' && host.dataset.executionDisclosureAnchor !== 'true') {
      host.scrollTop = host.scrollHeight
      host.dataset.executionAdjustedTop = String(host.scrollTop)
    }
    let frame = 0
    const update = () => {
      frame = 0
      const offset = host.getBoundingClientRect().top - element.getBoundingClientRect().top
      const overscan = Math.max(120, Math.min(240, host.clientHeight / 2))
      const lower = offset - overscan, upper = offset + host.clientHeight + overscan
      let first = 0
      while (first < items.length - 1 && positions[first + 1] < lower) first++
      let last = first + 1
      while (last < items.length && positions[last] < upper) last++
      // Keep keyboard focus mounted even when scrolling with the keyboard.
      const focused = element.querySelector<HTMLElement>('[data-execution-virtual-key]:focus-within')?.dataset.executionVirtualKey
      const anchor = host.dataset.executionDisclosureAnchor === 'true'
        ? [...element.querySelectorAll<HTMLElement>(':scope > [data-execution-virtual-key]')]
          .find(row => row.querySelector(`[data-execution-item-key="${CSS.escape(host.dataset.executionAnchorKey ?? '')}"], [data-execution-item-keys~="${CSS.escape(host.dataset.executionAnchorKey ?? '')}"]`))?.dataset.executionVirtualKey
        : undefined
      setRange(previous => previous.start === first && previous.end === last && previous.key === items[first]?.key && previous.focus === focused && previous.anchor === anchor ? previous : { start: first, end: last, key: items[first]?.key, focus: focused, anchor })
      onVisibleRef.current?.(items.slice(first, last))
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
    const resize = new ResizeObserver(entries => {
      let dirty = false, adjustment = 0
      const anchorKey = host.dataset.executionAnchorKey
      const anchorRun = host.dataset.executionAnchorRun
      const anchorRoot = anchorRun ? host.querySelector(`[data-execution-run-id="${CSS.escape(anchorRun)}"]`) : host
      const anchor = anchorKey ? anchorRoot?.querySelector<HTMLElement>(`[data-execution-item-key="${CSS.escape(anchorKey)}"], [data-execution-item-keys~="${CSS.escape(anchorKey)}"]`) : null
      const anchorTop = anchor?.getBoundingClientRect().top ?? host.getBoundingClientRect().top
      for (const entry of entries) {
        const row = entry.target as HTMLElement
        const key = row.dataset.executionVirtualKey
        if (!key) continue
        const height = row.getBoundingClientRect().height - (Number.parseFloat(row.style.paddingBottom) || 0)
        const previous = heights.current.get(key) ?? 72
        if (Math.abs(height - previous) < 0.5) continue
        heights.current.set(key, height); dirty = true
        if (!row.contains(anchor ?? null) && row.getBoundingClientRect().bottom <= anchorTop) adjustment += height - previous
      }
      if (dirty) {
        // Disclosure geometry has one owner, after the new measurements commit.
        if (adjustment && host.dataset.followingLatest !== 'true' && host.dataset.executionDisclosureAnchor !== 'true') {
          host.scrollTop += adjustment
          host.dataset.executionAdjustedTop = String(host.scrollTop)
        }
        measure(value => value + 1)
      }
      schedule()
    })
    resize.observe(host)
    element.querySelectorAll<HTMLElement>(':scope > [data-execution-virtual-key]').forEach(row => resize.observe(row))
    host.addEventListener('scroll', schedule, { passive: true })
    host.addEventListener('execution-disclosure-anchor', update)
    schedule()
    return () => { cancelAnimationFrame(frame); resize.disconnect(); host.removeEventListener('scroll', schedule); host.removeEventListener('execution-disclosure-anchor', update) }
  }, [enabled, items, positions, gap, start, end, range.anchor, range.focus])

  // Retain measurements only for the bounded loaded interval.
  useLayoutEffect(() => {
    const keys = new Set(items.map(item => item.key))
    for (const key of heights.current.keys()) if (!keys.has(key)) heights.current.delete(key)
  }, [items])
  // An empty wrapper would add a grid gap before the initial Run feedback.
  if (items.length === 0) return null
  if (!enabled) return <>{items.map(children)}</>
  const indexes = Array.from({ length: end - start }, (_, offset) => start + offset)
  const focusedIndex = range.focus ? items.findIndex(item => item.key === range.focus) : -1
  if (focusedIndex >= 0 && !indexes.includes(focusedIndex)) indexes.push(focusedIndex)
  const anchorIndex = range.anchor ? items.findIndex(item => item.key === range.anchor) : -1
  if (anchorIndex >= 0 && !indexes.includes(anchorIndex)) indexes.push(anchorIndex)
  indexes.sort((a, b) => a - b)
  let cursor = 0
  const rows = indexes.flatMap(index => {
    const item = items[index]
    const result: ReactNode[] = []
    if (index > cursor) result.push(<div key={`space:${item.key}`} aria-hidden="true" style={{ height: positions[index] - positions[cursor] }} />)
    result.push(<div key={item.key} data-execution-virtual-key={item.key}
      style={{ paddingBottom: gaps[index], display: 'flow-root' }}>{children(item)}</div>)
    cursor = index + 1
    return result
  })
  return <div ref={root} className="execution-virtual-list" style={{ overflowAnchor: 'none' }}>
    {rows}
    {cursor < items.length && <div aria-hidden="true" style={{ height: positions[items.length] - positions[cursor] }} />}
  </div>
}
