import { BusyLabel } from './BusyLabel'
import { useClosingSnapshot } from './use-closing-snapshot'
import { MoreMenuIcon, SidebarMenuIcon, type SidebarMenuIconKind } from './SidebarMenuIcon'
import { RovaiBrandMark } from './RovaiBrandMark'
import { TeamGlyph } from './MissionDefinitionEditor'
import { useShortcutAction, useShortcutLabel, useShortcuts } from './ShortcutProvider'
import { useThreadClient } from './camp-client'
import { useMobileLayout } from './MobileLayout'
import { useNavigationPressMenu } from './useNavigationPressMenu'
import { useProjectFolderDrag } from './use-project-folder-drag'
import { orderedPinnedProjects } from '../../shared/navigation-preferences-model'
import { ChatMemberPicker } from './ChatMemberPicker'
import { ChatListPanel, ChatSectionRail, type ChatNavigationProps } from './ChatNavigation'
import { navigationThreadHasUnread } from './navigation-unread'
import { useInterruptionAttention } from './thread-interruption-attention'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type JSX
} from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type {
  AppUpdateSnapshot,
  NavigationPin,
  NavigationProjectMove,
  NavigationThreadItem,
  NavigationThreadReadState,
  NavigationThreadTarget,
  NavigationThreadGroup,
  NavigationSnapshot,
  ProjectNavigationGroup,
  SettingsSection
} from '@contracts'
import {
  appUpdateBadgePresentation,
  type AppUpdateBadgePresentation
} from './app-update-presentation'
import { writeClipboardText } from './clipboard'
import {
  AppDialogBody,
  AppDialogContent,
  AppDialogFooter,
  AppDialogHeader
} from './AppDialog'
import { NavigationIcon, type NavigationIconName } from './NavigationIcon'
import { MissionIcon } from './MissionIcon'
import {
  shouldHandlePrimaryShortcut
} from './renderer-platform'
import { allNavigationThreads } from './ui-model'
import { NavigationSearchPanel } from './NavigationSearchPanel'
import type { NavigationSearchRow } from './camp-navigation-search'
import { NavigationTitle } from './NavigationTitle'
import { formatThreadTitle, normalizeThreadTitle, THREAD_TITLE_MAX_SCALARS } from './camp-title'
import { ProjectRenameDialog } from './ProjectRenameDialog'
import { normalizeFailure, reportOperationFailure } from './operation-failure'
import { createPortal } from 'react-dom'
import { useNavigationActionsHost, useNavigationCollapsed } from './NavigationShell'
import {
  NAVIGATION_INITIAL_VISIBLE_CAMPS,
  NAVIGATION_MORE_CAMPS_STEP,
  navigationGroupKey,
  type NavigationGroupLimits
} from './navigation-window-reader'
import { UiText, uiAttribute } from './interface-language'

export type NavigationSettingsSection = SettingsSection

/** One positioning request per visit, including across mobile drawer mounts. */
export interface NavigationRowReveal { status: 'pending' | 'expanding' | 'done' }

type NavigationAction = {
  kind: 'rename' | 'delete'
  thread: NavigationThreadItem
} | {
  kind: 'remove_project'
  project: ProjectNavigationGroup
} | null

export function campNavigationMenuLabels(pinned: boolean, unread = false): string[] {
  return [pinned ? uiAttribute('取消置顶') : uiAttribute('置顶'),
    unread ? uiAttribute('标记已读') : uiAttribute('标记未读'),
    uiAttribute('重命名'), uiAttribute('复制会话 ID'), uiAttribute('分叉'), uiAttribute('导出'), uiAttribute('删除')]
}

export async function copyThreadIdToClipboard(
  threadId: string,
  writeText: (text: string) => Promise<boolean> = writeClipboardText
): Promise<void> {
  let copied = false
  try {
    copied = await writeText(threadId)
  } catch {
    copied = false
  }
  if (!copied) throw new Error(uiAttribute('无法复制会话 ID，请重试。'))
}

