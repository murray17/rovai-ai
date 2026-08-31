import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as Dialog from '@radix-ui/react-dialog'
import type { CampSnapshot, MessageDeliveryView } from '@contracts'
import { MemberAvatar } from './MemberAvatar'
import { executionDeliveryRecipientIds, executionRecipientLayout } from './execution-delivery-recipients'

type Member = CampSnapshot['members'][number]

export function AgentRunDeliveryRecipients({
  sourceAgentRunId,
  deliveries,
  memberById
}: {
  sourceAgentRunId: string
  deliveries: MessageDeliveryView[]
  memberById: Map<string, Member>
}): React.JSX.Element | null {
  const recipients = useMemo(() => executionDeliveryRecipientIds(deliveries, sourceAgentRunId).map(agentId => {
    const member = memberById.get(agentId)
    return { agentId, displayName: member?.displayName ?? agentId, avatarRef: member?.avatarRef ?? null }
  }), [deliveries, sourceAgentRunId, memberById])
  const trackRef = useRef<HTMLDivElement>(null)
  const overflowRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const focusedAvatarRef = useRef<HTMLElement | null>(null)
  const skipFocusRestoreRef = useRef(false)
  const [width, setWidth] = useState(0)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 306, transform: 'none' })
  const [tooltip, setTooltip] = useState<{ label: string; left: number; top: number } | null>(null)
  const hasRecipients = recipients.length > 0

  useLayoutEffect(() => {
    const track = trackRef.current
    if (!track) return undefined
    const measure = (): void => setWidth(track.getBoundingClientRect().width)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(track)
    return () => observer.disconnect()
  }, [hasRecipients])

  const layout = executionRecipientLayout(recipients.length, width)
  const visible = recipients.slice(0, layout.visibleCount)
  const hidden = recipients.slice(layout.visibleCount)

  useLayoutEffect(() => {
    if (layout.hiddenCount === 0) setOpen(false)
    if (focusedAvatarRef.current && !focusedAvatarRef.current.isConnected) {
      focusedAvatarRef.current = null
      setTooltip(null)
      overflowRef.current?.focus({ preventScroll: true })
    }
  }, [layout.hiddenCount, layout.visibleCount])

  useEffect(() => {
    if (!open && !tooltip) return undefined
    const dismiss = (event: Event): void => {
      if (event.target instanceof Node && popupRef.current?.contains(event.target)) return
      // Scrolling/resizing a reading surface must not pull it back to the trigger.
      skipFocusRestoreRef.current = true
      setOpen(false)
      setTooltip(null)
    }
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [open, tooltip])

  const showName = (target: HTMLElement, label: string): void => {
    const rect = target.getBoundingClientRect()
    setTooltip({ label, left: Math.min(window.innerWidth - 132, Math.max(132, rect.left + rect.width / 2)), top: rect.top - 8 })
  }
  const setExpanded = (next: boolean): void => {
    if (next && overflowRef.current) {
      skipFocusRestoreRef.current = false
      const rect = overflowRef.current.getBoundingClientRect()
      const below = window.innerHeight - rect.bottom - 18
      const above = rect.top - 18
      const height = Math.min(306, hidden.length * 36 + 48)
      const placeBelow = below >= height || below >= above
      const maxHeight = Math.min(306, Math.max(0, placeBelow ? below : above))
      setPosition({
        left: Math.max(12, Math.min(rect.right - 244, window.innerWidth - 256)),
        top: placeBelow ? rect.bottom + 6 : rect.top - 6,
        maxHeight,
        transform: placeBelow ? 'none' : 'translateY(-100%)'
      })
    }
    setTooltip(null)
    setOpen(next)
  }

  if (!hasRecipients) return null
  return <div className="execution-run-recipients" aria-label="本次执行的协作投递对象">
    <small>协作投递</small>
    <div className="execution-recipient-track" ref={trackRef}>
      {visible.map(recipient => <span
        key={recipient.agentId}
        className="execution-recipient-avatar"
        data-recipient-id={recipient.agentId}
        role="img"
        aria-label={recipient.displayName}
        tabIndex={0}
        onPointerEnter={event => showName(event.currentTarget, recipient.displayName)}
        onPointerLeave={event => { if (document.activeElement !== event.currentTarget) setTooltip(null) }}
        onFocus={event => {
          focusedAvatarRef.current = event.currentTarget
          showName(event.currentTarget, recipient.displayName)
        }}
        onBlur={() => { focusedAvatarRef.current = null; setTooltip(null) }}
        onKeyDownCapture={event => {
          if (event.key === 'Escape' && tooltip) {
            event.preventDefault()
            event.stopPropagation()
            setTooltip(null)
          }
        }}
      >
        <MemberAvatar {...recipient} size="mention" decorative />
      </span>)}
      {hidden.length > 0 && <Dialog.Root open={open} onOpenChange={setExpanded} modal={false}>
        <Dialog.Trigger asChild>
          <button
            ref={overflowRef}
            type="button"
            className="execution-recipient-overflow"
            style={{ width: layout.overflowWidth }}
            aria-label={`还有 ${hidden.length} 位协作投递对象，查看其余队员`}
          >+{hidden.length}</button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Content
            ref={popupRef}
            className="app-dialog execution-recipient-popover"
            style={position}
            aria-describedby={undefined}
            onEscapeKeyDown={event => {
              event.preventDefault()
              event.stopPropagation()
              setExpanded(false)
            }}
            onCloseAutoFocus={event => {
              if (skipFocusRestoreRef.current) event.preventDefault()
            }}
          >
            <header>
              <Dialog.Title>其他 {hidden.length} 位投递对象</Dialog.Title>
              <Dialog.Close aria-label="关闭其余投递对象" className="execution-recipient-close">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
              </Dialog.Close>
            </header>
            <ul className="execution-recipient-list" tabIndex={0} aria-label="其余协作投递对象">
              {hidden.map(recipient => <li key={recipient.agentId}>
                <MemberAvatar {...recipient} size="mention" decorative />
                <span>{recipient.displayName}</span>
              </li>)}
            </ul>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>}
    </div>
    {tooltip && createPortal(<div role="tooltip" className="execution-recipient-tooltip" style={{ left: tooltip.left, top: tooltip.top }}>{tooltip.label}</div>, document.body)}
  </div>
}
