import { useEffect, useRef, useState } from 'react'

export const DEFAULT_CAPABILITY_WIDTH = 320
export function defaultCapabilityWidth(viewport: number): number {
  return viewport >= 2300 ? 400 : viewport >= 1600 ? 360 : DEFAULT_CAPABILITY_WIDTH
}
export function capabilityListWidth(preferred: number, available: number): number {
  return Math.round(
    Math.max(
      240,
      Math.min(
        Number.isFinite(preferred) ? preferred : DEFAULT_CAPABILITY_WIDTH,
        560,
        Math.max(240, available - 391)
      )
    )
  )
}

export function useCapabilitySplitter(storageKey: string, controls: string, enabled = true) {
  const root = useRef<HTMLDivElement>(null)
  const divider = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    pointerId: number
    startX: number
    width: number
  } | null>(null)
  const preferred = useRef<number | null>(null)
  const available = useRef(0)
  const currentWidth = useRef(DEFAULT_CAPABILITY_WIDTH)
  const [compact, setCompact] = useState(false)
  const setWidth = (value: number, save: boolean): void => {
    const width = capabilityListWidth(value, available.current)
    currentWidth.current = width
    root.current?.style.setProperty('--capability-list-width', `${width}px`)
    divider.current?.setAttribute('aria-valuenow', String(width))
    divider.current?.setAttribute(
      'aria-valuemax',
      String(Math.max(240, Math.min(560, Math.floor(available.current - 391))))
    )
    divider.current?.setAttribute('aria-valuetext', `列表宽度 ${width} 像素`)
    if (save) {
      preferred.current = width
      try {
        window.localStorage.setItem(storageKey, String(width))
      } catch {
        /* Keep the in-window preference usable. */
      }
    }
  }
  useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(storageKey))
      if (stored >= 240 && stored <= 560) preferred.current = stored
    } catch {
      /* Local layout is available without storage. */
    }
    const measure = (): void => {
      available.current = root.current?.getBoundingClientRect().width ?? 0
      setCompact(available.current < 620)
      setWidth(preferred.current ?? defaultCapabilityWidth(window.innerWidth), false)
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (root.current) observer.observe(root.current)
    return () => observer.disconnect()
  }, [storageKey, enabled])
  const finish = (cancel = false): void => {
    const active = drag.current
    if (!active) return
    drag.current = null
    root.current?.removeAttribute('data-resizing')
    setWidth(cancel ? active.width : currentWidth.current, true)
    if (divider.current?.hasPointerCapture(active.pointerId))
      divider.current.releasePointerCapture(active.pointerId)
  }
  useEffect(() => {
    const onBlur = (): void => finish()
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [])
  const separator = (
    <div className="capability-divider-rail">
      <div
        ref={divider}
        className="capability-divider"
        role="separator"
        tabIndex={0}
        aria-label="调整列表宽度"
        aria-orientation="vertical"
        aria-valuemin={240}
        aria-valuemax={560}
        aria-valuenow={DEFAULT_CAPABILITY_WIDTH}
        aria-controls={controls}
        title="拖动调整宽度，双击复位；方向键也可调整"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          event.currentTarget.focus()
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            width: currentWidth.current
          }
          root.current?.setAttribute('data-resizing', 'true')
        }}
        onPointerMove={(event) => {
          if (drag.current?.pointerId === event.pointerId)
            setWidth(drag.current.width + event.clientX - drag.current.startX, false)
        }}
        onPointerUp={() => finish()}
        onPointerCancel={() => finish(true)}
        onLostPointerCapture={() => finish()}
        onDoubleClick={() => {
          preferred.current = null
          try {
            window.localStorage.removeItem(storageKey)
          } catch {}
          setWidth(defaultCapabilityWidth(window.innerWidth), false)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            finish(true)
            return
          }
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)) return
          event.preventDefault()
          if (event.key === 'Enter') {
            preferred.current = null
            try {
              window.localStorage.removeItem(storageKey)
            } catch {
              /* In-window reset remains available. */
            }
            setWidth(defaultCapabilityWidth(window.innerWidth), false)
            return
          }
          setWidth(
            event.key === 'Home'
              ? 240
              : event.key === 'End'
                ? 560
                : currentWidth.current +
                  (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 24 : 8),
            true
          )
        }}
      />
    </div>
  )
  return { root, compact, separator }
}
