import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useMobileLayout } from './MobileLayout'
import { MemberAvatar, type MemberAvatarProps } from './MemberAvatar'
import { ExecutionIcon } from './ExecutionIcons'
import { UiText, uiAttribute } from './interface-language'
import { useThreadDetailCopy } from './camp-detail-copy'

export type ThreadDetailTab = 'execution' | 'tasks' | 'members'
export type RunningThreadMember = Pick<MemberAvatarProps, 'agentId' | 'avatarRef' | 'displayName'>

function ThreadDetailIcon({ tab }: { tab: ThreadDetailTab }): React.JSX.Element {
  if (tab === 'execution') return <ExecutionIcon />
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
    {tab === 'tasks' && <><rect x="6" y="4" width="15" height="17" rx="2" /><path d="M3 7h5M3 12h5M3 17h5M12 8h5M12 12h5M12 16h3" /></>}
    {tab === 'members' && <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /><circle cx="9" cy="7" r="4" /></>}
  </svg>
}

function ThreadExecutionEntry({ members, executionCount, expanded, panelId, mobile = false, onSelect }: {
  members: readonly RunningThreadMember[]
  executionCount: number
  expanded: boolean
  panelId: string
  mobile?: boolean
  onSelect(tab: ThreadDetailTab, trigger: HTMLButtonElement, keyboard: boolean): void
}): React.JSX.Element {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const tooltipRef = useRef<HTMLSpanElement>(null)
  const tooltipId = useId()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [pageHidden, setPageHidden] = useState(false)
  const [anchor, setAnchor] = useState({ top: 0, right: 12 })
  const running = members.length > 0
  const showNames = !mobile && running && (hovered || focused) && !dismissed
  const avatarLimit = mobile ? 2 : 3
  const names = members.map(member => member.displayName).join('、')
  const description = running
    ? uiAttribute("{0} 位队员正在执行：{1}", String(members.length), String(names))
    : uiAttribute("共 {0} 位队员有执行记录，当前没有队员正在执行", String(executionCount))

  useEffect(() => {
    if (!running) return
    const update = (): void => setPageHidden(document.hidden)
    update()
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [running])

  useLayoutEffect(() => {
    if (!showNames) return
    const update = (): void => {
      const rect = triggerRef.current?.getBoundingClientRect()
      const width = tooltipRef.current?.offsetWidth ?? 0
      if (rect) setAnchor({ top: rect.bottom + 6,
        right: Math.max(12, Math.min(window.innerWidth - rect.right, window.innerWidth - width - 12)) })
    }
    update()
    const observer = new ResizeObserver(update)
    if (triggerRef.current) observer.observe(triggerRef.current)
    window.addEventListener('resize', update)
    return () => { observer.disconnect(); window.removeEventListener('resize', update) }
  }, [showNames, members.length, names])

  const face = <>
    {!mobile && <ThreadDetailIcon tab="execution" />}
    {mobile
      ? <span><UiText zh={"执行"} /></span>
      : <span className="camp-detail-entry-copy">
          <span><UiText zh={"执行"} /></span>
          {!running && <small>{executionCount}</small>}
        </span>}
    {running && <>
      <span className="camp-execution-members" aria-hidden="true">
        {members.slice(0, avatarLimit).map(member => <MemberAvatar key={member.agentId} {...member} size="execution" decorative />)}
        {members.length > avatarLimit && <span className="camp-execution-overflow">+{members.length - avatarLimit}</span>}
      </span>
      <svg className="camp-execution-orbits" aria-hidden="true" focusable="false" data-paused={pageHidden}>
        <rect width="100%" height="100%" rx="5" pathLength="100" />
        <rect className="is-ember" width="100%" height="100%" rx="5" pathLength="100" />
      </svg>
    </>}
  </>

  return <>
    <button
      ref={triggerRef}
      className="camp-detail-entry camp-execution-entry"
      type="button"
      data-detail="execution"
      data-running={running}
      aria-label={uiAttribute("执行，{0}", String(description))}
      aria-expanded={expanded}
      aria-pressed={mobile ? expanded : undefined}
      aria-controls={panelId}
      aria-haspopup={mobile ? undefined : 'dialog'}
      aria-describedby={showNames ? tooltipId : undefined}
      onPointerEnter={() => { setHovered(true); setDismissed(false) }}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => { setFocused(true); setDismissed(false) }}
      onBlur={() => setFocused(false)}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !showNames) return
        event.preventDefault()
        event.stopPropagation()
        setDismissed(true)
      }}
      onClick={(event) => {
        setDismissed(true)
        onSelect('execution', event.currentTarget, event.detail === 0)
      }}
    >
      {mobile ? <span className="mobile-execution-face">{face}</span> : face}
    </button>
    {showNames && createPortal(<span ref={tooltipRef} id={tooltipId} role="tooltip" className="camp-execution-tooltip" style={anchor}>
      {description}
    </span>, document.body)}
  </>
}

