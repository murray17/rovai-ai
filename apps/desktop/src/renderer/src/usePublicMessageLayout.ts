import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { PUBLIC_MESSAGE_GROUP_HEIGHT } from './public-message-grouping'
import { captureTimelineReadingAnchor, restoreTimelineReadingAnchor, type TimelineReadingAnchor } from './timeline-reading-anchor'
import type { ThreadConversationTimelineItem } from './ThreadWorkspace'

/**
 * Measure only public content, excluding identity and actions: changing a group must
 * not change its own height predicate. Lightboxes live outside this surface.
 */
export function usePublicMessageLayout(
  timelineRef: RefObject<HTMLElement | null>,
  revision: readonly ThreadConversationTimelineItem[],
  threadId: string,
  visible: boolean,
  followingLatest: () => boolean,
  preserveReadingPosition: () => boolean,
  virtualGeometry = false
): ReadonlySet<string> {
  const [layout, setLayout] = useState<{ threadId: string; short: Set<string> }>({
    threadId, short: new Set()
  })
  const currentLayout = useRef(layout)
  currentLayout.current = layout
  const pendingAnchor = useRef<{ threadId: string; anchor: TimelineReadingAnchor; follow: boolean } | null>(null)
  const measurements = useRef({ threadId, width: 0, short: new Map<string, boolean>() })

  useLayoutEffect(() => {
    const scroll = timelineRef.current
    const pending = pendingAnchor.current
    pendingAnchor.current = null
    if (!scroll || !pending || pending.threadId !== threadId || !preserveReadingPosition()) return
    if (pending.follow) scroll.scrollTop = scroll.scrollHeight
    else restoreTimelineReadingAnchor(scroll, pending.anchor)
  }, [layout, threadId, timelineRef, preserveReadingPosition])

  useLayoutEffect(() => {
    const scroll = timelineRef.current
    if (!visible || !scroll) return
    let surfaces: HTMLElement[] = []
    const observed = new Set<HTMLElement>()
    const messageIds = new Set(revision.flatMap(item => item.kind === 'camp_message' ? [item.message.id] : []))
    let frame: number | null = null
    const measure = (): void => {
      frame = null
      if (!scroll.clientWidth || !scroll.clientHeight) return
      if (measurements.current.threadId !== threadId || measurements.current.width !== scroll.clientWidth) {
        measurements.current = { threadId, width: scroll.clientWidth, short: new Map() }
      }
      const cache = measurements.current.short
      for (const id of cache.keys()) if (!messageIds.has(id)) cache.delete(id)
      surfaces = [...scroll.querySelectorAll<HTMLElement>('.public-agent-message .message-surface')]
      for (const element of observed) if (!scroll.contains(element)) { resize.unobserve(element); observed.delete(element) }
      for (const surface of surfaces) {
        const messageId = surface.closest<HTMLElement>('[data-message-id]')?.dataset.messageId
        if (!messageId || !surface.isConnected) continue
        if (!observed.has(surface)) { resize.observe(surface); observed.add(surface) }
        // Keep identity visible until lazy images have settled; placeholders already reserve space.
        if (surface.querySelector('[aria-busy="true"]')
          || [...surface.querySelectorAll('img')].some(image => !image.complete)) { cache.set(messageId, false); continue }
        const bounds = surface.getBoundingClientRect()
        const footer = surface.nextElementSibling
        const bottom = footer?.classList.contains('message-delivery-footer')
          ? footer.getBoundingClientRect().bottom : bounds.bottom
        if (footer instanceof HTMLElement && footer.classList.contains('message-delivery-footer') && !observed.has(footer)) {
          resize.observe(footer); observed.add(footer)
        }
        cache.set(messageId, bottom - bounds.top < PUBLIC_MESSAGE_GROUP_HEIGHT)
      }
      const short = new Set([...cache].flatMap(([id, isShort]) => isShort ? [id] : []))
      const previous = currentLayout.current
      if (previous.threadId === threadId && previous.short.size === short.size
        && [...short].every(id => previous.short.has(id))) return
      const viewport = scroll.getBoundingClientRect()
      const source = surfaces.find(surface => {
        const bounds = surface.getBoundingClientRect()
        return bounds.bottom > viewport.top && bounds.top < viewport.bottom
      })
      // Explicit navigation owns the destination through asynchronous regrouping.
      // Do not save an old reading anchor to restore after that navigation finishes.
      pendingAnchor.current = !virtualGeometry && preserveReadingPosition() ? {
        threadId, anchor: captureTimelineReadingAnchor(scroll, source), follow: followingLatest()
      } : null
      const next = { threadId, short }
      currentLayout.current = next
      setLayout(next)
    }
    const schedule = (): void => {
      if (frame === null) frame = window.requestAnimationFrame(measure)
    }
    const resize = new ResizeObserver(schedule)
    const mutation = new MutationObserver(schedule)
    resize.observe(scroll)
    mutation.observe(scroll, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-busy'] })
    scroll.addEventListener('load', schedule, true)
    scroll.addEventListener('error', schedule, true)
    measure()
    return () => {
      resize.disconnect()
      mutation.disconnect()
      scroll.removeEventListener('load', schedule, true)
      scroll.removeEventListener('error', schedule, true)
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [threadId, revision, visible, followingLatest, timelineRef, preserveReadingPosition, virtualGeometry])

  return layout.threadId === threadId ? layout.short : new Set()
}