export function projectNavigationMenuLabels(pinned: boolean, platform: NodeJS.Platform = 'darwin'): string[] {
  return [uiAttribute('新建对话'), pinned ? uiAttribute('取消置顶项目') : uiAttribute('置顶项目'),
    uiAttribute('重命名'), platform === 'darwin' ? uiAttribute('在 Finder 中显示') : uiAttribute('在文件管理器中显示'),
    uiAttribute('复制项目路径'), uiAttribute('移除项目')]
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

export function navigationPaginationControls(
  visibleCount: number,
  hasMore: boolean
): { showMore: boolean; showCollapse: boolean } {
  return {
    showMore: hasMore,
    showCollapse: visibleCount > NAVIGATION_INITIAL_VISIBLE_CAMPS
  }
}

export function navigationGroupWindow(
  group: NavigationThreadGroup,
  limit: number,
  pinnedThreadIds: ReadonlySet<string>,
  activeRow?: NavigationThreadItem,
  pinnedInGroup = 0
): { threads: NavigationThreadItem[]; windowCount: number; hasMore: boolean } {
  const unpinned = group.recentThreads.filter(thread => !pinnedThreadIds.has(thread.id))
  const threads = unpinned.slice(0, limit)
  const windowCount = threads.length
  if (activeRow && group.totalCount > 0 && !activeRow.archivedAt && !pinnedThreadIds.has(activeRow.id)
    && !threads.some(thread => thread.id === activeRow.id)) threads.push(activeRow)
  const pinnedCount = Math.max(pinnedInGroup, group.recentThreads.length - unpinned.length)
  return {
    threads, windowCount,
    hasMore: threads.length < group.totalCount - pinnedCount
  }
}

type ProjectOrdering = {
  registeredProjects: readonly string[]
  pinnedProjectOrder: readonly string[]
  move(request: NavigationProjectMove): void
}

type ProjectMoveActions = { up?: () => void; down?: () => void }

function projectMoveActions(projects: ProjectNavigationGroup[], registered: Set<string>, section: NavigationProjectMove['section'], ordering?: ProjectOrdering) {
  const actions = new Map<string, ProjectMoveActions>()
  if (!ordering) return actions
  const keys = projects.filter(project => registered.has(project.projectPath)).map(project => project.projectKey)
  keys.forEach((projectKey, index) => {
    const before = (beforeProjectKey: string | null) => ordering.move({ section, projectKey, beforeProjectKey })
    actions.set(projectKey, {
      up: index > 0 ? () => before(keys[index - 1]) : undefined,
      down: index + 1 < keys.length ? () => before(keys[index + 2] ?? null) : undefined
    })
  })
  return actions
}

export function ThreadNavigation({
  navigationId = 'global-navigation',
  chatNavigation,
  settingsNavigation,
  footer,
  view,
  state,
  disabled = false,
  navigation,
  groupLimits = {},
  onGroupLimitChange = async () => undefined,
  activeThreadId,
  openedNavigationRow,
  activeRowReveal,
  canLocateActiveRow = true,
  firstRunThreadId = null,
  openingThreadId = null,
  currentProjectKey = 'quick-chat',
  shellOnlyProjectPath = null,
  creatingConversation = false,
  pins = [],
  projectOrdering,
  pinnedThreadItems = [],
  pinReadIssue,
  onRetryPins,
  threadReadStates = {},
  onSetThreadUnread,
  onRevealProject,
  onProjectPathCopied = () => undefined,
  platform = 'darwin',
  settingsSection = 'general',
  updateSnapshot = null,
  onNewConversation,
  onMembers,
  onTeams = () => undefined,
  onAutomations = () => undefined,
  onMissions = () => undefined,
  unreadMissionCount = 0,
  onMemory,
  pendingMemoryCount,
  onSettings,
  onOpenUpdates = () => undefined,
  onSettingsSectionChange = () => undefined,
  onSettingsBack = () => undefined,
  onOpenProject,
  onSelectProject = () => undefined,
  onCreateInProject = () => undefined,
  onThread,
  onSearchResult,
  searchProjectPaths,
  onTogglePin = () => undefined,
  onRemoveProject,
  onRenameProject,
  onThreadIdCopied = () => undefined,
  onExportThread,
  onForkThread,
  forkBusy = false,
  onArchive,
  onRename,
  onDelete,
  onThreadUnavailable,
  onError
}: {
  navigationId?: string
  chatNavigation?: ChatNavigationProps
  settingsNavigation?: React.ReactNode
  footer?: React.ReactNode
  view: 'compose' | 'camp' | 'chat' | 'members' | 'teams' | 'automations' | 'missions' | 'memory' | 'settings'
  state: 'loading' | 'ready' | 'error'
  disabled?: boolean
  navigation: NavigationSnapshot | null
  groupLimits?: NavigationGroupLimits
  onGroupLimitChange?(groupKey: string, limit: number): Promise<void>
  activeThreadId: string | null
  openedNavigationRow?: NavigationThreadItem | null
  activeRowReveal?: NavigationRowReveal
  canLocateActiveRow?: boolean
  firstRunThreadId?: string | null
  openingThreadId?: string | null
  currentProjectKey?: string
  shellOnlyProjectPath?: string | null
  creatingConversation?: boolean
  pins?: NavigationPin[]
  projectOrdering?: ProjectOrdering
  pinnedThreadItems?: NavigationThreadItem[]
  pinReadIssue?: string | null
  onRetryPins?(): Promise<void>
  threadReadStates?: Record<string, NavigationThreadReadState>
  onSetThreadUnread?(thread: NavigationThreadItem, unread: boolean): Promise<void>
  onRevealProject?(project: ProjectNavigationGroup): Promise<void>
  onProjectPathCopied?(): void
  platform?: NodeJS.Platform
  settingsSection?: NavigationSettingsSection
  updateSnapshot?: AppUpdateSnapshot | null
  onNewConversation(): void
  onMembers(): void
  onTeams?(): void
  onAutomations?(): void
  onMissions?(): void
  unreadMissionCount?: number
  onMemory(): void
  pendingMemoryCount: number
  onSettings(): void
  onOpenUpdates?(): void
  onSettingsSectionChange?(section: NavigationSettingsSection): void
  onSettingsBack?(): void
  onOpenProject(): void
  onSelectProject?(project: ProjectNavigationGroup | null): void
  onCreateInProject?(project: ProjectNavigationGroup | null): void
  onThread(thread: NavigationThreadTarget): void
  onSearchResult?(row: NavigationSearchRow): void
  searchProjectPaths?: readonly string[]
  onTogglePin?(kind: NavigationPin['kind'], targetKey: string, thread?: NavigationThreadItem): void | Promise<void>
  onRenameProject?(project: ProjectNavigationGroup, name: string | null): Promise<void>
  onRemoveProject(project: ProjectNavigationGroup): Promise<void>
  onThreadIdCopied?(): void
  onExportThread?(thread: NavigationThreadItem): void
  onForkThread?(thread: NavigationThreadItem): void
  forkBusy?: boolean
  onRename(thread: NavigationThreadItem, title: string): Promise<void>
  onArchive?(thread: NavigationThreadItem): Promise<void>
  onDelete(thread: NavigationThreadItem): Promise<void>
  onThreadUnavailable?(thread: NavigationThreadItem, message: string): void
  onError(error: unknown): void
}): JSX.Element {
  const client = useThreadClient()
  const mobile = useMobileLayout()
  const actionsHost = useNavigationActionsHost()
  const collapsed = useNavigationCollapsed()
  const navigationCollapsed = !mobile && collapsed
  const settingsSidebar = view === 'settings' && !mobile
  const navigationScroll = useRef<HTMLDivElement>(null)
  useProjectFolderDrag(navigationScroll, disabled || settingsSidebar || navigationCollapsed ? undefined : projectOrdering?.move)
  const [collapsedProjectGroups, setCollapsedProjectGroups] = useState<Set<string>>(() => new Set())
  const [loadingGroups, setLoadingGroups] = useState<Set<string>>(() => new Set())
  const [action, setAction] = useState<NavigationAction>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [actionIssue, setActionIssue] = useState<{ code: string | null; message: string } | null>(null)
  const [renameProject, setRenameProject] = useState<ProjectNavigationGroup | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const normalizedRenameTitle = normalizeThreadTitle(renameTitle)
  const renameTitleLength = Array.from(normalizedRenameTitle).length
  const renameTooLong = renameTitleLength > THREAD_TITLE_MAX_SCALARS
  const renameInvalid = renameTooLong || actionIssue?.code === 'camp.name_too_long'
  const renameIssue = renameTooLong ? uiAttribute('对话名称最多 80 个字符。') : actionIssue?.message
  const renameCanSubmit = !!normalizedRenameTitle && !renameInvalid && !actionBusy
  const actionOpen = action !== null
  const actionView = useClosingSnapshot(actionOpen, {
    action, actionBusy, actionIssue, renameTitle, renameCanSubmit,
    renameInvalid, renameIssue, renameTooLong, renameTitleLength
  })
  const { action: displayedAction, actionBusy: displayedBusy } = actionView
  const [paletteOpen, setPaletteOpen] = useState(false)
  const loadingGroupsRef = useRef<Set<string>>(new Set())
  const navigationThreads = useMemo(
    () => navigation ? allNavigationThreads(navigation) : [],
    [navigation]
  )
  const campById = useMemo(() => new Map(
    [...pinnedThreadItems, ...navigationThreads].map((thread) => [thread.id, thread])
  ), [navigationThreads, pinnedThreadItems])
  const projectByKey = useMemo(
    () => new Map((navigation?.projects ?? []).map((project) => [project.projectKey, project])),
    [navigation]
  )
  const pinnedThreadIds = useMemo(
    () => new Set(pins.filter((pin) => pin.kind === 'camp').map((pin) => pin.targetKey)),
    [pins]
  )
  const pinnedThreads = pins
    .filter((pin) => pin.kind === 'camp')
    .flatMap((pin) => campById.get(pin.targetKey) ?? [])
    .filter(thread => !thread.archivedAt)
  const pinnedKeys = orderedPinnedProjects(pins, projectOrdering?.pinnedProjectOrder ?? [])
  const pinnedProjects = pinnedKeys.flatMap(key => projectByKey.get(key) ?? [])
  const pinnedProjectKeys = new Set(pinnedKeys)
  const ordinaryProjects = (navigation?.projects ?? []).filter(project => !pinnedProjectKeys.has(project.projectKey))
  const registered = new Set(projectOrdering?.registeredProjects)
  const pinnedMoves = projectMoveActions(pinnedProjects, registered, 'pinned', projectOrdering)
  const ordinaryMoves = projectMoveActions(ordinaryProjects, registered, 'projects', projectOrdering)
  const quickChatTotalCount = navigation?.quickChat.totalCount ?? 0
  const currentThreadId = view === 'camp' ? activeThreadId : null
  const activeRow = activeThreadId
    ? campById.get(activeThreadId) ?? (openedNavigationRow?.id === activeThreadId ? openedNavigationRow : undefined)
    : undefined
  const activeGroupKey = activeRow && !activeRow.archivedAt ? navigationGroupKey(activeRow) : null
  const activeGroupPins = activeGroupKey
    ? pinnedThreads.filter(thread => navigationGroupKey(thread) === activeGroupKey).length : 0
  const groupWindow = (groupKey: string, group: NavigationThreadGroup) => navigationGroupWindow(
    group, groupLimits[groupKey] ?? NAVIGATION_INITIAL_VISIBLE_CAMPS, pinnedThreadIds,
    groupKey === activeGroupKey ? activeRow : undefined, groupKey === activeGroupKey ? activeGroupPins : 0
  )
  const quickChatWindow = groupWindow('quick-chat', navigation?.quickChat ?? { recentThreads: [], totalCount: 0 })
  // The project used for new conversations can differ from the one being read.
  let highlightedProjectKey: string | null = currentProjectKey
  if (!mobile && activeRow && activeGroupKey) {
    const group = activeGroupKey === 'quick-chat' ? navigation?.quickChat : projectByKey.get(activeGroupKey)
    if (pinnedThreads.some(thread => thread.id === activeRow.id)) {
      highlightedProjectKey = null
    } else if (group && groupWindow(activeGroupKey, group).threads.some(thread => thread.id === activeRow.id)) {
      highlightedProjectKey = collapsedProjectGroups.has(activeGroupKey) ? activeGroupKey : null
    }
  }
  const updateBadge = appUpdateBadgePresentation(updateSnapshot)
  const managed = Boolean(useShortcuts())
  const jumpLabel = useShortcutLabel('jump', platform)
  const searchLabel = uiAttribute('搜索')
  useShortcutAction('jump', () => setPaletteOpen(open => !open), !disabled)

  useEffect(() => {
    if (disabled || managed) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      if (shouldHandlePrimaryShortcut(platform, event, 'K')) {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [disabled, platform, managed])

  const showMore = async (groupKey: string): Promise<void> => {
    if (loadingGroupsRef.current.has(groupKey)) return
    loadingGroupsRef.current = new Set(loadingGroupsRef.current).add(groupKey)
    setLoadingGroups(new Set(loadingGroupsRef.current))
    try {
      const currentLimit = groupLimits[groupKey] ?? NAVIGATION_INITIAL_VISIBLE_CAMPS
      await onGroupLimitChange(groupKey, currentLimit + (mobile ? NAVIGATION_INITIAL_VISIBLE_CAMPS : NAVIGATION_MORE_CAMPS_STEP))
    } catch (error) {
      onError(error)
    } finally {
      const nextLoading = new Set(loadingGroupsRef.current)
      nextLoading.delete(groupKey)
      loadingGroupsRef.current = nextLoading
      setLoadingGroups(new Set(nextLoading))
    }
  }

  const collapseGroupThreads = (groupKey: string): void => {
    void onGroupLimitChange(groupKey, NAVIGATION_INITIAL_VISIBLE_CAMPS).catch(onError)
  }

  const toggleProjectGroup = (groupKey: string): void => {
    setCollapsedProjectGroups((current) => toggleNavigationGroup(current, groupKey))
    if (collapsedProjectGroups.has(groupKey)
      || loadingGroupsRef.current.has(groupKey)
      || (groupLimits[groupKey] ?? NAVIGATION_INITIAL_VISIBLE_CAMPS) > NAVIGATION_INITIAL_VISIBLE_CAMPS) {
      collapseGroupThreads(groupKey)
    }
  }

  // Ignore the drawer's initial restoration. A subsequent scroll while the
  // row read is pending belongs to the user (including keys and scrollbar drag).
  useEffect(() => {
    const list = navigationScroll.current
    if (!activeThreadId || !activeRowReveal || !list) return
    const initialTop = list.scrollTop
    const onScroll = (): void => { if (list.scrollTop !== initialTop) activeRowReveal.status = 'done' }
    list.addEventListener('scroll', onScroll)
    return () => list.removeEventListener('scroll', onScroll)
  }, [activeRowReveal, activeThreadId])

  // A row read or an expanded group may arrive in a later commit.
  useEffect(() => {
    if (!activeRowReveal || activeRowReveal.status === 'done' || !activeThreadId) return
    if (navigationCollapsed) {
      activeRowReveal.status = 'done'
      return
    }
    const list = navigationScroll.current
    if (!canLocateActiveRow || !activeGroupKey || !list?.clientHeight) return
    const row = list.querySelector<HTMLElement>('.camp-nav-row.selected')
    if (row) {
      activeRowReveal.status = 'done'
      const bounds = list.getBoundingClientRect()
      const target = row.getBoundingClientRect()
      if (target.top < bounds.top) list.scrollTop += target.top - bounds.top
      else if (target.bottom > bounds.bottom) list.scrollTop += target.bottom - bounds.bottom
    } else if (activeRowReveal.status === 'pending' && !pinnedThreadIds.has(activeThreadId)
      && collapsedProjectGroups.has(activeGroupKey) && (activeGroupKey === 'quick-chat' || projectByKey.has(activeGroupKey))) {
      activeRowReveal.status = 'expanding'
      toggleProjectGroup(activeGroupKey)
    }
  })

  const cancelRowReveal = (): void => { if (activeRowReveal) activeRowReveal.status = 'done' }

  const togglePin = async (
    kind: NavigationPin['kind'],
    targetKey: string,
    thread?: NavigationThreadItem
  ): Promise<void> => {
    await onTogglePin(kind, targetKey, thread)
  }

  const copyThreadId = async (thread: NavigationThreadItem): Promise<void> => {
    try {
      await copyThreadIdToClipboard(thread.id)
      onThreadIdCopied()
    } catch (error) {
      onError(error)
    }
  }

  const copyProjectPath = async (project: ProjectNavigationGroup): Promise<void> => {
    try {
      if (!await writeClipboardText(project.projectPath)) throw new Error(uiAttribute('无法复制项目路径，请重试。'))
      onProjectPathCopied()
    } catch (error) { onError(error) }
  }

  const setThreadUnread = (thread: NavigationThreadItem, unread: boolean): void => {
    void onSetThreadUnread?.(thread, unread).catch(onError)
  }

  const openAction = (kind: 'rename' | 'delete' | 'archive', thread: NavigationThreadItem): void => {
    if (kind === 'archive') {
      void onArchive?.(thread).catch(onError)
      return
    }
    setAction({ kind, thread })
    setRenameTitle(thread.title)
    setActionIssue(null)
  }

  const openProjectRemoval = (project: ProjectNavigationGroup): void => {
    setAction({ kind: 'remove_project', project })
  }

  const closeAction = (): void => {
    if (actionBusy) return
    setAction(null)
  }

  const showThreadActionFailure = (operation: 'thread.rename' | 'thread.delete', thread: NavigationThreadItem, error: unknown): void => {
    const feedback = reportOperationFailure(operation, error, { presentation: 'detail' })
    if (feedback.outcome === 'gone' && onThreadUnavailable) {
      setAction(null)
      onThreadUnavailable(thread, feedback.message)
      return
    }
    setActionIssue({ code: normalizeFailure(error).code, message: feedback.message })
  }

  const submitRename = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!action || action.kind !== 'rename' || !renameCanSubmit) return
    setActionBusy(true)
    setActionIssue(null)
    try {
      await onRename(action.thread, normalizedRenameTitle)
      setAction(null)
    } catch (error) {
      showThreadActionFailure('thread.rename', action.thread, error)
    } finally {
      setActionBusy(false)
    }
  }

  const confirmDelete = async (): Promise<void> => {
    if (!action || action.kind !== 'delete' || actionBusy) return
    setActionBusy(true)
    setActionIssue(null)
    try {
      await onDelete(action.thread)
      setAction(null)
    } catch (error) {
      showThreadActionFailure('thread.delete', action.thread, error)
    } finally {
      setActionBusy(false)
    }
  }

  const confirmProjectRemoval = async (): Promise<void> => {
    if (!action || action.kind !== 'remove_project' || actionBusy) return
    setActionBusy(true)
    try {
      await onRemoveProject(action.project)
      setAction(null)
    } catch (error) {
      onError(error)
    } finally {
      setActionBusy(false)
    }
  }

  return (
    <>
      {chatNavigation && actionsHost && !mobile && !settingsSidebar && createPortal(<>
        <button className="navigation-collapse-button" type="button" aria-label={searchLabel}
          title={jumpLabel ? `${searchLabel}（${jumpLabel}）` : searchLabel} onClick={() => setPaletteOpen(true)}>
          <NavigationIcon name="search" />
        </button>
        {collapsed && view === 'chat' && <ChatMemberPicker {...chatNavigation} toolbar />}
        {collapsed && (view === 'camp' || view === 'compose') && <button className="navigation-collapse-button" type="button"
          aria-label={uiAttribute('新对话')} title={uiAttribute('新对话')} disabled={state !== 'ready' || creatingConversation}
          onClick={onNewConversation}><NavigationIcon name="square-pen" /></button>}
      </>, actionsHost)}
      <aside id={navigationId} className={`unified-sidebar ${chatNavigation ? 'has-chat-rail' : ''} ${settingsSidebar ? 'settings-navigation-mode' : ''}${navigationCollapsed ? ' is-collapsed' : ''}`} inert={disabled || (navigationCollapsed && !chatNavigation)} aria-label={settingsSidebar ? uiAttribute("设置分类") : uiAttribute("全局导航")}>
        {chatNavigation && <ChatSectionRail chat={chatNavigation} view={view} projects={chatNavigation.projects} missions={onMissions} automations={onAutomations} members={onMembers} teams={onTeams}
          settings={updateBadge ? onOpenUpdates : onSettings} missionUnread={unreadMissionCount > 0} update={updateBadge}/>}
        <div className="unified-sidebar-drag" aria-hidden="true" />
        <div className="unified-brand">
          <span className="rail-logo" role="img" aria-label="Rovai AI">
            <RovaiBrandMark className="rail-logo-mark" width={20} height={20} />
            <span><strong>Rovai AI</strong></span>
          </span>
          {!settingsSidebar && (
            <button
              className="rail-search-button"
              type="button"
              aria-label={uiAttribute('搜索对话、使命和消息')}
              title={jumpLabel ? `${searchLabel}（${jumpLabel}）` : searchLabel}
              onClick={() => setPaletteOpen(true)}
            >
              <NavigationIcon name="search" />
            </button>
          )}
        </div>
        {view === 'chat' && chatNavigation ? <ChatListPanel navigation={chatNavigation}/> : settingsSidebar
          ? (
              settingsNavigation ?? <SettingsSidebarNavigation
                groups={SETTINGS_SIDEBAR_GROUPS.map(group => ({ ...group, items: group.items.filter(item => (item.key !== 'channels' || client.channels) && (item.key !== 'shortcuts' || managed)) }))}
                section={settingsSection}
                updateBadge={updateBadge}
                pendingMemoryCount={pendingMemoryCount}
                onSectionChange={onSettingsSectionChange}
                onBack={onSettingsBack}
              />
            )
          : (
              <>
                <nav className="unified-primary-nav" aria-label={uiAttribute("主要页面")}>
                  <button className={`rail-button new-conversation-button ${view === 'compose' ? 'active' : ''}`} type="button" aria-label={uiAttribute("新对话")} title={uiAttribute("新对话")} onClick={onNewConversation} disabled={state !== 'ready' || creatingConversation}>
                    <span className="rail-glyph" aria-hidden="true"><NavigationIcon name="square-pen" /></span><span className="rail-label"><UiText zh={"新对话"} /></span>
                  </button>
                  <button className={`rail-button ${view === 'members' ? 'active' : ''}`} type="button" aria-current={view === 'members' ? 'page' : undefined} aria-label={uiAttribute("队员")} title={uiAttribute("队员")} onClick={onMembers}>
                    <span className="rail-glyph" aria-hidden="true"><NavigationIcon name="users" /></span><span className="rail-label"><UiText zh={"队员"} /></span>
                  </button>
                  <button className={`rail-button ${view === 'teams' ? 'active' : ''}`} type="button" aria-current={view === 'teams' ? 'page' : undefined} aria-label={uiAttribute('团队')} title={uiAttribute('团队')} onClick={onTeams}>
                    <span className="rail-glyph" aria-hidden="true"><TeamGlyph/></span><span className="rail-label">{uiAttribute('团队')}</span>
                  </button>
                  <button
                    className={`rail-button ${view === 'missions' ? 'active' : ''}`}
                    type="button"
                    aria-current={view === 'missions' ? 'page' : undefined}
                    aria-label={unreadMissionCount > 0 ? uiAttribute("使命板，{0} 个使命有未读回复", String(unreadMissionCount)) : uiAttribute("使命板")}
                    title={unreadMissionCount > 0 ? uiAttribute("使命板 · {0} 个使命有未读回复", String(unreadMissionCount)) : uiAttribute("使命板")}
                    onClick={onMissions}
                  >
                    <span className="rail-glyph" aria-hidden="true"><MissionIcon /></span><span className="rail-label"><UiText zh={"使命板"} /></span>
                    {unreadMissionCount > 0 && <i className="mission-rail-badge-dot" aria-hidden="true" />}
                  </button>
                  <button className={`rail-button ${view === 'automations' ? 'active' : ''}`} type="button" aria-current={view === 'automations' ? 'page' : undefined} aria-label={uiAttribute("定时任务")} title={uiAttribute("定时任务")} onClick={onAutomations}>
                    <span className="rail-glyph" aria-hidden="true"><NavigationIcon name="calendar-clock" /></span><span className="rail-label"><UiText zh={"定时任务"} /></span>
                  </button>
                </nav>

      <div className="navigation-scroll" ref={navigationScroll} onWheel={cancelRowReveal} onTouchMove={cancelRowReveal}
        onClickCapture={event => {
          if (event.target instanceof Element && event.target.closest('.project-select-row, .camp-pagination-actions')) cancelRowReveal()
        }}>
        {mobile && <header className="mobile-navigation-heading"><h2><UiText zh={"对话"} /></h2><div>
          <button className="mobile-icon-button" type="button" aria-label={uiAttribute("选择工作目录")} disabled={state !== 'ready'} onClick={onOpenProject}><NavigationIcon name="folder-open" /></button>
          <button className="mobile-icon-button" type="button" aria-label={uiAttribute("搜索对话、使命和消息")} onClick={() => setPaletteOpen(true)}><NavigationIcon name="search" /></button>
        </div></header>}
        {(pinnedThreads.length > 0 || pinnedProjects.length > 0 || pinReadIssue) && (
          <section className="pinned-navigation" aria-labelledby="pinned-heading" data-project-sort-section="pinned">
            <div className="sidebar-group-title navigation-section-title">
              <span id="pinned-heading"><UiText zh={"置顶"} /></span>
            </div>
            {pinReadIssue && <div className="inline-error" role="alert">
              <span>{pinReadIssue}</span>
              {onRetryPins && <button className="quiet-button compact" type="button" onClick={() => void onRetryPins()}><UiText zh="重试" /></button>}
            </div>}
            {pinnedThreads.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                firstRunThreadId={firstRunThreadId}
                readState={threadReadStates[thread.id]}
                onSetUnread={onSetThreadUnread ? (unread) => setThreadUnread(thread, unread) : undefined}
                active={thread.id === activeThreadId}
                current={thread.id === currentThreadId}
                opening={thread.id === openingThreadId}
                pinned
                onTogglePin={() => void togglePin('camp', thread.id, thread)}
                onCopyThreadId={() => void copyThreadId(thread)}
                onExport={onExportThread ? () => onExportThread(thread) : undefined}
                onFork={onForkThread ? () => onForkThread(thread) : undefined}
                forkBusy={forkBusy}
                onThread={onThread}
                onAction={openAction}
              />
            ))}
            {pinnedProjects.map((project) => {
              const groupKey = projectKey(project)
              const window = groupWindow(groupKey, project)
              return <ThreadGroup
                key={`pinned-${project.projectKey}`}
                groupKey={groupKey}
                pinTargetKey={project.projectKey}
                moveActions={pinnedMoves.get(project.projectKey)}
                label={project.name}
                totalCount={project.totalCount}
                {...window}
                projectExpanded={!collapsedProjectGroups.has(groupKey)}
                loadingMore={loadingGroups.has(groupKey)}
                activeThreadId={activeThreadId}
                currentThreadId={currentThreadId}
                firstRunThreadId={firstRunThreadId}
                openingThreadId={openingThreadId}
                currentProject={currentProjectKey === project.projectKey}
                highlighted={highlightedProjectKey === groupKey}
                createDisabled={creatingConversation}
                pinned
                onShowMore={() => void showMore(groupKey)}
                onCollapseThreads={() => collapseGroupThreads(groupKey)}
                onToggleExpanded={() => toggleProjectGroup(groupKey)}
                onSelectProject={() => onSelectProject(project)}
                onCreate={() => onCreateInProject(project)}
                onTogglePin={project.projectPath === shellOnlyProjectPath
                  ? undefined
                  : () => void togglePin('project', project.projectKey)}
                onRenameProject={onRenameProject ? () => setRenameProject(project) : undefined}
                onRemoveProject={() => openProjectRemoval(project)}
                onToggleThreadPin={(thread) => void togglePin('camp', thread.id, thread)}
                onCopyThreadId={(thread) => void copyThreadId(thread)}
                onExportThread={onExportThread}
                onForkThread={onForkThread}
                forkBusy={forkBusy}
                threadReadStates={threadReadStates}
                onSetThreadUnread={onSetThreadUnread ? setThreadUnread : undefined}
                platform={platform}
                onRevealProject={onRevealProject ? () => { void onRevealProject(project).catch(onError) } : undefined}
                onCopyProjectPath={() => void copyProjectPath(project)}
                onThread={onThread}
                onAction={openAction}
              />
            })}
          </section>
        )}
        <section className="navigation-projects" aria-labelledby="projects-heading" data-project-sort-section="projects">
          <div className="sidebar-group-title navigation-section-title"><span id="projects-heading"><UiText zh={"项目"} /></span><button className="section-create-button" type="button" aria-label={uiAttribute("选择工作目录")} title={uiAttribute("选择工作目录")} onClick={onOpenProject} disabled={state !== 'ready'}>＋</button></div>
          {ordinaryProjects.map((project) => {
            const groupKey = projectKey(project)
            const window = groupWindow(groupKey, project)
            return (
              <ThreadGroup
                key={project.projectKey}
                groupKey={groupKey}
                pinTargetKey={project.projectKey}
                moveActions={ordinaryMoves.get(project.projectKey)}
                label={project.name}
                totalCount={project.totalCount}
                {...window}
                projectExpanded={!collapsedProjectGroups.has(groupKey)}
                loadingMore={loadingGroups.has(groupKey)}
                activeThreadId={activeThreadId}
                currentThreadId={currentThreadId}
                firstRunThreadId={firstRunThreadId}
                openingThreadId={openingThreadId}
                currentProject={currentProjectKey === project.projectKey}
                highlighted={highlightedProjectKey === groupKey}
                createDisabled={creatingConversation}
                onShowMore={() => void showMore(groupKey)}
                onCollapseThreads={() => collapseGroupThreads(groupKey)}
                onToggleExpanded={() => toggleProjectGroup(groupKey)}
                onSelectProject={() => onSelectProject(project)}
                onCreate={() => onCreateInProject(project)}
                onTogglePin={project.projectPath === shellOnlyProjectPath
                  ? undefined
                  : () => void togglePin('project', project.projectKey)}
                onRenameProject={onRenameProject ? () => setRenameProject(project) : undefined}
                onRemoveProject={() => openProjectRemoval(project)}
                onToggleThreadPin={(thread) => void togglePin('camp', thread.id, thread)}
                onCopyThreadId={(thread) => void copyThreadId(thread)}
                onExportThread={onExportThread}
                onForkThread={onForkThread}
                forkBusy={forkBusy}
                threadReadStates={threadReadStates}
                onSetThreadUnread={onSetThreadUnread ? setThreadUnread : undefined}
                platform={platform}
                onRevealProject={onRevealProject ? () => { void onRevealProject(project).catch(onError) } : undefined}
                onCopyProjectPath={() => void copyProjectPath(project)}
                onThread={onThread}
                onAction={openAction}
              />
            )
          })}
          {navigation && navigation.projects.length === 0 && <p className="sidebar-empty"><UiText zh={"选择工作目录后，对话会在这里成组显示。"} /></p>}
          {navigation && <ThreadGroup
            groupKey="quick-chat"
            label={uiAttribute("快速对话")}
            totalCount={quickChatTotalCount}
            {...quickChatWindow}
            projectExpanded={!collapsedProjectGroups.has('quick-chat')}
            loadingMore={loadingGroups.has('quick-chat')}
            activeThreadId={activeThreadId}
            currentThreadId={currentThreadId}
            firstRunThreadId={firstRunThreadId}
            openingThreadId={openingThreadId}
            currentProject={currentProjectKey === 'quick-chat'}
            highlighted={highlightedProjectKey === 'quick-chat'}
            createDisabled={creatingConversation}
            onShowMore={() => void showMore('quick-chat')}
            onCollapseThreads={() => collapseGroupThreads('quick-chat')}
            onToggleExpanded={() => toggleProjectGroup('quick-chat')}
            onSelectProject={() => onSelectProject(null)}
            onCreate={() => onCreateInProject(null)}
            onToggleThreadPin={(thread) => void togglePin('camp', thread.id, thread)}
            onCopyThreadId={(thread) => void copyThreadId(thread)}
            onExportThread={onExportThread}
                onForkThread={onForkThread}
                forkBusy={forkBusy}
            threadReadStates={threadReadStates}
            onSetThreadUnread={onSetThreadUnread ? setThreadUnread : undefined}
            platform={platform}
            onThread={onThread}
            onAction={openAction}
          />}
        </section>
          </div>
      <div className="unified-sidebar-footer">
        {footer}
        <div className="sidebar-settings-entry" role="group" aria-label={uiAttribute("设置与应用更新")}>
          <button
            className={`rail-button sidebar-settings-main${mobile && view === 'settings' ? ' active' : ''}`}
            aria-current={mobile && view === 'settings' ? 'page' : undefined}
            type="button"
            aria-label={mobile ? uiAttribute("设置") : uiAttribute("设置，打开上次保留的设置页面")}
            onClick={() => {
              onSettings()
            }}
          >
            <span className="rail-glyph" aria-hidden="true"><NavigationIcon name="settings" /></span><span className="rail-label"><UiText zh={"设置"} /></span>
          </button>
          {pendingMemoryCount > 0 && <button type="button" className="team-memory-review-shortcut" aria-label={uiAttribute('记忆，{0} 条普通提案待确认', String(pendingMemoryCount))} title={uiAttribute('记忆，{0} 条普通提案待确认', String(pendingMemoryCount))} onClick={onMemory}><NavigationIcon name="brain"/><span>{pendingMemoryCount}</span></button>}
          {updateBadge && (
            <button
              className={`app-update-badge is-${updateBadge.kind}`}
              type="button"
              aria-label={uiAttribute("打开关于与更新，{0}", String(updateBadge.accessibleLabel))}
              title={updateBadge.accessibleLabel}
              onClick={() => {
                onOpenUpdates()
              }}
            >
              <UpdateBadgeIcon kind={updateBadge.kind} />
              <span>{updateBadge.label}</span>
            </button>
          )}
        </div>
      </div>
              </>
            )}
      </aside>

      {renameProject && onRenameProject && <ProjectRenameDialog project={renameProject} onClose={() => setRenameProject(null)} onSave={onRenameProject} />}

      {paletteOpen && <NavigationSearchPanel
        onClose={() => setPaletteOpen(false)}
        projects={navigation?.projects}
        missionProjectPaths={searchProjectPaths}
        firstRunThreadId={firstRunThreadId}
        onChoose={row => {
          setPaletteOpen(false)
          if (onSearchResult) onSearchResult(row)
          else onThread(row.target.thread)
        }}
      />}

      <Dialog.Root open={actionOpen} onOpenChange={(open) => { if (!open) closeAction() }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay app-dialog-overlay app-dialog-exits" />
          <AppDialogContent
            className="camp-action-dialog"
            exitMotion
            inert={!actionOpen}
            tone={displayedAction?.kind === 'delete' || displayedAction?.kind === 'remove_project' ? 'danger' : 'brand'}
          >
            {displayedAction?.kind === 'rename' ? (
              <>
                <AppDialogHeader
                  title={uiAttribute("重命名对话")}
                  description={uiAttribute("仅更新侧栏中的对话名称。项目归属、队员、消息与活动顺序保持不变。")}
                  icon="pencil"
                  closeDisabled={displayedBusy}
                  hideDescription
                />
                <form className="app-dialog-form" onSubmit={(event) => void submitRename(event)}>
                  <AppDialogBody>
                    <label className="field-label" htmlFor="rename-camp-title">
                      <UiText zh="对话名称" />
                      <input
                        id="rename-camp-title"
                        data-dialog-autofocus
                        autoComplete="off"
                        value={actionView.renameTitle}
                        readOnly={displayedBusy}
                        aria-invalid={actionView.renameInvalid}
                        aria-describedby={actionView.renameIssue ? 'rename-camp-error' : undefined}
                        onChange={(event) => { setRenameTitle(event.target.value); setActionIssue(null) }}
                        onKeyDown={(event) => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault() }}
                      />
                    </label>
                    {actionView.renameIssue && <div className="compact-field-meta">
                      <p id="rename-camp-error" className="compact-field-error" role="alert">{actionView.renameIssue}</p>
                      {actionView.renameTooLong && <span>{actionView.renameTitleLength} / {THREAD_TITLE_MAX_SCALARS}</span>}
                    </div>}
                  </AppDialogBody>
                  <AppDialogFooter>
                    <Dialog.Close asChild><button className="quiet-button" type="button" disabled={displayedBusy}><UiText zh={"取消"} /></button></Dialog.Close>
                    <button className="primary-button conversation-primary-button" type="submit" disabled={!actionView.renameCanSubmit} aria-busy={displayedBusy}>
                      <BusyLabel busy={displayedBusy}>{uiAttribute("保存名称")}</BusyLabel>
                    </button>
                  </AppDialogFooter>
                </form>
              </>
            ) : displayedAction?.kind === 'delete' ? (
              <>
                <AppDialogHeader
                  title={uiAttribute("删除对话？")}
                  description={uiAttribute("会一并删除此对话保存的附件，包含已编辑内容。原始工作区文件和外部引用文件不受影响。")}
                  icon="trash"
                  closeDisabled={displayedBusy}
                />
                {actionView.actionIssue && <AppDialogBody>
                  <p className="compact-inline-error" role="alert">{actionView.actionIssue.message}</p>
                </AppDialogBody>}
                <AppDialogFooter>
                  <Dialog.Close asChild><button className="quiet-button" type="button" autoFocus data-dialog-autofocus disabled={displayedBusy}><UiText zh={"取消"} /></button></Dialog.Close>
                  <button className="danger-button" type="button" onClick={() => void confirmDelete()} disabled={displayedBusy} aria-busy={displayedBusy}>
                    <BusyLabel busy={displayedBusy}>{uiAttribute("删除")}</BusyLabel>
                  </button>
                </AppDialogFooter>
              </>
            ) : displayedAction?.kind === 'remove_project' ? (
              <>
                <AppDialogHeader
                  title={uiAttribute("从侧栏移除“{0}”？", String(displayedAction.project.name))}
                  description={uiAttribute("文件、会话记录和正在进行的执行都会保留。重新选择同一目录即可恢复显示。")}
                  icon="folder"
                  closeDisabled={displayedBusy}
                />
                <AppDialogFooter>
                  <Dialog.Close asChild><button className="quiet-button" type="button" autoFocus data-dialog-autofocus disabled={displayedBusy}><UiText zh={"取消"} /></button></Dialog.Close>
                  <button className="danger-button" type="button" onClick={() => void confirmProjectRemoval()} disabled={displayedBusy} aria-busy={displayedBusy}>
                    <BusyLabel busy={displayedBusy}>{uiAttribute("移除")}</BusyLabel>
                  </button>
                </AppDialogFooter>
              </>
            ) : null}
          </AppDialogContent>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}

