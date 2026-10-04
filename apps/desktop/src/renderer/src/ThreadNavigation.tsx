import { useThreadClient } from './camp-client'
import { useMobileLayout } from './MobileLayout'
import { useNavigationPressMenu } from './useNavigationPressMenu'
import { navigationThreadHasUnread } from './navigation-unread'
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
  NavigationThreadItem,
  NavigationThreadReadState,
  NavigationThreadTarget,
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
  primaryShortcutLabel,
  shouldHandlePrimaryShortcut
} from './renderer-platform'
import { allNavigationThreads } from './ui-model'
import { navigationThreadSearch, startNavigationThreadLookup, type NavigationThreadLookup } from './camp-navigation-search'
import { formatThreadTitle } from './camp-title'
import { ProjectRenameDialog } from './ProjectRenameDialog'
import { useNavigationCollapsed } from './NavigationShell'
import {
  NAVIGATION_INITIAL_VISIBLE_CAMPS,
  NAVIGATION_MORE_CAMPS_STEP,
  type NavigationGroupLimits
} from './navigation-window-reader'
import { UiText, uiAttribute } from './interface-language'

export type NavigationSettingsSection = SettingsSection

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
    uiAttribute('重命名'), uiAttribute('复制会话 ID'), uiAttribute('删除')]
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
  totalCount: number
): { showMore: boolean; showCollapse: boolean } {
  return {
    showMore: visibleCount < totalCount,
    showCollapse: visibleCount > NAVIGATION_INITIAL_VISIBLE_CAMPS
  }
}

