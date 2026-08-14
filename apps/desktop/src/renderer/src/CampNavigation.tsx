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
  NavigationPin,
  NavigationCampItem,
  NavigationCampPage,
  NavigationSnapshot,
  ProjectNavigationGroup,
  SettingsSection
} from '@contracts'
import { writeClipboardText } from './clipboard'
import { allNavigationCamps } from './ui-model'

export interface CampDeleteAttempt {
  deleted: boolean
  blockers: Array<{ code: string; count: number }>
}

export type NavigationSettingsSection = SettingsSection

type NavigationAction = {
  kind: 'rename' | 'delete'
  camp: NavigationCampItem
} | {
  kind: 'remove_project'
  project: ProjectNavigationGroup
} | null

export function campNavigationMenuLabels(pinned: boolean): string[] {
  return [pinned ? '取消置顶' : '置顶', '重命名', '复制会话 ID', '删除']
}

export async function copyCampIdToClipboard(
  campId: string,
  writeText: (text: string) => Promise<boolean> = writeClipboardText
): Promise<void> {
  let copied = false
  try {
    copied = await writeText(campId)
  } catch {
    copied = false
  }
  if (!copied) throw new Error('无法复制会话 ID，请重试。')
}

export function projectNavigationMenuLabels(pinned: boolean): string[] {
  return [pinned ? '取消置顶项目' : '置顶项目', '移除项目']
}

export function toggleNavigationGroup(groups: ReadonlySet<string>, groupKey: string): Set<string> {
  const next = new Set(groups)
  if (next.has(groupKey)) next.delete(groupKey)
  else next.add(groupKey)
  return next
}

export function activateProjectNavigationRow(
  onSelectProject: () => void,
  onToggleExpanded: () => void
): void {
  onSelectProject()
  onToggleExpanded()
}

export const NAVIGATION_INITIAL_VISIBLE_CAMPS = 5
export const NAVIGATION_MORE_CAMPS_STEP = 10

export interface NavigationGroupPaginationState {
  camps: NavigationCampItem[]
  visibleCount: number
  serverOffset: number
}

export function appendUniqueNavigationCamps(
  current: readonly NavigationCampItem[],
  incoming: readonly NavigationCampItem[]
): NavigationCampItem[] {
  const seen = new Set<string>()
  return [...current, ...incoming].filter((camp) => {
    if (seen.has(camp.id)) return false
    seen.add(camp.id)
    return true
  })
}

export function navigationGroupPagination(
  recentCamps: readonly NavigationCampItem[],
  totalCount: number,
  current?: NavigationGroupPaginationState
): NavigationGroupPaginationState {
  const normalizedTotal = Math.max(0, totalCount)
  const camps = current
    ? appendUniqueNavigationCamps(recentCamps, current.camps)
    : appendUniqueNavigationCamps([], recentCamps)
  return {
    camps,
    visibleCount: Math.min(
      normalizedTotal,
      current?.visibleCount ?? Math.min(NAVIGATION_INITIAL_VISIBLE_CAMPS, camps.length)
    ),
    serverOffset: Math.min(
      normalizedTotal,
      current?.serverOffset ?? Math.min(NAVIGATION_INITIAL_VISIBLE_CAMPS, normalizedTotal)
    )
  }
}

export function navigationPaginationControls(
  visibleCount: number,
  totalCount: number
): { showMore: boolean; showCollapse: boolean } {
  return {
    showMore: visibleCount < totalCount,
    showCollapse: visibleCount > NAVIGATION_INITIAL_VISIBLE_CAMPS
  }
}

export function collapseNavigationGroupPagination(
  state: NavigationGroupPaginationState,
  totalCount: number
): NavigationGroupPaginationState {
  return {
    ...state,
    visibleCount: Math.min(NAVIGATION_INITIAL_VISIBLE_CAMPS, Math.max(0, totalCount))
  }
}

export function removeNavigationCampFromPagination(
  state: NavigationGroupPaginationState,
  campId: string
): NavigationGroupPaginationState {
  if (!state.camps.some((camp) => camp.id === campId)) return state
  const camps = state.camps.filter((camp) => camp.id !== campId)
  return {
    camps,
    visibleCount: Math.min(state.visibleCount, camps.length),
    serverOffset: Math.max(0, state.serverOffset - 1)
  }
}

