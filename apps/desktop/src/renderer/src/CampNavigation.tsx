import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type JSX,
  type ReactNode,
  type RefObject
} from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type {
  AgentProfile,
  NavigationPin,
  NavigationCampItem,
  NavigationCampPage,
  NavigationSnapshot,
  ProjectNavigationGroup
} from '@contracts'
import { allNavigationCamps } from './ui-model'
import { formatMentionDisplayText } from './AgentMentionTextarea'

export interface CampDeleteAttempt {
  deleted: boolean
  blockers: Array<{ code: string; count: number }>
}

export type NavigationSettingsSection =
  | 'skills'
  | 'mcp'
  | 'runtime'
  | 'appearance'
  | 'notifications'
  | 'diagnostics'

type CampAction = {
  kind: 'rename' | 'delete'
  camp: NavigationCampItem
} | null

export function campNavigationMenuLabels(pinned: boolean): string[] {
  return [pinned ? '取消置顶' : '置顶', '重命名', '删除']
}

export function projectNavigationMenuLabels(pinned: boolean): string[] {
  return [pinned ? '取消置顶项目' : '置顶项目']
}

export function toggleNavigationGroup(groups: ReadonlySet<string>, groupKey: string): Set<string> {
  const next = new Set(groups)
  if (next.has(groupKey)) next.delete(groupKey)
  else next.add(groupKey)
  return next
}

