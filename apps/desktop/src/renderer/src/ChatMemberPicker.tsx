import * as Popover from '@radix-ui/react-popover'
import { useEffect, useId, useRef, useState } from 'react'
import type { AgentProfile } from '@contracts'
import { MemberAvatar } from './MemberAvatar'
import { NavigationIcon } from './NavigationIcon'
import { uiAttribute } from './interface-language'
import { hasNewChatDraft } from './chat-draft'

export interface ChatPickerProps {
  profiles: AgentProfile[]
  loadProfiles(): Promise<AgentProfile[]>
  chooseMember(agentId: string): void
}

export function ChatMemberPicker({ profiles, loadProfiles, chooseMember, toolbar = false }: ChatPickerProps & { toolbar?: boolean }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [roster, setRoster] = useState(profiles)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [retry, setRetry] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const picked = useRef(false)
  const listId = useId()
  const load = useRef(loadProfiles)
  load.current = loadProfiles
  useEffect(() => {
    if (!open) return
    let active = true
    setFailed(false); setLoading(true)
    void load.current().then(value => { if (active) setRoster(value) })
      .catch(() => { if (active) setFailed(true) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open, retry])
  const needle = query.trim().toLocaleLowerCase()
  const people = roster.filter(person => !person.removedAt &&
    (person.displayName.toLocaleLowerCase().includes(needle) || person.teamRole.toLocaleLowerCase().includes(needle)))
  const selected = Math.min(highlight, Math.max(0, people.length - 1))
  useEffect(() => {
    if (open) document.getElementById(listId + '-' + selected)?.scrollIntoView({ block: 'nearest' })
  }, [selected, open, listId])
  function choose(person?: AgentProfile) {
    if (!person) return
    picked.current = true
    setOpen(false)
    chooseMember(person.agentId)
  }
  return <Popover.Root open={open} onOpenChange={value => {
    if (value) { picked.current = false; setRoster(profiles); setHighlight(0); setQuery('') }
    setOpen(value)
  }}>
    <Popover.Trigger asChild><button className={toolbar ? 'navigation-collapse-button' : 'section-create-button chat-new-button'}
      type="button" title={uiAttribute('新聊天')} aria-label={uiAttribute('新聊天')}><NavigationIcon name="square-pen" /></button></Popover.Trigger>
    <Popover.Portal><Popover.Content className="sidebar-action-menu chat-start-menu" side={toolbar ? 'bottom' : 'right'} align="start" sideOffset={6}
      collisionPadding={8} aria-label={uiAttribute('新聊天')} onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus() }}
      onCloseAutoFocus={event => { if (picked.current) event.preventDefault() }}>
      <div className="runtime-model-search chat-start-search"><NavigationIcon name="search" />
        <input ref={input} role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls={listId}
          aria-activedescendant={people.length ? listId + '-' + selected : undefined} aria-label={uiAttribute('搜索队员')}
          placeholder={uiAttribute('搜索队员名称或角色')} value={query} autoComplete="off" spellCheck={false}
          onChange={event => { setQuery(event.target.value); setHighlight(0) }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              if (people.length) setHighlight((selected + people.length + (event.key === 'ArrowDown' ? 1 : -1)) % people.length)
            } else if (event.key === 'Enter') { event.preventDefault(); choose(people[selected]) }
          }} />
      </div>
      <div className="chat-start-list" id={listId} role="listbox" aria-label={uiAttribute('队员')}>
        {people.map((person, index) => <button key={person.agentId} id={listId + '-' + index} type="button" role="option" tabIndex={-1}
          aria-selected={index === selected} data-highlighted={index === selected ? '' : undefined}
          className="sidebar-action-menu-item chat-start-option" onMouseDown={event => event.preventDefault()}
          onPointerMove={() => setHighlight(index)} onClick={() => choose(person)}>
          <MemberAvatar agentId={person.agentId} avatarRef={person.avatarRef} displayName={person.displayName} size="execution" decorative />
          <span className="chat-start-copy"><strong>{person.displayName}</strong><small>{person.teamRole}</small></span>
          {hasNewChatDraft(person.agentId) && <span className="chat-start-draft">{uiAttribute('草稿')}</span>}
        </button>)}
      </div>
      {!people.length && (failed ? <button type="button" className="quiet-button" onClick={() => setRetry(value => value+1)}>{uiAttribute('重新读取队员')}</button>
        : <p className="chat-start-empty" role="status">{uiAttribute(loading ? '正在读取队员…' : '没有找到队员')}</p>)}
    </Popover.Content></Popover.Portal>
  </Popover.Root>
}
