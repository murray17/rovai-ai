import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function NewConversationQuickHelp({
  onOpenChange,
  label = '一键新建说明',
  children
}: {
  onOpenChange?(open: boolean): void
  label?: string
  children?: ReactNode
}): React.JSX.Element {
  const [position, setPosition] = useState<{
    width: number
    left: number
    top: number
  } | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const tooltip = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const id = useId()
  function keepOpen() {
    clearTimeout(timer.current)
  }
  function close() {
    keepOpen()
    setPosition(null)
    onOpenChange?.(false)
  }
  function show() {
    keepOpen()
    if (!trigger.current) return
    onOpenChange?.(true)
    const rect = trigger.current.getBoundingClientRect()
    const width = Math.min(320, window.innerWidth - 32)
    setPosition({
      width,
      left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)),
      top: rect.top - 8
    })
  }
  function leave() {
    keepOpen()
    if (document.activeElement !== trigger.current) timer.current = setTimeout(close, 120)
  }
  useEffect(
    () => () => {
      clearTimeout(timer.current)
      onOpenChange?.(false)
    },
    [onOpenChange]
  )
  useEffect(() => {
    if (!position) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      close()
    }
    const onPointer = (event: PointerEvent) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !tooltip.current?.contains(event.target as Node)
      )
        close()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onPointer, true)
    const onViewportChange = () => {
      if (document.activeElement === trigger.current) show()
      else close()
    }
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [position !== null])
  return (
    <>
      <button
        ref={trigger}
        className="new-camp-quick-help"
        type="button"
        aria-label={label}
        aria-describedby={position ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={leave}
        onFocus={show}
        onBlur={close}
        onClick={show}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="7.3" />
          <path d="M7.9 7.5a2.1 2.1 0 0 1 4.2.1c0 1.5-2.1 1.6-2.1 3.2M10 13.4v.1" />
        </svg>
      </button>
      {position &&
        createPortal(
          <span
            ref={tooltip}
            id={id}
            role="tooltip"
            className="new-camp-quick-tooltip"
            style={position}
            onMouseEnter={keepOpen}
            onMouseLeave={leave}
          >
            {children ?? (
              <>
                保存所选队员和负责人，下次点击「新对话」直接创建。
                <br />
                可在「设置 → 通用」关闭。
              </>
            )}
          </span>,
          document.body
        )}
    </>
  )
}