export function CampNavigation({
  view,
  state,
  navigation,
  agents,
  activeCampId,
  pins = [],
  pinnedCampItems = [],
  settingsSection = 'skills',
  onNewConversation,
  onMembers,
  onMemory,
  pendingMemoryCount,
  notificationUnreadCount = 0,
  notificationButtonRef,
  onNotifications = () => undefined,
  memberSidebar = null,
  onSettings,
  onSettingsSectionChange = () => undefined,
  onSettingsBack = () => undefined,
  onOpenProject,
  onCamp,
  onTogglePin = () => undefined,
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
  pins?: NavigationPin[]
  pinnedCampItems?: NavigationCampItem[]
  settingsSection?: NavigationSettingsSection
  onNewConversation(): void
  onMembers(): void
  onMemory(): void
  pendingMemoryCount: number
  notificationUnreadCount?: number
  notificationButtonRef?: RefObject<HTMLButtonElement | null>
  onNotifications?(): void
  memberSidebar?: ReactNode
  onSettings(): void
  onSettingsSectionChange?(section: NavigationSettingsSection): void
  onSettingsBack?(): void
  onOpenProject(): void
  onCamp(camp: NavigationCampItem): void
  onTogglePin?(kind: NavigationPin['kind'], targetKey: string, camp?: NavigationCampItem): void | Promise<void>
  onRename(camp: NavigationCampItem, title: string): Promise<void>
  onDelete(camp: NavigationCampItem): Promise<CampDeleteAttempt>
  onStop(camp: NavigationCampItem): Promise<void>
  onError(error: unknown): void
}): JSX.Element {
  const [expandedAllGroups, setExpandedAllGroups] = useState<Set<string>>(() => new Set())
  // Project visibility is independent from the "show all" pagination state below.
  // An empty collapsed set keeps the existing default of showing recent Camps.
  const [collapsedProjectGroups, setCollapsedProjectGroups] = useState<Set<string>>(() => new Set())
  const [allCampsByGroup, setAllCampsByGroup] = useState<Record<string, NavigationCampItem[]>>({})
  const [loadingGroup, setLoadingGroup] = useState<string | null>(null)
  const [action, setAction] = useState<CampAction>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [deleteBlockers, setDeleteBlockers] = useState<Array<{ code: string; count: number }>>([])
  const [actionBusy, setActionBusy] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [sidebarFocusRequest, setSidebarFocusRequest] = useState<{ id: number; target: string } | null>(null)
  const expandedAllGroupsRef = useRef(expandedAllGroups)
  const sidebarRef = useRef<HTMLElement>(null)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  const previousViewRef = useRef(view)
  const dialogReturnFocusTargetRef = useRef<string | null>(null)
  const nextSidebarFocusRequestIdRef = useRef(1)
  const navigationCamps = useMemo(
    () => navigation ? allNavigationCamps(navigation) : [],
    [navigation]
  )
  const campById = useMemo(() => new Map(
    [...navigationCamps, ...pinnedCampItems].map((camp) => [camp.id, camp])
  ), [navigationCamps, pinnedCampItems])
  const projectByKey = useMemo(
    () => new Map((navigation?.projects ?? []).map((project) => [project.projectKey, project])),
    [navigation]
  )
  const pinnedCampIds = useMemo(
    () => new Set(pins.filter((pin) => pin.kind === 'camp').map((pin) => pin.targetKey)),
    [pins]
  )
  const pinnedCamps = pins
    .filter((pin) => pin.kind === 'camp')
    .flatMap((pin) => campById.get(pin.targetKey) ?? [])
  const pinnedProjects = pins
    .filter((pin) => pin.kind === 'project')
    .flatMap((pin) => projectByKey.get(pin.targetKey) ?? [])

  useEffect(() => {
    expandedAllGroupsRef.current = expandedAllGroups
  }, [expandedAllGroups])

  useLayoutEffect(() => {
    if (previousViewRef.current === 'settings' && view !== 'settings') {
      // The settings entry is remounted when the ordinary navigation returns.
      // Restore focus after that render so keyboard users return to their entry point.
      settingsButtonRef.current?.focus()
    }
    previousViewRef.current = view
  }, [view])

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
      const projectPath = groupKey === 'quick-chat'
        ? null
        : navigation.projects.find((project) => projectKey(project) === groupKey)?.projectPath
      if (groupKey !== 'quick-chat' && !projectPath) continue
      void loadAllGroup(groupKey, projectPath ?? null)
    }
    // Refresh expanded groups when the authoritative navigation sequence changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation?.throughGlobalSequence])

  useEffect(() => {
    for (const project of pinnedProjects) {
      const groupKey = projectKey(project)
      if (allCampsByGroup[groupKey] || loadingGroup === groupKey) continue
      expandedAllGroupsRef.current = new Set(expandedAllGroupsRef.current).add(groupKey)
      void loadAllGroup(groupKey, project.projectPath)
    }
    // Pinned Projects always resolve their complete Camp group.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins, navigation?.throughGlobalSequence])

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

  const toggleProjectGroup = (groupKey: string): void => {
    setCollapsedProjectGroups((current) => toggleNavigationGroup(current, groupKey))
  }

  const requestSidebarFocus = (target: string): void => {
    setSidebarFocusRequest({ id: nextSidebarFocusRequestIdRef.current++, target })
  }

  useLayoutEffect(() => {
    if (!sidebarFocusRequest) return
    let frameId = 0
    let frameCount = 0
    let cancelled = false
    const finish = (): void => {
      setSidebarFocusRequest((current) => current?.id === sidebarFocusRequest.id ? null : current)
    }
    const cancelOnUserInput = (): void => {
      cancelled = true
      cancelAnimationFrame(frameId)
      finish()
    }
    const restore = (): void => {
      if (cancelled) return
      const targetElement = Array.from(
        sidebarRef.current?.querySelectorAll<HTMLButtonElement>('[data-sidebar-menu-target]') ?? []
      ).find((element) => element.dataset.sidebarMenuTarget === sidebarFocusRequest.target)
      targetElement?.focus()
      frameCount += 1
      if (frameCount < 16) {
        frameId = requestAnimationFrame(restore)
      } else {
        finish()
      }
    }
    window.addEventListener('pointerdown', cancelOnUserInput, true)
    window.addEventListener('keydown', cancelOnUserInput, true)
    restore()
    return () => {
      cancelAnimationFrame(frameId)
      window.removeEventListener('pointerdown', cancelOnUserInput, true)
      window.removeEventListener('keydown', cancelOnUserInput, true)
    }
  }, [sidebarFocusRequest])

  const togglePin = async (
    kind: NavigationPin['kind'],
    targetKey: string,
    camp?: NavigationCampItem
  ): Promise<void> => {
    const focusTarget = `${kind}:${targetKey}`
    await onTogglePin(kind, targetKey, camp)
    requestSidebarFocus(focusTarget)
  }

  const openAction = (kind: 'rename' | 'delete', camp: NavigationCampItem): void => {
    dialogReturnFocusTargetRef.current = `camp:${camp.id}`
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

  return (
    <>
      <aside ref={sidebarRef} className={`unified-sidebar ${view === 'settings' ? 'settings-navigation-mode' : ''}`} aria-label={view === 'settings' ? '设置分类' : '全局导航'}>
        <div className="unified-sidebar-drag" aria-hidden="true" />
        <div className="unified-brand">
          <span className="rail-logo" role="img" aria-label="Rovai AI">
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1 L14.2 9.8 L23 12 L14.2 14.2 L12 23 L9.8 14.2 L1 12 L9.8 9.8 Z" fill="currentColor" /></svg>
            <span><strong>Rovai AI</strong></span>
          </span>
          <button
            ref={notificationButtonRef}
            className="notification-trigger"
            type="button"
            aria-label={notificationUnreadCount > 0
              ? `通知，${notificationUnreadCount} 条未读`
              : '通知'}
            title="通知"
            onClick={onNotifications}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6.5 10.5a5.5 5.5 0 0 1 11 0c0 5 2 5.2 2 6.5h-15c0-1.3 2-1.5 2-6.5Z" />
              <path d="M9.7 19a2.5 2.5 0 0 0 4.6 0" />
            </svg>
            {notificationUnreadCount > 0 && (
              <span className="notification-trigger-badge" aria-hidden="true">
                {notificationUnreadCount > 99 ? '99+' : notificationUnreadCount}
              </span>
            )}
          </button>
        </div>
        {view === 'settings'
          ? (
              <SettingsSidebarNavigation
                section={settingsSection}
                onSectionChange={onSettingsSectionChange}
                onBack={onSettingsBack}
              />
            )
          : (
              <>
                <nav className="unified-primary-nav" aria-label="主要页面">
                  <button className={`rail-button ${view === 'compose' ? 'active' : ''}`} type="button" aria-label="新对话" title="新对话" onClick={onNewConversation} disabled={state !== 'ready'}>
                    <span className="rail-glyph" aria-hidden="true">＋</span><span className="rail-label">新对话</span>
                  </button>
                  <button className={`rail-button ${view === 'members' ? 'active' : ''}`} type="button" aria-current={view === 'members' ? 'page' : undefined} aria-label="队员" title="队员" onClick={onMembers}>
                    <span className="rail-glyph" aria-hidden="true">◎</span><span className="rail-label">队员</span>
                  </button>
                  <button
                    className={`rail-button ${view === 'memory' ? 'active' : ''}`}
                    type="button"
                    aria-current={view === 'memory' ? 'page' : undefined}
                    aria-label={pendingMemoryCount > 0 ? `记忆，${pendingMemoryCount} 条普通提案待确认` : '记忆'}
                    title={pendingMemoryCount > 0 ? `记忆 · ${pendingMemoryCount} 条普通提案待确认` : '记忆'}
                    onClick={onMemory}
                  >
                    <span className="rail-glyph" aria-hidden="true">◈</span><span className="rail-label">记忆</span>
                    {pendingMemoryCount > 0 && <i className="rail-badge-dot" aria-hidden="true" />}
                  </button>
                </nav>
                <button className="conversation-jump" type="button" onClick={() => setPaletteOpen(true)}>
                  <span>跳转到对话…</span><kbd aria-hidden="true">⌘K</kbd>
                </button>

      {view === 'members' && memberSidebar
        ? memberSidebar
        : <div className="navigation-scroll">
        {(pinnedCamps.length > 0 || pinnedProjects.length > 0) && (
          <section className="pinned-navigation" aria-labelledby="pinned-heading">
            <div className="sidebar-group-title navigation-section-title">
              <span id="pinned-heading">置顶</span>
            </div>
            {pinnedCamps.map((camp) => (
              <CampRow
                key={camp.id}
                camp={camp}
                active={camp.id === activeCampId}
                agents={agents}
                pinned
                onTogglePin={() => void togglePin('camp', camp.id, camp)}
                onCamp={onCamp}
                onAction={openAction}
              />
            ))}
            {pinnedProjects.map((project) => (
              <CampGroup
                key={`pinned-${project.projectKey}`}
                groupKey={`pinned-${project.projectKey}`}
                pinTargetKey={project.projectKey}
                label={project.name}
                totalCount={project.totalCount}
                camps={(allCampsByGroup[project.projectKey] ?? project.recentCamps)
                  .filter((camp) => !pinnedCampIds.has(camp.id))}
                expandedAll
                projectExpanded={!collapsedProjectGroups.has(`pinned-${project.projectKey}`)}
                loadingAll={loadingGroup === project.projectKey}
                activeCampId={activeCampId}
                agents={agents}
                pinned
                onToggleAll={() => undefined}
                onToggleExpanded={() => toggleProjectGroup(`pinned-${project.projectKey}`)}
                onTogglePin={() => void togglePin('project', project.projectKey)}
                onToggleCampPin={(camp) => void togglePin('camp', camp.id, camp)}
                onCamp={onCamp}
                onAction={openAction}
              />
            ))}
          </section>
        )}
        <section className="navigation-projects" aria-labelledby="projects-heading">
          <div className="sidebar-group-title navigation-section-title"><span id="projects-heading">项目</span><button aria-label="选择工作目录" title="选择工作目录" onClick={onOpenProject}>＋</button></div>
          {navigation?.projects.map((project) => {
            const groupKey = projectKey(project)
            if (pins.some((pin) => pin.kind === 'project' && pin.targetKey === project.projectKey)) return null
            return (
              <CampGroup
                key={project.projectKey}
                groupKey={groupKey}
                pinTargetKey={project.projectKey}
                label={project.name}
                totalCount={project.totalCount}
                camps={(expandedAllGroups.has(groupKey) ? allCampsByGroup[groupKey] ?? project.recentCamps : project.recentCamps)
                  .filter((camp) => !pinnedCampIds.has(camp.id))}
                expandedAll={expandedAllGroups.has(groupKey)}
                projectExpanded={!collapsedProjectGroups.has(groupKey)}
                loadingAll={loadingGroup === groupKey}
                activeCampId={activeCampId}
                agents={agents}
                pinned={pins.some((pin) => pin.kind === 'project' && pin.targetKey === project.projectKey)}
                onToggleAll={() => toggleAll(groupKey, project.projectPath)}
                onToggleExpanded={() => toggleProjectGroup(groupKey)}
                onTogglePin={() => void togglePin('project', project.projectKey)}
                onToggleCampPin={(camp) => void togglePin('camp', camp.id, camp)}
                onCamp={onCamp}
                onAction={openAction}
              />
            )
          })}
          {navigation && navigation.projects.length === 0 && <p className="sidebar-empty">选择工作目录后，对话会在这里成组显示。</p>}
          <CampGroup
            groupKey="quick-chat"
            label="快速对话"
            totalCount={navigation?.quickChat.totalCount ?? 0}
            camps={(expandedAllGroups.has('quick-chat') ? allCampsByGroup['quick-chat'] ?? navigation?.quickChat.recentCamps ?? [] : navigation?.quickChat.recentCamps ?? [])
              .filter((camp) => !pinnedCampIds.has(camp.id))}
            expandedAll={expandedAllGroups.has('quick-chat')}
            projectExpanded={!collapsedProjectGroups.has('quick-chat')}
            loadingAll={loadingGroup === 'quick-chat'}
            activeCampId={activeCampId}
            agents={agents}
            onToggleAll={() => toggleAll('quick-chat', null)}
            onToggleExpanded={() => toggleProjectGroup('quick-chat')}
            onToggleCampPin={(camp) => void togglePin('camp', camp.id, camp)}
            onCamp={onCamp}
            onAction={openAction}
          />
        </section>
          </div>}
      <div className="unified-sidebar-footer">
        <button
          ref={settingsButtonRef}
          className="rail-button"
          type="button"
          aria-label="设置"
          onClick={onSettings}
        >
          <span className="rail-glyph" aria-hidden="true">⚙</span><span className="rail-label">设置</span>
        </button>
      </div>
              </>
            )}
      </aside>

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
          <Dialog.Content
            className="dialog-content camp-action-dialog"
            onCloseAutoFocus={(event) => {
              const target = dialogReturnFocusTargetRef.current
              dialogReturnFocusTargetRef.current = null
              if (!target) return
              event.preventDefault()
              requestSidebarFocus(target)
            }}
          >
            {action?.kind === 'rename' ? (
              <form onSubmit={(event) => void submitRename(event)}>
                <Dialog.Title>重命名对话</Dialog.Title>
                <Dialog.Description>只修改侧栏标题，不改变 Camp 的项目归属、队员或活动顺序。</Dialog.Description>
                <label className="field-label" htmlFor="rename-camp-title">标题<input id="rename-camp-title" autoFocus value={renameTitle} onChange={(event) => setRenameTitle(event.target.value)} disabled={actionBusy} /></label>
                <div className="dialog-actions"><Dialog.Close asChild><button className="quiet-button" type="button" disabled={actionBusy}>取消</button></Dialog.Close><button className="primary-button" type="submit" disabled={!renameTitle.trim() || actionBusy}>{actionBusy ? '保存中…' : '保存'}</button></div>
              </form>
            ) : action?.kind === 'delete' ? (
              <div>
                <Dialog.Title>永久删除“{formatMentionDisplayText(action.camp.title, agents)}”？</Dialog.Title>
                <Dialog.Description>这会删除 Camp 的会话、队员连续性、运行记录和关联数据。此操作不能撤销，也不会删除本地 Repository。</Dialog.Description>
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

function SettingsSidebarNavigation({
  section,
  onSectionChange,
  onBack
}: {
  section: NavigationSettingsSection
  onSectionChange(section: NavigationSettingsSection): void
  onBack(): void
}): JSX.Element {
  const items: Array<{
    key: NavigationSettingsSection
    icon: string
    label: string
  }> = [
    { key: 'skills', icon: '◇', label: 'Skill' },
    { key: 'mcp', icon: '⌘', label: 'MCP' },
    { key: 'runtime', icon: '◈', label: 'Agent 运行时' },
    { key: 'appearance', icon: '◐', label: '外观' },
    { key: 'notifications', icon: '♢', label: '通知' },
    { key: 'diagnostics', icon: '⌁', label: '诊断' }
  ]
  return (
    <div className="settings-sidebar-navigation">
      <div className="settings-sidebar-heading">
        <button className="settings-sidebar-back" type="button" onClick={onBack}>
          <span aria-hidden="true">←</span>
          <strong>返回 App</strong>
        </button>
        <div className="settings-sidebar-title">
          <strong>设置</strong>
          <span>应用级偏好与本机能力</span>
        </div>
      </div>
      <nav className="settings-sidebar-menu" aria-label="设置页面">
        {items.map((item) => (
          <button
            className={section === item.key ? 'active' : ''}
            type="button"
            aria-current={section === item.key ? 'page' : undefined}
            key={item.key}
            onClick={() => onSectionChange(item.key)}
          >
            <span aria-hidden="true">{item.icon}</span>
            <strong>{item.label}</strong>
          </button>
        ))}
      </nav>
    </div>
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
          : '快速对话'
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
                <small>{camp.projectBindingKind === 'directory' ? projectNameByPath.get(camp.projectPath) ?? '项目' : '快速对话'}</small>
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
  pinTargetKey,
  label,
  totalCount,
  camps,
  expandedAll,
  projectExpanded,
  loadingAll,
  activeCampId,
  agents,
  pinned = false,
  onToggleAll,
  onToggleExpanded,
  onTogglePin,
  onToggleCampPin,
  onCamp,
  onAction
}: {
  groupKey: string
  pinTargetKey?: string
  label: string
  totalCount: number
  camps: NavigationCampItem[]
  expandedAll: boolean
  projectExpanded: boolean
  loadingAll: boolean
  activeCampId: string | null
  agents: Pick<AgentProfile, 'handle' | 'displayName'>[]
  pinned?: boolean
  onToggleAll(): void
  onToggleExpanded(): void
  onTogglePin?(): void
  onToggleCampPin(camp: NavigationCampItem): void
  onCamp(camp: NavigationCampItem): void
  onAction(kind: 'rename' | 'delete', camp: NavigationCampItem): void
}): JSX.Element {
  const projectMenuLabels = projectNavigationMenuLabels(pinned)
  const contentId = `camp-group-content-${groupKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`
  return (
    <section className="camp-nav-group" data-group={groupKey}>
      <div className="camp-group-heading-row">
        <button
          className="camp-group-heading"
          type="button"
          title={label}
          aria-expanded={projectExpanded}
          aria-controls={contentId}
          onClick={onToggleExpanded}
        >
          <svg className="project-folder-glyph" viewBox="0 0 24 24" aria-hidden="true">
            <g className="project-folder-closed">
              <path className="folder-fill" d="M3.75 7.2c0-1.1.9-2 2-2h4.05l2.05 2.15h6.4c1.1 0 2 .9 2 2v7.4c0 1.1-.9 2-2 2H5.75c-1.1 0-2-.9-2-2Z" />
              <path d="M3.9 9.1h16.2" />
            </g>
            <g className="project-folder-open">
              <path d="M3.75 9V7.2c0-1.1.9-2 2-2h4.05l2.05 2.15h6.4c1.1 0 2 .9 2 2v1" />
              <path className="folder-fill" d="M6.55 9.8h13.7l-1.65 6.85a2 2 0 0 1-1.95 1.55H5.6a1.9 1.9 0 0 1-1.85-2.35l1.05-4.5A1.8 1.8 0 0 1 6.55 9.8Z" />
            </g>
          </svg>
          <span className="truncate">{label}</span>
          <svg className="project-disclosure-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m5.5 6.2 2.5 2.5 2.5-2.5" /></svg>
        </button>
        {onTogglePin && pinTargetKey && (
          <SidebarActionMenu
            target={`project:${pinTargetKey}`}
            label={`管理项目“${label}”`}
            triggerClassName="group-menu-trigger"
            items={[{
              key: 'toggle-pin',
              label: projectMenuLabels[0],
              icon: 'pin',
              filled: pinned,
              deferCloseAutoFocus: true,
              onSelect: onTogglePin
            }]}
          />
        )}
      </div>
      <div id={contentId} className="camp-group-children" hidden={!projectExpanded}>
        {projectExpanded && camps.map((camp) => (
          <CampRow
            key={camp.id}
            camp={camp}
            active={camp.id === activeCampId}
            agents={agents}
            pinned={false}
            onTogglePin={() => onToggleCampPin(camp)}
            onCamp={onCamp}
            onAction={onAction}
          />
        ))}
        {projectExpanded && camps.length === 0 && totalCount === 0 && <p className="sidebar-empty">还没有对话</p>}
        {projectExpanded && totalCount > 5 && <button className="show-all-camps" type="button" onClick={onToggleAll} disabled={loadingAll}>{loadingAll ? '正在读取…' : expandedAll ? '收起' : '查看全部'}</button>}
      </div>
    </section>
  )
}

function CampRow({
  camp,
  active,
  agents,
  pinned,
  onTogglePin,
  onCamp,
  onAction
}: {
  camp: NavigationCampItem
  active: boolean
  agents: Pick<AgentProfile, 'handle' | 'displayName'>[]
  pinned: boolean
  onTogglePin(): void
  onCamp(camp: NavigationCampItem): void
  onAction(kind: 'rename' | 'delete', camp: NavigationCampItem): void
}): JSX.Element {
  const title = formatMentionDisplayText(camp.title, agents)
  const menuLabels = campNavigationMenuLabels(pinned)
  return (
    <div className={`camp-nav-row ${active ? 'selected' : ''}`}>
      <button
        className="camp-nav-open"
        type="button"
        aria-current={active ? 'page' : undefined}
        title={title}
        onClick={() => onCamp(camp)}
      >
        <span className="camp-marker-slot" aria-hidden="true">
          {camp.marker === 'unread_completed' && <i className="task-dot camp-marker-unread_completed" />}
        </span>
        <span className="truncate">{title}</span>
        {camp.marker === 'loading' && <span className="camp-loading-spinner camp-marker-loading" role="img" aria-label="正在运行" />}
      </button>
      <SidebarActionMenu
        target={`camp:${camp.id}`}
        label={`管理“${title}”`}
        triggerClassName="camp-menu-trigger"
        items={[{
          key: 'toggle-pin',
          label: menuLabels[0],
          icon: 'pin',
          filled: pinned,
          deferCloseAutoFocus: true,
          onSelect: onTogglePin
        }, {
          key: 'rename',
          label: menuLabels[1],
          icon: 'edit',
          onSelect: () => onAction('rename', camp)
        }, {
          key: 'delete',
          label: menuLabels[2],
          icon: 'trash',
          danger: true,
          separatorBefore: true,
          onSelect: () => onAction('delete', camp)
        }]}
      />
    </div>
  )
}

type SidebarActionMenuItem = {
  key: string
  label: string
  icon: 'pin' | 'edit' | 'trash'
  filled?: boolean
  danger?: boolean
  separatorBefore?: boolean
  deferCloseAutoFocus?: boolean
  onSelect(): void
}

function SidebarActionMenu({
  target,
  label,
  triggerClassName,
  items
}: {
  target: string
  label: string
  triggerClassName: string
  items: SidebarActionMenuItem[]
}): JSX.Element {
  const deferCloseAutoFocusRef = useRef(false)
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className={`sidebar-menu-trigger ${triggerClassName}`}
          type="button"
          aria-label={label}
          title="更多操作"
          data-sidebar-menu-target={target}
        >
          <svg className="more-icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="5" cy="12" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="19" cy="12" r="1.8" />
          </svg>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="sidebar-action-menu"
          aria-label={label}
          align="end"
          sideOffset={4}
          collisionPadding={8}
          loop
          onCloseAutoFocus={(event) => {
            if (!deferCloseAutoFocusRef.current) return
            deferCloseAutoFocusRef.current = false
            event.preventDefault()
          }}
        >
          {items.flatMap((item) => [
            item.separatorBefore
              ? <DropdownMenu.Separator className="sidebar-action-menu-separator" key={`${item.key}-separator`} />
              : null,
            <DropdownMenu.Item
              className={`sidebar-action-menu-item ${item.danger ? 'danger' : ''}`}
              key={item.key}
              onSelect={() => {
                deferCloseAutoFocusRef.current = item.deferCloseAutoFocus === true
                item.onSelect()
              }}
            >
              <SidebarMenuIcon kind={item.icon} filled={item.filled} />
              <span>{item.label}</span>
            </DropdownMenu.Item>
          ])}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function SidebarMenuIcon({ kind, filled = false }: {
  kind: SidebarActionMenuItem['icon']
  filled?: boolean
}): JSX.Element {
  if (kind === 'edit') {
    return <svg className="sidebar-action-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 19 3.8-.8L18 9l-3-3-9.2 9.2Z" /><path d="m13.8 7.2 3 3" /></svg>
  }
  if (kind === 'trash') {
    return <svg className="sidebar-action-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V4h6v3m2 0-1 13H8L7 7m3 4v5m4-5v5" /></svg>
  }
  return (
    <svg className={`sidebar-action-menu-icon ${filled ? 'filled' : ''}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 4h6l-.8 5 3.3 3.2v1.3h-11v-1.3L9.8 9Z" />
      <path d="M12 13.5V21" />
    </svg>
  )
}

function projectKey(project: ProjectNavigationGroup): string {
  return project.projectKey
}

function deleteBlockerLabel(code: string): string {
  return ({
    nonterminal_agent_run: '仍有 Agent 正在执行或等待',
    nonterminal_camp_turn: '仍有 CampTurn 未结束',
    pending_approval: '仍有待处理审批',
    unsettled_action: '仍有未收敛动作',
    pending_inbox_delivery: '仍有 Inbox 消息待投递',
    pending_runtime_delivery: '仍有 Agent 运行时结果待确认',
    active_worker_lease: '仍有执行器持有租约',
    unfinished_membership_change: '仍有队员变更未完成',
    unfinished_task_cancellation: '仍有 Task 取消未完成'
  } as Record<string, string>)[code] ?? code
}
