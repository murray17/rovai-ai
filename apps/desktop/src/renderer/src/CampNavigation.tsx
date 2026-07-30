import { useEffect, useMemo, useRef, useState, type FormEvent, type JSX } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type {
  AgentProfile,
  NavigationCampItem,
  NavigationCampPage,
  NavigationSnapshot,
  ProjectNavigationGroup
} from '@contracts'
import {
  allNavigationCamps,
  RAIL_COLLAPSED_WIDTH,
  RAIL_EXPANDED_WIDTH,
  railExpandedFromWidth
} from './ui-model'
import { formatMentionDisplayText } from './AgentMentionTextarea'

export interface CampDeleteAttempt {
  deleted: boolean
  blockers: Array<{ code: string; count: number }>
}

type CampAction = {
  kind: 'rename' | 'delete'
  camp: NavigationCampItem
} | null

export function CampNavigation({
  view,
  state,
  navigation,
  agents,
  activeCampId,
  sidebarHidden = false,
  railWidth = RAIL_COLLAPSED_WIDTH,
  onRailWidthLive = () => undefined,
  onRailWidthCommit = () => undefined,
  onNewConversation,
  onMembers,
  onMemory,
  pendingMemoryCount,
  onSettings,
  onOpenProject,
  onCamp,
  onRename,
  onDelete,
  onStop,
  onError
}: {
  view: 'compose' | 'camp' | 'members' | 'memory' | 'settings'
  state: 'loading' | 'ready' | 'error'
  navigation: NavigationSnapshot | null
  agents: Pick<AgentProfile, 'handle' | 'displayName'>[]
  activeCampId: string | null
  sidebarHidden?: boolean
  railWidth?: number
  onRailWidthLive?(width: number): void
  onRailWidthCommit?(width: number): void
  onNewConversation(): void
  onMembers(): void
  onMemory(): void
  pendingMemoryCount: number
  onSettings(): void
  onOpenProject(): void
  onCamp(camp: NavigationCampItem): void
  onRename(camp: NavigationCampItem, title: string): Promise<void>
  onDelete(camp: NavigationCampItem): Promise<CampDeleteAttempt>
  onStop(camp: NavigationCampItem): Promise<void>
  onError(error: unknown): void
}): JSX.Element {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const [expandedAllGroups, setExpandedAllGroups] = useState<Set<string>>(() => new Set())
  const [allCampsByGroup, setAllCampsByGroup] = useState<Record<string, NavigationCampItem[]>>({})
  const [loadingGroup, setLoadingGroup] = useState<string | null>(null)
  const [action, setAction] = useState<CampAction>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [deleteBlockers, setDeleteBlockers] = useState<Array<{ code: string; count: number }>>([])
  const [actionBusy, setActionBusy] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const expandedAllGroupsRef = useRef(expandedAllGroups)

  useEffect(() => {
    expandedAllGroupsRef.current = expandedAllGroups
  }, [expandedAllGroups])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const loadAllGroup = async (groupKey: string, projectPath: string | null): Promise<void> => {
    setLoadingGroup(groupKey)
    try {
      const camps: NavigationCampItem[] = []
      let offset = 0
      for (;;) {
        const page = await window.rovai.request<NavigationCampPage>('navigation.groupCamps', {
          projectPath,
          offset,
          limit: 200
        })
        if (page.schemaVersion !== 2) throw new Error('Navigation group schema is incompatible')
        camps.push(...page.camps)
        if (page.nextOffset === null) break
        offset = page.nextOffset
      }
      if (expandedAllGroupsRef.current.has(groupKey)) {
        setAllCampsByGroup((current) => ({ ...current, [groupKey]: camps }))
      }
    } catch (error) {
      onError(error)
    } finally {
      setLoadingGroup((current) => current === groupKey ? null : current)
    }
  }

  useEffect(() => {
    if (!navigation) return
    for (const groupKey of expandedAllGroups) {
      const projectPath = groupKey === 'lobby'
        ? null
        : navigation.projects.find((project) => projectKey(project) === groupKey)?.projectPath
      if (groupKey !== 'lobby' && !projectPath) continue
      void loadAllGroup(groupKey, projectPath ?? null)
    }
    // Refresh expanded groups when the authoritative navigation sequence changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation?.throughGlobalSequence])

  const toggleGroup = (groupKey: string): void => {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (next.has(groupKey)) next.delete(groupKey)
      else next.add(groupKey)
      return next
    })
  }

  const toggleAll = (groupKey: string, projectPath: string | null): void => {
    if (expandedAllGroups.has(groupKey)) {
      setExpandedAllGroups((current) => {
        const next = new Set(current)
        next.delete(groupKey)
        return next
      })
      return
    }
    setExpandedAllGroups((current) => new Set(current).add(groupKey))
    expandedAllGroupsRef.current = new Set(expandedAllGroupsRef.current).add(groupKey)
    void loadAllGroup(groupKey, projectPath)
  }

  const openAction = (kind: 'rename' | 'delete', camp: NavigationCampItem): void => {
    setAction({ kind, camp })
    setRenameTitle(formatMentionDisplayText(camp.title, agents))
    setDeleteBlockers([])
  }

  const closeAction = (): void => {
    if (actionBusy) return
    setAction(null)
    setDeleteBlockers([])
  }

  const submitRename = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!action || action.kind !== 'rename' || !renameTitle.trim() || actionBusy) return
    setActionBusy(true)
    try {
      await onRename(action.camp, renameTitle)
      setAction(null)
    } catch (error) {
      onError(error)
    } finally {
      setActionBusy(false)
    }
  }

  const confirmDelete = async (): Promise<void> => {
    if (!action || action.kind !== 'delete' || actionBusy) return
    setActionBusy(true)
    try {
      const result = await onDelete(action.camp)
      if (result.deleted) {
        setAction(null)
        setDeleteBlockers([])
      } else {
        setDeleteBlockers(result.blockers)
      }
    } catch (error) {
      onError(error)
    } finally {
      setActionBusy(false)
    }
  }

  const stopBlockingRuns = async (): Promise<void> => {
    if (!action || action.kind !== 'delete' || actionBusy) return
    setActionBusy(true)
    try {
      await onStop(action.camp)
      onCamp(action.camp)
      setAction(null)
      setDeleteBlockers([])
    } catch (error) {
      onError(error)
    } finally {
      setActionBusy(false)
    }
  }

  const railExpanded = railExpandedFromWidth(railWidth)

  const toggleRail = (): void => {
    onRailWidthCommit(railExpanded ? RAIL_COLLAPSED_WIDTH : RAIL_EXPANDED_WIDTH)
  }

  const beginRailResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = railWidth
    const widthAt = (clientX: number): number =>
      Math.min(RAIL_EXPANDED_WIDTH, Math.max(RAIL_COLLAPSED_WIDTH, startWidth + (clientX - startX)))
    const onMove = (moveEvent: PointerEvent): void => onRailWidthLive(widthAt(moveEvent.clientX))
    const onUp = (upEvent: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      onRailWidthCommit(widthAt(upEvent.clientX))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <>
      <nav className={`icon-rail ${railExpanded ? 'expanded' : ''}`} aria-label="全局导航">
        <div className="rail-drag" aria-hidden="true" />
        <span className="rail-logo" role="img" aria-label="Rovai-ai">
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1 L14.2 9.8 L23 12 L14.2 14.2 L12 23 L9.8 14.2 L1 12 L9.8 9.8 Z" fill="currentColor" /></svg>
          <span className="rail-label rail-logo-name">Rovai-ai</span>
        </span>
        <button className={`rail-button ${view === 'compose' ? 'active' : ''}`} type="button" aria-label="新对话" title="新对话" onClick={onNewConversation} disabled={state !== 'ready'}>
          <span className="rail-glyph" aria-hidden="true">＋</span><span className="rail-label">新对话</span>
        </button>
        <button className={`rail-button ${view === 'members' ? 'active' : ''}`} type="button" aria-current={view === 'members' ? 'page' : undefined} aria-label="成员" title="成员" onClick={onMembers}>
          <span className="rail-glyph" aria-hidden="true">◎</span><span className="rail-label">成员</span>
        </button>
        <button
          className={`rail-button ${view === 'memory' ? 'active' : ''}`}
          type="button"
          aria-current={view === 'memory' ? 'page' : undefined}
          aria-label={pendingMemoryCount > 0 ? `长期记忆，${pendingMemoryCount} 条普通提案待确认` : '长期记忆'}
          title={pendingMemoryCount > 0 ? `长期记忆 · ${pendingMemoryCount} 条普通提案待确认` : '长期记忆'}
          onClick={onMemory}
        >
          <span className="rail-glyph" aria-hidden="true">◈</span><span className="rail-label">长期记忆</span>
          {pendingMemoryCount > 0 && <i className="rail-badge-dot" aria-hidden="true" />}
        </button>
        <span className="rail-spacer" aria-hidden="true" />
        <button
          className={`rail-button ${view === 'settings' ? 'active' : ''}`}
          type="button"
          aria-current={view === 'settings' ? 'page' : undefined}
          aria-label="设置"
          title="设置"
          onClick={onSettings}
        >
          <span className="rail-glyph" aria-hidden="true">⚙</span><span className="rail-label">设置</span>
        </button>
        <div
          className="rail-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整导航宽度"
          title="拖拽或双击调整导航宽度"
          tabIndex={0}
          onPointerDown={beginRailResize}
          onDoubleClick={toggleRail}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              toggleRail()
            } else if (event.key === 'ArrowRight') {
              event.preventDefault()
              onRailWidthCommit(RAIL_EXPANDED_WIDTH)
            } else if (event.key === 'ArrowLeft') {
              event.preventDefault()
              onRailWidthCommit(RAIL_COLLAPSED_WIDTH)
            }
          }}
        />
      </nav>

      {!sidebarHidden && (
      <aside className="sidebar camp-navigation">
      <div className="sidebar-drag" aria-hidden="true" />
      <button className="conversation-jump" type="button" onClick={() => setPaletteOpen(true)}>
        <span>跳转到对话…</span><kbd aria-hidden="true">⌘K</kbd>
      </button>

      <div className="navigation-scroll">
        <CampGroup
          groupKey="lobby"
          label="大厅"
          totalCount={navigation?.lobby.totalCount ?? 0}
          camps={expandedAllGroups.has('lobby') ? allCampsByGroup.lobby ?? navigation?.lobby.recentCamps ?? [] : navigation?.lobby.recentCamps ?? []}
          collapsed={collapsedGroups.has('lobby')}
          expandedAll={expandedAllGroups.has('lobby')}
          loadingAll={loadingGroup === 'lobby'}
          activeCampId={activeCampId}
          agents={agents}
          onToggle={() => toggleGroup('lobby')}
          onToggleAll={() => toggleAll('lobby', null)}
          onCamp={onCamp}
          onAction={openAction}
        />

        <section className="navigation-projects" aria-labelledby="projects-heading">
          <div className="sidebar-group-title navigation-section-title"><span id="projects-heading">项目</span><button aria-label="选择工作目录" title="选择工作目录" onClick={onOpenProject}>＋</button></div>
          {navigation?.projects.map((project) => {
            const groupKey = projectKey(project)
            return (
              <CampGroup
                key={project.projectKey}
                groupKey={groupKey}
                label={project.name}
                totalCount={project.totalCount}
                camps={expandedAllGroups.has(groupKey) ? allCampsByGroup[groupKey] ?? project.recentCamps : project.recentCamps}
                collapsed={collapsedGroups.has(groupKey)}
                expandedAll={expandedAllGroups.has(groupKey)}
                loadingAll={loadingGroup === groupKey}
                activeCampId={activeCampId}
                agents={agents}
                onToggle={() => toggleGroup(groupKey)}
                onToggleAll={() => toggleAll(groupKey, project.projectPath)}
                onCamp={onCamp}
                onAction={openAction}
              />
            )
          })}
          {navigation && navigation.projects.length === 0 && <p className="sidebar-empty">选择工作目录后，对话会在这里成组显示。</p>}
        </section>
      </div>

      </aside>
      )}

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        navigation={navigation}
        agents={agents}
        onCamp={(camp) => {
          setPaletteOpen(false)
          onCamp(camp)
        }}
      />

      <Dialog.Root open={action !== null} onOpenChange={(open) => { if (!open) closeAction() }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content camp-action-dialog">
            {action?.kind === 'rename' ? (
              <form onSubmit={(event) => void submitRename(event)}>
                <Dialog.Title>重命名对话</Dialog.Title>
                <Dialog.Description>只修改侧栏标题，不改变 Camp 的项目归属、成员或活动顺序。</Dialog.Description>
                <label className="field-label" htmlFor="rename-camp-title">标题<input id="rename-camp-title" autoFocus value={renameTitle} onChange={(event) => setRenameTitle(event.target.value)} disabled={actionBusy} /></label>
                <div className="dialog-actions"><Dialog.Close asChild><button className="quiet-button" type="button" disabled={actionBusy}>取消</button></Dialog.Close><button className="primary-button" type="submit" disabled={!renameTitle.trim() || actionBusy}>{actionBusy ? '保存中…' : '保存'}</button></div>
              </form>
            ) : action?.kind === 'delete' ? (
              <div>
                <Dialog.Title>永久删除“{formatMentionDisplayText(action.camp.title, agents)}”？</Dialog.Title>
                <Dialog.Description>这会删除 Camp 的公共讨论、成员连续性、运行记录和关联数据。此操作不能撤销，也不会删除本地 Repository。</Dialog.Description>
                {deleteBlockers.length > 0 && (
                  <div className="delete-blockers" role="alert">
                    <strong>当前还不能删除</strong>
                    <p>请先打开该对话，停止运行并处理未决审批或动作，然后重试。</p>
                    <ul>{deleteBlockers.map((blocker) => <li key={blocker.code}>{deleteBlockerLabel(blocker.code)}（{blocker.count}）</li>)}</ul>
                  </div>
                )}
                <div className="dialog-actions"><Dialog.Close asChild><button className="quiet-button" type="button" disabled={actionBusy}>取消</button></Dialog.Close>{deleteBlockers.some((blocker) => blocker.code === 'nonterminal_agent_run' || blocker.code === 'nonterminal_camp_turn') && <button className="quiet-button" type="button" onClick={() => void stopBlockingRuns()} disabled={actionBusy}>{actionBusy ? '正在请求停止…' : '停止运行'}</button>}{deleteBlockers.length > 0 && <button className="quiet-button" type="button" onClick={() => { onCamp(action.camp); setAction(null) }}>打开对话</button>}<button className="danger-button" type="button" onClick={() => void confirmDelete()} disabled={actionBusy}>{actionBusy ? '检查中…' : deleteBlockers.length > 0 ? '重新检查并删除' : '永久删除'}</button></div>
              </div>
            ) : null}
            <Dialog.Close asChild><button className="dialog-close" aria-label="关闭" disabled={actionBusy}>×</button></Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}