type SettingsSidebarItem<Section extends string> = {
  key: Section
  icon: NavigationIconName
  label: string
}

export type SettingsSidebarGroup<Section extends string = NavigationSettingsSection> = {
  key: string
  label: string
  items: SettingsSidebarItem<Section>[]
}

export const SETTINGS_SIDEBAR_GROUPS: SettingsSidebarGroup[] = [
  {
    key: 'application',
    label:"应用",
    items: [
      { key: 'general', icon: 'sliders-horizontal', label:"通用" },
      { key: 'memory', icon: 'brain', label: '记忆' },
      { key: 'appearance', icon: 'sun-moon', label:"外观" },
      { key: 'shortcuts', icon: 'keyboard', label: '快捷键' },
      { key: 'notifications', icon: 'bell-ring', label:"提醒" },
      { key: 'archive', icon: 'archive', label: "归档" }
    ]
  },
  {
    key: 'capabilities',
    label:"能力",
    items: [
      { key: 'runtime', icon: 'cpu', label:"智能体" },
      { key: 'mcp', icon: 'blocks', label: 'MCP' },
      { key: 'skills', icon: 'sparkles', label: 'Skills' },
      { key: 'toolbox', icon: 'briefcase-business', label:"工具箱" },
      { key: 'remote', icon: 'monitor-smartphone', label:"远程连接" },
      { key: 'channels', icon: 'radio-tower', label:"渠道" }
    ]
  },
  {
    key: 'support',
    label:"支持",
    items: [
      { key: 'monitoring', icon: 'chart-line', label:"运行监控" },
      { key: 'diagnostics', icon: 'stethoscope', label:"诊断与修复" },
      { key: 'about', icon: 'info', label:"关于与更新" }
    ]
  }
]