export function ThreadDetailEntries({
  activeTab,
  visible,
  panelId,
  showExecution,
  executionExpanded = visible && activeTab === 'execution',
  runningMembers,
  executionCount,
  taskCount,
  memberCount,
  onSelect
}: {
  activeTab: ThreadDetailTab
  visible: boolean
  panelId: string
  showExecution: boolean
  executionExpanded?: boolean
  runningMembers: readonly RunningThreadMember[]
  executionCount: number
  taskCount: number
  memberCount: number
  onSelect(tab: ThreadDetailTab, trigger: HTMLButtonElement, keyboard: boolean): void
}): React.JSX.Element {
  const copy = useThreadDetailCopy()
  const entries: Array<{ tab: ThreadDetailTab; count: number }> = [
    { tab: 'tasks', count: taskCount },
    { tab: 'members', count: memberCount }
  ]
  return (
    <div className="camp-detail-entries" role="group" aria-label={uiAttribute("当前会话详情入口")}>
      {showExecution && <ThreadExecutionEntry
        members={runningMembers}
        executionCount={executionCount}
        expanded={executionExpanded}
        panelId={panelId}
        onSelect={onSelect}
      />}
      {entries.map(({ tab, count }) => (
        <button
          className="camp-detail-entry"
          key={tab}
          type="button"
          data-detail={tab}
          aria-expanded={visible && activeTab === tab}
          aria-controls={panelId}
          aria-haspopup="dialog"
          onClick={(event) => onSelect(tab, event.currentTarget, event.detail === 0)}
        >
          <ThreadDetailIcon tab={tab} />
          <span className="camp-detail-entry-copy">
            <span>{copy[tab]}</span>
            <small>{count}</small>
          </span>
        </button>
      ))}
    </div>
  )
}

