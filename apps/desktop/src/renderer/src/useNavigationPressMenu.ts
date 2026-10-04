import { uiAttribute } from './interface-language'
import { useEffect, useMemo, useRef, useState, type HTMLAttributes } from 'react'

type Pointer = { pointerId: number; pointerType: string; isPrimary: boolean; button: number; clientX: number; clientY: number }

// The same gesture governs project and conversation rows. It never activates a row.
export function createNavigationPressGesture(onOpen: () => void) {
  let pointer: Pointer | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let suppressClick = false
  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    pointer = null
  }
  return {
    cancel,
    start(event: Pointer): boolean {
      cancel()
      suppressClick = false
      if (!event.isPrimary || event.button !== 0 || !['touch', 'pen'].includes(event.pointerType)) return false
      pointer = event
      timer = setTimeout(() => {
        timer = null
        suppressClick = true
        onOpen()
      }, 480)
      return true
    },
    move(event: Pick<Pointer, 'pointerId' | 'clientX' | 'clientY'>): void {
      if (!pointer || event.pointerId !== pointer.pointerId) return
      if (Math.hypot(event.clientX - pointer.clientX, event.clientY - pointer.clientY) > 10) {
        suppressClick = true
        cancel()
      }
    },
    openContext(suppressReleaseClick = true): void {
      cancel()
      suppressClick = suppressReleaseClick
      onOpen()
    },
    consumeClick(): boolean {
      const suppressed = suppressClick
      suppressClick = false
      return suppressed
    }
  }
}

export function useNavigationPressMenu(enabled: boolean) {
  const [open, updateOpen] = useState(false)
  const [contextPoint, setContextPoint] = useState<{ x: number; y: number } | null>(null)
  const setOpen = (next: boolean): void => {
    if (!next) setContextPoint(null)
    updateOpen(next)
  }
  const ignoreMenuRelease = useRef(false)
  const lastPointerType = useRef('mouse')
  const rowFocusTarget = useRef<HTMLElement | null>(null)
  const rememberRow = (row: HTMLElement): void => {
    rowFocusTarget.current = row.matches('button') ? row : row.querySelector('button')
  }
  const gesture = useMemo(() => createNavigationPressGesture(() => {
    ignoreMenuRelease.current = true
    updateOpen(true)
  }), [])
  const stopWatching = useRef(() => {})
  const cancel = (): void => { gesture.cancel(); stopWatching.current() }

  useEffect(() => {
    if (!enabled) setOpen(false)
    return () => { gesture.cancel(); stopWatching.current() }
  }, [enabled, gesture])

  const rowProps: HTMLAttributes<HTMLElement> = enabled ? {
    'aria-haspopup': 'menu',
    'aria-description': uiAttribute('右键、长按或按 Shift+F10 显示操作'),
    onPointerDown: event => {
      lastPointerType.current = event.pointerType
      rememberRow(event.currentTarget)
      cancel()
      if (!gesture.start(event)) return
      const otherPointer = (next: PointerEvent): void => { if (!next.isPrimary) cancel() }
      document.addEventListener('scroll', cancel, true)
      document.addEventListener('visibilitychange', cancel)
      document.addEventListener('pointerdown', otherPointer, true)
      window.addEventListener('blur', cancel)
      stopWatching.current = () => {
        document.removeEventListener('scroll', cancel, true)
        document.removeEventListener('visibilitychange', cancel)
        document.removeEventListener('pointerdown', otherPointer, true)
        window.removeEventListener('blur', cancel)
      }
    },
    onPointerMove: event => gesture.move(event),
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onClickCapture: event => {
      if (gesture.consumeClick()) { event.preventDefault(); event.stopPropagation() }
    },
    onContextMenu: event => {
      rememberRow(event.currentTarget)
      event.preventDefault()
      cancel()
      setContextPoint({ x: event.clientX, y: event.clientY })
      gesture.openContext(['touch', 'pen'].includes((event.nativeEvent as PointerEvent).pointerType || lastPointerType.current))
    },
    onKeyDown: event => {
      gesture.consumeClick()
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        rememberRow(event.currentTarget)
        event.preventDefault()
        cancel()
        setContextPoint(null)
        setOpen(true)
      }
    }
  } : {}
  const menuProps: HTMLAttributes<HTMLDivElement> = {
    onPointerDownCapture: () => { ignoreMenuRelease.current = false; cancel() },
    onPointerUpCapture: event => {
      // Releasing the original long press must not select the item under the finger.
      if (ignoreMenuRelease.current) { event.preventDefault(); event.stopPropagation() }
      ignoreMenuRelease.current = false
      cancel()
    }
  }
  useEffect(() => {
    if (!open) return undefined
    const close = (): void => { setContextPoint(null); updateOpen(false) }
    document.addEventListener('scroll', close, true)
    document.addEventListener('visibilitychange', close)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('scroll', close, true)
      document.removeEventListener('visibilitychange', close)
      window.removeEventListener('blur', close)
    }
  }, [open])
  return { open, setOpen, contextPoint, rowProps, menuProps, restoreRowFocus: () => rowFocusTarget.current?.focus({ preventScroll: true }) }
}