export function SettingsSidebarNavigation<Section extends string>({
  groups,
  section,
  updateBadge,
  pendingMemoryCount = 0,
  onSectionChange,
  onBack
}: {
  groups: SettingsSidebarGroup<Section>[]
  section: Section
  updateBadge: AppUpdateBadgePresentation | null
  pendingMemoryCount?: number
  onSectionChange(section: Section): void
  onBack(): void
}): JSX.Element {
  return (
    <div className="settings-sidebar-navigation">
      <div className="settings-sidebar-heading">
        <button className="settings-sidebar-back" type="button" onClick={onBack}>
          <span aria-hidden="true"><NavigationIcon name="arrow-left" /></span>
          <strong><UiText zh={"返回 App"} /></strong>
        </button>
      </div>
      <nav className="settings-sidebar-menu" aria-label={uiAttribute("设置页面")}>
        {groups.map((group) => {
          const headingId = `settings-sidebar-group-${group.key}`
          return (
            <section className="settings-sidebar-group" aria-labelledby={headingId} key={group.key}>
              <h2 id={headingId} className="settings-sidebar-group-title">{uiAttribute(group.label)}</h2>
              {group.items.map((item) => (
                <button
                  className={`${section === item.key ? 'active' : ''} ${item.key === 'about' && updateBadge ? 'has-update-badge' : ''}`.trim()}
                  type="button"
                  aria-current={section === item.key ? 'page' : undefined}
                  aria-label={item.key === 'about' && updateBadge
                    ? uiAttribute("关于与更新，{0}", String(updateBadge.accessibleLabel))
                    : undefined}
                  key={item.key}
                  onClick={() => onSectionChange(item.key)}
                >
                  <span className="settings-sidebar-icon" aria-hidden="true"><NavigationIcon name={item.icon} /></span>
                  <strong>{uiAttribute(item.label)}</strong>
                  {item.key === 'memory' && pendingMemoryCount > 0 && <span className="team-memory-count">{pendingMemoryCount}</span>}
                  {item.key === 'about' && updateBadge && (
                    <span
                      className={`app-update-badge settings-app-update-badge is-${updateBadge.kind}`}
                      aria-hidden="true"
                    >
                      <UpdateBadgeIcon kind={updateBadge.kind} />
                      <span>{updateBadge.label}</span>
                    </span>
                  )}
                </button>
              ))}
            </section>
          )
        })}
      </nav>
    </div>
  )
}

