import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { uiAttribute } from './interface-language'
import { captureTimelineReadingAnchor, restoreTimelineReadingAnchor, type TimelineReadingAnchor } from './timeline-reading-anchor'
import { USER_ANCHOR_MIN_COUNT, USER_ANCHOR_MIN_WIDTH, USER_ANCHOR_ROW_HEIGHT,
  userAnchorKeyIndex, userAnchorStackHeight, type UserMessageAnchor } from './user-message-anchors'

export function UserMessageAnchors({ anchors, viewportRef, enabled, followingLatest, onNavigate }: {
  anchors: readonly UserMessageAnchor[]
  viewportRef: RefObject<HTMLElement | null>
  enabled: boolean
  followingLatest(): boolean
  onNavigate(messageId: string): void
}): React.JSX.Element | null {
  const navRef = useRef<HTMLElement>(null)
  const railRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const previewId = useId()
  const [room, setRoom] = useState({ show: false, height: 0 })
  const roomRef = useRef(room)
  const measured = useRef(false)
  const measuredWidth = useRef<number | null>(null)
  const pendingReading = useRef<{ anchor: TimelineReadingAnchor; follow: boolean } | null>(null)
  const [visibleIds, setVisibleIds] = useState<ReadonlySet<string>>(new Set())
  const [tabId, setTabId] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ id: string; top: number } | null>(null)
  const previewSource = useRef<'keyboard' | 'pointer' | null>(null)
  const browsing = useRef({ pointer: false, until: 0 })
  const lastRange = useRef('')
  const available = enabled && anchors.length >= USER_ANCHOR_MIN_COUNT

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const stage = viewport?.parentElement
    if (!viewport || !stage) return
    const resize = (): void => {
      const width = stage.clientWidth
      const previousWidth = measuredWidth.current
      measuredWidth.current = width
      const height = userAnchorStackHeight(anchors.length, stage.clientHeight)
      const show = available && width >= USER_ANCHOR_MIN_WIDTH && height >= 30
      const previous = roomRef.current
      if (previous.show === show && previous.height === height) return
      // The workspace already owns reading restoration across width changes.
      if (measured.current && previousWidth === width && previous.show !== show && !viewport.hidden && width) {
        pendingReading.current = { anchor: captureTimelineReadingAnchor(viewport), follow: followingLatest() }
      }
      measured.current = true
      if (!show) {
        if (navRef.current?.contains(document.activeElement)) viewport.focus({ preventScroll: true })
        setPreview(null)
        previewSource.current = null
        browsing.current.pointer = false
      }
      roomRef.current = { show, height }
      setRoom({ show, height })
    }
    const observer = new ResizeObserver(resize)
    observer.observe(stage)
    resize()
    return () => observer.disconnect()
  }, [anchors.length, available, followingLatest, viewportRef])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const pending = pendingReading.current
    pendingReading.current = null
    if (!viewport || !pending || viewport.hidden) return
    if (pending.follow) viewport.scrollTop = viewport.scrollHeight
    else restoreTimelineReadingAnchor(viewport, pending.anchor)
  }, [room.show, viewportRef])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!available || !room.show || !viewport) return
    const ids = new Set(anchors.map(anchor => anchor.id))
    const parts = new Map<Element, string>()
    const intersecting = new Set<Element>()
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRect.height > 0) intersecting.add(entry.target)
        else intersecting.delete(entry.target)
      }
      const next = new Set([...intersecting].map(part => parts.get(part)!).filter(Boolean))
      setVisibleIds(previous => previous.size === next.size && [...next].every(id => previous.has(id))
        ? previous : next)
    }, { root: viewport, rootMargin: '-1px 0px', threshold: 0 })
    for (const message of viewport.querySelectorAll<HTMLElement>('[data-message-id]')) {
      const id = message.dataset.messageId!
      if (!ids.has(id)) continue
      // Observe actual content and identity, excluding the transparent action/receipt row.
      for (const part of message.querySelectorAll<HTMLElement>(
        ':scope > .current-user-profile-trigger, .bubble-meta, .message-surface > :not(.message-action-line)'
      )) {
        parts.set(part, id)
        observer.observe(part)
      }
    }
    return () => observer.disconnect()
  }, [anchors, available, room.show, viewportRef])

  useLayoutEffect(() => {
    if (!room.show) return
    const rail = railRef.current
    const nav = navRef.current
    if (!rail || !nav) return
    const indices = anchors.flatMap((anchor, index) => visibleIds.has(anchor.id) ? [index] : [])
    const signature = indices.map(index => anchors[index].id).join(',')
    if (signature === lastRange.current) return
    lastRange.current = signature
    if (!indices.length || browsing.current.pointer || browsing.current.until > Date.now()
      || nav.contains(document.activeElement)) return
    const first = indices[0] * USER_ANCHOR_ROW_HEIGHT
    const last = (indices.at(-1)! + 1) * USER_ANCHOR_ROW_HEIGHT
    if (first < rail.scrollTop + 20 || last > rail.scrollTop + rail.clientHeight - 20) {
      rail.scrollTop = Math.max(0, (first + last - rail.clientHeight) / 2)
    }
    setTabId(anchors[indices[0]].id)
  }, [anchors, room.show, visibleIds])

  const revealPreview = (id: string, button: HTMLElement): void => {
    const nav = navRef.current
    const rail = railRef.current
    if (!nav || !rail) return
    const bounds = button.getBoundingClientRect()
    const railBounds = rail.getBoundingClientRect()
    if (bounds.bottom <= railBounds.top || bounds.top >= railBounds.bottom) return
    setPreview({ id, top: bounds.top + bounds.height / 2 - nav.getBoundingClientRect().top })
  }

  useLayoutEffect(() => {
    const card = previewRef.current
    const nav = navRef.current
    const stage = viewportRef.current?.parentElement
    if (!preview || !card || !nav || !stage) return
    const half = card.offsetHeight / 2
    const inset = nav.getBoundingClientRect().top - stage.getBoundingClientRect().top
    const top = Math.max(half + 8 - inset, Math.min(stage.clientHeight - half - 8 - inset, preview.top))
    card.style.top = `${top}px`
  }, [preview, anchors, room.height, viewportRef])

  if (!available || !room.show) return null
  const rovingId = anchors.some(anchor => anchor.id === tabId) ? tabId
    : anchors.find(anchor => visibleIds.has(anchor.id))?.id ?? anchors[0].id
  const previewAnchor = preview && anchors.find(anchor => anchor.id === preview.id)
  return (
    <nav className="conversation-anchor-nav" ref={navRef} aria-label={uiAttribute('用户消息锚点')}
      style={{ '--user-anchor-height': `${room.height}px` } as CSSProperties}
      onPointerEnter={() => { browsing.current.pointer = true }}
      onPointerLeave={() => {
        browsing.current.pointer = false
        if (previewSource.current === 'pointer') { previewSource.current = null; setPreview(null) }
      }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); previewSource.current = null; setPreview(null) }
      }}>
      <div className="conversation-anchor-items" ref={railRef}
        onWheel={() => { browsing.current.until = Date.now() + 1500; previewSource.current = null; setPreview(null) }}
        onTouchStart={() => { browsing.current.until = Date.now() + 1500; previewSource.current = null; setPreview(null) }}
        onScroll={() => {
          const focused = document.activeElement as HTMLElement | null
          const id = focused?.dataset.userMessageAnchor
          if (previewSource.current === 'keyboard' && id && focused && railRef.current?.contains(focused)) {
            revealPreview(id, focused)
          } else setPreview(null)
        }}>
        {anchors.map((anchor, index) => (
          <button key={anchor.id} className={`conversation-anchor-item${visibleIds.has(anchor.id) ? ' in-view' : ''}`}
            type="button" data-user-message-anchor={anchor.id} tabIndex={rovingId === anchor.id ? 0 : -1}
            aria-label={uiAttribute('跳转到第{0}/{1}条用户消息：{2}', index + 1, anchors.length, anchor.title)
              + (visibleIds.has(anchor.id) ? `，${uiAttribute('当前可见')}` : '')}
            data-visible={visibleIds.has(anchor.id) || undefined}
            aria-describedby={previewAnchor?.id === anchor.id ? previewId : undefined}
            onPointerEnter={event => { previewSource.current = 'pointer'; revealPreview(anchor.id, event.currentTarget) }}
            onPointerMove={event => {
              if (!preview) { previewSource.current = 'pointer'; revealPreview(anchor.id, event.currentTarget) }
            }}
            onFocus={event => {
              setTabId(anchor.id)
              if (event.currentTarget.matches(':focus-visible')) {
                previewSource.current = 'keyboard'
                revealPreview(anchor.id, event.currentTarget)
              }
            }}
            onBlur={() => setPreview(null)}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) return
              const next = userAnchorKeyIndex(event.key, index, anchors.length, room.height)
              if (next === null) return
              event.preventDefault()
              previewSource.current = 'keyboard'
              const rail = railRef.current!
              const top = next * USER_ANCHOR_ROW_HEIGHT
              rail.scrollTop = Math.max(0, Math.min(rail.scrollTop, top))
              if (top + USER_ANCHOR_ROW_HEIGHT > rail.scrollTop + rail.clientHeight) {
                rail.scrollTop = top + USER_ANCHOR_ROW_HEIGHT - rail.clientHeight
              }
              const button = rail.children[next] as HTMLButtonElement
              button.focus({ preventScroll: true })
              revealPreview(anchors[next].id, button)
            }}
            onClick={() => { previewSource.current = null; setPreview(null); onNavigate(anchor.id) }}>
            <span className="conversation-anchor-mark" aria-hidden="true" />
          </button>
        ))}
      </div>
      {previewAnchor && (
        <div className="conversation-anchor-preview" ref={previewRef} id={previewId} role="tooltip"
          style={{ top: preview.top }}>
          <div className="conversation-anchor-preview-title">{previewAnchor.title}</div>
          {previewAnchor.firstReply && <p className="conversation-anchor-preview-copy">{previewAnchor.firstReply}</p>}
        </div>
      )}
    </nav>
  )
}