export function ThreadNavigation({
  navigationId = 'global-navigation',
  settingsNavigation,
  footer,
  view,
  state,
  disabled = false,
  navigation,
  groupLimits = {},
  onGroupLimitChange = async () => undefined,
  activeThreadId,
  firstRunThreadId = null,
  openingThreadId = null,
  currentProjectKey = 'quick-chat',
  shellOnlyProjectPath = null,
  creatingConversation = false,
  pins = [],
  pinnedThreadItems = [],
  threadReadStates = {},
  onSetThreadUnread,
  onRevealProject,
  onProjectPathCopied = () => undefined,
  platform = 'darwin',
  settingsSection = 'general',
  updateSnapshot = null,
  onNewConversation,
  onMembers,
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
  onTogglePin = () => undefined,
  onRemoveProject,
  onRenameProject,
  onThreadIdCopied = () => undefined,
  onRename,
  onDelete,
  onDeleteError,
  onError
}: {
  navigationId?: string
  settingsNavigation?: React.ReactNode
  footer?: React.ReactNode
  view: 'compose' | 'camp' | 'members' | 'automations' | 'missions' | 'memory' | 'settings'
  state: 'loading' | 'ready' | 'error'
  disabled?: boolean
  navigation: NavigationSnapshot | null
  groupLimits?: NavigationGroupLimits
  onGroupLimitChange?(groupKey: string, limit: number): Promise<void>
  activeThreadId: string | null
  firstRunThreadId?: string | null
  openingThreadId?: string | null
  currentProjectKey?: string
  shellOnlyProjectPath?: string | null
  creatingConversation?: boolean
  pins?: NavigationPin[]
  pinnedThreadItems?: NavigationThreadItem[]
  threadReadStates?: Record<string, NavigationThreadReadState>
  onSetThreadUnread?(thread: NavigationThreadItem, unread: boolean): Promise<void>
  onRevealProject?(project: ProjectNavigationGroup): Promise<void>
  onProjectPathCopied?(): void
  platform?: NodeJS.Platform
  settingsSection?: NavigationSettingsSection
  updateSnapshot?: AppUpdateSnapshot | null
  onNewConversation(): void
  onMembers(): void
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
  onTogglePin?(kind: NavigationPin['kind'], targetKey: string, thread?: NavigationThreadItem): void | Promise<void>
  onRenameProject?(project: ProjectNavigationGroup, name: string | null): Promise<void>
  onRemoveProject(project: ProjectNavigationGroup): Promise<void>
  onThreadIdCopied?(): void
  onRename(thread: NavigationThreadItem, title: string): Promise<void>
  onDelete(thread: NavigationThreadItem): Promise<void>
  onDeleteError?(error: unknown): void
  onError(error: unknown): void
}): JSX.Element {
  const client = useThreadClient()
  const mobile = useMobileLayout()
  const collapsed = useNavigationCollapsed()
  const navigationCollapsed = !mobile && collapsed
  const [collapsedProjectGroups, setCollapsedProjectGroups] = useState<Set<string>>(() => new Set())
  const [loadingGroups, setLoadingGroups] = useState<Set<string>>(() => new Set())
  const [action, setAction] = useState<NavigationAction>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [renameProject, setRenameProject] = useState<ProjectNavigationGroup | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
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
  const pinnedProjects = pins
    .filter((pin) => pin.kind === 'project')
    .flatMap((pin) => projectByKey.get(pin.targetKey) ?? [])
  const quickChatRecentThreads = navigation?.quickChat.recentThreads ?? []
  const quickChatTotalCount = navigation?.quickChat.totalCount ?? 0
  const visibleCount = (groupKey: string, threads: readonly NavigationThreadItem[]): number => Math.min(
    threads.length,
    groupLimits[groupKey] ?? NAVIGATION_INITIAL_VISIBLE_CAMPS
  )
  const quickChatVisibleCount = visibleCount('quick-chat', quickChatRecentThreads)
  const updateBadge = appUpdateBadgePresentation(updateSnapshot)

  useEffect(() => {
    if (disabled) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      if (shouldHandlePrimaryShortcut(platform, event, 'K')) {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [disabled, platform])

  const showMore = async (
    groupKey: string,
    currentCount: number
  ): Promise<void> => {
    if (loadingGroupsRef.current.has(groupKey)) return
    loadingGroupsRef.current = new Set(loadingGroupsRef.current).add(groupKey)
    setLoadingGroups(new Set(loadingGroupsRef.current))
    try {
      await onGroupLimitChange(groupKey, currentCount + (mobile ? NAVIGATION_INITIAL_VISIBLE_CAMPS : NAVIGATION_MORE_CAMPS_STEP))
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
  }

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

  const openAction = (kind: 'rename' | 'delete', thread: NavigationThreadItem): void => {
    setAction({ kind, thread })
    setRenameTitle(thread.title)
  }

  const openProjectRemoval = (project: ProjectNavigationGroup): void => {
    setAction({ kind: 'remove_project', project })
  }

  const closeAction = (): void => {
    if (actionBusy) return
    setAction(null)
  }

  const submitRename = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!action || action.kind !== 'rename' || !renameTitle.trim() || actionBusy) return
    setActionBusy(true)
    try {
      await onRename(action.thread, renameTitle)
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
      await onDelete(action.thread)
      setAction(null)
    } catch (error) {
      ;(onDeleteError ?? onError)(error)
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
      <aside id={navigationId} className={`unified-sidebar ${view === 'settings' && !mobile ? 'settings-navigation-mode' : ''}${navigationCollapsed ? ' is-collapsed' : ''}`} inert={disabled || navigationCollapsed} aria-label={view === 'settings' && !mobile ? uiAttribute("设置分类") : uiAttribute("全局导航")}>
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
        </div>
        {view === 'settings' && !mobile
          ? (
              settingsNavigation ?? <SettingsSidebarNavigation
                groups={SETTINGS_SIDEBAR_GROUPS.map(group => ({ ...group, items: group.items.filter(item => item.key !== 'channels' || client.channels) }))}
                section={settingsSection}
                updateBadge={updateBadge}
                onSectionChange={onSettingsSectionChange}
                onBack={onSettingsBack}
              />
            )
          : (
              <>
                <nav className="unified-primary-nav" aria-label={uiAttribute("主要页面")}>
                  <button className={`rail-button ${view === 'compose' ? 'active' : ''}`} type="button" aria-label={uiAttribute("新对话")} title={uiAttribute("新对话")} onClick={onNewConversation} disabled={state !== 'ready' || creatingConversation}>
                    <span className="rail-glyph" aria-hidden="true"><NavigationIcon name="square-pen" /></span><span className="rail-label"><UiText zh={"新对话"} /></span>
                  </button>
                  <button className={`rail-button ${view === 'members' ? 'active' : ''}`} type="button" aria-current={view === 'members' ? 'page' : undefined} aria-label={uiAttribute("队员")} title={uiAttribute("队员")} onClick={onMembers}>
                    <span className="rail-glyph" aria-hidden="true"><NavigationIcon name="users" /></span><span className="rail-label"><UiText zh={"队员"} /></span>
                  </button>
                  <button
                    className={`rail-button ${view === 'memory' ? 'active' : ''}`}
                    type="button"
                    aria-current={view === 'memory' ? 'page' : undefined}
                    aria-label={pendingMemoryCount > 0 ? uiAttribute("记忆，{0} 条普通提案待确认", String(pendingMemoryCount)) : uiAttribute("记忆")}
                    title={pendingMemoryCount > 0 ? uiAttribute("记忆 · {0} 条普通提案待确认", String(pendingMemoryCount)) : uiAttribute("记忆")}
                    onClick={onMemory}
                  >
                    <span className="rail-glyph" aria-hidden="true"><NavigationIcon name="brain" /></span><span className="rail-label"><UiText zh={"记忆"} /></span>
                    {pendingMemoryCount > 0 && <i className="rail-badge-dot" aria-hidden="true" />}
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
                <button className="conversation-jump" type="button" onClick={() => setPaletteOpen(true)}>
                  <span><UiText zh={"跳转到对话…"} /></span><kbd aria-hidden="true">{primaryShortcutLabel(platform, 'K')}</kbd>
                </button>

      <div className="navigation-scroll">
        {mobile && <header className="mobile-navigation-heading"><h2><UiText zh={"对话"} /></h2><div>
          <button className="mobile-icon-button" type="button" aria-label={uiAttribute("选择工作目录")} disabled={state !== 'ready'} onClick={onOpenProject}><NavigationIcon name="folder-open" /></button>
          <button className="mobile-icon-button" type="button" aria-label={uiAttribute("搜索对话")} onClick={() => setPaletteOpen(true)}><NavigationIcon name="search" /></button>
        </div></header>}
        {(pinnedThreads.length > 0 || pinnedProjects.length > 0) && (
          <section className="pinned-navigation" aria-labelledby="pinned-heading">
            <div className="sidebar-group-title navigation-section-title">
              <span id="pinned-heading"><UiText zh={"置顶"} /></span>
            </div>
            {pinnedThreads.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                firstRunThreadId={firstRunThreadId}
                readState={threadReadStates[thread.id]}
                onSetUnread={onSetThreadUnread ? (unread) => setThreadUnread(thread, unread) : undefined}
                active={thread.id === activeThreadId}
                opening={thread.id === openingThreadId}
                pinned
                onTogglePin={() => void togglePin('camp', thread.id, thread)}
                onCopyThreadId={() => void copyThreadId(thread)}
                onThread={onThread}
                onAction={openAction}
              />
            ))}
            {pinnedProjects.map((project) => {
              const groupKey = projectKey(project)
              const count = visibleCount(groupKey, project.recentThreads)
              return <ThreadGroup
                key={`pinned-${project.projectKey}`}
                groupKey={groupKey}
                pinTargetKey={project.projectKey}
                label={project.name}
                totalCount={project.totalCount}
                visibleCount={count}
                threads={project.recentThreads.slice(0, count)
                  .filter((thread) => !pinnedThreadIds.has(thread.id))}
                projectExpanded={!collapsedProjectGroups.has(groupKey)}
                loadingMore={loadingGroups.has(groupKey)}
                activeThreadId={activeThreadId}
                firstRunThreadId={firstRunThreadId}
                openingThreadId={openingThreadId}
                currentProject={currentProjectKey === project.projectKey}
                createDisabled={creatingConversation}
                pinned
                onShowMore={() => void showMore(groupKey, count)}
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
        <section className="navigation-projects" aria-labelledby="projects-heading">
          <div className="sidebar-group-title navigation-section-title"><span id="projects-heading"><UiText zh={"项目"} /></span><button className="section-create-button" type="button" aria-label={uiAttribute("选择工作目录")} title={uiAttribute("选择工作目录")} onClick={onOpenProject} disabled={state !== 'ready'}>＋</button></div>
          {navigation?.projects.map((project) => {
            const groupKey = projectKey(project)
            if (pins.some((pin) => pin.kind === 'project' && pin.targetKey === project.projectKey)) return null
            const count = visibleCount(groupKey, project.recentThreads)
            return (
              <ThreadGroup
                key={project.projectKey}
                groupKey={groupKey}
                pinTargetKey={project.projectKey}
                label={project.name}
                totalCount={project.totalCount}
                visibleCount={count}
                threads={project.recentThreads.slice(0, count)
                  .filter((thread) => !pinnedThreadIds.has(thread.id))}
                projectExpanded={!collapsedProjectGroups.has(groupKey)}
                loadingMore={loadingGroups.has(groupKey)}
                activeThreadId={activeThreadId}
                firstRunThreadId={firstRunThreadId}
                openingThreadId={openingThreadId}
                currentProject={currentProjectKey === project.projectKey}
                createDisabled={creatingConversation}
                pinned={pins.some((pin) => pin.kind === 'project' && pin.targetKey === project.projectKey)}
                onShowMore={() => void showMore(groupKey, count)}
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
            visibleCount={quickChatVisibleCount}
            threads={quickChatRecentThreads.slice(0, quickChatVisibleCount)
              .filter((thread) => !pinnedThreadIds.has(thread.id))}
            projectExpanded={!collapsedProjectGroups.has('quick-chat')}
            loadingMore={loadingGroups.has('quick-chat')}
            activeThreadId={activeThreadId}
            firstRunThreadId={firstRunThreadId}
            openingThreadId={openingThreadId}
            currentProject={currentProjectKey === 'quick-chat'}
            createDisabled={creatingConversation}
            onShowMore={() => void showMore('quick-chat', quickChatVisibleCount)}
            onCollapseThreads={() => collapseGroupThreads('quick-chat')}
            onToggleExpanded={() => toggleProjectGroup('quick-chat')}
            onSelectProject={() => onSelectProject(null)}
            onCreate={() => onCreateInProject(null)}
            onToggleThreadPin={(thread) => void togglePin('camp', thread.id, thread)}
            onCopyThreadId={(thread) => void copyThreadId(thread)}
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

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        navigation={navigation}
        firstRunThreadId={firstRunThreadId}
        onThread={(thread) => {
          setPaletteOpen(false)
          onThread(thread)
        }}
      />

      <Dialog.Root open={action !== null} onOpenChange={(open) => { if (!open) closeAction() }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
          <AppDialogContent
            className="camp-action-dialog"
            tone={action?.kind === 'delete' || action?.kind === 'remove_project' ? 'danger' : 'brand'}
          >
            {action?.kind === 'rename' ? (
              <>
                <AppDialogHeader
                  title={uiAttribute("重命名对话")}
                  description={uiAttribute("仅更新侧栏中的对话名称。项目归属、队员、消息与活动顺序保持不变。")}
                  icon="pencil"
                  closeDisabled={actionBusy}
            hideDescription
                />
                <form className="app-dialog-form" onSubmit={(event) => void submitRename(event)}>
                  <AppDialogBody>
                    <label className="field-label" htmlFor="rename-camp-title"><UiText zh={"对话名称"} /><input id="rename-camp-title" autoFocus data-dialog-autofocus value={renameTitle} onChange={(event) => setRenameTitle(event.target.value)} disabled={actionBusy} /></label>
                  </AppDialogBody>
                  <AppDialogFooter>
                    <Dialog.Close asChild><button className="quiet-button" type="button" disabled={actionBusy}><UiText zh={"取消"} /></button></Dialog.Close>
                    <button className="primary-button conversation-primary-button" type="submit" disabled={!renameTitle.trim() || actionBusy}>{actionBusy ? uiAttribute("保存中…") : uiAttribute("保存名称")}</button>
                  </AppDialogFooter>
                </form>
              </>
            ) : action?.kind === 'delete' ? (
              <>
                <AppDialogHeader
                  title={uiAttribute("删除对话？")}
                  description={uiAttribute("会一并删除此对话保存的附件，包含已编辑内容。原始工作区文件和外部引用文件不受影响。")}
                  icon="trash"
                  closeDisabled={actionBusy}
                />
                <AppDialogFooter>
                  <Dialog.Close asChild><button className="quiet-button" type="button" autoFocus data-dialog-autofocus disabled={actionBusy}><UiText zh={"取消"} /></button></Dialog.Close>
                  <button className="danger-button" type="button" onClick={() => void confirmDelete()} disabled={actionBusy}>{actionBusy ? uiAttribute("正在删除…") : uiAttribute("删除")}</button>
                </AppDialogFooter>
              </>
            ) : action?.kind === 'remove_project' ? (
              <>
                <AppDialogHeader
                  title={uiAttribute("从侧栏移除“{0}”？", String(action.project.name))}
                  description={uiAttribute("文件、会话记录和正在进行的执行都会保留。重新选择同一目录即可恢复显示。")}
                  icon="folder"
                  closeDisabled={actionBusy}
                />
                <AppDialogFooter>
                  <Dialog.Close asChild><button className="quiet-button" type="button" autoFocus data-dialog-autofocus disabled={actionBusy}><UiText zh={"取消"} /></button></Dialog.Close>
                  <button className="danger-button" type="button" onClick={() => void confirmProjectRemoval()} disabled={actionBusy}>{actionBusy ? uiAttribute("正在移除…") : uiAttribute("移除")}</button>
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
      { key: 'appearance', icon: 'sun-moon', label:"外观" },
      { key: 'notifications', icon: 'bell-ring', label:"提醒" }
    ]
  },
  {
    key: 'capabilities',
    label:"能力",
    items: [
      { key: 'mcp', icon: 'blocks', label: 'MCP' },
      { key: 'skills', icon: 'sparkles', label: 'Skills' },
      { key: 'toolbox', icon: 'briefcase-business', label:"工具箱" },
      { key: 'runtime', icon: 'cpu', label:"智能体" },
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
  onSectionChange,
  onBack
}: {
  groups: SettingsSidebarGroup<Section>[]
  section: Section
  updateBadge: AppUpdateBadgePresentation | null
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
        <div className="settings-sidebar-title">
          <strong><UiText zh={"设置"} /></strong>
          <span><UiText zh={"应用级偏好与本机能力"} /></span>
        </div>
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
                  <span aria-hidden="true"><NavigationIcon name={item.icon} /></span>
                  <strong>{uiAttribute(item.label)}</strong>
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

function CommandPalette({
  open,
  onOpenChange,
  navigation,
  firstRunThreadId,
  onThread
}: {
  open: boolean
  onOpenChange(open: boolean): void
  navigation: NavigationSnapshot | null
  firstRunThreadId: string | null
  onThread(thread: NavigationThreadTarget): void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const projectNameByPath = useMemo(
    () => new Map((navigation?.projects ?? []).map((project) => [project.projectPath, project.name])),
    [navigation]
  )
  const threads = useMemo(() => navigation ? allNavigationThreads(navigation) : [], [navigation])
  const search = navigationThreadSearch(query, threads, projectNameByPath, firstRunThreadId)
  const threadId = search.kind === 'id' ? search.threadId : null
  const [lookup, setLookup] = useState<NavigationThreadLookup | null>(null)
  const currentLookup = lookup?.threadId === threadId ? lookup : null
  const loading = threadId !== null && currentLookup === null
  const error = threadId !== null ? currentLookup?.error : null
  const visible = search.kind === 'text'
    ? search.threads
    : currentLookup?.thread ? [currentLookup.thread] : []

  useEffect(() => {
    setLookup(null)
    if (!open || threadId === null) return
    return startNavigationThreadLookup(threadId, setLookup)
  }, [open, threadId])

  const selectedIndex = Math.min(activeIndex, Math.max(visible.length - 1, 0))

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
        <Dialog.Content className="command-palette" onCloseAutoFocus={(event) => event.preventDefault()}>
          <Dialog.Title className="command-palette-title"><UiText zh={"跳转到对话"} /></Dialog.Title>
          <Dialog.Description className="sr-only"><UiText zh={"输入对话或项目关键字，或粘贴完整会话 ID 精确查找；方向键选择，回车打开。"} /></Dialog.Description>
          <input
            className="command-palette-input"
            autoFocus
            value={query}
            placeholder={uiAttribute("搜索对话、项目或完整会话 ID…")}
            aria-label={uiAttribute("搜索对话")}
            onChange={(event) => {
              setQuery(event.target.value)
              setActiveIndex(0)
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveIndex((index) => Math.min(index + 1, Math.max(visible.length - 1, 0)))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveIndex((index) => Math.max(index - 1, 0))
              } else if (event.key === 'Enter' && visible[selectedIndex]) {
                event.preventDefault()
                onThread(visible[selectedIndex])
              }
            }}
          />
          <div className="command-palette-list" aria-label={uiAttribute("匹配的对话")} aria-busy={loading}>
            {visible.map((thread, index) => (
              <button
                className={`command-palette-item ${index === selectedIndex ? 'active' : ''}`}
                type="button"
                key={thread.id}
                onClick={() => onThread(thread)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span className="truncate" title={formatThreadTitle(thread, firstRunThreadId)}>{formatThreadTitle(thread, firstRunThreadId)}</span>
                <small>{thread.projectBindingKind === 'directory' ? projectNameByPath.get(thread.projectPath) ?? uiAttribute('项目') : uiAttribute("快速对话")}</small>
              </button>
            ))}
            {visible.length === 0 && (
              <p className="command-palette-empty" role="status">
                {loading ? uiAttribute("正在查找会话…") : error ? uiAttribute(error) : uiAttribute("没有匹配的对话。")}
              </p>
            )}
          </div>
          <footer className="command-palette-footer"><span><kbd>↑ ↓</kbd><UiText zh={" 选择"} /></span><span><kbd>↵</kbd><UiText zh={" 打开"} /></span><span><kbd>Esc</kbd><UiText zh={" 关闭"} /></span></footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ThreadGroup({
  groupKey,
  pinTargetKey,
  label,
  totalCount,
  threads,
  visibleCount,
  projectExpanded,
  loadingMore,
  activeThreadId,
  firstRunThreadId,
  openingThreadId,
  currentProject,
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
  label: string
  totalCount: number
  threads: NavigationThreadItem[]
  visibleCount: number
  projectExpanded: boolean
  loadingMore: boolean
  activeThreadId: string | null
  firstRunThreadId: string | null
  openingThreadId: string | null
  currentProject: boolean
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
  onThread(thread: NavigationThreadItem): void
  onAction(kind: 'rename' | 'delete', thread: NavigationThreadItem): void
}): JSX.Element {
  const mobile = useMobileLayout()
  const projectMenuLabels = projectNavigationMenuLabels(pinned, platform)
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
  const pressMenu = useNavigationPressMenu(!!pinTargetKey && projectMenuItems.length > 0)
  const contentId = `camp-group-content-${groupKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`
  const paginationControls = navigationPaginationControls(visibleCount, totalCount)
  return (
    <section className="camp-nav-group" data-group={groupKey}>
      <div className={`project-heading-row ${currentProject ? 'current-project' : ''}`} data-menu-open={pressMenu.open || undefined}
        onContextMenu={(event) => { if (!event.defaultPrevented) pressMenu.rowProps.onContextMenu?.(event) }} data-expanded={projectExpanded ? 'true' : 'false'}>
        <button
          {...pressMenu.rowProps}
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
            opening={thread.id === openingThreadId}
            pinned={false}
            onTogglePin={() => onToggleThreadPin(thread)}
            onCopyThreadId={() => onCopyThreadId(thread)}
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
  opening,
  pinned,
  onTogglePin,
  onCopyThreadId,
  onThread,
  onAction
}: {
  thread: NavigationThreadItem
  readState?: NavigationThreadReadState
  onSetUnread?(unread: boolean): void
  firstRunThreadId: string | null
  active: boolean
  opening: boolean
  pinned: boolean
  onTogglePin(): void
  onCopyThreadId(): void
  onThread(thread: NavigationThreadItem): void
  onAction(kind: 'rename' | 'delete', thread: NavigationThreadItem): void
}): JSX.Element {
  const mobile = useMobileLayout()
  const pressMenu = useNavigationPressMenu(true)
  const title = formatThreadTitle(thread, firstRunThreadId)
  const hasNewReply = navigationThreadHasUnread(thread, readState)
  const loadingStatus = opening ? 'opening' : thread.marker === 'loading' ? 'loading' : null
  const status = loadingStatus && hasNewReply ? `${loadingStatus}-unread` : loadingStatus ?? (hasNewReply ? 'unread' : 'none')
  const menuLabels = campNavigationMenuLabels(pinned, hasNewReply)
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
    key: 'toggle-unread', label: menuLabels[1], icon: hasNewReply ? 'read' : 'unread',
    onSelect: () => onSetUnread(!hasNewReply)
  })
  menuItems.push({
    key: 'copy-id',
    label: menuLabels[3],
    icon: 'copy',
    onSelect: onCopyThreadId
  })
  menuItems.push({
    key: 'delete',
    label: menuLabels[4],
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
        aria-current={active ? 'page' : undefined}
        aria-busy={opening || undefined}
        aria-label={`${title}${hasNewReply ? readState?.manualUnread ? uiAttribute("，已标记未读") : uiAttribute("，有新回复") : ''}${opening ? uiAttribute("，正在打开") : thread.marker === 'loading' ? uiAttribute("，正在运行") : ''}`}
        title={`${title}${hasNewReply ? uiAttribute(" · 未读") : ''}${opening ? uiAttribute(" · 正在打开") : loadingStatus ? uiAttribute(" · 正在运行") : ''}`}
        onClick={() => onThread(thread)}
      >
        {pinned && <span className="pinned-camp-icon" aria-hidden="true"><NavigationIcon name="messages" /></span>}
        <span className="truncate">{title}</span>
        {thread.activationState === 'pending' && <span className="camp-draft-badge"><UiText zh={"草稿"} /></span>}
        <span className="camp-status-cluster" data-status={status} aria-hidden="true">
          {hasNewReply && <span className="camp-status-slot"><i className="camp-unread-dot" /></span>}
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
  icon: 'pin' | 'edit' | 'copy' | 'trash' | 'remove' | 'square-pen' | 'reveal' | 'read' | 'unread'
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
  const trigger = (
    <button
      className={`sidebar-menu-trigger ${triggerClassName}${mobile ? ' mobile-context-trigger' : ''}`}
      type="button" aria-label={label} title={uiAttribute('更多操作')}
      data-sidebar-menu-target={target}
      data-state={pressMenu?.open ? 'open' : 'closed'}
      aria-haspopup="menu" aria-expanded={pressMenu?.open ?? false}
      onClick={pressMenu?.contextPoint ? () => pressMenu.setOpen(false) : undefined}
    >
      {mobile ? uiAttribute('操作') : <svg className="more-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
      </svg>}
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
          onEscapeKeyDown={() => pressMenu?.restoreRowFocus()}
          onCloseAutoFocus={(event) => event.preventDefault()}
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

function SidebarMenuIcon({ kind, filled = false }: {
  kind: SidebarActionMenuItem['icon']
  filled?: boolean
}): JSX.Element {
  if (kind === 'square-pen') return <NavigationIcon name="square-pen" />
  if (kind === 'reveal') return <svg className="sidebar-action-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9V6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v3M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9" /><path d="M12 14h9m-3-3 3 3-3 3" /></svg>
  if (kind === 'read') return <svg className="sidebar-action-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m3 9 9-6 9 6v10H3ZM3 9l9 6 9-6" /></svg>
  if (kind === 'unread') return <svg className="sidebar-action-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /><circle cx="20" cy="5" r="3" fill="currentColor" stroke="var(--surface-raised)" strokeWidth="1.8" /></svg>
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