function UpdateBadgeIcon({
  kind
}: {
  kind: AppUpdateBadgePresentation['kind']
}): JSX.Element {
  if (kind === 'ready') {
    return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg>
  }
  if (kind === 'failed') {
    return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2 14 13H2ZM8 6v3m0 2h.01" /></svg>
  }
  if (kind === 'available') {
    return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8m0 0 3-3m-3 3L5 7M3 13h10" /></svg>
  }
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2a6 6 0 1 1-5.2 3" /></svg>
}

function ThreadGroup({
  groupKey,
  pinTargetKey,
  moveActions,
  label,
  totalCount,
  threads,
  windowCount,
  hasMore,
  projectExpanded,
  loadingMore,
  activeThreadId,
  currentThreadId,
  firstRunThreadId,
  openingThreadId,
  currentProject,
  highlighted,
  createDisabled,
  pinned = false,
  onShowMore,
  onCollapseThreads,
  onToggleExpanded,
  onSelectProject,
  onCreate,
  onTogglePin,
  onRemoveProject,
  onRenameProject,
  onToggleThreadPin,
  onCopyThreadId,
  onExportThread,
  onForkThread,
  forkBusy = false,
  threadReadStates,
  onSetThreadUnread,
  platform,
  onRevealProject,
  onCopyProjectPath,
  onThread,
  onAction
}: {
  groupKey: string
  pinTargetKey?: string
  moveActions?: ProjectMoveActions
  label: string
  totalCount: number
  threads: NavigationThreadItem[]
  windowCount: number
  hasMore: boolean
  projectExpanded: boolean
  loadingMore: boolean
  activeThreadId: string | null
  currentThreadId: string | null
  firstRunThreadId: string | null
  openingThreadId: string | null
  currentProject: boolean
  highlighted: boolean
  createDisabled: boolean
  pinned?: boolean
  onShowMore(): void
  onCollapseThreads(): void
  onToggleExpanded(): void
  onSelectProject(): void
  onCreate(): void
  onTogglePin?(): void
  onRenameProject?(): void
  onRemoveProject?(): void
  threadReadStates: Record<string, NavigationThreadReadState>
  onSetThreadUnread?(thread: NavigationThreadItem, unread: boolean): void
  platform: NodeJS.Platform
  onRevealProject?(): void
  onCopyProjectPath?(): void
  onToggleThreadPin(thread: NavigationThreadItem): void
  onCopyThreadId(thread: NavigationThreadItem): void
  onExportThread?(thread: NavigationThreadItem): void
  onForkThread?(thread: NavigationThreadItem): void
  forkBusy?: boolean
  onThread(thread: NavigationThreadItem): void
  onAction(kind: 'rename' | 'delete' | 'archive', thread: NavigationThreadItem): void
}): JSX.Element {
  const mobile = useMobileLayout()
  const projectMenuLabels = projectNavigationMenuLabels(pinned, platform)
  const folderButton = useRef<HTMLButtonElement>(null)
  function moveFocusedFolder(direction: keyof ProjectMoveActions) {
    const move = moveActions?.[direction]
    if (!move) return
    move()
    requestAnimationFrame(() => {
      folderButton.current?.focus({ preventScroll: true })
      folderButton.current?.scrollIntoView({ block: 'nearest' })
    })
  }
  const projectMenuItems: SidebarActionMenuItem[] = pinTargetKey
    ? [{ key: 'new-chat', label: projectMenuLabels[0], icon: 'square-pen', onSelect: onCreate, disabled: createDisabled }]
    : []
  if (onTogglePin) {
    projectMenuItems.push({
      key: 'toggle-pin',
      label: projectMenuLabels[1],
      separatorBefore: true,
      icon: 'pin',
      filled: pinned,
      onSelect: onTogglePin
    })
  }
  if (onRenameProject) {
    projectMenuItems.push({ key: 'rename-project', label: projectMenuLabels[2], icon: 'edit', onSelect: onRenameProject })
  }
  if (moveActions) {
    projectMenuItems.push(
      { key: 'move-up', label: uiAttribute('上移项目'), icon: 'move-up', disabled: !moveActions.up, separatorBefore: true, onSelect: () => moveActions.up?.() },
      { key: 'move-down', label: uiAttribute('下移项目'), icon: 'move-down', disabled: !moveActions.down, onSelect: () => moveActions.down?.() }
    )
  }
  if (onRevealProject) projectMenuItems.push({ key: 'reveal-project', label: projectMenuLabels[3], icon: 'reveal', separatorBefore: true, onSelect: onRevealProject })
  if (onCopyProjectPath) projectMenuItems.push({ key: 'copy-path', label: projectMenuLabels[4], icon: 'copy', separatorBefore: !onRevealProject, onSelect: onCopyProjectPath })
  if (onRemoveProject) {
    projectMenuItems.push({
      key: 'remove-project',
      label: projectMenuLabels[5],
      icon: 'remove',
      danger: true,
      separatorBefore: projectMenuItems.length > 0,
      onSelect: onRemoveProject
    })
  }
  const canMove = !!(moveActions?.up || moveActions?.down)
  const pressMenu = useNavigationPressMenu(!!pinTargetKey && projectMenuItems.length > 0, canMove ? '.project-folder-touch-target' : undefined)
  const contentId = `camp-group-content-${groupKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`
  const paginationControls = navigationPaginationControls(windowCount, hasMore)
  const hiddenSelection = highlighted && !mobile && !projectExpanded
    ? threads.find(thread => thread.id === activeThreadId) : undefined
  return (
    <section className="camp-nav-group" data-group={groupKey} data-project-sort-key={canMove ? pinTargetKey : undefined}>
      <div className={`project-heading-row ${currentProject ? 'current-project' : ''}`} data-menu-open={pressMenu.open || undefined}
        data-highlighted={highlighted || undefined}
        onContextMenu={(event) => { if (!event.defaultPrevented) pressMenu.rowProps.onContextMenu?.(event) }} data-expanded={projectExpanded ? 'true' : 'false'}>
        <button
          {...pressMenu.rowProps}
          ref={folderButton}
          className="project-select-row"
          aria-keyshortcuts={moveActions ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
          onKeyDown={event => {
            pressMenu.rowProps.onKeyDown?.(event)
            if (!moveActions || !event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault()
              moveFocusedFolder(event.key === 'ArrowUp' ? 'up' : 'down')
            }
          }}
          type="button"
          title={label}
          aria-current={currentProject ? 'true' : undefined}
          aria-description={hiddenSelection && uiAttribute('所选会话：{0}', formatThreadTitle(hiddenSelection, firstRunThreadId))}
          aria-expanded={projectExpanded}
          aria-controls={contentId}
          data-sidebar-focus-target={`project-row:${groupKey}`}
          onClick={() => activateProjectNavigationRow(onSelectProject, onToggleExpanded)}
        >
          <span className="project-folder-touch-target" aria-hidden="true">
            <svg className="project-folder-glyph" viewBox="0 0 24 24">
              <g className="project-folder-closed">
                <path className="folder-fill" d="M3.75 7.2c0-1.1.9-2 2-2h4.05l2.05 2.15h6.4c1.1 0 2 .9 2 2v7.4c0 1.1-.9 2-2 2H5.75c-1.1 0-2-.9-2-2Z" />
                <path d="M3.9 9.1h16.2" />
              </g>
              <g className="project-folder-open">
                <path d="M3.75 9V7.2c0-1.1.9-2 2-2h4.05l2.05 2.15h6.4c1.1 0 2 .9 2 2v1" />
                <path className="folder-fill" d="M6.55 9.8h13.7l-1.65 6.85a2 2 0 0 1-1.95 1.55H5.6a1.9 1.9 0 0 1-1.85-2.35l1.05-4.5A1.8 1.8 0 0 1 6.55 9.8Z" />
              </g>
            </svg>
          </span>
          <NavigationTitle>{label}</NavigationTitle>
        </button>
        {pinTargetKey && projectMenuItems.length > 0 && (
          <SidebarActionMenu
            target={`project:${pinTargetKey}`}
            label={uiAttribute("管理项目“{0}”", String(label))}
            triggerClassName="group-menu-trigger"
            items={projectMenuItems}
            pressMenu={pressMenu}
            mobile={mobile}
          />
        )}
        <button className="group-create-button" type="button" aria-label={uiAttribute("在“{0}”中新建对话", String(label))} title={uiAttribute("新建对话")} disabled={createDisabled} onClick={onCreate}><NavigationIcon name="square-pen" /></button>
      </div>
      <div id={contentId} className="camp-group-children" hidden={!projectExpanded}>
        {projectExpanded && threads.map((thread) => (
          <ThreadRow
            key={thread.id}
            thread={thread}
            firstRunThreadId={firstRunThreadId}
            readState={threadReadStates[thread.id]}
            onSetUnread={onSetThreadUnread ? (unread) => onSetThreadUnread(thread, unread) : undefined}
            active={thread.id === activeThreadId}
            current={thread.id === currentThreadId}
            opening={thread.id === openingThreadId}
            pinned={false}
            onTogglePin={() => onToggleThreadPin(thread)}
            onCopyThreadId={() => onCopyThreadId(thread)}
            onExport={onExportThread ? () => onExportThread(thread) : undefined}
                onFork={onForkThread ? () => onForkThread(thread) : undefined}
                forkBusy={forkBusy}
            onThread={onThread}
            onAction={onAction}
          />
        ))}
        {projectExpanded && threads.length === 0 && totalCount === 0 && <p className="sidebar-empty"><UiText zh={"还没有对话"} /></p>}
        {projectExpanded && (paginationControls.showMore || paginationControls.showCollapse) && (
          <div className="camp-pagination-actions">
            {paginationControls.showMore && <button className="show-more-camps" type="button" onClick={onShowMore} disabled={loadingMore}>{loadingMore ? uiAttribute("正在读取…") : uiAttribute("查看更多")}</button>}
            {paginationControls.showCollapse && <button className="collapse-camps" type="button" onClick={onCollapseThreads} disabled={loadingMore}><UiText zh={"收起"} /></button>}
          </div>
        )}
      </div>
    </section>
  )
}

function ThreadRow({
  thread,
  readState,
  onSetUnread,
  firstRunThreadId,
  active,
  current,
  opening,
  pinned,
  onTogglePin,
  onCopyThreadId,
  onExport,
  onFork,
  forkBusy = false,
  onThread,
  onAction
}: {
  thread: NavigationThreadItem
  readState?: NavigationThreadReadState
  onSetUnread?(unread: boolean): void
  firstRunThreadId: string | null
  active: boolean
  current: boolean
  opening: boolean
  pinned: boolean
  onTogglePin(): void
  onCopyThreadId(): void
  onExport?(): void
  onFork?(): void
  forkBusy?: boolean
  onThread(thread: NavigationThreadItem): void
  onAction(kind: 'rename' | 'delete' | 'archive', thread: NavigationThreadItem): void
}): JSX.Element {
  const mobile = useMobileLayout()
  const pressMenu = useNavigationPressMenu(true)
  const title = formatThreadTitle(thread, firstRunThreadId)
  const attention = useInterruptionAttention()
  const hasNewReply = navigationThreadHasUnread(thread, readState?.manualUnread ? { ...readState, manualUnread: false } : readState)
  const hasInterruption = attention?.snapshots[thread.id]?.unread ?? false
  const hasUnread = Boolean(readState?.manualUnread || hasNewReply || hasInterruption)
  const showDot = hasUnread
  const unreadLabel = [
    readState?.manualUnread ? uiAttribute('已标记未读') : '',
    hasNewReply ? uiAttribute('有新回复') : '',
    hasInterruption ? uiAttribute('有未查看的执行中断') : ''
  ].filter(Boolean).join('，')
  const loadingStatus = opening ? 'opening' : thread.marker === 'loading' ? 'loading' : null
  const status = loadingStatus && showDot ? `${loadingStatus}-unread` : loadingStatus ?? (showDot ? 'unread' : 'none')
  const menuLabels = campNavigationMenuLabels(pinned, hasUnread)
  const menuItems: SidebarActionMenuItem[] = thread.activationState === 'pending'
    ? []
    : [{
        key: 'toggle-pin',
        label: menuLabels[0],
        icon: 'pin',
        filled: pinned,
        onSelect: onTogglePin
      }, {
        key: 'rename',
        label: menuLabels[2],
        icon: 'edit',
        onSelect: () => onAction('rename', thread)
      }]
  if (onSetUnread) menuItems.splice(1, 0, {
    key: 'toggle-unread', label: menuLabels[1], icon: hasUnread ? 'read' : 'unread',
    onSelect: () => onSetUnread(!hasUnread)
  })
  menuItems.push({
    key: 'copy-id',
    label: menuLabels[3],
    icon: 'copy',
    onSelect: onCopyThreadId
  })
  if (onFork && thread.activationState !== 'pending') menuItems.push({
    key: 'fork', label: menuLabels[4], icon: 'fork', disabled: forkBusy, onSelect: onFork
  })
  if (onExport && thread.activationState !== 'pending') menuItems.push({
    key: 'export', label: menuLabels[5], icon: 'export', onSelect: onExport
  })
  if (thread.activationState === 'active' && !thread.archivedAt) menuItems.push({
    key: 'archive', label: uiAttribute('归档'), icon: 'archive', onSelect: () => onAction('archive', thread)
  })
  menuItems.push({
    key: 'delete',
    label: menuLabels[6],
    icon: 'trash',
    danger: true,
    separatorBefore: true,
    onSelect: () => onAction('delete', thread)
  })
  return (
    <div className={`camp-nav-row${active ? ' selected' : ''}${opening ? ' opening' : ''}`} data-thread-id={thread.id} data-menu-open={pressMenu.open || undefined}
      onContextMenu={(event) => { if (!event.defaultPrevented) pressMenu.rowProps.onContextMenu?.(event) }}>
      <button
        {...pressMenu.rowProps}
        className="camp-nav-open"
        type="button"
        aria-current={current ? 'page' : undefined}
        aria-busy={opening || undefined}
        aria-label={`${title}${unreadLabel ? `，${unreadLabel}` : ''}${opening ? uiAttribute("，正在打开") : thread.marker === 'loading' ? uiAttribute("，正在运行") : ''}`}
        title={`${title}${hasUnread ? uiAttribute(" · 未读") : ''}${opening ? uiAttribute(" · 正在打开") : loadingStatus ? uiAttribute(" · 正在运行") : ''}`}
        onClick={() => onThread(thread)}
      >
        {pinned && <span className="pinned-camp-icon" aria-hidden="true"><NavigationIcon name="messages" /></span>}
        <NavigationTitle selected={active}>{title}</NavigationTitle>
        {thread.activationState === 'pending' && <span className="camp-draft-badge"><UiText zh={"草稿"} /></span>}
        <span className="camp-status-cluster" data-status={status} aria-hidden="true">
          {showDot && <span className="camp-status-slot"><i className="camp-unread-dot" /></span>}
          {loadingStatus && <span className="camp-status-slot"><span className={`camp-loading-spinner ${opening ? 'camp-open-spinner' : 'camp-marker-loading'}`} /></span>}
        </span>
      </button>
      <SidebarActionMenu
        target={`thread:${thread.id}`}
        label={uiAttribute("管理“{0}”", String(title))}
        triggerClassName="camp-menu-trigger"
        items={menuItems}
        pressMenu={pressMenu}
        mobile={mobile}
      />
    </div>
  )
}

type SidebarActionMenuItem = {
  key: string
  label: string
  icon: SidebarMenuIconKind
  disabled?: boolean
  filled?: boolean
  danger?: boolean
  separatorBefore?: boolean
  onSelect(): void
}

function SidebarActionMenu({
  target,
  label,
  triggerClassName,
  items,
  pressMenu,
  mobile = false
}: {
  target: string
  label: string
  triggerClassName: string
  items: SidebarActionMenuItem[]
  pressMenu?: ReturnType<typeof useNavigationPressMenu>
  mobile?: boolean
}): JSX.Element {
  const restoreRowFocusOnClose = useRef(false)
  const trigger = (
    <button
      className={`sidebar-menu-trigger ${triggerClassName}${mobile ? ' mobile-context-trigger' : ''}`}
      type="button" aria-label={label} title={uiAttribute('更多操作')}
      data-sidebar-menu-target={target}
      data-state={pressMenu?.open ? 'open' : 'closed'}
      aria-haspopup="menu" aria-expanded={pressMenu?.open ?? false}
      onClick={pressMenu?.contextPoint ? () => pressMenu.setOpen(false) : undefined}
    >
      {mobile ? uiAttribute('操作') : <MoreMenuIcon />}
    </button>
  )
  return (
    <DropdownMenu.Root key={mobile ? 'mobile' : 'desktop'} open={pressMenu?.open} onOpenChange={pressMenu?.setOpen}>
      {pressMenu?.contextPoint ? <>
        {trigger}
        <DropdownMenu.Trigger asChild>
          <button className="sidebar-context-anchor" aria-hidden="true" tabIndex={-1}
            style={{ left: pressMenu.contextPoint.x, top: pressMenu.contextPoint.y }} />
        </DropdownMenu.Trigger>
      </> : <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>}
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          {...pressMenu?.menuProps}
          className="sidebar-action-menu"
          aria-label={label}
          align={pressMenu?.contextPoint ? 'start' : 'end'}
          sideOffset={pressMenu?.contextPoint ? 0 : 4}
          collisionPadding={8}
          loop
          onEscapeKeyDown={() => { restoreRowFocusOnClose.current = true }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const restoreRowFocus = restoreRowFocusOnClose.current
            restoreRowFocusOnClose.current = false
            // The modal focus trap must be released before returning to the row.
            if (restoreRowFocus) pressMenu?.restoreRowFocus()
          }}
        >
          {items.flatMap((item) => [
            item.separatorBefore
              ? <DropdownMenu.Separator className="sidebar-action-menu-separator" key={`${item.key}-separator`} />
              : null,
            <DropdownMenu.Item
              className={`sidebar-action-menu-item ${item.danger ? 'danger' : ''}`}
              key={item.key}
              disabled={item.disabled}
              onSelect={() => {
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

function projectKey(project: ProjectNavigationGroup): string {
  return project.projectKey
}
