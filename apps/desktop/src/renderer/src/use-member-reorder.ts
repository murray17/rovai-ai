import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'
import type { AgentProfile } from '@contracts'

/** Reorders only within the existing presence group, retaining filtered-out rows. */
export function moveRosterMember(order: readonly string[], source: string, target: string): string[] {
  const from = order.indexOf(source)
  const to = order.indexOf(target)
  if (from < 0 || to < 0 || from === to) return [...order]
  const next = [...order]
  next.splice(from, 1)
  next.splice(to, 0, source)
  return next
}

export function useMemberReorder({ members, busy, scrollRef, onReorder, onDraggingChange }: {
  members: AgentProfile[]
  busy: boolean
  scrollRef: RefObject<HTMLDivElement | null>
  onReorder(order: string[], focusAgentId: string): Promise<void>
  onDraggingChange(value: boolean): void
}) {
  const [order, setOrder] = useState<string[] | null>(null)
  const [agentId, setAgentId] = useState<string | null>(null)
  const suppressClick = useRef(false)
  const latest = useRef({ members, busy, onReorder, onDraggingChange })
  latest.current = { members, busy, onReorder, onDraggingChange }
  const gesture = useRef<{
    id: string; pointerId: number; element: HTMLElement; x: number; y: number
    startX: number; startY: number; order: string[]; active: boolean; frame: number
  } | null>(null)

  const stop = (commit: boolean): void => {
    const current = gesture.current
    if (!current) return
    gesture.current = null
    cancelAnimationFrame(current.frame)
    if (current.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId)
    latest.current.onDraggingChange(false)
    setOrder(null)
    setAgentId(null)
    // pointerup is followed by a click in the same event turn.
    window.setTimeout(() => { suppressClick.current = false }, 0)
    const before = latest.current.members.map((member) => member.agentId)
    if (commit && current.active && before.length === current.order.length
      && before.every((id) => current.order.includes(id))
      && before.some((id, index) => current.order[index] !== id)) {
      void latest.current.onReorder(current.order, current.id)
    }
  }
  const stopRef = useRef(stop)
  stopRef.current = stop

  const tick = (): void => {
    const current = gesture.current
    if (!current?.active) return
    const scroll = scrollRef.current
    if (scroll) {
      const rect = scroll.getBoundingClientRect()
      if (current.y < rect.top + 32) scroll.scrollTop -= 8
      else if (current.y > rect.bottom - 32) scroll.scrollTop += 8
      const target = document.elementFromPoint(current.x, current.y)?.closest<HTMLElement>('[data-member-id]')
      const targetId = target?.dataset.memberId
      const source = latest.current.members.find((member) => member.agentId === current.id)
      const destination = latest.current.members.find((member) => member.agentId === targetId)
      if (target && scroll.contains(target) && source && destination && source.presence === destination.presence) {
        const next = moveRosterMember(current.order, current.id, destination.agentId)
        if (next.some((id, index) => current.order[index] !== id)) { current.order = next; setOrder(next) }
      }
    }
    current.frame = requestAnimationFrame(tick)
  }

  const tickRef = useRef(tick)
  tickRef.current = tick
  useEffect(() => {
    const cancel = (): void => stopRef.current(false)
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') cancel() }
    const move = (event: globalThis.PointerEvent): void => {
      const current = gesture.current
      if (!current || event.pointerId !== current.pointerId) return
      current.x = event.clientX; current.y = event.clientY
      if (!current.active && Math.hypot(current.x - current.startX, current.y - current.startY) >= 6) {
        current.active = true
        suppressClick.current = true
        // Rows move in the DOM during preview; capture belongs to the stable scroll pane.
        current.element.setPointerCapture(event.pointerId)
        setAgentId(current.id)
        latest.current.onDraggingChange(true)
        tickRef.current()
      }
      if (current.active) event.preventDefault()
    }
    const up = (event: globalThis.PointerEvent): void => {
      if (gesture.current?.pointerId === event.pointerId) stopRef.current(true)
    }
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', key)
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    return () => {
      cancel(); window.removeEventListener('blur', cancel); window.removeEventListener('keydown', key)
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
    }
  }, [])

  return { order, agentId, suppressClick, handlers: (id: string) => ({
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (event.button !== 0 || latest.current.busy || gesture.current || !scrollRef.current) return
      gesture.current = { id, element: scrollRef.current, pointerId: event.pointerId,
        x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY,
        order: latest.current.members.map((member) => member.agentId), active: false, frame: 0 }
    }
  }) }
}
