import { BusyLabel } from './BusyLabel'
import { prepareImagePublication, releaseClientImageCache, type ImagePublication } from './ImageGallery'
import type { ImagePreviewUrl } from './image-preview-url'
import type { NavigationFindIntent, NavigationSearchRow } from './camp-navigation-search'
import { ArchiveSettings } from './ArchiveSettings'
import { isArchiveChangeEvent, writeArchive } from './thread-archive'
import { useMemoryCapability } from './MemoryCapabilityProvider'
import { reportProjectFileReferenceRejection } from './useProjectFileAvailability'
import { prepareFileEditsForQuit } from './file-edit-store'
import { ThreadReferencePreviewProvider } from './ThreadReferencePreview'
import { MessageReeditStore } from './message-reedit-store'
import { MessageWithdrawal } from './message-withdrawal'
import { useTeams } from './useTeams'
import { TeamWorkspace, type TeamLeaveGuard } from './TeamWorkspace'
import { MemoryChangeNotice } from './MemoryChangeNotice'
import { collectMemoryChanges, memoryChangesAfter, memoryChangeText, memoryEventsForNotice, resolveMemoryChangeScope, type MemoryChange } from './memory-change-notice'
import { useTaskCapability } from './TaskCapabilityProvider'
import { ShortcutSettings } from './ShortcutSettings'
import { useShortcutAction } from './ShortcutProvider'
import { AppToast, type AppToastAction, type AppToastValue } from './AppToast'
import { ThreadForkOperation, type ThreadForkState } from './thread-fork'
import { useForkLoading } from './use-fork-loading'
export { AppToast } from './AppToast'
import { EMPTY_SNAPSHOT, isProjectPath, moveNavigationProject } from '../../shared/navigation-preferences-model'
import { useThreadUserAnchorCache } from './useThreadUserAnchors'
import { hasPendingThreadDraftInput } from './pending-thread-draft'
import { memberCreationHelper, memberCreationInitialDraft, navigationWithMemberCreationDrafts, type MemberCreationDraft } from './member-creation-flow'
import { navigationThreadReadState, saveNavigationThreadReadState } from './navigation-unread'
import { newCommandId } from '../../shared/command-id'
import { ConversationExportDialog, useConversationExport } from './ConversationExport'
import type { BusinessEnvironment } from './business-environment'
import { AppHeader } from './AppHeader'
import { MobileConversationDrawer, MobileLayoutProvider, MobilePageHeader, useMobilePageTransition, useMobileViewport } from './MobileLayout'
import { MobileSettingsLayout } from './MobileSettingsLayout'
export { AppHeader } from './AppHeader'
import { CurrentUserProfileProvider } from './CurrentUserProfile'
import { readErrorMessage } from './error-message'
import { normalizeFailure, OperationFailure, operationFailureTitle, reportOperationFailure, retryRead, sharedRejectionMessage, type OperationId } from './operation-failure'
import { createThreadRefreshRecovery } from './thread-refresh-recovery'
import { requestRunStop } from './run-stop'
import { CoreSubsystemNotice } from './CoreSubsystemNotice'
import { Activity, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { THREAD_SNAPSHOT_SCHEMA_VERSION } from '@contracts'
import type {
  AdapterInstallation,
  AdapterKind,
  AgentProfile,
  Team,
  AgentRunView,
  ActionApprovalView,
  AppUpdatePrompt as AppUpdatePromptValue,
  AppearancePreferences,
  AppearanceSnapshot,
  ArchiveKind,
  ThreadActivationState,
  ThreadCreationPreflight,
  ThreadComposerDraftView,
  ThreadDeletionIssue,
  ThreadMessagePage,
  ThreadMessageAroundSnapshot,
  ThreadMessageView,
  ThreadMemberRemovalPreview,
  RemoveThreadMemberCommand,
  ThreadOpenProjection,
  ThreadSnapshot,
  CreateThreadRequest,
  CoreEvent,
  DesktopStartupSnapshot,
  EventBatch,
  ExecutionConsolePlacement,
  GeneralPreferencesSnapshot,
  RuntimeStatus,
  NotificationActionView,
  NotificationEpisodeView,
  OnboardingRuntimeSelection,
  OnboardingSnapshot,
  MissionAttachmentDraft,
  MissionRecord,
  MissionCreate,
  MissionDescriptionContent,
  NavigationThreadItem,
  NavigationThreadTarget,
  NavigationThreadRows,
  ThreadViewedAcknowledgement,
  NavigationPin,
  NavigationPreferencesSnapshot,
  NavigationProjectMove,
  NavigationSnapshot,
  ProjectNavigationGroup,
  RestorableLocation,
  RovaiApi,
  HearthReviewItem,
  MemoryRecord,
  SendThreadMessageResult,
  StoredCommandResult,
  SupervisorSnapshot,
  ThemePreference,
  WorkspaceInspection,
  WorkspaceSelection
} from '@contracts'
import {
  MembersView,
  RuntimeInstallationsPanel,
  type MembersViewHandle
} from './MemberManagement'
import type { MemberWorkspaceTab } from './MemberSidebar'
import type { RuntimeStartupLeaveGuard } from './RuntimeStartupSettings'
import {
  ThreadWorkspace,
  QuickChatWorkspace,
  composerHasSendablePayload,
  type ThreadMessageSendReceipt,
  type ThreadLeaveGuard,
  type ThreadLeavePreparation,
  type ThreadMemberAddOutcome,
  type ThreadMemberRemoveOutcome,
  type ThreadInspectorTab,
  type ThreadRuntimeRecovery,
  type NotificationFocusTarget,
  type VisibleNotificationSources
} from './ThreadWorkspace'
import { composerDocumentToStructuredContent } from './composer-document'
import { clearLocalThreadComposerDraft } from './camp-composer-local-store'
import {
  ThreadNavigation,
  type NavigationRowReveal,
  type NavigationSettingsSection
} from './ThreadNavigation'
import { NewConversationDialog } from './NewConversationDialog'
import { MissionBoard, MissionInteractionProvider, MissionIntro } from './MissionBoard'
import { MissionActivityDocument } from './MissionDelivery'
import { MissionCommandRejected, missionCommand, missionError, unreadMissionCount, useMissions } from './useMissions'
import './mission.css'
import { createRuntimeRefresh, openRuntimeModelCatalog } from './runtime-check'
import { MissionSurface } from './MissionSurface'
import { MissionHeader } from './MissionHeader'
import { FilePreviewProvider } from './FilePreviewContext'
import { NavigationShell } from './NavigationShell'
import { StartupLoadingCanvas } from './StartupLoadingCanvas'
import { createDesktopNavigation, type NavigationTarget, type NavigationTransaction, type NavigationIntent, type MemoryNavigationTarget, type ArchiveNavigationSelection } from './desktop-navigation'
import { forgetFilePreviewSession } from './file-preview-session'
import { AppearanceSettings } from './AppearanceSettings'
import { AboutUpdatesSettings } from './AboutUpdatesSettings'
import { RemoteAboutSettings } from './RemoteAboutSettings'
import { AppUpdatePrompt } from './AppUpdatePrompt'
import { useAppUpdates, type AppUpdatesController } from './useAppUpdates'
import { ThreadInterruptionAttentionContext, useThreadInterruptionAttention } from './thread-interruption-attention'
import {
  NotificationAttentionController,
  type NotificationNavigationResult
} from './NotificationAttentionController'
import {
  createNotificationPresentationCoordinator,
  type NotificationPresentationCoordinator
} from './NotificationPresentationCoordinator'
import { NotificationSettings } from './NotificationSettings'
import { NativeSkillsSettings, ToolboxSettings } from './RebuiltSkillsSettings'
import { McpSettings } from './McpSettings'
import { ChannelSettings } from './ChannelSettings'
import { SettingsPageHeader } from './SettingsPageHeader'
import { GeneralSettings } from './GeneralSettings'
import { HostWebSettings } from './HostWebSettings'
import { MemoryLibrary } from './MemoryLibrary'
import {
  AutomationWorkspace,
  type AutomationLeaveGuard
} from './AutomationWorkspace'
import { DiagnosticsCenter } from './DiagnosticsCenter'
import { RuntimeMonitoring } from './RuntimeMonitoring'
import { localizeExecutionEngineTerms } from './product-copy'
import { formatThreadTitle } from './camp-title'
import {
  applyAppearanceSnapshot,
  initialAppearanceSnapshot
} from './theme'
import { allNavigationThreads } from './ui-model'
import { restoredMemberId, startupTargetFromSnapshot } from './startup-location'
import {
  OnboardingFlow,
  type OnboardingRuntimePhase
} from './OnboardingFlow'
import { provisionFirstRun } from './onboarding-provisioning'
import { UiText, changeInterfaceLanguage, initializeInterfaceLanguage, translateUi, uiAttribute, useInterfaceLanguage } from './interface-language'
import {
  currentProjectAccessDecision,
  currentProjectForThread,
  currentProjectGroup,
  currentProjectWorkspace,
  navigationIncludingCurrentWorkspace,
  navigationWithProjectDirectories,
  navigationWithProjectNames,
  navigationWithProjectOrder,
  persistCurrentProject,
  projectTargetKey,
  readCurrentProject,
  resolveAvailableNewConversationDefaults,
  shouldInvalidateNewConversationDefaults,
  type CurrentProject
} from './new-conversation-preferences'
import { type NavigationRefreshTrigger } from './navigation-refresh-coordinator'
import { createNavigationWindowReader, type NavigationGroupLimits } from './navigation-window-reader'
import { createMemberRosterReader } from './member-roster-reader'

export { allNavigationThreads }

const ACTIVE_CAMP_INVALIDATION_EVENTS = new Set([
  'thread.messages.changed',
  'thread.memberCreated',
  'thread.member.fast.updated',
  'camp.member_added',
  'camp.member_removed',
  'camp.membership_reconciliation_started',
  'camp.membership_reconciliation_completed',
  'camp.default_lead_reconciled',
  'agent_run.cancelled',
  'agent_run.continuation_requested',
  'agent_run.recovery_blocker_resolved',
  'agent_run.runtime_model_observed',
  'agent_run.terminal',
  'agent_run.interaction_changed',
  'agent_run.images.updated',
  'agent_run.file_changes_completed'
])

export const NAVIGATION_REFRESH_POLL_MS = 20_000

export function shouldRefreshNavigationForCoreEvent(
  event: CoreEvent,
  shuttingDown = false
): boolean {
  return !shuttingDown && event.method === 'navigation.invalidated'
}

export function shouldRefreshActiveThreadForCoreEvent(
  event: CoreEvent,
  activeThreadId: string | null,
  shuttingDown = false
): boolean {
  if (shuttingDown || !activeThreadId || (!ACTIVE_CAMP_INVALIDATION_EVENTS.has(event.method) && !isArchiveChangeEvent(event))) {
    return false
  }
  const eventThreadId = stringField(asRecord(event.params), 'threadId')
  if (event.method === 'agent_run.runtime_model_observed') {
    return eventThreadId === activeThreadId
  }
  return !eventThreadId || eventThreadId === activeThreadId
}

export interface ActiveThreadRefreshCoordinator {
  refresh(threadId: string): Promise<void>
}

export function createActiveThreadRefreshCoordinator(
  refreshOnce: (threadId: string) => Promise<void>,
  isCurrent: (threadId: string) => boolean = () => true
): ActiveThreadRefreshCoordinator {
  const activeRefreshes = new Map<string, {
    dirty: boolean
    completion: Promise<void>
  }>()

  return {
    refresh(threadId: string): Promise<void> {
      if (!isCurrent(threadId)) return Promise.resolve()
      const active = activeRefreshes.get(threadId)
      if (active) {
        active.dirty = true
        return active.completion
      }

      const entry = {
        dirty: false,
        completion: Promise.resolve()
      }
      activeRefreshes.set(threadId, entry)
      entry.completion = Promise.resolve()
        .then(async () => {
          try {
            let lastError: unknown = null
            do {
              if (!isCurrent(threadId)) return
              entry.dirty = false
              try {
                await refreshOnce(threadId)
                lastError = null
              } catch (nextError) {
                lastError = nextError
              }
            } while (entry.dirty)
            if (lastError !== null && isCurrent(threadId)) throw lastError
          } finally {
            if (activeRefreshes.get(threadId) === entry) activeRefreshes.delete(threadId)
          }
        })
      return entry.completion
    }
  }
}

export function refreshActiveThreadForCoreEvent(
  event: CoreEvent,
  activeThreadId: string | null,
  coordinator: ActiveThreadRefreshCoordinator,
  shuttingDown = false
): Promise<void> | null {
  return shouldRefreshActiveThreadForCoreEvent(event, activeThreadId, shuttingDown) && activeThreadId
    ? coordinator.refresh(activeThreadId)
    : null
}

export function requestAuthoritativeThreadOpenProjection(
  api: Pick<RovaiApi, 'request'>,
  threadId: string,
  traceId: string
): Promise<ThreadOpenProjection> {
  return api.request<ThreadOpenProjection>('threads.open', { traceId, threadId })
}

type LoadState = 'loading' | 'ready' | 'error'
export type StartupStatus = 'loading' | 'waiting' | 'resolved'
export const SHUTDOWN_FEEDBACK_DELAY_MS = 400
export type View = 'compose' | 'camp' | 'members' | 'teams' | 'automations' | 'missions' | 'memory' | 'settings'
type ActivateThreadOptions = {
  title?: string
  memberPrepared?: boolean
  reconcileDefaultLead?: boolean
  onArchived?: (message: string) => void
  initializeComposerDraft?: boolean
  preserveNotificationFocus?: boolean
  missionPresentation?: 'drawer'
  navigationFind?: NavigationFindIntent
  suppressErrors?: boolean
  stayOnOpenFailure?: boolean
  anchoredMessages?: readonly ThreadMessageView[]
  anchoredAgentRuns?: readonly AgentRunView[]
  anchoredTasks?: readonly import('@contracts').TaskView[]
}

export function activeThreadSurfaceNeedsLeaveGuard(
  view: View,
  activeThreadId: string | null
): activeThreadId is string {
  return view === 'camp' && activeThreadId !== null
}

export async function prepareActiveThreadForAppQuit(
  view: View,
  activeThreadId: string | null,
  registration: { threadId: string; guard: ThreadLeaveGuard } | null
): Promise<void> {
  if (
    view !== 'camp'
    || !activeThreadId
    || registration?.threadId !== activeThreadId
  ) {
    return
  }

  const preparation = await registration.guard()
  preparation.complete(true)
}

export async function runAutomationLeaveTransition(
  view: View,
  guard: AutomationLeaveGuard | null,
  transition: () => void | Promise<void>
): Promise<boolean> {
  if (view === 'automations' && guard && !(await guard())) return false
  await transition()
  return true
}

export async function prepareActiveAutomationForAppQuit(
  view: View,
  guard: AutomationLeaveGuard | null
): Promise<void> {
  if (view === 'automations' && guard && !(await guard())) {
    throw new Error(uiAttribute('定时任务修改尚未保存'))
  }
}

export type SettingsSection = NavigationSettingsSection
export type WindowDragStripPage = Extract<View, 'compose' | 'teams' | 'members' | 'automations' | 'missions' | 'memory' | 'settings'>

export function windowDragStripPage(view: View): WindowDragStripPage | null {
  return view === 'compose'
    || view === 'members'
    || view === 'teams'
    || view === 'automations'
    || view === 'missions'
    || view === 'memory'
    || view === 'settings'
    ? view
    : null
}

export function missionDrawerSuppressesExecutionAutoOpen(
  missionDrawer: boolean,
  executionPlacement: ExecutionConsolePlacement
): boolean {
  return missionDrawer && executionPlacement === 'bottom'
}

export function startupGateShouldBeVisible(
  snapshot: DesktopStartupSnapshot | null
): boolean {
  return snapshot === null
}

export function startupFeedbackShouldBeVisible(
  status: StartupStatus
): boolean {
  return status !== 'resolved'
}

export function campViewIsVisibleForReadAcknowledgement(
  view: View,
  activeThreadId: string | null,
  snapshotThreadId: string | null,
  visibilityState: DocumentVisibilityState,
  hasFocus: boolean
): boolean {
  return view === 'camp'
    && activeThreadId !== null
    && snapshotThreadId === activeThreadId
    && visibilityState === 'visible'
    && hasFocus
}

interface OptimisticThreadMessageEntry {
  threadId: string
  commandId: string
  message: ThreadMessageView
}

type ThreadSurfaceSnapshot = ThreadSnapshot & {
  openCoverage?: ThreadOpenProjection['coverage']
}

export interface CachedThreadSnapshot {
  snapshot: ThreadSurfaceSnapshot
  navigationRow: NavigationThreadItem | null
}

const CAMP_SNAPSHOT_CACHE_LIMIT = 5
export const CAMP_OPEN_FEEDBACK_DELAY_MS = 400

export function rememberThreadSnapshot(
  cache: Map<string, CachedThreadSnapshot>,
  snapshot: ThreadSurfaceSnapshot,
  limit = CAMP_SNAPSHOT_CACHE_LIMIT
): void {
  const id = snapshot.thread.id
  const navigationRow = cache.get(id)?.navigationRow ?? null
  cache.delete(id)
  if (limit <= 0) {
    cache.clear()
    return
  }
  cache.set(id, { snapshot, navigationRow })
  while (cache.size > limit) {
    const oldestThreadId = cache.keys().next().value
    if (oldestThreadId === undefined) break
    cache.delete(oldestThreadId)
  }
}

export function recentThreadSnapshot(
  cache: Map<string, CachedThreadSnapshot>,
  threadId: string
): ThreadSurfaceSnapshot | null {
  const entry = cache.get(threadId)
  if (!entry) return null
  cache.delete(threadId)
  cache.set(threadId, entry)
  return entry.snapshot
}

export function campActivationPreview<T extends ThreadSnapshot>(
  currentSnapshot: T | null,
  activeThreadId: string | null,
  cachedSnapshot: T | null,
  targetThreadId: string
): T | null {
  if (activeThreadId === targetThreadId && currentSnapshot?.thread.id === targetThreadId) {
    return currentSnapshot
  }
  return cachedSnapshot?.thread.id === targetThreadId ? cachedSnapshot : null
}

export function campOpenProjectionAsSnapshot(
  projection: ThreadOpenProjection,
  previous: ThreadSurfaceSnapshot | null = null
): ThreadSurfaceSnapshot {
  const previousEarlierMessages = previous?.thread.id === projection.thread.id
    ? previous.messages.filter((message) =>
        projection.messages.length > 0
          && message.sequence < projection.messages[0].sequence
      )
    : []
  const messagesById = new Map<string, ThreadMessageView>()
  for (const message of previousEarlierMessages) messagesById.set(message.id, message)
  for (const message of projection.messages) messagesById.set(message.id, message)
  const messages = [...messagesById.values()]
    .map((message) => ({ ...message, timelineGlobalSequence: null }))
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))
  const loadedCount = messages.length
  const totalCount = Math.max(projection.coverage.messages.totalCount, loadedCount)
  const omittedCount = Math.max(0, totalCount - loadedCount)
  return {
    schemaVersion: THREAD_SNAPSHOT_SCHEMA_VERSION,
    throughGlobalSequence: projection.throughGlobalSequence,
    thread: projection.thread,
    members: projection.members,
    membershipReconciliations: projection.membershipReconciliations,
    tasksEnabled: projection.tasksEnabled,
    ...(projection.tasks ? { tasks: projection.tasks } : {}),
    memberCreations: projection.memberCreations ?? [],
    messages,
    messageDeliveries: projection.messageDeliveries,
    turns: projection.turns,
    agentRuns: projection.agentRuns,
    executionEvidence: projection.executionEvidence,
    agentRunFileChanges: projection.agentRunFileChanges,
    agentRunImages: projection.agentRunImages ?? [],
    contextManifests: [],
    approvals: projection.approvals,
    nativeInteractions: projection.nativeInteractions ?? [],
    actions: [],
    timeline: [],
    openCoverage: {
      ...projection.coverage,
      messages: {
        ...projection.coverage.messages,
        loadedCount,
        totalCount,
        omittedCount,
        complete: omittedCount === 0,
        hasEarlier: omittedCount > 0,
        oldestLoadedSequence: messages[0]?.sequence ?? null,
        newestLoadedSequence: messages.at(-1)?.sequence ?? null
      }
    }
  }
}

const CANCELLABLE_TURN_STATUSES = new Set<ThreadSnapshot['turns'][number]['status']>([
  'running',
  'waiting'
])
const CANCELLABLE_RUN_STATUSES = new Set<ThreadSnapshot['agentRuns'][number]['status']>([
  'queued',
  'running',
  'waiting'
])
export function campActivationStateForCreation(
  source: 'one_click' | 'dialog'
): ThreadActivationState {
  return source === 'one_click' ? 'pending' : 'active'
}

export async function selectProjectDirectory(
  selectWorkspaceDirectory: () => Promise<WorkspaceSelection | null>,
  restoreProject: (projectPath: string) => Promise<void>,
  selectProject: (project: CurrentProject, workspace: WorkspaceSelection) => void
): Promise<'selected' | 'cancelled'> {
  const workspace = await selectWorkspaceDirectory()
  if (!workspace) return 'cancelled'

  await restoreProject(workspace.projectPath)
  selectProject({ kind: 'directory', projectPath: workspace.projectPath }, workspace)
  return 'selected'
}

export function cancellableTurnIds(snapshot: {
  turns: Pick<ThreadSnapshot['turns'][number], 'id' | 'status'>[]
  agentRuns: Pick<ThreadSnapshot['agentRuns'][number], 'threadTurnId' | 'status'>[]
}, scope: 'current_execution' | 'camp_cleanup' = 'current_execution'): string[] {
  if (scope === 'camp_cleanup') {
    return snapshot.turns
      .filter((turn) => CANCELLABLE_TURN_STATUSES.has(turn.status))
      .map((turn) => turn.id)
  }
  const executingTurnIds = new Set(snapshot.agentRuns
    .filter((run) => CANCELLABLE_RUN_STATUSES.has(run.status))
    .map((run) => run.threadTurnId))
  return snapshot.turns
    .filter((turn) =>
      CANCELLABLE_TURN_STATUSES.has(turn.status) && executingTurnIds.has(turn.id))
    .map((turn) => turn.id)
}

export function reconcileCancellingTurnIds(
  current: ReadonlySet<string>,
  snapshot: Pick<ThreadSnapshot, 'turns'>
): Set<string> {
  const terminalTurnIds = new Set(snapshot.turns
    .filter((turn) => !CANCELLABLE_TURN_STATUSES.has(turn.status))
    .map((turn) => turn.id))
  if (![...current].some((turnId) => terminalTurnIds.has(turnId))) {
    return current instanceof Set ? current : new Set(current)
  }
  return new Set([...current].filter((turnId) => !terminalTurnIds.has(turnId)))
}

export function effectiveCancellingTurnIds(
  local: ReadonlySet<string>,
  snapshot: Pick<ThreadSnapshot, 'turns'>
): Set<string> {
  const activeIds = new Set(snapshot.turns
    .filter((item) => CANCELLABLE_TURN_STATUSES.has(item.status))
    .map((item) => item.id))
  return new Set([...local].filter((id) => activeIds.has(id)))
}

export function reconcileRunCancellationIds(
  current: ReadonlySet<string>,
  snapshot: {
    agentRuns: Pick<AgentRunView, 'id' | 'status' | 'cancelRequestedAt'>[]
  }
): Set<string> {
  const runById = new Map(snapshot.agentRuns.map((run) => [run.id, run]))
  const next = new Set([...current].filter((runId) => {
    const run = runById.get(runId)
    return Boolean(
      run
      && CANCELLABLE_RUN_STATUSES.has(run.status)
      && run.cancelRequestedAt === null
    )
  }))
  if (next.size === current.size && [...next].every((runId) => current.has(runId))) {
    return current instanceof Set ? current : next
  }
  return next
}

export function effectiveCancellingRunIds(
  local: ReadonlySet<string>,
  snapshot: { agentRuns: Pick<AgentRunView, 'id' | 'status' | 'cancelRequestedAt'>[] }
): Set<string> {
  const activeIds = new Set(snapshot.agentRuns
    .filter((item) => CANCELLABLE_RUN_STATUSES.has(item.status))
    .map((item) => item.id))
  return new Set([...local].filter((id) => activeIds.has(id)))
}

// Apply only terminal facts returned by Core, then refresh the complete projection.
// Cleanup ACK is deliberately absent from this presentation boundary.
export function applyCancellationResult(
  snapshot: ThreadSnapshot,
  result: StoredCommandResult
): ThreadSnapshot {
  if (result.status !== 'applied') return snapshot
  const payload = result.payload
  const runs = new Map<string, {
    status: AgentRunView['status']
    unknown: boolean
    cancelledByRequest: boolean
  }>()
  const addRun = (id: unknown, status: unknown, code: unknown): void => {
    if (typeof id === 'string' && (status === 'failed' || status === 'cancelled' || status === 'succeeded')) {
      runs.set(id, {
        status,
        unknown: code === 'agent_run.accepted_input_outcome_unknown',
        cancelledByRequest: status === 'cancelled' && code === 'agent_run.cancelled'
      })
    }
  }
  addRun(payload.agentRunId, payload.status, result.code)
  if (Array.isArray(payload.runs)) {
    for (const item of payload.runs) {
      if (item && typeof item === 'object' && 'agentRunId' in item && 'terminalStatus' in item) {
        addRun(item.agentRunId, item.terminalStatus, 'terminalCode' in item ? item.terminalCode : null)
      }
    }
  }
  const turnStatus = payload.threadTurnStatus
  return {
    ...snapshot,
    agentRuns: snapshot.agentRuns.map((run) => {
      const settled = runs.get(run.id)
      return settled ? {
        ...run,
        status: settled.status,
        waitReason: null,
        hasUnsettledExternalEffects: settled.cancelledByRequest
          ? false
          : run.hasUnsettledExternalEffects || settled.unknown
      } : run
    }),
    turns: snapshot.turns.map((turn) => turn.id === payload.threadTurnId
      && (turnStatus === 'completed' || turnStatus === 'failed' || turnStatus === 'cancelled')
      ? { ...turn, status: turnStatus } : turn)
  }
}

export function shouldLoadRuntimeHealth(
  view: View,
  settingsSection: SettingsSection,
  hasHealth: boolean,
  healthAttempted: boolean
): boolean {
  return !hasHealth
    && !healthAttempted
    && (
      view === 'members'
      || (view === 'settings' && settingsSection === 'runtime')
    )
}

export function ControlledShutdownOverlay({
  visible = true
}: {
  visible?: boolean
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!visible) return
    dialogRef.current?.focus({ preventScroll: true })
  }, [visible])

  useEffect(() => {
    if (visible) return undefined
    const preventPendingInteraction = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener('keydown', preventPendingInteraction, true)
    return () => window.removeEventListener('keydown', preventPendingInteraction, true)
  }, [visible])

  return (
    <div
      ref={dialogRef}
      className={`shutdown-scrim ${visible ? 'is-visible' : 'is-pending'}`}
      role={visible ? 'dialog' : undefined}
      aria-modal={visible ? true : undefined}
      aria-live={visible ? 'polite' : undefined}
      aria-busy={visible ? true : undefined}
      aria-hidden={visible ? undefined : true}
      aria-labelledby={visible ? 'controlled-shutdown-title' : undefined}
      aria-describedby={visible
        ? 'controlled-shutdown-description controlled-shutdown-evidence'
        : undefined}
      tabIndex={visible ? -1 : undefined}
      onKeyDown={(event) => {
        if (!visible || event.key !== 'Tab') return
        event.preventDefault()
        dialogRef.current?.focus({ preventScroll: true })
      }}
    >
      {visible && (
        <section className="shutdown-card">
          <span className="shutdown-safe-mark" aria-hidden="true">
            <svg viewBox="0 0 20 20" focusable="false">
              <path d="M10 2.75 4.75 5.1v4.05c0 3.55 1.97 6.23 5.25 8.1 3.28-1.87 5.25-4.55 5.25-8.1V5.1L10 2.75Z" />
            </svg>
          </span>
          <div className="shutdown-card-content">
            <h2 id="controlled-shutdown-title"><UiText zh={"正在安全退出"} /></h2>
            <p id="controlled-shutdown-description"><UiText zh={"Rovai 正在保存本地状态并关闭后台服务。"} /></p>
            <span className="shutdown-progress-track" role="progressbar" aria-label={uiAttribute("正在完成安全退出")}>
              <i />
            </span>
            <p className="shutdown-evidence-note" id="controlled-shutdown-evidence"><UiText zh={"未完成的任务会取消，未确认的改动保留为待核对记录。"} /></p>
          </div>
        </section>
      )}
    </div>
  )
}


export function authoritativeWorkspaceIsAvailable(
  snapshot: SupervisorSnapshot | null
): boolean {
  return snapshot?.runtimeMode === 'full_core'
    && snapshot.fullCoreState === 'ready'
    && snapshot.capabilities.authoritativeWorkspace
    && snapshot.capabilities.coreRequests
}

function startupView(target: RestorableLocation | null): View {
  return target?.kind === 'camp' || target?.kind === 'members' || target?.kind === 'teams' || target?.kind === 'memory'
    ? target.kind
    : 'compose'
}

/** The normal page chrome, without mounting any Core-backed query or mutation. */
export function StartupWorkspace({
  snapshot,
  feedbackVisible,
  error,
  onRetry
}: {
  snapshot: DesktopStartupSnapshot | null
  feedbackVisible: boolean
  error: string | null
  onRetry(): void
}): React.JSX.Element {
  const target = snapshot ? startupTargetFromSnapshot(snapshot) : null
  const view = startupView(target)
  const dragPage = windowDragStripPage(view)
  const ignore = (): void => undefined
  const ignoreAsync = async (): Promise<void> => undefined
  const contentClass = view === 'camp' ? 'task-content camp-content'
    : view === 'members' ? 'members-content'
      : view === 'memory' ? 'memory-content' : 'task-content compose-content'
  return (
    <>
    <NavigationShell platform={window.rovai.platform} disabled
      className={view === 'camp' ? 'app-shell-camp' : ''}
      data-startup-frame={target?.kind ?? 'location'}
    >
      <ThreadNavigation
        platform={window.rovai.platform}
        view={view}
        state="loading"
        disabled
        navigation={null}
        activeThreadId={null}
        pendingMemoryCount={0}
        onNewConversation={ignore}
        onMembers={ignore}
        onAutomations={ignore}
        onMemory={ignore}
        onSettings={ignore}
        onOpenProject={ignore}
        onThread={ignore}
        onRemoveProject={ignoreAsync}
        onRename={ignoreAsync}
        onDelete={ignoreAsync}
        onError={ignore}
      />
      {view === 'camp' && <AppHeader
        threadTitle={uiAttribute("对话")}
        contextLabel={null}
        thread={null}
        onFocusApprovals={ignore}
      />}
      {dragPage && <WindowDragStrip page={dragPage} />}
      <main className={`content ${contentClass}`} aria-busy="true">
        {error && (target
          ? <StartupRouteLoading
              kind={target.kind}
              waiting
              error={error}
              onRetry={onRetry}
              onExportDiagnostics={() => window.rovai.exportDiagnostics()}
            />
          : <StartupGate waiting error={error} onRetry={onRetry}
              onExportDiagnostics={() => window.rovai.exportDiagnostics()} />)}
      </main>
    </NavigationShell>
    {error === null && <StartupLoadingCanvas
      visible={feedbackVisible}
      route={target?.kind ?? 'location'}
    />}
    </>
  )
}

