import React, { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as Menu from '@radix-ui/react-dropdown-menu'
import * as Popover from '@radix-ui/react-popover'
import { MemberAvatar } from './MemberAvatar'
import { NavigationIcon } from './NavigationIcon'
import { useMobileLayout } from './MobileLayout'
import { missionLabelColorToken } from './theme'
import { DialogControlIcon } from './AppDialog'
import type { AgentProfile, MissionRecord as Mission, MissionStatus as Status } from '@contracts'
export const statuses: {id: Status; label: string}[] = [{id:'needs_you',label:'需要你'},{id:'not_started',label:'未开始'},{id:'in_progress',label:'进行中'},{id:'completed',label:'已完成'}]
const People = createContext<AgentProfile[]>([])
export function MissionPeopleProvider({agents,children}:{agents:AgentProfile[];children:ReactNode}) {return <People.Provider value={agents}>{children}</People.Provider>}
function usePeople() {const agents=useContext(People);return (id:string)=>agents.find(agent=>agent.agentId===id) ?? {avatarRef:null,displayName:id,teamRole:''}}


export function Icon({ name }: { name: 'board' | 'list' | 'plus' | 'chevron' | 'chevron-right' | 'play' | 'branch' | 'history' | 'more' | 'check' | 'expand' | 'collapse' | 'tag' | 'refresh' }) {
  const d = { collapse: 'M3 8h5V3M21 8h-5V3M8 21v-5H3M16 21v-5h5', 'chevron-right': 'm9 6 6 6-6 6', tag: 'M3 3h8l10 10-8 8L3 11ZM7 7h.01', refresh: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 11-2l3 7M4 12l3 7a7 7 0 0 0 11-2', board: 'M4 4h16v16H4zM9 4v16M15 4v16', list: 'M8 6h12M8 12h12M8 18h12M4 6h.1M4 12h.1M4 18h.1', plus: 'M12 5v14M5 12h14', chevron: 'm6 9 6 6 6-6', play: 'm8 5 11 7-11 7Z', branch: 'M6 3v12a4 4 0 0 0 4 4h2M18 7a6 6 0 0 1-6 6H6', history: 'M3 11a9 9 0 1 1 2.5 7M3 4v7h7M12 7v5l3 2', more: 'M5 12h.01M12 12h.01M19 12h.01', check: 'm5 12 4 4L19 6', expand: 'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5' }[name]
  return <svg className="mission-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} />{name === 'branch' && <><circle cx="6" cy="3" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="14" cy="19" r="2"/></>}</svg>
}
export const tagStyle = (tag: string) => ({ '--mission-tag-color': missionLabelColorToken(tag) } as React.CSSProperties)
export function TagMark({ tag }: { tag: string }) { return <span className="mission-tag-mark" style={tagStyle(tag)}><Icon name="tag"/></span> }
export function TagColorDot({ tag }: { tag: string }) { return <span className="mission-tag-color-dot" style={tagStyle(tag)} aria-hidden="true"/> }
export function FilterStateIcon() { return <span className="mission-filter-state-icon" aria-hidden="true"/> }
export function Avatar({ id, size = 'execution' }: { id: string; size?: 'execution' | 'mention' | 'list' }) {
  const person=usePeople(); const p = person(id); return <MemberAvatar agentId={id} avatarRef={p.avatarRef} displayName={p.displayName} size={size} decorative />
}
export function StatusIcon({ status }: { status: Status }) {
  return <span className={`mission-state-glyph is-${status}`} aria-hidden="true">{status === 'needs_you' ? '!' : status === 'completed' ? <Icon name="check"/> : ''}</span>
}
export function StatusMenu({ m, onStatus, compact = false }: { m: Mission; onStatus: (status: Status) => void; compact?: boolean }) {
  return <Menu.Root><Menu.Trigger asChild><button className={`mission-status ${compact ? 'is-compact' : ''}`} aria-label={`修改 ${m.title} 的状态，当前${statuses.find(s => s.id === m.status)?.label}`} title="修改状态"><StatusIcon status={m.status}/>{!compact && <span>{statuses.find(s => s.id === m.status)?.label}</span>}<Icon name="chevron"/></button></Menu.Trigger>
    <Menu.Portal><Menu.Content className="compact-menu mission-status-menu" align="end" sideOffset={6} collisionPadding={12} loop><Menu.Label className="mission-menu-label">使命状态</Menu.Label><Menu.RadioGroup value={m.status} onValueChange={v => onStatus(v as Status)}>{statuses.map(s => <Menu.RadioItem key={s.id} value={s.id} className="compact-option"><StatusIcon status={s.id}/><span>{s.label}</span><Menu.ItemIndicator><Icon name="check"/></Menu.ItemIndicator></Menu.RadioItem>)}</Menu.RadioGroup></Menu.Content></Menu.Portal></Menu.Root>
}

export const orderedMembers = (m: Mission) => [...(m.defaultLeadAgentId ? [m.defaultLeadAgentId] : []), ...m.memberAgentIds.filter(id => id !== m.defaultLeadAgentId)]
export type AnchorAction = (event: React.MouseEvent<HTMLElement>) => void

export const MISSION_CARD_AVATAR_LIMIT = 5
const MISSION_CARD_AVATAR_SIZE = 23
const MISSION_CARD_AVATAR_OVERLAP = 7
const MISSION_CARD_OVERFLOW_GAP = 4

export function missionCardVisibleAvatarCount(
  memberCount: number,
  availableWidth: number,
  measureOverflow: (label: string) => number = label => label.length * 7
): number {
  if (memberCount <= 0) return 0
  const maximum = Math.min(memberCount, MISSION_CARD_AVATAR_LIMIT)
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return maximum
  const widthFor = (count: number): number => {
    const avatars = MISSION_CARD_AVATAR_SIZE + (count - 1) * (MISSION_CARD_AVATAR_SIZE - MISSION_CARD_AVATAR_OVERLAP)
    const hidden = memberCount - count
    return avatars + (hidden > 0 ? MISSION_CARD_OVERFLOW_GAP + measureOverflow(`+${hidden}`) : 0)
  }
  let visible = maximum
  while (visible > 1 && widthFor(visible) > availableWidth + 0.5) visible -= 1
  return visible
}

let missionRosterMeasureContext: CanvasRenderingContext2D | null | undefined
function measureMissionRosterOverflow(label: string): number {
  if (missionRosterMeasureContext === undefined && typeof document !== 'undefined') {
    missionRosterMeasureContext = document.createElement('canvas').getContext('2d')
  }
  if (!missionRosterMeasureContext) return label.length * 7
  missionRosterMeasureContext.font = '600 11.5px ui-monospace, SFMono-Regular, Menlo, monospace'
  return missionRosterMeasureContext.measureText(label).width
}

export function MissionAvatars({ m, onClick, compact = false }: { m: Mission; onClick?: AnchorAction; compact?: boolean }) {
  const person=usePeople();
  const memberIds = orderedMembers(m)
  const memberKey = memberIds.join('\u0000')
  const maximum = compact ? Math.min(memberIds.length, MISSION_CARD_AVATAR_LIMIT) : memberIds.length
  const [visibleCount, setVisibleCount] = useState(maximum)
  const groupRef = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    if (!compact) return
    const group = groupRef.current
    const footer = group?.parentElement
    if (!group || !footer) return
    const fit = (): void => {
      const footerStyle = getComputedStyle(footer)
      const gap = Number.parseFloat(footerStyle.columnGap || footerStyle.gap) || 0
      const siblings = Array.from(footer.children).filter((element): element is HTMLElement => element instanceof HTMLElement && element !== group && getComputedStyle(element).display !== 'none')
      const occupied = siblings.reduce((width, element) => {
        const style = getComputedStyle(element)
        // Ignore the unread/time auto-start margin: it is flexible spare space, not a constraint.
        return width + element.getBoundingClientRect().width + (Number.parseFloat(style.marginRight) || 0)
      }, 0)
      const available = footer.clientWidth - occupied - gap * siblings.length
      const next = missionCardVisibleAvatarCount(memberIds.length, available, measureMissionRosterOverflow)
      setVisibleCount(current => current === next ? current : next)
    }
    fit()
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit)
    resizeObserver?.observe(footer)
    for (const element of Array.from(footer.children)) if (element !== group) resizeObserver?.observe(element)
    window.addEventListener('resize', fit)
    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', fit)
    }
  }, [compact, memberKey, memberIds.length, m.hasUnread, m.updatedAt])

  const visibleIds = compact ? memberIds.slice(0, Math.min(visibleCount, maximum)) : memberIds
  const overflow = memberIds.length - visibleIds.length
  const names = memberIds.map(id => `${person(id).displayName}${id === m.defaultLeadAgentId ? '（队长）' : ''}`)
  const label = `查看队员：${names.join('、')}${compact && overflow ? `；当前显示 ${visibleIds.length} 位，另有 ${overflow} 位收起` : ''}`
  const title = `${names.join('、')}${compact && overflow ? `\n+${overflow}：${memberIds.slice(visibleIds.length).map(id => person(id).displayName).join('、')}` : ''}`
  const portraits = visibleIds.map(id => <span key={id} className="mission-avatar-item" title={`${person(id).displayName}${id === m.defaultLeadAgentId ? ' · 队长' : ''}`} data-member-id={id}><Avatar id={id}/></span>)
  const content = <>{portraits}{overflow > 0 && <span className="mission-avatar-overflow" aria-hidden="true"><span className="mission-overflow-label">+{overflow}</span></span>}</>
  const className = `mission-avatars${compact ? ' is-card-roster' : ''}`
  const data = compact ? { 'data-visible-count': visibleIds.length, 'data-member-count': memberIds.length, 'data-overflow-count': overflow } : {}
  return onClick ? <button ref={node => { groupRef.current = node }} className={className} onClick={onClick} aria-label={label} title={title} {...data}>{content}</button>
    : <span ref={node => { groupRef.current = node }} className={className} role="img" aria-label={label} title={title} {...data}>{content}</span>
}
export function MissionTags({ tags, onEdit }: { tags: string[]; onEdit?: AnchorAction }) {
  return <div className="mission-tags" aria-label="使命标签">{tags.map(tag => <span className="mission-tag is-colored" style={tagStyle(tag)} key={tag} title={tag}>{tag}</span>)}
    {onEdit && <button className="mission-edit-tags" onClick={onEdit} aria-label="编辑标签" title="编辑标签"><Icon name="tag"/>{tags.length ? <Icon name="plus"/> : '添加标签'}</button>}
  </div>
}
export function MissionFilter({ label, icon, options, values, onChange, searchable = true }: {
  label: string; searchable?: boolean; icon: ReactNode; options: { id: string; label: string; icon?: ReactNode; keywords?: string; count?: number }[]; values: string[]; onChange(values: string[]): void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const selected = options.filter(item => values.includes(item.id))
  const summary = selected.length === 1 ? selected[0].label : selected.length ? `${selected.length}` : ''
  const found = options.filter(option => `${option.label} ${option.keywords ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  function navigate(event: React.KeyboardEvent<HTMLElement>) {
    if (event.nativeEvent.isComposing || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    if (event.target === searchRef.current && !['ArrowDown', 'ArrowUp'].includes(event.key)) return
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.mission-filter-options button'))
    if (!buttons.length) return
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : index < 0 ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1) : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next].focus()
  }
  return <Popover.Root open={open} onOpenChange={value => { setOpen(value); if (!value) setQuery('') }}><Popover.Trigger asChild><button className={`mission-filter ${values.length ? 'selected' : ''}`} aria-label={`${label}筛选${summary ? `：${selected.map(o => o.label).join('、')}` : ''}`} title={selected.map(o => o.label).join('、') || `${label}筛选`}>
    {icon}<span className="mission-filter-label">{label}</span>{summary && <span className="mission-filter-value">{summary}</span>}<Icon name="chevron"/>
  </button></Popover.Trigger><Popover.Portal><Popover.Content className="compact-menu mission-unified-filter" aria-label={`${label}筛选`} sideOffset={6} align="start" collisionPadding={12} onKeyDown={navigate}
    onOpenAutoFocus={event => { if (searchable) { event.preventDefault(); searchRef.current?.focus() } }}>
    {searchable && <label className="mission-filter-search"><NavigationIcon name="search"/><input ref={searchRef} aria-label={`搜索${label}`} placeholder={`搜索${label}…`} value={query} onChange={event => setQuery(event.target.value)}/></label>}
    <div className="mission-filter-options" role="group" aria-label={`选择${label}`}>
      {found.map(option => <button type="button" role="checkbox" aria-checked={values.includes(option.id)} className="compact-option" key={option.id} onClick={() => onChange(values.includes(option.id) ? values.filter(id => id !== option.id) : [...values, option.id])}>
        {option.icon ?? icon}<span>{option.label}</span>{option.count !== undefined && <small>{option.count}</small>}<span className="mission-filter-check">{values.includes(option.id) && <Icon name="check"/>}</span>
      </button>)}
      {!found.length && <p className="mission-filter-empty">没有匹配的{label}</p>}
    </div>
  </Popover.Content></Popover.Portal></Popover.Root>
}
export type ContextPosition = { id: string; x: number; y: number; origin: HTMLElement | null }
export function MissionContextMenu({ m, position, catalog, onClose, onEdit, onStatus, onLead, onSaveTags, onCleanup, onDelete }: {
  m: Mission | undefined; position: ContextPosition | null; onClose(): void; onStatus(status: Status): void;
  catalog: string[]; onEdit(): void; onLead(id: string): void; onSaveTags(tags: string[]): Promise<void>; onCleanup(): void; onDelete(): void
}) {
  const person=usePeople();
  const mobile=useMobileLayout()
  const [panel, setPanel] = useState<string | null>(null)
  const triggers = useRef(new Map<string, HTMLDivElement>())
  const panels = m ? [
    {id:'status',label:'状态',className:'',content:<Menu.RadioGroup value={m.status} onValueChange={v => onStatus(v as Status)}>{statuses.map(s => <Menu.RadioItem className="compact-option" value={s.id} key={s.id}><StatusIcon status={s.id}/><span>{s.label}</span><Menu.ItemIndicator><Icon name="check"/></Menu.ItemIndicator></Menu.RadioItem>)}</Menu.RadioGroup>},
    {id:'members',label:'查看队员',className:'mission-members-popover',content:<MissionRoster m={m}/>},
    {id:'lead',label:'队长',className:'',content:<Menu.RadioGroup value={m.defaultLeadAgentId ?? ''} onValueChange={onLead}>{orderedMembers(m).map(id => <Menu.RadioItem className="compact-option" key={id} value={id}><Avatar id={id}/><span>{person(id).displayName}</span><Menu.ItemIndicator><Icon name="check"/></Menu.ItemIndicator></Menu.RadioItem>)}</Menu.RadioGroup>},
    {id:'tags',label:'标签',className:'mission-label-popover',content:<LabelsEditor m={m} catalog={catalog} onSave={onSaveTags}/>}
  ] : []
  const currentPanel = mobile ? panels.find(item => item.id === panel) : undefined
  function submenu(id: string, label: string, children: ReactNode, className = '') {
    if (mobile) return <Menu.Item key={id} className="compact-option" onSelect={event => { event.preventDefault(); setPanel(id) }}><span>{label}</span><Icon name="chevron-right"/></Menu.Item>
    return <Menu.Sub key={id} open={panel === id} onOpenChange={open => { if (!open) setPanel(current => current === id ? null : current) }}>
      <Menu.SubTrigger ref={node => { if (node) triggers.current.set(id, node); else triggers.current.delete(id) }} className="compact-option" onPointerMove={event => event.preventDefault()} onPointerLeave={event => event.preventDefault()}
        onClick={event => { event.preventDefault(); setPanel(current => current === id ? null : id) }}
        onKeyDown={event => { if (['Enter', ' ', 'ArrowRight'].includes(event.key)) { event.preventDefault(); setPanel(id) } }}>
        <span>{label}</span><Icon name="chevron-right"/>
      </Menu.SubTrigger>
      <Menu.Portal><Menu.SubContent className={`compact-menu mission-action-submenu ${className}`} aria-label={label} sideOffset={5} collisionPadding={10} loop
        onEscapeKeyDown={event => { event.preventDefault(); setPanel(null); requestAnimationFrame(() => triggers.current.get(id)?.focus()) }}>
        {children}
      </Menu.SubContent></Menu.Portal>
    </Menu.Sub>
  }
  return <Menu.Root open={!!m && !!position} onOpenChange={open => { if (!open) { setPanel(null); onClose() } }}><Menu.Trigger asChild><span className="attachment-context-anchor" style={{ left: position?.x ?? 0, top: position?.y ?? 0 }}/></Menu.Trigger>
    {m && <Menu.Portal><Menu.Content className={`compact-menu mission-action-menu${currentPanel ? ` mission-action-submenu ${currentPanel.className}` : ''}`} aria-label={currentPanel?.label ?? `${m.title}的操作`} align="start" side="right" sideOffset={4} collisionPadding={10} loop
      onCloseAutoFocus={event => event.preventDefault()} onEscapeKeyDown={event => {
        if (currentPanel) { event.preventDefault(); setPanel(null) }
        else requestAnimationFrame(() => position?.origin?.isConnected && position.origin.focus())
      }}>
      {currentPanel ? <><Menu.Item className="compact-option mission-mobile-menu-back" onSelect={event => { event.preventDefault(); setPanel(null) }}><NavigationIcon name="arrow-left"/><span>{currentPanel.label}</span></Menu.Item><Menu.Separator className="sidebar-action-menu-separator"/>{currentPanel.content}</> : <>
      <Menu.Item className="compact-option" onSelect={onEdit}><span>编辑</span></Menu.Item>
      {panels.map(item => submenu(item.id, item.label, item.content, item.className))}
      {m.cleanupAvailable && <Menu.Item className="compact-option" onSelect={onCleanup}><span>清理使命 Worktree</span></Menu.Item>}
      <Menu.Separator className="sidebar-action-menu-separator"/>
      <Menu.Item className="compact-option mission-danger-item" onSelect={onDelete}><span>删除</span></Menu.Item>
      </>}
    </Menu.Content></Menu.Portal>}
  </Menu.Root>
}
export function CompactDialog({ title, children, footer, onClose, className = '' }: { title: string; children: ReactNode; footer?: ReactNode; onClose(): void; className?: string }) {
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className={`compact-dialog ${className}`} aria-describedby={undefined}>
    <header className="compact-header"><Dialog.Title>{title}</Dialog.Title><Dialog.Close asChild><button className="compact-close" aria-label="关闭"><DialogControlIcon name="close"/></button></Dialog.Close></header>
    <div className="compact-body">{children}</div><footer className="compact-footer">{footer ?? <button className="compact-cancel" onClick={onClose}>关闭</button>}</footer>
  </Dialog.Content></Dialog.Portal></Dialog.Root>
}
export function LabelsEditor({ m, catalog, onSave }: { m: Mission; catalog: string[]; onSave(tags: string[]): Promise<void> }) {
  const [query, setQuery] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const pending = useRef<string[] | null>(null)
  const normalized = query.trim().replace(/\s+/g, ' ')
  const all = [...new Set([...catalog, ...m.tags])]
  const found = all.filter(tag => tag.toLocaleLowerCase().includes(normalized.toLocaleLowerCase()))
  const exact = all.some(tag => tag.toLocaleLowerCase() === normalized.toLocaleLowerCase())
  const tooLong = [...normalized].length > 24
  async function save(next: string[]) { if (busy) return; pending.current = next; setBusy(true); setError(''); try { await onSave(next); pending.current = null; setQuery('') } catch (e) { setError(String(e instanceof Error ? e.message : e)) } finally { setBusy(false) } }
  function toggle(tag: string) { void save(m.tags.includes(tag) ? m.tags.filter(t => t !== tag) : [...m.tags, tag]) }
  function create() { if (!normalized || exact || tooLong) return; void save([...m.tags, normalized]) }
  return <div className="mission-label-editor" aria-label="编辑标签" aria-busy={busy} onKeyDown={event => {
    // Text editing and normal Tab navigation belong to this small form, not menu typeahead.
    if (event.key !== 'Escape') event.stopPropagation()
    if (event.key === 'Tab') {
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)')]
      const index = controls.indexOf(document.activeElement as HTMLElement)
      if (event.shiftKey && index === 0 || !event.shiftKey && index === controls.length - 1) { event.preventDefault(); controls[event.shiftKey ? controls.length - 1 : 0]?.focus() }
    }
  }}>
    <label className="mission-tag-search"><NavigationIcon name="search"/><input autoFocus value={query} onChange={e => setQuery(e.target.value)} aria-label="搜索或新建标签" placeholder="搜索或新建标签…" onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); create() } }}/></label>
    <div className="mission-tag-options" role="group" aria-label="可选标签">{found.map(tag => <button type="button" className="compact-option" key={tag} role="checkbox" aria-checked={m.tags.includes(tag)} disabled={busy} onPointerDown={event => event.stopPropagation()} onClick={event => { event.preventDefault(); event.stopPropagation(); toggle(tag) }}><TagColorDot tag={tag}/><span>{tag}</span>{m.tags.includes(tag) && <Icon name="check"/>}</button>)}
      {normalized && !exact && <button type="button" className="compact-option" onPointerDown={event => event.stopPropagation()} onClick={event => { event.preventDefault(); event.stopPropagation(); create() }} disabled={tooLong || busy}><Icon name="plus"/><span>新建“{normalized}”</span></button>}
      {tooLong && <p className="compact-inline-error" role="alert">标签最多 24 个字符。</p>}
    </div>{error && <div className="mission-tag-error" role="alert"><p>{error}</p><button onClick={() => pending.current && void save(pending.current)} disabled={busy}>重试</button></div>}
  </div>
}
export function MissionRoster({ m }: { m: Mission }) {
  const person=usePeople();
  return <div className="mission-roster" aria-label="使命队员">{orderedMembers(m).map(id => <div key={id}><Avatar id={id} size="list"/><span><strong>{person(id).displayName}</strong><small>{person(id).teamRole}</small></span>{id === m.defaultLeadAgentId && <span className="mission-tag">队长</span>}</div>)}</div>
}
export function MissionPopover({ position, title, children, onClose, className = '' }: { position: ContextPosition; title: string; children: ReactNode; onClose(): void; className?: string }) {
  return <Popover.Root open onOpenChange={open => { if (!open) onClose() }}><Popover.Anchor asChild><span className="attachment-context-anchor" style={{ left: position.x, top: position.y }}/></Popover.Anchor><Popover.Portal>
    <Popover.Content className={`compact-menu mission-property-popover ${className}`} aria-label={title} side="bottom" align="start" sideOffset={6} collisionPadding={12}
      onCloseAutoFocus={event => event.preventDefault()} onEscapeKeyDown={event => { event.stopPropagation(); requestAnimationFrame(() => position.origin?.isConnected && position.origin.focus()) }}>
      {children}
    </Popover.Content>
  </Popover.Portal></Popover.Root>
}
