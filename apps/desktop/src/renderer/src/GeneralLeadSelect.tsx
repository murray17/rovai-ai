import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import * as Popover from '@radix-ui/react-popover'
import type { AgentProfile } from '@contracts'
import { DialogControlIcon } from './AppDialog'
import { MemberAvatar } from './MemberAvatar'

function selectable(agent: AgentProfile): boolean {
  return agent.presence === 'present' && agent.removedAt === null
}

export function GeneralLeadSelect({ agents, value, disabled, onChange }: {
  agents: AgentProfile[]
  value: string
  disabled: boolean
  onChange(agentId: string): void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState(value)
  const keyboardOpened = useRef(false)
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const id = useId()
  const selected = agents.find(agent => agent.agentId === value)
  const filtered = agents.filter(agent => `${agent.displayName} ${agent.teamRole}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const enabled = filtered.filter(selectable)
  const active = enabled.find(agent => agent.agentId === activeId) ?? enabled[0]
  const activeIndex = filtered.findIndex(agent => agent.agentId === active?.agentId)
  const searchable = agents.length > 8
  const activeDescendant = open && activeIndex >= 0 ? `${id}-${activeIndex}` : undefined

  function changeOpen(next: boolean): void {
    if (disabled && next) return
    if (next) {
      setQuery('')
      setActiveId(value)
    }
    setOpen(next)
  }

  function choose(agent: AgentProfile): void {
    if (disabled || !selectable(agent)) return
    onChange(agent.agentId)
    setOpen(false)
  }

  function handleKey(event: KeyboardEvent<HTMLElement>): void {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    const navigationKey = ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
    const selectKey = event.key === 'Enter' || (event.key === ' ' && !(event.target instanceof HTMLInputElement))
    if (!navigationKey && !selectKey) return
    if (disabled) return
    keyboardOpened.current = true
    event.preventDefault()
    if (!open) {
      keyboardOpened.current = true
      changeOpen(true)
      return
    }
    if (selectKey) {
      if (active) choose(active)
      return
    }
    const currentIndex = enabled.findIndex(agent => agent.agentId === active?.agentId)
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1
      : Math.max(0, Math.min(enabled.length - 1, currentIndex + (event.key === 'ArrowDown' ? 1 : -1)))
    if (enabled[nextIndex]) setActiveId(enabled[nextIndex].agentId)
  }

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  useEffect(() => {
    if (open && activeIndex >= 0) {
      const container = list.current
      const option = container?.querySelector(`[data-option-index="${activeIndex}"]`)
      if (!container || !option) return
      // Scroll this list only; moving ancestor scroll areas would move the popup anchor.
      const bounds = container.getBoundingClientRect()
      const row = option.getBoundingClientRect()
      if (row.top < bounds.top) container.scrollTop -= bounds.top - row.top
      else if (row.bottom > bounds.bottom) container.scrollTop += row.bottom - bounds.bottom
    }
  }, [open, activeIndex])

  return (
    <Popover.Root open={open} onOpenChange={changeOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="general-lead-trigger" role="combobox" aria-label="默认队长"
          aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="listbox"
          aria-activedescendant={activeDescendant} disabled={disabled}
          onPointerDown={() => { keyboardOpened.current = false }} onKeyDown={handleKey}>
          {selected && <MemberAvatar agentId={selected.agentId} avatarRef={selected.avatarRef} displayName={selected.displayName} size="mention" decorative />}
          <span className="general-lead-value"><strong>{selected?.displayName ?? '请选择队长'}</strong><small>{selected ? selectable(selected) ? selected.teamRole : '已失效' : '从默认队员中选择'}</small></span>
          <DialogControlIcon name="chevron" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="general-lead-popover" align="end" sideOffset={6} collisionPadding={12}
          aria-label="选择默认队长" onKeyDown={handleKey}
          onOpenAutoFocus={event => {
            event.preventDefault()
            if (keyboardOpened.current) (searchable ? search.current : list.current)?.focus()
          }}>
          {searchable && <div className="general-lead-search">
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
            <input ref={search} type="search" aria-label="搜索队长" placeholder="搜索已选队员"
              aria-controls={id} aria-activedescendant={activeDescendant} autoComplete="off" value={query}
              onChange={event => { setQuery(event.target.value); setActiveId('') }} />
          </div>}
          <div ref={list} id={id} role="listbox" aria-label="默认队长候选" aria-activedescendant={activeDescendant} tabIndex={-1} className="general-lead-options">
            {filtered.map((agent, index) => <div id={`${id}-${index}`} data-option-index={index} key={agent.agentId}
              role="option" aria-selected={agent.agentId === value} aria-disabled={!selectable(agent)}
              className={`general-lead-option${agent.agentId === active?.agentId ? ' is-active' : ''}`}
              onClick={() => choose(agent)} title={agent.displayName}>
              <MemberAvatar agentId={agent.agentId} avatarRef={agent.avatarRef} displayName={agent.displayName} size="mention" decorative />
              <span className="general-lead-option-copy"><strong>{agent.displayName}</strong><small>{selectable(agent) ? agent.teamRole : '已失效'}</small></span>
              {agent.agentId === value && <DialogControlIcon name="check" />}
            </div>)}
            {!filtered.length && <p className="general-lead-empty">没有匹配的队员</p>}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
