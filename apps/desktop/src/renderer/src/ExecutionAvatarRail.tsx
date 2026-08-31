import { useCallback, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { MemberAvatar, type MemberAvatarProps } from './MemberAvatar'

export interface ExecutionAvatarRailItem extends Pick<MemberAvatarProps, 'agentId' | 'avatarRef' | 'displayName'> {
  statusLabel: string
  statusTone: string
  stateShape: 'running' | 'waiting' | 'completed' | 'failed' | 'stopped' | 'recorded'
}

// Four 38px controls, each followed by a 6px gap. Keep the CSS slot size in sync.
const SCROLL_STEP = 176
const EDGE_INSET = 32

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

function revealAvatar(rail: HTMLUListElement, button: HTMLButtonElement): void {
  const viewport = rail.getBoundingClientRect()
  const avatar = button.getBoundingClientRect()
  const maximum = Math.max(0, rail.scrollWidth - rail.clientWidth)
  const left = viewport.left + (rail.scrollLeft > 1 ? EDGE_INSET : 3)
  const right = viewport.right - (rail.scrollLeft < maximum - 1 ? EDGE_INSET : 3)
  const delta = avatar.left < left ? avatar.left - left : avatar.right > right ? avatar.right - right : 0
  // Scroll only this rail; scrollIntoView would also move the conversation/Inspector ancestors.
  if (delta !== 0) rail.scrollTo({
    left: Math.max(0, Math.min(rail.scrollLeft + delta, maximum)),
    behavior: scrollBehavior()
  })
}

function StateIcon({ shape }: { shape: ExecutionAvatarRailItem['stateShape'] }): React.JSX.Element {
  return <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {shape === 'running' && <><circle cx="8" cy="8" r="2.5" fill="currentColor" /><circle cx="8" cy="8" r="5.5" /></>}
    {shape === 'waiting' && <circle cx="8" cy="8" r="4.5" />}
    {shape === 'completed' && <path d="m3.5 8 3 3 6-6" />}
    {shape === 'failed' && <><path d="M8 1.5 14.5 8 8 14.5 1.5 8Z" /><path d="M8 5v3M8 10.5h.01" /></>}
    {shape === 'stopped' && <rect x="4" y="4" width="8" height="8" rx="1" />}
    {shape === 'recorded' && <path d="M4 8h8" />}
  </svg>
}

export function ExecutionAvatarRail({
  items,
  selectedAgentId,
  revealRequest,
  active,
  onOpen
}: {
  items: ExecutionAvatarRailItem[]
  selectedAgentId: string | null
  revealRequest: number
  active: boolean
  onOpen(agentId: string, trigger: HTMLButtonElement): void
}): React.JSX.Element {
  const railRef = useRef<HTMLUListElement>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const leftButtonRef = useRef<HTMLButtonElement>(null)
  const rightButtonRef = useRef<HTMLButtonElement>(null)
  const tooltipRef = useRef<HTMLSpanElement>(null)
  const lastReveal = useRef<{ agentId: string; request: number } | null>(null)
  const arrowScrollTarget = useRef<number | null>(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null)
  const [focusedAgentId, setFocusedAgentId] = useState<string | null>(null)
  const tooltipId = useId()
  const listId = useId()
  const itemIds = JSON.stringify(items.map(item => item.agentId))
  const tooltipItem = active
    ? items.find(item => item.agentId === (hoveredAgentId ?? focusedAgentId))
    : undefined

  const updateEdges = useCallback((): void => {
    const rail = railRef.current
    if (!rail) return
    const maximum = Math.max(0, rail.scrollWidth - rail.clientWidth)
    if (arrowScrollTarget.current !== null
      && (Math.abs(rail.scrollLeft - arrowScrollTarget.current) < 1 || arrowScrollTarget.current > maximum)) {
      arrowScrollTarget.current = null
    }
    const left = maximum > 1 && rail.scrollLeft > 1
    const right = maximum > 1 && rail.scrollLeft < maximum - 1
    setEdges(previous => previous.left === left && previous.right === right ? previous : { left, right })
  }, [])

  useLayoutEffect(() => {
    const rail = railRef.current
    if (!rail) return
    const wheel = (event: WheelEvent): void => {
      if (event.ctrlKey || rail.scrollWidth <= rail.clientWidth + 1) return
      arrowScrollTarget.current = null
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
      event.preventDefault()
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? rail.clientWidth : 1
      rail.scrollBy({ left: event.deltaY * unit, behavior: 'auto' })
    }
    const observer = new ResizeObserver(updateEdges)
    observer.observe(rail)
    rail.addEventListener('scroll', updateEdges, { passive: true })
    // React's delegated wheel listener is passive; the vertical-wheel conversion must not be.
    rail.addEventListener('wheel', wheel, { passive: false })
    updateEdges()
    return () => {
      observer.disconnect()
      rail.removeEventListener('scroll', updateEdges)
      rail.removeEventListener('wheel', wheel)
    }
  }, [itemIds, updateEdges])

  useLayoutEffect(() => {
    const rail = railRef.current
    if (!active || !selectedAgentId || !rail?.clientWidth) return
    if (lastReveal.current?.agentId === selectedAgentId && lastReveal.current.request === revealRequest) return
    const button = buttons.current.get(selectedAgentId)
    if (!button) return
    arrowScrollTarget.current = null
    revealAvatar(rail, button)
    lastReveal.current = { agentId: selectedAgentId, request: revealRequest }
  }, [active, selectedAgentId, revealRequest, itemIds])

  useLayoutEffect(() => {
    if (!active) return
    // A scroll arrow disappearing at an edge must not strand keyboard focus on an invisible control.
    const boundary = !edges.left && document.activeElement === leftButtonRef.current ? items[0]
      : !edges.right && document.activeElement === rightButtonRef.current ? items.at(-1) : null
    if (boundary) buttons.current.get(boundary.agentId)?.focus({ preventScroll: true })
  }, [active, edges, items])

  useLayoutEffect(() => {
    const rail = railRef.current
    const tooltip = tooltipRef.current
    const button = tooltipItem && buttons.current.get(tooltipItem.agentId)
    if (!rail || !tooltip || !button) return
    const position = (): void => {
      const viewport = rail.getBoundingClientRect()
      const avatar = button.getBoundingClientRect()
      tooltip.hidden = avatar.right <= viewport.left || avatar.left >= viewport.right
      const center = avatar.left + avatar.width / 2 - viewport.left
      tooltip.style.left = `${Math.max(0, Math.min(center - tooltip.offsetWidth / 2, rail.clientWidth - tooltip.offsetWidth))}px`
    }
    position()
    const observer = new ResizeObserver(position)
    observer.observe(rail)
    observer.observe(tooltip)
    rail.addEventListener('scroll', position, { passive: true })
    return () => {
      observer.disconnect()
      rail.removeEventListener('scroll', position)
    }
  }, [tooltipItem])

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    if (event.key === 'Escape' && tooltipItem) {
      event.preventDefault()
      event.stopPropagation()
      setHoveredAgentId(null)
      setFocusedAgentId(null)
      return
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
      || event.altKey || event.ctrlKey || event.metaKey) return
    const current = items.findIndex(item => buttons.current.get(item.agentId) === event.target)
    if (current < 0) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length
    const button = buttons.current.get(items[next].agentId)
    if (!button || !railRef.current) return
    arrowScrollTarget.current = null
    setHoveredAgentId(null)
    setFocusedAgentId(items[next].agentId)
    button.focus({ preventScroll: true })
    // Home/End also reveal an already-focused avatar after a wheel gesture moved it off screen.
    revealAvatar(railRef.current, button)
  }

  const scrollByFour = (direction: -1 | 1): void => {
    const rail = railRef.current
    if (!rail) return
    const target = Math.max(0, Math.min(
      (arrowScrollTarget.current ?? rail.scrollLeft) + direction * SCROLL_STEP,
      rail.scrollWidth - rail.clientWidth
    ))
    arrowScrollTarget.current = target
    rail.scrollTo({ left: target, behavior: scrollBehavior() })
  }

  return <div className={`run-pulse-avatar-rail${edges.left ? ' can-scroll-left' : ''}${edges.right ? ' can-scroll-right' : ''}`}>
    <button
      ref={leftButtonRef}
      className="run-pulse-avatar-scroll is-left"
      type="button"
      aria-label="向左查看更多队员"
      aria-controls={listId}
      aria-hidden={!edges.left}
      disabled={!edges.left}
      onClick={() => scrollByFour(-1)}
    ><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m10 3.5-4.5 4.5 4.5 4.5" /></svg></button>
    <ul ref={railRef} id={listId} className="run-pulse-list" aria-label="队员执行过程入口" onKeyDown={onKeyDown}>
      {items.map(item => <li key={item.agentId}>
        <button
          ref={button => { if (button) buttons.current.set(item.agentId, button); else buttons.current.delete(item.agentId) }}
          type="button"
          className={`run-pulse-chip${selectedAgentId === item.agentId ? ' is-selected' : ''}`}
          aria-label={`打开${item.displayName}的执行过程，${item.statusLabel}`}
          aria-pressed={selectedAgentId === item.agentId}
          aria-expanded={selectedAgentId === item.agentId}
          aria-controls="agent-execution-drawer"
          aria-describedby={tooltipItem?.agentId === item.agentId ? tooltipId : undefined}
          data-agent-id={item.agentId}
          onPointerEnter={() => setHoveredAgentId(item.agentId)}
          onPointerLeave={() => setHoveredAgentId(null)}
          onFocus={event => {
            arrowScrollTarget.current = null
            setFocusedAgentId(item.agentId)
            if (railRef.current) revealAvatar(railRef.current, event.currentTarget)
          }}
          onBlur={() => setFocusedAgentId(null)}
          onClick={event => onOpen(item.agentId, event.currentTarget)}
        >
          <MemberAvatar agentId={item.agentId} avatarRef={item.avatarRef} displayName={item.displayName} size="list" decorative />
          <span className={`run-pulse-chip-state tone-${item.statusTone} state-${item.stateShape}`} role="img" aria-label={item.statusLabel}>
            <StateIcon shape={item.stateShape} />
          </span>
        </button>
      </li>)}
    </ul>
    <button
      ref={rightButtonRef}
      className="run-pulse-avatar-scroll is-right"
      type="button"
      aria-label="向右查看更多队员"
      aria-controls={listId}
      aria-hidden={!edges.right}
      disabled={!edges.right}
      onClick={() => scrollByFour(1)}
    ><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg></button>
    {tooltipItem && <span ref={tooltipRef} id={tooltipId} className="run-pulse-avatar-tooltip" role="tooltip">
      {tooltipItem.displayName} · {tooltipItem.statusLabel}
    </span>}
  </div>
}