export function BootstrapShell({
  snapshot
}: {
  snapshot: SupervisorSnapshot | null
}): React.JSX.Element {
  const [appearance, setAppearance] = useState<AppearanceSnapshot>(
    () => initialAppearanceSnapshot(document.documentElement)
  )
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'retry' | 'diagnostics' | null>(null)

  useEffect(() => {
    let disposed = false
    const acceptSnapshot = (next: AppearanceSnapshot): void => {
      if (disposed) return
      applyAppearanceSnapshot(document.documentElement, next)
      setAppearance(next)
    }
    void window.rovai.appearance.get().then(acceptSnapshot).catch(() => undefined)
    const unsubscribe = window.rovai.appearance.onChanged(acceptSnapshot)
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [])

  const authorityCopy = bootstrapAuthorityCopy(snapshot)
  const retry = async (): Promise<void> => {
    setBusy('retry')
    setActionError(null)
    try {
      await window.rovai.supervisor.retryFullCore()
    } catch {
      setActionError(uiAttribute('暂时无法重新打开，请重试。'))
    } finally {
      setBusy(null)
    }
  }
  const exportDiagnostics = async (): Promise<void> => {
    setBusy('diagnostics')
    setActionError(null)
    try {
      await window.rovai.exportDiagnostics()
    } catch {
      setActionError(uiAttribute('暂时无法导出诊断，请重试。'))
    } finally {
      setBusy(null)
    }
  }
  const changeAppearance = async (preference: ThemePreference): Promise<void> => {
    setActionError(null)
    try {
      setAppearance(await window.rovai.appearance.setPreference(preference))
    } catch {
      setActionError(uiAttribute('暂时无法保存外观设置，请重试。'))
    }
  }

  return (
    <div className="bootstrap-shell" data-runtime-mode={snapshot?.runtimeMode ?? 'bootstrap_only'}>
      <WindowDragStrip page="settings" />
      <header className="bootstrap-shell-brand" aria-label="Rovai AI">
        <span className="bootstrap-shell-mark" aria-hidden="true">R</span>
        <span>Rovai AI</span>
      </header>
      <main className="bootstrap-shell-main">
        <section className="bootstrap-authority-card" aria-live="polite">
          <span className={`bootstrap-authority-state state-${snapshot?.fullCoreState ?? 'idle'}`}>
            {authorityCopy.eyebrow}
          </span>
          <h1>{authorityCopy.title}</h1>
          <p>{authorityCopy.description}</p>
          <div className="bootstrap-actions">
            <button
              className="primary-button"
              type="button"
              disabled={busy !== null || !snapshot?.capabilities.fullCoreRetry}
              onClick={() => void retry()}
            >
              {busy === 'retry' ? uiAttribute("正在打开会话") : uiAttribute("重新打开")}
            </button>
            <button
              className="quiet-button"
              type="button"
              disabled={busy !== null}
              aria-busy={busy === 'diagnostics'}
              onClick={() => void exportDiagnostics()}
            >
              <BusyLabel busy={busy === 'diagnostics'}>{uiAttribute("导出诊断")}</BusyLabel>
            </button>
          </div>
          {actionError && (
            <p className="bootstrap-action-error" role="alert">
              {actionError}
            </p>
          )}
        </section>

        <aside className="bootstrap-local-card">
          <div>
            <span className="bootstrap-local-label"><UiText zh={"本地外观"} /></span>
            <p><UiText zh={"你仍然可以调整外观。"} /></p>
          </div>
          <div className="bootstrap-theme-options" role="group" aria-label={uiAttribute("外观主题")}>
            {([
              ['system', '跟随系统'],
              ['day', '日间'],
              ['night', '夜间']
            ] as const).map(([preference, label]) => (
              <button
                type="button"
                aria-pressed={appearance.preference === preference}
                onClick={() => void changeAppearance(preference)}
                key={preference}
              >
                {uiAttribute(label)}
              </button>
            ))}
          </div>
          {(snapshot?.localDegradations.length ?? 0) > 0 && (
            <div className="bootstrap-degradations">
              <span className="bootstrap-local-label"><UiText zh={"本机设置提示"} /></span>
              <p><UiText zh={"部分本机设置暂时无法读取，可导出诊断以排查原因。"} /></p>
            </div>
          )}
        </aside>
      </main>
    </div>
  )
}

export function bootstrapAuthorityCopy(snapshot: SupervisorSnapshot | null): {
  eyebrow: string
  title: string
  description: string
} {
  const starting = !snapshot || snapshot.fullCoreState === 'idle' || snapshot.fullCoreState === 'starting'
  return {
    eyebrow: starting ?uiAttribute("请稍候") :uiAttribute("会话尚未就绪"),
    title: starting ?uiAttribute("正在打开会话") :uiAttribute("暂时无法打开会话"),
    description: starting ?uiAttribute("准备好后会自动打开。") :uiAttribute("请重新打开，或导出诊断以排查原因。")
  }
}

export function navigationWithoutDeletedThreads(
  snapshot: NavigationSnapshot,
  deletingThreadIds: ReadonlySet<string>
): NavigationSnapshot {
  const filterGroup = <T extends { totalCount: number; recentThreads: NavigationThreadItem[] }>(group: T): T => {
    const recentThreads = group.recentThreads.filter((thread) => !deletingThreadIds.has(thread.id))
    const removed = group.recentThreads.length - recentThreads.length
    return removed === 0
      ? group
      : { ...group, recentThreads, totalCount: Math.max(0, group.totalCount - removed) }
  }
  return {
    ...snapshot,
    quickChat: filterGroup(snapshot.quickChat),
    projects: snapshot.projects
      .map(filterGroup)
      .filter((project) => project.totalCount > 0)
  }
}

export function BusinessApp({
  environment,
  sidebarFooter,
  remoteConnection,
  initialStartupSnapshot,
  startupStartedAtMs
}: {
  environment: BusinessEnvironment
  sidebarFooter?: React.ReactNode
  remoteConnection?: React.ReactNode
  initialStartupSnapshot?: DesktopStartupSnapshot
  startupStartedAtMs?: number
}): React.JSX.Element {
  const memoryCapability = useMemoryCapability()
  const memoryCapabilityRef = useRef(memoryCapability)
  memoryCapabilityRef.current = memoryCapability
  const taskCapability = useTaskCapability()
  const taskCapabilityRef = useRef(taskCapability.enabled)
  const taskCapabilityRevisionRef = useRef(0)
  if (taskCapabilityRef.current !== taskCapability.enabled) taskCapabilityRevisionRef.current += 1
  taskCapabilityRef.current = taskCapability.enabled
  const { client, preferences: uiPreferences, desktop } = environment
  useEffect(() => () => releaseClientImageCache(client), [client])
  const reeditStore = useMemo(() => new MessageReeditStore(client.reeditScope ?? '',
    client.reeditScope ? undefined : null), [client])
  const userAnchorNavigationFor = useThreadUserAnchorCache(client)
  const interfaceLanguage = useInterfaceLanguage()
  const onboardingLanguageRequest = useRef(0)
  const mobile = useMobileViewport(!desktop)
  const [mobileSettingsList, setMobileSettingsList] = useState(false)
  const [mobileConversationDrawerOpen, setMobileConversationDrawerOpen] = useState(false)
  const mobileConversationListButtonRef = useRef<HTMLButtonElement>(null)
  const mobileMenuScroll = useRef(0)
  const openMobileMenu = (trigger: HTMLButtonElement): void => {
    mobileConversationListButtonRef.current = trigger
    setMobileConversationDrawerOpen(true)
  }
  const initialTarget: RestorableLocation = initialStartupSnapshot
    ? startupTargetFromSnapshot(initialStartupSnapshot) : { kind: 'quick_chat' }
  type NavigationContext = { campOptions?: ActivateThreadOptions; beforeCommit?: () => void; prepared?: boolean; memberPrepared?: boolean; preserveUnreadReminder?: boolean; onlyIf?: () => boolean }
  const applyNavigationRef = useRef<(target: NavigationTarget, transaction: NavigationTransaction, context?: NavigationContext) => Promise<void>>(async () => undefined)
  const desktopNavigation = useMemo(() => createDesktopNavigation<NavigationContext>(
    (target, transaction, context) => applyNavigationRef.current(target, transaction, context), environment.navigationHistory
  ), [environment.navigationHistory])
  useEffect(() => {
    const disconnect = desktopNavigation.connect()
    return () => { disconnect(); desktopNavigation.reset() }
  }, [desktopNavigation])
  const displayedEntry = desktopNavigation.captureCurrentEntry()
  const restoredWebNavigation = useRef(false)
  const lastMainTarget = useRef<NavigationTarget>({ kind: 'quick_chat' })
  const [appearance, setAppearance] = useState<AppearanceSnapshot>(
    () => initialAppearanceSnapshot(document.documentElement)
  )
  const appUpdates = useAppUpdates(desktop?.appUpdates ?? null)
  const [memberReadIssue, setMemberReadIssue] = useState<string | null>(null)
  const [pinReadIssue, setPinReadIssue] = useState<string | null>(null)
  const [runtimeReadIssue, setRuntimeReadIssue] = useState<string | null>(null)
  const [appearanceReadIssue, setAppearanceReadIssue] = useState<string | null>(null)
  const [health, setHealth] = useState<RuntimeStatus | null>(null)
  const [healthLoading, setHealthLoading] = useState(false)
  const [healthAttempted, setHealthAttempted] = useState(false)
  const [agents, setAgents] = useState<AgentProfile[]>([])
  const [installations, setInstallations] = useState<AdapterInstallation[]>([])
  const [navigation, setNavigation] = useState<NavigationSnapshot | null>(null)
  const [navigationGroupLimits, setNavigationGroupLimits] = useState<NavigationGroupLimits>({})
  const [navigationState, setNavigationState] = useState<LoadState>('loading')
  const [navigationPins, setNavigationPins] = useState<NavigationPin[]>([])
  const [removedProjectKeys, setRemovedProjectKeys] = useState<Set<string>>(() => new Set())
  const [removedProjectAuthorityReady, setRemovedProjectAuthorityReady] = useState(false)
  const [pendingProjectMoves, setPendingProjectMoves] = useState<NavigationProjectMove[]>([])
  const [projectNames, setProjectNames] = useState<Record<string, string>>({})
  const [navigationPreferences, setNavigationPreferences] = useState<NavigationPreferencesSnapshot | null>(null)
  const navigationPreferencesRef = useRef<NavigationPreferencesSnapshot | null>(null)
  const navigationPreferencesRead = useRef<Promise<NavigationPreferencesSnapshot> | null>(null)
  const legacyProjectAttempted = useRef(false)
  // Capture before startup restoration can overwrite the old empty selection.
  const [legacySelectedProject] = useState(() => readCurrentProject())
  const [threadReadStates, setThreadReadStates] = useState<NavigationPreferencesSnapshot['threadReadStates']>({})
  const threadReadStatesRef = useRef(threadReadStates)
  const threadReadRevisions = useRef(new Map<string, symbol>())
  const acceptThreadReadStates = useCallback((next: NavigationPreferencesSnapshot['threadReadStates']): void => {
    const current = threadReadStatesRef.current
    let changed = false
    for (const id of new Set([...Object.keys(next), ...Object.keys(current)])) {
      if (current[id]?.manualUnread === next[id]?.manualUnread
        && current[id]?.readThroughGlobalSequence === next[id]?.readThroughGlobalSequence) continue
      if (next[id]) threadReadRevisions.current.set(id, Symbol())
      else threadReadRevisions.current.delete(id)
      changed = true
    }
    if (!changed) return
    threadReadStatesRef.current = next
    setThreadReadStates(next)
  }, [])

  const [pinnedThreadItems, setPinnedThreadItems] = useState<NavigationThreadItem[]>([])
  const [storedPendingMemoryCount, setPendingMemoryCount] = useState(0)
  const pendingMemoryCount = memoryCapability.active ? storedPendingMemoryCount : 0
  const [memoryReviewNotice, setMemoryReviewNotice] = useState<number | null>(null)
  const [memoryAutoNotice, setMemoryAutoNotice] = useState<MemoryChange[]>([])
  const visibleMemoryAutoNotice = memoryChangesAfter(memoryAutoNotice, memoryCapability.headsUpAfterGlobalSequence)
  const visibleMemoryReviewNotice = memoryReviewNotice !== null && memoryReviewNotice > memoryCapability.headsUpAfterGlobalSequence
  const [memoryRefreshKey, setMemoryRefreshKey] = useState(0)
  const [memoryTarget, setMemoryTarget] = useState<MemoryNavigationTarget>({ kind: 'memory', memoryId: null })
  const [memoryReviewDrawerSignal, setMemoryReviewDrawerSignal] = useState(0)
  const [campSnapshotState, setThreadSnapshotState] = useState<{
    snapshot: ThreadSurfaceSnapshot | null
    entryPreview: boolean
    initialComposerDraft: ThreadComposerDraftView | null
  }>({ snapshot: null, entryPreview: false, initialComposerDraft: null })
  const campSnapshot = campSnapshotState.snapshot
  const [campInspectorThreadId, setThreadInspectorThreadId] = useState<string | null>(null)
  const [campInspectorTab, setThreadInspectorTab] = useState<ThreadInspectorTab>('tasks')
  const [singleChatThreadId, setSingleChatThreadId] = useState<string | null>(null)
  const [campDetailEntryHost, setThreadDetailEntryHost] = useState<HTMLDivElement | null>(null)
  const [optimisticThreadMessages, setOptimisticThreadMessages] = useState<OptimisticThreadMessageEntry[]>([])
  const [imagePublications, setImagePublications] = useState<ImagePublication[]>([])
  const [cancellingTurnIds, setCancellingTurnIds] = useState<Set<string>>(() => new Set())
  const [cancellingRunIds, setCancellingRunIds] = useState<Set<string>>(() => new Set())
  const [confirmingRunIds, setConfirmingRunIds] = useState<Set<string>>(() => new Set())
  const [state, setState] = useState<LoadState>('loading')
  const [shuttingDown, setShuttingDown] = useState(false)
  const shuttingDownRef = useRef(false)
  const [notificationHeadsUpVisible, setNotificationHeadsUpVisible] = useState(false)
  const [startupSnapshot, setStartupSnapshot] = useState<DesktopStartupSnapshot | null>(
    initialStartupSnapshot ?? null
  )
  const [startupRouteTarget, setStartupRouteTarget] = useState<RestorableLocation | null>(initialTarget)
  const [startupStatus, setStartupStatus] = useState<StartupStatus>(desktop ? 'loading' : 'resolved')
  const [startupError, setStartupError] = useState<string | null>(null)
  const [onboardingSnapshot, setOnboardingSnapshot] = useState<OnboardingSnapshot | null>(null)
  const [onboardingRuntimePhase, setOnboardingRuntimePhase] = useState<OnboardingRuntimePhase>('idle')
  const [onboardingBusy, setOnboardingBusy] = useState(false)
  const [onboardingError, setOnboardingError] = useState<string | null>(null)
  const [locationSaveError, setLocationSaveError] = useState<string | null>(null)
  const [view, setView] = useState<View>(() => startupView(initialTarget))
  const memoryPageOpen = view === 'memory'
  const mobilePageRef = useMobilePageTransition(mobile, view)
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(
    initialTarget.kind === 'members' ? initialTarget.agentId : null
  )
  const [memberTab, setMemberTab] = useState<MemberWorkspaceTab>(
    initialTarget.kind === 'members' ? initialTarget.tab : 'identity'
  )
  const [memberRuntimeFocusRequest, setMemberRuntimeFocusRequest] = useState(0)
  const [memberCreationDrafts, setMemberCreationDrafts] = useState(() => new Map<string, MemberCreationDraft>())
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general')
  const [archiveSelection, setArchiveSelection] = useState<ArchiveNavigationSelection>()
  const [remotePort, setRemotePort] = useState<string | null>(null)
  const newConversationRequestBusy = useRef(false)
  const [generalPreferences, setGeneralPreferencesState] = useState<GeneralPreferencesSnapshot | null>(null)
  const [generalPreferencesReadFailed, setGeneralPreferencesReadFailed] = useState(false)
  const setGeneralPreferences = useCallback((snapshot: GeneralPreferencesSnapshot): void => {
    initializeInterfaceLanguage(snapshot)
    setGeneralPreferencesReadFailed(false)
    // Host reads return fresh objects, including when an invalidation was ignored.
    setGeneralPreferencesState(current => JSON.stringify(current) === JSON.stringify(snapshot) ? current : snapshot)
  }, [])
  const readGeneralPreferences = useMemo(() => createRuntimeRefresh(async () => {
    try {
      setGeneralPreferences(await retryRead(() => uiPreferences.generalPreferences.get()))
    } catch (error) {
      reportOperationFailure('preferences.read', error)
      setGeneralPreferencesReadFailed(true)
    }
  }), [uiPreferences, setGeneralPreferences])
  const [currentProject, setCurrentProject] = useState<CurrentProject>(() => readCurrentProject())
  const [currentWorkspaceHint, setCurrentWorkspaceHint] = useState<WorkspaceSelection | null>(null)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const conversationExport = useConversationExport(client, `${view}:${activeThreadId ?? ''}`)
  const campInspectorVisible = activeThreadId !== null && campInspectorThreadId === activeThreadId
  const singleChatVisible = activeThreadId !== null && singleChatThreadId === activeThreadId
  const [notificationFocus, setNotificationFocus] = useState<NotificationFocusTarget | null>(null)
  const [singleChatNotificationTarget, setSingleChatNotificationTarget] = useState<(NonNullable<NotificationActionView['singleChat']> & { requestId: number }) | null>(null)
  const [visibleSingleChatSources, setVisibleSingleChatSources] = useState<VisibleNotificationSources | null>(null)
  const [visibleNotificationSources, setVisibleNotificationSources] = useState<VisibleNotificationSources | null>(null)
  const [notificationAnchor, setNotificationAnchor] = useState<{
    threadId: string
    messages: readonly ThreadMessageView[]
    agentRuns: readonly AgentRunView[]
    tasks: readonly import('@contracts').TaskView[]
  } | null>(null)
  const teamLibrary = useTeams(client, startupStatus === 'resolved')
  const teamLeaveGuard = useRef<TeamLeaveGuard | null>(null)
  const registerTeamLeaveGuard = useCallback((guard: TeamLeaveGuard | null): void => { teamLeaveGuard.current = guard }, [])
  const [newConversationInitialTeamId, setNewConversationInitialTeamId] = useState<string | null>(null)
  const [newConversationInitialTeam, setNewConversationInitialTeam] = useState<Team | null>(null)
  const missionList = useMissions(client, startupStatus === 'resolved')
  const missionSearchPaths = useMemo(
    () => missionList.missions.filter(mission => mission.projectBindingKind === 'directory').map(mission => mission.projectPath),
    [missionList.missions]
  )
  const [navigationFind, setNavigationFind] = useState<NavigationFindIntent | null>(null)
  const consumeNavigationFind = useCallback((intent: NavigationFindIntent): void => {
    setNavigationFind(current => current === intent ? null : current)
  }, [])
  const [missionPresentation, setMissionPresentation] = useState<'drawer' | 'full'>('full')
  const [missionOpenRequest, setMissionOpenRequest] = useState(0)
  const [newMissionOpen, setNewMissionOpen] = useState(false)
  const missionCreation = useRef<{id: string; command: MissionCreate; attachments: MissionAttachmentDraft[]; attachmentSignature: string} | null>(null)
  const boardMission = missionList.missions.find(mission => mission.threadId === activeThreadId)
  // Keep the mounted editor through a board invalidation until its ordinary leave guard saves the draft.
  const displayedMission = useRef<MissionRecord | undefined>(undefined)
  if (boardMission || displayedMission.current?.threadId !== activeThreadId || view !== 'camp') displayedMission.current = boardMission
  const activeMission = boardMission ?? displayedMission.current
  const missionThread = !!activeMission || !!(campSnapshot?.thread.id === activeThreadId && campSnapshot?.thread.missionId)
  const selectedThread = view !== 'compose' && !missionThread && campSnapshot?.thread.id === activeThreadId
    && !campSnapshot.thread.archivedAt ? campSnapshot.thread : null
  const selectedThreadRef = useRef(selectedThread)
  selectedThreadRef.current = selectedThread
  const selectedThreadId = selectedThread?.id ?? null
  const visitThreadId = view === 'camp' ? selectedThreadId : null
  const activeRowReveal = useMemo<NavigationRowReveal | undefined>(
    () => visitThreadId ? { status: 'pending' } : undefined, [visitThreadId, mobile]
  )
  const missionDrawer = !mobile && view === 'camp' && !!activeMission && missionPresentation === 'drawer'
  const [newConversationOpen, setNewConversationOpen] = useState(false)
  const [newConversationInitialWorkspace, setNewConversationInitialWorkspace] = useState<WorkspaceSelection | null>(null)
  const [newConversationInitialSelection, setNewConversationInitialSelection] = useState<GeneralPreferencesSnapshot['newConversationDefaults']>(null)
  const [newConversationAttention, setNewConversationAttention] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<{
    operation: OperationId; message: string; retry?: () => void
  } | null>(null)
  const showOperationError = useCallback((operation: OperationId, cause: unknown, retry?: () => void) => {
    setError({ operation, message: reportOperationFailure(operation, cause, { presentation: 'detail' }).message, retry })
  }, [])
  const [toast, setToast] = useState<AppToastValue | null>(null)
  const forkOperation = useMemo(() => new ThreadForkOperation(client, client.reeditScope), [client])
  const forkState = useSyncExternalStore(forkOperation.subscribe, forkOperation.getSnapshot, forkOperation.getSnapshot)
  const { visible: forkLoading, dismiss: dismissForkLoading } = useForkLoading(forkState.phase)
  const [dismissedForkState, setDismissedForkState] = useState<ThreadForkState | null>(null)
  const forkOpening = useRef(false)
  const forkOrigin = useRef<{ threadId: string; visit: ReturnType<typeof desktopNavigation.captureVisit> } | null>(null)
  const forkBusy = forkState.phase === 'pending' || (forkState.phase === 'unknown' && dismissedForkState !== forkState)
  const notify = useCallback((message: string): void => {
    setToast({ message, tone: 'neutral' })
  }, [])
  const notifyError = useCallback((message: string, action?: AppToastAction): void => {
    setToast({ message, tone: 'danger', actions: action ? [action] : undefined })
  }, [])
  const [threadRefreshToast, setThreadRefreshToast] = useState<{ threadId: string; toast: AppToastValue } | null>(null)
  const [openingThreadId, setOpeningThreadId] = useState<string | null>(null)
  const [runtimeRecovery, setRuntimeRecovery] = useState<ThreadRuntimeRecovery | null>(null)
  const campEventSequenceMarker = useRef(0)
  const inFlightRunStops = useRef(new Set<string>())
  const archiveWrites = useRef(new Set<string>())
  const campSelectionGeneration = useRef(0)
  const verifyingPreview = useRef<{ generation: number; projectChosen: boolean } | null>(null)
  const campOpenFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const campSnapshotCache = useRef(new Map<string, CachedThreadSnapshot>())
  const campSnapshotRef = useRef<ThreadSurfaceSnapshot | null>(null)
  const campSnapshotEntryPreviewRef = useRef(false)
  const activeThreadIdRef = useRef<string | null>(null)
  const viewRef = useRef<View>('compose')
  const threadRefreshRecovery = useMemo(() => createThreadRefreshRecovery({
    isCurrent: threadId => viewRef.current === 'camp' && activeThreadIdRef.current === threadId && !shuttingDownRef.current,
    onFailure: error => reportOperationFailure('thread.refresh', error),
    onExhausted: (threadId, retry) => setThreadRefreshToast({
      threadId, toast: {
        message: uiAttribute('会话暂时没有刷新，Rovai 没有响应。'), tone: 'neutral',
        actions: [{ label: uiAttribute('重试'), icon: 'retry', onSelect: retry }]
      }
    }),
    onClear: threadId => setThreadRefreshToast(current => current?.threadId === threadId ? null : current)
  }), [])
  useEffect(() => () => threadRefreshRecovery.clear(), [threadRefreshRecovery, activeThreadId, view])
  const notificationFocusSequence = useRef(0)
  const notificationFocusRef = useRef<NotificationFocusTarget | null>(null)
  const notificationPresentationRef = useRef<NotificationPresentationCoordinator | null>(null)
  const campViewedAcknowledgements = useRef(new Map<string, number>())
  const [openedNavigationRow, setOpenedNavigationRow] = useState<NavigationThreadItem | null>(null)
  useEffect(() => {
    setOpenedNavigationRow(current => current?.id === selectedThreadId ? current : null)
  }, [selectedThreadId])
  const pinnedThreadIdsRef = useRef<string[]>([])
  pinnedThreadIdsRef.current = navigationPins.filter(pin => pin.kind === 'camp').map(pin => pin.targetKey)
  const navigationSnapshotRef = useRef<NavigationSnapshot | null>(null)
  const deletingThreadIdsRef = useRef(new Set<string>())
  const shownDeletionIssuesRef = useRef(new Set<string>())
  const overviewRequest = useRef<Promise<boolean> | null>(null)
  const startupSnapshotRequest = useRef<Promise<void> | null>(null)
  const onboardingSnapshotRequest = useRef<Promise<void> | null>(null)
  const onboardingRuntimeRequest = useRef<Promise<void> | null>(null)
  const startupTraceId = useRef(newCommandId())
  const startupStartedAt = useRef(startupStartedAtMs ?? performance.now())
  const membersViewRef = useRef<MembersViewHandle>(null)
  const [commonEnvironmentReturn, setCommonEnvironmentReturn] = useState<{ kind: AdapterKind; memberId: string; memberName: string } | null>(null)
  const commonEnvironmentReturnRef = useRef(commonEnvironmentReturn); commonEnvironmentReturnRef.current = commonEnvironmentReturn
  const commonEnvironmentScroll = useRef<{ element: HTMLElement; top: number; left: number }[]>([])
  useLayoutEffect(() => {
    if (view !== 'members' || !commonEnvironmentReturn) return
    for (const { element, top, left } of commonEnvironmentScroll.current) { element.scrollTop = top; element.scrollLeft = left }
    commonEnvironmentScroll.current = []
    setCommonEnvironmentReturn(null)
  }, [view, commonEnvironmentReturn])
  const campLeaveGuardRef = useRef<{ threadId: string; guard: ThreadLeaveGuard } | null>(null)
  const navigationThreadPreparation = useRef<{
    threadId: string; guard: ThreadLeaveGuard; promise: Promise<ThreadLeavePreparation>; users: number; didLeave: boolean
  } | null>(null)
  const automationLeaveGuardRef = useRef<AutomationLeaveGuard | null>(null)
  const runtimeSettingsLeaveGuardRef = useRef<RuntimeStartupLeaveGuard | null>(null)
  const startupResolvedSessionId = useRef<string | null>(null)
  const pendingRestorableLocation = useRef<RestorableLocation | null>(null)
  const invalidatingNewConversationDefaults = useRef(false)
  const newConversationDefaultsRecheckPending = useRef(false)
  const [newConversationDefaultsRecheck, setNewConversationDefaultsRecheck] = useState(0)
  const campCreationPreflight = useMemo(
    () => campCreationPreflightFromAgents(agents),
    [agents]
  )
  activeThreadIdRef.current = activeThreadId
  viewRef.current = view
  notificationFocusRef.current = notificationFocus
  if (notificationPresentationRef.current === null) {
    notificationPresentationRef.current = createNotificationPresentationCoordinator()
  }

  const storeThreadSnapshot = useCallback((
    snapshot: ThreadSurfaceSnapshot | null,
    entryPreview = false,
    initialComposerDraft: ThreadComposerDraftView | null = null
  ): void => {
    if (snapshot && !taskCapabilityRef.current) {
      const { tasks: _tasks, ...rest } = snapshot
      const { tasks: _coverage, ...coverage } = snapshot.openCoverage ?? {}
      snapshot = { ...rest, tasksEnabled: false, ...(snapshot.openCoverage ? { openCoverage: coverage as typeof snapshot.openCoverage } : {}) }
    }
    campSnapshotRef.current = snapshot
    campSnapshotEntryPreviewRef.current = entryPreview
    if (snapshot) rememberThreadSnapshot(campSnapshotCache.current, snapshot)
    setThreadSnapshotState({ snapshot, entryPreview, initialComposerDraft })
  }, [])

  const consumeInitialComposerDraft = useCallback((draft: ThreadComposerDraftView): void => {
    setThreadSnapshotState((current) => current.initialComposerDraft === draft
      ? { ...current, initialComposerDraft: null }
      : current)
  }, [])

  const saveThreadReadState = useCallback(async (
    threadId: string,
    state: NavigationPreferencesSnapshot['threadReadStates'][string] | null
  ): Promise<void> => {
    const revision = Symbol()
    threadReadRevisions.current.set(threadId, revision)
    const { snapshot, confirmed } = await saveNavigationThreadReadState(uiPreferences.navigationPreferences, threadId, state)
    if (snapshot && threadReadRevisions.current.get(threadId) === revision) {
      // A late receipt only owns the one Thread that was written.
      const next = { ...threadReadStatesRef.current }
      const saved = snapshot.threadReadStates[threadId]
      if (saved) next[threadId] = saved
      else delete next[threadId]
      acceptThreadReadStates(next)
    }
    if (!confirmed) throw new Error(uiAttribute('本机阅读状态的保存结果尚未确认，请重试。'))
  }, [uiPreferences, acceptThreadReadStates])

  const clearThreadUnreadReminder = useCallback(async (threadId: string, revision: symbol | undefined): Promise<void> => {
    const current = threadReadStatesRef.current[threadId]
    // Only an explicit navigation with a full projection clears the reminder.
    // Startup restoration and automatic observation never enter this transition.
    if (campSnapshotRef.current?.thread.id === threadId && !campSnapshotEntryPreviewRef.current
      && revision === threadReadRevisions.current.get(threadId) && current?.manualUnread) {
      await saveThreadReadState(threadId, { ...current, manualUnread: false })
    }
  }, [saveThreadReadState])

  const clearThreadOpenFeedback = useCallback((): void => {
    if (campOpenFeedbackTimer.current !== null) {
      clearTimeout(campOpenFeedbackTimer.current)
      campOpenFeedbackTimer.current = null
    }
    setOpeningThreadId(null)
  }, [])

  const registerThreadLeaveGuard = useCallback((
    threadId: string,
    guard: ThreadLeaveGuard | null
  ): void => {
    if (guard) {
      campLeaveGuardRef.current = { threadId, guard }
    } else if (campLeaveGuardRef.current?.threadId === threadId) {
      campLeaveGuardRef.current = null
    }
  }, [])

  const leaveActiveThread = useCallback(async (
    transition: () => void | Promise<void>
  ): Promise<boolean> => {
    const leavingThreadId = activeThreadIdRef.current
    const registration = campLeaveGuardRef.current
    if (
      !activeThreadSurfaceNeedsLeaveGuard(viewRef.current, leavingThreadId)
      || registration?.threadId !== leavingThreadId
    ) {
      await transition()
      return true
    }

    let preparation = navigationThreadPreparation.current
    if (!preparation || preparation.threadId !== leavingThreadId || preparation.guard !== registration.guard) {
      preparation = { threadId: registration.threadId, guard: registration.guard,
        promise: Promise.resolve().then(registration.guard), users: 0, didLeave: false }
      navigationThreadPreparation.current = preparation
    }
    preparation.users += 1
    let prepared: ThreadLeavePreparation | undefined
    try {
      prepared = await preparation.promise
      await transition()
      await afterNextPaint()
      preparation.didLeave ||= viewRef.current !== 'camp' || activeThreadIdRef.current !== leavingThreadId
    } catch (nextError) {
      showOperationError('composer.leave', nextError)
      return false
    } finally {
      preparation.users -= 1
      if (preparation.users === 0) {
        prepared?.complete(preparation.didLeave)
        if (navigationThreadPreparation.current === preparation) navigationThreadPreparation.current = null
      }
    }
    return true
  }, [])

  const showArchiveLanding = useCallback((mission: boolean, onNotice?: (message: string) => void): void => {
    setActiveThreadId(null)
    storeThreadSnapshot(null)
    setNotificationFocus(null)
    setView(mission ? 'missions' : 'compose')
    onNotice?.(uiAttribute(mission ? '该使命已归档，可在「设置 → 归档」中取消归档' : '该会话已归档，可在「设置 → 归档」中取消归档'))
  }, [storeThreadSnapshot])

  const leaveArchivedWorkspace = useCallback((threadId: string, mission: boolean, onNotice?: (message: string) => void): void => {
    if (viewRef.current !== 'camp' || activeThreadIdRef.current !== threadId) return
    const { entries, index } = desktopNavigation.getSnapshot()
    const target = entries[index]
    if (target?.kind === 'camp' && target.threadId === threadId
      && desktopNavigation.captureCurrentEntry().update({ kind: mission ? 'missions' : 'quick_chat' })) {
      showArchiveLanding(mission, onNotice)
    }
  }, [desktopNavigation, showArchiveLanding])

  const setThreadSnapshot = useCallback((snapshot: ThreadSurfaceSnapshot | null, entryPreview = false,
    initialComposerDraft: ThreadComposerDraftView | null = null): void => {
    if (snapshot?.thread.archivedAt) {
      const { id, missionId } = snapshot.thread
      campSnapshotCache.current.delete(id)
      if (activeThreadIdRef.current === id && viewRef.current === 'camp' && !archiveWrites.current.has(id)) {
        void leaveActiveThread(() => leaveArchivedWorkspace(id, !!missionId, notify))
      }
      return
    }
    storeThreadSnapshot(snapshot, entryPreview, initialComposerDraft)
  }, [leaveActiveThread, leaveArchivedWorkspace, notify, storeThreadSnapshot])

  const registerAutomationLeaveGuard = useCallback((guard: AutomationLeaveGuard | null): void => {
    automationLeaveGuardRef.current = guard
  }, [])

  const registerRuntimeSettingsLeaveGuard = useCallback((guard: RuntimeStartupLeaveGuard | null): void => {
    runtimeSettingsLeaveGuardRef.current = guard
  }, [])

  const leaveActiveAutomation = useCallback(async (
    transition: () => void | Promise<void>
  ): Promise<boolean> => {
    try {
      return await runAutomationLeaveTransition(
        viewRef.current,
        automationLeaveGuardRef.current,
        transition
      )
    } catch (nextError) {
      showOperationError('automation.save', nextError)
      return false
    }
  }, [])

  const leaveActiveSurface = useCallback(async (
    transition: () => void | Promise<void>
  ): Promise<boolean> => {
    if (viewRef.current === 'settings' && runtimeSettingsLeaveGuardRef.current && !(await runtimeSettingsLeaveGuardRef.current())) return false
    let automationTransitioned = false
    const campTransitioned = await leaveActiveThread(async () => {
      automationTransitioned = await leaveActiveAutomation(transition)
    })
    return campTransitioned && automationTransitioned
  }, [leaveActiveAutomation, leaveActiveThread])

  const prepareForAppQuit = useCallback(async (): Promise<void> => {
    try {
      if (viewRef.current === 'teams' && teamLeaveGuard.current && !await teamLeaveGuard.current()) throw new Error(uiAttribute('团队更改尚未保存。'))
      await prepareActiveThreadForAppQuit(
        viewRef.current,
        activeThreadIdRef.current,
        campLeaveGuardRef.current
      )
      await prepareActiveAutomationForAppQuit(
        viewRef.current,
        automationLeaveGuardRef.current
      )
      await prepareFileEditsForQuit()
    } catch (nextError) {
      showOperationError('app.quit', nextError)
      throw nextError
    }
  }, [])

  useEffect(
    () => desktop?.appLifecycle.onPrepareQuit(prepareForAppQuit),
    [prepareForAppQuit]
  )

  const cancelPendingThreadActivation = useCallback((): void => {
    campSelectionGeneration.current += 1
    clearThreadOpenFeedback()
  }, [clearThreadOpenFeedback])

  const requestThreadProjection = useCallback(async (
    threadId: string,
    mode: 'enter' | 'open'
  ): Promise<{
    snapshot: ThreadSurfaceSnapshot
    traceId: string
    startedAt: number
    receivedAt: number
  }> => {
    const traceId = newCommandId()
    const startedAt = performance.now()
    const method = mode === 'enter' ? 'threads.enter' : 'threads.open'
    console.info(`[camp-open] trace=${traceId} stage=renderer_request method=${method}`)
    let capabilityRevision = taskCapabilityRevisionRef.current
    let projection = mode === 'enter'
      ? await client.request<ThreadOpenProjection>('threads.enter', {
          traceId,
          commandId: newCommandId(),
          command: { threadId }
        })
      : await requestAuthoritativeThreadOpenProjection(client, threadId, traceId)
    // A capability change can race an enter for a different Thread. Re-read an
    // obsolete projection without replaying enter or refreshing every navigation.
    // The revision also catches off/on cycles during the same request.
    while ((projection.schemaVersion === 9 || projection.schemaVersion === 10)
      && capabilityRevision !== taskCapabilityRevisionRef.current
      && projection.tasksEnabled !== taskCapabilityRef.current) {
      capabilityRevision = taskCapabilityRevisionRef.current
      projection = await requestAuthoritativeThreadOpenProjection(client, threadId, traceId)
    }
    if (projection.schemaVersion !== 9 && projection.schemaVersion !== 10) throw new Error(uiAttribute('会话打开数据版本不兼容。'))
    const receivedAt = performance.now()
    console.info(
      `[camp-open] trace=${traceId} stage=renderer_received method=${method} `
      + `elapsed_ms=${(receivedAt - startedAt).toFixed(1)} `
      + `schema=${projection.schemaVersion} high_water=${projection.throughGlobalSequence} `
      + `messages=${projection.messages.length} runs=${projection.agentRuns.length} `
      + `evidence=${projection.executionEvidence.length}`
    )
    return {
      snapshot: campOpenProjectionAsSnapshot(projection, campSnapshotRef.current),
      traceId,
      startedAt,
      receivedAt
    }
  }, [])

  useEffect(() => () => {
    notificationPresentationRef.current?.cancel()
  }, [])

  useEffect(() => () => {
    if (campOpenFeedbackTimer.current !== null) {
      clearTimeout(campOpenFeedbackTimer.current)
    }
  }, [])

  const [memberRosterEntryReady, setMemberRosterEntryReady] = useState(false)

  useEffect(() => {
    if (view !== 'members') return
    // A newly created member may not be in the cached roster yet.
    if (!memberRosterEntryReady) return
    const manageable = agents.filter((agent) => agent.presence !== 'removed' && agent.removedAt === null)
    if (selectedMemberId && manageable.some((agent) => agent.agentId === selectedMemberId)) return
    const next = manageable.find((agent) => agent.presence === 'present')
      ?? manageable.find((agent) => agent.presence === 'away')
      ?? null
    const agentId = next?.agentId ?? null
    if (agentId === selectedMemberId) return
    if (desktopNavigation.getSnapshot().entries.length) {
      if (displayedEntry.update({ kind: 'members', agentId, tab: memberTab })) setSelectedMemberId(agentId)
    } else setSelectedMemberId(agentId)
  }, [agents, selectedMemberId, view, memberTab, desktopNavigation, displayedEntry, memberRosterEntryReady])

  useEffect(() => {
    setThreadInspectorThreadId((current) => view === 'camp' && current === activeThreadId ? current : null)
    setSingleChatThreadId((current) => view === 'camp' && current === activeThreadId ? current : null)
  }, [activeThreadId, view])

  const memberRosterReader = useMemo(() => createMemberRosterReader(
    () => retryRead(() => client.request<AgentProfile[]>('members.list')),
    (nextAgents) => {
      setAgents(nextAgents)
      setMemberReadIssue(null)
      if (viewRef.current === 'members') setMemberRosterEntryReady(true)
    }
  ), [client])
  const loadAgents = useCallback((): Promise<AgentProfile[]> => memberRosterReader.refresh().catch(error => {
    setMemberReadIssue(reportOperationFailure('members.read', error).message)
    throw error
  }), [memberRosterReader])

  useEffect(() => {
    if (startupStatus !== 'resolved' || view !== 'members') return
    // Enter the page with its current roster; the read must not block navigation.
    void loadAgents().catch(() => undefined)
  }, [loadAgents, startupStatus, view])

  const commitNavigation = useCallback((
    nextNavigation: NavigationSnapshot,
    groupLimits: NavigationGroupLimits,
    selectedPrefixRow?: NavigationThreadItem
  ): void => {
    // A cold restore can confirm the selected row entirely from the window.
    if (selectedPrefixRow) {
      const cached = campSnapshotCache.current.get(selectedPrefixRow.id)
      if (cached) cached.navigationRow = selectedPrefixRow
    }
    const visibleNavigation = navigationWithoutDeletedThreads(
      nextNavigation,
      deletingThreadIdsRef.current
    )
    navigationSnapshotRef.current = visibleNavigation
    setNavigation(visibleNavigation)
    setNavigationGroupLimits(groupLimits)
    setNavigationState('ready')
  }, [])

  const navigationRefreshCoordinator = useMemo(
    () => createNavigationWindowReader(
      (request) => client.request<NavigationSnapshot>('navigation.snapshot', request),
      commitNavigation,
      {
        initiallyVisible: document.visibilityState !== 'hidden',
        readThreads: (threadIds) => client.request<NavigationThreadRows>('navigation.threads', { threadIds }),
        getPinnedThreadIds: () => pinnedThreadIdsRef.current,
        getActiveThread: () => selectedThreadRef.current,
        onRows: (rows, requestedIds) => {
          const pinnedIds = new Set(pinnedThreadIdsRef.current)
          const updatedIds = new Set(requestedIds)
          if (requestedIds.some(id => pinnedIds.has(id))) setPinReadIssue(null)
          setPinnedThreadItems(current => [
            ...current.filter(thread => pinnedIds.has(thread.id) && !updatedIds.has(thread.id)),
            ...rows.threads.filter(thread => pinnedIds.has(thread.id) && !deletingThreadIdsRef.current.has(thread.id))
          ])
          const visibleRows = new Map(rows.threads
            .filter(thread => !thread.archivedAt && !deletingThreadIdsRef.current.has(thread.id))
            .map(thread => [thread.id, thread]))
          for (const id of requestedIds) {
            const row = visibleRows.get(id) ?? null
            const cached = campSnapshotCache.current.get(id)
            if (cached) cached.navigationRow = row
            if (id === selectedThreadRef.current?.id) setOpenedNavigationRow(row)
          }
        },
        onError: () => setNavigationState('error')
      }
    ),
    [client, commitNavigation]
  )

  const loadNavigation = useCallback(async (
    trigger: NavigationRefreshTrigger = 'explicit'
  ): Promise<NavigationSnapshot> => {
    await navigationRefreshCoordinator.refresh(trigger)
    const snapshot = navigationSnapshotRef.current
    if (!snapshot) throw new Error(uiAttribute('会话导航暂时不可用，请重试。'))
    return snapshot
  }, [navigationRefreshCoordinator])

  const loadPins = useCallback(async (): Promise<void> => {
    try {
      await retryRead(navigationRefreshCoordinator.refreshPins)
      setPinReadIssue(null)
    } catch (error) {
      setPinReadIssue(reportOperationFailure('navigation.pins.read', error).message)
    }
  }, [navigationRefreshCoordinator])
  useEffect(() => { void loadPins() }, [loadPins, navigationPins])

  const retryThreadDeletion = useCallback((operationId: string): void => {
    const retry = (): void => {
      void client.request<StoredCommandResult>('threads.retryDeletion', {
        commandId: newCommandId(),
        command: { operationId }
      }).then((result) => {
        if (result.status === 'rejected') throw new OperationFailure(normalizeFailure(result))
      }).catch(error => {
        const feedback = reportOperationFailure('thread.delete', error)
        if (feedback.outcome === 'gone') {
          notify(feedback.message)
          return
        }
        const canRetry = normalizeFailure(error).code !== 'camp.deletion_retry_user_required'
        notifyError(feedback.message, canRetry ? { label: uiAttribute('重试'), icon: 'retry', onSelect: retry } : undefined)
      })
    }
    retry()
  }, [client, notify, notifyError])

  const loadThreadDeletionIssues = useCallback(async (): Promise<void> => {
    const issues = await client.request<ThreadDeletionIssue[]>('threads.deletionIssues')
    const issue = issues.find(({ operationId, attentionRevision }) => (
      !shownDeletionIssuesRef.current.has(`${operationId}:${attentionRevision}`)
    ))
    if (!issue) return
    shownDeletionIssuesRef.current.add(`${issue.operationId}:${issue.attentionRevision}`)
    notifyError(
      uiAttribute('删除未完成，请重试。'),
      { label: uiAttribute('重试'), icon: 'retry', onSelect: () => retryThreadDeletion(issue.operationId) }
    )
  }, [client, notifyError, retryThreadDeletion])

  const loadOnboarding = useCallback((): Promise<void> => {
    if (!desktop) return Promise.resolve()
    if (onboardingSnapshotRequest.current) return onboardingSnapshotRequest.current
    const request = (async (): Promise<void> => {
      setOnboardingError(null)
      try {
        const snapshot = await desktop.onboarding.get()
        if (snapshot.status === 'uninitialized') {
          throw new Error(uiAttribute('首次引导状态尚未就绪，请重试。'))
        }
        setOnboardingSnapshot(snapshot)
      } catch (nextError) {
        setOnboardingError(errorMessage(nextError))
      }
    })()
    onboardingSnapshotRequest.current = request
    void request.finally(() => {
      if (onboardingSnapshotRequest.current === request) onboardingSnapshotRequest.current = null
    }).catch(() => undefined)
    return request
  }, [])

  const applyNavigationPreferences = useCallback((snapshot: NavigationPreferencesSnapshot): void => {
    navigationPreferencesRef.current = snapshot
    setNavigationPreferences(snapshot)
    setNavigationPins(snapshot.pins)
    setRemovedProjectKeys(current => {
      const next = new Set(snapshot.removedProjects.map(project => project.targetKey))
      return current.size === next.size && [...current].every(key => next.has(key)) ? current : next
    })
    setProjectNames(snapshot.projectNames)
    acceptThreadReadStates(snapshot.threadReadStates ?? {})
    setRemovedProjectAuthorityReady(true)
  }, [acceptThreadReadStates])

  useEffect(() => uiPreferences.navigationPreferences.onChanged?.(applyNavigationPreferences), [uiPreferences, applyNavigationPreferences])

  const moveProject = useCallback(async (move: NavigationProjectMove) => {
    const previous = navigationPreferencesRef.current
    setPendingProjectMoves(current => [...current, move])
    try {
      const saved = await uiPreferences.navigationPreferences.moveProject(move)
      if (navigationPreferencesRef.current === previous) applyNavigationPreferences(saved)
    } catch {
      // Removing this move below reveals the latest confirmed order, including other windows' edits.
    } finally {
      setPendingProjectMoves(current => current.filter(pending => pending !== move))
    }
  }, [uiPreferences, applyNavigationPreferences])

  const registerProject = useCallback(async (projectPath: string, explicit = false): Promise<void> => {
    const current = navigationPreferencesRef.current
    const key = projectTargetKey(projectPath)
    if (current?.registeredProjects.includes(projectPath) && !current.removedProjects.some(p => p.targetKey === key)) return
    if (current?.removedProjects.some(p => p.targetKey === key)) {
      if (!explicit) return
      // An explicit access restoration still owns its normal permission checks.
      applyNavigationPreferences(await uiPreferences.navigationPreferences.restoreProject(key))
      return
    }
    try {
      const saved = await uiPreferences.navigationPreferences.registerProjects([projectPath])
      applyNavigationPreferences(saved)
    } catch {
      if (explicit) throw new Error(uiAttribute('项目目录未保存，请重新添加。'))
      notifyError(uiAttribute('项目目录未保存，现有会话仍可正常使用。'))
    }
  }, [uiPreferences, applyNavigationPreferences, notifyError])
  const restoreNavigationProject = useCallback((path: string) => registerProject(path, true), [registerProject])

  const completeLegacyProjects = useCallback(async (fullNavigation: NavigationSnapshot): Promise<void> => {
    if (legacyProjectAttempted.current || navigationPreferencesRef.current?.legacyProjectsSynced) return
    legacyProjectAttempted.current = true
    try {
      const current = navigationPreferencesRef.current
      if (!current || current.readError) throw new Error('Project preferences are unavailable')
      const paths = fullNavigation.projects.map(project => project.projectPath)
      if (legacySelectedProject.kind === 'directory' && isProjectPath(legacySelectedProject.projectPath)) paths.push(legacySelectedProject.projectPath)
      applyNavigationPreferences(await uiPreferences.navigationPreferences.registerProjects(paths, true))
    } catch {
      notifyError(uiAttribute('项目目录未保存，现有会话仍可正常使用。'))
    }
  }, [uiPreferences, applyNavigationPreferences, legacySelectedProject, notifyError])

  const loadInstallations = useMemo(() => createRuntimeRefresh(async () => {
    const next = await retryRead(() => client.request<AdapterInstallation[]>('runtime.installations.list'))
    setInstallations(next)
    return next
  }), [client])

  const loadOverview = useCallback((showLoading = false): Promise<boolean> => {
    if (showLoading) setState('loading')
    if (overviewRequest.current) return overviewRequest.current
    setError(current => current?.operation === 'overview.read' || current?.operation === 'core.recover' ? null : current)
    const request = (async (): Promise<boolean> => {
      try {
        // Navigation is the most broadly useful Overview projection. Route-specific
        // startup authority is queued before this background load, while the remaining
        // projections can populate independently as their serialized Core replies arrive.
        const nextNavigationPromise = loadNavigation()
        const nextAgentsPromise = loadAgents()
        const nextInstallationsPromise = loadInstallations()
        const nextNavigationPreferencesPromise = navigationPreferencesRead.current ??= uiPreferences.navigationPreferences.get()
          .catch(() => ({ ...structuredClone(EMPTY_SNAPSHOT), readError: '导航偏好暂时无法读取。' }))
        // Apply the snapshot independently: failed optional persistence cannot hide
        // a successful Core navigation read or disable normal conversation actions.
        const preferencesReady = nextNavigationPreferencesPromise.then(snapshot => {
          if (!navigationPreferencesRef.current) applyNavigationPreferences(snapshot)
          return navigationPreferencesRef.current!
        })
        const navigationOverviewPromise = (async (): Promise<void> => {
          const nextNavigation = await nextNavigationPromise
          const preferences = await preferencesReady
          void completeLegacyProjects(nextNavigation)
          const projection = navigationWithProjectDirectories(nextNavigation, preferences)!
          const resolvedPins = await resolveNavigationPins(projection, preferences.pins, client)
          // Only prune against a complete, saved directory projection.
          if (preferences.legacyProjectsSynced && !preferences.readError && resolvedPins.pins.length !== preferences.pins.length) {
            void uiPreferences.navigationPreferences.replacePins(resolvedPins.pins)
              .then(applyNavigationPreferences).catch(() => undefined)
          }
          setPinnedThreadItems(resolvedPins.threads.filter(thread => !deletingThreadIdsRef.current.has(thread.id)))
        })()
        const results = await Promise.allSettled([
          navigationOverviewPromise,
          nextAgentsPromise,
          nextInstallationsPromise
        ])
        const navigationReady = results[0].status === 'fulfilled'
        if (results[0].status === 'rejected' && !navigationSnapshotRef.current) {
          showOperationError('overview.read', results[0].reason)
        }
        setState(navigationReady ? 'ready' : 'error')
        return navigationReady
      } catch (nextError) {
        if (!navigationSnapshotRef.current) showOperationError('overview.read', nextError)
        setState(navigationSnapshotRef.current ? 'ready' : 'error')
        return false
      }
    })()
    overviewRequest.current = request
    void request.finally(() => {
      if (overviewRequest.current === request) overviewRequest.current = null
    }).catch(() => undefined)
    return request
  }, [loadAgents, loadInstallations, loadNavigation, applyNavigationPreferences, completeLegacyProjects, showOperationError, uiPreferences])

  useEffect(() => {
    let cancelled = false
    if (!memoryCapability.active) {
      setMemoryReviewNotice(null)
      setMemoryAutoNotice([])
      return
    }
    const boundary = memoryCapability.headsUpAfterGlobalSequence
    setMemoryReviewNotice(current => current !== null && current > boundary ? current : null)
    setMemoryAutoNotice(current => memoryChangesAfter(current, boundary))
    // The mounted page already reads this list and reports its pending count.
    if (memoryPageOpen) return
    void client.request<HearthReviewItem[]>('memory.hearthReviewItems.list').then(items => {
      if (!cancelled && memoryCapabilityRef.current.active) {
        setPendingMemoryCount(items.filter(item => item.status === 'pending').length)
      }
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [client, memoryCapability.active, memoryCapability.headsUpAfterGlobalSequence, memoryRefreshKey, memoryPageOpen])

  const loadRuntime = useMemo(() => createRuntimeRefresh(async () => {
    setHealthAttempted(true)
    setHealthLoading(true)
    try {
      const results = await Promise.allSettled([
        retryRead(() => client.request<RuntimeStatus>('runtime.status.get')),
        loadInstallations()
      ])
      if (results[0].status === 'fulfilled') setHealth(results[0].value)
      const failure = results.find(result => result.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
      setRuntimeReadIssue(null)
    } catch (error) {
      setRuntimeReadIssue(reportOperationFailure('runtime.read', error).message)
      throw error
    } finally { setHealthLoading(false) }
  }), [client, loadInstallations])

  const refreshOnboardingRuntime = useCallback((): Promise<void> => {
    if (onboardingRuntimeRequest.current) return onboardingRuntimeRequest.current
    const request = (async (): Promise<void> => {
      setOnboardingError(null)
      try {
        setOnboardingRuntimePhase('discovering')
        await client.request('runtime.discovery.rescan', { interactiveShell: true })

        setOnboardingRuntimePhase('checking')
        await loadRuntime()
        setOnboardingRuntimePhase('models')
        setOnboardingRuntimePhase('ready')
      } catch (nextError) {
        setOnboardingRuntimePhase('error')
        setOnboardingError(errorMessage(nextError))
      }
    })()
    onboardingRuntimeRequest.current = request
    void request.finally(() => {
      if (onboardingRuntimeRequest.current === request) onboardingRuntimeRequest.current = null
    }).catch(() => undefined)
    return request
  }, [client, loadRuntime])

  const loadMemberData = useCallback(async (): Promise<void> => {
    await Promise.all([loadAgents(), loadInstallations()])
  }, [loadAgents, loadInstallations])

  const loadStartupSnapshot = useCallback((): Promise<void> => {
    if (!desktop) return Promise.resolve()
    if (startupSnapshotRequest.current) return startupSnapshotRequest.current
    const request = (async (): Promise<void> => {
      try {
        console.info(
          `[startup] trace=${startupTraceId.current} stage=main_session_request `
          + `elapsed_ms=${(performance.now() - startupStartedAt.current).toFixed(1)}`
        )
        const [snapshot, preferences] = await Promise.all([
          desktop.desktopSession.getStartupSnapshot(),
          uiPreferences.generalPreferences.get()
        ])
        const target = startupTargetFromSnapshot(snapshot)
        desktopNavigation.reset()
        cancelPendingThreadActivation()
        setActiveThreadId(null)
        setThreadSnapshot(null)
        setNotificationFocus(null)
        setStartupRouteTarget(target)
        if (target.kind === 'camp') {
          setView('camp')
        } else if (target.kind === 'teams') {
          setView('teams')
        } else if (target.kind === 'members') {
          setSelectedMemberId(target.agentId)
          setMemberTab(target.tab)
          setView('members')
        } else if (target.kind === 'memory') {
          setView('memory')
        } else {
          setView('compose')
        }
        setGeneralPreferences(preferences)
        setStartupSnapshot(snapshot)
        setSettingsSection(snapshot.lastSettingsSection)
        setStartupError(null)
        console.info(
          `[startup] trace=${startupTraceId.current} stage=main_session_received `
          + `target=${target.kind} elapsed_ms=${(performance.now() - startupStartedAt.current).toFixed(1)}`
        )
      } catch (nextError) {
        setStartupStatus('waiting')
        setStartupError(errorMessage(nextError))
      }
    })()
    startupSnapshotRequest.current = request
    void request.finally(() => {
      if (startupSnapshotRequest.current === request) startupSnapshotRequest.current = null
    }).catch(() => undefined)
    return request
  }, [cancelPendingThreadActivation, setThreadSnapshot, desktopNavigation])

  const completeStartup = useCallback((sessionId: string): void => {
    startupResolvedSessionId.current = sessionId
    setStartupStatus('resolved')
    setStartupError(null)
    setStartupRouteTarget(null)
  }, [])

  const commitRestorableLocation = useCallback(async (
    location: RestorableLocation
  ): Promise<void> => {
    if (!desktop) return
    pendingRestorableLocation.current = location
    try {
      await desktop.desktopSession.commitRestorableLocation(location)
      if (JSON.stringify(pendingRestorableLocation.current) === JSON.stringify(location)) {
        setLocationSaveError(null)
      }
    } catch (nextError) {
      setLocationSaveError(errorMessage(nextError))
    }
  }, [])

  const activateThreadWithoutLeaveGuard = useCallback(async (
    threadId: string,
    options: ActivateThreadOptions,
    selectionGeneration: number,
    transaction?: NavigationTransaction
  ): Promise<boolean> => {
    if (selectionGeneration !== campSelectionGeneration.current || (transaction && !transaction.isCurrent())) return false
    const cachedSnapshot = activeThreadIdRef.current === threadId
      ? null
      : recentThreadSnapshot(campSnapshotCache.current, threadId)
    const previewSnapshot = campActivationPreview(
      campSnapshotRef.current,
      activeThreadIdRef.current,
      cachedSnapshot,
      threadId
    )
    const commitThreadSurface = (
      snapshot: ThreadSurfaceSnapshot,
      entryPreview = false,
      initialComposerDraft: ThreadComposerDraftView | null = null
    ): void => {
      if (transaction && !transaction.commit()) return
      if (entryPreview) verifyingPreview.current = { generation: selectionGeneration, projectChosen: false }
      const preview = verifyingPreview.current
      if (preview?.generation !== selectionGeneration || !preview.projectChosen) {
        const snapshotProject = currentProjectForThread(snapshot.thread)
        setCurrentProject(snapshotProject)
        persistCurrentProject(snapshotProject)
      }
      if (!entryPreview) verifyingPreview.current = null
      campEventSequenceMarker.current = snapshot.throughGlobalSequence
      if (!options.preserveNotificationFocus) {
        setNotificationFocus(null)
        setNotificationAnchor(null)
      }
      if ((options.anchoredMessages?.length ?? 0) > 0
        || (options.anchoredAgentRuns?.length ?? 0) > 0
        || (options.anchoredTasks?.length ?? 0) > 0) {
        setNotificationAnchor({
          threadId,
          messages: options.anchoredMessages ?? [],
          agentRuns: options.anchoredAgentRuns ?? [],
          tasks: options.anchoredTasks ?? []
        })
      }
      setActiveThreadId(threadId)
      setThreadSnapshot(snapshot, entryPreview, initialComposerDraft)
      setNavigationFind(entryPreview ? null : options.navigationFind ?? null)
      if (snapshot.thread.missionId && options.missionPresentation) {
        setMissionPresentation(options.missionPresentation)
      }
      setView('camp')
    }
    // A preview commits navigation before the authoritative request finishes.
    // Fork recovery must preserve the current page until full opening succeeds.
    const openingFromCache = previewSnapshot && !previewSnapshot.thread.archivedAt && !options.stayOnOpenFailure
    if (openingFromCache) {
      commitThreadSurface(previewSnapshot, true)
    } else {
      campOpenFeedbackTimer.current = setTimeout(() => {
        campOpenFeedbackTimer.current = null
        if (selectionGeneration === campSelectionGeneration.current) {
          setOpeningThreadId(threadId)
        }
      }, CAMP_OPEN_FEEDBACK_DELAY_MS)
    }
    try {
      const { snapshot, traceId, startedAt, receivedAt } = await requestThreadProjection(
        threadId,
        options.reconcileDefaultLead === false ? 'open' : 'enter'
      )
      if (selectionGeneration !== campSelectionGeneration.current || (transaction && !transaction.isCurrent())) {
        return false
      }
      clearThreadOpenFeedback()
      if (snapshot.thread.archivedAt) {
        campSnapshotCache.current.delete(threadId)
        const mission = !!snapshot.thread.missionId
        if (!transaction || transaction.commit({ kind: mission ? 'missions' : 'quick_chat' })) showArchiveLanding(mission, options.onArchived ?? notify)
        return false
      }
      commitThreadSurface(snapshot, false, null)
      await afterNextPaint()
      if (selectionGeneration !== campSelectionGeneration.current) return false
      const paintedAt = performance.now()
      console.info(
        `[camp-open] trace=${traceId} stage=renderer_meaningful_paint `
        + `elapsed_ms=${(paintedAt - startedAt).toFixed(1)} `
        + `paint_ms=${(paintedAt - receivedAt).toFixed(1)}`
      )
      void (async () => {
        await navigationRefreshCoordinator.refreshThreads([threadId], 'explicit')
        if (selectionGeneration !== campSelectionGeneration.current) return
        console.info(
          `[camp-open] trace=${traceId} stage=renderer_background_complete `
          + `elapsed_ms=${(performance.now() - startedAt).toFixed(1)}`
        )
      })().catch(error => {
        if (selectionGeneration === campSelectionGeneration.current) reportOperationFailure('navigation.read', error)
      })
      return true
    } catch (nextError) {
      if (selectionGeneration !== campSelectionGeneration.current) return false
      clearThreadOpenFeedback()
      if (transaction && !transaction.isCurrent()) return false
      // A removed historical resource resolves to a real page by replacing this entry.
      const failure = normalizeFailure(nextError)
      const exists = failure.kind === 'connection' || await client.request<boolean>('threads.exists', { threadId }).catch(() => true)
      if (selectionGeneration !== campSelectionGeneration.current || (transaction && !transaction.isCurrent())) return false
      if (!exists && !options.stayOnOpenFailure && transaction?.commit({ kind: 'quick_chat' })) {
        setActiveThreadId(null)
        setThreadSnapshot(null)
        setView('compose')
      } else if (!options.suppressErrors) {
        const target = navigationSnapshotRef.current && allNavigationThreads(navigationSnapshotRef.current).find(thread => thread.id === threadId)
        const subject = options.title ?? (target ? formatThreadTitle(target) : undefined)
        const visit = desktopNavigation.captureVisit()
        const feedback = reportOperationFailure(openingFromCache ? 'thread.refresh' : 'thread.open', nextError, { subject })
        const action: AppToastAction = {
          label: uiAttribute('重试'), icon: 'retry',
          onSelect: () => {
            if (!visit.isCurrent() || selectionGeneration !== campSelectionGeneration.current || shuttingDownRef.current) return
            const navigate = campSnapshotEntryPreviewRef.current && activeThreadIdRef.current === threadId
              ? desktopNavigation.replace : desktopNavigation.push
            void navigate({ kind: 'camp', threadId }, { campOptions: options })
          }
        }
        if (openingFromCache) setToast({ message: feedback.message, tone: 'neutral', actions: [action] })
        else notifyError(feedback.message, action)
      }
      return false
    }
  }, [clearThreadOpenFeedback, client, desktopNavigation, navigationRefreshCoordinator, notify, notifyError, requestThreadProjection, setThreadSnapshot, showArchiveLanding])

  const activateThread = useCallback(async (
    threadId: string,
    options: ActivateThreadOptions = {}
  ): Promise<boolean> => {
    const readRevision = threadReadRevisions.current.get(threadId)
    const sameThread = viewRef.current === 'camp' && activeThreadIdRef.current === threadId
    const navigate = sameThread && (campSnapshotEntryPreviewRef.current || options.navigationFind)
      ? desktopNavigation.replace : desktopNavigation.push
    const activated = await navigate({ kind: 'camp', threadId }, { campOptions: options, memberPrepared: options.memberPrepared })
    const state = desktopNavigation.getSnapshot()
    const target = state.entries[state.index]
    if (target?.kind !== 'camp' || target.threadId !== threadId) return false
    if (viewRef.current === 'camp' && activeThreadIdRef.current === threadId) {
      if ((options.anchoredMessages?.length ?? 0) > 0
        || (options.anchoredAgentRuns?.length ?? 0) > 0
        || (options.anchoredTasks?.length ?? 0) > 0) {
        setNotificationAnchor({
          threadId,
          messages: options.anchoredMessages ?? [],
          agentRuns: options.anchoredAgentRuns ?? [],
          tasks: options.anchoredTasks ?? []
        })
      }
      if (campSnapshotRef.current?.thread.missionId && options.missionPresentation) {
        setMissionPresentation(options.missionPresentation)
      }
      await clearThreadUnreadReminder(threadId, readRevision)
      return true
    }
    return activated
  }, [desktopNavigation, clearThreadUnreadReminder])

  useEffect(() => {
    if (startupStatus === 'resolved') void forkOperation.recover()
  }, [forkOperation, startupStatus])

  const openFork = useCallback(async (onlyIf?: () => boolean): Promise<void> => {
    if (forkOpening.current) return
    forkOpening.current = true
    try {
      const target = forkOperation.persistTarget()
      if (!target) return
      if (onlyIf && !onlyIf()) return
      const targetVisible = viewRef.current === 'camp' && activeThreadIdRef.current === target
      if (targetVisible && campSnapshotRef.current?.thread.id === target && !campSnapshotEntryPreviewRef.current) {
        forkOperation.dismiss()
        return
      }
      const navigate = targetVisible && campSnapshotEntryPreviewRef.current
        ? desktopNavigation.replace : desktopNavigation.push
      const opened = await navigate({ kind: 'camp', threadId: target }, {
        campOptions: { reconcileDefaultLead: false, suppressErrors: true, stayOnOpenFailure: true }, onlyIf
      })
      const navigation = desktopNavigation.getSnapshot()
      const destination = navigation.entries[navigation.index]
      if (opened && destination?.kind === 'camp' && destination.threadId === target
        && campSnapshotRef.current?.thread.id === target && !campSnapshotEntryPreviewRef.current) {
        if (forkOperation.getSnapshot().saved?.threadId === target) forkOperation.dismiss()
      }
    } catch { /* A known copy remains in navigation; no completion/opening-failure toast. */ }
    finally { forkOpening.current = false }
  }, [desktopNavigation, forkOperation])

  const retryFork = useCallback(async (): Promise<void> => {
    const origin = forkOrigin.current
    const automatic = !!origin && origin.visit.isCurrent()
      && viewRef.current === 'camp' && activeThreadIdRef.current === origin.threadId
    const target = await forkOperation.retry()
    if (target && automatic && origin.visit.isCurrent()) {
      await openFork(() => origin.visit.isSameVisit()
        && viewRef.current === 'camp' && activeThreadIdRef.current === origin.threadId)
    }
  }, [forkOperation, openFork])

  const forkThread = useCallback(async (sourceThreadId: string, sourceMessageId?: string): Promise<void> => {
    const current = forkOperation.getSnapshot()
    if (current.phase === 'pending') return
    if (current.phase === 'unknown'
      && (current.saved?.sourceThreadId !== sourceThreadId || current.saved.sourceMessageId !== sourceMessageId)) {
      setDismissedForkState(null)
      return
    }
    const visit = desktopNavigation.captureVisit()
    const fromSource = viewRef.current === 'camp' && activeThreadIdRef.current === sourceThreadId
    forkOrigin.current = fromSource ? { threadId: sourceThreadId, visit } : null
    if (current.phase === 'unknown') {
      await retryFork()
      return
    }
    const target = await forkOperation.start({ commandId: newCommandId(), sourceThreadId,
      ...(sourceMessageId ? { sourceMessageId } : {}) })
    if (target && fromSource && visit.isCurrent()) {
      await openFork(() => visit.isSameVisit() && viewRef.current === 'camp' && activeThreadIdRef.current === sourceThreadId)
    }
  }, [desktopNavigation, forkOperation, openFork, retryFork])

  const forkToast = useMemo<AppToastValue | null>(() => {
    if (dismissedForkState === forkState) return null
    if (forkState.phase === 'unknown') {
      return {
        message: translateUi(interfaceLanguage, '分叉结果尚未确认'), tone: 'danger',
        actions: [{ label: translateUi(interfaceLanguage, '重试'), icon: 'retry', onSelect: () => { void retryFork() } }]
      }
    }
    if (forkState.phase === 'rejected') return { message: translateUi(interfaceLanguage, forkState.error ?? '分叉失败'), tone: 'danger' }
    return forkLoading ? { message: translateUi(interfaceLanguage, '正在分叉…'), tone: 'neutral', loading: true } : null
  }, [dismissedForkState, forkLoading, forkState, interfaceLanguage, retryFork])

  useEffect(() => desktop?.userAutomation.onOpenThread(({ threadId }) => {
    void activateThread(threadId, { reconcileDefaultLead: false })
  }), [activateThread])

  const threadRefreshIsCurrent = useCallback((threadId: string): boolean =>
    viewRef.current === 'camp' && activeThreadIdRef.current === threadId
      && !deletingThreadIdsRef.current.has(threadId) && !shuttingDownRef.current, [])

  const refreshActiveThreadSnapshotOnce = useCallback(async (threadId: string): Promise<void> => {
    const visit = desktopNavigation.captureVisit()
    const isCurrent = () => visit.isSameVisit() && threadRefreshIsCurrent(threadId)
    let snapshot: ThreadSurfaceSnapshot
    try {
      snapshot = (await requestThreadProjection(threadId, 'open')).snapshot
    } catch (nextError) {
      if (!isCurrent()) return
      if (normalizeFailure(nextError).kind === 'connection') throw nextError
      // Web invalidation can arrive before the delete receipt, or from another
      // client. Confirm removal through Core instead of treating a stale read as
      // a failed delete; a failed existence check still preserves the read error.
      const exists = await client.request<boolean>('threads.exists', { threadId }).catch(() => true)
      if (!isCurrent()) return
      if (!exists) {
        hideAcceptedThreadDeletion(threadId)
        return
      }
      throw nextError
    }
    if (!isCurrent()) return
    if (snapshot.throughGlobalSequence < campEventSequenceMarker.current) return
    campEventSequenceMarker.current = snapshot.throughGlobalSequence
    setThreadSnapshot(snapshot)
    setConfirmingRunIds(new Set())
  }, [client, desktopNavigation, requestThreadProjection, setThreadSnapshot, threadRefreshIsCurrent])

  const activeThreadRefreshCoordinator = useMemo(
    () => createActiveThreadRefreshCoordinator(refreshActiveThreadSnapshotOnce, threadRefreshIsCurrent),
    [refreshActiveThreadSnapshotOnce, threadRefreshIsCurrent]
  )

  const refreshActiveThreadSnapshot = useCallback(async (threadId: string): Promise<void> => {
    const visit = desktopNavigation.captureVisit()
    await activeThreadRefreshCoordinator.refresh(threadId)
    if (visit.isSameVisit() && threadRefreshIsCurrent(threadId)) threadRefreshRecovery.succeeded(threadId, 'snapshot')
  }, [activeThreadRefreshCoordinator, desktopNavigation, threadRefreshIsCurrent, threadRefreshRecovery])

  const refreshThreadInBackground = useCallback(async (threadId: string): Promise<void> => {
    // The upcoming read covers notifications received during backoff. Once it
    // starts, the coordinator coalesces new notifications into a trailing read.
    if (!threadRefreshIsCurrent(threadId) || threadRefreshRecovery.isWaitingToRetry(threadId)) return
    const visit = desktopNavigation.captureVisit()
    const read = () => refreshActiveThreadSnapshot(threadId)
    await read().catch(error => {
      if (visit.isSameVisit()) return threadRefreshRecovery.recover(threadId, 'snapshot', read, error)
    })
  }, [desktopNavigation, refreshActiveThreadSnapshot, threadRefreshIsCurrent, threadRefreshRecovery])

  useEffect(() => {
    if (!taskCapability.ready) return
    if (!taskCapability.enabled) {
      campSnapshotCache.current.clear()
      if (campSnapshotRef.current) setThreadSnapshot(campSnapshotRef.current, campSnapshotEntryPreviewRef.current, campSnapshotState.initialComposerDraft)
      if (campInspectorTab === 'tasks') setThreadInspectorThreadId(null)
      if (notificationFocusRef.current?.kind === 'task') {
        notificationPresentationRef.current?.cancel()
        setNotificationFocus(null)
      }
    }
    // Capability changes invalidate the current surface. Ordinary navigation
    // already verifies its cached preview with threads.enter and must retain it.
    const threadId = activeThreadIdRef.current
    if (threadId) void refreshActiveThreadSnapshot(threadId).catch(() => undefined)
  }, [taskCapability.enabled, taskCapability.ready, refreshActiveThreadSnapshot])

  const loadEarlierThreadMessages = useCallback(async (): Promise<void> => {
    const requestedSnapshot = campSnapshotRef.current
    const coverage = requestedSnapshot?.openCoverage?.messages
    const beforeSequence = coverage?.oldestLoadedSequence ?? null
    if (!requestedSnapshot || !coverage?.hasEarlier || beforeSequence === null) return
    const threadId = requestedSnapshot.thread.id
    const selectionGeneration = campSelectionGeneration.current
    const page = await client.request<ThreadMessagePage>('thread.messages.page', {
      threadId,
      beforeSequence,
      throughGlobalSequence: requestedSnapshot.throughGlobalSequence,
      limit: 50
    })
    if (
      page.schemaVersion !== 1
      || page.threadId !== threadId
      || page.throughGlobalSequence !== requestedSnapshot.throughGlobalSequence
      || page.requestedBeforeSequence !== beforeSequence
      || page.hasMore !== (page.nextBeforeSequence !== null)
      || page.messages.some((message) => message.sequence >= beforeSequence)
    ) {
      throw new Error(uiAttribute('较早消息数据不兼容，请重新打开会话。'))
    }
    if (selectionGeneration !== campSelectionGeneration.current) return
    const current = campSnapshotRef.current
    if (!current || current.thread.id !== threadId) return
    const messagesById = new Map(current.messages.map((message) => [message.id, message]))
    for (const message of page.messages) messagesById.set(message.id, message)
    const messages = [...messagesById.values()].sort((left, right) =>
      left.sequence - right.sequence || left.id.localeCompare(right.id)
    )
    const loadedCount = messages.length
    const totalCount = page.hasMore
      ? Math.max(current.openCoverage?.messages.totalCount ?? 0, loadedCount + 1)
      : loadedCount
    const omittedCount = Math.max(0, totalCount - loadedCount)
    setThreadSnapshot({
      ...current,
      messages,
      openCoverage: current.openCoverage
        ? {
            ...current.openCoverage,
            messages: {
              ...current.openCoverage.messages,
              loadedCount,
              totalCount,
              omittedCount,
              complete: !page.hasMore,
              hasEarlier: page.hasMore,
              oldestLoadedSequence: messages[0]?.sequence ?? null,
              newestLoadedSequence: messages.at(-1)?.sequence ?? null
            }
          }
        : undefined
    })
  }, [setThreadSnapshot])

  const refreshVisibleNotificationThread = useCallback(async (
    _episode: NotificationEpisodeView,
    action: NotificationActionView
  ): Promise<boolean> => {
    if (action.kind !== 'open_camp_message' || !action.messageId) return false
    const threadId = action.threadId
    if (activeThreadIdRef.current !== threadId || viewRef.current !== 'camp') return false
    await refreshActiveThreadSnapshot(threadId)
    await afterNextPaint()
    if (activeThreadIdRef.current !== threadId || viewRef.current !== 'camp') return false
    if (!action.available) return false
    return notificationMessageIsVisible(action.messageId)
  }, [refreshActiveThreadSnapshot])

  useEffect(() => {
    if (startupStatus !== 'resolved') return
    void loadThreadDeletionIssues().catch(() => undefined)
  }, [loadThreadDeletionIssues, startupStatus])

  useEffect(() => {
    if (notificationFocus?.kind !== 'camp_message' && notificationFocus?.kind !== 'agent_run') {
      setNotificationAnchor(null)
    }
  }, [notificationFocus])

  useEffect(() => {
    if (!campSnapshot) return
    const persistedIds = new Set(campSnapshot.messages.map((message) => message.id))
    setOptimisticThreadMessages((current) => {
      const next = current.filter((entry) =>
        entry.threadId !== campSnapshot.thread.id || !persistedIds.has(entry.message.id)
      )
      return next.length === current.length ? current : next
    })
  }, [campSnapshot])

  useEffect(() => {
    if (!campSnapshot) return
    setCancellingTurnIds((current) => reconcileCancellingTurnIds(current, campSnapshot))
  }, [campSnapshot])

  useEffect(() => {
    if (desktop) void loadStartupSnapshot()
    else {
      void readGeneralPreferences()
      void loadOverview(true)
    }
  }, [desktop, loadStartupSnapshot, loadOverview, readGeneralPreferences])

  useEffect(() => {
    if (desktop) void loadOnboarding()
  }, [desktop, loadOnboarding])

  useEffect(() => {
    if (
      onboardingSnapshot?.status !== 'in_progress'
      || onboardingSnapshot.step !== 'runtime'
      || onboardingRuntimePhase !== 'idle'
    ) return
    void refreshOnboardingRuntime()
  }, [onboardingRuntimePhase, onboardingSnapshot, refreshOnboardingRuntime])

  useEffect(() => {
    if (invalidatingNewConversationDefaults.current) {
      newConversationDefaultsRecheckPending.current = true
      return
    }
    if (!shouldInvalidateNewConversationDefaults(generalPreferences, agents, state === 'ready' && !teamLibrary.loading && !teamLibrary.error, teamLibrary.teams)) return
    invalidatingNewConversationDefaults.current = true
    void uiPreferences.generalPreferences.invalidateNewConversationDefaults({
      expectedTeamId: generalPreferences?.newConversationTeamId ?? null,
      expectedDefaults: generalPreferences?.newConversationDefaults ?? null
    })
      .then(setGeneralPreferences)
      .catch(error => reportOperationFailure('preferences.save', error))
      .finally(() => {
        invalidatingNewConversationDefaults.current = false
        // Coalesce observations received in flight; an unchanged receipt alone never retries.
        if (newConversationDefaultsRecheckPending.current) {
          newConversationDefaultsRecheckPending.current = false
          setNewConversationDefaultsRecheck(current => current + 1)
        }
      })
  }, [agents, generalPreferences, state, teamLibrary.loading, teamLibrary.error, teamLibrary.teams, newConversationDefaultsRecheck])

  const currentProjectPath = currentProject.kind === 'directory'
    ? currentProject.projectPath
    : null
  const orderedPreferences = useMemo(() => navigationPreferences
    && pendingProjectMoves.reduce(moveNavigationProject, navigationPreferences), [navigationPreferences, pendingProjectMoves])
  const projectOrder = orderedPreferences?.projectOrder ?? null
  const visibleNavigation = useMemo(
    () => navigationWithProjectNames(navigationWithProjectOrder(
      navigationWithProjectDirectories(navigation, navigationPreferences),
      projectOrder
    ), projectNames),
    [navigation, navigationPreferences, projectOrder, projectNames]
  )
  const currentProjectAccess = currentProjectAccessDecision({
    currentProject,
    currentWorkspaceHint,
    navigation: visibleNavigation,
    removedProjectKeys,
    removedProjectAuthorityReady
  })

  useEffect(() => {
    if (currentProjectAccess === 'wait') return undefined
    if (currentProjectAccess === 'fallback') {
      const fallback: CurrentProject = { kind: 'quick_chat' }
      setCurrentProject(fallback)
      setCurrentWorkspaceHint(null)
      persistCurrentProject(fallback)
      return undefined
    }
    if (currentProjectAccess === 'clear_hint') {
      setCurrentWorkspaceHint(null)
      return undefined
    }
    if (currentProjectAccess === 'keep_hint') return undefined
    if (currentProject.kind !== 'directory') return undefined

    let cancelled = false
    void client.request<WorkspaceInspection>('workspaces.inspect', {
      path: currentProject.projectPath
    }).then((workspace) => {
      if (!cancelled) setCurrentWorkspaceHint(workspace)
    }).catch(() => {
      if (cancelled) return
      const fallback: CurrentProject = { kind: 'quick_chat' }
      setCurrentProject(fallback)
      setCurrentWorkspaceHint(null)
      persistCurrentProject(fallback)
    })
    return () => { cancelled = true }
  }, [
    currentProjectAccess,
    currentProject.kind,
    currentProjectPath,
    currentWorkspaceHint?.projectPath
  ])

  const startupPrerequisitesReady = generalPreferences !== null
    && onboardingSnapshot?.status === 'completed'
  useEffect(() => {
    if (
      !startupSnapshot
      || !startupPrerequisitesReady
      || startupResolvedSessionId.current === startupSnapshot.sessionId
    ) return
    let cancelled = false
    let overviewTimer: number | null = null

    const showQuickChat = (): void => {
      cancelPendingThreadActivation()
      setActiveThreadId(null)
      setThreadSnapshot(null)
      setNotificationFocus(null)
      setView('compose')
    }

    const scheduleOverview = (): void => {
      if (overviewTimer !== null) return
      overviewTimer = window.setTimeout(() => {
        void loadOverview(true)
      }, 0)
    }

    const paintRouteShell = async (target: RestorableLocation): Promise<boolean> => {
      await afterNextPaint()
      if (cancelled) return false
      console.info(
        `[startup] trace=${startupTraceId.current} stage=renderer_route_shell_paint `
        + `target=${target.kind} elapsed_ms=${(performance.now() - startupStartedAt.current).toFixed(1)}`
      )
      return true
    }

    const logRouteContentPaint = async (target: RestorableLocation['kind']): Promise<void> => {
      await afterNextPaint()
      if (cancelled) return
      console.info(
        `[startup] trace=${startupTraceId.current} stage=renderer_route_content_paint `
        + `target=${target} elapsed_ms=${(performance.now() - startupStartedAt.current).toFixed(1)}`
      )
    }

    const resolve = async (): Promise<void> => {
      const target = startupTargetFromSnapshot(startupSnapshot)
      if (!await paintRouteShell(target)) return
      if (target.kind === 'quick_chat') {
        showQuickChat()
        scheduleOverview()
        completeStartup(startupSnapshot.sessionId)
        await logRouteContentPaint(target.kind)
        return
      } else if (target.kind === 'memory') {
        scheduleOverview()
        return
      } else if (target.kind === 'teams') {
        setView('teams'); scheduleOverview(); completeStartup(startupSnapshot.sessionId); return
      } else if (target.kind === 'members') {
        const agentsRequest = loadAgents()
        scheduleOverview()
        const nextAgents = await agentsRequest
        if (cancelled) return
        setSelectedMemberId(restoredMemberId(target.agentId, nextAgents))
        completeStartup(startupSnapshot.sessionId)
        await logRouteContentPaint(target.kind)
        return
      } else {
        const projectionRequest = requestThreadProjection(target.threadId, 'enter')
        scheduleOverview()
        let opened: Awaited<ReturnType<typeof requestThreadProjection>>
        try {
          opened = await projectionRequest
        } catch (snapshotError) {
          let exists: boolean
          try {
            exists = await client.request<boolean>('threads.exists', {
              threadId: target.threadId
            })
          } catch {
            throw snapshotError
          }
          if (cancelled) return
          if (!exists) {
            showQuickChat()
            completeStartup(startupSnapshot.sessionId)
            await logRouteContentPaint('quick_chat')
            return
          }
          throw snapshotError
        }
        if (cancelled) return
        const { snapshot, traceId, startedAt, receivedAt } = opened
        if (snapshot.thread.archivedAt) {
          showArchiveLanding(!!snapshot.thread.missionId, notify)
          completeStartup(startupSnapshot.sessionId)
          return
        }
        cancelPendingThreadActivation()
        const selectionGeneration = campSelectionGeneration.current
        campEventSequenceMarker.current = snapshot.throughGlobalSequence
        const snapshotProject = currentProjectForThread(snapshot.thread)
        setCurrentProject(snapshotProject)
        persistCurrentProject(snapshotProject)
        setActiveThreadId(target.threadId)
        setThreadSnapshot(snapshot)
        setNotificationFocus(null)
        setView('camp')
        completeStartup(startupSnapshot.sessionId)
        await afterNextPaint()
        if (cancelled || selectionGeneration !== campSelectionGeneration.current) return
        const paintedAt = performance.now()
        console.info(
          `[startup] trace=${startupTraceId.current} stage=renderer_route_content_paint `
          + `target=camp elapsed_ms=${(performance.now() - startupStartedAt.current).toFixed(1)}`
        )
        console.info(
          `[camp-open] trace=${traceId} stage=renderer_meaningful_paint source=startup `
          + `elapsed_ms=${(paintedAt - startedAt).toFixed(1)} `
          + `paint_ms=${(paintedAt - receivedAt).toFixed(1)}`
        )
        void (async () => {
          await loadNavigation()
          if (cancelled || selectionGeneration !== campSelectionGeneration.current) return
          console.info(
            `[camp-open] trace=${traceId} stage=renderer_background_complete source=startup `
            + `elapsed_ms=${(performance.now() - startedAt).toFixed(1)}`
          )
        })().catch(error => {
          if (!cancelled && selectionGeneration === campSelectionGeneration.current) reportOperationFailure('navigation.read', error)
        })
        return
      }
    }

    setStartupStatus('loading')
    const resolution = resolve()
    void resolution.catch((nextError) => {
      if (cancelled) return
      setStartupStatus('waiting')
      setStartupError(errorMessage(nextError))
    })
    return () => {
      cancelled = true
      if (overviewTimer !== null) window.clearTimeout(overviewTimer)
    }
  }, [
    cancelPendingThreadActivation,
    completeStartup,
    loadAgents,
    loadNavigation,
    loadOverview,
    requestThreadProjection,
    userAnchorNavigationFor,
    setThreadSnapshot,
    showArchiveLanding,
    notify,
    startupPrerequisitesReady,
    startupSnapshot
  ])

  useEffect(() => {
    if (startupStatus !== 'resolved' || desktopNavigation.getSnapshot().entries.length) return
    if (environment.navigationHistory?.initial) {
      if (!restoredWebNavigation.current) {
        restoredWebNavigation.current = true
        void desktopNavigation.restore({ preserveUnreadReminder: true }).then(restored => { if (!restored) desktopNavigation.reset({ kind: 'quick_chat' }) })
      }
      return
    }
    const target: NavigationTarget = view === 'camp' && activeThreadId
      ? { kind: 'camp', threadId: activeThreadId }
      : view === 'members' ? { kind: 'members', agentId: restoredMemberId(selectedMemberId, agents), tab: memberTab }
      : view === 'teams' ? { kind: 'teams' }
      : view === 'missions' ? { kind: 'missions' }
      : view === 'memory' ? memoryTarget
      : { kind: 'quick_chat' }
    desktopNavigation.reset(target)
  }, [startupStatus, desktopNavigation, view, activeThreadId, selectedMemberId, agents, memberTab, memoryTarget])

  useEffect(() => {
    if (startupStatus !== 'resolved' || (view !== 'compose' && view !== 'teams')) return
    void commitRestorableLocation(view === 'teams' ? { kind: 'teams' } : { kind: 'quick_chat' })
  }, [commitRestorableLocation, startupStatus, view])

  useEffect(() => {
    if (
      startupStatus !== 'resolved'
      || view !== 'camp'
      || !activeThreadId
      || campSnapshot?.thread.id !== activeThreadId
    ) return
    const activationState = campSnapshot.thread.activationState
    const pendingDraftIsNavigable = activationState === 'pending' && navigation !== null
      && allNavigationThreads(navigation).some((thread) =>
        thread.id === activeThreadId && thread.activationState === 'pending'
      )
    if (activationState === 'pending' && !pendingDraftIsNavigable) return
    void commitRestorableLocation({ kind: 'camp', threadId: activeThreadId })
  }, [activeThreadId, campSnapshot, commitRestorableLocation, navigation, startupStatus, view])

  useEffect(() => {
    if (startupStatus !== 'resolved' || view !== 'members') return
    void commitRestorableLocation({
      kind: 'members',
      agentId: restoredMemberId(selectedMemberId, agents),
      tab: memberTab
    })
  }, [agents, commitRestorableLocation, memberTab, selectedMemberId, startupStatus, view])

  useEffect(() => {
    if (
      !startupSnapshot
      || startupRouteTarget?.kind !== 'memory'
      || view === 'memory'
    ) return
    completeStartup(startupSnapshot.sessionId)
  }, [completeStartup, startupRouteTarget, startupSnapshot, view])

  const appearanceReadGeneration = useRef(0)
  const acceptAppearance = useCallback((snapshot: AppearanceSnapshot): void => {
    appearanceReadGeneration.current += 1
    applyAppearanceSnapshot(document.documentElement, snapshot)
    setAppearance(snapshot)
    setAppearanceReadIssue(null)
  }, [])
  const readAppearance = useCallback(async (): Promise<void> => {
    const request = ++appearanceReadGeneration.current
    try {
      const snapshot = await retryRead(() => uiPreferences.appearance.get())
      if (request === appearanceReadGeneration.current) acceptAppearance(snapshot)
    } catch (error) {
      if (request === appearanceReadGeneration.current) setAppearanceReadIssue(reportOperationFailure('appearance.read', error).message)
    }
  }, [acceptAppearance, uiPreferences])
  useEffect(() => {
    const unsubscribe = uiPreferences.appearance.onChanged(acceptAppearance)
    void readAppearance()
    return () => {
      appearanceReadGeneration.current += 1
      unsubscribe?.()
    }
  }, [acceptAppearance, readAppearance, uiPreferences])

  useEffect(() => {
    if (startupStatus !== 'resolved') return
    if (!shouldLoadRuntimeHealth(
      view,
      settingsSection,
      health !== null,
      healthAttempted
    )) return
    void loadRuntime().catch(() => undefined)
  }, [health, healthAttempted, loadRuntime, settingsSection, startupStatus, view])

  useEffect(() => {
    if (startupStatus !== 'resolved' || shuttingDown) return undefined
    let disposed = false
    let pollTimer: number | null = null

    const appIsVisible = (): boolean => document.visibilityState !== 'hidden'
    const clearPoll = (): void => {
      if (pollTimer !== null) window.clearTimeout(pollTimer)
      pollTimer = null
    }
    const schedulePoll = (): void => {
      clearPoll()
      if (disposed || !appIsVisible()) return
      pollTimer = window.setTimeout(() => {
        pollTimer = null
        void loadNavigation('poll')
          .catch(() => undefined)
          .finally(schedulePoll)
      }, NAVIGATION_REFRESH_POLL_MS)
    }
    const handleVisibilityChange = (): void => {
      const visible = appIsVisible()
      navigationRefreshCoordinator.setVisible(visible)
      if (visible) schedulePoll()
      else clearPoll()
    }
    const handleFocus = (): void => {
      if (!appIsVisible()) return
      void loadNavigation('foreground').catch(() => undefined)
    }

    navigationRefreshCoordinator.setVisible(appIsVisible())
    schedulePoll()
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      disposed = true
      clearPoll()
      navigationRefreshCoordinator.setVisible(false)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [loadNavigation, navigationRefreshCoordinator, shuttingDown, startupStatus])

  useEffect(() => {
    if (
      view !== 'camp'
      || !activeThreadId
      || campSnapshot?.thread.id !== activeThreadId
    ) return undefined
    const threadId = activeThreadId
    const throughGlobalSequence = campSnapshot.throughGlobalSequence
    if (campSnapshotState.entryPreview) return undefined
    const mission = campSnapshot.thread.missionId && activeMission?.threadId === threadId ? activeMission : null
    const row = (navigation ? allNavigationThreads(navigation).find(thread => thread.id === threadId) : null)
      ?? (openedNavigationRow?.id === threadId ? openedNavigationRow : null)
      ?? pinnedThreadItems.find(thread => thread.id === threadId)
    if (campSnapshot.thread.missionId ? !mission?.hasUnread
      : !row || row.latestCompletionGlobalSequence <= (row.lastSeenGlobalSequence ?? 0)
        || row.latestCompletionGlobalSequence > throughGlobalSequence) return undefined
    // Missions use published Agent replies as their existing unread boundary.
    const observedCompletion = mission ? throughGlobalSequence : row!.latestCompletionGlobalSequence
    let cancelled = false
    let retryTimer: number | null = null
    const acknowledgeVisibleThread = async (): Promise<void> => {
      if (!campViewIsVisibleForReadAcknowledgement(
        view,
        activeThreadId,
        campSnapshot.thread.id,
        document.visibilityState,
        document.hasFocus()
      )) return
      if ((campViewedAcknowledgements.current.get(threadId) ?? 0) >= observedCompletion) return
      campViewedAcknowledgements.current.set(threadId, observedCompletion)
      try {
        const acknowledgement = await client.request<ThreadViewedAcknowledgement>('navigation.campViewed', {
          threadId,
          throughGlobalSequence
        })
        if (mission) {
          void missionList.refresh()
        } else navigationRefreshCoordinator.acceptRows(acknowledgement.navigation)
      } catch {
        if (campViewedAcknowledgements.current.get(threadId) === observedCompletion) {
          campViewedAcknowledgements.current.delete(threadId)
        }
        if (!cancelled) {
          retryTimer = window.setTimeout(() => {
            retryTimer = null
            void acknowledgeVisibleThread()
          }, 2_500)
        }
      }
    }
    void acknowledgeVisibleThread()
    window.addEventListener('focus', acknowledgeVisibleThread)
    document.addEventListener('visibilitychange', acknowledgeVisibleThread)
    return () => {
      cancelled = true
      if (retryTimer !== null) window.clearTimeout(retryTimer)
      window.removeEventListener('focus', acknowledgeVisibleThread)
      document.removeEventListener('visibilitychange', acknowledgeVisibleThread)
    }
  }, [
    activeThreadId,
    campSnapshot?.thread.id,
    campSnapshot?.throughGlobalSequence,
    navigation,
    pinnedThreadItems,
    openedNavigationRow,
    activeMission,
    missionList.refresh,
    campSnapshotState.entryPreview,
    navigationRefreshCoordinator,
    client,
    view
  ])

  useEffect(() => {
    const unsubscribe = client.onEvent?.((event: CoreEvent) => {
      const params = asRecord(event.params)
      if (shuttingDownRef.current) return
      if (event.method === 'memory.changed' && memoryCapabilityRef.current.active) {
        setMemoryRefreshKey(current => current + 1)
      }
      if (event.method === 'preferences.new_conversation_changed') {
        void readGeneralPreferences()
      }
      if (event.method === 'members.invalidated' && (viewRef.current === 'members' || viewRef.current === 'camp')) {
        void loadAgents().catch(() => undefined)
      }
      if (event.method === 'runtime.state') {
        const runtimeStatus = stringField(params, 'status')
        if (runtimeStatus === 'shutting_down') {
          shuttingDownRef.current = true
          setShuttingDown(true)
          setError(null)
          setLocationSaveError(null)
          setToast(null)
        } else if (runtimeStatus === 'crashed') {
          setState('error')
          showOperationError('core.recover', {
            kind: 'infrastructure_failure', code: 'core_process_exited', message: stringField(params, 'message')
          })
        } else if (runtimeStatus === 'starting' || runtimeStatus === 'restarting') {
          campViewedAcknowledgements.current.clear()
          setOpenedNavigationRow(null)
          setState('loading')
          setHealth(null)
          setHealthAttempted(false)
        } else if (runtimeStatus === 'ready') {
          void loadOverview().catch(() => undefined)
          if (viewRef.current !== 'memory' && memoryCapabilityRef.current.active) setMemoryRefreshKey(current => current + 1)
        }
      }
      if (
        event.method === 'runtime.discovery.updated'
        || event.method === 'runtime.discovery.completed'
        || event.method === 'runtime.availability.updated'
      ) {
        void loadRuntime().catch(() => undefined)
      }
      if (event.method === 'navigation.invalidated') {
        const reason = stringField(params, 'reason')
        const deletingThreadId = stringField(params, 'threadId')
        if (reason === 'camps.deletion_attention') {
          void loadThreadDeletionIssues().catch(() => undefined)
        }
        if (
          deletingThreadId
          && (
            reason === 'camps.delete_accepted'
            || reason === 'thread.deleted'
            || reason === 'camps.deletion_attention'
          )
        ) {
          hideAcceptedThreadDeletion(deletingThreadId)
        }
      }
      if (shouldRefreshNavigationForCoreEvent(event, shuttingDownRef.current)) {
        void navigationRefreshCoordinator.invalidate({
          scope: params.scope === 'camp' || params.scope === 'group' ? params.scope : 'all',
          threadId: stringField(params, 'threadId') ?? undefined,
          groupKeys: Array.isArray(params.groupKeys) ? params.groupKeys.filter((key): key is string => typeof key === 'string') : undefined
        }).catch(() => undefined)
      }
      const threadId = activeThreadIdRef.current
      if (isArchiveChangeEvent(event) && typeof params.threadId === 'string') campSnapshotCache.current.delete(params.threadId)
      if (isArchiveChangeEvent(event) && params.threadId === threadId && typeof params.throughGlobalSequence === 'number') {
        campEventSequenceMarker.current = Math.max(campEventSequenceMarker.current, params.throughGlobalSequence)
      }
      void refreshActiveThreadForCoreEvent(event, threadId, { refresh: refreshThreadInBackground }, shuttingDownRef.current)
    })
    return () => { unsubscribe?.() }
  }, [
    refreshThreadInBackground,
    readGeneralPreferences,
    loadRuntime,
    loadAgents,
    loadOverview,
    loadThreadDeletionIssues,
    navigationRefreshCoordinator,
    showOperationError
  ])

  useEffect(() => {
    if (!campSnapshot) {
      setCancellingRunIds(new Set())
      setConfirmingRunIds(new Set())
      return
    }
    setCancellingRunIds((current) => reconcileRunCancellationIds(current, campSnapshot))
    setConfirmingRunIds((current) => reconcileRunCancellationIds(current, campSnapshot))
  }, [campSnapshot])

  const displayNavigation = navigationWithProjectNames(navigationIncludingCurrentWorkspace(
    navigationWithMemberCreationDrafts(visibleNavigation, memberCreationDrafts),
    currentProject,
    currentWorkspaceHint
  ), projectNames)
  const activeThread = navigation
    ? allNavigationThreads(navigation).find((thread) => thread.id === activeThreadId) ?? null
    : null
  const selectedCurrentProject = currentProjectGroup(displayNavigation, currentProject)
  const shellOnlyCurrentProjectPath = selectedCurrentProject
    && !navigationPreferences?.registeredProjects.includes(selectedCurrentProject.projectPath)
    && !currentProjectGroup(navigation, currentProject)
    ? selectedCurrentProject.projectPath
    : null
  const currentProjectKey = selectedCurrentProject?.projectKey ?? 'quick-chat'
  const currentProjectLabel = selectedCurrentProject?.name ?? uiAttribute('快速对话')
  const activeProjectPath = activeThread?.projectBindingKind === 'directory'
    ? activeThread.projectPath
    : campSnapshot?.thread.id === activeThreadId
      && campSnapshot.thread.projectBindingKind === 'directory'
      ? campSnapshot.thread.projectPath
      : null
  const activeThreadProject = activeProjectPath && displayNavigation
    ? displayNavigation.projects.find((project) => project.projectPath === activeProjectPath) ?? null
    : null
  const firstRunThreadId = onboardingSnapshot?.status === 'completed'
    && onboardingSnapshot.origin === 'onboarding'
    ? onboardingSnapshot.quickChatThreadId
    : null
  const activeThreadTitle = activeThread
    ? formatThreadTitle(activeThread, firstRunThreadId)
    : campSnapshot?.thread.id === activeThreadId ? formatThreadTitle(campSnapshot.thread, firstRunThreadId) : ''
  const activeThreadContextLabel = activeThreadProject?.name
    ?? (activeProjectPath === currentProjectPath ? currentProjectLabel : uiAttribute('快速对话'))
  const activeCancellingTurnIds = useMemo(
    () => campSnapshot?.thread.id === activeThreadId
      ? effectiveCancellingTurnIds(cancellingTurnIds, campSnapshot)
      : new Set<string>(),
    [activeThreadId, campSnapshot, cancellingTurnIds]
  )
  const activeThreadStopping = activeCancellingTurnIds.size > 0
  const activeOptimisticMessages = useMemo(
    () => optimisticThreadMessages.filter((entry) => entry.threadId === activeThreadId).map((entry) => entry.message),
    [activeThreadId, optimisticThreadMessages]
  )
  const activeCancellingRunIds = useMemo(
    () => campSnapshot?.thread.id === activeThreadId
      ? effectiveCancellingRunIds(cancellingRunIds, campSnapshot)
      : new Set<string>(),
    [activeThreadId, campSnapshot, cancellingRunIds]
  )
  const activeConfirmingRunIds = useMemo(
    () => campSnapshot?.thread.id === activeThreadId
      ? reconcileRunCancellationIds(confirmingRunIds, campSnapshot)
      : new Set<string>(),
    [activeThreadId, campSnapshot, confirmingRunIds]
  )

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    if (client.onInvalidated || shuttingDown || !activeThreadId || campSnapshot?.thread.id !== activeThreadId) return undefined
    const threadId = activeThreadId
    let memoryNoticeFloor = campEventSequenceMarker.current
    let resumeMemoryNotices = false

    const refreshSnapshot = async (): Promise<void> => {
      const { snapshot } = await requestThreadProjection(threadId, 'open')
      if (cancelled) return
      if (snapshot.throughGlobalSequence < campEventSequenceMarker.current) return
      campEventSequenceMarker.current = snapshot.throughGlobalSequence
      setThreadSnapshot(snapshot)
      setConfirmingRunIds((current) => reconcileRunCancellationIds(current, snapshot))
      threadRefreshRecovery.succeeded(threadId, 'snapshot')
    }

    const readEvents = async (): Promise<void> => {
      const memoryObservation = memoryCapabilityRef.current.beginObservation()
      const batch = await client.request<EventBatch>('events.subscribe', {
        threadId,
        afterGlobalSequence: campEventSequenceMarker.current,
        limit: 250
      })
      if (cancelled) return
      const capability = batch.memoryCapability !== undefined
        ? memoryCapabilityRef.current.acceptSnapshot(batch.memoryCapability, memoryObservation)
        : memoryCapabilityRef.current
      const memoryResumed = resumeMemoryNotices || batch.resetRequired
      if (memoryResumed || !capability?.enabled || !memoryCapabilityRef.current.active) {
        memoryNoticeFloor = Math.max(memoryNoticeFloor, batch.throughGlobalSequence)
        resumeMemoryNotices = false
      }
      const memoryEvents = memoryEventsForNotice(batch.events, capability, memoryCapabilityRef.current.active, memoryNoticeFloor)
      const noticeSequence = capability?.observedThroughChangeSequence
      const noticeBoundary = capability?.headsUpAfterGlobalSequence ?? memoryNoticeFloor
      const reviewSequence = memoryEvents.reduce((sequence, event) => event.eventType === 'memory.hearth_review_created' ? Math.max(sequence, event.globalSequence) : sequence, 0)
      const autoAppliedEvents = memoryEvents.filter((event) =>
        event.eventType === 'memory.agent_created' || event.eventType === 'memory.agent_revised'
      )
      if (reviewSequence > 0 || autoAppliedEvents.length > 0) {
        if (reviewSequence > 0) setMemoryReviewNotice(current => Math.max(current ?? 0, reviewSequence))
        if (autoAppliedEvents.length > 0) {
          setMemoryAutoNotice((current) => collectMemoryChanges(memoryChangesAfter(current, noticeBoundary), autoAppliedEvents))
          const lastChange = collectMemoryChanges([], autoAppliedEvents).at(-1)
          if (lastChange && lastChange.scope === null) {
            void client.request<MemoryRecord>('memory.get', { memoryId: lastChange.memoryId })
              .then((memory) => {
                if (!cancelled && memoryCapabilityRef.current.active && memoryCapabilityRef.current.observedThroughChangeSequence === noticeSequence) setMemoryAutoNotice((current) => resolveMemoryChangeScope(current, lastChange.memoryId, lastChange.sequence, memory.scope))
              })
              .catch(() => undefined)
          }
        }
      }
      // Live content uses global memory.changed; this scoped poll only repairs gaps.
      if (capability?.enabled && memoryCapabilityRef.current.active && memoryResumed) {
        setMemoryRefreshKey(current => current + 1)
      }
      if (batch.schemaVersion !== 9 || batch.resetRequired || batch.events.length > 0) {
        await refreshSnapshot()
      } else {
        campEventSequenceMarker.current = batch.nextGlobalSequence
      }
    }

    const poll = async (): Promise<void> => {
      try {
        await readEvents()
        if (!cancelled) threadRefreshRecovery.succeeded(threadId, 'events')
      } catch (nextError) {
        resumeMemoryNotices = true
        if (!cancelled) {
          await threadRefreshRecovery.recover(threadId, 'events', readEvents, nextError)
        }
      } finally {
        if (!cancelled) timer = setTimeout(() => void poll(), 1_400)
      }
    }

    void poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [activeThreadId, campSnapshot?.thread.id, client, requestThreadProjection, setThreadSnapshot, shuttingDown, threadRefreshRecovery])

  useEffect(() => client.onInvalidated?.((change) => {
    if (memoryCapabilityRef.current.active && viewRef.current !== 'memory'
      && (!change || change.resync || change.memoryContentChanged)) setMemoryRefreshKey(current => current + 1)
    if (!change || change.resync || change.referencesChanged) campSnapshotCache.current.clear()
    campViewedAcknowledgements.current.clear()
    void readGeneralPreferences()
    void loadNavigation('invalidation').catch(() => undefined)
    void loadThreadDeletionIssues().catch(() => undefined)
    const threadId = activeThreadIdRef.current
    if (threadId) void refreshThreadInBackground(threadId)
    void loadAgents().catch(() => undefined)
  }), [client, readGeneralPreferences, loadNavigation, loadThreadDeletionIssues, loadAgents, refreshThreadInBackground])

  const chooseCurrentProject = (
    nextProject: CurrentProject,
    workspaceHint: WorkspaceSelection | null = null
  ): void => {
    setCurrentProject(nextProject)
    setCurrentWorkspaceHint(nextProject.kind === 'directory' ? workspaceHint : null)
    persistCurrentProject(nextProject)
  }

  const openNewConversation = (
    workspace: WorkspaceSelection | null,
    attentionMessage: string | null = null,
    preferences = generalPreferences,
    team: Team | null = null
  ): void => {
    setNewConversationInitialWorkspace(workspace)
    setNewConversationInitialTeamId(team?.id ?? preferences?.newConversationTeamId ?? null)
    setNewConversationInitialTeam(team)
    setNewConversationInitialSelection(preferences?.newConversationDefaults ?? null)
    setNewConversationAttention(attentionMessage)
    setNewConversationOpen(true)
  }

  const requestNewConversation = async (
    workspace: WorkspaceSelection | null
  ): Promise<'created' | 'dialog' | 'ignored'> => {
    if (busy === 'create-camp' || newConversationRequestBusy.current) return 'ignored'
    newConversationRequestBusy.current = true
    const intent = desktopNavigation.beginIntent()
    try {
      const preferences = await uiPreferences.generalPreferences.get()
      if (!intent.isCurrent()) return 'ignored'
      setGeneralPreferences(preferences)
      // Only a Team-backed one-click creation needs the latest library first.
      const requiresTeam = preferences.oneClickNewConversationEnabled
        && !preferences.newConversationDefaultsRequireConfirmation && Boolean(preferences.newConversationTeamId)
      const teams = requiresTeam ? await teamLibrary.refresh().catch(() => null) : []
      if (!intent.isCurrent()) return 'ignored'
      const defaults = teams && resolveAvailableNewConversationDefaults(preferences, agents, teams)
      let attentionMessage: string | null = null
      if (preferences.oneClickNewConversationEnabled && defaults) {
        try {
          await createThread({
            name: null,
            workspace: workspace ? { projectPath: workspace.projectPath } : null,
            ...(defaults.team ? { team: defaults.team } : {}),
            memberAgentIds: defaults.defaults.memberAgentIds,
            defaultLeadAgentId: defaults.defaults.defaultLeadAgentId,
            collaborationMode: 'peer',
            activationState: campActivationStateForCreation('one_click')
          }, false, intent)
          return 'created'
        } catch (nextError) {
          if (!intent.isCurrent()) return 'ignored'
          attentionMessage = uiAttribute("一键创建未完成：{0} 请重新确认项目、队员与默认负责人。", String(errorMessage(nextError)))
        }
      }
      if (!requiresTeam) void teamLibrary.refresh().catch(() => undefined)
      openNewConversation(workspace, attentionMessage, preferences, teams?.find(team => team.id === preferences.newConversationTeamId) ?? null)
      return 'dialog'
    } catch (nextError) {
      if (!intent.isCurrent()) return 'ignored'
      showOperationError('preferences.read', nextError)
      return 'ignored'
    } finally { newConversationRequestBusy.current = false }
  }

  const chooseWorkspaceDirectory = async (): Promise<WorkspaceSelection | null> => {
    setBusy('open-project')
    try {
      return await environment.selectWorkspaceDirectory()
    } finally {
      setBusy(null)
    }
  }

  const openProject = async (): Promise<void> => {
    setError(null)
    try {
      await selectProjectDirectory(
        chooseWorkspaceDirectory,
        restoreNavigationProject,
        chooseCurrentProject
      )
    } catch (nextError) {
      notifyError(errorMessage(nextError))
    }
  }

  const requestMemberTransition = useCallback((
    action: () => void | Promise<void>
  ): Promise<boolean> => {
    if (viewRef.current === 'teams') {
      return (teamLeaveGuard.current?.() ?? Promise.resolve(true)).then(async allowed => { if (allowed) await action(); return allowed })
    }
    if (viewRef.current !== 'members' && !commonEnvironmentReturnRef.current) {
      return Promise.resolve().then(action).then(() => true)
    }
    return membersViewRef.current?.requestTransition(action) ?? Promise.resolve(false)
  }, [])

  const chooseView = (nextView: View): void => {
    if (nextView === viewRef.current) {
      const current = desktopNavigation.getSnapshot()
      const target = current.entries[current.index]
      if (target) void desktopNavigation.push(target)
      return
    }
    const target: NavigationTarget = nextView === 'members'
      ? { kind: 'members', agentId: selectedMemberId, tab: memberTab }
      : nextView === 'teams' ? { kind: 'teams' }
      : nextView === 'memory' ? { kind: 'memory', memoryId: null }
      : nextView === 'automations' ? { kind: 'automations' }
      : nextView === 'missions' ? { kind: 'missions' }
      : nextView === 'camp' && activeThreadId ? { kind: 'camp', threadId: activeThreadId }
      : nextView === 'settings' ? { kind: 'settings', section: settingsSection }
      : { kind: 'quick_chat' }
    void (mobile ? desktopNavigation.replace(target) : desktopNavigation.push(target))
  }

  const configureMemberRuntime = (agentId: string): void => {
    const focusRuntime = (): void => {
      setRuntimeRecovery(null)
      setMemberRuntimeFocusRequest((request) => request + 1)
    }
    if (viewRef.current === 'members' && selectedMemberId === agentId && memberTab === 'runtime') focusRuntime()
    else void desktopNavigation.push({ kind: 'members', agentId, tab: 'runtime' }, { beforeCommit: focusRuntime })
  }

  const openMemoryReviews = (): void => {
    const showReviews = (): void => {
      setMemoryReviewNotice(null)
      setMemoryReviewDrawerSignal((current) => current + 1)
    }
    if (viewRef.current === 'memory') showReviews()
    else void desktopNavigation.push({ kind: 'memory', memoryId: null }, { beforeCommit: showReviews })
  }

  const openAutomaticMemory = (): void => {
    const clearNotice = (): void => setMemoryAutoNotice([])
    if (viewRef.current === 'memory' && memoryTarget.memoryId === (visibleMemoryAutoNotice.at(-1)?.memoryId ?? null)) clearNotice()
    else void desktopNavigation.push({ kind: 'memory', memoryId: (visibleMemoryAutoNotice.at(-1)?.memoryId ?? null) }, { beforeCommit: clearNotice })
  }

  const closeSettings = (): void => { void desktopNavigation.push(lastMainTarget.current) }

  const chooseSettingsSection = (section: SettingsSection): void => {
    if (viewRef.current === 'settings' || viewRef.current === 'memory') void desktopNavigation.push(section === 'memory' ? { kind: 'memory', memoryId: null } : { kind: 'settings', section })
    void uiPreferences.generalPreferences.setLastSettingsSection(section)
      .then(setGeneralPreferences)
      .catch(error => showOperationError('preferences.save', error))
  }

  const navigateToSettings = async (section: SettingsSection): Promise<boolean> => {
    await desktopNavigation.push({ kind: 'settings', section })
    const current = desktopNavigation.getSnapshot()
    const target = current.entries[current.index]
    return target?.kind === 'settings' && target.section === section
  }

  applyNavigationRef.current = async (target, transaction, context) => {
    if (shuttingDownRef.current) return
    const readRevision = target.kind === 'camp' ? threadReadRevisions.current.get(target.threadId) : undefined
    // Invalidate older Thread reads immediately, including reads waiting behind a leave guard.
    const selectionGeneration = ++campSelectionGeneration.current
    clearThreadOpenFeedback()
    const apply = async (): Promise<void> => {
      if (!transaction.isCurrent() || context?.onlyIf?.() === false) return
      if (target.kind === 'camp') {
        if (viewRef.current === 'camp' && activeThreadIdRef.current === target.threadId && !campSnapshotEntryPreviewRef.current) {
          if (transaction.commit()) {
            setNavigationFind(context?.campOptions?.navigationFind ?? null)
            if (!context?.preserveUnreadReminder) await clearThreadUnreadReminder(target.threadId, readRevision)
          }
          return
        }
        const opened = await activateThreadWithoutLeaveGuard(target.threadId, context?.campOptions ?? {}, selectionGeneration, transaction)
        if (opened && transaction.isCurrent() && !context?.preserveUnreadReminder) await clearThreadUnreadReminder(target.threadId, readRevision)
        return
      }
      const previous = desktopNavigation.getSnapshot()
      if ((target.kind === 'settings' || target.kind === 'memory') && viewRef.current !== 'settings' && viewRef.current !== 'memory') {
        lastMainTarget.current = previous.entries[previous.index] ?? { kind: 'quick_chat' }
      }
      if (!transaction.commit()) return
      setNavigationFind(null)
      if (target.kind !== 'members' && target.kind !== 'settings') setCommonEnvironmentReturn(null)
      context?.beforeCommit?.()
      setNotificationFocus(null)
      switch (target.kind) {
        case 'settings':
          setSettingsSection(target.section)
          setArchiveSelection(target.archive)
          setMobileSettingsList(target.overview === true)
          setView(target.section === 'memory' && !target.overview ? 'memory' : 'settings')
          break
        case 'members':
          if (viewRef.current !== 'members') setMemberRosterEntryReady(false)
          membersViewRef.current?.showSelectedMember()
          setSelectedMemberId(target.agentId); setMemberTab(target.tab); setView('members'); break
        case 'memory': setMemoryTarget(target); setView('memory'); break
        case 'teams': setView('teams'); break
        case 'automations': setView('automations'); break
        case 'missions': setView('missions'); break
        case 'quick_chat': setView('compose'); break
      }
    }
    const leave = async (): Promise<void> => {
      if (!transaction.isCurrent()) return
      const sameSurface = target.kind === viewRef.current
        && (target.kind !== 'camp' || target.threadId === activeThreadIdRef.current)
      if (context?.prepared || sameSurface) await apply()
      else await leaveActiveSurface(() => Promise.race([apply(), transaction.superseded]))
    }
    try {
      if (((viewRef.current === 'members' || (commonEnvironmentReturnRef.current && target.kind !== 'settings')) && target.kind !== 'members' || viewRef.current === 'teams' && target.kind !== 'teams') && !context?.prepared && !context?.memberPrepared) await requestMemberTransition(leave)
      else await leave()
    } catch (nextError) {
      if (transaction.isCurrent()) showOperationError(target.kind === 'camp' ? 'thread.open' : 'navigation.action', nextError)
    }
  }

  const openSettings = (): void => {
    const rememberedSection = generalPreferences?.lastSettingsSection ?? 'general'
    if (mobile) void desktopNavigation.replace({ kind: 'settings', section: rememberedSection, overview: true })
    else void navigateToSettings(rememberedSection)
  }

  const returnToMobileSettings = (): void => {
    const { entries, index } = desktopNavigation.getSnapshot()
    const previous = entries[index - 1]
    if (previous?.kind === 'settings' && previous.overview) void desktopNavigation.back()
    else void desktopNavigation.replace({ kind: 'settings', section: settingsSection, overview: true })
  }

  const returnToMissions = (): void => {
    const { entries, index } = desktopNavigation.getSnapshot()
    if (mobile && entries[index - 1]?.kind === 'missions') void desktopNavigation.back()
    else chooseView('missions')
  }

  const openUpdateSettings = async (
    prompt: AppUpdatePromptValue | null = appUpdates.snapshot?.pendingPrompt ?? null
  ): Promise<boolean> => {
    const expectedVersion = prompt?.version ?? appUpdates.snapshot?.availableRelease?.version
    if (!expectedVersion) return false
    try {
      const transitioned = await navigateToSettings('about')
      if (!transitioned) return false
      await afterNextPaint()
      let releaseSection = document.querySelector<HTMLElement>('.about-release-section')
      if (releaseSection?.dataset.appUpdateReleaseVersion !== expectedVersion) {
        document.querySelector<HTMLButtonElement>('[data-app-update-release-tab="available"]')?.click()
        await afterNextPaint()
        releaseSection = document.querySelector<HTMLElement>('.about-release-section')
      }
      if (releaseSection?.dataset.appUpdateReleaseVersion !== expectedVersion) return false
      const heading = document.querySelector<HTMLElement>('#about-release-notes-heading')
      heading?.focus({ preventScroll: true })
      heading?.scrollIntoView({ block: 'nearest' })
      return Boolean(heading)
    } catch (nextError) {
      showOperationError('updates.open', nextError, () => void openUpdateSettings(prompt))
      return false
    }
  }

  const commitMemoryLocation = useCallback((): void => {
    if (
      startupSnapshot
      && startupRouteTarget?.kind === 'memory'
      && startupResolvedSessionId.current !== startupSnapshot.sessionId
    ) {
      completeStartup(startupSnapshot.sessionId)
      void afterNextPaint().then(() => {
        console.info(
          `[startup] trace=${startupTraceId.current} stage=renderer_route_content_paint `
          + `target=memory elapsed_ms=${(performance.now() - startupStartedAt.current).toFixed(1)}`
        )
      })
    }
    if (!startupResolvedSessionId.current || viewRef.current !== 'memory') return
    void commitRestorableLocation({ kind: 'memory' })
  }, [completeStartup, commitRestorableLocation, startupRouteTarget, startupSnapshot])

  const retryStartup = (): void => {
    setStartupStatus('loading')
    setStartupError(null)
    setOnboardingError(null)
    void loadStartupSnapshot()
    void loadOnboarding()
  }

  const beginNewConversation = (): void => {
    void requestMemberTransition(async () => {
      cancelPendingThreadActivation()
      await requestNewConversation(currentProjectWorkspace(displayNavigation, currentProject))
    })
  }

  const setThreadUnread = async (thread: NavigationThreadItem, unread: boolean): Promise<void> => {
    const acknowledgement = unread ? null : interruptionAttention.captureRead(thread.id)
    await saveThreadReadState(thread.id, navigationThreadReadState(thread, unread, threadReadStatesRef.current[thread.id]))
    if (acknowledgement) await interruptionAttention.acknowledge(acknowledgement)
  }

  const chooseThread = (thread: NavigationThreadTarget): void => {
    void activateThread(thread.id, { reconcileDefaultLead: thread.activationState !== 'pending', title: formatThreadTitle(thread) })
      .catch(error => notifyError(reportOperationFailure('thread.open', error, { subject: formatThreadTitle(thread) }).message))
  }

  const openSearchResult = (row: NavigationSearchRow): void => {
    setMobileConversationDrawerOpen(false)
    const { thread, kind } = row.target
    if (kind === 'mission' && !missionList.missions.some(mission => mission.threadId === thread.id)) {
      void missionList.refresh()
    }
    const navigationFind = row.hit
      ? { threadId: thread.id, query: row.query, anchorMessageId: row.hit.message.id }
      : undefined
    void activateThread(thread.id, {
      reconcileDefaultLead: kind === 'thread' && thread.activationState !== 'pending',
      missionPresentation: kind === 'mission' ? 'drawer' : undefined,
      navigationFind, title: formatThreadTitle(thread)
    }).then(opened => {
      if (opened && kind === 'mission' && activeThreadIdRef.current === thread.id && viewRef.current === 'camp') {
        setMissionOpenRequest(value => value + 1)
      }
    }).catch(nextError => notifyError(errorMessage(nextError)))
  }

  const navigateFromNotification = useCallback(async (
    _episode: NotificationEpisodeView,
    action: NotificationActionView
  ): Promise<NotificationNavigationResult> => {
    let result: NotificationNavigationResult = {
      status: 'failed',
      message:uiAttribute("当前页面尚未完成切换，请稍后重试。")
    }
    let transitionActionCompleted = false
    const transitioned = await requestMemberTransition(async () => {
      try {
        if (!action.available) {
          result = {
            status: 'failed',
            message:uiAttribute("这个来源当前不可用。你可以显式选择卡片上的其他动作。")
          }
          return
        }
        if (action.kind === 'open_native_interaction') {
          const sources = await client.request<import('@contracts').NativeInteractionNotification[]>('nativeInteractions.notifications')
          const source = sources.find(source => source.id === action.interactionId
            && source.thread.id === action.threadId && source.agentRunId === action.agentRunId
            && (source.singleChat?.conversationId ?? null) === (action.singleChat?.conversationId ?? null))
          if (!source) throw new Error(uiAttribute('请求已处理'))
        }
        if (action.kind === 'open_single_chat') {
          const source = action.singleChat
          if (!source) throw new Error(uiAttribute('单聊通知缺少原始对话标识。'))
          const snapshot = await client.request<import('@contracts').SingleChatSnapshot | null>('singleChat.get', {
            conversationId: source.conversationId
          })
          if (!snapshot || snapshot.conversation.id !== source.conversationId || snapshot.conversation.status !== 'active'
            || snapshot.conversation.threadId !== action.threadId
            || snapshot.conversation.agentId !== source.agentId
            || !snapshot.agentRuns.some((run) => run.id === source.agentRunId)) {
            throw new Error(uiAttribute('原单聊已结束或来源不可用。'))
          }
          if (action.approvalId && !snapshot.approvals.some((approval) => approval.id === action.approvalId && approval.status === 'pending')) {
            throw new Error(uiAttribute('这项审批已经处理。'))
          }
        }
        let anchoredTasks: readonly import('@contracts').TaskView[] = []
        if (action.kind === 'open_mission' || (action.kind === 'open_task' && taskCapabilityRef.current)) {
          const source = action.subject
          if (!source || source.kind !== (action.kind === 'open_mission' ? 'mission' : 'task')) {
            throw new Error(uiAttribute('通知缺少原始事项标识。'))
          }
          const snapshot = await client.request<ThreadSnapshot>('threads.snapshot', { threadId: action.threadId })
          if (snapshot.thread.id !== action.threadId
            || (source.kind === 'mission' ? snapshot.thread.missionId !== source.id : taskCapabilityRef.current && snapshot.tasksEnabled && !(snapshot.tasks ?? []).some(task => task.taskId === source.id))) {
            throw new Error(uiAttribute('原事项已删除或暂时不可用。'))
          }
          if (source.kind === 'task' && taskCapabilityRef.current) anchoredTasks = (snapshot.tasks ?? []).filter(task => task.taskId === source.id)
        }
        let anchoredMessages: readonly ThreadMessageView[] = []
        let anchoredAgentRuns: readonly AgentRunView[] = []
        if (action.kind === 'open_camp_message') {
          if (!action.messageId) {
            result = {
              status: 'failed',
              message:uiAttribute("消息动作没有可用的精确定位目标。")
            }
            return
          }
          const around = await client.request<ThreadMessageAroundSnapshot>(
            'thread.messages.around',
            {
              threadId: action.threadId,
              messageId: action.messageId
            }
          )
          if (
            around.schemaVersion !== 1
            || around.threadId !== action.threadId
            || around.anchorMessageId !== action.messageId
          ) throw new Error(uiAttribute('消息定位合同不兼容。'))
          if (!around.sourceAvailable) {
            result = {
              status: 'failed',
              message:uiAttribute("原消息已删除或暂时不可用。通知仍保留在“全部”列表中。")
            }
            return
          }
          if (!around.messages.some((message) => message.id === action.messageId)) {
            throw new Error(uiAttribute('消息定位结果未包含目标消息。'))
          }
          anchoredMessages = around.messages
        }
        if (action.kind === 'open_agent_run') {
          if (!action.agentRunId) {
            result = {
              status: 'failed',
              message:uiAttribute("执行动作没有可用的精确定位目标。")
            }
            return
          }
          const availableSnapshot = campSnapshotRef.current?.thread.id === action.threadId
            ? campSnapshotRef.current
            : campSnapshotCache.current.get(action.threadId)?.snapshot ?? null
          const run = await resolveNotificationAgentRun(client, action.threadId, action.agentRunId, availableSnapshot)
          if (!run) {
            result = {
              status: 'failed',
              message:uiAttribute("原执行已删除或暂时不可用。通知仍保留在“全部”列表中。")
            }
            return
          }
          anchoredAgentRuns = [run]
        }
        const target: NotificationFocusTarget | null = (action.kind === 'open_mission' || (action.kind === 'open_task' && taskCapabilityRef.current)) && action.subject
          ? { requestId: ++notificationFocusSequence.current, kind: action.subject.kind === 'mission' ? 'mission' : 'task', subjectId: action.subject.id, threadTurnId: null }
          : (action.kind === 'open_single_chat' || action.kind === 'open_native_interaction') && action.singleChat
          ? { requestId: ++notificationFocusSequence.current, kind: 'single_chat',
            conversationId: action.singleChat.conversationId, agentRunId: action.singleChat.agentRunId,
            threadTurnId: action.threadTurnId, approvalId: action.approvalId ?? undefined, interactionId: action.interactionId }
          : action.kind === 'open_camp_message'
          ? action.messageId
            ? {
              requestId: ++notificationFocusSequence.current,
              kind: 'camp_message',
              threadTurnId: action.threadTurnId,
              messageId: action.messageId
            }
            : null
          : action.kind === 'open_native_interaction'
            ? { requestId: ++notificationFocusSequence.current, kind: 'native_interaction',
                threadTurnId: null, interactionId: action.interactionId }
          : action.kind === 'open_approval'
            ? {
              requestId: ++notificationFocusSequence.current,
              kind: 'approval',
              threadTurnId: null,
              approvalId: action.approvalId ?? undefined
            }
          : action.kind === 'open_camp_turn' && action.threadTurnId
            ? {
              requestId: ++notificationFocusSequence.current,
              kind: 'camp_turn',
              threadTurnId: action.threadTurnId
            }
          : action.kind === 'open_agent_run' && action.agentRunId
            ? {
              requestId: ++notificationFocusSequence.current,
              kind: 'agent_run',
              agentRunId: action.agentRunId,
              threadTurnId: null
            }
            : null
        setNotificationFocus(target ? { ...target, active: false } : null)
        let archivedNotice: string | undefined
        const activated = await activateThread(action.threadId, {
          onArchived: message => { archivedNotice = message },
          memberPrepared: true,
          preserveNotificationFocus: target !== null,
          missionPresentation: 'drawer',
          reconcileDefaultLead: true,
          suppressErrors: true,
          anchoredMessages,
          anchoredTasks,
          anchoredAgentRuns
        })
        if (!activated) {
          result = {
            status: 'failed',
            message: archivedNotice ?? uiAttribute("暂时无法打开通知来源。通知仍保留，可稍后重试。")
          }
          return
        }
        if (
          action.kind === 'open_camp_message'
          && action.messageId
          && !document.querySelector(
            `[data-message-id="${CSS.escape(action.messageId)}"]`
          )
        ) {
          result = {
            status: 'failed',
            message:uiAttribute("已打开会话，但原消息未能呈现。通知仍保留，可稍后重试。")
          }
          return
        }
        if ((action.kind === 'open_single_chat' || action.kind === 'open_native_interaction') && action.singleChat && target) {
          setSingleChatNotificationTarget({ ...action.singleChat, requestId: target.requestId })
          setSingleChatThreadId(action.threadId)
        } else setSingleChatThreadId(null)
        result = { status: 'navigated' }
      } catch (nextError) {
        result = {
          status: 'failed',
          message: uiAttribute("暂时无法打开通知来源：{0}", String(errorMessage(nextError)))
        }
      } finally {
        transitionActionCompleted = true
      }
    })
    return transitioned || transitionActionCompleted ? result : {
      status: 'failed',
      message:uiAttribute("请先处理当前队员页面中尚未保存的更改，再打开这条通知。")
    }
  }, [activateThread, requestMemberTransition])

  const presentNotificationNavigation = useCallback(async (
    _episode: NotificationEpisodeView,
    action: NotificationActionView
  ): Promise<boolean> => {
    if (activeThreadIdRef.current !== action.threadId || viewRef.current !== 'camp') return false
    if (action.kind === 'open_camp' || (action.kind === 'open_task' && !taskCapabilityRef.current)) return true
    const focus = notificationFocusRef.current
    if (!focus || !notificationFocusMatchesAction(focus, action)) return false
    const coordinator = notificationPresentationRef.current
    if (!coordinator) return false
    const presentation = coordinator.waitFor(focus.requestId)
    setNotificationFocus((current) => current?.requestId === focus.requestId
      ? { ...current, active: true }
      : current)
    const presented = await presentation
    return presented || (action.kind === 'open_task' && !taskCapabilityRef.current
      && activeThreadIdRef.current === action.threadId && viewRef.current === 'camp')
  }, [])

  const completeNotificationNavigation = useCallback((requestId: number): void => {
    // Direct source links also use focus requests, without a notification waiter.
    notificationPresentationRef.current?.complete(requestId)
    setNotificationFocus((current) => current?.requestId === requestId ? null : current)
  }, [])

  const cancelNotificationNavigation = useCallback((): void => {
    notificationPresentationRef.current?.cancel()
    setNotificationFocus(null)
    setNotificationAnchor(null)
  }, [])

  const toggleNavigationPin = async (
    kind: NavigationPin['kind'],
    targetKey: string,
    thread?: NavigationThreadItem
  ): Promise<void> => {
    const existing = navigationPins.find((pin) =>
      pin.kind === kind && pin.targetKey === targetKey
    )
    const nextPins = existing
      ? navigationPins.filter((pin) => pin !== existing)
      : [...navigationPins, { kind, targetKey, pinnedAt: new Date().toISOString() }]
    try {
      const snapshot = await uiPreferences.navigationPreferences.replacePins(nextPins)
      applyNavigationPreferences(snapshot)
      if (kind === 'camp') {
        setPinnedThreadItems((current) => existing
          ? current.filter((item) => item.id !== targetKey)
          : [
              ...current.filter((item) => item.id !== targetKey),
              thread ?? (navigation ? allNavigationThreads(navigation).find((item) => item.id === targetKey) : undefined)
            ].filter((item): item is NavigationThreadItem => Boolean(item)))
      }
    } catch (error) {
      showOperationError('navigation.pin', error)
    }
  }

  const removeNavigationProject = async (
    project: ProjectNavigationGroup
  ): Promise<void> => {
    const activeSnapshot = campSnapshotRef.current
    const removingActiveThread = activeSnapshot?.thread.id === activeThreadIdRef.current
      && activeSnapshot.thread.projectBindingKind === 'directory'
      && activeSnapshot.thread.projectPath === project.projectPath
    const remove = async (): Promise<void> => {
      setBusy(`remove-project-${project.projectKey}`)
      setError(null)
      try {
        const relatedPinnedThreadIds = pinnedThreadItems
          .filter((thread) => (
            thread.projectBindingKind === 'directory'
            && thread.projectPath === project.projectPath
          ))
          .map((thread) => thread.id)
        const snapshot = await uiPreferences.navigationPreferences.removeProject(
          project.projectKey,
          relatedPinnedThreadIds
        )
        applyNavigationPreferences(snapshot)
        setPinnedThreadItems((current) => current.filter((thread) => !(
          thread.projectBindingKind === 'directory'
          && thread.projectPath === project.projectPath
        )))

        const removingCurrent = currentProject.kind === 'directory'
          && currentProject.projectPath === project.projectPath
        if (removingCurrent) {
          const fallback: CurrentProject = { kind: 'quick_chat' }
          setCurrentProject(fallback)
          setCurrentWorkspaceHint(null)
          persistCurrentProject(fallback)
        }
        if (removingActiveThread) {
          if (activeThreadId) forgetRemovedThreadSurface(activeThreadId)
          setNotificationFocus(null)
        }
        if (removingCurrent || removingActiveThread) {
          await commitRestorableLocation({ kind: 'quick_chat' })
        }
      } finally {
        setBusy(null)
      }
    }
    if (removingActiveThread) {
      const transitioned = await leaveActiveSurface(remove)
      if (!transitioned) {
        throw new Error(uiAttribute('当前输入操作尚未完成，项目未从侧栏移除。请重试。'))
      }
    } else {
      await remove()
    }
  }

  const renameProject = async (project: ProjectNavigationGroup, name: string | null): Promise<void> => {
    const snapshot = await uiPreferences.navigationPreferences.setProjectName(project.projectKey, name)
    applyNavigationPreferences(snapshot)
  }

  const renameThread = async (thread: NavigationThreadItem, title: string): Promise<void> => {
    setBusy(`rename-camp-${thread.id}`)
    setError(null)
    try {
      const result = await client.request<StoredCommandResult>('threads.rename', {
        commandId: newCommandId(),
        command: {
          threadId: thread.id,
          title
        }
      })
      if (result.status === 'rejected') throw new OperationFailure(normalizeFailure(result))
      void navigationRefreshCoordinator.refreshThreads([thread.id], 'explicit')
        .catch(error => reportOperationFailure('navigation.read', error))
      void refreshThreadInBackground(thread.id)
    } finally {
      setBusy(null)
    }
  }

  const showUnarchivedToast = (threadId: string, kind: ArchiveKind): void => {
    setToast({
      message: uiAttribute('已取消归档'), tone: 'neutral', icon: 'archive',
      actions: [{ label: uiAttribute('查看'), onSelect: () => {
        const open = kind === 'mission'
          ? openMission({ threadId })
          : activateThread(threadId, { reconcileDefaultLead: false })
        void open.catch(error => notifyError(errorMessage(error)))
      } }]
    })
  }

  const changeArchive = async (
    threadId: string, archived: boolean, kind: ArchiveKind
  ): Promise<void> => {
    if (archiveWrites.current.has(threadId)) return
    archiveWrites.current.add(threadId)
    const apply = async (): Promise<void> => {
      let changed: boolean
      try {
        changed = (await writeArchive(client, archived, { threadId })).changed
      } catch (error) {
        const reason = errorMessage(error)
        notifyError(archived ? uiAttribute('归档失败：{0}', reason) : uiAttribute('取消归档失败：{0}', reason))
        return
      }
      campSnapshotCache.current.delete(threadId)
      if (!archived) {
        showUnarchivedToast(threadId, kind)
        return
      }
      leaveArchivedWorkspace(threadId, kind === 'mission')
      if (changed) setToast({
        message: uiAttribute('已归档'), tone: 'neutral', icon: 'archive',
        actions: [
          { label: uiAttribute('撤销'), onSelect: () => {
            void changeArchive(threadId, false, kind).catch(error => notifyError(errorMessage(error)))
          } },
          { label: uiAttribute('查看'), onSelect: () => {
            void desktopNavigation.push({ kind: 'settings', section: 'archive', archive: { kind, threadId } })
          } }
        ]
      })
    }
    try {
      if (archived && viewRef.current === 'camp' && activeThreadIdRef.current === threadId) await leaveActiveThread(apply)
      else await apply()
    } finally {
      archiveWrites.current.delete(threadId)
    }
  }

  const deleteThreadWithoutAutomationLeaveGuard = async (thread: NavigationThreadItem): Promise<void> => {
    setBusy(`delete-camp-${thread.id}`)
    setError(null)
    try {
      if (thread.projectBindingKind === 'directory' && !navigationPreferencesRef.current?.legacyProjectsSynced) {
        await registerProject(thread.projectPath)
      }
      const result = await client.request<StoredCommandResult>('threads.delete', {
        commandId: newCommandId(),
        command: { threadId: thread.id }
      })
      if (result.status === 'rejected') throw new OperationFailure(normalizeFailure(result))
      hideAcceptedThreadDeletion(thread.id)
      void navigationRefreshCoordinator.refreshGroups([thread.projectBindingKind === 'directory' ? `directory:${thread.projectPath}` : 'quick-chat']).catch(() => undefined)
    } finally {
      setBusy(null)
    }
  }

  const deleteThread = async (thread: NavigationThreadItem): Promise<void> => {
    if (viewRef.current === 'automations' && activeThreadIdRef.current === thread.id
      && !await leaveActiveAutomation(() => undefined)) return
    await deleteThreadWithoutAutomationLeaveGuard(thread)
  }

  const cancelAgentRun = async (run: AgentRunView): Promise<void> => {
    const threadId = activeThreadIdRef.current
    if (!threadId || campSnapshotRef.current?.thread.id !== threadId
      || inFlightRunStops.current.has(run.id) || shuttingDownRef.current) return
    const visit = desktopNavigation.captureVisit()
    const isInOrigin = () => visit.isCurrent() && viewRef.current === 'camp' && !shuttingDownRef.current
    inFlightRunStops.current.add(run.id)
    setError(current => current?.operation === 'run.stop' ? null : current)
    setConfirmingRunIds(current => new Set([...current].filter(id => id !== run.id)))
    setCancellingRunIds(current => new Set(current).add(run.id))

    try {
      let result: StoredCommandResult
      try {
        result = await requestRunStop(client, threadId, run, async () => {
          if (!isInOrigin()) return null
          await refreshActiveThreadSnapshot(threadId)
          if (!isInOrigin() || campSnapshotRef.current?.thread.id !== threadId || deletingThreadIdsRef.current.has(threadId)) return null
          return campSnapshotRef.current.agentRuns.find(item => item.id === run.id)?.version ?? null
        })
      } catch {
        if (isInOrigin()) {
          setConfirmingRunIds(current => new Set(current).add(run.id))
          try {
            const { snapshot } = await requestThreadProjection(threadId, 'open')
            if (isInOrigin() && snapshot.throughGlobalSequence >= campEventSequenceMarker.current) {
              campEventSequenceMarker.current = snapshot.throughGlobalSequence
              setThreadSnapshot(snapshot)
              setConfirmingRunIds(current => reconcileRunCancellationIds(current, snapshot))
            }
          } catch {
            // A later authoritative refresh settles the unknown stop result.
          }
        }
        return
      }

      if (result.status === 'rejected') {
        if (!isInOrigin()) return
        if (result.code === 'agent_run.turn_cancellation_in_progress') {
          const turnId = run.threadTurnId
          if (turnId) setCancellingTurnIds(current => new Set(current).add(turnId))
        } else {
          showOperationError('run.stop', result)
        }
        void refreshThreadInBackground(threadId)
        return
      }

      if (campSnapshotRef.current?.thread.id === threadId) {
        setThreadSnapshot(applyCancellationResult(campSnapshotRef.current, result))
      }
      void refreshThreadInBackground(threadId)
    } finally {
      inFlightRunStops.current.delete(run.id)
      setCancellingRunIds(current => new Set([...current].filter(id => id !== run.id)))
    }
  }

  const changeDefaultLead = async (agentId: string): Promise<void> => {
    const threadId = activeThreadIdRef.current
    const snapshot = campSnapshotRef.current
    if (!threadId || snapshot?.thread.id !== threadId) return
    const visit = desktopNavigation.captureVisit()
    const subject = snapshot.members.find(member => member.agentId === agentId)?.displayName
    setBusy('change-default-lead')
    setError(current => current?.operation === 'thread.lead.change' ? null : current)
    try {
      const result = await client.request<StoredCommandResult>('threads.changeDefaultLead', {
        commandId: newCommandId(),
        command: { threadId, successorAgentId: agentId }
      })
      if (result.status === 'rejected') {
        if (visit.isSameVisit() && result.code === 'camp.default_lead_unavailable') {
          notify(reportOperationFailure('thread.lead.change', result, { subject }).message)
          void refreshThreadInBackground(threadId)
          return
        }
        throw new OperationFailure(normalizeFailure(result))
      }
      void refreshThreadInBackground(threadId)
      void navigationRefreshCoordinator.refreshThreads([threadId], 'explicit').catch(error => reportOperationFailure('navigation.read', error))
    } catch (error) {
      if (visit.isSameVisit()) showOperationError('thread.lead.change', error)
    } finally {
      setBusy(null)
    }
  }

  const addThreadMembers = async (agentIds: string[]): Promise<ThreadMemberAddOutcome> => {
    const threadId = activeThreadIdRef.current
    const currentSnapshot = campSnapshotRef.current
    if (!threadId || currentSnapshot?.thread.id !== threadId) {
      throw new Error(uiAttribute('当前会话尚未准备好。'))
    }
    setBusy('camp-membership')
    setError(null)
    const outcome: ThreadMemberAddOutcome = {
      addedAgentIds: [],
      unchangedAgentIds: [],
      failures: []
    }
    let membershipGeneration = currentSnapshot.thread.membershipGeneration
    try {
      for (let index = 0; index < agentIds.length; index += 1) {
        const agentId = agentIds[index]
        try {
          const result = await client.request<StoredCommandResult>('threads.members.add', {
            commandId: newCommandId(),
            command: {
              threadId,
              agentId,
              expectedMembershipGeneration: membershipGeneration
            }
          })
          if (result.status === 'rejected') {
            const message = commandFailureMessage(result)
            outcome.failures.push({ agentId, message })
            if (membershipConflictCode(result.code)) {
              for (const remainingAgentId of agentIds.slice(index + 1)) {
                outcome.failures.push({
                  agentId: remainingAgentId,
                  message:uiAttribute("名册已发生变化，请在刷新后重试。")
                })
              }
              break
            }
            continue
          }
          const payload = asRecord(result.payload)
          if (typeof payload.membershipGeneration === 'number') {
            membershipGeneration = payload.membershipGeneration
          }
          if (payload.changed === false) outcome.unchangedAgentIds.push(agentId)
          else outcome.addedAgentIds.push(agentId)
        } catch (error) {
          outcome.failures.push({ agentId, message: errorMessage(error) })
        }
      }
      try {
        await Promise.all([
          refreshActiveThreadSnapshot(threadId),
          navigationRefreshCoordinator.refreshThreads([threadId], 'explicit')
        ])
      } catch {
        // The per-command outcomes are authoritative; normal event refresh will converge the surface.
      }
      return outcome
    } finally {
      setBusy(null)
    }
  }

  const previewThreadMemberRemoval = async (agentId: string): Promise<ThreadMemberRemovalPreview | null> => {
    const threadId = activeThreadIdRef.current
    if (!threadId || campSnapshotRef.current?.thread.id !== threadId) {
      throw new Error(uiAttribute('当前会话尚未准备好。'))
    }
    return client.request<ThreadMemberRemovalPreview | null>(
      'threads.members.removalPreview',
      { threadId, agentId }
    )
  }

  const removeThreadMember = async (
    command: RemoveThreadMemberCommand
  ): Promise<ThreadMemberRemoveOutcome> => {
    const threadId = activeThreadIdRef.current
    if (!threadId || command.threadId !== threadId || campSnapshotRef.current?.thread.id !== threadId) {
      return { status: 'conflict', message: uiAttribute('队员名单已变化，请重新选择要移出的队员。') }
    }
    setBusy('camp-membership')
    setError(null)
    try {
      const result = await client.request<StoredCommandResult>('threads.members.remove', {
        commandId: newCommandId(),
        command: { ...command, reason: 'removed_from_camp' }
      })
      if (result.status === 'rejected') {
        try {
          await refreshActiveThreadSnapshot(threadId)
        } catch {
          // Keep the deterministic command result when the follow-up projection is unavailable.
        }
        if (membershipConflictCode(result.code)) {
          return { status: 'conflict', message: uiAttribute('队员名单已变化，请重新选择要移出的队员。') }
        }
        return { status: 'failed', message: reportOperationFailure('thread.member.remove', result).message }
      }
      try {
        await Promise.all([
          refreshActiveThreadSnapshot(threadId),
          navigationRefreshCoordinator.refreshThreads([threadId], 'explicit')
        ])
      } catch {
        // The accepted cutover is authoritative; reconciliation events will refresh the surface.
      }
      const reconciliationStatus = stringField(asRecord(result.payload), 'reconciliationStatus')
      return {
        status: 'removed',
        reconciliationStatus: reconciliationStatus === 'reconciling' ? 'reconciling' : 'settled'
      }
    } catch (error) {
      return { status: 'failed', message: reportOperationFailure('thread.member.remove', error).message }
    } finally {
      setBusy(null)
    }
  }

  async function createThread(
    draft: Omit<CreateThreadRequest, 'commandId'>,
    enableOneClick = false,
    intent: NavigationIntent = desktopNavigation.beginIntent(),
    memberCreation = false
  ): Promise<void> {
    cancelPendingThreadActivation()
    setBusy('create-camp')
    try {
      if (draft.workspace && !navigationPreferencesRef.current?.legacyProjectsSynced) {
        await registerProject(draft.workspace.projectPath)
      }
      const result = await client.request<StoredCommandResult>('threads.create', {
        commandId: newCommandId(),
        ...draft
      })
      if (result.status === 'rejected') throw new Error(commandFailureMessage(result))
      const threadId = stringField(result.payload, 'threadId')
      if (!threadId) throw new Error(uiAttribute('会话已创建，但暂时无法打开。请刷新会话列表后重试。'))
      if (memberCreation) setMemberCreationDrafts((current) => new Map(current).set(threadId, {
        draft: memberCreationInitialDraft(threadId),
        navigation: { id: threadId, title: uiAttribute('新建队员'), activationState: 'pending',
          projectBindingKind: 'quick_chat', projectPath: '', defaultLead: null, marker: 'none',
          lastActivityAt: new Date().toISOString(), lastActivityGlobalSequence: 0,
          latestCompletionGlobalSequence: 0, version: 1 }
      }))
      setNewConversationOpen(false)
      let preferencesSaveFailed = false
      if (enableOneClick) {
        try {
          const saved = draft.team
            ? await uiPreferences.generalPreferences.setNewConversationTeam(draft.team.teamId, true)
            : await uiPreferences.generalPreferences.setNewConversationDefaults({
            memberAgentIds: draft.memberAgentIds,
            defaultLeadAgentId: draft.defaultLeadAgentId
          }, true)
          setGeneralPreferences(saved)
        } catch {
          preferencesSaveFailed = true
        }
      }
      try {
        if (intent.isCurrent()) {
          await activateThread(threadId, { reconcileDefaultLead: false, initializeComposerDraft: true })
        } else {
          // Core owns the created Thread. Refresh its visibility without stealing focus;
          // empty one-click drafts still follow the existing pending-Thread lifecycle.
          await navigationRefreshCoordinator.invalidate({ scope: 'group', threadId })
        }
      } finally {
        if (preferencesSaveFailed) {
          notifyError(uiAttribute('对话已创建，但默认队伍与一键新建设置未保存。可在「设置 → 通用」重试。'))
        }
      }
    } finally {
      setBusy(null)
    }
  }

  const beginMemberCreation = async (): Promise<boolean> => {
    if (newConversationRequestBusy.current) return true
    newConversationRequestBusy.current = true
    const intent = desktopNavigation.beginIntent()
    try {
      const [preflight, preferences] = await Promise.all([
        client.request<ThreadCreationPreflight>('threads.creationPreflight'),
        uiPreferences.generalPreferences.get()
      ])
      if (!intent.isCurrent()) return true
      const helper = memberCreationHelper(preflight, preferences.newConversationDefaults?.defaultLeadAgentId ?? null)
      if (!helper) return false
      await createThread({ name: null, workspace: null, memberAgentIds: [helper],
        defaultLeadAgentId: helper, collaborationMode: 'peer', activationState: 'pending' }, false, intent, true)
    } catch (error) { notifyError(errorMessage(error)) }
    finally { newConversationRequestBusy.current = false }
    return true
  }

  const updateMemberCreationDraft = useCallback((draft: ThreadComposerDraftView): void => {
    setMemberCreationDrafts((current) => {
      const previous = current.get(draft.threadId)
      if (!previous || previous.draft === draft) return current
      return new Map(current).set(draft.threadId, { ...previous, draft })
    })
  }, [])

  const forgetMemberCreationDraft = (threadId: string): void => {
    setMemberCreationDrafts((current) => {
      if (!current.has(threadId)) return current
      const next = new Map(current); next.delete(threadId); return next
    })
  }

  function forgetRemovedThreadSurface(threadId: string): void {
    if (activeThreadIdRef.current !== threadId) return
    setActiveThreadId(null)
    setThreadSnapshot(null)
    const current = desktopNavigation.getSnapshot()
    const target = current.entries[current.index]
    if (viewRef.current === 'camp' && target?.kind === 'camp' && target.threadId === threadId) {
      // Correct the displayed resource without invalidating a newer Thread read.
      if (desktopNavigation.captureCurrentEntry().update({ kind: 'quick_chat' })) setView('compose')
    }
  }

  function hideAcceptedThreadDeletion(threadId: string): void {
    reeditStore.deleteThread(threadId)
    deletingThreadIdsRef.current.add(threadId)
    const currentNavigation = navigationSnapshotRef.current
    if (currentNavigation) {
      const nextNavigation = navigationWithoutDeletedThreads(
        currentNavigation,
        deletingThreadIdsRef.current
      )
      navigationSnapshotRef.current = nextNavigation
      setNavigation(nextNavigation)
    }
    setPinnedThreadItems((current) => current.filter((thread) => thread.id !== threadId))
    clearLocalThreadComposerDraft(threadId)
    forgetMemberCreationDraft(threadId)
    const discardComposerAttachments = client.composerAttachments.discard?.(threadId)
    if (discardComposerAttachments) void discardComposerAttachments.catch(() => undefined)
    forgetFilePreviewSession(threadId, activeThreadIdRef.current === threadId)
    campSnapshotCache.current.delete(threadId)
    forgetRemovedThreadSurface(threadId)
  }

  const refreshPendingThreadNavigation = (): void => {
    const threadId = activeThreadIdRef.current
    if (threadId) void navigationRefreshCoordinator.invalidate({ scope: 'group', threadId }).catch(() => undefined)
  }

  const settlePendingThreadOnLeave = async (draft: ThreadComposerDraftView): Promise<void> => {
    if (hasPendingThreadDraftInput(draft)) {
      await navigationRefreshCoordinator.invalidate({ scope: 'group', threadId: draft.threadId })
      return
    }
    const result = await client.request<StoredCommandResult>('threads.discardPending', {
      commandId: newCommandId(),
      command: { threadId: draft.threadId }
    })
    if (result.status === 'rejected' && result.code !== 'camp.pending_not_empty') {
      throw new Error(commandFailureMessage(result))
    }
    if (result.status !== 'rejected') {
      clearLocalThreadComposerDraft(draft.threadId)
      campSnapshotCache.current.delete(draft.threadId)
      forgetMemberCreationDraft(draft.threadId)
    }
    if (result.status !== 'rejected') forgetRemovedThreadSurface(draft.threadId)
    await navigationRefreshCoordinator.invalidate({ scope: 'group', threadId: draft.threadId })
  }

  const sendThreadMessage = async (
    draft: ThreadComposerDraftView, deliveryMode: 'start' | 'steer' = 'start',
    steerTargets: Array<{agentRunId: string; executionEpoch: number}> = [], displayedImages?: ReadonlyMap<string, ImagePreviewUrl>
  ): Promise<ThreadMessageSendReceipt | void> => {
    const hasReadyAttachment = draft.attachments.length > 0
    const hasSendablePayload = composerHasSendablePayload(draft.body, hasReadyAttachment)
    const threadId = activeThreadIdRef.current
    if (!threadId || draft.threadId !== threadId || !hasSendablePayload || draft.revision < 1) return
    const commandId = newCommandId()
    const selectionGeneration = campSelectionGeneration.current
    const optimisticMessage = optimisticThreadMessage(
      campSnapshotRef.current?.thread.id === threadId ? campSnapshotRef.current : null,
      commandId,
      draft
    )
    // The public message ID confirms the image owner, including when recipient delivery is still waiting.
    const imagePublication = prepareImagePublication(client, draft, optimisticMessage.sequence, displayedImages)
    if (imagePublication) setImagePublications(current => [...current, imagePublication])
    setBusy('camp-message')
    setError(null)
    setRuntimeRecovery((current) => current?.threadId === threadId ? null : current)
    let rejectedForRuntime = false
    try {
      const result = await client.request<SendThreadMessageResult>(
        'thread.messages.send',
        { ...campMessageSendParams(commandId, threadId, draft), deliveryMode, steerTargets }
      )
      if (!result.commandResult) {
        throw new Error(uiAttribute('消息提交结果暂时不可用，请稍后重试。'))
      }
      if (result.commandResult.status === 'rejected') {
        if (result.commandResult.code === 'project_file_reference_unavailable') {
          const payload = result.commandResult.payload
          if (typeof payload.rawReference === 'string') reportProjectFileReferenceRejection(threadId, payload.rawReference, String(payload.reason ?? 'invalid_reference'))
        }
        const recovery = runtimeRecoveryFromCommandResult(threadId, result.commandResult)
        if (recovery) {
          rejectedForRuntime = true
          setRuntimeRecovery(recovery)
        }
        throw new Error(commandFailureMessage(result.commandResult))
      }
      forgetMemberCreationDraft(threadId)
      const threadMessageId = stringField(result.commandResult.payload, 'threadMessageId')
      const deliveryIds = stringArrayField(result.commandResult.payload, 'deliveryIds')
      const agentRunIds = stringArrayField(result.commandResult.payload, 'agentRunIds')
      const sequence = typeof result.commandResult.payload.sequence === 'number'
        ? result.commandResult.payload.sequence
        : optimisticMessage.sequence
      if (threadMessageId) {
        imagePublication?.publish(threadMessageId, viewRef.current === 'camp' && activeThreadIdRef.current === threadId)
        // File publication fields arrive from Core's projection; never display a fabricated file segment.
        if (!draft.content.segments.some(segment => segment.kind === 'atom' && segment.atom.type === 'project_file_reference')) {
          setOptimisticThreadMessages((current) => [...current, {
            threadId, commandId,
            message: { ...optimisticMessage, id: threadMessageId, sequence, threadTurnId: null }
          }])
        }
        void refreshActiveThreadSnapshot(threadId)
          .then(async () => {
            if (selectionGeneration !== campSelectionGeneration.current) return
            setOptimisticThreadMessages((current) =>
              current.filter((entry) => entry.commandId !== commandId)
            )
            if (selectionGeneration === campSelectionGeneration.current) await navigationRefreshCoordinator.invalidate({ scope: 'group', threadId })
          })
          .catch(error => reportOperationFailure('navigation.read', error))
      }
      return {
        ...(threadMessageId ? { threadMessageId } : {}),
        ...(threadMessageId && typeof result.commandResult.payload.sequence === 'number'
          ? { publishedMessageSequence: sequence } : {}),
        deliveryIds,
        agentRunIds,
        addressedAgentIds: optimisticMessage.addressedAgentIds
      }
    } catch (nextError) {
      setOptimisticThreadMessages((current) =>
        current.filter((entry) => entry.commandId !== commandId)
      )
      if (!rejectedForRuntime) notify(errorMessage(nextError))
      throw nextError
    } finally {
      if (imagePublication) {
        imagePublication.release()
        setImagePublications(current => current.filter(entry => entry !== imagePublication))
      }
      setBusy(null)
    }
  }

  const withdrawalCallbacks = useRef({ refresh: refreshActiveThreadSnapshot, notify })
  withdrawalCallbacks.current = { refresh: refreshActiveThreadSnapshot, notify }
  const messageWithdrawal = useMemo(() => new MessageWithdrawal({
    store: reeditStore,
    request: request => client.withdrawMessage ? client.withdrawMessage(request)
      : client.request<StoredCommandResult>('thread.messages.withdraw', request).then(result => ({ result, source: 'direct' })),
    accepted: (_threadId, messageId) => {
      setOptimisticThreadMessages(current => current.filter(entry => entry.message.id !== messageId))
    },
    refresh: threadId => withdrawalCallbacks.current.refresh(threadId),
    notify: message => withdrawalCallbacks.current.notify(message),
    rejectionMessage: commandFailureMessage
  }), [client, reeditStore])
  useEffect(() => {
    const stop = reeditStore.start()
    messageWithdrawal.recoverPending()
    const recover = (): void => { reeditStore.sweep(); messageWithdrawal.recoverPending() }
    window.addEventListener('online', recover)
    window.addEventListener('focus', recover)
    const unsubscribe = client.onInvalidated?.(recover)
    return () => { stop(); unsubscribe?.(); window.removeEventListener('online', recover); window.removeEventListener('focus', recover) }
  }, [client, reeditStore, messageWithdrawal])
  const withdrawThreadMessage = (message: ThreadMessageView): Promise<void> => {
    const threadId = activeThreadIdRef.current
    return threadId ? messageWithdrawal.withdraw(threadId, message) : Promise.resolve()
  }

  const resolveActionApproval = async (
    approval: ActionApprovalView,
    optionId: string
  ): Promise<void> => {
    const threadId = activeThreadIdRef.current
    if (!threadId) return
    setBusy(`action-approval-${approval.id}`)
    try {
      const result = await client.request<StoredCommandResult>('action.approvals.resolve', {
        commandId: newCommandId(),
        threadId,
        approvalId: approval.id,
        expectedVersion: approval.version,
        optionId,
        reason: `用户选择智能体原生选项：${optionId}。`
      })
      void refreshThreadInBackground(threadId)
      if (result.status === 'rejected') throw new OperationFailure(normalizeFailure(result))
    } finally {
      setBusy(null)
    }
  }

  const changeAppearancePreferences = async (preferences: AppearancePreferences): Promise<AppearanceSnapshot> => {
    const snapshot = await uiPreferences.appearance.updatePreferences(preferences)
    applyAppearanceSnapshot(document.documentElement, snapshot)
    setAppearance(snapshot)
    return snapshot
  }

  const runOnboardingMutation = async (
    mutate: () => Promise<OnboardingSnapshot>
  ): Promise<void> => {
    setOnboardingBusy(true)
    setOnboardingError(null)
    try {
      setOnboardingSnapshot(await mutate())
    } catch (nextError) {
      setOnboardingError(errorMessage(nextError))
    } finally {
      setOnboardingBusy(false)
    }
  }

  const changeOnboardingTheme = async (preference: ThemePreference): Promise<void> => {
    setOnboardingBusy(true)
    setOnboardingError(null)
    try {
      const snapshot = await uiPreferences.appearance.setPreference(preference)
      applyAppearanceSnapshot(document.documentElement, snapshot)
      setAppearance(snapshot)
    } catch (nextError) {
      setOnboardingError(errorMessage(nextError))
    } finally {
      setOnboardingBusy(false)
    }
  }

  const completeOnboarding = async (): Promise<void> => {
    if (!desktop || onboardingSnapshot?.status !== 'in_progress') return
    setOnboardingBusy(true)
    setOnboardingError(null)
    try {
      const result = await provisionFirstRun(
        { request: client.request, onboarding: desktop.onboarding, desktopSession: desktop.desktopSession },
        onboardingSnapshot,
        installations,
        (checkpoint) => {
          if (checkpoint.status === 'in_progress') setOnboardingSnapshot(checkpoint)
        },
        interfaceLanguage
      )
      const [nextAgents, , nextInstallations] = await Promise.all([
        client.request<AgentProfile[]>('members.list'),
        loadNavigation(),
        loadInstallations()
      ])
      setAgents(nextAgents)
      setInstallations(nextInstallations)
      setState('ready')
      const activated = await activateThread(result.quickChatThreadId, { reconcileDefaultLead: false })
      // The new Thread resolves this startup; do not replay the initial home route afterward.
      if (activated && startupSnapshot) completeStartup(startupSnapshot.sessionId)
      setOnboardingSnapshot(result.snapshot)
    } catch (nextError) {
      const message = errorMessage(nextError)
      try {
        const stored = await desktop.onboarding.get()
        if (stored.status === 'completed') {
          setOnboardingSnapshot(stored)
          setError({ operation: 'thread.open', message: uiAttribute('“初次集结”已保存，请重新打开会话。') })
        } else {
          setOnboardingSnapshot(stored)
          setOnboardingError(message)
        }
      } catch {
        setOnboardingError(message)
      }
    } finally {
      setOnboardingBusy(false)
    }
  }

  const openThreadInspector = (tab: ThreadInspectorTab): void => {
    setThreadInspectorTab(tab)
    setSingleChatThreadId(null)
    setThreadInspectorThreadId(activeThreadId)
  }

  const openSingleChat = (): void => {
    setSingleChatNotificationTarget(null)
    setThreadInspectorThreadId(null)
    setSingleChatThreadId(activeThreadId)
  }

  const changeExecutionConsolePlacement = useCallback(async (
    placement: ExecutionConsolePlacement
  ): Promise<ExecutionConsolePlacement> => {
    const next = await uiPreferences.generalPreferences.setExecutionConsolePlacement(placement)
    setGeneralPreferences(next)
    return next.executionConsolePlacement
  }, [])

  const focusThreadApprovals = (): void => {
    if (mobile) { setThreadInspectorThreadId(null); setSingleChatThreadId(null) }
    setNotificationFocus({
      requestId: ++notificationFocusSequence.current,
      kind: 'approval',
      threadTurnId: null,
      active: true
    })
  }

  async function openMission(mission: Pick<MissionRecord, 'threadId'>): Promise<void> {
    setMissionPresentation('drawer')
    await activateThread(mission.threadId, { reconcileDefaultLead: false })
    if (activeThreadIdRef.current === mission.threadId && viewRef.current === 'camp') {
      setMissionPresentation('drawer'); setMissionOpenRequest(value => value + 1)
    }
  }
  const refreshMission = async (threadId: string): Promise<void> => {
    await missionList.refresh()
    if (activeThreadIdRef.current === threadId) await refreshActiveThreadSnapshot(threadId)
  }
  const refreshMissionAfterWorkspaceCleanup = async (threadId: string): Promise<void> => {
    await Promise.all([
      missionList.refreshOrThrow(),
      activeThreadIdRef.current === threadId ? refreshActiveThreadSnapshot(threadId) : Promise.resolve()
    ])
  }
  const onMissionDeleted = async (threadId: string): Promise<void> => {
    const wasActive = activeThreadIdRef.current === threadId
    hideAcceptedThreadDeletion(threadId)
    if (wasActive) {
      await desktopNavigation.replace({ kind: 'missions' }, { prepared: true })
    }
    void missionList.refresh()
  }
  const missionSource = (messageId: string): void => {
    setNotificationFocus({ requestId: ++notificationFocusSequence.current, kind: 'camp_message', threadTurnId: null, messageId, active: true })
  }
  async function createMission(draft: Omit<CreateThreadRequest, 'commandId' | 'activationState'>, _enableOneClick: boolean, definition?: {description: string; descriptionContent: MissionDescriptionContent; start: boolean; tags: string[]; attachments: MissionAttachmentDraft[]}): Promise<void> {
    if (!definition) throw new Error(uiAttribute('缺少使命定义'))
    const command: MissionCreate = { ...(draft.team ? { team: draft.team } : {}), title: draft.name ?? '', description: definition.description, descriptionContent: definition.descriptionContent, memberAgentIds: draft.memberAgentIds, defaultLeadAgentId: draft.defaultLeadAgentId, projectBindingKind: draft.workspace ? 'directory' : 'quick_chat', projectPath: draft.workspace?.projectPath ?? '', tags: definition.tags }
    const attachmentSignature = JSON.stringify(definition.attachments.map(({ id, file, kindHint }) => [id, file.name, file.size, file.lastModified, file.type, kindHint]))
    // Unknown transport outcomes retry the exact command. A different draft cannot
    // accidentally create a second Mission while the first result is unresolved.
    const pending = missionCreation.current
    if (pending && (JSON.stringify(pending.command) !== JSON.stringify(command) || pending.attachmentSignature !== attachmentSignature)) throw new Error(uiAttribute('上次创建结果尚未确认，请恢复原内容并重试。'))
    const request = pending ?? { id: newCommandId(), command, attachments: definition.attachments, attachmentSignature }
    missionCreation.current = request
    setBusy('create-mission')
    try {
      const result = request.attachments.length
        ? await (async () => {
            if (!client.missionAttachments) throw new Error(uiAttribute('当前环境不支持使命附件。'))
            const stored = await client.missionAttachments.create(request.id, request.command, request.attachments)
            if (stored.status === 'rejected') throw new MissionCommandRejected(stored)
            return stored
          })()
        : await missionCommand(client, 'missions.create', request.command, request.id)
      const threadId = stringField(result.payload, 'threadId'), missionId = stringField(result.payload, 'missionId')
      if (!threadId || !missionId) throw new Error(uiAttribute('使命已保存，但返回的标识不完整。请刷新使命板。'))
      missionCreation.current = null; setNewMissionOpen(false)
      if (definition.start) {
        try { await missionCommand(client, 'missions.start', { missionId }) }
        catch (error) { notifyError(uiAttribute("使命已保存，暂时未开始：{0}", String(missionError(error)))) }
      }
      await missionList.refresh()
    } catch (error) {
      if (error instanceof MissionCommandRejected) {
        missionCreation.current = null
        if (error.result.code.startsWith('team.')) void teamLibrary.refresh().catch(() => undefined)
      }
      throw error
    } finally { setBusy(null) }
  }

  const windowDragPage = windowDragStripPage(missionDrawer ? 'missions' : view)
  const visibleThreadSnapshot = campSnapshot && activeThreadId
    ? campSnapshotWithCurrentAnchor(campSnapshot, activeThreadId, notificationAnchor)
    : campSnapshot
  const firstRunThread = onboardingSnapshot?.status === 'completed'
    && onboardingSnapshot.origin === 'onboarding'
    && onboardingSnapshot.quickChatThreadId === activeThreadId
    && onboardingSnapshot.memberAgentId
    && onboardingSnapshot.selectedMemberRole
    ? {
        memberAgentId: onboardingSnapshot.memberAgentId,
        memberRole: onboardingSnapshot.selectedMemberRole
      }
    : null
  const pageContentClassName: Record<View, string> = {
    compose: 'task-content compose-content',
    'camp': 'task-content camp-content',
    members: 'members-content',
    teams: 'members-content',
    automations: 'automation-content',
    missions: 'mission-board-content',
    memory: 'memory-content',
    settings: 'settings-content'
  }
  const startupGateVisible = Boolean(desktop) && startupGateShouldBeVisible(startupSnapshot)
  const canShowThread = !startupGateVisible && view === 'camp'
    && (!missionThread || !!activeMission) && activeThreadId !== null
    && visibleThreadSnapshot?.thread.id === activeThreadId
  const formalThreadVisible = canShowThread && generalPreferences !== null && !campSnapshotEntryPreviewRef.current
    && !newConversationOpen && !newMissionOpen && !shuttingDown
  const interruptionAttention = useThreadInterruptionAttention(
    startupStatus === 'resolved',
    [...(displayNavigation ? allNavigationThreads(displayNavigation).map(thread => thread.id) : []),
      ...pinnedThreadItems.map(thread => thread.id), ...(activeThreadId ? [activeThreadId] : [])],
    { threadId: activeThreadId, visible: formalThreadVisible }
  )
  const shortcutsEnabled = startupStatus === 'resolved' && !shuttingDown
  useShortcutAction('new', beginNewConversation, shortcutsEnabled)
  useShortcutAction('settings', openSettings, shortcutsEnabled)
  useShortcutAction('missions', () => chooseView('missions'), shortcutsEnabled)
  useShortcutAction('automations', () => chooseView('automations'), shortcutsEnabled)

  const startupFeedbackVisible = startupFeedbackShouldBeVisible(startupStatus)
  const startupRoutePending = !startupGateVisible && startupStatus !== 'resolved'
    ? startupRouteTarget
    : null
  const startupLoadingVisible = startupStatus === 'loading' && startupFeedbackVisible && !shuttingDown
  const startupLoadingRoute = startupGateVisible
    ? 'location'
    : startupRoutePending?.kind ?? startupRouteTarget?.kind ?? 'location'
  const inlineNotices = (memoryCapability.active && (visibleMemoryReviewNotice || visibleMemoryAutoNotice.length > 0))
    || (!shuttingDown && (error || locationSaveError))
    ? (
        <>
          {memoryCapability.active && visibleMemoryReviewNotice && (
            <MemoryChangeNotice review onOpen={openMemoryReviews} onClose={() => setMemoryReviewNotice(null)}>
              {pendingMemoryCount > 0 ? uiAttribute('{0} 条共同记忆待审核', pendingMemoryCount) : uiAttribute('共同记忆审核已更新')}
            </MemoryChangeNotice>
          )}
          {memoryCapability.active && visibleMemoryAutoNotice.length > 0 && (
            <MemoryChangeNotice onOpen={openAutomaticMemory} onClose={() => setMemoryAutoNotice([])}>
              {memoryChangeText(visibleMemoryAutoNotice, agents.find((agent) => agent.agentId === visibleMemoryAutoNotice.at(-1)?.actorId)?.displayName)}
            </MemoryChangeNotice>
          )}
          {!shuttingDown && error && (
            <div className="error-banner" role="alert">
              <span className="error-icon" aria-hidden="true">!</span>
              <div><strong>{operationFailureTitle(error.operation)}</strong><span>{error.message}</span></div>
              <div className="error-actions">
                {error.operation === 'overview.read' && <button className="quiet-button" type="button" onClick={() => void loadOverview()}><UiText zh="刷新状态" /></button>}
                {error.retry && <button className="quiet-button" type="button" onClick={error.retry}><UiText zh="重试" /></button>}
                <button className="icon-button" type="button" aria-label={uiAttribute("关闭错误")} onClick={() => setError(null)}>×</button>
              </div>
            </div>
          )}
          {!shuttingDown && locationSaveError && (
            <div className="error-banner" role="alert">
              <span className="error-icon" aria-hidden="true">!</span>
              <div><strong><UiText zh={"当前页面已打开，但下次启动位置未保存"} /></strong><span>{locationSaveError}</span></div>
              <div className="error-actions">
                <button className="quiet-button" type="button" onClick={() => {
                  const location = pendingRestorableLocation.current
                  if (location) void commitRestorableLocation(location)
                }}><UiText zh={"重试保存"} /></button>
                <button className="icon-button" type="button" aria-label={uiAttribute("关闭启动位置保存错误")} onClick={() => setLocationSaveError(null)}>×</button>
              </div>
            </div>
          )}
        </>
      )
    : null

  if (desktop && onboardingSnapshot === null) {
    return (
      <>
        <StartupWorkspace
          snapshot={startupSnapshot}
          feedbackVisible={!shuttingDown}
          error={onboardingError || startupError}
          onRetry={retryStartup}
        />
      </>
    )
  }

  if (desktop && onboardingSnapshot?.status === 'in_progress') {
    return (
      <div className="app-shell onboarding-app-shell">
        <OnboardingFlow
          snapshot={onboardingSnapshot}
          appearance={appearance}
          health={health}
          installations={installations}
          runtimePhase={onboardingRuntimePhase}
          busy={onboardingBusy}
          error={onboardingError}
          onLanguageChange={(language) => {
            const request = ++onboardingLanguageRequest.current
            setOnboardingError(null)
            void changeInterfaceLanguage(uiPreferences.generalPreferences, language, setGeneralPreferences)
              .then(() => { if (request === onboardingLanguageRequest.current) setOnboardingError(null) })
              .catch(() => { if (request === onboardingLanguageRequest.current) setOnboardingError('语言偏好未能保存，请重试。') })
          }}
          onThemeChange={(preference) => void changeOnboardingTheme(preference)}
          onShowWelcome={() => void runOnboardingMutation(
            () => desktop.onboarding.showWelcome()
          )}
          onCompleteWelcome={() => void runOnboardingMutation(
            () => desktop.onboarding.completeWelcome()
          )}
          onSelectMember={(role) => void runOnboardingMutation(
            () => desktop.onboarding.selectMember(role)
          )}
          onShowMemberSelection={() => void runOnboardingMutation(
            () => desktop.onboarding.showMemberSelection()
          )}
          onCompleteMemberSelection={() => void runOnboardingMutation(
            () => desktop.onboarding.completeMemberSelection()
          )}
          onRefreshRuntime={() => void refreshOnboardingRuntime()}
          onOpenModelCatalog={async (runtimeKind, target) => {
            const catalog = await openRuntimeModelCatalog(runtimeKind, client.request, true, target)
            void loadInstallations().catch(() => undefined)
            return catalog
          }}
          onRuntimeSelectionChange={(selection: OnboardingRuntimeSelection | null) => {
            void runOnboardingMutation(
              () => desktop.onboarding.setRuntimeSelection(selection)
            )
          }}
          onDeferRuntime={() => void runOnboardingMutation(
            () => desktop.onboarding.deferRuntimeSetup()
          )}
          onComplete={() => void completeOnboarding()}
        />
      </div>
    )
  }

  const cachedNavigationRow = selectedThreadId ? campSnapshotCache.current.get(selectedThreadId)?.navigationRow : null
  const renderNavigation = (drawer = false): React.JSX.Element => <ThreadNavigation
    navigationId={drawer ? 'mobile-conversation-navigation' : 'global-navigation'}
    platform={client.platform}
    footer={sidebarFooter}
    view={view === 'memory' ? 'settings' : view === 'camp' && missionThread ? 'missions' : view}
    state={startupStatus === 'resolved' ? navigationState : 'loading'}
    navigation={displayNavigation}
    groupLimits={navigationGroupLimits}
    onGroupLimitChange={navigationRefreshCoordinator.resizeGroup}
    activeThreadId={selectedThreadId}
    activeRowReveal={activeRowReveal}
    canLocateActiveRow={!campSnapshotState.entryPreview && navigationPreferences !== null && (!drawer || mobileConversationDrawerOpen)}
    openedNavigationRow={openedNavigationRow?.id === selectedThreadId ? openedNavigationRow : cachedNavigationRow}
    firstRunThreadId={firstRunThreadId}
    openingThreadId={openingThreadId}
    currentProjectKey={currentProjectKey}
    shellOnlyProjectPath={shellOnlyCurrentProjectPath}
    creatingConversation={busy === 'create-camp'}
    pins={navigationPins}
    projectOrdering={orderedPreferences ? { registeredProjects: orderedPreferences.registeredProjects,
      pinnedProjectOrder: orderedPreferences.pinnedProjectOrder, move: moveProject } : undefined}
    pinnedThreadItems={pinnedThreadItems}
    pinReadIssue={pinReadIssue}
    onRetryPins={loadPins}
    threadReadStates={threadReadStates}
    onSetThreadUnread={setThreadUnread}
    onRevealProject={environment.revealProjectDirectory ? project => environment.revealProjectDirectory!(project.projectPath) : undefined}
    settingsSection={view === 'memory' ? 'memory' : settingsSection}
    updateSnapshot={appUpdates.snapshot}
    onNewConversation={() => { setMobileConversationDrawerOpen(false); beginNewConversation() }}
    onMembers={() => { setMobileConversationDrawerOpen(false); chooseView('members') }}
    onTeams={() => { setMobileConversationDrawerOpen(false); chooseView('teams') }}
    onAutomations={() => { setMobileConversationDrawerOpen(false); chooseView('automations') }}
    onMissions={() => { setMobileConversationDrawerOpen(false); chooseView('missions') }}
    unreadMissionCount={unreadMissionCount(missionList.missions)}
    onMemory={() => { setMobileConversationDrawerOpen(false); openMemoryReviews() }}
    pendingMemoryCount={pendingMemoryCount}
    onSettings={() => { setMobileConversationDrawerOpen(false); openSettings() }}
    onOpenUpdates={() => { setMobileConversationDrawerOpen(false); void openUpdateSettings() }}
    onSettingsSectionChange={chooseSettingsSection}
    onSettingsBack={closeSettings}
    onOpenProject={() => { setMobileConversationDrawerOpen(false); void openProject() }}
    onSelectProject={(project) => {
      // A cached visit already owns the page. Folding a group can change the
      // selected project while its Thread is still waiting for verification.
      const preview = verifyingPreview.current
      if (preview?.generation === campSelectionGeneration.current && campSnapshotEntryPreviewRef.current) {
        preview.projectChosen = true
      } else {
        cancelPendingThreadActivation()
      }
      chooseCurrentProject(
        project
          ? { kind: 'directory', projectPath: project.projectPath }
          : { kind: 'quick_chat' },
        project ? { name: project.name, projectPath: project.projectPath } : null
      )
    }}
    onCreateInProject={(project) => {
      setMobileConversationDrawerOpen(false)
      void requestMemberTransition(async () => {
        cancelPendingThreadActivation()
        await requestNewConversation(project
          ? { name: project.name, projectPath: project.projectPath }
          : null)
      })
    }}
    onThread={(target) => { setMobileConversationDrawerOpen(false); chooseThread(target) }}
    onSearchResult={openSearchResult}
    searchProjectPaths={missionSearchPaths}
    onExportThread={conversationExport.reader.open}
    onForkThread={thread => { void forkThread(thread.id) }}
    forkBusy={forkBusy}
    onTogglePin={toggleNavigationPin}
    onRemoveProject={removeNavigationProject}
    onRenameProject={renameProject}
    onThreadIdCopied={() => {
      setError(null)
    }}
    onArchive={async thread => { await changeArchive(thread.id, true, 'chat') }}
    onRename={renameThread}
    onDelete={deleteThread}
    onThreadUnavailable={(thread, message) => {
      notify(message)
      void navigationRefreshCoordinator.invalidate({ scope: 'group', threadId: thread.id })
        .catch(error => reportOperationFailure('navigation.read', error))
    }}
    onError={error => showOperationError('navigation.action', error)}
  />

  return (
    <ThreadInterruptionAttentionContext.Provider value={interruptionAttention}>
    <MobileLayoutProvider value={mobile}>
    <FilePreviewProvider api={environment.files} threadId={view === 'camp' ? activeThreadId : null} resolvedTheme={appearance.resolvedTheme}
      projectFilesEnabled={!!activeProjectPath}
      missionActivity={activeMission && view === 'camp' ? <MissionActivityDocument mission={activeMission} agents={agents} onSource={missionSource} onNotify={notify} onWorkspaceCleanupRequested={refreshMissionAfterWorkspaceCleanup}/> : null}>
    <ConversationExportDialog state={conversationExport.state} reader={conversationExport.reader} />
    <ThreadReferencePreviewProvider threadId={view === 'camp' ? activeThreadId : null} onOpen={async reference => {
      if (reference.kind === 'thread') await activateThread(reference.id, { reconcileDefaultLead: false })
      else {
        const mission = await client.request<MissionRecord | null>('missions.get', { missionId: reference.id })
        if (!mission) throw new Error('引用不可用')
        await openMission(mission)
      }
    }}>
    <MissionInteractionProvider missions={missionList.missions} projects={displayNavigation?.projects ?? []} agents={agents} installations={installations} onChanged={refreshMission} onWorkspaceCleaned={refreshMissionAfterWorkspaceCleanup} onDeleted={onMissionDeleted} onArchive={async mission => { await changeArchive(mission.threadId, true, 'mission') }} onOpen={mission => { void openMission(mission).catch(error => notifyError(missionError(error))) }} onError={notifyError}>
    <NavigationShell platform={client.platform} settings={view === 'settings' || view === 'memory'} navigation={desktopNavigation} nativeWindowControls={desktop?.windowControls} browser={!desktop} disabled={startupStatus !== 'resolved' || shuttingDown} className={view === 'camp' && !missionDrawer ? 'app-shell-camp' : ''} data-mobile-view={mobile ? view : undefined} data-mobile-settings-list={mobile && view === 'settings' && mobileSettingsList || undefined}>
      {!startupGateVisible && !shuttingDown && forkToast && <AppToast toast={forkToast}
        onClose={() => {
          if (forkToast.loading) dismissForkLoading()
          else setDismissedForkState(forkState)
        }} />}
      {!mobile && renderNavigation()}
      {!startupGateVisible && mobile && ['compose', 'members', 'teams', 'automations'].includes(view) && <MobilePageHeader
        title={({ compose:uiAttribute("新对话"), members:uiAttribute("队员"), teams:uiAttribute("团队"), automations:uiAttribute("定时任务") } as Record<string, string>)[view]}
        onOpenMenu={openMobileMenu} menuOpen={mobileConversationDrawerOpen} triggerRef={mobileConversationListButtonRef} />}
      {!startupGateVisible && view === 'camp' && !missionThread && <AppHeader
        threadTitle={activeThreadTitle ||uiAttribute("对话")}
        contextLabel={activeThreadContextLabel}
        thread={campSnapshot?.thread.id === activeThreadId ? campSnapshot : null}
        detailEntryHostRef={setThreadDetailEntryHost}
        onFocusApprovals={focusThreadApprovals}
        onOpenConversationList={mobile ? openMobileMenu : undefined}
        conversationListButtonRef={mobileConversationListButtonRef}
      />}
      {windowDragPage && <WindowDragStrip page={windowDragPage} />}

      <main ref={mobilePageRef} className={`content ${pageContentClassName[missionDrawer ? 'missions' : view]}${missionThread && view === 'camp' ? ' mission-active-content' : ''}`}>
        {startupGateVisible && startupStatus === 'waiting' && (
          <StartupGate
            waiting
            error={startupError}
            onRetry={retryStartup}
            onExportDiagnostics={desktop ? () => desktop.exportDiagnostics() : undefined}
          />
        )}
        {!startupGateVisible && view !== 'members' && view !== 'automations' && view !== 'memory' && inlineNotices}
        {!startupGateVisible && !shuttingDown && toast && (
          <AppToast toast={toast} onClose={() => setToast(current => current === toast ? null : current)} />
        )}

        {!startupGateVisible && !shuttingDown && view === 'camp' && threadRefreshToast && threadRefreshToast.threadId === activeThreadId && (
          <AppToast toast={threadRefreshToast.toast} onClose={() => setThreadRefreshToast(current => current === threadRefreshToast ? null : current)} />
        )}

        {!startupGateVisible && startupStatus === 'waiting' && startupRoutePending?.kind === 'camp' && view === 'camp' && (
          <StartupRouteLoading
            kind="camp"
            waiting
            error={startupError}
            onRetry={retryStartup}
            onExportDiagnostics={desktop ? () => desktop.exportDiagnostics() : undefined}
          />
        )}

        {!startupGateVisible && <MissionBoard missions={missionList.missions} projects={displayNavigation?.projects ?? []} loading={missionList.loading} error={missionList.error}
          hidden={view !== 'missions' && !missionDrawer} selectedId={missionDrawer ? activeMission?.missionId : undefined} onRefresh={missionList.refresh}
          onOpenMenu={openMobileMenu} menuOpen={mobileConversationDrawerOpen} menuTriggerRef={mobileConversationListButtonRef}
          onNew={() => { setNewMissionOpen(true) }} onOpen={mission => { void openMission(mission).catch(error => notifyError(missionError(error))) }}/>} 
        {!startupGateVisible && view === 'camp' && missionThread && !activeMission && <section className="mission-section-empty" role={missionList.error ? 'alert' : 'status'}><p>{missionList.error || (missionList.loading ? uiAttribute("正在读取使命…") : uiAttribute("此使命当前不可用。"))}</p>{!missionList.loading && <button className="quiet-button" onClick={missionList.refresh}><UiText zh={"重试"} /></button>}<button className="quiet-button" onClick={returnToMissions}><UiText zh={"返回使命板"} /></button></section>}
        {canShowThread && (!desktop || generalPreferences !== null) && (
          <MissionSurface key={activeThreadId} enabled={!!activeMission} full={!missionDrawer} onExpand={() => setMissionPresentation('full')} onClose={returnToMissions}>
          {activeMission && <MissionHeader mission={activeMission} drawer={missionDrawer} thread={visibleThreadSnapshot} projectName={activeThreadProject?.name ?? activeThreadContextLabel}
            openRequest={missionOpenRequest} onExpand={() => setMissionPresentation('full')} onFold={() => setMissionPresentation('drawer')}
            executionTakesPreviewPriority={generalPreferences?.executionConsoleAutoOpen
              && generalPreferences.executionConsolePlacement === 'right'
              && visibleThreadSnapshot.agentRuns.some((run) => run.status === 'running')}
            onClose={returnToMissions} onFocusApprovals={focusThreadApprovals} detailEntryHostRef={setThreadDetailEntryHost}/>}
          {generalPreferences === null
            ? <ThreadPreferencesFeedback failed={generalPreferencesReadFailed} retry={readGeneralPreferences} />
            : <ThreadWorkspace
            key={activeThreadId}
            missionBoard={activeMission ? <MissionIntro mission={activeMission} projects={displayNavigation?.projects ?? []}/> : null}
            previewTabsInPane={false}
            executionAutoOpen={generalPreferences.executionConsoleAutoOpen}
            suppressExecutionAutoOpen={missionDrawerSuppressesExecutionAutoOpen(
              missionDrawer,
              generalPreferences.executionConsolePlacement
            )}
            snapshot={visibleThreadSnapshot}
            navigationFindIntent={navigationFind?.threadId === activeThreadId ? navigationFind : null}
            onNavigationFindConsumed={consumeNavigationFind}
            userAnchorNavigation={userAnchorNavigationFor(activeThreadId)}
            memberCreation={memberCreationDrafts.has(activeThreadId)}
            initialComposerDraft={memberCreationDrafts.get(activeThreadId)?.draft ?? campSnapshotState.initialComposerDraft}
            onPendingDraftChange={updateMemberCreationDraft}
            onInitialComposerDraftConsumed={consumeInitialComposerDraft}
            openCoverage={campSnapshot?.thread.id === activeThreadId
              ? campSnapshot.openCoverage ?? null
              : null}
            messageHistory={campSnapshot?.thread.id === activeThreadId
              ? campSnapshot.openCoverage?.messages ?? null
              : null}
            onLoadEarlierMessages={loadEarlierThreadMessages}
            optimisticMessages={activeOptimisticMessages}
            imagePublications={imagePublications}
            projectName={activeThreadProject?.name ?? null}
            agents={agents}
            installations={installations}
            busy={busy === 'camp-message' || busy === 'change-default-lead' || busy === 'camp-membership' || busy?.startsWith('action-approval-') === true}
            onSend={sendThreadMessage}
            onReconcileDelivery={async deliveryId => {
              const result = await client.request<{ status: string }>('runtimeInputs.reconcile', { deliveryId })
              await refreshActiveThreadSnapshot(activeThreadId!)
              return result.status
            }}
            onWithdrawMessage={withdrawThreadMessage}
            onMessageMutation={refreshActiveThreadSnapshot}
            onForkMessage={message => { void forkThread(activeThreadId!, message.id) }}
            forkBusy={forkBusy}
            reeditStore={reeditStore}
            onPendingDraftPersisted={refreshPendingThreadNavigation}
            onPendingThreadLeave={settlePendingThreadOnLeave}
            onThreadLeaveGuardChange={registerThreadLeaveGuard}
            onChangeLead={changeDefaultLead}
            onAddMembers={addThreadMembers}
            onPreviewMemberRemoval={previewThreadMemberRemoval}
            onRemoveMember={removeThreadMember}
            onTasksChanged={() => refreshActiveThreadSnapshot(activeThreadId)}
            onResolveApproval={resolveActionApproval}
            onRespondInteraction={async (interaction, answer) => {
              const threadId = activeThreadId!
              const result = await client.request<import('@contracts').NativeInteractionResult>('nativeInteractions.respond', {
                commandId: newCommandId(), threadId,
                agentRunId: interaction.agentRunId, executionEpoch: interaction.executionEpoch,
                interactionId: interaction.id, answer
              })
              void refreshActiveThreadSnapshot(threadId).catch(() => undefined)
              return result
            }}
            cancellingTurnIds={activeCancellingTurnIds}
            cancellingRunIds={activeCancellingRunIds}
            confirmingRunIds={activeConfirmingRunIds}
            onCancelAgentRun={cancelAgentRun}
            stopping={activeThreadStopping}
            executionPlacement={mobile ? 'inspector' : generalPreferences.executionConsolePlacement}
            onExecutionPlacementChange={changeExecutionConsolePlacement}
            worldMapEnabled={!mobile && generalPreferences.worldMapEnabled}
            workspaceEntrySnapshotReady={!campSnapshotState.entryPreview}
            inspectorVisible={visibleThreadSnapshot.thread.activationState === 'active' && campInspectorVisible}
            inspectorTab={campInspectorTab}
            detailEntryHost={campDetailEntryHost}
            singleChatVisible={visibleThreadSnapshot.thread.activationState === 'active' && singleChatVisible}
            onOpenSingleChat={openSingleChat}
            onCloseSingleChat={() => setSingleChatThreadId(null)}
            onCloseInspector={() => setThreadInspectorThreadId(null)}
            onInspectorTabChange={setThreadInspectorTab}
            onOpenInspector={openThreadInspector}
            notificationFocus={notificationFocus}
            onNotificationFocusPresented={completeNotificationNavigation}
            singleChatTarget={singleChatNotificationTarget}
            onVisibleSingleChatSources={setVisibleSingleChatSources}
            onVisibleNotificationSources={setVisibleNotificationSources}
            runtimeRecovery={runtimeRecovery?.threadId === activeThreadId ? runtimeRecovery : null}
            firstRunThread={firstRunThread}
            firstRunThreadId={firstRunThreadId}
            onConfigureRuntime={configureMemberRuntime}
            onOpenMembers={() => chooseView('members')}
            onDismissRuntimeRecovery={() => setRuntimeRecovery(null)}
            onNotify={notify}
            onNotifyError={notifyError}
          />}
          </MissionSurface>
        )}

        {!startupGateVisible && view === 'compose' && (
          <QuickChatWorkspace
            agents={agents}
            firstRunThreadId={firstRunThreadId}
            recentThreads={visibleNavigation ? allNavigationThreads(visibleNavigation).slice(0, 5) : []}
            onOpenThread={chooseThread}
            onNewConversation={beginNewConversation}
            onOpenMembers={() => chooseView('members')}
            onOpenRuntimeSettings={() => {
              chooseSettingsSection('runtime')
              void navigateToSettings('runtime')
            }}
          />
        )}

        {!startupGateVisible && view === 'automations' && (
          <AutomationWorkspace
            agents={agents}
            projects={displayNavigation?.projects ?? []}
            defaultMemberId={campSnapshot?.thread.defaultLeadAgentId
              ?? agents.find((agent) => agent.presence === 'present')?.agentId
              ?? ''}
            topNotices={inlineNotices}
            onOpenThread={(threadId) => void activateThread(threadId, { reconcileDefaultLead: false })}
            onLeaveGuardChange={registerAutomationLeaveGuard}
          />
        )}

        {!startupGateVisible && view === 'memory' && (
          <MobileSettingsLayout pendingMemoryCount={pendingMemoryCount} overview={false} section="memory" appearance={appearance} menuOpen={mobileConversationDrawerOpen} triggerRef={mobileConversationListButtonRef} onOpenMenu={openMobileMenu} onBack={returnToMobileSettings} onSectionChange={chooseSettingsSection}>
          <MemoryLibrary
            agents={agents}
            topNotices={inlineNotices}
            refreshSignal={memoryRefreshKey}
            navigationTarget={memoryTarget}
            onNavigate={(target, mode) => {
              if (mode === 'push') void desktopNavigation.push(target)
              else if (displayedEntry.update(target)) setMemoryTarget(target)
            }}
            reviewDrawerSignal={memoryReviewDrawerSignal}
            onReviewDrawerSignalConsumed={() => setMemoryReviewDrawerSignal(0)}
            onPendingCountChange={setPendingMemoryCount}
            onReady={commitMemoryLocation}
            startupFeedbackVisible={startupRoutePending?.kind !== 'memory' || startupFeedbackVisible}
          />
          </MobileSettingsLayout>
        )}

        {!startupGateVisible && view === 'settings' && (
          <MobileSettingsLayout pendingMemoryCount={pendingMemoryCount} overview={mobileSettingsList} section={settingsSection} appearance={appearance}
            menuOpen={mobileConversationDrawerOpen} triggerRef={mobileConversationListButtonRef}
            onOpenMenu={openMobileMenu} onBack={returnToMobileSettings} onSectionChange={chooseSettingsSection}>
          <SettingsView
            teams={teamLibrary.teams}
            preferencesApi={uiPreferences.generalPreferences}
            nativeSettings={environment.desktop && { windowControls: environment.desktop.windowControls, windowClose: environment.desktop.windowClose }}
            remoteConnection={environment.desktop?.hostWeb ? <HostWebSettings portDraft={remotePort} onPortDraftChange={setRemotePort} api={environment.desktop.hostWeb} /> : remoteConnection}
            zoomManagedBy={environment.desktop ? 'desktop' : 'browser'}
            platform={client.platform}
            appearance={appearance}
            health={health}
            agents={agents}
            generalPreferences={generalPreferences}
            onGeneralPreferencesChange={setGeneralPreferences}
            installations={installations}
            busy={busy}
            section={settingsSection}
            archiveContent={settingsSection === 'archive' && <ArchiveSettings key={archiveSelection?.threadId}
              projectNames={projectNames} initialKind={archiveSelection?.kind} firstThreadId={archiveSelection?.threadId}
              onDeleted={threadId => { hideAcceptedThreadDeletion(threadId); void missionList.refresh() }}
              onRestored={item => showUnarchivedToast(item.threadId, item.missionId ? 'mission' : 'chat')}
              onNotify={notify} onError={notifyError} />}
            updates={appUpdates}
            serverUpdates={environment.serverUpdates}
            commonEnvironmentReturn={commonEnvironmentReturn ? {
              kind: commonEnvironmentReturn.kind, memberName: commonEnvironmentReturn.memberName,
              onBack: () => { void desktopNavigation.push({ kind: 'members', agentId: commonEnvironmentReturn.memberId, tab: 'runtime' }, { memberPrepared: true }) }
            } : undefined}
            onDiagnosticsNavigate={(section) => chooseSettingsSection(section)}
            onRuntimeLeaveGuardChange={registerRuntimeSettingsLeaveGuard}
            onReload={loadRuntime}
            runtimeReadIssue={runtimeReadIssue}
            appearanceReadIssue={appearanceReadIssue}
            onReadAppearance={readAppearance}
            onAppearanceChange={changeAppearancePreferences}
          />
          </MobileSettingsLayout>
        )}

        {!startupGateVisible && view === 'teams' && <TeamWorkspace teams={teamLibrary.teams} agents={agents} loading={teamLibrary.loading} loadError={teamLibrary.error}
          defaultTeamId={generalPreferences?.newConversationTeamId ?? null} customDefaults={generalPreferences?.newConversationDefaults ?? null}
          refresh={teamLibrary.refresh} onLeaveGuardChange={registerTeamLeaveGuard} onNewConversation={team => {
            openNewConversation(currentProjectWorkspace(displayNavigation, currentProject), null, generalPreferences, team)
          }}/>}
        {!startupGateVisible && (view === 'members' || commonEnvironmentReturn !== null) && (
          startupRoutePending?.kind === 'members'
            ? startupStatus === 'waiting'
              ? (
                <StartupRouteLoading
                  kind="members"
                  waiting
                  error={startupError}
                  onRetry={retryStartup}
                  onExportDiagnostics={desktop ? () => desktop.exportDiagnostics() : undefined}
                />
              )
              : null
            : (
                <div className="members-workspace" style={view !== 'members' ? { display: 'none' } : undefined}>
                  <MembersView
                    ref={membersViewRef}
                    onEditCommonEnvironment={(kind, member) => {
                      commonEnvironmentScroll.current = Array.from(document.querySelectorAll<HTMLElement>('.members-workspace, .members-workspace *')).filter(element => element.scrollTop !== 0 || element.scrollLeft !== 0).map(element => ({ element, top: element.scrollTop, left: element.scrollLeft }))
                      void desktopNavigation.push({ kind: 'settings', section: 'runtime' }, { memberPrepared: true, beforeCommit: () => setCommonEnvironmentReturn({ kind, memberId: member.agentId, memberName: member.displayName }) })
                    }}
                    agents={agents}
                    topNotices={<>
                      {inlineNotices}
                      {memberReadIssue && <ReadIssue message={memberReadIssue} retry={loadAgents} />}
                      {memberTab === 'runtime' && runtimeReadIssue && <ReadIssue message={runtimeReadIssue} retry={loadRuntime} />}
                    </>}
                    installations={installations}
                    runtimeAvailability={health?.runtimeAvailability ?? []}
                    hostPlatform={health?.hostPlatform ?? null}
                    runtimePlatformAdmission={health?.runtimePlatformAdmission ?? []}
                    runtimeDiscoveryPending={health === null || healthLoading}
                    selectedAgentId={selectedMemberId}
                    activeTab={memberTab}
                    runtimeFocusRequest={memberRuntimeFocusRequest}
                    onSelectedAgentChange={(agentId, tab) => {
                      void desktopNavigation.push({ kind: 'members', agentId, tab })
                    }}
                    onTabChange={(tab) => { void desktopNavigation.push({ kind: 'members', agentId: selectedMemberId, tab }) }}
                    onProfileCommitted={(profile) => setAgents((current) => (
                      current.some((agent) => agent.agentId === profile.agentId)
                        ? current.map((agent) => (
                            agent.agentId === profile.agentId && agent.version < profile.version
                              ? profile
                              : agent
                          ))
                        : [...current, profile]
                    ))}
                    onReload={loadMemberData}
                    onCreateWithAI={beginMemberCreation}
                    onOpenRuntimeSettings={() => {
                      chooseSettingsSection('runtime')
                      void navigateToSettings('runtime')
                    }}
                  />
                </div>
              )
        )}
      </main>

      {mobile && <MobileConversationDrawer open={mobileConversationDrawerOpen} onOpenChange={setMobileConversationDrawerOpen}
        triggerRef={mobileConversationListButtonRef} scrollPosition={mobileMenuScroll}>
        {renderNavigation(true)}
      </MobileConversationDrawer>}

      <NewConversationDialog
        open={newConversationOpen}
        initialWorkspace={newConversationInitialWorkspace}
        initialSelection={newConversationInitialSelection}
        teams={teamLibrary.teams}
        teamsLoading={teamLibrary.loading}
        teamsError={teamLibrary.error}
        onRetryTeams={() => { void teamLibrary.refresh().catch(() => undefined) }}
        initialTeamId={newConversationInitialTeamId}
        initialTeam={newConversationInitialTeam}
        attentionMessage={newConversationAttention}
        projects={displayNavigation?.projects ?? []}
        preflight={campCreationPreflight}
        agents={agents}
        busy={busy === 'create-camp' || busy === 'open-project'}
        projectAccessReady={removedProjectAuthorityReady}
        onOpenChange={setNewConversationOpen}
        onChooseWorkspaceDirectory={chooseWorkspaceDirectory}
        onWorkspaceSelected={(workspace) => restoreNavigationProject(workspace.projectPath)}
        onCreate={(draft, enableOneClick) => createThread({
          ...draft,
          activationState: campActivationStateForCreation('dialog')
        }, enableOneClick)}
      />
      <NewConversationDialog purpose="mission" open={newMissionOpen} recovery={missionCreation.current?.command ?? null} recoveryAttachments={missionCreation.current?.attachments ?? []}
        initialWorkspace={currentProjectWorkspace(displayNavigation, currentProject)}
        initialSelection={generalPreferences?.newConversationDefaults ?? null}
        initialTeamId={generalPreferences?.newConversationTeamId ?? null}
        teams={teamLibrary.teams} teamsLoading={teamLibrary.loading} teamsError={teamLibrary.error}
        onRetryTeams={() => { void teamLibrary.refresh().catch(() => undefined) }}
        projects={displayNavigation?.projects ?? []} missionTagCatalog={[...new Set(missionList.missions.flatMap(mission => mission.tags))]} preflight={campCreationPreflight} agents={agents} installations={installations}
        busy={busy === 'create-mission'} projectAccessReady={removedProjectAuthorityReady}
        onOpenChange={open => { if (!busy) setNewMissionOpen(open) }}
        onChooseWorkspaceDirectory={chooseWorkspaceDirectory} onWorkspaceSelected={workspace => restoreNavigationProject(workspace.projectPath)}
        onCreate={createMission}/>
      <NotificationAttentionController
        enabled={startupStatus === 'resolved'}
        activeThreadId={activeThreadId}
        firstRunThreadId={firstRunThreadId}
        activeThreadVisible={formalThreadVisible}
        navigationActive={notificationFocus !== null}
        onNavigate={navigateFromNotification}
        onPresentNavigation={presentNotificationNavigation}
        onCancelNavigation={cancelNotificationNavigation}
        onRefreshVisibleThread={refreshVisibleNotificationThread}
        onError={notify}
        singleChatSources={singleChatVisible ? visibleSingleChatSources : null}
        visibleSources={visibleNotificationSources}
        onHeadsUpVisibleChange={setNotificationHeadsUpVisible}
      />
      {desktop && <AppUpdatePrompt
        snapshot={appUpdates.snapshot}
        campComposerVisible={view === 'camp'}
        blocked={notificationHeadsUpVisible
          || newConversationOpen
          || shuttingDown
          || (view === 'settings' && settingsSection === 'about')}
        onDismiss={appUpdates.dismissPrompt}
        onOpenDetails={openUpdateSettings}
        onDownload={appUpdates.download}
      />}
    </NavigationShell>
    {startupStatus !== 'waiting' && <StartupLoadingCanvas visible={startupLoadingVisible} route={startupLoadingRoute} />}
    </MissionInteractionProvider>
    </ThreadReferencePreviewProvider>
    </FilePreviewProvider>
    </MobileLayoutProvider>
    </ThreadInterruptionAttentionContext.Provider>
  )
}

export function WindowDragStrip({
  page
}: {
  page: WindowDragStripPage
}): React.JSX.Element {
  return <div className={`window-drag-strip window-drag-strip-${page}`} aria-hidden="true" />
}

function StartupRecoveryActions({ onRetry, onExportDiagnostics }: {
  onRetry(): void
  onExportDiagnostics?: () => Promise<unknown>
}): React.JSX.Element {
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(false)
  const exportDiagnostics = async (): Promise<void> => {
    setExporting(true)
    setExportError(false)
    try { await onExportDiagnostics?.() }
    catch { setExportError(true) }
    finally { setExporting(false) }
  }
  return <div className="startup-route-actions">
    <button className="primary-button" type="button" onClick={onRetry}><UiText zh={"重新打开"} /></button>
    {onExportDiagnostics && <button className="quiet-button" type="button" disabled={exporting} aria-busy={exporting} onClick={() => void exportDiagnostics()}>
      <BusyLabel busy={exporting}>{uiAttribute("导出诊断")}</BusyLabel>
    </button>}
    {exportError && <p role="alert"><UiText zh={"暂时无法导出诊断，请重试。"} /></p>}
  </div>
}

function StartupRecoverySurface({
  route,
  headingLevel,
  onRetry,
  onExportDiagnostics
}: {
  route: string
  headingLevel: 1 | 2
  onRetry(): void
  onExportDiagnostics?: () => Promise<unknown>
}): React.JSX.Element {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [])

  const title = headingLevel === 1
    ? <h1 id="startup-recovery-title" ref={headingRef} tabIndex={-1}><UiText zh={"暂时无法打开会话"} /></h1>
    : <h2 id="startup-recovery-title" ref={headingRef} tabIndex={-1}><UiText zh={"暂时无法打开会话"} /></h2>

  return (
    <section
      className="startup-recovery-canvas"
      data-startup-route={route}
      data-startup-status="waiting"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="startup-recovery-title"
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return
        const actions = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
        if (!actions.length) return
        const first = actions[0]
        const last = actions.at(-1)!
        if (event.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current)) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }}
    >
      <div className="startup-recovery-content">
        {title}
        <StartupRecoveryActions onRetry={onRetry} onExportDiagnostics={onExportDiagnostics} />
      </div>
    </section>
  )
}

export function StartupGate({
  waiting,
  onRetry,
  onExportDiagnostics
}: {
  waiting: boolean
  error: string | null
  onRetry(): void
  onExportDiagnostics?: () => Promise<unknown>
}): React.JSX.Element {
  if (!waiting) return <StartupLoadingCanvas visible route="location" />
  return <StartupRecoverySurface route="location" headingLevel={1} onRetry={onRetry} onExportDiagnostics={onExportDiagnostics} />
}

export function StartupRouteLoading({
  kind,
  waiting,
  onRetry,
  onExportDiagnostics
}: {
  kind: RestorableLocation['kind']
  waiting: boolean
  error: string | null
  onRetry(): void
  onExportDiagnostics?: () => Promise<unknown>
}): React.JSX.Element {
  if (!waiting) return <StartupLoadingCanvas visible route={kind} />
  return <StartupRecoverySurface route={kind} headingLevel={2} onRetry={onRetry} onExportDiagnostics={onExportDiagnostics} />
}


function ThreadPreferencesFeedback({ failed, retry }: { failed: boolean; retry(): Promise<void> }): React.JSX.Element {
  const [retrying, setRetrying] = useState(false)
  const inFlight = useRef(false)

  const retryPreferences = (): void => {
    if (inFlight.current) return
    inFlight.current = true
    setRetrying(true)
    void retry().finally(() => {
      inFlight.current = false
      setRetrying(false)
    })
  }

  return <section className="thread-preferences-feedback">
    {failed
      ? <p role="alert"><UiText zh={"会话设置暂时无法读取。"} /></p>
      : <p role="status"><UiText zh={"正在读取会话设置…"} /></p>}
    {failed && <button className="quiet-button" type="button" aria-disabled={retrying || undefined} aria-busy={retrying} onClick={retryPreferences}>
      <BusyLabel busy={retrying}><UiText zh={'重试'} /></BusyLabel>
    </button>}
  </section>
}

function ReadIssue({ message, retry }: { message: string; retry(): Promise<unknown> }): React.JSX.Element {
  return <div className="inline-error" role="alert">
    <span>{message}</span>
    <button className="quiet-button compact" type="button" onClick={() => void retry().catch(() => undefined)}><UiText zh="重试" /></button>
  </div>
}

export function SettingsView({
  teams = [],
  preferencesApi,
  remoteConnection,
  nativeSettings,
  zoomManagedBy = 'desktop',
  platform = 'darwin',
  appearance,
  health,
  agents,
  generalPreferences,
  onGeneralPreferencesChange,
  installations,
  busy,
  section,
  archiveContent,
  updates,
  serverUpdates,
  onDiagnosticsNavigate,
  commonEnvironmentReturn,
  onRuntimeLeaveGuardChange,
  onReload,
  runtimeReadIssue,
  appearanceReadIssue,
  onReadAppearance,
  onAppearanceChange
}: {
  teams?: Team[]
  remoteConnection?: React.ReactNode
  preferencesApi: import('@contracts').GeneralPreferencesApi
  nativeSettings?: { windowControls: import('@contracts').WindowControlsApi; windowClose?: import('@contracts').WindowCloseApi; browserAccess?: React.ReactNode }
  zoomManagedBy?: 'desktop' | 'browser'
  platform?: NodeJS.Platform
  appearance: AppearanceSnapshot
  health: RuntimeStatus | null
  agents: AgentProfile[]
  generalPreferences?: GeneralPreferencesSnapshot | null
  onGeneralPreferencesChange?(preferences: GeneralPreferencesSnapshot): void
  installations: AdapterInstallation[]
  busy: string | null
  section: SettingsSection
  archiveContent?: React.ReactNode
  updates: AppUpdatesController
  serverUpdates?: import('@contracts').AppUpdatesApi
  commonEnvironmentReturn?: { kind: AdapterKind; memberName: string; onBack(): void }
  onRuntimeLeaveGuardChange?(guard: RuntimeStartupLeaveGuard | null): void
  onDiagnosticsNavigate(section: 'mcp' | 'runtime', runtimeKind?: AdapterKind): void
  onReload(): Promise<void>
  runtimeReadIssue?: string | null
  appearanceReadIssue?: string | null
  onReadAppearance?(): Promise<void>
  onAppearanceChange(preferences: AppearancePreferences): Promise<AppearanceSnapshot>
}): React.JSX.Element {
  return (
    <div className="settings-workbench">
      <div className={`settings-panel settings-panel-${section}${section === 'shortcuts' ? ' settings-panel-general' : ''}`}>
        {section === 'remote' && remoteConnection}
        {section === 'general' && (
          <GeneralSettings
            api={preferencesApi}
            teams={teams}
            windowControls={nativeSettings?.windowControls}
            windowClose={platform === 'win32' ? nativeSettings?.windowClose : undefined}
            browserAccess={nativeSettings?.browserAccess}
            agents={agents}
            initialPreferences={generalPreferences}
            onPreferencesChange={onGeneralPreferencesChange}
          />
        )}
        <Activity mode={section === 'skills' ? 'visible' : 'hidden'}><NativeSkillsSettings health={health} /></Activity>
        <Activity mode={section === 'toolbox' ? 'visible' : 'hidden'}><ToolboxSettings agents={agents} /></Activity>
        <Activity mode={section === 'mcp' ? 'visible' : 'hidden'}><McpSettings agents={agents} platform={platform} /></Activity>
        {section === 'runtime' && runtimeReadIssue && <ReadIssue message={runtimeReadIssue} retry={onReload} />}
        <RuntimeInstallationsPanel health={health} installations={installations} onReload={onReload} commonEnvironmentReturn={commonEnvironmentReturn}
          active={section === 'runtime'} onLeaveGuardChange={onRuntimeLeaveGuardChange} />
        {section === 'channels' && <ChannelSettings agents={agents} />}
        {section === 'appearance' && appearanceReadIssue && onReadAppearance && <ReadIssue message={appearanceReadIssue} retry={onReadAppearance} />}
        {section === 'appearance' && (
          <AppearanceSettings
            zoomManagedBy={zoomManagedBy}
            appearance={appearance}
            platform={platform}
            disabled={busy === 'appearance'}
            onChange={onAppearanceChange}
          />
        )}
        {section === 'shortcuts' && <ShortcutSettings />}
        {section === 'notifications' && (
          <NotificationSettings />
        )}
        {section === 'archive' && archiveContent}
        {section === 'monitoring' && (
          <RuntimeMonitoring platform={platform} health={health} />
        )}
        {section === 'diagnostics' && (
          <DiagnosticsCenter onNavigate={onDiagnosticsNavigate} platform={platform} />
        )}
        {section === 'about' && (
          zoomManagedBy === 'browser' ? <RemoteAboutSettings updatesApi={serverUpdates} /> : <AboutUpdatesSettings updates={updates} />
        )}
      </div>
    </div>
  )
}

export function campSnapshotWithAnchoredMessages(
  snapshot: ThreadSnapshot,
  anchoredMessages: readonly ThreadMessageView[]
): ThreadSnapshot {
  if (anchoredMessages.length === 0) return snapshot
  const messagesById = new Map(snapshot.messages.map((message) => [message.id, message]))
  for (const message of anchoredMessages) {
    if (!messagesById.has(message.id)) messagesById.set(message.id, message)
  }
  return {
    ...snapshot,
    messages: [...messagesById.values()].sort((left, right) =>
      left.sequence - right.sequence || left.id.localeCompare(right.id)
    )
  }
}

export function campSnapshotWithAnchoredAgentRuns(
  snapshot: ThreadSnapshot,
  anchoredAgentRuns: readonly AgentRunView[]
): ThreadSnapshot {
  if (anchoredAgentRuns.length === 0) return snapshot
  const runsById = new Map(snapshot.agentRuns.map((run) => [run.id, run]))
  for (const run of anchoredAgentRuns) {
    if (!runsById.has(run.id)) runsById.set(run.id, run)
  }
  return { ...snapshot, agentRuns: [...runsById.values()] }
}

export function campSnapshotWithCurrentAnchor(
  snapshot: ThreadSnapshot,
  threadId: string,
  anchor: {
    threadId: string
    messages?: readonly ThreadMessageView[]
    agentRuns?: readonly AgentRunView[]
    tasks?: readonly import('@contracts').TaskView[]
  } | null
): ThreadSnapshot {
  if (anchor?.threadId !== threadId) return snapshot
  let withTasks = snapshot
  if (snapshot.tasksEnabled && anchor.tasks?.length) {
    const tasks = new Map((snapshot.tasks ?? []).map(task => [task.taskId, task]))
    for (const task of anchor.tasks) {
      if (!tasks.has(task.taskId)) tasks.set(task.taskId, task)
    }
    withTasks = { ...snapshot, tasks: [...tasks.values()] }
  }
  return campSnapshotWithAnchoredAgentRuns(
    campSnapshotWithAnchoredMessages(withTasks, anchor.messages ?? []),
    anchor.agentRuns ?? []
  )
}

export function rectanglesIntersect(
  target: Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left'>,
  viewport: Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left'>
): boolean {
  return target.bottom > viewport.top
    && target.top < viewport.bottom
    && target.right > viewport.left
    && target.left < viewport.right
}

export function notificationMessageIsVisible(messageId: string): boolean {
  if (document.visibilityState !== 'visible' || !document.hasFocus()) return false
  const target = document.querySelector<HTMLElement>(
    `[data-message-id="${CSS.escape(messageId)}"]`
  )
  const viewport = target?.closest<HTMLElement>('.timeline-scroll') ?? null
  if (!target || !viewport) return false
  return rectanglesIntersect(target.getBoundingClientRect(), viewport.getBoundingClientRect())
}

export async function resolveNotificationAgentRun(
  client: Pick<RovaiApi, 'request'>,
  threadId: string,
  agentRunId: string,
  availableSnapshot: ThreadSnapshot | null
): Promise<AgentRunView | null> {
  const cachedRun = availableSnapshot?.thread.id === threadId
    ? availableSnapshot.agentRuns.find(({ id }) => id === agentRunId)
    : null
  if (cachedRun) return cachedRun
  const snapshot = await client.request<ThreadSnapshot>('threads.snapshot', { threadId })
  if ((snapshot.schemaVersion !== THREAD_SNAPSHOT_SCHEMA_VERSION && snapshot.schemaVersion !== 36) || snapshot.thread.id !== threadId) {
    throw new Error(uiAttribute('执行定位合同不兼容。'))
  }
  return snapshot.agentRuns.find(({ id }) => id === agentRunId) ?? null
}

export function notificationFocusMatchesAction(
  focus: NotificationFocusTarget,
  action: NotificationActionView
): boolean {
  if (focus.kind === 'mission' || focus.kind === 'task') {
    return action.kind === (focus.kind === 'mission' ? 'open_mission' : 'open_task')
      && focus.subjectId === action.subject?.id && focus.kind === action.subject?.kind
  }
  if (focus.kind === 'single_chat') {
    return (action.kind === 'open_single_chat' || action.kind === 'open_native_interaction')
      && (focus.interactionId ?? null) === (action.interactionId ?? null)
      && focus.conversationId === action.singleChat?.conversationId
      && focus.agentRunId === action.singleChat?.agentRunId
      && (focus.approvalId ?? null) === action.approvalId
  }
  if (focus.kind === 'camp_message') {
    return action.kind === 'open_camp_message'
      && Boolean(focus.messageId)
      && focus.messageId === action.messageId
  }
  if (focus.kind === 'camp_turn') {
    return action.kind === 'open_camp_turn'
      && Boolean(focus.threadTurnId)
      && focus.threadTurnId === action.threadTurnId
  }
  if (focus.kind === 'agent_run') {
    return action.kind === 'open_agent_run'
      && Boolean(focus.agentRunId)
      && focus.agentRunId === action.agentRunId
  }
  if (focus.kind === 'native_interaction') return action.kind === 'open_native_interaction'
    && Boolean(focus.interactionId) && focus.interactionId === action.interactionId
  return action.kind === 'open_approval'
    && (focus.approvalId ?? null) === (action.approvalId ?? null)
}

async function resolveNavigationPins(
  navigation: NavigationSnapshot,
  pins: NavigationPin[],
  client: Pick<RovaiApi, 'request'>
): Promise<{ pins: NavigationPin[]; threads: NavigationThreadItem[] }> {
  const pinnedThreadIds = new Set(
    pins.filter((pin) => pin.kind === 'camp').map((pin) => pin.targetKey)
  )
  const campById = new Map(
    allNavigationThreads(navigation)
      .filter((thread) => pinnedThreadIds.has(thread.id))
      .map((thread) => [thread.id, thread])
  )
  const unresolvedThreadIds = new Set(
    [...pinnedThreadIds].filter((threadId) => !campById.has(threadId))
  )

  if (unresolvedThreadIds.size > 0) {
    const rows = await client.request<NavigationThreadRows>('navigation.threads', { threadIds: [...unresolvedThreadIds] })
    for (const thread of rows.threads) campById.set(thread.id, thread)
  }

  const validProjectKeys = new Set(navigation.projects.map((project) => project.projectKey))
  const validPins = pins.filter((pin) =>
    pin.kind === 'camp'
      ? campById.has(pin.targetKey)
      : validProjectKeys.has(pin.targetKey)
  )
  return {
    pins: validPins,
    threads: validPins
      .filter((pin) => pin.kind === 'camp')
      .flatMap((pin) => campById.get(pin.targetKey) ?? [])
  }
}

export function optimisticThreadMessage(
  snapshot: ThreadSnapshot | null,
  commandId: string,
  draft: ThreadComposerDraftView,
  createdAt = new Date().toISOString()
): ThreadMessageView {
  const defaultLeadId = snapshot?.members.find((member) => member.isDefaultLead)?.agentId
  const explicitlyMentionedIds = [...new Set(draft.content.segments.flatMap((segment) =>
    segment.kind === 'atom' && segment.atom.type === 'member'
      ? [segment.atom.agentId]
      : []
  ))]
  const broadcast = draft.content.segments.some((segment) =>
    segment.kind === 'atom' && segment.atom.type === 'all_members'
  )
  const addressedAgentIds = broadcast
    ? snapshot?.members
        .filter((member) => member.membershipStatus === 'active' && member.profilePresence === 'present')
        .map((member) => member.agentId) ?? []
    : explicitlyMentionedIds.length > 0
      ? explicitlyMentionedIds
      : defaultLeadId ? [defaultLeadId] : []
  const sequence = Math.max(0, ...(snapshot?.messages.map((message) => message.sequence) ?? [])) + 1
  return {
    id: `optimistic:${commandId}`,
    sequence,
    timelineGlobalSequence: null,
    authorType: 'user',
    authorId: 'local_user',
    sourceAgentRunId: null,
    quotes: draft.quotes,
    body: draft.body,
    content: composerDocumentToStructuredContent({ ...draft.content, segments: draft.content.segments.map(segment => segment.kind === 'atom' && segment.atom.type === 'project_file_reference' ? { kind: 'text', text: segment.atom.labelFallback } : segment) }),
    attachments: draft.attachments,
    addressMode: broadcast ? 'broadcast' : explicitlyMentionedIds.length > 0 ? 'explicit' : 'default',
    addressedAgentIds,
    replyToThreadMessageId: draft.replyIntent?.replyToThreadMessageId ?? null,
    threadTurnId: null,
    presentation: null,
    createdAt,
    withdrawn: false,
    canWithdraw: false,
    version: 1
  }
}

export function campMessageSendParams(
  commandId: string,
  threadId: string,
  draft: ThreadComposerDraftView
): {
  commandId: string
  threadId: string
  content: ThreadComposerDraftView['content']
  sourceAttachments: Array<{
    id: string
    sourcePath: string
    displayName: string
    kind: 'file' | 'directory'
    mediaType: string | null
    observedByteSize: number | null
    pastedTextPreview?: string
  }>
  quotes: ThreadComposerDraftView['quotes']
  replyToThreadMessageId: string | null
  execution: {
    taskId: null
    purpose: string
    completionRole: 'required'
  }
} {
  const sourceAttachments = draft.attachments.map((attachment) => {
    if (!attachment.sourcePath) throw new Error(uiAttribute('本地附件来源已不可用，请移除后重新添加。'))
    return {
      id: attachment.id,
      sourcePath: attachment.sourcePath,
      displayName: attachment.displayName,
      kind: attachment.kind,
      mediaType: attachment.mediaType,
      observedByteSize: attachment.byteSize,
      ...(attachment.pastedTextPreview !== undefined ? { pastedTextPreview: attachment.pastedTextPreview } : {})
    }
  })
  return {
    commandId,
    threadId,
    content: draft.content,
    sourceAttachments,
    quotes: draft.quotes,
    replyToThreadMessageId: draft.replyIntent?.replyToThreadMessageId ?? null,
    execution: {
      taskId: null,
      purpose: campMessageExecutionPurpose(draft),
      completionRole: 'required'
    }
  }
}

export function campMessageExecutionPurpose(draft: ThreadComposerDraftView): string {
  return draft.body.trim() || 'Thread attachment-only message'
}

export function campCreationPreflightFromAgents(
  agents: AgentProfile[]
): ThreadCreationPreflight {
  const presentMembers = agents
    .filter((agent) => agent.presence === 'present')
    .sort((left, right) => left.memberOrder - right.memberOrder || left.agentId.localeCompare(right.agentId))
    .map((agent) => ({
      agentId: agent.agentId,
      displayName: agent.displayName,
      memberOrder: agent.memberOrder,
      runtimeConfigured: agent.runtimeConfiguration !== null,
      runtimeReadiness: agent.runtimeReadiness.status
    }))
  const initialLeadAgentId = presentMembers
    .find((member) => member.runtimeReadiness === 'ready')
    ?.agentId ?? presentMembers
    .find((member) => member.runtimeReadiness === 'light_ready' || member.runtimeReadiness === 'installed_unverified')
    ?.agentId ?? presentMembers[0]?.agentId ?? null
  const blockers: ThreadCreationPreflight['blockers'] = presentMembers.length === 0
    ? [{ code: 'no_present_members', detail:uiAttribute("当前没有在队的队员。") }]
    : []
  return {
    admissible: blockers.length === 0,
    presentMembers,
    initialLeadAgentId,
    blockers
  }
}

export function commandFailureMessage(result: StoredCommandResult): string {
  return sharedRejectionMessage(result.code)
    ?? localizeExecutionEngineTerms(stringField(result.payload, 'message') ?? uiAttribute("操作未完成：{0}", String(result.code)))
}

function membershipConflictCode(code: string): boolean {
  return code === 'camp.membership_generation_conflict'
    || code === 'camp.membership_version_conflict'
    || code === 'camp.member_not_found'
    || code === 'camp.member_not_active'
}

export function runtimeRecoveryFromCommandResult(
  threadId: string,
  result: StoredCommandResult
): ThreadRuntimeRecovery | null {
  if (result.status !== 'rejected' || result.code !== 'agent_run.runtime_not_ready') return null
  const agentId = stringField(result.payload, 'agentId')
  const blockerCode = stringField(result.payload, 'blockerCode')
  if (!agentId || !blockerCode) return null
  return {
    threadId,
    targets: [{ agentId, blockerCode }]
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function stringField(value: Record<string, unknown>, key: string): string | null {
  return typeof value[key] === 'string' ? value[key] as string : null
}

function stringArrayField(value: Record<string, unknown>, key: string): string[] {
  return Array.isArray(value[key])
    ? value[key].filter((entry): entry is string => typeof entry === 'string')
    : []
}

export function errorMessage(error: unknown): string {
  return localizeExecutionEngineTerms(readErrorMessage(error))
}

function afterNextPaint(timeoutMs = 250): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      resolve()
    }
    const timeout = window.setTimeout(finish, timeoutMs)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(finish)
    })
  })
}
