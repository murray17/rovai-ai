import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type {
  NavigationCampItem,
  NavigationCampPage,
  NavigationSnapshot,
  ProjectNavigationGroup
} from '@contracts'

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
  activeCampId,
  onNewConversation,
  onMembers,
  onSettings,
  onOpenProject,
  onCamp,
  onRename,
  onDelete,
  onStop,
  onError
}: {
  view: 'home' | 'compose' | 'camp' | 'members' | 'settings'
  state: 'loading' | 'ready' | 'error'
  navigation: NavigationSnapshot | null
  activeCampId: string | null
  onNewConversation(): void
  onMembers(): void
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
  const expandedAllGroupsRef = useRef(expandedAllGroups)

  useEffect(() => {
    expandedAllGroupsRef.current = expandedAllGroups
  }, [expandedAllGroups])

  const loadAllGroup = async (groupKey: string, repositoryScopeId: string | null): Promise<void> => {
    setLoadingGroup(groupKey)
    try {
      const camps: NavigationCampItem[] = []
      let offset = 0
      for (;;) {
        const page = await window.lumen.request<NavigationCampPage>('navigation.groupCamps', {
          repositoryScopeId,
          offset,
          limit: 200
        })
        if (page.schemaVersion !== 1) throw new Error('Navigation group schema is incompatible')
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
      const repositoryScopeId = groupKey === 'lobby'
        ? null
        : navigation.projects.find((project) => projectKey(project) === groupKey)?.repositoryScopeId
      if (groupKey !== 'lobby' && !repositoryScopeId) continue
      void loadAllGroup(groupKey, repositoryScopeId ?? null)
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

  const toggleAll = (groupKey: string, repositoryScopeId: string | null): void => {
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
    void loadAllGroup(groupKey, repositoryScopeId)
  }

  const openAction = (kind: 'rename' | 'delete', camp: NavigationCampItem): void => {
    setAction({ kind, camp })
    setRenameTitle(camp.title)
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

  return (
    <aside className="sidebar camp-navigation">
      <div className="sidebar-brand" aria-label="Lumen AI"><span className="brand-mark small" aria-hidden="true"><span /></span><strong>Lumen</strong></div>

      <nav className="sidebar-primary-actions" aria-label="全局导航">
        <button className={`nav-item ${view === 'compose' ? 'active' : ''}`} onClick={onNewConversation} disabled={state !== 'ready'}><span aria-hidden="true">＋</span>新对话</button>
        <button aria-current={view === 'members' ? 'page' : undefined} className={`nav-item ${view === 'members' ? 'active' : ''}`} onClick={onMembers}><span aria-hidden="true">◎</span>成员</button>
      </nav>

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
          onToggle={() => toggleGroup('lobby')}
          onToggleAll={() => toggleAll('lobby', null)}
          onCamp={onCamp}
          onAction={openAction}
        />

        <section className="navigation-projects" aria-labelledby="projects-heading">
          <div className="sidebar-group-title navigation-section-title"><span id="projects-heading">项目</span><button aria-label="打开本地 Git 项目" title="打开本地 Git 项目" onClick={onOpenProject}>＋</button></div>
          {navigation?.projects.map((project) => {
            const groupKey = projectKey(project)
            return (
              <CampGroup
                key={project.repositoryScopeId}
                groupKey={groupKey}
                label={project.name}
                totalCount={project.totalCount}
                camps={expandedAllGroups.has(groupKey) ? allCampsByGroup[groupKey] ?? project.recentCamps : project.recentCamps}
                collapsed={collapsedGroups.has(groupKey)}
                expandedAll={expandedAllGroups.has(groupKey)}
                loadingAll={loadingGroup === groupKey}
                activeCampId={activeCampId}
                onToggle={() => toggleGroup(groupKey)}
                onToggleAll={() => toggleAll(groupKey, project.repositoryScopeId)}
                onCamp={onCamp}
                onAction={openAction}
              />
            )
          })}
          {navigation && navigation.projects.length === 0 && <p className="sidebar-empty">打开项目后，对话会在这里成组显示。</p>}
        </section>
      </div>

      <div className="sidebar-bottom">
        <button aria-current={view === 'settings' ? 'page' : undefined} className={`nav-item settings-entry ${view === 'settings' ? 'active' : ''}`} onClick={onSettings}>
          <span aria-hidden="true">⚙</span><span className="settings-label">设置</span>{state === 'error' && <i className="core-error-dot" aria-label="Core 不可用" title="Core 不可用" />}
        </button>
      </div>

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
                <Dialog.Title>永久删除“{action.camp.title}”？</Dialog.Title>
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
    </aside>
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
      </button>
      {!collapsed && (
        <div className="camp-group-children">
          {camps.map((camp) => (
            <div className={`camp-nav-row ${camp.id === activeCampId ? 'selected' : ''}`} key={camp.id}>
              <button className="camp-nav-open" type="button" aria-current={camp.id === activeCampId ? 'page' : undefined} title={camp.title} onClick={() => onCamp(camp)}>
                <i aria-hidden="true" className={`task-dot camp-marker-${camp.marker}`} /><span className="truncate">{camp.title}</span>
              </button>
              <details className="camp-row-menu">
                <summary aria-label={`管理“${camp.title}”`} title="更多操作">•••</summary>
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
  return `project:${project.repositoryScopeId}`
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
    pending_runtime_delivery: '仍有 Runtime 结果待确认',
    active_worker_lease: '仍有执行器持有租约',
    unfinished_membership_change: '仍有成员变更未完成',
    unfinished_task_cancellation: '仍有 Task 取消未完成'
  } as Record<string, string>)[code] ?? code
}
