import React, { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useOptionalFilePreview } from './FilePreviewContext'
import { useOptionalFilePreviewLayout } from './FilePreviewLayout'
import { filePreviewSplitMinWidth } from './file-preview-layout'
import { UiText, uiAttribute } from './interface-language'

const WIDTH_KEY = 'rovai.mission-drawer-width'
const minimum = 640
const clamp = (width: number, maximum: number) => Math.max(Math.min(minimum, maximum), Math.min(width, maximum))

export function MissionSurface({ enabled = true, full, onExpand, onClose, children }: {
  enabled?: boolean; full: boolean; onExpand(): void; onClose(): void; children: ReactNode
}) {
  const root = useRef<HTMLElement>(null), handle = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1040), [available, setAvailable] = useState(1170), [dragging, setDragging] = useState(false)
  const preferred = useRef<number | null>(null)
  const latestExpand = useRef(onExpand); latestExpand.current = onExpand
  const preview = useOptionalFilePreview()
  const previewLayout = useOptionalFilePreviewLayout()
  const gesture = useRef<{
    id: number; before: number; x: number; right: number; scale: number
    snapX: number; maximum: number; width: number; moved: boolean
  } | null>(null)

  function release() {
    const value = gesture.current
    gesture.current = null
    setDragging(false)
    document.documentElement.classList.remove('mission-drawer-resizing')
    if (value && handle.current?.hasPointerCapture(value.id)) handle.current.releasePointerCapture(value.id)
    return value
  }

  function save(next: number) {
    preferred.current = next
    try { localStorage.setItem(WIDTH_KEY, String(next)) } catch {}
  }

  function finish(cancel = false) {
    const value = release()
    if (!value) return
    setWidth(cancel ? value.before : value.width)
    if (!cancel && value.moved) save(value.width)
  }

  function expandDuringMove() {
    const value = release()
    if (value) setWidth(value.before)
    latestExpand.current()
    requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>('button[aria-label="折叠为使命抽屉"]')?.focus({ preventScroll: true }))
  }

  function hidePreviewBeforeConversationCompacts(previous: number, next: number) {
    if (!preview?.paneVisible || !previewLayout || previewLayout.availableWidth <= 0) return
    const drawerChrome = Math.max(0, previous - previewLayout.availableWidth)
    const splitMinimum = filePreviewSplitMinWidth(previewLayout.activityMode) + drawerChrome
    if (previous >= splitMinimum && next < splitMinimum) preview.hidePane()
  }

  useLayoutEffect(() => {
    if (!enabled) return
    const shell = root.current?.closest<HTMLElement>('.navigation-shell')
    if (!shell) return
    try {
      const stored = Number(localStorage.getItem(WIDTH_KEY))
      if (stored >= minimum) preferred.current = stored
    } catch {}
    const measure = () => {
      if (gesture.current) finish(true)
      const rail = parseFloat(getComputedStyle(shell).getPropertyValue('--rail-width')) || 0
      const next = Math.max(1, shell.clientWidth - rail - 24)
      setAvailable(next)
      setWidth(clamp(preferred.current ?? 1040, next))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(shell)
    const nav = document.getElementById('global-navigation')
    if (nav) observer.observe(nav)
    measure()
    return () => {
      observer.disconnect()
      document.documentElement.classList.remove('mission-drawer-resizing')
    }
  }, [enabled])

  useEffect(() => {
    const cancel = () => finish(true)
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) {
        event.preventDefault()
        event.stopImmediatePropagation()
        finish(true)
      }
    }
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', escape, true)
    return () => {
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', escape, true)
    }
  }, [])

  function move(clientX: number) {
    const value = gesture.current
    if (!value || (!value.moved && Math.abs(clientX - value.x) < 3)) return
    value.moved = true
    // Crossing the left threshold ends this drag immediately; pointerup is no
    // longer required and cannot oscillate the presentation back to a drawer.
    if (clientX <= value.snapX && clientX < value.x - 3) {
      expandDuringMove()
      return
    }
    const next = clamp((value.right - clientX) / value.scale, value.maximum)
    hidePreviewBeforeConversationCompacts(value.width, next)
    value.width = next
    setWidth(next)
  }

  function chooseWidth(next: number) {
    next = clamp(next, available)
    hidePreviewBeforeConversationCompacts(width, next)
    save(next)
    setWidth(next)
  }

  if (!enabled) return <div className="ordinary-workspace-host">{children}</div>
  return <section ref={root} className={`${full ? 'mission-full' : 'mission-drawer'} mission-workspace-host${dragging ? ' is-resizing' : ''}`}
    style={{ '--mission-drawer-width': `${width}px` } as React.CSSProperties}
    role={full ? undefined : 'dialog'} aria-modal={full ? undefined : false} aria-label={full ? undefined : uiAttribute("使命会话")}
    onKeyDown={event => {
      if (full || event.key !== 'Escape' || event.defaultPrevented) return
      // Let the focused conversation tool consume Escape before closing its owner.
      if (root.current?.querySelector('.thread-detail-entry[aria-expanded="true"]')) return
      event.preventDefault()
      onClose()
    }}>
    {!full && <>
      <div ref={handle} className="mission-drawer-resize-handle" role="separator" tabIndex={0}
        aria-label={uiAttribute("调整使命抽屉宽度")} aria-orientation="vertical"
        aria-valuemin={Math.min(minimum, available)} aria-valuemax={available} aria-valuenow={Math.round(width)}
        aria-valuetext={uiAttribute("{0} 像素，向左拖到边缘立即展开", String(Math.round(width)))}
        aria-describedby="mission-drawer-resize-help" title={uiAttribute("向左拖动，到边缘立即展开；双击或 Enter 展开")}
        onPointerDown={event => {
          if (event.button !== 0 || !event.isPrimary || gesture.current) return
          event.preventDefault()
          event.currentTarget.focus({ preventScroll: true })
          event.currentTarget.setPointerCapture(event.pointerId)
          const shell = root.current!.closest<HTMLElement>('.navigation-shell')!
          const bounds = shell.getBoundingClientRect()
          const rail = parseFloat(getComputedStyle(shell).getPropertyValue('--rail-width')) || 0
          const scale = bounds.width / shell.clientWidth
          gesture.current = {
            id: event.pointerId,
            before: width,
            width,
            moved: false,
            x: event.clientX,
            right: root.current!.getBoundingClientRect().right,
            scale,
            snapX: bounds.left + (rail + 48) * scale,
            maximum: available
          }
          setDragging(true)
          document.documentElement.classList.add('mission-drawer-resizing')
        }}
        onPointerMove={event => { if (gesture.current?.id === event.pointerId) move(event.clientX) }}
        onPointerUp={event => {
          if (gesture.current?.id !== event.pointerId) return
          move(event.clientX)
          finish()
        }}
        onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish(true)} onDoubleClick={onExpand}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === 'End') {
            event.preventDefault()
            onExpand()
            return
          }
          if (event.key === 'Home') {
            event.preventDefault()
            chooseWidth(minimum)
            return
          }
          if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
          event.preventDefault()
          const next = width + (event.key === 'ArrowLeft' ? 1 : -1) * (event.shiftKey ? 80 : 32)
          if (next >= available - 24) onExpand()
          else chooseWidth(next)
        }} />
      <span className="sr-only" id="mission-drawer-resize-help"><UiText zh={"左右方向键调整宽度，Shift 加速；Enter 或 End 展开；Home 使用最小宽度；拖动时 Escape 取消。"} /></span>
    </>}
    {children}
  </section>
}