export async function revealMoreNavigationCamps(
  state: NavigationGroupPaginationState,
  totalCount: number,
  loadPage: (offset: number, limit: number) => Promise<NavigationCampPage>
): Promise<NavigationGroupPaginationState> {
  const targetVisibleCount = Math.min(
    Math.max(0, totalCount),
    state.visibleCount + NAVIGATION_MORE_CAMPS_STEP
  )
  if (state.camps.length >= targetVisibleCount) {
    return { ...state, visibleCount: targetVisibleCount }
  }

  const page = await loadPage(state.serverOffset, NAVIGATION_MORE_CAMPS_STEP)
  if (page.schemaVersion !== 3) throw new Error('会话列表数据版本不兼容。')
  const camps = appendUniqueNavigationCamps(state.camps, page.camps)
  const pageTotalCount = Math.max(0, page.totalCount)
  return {
    camps,
    visibleCount: Math.min(targetVisibleCount, pageTotalCount, camps.length),
    serverOffset: Math.min(pageTotalCount, page.nextOffset ?? pageTotalCount)
  }
}

export function CampNavigation({
  view,
  state,
  navigation,
  activeCampId,
  currentProjectKey = 'quick-chat',
  shellOnlyProjectPath = null,
  creatingConversation = false,
  pins = [],
  pinnedCampItems = [],
  settingsSection = 'general',
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
  onSelectProject = () => undefined,
  onCreateInProject = () => undefined,
  onCamp,
  onTogglePin = () => undefined,
  onRemoveProject,
  onCampIdCopied = () => undefined,
  onRename,
  onDelete,
  onStop,
  onError
}: {
  view: 'compose' | 'camp' | 'members' | 'memory' | 'settings'
  state: 'loading' | 'ready' | 'error'
  navigation: NavigationSnapshot | null
  activeCampId: string | null
  currentProjectKey?: string
  shellOnlyProjectPath?: string | null
  creatingConversation?: boolean
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
  onSelectProject?(project: ProjectNavigationGroup | null): void
  onCreateInProject?(project: ProjectNavigationGroup | null): void
  onCamp(camp: NavigationCampItem): void
  onTogglePin?(kind: NavigationPin['kind'], targetKey: string, camp?: NavigationCampItem): void | Promise<void>
  onRemoveProject(project: ProjectNavigationGroup): Promise<void>
  onCampIdCopied?(): void
  onRename(camp: NavigationCampItem, title: string): Promise<void>
  onDelete(camp: NavigationCampItem): Promise<CampDeleteAttempt>
  onStop(camp: NavigationCampItem): Promise<void>
  onError(error: unknown): void
}): JSX.Element {
  const [collapsedProjectGroups, setCollapsedProjectGroups] = useState<Set<string>>(() => new Set())
  const [paginationByGroup, setPaginationByGroup] = useState<Record<string, NavigationGroupPaginationState>>({})
  const [loadingGroups, setLoadingGroups] = useState<Set<string>>(() => new Set())
  const [action, setAction] = useState<NavigationAction>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [deleteBlockers, setDeleteBlockers] = useState<Array<{ code: string; count: number }>>([])
  const [actionBusy, setActionBusy] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [sidebarFocusRequest, setSidebarFocusRequest] = useState<{ id: number; target: string } | null>(null)
  const paginationByGroupRef = useRef(paginationByGroup)
  const loadingGroupsRef = useRef<Set<string>>(new Set())
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
  const quickChatRecentCamps = navigation?.quickChat.recentCamps ?? []
  const quickChatTotalCount = navigation?.quickChat.totalCount ?? 0
  const quickChatPagination = navigationGroupPagination(
    quickChatRecentCamps,
    quickChatTotalCount,
    paginationByGroup['quick-chat']
  )

  useEffect(() => {
    paginationByGroupRef.current = paginationByGroup
  }, [paginationByGroup])

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

  const commitPagination = (groupKey: string, pagination: NavigationGroupPaginationState): void => {
    const next = { ...paginationByGroupRef.current, [groupKey]: pagination }
    paginationByGroupRef.current = next
    setPaginationByGroup(next)
  }

  const showMore = async (
    groupKey: string,
    projectPath: string | null,
    recentCamps: readonly NavigationCampItem[],
    totalCount: number
  ): Promise<void> => {
    if (loadingGroupsRef.current.has(groupKey)) return
    const pagination = navigationGroupPagination(
      recentCamps,
      totalCount,
      paginationByGroupRef.current[groupKey]
    )
    if (pagination.camps.length >= Math.min(totalCount, pagination.visibleCount + NAVIGATION_MORE_CAMPS_STEP)) {
      commitPagination(groupKey, await revealMoreNavigationCamps(pagination, totalCount, async () => {
        throw new Error('Cached navigation pagination unexpectedly requested a page')
      }))
      return
    }

    loadingGroupsRef.current = new Set(loadingGroupsRef.current).add(groupKey)
    setLoadingGroups(new Set(loadingGroupsRef.current))
    try {
      const next = await revealMoreNavigationCamps(pagination, totalCount, (offset, limit) => (
        window.rovai.request<NavigationCampPage>('navigation.groupCamps', { projectPath, offset, limit })
      ))
      commitPagination(groupKey, next)
    } catch (error) {
      onError(error)
    } finally {
      const nextLoading = new Set(loadingGroupsRef.current)
      nextLoading.delete(groupKey)
      loadingGroupsRef.current = nextLoading
      setLoadingGroups(new Set(nextLoading))
    }
  }

  const collapseGroupCamps = (
    groupKey: string,
    recentCamps: readonly NavigationCampItem[],
    totalCount: number
  ): void => {
    commitPagination(groupKey, collapseNavigationGroupPagination(
      navigationGroupPagination(recentCamps, totalCount, paginationByGroupRef.current[groupKey]),
      totalCount
    ))
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
        sidebarRef.current?.querySelectorAll<HTMLButtonElement>(
          '[data-sidebar-menu-target], [data-sidebar-focus-target]'
        ) ?? []
      ).find((element) => (
        element.dataset.sidebarMenuTarget === sidebarFocusRequest.target
        || element.dataset.sidebarFocusTarget === sidebarFocusRequest.target
      ))
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

  const copyCampId = async (camp: NavigationCampItem): Promise<void> => {
    try {
      await copyCampIdToClipboard(camp.id)
      onCampIdCopied()
    } catch (error) {
      onError(error)
    }
  }

  const openAction = (kind: 'rename' | 'delete', camp: NavigationCampItem): void => {
    dialogReturnFocusTargetRef.current = `camp:${camp.id}`
    setAction({ kind, camp })
    setRenameTitle(camp.title)
    setDeleteBlockers([])
  }

  const openProjectRemoval = (project: ProjectNavigationGroup): void => {
    dialogReturnFocusTargetRef.current = `project:${project.projectKey}`
    setAction({ kind: 'remove_project', project })
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
        const nextPagination = Object.fromEntries(
          Object.entries(paginationByGroupRef.current).map(([groupKey, pagination]) => [
            groupKey,
            removeNavigationCampFromPagination(pagination, action.camp.id)
          ])
        )
        paginationByGroupRef.current = nextPagination
        setPaginationByGroup(nextPagination)
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

  const confirmProjectRemoval = async (): Promise<void> => {
    if (!action || action.kind !== 'remove_project' || actionBusy) return
    setActionBusy(true)
    try {
      await onRemoveProject(action.project)
      dialogReturnFocusTargetRef.current = 'project-row:quick-chat'
      setAction(null)
      requestSidebarFocus('project-row:quick-chat')
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
            <svg
              className="rail-logo-mark"
              data-brand-mark="horizon"
              data-brand-layout="separated"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M12 2 L13.16 7.3 L17.76 8.84 L13.16 10.38 L12 15.68 L10.84 10.38 L6.24 8.84 L10.84 7.3 Z" fill="currentColor" />
              <path d="M3 20.96 Q12 15.96 21 20.96" fill="none" stroke="currentColor" strokeWidth="2.08" strokeLinecap="round" />
              <circle className="brand-rendezvous-point" data-brand-point="rendezvous" cx="12" cy="18.46" r="1.05" />
            </svg>
            <span><strong>Rovai AI</strong></span>
          </span>
          <button
            ref={notificationButtonRef}
            className="notification-trigger"
            type="button"
            aria-label={notificationUnreadCount > 0
              ? `通知，${notificationUnreadCount} 项未读`
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
                  <button className={`rail-button ${view === 'compose' ? 'active' : ''}`} type="button" aria-label="新对话" title="新对话" onClick={onNewConversation} disabled={state !== 'ready' || creatingConversation}>
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
                pinned
                onTogglePin={() => void togglePin('camp', camp.id, camp)}
                onCopyCampId={() => void copyCampId(camp)}
                onCamp={onCamp}
                onAction={openAction}
              />
            ))}
            {pinnedProjects.map((project) => {
              const groupKey = projectKey(project)
              const pagination = navigationGroupPagination(
                project.recentCamps,
                project.totalCount,
                paginationByGroup[groupKey]
              )
              return <CampGroup
                key={`pinned-${project.projectKey}`}
                groupKey={groupKey}
                pinTargetKey={project.projectKey}
                label={project.name}
                totalCount={project.totalCount}
                visibleCount={pagination.visibleCount}
                camps={pagination.camps.slice(0, pagination.visibleCount)
                  .filter((camp) => !pinnedCampIds.has(camp.id))}
                projectExpanded={!collapsedProjectGroups.has(groupKey)}
                loadingMore={loadingGroups.has(groupKey)}
                activeCampId={activeCampId}
                currentProject={currentProjectKey === project.projectKey}
                createDisabled={creatingConversation}
                pinned
                onShowMore={() => void showMore(groupKey, project.projectPath, project.recentCamps, project.totalCount)}
                onCollapseCamps={() => collapseGroupCamps(groupKey, project.recentCamps, project.totalCount)}
                onToggleExpanded={() => toggleProjectGroup(groupKey)}
                onSelectProject={() => onSelectProject(project)}
                onCreate={() => onCreateInProject(project)}
                onTogglePin={project.projectPath === shellOnlyProjectPath
                  ? undefined
                  : () => void togglePin('project', project.projectKey)}
                onRemoveProject={() => openProjectRemoval(project)}
                onToggleCampPin={(camp) => void togglePin('camp', camp.id, camp)}
                onCopyCampId={(camp) => void copyCampId(camp)}
                onCamp={onCamp}
                onAction={openAction}
              />
            })}
          </section>
        )}
        <section className="navigation-projects" aria-labelledby="projects-heading">
          <div className="sidebar-group-title navigation-section-title"><span id="projects-heading">项目</span><button className="section-create-button" aria-label="选择工作目录" title="选择工作目录" onClick={onOpenProject}>＋</button></div>
          {navigation?.projects.map((project) => {
            const groupKey = projectKey(project)
            if (pins.some((pin) => pin.kind === 'project' && pin.targetKey === project.projectKey)) return null
            const pagination = navigationGroupPagination(
              project.recentCamps,
              project.totalCount,
              paginationByGroup[groupKey]
            )
            return (
              <CampGroup
                key={project.projectKey}
                groupKey={groupKey}
                pinTargetKey={project.projectKey}
                label={project.name}
                totalCount={project.totalCount}
                visibleCount={pagination.visibleCount}
                camps={pagination.camps.slice(0, pagination.visibleCount)
                  .filter((camp) => !pinnedCampIds.has(camp.id))}
                projectExpanded={!collapsedProjectGroups.has(groupKey)}
                loadingMore={loadingGroups.has(groupKey)}
                activeCampId={activeCampId}
                currentProject={currentProjectKey === project.projectKey}
                createDisabled={creatingConversation}
                pinned={pins.some((pin) => pin.kind === 'project' && pin.targetKey === project.projectKey)}
                onShowMore={() => void showMore(groupKey, project.projectPath, project.recentCamps, project.totalCount)}
                onCollapseCamps={() => collapseGroupCamps(groupKey, project.recentCamps, project.totalCount)}
                onToggleExpanded={() => toggleProjectGroup(groupKey)}
                onSelectProject={() => onSelectProject(project)}
                onCreate={() => onCreateInProject(project)}
                onTogglePin={project.projectPath === shellOnlyProjectPath
                  ? undefined
                  : () => void togglePin('project', project.projectKey)}
                onRemoveProject={() => openProjectRemoval(project)}
                onToggleCampPin={(camp) => void togglePin('camp', camp.id, camp)}
                onCopyCampId={(camp) => void copyCampId(camp)}
                onCamp={onCamp}
                onAction={openAction}
              />
            )
          })}
          {navigation && navigation.projects.length === 0 && <p className="sidebar-empty">选择工作目录后，对话会在这里成组显示。</p>}
          <CampGroup
            groupKey="quick-chat"
            label="快速对话"
            totalCount={quickChatTotalCount}
            visibleCount={quickChatPagination.visibleCount}
            camps={quickChatPagination.camps.slice(0, quickChatPagination.visibleCount)
              .filter((camp) => !pinnedCampIds.has(camp.id))}
            projectExpanded={!collapsedProjectGroups.has('quick-chat')}
            loadingMore={loadingGroups.has('quick-chat')}
            activeCampId={activeCampId}
            currentProject={currentProjectKey === 'quick-chat'}
            createDisabled={creatingConversation}
            onShowMore={() => void showMore('quick-chat', null, quickChatRecentCamps, quickChatTotalCount)}
            onCollapseCamps={() => collapseGroupCamps('quick-chat', quickChatRecentCamps, quickChatTotalCount)}
            onToggleExpanded={() => toggleProjectGroup('quick-chat')}
            onSelectProject={() => onSelectProject(null)}
            onCreate={() => onCreateInProject(null)}
            onToggleCampPin={(camp) => void togglePin('camp', camp.id, camp)}
            onCopyCampId={(camp) => void copyCampId(camp)}
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
                <Dialog.Description>只修改侧栏标题，不改变会话的项目归属、队员或活动顺序。</Dialog.Description>
                <label className="field-label" htmlFor="rename-camp-title">标题<input id="rename-camp-title" autoFocus value={renameTitle} onChange={(event) => setRenameTitle(event.target.value)} disabled={actionBusy} /></label>
                <div className="dialog-actions"><Dialog.Close asChild><button className="quiet-button" type="button" disabled={actionBusy}>取消</button></Dialog.Close><button className="primary-button" type="submit" disabled={!renameTitle.trim() || actionBusy}>{actionBusy ? '保存中…' : '保存'}</button></div>
              </form>
            ) : action?.kind === 'delete' ? (
              <div>
                <Dialog.Title>永久删除“{action.camp.title}”？</Dialog.Title>
                <Dialog.Description>这会删除该会话的消息、队员连续性、运行记录和关联数据。此操作不能撤销，也不会删除本地项目目录。</Dialog.Description>
                {deleteBlockers.length > 0 && (
                  <div className="delete-blockers" role="alert">
                    <strong>当前还不能删除</strong>
                    <p>请先打开该对话，停止运行并处理未决审批或动作，然后重试。</p>
                    <ul>{deleteBlockers.map((blocker) => <li key={blocker.code}>{deleteBlockerLabel(blocker.code)}（{blocker.count}）</li>)}</ul>
                  </div>
                )}
                <div className="dialog-actions"><Dialog.Close asChild><button className="quiet-button" type="button" disabled={actionBusy}>取消</button></Dialog.Close>{deleteBlockers.some((blocker) => blocker.code === 'nonterminal_agent_run' || blocker.code === 'nonterminal_camp_turn') && <button className="quiet-button" type="button" onClick={() => void stopBlockingRuns()} disabled={actionBusy}>{actionBusy ? '正在请求停止…' : '停止运行'}</button>}{deleteBlockers.length > 0 && <button className="quiet-button" type="button" onClick={() => { onCamp(action.camp); setAction(null) }}>打开对话</button>}<button className="danger-button" type="button" onClick={() => void confirmDelete()} disabled={actionBusy}>{actionBusy ? '检查中…' : deleteBlockers.length > 0 ? '重新检查并删除' : '永久删除'}</button></div>
              </div>
            ) : action?.kind === 'remove_project' ? (
              <div>
                <Dialog.Title>从侧栏移除“{action.project.name}”？</Dialog.Title>
                <Dialog.Description>
                  项目会从这台 Mac 的侧栏隐藏，并取消项目及其中对话的置顶。不会删除本地目录、会话、消息、运行记录或审计；正在运行的执行也不会停止。之后重新选择同一工作目录即可恢复。
                </Dialog.Description>
                <div className="dialog-actions">
                  <Dialog.Close asChild><button className="quiet-button" type="button" disabled={actionBusy}>取消</button></Dialog.Close>
                  <button className="primary-button" type="button" onClick={() => void confirmProjectRemoval()} disabled={actionBusy}>{actionBusy ? '正在移除…' : '移除项目'}</button>
                </div>
              </div>
            ) : null}
            <Dialog.Close asChild><button className="dialog-close" aria-label="关闭" disabled={actionBusy}>×</button></Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}