export function ThreadDetailPopover({
  entryHost,
  activeTab,
  visible,
  showExecution,
  executionExpanded = visible && activeTab === 'execution',
  mobileExecutionMaximized = false,
  onToggleMobileExecutionMaximized,
  runningMembers,
  executionCount,
  taskCount,
  memberCount,
  onOpen,
  onClose,
  singleChatVisible = false,
  onOpenSingleChat = () => undefined,
  onOpenMissionActivity,
  children
}: {
  entryHost?: HTMLElement | null
  activeTab: ThreadDetailTab
  visible: boolean
  showExecution: boolean
  executionExpanded?: boolean
  mobileExecutionMaximized?: boolean
  onToggleMobileExecutionMaximized?(): void
  runningMembers: readonly RunningThreadMember[]
  executionCount: number
  taskCount: number
  memberCount: number
  onOpen(tab: ThreadDetailTab): void
  onClose(): void
  singleChatVisible?: boolean
  onOpenSingleChat?(): void
  onOpenMissionActivity?(): void
  children: ReactNode
}): React.JSX.Element {
  const mobile = useMobileLayout()
  const copy = useThreadDetailCopy()
  const panelId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const focusPanelRef = useRef(false)
  const menuSelected = useRef(false)
  const secondary = singleChatVisible || (visible && activeTab !== 'execution')

  useEffect(() => {
    if (!visible || !focusPanelRef.current) return
    focusPanelRef.current = false
    panelRef.current?.focus({ preventScroll: true })
  }, [visible, activeTab])

  useEffect(() => {
    if (!visible) return
    // Keep this non-modal work surface stable while the user interacts elsewhere.
    // Only the current entry, the close button, or Escape dismisses it.
    const dismissOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (document.querySelector('.app-dialog, [role="menu"][data-state="open"]')) return
      // Tool results own their first Escape; the remaining execution surface closes here.
      if (event.target instanceof Element && event.target.closest('.tool-call-result-scroll')) return
      event.preventDefault()
      onClose()
      triggerRef.current?.focus({ preventScroll: true })
    }
    document.addEventListener('keydown', dismissOnEscape)
    return () => {
      document.removeEventListener('keydown', dismissOnEscape)
    }
  }, [visible, onClose])

  const entries = mobile ? <>
    <div className="mobile-camp-tabs" role="group" aria-label={uiAttribute("当前会话视图")} hidden={secondary}>
      <button type="button" aria-pressed={!visible} onClick={onClose}><UiText zh={"对话"} /></button>
      <ThreadExecutionEntry mobile members={runningMembers} executionCount={executionCount} expanded={executionExpanded} panelId={panelId}
        onSelect={(tab, trigger) => { triggerRef.current = trigger; if (visible && activeTab === tab) onClose(); else onOpen(tab) }} />
    </div>
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button className="mobile-icon-button mobile-camp-more" type="button" data-secondary={secondary} aria-label={uiAttribute("会话更多操作")}>
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="mobile-camp-menu" align="end" sideOffset={4} collisionPadding={12}
          onCloseAutoFocus={event => { if (menuSelected.current) event.preventDefault(); menuSelected.current = false }}>
          {(['tasks', 'members'] as const).map(tab => <DropdownMenu.Item key={tab} onSelect={() => {
            menuSelected.current = true
            triggerRef.current = entryHost?.querySelector<HTMLButtonElement>('.mobile-camp-more') ?? null
            focusPanelRef.current = true
            onOpen(tab)
          }}><ThreadDetailIcon tab={tab} /><span>{copy[tab]}</span></DropdownMenu.Item>)}
          <DropdownMenu.Item onSelect={() => { menuSelected.current = true; onOpenSingleChat() }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6A8.4 8.4 0 0 1 12.5 3h.5a8.5 8.5 0 0 1 8 8v.5Z" /></svg>
            <span>{copy.singleChatTitle}</span>
          </DropdownMenu.Item>
          {onOpenMissionActivity && <DropdownMenu.Item onSelect={() => { menuSelected.current = true; onOpenMissionActivity() }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 11a9 9 0 1 1 2.6 7M3 4v7h7M12 7v5l3 2" /></svg><span><UiText zh={"活动"} /></span>
          </DropdownMenu.Item>}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  </> : <ThreadDetailEntries
    activeTab={activeTab}
    visible={visible}
    panelId={panelId}
    showExecution={showExecution}
    executionExpanded={executionExpanded}
    runningMembers={runningMembers}
    executionCount={executionCount}
    taskCount={taskCount}
    memberCount={memberCount}
    onSelect={(tab, trigger, keyboard) => {
      triggerRef.current = trigger
      if (visible && activeTab === tab) {
        onClose()
        return
      }
      focusPanelRef.current = keyboard
      onOpen(tab)
    }}
  />

  return <>
    {entryHost
      ? createPortal(entries, entryHost)
      : <div className="camp-detail-entry-fallback">{entries}</div>}
    <aside
      ref={panelRef}
      id={panelId}
      className="camp-detail-popover"
      data-detail={activeTab}
      role={mobile && activeTab !== 'members' ? 'region' : 'dialog'}
      aria-modal={mobile && activeTab !== 'members' ? undefined : false}
      aria-labelledby={`${panelId}-title`}
      tabIndex={-1}
      hidden={!visible}
      onDragEnter={(event) => event.stopPropagation()}
      onDragOver={(event) => {
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = 'none'
      }}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <header className="camp-detail-heading">
        <ThreadDetailIcon tab={activeTab} />
        <strong id={`${panelId}-title`}>{copy[activeTab]}</strong>
        {mobile && activeTab === 'execution' && onToggleMobileExecutionMaximized && <button
          className="mobile-execution-expand"
          type="button"
          aria-label={mobileExecutionMaximized ? uiAttribute("还原执行面板") : uiAttribute("展开执行面板")}
          aria-pressed={mobileExecutionMaximized}
          onClick={onToggleMobileExecutionMaximized}
        ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={mobileExecutionMaximized
          ? 'M4 9h5V4m6 0v5h5M4 15h5v5m6 0v-5h5'
          : 'M9 4H4v5m11-5h5v5M4 15v5h5m6 0h5v-5'} /></svg></button>}
        <button
          className="camp-detail-collapse"
          type="button"
          aria-label={uiAttribute("收起会话详情")}
          title={uiAttribute("收起 · Esc")}
          onClick={() => {
            onClose()
            triggerRef.current?.focus({ preventScroll: true })
          }}
        >
          {!mobile && <span><UiText zh={"收起"} /></span>}
          <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d={mobile ? 'm4 4 8 8m0-8-8 8' : 'm4 10 4-4 4 4'} /></svg>
        </button>
      </header>
      {children}
      <footer className="camp-detail-footer">
        <span className="camp-detail-dismiss-hint"><kbd>Esc</kbd><UiText zh={" 收起"} /></span>
      </footer>
    </aside>
  </>
}
