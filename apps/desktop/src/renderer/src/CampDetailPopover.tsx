import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type CampDetailTab = 'execution' | 'tasks' | 'members'

const labels: Record<CampDetailTab, string> = {
  execution: '执行',
  tasks: '任务',
  members: '队员'
}

const footnotes: Record<CampDetailTab, string> = {
  execution: '连续执行历史',
  tasks: '任务取消不等于执行停止',
  members: '仅管理当前会话队员'
}

function CampDetailIcon({ tab }: { tab: CampDetailTab }): React.JSX.Element {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
    {tab === 'execution' && <path d="M3 12h4l3-8 4 16 3-8h4" />}
    {tab === 'tasks' && <><rect x="6" y="4" width="15" height="17" rx="2" /><path d="M3 7h5M3 12h5M3 17h5M12 8h5M12 12h5M12 16h3" /></>}
    {tab === 'members' && <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /><circle cx="9" cy="7" r="4" /></>}
  </svg>
}

export function CampDetailEntries({
  activeTab,
  visible,
  panelId,
  executionCount,
  runningCount,
  taskCount,
  memberCount,
  onSelect
}: {
  activeTab: CampDetailTab
  visible: boolean
  panelId: string
  executionCount: number | null
  runningCount: number
  taskCount: number
  memberCount: number
  onSelect(tab: CampDetailTab, trigger: HTMLButtonElement, keyboard: boolean): void
}): React.JSX.Element {
  const entries: Array<{ tab: CampDetailTab; count: number }> = [
    ...(executionCount === null ? [] : [{ tab: 'execution' as const, count: executionCount }]),
    { tab: 'tasks', count: taskCount },
    { tab: 'members', count: memberCount }
  ]
  return (
    <div className="camp-detail-entries" role="group" aria-label="当前会话详情入口">
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
          {tab === 'execution' && runningCount > 0
            ? <span className="camp-loading-spinner" role="img" aria-label={`${runningCount} 位队员正在执行`} />
            : <CampDetailIcon tab={tab} />}
          <span>{labels[tab]}</span>
          <small>{count}</small>
        </button>
      ))}
    </div>
  )
}

export function CampDetailPopover({
  entryHost,
  activeTab,
  visible,
  executionCount,
  runningCount,
  taskCount,
  memberCount,
  onOpen,
  onClose,
  children
}: {
  entryHost?: HTMLElement | null
  activeTab: CampDetailTab
  visible: boolean
  executionCount: number | null
  runningCount: number
  taskCount: number
  memberCount: number
  onOpen(tab: CampDetailTab): void
  onClose(): void
  children: ReactNode
}): React.JSX.Element {
  const panelId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const focusPanelRef = useRef(false)

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
      // Execution details and tool results keep their existing Escape hierarchy.
      if (event.target instanceof Element && event.target.closest('.execution-drawer')) return
      event.preventDefault()
      onClose()
      triggerRef.current?.focus({ preventScroll: true })
    }
    document.addEventListener('keydown', dismissOnEscape)
    return () => {
      document.removeEventListener('keydown', dismissOnEscape)
    }
  }, [visible, onClose])

  const entries = <CampDetailEntries
    activeTab={activeTab}
    visible={visible}
    panelId={panelId}
    executionCount={executionCount}
    runningCount={runningCount}
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
      role="dialog"
      aria-modal={false}
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
        <CampDetailIcon tab={activeTab} />
        <strong id={`${panelId}-title`}>{labels[activeTab]}</strong>
        <span className="camp-detail-scope">当前会话</span>
        <button
          className="icon-button"
          type="button"
          aria-label="收起会话详情"
          title="收起 · Esc"
          onClick={() => {
            onClose()
            triggerRef.current?.focus({ preventScroll: true })
          }}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="m4 4 8 8M12 4l-8 8" /></svg>
        </button>
      </header>
      {children}
      <footer className="camp-detail-footer">
        <span>{footnotes[activeTab]}</span>
        <span className="camp-detail-dismiss-hint"><kbd>Esc</kbd> 收起</span>
      </footer>
    </aside>
  </>
}