type SettingsSidebarItem = {
  key: NavigationSettingsSection
  icon: string
  label: string
}

type SettingsSidebarGroup = {
  key: string
  label: string
  items: SettingsSidebarItem[]
}

const SETTINGS_SIDEBAR_GROUPS: SettingsSidebarGroup[] = [
  {
    key: 'application',
    label: '应用',
    items: [
      { key: 'general', icon: '⌂', label: '通用' },
      { key: 'appearance', icon: '◐', label: '外观' },
      { key: 'notifications', icon: '♢', label: '通知' }
    ]
  },
  {
    key: 'capabilities',
    label: '能力',
    items: [
      { key: 'skills', icon: '◇', label: 'Skill' },
      { key: 'mcp', icon: '⌘', label: 'MCP' },
      { key: 'runtime', icon: '◈', label: 'Agent 运行时' }
    ]
  },
  {
    key: 'support',
    label: '支持',
    items: [
      { key: 'diagnostics', icon: '⌁', label: '诊断与修复' }
    ]
  }
]

function SettingsSidebarNavigation({
  section,
  onSectionChange,
  onBack
}: {
  section: NavigationSettingsSection
  onSectionChange(section: NavigationSettingsSection): void
  onBack(): void
}): JSX.Element {
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
        {SETTINGS_SIDEBAR_GROUPS.map((group) => {
          const headingId = `settings-sidebar-group-${group.key}`
          return (
            <section className="settings-sidebar-group" aria-labelledby={headingId} key={group.key}>
              <h2 id={headingId} className="settings-sidebar-group-title">{group.label}</h2>
              {group.items.map((item) => (
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
            </section>
          )
        })}
      </nav>
    </div>
  )
}

function CommandPalette({
  open,
  onOpenChange,
  navigation,
  onCamp
}: {
  open: boolean
  onOpenChange(open: boolean): void
  navigation: NavigationSnapshot | null
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
        return camp.title.toLowerCase().includes(trimmedQuery)
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
                <span className="truncate">{camp.title}</span>
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
  visibleCount,
  projectExpanded,
  loadingMore,
  activeCampId,
  currentProject,
  createDisabled,
  pinned = false,
  onShowMore,
  onCollapseCamps,
  onToggleExpanded,
  onSelectProject,
  onCreate,
  onTogglePin,
  onRemoveProject,
  onToggleCampPin,
  onCopyCampId,
  onCamp,
  onAction
}: {
  groupKey: string
  pinTargetKey?: string
  label: string
  totalCount: number
  camps: NavigationCampItem[]
  visibleCount: number
  projectExpanded: boolean
  loadingMore: boolean
  activeCampId: string | null
  currentProject: boolean
  createDisabled: boolean
  pinned?: boolean
  onShowMore(): void
  onCollapseCamps(): void
  onToggleExpanded(): void
  onSelectProject(): void
  onCreate(): void
  onTogglePin?(): void
  onRemoveProject?(): void
  onToggleCampPin(camp: NavigationCampItem): void
  onCopyCampId(camp: NavigationCampItem): void
  onCamp(camp: NavigationCampItem): void
  onAction(kind: 'rename' | 'delete', camp: NavigationCampItem): void
}): JSX.Element {
  const projectMenuLabels = projectNavigationMenuLabels(pinned)
  const projectMenuItems: SidebarActionMenuItem[] = []
  if (onTogglePin) {
    projectMenuItems.push({
      key: 'toggle-pin',
      label: projectMenuLabels[0],
      icon: 'pin',
      filled: pinned,
      deferCloseAutoFocus: true,
      onSelect: onTogglePin
    })
  }
  if (onRemoveProject) {
    projectMenuItems.push({
      key: 'remove-project',
      label: projectMenuLabels[1],
      icon: 'remove',
      separatorBefore: projectMenuItems.length > 0,
      onSelect: onRemoveProject
    })
  }
  const contentId = `camp-group-content-${groupKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`
  const paginationControls = navigationPaginationControls(visibleCount, totalCount)
  return (
    <section className="camp-nav-group" data-group={groupKey}>
      <div className={`project-heading-row ${currentProject ? 'current-project' : ''}`} data-expanded={projectExpanded ? 'true' : 'false'}>
        <button
          className="project-select-row"
          type="button"
          title={label}
          aria-current={currentProject ? 'true' : undefined}
          aria-expanded={projectExpanded}
          aria-controls={contentId}
          data-sidebar-focus-target={`project-row:${groupKey}`}
          onClick={() => activateProjectNavigationRow(onSelectProject, onToggleExpanded)}
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
        </button>
        {pinTargetKey && projectMenuItems.length > 0 && (
          <SidebarActionMenu
            target={`project:${pinTargetKey}`}
            label={`管理项目“${label}”`}
            triggerClassName="group-menu-trigger"
            items={projectMenuItems}
          />
        )}
        <button className="group-create-button" type="button" aria-label={`在“${label}”中新建对话`} title="新建对话" disabled={createDisabled} onClick={onCreate}>＋</button>
      </div>
      <div id={contentId} className="camp-group-children" hidden={!projectExpanded}>
        {projectExpanded && camps.map((camp) => (
          <CampRow
            key={camp.id}
            camp={camp}
            active={camp.id === activeCampId}
            pinned={false}
            onTogglePin={() => onToggleCampPin(camp)}
            onCopyCampId={() => onCopyCampId(camp)}
            onCamp={onCamp}
            onAction={onAction}
          />
        ))}
        {projectExpanded && camps.length === 0 && totalCount === 0 && <p className="sidebar-empty">还没有对话</p>}
        {projectExpanded && (paginationControls.showMore || paginationControls.showCollapse) && (
          <div className="camp-pagination-actions">
            {paginationControls.showMore && <button className="show-more-camps" type="button" onClick={onShowMore} disabled={loadingMore}>{loadingMore ? '正在读取…' : '查看更多'}</button>}
            {paginationControls.showCollapse && <button className="collapse-camps" type="button" onClick={onCollapseCamps} disabled={loadingMore}>收起</button>}
          </div>
        )}
      </div>
    </section>
  )
}

function CampRow({
  camp,
  active,
  pinned,
  onTogglePin,
  onCopyCampId,
  onCamp,
  onAction
}: {
  camp: NavigationCampItem
  active: boolean
  pinned: boolean
  onTogglePin(): void
  onCopyCampId(): void
  onCamp(camp: NavigationCampItem): void
  onAction(kind: 'rename' | 'delete', camp: NavigationCampItem): void
}): JSX.Element {
  const title = camp.title
  const menuLabels = campNavigationMenuLabels(pinned)
  const menuItems: SidebarActionMenuItem[] = camp.activationState === 'pending'
    ? []
    : [{
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
      }]
  menuItems.push({
    key: 'copy-id',
    label: menuLabels[2],
    icon: 'copy',
    onSelect: onCopyCampId
  })
  menuItems.push({
    key: 'delete',
    label: menuLabels[3],
    icon: 'trash',
    danger: true,
    separatorBefore: true,
    onSelect: () => onAction('delete', camp)
  })
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
        {camp.activationState === 'pending' && <span className="camp-draft-badge">草稿</span>}
        {camp.marker === 'loading' && <span className="camp-loading-spinner camp-marker-loading" role="img" aria-label="正在运行" />}
      </button>
      <SidebarActionMenu
        target={`camp:${camp.id}`}
        label={`管理“${title}”`}
        triggerClassName="camp-menu-trigger"
        items={menuItems}
      />
    </div>
  )
}

type SidebarActionMenuItem = {
  key: string
  label: string
  icon: 'pin' | 'edit' | 'copy' | 'trash' | 'remove'
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
  if (kind === 'copy') {
    return <svg className="sidebar-action-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 6V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1" /></svg>
  }
  if (kind === 'remove') {
    return <svg className="sidebar-action-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6.5h14v11H5z" /><path d="M9 12h6" /></svg>
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
    nonterminal_camp_turn: '本轮协作仍未结束',
    pending_approval: '仍有待处理审批',
    unsettled_action: '仍有未收敛动作',
    pending_message_delivery: '仍有公共消息投递未完成',
    pending_runtime_delivery: '仍有 Agent 运行时结果待确认',
    active_worker_lease: '仍有执行器持有租约',
    unfinished_membership_change: '仍有队员变更未完成',
    unfinished_task_cancellation: '仍有任务取消未完成'
  } as Record<string, string>)[code] ?? code
}
