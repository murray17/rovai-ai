import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { PUBLIC_MESSAGE_GROUP_HEIGHT } from './public-message-grouping'
import { captureTimelineReadingAnchor, restoreTimelineReadingAnchor, type TimelineReadingAnchor } from './timeline-reading-anchor'

/**
 * Measure only public content, excluding identity and actions: changing a group must
 * not change its own height predicate. Lightboxes live outside this surface.
 */
export function usePublicMessageLayout(
  timelineRef: RefObject<HTMLElement | null>,
  revision: unknown,
  threadId: string,
  visible: boolean,
  followingLatest: () => boolean
): ReadonlySet<string> {
  const [layout, setLayout] = useState<{ threadId: string; short: Set<string> }>({
    threadId, short: new Set()
  })
  const currentLayout = useRef(layout)
  currentLayout.current = layout
  const pendingAnchor = useRef<{ threadId: string; anchor: TimelineReadingAnchor; follow: boolean } | null>(null)

  useLayoutEffect(() => {
    const scroll = timelineRef.current
    const pending = pendingAnchor.current
    pendingAnchor.current = null
    if (!scroll || !pending || pending.threadId !== threadId) return
    if (pending.follow) scroll.scrollTop = scroll.scrollHeight
    else restoreTimelineReadingAnchor(scroll, pending.anchor)
  }, [layout, threadId, timelineRef])

  useLayoutEffect(() => {
    const scroll = timelineRef.current
    if (!visible || !scroll) return
    const surfaces = [...scroll.querySelectorAll<HTMLElement>('.public-agent-message .message-surface')]
    let frame: number | null = null
    const measure = (): void => {
      frame = null
      if (!scroll.clientWidth || !scroll.clientHeight) return
      const short = new Set<string>()
      for (const surface of surfaces) {
        const messageId = surface.closest<HTMLElement>('[data-message-id]')?.dataset.messageId
        if (!messageId || !surface.isConnected) continue
        // Keep identity visible until lazy images have settled; placeholders already reserve space.
        if (surface.querySelector('[aria-busy="true"]')
          || [...surface.querySelectorAll('img')].some(image => !image.complete)) continue
        const bounds = surface.getBoundingClientRect()
        const footer = surface.nextElementSibling
        const bottom = footer?.classList.contains('message-delivery-footer')
          ? footer.getBoundingClientRect().bottom : bounds.bottom
        if (bottom - bounds.top < PUBLIC_MESSAGE_GROUP_HEIGHT) short.add(messageId)
      }
      const previous = currentLayout.current
      if (previous.threadId === threadId && previous.short.size === short.size
        && [...short].every(id => previous.short.has(id))) return
      const viewport = scroll.getBoundingClientRect()
      const source = surfaces.find(surface => {
        const bounds = surface.getBoundingClientRect()
        return bounds.bottom > viewport.top && bounds.top < viewport.bottom
      })
      pendingAnchor.current = {
        threadId, anchor: captureTimelineReadingAnchor(scroll, source), follow: followingLatest()
      }
      const next = { threadId, short }
      currentLayout.current = next
      setLayout(next)
    }
    const schedule = (): void => {
      if (frame === null) frame = window.requestAnimationFrame(measure)
    }
    const resize = new ResizeObserver(schedule)
    const mutation = new MutationObserver(schedule)
    for (const surface of surfaces) {
      resize.observe(surface)
      mutation.observe(surface, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-busy'] })
      const footer = surface.nextElementSibling
      if (footer?.classList.contains('message-delivery-footer')) resize.observe(footer)
    }
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
  }, [threadId, revision, visible, followingLatest, timelineRef])

  return layout.threadId === threadId ? layout.short : new Set()
}
