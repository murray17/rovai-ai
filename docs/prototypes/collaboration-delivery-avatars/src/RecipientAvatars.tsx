import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as Dialog from '@radix-ui/react-dialog'
import { MemberAvatar } from '../../../../apps/desktop/src/renderer/src/MemberAvatar'
import type { CampSnapshot, MessageDeliveryView } from '@contracts'

type Member = CampSnapshot['members'][number]
type PrototypeDelivery = MessageDeliveryView & { prototypeSourceRunId?: string }

// Preview-only source attribution. The production projection is not changed.
export function prototypeDeliveriesForRun(deliveries: PrototypeDelivery[], run: { id: string }): PrototypeDelivery[] {
  return deliveries.filter(delivery => delivery.prototypeSourceRunId === run.id)
}

export function RecipientAvatars({ deliveries, memberById }: {
  deliveries: MessageDeliveryView[]
  memberById: Map<string, Member>
}): React.JSX.Element | null {
  const recipients = useMemo(() => {
    const unique = new Map<string, { agentId: string; displayName: string; avatarRef: string | null }>()
    for (const delivery of deliveries) {
      if (delivery.deliveryKind !== 'public_a2a' || unique.has(delivery.recipientAgentId)) continue
      const member = memberById.get(delivery.recipientAgentId)
      unique.set(delivery.recipientAgentId, {
        agentId: delivery.recipientAgentId,
        displayName: member?.displayName ?? delivery.recipientAgentId,
        avatarRef: member?.avatarRef ?? null
      })
    }
    return [...unique.values()]
  }, [deliveries, memberById])
  const trackRef = useRef<HTMLDivElement>(null)
  const overflowRef = useRef<HTMLButtonElement>(null)
  const [trackWidth, setTrackWidth] = useState(0)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const [tooltip, setTooltip] = useState<{ label: string; left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const track = trackRef.current
    if (!track) return undefined
    const measure = (): void => setTrackWidth(track.getBoundingClientRect().width)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(track)
    return () => observer.disconnect()
  }, [recipients.length > 0])

  const cell = 28
  const gap = 4
  const capacity = Math.max(0, Math.floor((trackWidth + gap) / (cell + gap)))
  const visibleCount = recipients.length <= capacity ? recipients.length : Math.max(0, capacity - 1)
  const visible = recipients.slice(0, visibleCount)
  const hidden = recipients.slice(visibleCount)

  const showName = (target: HTMLElement, label: string): void => {
    const rect = target.getBoundingClientRect()
    setTooltip({ label, left: Math.min(window.innerWidth - 132, Math.max(132, rect.left + rect.width / 2)), top: rect.top - 8 })
  }
  const setExpanded = (next: boolean): void => {
    if (next && overflowRef.current) {
      const rect = overflowRef.current.getBoundingClientRect()
      const availableBelow = window.innerHeight - rect.bottom - 16
      const height = Math.min(306, hidden.length * 36 + 48)
      setPosition({
        left: Math.max(12, Math.min(rect.right - 244, window.innerWidth - 256)),
        top: availableBelow >= height ? rect.bottom + 6 : Math.max(12, rect.top - height - 6)
      })
    }
    setTooltip(null)
    setOpen(next)
  }

  if (!recipients.length) return null
  return <div className="execution-run-recipients recipient-avatar-row" aria-label="本次执行的协作投递对象">
    <small>协作投递</small>
    <div className="recipient-avatar-track" ref={trackRef} data-total={recipients.length} data-visible={visibleCount}>
      {visible.map(recipient => <span
        key={recipient.agentId}
        className="recipient-avatar-target"
        tabIndex={0}
        role="img"
        aria-label={recipient.displayName}
        data-recipient-id={recipient.agentId}
        onPointerEnter={event => showName(event.currentTarget, recipient.displayName)}
        onPointerLeave={event => { if (document.activeElement !== event.currentTarget) setTooltip(null) }}
        onFocus={event => showName(event.currentTarget, recipient.displayName)}
        onBlur={() => setTooltip(null)}
        onKeyDownCapture={event => {
          if (event.key === 'Escape' && tooltip) { event.preventDefault(); event.stopPropagation(); setTooltip(null) }
        }}
      >
        <MemberAvatar {...recipient} size="mention" decorative />
      </span>)}
      {hidden.length > 0 && <Dialog.Root open={open} onOpenChange={setExpanded} modal={false}>
        <Dialog.Trigger asChild>
          <button
            ref={overflowRef}
            type="button"
            className="recipient-overflow-trigger"
            aria-label={`还有 ${hidden.length} 位协作投递对象，查看其余队员`}
          >+{hidden.length}</button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Content
            className="app-dialog recipient-overflow-popover"
            style={position}
            aria-describedby={undefined}
            onEscapeKeyDown={event => {
              event.preventDefault()
              event.stopPropagation()
              setExpanded(false)
            }}
          >
            <header>
              <Dialog.Title>其他 {hidden.length} 位投递对象</Dialog.Title>
              <Dialog.Close aria-label="关闭其余投递对象" className="recipient-overflow-close">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
              </Dialog.Close>
            </header>
            <ul>
              {hidden.map(recipient => <li key={recipient.agentId}>
                <MemberAvatar {...recipient} size="mention" decorative />
                <span>{recipient.displayName}</span>
              </li>)}
            </ul>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>}
    </div>
    {tooltip && createPortal(<div role="tooltip" className="recipient-name-tooltip" style={{ left: tooltip.left, top: tooltip.top }}>{tooltip.label}</div>, document.body)}
  </div>
}
