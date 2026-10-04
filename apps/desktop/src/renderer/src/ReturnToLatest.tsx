import { uiAttribute } from './interface-language'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

/** One local overlay per reading viewport. Its state never rerenders the transcript. */
export function ReturnToLatest({
  viewportRef, ownerKey, contentRevision, scope, enabled = true, hasNewer = false, onLatest
}: {
  viewportRef: RefObject<HTMLElement | null>
  ownerKey: string
  contentRevision: unknown
  scope: 'camp' | 'execution' | 'single'
  enabled?: boolean
  hasNewer?: boolean
  onLatest(): void
}): React.JSX.Element | null {
  const [away, setAway] = useState(false)
  const [visibleViewport, setVisibleViewport] = useState(false)
  const [hasNewContent, setHasNewContent] = useState(false)
  const awayRef = useRef(false)
  const previous = useRef({ ownerKey, contentRevision })
  const measureRef = useRef<(() => void) | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const setButtonRef = useCallback((button: HTMLButtonElement | null): void => {
    const viewport = viewportRef.current
    if (!button && buttonRef.current === document.activeElement
      && viewport?.isConnected && viewport.clientHeight > 0) {
      viewport.setAttribute('tabindex', '-1')
      viewport.focus({ preventScroll: true })
    }
    buttonRef.current = button
  }, [viewportRef])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!enabled || !viewport) return
    let frame: number | null = null
    const measure = (): void => {
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        const visible = viewport.clientHeight > 0 && viewport.clientWidth > 0
        const gap = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop
        const next = visible && gap > (awayRef.current ? 24 : 96)
        awayRef.current = next
        setAway(next)
        setVisibleViewport(visible)
        if (!next && !hasNewer) setHasNewContent(false)
      })
    }
    measureRef.current = measure
    viewport.addEventListener('scroll', measure, { passive: true })
    // Only observe the two boxes; no subtree traversal or mutation observer.
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild)
    measure()
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      observer.disconnect()
      viewport.removeEventListener('scroll', measure)
      measureRef.current = null
    }
  }, [enabled, ownerKey, viewportRef, hasNewer])

  useEffect(() => {
    if (previous.current.ownerKey !== ownerKey) {
      awayRef.current = false
      setAway(false)
      setHasNewContent(false)
    } else if (previous.current.contentRevision !== contentRevision && (awayRef.current || hasNewer)) {
      setHasNewContent(true)
    }
    previous.current = { ownerKey, contentRevision }
    measureRef.current?.()
  }, [ownerKey, contentRevision, hasNewer])

  if (!enabled || !visibleViewport || (!away && !hasNewer)) return null
  const label = hasNewContent
    ? scope === 'execution' ? uiAttribute('有新输出，回到最新') : uiAttribute('有新回复，回到最新')
    : uiAttribute('回到最新')
  return (
    <div className="return-to-latest-layer">
      <button
        ref={setButtonRef}
        type="button"
        className="return-to-latest"
        data-return-scope={scope}
        aria-label={label}
        title={label}
        onPointerDown={(event) => {
          event.stopPropagation()
          if (event.button === 0) event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerUp={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          const viewport = viewportRef.current
          if (!viewport) return
          onLatest()
          viewport.scrollTop = viewport.scrollHeight
          awayRef.current = false
          setAway(false)
          setHasNewContent(false)
          if (document.activeElement === event.currentTarget) {
            viewport.setAttribute('tabindex', '-1')
            viewport.focus({ preventScroll: true })
          }
        }}
      >
        <span className="return-to-latest-face" aria-hidden="true">
          <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 3.5v12m-5-5 5 5 5-5" />
          </svg>
          {hasNewContent && <span className="return-to-latest-dot" />}
        </span>
      </button>
    </div>
  )
}