function CommandPalette({
  open,
  onOpenChange,
  navigation,
  agents,
  onCamp
}: {
  open: boolean
  onOpenChange(open: boolean): void
  navigation: NavigationSnapshot | null
  agents: Pick<AgentProfile, 'handle' | 'displayName'>[]
  onCamp(camp: NavigationCampItem): void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const projectNameByPath = useMemo(
    () => new Map((navigation?.projects ?? []).map((project) => [project.projectPath, project.name])),
    [navigation]
  )
  const camps = useMemo(() => navigation ? allNavigationCamps(navigation) : [], [navigation])
  const trimmedQuery = query.trim().toLowerCase()
  const visible = (trimmedQuery
    ? camps.filter((camp) => {
        const projectName = camp.projectBindingKind === 'directory'
          ? projectNameByPath.get(camp.projectPath) ?? ''
          : '大厅'
        return formatMentionDisplayText(camp.title, agents).toLowerCase().includes(trimmedQuery)
          || projectName.toLowerCase().includes(trimmedQuery)
      })
    : camps
  ).slice(0, 12)

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
    }
  }, [open])

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="command-palette">
          <Dialog.Title className="sr-only">跳转到对话</Dialog.Title>
          <Dialog.Description className="sr-only">输入关键字过滤对话，回车打开第一个匹配。</Dialog.Description>
          <input
            className="command-palette-input"
            autoFocus
            value={query}
            placeholder="搜索对话或项目…"
            aria-label="搜索对话"
            onChange={(event) => {
              setQuery(event.target.value)
              setActiveIndex(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveIndex((index) => Math.min(index + 1, Math.max(visible.length - 1, 0)))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveIndex((index) => Math.max(index - 1, 0))
              } else if (event.key === 'Enter' && visible[activeIndex]) {
                event.preventDefault()
                onCamp(visible[activeIndex])
              }
            }}
          />
          <div className="command-palette-list" aria-label="匹配的对话">
            {visible.map((camp, index) => (
              <button
                className={`command-palette-item ${index === activeIndex ? 'active' : ''}`}
                type="button"
                key={camp.id}
                onClick={() => onCamp(camp)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span className="truncate">{formatMentionDisplayText(camp.title, agents)}</span>
                <small>{camp.projectBindingKind === 'directory' ? projectNameByPath.get(camp.projectPath) ?? '项目' : '大厅'}</small>
              </button>
            ))}
            {visible.length === 0 && <p className="command-palette-empty">没有匹配的对话。</p>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function CampGroup({
  groupKey,
  label,
  totalCount,
  camps,
  collapsed,
  expandedAll,
  loadingAll,
  activeCampId,
  agents,
  onToggle,
  onToggleAll,
  onCamp,
  onAction
}: {
  groupKey: string
  label: string
  totalCount: number
  camps: NavigationCampItem[]
  collapsed: boolean
  expandedAll: boolean
  loadingAll: boolean
  activeCampId: string | null
  agents: Pick<AgentProfile, 'handle' | 'displayName'>[]
  onToggle(): void
  onToggleAll(): void
  onCamp(camp: NavigationCampItem): void
  onAction(kind: 'rename' | 'delete', camp: NavigationCampItem): void
}): JSX.Element {
  return (
    <section className="camp-nav-group" data-group={groupKey}>
      <button className="camp-group-toggle" type="button" aria-expanded={!collapsed} onClick={onToggle} title={label}>
        <svg aria-hidden="true" className="disclosure" viewBox="0 0 12 12">
          <path d={collapsed ? 'M4 2.5 7.5 6 4 9.5' : 'M2.5 4 6 7.5 9.5 4'} />
        </svg>
        <span className="truncate">{label}</span>
        {totalCount > 0 && <small className="camp-group-count">{totalCount}</small>}
      </button>
      {!collapsed && (
        <div className="camp-group-children">
          {camps.map((camp) => (
            <div className={`camp-nav-row ${camp.id === activeCampId ? 'selected' : ''}`} key={camp.id}>
              <button className="camp-nav-open" type="button" aria-current={camp.id === activeCampId ? 'page' : undefined} title={formatMentionDisplayText(camp.title, agents)} onClick={() => onCamp(camp)}>
                <i aria-hidden="true" className={`task-dot camp-marker-${camp.marker}`} /><span className="truncate">{formatMentionDisplayText(camp.title, agents)}</span>
              </button>
              <details className="camp-row-menu">
                <summary aria-label={`管理“${formatMentionDisplayText(camp.title, agents)}”`} title="更多操作">•••</summary>
                <div className="camp-row-menu-popup" role="menu">
                  <button type="button" role="menuitem" onClick={(event) => { closeParentDetails(event.currentTarget); onAction('rename', camp) }}>重命名</button>
                  <button type="button" role="menuitem" className="danger-menu-item" onClick={(event) => { closeParentDetails(event.currentTarget); onAction('delete', camp) }}>删除</button>
                </div>
              </details>
            </div>
          ))}
          {camps.length === 0 && <p className="sidebar-empty">还没有对话</p>}
          {totalCount > 5 && <button className="show-all-camps" type="button" onClick={onToggleAll} disabled={loadingAll}>{loadingAll ? '正在读取…' : expandedAll ? '收起' : `查看全部 ${totalCount} 个`}</button>}
        </div>
      )}
    </section>
  )
}

function projectKey(project: ProjectNavigationGroup): string {
  return project.projectKey
}

function closeParentDetails(element: HTMLElement): void {
  element.closest('details')?.removeAttribute('open')
}

function deleteBlockerLabel(code: string): string {
  return ({
    nonterminal_agent_run: '仍有 Agent 正在执行或等待',
    nonterminal_camp_turn: '仍有 CampTurn 未结束',
    pending_approval: '仍有待处理审批',
    unsettled_action: '仍有未收敛动作',
    pending_inbox_delivery: '仍有 Inbox 消息待投递',
    pending_runtime_delivery: '仍有执行引擎结果待确认',
    active_worker_lease: '仍有执行器持有租约',
    unfinished_membership_change: '仍有成员变更未完成',
    unfinished_task_cancellation: '仍有 Task 取消未完成'
  } as Record<string, string>)[code] ?? code
}
