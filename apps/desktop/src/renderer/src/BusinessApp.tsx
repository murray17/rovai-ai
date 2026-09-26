import { newCommandId } from '../../shared/command-id'
import type { BusinessEnvironment } from './business-environment'
import { AppHeader } from './AppHeader'
import { MobileLayoutProvider, MobilePageHeader, useMobilePageTransition, useMobileViewport } from './MobileLayout'
import { MobileSettingsLayout } from './MobileSettingsLayout'
export { AppHeader } from './AppHeader'
import { CurrentUserProfileProvider } from './CurrentUserProfile'
import { readErrorMessage } from './error-message'
import { CoreSubsystemNotice } from './CoreSubsystemNotice'
import { Activity, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type {
  AdapterInstallation,
  AdapterKind,
  AgentProfile,
  AgentRunView,
  ActionApprovalView,
  AppUpdatePrompt as AppUpdatePromptValue,
  AppearancePreferences,
  AppearanceSnapshot,
  CampActivationState,
  CampCreationPreflight,
  CampComposerDraftView,
  CampDeletionIssue,
  CampMessagePage,
  CampMessageAroundSnapshot,
  CampMessageView,
  CampMemberRemovalPreview,
  CampOpenProjection,
  CampSnapshot,
  CreateCampRequest,
  CoreEvent,
  DesktopStartupSnapshot,
  EventBatch,
  ExecutionConsolePlacement,
  GeneralPreferencesSnapshot,
  HealthStatus,
  NotificationActionView,
  NotificationEpisodeView,
  OnboardingRuntimeSelection,
  OnboardingSnapshot,
  MissionAttachmentDraft,
  MissionRecord,
  MissionCreate,
  NavigationCampItem,
  NavigationCampTarget,
  NavigationCampRows,
  CampViewedAcknowledgement,
  NavigationPin,
  NavigationPreferencesSnapshot,
  NavigationSnapshot,
  ProjectNavigationGroup,
  RestorableLocation,
  RovaiApi,
  HearthReviewItem,
  SendCampMessageResult,
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
import {
  CampWorkspace,
  QuickChatWorkspace,
  composerHasSendablePayload,
  type CampMessageSendReceipt,
  type CampLeaveGuard,
  type CampLeavePreparation,
  type CampMemberAddOutcome,
  type CampMemberRemoveOutcome,
  type CampInspectorTab,
  type CampRuntimeRecovery,
  type NotificationFocusTarget,
  type VisibleNotificationSources
} from './CampWorkspace'
import { composerDocumentToStructuredContent } from './composer-document'
import { clearLocalCampComposerDraft } from './camp-composer-local-store'
import {
  CampNavigation,
  type NavigationSettingsSection
} from './CampNavigation'
import { NewConversationDialog } from './NewConversationDialog'
import { MissionBoard, MissionInteractionProvider, MissionIntro } from './MissionBoard'
import { MissionActivityDocument } from './MissionDelivery'
import { MissionCommandRejected, missionCommand, missionError, unreadMissionCount, useMissions } from './useMissions'
import './mission.css'
import { openRuntimeModelCatalog } from './runtime-check'
import { MissionSurface } from './MissionSurface'
import { MissionHeader } from './MissionHeader'
import { FilePreviewProvider } from './FilePreviewContext'
import { NavigationShell } from './NavigationShell'
import { StartupLoadingCanvas } from './StartupLoadingCanvas'
import { createDesktopNavigation, type NavigationTarget, type NavigationTransaction, type NavigationIntent, type MemoryNavigationTarget } from './desktop-navigation'
import { forgetFilePreviewSession } from './file-preview-session'
import { AppearanceSettings } from './AppearanceSettings'
import { AboutUpdatesSettings } from './AboutUpdatesSettings'
import { RemoteAboutSettings } from './RemoteAboutSettings'
import { AppUpdatePrompt } from './AppUpdatePrompt'
import { useAppUpdates, type AppUpdatesController } from './useAppUpdates'
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
import { formatCampTitle } from './camp-title'
import {
  applyAppearanceSnapshot,
  initialAppearanceSnapshot
} from './theme'
import {
  allNavigationCamps,
  liveRuntimeEventFromCore,
  type LiveRuntimeEvent
} from './ui-model'
import { restoredMemberId, startupTargetFromSnapshot } from './startup-location'
import {
  OnboardingFlow,
  type OnboardingRuntimePhase
} from './OnboardingFlow'
import { provisionFirstRun } from './onboarding-provisioning'
import {
  currentProjectAccessDecision,
  currentProjectForCamp,
  currentProjectGroup,
  currentProjectWorkspace,
  navigationIncludingCurrentWorkspace,
  navigationWithProjectAuthority,
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
import { appendLiveRuntimeEventBatch, createLiveRuntimeEventBuffer } from './live-runtime-event-buffer'

export { allNavigationCamps }

const ACTIVE_CAMP_INVALIDATION_EVENTS = new Set([
  'camp.member.fast.updated',
  'camp.member_added',
  'camp.member_removed',
  'camp.membership_reconciliation_started',
  'camp.membership_reconciliation_completed',
  'camp.default_lead_reconciled',
  'agent_run.cancelled',
  'agent_run.recovery_blocker_resolved',
  'agent_run.runtime_model_observed',
  'agent_run.terminal',
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

export function shouldRefreshActiveCampForCoreEvent(
  event: CoreEvent,
  activeCampId: string | null,
  shuttingDown = false
): boolean {
  if (shuttingDown || !activeCampId || !ACTIVE_CAMP_INVALIDATION_EVENTS.has(event.method)) {
    return false
  }
  const eventCampId = stringField(asRecord(event.params), 'campId')
  if (event.method === 'agent_run.runtime_model_observed') {
    return eventCampId === activeCampId
  }
  return !eventCampId || eventCampId === activeCampId
}

export interface ActiveCampRefreshCoordinator {
  refresh(campId: string): Promise<void>
}

export function createActiveCampRefreshCoordinator(
  refreshOnce: (campId: string) => Promise<void>
): ActiveCampRefreshCoordinator {
  const activeRefreshes = new Map<string, {
    dirty: boolean
    completion: Promise<void>
  }>()

  return {
    refresh(campId: string): Promise<void> {
      const active = activeRefreshes.get(campId)
      if (active) {
        active.dirty = true
        return active.completion
      }

      const entry = {
        dirty: false,
        completion: Promise.resolve()
      }
      activeRefreshes.set(campId, entry)
      entry.completion = Promise.resolve()
        .then(async () => {
          try {
            let lastError: unknown = null
            do {
              entry.dirty = false
              try {
                await refreshOnce(campId)
                lastError = null
              } catch (nextError) {
                lastError = nextError
              }
            } while (entry.dirty)
            if (lastError !== null) throw lastError
          } finally {
            if (activeRefreshes.get(campId) === entry) activeRefreshes.delete(campId)
          }
        })
      return entry.completion
    }
  }
}

export function refreshActiveCampForCoreEvent(
  event: CoreEvent,
  activeCampId: string | null,
  coordinator: ActiveCampRefreshCoordinator,
  shuttingDown = false
): Promise<void> | null {
  return shouldRefreshActiveCampForCoreEvent(event, activeCampId, shuttingDown) && activeCampId
    ? coordinator.refresh(activeCampId)
    : null
}

export function requestAuthoritativeCampOpenProjection(
  api: Pick<RovaiApi, 'request'>,
  campId: string,
  traceId: string
): Promise<CampOpenProjection> {
  return api.request<CampOpenProjection>('camps.open', { traceId, campId })
}

type LoadState = 'loading' | 'ready' | 'error'
export type StartupStatus = 'loading' | 'waiting' | 'resolved'
export const STARTUP_FEEDBACK_DELAY_MS = 400
export const SHUTDOWN_FEEDBACK_DELAY_MS = 400
export type View = 'compose' | 'camp' | 'members' | 'automations' | 'missions' | 'memory' | 'settings'
type ActivateCampOptions = {
  memberPrepared?: boolean
  reconcileDefaultLead?: boolean
  initializeComposerDraft?: boolean
  preserveNotificationFocus?: boolean
  missionPresentation?: 'drawer'
  suppressErrors?: boolean
  anchoredMessages?: readonly CampMessageView[]
  anchoredAgentRuns?: readonly AgentRunView[]
}

export function activeCampSurfaceNeedsLeaveGuard(
  view: View,
  activeCampId: string | null
): activeCampId is string {
  return view === 'camp' && activeCampId !== null
}

export async function prepareActiveCampForAppQuit(
  view: View,
  activeCampId: string | null,
  registration: { campId: string; guard: CampLeaveGuard } | null
): Promise<void> {
  if (
    view !== 'camp'
    || !activeCampId
    || registration?.campId !== activeCampId
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
    throw new Error('定时任务修改尚未保存')
  }
}

export type SettingsSection = NavigationSettingsSection
export type WindowDragStripPage = Extract<View, 'compose' | 'members' | 'automations' | 'missions' | 'memory' | 'settings'>

export function windowDragStripPage(view: View): WindowDragStripPage | null {
  return view === 'compose'
    || view === 'members'
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
  status: StartupStatus,
  delayElapsed: boolean
): boolean {
  return status === 'waiting' || (status === 'loading' && delayElapsed)
}

export function campViewIsVisibleForReadAcknowledgement(
  view: View,
  activeCampId: string | null,
  snapshotCampId: string | null,
  visibilityState: DocumentVisibilityState,
  hasFocus: boolean
): boolean {
  return view === 'camp'
    && activeCampId !== null
    && snapshotCampId === activeCampId
    && visibilityState === 'visible'
    && hasFocus
}

interface OptimisticCampMessageEntry {
  campId: string
  commandId: string
  message: CampMessageView
}

type CampSurfaceSnapshot = CampSnapshot & {
  openCoverage?: CampOpenProjection['coverage']
}

const CAMP_SNAPSHOT_CACHE_LIMIT = 5
export const CAMP_OPEN_FEEDBACK_DELAY_MS = 400

export function rememberCampSnapshot(
  cache: Map<string, CampSurfaceSnapshot>,
  snapshot: CampSurfaceSnapshot,
  limit = CAMP_SNAPSHOT_CACHE_LIMIT
): void {
  cache.delete(snapshot.camp.id)
  if (limit <= 0) {
    cache.clear()
    return
  }
  cache.set(snapshot.camp.id, snapshot)
  while (cache.size > limit) {
    const oldestCampId = cache.keys().next().value
    if (oldestCampId === undefined) break
    cache.delete(oldestCampId)
  }
}

export function recentCampSnapshot(
  cache: Map<string, CampSurfaceSnapshot>,
  campId: string
): CampSurfaceSnapshot | null {
  const snapshot = cache.get(campId) ?? null
  if (!snapshot) return null
  cache.delete(campId)
  cache.set(campId, snapshot)
  return snapshot
}

export function campActivationPreview<T extends CampSnapshot>(
  currentSnapshot: T | null,
  activeCampId: string | null,
  cachedSnapshot: T | null,
  targetCampId: string
): T | null {
  if (activeCampId === targetCampId && currentSnapshot?.camp.id === targetCampId) {
    return currentSnapshot
  }
  return cachedSnapshot?.camp.id === targetCampId ? cachedSnapshot : null
}

export function campOpenProjectionAsSnapshot(
  projection: CampOpenProjection,
  previous: CampSurfaceSnapshot | null = null
): CampSurfaceSnapshot {
  const previousEarlierMessages = previous?.camp.id === projection.camp.id
    ? previous.messages.filter((message) =>
        projection.messages.length > 0
          && message.sequence < projection.messages[0].sequence
      )
    : []
  const messagesById = new Map<string, CampMessageView>()
  for (const message of previousEarlierMessages) messagesById.set(message.id, message)
  for (const message of projection.messages) messagesById.set(message.id, message)
  const messages = [...messagesById.values()]
    .map((message) => ({ ...message, timelineGlobalSequence: null }))
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))
  const loadedCount = messages.length
  const totalCount = Math.max(projection.coverage.messages.totalCount, loadedCount)
  const omittedCount = Math.max(0, totalCount - loadedCount)
  return {
    schemaVersion: 34,
    throughGlobalSequence: projection.throughGlobalSequence,
    camp: projection.camp,
    members: projection.members,
    membershipReconciliations: projection.membershipReconciliations,
    tasks: projection.tasks,
    messages,
    messageDeliveries: projection.messageDeliveries,
    turns: projection.turns,
    agentRuns: projection.agentRuns,
    executionEvidence: projection.executionEvidence,
    agentRunFileChanges: projection.agentRunFileChanges,
    agentRunImages: projection.agentRunImages ?? [],
    contextManifests: [],
    approvals: projection.approvals,
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

const CANCELLABLE_TURN_STATUSES = new Set<CampSnapshot['turns'][number]['status']>([
  'running',
  'waiting'
])
const CANCELLABLE_RUN_STATUSES = new Set<CampSnapshot['agentRuns'][number]['status']>([
  'queued',
  'running',
  'waiting'
])
export function campActivationStateForCreation(
  source: 'one_click' | 'dialog'
): CampActivationState {
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
  turns: Pick<CampSnapshot['turns'][number], 'id' | 'status'>[]
  agentRuns: Pick<CampSnapshot['agentRuns'][number], 'campTurnId' | 'status'>[]
}, scope: 'current_execution' | 'camp_cleanup' = 'current_execution'): string[] {
  if (scope === 'camp_cleanup') {
    return snapshot.turns
      .filter((turn) => CANCELLABLE_TURN_STATUSES.has(turn.status))
      .map((turn) => turn.id)
  }
  const executingTurnIds = new Set(snapshot.agentRuns
    .filter((run) => CANCELLABLE_RUN_STATUSES.has(run.status))
    .map((run) => run.campTurnId))
  return snapshot.turns
    .filter((turn) =>
      CANCELLABLE_TURN_STATUSES.has(turn.status) && executingTurnIds.has(turn.id))
    .map((turn) => turn.id)
}

export function reconcileCancellingTurnIds(
  current: ReadonlySet<string>,
  snapshot: Pick<CampSnapshot, 'turns'>
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
  snapshot: Pick<CampSnapshot, 'turns'>
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
  snapshot: CampSnapshot,
  result: StoredCommandResult
): CampSnapshot {
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
  const turnStatus = payload.campTurnStatus
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
    turns: snapshot.turns.map((turn) => turn.id === payload.campTurnId
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
            <h2 id="controlled-shutdown-title">正在安全退出</h2>
            <p id="controlled-shutdown-description">Rovai 正在保存本地状态并关闭后台服务。</p>
            <span className="shutdown-progress-track" role="progressbar" aria-label="正在完成安全退出">
              <i />
            </span>
            <p className="shutdown-evidence-note" id="controlled-shutdown-evidence">
              未完成的任务会取消，未确认的改动保留为待核对记录。
            </p>
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
  return target?.kind === 'camp' || target?.kind === 'members' || target?.kind === 'memory'
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
      <CampNavigation
        platform={window.rovai.platform}
        view={view}
        state="loading"
        disabled
        navigation={null}
        activeCampId={null}
        pendingMemoryCount={0}
        onNewConversation={ignore}
        onMembers={ignore}
        onAutomations={ignore}
        onMemory={ignore}
        onSettings={ignore}
        onOpenProject={ignore}
        onCamp={ignore}
        onRemoveProject={ignoreAsync}
        onRename={ignoreAsync}
        onDelete={ignoreAsync}
        onDeleteError={ignore}
        onError={ignore}
      />
      {view === 'camp' && <AppHeader
        campTitle="对话"
        contextLabel={null}
        camp={null}
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
    <StartupLoadingCanvas
      visible={feedbackVisible && error === null}
      route={target?.kind ?? 'location'}
    />
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
      setActionError('暂时无法重新打开，请重试。')
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
      setActionError('暂时无法导出诊断，请重试。')
    } finally {
      setBusy(null)
    }
  }
  const changeAppearance = async (preference: ThemePreference): Promise<void> => {
    setActionError(null)
    try {
      setAppearance(await window.rovai.appearance.setPreference(preference))
    } catch {
      setActionError('暂时无法保存外观设置，请重试。')
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
              {busy === 'retry' ? '正在打开会话' : '重新打开'}
            </button>
            <button
              className="quiet-button"
              type="button"
              disabled={busy !== null}
              onClick={() => void exportDiagnostics()}
            >
              {busy === 'diagnostics' ? '正在导出…' : '导出诊断'}
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
            <span className="bootstrap-local-label">本地外观</span>
            <p>你仍然可以调整外观。</p>
          </div>
          <div className="bootstrap-theme-options" role="group" aria-label="外观主题">
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
                {label}
              </button>
            ))}
          </div>
          {(snapshot?.localDegradations.length ?? 0) > 0 && (
            <div className="bootstrap-degradations">
              <span className="bootstrap-local-label">本机设置提示</span>
              <p>部分本机设置暂时无法读取，可导出诊断以排查原因。</p>
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
    eyebrow: starting ? '请稍候' : '会话尚未就绪',
    title: starting ? '正在打开会话' : '暂时无法打开会话',
    description: starting ? '准备好后会自动打开。' : '请重新打开，或导出诊断以排查原因。'
  }
}

type AppToastValue = {
  message: string
  tone: 'neutral' | 'danger'
  action?: { label: string; onSelect(): void }
  persistent?: boolean
}

export function navigationWithoutDeletedCamps(
  snapshot: NavigationSnapshot,
  deletingCampIds: ReadonlySet<string>
): NavigationSnapshot {
  const filterGroup = <T extends { totalCount: number; recentCamps: NavigationCampItem[] }>(group: T): T => {
    const recentCamps = group.recentCamps.filter((camp) => !deletingCampIds.has(camp.id))
    const removed = group.recentCamps.length - recentCamps.length
    return removed === 0
      ? group
      : { ...group, recentCamps, totalCount: Math.max(0, group.totalCount - removed) }
  }
  return {
    ...snapshot,
    quickChat: filterGroup(snapshot.quickChat),
    projects: snapshot.projects
      .map(filterGroup)
      .filter((project) => project.totalCount > 0)
  }
}

export function AppToast({
  toast,
  onClose
}: {
  toast: AppToastValue
  onClose(): void
}): React.JSX.Element {
  return (
    <div
      className={`app-toast${toast.tone === 'danger' ? ' is-danger' : ''}`}
      role={toast.tone === 'danger' ? 'alert' : 'status'}
      aria-live={toast.tone === 'danger' ? 'assertive' : 'polite'}
    >
      <span>{toast.message}</span>
      {toast.action && <button className="app-toast-action" type="button" onClick={() => { onClose(); toast.action?.onSelect() }}>{toast.action.label}</button>}
      <button className="icon-button" type="button" aria-label="关闭提示" onClick={onClose}>×</button>
    </div>
  )
}

export function BusinessApp({
  environment,
  sidebarFooter,
  remoteConnection,
  initialStartupSnapshot,
  startupStartedAtMs,
  startupFeedbackDelayElapsed
}: {
  environment: BusinessEnvironment
  sidebarFooter?: React.ReactNode
  remoteConnection?: React.ReactNode
  initialStartupSnapshot?: DesktopStartupSnapshot
  startupStartedAtMs?: number
  startupFeedbackDelayElapsed?: boolean
}): React.JSX.Element {
  const { client, preferences: uiPreferences, desktop } = environment
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
  type NavigationContext = { campOptions?: ActivateCampOptions; beforeCommit?: () => void; prepared?: boolean; memberPrepared?: boolean }
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
  const [health, setHealth] = useState<HealthStatus | null>(null)
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
  const [projectOrder, setProjectOrder] = useState<string[] | null>(null)
  const [projectNames, setProjectNames] = useState<Record<string, string>>({})
  const projectNamesGeneration = useRef(0)
  const [pinnedCampItems, setPinnedCampItems] = useState<NavigationCampItem[]>([])
  const [pendingMemoryCount, setPendingMemoryCount] = useState(0)
  const [memoryReviewNotice, setMemoryReviewNotice] = useState(false)
  const [memoryAutoNotice, setMemoryAutoNotice] = useState<{
    count: number
    memoryId: string | null
    scope: 'companion' | 'relationship' | null
  }>({ count: 0, memoryId: null, scope: null })
  const [memoryRefreshKey, setMemoryRefreshKey] = useState(0)
  const [memoryTarget, setMemoryTarget] = useState<MemoryNavigationTarget>({ kind: 'memory', memoryId: null })
  const [memoryReviewDrawerSignal, setMemoryReviewDrawerSignal] = useState(0)
  const [campSnapshotState, setCampSnapshotState] = useState<{
    snapshot: CampSurfaceSnapshot | null
    entryPreview: boolean
    initialComposerDraft: CampComposerDraftView | null
  }>({ snapshot: null, entryPreview: false, initialComposerDraft: null })
  const campSnapshot = campSnapshotState.snapshot
  const [campInspectorCampId, setCampInspectorCampId] = useState<string | null>(null)
  const [campInspectorTab, setCampInspectorTab] = useState<CampInspectorTab>('tasks')
  const [singleChatCampId, setSingleChatCampId] = useState<string | null>(null)
  const [campDetailEntryHost, setCampDetailEntryHost] = useState<HTMLDivElement | null>(null)
  const [optimisticCampMessages, setOptimisticCampMessages] = useState<OptimisticCampMessageEntry[]>([])
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
  const mobilePageRef = useMobilePageTransition(mobile, view)
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(
    initialTarget.kind === 'members' ? initialTarget.agentId : null
  )
  const [memberTab, setMemberTab] = useState<MemberWorkspaceTab>(
    initialTarget.kind === 'members' ? initialTarget.tab : 'identity'
  )
  const [memberRuntimeFocusRequest, setMemberRuntimeFocusRequest] = useState(0)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general')
  const [remotePort, setRemotePort] = useState<string | null>(null)
  const newConversationRequestBusy = useRef(false)
  const [generalPreferences, setGeneralPreferences] = useState<GeneralPreferencesSnapshot | null>(null)
  const [currentProject, setCurrentProject] = useState<CurrentProject>(() => readCurrentProject())
  const [currentWorkspaceHint, setCurrentWorkspaceHint] = useState<WorkspaceSelection | null>(null)
  const [activeCampId, setActiveCampId] = useState<string | null>(null)
  const campInspectorVisible = activeCampId !== null && campInspectorCampId === activeCampId
  const singleChatVisible = activeCampId !== null && singleChatCampId === activeCampId
  const [notificationFocus, setNotificationFocus] = useState<NotificationFocusTarget | null>(null)
  const [singleChatNotificationTarget, setSingleChatNotificationTarget] = useState<(NonNullable<NotificationActionView['singleChat']> & { requestId: number }) | null>(null)
  const [visibleSingleChatSources, setVisibleSingleChatSources] = useState<VisibleNotificationSources | null>(null)
  const [visibleNotificationSources, setVisibleNotificationSources] = useState<VisibleNotificationSources | null>(null)
  const [notificationAnchor, setNotificationAnchor] = useState<{
    campId: string
    messages: readonly CampMessageView[]
    agentRuns: readonly AgentRunView[]
  } | null>(null)
  const missionList = useMissions(client, startupStatus === 'resolved')
  const [missionPresentation, setMissionPresentation] = useState<'drawer' | 'full'>('full')
  const [missionOpenRequest, setMissionOpenRequest] = useState(0)
  const [newMissionOpen, setNewMissionOpen] = useState(false)
  const missionCreation = useRef<{id: string; command: MissionCreate; attachments: MissionAttachmentDraft[]; attachmentSignature: string} | null>(null)
  const activeMission = missionList.missions.find(m => m.campId === activeCampId)
  const missionCamp = !!activeMission || !!(campSnapshot?.camp.id === activeCampId && campSnapshot?.camp.missionId)
  const missionDrawer = !mobile && view === 'camp' && !!activeMission && missionPresentation === 'drawer'
  const [newConversationOpen, setNewConversationOpen] = useState(false)
  const [newConversationInitialWorkspace, setNewConversationInitialWorkspace] = useState<WorkspaceSelection | null>(null)
  const [newConversationInitialSelection, setNewConversationInitialSelection] = useState<GeneralPreferencesSnapshot['newConversationDefaults']>(null)
  const [newConversationAttention, setNewConversationAttention] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<AppToastValue | null>(null)
  const notify = useCallback((message: string): void => {
    setToast((current) => current?.persistent ? current : { message, tone: 'neutral' })
  }, [])
  const notifyError = useCallback((message: string, action?: { label: string; onSelect(): void }, persistent = false): void => {
    setToast((current) => current?.persistent && !persistent
      ? current
      : { message, tone: 'danger', action, persistent })
  }, [])
  const [openingCampId, setOpeningCampId] = useState<string | null>(null)
  const [runtimeRecovery, setRuntimeRecovery] = useState<CampRuntimeRecovery | null>(null)
  const [liveRuntimeEvents, setLiveRuntimeEvents] = useState<LiveRuntimeEvent[]>([])
  const campEventSequenceMarker = useRef(0)
  const campSelectionGeneration = useRef(0)
  const campOpenFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const campSnapshotCache = useRef(new Map<string, CampSurfaceSnapshot>())
  const campSnapshotRef = useRef<CampSurfaceSnapshot | null>(null)
  const activeCampIdRef = useRef<string | null>(null)
  const viewRef = useRef<View>('compose')
  const notificationFocusSequence = useRef(0)
  const notificationFocusRef = useRef<NotificationFocusTarget | null>(null)
  const notificationPresentationRef = useRef<NotificationPresentationCoordinator | null>(null)
  const campViewedAcknowledgements = useRef(new Map<string, number>())
  const [openedNavigationRow, setOpenedNavigationRow] = useState<NavigationCampItem | null>(null)
  const pinnedCampIdsRef = useRef<string[]>([])
  pinnedCampIdsRef.current = navigationPins.filter(pin => pin.kind === 'camp').map(pin => pin.targetKey)
  const healthRequest = useRef<Promise<HealthStatus> | null>(null)
  const navigationSnapshotRef = useRef<NavigationSnapshot | null>(null)
  const deletingCampIdsRef = useRef(new Set<string>())
  const shownDeletionIssuesRef = useRef(new Set<string>())
  const projectOrderSyncGeneration = useRef(0)
  const overviewRequest = useRef<Promise<boolean> | null>(null)
  const startupSnapshotRequest = useRef<Promise<void> | null>(null)
  const onboardingSnapshotRequest = useRef<Promise<void> | null>(null)
  const onboardingRuntimeRequest = useRef<Promise<void> | null>(null)
  const startupTraceId = useRef(newCommandId())
  const startupStartedAt = useRef(startupStartedAtMs ?? performance.now())
  const liveRuntimeEventSequence = useRef(0)
  const runtimeHealthRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const runtimeHealthRefreshIncludesMembers = useRef(false)
  const membersViewRef = useRef<MembersViewHandle>(null)
  const campLeaveGuardRef = useRef<{ campId: string; guard: CampLeaveGuard } | null>(null)
  const navigationCampPreparation = useRef<{
    campId: string; guard: CampLeaveGuard; promise: Promise<CampLeavePreparation>; users: number; didLeave: boolean
  } | null>(null)
  const automationLeaveGuardRef = useRef<AutomationLeaveGuard | null>(null)
  const startupResolvedSessionId = useRef<string | null>(null)
  const pendingRestorableLocation = useRef<RestorableLocation | null>(null)
  const invalidatingNewConversationDefaults = useRef(false)
  const campCreationPreflight = useMemo(
    () => campCreationPreflightFromAgents(agents),
    [agents]
  )
  activeCampIdRef.current = activeCampId
  viewRef.current = view
  notificationFocusRef.current = notificationFocus
  if (notificationPresentationRef.current === null) {
    notificationPresentationRef.current = createNotificationPresentationCoordinator()
  }

  const setCampSnapshot = useCallback((
    snapshot: CampSurfaceSnapshot | null,
    entryPreview = false,
    initialComposerDraft: CampComposerDraftView | null = null
  ): void => {
    campSnapshotRef.current = snapshot
    if (snapshot) rememberCampSnapshot(campSnapshotCache.current, snapshot)
    setCampSnapshotState({ snapshot, entryPreview, initialComposerDraft })
  }, [])

  const consumeInitialComposerDraft = useCallback((draft: CampComposerDraftView): void => {
    setCampSnapshotState((current) => current.initialComposerDraft === draft
      ? { ...current, initialComposerDraft: null }
      : current)
  }, [])

  const clearCampOpenFeedback = useCallback((): void => {
    if (campOpenFeedbackTimer.current !== null) {
      clearTimeout(campOpenFeedbackTimer.current)
      campOpenFeedbackTimer.current = null
    }
    setOpeningCampId(null)
  }, [])

  const registerCampLeaveGuard = useCallback((
    campId: string,
    guard: CampLeaveGuard | null
  ): void => {
    if (guard) {
      campLeaveGuardRef.current = { campId, guard }
    } else if (campLeaveGuardRef.current?.campId === campId) {
      campLeaveGuardRef.current = null
    }
  }, [])

  const leaveActiveCamp = useCallback(async (
    transition: () => void | Promise<void>
  ): Promise<boolean> => {
    const leavingCampId = activeCampIdRef.current
    const registration = campLeaveGuardRef.current
    if (
      !activeCampSurfaceNeedsLeaveGuard(viewRef.current, leavingCampId)
      || registration?.campId !== leavingCampId
    ) {
      await transition()
      return true
    }

    let preparation = navigationCampPreparation.current
    if (!preparation || preparation.campId !== leavingCampId || preparation.guard !== registration.guard) {
      preparation = { campId: registration.campId, guard: registration.guard,
        promise: Promise.resolve().then(registration.guard), users: 0, didLeave: false }
      navigationCampPreparation.current = preparation
    }
    preparation.users += 1
    let prepared: CampLeavePreparation | undefined
    try {
      prepared = await preparation.promise
      await transition()
      await afterNextPaint()
      preparation.didLeave ||= viewRef.current !== 'camp' || activeCampIdRef.current !== leavingCampId
    } catch (nextError) {
      setError(`离开当前会话前未能完成输入操作：${errorMessage(nextError)}`)
      return false
    } finally {
      preparation.users -= 1
      if (preparation.users === 0) {
        prepared?.complete(preparation.didLeave)
        if (navigationCampPreparation.current === preparation) navigationCampPreparation.current = null
      }
    }
    return true
  }, [])

  const registerAutomationLeaveGuard = useCallback((guard: AutomationLeaveGuard | null): void => {
    automationLeaveGuardRef.current = guard
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
      setError(`离开定时任务前未能保存修改：${errorMessage(nextError)}`)
      return false
    }
  }, [])

  const leaveActiveSurface = useCallback(async (
    transition: () => void | Promise<void>
  ): Promise<boolean> => {
    let automationTransitioned = false
    const campTransitioned = await leaveActiveCamp(async () => {
      automationTransitioned = await leaveActiveAutomation(transition)
    })
    return campTransitioned && automationTransitioned
  }, [leaveActiveAutomation, leaveActiveCamp])

  const prepareForAppQuit = useCallback(async (): Promise<void> => {
    try {
      await prepareActiveCampForAppQuit(
        viewRef.current,
        activeCampIdRef.current,
        campLeaveGuardRef.current
      )
      await prepareActiveAutomationForAppQuit(
        viewRef.current,
        automationLeaveGuardRef.current
      )
    } catch (nextError) {
      setError(`退出应用前未能完成输入操作：${errorMessage(nextError)}`)
      throw nextError
    }
  }, [])

  useEffect(
    () => desktop?.appLifecycle.onPrepareQuit(prepareForAppQuit),
    [prepareForAppQuit]
  )

  const cancelPendingCampActivation = useCallback((): void => {
    campSelectionGeneration.current += 1
    clearCampOpenFeedback()
  }, [clearCampOpenFeedback])

  const requestCampProjection = useCallback(async (
    campId: string,
    mode: 'enter' | 'open'
  ): Promise<{
    snapshot: CampSurfaceSnapshot
    traceId: string
    startedAt: number
  }> => {
    const traceId = newCommandId()
    const startedAt = performance.now()
    const method = mode === 'enter' ? 'camps.enter' : 'camps.open'
    console.info(`[camp-open] trace=${traceId} stage=renderer_request method=${method}`)
    const projection = mode === 'enter'
      ? await client.request<CampOpenProjection>('camps.enter', {
          traceId,
          commandId: newCommandId(),
          command: { campId }
        })
      : await requestAuthoritativeCampOpenProjection(client, campId, traceId)
    if (projection.schemaVersion !== 8) throw new Error('会话打开数据版本不兼容。')
    console.info(
      `[camp-open] trace=${traceId} stage=renderer_received method=${method} `
      + `elapsed_ms=${(performance.now() - startedAt).toFixed(1)} `
      + `schema=${projection.schemaVersion} high_water=${projection.throughGlobalSequence} `
      + `messages=${projection.messages.length} runs=${projection.agentRuns.length} `
      + `evidence=${projection.executionEvidence.length}`
    )
    return {
      snapshot: campOpenProjectionAsSnapshot(projection, campSnapshotRef.current),
      traceId,
      startedAt
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

  useEffect(() => {
    if (view !== 'members') return
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
  }, [agents, selectedMemberId, view, memberTab, desktopNavigation, displayedEntry])

  useEffect(() => {
    setCampInspectorCampId((current) => view === 'camp' && current === activeCampId ? current : null)
    setSingleChatCampId((current) => view === 'camp' && current === activeCampId ? current : null)
  }, [activeCampId, view])

  const memberRosterReader = useMemo(() => createMemberRosterReader(
    () => client.request<AgentProfile[]>('members.list'),
    setAgents
  ), [client])
  const loadAgents = useCallback((): Promise<AgentProfile[]> => memberRosterReader.refresh(), [memberRosterReader])

  useEffect(() => {
    if (startupStatus !== 'resolved' || view !== 'members') return
    // Enter the page with its current roster; the read must not block navigation.
    void loadAgents().catch((nextError) => setError(errorMessage(nextError)))
  }, [loadAgents, startupStatus, view])

  const commitNavigation = useCallback((
    nextNavigation: NavigationSnapshot,
    groupLimits: NavigationGroupLimits
  ): void => {
    const visibleNavigation = navigationWithoutDeletedCamps(
      nextNavigation,
      deletingCampIdsRef.current
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
        readCamps: (campIds) => client.request<NavigationCampRows>('navigation.camps', { campIds }),
        getPinnedCampIds: () => pinnedCampIdsRef.current,
        onRows: (rows, requestedIds) => {
          setPinnedCampItems(current => current.flatMap(camp =>
            requestedIds.includes(camp.id) ? rows.camps.find(next => next.id === camp.id) ?? [] : camp))
          const activeRow = rows.camps.find(camp => camp.id === activeCampIdRef.current)
          if (activeRow) setOpenedNavigationRow(activeRow)
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
    if (!snapshot) throw new Error('会话导航暂时不可用，请重试。')
    return snapshot
  }, [navigationRefreshCoordinator])

  const retryCampDeletion = useCallback((operationId: string): void => {
    const retry = (): void => {
      void client.request<StoredCommandResult>('camps.retryDeletion', {
        commandId: newCommandId(),
        command: { operationId }
      }).then((result) => {
        if (result.status === 'rejected') throw new Error(commandFailureMessage(result))
        setToast(null)
      }).catch(() => {
        notifyError('删除未完成，请重试。', { label: '重试', onSelect: retry }, true)
      })
    }
    retry()
  }, [client, notifyError])

  const loadCampDeletionIssues = useCallback(async (): Promise<void> => {
    const issues = await client.request<CampDeletionIssue[]>('camps.deletionIssues')
    const issue = issues.find(({ operationId, attentionRevision }) => (
      !shownDeletionIssuesRef.current.has(`${operationId}:${attentionRevision}`)
    ))
    if (!issue) return
    shownDeletionIssuesRef.current.add(`${issue.operationId}:${issue.attentionRevision}`)
    notifyError(
      '删除未完成，请重试。',
      { label: '重试', onSelect: () => retryCampDeletion(issue.operationId) },
      true
    )
  }, [client, notifyError, retryCampDeletion])

  const loadOnboarding = useCallback((): Promise<void> => {
    if (!desktop) return Promise.resolve()
    if (onboardingSnapshotRequest.current) return onboardingSnapshotRequest.current
    const request = (async (): Promise<void> => {
      setOnboardingError(null)
      try {
        const snapshot = await desktop.onboarding.get()
        if (snapshot.status === 'uninitialized') {
          throw new Error('首次引导状态尚未就绪，请重试。')
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

  const loadOverview = useCallback((showLoading = false): Promise<boolean> => {
    if (showLoading) setState('loading')
    if (overviewRequest.current) return overviewRequest.current
    setError(null)
    const request = (async (): Promise<boolean> => {
      try {
        // Navigation is the most broadly useful Overview projection. Route-specific
        // startup authority is queued before this background load, while the remaining
        // projections can populate independently as their serialized Core replies arrive.
        const nextNavigationPromise = loadNavigation()
        const nextAgentsPromise = loadAgents()
        const nextInstallationsPromise = client
          .request<AdapterInstallation[]>('runtime.installations.list')
          .then((nextInstallations) => {
            setInstallations(nextInstallations)
            return nextInstallations
          })
        const nextMemoryReviewItemsPromise = client
          .request<HearthReviewItem[]>('memory.hearthReviewItems.list')
          .then((nextMemoryReviewItems) => {
            setPendingMemoryCount(
              nextMemoryReviewItems.filter((reviewItem) => reviewItem.status === 'pending').length
            )
            return nextMemoryReviewItems
          })
        const namesGeneration = projectNamesGeneration.current
        const nextNavigationPreferencesPromise = uiPreferences.navigationPreferences.get()

        const navigationOverviewPromise = (async (): Promise<void> => {
          const [nextNavigation, nextNavigationPreferences] = await Promise.all([
            nextNavigationPromise,
            nextNavigationPreferencesPromise
          ])
          const resolvedPins = await resolveNavigationPins(
            nextNavigation,
            nextNavigationPreferences.pins, client
          )
          let resolvedNavigationPreferences = nextNavigationPreferences
          if (resolvedPins.pins.length !== nextNavigationPreferences.pins.length) {
            resolvedNavigationPreferences = await uiPreferences.navigationPreferences.replacePins(
              resolvedPins.pins
            )
          }
          const removedProjectKeySet = new Set(
            resolvedNavigationPreferences.removedProjects.map((project) => project.targetKey)
          )
          resolvedNavigationPreferences = await uiPreferences.navigationPreferences
            .synchronizeProjectOrder(
              nextNavigation.projects
                .map((project) => project.projectKey)
                .filter((projectKey) => !removedProjectKeySet.has(projectKey))
            )
          setNavigationPins(resolvedPins.pins)
          setRemovedProjectKeys(removedProjectKeySet)
          setProjectOrder(resolvedNavigationPreferences.projectOrder)
          if (namesGeneration === projectNamesGeneration.current) {
            setProjectNames(resolvedNavigationPreferences.projectNames)
          }
          setRemovedProjectAuthorityReady(true)
          setPinnedCampItems(
            resolvedPins.camps.filter((camp) => !deletingCampIdsRef.current.has(camp.id))
          )
        })()
        const results = await Promise.allSettled([
          navigationOverviewPromise,
          nextAgentsPromise,
          nextInstallationsPromise,
          nextMemoryReviewItemsPromise
        ])
        const firstFailure = results.find(
          (result): result is PromiseRejectedResult => result.status === 'rejected'
        )
        if (firstFailure) setError(errorMessage(firstFailure.reason))
        const navigationReady = results[0]?.status === 'fulfilled'
        setState(navigationReady ? 'ready' : 'error')
        return navigationReady
      } catch (nextError) {
        setError(errorMessage(nextError))
        setState(navigationSnapshotRef.current ? 'ready' : 'error')
        return false
      }
    })()
    overviewRequest.current = request
    void request.finally(() => {
      if (overviewRequest.current === request) overviewRequest.current = null
    }).catch(() => undefined)
    return request
  }, [loadAgents, loadNavigation])

  const loadHealth = useCallback((): Promise<HealthStatus> => {
    if (healthRequest.current) return healthRequest.current
    setHealthAttempted(true)
    setHealthLoading(true)
    const request = client.request<HealthStatus>('health.check')
      .then((nextHealth) => {
        setHealth(nextHealth)
        return nextHealth
      })
      .finally(() => {
        if (healthRequest.current === request) healthRequest.current = null
        setHealthLoading(false)
      })
    healthRequest.current = request
    return request
  }, [])

  const refreshOnboardingRuntime = useCallback((): Promise<void> => {
    if (onboardingRuntimeRequest.current) return onboardingRuntimeRequest.current
    const request = (async (): Promise<void> => {
      setOnboardingError(null)
      try {
        setOnboardingRuntimePhase('discovering')
        await client.request('runtime.discovery.rescan', { interactiveShell: true })

        setOnboardingRuntimePhase('checking')
        const nextHealth = await client.request<HealthStatus>('health.check')
        setHealth(nextHealth)
        setHealthAttempted(true)

        setOnboardingRuntimePhase('models')
        const nextInstallations = await client.request<AdapterInstallation[]>(
          'runtime.installations.list'
        )
        setInstallations(nextInstallations)
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
  }, [])

  const loadInstallations = useCallback(async (): Promise<void> => {
    const nextInstallations = await client.request<AdapterInstallation[]>('runtime.installations.list')
    setInstallations(nextInstallations)
  }, [])

  const loadMemberData = useCallback(async (): Promise<void> => {
    await Promise.all([loadAgents(), loadInstallations()])
  }, [loadAgents, loadInstallations])

  const applyNavigationPreferences = useCallback((
    snapshot: NavigationPreferencesSnapshot
  ): void => {
    setNavigationPins(snapshot.pins)
    const nextRemovedProjectKeys = new Set(
      snapshot.removedProjects.map((project) => project.targetKey)
    )
    setRemovedProjectKeys((current) => (
      current.size === nextRemovedProjectKeys.size
      && [...current].every((projectKey) => nextRemovedProjectKeys.has(projectKey))
    ) ? current : nextRemovedProjectKeys)
    setProjectOrder((current) => {
      const next = snapshot.projectOrder
      if (current === null || next === null) return current === next ? current : next
      return current.length === next.length
        && current.every((projectKey, index) => projectKey === next[index])
        ? current
        : next
    })
    setRemovedProjectAuthorityReady(true)
  }, [])

  useEffect(() => {
    if (!navigation || !removedProjectAuthorityReady) return
    const generation = ++projectOrderSyncGeneration.current
    const projectKeys = navigation.projects
      .map((project) => project.projectKey)
      .filter((projectKey) => !removedProjectKeys.has(projectKey))
    void uiPreferences.navigationPreferences.synchronizeProjectOrder(projectKeys)
      .then((snapshot) => {
        if (generation === projectOrderSyncGeneration.current) {
          applyNavigationPreferences(snapshot)
        }
      })
      .catch((nextError) => {
        if (generation === projectOrderSyncGeneration.current) {
          setError(`项目顺序暂时无法保存：${errorMessage(nextError)}`)
        }
      })
  }, [applyNavigationPreferences, navigation, removedProjectAuthorityReady, removedProjectKeys])

  const restoreNavigationProject = useCallback(async (projectPath: string): Promise<void> => {
    const targetKey = projectTargetKey(projectPath)
    try {
      const snapshot = await uiPreferences.navigationPreferences.restoreProject(targetKey)
      applyNavigationPreferences(snapshot)
    } catch (nextError) {
      setError(`项目访问状态未能恢复，已停止后续目录检查：${errorMessage(nextError)}`)
      throw nextError
    }
  }, [applyNavigationPreferences])

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
        cancelPendingCampActivation()
        setActiveCampId(null)
        setCampSnapshot(null)
        setNotificationFocus(null)
        setStartupRouteTarget(target)
        if (target.kind === 'camp') {
          setView('camp')
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
  }, [cancelPendingCampActivation, setCampSnapshot, desktopNavigation])

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

  const activateCampWithoutLeaveGuard = useCallback(async (
    campId: string,
    options: ActivateCampOptions,
    selectionGeneration: number,
    transaction?: NavigationTransaction
  ): Promise<boolean> => {
    if (selectionGeneration !== campSelectionGeneration.current || (transaction && !transaction.isCurrent())) return false
    const cachedSnapshot = activeCampIdRef.current === campId
      ? null
      : recentCampSnapshot(campSnapshotCache.current, campId)
    const previewSnapshot = campActivationPreview(
      campSnapshotRef.current,
      activeCampIdRef.current,
      cachedSnapshot,
      campId
    )
    const commitCampSurface = (
      snapshot: CampSurfaceSnapshot,
      entryPreview = false,
      initialComposerDraft: CampComposerDraftView | null = null
    ): void => {
      if (transaction && !transaction.commit()) return
      const snapshotProject = currentProjectForCamp(snapshot.camp)
      setCurrentProject(snapshotProject)
      persistCurrentProject(snapshotProject)
      campEventSequenceMarker.current = snapshot.throughGlobalSequence
      if (!options.preserveNotificationFocus) {
        setNotificationFocus(null)
        setNotificationAnchor(null)
      }
      if ((options.anchoredMessages?.length ?? 0) > 0
        || (options.anchoredAgentRuns?.length ?? 0) > 0) {
        setNotificationAnchor({
          campId,
          messages: options.anchoredMessages ?? [],
          agentRuns: options.anchoredAgentRuns ?? []
        })
      }
      setActiveCampId(campId)
      setCampSnapshot(snapshot, entryPreview, initialComposerDraft)
      if (snapshot.camp.missionId && options.missionPresentation) {
        setMissionPresentation(options.missionPresentation)
      }
      setView('camp')
    }
    if (previewSnapshot) {
      commitCampSurface(previewSnapshot, true)
    } else {
      campOpenFeedbackTimer.current = setTimeout(() => {
        campOpenFeedbackTimer.current = null
        if (selectionGeneration === campSelectionGeneration.current) {
          setOpeningCampId(campId)
        }
      }, CAMP_OPEN_FEEDBACK_DELAY_MS)
    }
    try {
      const { snapshot, traceId, startedAt } = await requestCampProjection(
        campId,
        options.reconcileDefaultLead === false ? 'open' : 'enter'
      )
      if (selectionGeneration !== campSelectionGeneration.current || (transaction && !transaction.isCurrent())) {
        return false
      }
      clearCampOpenFeedback()
      commitCampSurface(snapshot, false, null)
      await afterNextPaint()
      if (selectionGeneration !== campSelectionGeneration.current) return false
      console.info(
        `[camp-open] trace=${traceId} stage=renderer_meaningful_paint `
        + `elapsed_ms=${(performance.now() - startedAt).toFixed(1)}`
      )
      void (async () => {
        await navigationRefreshCoordinator.refreshCamps([campId], 'explicit')
        if (selectionGeneration !== campSelectionGeneration.current) return
        console.info(
          `[camp-open] trace=${traceId} stage=renderer_background_complete `
          + `elapsed_ms=${(performance.now() - startedAt).toFixed(1)}`
        )
      })().catch((nextError) => {
        if (selectionGeneration === campSelectionGeneration.current) {
          setError(errorMessage(nextError))
        }
      })
      return true
    } catch (nextError) {
      if (selectionGeneration !== campSelectionGeneration.current) return false
      clearCampOpenFeedback()
      if (transaction && !transaction.isCurrent()) return false
      // A removed historical resource resolves to a real page by replacing this entry.
      const exists = await client.request<boolean>('camps.exists', { campId }).catch(() => true)
      if (transaction && !transaction.isCurrent()) return false
      if (!exists && transaction?.commit({ kind: 'quick_chat' })) {
        setActiveCampId(null)
        setCampSnapshot(null)
        setView('compose')
      } else if (!options.suppressErrors) {
        setError(errorMessage(nextError))
      }
      return false
    }
  }, [clearCampOpenFeedback, navigationRefreshCoordinator, requestCampProjection, setCampSnapshot])

  const activateCamp = useCallback(async (
    campId: string,
    options: ActivateCampOptions = {}
  ): Promise<boolean> => {
    const activated = await desktopNavigation.push({ kind: 'camp', campId }, { campOptions: options, memberPrepared: options.memberPrepared })
    const state = desktopNavigation.getSnapshot()
    const target = state.entries[state.index]
    if (target?.kind !== 'camp' || target.campId !== campId) return false
    if (viewRef.current === 'camp' && activeCampIdRef.current === campId) {
      if ((options.anchoredMessages?.length ?? 0) > 0
        || (options.anchoredAgentRuns?.length ?? 0) > 0) {
        setNotificationAnchor({
          campId,
          messages: options.anchoredMessages ?? [],
          agentRuns: options.anchoredAgentRuns ?? []
        })
      }
      if (campSnapshotRef.current?.camp.missionId && options.missionPresentation) {
        setMissionPresentation(options.missionPresentation)
      }
      return true
    }
    return activated
  }, [desktopNavigation])

  useEffect(() => desktop?.userAutomation.onOpenCamp(({ campId }) => {
    void activateCamp(campId, { reconcileDefaultLead: false })
  }), [activateCamp])

  const refreshActiveCampSnapshotOnce = useCallback(async (campId: string): Promise<void> => {
    const { snapshot } = await requestCampProjection(campId, 'open')
    if (activeCampIdRef.current !== campId) return
    if (snapshot.throughGlobalSequence < campEventSequenceMarker.current) return
    campEventSequenceMarker.current = snapshot.throughGlobalSequence
    setCampSnapshot(snapshot)
    setConfirmingRunIds(new Set())
  }, [requestCampProjection, setCampSnapshot])

  const activeCampRefreshCoordinator = useMemo(
    () => createActiveCampRefreshCoordinator(refreshActiveCampSnapshotOnce),
    [refreshActiveCampSnapshotOnce]
  )

  const refreshActiveCampSnapshot = useCallback(
    (campId: string): Promise<void> => activeCampRefreshCoordinator.refresh(campId),
    [activeCampRefreshCoordinator]
  )

  const loadEarlierCampMessages = useCallback(async (): Promise<void> => {
    const requestedSnapshot = campSnapshotRef.current
    const coverage = requestedSnapshot?.openCoverage?.messages
    const beforeSequence = coverage?.oldestLoadedSequence ?? null
    if (!requestedSnapshot || !coverage?.hasEarlier || beforeSequence === null) return
    const campId = requestedSnapshot.camp.id
    const selectionGeneration = campSelectionGeneration.current
    const page = await client.request<CampMessagePage>('camp.messages.page', {
      campId,
      beforeSequence,
      throughGlobalSequence: requestedSnapshot.throughGlobalSequence,
      limit: 50
    })
    if (
      page.schemaVersion !== 1
      || page.campId !== campId
      || page.throughGlobalSequence !== requestedSnapshot.throughGlobalSequence
      || page.requestedBeforeSequence !== beforeSequence
      || page.hasMore !== (page.nextBeforeSequence !== null)
      || page.messages.some((message) => message.sequence >= beforeSequence)
    ) {
      throw new Error('较早消息数据不兼容，请重新打开会话。')
    }
    if (selectionGeneration !== campSelectionGeneration.current) return
    const current = campSnapshotRef.current
    if (!current || current.camp.id !== campId) return
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
    setCampSnapshot({
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
  }, [setCampSnapshot])

  const refreshVisibleNotificationCamp = useCallback(async (
    _episode: NotificationEpisodeView,
    action: NotificationActionView
  ): Promise<boolean> => {
    if (action.kind !== 'open_camp_message' || !action.messageId) return false
    const campId = action.campId
    if (activeCampIdRef.current !== campId || viewRef.current !== 'camp') return false
    await refreshActiveCampSnapshot(campId)
    await afterNextPaint()
    if (activeCampIdRef.current !== campId || viewRef.current !== 'camp') return false
    if (!action.available) return false
    return notificationMessageIsVisible(action.messageId)
  }, [refreshActiveCampSnapshot])

  useEffect(() => {
    if (!toast || toast.persistent) return undefined
    const timer = setTimeout(() => setToast(null), 3_200)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (startupStatus !== 'resolved') return
    void loadCampDeletionIssues().catch(() => undefined)
  }, [loadCampDeletionIssues, startupStatus])

  useEffect(() => {
    if (notificationFocus?.kind !== 'camp_message' && notificationFocus?.kind !== 'agent_run') {
      setNotificationAnchor(null)
    }
  }, [notificationFocus])

  useEffect(() => {
    if (!campSnapshot) return
    const persistedIds = new Set(campSnapshot.messages.map((message) => message.id))
    setOptimisticCampMessages((current) => {
      const next = current.filter((entry) =>
        entry.campId !== campSnapshot.camp.id || !persistedIds.has(entry.message.id)
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
      void uiPreferences.generalPreferences.get().then(setGeneralPreferences).catch((e) => setError(errorMessage(e)))
      void loadOverview(true)
    }
  }, [desktop, loadStartupSnapshot, loadOverview, uiPreferences])

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
    if (
      !shouldInvalidateNewConversationDefaults(generalPreferences, agents, state === 'ready')
      || invalidatingNewConversationDefaults.current
    ) return
    invalidatingNewConversationDefaults.current = true
    void uiPreferences.generalPreferences.invalidateNewConversationDefaults(generalPreferences?.newConversationDefaults ?? null)
      .then(setGeneralPreferences)
      .catch((nextError) => setError(errorMessage(nextError)))
      .finally(() => { invalidatingNewConversationDefaults.current = false })
  }, [agents, generalPreferences, state])

  const currentProjectPath = currentProject.kind === 'directory'
    ? currentProject.projectPath
    : null
  const visibleNavigation = useMemo(
    () => navigationWithProjectNames(navigationWithProjectOrder(
      navigationWithProjectAuthority(
        navigation,
        removedProjectKeys,
        removedProjectAuthorityReady
      ),
      projectOrder
    ), projectNames),
    [navigation, projectOrder, projectNames, removedProjectAuthorityReady, removedProjectKeys]
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
      cancelPendingCampActivation()
      setActiveCampId(null)
      setCampSnapshot(null)
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
        const projectionRequest = requestCampProjection(target.campId, 'enter')
        scheduleOverview()
        let opened: Awaited<ReturnType<typeof requestCampProjection>>
        try {
          opened = await projectionRequest
        } catch (snapshotError) {
          let exists: boolean
          try {
            exists = await client.request<boolean>('camps.exists', {
              campId: target.campId
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
        const { snapshot, traceId, startedAt } = opened
        cancelPendingCampActivation()
        const selectionGeneration = campSelectionGeneration.current
        campEventSequenceMarker.current = snapshot.throughGlobalSequence
        const snapshotProject = currentProjectForCamp(snapshot.camp)
        setCurrentProject(snapshotProject)
        persistCurrentProject(snapshotProject)
        setActiveCampId(target.campId)
        setCampSnapshot(snapshot)
        setNotificationFocus(null)
        setView('camp')
        completeStartup(startupSnapshot.sessionId)
        await afterNextPaint()
        if (cancelled || selectionGeneration !== campSelectionGeneration.current) return
        console.info(
          `[startup] trace=${startupTraceId.current} stage=renderer_route_content_paint `
          + `target=camp elapsed_ms=${(performance.now() - startupStartedAt.current).toFixed(1)}`
        )
        console.info(
          `[camp-open] trace=${traceId} stage=renderer_meaningful_paint source=startup `
          + `elapsed_ms=${(performance.now() - startedAt).toFixed(1)}`
        )
        void (async () => {
          await loadNavigation()
          if (cancelled || selectionGeneration !== campSelectionGeneration.current) return
          console.info(
            `[camp-open] trace=${traceId} stage=renderer_background_complete source=startup `
            + `elapsed_ms=${(performance.now() - startedAt).toFixed(1)}`
          )
        })().catch((nextError) => {
          if (!cancelled && selectionGeneration === campSelectionGeneration.current) {
            setError(errorMessage(nextError))
          }
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
    cancelPendingCampActivation,
    completeStartup,
    loadAgents,
    loadNavigation,
    loadOverview,
    requestCampProjection,
    setCampSnapshot,
    startupPrerequisitesReady,
    startupSnapshot
  ])

  useEffect(() => {
    if (startupStatus !== 'resolved' || desktopNavigation.getSnapshot().entries.length) return
    if (environment.navigationHistory?.initial) {
      if (!restoredWebNavigation.current) {
        restoredWebNavigation.current = true
        void desktopNavigation.restore().then(restored => { if (!restored) desktopNavigation.reset({ kind: 'quick_chat' }) })
      }
      return
    }
    const target: NavigationTarget = view === 'camp' && activeCampId
      ? { kind: 'camp', campId: activeCampId }
      : view === 'members' ? { kind: 'members', agentId: restoredMemberId(selectedMemberId, agents), tab: memberTab }
      : view === 'memory' ? memoryTarget
      : { kind: 'quick_chat' }
    desktopNavigation.reset(target)
  }, [startupStatus, desktopNavigation, view, activeCampId, selectedMemberId, agents, memberTab, memoryTarget])

  useEffect(() => {
    if (startupStatus !== 'resolved' || view !== 'compose') return
    void commitRestorableLocation({ kind: 'quick_chat' })
  }, [commitRestorableLocation, startupStatus, view])

  useEffect(() => {
    if (
      startupStatus !== 'resolved'
      || view !== 'camp'
      || !activeCampId
      || campSnapshot?.camp.id !== activeCampId
    ) return
    const activationState = campSnapshot.camp.activationState
    const pendingDraftIsNavigable = activationState === 'pending' && navigation !== null
      && allNavigationCamps(navigation).some((camp) =>
        camp.id === activeCampId && camp.activationState === 'pending'
      )
    if (activationState === 'pending' && !pendingDraftIsNavigable) return
    void commitRestorableLocation({ kind: 'camp', campId: activeCampId })
  }, [activeCampId, campSnapshot, commitRestorableLocation, navigation, startupStatus, view])

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

  useEffect(() => {
    let active = true
    const acceptSnapshot = (snapshot: AppearanceSnapshot): void => {
      applyAppearanceSnapshot(document.documentElement, snapshot)
      if (active) setAppearance(snapshot)
    }
    const unsubscribe = uiPreferences.appearance.onChanged(acceptSnapshot)
    void uiPreferences.appearance.get()
      .then(acceptSnapshot)
      .catch((nextError) => {
        if (active) setError(errorMessage(nextError))
      })
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    if (startupStatus !== 'resolved') return
    if (!shouldLoadRuntimeHealth(
      view,
      settingsSection,
      health !== null,
      healthAttempted
    )) return
    void loadHealth().catch((nextError) => setError(errorMessage(nextError)))
  }, [health, healthAttempted, loadHealth, settingsSection, startupStatus, view])

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
      || !activeCampId
      || campSnapshot?.camp.id !== activeCampId
    ) return undefined
    const campId = activeCampId
    const throughGlobalSequence = campSnapshot.throughGlobalSequence
    if (campSnapshotState.entryPreview) return undefined
    const mission = campSnapshot.camp.missionId
      ? missionList.missions.find(item => item.campId === campId) : null
    const row = (navigation ? allNavigationCamps(navigation).find(camp => camp.id === campId) : null)
      ?? (openedNavigationRow?.id === campId ? openedNavigationRow : null)
      ?? pinnedCampItems.find(camp => camp.id === campId)
    if (campSnapshot.camp.missionId ? !mission?.hasUnread
      : !row || row.latestCompletionGlobalSequence <= (row.lastSeenGlobalSequence ?? 0)
        || row.latestCompletionGlobalSequence > throughGlobalSequence) return undefined
    // Missions use published Agent replies as their existing unread boundary.
    const observedCompletion = mission ? throughGlobalSequence : row!.latestCompletionGlobalSequence
    let cancelled = false
    let retryTimer: number | null = null
    const acknowledgeVisibleCamp = async (): Promise<void> => {
      if (!campViewIsVisibleForReadAcknowledgement(
        view,
        activeCampId,
        campSnapshot.camp.id,
        document.visibilityState,
        document.hasFocus()
      )) return
      if ((campViewedAcknowledgements.current.get(campId) ?? 0) >= observedCompletion) return
      campViewedAcknowledgements.current.set(campId, observedCompletion)
      try {
        const acknowledgement = await client.request<CampViewedAcknowledgement>('navigation.campViewed', {
          campId,
          throughGlobalSequence
        })
        if (mission) void missionList.refresh()
        else navigationRefreshCoordinator.acceptRows(acknowledgement.navigation)
      } catch {
        if (campViewedAcknowledgements.current.get(campId) === observedCompletion) {
          campViewedAcknowledgements.current.delete(campId)
        }
        if (!cancelled) {
          retryTimer = window.setTimeout(() => {
            retryTimer = null
            void acknowledgeVisibleCamp()
          }, 2_500)
        }
      }
    }
    void acknowledgeVisibleCamp()
    window.addEventListener('focus', acknowledgeVisibleCamp)
    document.addEventListener('visibilitychange', acknowledgeVisibleCamp)
    return () => {
      cancelled = true
      if (retryTimer !== null) window.clearTimeout(retryTimer)
      window.removeEventListener('focus', acknowledgeVisibleCamp)
      document.removeEventListener('visibilitychange', acknowledgeVisibleCamp)
    }
  }, [
    activeCampId,
    campSnapshot?.camp.id,
    campSnapshot?.throughGlobalSequence,
    navigation,
    pinnedCampItems,
    openedNavigationRow,
    missionList.missions,
    missionList.refresh,
    campSnapshotState.entryPreview,
    navigationRefreshCoordinator,
    client,
    view
  ])

  useEffect(() => {
    const liveEvents = createLiveRuntimeEventBuffer((batch) => {
      setLiveRuntimeEvents((current) => appendLiveRuntimeEventBatch(current, batch))
    })
    const unsubscribe = client.onEvent?.((event: CoreEvent) => {
      const params = asRecord(event.params)
      if (shuttingDownRef.current) return
      const liveEvent = liveRuntimeEventFromCore(
        event,
        `live-${++liveRuntimeEventSequence.current}`
      )
      if (liveEvent) {
        liveEvents.push(liveEvent)
      }
      if (event.method === 'preferences.new_conversation_changed') {
        void uiPreferences.generalPreferences.get().then(setGeneralPreferences).catch((e) => setError(errorMessage(e)))
      }
      if (event.method === 'members.invalidated' && viewRef.current === 'members') {
        void loadAgents().catch((nextError) => setError(errorMessage(nextError)))
      }
      if (event.method === 'agent_run.terminal') liveEvents.flush()
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
          setError(stringField(params, 'message') ?? '后台服务已停止。')
        } else if (runtimeStatus === 'starting' || runtimeStatus === 'restarting') {
          campViewedAcknowledgements.current.clear()
          setOpenedNavigationRow(null)
          setState('loading')
          setHealth(null)
          setHealthAttempted(false)
        } else if (runtimeStatus === 'ready') {
          void loadOverview().catch(() => undefined)
        }
      }
      if (
        event.method === 'runtime.discovery.updated'
        || event.method === 'runtime.discovery.completed'
        || event.method === 'runtime.availability.updated'
      ) {
        runtimeHealthRefreshIncludesMembers.current ||= event.method !== 'runtime.availability.updated'
        if (runtimeHealthRefreshTimer.current) clearTimeout(runtimeHealthRefreshTimer.current)
        runtimeHealthRefreshTimer.current = setTimeout(() => {
          runtimeHealthRefreshTimer.current = null
          const includeMembers = runtimeHealthRefreshIncludesMembers.current
          runtimeHealthRefreshIncludesMembers.current = false
          void Promise.all([
            loadHealth(),
            includeMembers ? loadMemberData() : loadInstallations()
          ]).catch(() => undefined)
        }, 80)
      }
      if (event.method === 'navigation.invalidated') {
        const reason = stringField(params, 'reason')
        const deletingCampId = stringField(params, 'campId')
        if (reason === 'camps.deletion_attention') {
          void loadCampDeletionIssues().catch(() => undefined)
        }
        if (
          deletingCampId
          && (
            reason === 'camps.delete_accepted'
            || reason === 'camp.deleted'
            || reason === 'camps.deletion_attention'
          )
        ) {
          hideAcceptedCampDeletion(deletingCampId)
        }
      }
      if (shouldRefreshNavigationForCoreEvent(event, shuttingDownRef.current)) {
        void navigationRefreshCoordinator.invalidate({
          scope: params.scope === 'camp' || params.scope === 'group' ? params.scope : 'all',
          campId: stringField(params, 'campId') ?? undefined,
          groupKeys: Array.isArray(params.groupKeys) ? params.groupKeys.filter((key): key is string => typeof key === 'string') : undefined
        }).catch(() => undefined)
      }
      const campId = activeCampIdRef.current
      const refresh = campId && deletingCampIdsRef.current.has(campId)
        ? null
        : refreshActiveCampForCoreEvent(
            event,
            campId,
            activeCampRefreshCoordinator,
            shuttingDownRef.current
          )
      if (refresh && campId) {
        void refresh.catch((nextError) => {
          if (activeCampIdRef.current === campId) setError(errorMessage(nextError))
        })
      }
    })
    return () => { unsubscribe?.(); liveEvents.dispose() }
  }, [
    activeCampRefreshCoordinator,
    loadHealth,
    loadInstallations,
    loadAgents,
    loadMemberData,
    loadOverview,
    loadCampDeletionIssues,
    navigationRefreshCoordinator
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
    visibleNavigation,
    currentProject,
    currentWorkspaceHint
  ), projectNames)
  const activeCamp = navigation
    ? allNavigationCamps(navigation).find((camp) => camp.id === activeCampId) ?? null
    : null
  const selectedCurrentProject = currentProjectGroup(displayNavigation, currentProject)
  const shellOnlyCurrentProjectPath = selectedCurrentProject
    && !currentProjectGroup(navigation, currentProject)
    ? selectedCurrentProject.projectPath
    : null
  const currentProjectKey = selectedCurrentProject?.projectKey ?? 'quick-chat'
  const currentProjectLabel = selectedCurrentProject?.name ?? '快速对话'
  const activeProjectPath = activeCamp?.projectBindingKind === 'directory'
    ? activeCamp.projectPath
    : campSnapshot?.camp.id === activeCampId
      && campSnapshot.camp.projectBindingKind === 'directory'
      ? campSnapshot.camp.projectPath
      : null
  const activeCampProject = activeProjectPath && displayNavigation
    ? displayNavigation.projects.find((project) => project.projectPath === activeProjectPath) ?? null
    : null
  const activeCampTitle = activeCamp
    ? formatCampTitle(activeCamp)
    : campSnapshot?.camp.id === activeCampId ? formatCampTitle(campSnapshot.camp) : ''
  const activeCampContextLabel = activeCampProject?.name
    ?? (activeProjectPath === currentProjectPath ? currentProjectLabel : '快速对话')
  const activeCancellingTurnIds = useMemo(
    () => campSnapshot?.camp.id === activeCampId
      ? effectiveCancellingTurnIds(cancellingTurnIds, campSnapshot)
      : new Set<string>(),
    [activeCampId, campSnapshot, cancellingTurnIds]
  )
  const activeCampStopping = activeCancellingTurnIds.size > 0
  const activeOptimisticMessages = useMemo(
    () => optimisticCampMessages.filter((entry) => entry.campId === activeCampId).map((entry) => entry.message),
    [activeCampId, optimisticCampMessages]
  )
  const activeCancellingRunIds = useMemo(
    () => campSnapshot?.camp.id === activeCampId
      ? effectiveCancellingRunIds(cancellingRunIds, campSnapshot)
      : new Set<string>(),
    [activeCampId, campSnapshot, cancellingRunIds]
  )
  const activeConfirmingRunIds = useMemo(
    () => campSnapshot?.camp.id === activeCampId
      ? reconcileRunCancellationIds(confirmingRunIds, campSnapshot)
      : new Set<string>(),
    [activeCampId, campSnapshot, confirmingRunIds]
  )

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    if (client.onInvalidated || !activeCampId || campSnapshot?.camp.id !== activeCampId) return undefined
    const campId = activeCampId

    const refreshSnapshot = async (): Promise<void> => {
      const { snapshot } = await requestCampProjection(campId, 'open')
      if (cancelled) return
      if (snapshot.throughGlobalSequence < campEventSequenceMarker.current) return
      campEventSequenceMarker.current = snapshot.throughGlobalSequence
      setCampSnapshot(snapshot)
      setConfirmingRunIds((current) => reconcileRunCancellationIds(current, snapshot))
    }

    const poll = async (): Promise<void> => {
      try {
        const batch = await client.request<EventBatch>('events.subscribe', {
          campId,
          afterGlobalSequence: campEventSequenceMarker.current,
          limit: 250
        })
        if (cancelled) return
        const reviewItemCreated = batch.events.some((event) =>
          event.eventType === 'memory.hearth_review_created'
        )
        const autoAppliedEvents = batch.events.filter((event) =>
          event.eventType === 'memory.agent_created' || event.eventType === 'memory.agent_revised'
        )
        if (reviewItemCreated || autoAppliedEvents.length > 0) {
          if (reviewItemCreated) setMemoryReviewNotice(true)
          if (autoAppliedEvents.length > 0) {
            const lastPayload = asRecord(autoAppliedEvents.at(-1)?.payload)
            const lastMemoryId = typeof lastPayload.memoryId === 'string'
              ? lastPayload.memoryId
              : null
            const lastScope = lastPayload.scope === 'companion' || lastPayload.scope === 'relationship'
              ? lastPayload.scope
              : null
            setMemoryAutoNotice((current) => ({
              count: current.count + autoAppliedEvents.length,
              memoryId: lastMemoryId ?? current.memoryId,
              scope: lastScope ?? current.scope
            }))
          }
          setMemoryRefreshKey((current) => current + 1)
          void client.request<HearthReviewItem[]>('memory.hearthReviewItems.list')
            .then((reviewItems) => setPendingMemoryCount(
              reviewItems.filter((reviewItem) => reviewItem.status === 'pending').length
            ))
            .catch(() => undefined)
        }
        if (batch.schemaVersion !== 9 || batch.resetRequired || batch.events.length > 0) {
          await refreshSnapshot()
        } else {
          campEventSequenceMarker.current = batch.nextGlobalSequence
        }
      } catch (nextError) {
        if (!cancelled) setError(errorMessage(nextError))
      } finally {
        if (!cancelled) timer = setTimeout(() => void poll(), 1_400)
      }
    }

    void poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [activeCampId, campSnapshot?.camp.id, requestCampProjection, setCampSnapshot])

  useEffect(() => client.onInvalidated?.(() => {
    campViewedAcknowledgements.current.clear()
    setOpenedNavigationRow(null)
    void uiPreferences.generalPreferences.get().then(setGeneralPreferences).catch((e) => setError(errorMessage(e)))
    void loadNavigation('invalidation').catch(() => undefined)
    void loadCampDeletionIssues().catch(() => undefined)
    const campId = activeCampIdRef.current
    if (campId && !deletingCampIdsRef.current.has(campId)) {
      void activeCampRefreshCoordinator.refresh(campId).catch((e) => setError(errorMessage(e)))
    }
    void loadAgents().catch(() => undefined)
  }), [client, uiPreferences, loadNavigation, loadCampDeletionIssues, loadAgents, activeCampRefreshCoordinator])

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
    preferences = generalPreferences
  ): void => {
    setNewConversationInitialWorkspace(workspace)
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
      // Another device may have changed the team since this page mounted.
      const preferences = await uiPreferences.generalPreferences.get()
      if (!intent.isCurrent()) return 'ignored'
      setGeneralPreferences(preferences)
      const defaults = resolveAvailableNewConversationDefaults(preferences, agents)
      if (preferences.oneClickNewConversationEnabled && defaults) {
        try {
          await createCamp({
            name: null,
            workspace: workspace ? { projectPath: workspace.projectPath } : null,
            memberAgentIds: defaults.defaults.memberAgentIds,
            defaultLeadAgentId: defaults.defaults.defaultLeadAgentId,
            collaborationMode: 'peer',
            activationState: campActivationStateForCreation('one_click')
          }, false, intent)
          return 'created'
        } catch (nextError) {
          if (!intent.isCurrent()) return 'ignored'
          openNewConversation(workspace, `一键创建未完成：${errorMessage(nextError)} 请重新确认项目、队员与默认负责人。`, preferences)
          return 'dialog'
        }
      }
      openNewConversation(workspace, null, preferences)
      return 'dialog'
    } catch (nextError) {
      if (!intent.isCurrent()) return 'ignored'
      setError(`默认队员设置读取失败：${errorMessage(nextError)}`)
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
    if (!removedProjectAuthorityReady) return
    setError(null)
    try {
      await selectProjectDirectory(
        chooseWorkspaceDirectory,
        restoreNavigationProject,
        chooseCurrentProject
      )
    } catch (nextError) {
      setError(errorMessage(nextError))
    }
  }

  const requestMemberTransition = useCallback((
    action: () => void | Promise<void>
  ): Promise<boolean> => {
    if (viewRef.current !== 'members') {
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
      : nextView === 'memory' ? { kind: 'memory', memoryId: null }
      : nextView === 'automations' ? { kind: 'automations' }
      : nextView === 'missions' ? { kind: 'missions' }
      : nextView === 'camp' && activeCampId ? { kind: 'camp', campId: activeCampId }
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
      setMemoryReviewNotice(false)
      setMemoryReviewDrawerSignal((current) => current + 1)
    }
    if (viewRef.current === 'memory') showReviews()
    else void desktopNavigation.push({ kind: 'memory', memoryId: null }, { beforeCommit: showReviews })
  }

  const openAutomaticMemory = (): void => {
    const clearNotice = (): void => setMemoryAutoNotice({ count: 0, memoryId: null, scope: null })
    if (viewRef.current === 'memory' && memoryTarget.memoryId === memoryAutoNotice.memoryId) clearNotice()
    else void desktopNavigation.push({ kind: 'memory', memoryId: memoryAutoNotice.memoryId }, { beforeCommit: clearNotice })
  }

  const closeSettings = (): void => { void desktopNavigation.push(lastMainTarget.current) }

  const chooseSettingsSection = (section: SettingsSection): void => {
    if (viewRef.current === 'settings') void desktopNavigation.push({ kind: 'settings', section })
    void uiPreferences.generalPreferences.setLastSettingsSection(section)
      .then(setGeneralPreferences)
      .catch((nextError) => setError(errorMessage(nextError)))
  }

  const navigateToSettings = async (section: SettingsSection): Promise<boolean> => {
    await desktopNavigation.push({ kind: 'settings', section })
    const current = desktopNavigation.getSnapshot()
    const target = current.entries[current.index]
    return target?.kind === 'settings' && target.section === section
  }

  applyNavigationRef.current = async (target, transaction, context) => {
    if (shuttingDownRef.current) return
    // Invalidate older Camp reads immediately, including reads waiting behind a leave guard.
    const selectionGeneration = ++campSelectionGeneration.current
    clearCampOpenFeedback()
    const apply = async (): Promise<void> => {
      if (!transaction.isCurrent()) return
      if (target.kind === 'camp') {
        if (viewRef.current === 'camp' && activeCampIdRef.current === target.campId) {
          transaction.commit()
          return
        }
        await activateCampWithoutLeaveGuard(target.campId, context?.campOptions ?? {}, selectionGeneration, transaction)
        return
      }
      const previous = desktopNavigation.getSnapshot()
      if (target.kind === 'settings' && viewRef.current !== 'settings') {
        lastMainTarget.current = previous.entries[previous.index] ?? { kind: 'quick_chat' }
      }
      if (!transaction.commit()) return
      context?.beforeCommit?.()
      setNotificationFocus(null)
      switch (target.kind) {
        case 'settings': setSettingsSection(target.section); setMobileSettingsList(target.overview === true); setView('settings'); break
        case 'members':
          membersViewRef.current?.showSelectedMember()
          setSelectedMemberId(target.agentId); setMemberTab(target.tab); setView('members'); break
        case 'memory': setMemoryTarget(target); setView('memory'); break
        case 'automations': setView('automations'); break
        case 'missions': setView('missions'); break
        case 'quick_chat': setView('compose'); break
      }
    }
    const leave = async (): Promise<void> => {
      if (!transaction.isCurrent()) return
      const sameSurface = target.kind === viewRef.current
        && (target.kind !== 'camp' || target.campId === activeCampIdRef.current)
      if (context?.prepared || sameSurface) await apply()
      else await leaveActiveSurface(() => Promise.race([apply(), transaction.superseded]))
    }
    try {
      if (viewRef.current === 'members' && target.kind !== 'members' && !context?.prepared && !context?.memberPrepared) await requestMemberTransition(leave)
      else await leave()
    } catch (nextError) {
      if (transaction.isCurrent()) setError(errorMessage(nextError))
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
      releaseSection.scrollIntoView({ block: 'start' })
      return Boolean(heading)
    } catch (nextError) {
      setError(`无法打开更新内容：${errorMessage(nextError)}`)
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
      cancelPendingCampActivation()
      await requestNewConversation(currentProjectWorkspace(displayNavigation, currentProject))
    })
  }

  const chooseCamp = (camp: NavigationCampTarget): void => {
    void activateCamp(camp.id, { reconcileDefaultLead: camp.activationState !== 'pending' })
  }

  const navigateFromNotification = useCallback(async (
    _episode: NotificationEpisodeView,
    action: NotificationActionView
  ): Promise<NotificationNavigationResult> => {
    let result: NotificationNavigationResult = {
      status: 'failed',
      message: '当前页面尚未完成切换，请稍后重试。'
    }
    let transitionActionCompleted = false
    const transitioned = await requestMemberTransition(async () => {
      try {
        if (!action.available) {
          result = {
            status: 'failed',
            message: '这个来源当前不可用。你可以显式选择卡片上的其他动作。'
          }
          return
        }
        if (action.kind === 'open_single_chat') {
          const source = action.singleChat
          if (!source) throw new Error('单聊通知缺少原始对话标识。')
          const snapshot = await client.request<import('@contracts').SingleChatSnapshot | null>('singleChat.get', {
            conversationId: source.conversationId
          })
          if (!snapshot || snapshot.conversation.id !== source.conversationId || snapshot.conversation.status !== 'active'
            || snapshot.conversation.campId !== action.campId
            || snapshot.conversation.agentId !== source.agentId
            || !snapshot.agentRuns.some((run) => run.id === source.agentRunId)) {
            throw new Error('原单聊已结束或来源不可用。')
          }
          if (action.approvalId && !snapshot.approvals.some((approval) => approval.id === action.approvalId && approval.status === 'pending')) {
            throw new Error('这项审批已经处理。')
          }
        }
        let anchoredMessages: readonly CampMessageView[] = []
        let anchoredAgentRuns: readonly AgentRunView[] = []
        if (action.kind === 'open_camp_message') {
          if (!action.messageId) {
            result = {
              status: 'failed',
              message: '消息动作没有可用的精确定位目标。'
            }
            return
          }
          const around = await client.request<CampMessageAroundSnapshot>(
            'camp.messages.around',
            {
              campId: action.campId,
              messageId: action.messageId
            }
          )
          if (
            around.schemaVersion !== 1
            || around.campId !== action.campId
            || around.anchorMessageId !== action.messageId
          ) throw new Error('消息定位合同不兼容。')
          if (!around.sourceAvailable) {
            result = {
              status: 'failed',
              message: '原消息已删除或暂时不可用。通知仍保留在“全部”列表中。'
            }
            return
          }
          if (!around.messages.some((message) => message.id === action.messageId)) {
            throw new Error('消息定位结果未包含目标消息。')
          }
          anchoredMessages = around.messages
        }
        if (action.kind === 'open_agent_run') {
          if (!action.agentRunId) {
            result = {
              status: 'failed',
              message: '执行动作没有可用的精确定位目标。'
            }
            return
          }
          const availableSnapshot = campSnapshotRef.current?.camp.id === action.campId
            ? campSnapshotRef.current
            : campSnapshotCache.current.get(action.campId) ?? null
          let run = availableSnapshot?.agentRuns.find(({ id }) => id === action.agentRunId) ?? null
          if (!run) {
            const fullSnapshot = await client.request<CampSnapshot>('camps.snapshot', {
              campId: action.campId
            })
            if (fullSnapshot.schemaVersion !== 34 || fullSnapshot.camp.id !== action.campId) {
              throw new Error('执行定位合同不兼容。')
            }
            run = fullSnapshot.agentRuns.find(({ id }) => id === action.agentRunId) ?? null
          }
          if (!run) {
            result = {
              status: 'failed',
              message: '原执行已删除或暂时不可用。通知仍保留在“全部”列表中。'
            }
            return
          }
          anchoredAgentRuns = [run]
        }
        const target: NotificationFocusTarget | null = action.kind === 'open_single_chat' && action.singleChat
          ? { requestId: ++notificationFocusSequence.current, kind: 'single_chat',
            conversationId: action.singleChat.conversationId, agentRunId: action.singleChat.agentRunId,
            campTurnId: action.campTurnId, approvalId: action.approvalId ?? undefined }
          : action.kind === 'open_camp_message'
          ? action.messageId
            ? {
              requestId: ++notificationFocusSequence.current,
              kind: 'camp_message',
              campTurnId: action.campTurnId,
              messageId: action.messageId
            }
            : null
          : action.kind === 'open_approval'
            ? {
              requestId: ++notificationFocusSequence.current,
              kind: 'approval',
              campTurnId: null,
              approvalId: action.approvalId ?? undefined
            }
          : action.kind === 'open_camp_turn' && action.campTurnId
            ? {
              requestId: ++notificationFocusSequence.current,
              kind: 'camp_turn',
              campTurnId: action.campTurnId
            }
          : action.kind === 'open_agent_run' && action.agentRunId
            ? {
              requestId: ++notificationFocusSequence.current,
              kind: 'agent_run',
              agentRunId: action.agentRunId,
              campTurnId: null
            }
            : null
        setNotificationFocus(target ? { ...target, active: false } : null)
        const activated = await activateCamp(action.campId, {
          memberPrepared: true,
          preserveNotificationFocus: target !== null,
          missionPresentation: 'drawer',
          reconcileDefaultLead: true,
          suppressErrors: true,
          anchoredMessages,
          anchoredAgentRuns
        })
        if (!activated) {
          result = {
            status: 'failed',
            message: '暂时无法打开通知来源。通知仍保留，可稍后重试。'
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
            message: '已打开会话，但原消息未能呈现。通知仍保留，可稍后重试。'
          }
          return
        }
        if (action.kind === 'open_single_chat' && action.singleChat && target) {
          setSingleChatNotificationTarget({ ...action.singleChat, requestId: target.requestId })
          setSingleChatCampId(action.campId)
        } else setSingleChatCampId(null)
        result = { status: 'navigated' }
      } catch (nextError) {
        result = {
          status: 'failed',
          message: `暂时无法打开通知来源：${errorMessage(nextError)}`
        }
      } finally {
        transitionActionCompleted = true
      }
    })
    return transitioned || transitionActionCompleted ? result : {
      status: 'failed',
      message: '请先处理当前队员页面中尚未保存的更改，再打开这条通知。'
    }
  }, [activateCamp, requestMemberTransition])

  const presentNotificationNavigation = useCallback(async (
    _episode: NotificationEpisodeView,
    action: NotificationActionView
  ): Promise<boolean> => {
    if (activeCampIdRef.current !== action.campId || viewRef.current !== 'camp') return false
    if (action.kind === 'open_camp') return true
    const focus = notificationFocusRef.current
    if (!focus || !notificationFocusMatchesAction(focus, action)) return false
    const coordinator = notificationPresentationRef.current
    if (!coordinator) return false
    const presentation = coordinator.waitFor(focus.requestId)
    setNotificationFocus((current) => current?.requestId === focus.requestId
      ? { ...current, active: true }
      : current)
    return presentation
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
    camp?: NavigationCampItem
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
        setPinnedCampItems((current) => existing
          ? current.filter((item) => item.id !== targetKey)
          : [
              ...current.filter((item) => item.id !== targetKey),
              camp ?? (navigation ? allNavigationCamps(navigation).find((item) => item.id === targetKey) : undefined)
            ].filter((item): item is NavigationCampItem => Boolean(item)))
      }
    } catch (nextError) {
      setError(errorMessage(nextError))
    }
  }

  const removeNavigationProject = async (
    project: ProjectNavigationGroup
  ): Promise<void> => {
    const activeSnapshot = campSnapshotRef.current
    const removingActiveCamp = activeSnapshot?.camp.id === activeCampIdRef.current
      && activeSnapshot.camp.projectBindingKind === 'directory'
      && activeSnapshot.camp.projectPath === project.projectPath
    const remove = async (): Promise<void> => {
      setBusy(`remove-project-${project.projectKey}`)
      setError(null)
      try {
        const relatedPinnedCampIds = pinnedCampItems
          .filter((camp) => (
            camp.projectBindingKind === 'directory'
            && camp.projectPath === project.projectPath
          ))
          .map((camp) => camp.id)
        const snapshot = await uiPreferences.navigationPreferences.removeProject(
          project.projectKey,
          relatedPinnedCampIds
        )
        applyNavigationPreferences(snapshot)
        setPinnedCampItems((current) => current.filter((camp) => !(
          camp.projectBindingKind === 'directory'
          && camp.projectPath === project.projectPath
        )))

        const removingCurrent = currentProject.kind === 'directory'
          && currentProject.projectPath === project.projectPath
        if (removingCurrent) {
          const fallback: CurrentProject = { kind: 'quick_chat' }
          setCurrentProject(fallback)
          setCurrentWorkspaceHint(null)
          persistCurrentProject(fallback)
        }
        if (removingActiveCamp) {
          if (activeCampId) forgetRemovedCampSurface(activeCampId)
          setNotificationFocus(null)
        }
        if (removingCurrent || removingActiveCamp) {
          await commitRestorableLocation({ kind: 'quick_chat' })
        }
        notify(`已从侧栏移除“${project.name}”`)
      } finally {
        setBusy(null)
      }
    }
    if (removingActiveCamp) {
      const transitioned = await leaveActiveSurface(remove)
      if (!transitioned) {
        throw new Error('当前输入操作尚未完成，项目未从侧栏移除。请重试。')
      }
    } else {
      await remove()
    }
  }

  const renameProject = async (project: ProjectNavigationGroup, name: string | null): Promise<void> => {
    // Invalidate older Overview reads; order/pin responses never own display names.
    ++projectNamesGeneration.current
    const snapshot = await uiPreferences.navigationPreferences.setProjectName(project.projectKey, name)
    setProjectNames(snapshot.projectNames)
    notify('项目名称已保存')
  }

  const renameCamp = async (camp: NavigationCampItem, title: string): Promise<void> => {
    setBusy(`rename-camp-${camp.id}`)
    setError(null)
    try {
      const result = await client.request<StoredCommandResult>('camps.rename', {
        commandId: newCommandId(),
        command: {
          campId: camp.id,
          title,
          expectedVersion: camp.version
        }
      })
      if (result.status === 'rejected') throw new Error(commandFailureMessage(result))
      await Promise.all([
        navigationRefreshCoordinator.refreshCamps([camp.id], 'explicit'),
        activeCampId === camp.id ? refreshActiveCampSnapshot(camp.id) : Promise.resolve()
      ])
    } finally {
      setBusy(null)
    }
  }

  const deleteCampWithoutAutomationLeaveGuard = async (camp: NavigationCampItem): Promise<void> => {
    setBusy(`delete-camp-${camp.id}`)
    setError(null)
    try {
      const result = await client.request<StoredCommandResult>('camps.delete', {
        commandId: newCommandId(),
        command: campDeleteCommand(camp)
      })
      if (result.status === 'rejected') throw new Error(commandFailureMessage(result))
      hideAcceptedCampDeletion(camp.id)
      void navigationRefreshCoordinator.refreshGroups([camp.projectBindingKind === 'directory' ? `directory:${camp.projectPath}` : 'quick-chat']).catch(() => undefined)
    } finally {
      setBusy(null)
    }
  }

  const deleteCamp = async (camp: NavigationCampItem): Promise<void> => {
    if (viewRef.current === 'automations' && activeCampIdRef.current === camp.id) {
      await leaveActiveAutomation(() => deleteCampWithoutAutomationLeaveGuard(camp))
      return
    }
    await deleteCampWithoutAutomationLeaveGuard(camp)
  }

  const cancelAgentRun = async (run: AgentRunView): Promise<void> => {
    const campId = activeCampId
    if (!campId || campSnapshotRef.current?.camp.id !== campId) return
    setError(null)
    setConfirmingRunIds((current) => {
      const next = new Set(current)
      next.delete(run.id)
      return next
    })
    setCancellingRunIds((current) => new Set(current).add(run.id))

    let result: StoredCommandResult
    try {
      result = await client.request<StoredCommandResult>('agentRuns.cancel', {
        commandId: newCommandId(),
        command: {
          campId,
          agentRunId: run.id,
          expectedVersion: run.version
        }
      })
    } catch {
      setCancellingRunIds((current) => {
        const next = new Set(current)
        next.delete(run.id)
        return next
      })
      setConfirmingRunIds((current) => new Set(current).add(run.id))
      try {
        const { snapshot } = await requestCampProjection(campId, 'open')
        if (activeCampIdRef.current === campId) {
          campEventSequenceMarker.current = Math.max(
            campEventSequenceMarker.current,
            snapshot.throughGlobalSequence
          )
          setCampSnapshot(snapshot)
        }
        setConfirmingRunIds((current) => reconcileRunCancellationIds(current, snapshot))
      } catch {
        // Keep the uncertainty projection until a later authoritative Camp refresh converges it.
      }
      return
    }

    if (result.status === 'rejected') {
      setCancellingRunIds((current) => {
        const next = new Set(current)
        next.delete(run.id)
        return next
      })
      setConfirmingRunIds((current) => {
        const next = new Set(current)
        next.delete(run.id)
        return next
      })
      try {
        await refreshActiveCampSnapshot(campId)
      } catch {
        // The deterministic command result remains authoritative even if this refresh fails.
      }
      setError(commandFailureMessage(result))
      return
    }

    if (campSnapshotRef.current?.camp.id === campId) {
      setCampSnapshot(applyCancellationResult(campSnapshotRef.current, result))
    }
    setCancellingRunIds((current) => new Set([...current].filter((id) => id !== run.id)))
    setConfirmingRunIds((current) => new Set([...current].filter((id) => id !== run.id)))
    try {
      await refreshActiveCampSnapshot(campId)
    } catch {
      // Core's terminal response already clears stopping; the next poll fills in the rest.
    }
  }

  const changeDefaultLead = async (agentId: string): Promise<void> => {
    if (!activeCampId || campSnapshot?.camp.id !== activeCampId) return
    setBusy('change-default-lead')
    setError(null)
    try {
      const result = await client.request<StoredCommandResult>('camps.changeDefaultLead', {
        commandId: newCommandId(),
        command: {
          campId: activeCampId,
          successorAgentId: agentId,
          expectedVersion: campSnapshot.camp.version
        }
      })
      if (result.status === 'rejected') throw new Error(commandFailureMessage(result))
      await Promise.all([
        refreshActiveCampSnapshot(activeCampId),
        navigationRefreshCoordinator.refreshCamps([activeCampId], 'explicit')
      ])
    } catch (nextError) {
      setError(errorMessage(nextError))
      throw nextError
    } finally {
      setBusy(null)
    }
  }

  const addCampMembers = async (agentIds: string[]): Promise<CampMemberAddOutcome> => {
    const campId = activeCampIdRef.current
    const currentSnapshot = campSnapshotRef.current
    if (!campId || currentSnapshot?.camp.id !== campId) {
      throw new Error('当前会话尚未准备好。')
    }
    setBusy('camp-membership')
    setError(null)
    const outcome: CampMemberAddOutcome = {
      addedAgentIds: [],
      unchangedAgentIds: [],
      failures: []
    }
    let membershipGeneration = currentSnapshot.camp.membershipGeneration
    try {
      for (let index = 0; index < agentIds.length; index += 1) {
        const agentId = agentIds[index]
        try {
          const result = await client.request<StoredCommandResult>('camps.members.add', {
            commandId: newCommandId(),
            command: {
              campId,
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
                  message: '名册已发生变化，请在刷新后重试。'
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
          refreshActiveCampSnapshot(campId),
          navigationRefreshCoordinator.refreshCamps([campId], 'explicit')
        ])
      } catch {
        // The per-command outcomes are authoritative; normal event refresh will converge the surface.
      }
      return outcome
    } finally {
      setBusy(null)
    }
  }

  const previewCampMemberRemoval = async (agentId: string): Promise<CampMemberRemovalPreview> => {
    const campId = activeCampIdRef.current
    if (!campId || campSnapshotRef.current?.camp.id !== campId) {
      throw new Error('当前会话尚未准备好。')
    }
    const preview = await client.request<CampMemberRemovalPreview | null>(
      'camps.members.removalPreview',
      { campId, agentId }
    )
    if (!preview) throw new Error('这位队员已不在当前会话中。')
    return preview
  }

  const removeCampMember = async (
    preview: CampMemberRemovalPreview
  ): Promise<CampMemberRemoveOutcome> => {
    const campId = activeCampIdRef.current
    if (!campId || preview.campId !== campId || campSnapshotRef.current?.camp.id !== campId) {
      return { status: 'conflict', message: '当前会话已发生变化，请重新读取影响。' }
    }
    setBusy('camp-membership')
    setError(null)
    try {
      const result = await client.request<StoredCommandResult>('camps.members.remove', {
        commandId: newCommandId(),
        command: {
          campId,
          agentId: preview.agentId,
          expectedMembershipGeneration: preview.membershipGeneration,
          expectedMembershipVersion: preview.membershipVersion,
          replacementDefaultLeadAgentId: preview.nextDefaultLeadAgentId,
          reason: 'removed_from_camp'
        }
      })
      if (result.status === 'rejected') {
        try {
          await refreshActiveCampSnapshot(campId)
        } catch {
          // Keep the deterministic command result when the follow-up projection is unavailable.
        }
        return {
          status: membershipConflictCode(result.code) ? 'conflict' : 'failed',
          message: commandFailureMessage(result)
        }
      }
      try {
        await Promise.all([
          refreshActiveCampSnapshot(campId),
          navigationRefreshCoordinator.refreshCamps([campId], 'explicit')
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
      return { status: 'failed', message: errorMessage(error) }
    } finally {
      setBusy(null)
    }
  }

  async function createCamp(
    draft: Omit<CreateCampRequest, 'commandId'>,
    enableOneClick = false,
    intent: NavigationIntent = desktopNavigation.beginIntent()
  ): Promise<void> {
    cancelPendingCampActivation()
    setBusy('create-camp')
    try {
      if (draft.workspace) {
        await restoreNavigationProject(draft.workspace.projectPath)
      }
      const result = await client.request<StoredCommandResult>('camps.create', {
        commandId: newCommandId(),
        ...draft
      })
      if (result.status === 'rejected') throw new Error(commandFailureMessage(result))
      const campId = stringField(result.payload, 'campId')
      if (!campId) throw new Error('会话已创建，但暂时无法打开。请刷新会话列表后重试。')
      setNewConversationOpen(false)
      let preferencesSaveFailed = false
      if (enableOneClick) {
        try {
          const saved = await uiPreferences.generalPreferences.setNewConversationDefaults({
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
          await activateCamp(campId, { reconcileDefaultLead: false, initializeComposerDraft: true })
        } else {
          // Core owns the created Camp. Refresh its visibility without stealing focus;
          // empty one-click drafts still follow the existing pending-Camp lifecycle.
          await navigationRefreshCoordinator.invalidate({ scope: 'group', campId })
        }
      } finally {
        if (preferencesSaveFailed) {
          notifyError('对话已创建，但默认队伍与一键新建设置未保存。可在「设置 → 通用」重试。')
        }
      }
    } finally {
      setBusy(null)
    }
  }

  function forgetRemovedCampSurface(campId: string): void {
    if (activeCampIdRef.current !== campId) return
    setActiveCampId(null)
    setCampSnapshot(null)
    const current = desktopNavigation.getSnapshot()
    const target = current.entries[current.index]
    if (viewRef.current === 'camp' && target?.kind === 'camp' && target.campId === campId) {
      // Correct the displayed resource without invalidating a newer Camp read.
      if (desktopNavigation.captureCurrentEntry().update({ kind: 'quick_chat' })) setView('compose')
    }
  }

  function hideAcceptedCampDeletion(campId: string): void {
    deletingCampIdsRef.current.add(campId)
    const currentNavigation = navigationSnapshotRef.current
    if (currentNavigation) {
      const nextNavigation = navigationWithoutDeletedCamps(
        currentNavigation,
        deletingCampIdsRef.current
      )
      navigationSnapshotRef.current = nextNavigation
      setNavigation(nextNavigation)
    }
    setPinnedCampItems((current) => current.filter((camp) => camp.id !== campId))
    clearLocalCampComposerDraft(campId)
    const discardComposerAttachments = client.composerAttachments.discard?.(campId)
    if (discardComposerAttachments) void discardComposerAttachments.catch(() => undefined)
    forgetFilePreviewSession(campId, activeCampIdRef.current === campId)
    campSnapshotCache.current.delete(campId)
    forgetRemovedCampSurface(campId)
  }

  const refreshPendingCampNavigation = (): void => {
    const campId = activeCampIdRef.current
    if (campId) void navigationRefreshCoordinator.invalidate({ scope: 'group', campId }).catch(() => undefined)
  }

  const settlePendingCampOnLeave = async (draft: CampComposerDraftView): Promise<void> => {
    if (draft.body.trim() || draft.attachments.length > 0 || draft.replyIntent) {
      await navigationRefreshCoordinator.invalidate({ scope: 'group', campId: draft.campId })
      return
    }
    const result = await client.request<StoredCommandResult>('camps.discardPending', {
      commandId: newCommandId(),
      command: { campId: draft.campId }
    })
    if (result.status === 'rejected' && result.code !== 'camp.pending_not_empty') {
      throw new Error(commandFailureMessage(result))
    }
    if (result.status !== 'rejected') campSnapshotCache.current.delete(draft.campId)
    if (result.status !== 'rejected') forgetRemovedCampSurface(draft.campId)
    await navigationRefreshCoordinator.invalidate({ scope: 'group', campId: draft.campId })
  }

  const sendCampMessage = async (
    draft: CampComposerDraftView
  ): Promise<CampMessageSendReceipt | void> => {
    const hasReadyAttachment = draft.attachments.length > 0
    const hasSendablePayload = composerHasSendablePayload(draft.body, hasReadyAttachment)
    if (!activeCampId || draft.campId !== activeCampId || !hasSendablePayload || draft.revision < 1) return
    const campId = activeCampId
    const commandId = newCommandId()
    const selectionGeneration = campSelectionGeneration.current
    const optimisticMessage = optimisticCampMessage(
      campSnapshot?.camp.id === campId ? campSnapshot : null,
      commandId,
      draft
    )
    // Core decides direct publication versus private queue admission. Never expose
    // a pending input as an optimistic public CampMessage before that decision.
    setBusy('camp-message')
    setError(null)
    setToast((current) => current?.persistent ? current : null)
    setRuntimeRecovery((current) => current?.campId === campId ? null : current)
    let rejectedForRuntime = false
    try {
      const result = await client.request<SendCampMessageResult>(
        'camp.messages.send',
        campMessageSendParams(commandId, campId, draft)
      )
      if (!result.commandResult) {
        throw new Error('消息提交结果暂时不可用，请稍后重试。')
      }
      if (result.commandResult.status === 'rejected') {
        const recovery = runtimeRecoveryFromCommandResult(campId, result.commandResult)
        if (recovery) {
          rejectedForRuntime = true
          setRuntimeRecovery(recovery)
        }
        throw new Error(commandFailureMessage(result.commandResult))
      }
      const campMessageId = stringField(result.commandResult.payload, 'campMessageId')
      const deliveryIds = stringArrayField(result.commandResult.payload, 'deliveryIds')
      const agentRunIds = stringArrayField(result.commandResult.payload, 'agentRunIds')
      const sequence = typeof result.commandResult.payload.sequence === 'number'
        ? result.commandResult.payload.sequence
        : optimisticMessage.sequence
      if (campMessageId) {
        setOptimisticCampMessages((current) => [...current, {
          campId, commandId,
          message: { ...optimisticMessage, id: campMessageId, sequence, campTurnId: null }
        }])
        void refreshActiveCampSnapshot(campId)
          .then(async () => {
            if (selectionGeneration !== campSelectionGeneration.current) return
            setOptimisticCampMessages((current) =>
              current.filter((entry) => entry.commandId !== commandId)
            )
            if (selectionGeneration === campSelectionGeneration.current) await navigationRefreshCoordinator.invalidate({ scope: 'group', campId })
          })
          .catch((nextError) => setError(errorMessage(nextError)))
      }
      return {
        ...(campMessageId ? { campMessageId } : {}),
        ...(campMessageId && typeof result.commandResult.payload.sequence === 'number'
          ? { publishedMessageSequence: sequence } : {}),
        deliveryIds,
        agentRunIds,
        addressedAgentIds: optimisticMessage.addressedAgentIds
      }
    } catch (nextError) {
      setOptimisticCampMessages((current) =>
        current.filter((entry) => entry.commandId !== commandId)
      )
      if (!rejectedForRuntime) notify(errorMessage(nextError))
      throw nextError
    } finally {
      setBusy(null)
    }
  }

  const withdrawCampMessage = async (message: CampMessageView): Promise<void> => {
    const campId = activeCampIdRef.current
    if (!campId || message.id.startsWith('optimistic:') || !message.canWithdraw) return
    const result = await client.request<StoredCommandResult>('camp.messages.withdraw', {
      commandId: newCommandId(),
      command: {
        campId,
        messageId: message.id,
        expectedVersion: message.version
      }
    })
    if (result.status === 'rejected') throw new Error(commandFailureMessage(result))
    setOptimisticCampMessages((current) => current.filter((entry) => entry.message.id !== message.id))
    await refreshActiveCampSnapshot(campId)
  }

  const resolveActionApproval = async (
    approval: ActionApprovalView,
    optionId: string
  ): Promise<void> => {
    if (!activeCampId) return
    setBusy(`action-approval-${approval.id}`)
    setError(null)
    try {
      const result = await client.request<StoredCommandResult>('action.approvals.resolve', {
        commandId: newCommandId(),
        campId: activeCampId,
        approvalId: approval.id,
        expectedVersion: approval.version,
        optionId,
        reason: `用户选择 Agent 运行时原生选项：${optionId}。`
      })
      if (result.status === 'rejected') throw new Error(commandFailureMessage(result))
      const { snapshot } = await requestCampProjection(activeCampId, 'open')
      campEventSequenceMarker.current = snapshot.throughGlobalSequence
      setCampSnapshot(snapshot)
    } catch (nextError) {
      setError(errorMessage(nextError))
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
        }
      )
      const [nextAgents, , nextInstallations] = await Promise.all([
        client.request<AgentProfile[]>('members.list'),
        loadNavigation(),
        client.request<AdapterInstallation[]>('runtime.installations.list')
      ])
      setAgents(nextAgents)
      setInstallations(nextInstallations)
      setState('ready')
      const activated = await activateCamp(result.quickChatCampId, { reconcileDefaultLead: false })
      // The new Camp resolves this startup; do not replay the initial home route afterward.
      if (activated && startupSnapshot) completeStartup(startupSnapshot.sessionId)
      setOnboardingSnapshot(result.snapshot)
    } catch (nextError) {
      const message = errorMessage(nextError)
      try {
        const stored = await desktop.onboarding.get()
        if (stored.status === 'completed') {
          setOnboardingSnapshot(stored)
          setError(`“初次集结”已保存，但当前页面还未完全打开：${message}`)
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

  const openCampInspector = (tab: CampInspectorTab): void => {
    setCampInspectorTab(tab)
    setSingleChatCampId(null)
    setCampInspectorCampId(activeCampId)
  }

  const openSingleChat = (): void => {
    setSingleChatNotificationTarget(null)
    setCampInspectorCampId(null)
    setSingleChatCampId(activeCampId)
  }

  const changeExecutionConsolePlacement = useCallback(async (
    placement: ExecutionConsolePlacement
  ): Promise<ExecutionConsolePlacement> => {
    const next = await uiPreferences.generalPreferences.setExecutionConsolePlacement(placement)
    setGeneralPreferences(next)
    return next.executionConsolePlacement
  }, [])

  const focusCampApprovals = (): void => {
    if (mobile) { setCampInspectorCampId(null); setSingleChatCampId(null) }
    setNotificationFocus({
      requestId: ++notificationFocusSequence.current,
      kind: 'approval',
      campTurnId: null,
      active: true
    })
  }

  async function openMission(mission: MissionRecord): Promise<void> {
    setMissionPresentation('drawer')
    await activateCamp(mission.campId, { reconcileDefaultLead: false })
    if (activeCampIdRef.current === mission.campId && viewRef.current === 'camp') {
      setMissionPresentation('drawer'); setMissionOpenRequest(value => value + 1)
    }
  }
  const refreshMission = async (campId: string): Promise<void> => {
    await missionList.refresh()
    if (activeCampIdRef.current === campId) await refreshActiveCampSnapshot(campId)
  }
  const refreshMissionAfterWorkspaceCleanup = async (campId: string): Promise<void> => {
    await Promise.all([
      missionList.refreshOrThrow(),
      activeCampIdRef.current === campId ? refreshActiveCampSnapshot(campId) : Promise.resolve()
    ])
  }
  const onMissionDeleted = async (campId: string): Promise<void> => {
    const wasActive = activeCampIdRef.current === campId
    hideAcceptedCampDeletion(campId)
    if (wasActive) {
      await desktopNavigation.replace({ kind: 'missions' }, { prepared: true })
    }
    void missionList.refresh()
  }
  const missionSource = (messageId: string): void => {
    setNotificationFocus({ requestId: ++notificationFocusSequence.current, kind: 'camp_message', campTurnId: null, messageId, active: true })
  }
  async function createMission(draft: Omit<CreateCampRequest, 'commandId' | 'activationState'>, saveTeam: boolean, definition?: {description: string; start: boolean; tags: string[]; attachments: MissionAttachmentDraft[]}): Promise<void> {
    if (!definition) throw new Error('缺少使命定义')
    const command: MissionCreate = { title: draft.name ?? '', description: definition.description, memberAgentIds: draft.memberAgentIds, defaultLeadAgentId: draft.defaultLeadAgentId, projectBindingKind: draft.workspace ? 'directory' : 'quick_chat', projectPath: draft.workspace?.projectPath ?? '', tags: definition.tags }
    const attachmentSignature = JSON.stringify(definition.attachments.map(({ id, file, kindHint }) => [id, file.name, file.size, file.lastModified, file.type, kindHint]))
    // Unknown transport outcomes retry the exact command. A different draft cannot
    // accidentally create a second Mission while the first result is unresolved.
    const pending = missionCreation.current
    if (pending && (JSON.stringify(pending.command) !== JSON.stringify(command) || pending.attachmentSignature !== attachmentSignature)) throw new Error('上次创建结果尚未确认，请恢复原内容并重试。')
    const request = pending ?? { id: newCommandId(), command, attachments: definition.attachments, attachmentSignature }
    missionCreation.current = request
    setBusy('create-mission')
    try {
      const result = request.attachments.length
        ? await (async () => {
            if (!client.missionAttachments) throw new Error('当前环境不支持使命附件。')
            const stored = await client.missionAttachments.create(request.id, request.command, request.attachments)
            if (stored.status === 'rejected') throw new MissionCommandRejected(stored)
            return stored
          })()
        : await missionCommand(client, 'missions.create', request.command, request.id)
      const campId = stringField(result.payload, 'campId'), missionId = stringField(result.payload, 'missionId')
      if (!campId || !missionId) throw new Error('使命已保存，但返回的标识不完整。请刷新使命板。')
      missionCreation.current = null; setNewMissionOpen(false)
      if (saveTeam) {
        try { setGeneralPreferences(await uiPreferences.generalPreferences.setNewConversationDefaults({ memberAgentIds: draft.memberAgentIds, defaultLeadAgentId: draft.defaultLeadAgentId }, true)) }
        catch { notifyError('使命已创建，但默认队伍设置未保存。可在设置中重试。') }
      }
      if (definition.start) {
        try { await missionCommand(client, 'missions.start', { missionId }) }
        catch (error) { notifyError(`使命已保存，暂时未开始：${missionError(error)}`) }
      }
      await missionList.refresh()
    } catch (error) {
      if (error instanceof MissionCommandRejected) missionCreation.current = null
      throw error
    } finally { setBusy(null) }
  }

  const windowDragPage = windowDragStripPage(missionDrawer ? 'missions' : view)
  const visibleCampSnapshot = campSnapshot && activeCampId
    ? campSnapshotWithCurrentAnchor(campSnapshot, activeCampId, notificationAnchor)
    : campSnapshot
  const firstRunCamp = onboardingSnapshot?.status === 'completed'
    && onboardingSnapshot.origin === 'onboarding'
    && onboardingSnapshot.quickChatCampId === activeCampId
    && onboardingSnapshot.memberAgentId
    && onboardingSnapshot.selectedMemberRole
    ? {
        memberAgentId: onboardingSnapshot.memberAgentId,
        memberRole: onboardingSnapshot.selectedMemberRole
      }
    : null
  const pageContentClassName: Record<View, string> = {
    compose: 'task-content compose-content',
    camp: 'task-content camp-content',
    members: 'members-content',
    automations: 'automation-content',
    missions: 'mission-board-content',
    memory: 'memory-content',
    settings: 'settings-content'
  }
  const startupGateVisible = Boolean(desktop) && startupGateShouldBeVisible(startupSnapshot)
  const startupFeedbackVisible = startupFeedbackShouldBeVisible(
    startupStatus,
    startupFeedbackDelayElapsed ?? false
  )
  const startupRoutePending = !startupGateVisible && startupStatus !== 'resolved'
    ? startupRouteTarget
    : null
  const startupLoadingVisible = startupStatus === 'loading' && startupFeedbackVisible && !shuttingDown
  const startupLoadingRoute = startupGateVisible
    ? 'location'
    : startupRoutePending?.kind ?? startupRouteTarget?.kind ?? 'location'
  const inlineNotices = memoryReviewNotice
    || memoryAutoNotice.count > 0
    || (!shuttingDown && (error || locationSaveError))
    ? (
        <>
          {memoryReviewNotice && (
            <div className="memory-review-notice" role="status">
              <div><strong>队员提交了一条共同记忆审核</strong><span>候选内容尚未成为正式记忆，你可以稍后在“记忆”中逐条处理。</span></div>
              <div><button className="quiet-button compact" type="button" onClick={openMemoryReviews}>查看审核</button><button className="icon-button" type="button" aria-label="暂时忽略共同记忆审核提示" onClick={() => setMemoryReviewNotice(false)}>×</button></div>
            </div>
          )}
          {memoryAutoNotice.count > 0 && (
            <div className="memory-review-notice memory-auto-applied-notice" role="status" aria-live="polite">
              <div><strong>已自动形成 {memoryAutoNotice.count} 条{memoryAutoNotice.count === 1 ? memoryAutoNotice.scope === 'relationship' ? '队员间记忆' : memoryAutoNotice.scope === 'companion' ? '队员记忆' : '共同记忆' : '记忆'}</strong><span>已立即用于后续协作，你可以随时查看、修订、停止沿用或遗忘。</span></div>
              <div><button className="quiet-button compact" type="button" onClick={openAutomaticMemory}>查看</button><button className="icon-button" type="button" aria-label="关闭自动形成提示" onClick={() => setMemoryAutoNotice({ count: 0, memoryId: null, scope: null })}>×</button></div>
            </div>
          )}
          {!shuttingDown && error && (
            <div className="error-banner" role="alert">
              <span className="error-icon" aria-hidden="true">!</span>
              <div><strong>操作未完成</strong><span>{error}</span><small>项目文件和已经写入的审计记录不会因此丢失。</small></div>
              <div className="error-actions"><button className="quiet-button" onClick={() => void loadOverview()}>刷新状态</button><button className="icon-button" aria-label="关闭错误" onClick={() => setError(null)}>×</button></div>
            </div>
          )}
          {!shuttingDown && locationSaveError && (
            <div className="error-banner" role="alert">
              <span className="error-icon" aria-hidden="true">!</span>
              <div><strong>当前页面已打开，但下次启动位置未保存</strong><span>{locationSaveError}</span></div>
              <div className="error-actions">
                <button className="quiet-button" type="button" onClick={() => {
                  const location = pendingRestorableLocation.current
                  if (location) void commitRestorableLocation(location)
                }}>重试保存</button>
                <button className="icon-button" type="button" aria-label="关闭启动位置保存错误" onClick={() => setLocationSaveError(null)}>×</button>
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
          feedbackVisible={startupFeedbackDelayElapsed ?? false}
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
          onOpenModelCatalog={async (runtimeKind) => {
            const catalog = await openRuntimeModelCatalog(runtimeKind)
            const nextInstallations = await client.request<AdapterInstallation[]>(
              'runtime.installations.list'
            )
            setInstallations(nextInstallations)
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

  const renderNavigation = (drawer = false): React.JSX.Element => <CampNavigation
    navigationId={drawer ? 'mobile-conversation-navigation' : 'global-navigation'}
    platform={client.platform}
    footer={sidebarFooter}
    view={view === 'camp' && missionCamp ? 'missions' : view}
    state={startupStatus === 'resolved' ? navigationState : 'loading'}
    navigation={displayNavigation}
    groupLimits={navigationGroupLimits}
    onGroupLimitChange={navigationRefreshCoordinator.resizeGroup}
    activeCampId={activeCampId}
    openingCampId={openingCampId}
    currentProjectKey={currentProjectKey}
    shellOnlyProjectPath={shellOnlyCurrentProjectPath}
    creatingConversation={busy === 'create-camp'}
    pins={navigationPins}
    pinnedCampItems={pinnedCampItems}
    settingsSection={settingsSection}
    updateSnapshot={appUpdates.snapshot}
    onNewConversation={() => { setMobileConversationDrawerOpen(false); beginNewConversation() }}
    onMembers={() => { setMobileConversationDrawerOpen(false); chooseView('members') }}
    onAutomations={() => { setMobileConversationDrawerOpen(false); chooseView('automations') }}
    onMissions={() => { setMobileConversationDrawerOpen(false); chooseView('missions') }}
    unreadMissionCount={unreadMissionCount(missionList.missions)}
    onMemory={() => { setMobileConversationDrawerOpen(false); chooseView('memory') }}
    pendingMemoryCount={pendingMemoryCount}
    onSettings={() => { setMobileConversationDrawerOpen(false); openSettings() }}
    onOpenUpdates={() => { setMobileConversationDrawerOpen(false); void openUpdateSettings() }}
    onSettingsSectionChange={chooseSettingsSection}
    onSettingsBack={closeSettings}
    onOpenProject={() => { setMobileConversationDrawerOpen(false); void openProject() }}
    onSelectProject={(project) => {
      cancelPendingCampActivation()
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
        cancelPendingCampActivation()
        await requestNewConversation(project
          ? { name: project.name, projectPath: project.projectPath }
          : null)
      })
    }}
    onCamp={(target) => { setMobileConversationDrawerOpen(false); chooseCamp(target) }}
    onTogglePin={toggleNavigationPin}
    onRemoveProject={removeNavigationProject}
    onRenameProject={renameProject}
    onCampIdCopied={() => {
      setError(null)
      notify('已复制会话 ID')
    }}
    onRename={renameCamp}
    onDelete={deleteCamp}
    onDeleteError={(nextError) => notifyError(errorMessage(nextError))}
    onError={(nextError) => setError(errorMessage(nextError))}
  />

  return (
    <MobileLayoutProvider value={mobile}>
    <FilePreviewProvider api={environment.files} campId={view === 'camp' ? activeCampId : null} resolvedTheme={appearance.resolvedTheme}
      missionActivity={activeMission && view === 'camp' ? <MissionActivityDocument mission={activeMission} agents={agents} onSource={missionSource} onNotify={notify} onWorkspaceCleanupRequested={refreshMissionAfterWorkspaceCleanup}/> : null}>
    <MissionInteractionProvider missions={missionList.missions} projects={displayNavigation?.projects ?? []} agents={agents} onChanged={refreshMission} onWorkspaceCleaned={refreshMissionAfterWorkspaceCleanup} onDeleted={onMissionDeleted} onOpen={mission => { void openMission(mission).catch(error => notifyError(missionError(error))) }} onError={notifyError}>
    <NavigationShell platform={client.platform} settings={view === 'settings'} navigation={desktopNavigation} nativeWindowControls={desktop?.windowControls} browser={!desktop} disabled={startupStatus !== 'resolved' || shuttingDown} className={view === 'camp' && !missionDrawer ? 'app-shell-camp' : ''} data-mobile-view={mobile ? view : undefined} data-mobile-settings-list={mobile && view === 'settings' && mobileSettingsList || undefined}>
      {!mobile && renderNavigation()}
      {!startupGateVisible && mobile && ['compose', 'members', 'memory', 'automations'].includes(view) && <MobilePageHeader
        title={({ compose: '新对话', members: '队员', memory: '记忆', automations: '定时任务' } as Record<string, string>)[view]}
        onOpenMenu={openMobileMenu} menuOpen={mobileConversationDrawerOpen} triggerRef={mobileConversationListButtonRef} />}
      {!startupGateVisible && view === 'camp' && !missionCamp && <AppHeader
        campTitle={activeCampTitle || '对话'}
        contextLabel={activeCampContextLabel}
        camp={campSnapshot?.camp.id === activeCampId ? campSnapshot : null}
        detailEntryHostRef={setCampDetailEntryHost}
        onFocusApprovals={focusCampApprovals}
        onOpenConversationList={mobile ? openMobileMenu : undefined}
        conversationListButtonRef={mobileConversationListButtonRef}
      />}
      {windowDragPage && <WindowDragStrip page={windowDragPage} />}

      <main ref={mobilePageRef} className={`content ${pageContentClassName[missionDrawer ? 'missions' : view]}${missionCamp && view === 'camp' ? ' mission-active-content' : ''}`}>
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
          <AppToast toast={toast} onClose={() => setToast(null)} />
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
        {!startupGateVisible && view === 'camp' && missionCamp && !activeMission && <section className="mission-section-empty" role={missionList.error ? 'alert' : 'status'}><p>{missionList.error || (missionList.loading ? '正在读取使命…' : '此使命当前不可用。')}</p>{!missionList.loading && <button className="quiet-button" onClick={() => void missionList.refresh()}>重试</button>}<button className="quiet-button" onClick={returnToMissions}>返回使命板</button></section>}
        {!startupGateVisible && generalPreferences && view === 'camp' && (!missionCamp || activeMission) && activeCampId && visibleCampSnapshot?.camp.id === activeCampId && (
          <MissionSurface key={activeCampId} enabled={!!activeMission} full={!missionDrawer} onExpand={() => setMissionPresentation('full')} onClose={returnToMissions}>
          {activeMission && <MissionHeader mission={activeMission} drawer={missionDrawer} camp={visibleCampSnapshot} projectName={activeCampProject?.name ?? activeCampContextLabel}
            openRequest={missionOpenRequest} onExpand={() => setMissionPresentation('full')} onFold={() => setMissionPresentation('drawer')}
            executionTakesPreviewPriority={generalPreferences.executionConsolePlacement === 'right'
              && visibleCampSnapshot.agentRuns.some((run) => run.status === 'running')}
            onClose={returnToMissions} onFocusApprovals={focusCampApprovals} detailEntryHostRef={setCampDetailEntryHost}/>}
          <CampWorkspace
            key={activeCampId}
            missionBoard={activeMission ? <MissionIntro mission={activeMission} projects={displayNavigation?.projects ?? []}/> : null}
            previewTabsInPane={false}
            suppressExecutionAutoOpen={missionDrawerSuppressesExecutionAutoOpen(
              missionDrawer,
              generalPreferences.executionConsolePlacement
            )}
            snapshot={visibleCampSnapshot}
            initialComposerDraft={campSnapshotState.initialComposerDraft}
            onInitialComposerDraftConsumed={consumeInitialComposerDraft}
            openCoverage={campSnapshot?.camp.id === activeCampId
              ? campSnapshot.openCoverage ?? null
              : null}
            messageHistory={campSnapshot?.camp.id === activeCampId
              ? campSnapshot.openCoverage?.messages ?? null
              : null}
            onLoadEarlierMessages={loadEarlierCampMessages}
            optimisticMessages={activeOptimisticMessages}
            projectName={activeCampProject?.name ?? null}
            agents={agents}
            installations={installations}
            liveRuntimeEvents={liveRuntimeEvents}
            busy={busy === 'camp-message' || busy === 'change-default-lead' || busy === 'camp-membership' || busy?.startsWith('action-approval-') === true}
            onSend={sendCampMessage}
            onWithdrawMessage={withdrawCampMessage}
            onPendingDraftPersisted={refreshPendingCampNavigation}
            onPendingCampLeave={settlePendingCampOnLeave}
            onCampLeaveGuardChange={registerCampLeaveGuard}
            onChangeLead={changeDefaultLead}
            onAddMembers={addCampMembers}
            onPreviewMemberRemoval={previewCampMemberRemoval}
            onRemoveMember={removeCampMember}
            onTasksChanged={() => refreshActiveCampSnapshot(activeCampId)}
            onResolveApproval={(approval, decision) => {
              void resolveActionApproval(approval, decision)
            }}
            cancellingTurnIds={activeCancellingTurnIds}
            cancellingRunIds={activeCancellingRunIds}
            confirmingRunIds={activeConfirmingRunIds}
            onCancelAgentRun={cancelAgentRun}
            stopping={activeCampStopping}
            executionPlacement={mobile ? 'inspector' : generalPreferences.executionConsolePlacement}
            onExecutionPlacementChange={changeExecutionConsolePlacement}
            worldMapEnabled={!mobile && generalPreferences.worldMapEnabled}
            workspaceEntrySnapshotReady={!campSnapshotState.entryPreview}
            inspectorVisible={visibleCampSnapshot.camp.activationState === 'active' && campInspectorVisible}
            inspectorTab={campInspectorTab}
            detailEntryHost={campDetailEntryHost}
            singleChatVisible={visibleCampSnapshot.camp.activationState === 'active' && singleChatVisible}
            onOpenSingleChat={openSingleChat}
            onCloseSingleChat={() => setSingleChatCampId(null)}
            onCloseInspector={() => setCampInspectorCampId(null)}
            onInspectorTabChange={setCampInspectorTab}
            onOpenInspector={openCampInspector}
            notificationFocus={notificationFocus}
            onNotificationFocusPresented={completeNotificationNavigation}
            singleChatTarget={singleChatNotificationTarget}
            onVisibleSingleChatSources={setVisibleSingleChatSources}
            onVisibleNotificationSources={setVisibleNotificationSources}
            runtimeRecovery={runtimeRecovery?.campId === activeCampId ? runtimeRecovery : null}
            firstRunCamp={firstRunCamp}
            onConfigureRuntime={configureMemberRuntime}
            onDismissRuntimeRecovery={() => setRuntimeRecovery(null)}
            onNotify={notify}
            onNotifyError={notifyError}
          />
          </MissionSurface>
        )}

        {!startupGateVisible && view === 'compose' && (
          <QuickChatWorkspace
            agents={agents}
            recentCamps={visibleNavigation ? allNavigationCamps(visibleNavigation).slice(0, 5) : []}
            onOpenCamp={chooseCamp}
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
            defaultMemberId={campSnapshot?.camp.defaultLeadAgentId
              ?? agents.find((agent) => agent.presence === 'present')?.agentId
              ?? ''}
            topNotices={inlineNotices}
            onOpenCamp={(campId) => void activateCamp(campId, { reconcileDefaultLead: false })}
            onNotify={notify}
            onLeaveGuardChange={registerAutomationLeaveGuard}
          />
        )}

        {!startupGateVisible && view === 'memory' && (
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
        )}

        {!startupGateVisible && view === 'settings' && (
          <MobileSettingsLayout overview={mobileSettingsList} section={settingsSection} appearance={appearance}
            menuOpen={mobileConversationDrawerOpen} triggerRef={mobileConversationListButtonRef}
            onOpenMenu={openMobileMenu} onBack={returnToMobileSettings} onSectionChange={chooseSettingsSection}>
          <SettingsView
            preferencesApi={uiPreferences.generalPreferences}
            nativeSettings={environment.desktop && { windowControls: environment.desktop.windowControls }}
            remoteConnection={environment.desktop?.hostWeb ? <HostWebSettings portDraft={remotePort} onPortDraftChange={setRemotePort} api={environment.desktop.hostWeb} /> : remoteConnection}
            zoomManagedBy={environment.desktop ? 'desktop' : 'browser'}
            platform={client.platform}
            appearance={appearance}
            health={health}
            agents={agents}
            generalPreferences={generalPreferences}
            currentProjectLabel={currentProjectLabel}
            onGeneralPreferencesChange={setGeneralPreferences}
            installations={installations}
            busy={busy}
            section={settingsSection}
            updates={appUpdates}
            serverUpdates={environment.serverUpdates}
            onDiagnosticsNavigate={(section) => chooseSettingsSection(section)}
            onReload={async () => {
              await Promise.all([loadOverview(), loadHealth()])
            }}
            onAppearanceChange={changeAppearancePreferences}
          />
          </MobileSettingsLayout>
        )}

        {!startupGateVisible && view === 'members' && (
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
                <div className="members-workspace">
                  <MembersView
                    ref={membersViewRef}
                    agents={agents}
                    topNotices={inlineNotices}
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
                    onOpenRuntimeSettings={() => {
                      chooseSettingsSection('runtime')
                      void navigateToSettings('runtime')
                    }}
                  />
                </div>
              )
        )}
      </main>

      {mobile && <Dialog.Root open={mobileConversationDrawerOpen} onOpenChange={setMobileConversationDrawerOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="mobile-conversation-scrim" />
          <Dialog.Content id="mobile-app-menu" className="mobile-conversation-drawer app-menu" aria-describedby={undefined} tabIndex={-1}
            onOpenAutoFocus={event => {
              event.preventDefault()
              const menu = document.getElementById('mobile-app-menu')
              const list = menu?.querySelector<HTMLElement>('.navigation-scroll')
              if (list) list.scrollTop = mobileMenuScroll.current
              menu?.focus()
            }}
            onScrollCapture={event => { if (event.target instanceof HTMLElement && event.target.classList.contains('navigation-scroll')) mobileMenuScroll.current = event.target.scrollTop }}
            onCloseAutoFocus={(event) => {
            event.preventDefault()
            const trigger = mobileConversationListButtonRef.current
            const visibleTrigger = trigger?.getClientRects().length ? trigger
              : [...document.querySelectorAll<HTMLButtonElement>('.app-shell [aria-label="打开主菜单"]')].find(button => button.getClientRects().length)
            visibleTrigger?.focus({ preventScroll: true })
          }}>
            <header className="app-menu-heading"><Dialog.Title>Rovai AI</Dialog.Title>
              <Dialog.Close asChild><button className="mobile-icon-button" type="button" aria-label="关闭主菜单"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button></Dialog.Close>
            </header>
            {renderNavigation(true)}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>}

      <NewConversationDialog
        open={newConversationOpen}
        initialWorkspace={newConversationInitialWorkspace}
        initialSelection={newConversationInitialSelection}
        attentionMessage={newConversationAttention}
        projects={displayNavigation?.projects ?? []}
        preflight={campCreationPreflight}
        agents={agents}
        busy={busy === 'create-camp' || busy === 'open-project'}
        projectAccessReady={removedProjectAuthorityReady}
        onOpenChange={setNewConversationOpen}
        onChooseWorkspaceDirectory={chooseWorkspaceDirectory}
        onWorkspaceSelected={(workspace) => restoreNavigationProject(workspace.projectPath)}
        onCreate={(draft, enableOneClick) => createCamp({
          ...draft,
          activationState: campActivationStateForCreation('dialog')
        }, enableOneClick)}
      />
      <NewConversationDialog purpose="mission" open={newMissionOpen} recovery={missionCreation.current?.command ?? null} recoveryAttachments={missionCreation.current?.attachments ?? []}
        initialWorkspace={currentProjectWorkspace(displayNavigation, currentProject)}
        initialSelection={generalPreferences?.newConversationDefaults ?? null}
        projects={displayNavigation?.projects ?? []} missionTagCatalog={[...new Set(missionList.missions.flatMap(mission => mission.tags))]} preflight={campCreationPreflight} agents={agents}
        busy={busy === 'create-mission'} projectAccessReady={removedProjectAuthorityReady}
        onOpenChange={open => { if (!busy) setNewMissionOpen(open) }}
        onChooseWorkspaceDirectory={chooseWorkspaceDirectory} onWorkspaceSelected={workspace => restoreNavigationProject(workspace.projectPath)}
        onCreate={createMission}/>
      <NotificationAttentionController
        enabled={startupStatus === 'resolved'}
        activeCampId={activeCampId}
        activeCampVisible={view === 'camp'
          && campSnapshot?.camp.id === activeCampId
          && !newConversationOpen
          && !newMissionOpen
          && !shuttingDown}
        navigationActive={notificationFocus !== null}
        onNavigate={navigateFromNotification}
        onPresentNavigation={presentNotificationNavigation}
        onCancelNavigation={cancelNotificationNavigation}
        onRefreshVisibleCamp={refreshVisibleNotificationCamp}
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
    <StartupLoadingCanvas visible={startupLoadingVisible} route={startupLoadingRoute} />
    </MissionInteractionProvider>
    </FilePreviewProvider>
    </MobileLayoutProvider>
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
    <button className="primary-button" type="button" onClick={onRetry}>重新打开</button>
    {onExportDiagnostics && <button className="quiet-button" type="button" disabled={exporting} onClick={() => void exportDiagnostics()}>
      {exporting ? '正在导出…' : '导出诊断'}
    </button>}
    {exportError && <p role="alert">暂时无法导出诊断，请重试。</p>}
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
    ? <h1 id="startup-recovery-title" ref={headingRef} tabIndex={-1}>暂时无法打开会话</h1>
    : <h2 id="startup-recovery-title" ref={headingRef} tabIndex={-1}>暂时无法打开会话</h2>

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


export function SettingsView({
  preferencesApi,
  remoteConnection,
  nativeSettings,
  zoomManagedBy = 'desktop',
  platform = 'darwin',
  appearance,
  health,
  agents,
  generalPreferences,
  currentProjectLabel,
  onGeneralPreferencesChange,
  installations,
  busy,
  section,
  updates,
  serverUpdates,
  onDiagnosticsNavigate,
  onReload,
  onAppearanceChange
}: {
  remoteConnection?: React.ReactNode
  preferencesApi: import('@contracts').GeneralPreferencesApi
  nativeSettings?: { windowControls: import('@contracts').WindowControlsApi; browserAccess?: React.ReactNode }
  zoomManagedBy?: 'desktop' | 'browser'
  platform?: NodeJS.Platform
  appearance: AppearanceSnapshot
  health: HealthStatus | null
  agents: AgentProfile[]
  generalPreferences?: GeneralPreferencesSnapshot | null
  currentProjectLabel?: string
  onGeneralPreferencesChange?(preferences: GeneralPreferencesSnapshot): void
  installations: AdapterInstallation[]
  busy: string | null
  section: SettingsSection
  updates: AppUpdatesController
  serverUpdates?: import('@contracts').AppUpdatesApi
  onDiagnosticsNavigate(section: 'mcp' | 'runtime', runtimeKind?: AdapterKind): void
  onReload(): Promise<void>
  onAppearanceChange(preferences: AppearancePreferences): Promise<AppearanceSnapshot>
}): React.JSX.Element {
  return (
    <div className="settings-workbench">
      <div className={`settings-panel settings-panel-${section}`}>
        {section === 'remote' && remoteConnection}
        {section === 'general' && (
          <GeneralSettings
            api={preferencesApi}
            windowControls={nativeSettings?.windowControls}
            browserAccess={nativeSettings?.browserAccess}
            agents={agents}
            initialPreferences={generalPreferences}
            currentProjectLabel={currentProjectLabel}
            onPreferencesChange={onGeneralPreferencesChange}
          />
        )}
        <Activity mode={section === 'skills' ? 'visible' : 'hidden'}><NativeSkillsSettings /></Activity>
        <Activity mode={section === 'toolbox' ? 'visible' : 'hidden'}><ToolboxSettings agents={agents} /></Activity>
        <Activity mode={section === 'mcp' ? 'visible' : 'hidden'}><McpSettings agents={agents} platform={platform} /></Activity>
        <Activity mode={section === 'runtime' ? 'visible' : 'hidden'}>
          <RuntimeInstallationsPanel health={health} installations={installations} onReload={onReload} />
        </Activity>
        {section === 'channels' && <ChannelSettings agents={agents} />}
        {section === 'appearance' && (
          <AppearanceSettings
            zoomManagedBy={zoomManagedBy}
            appearance={appearance}
            platform={platform}
            disabled={busy === 'appearance'}
            onChange={onAppearanceChange}
          />
        )}
        {section === 'notifications' && (
          <NotificationSettings />
        )}
        {section === 'monitoring' && (
          <RuntimeMonitoring platform={platform} />
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
  snapshot: CampSnapshot,
  anchoredMessages: readonly CampMessageView[]
): CampSnapshot {
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
  snapshot: CampSnapshot,
  anchoredAgentRuns: readonly AgentRunView[]
): CampSnapshot {
  if (anchoredAgentRuns.length === 0) return snapshot
  const runsById = new Map(snapshot.agentRuns.map((run) => [run.id, run]))
  for (const run of anchoredAgentRuns) {
    if (!runsById.has(run.id)) runsById.set(run.id, run)
  }
  return { ...snapshot, agentRuns: [...runsById.values()] }
}

export function campSnapshotWithCurrentAnchor(
  snapshot: CampSnapshot,
  campId: string,
  anchor: {
    campId: string
    messages?: readonly CampMessageView[]
    agentRuns?: readonly AgentRunView[]
  } | null
): CampSnapshot {
  if (anchor?.campId !== campId) return snapshot
  return campSnapshotWithAnchoredAgentRuns(
    campSnapshotWithAnchoredMessages(snapshot, anchor.messages ?? []),
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

export function notificationFocusMatchesAction(
  focus: NotificationFocusTarget,
  action: NotificationActionView
): boolean {
  if (focus.kind === 'single_chat') {
    return action.kind === 'open_single_chat'
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
      && Boolean(focus.campTurnId)
      && focus.campTurnId === action.campTurnId
  }
  if (focus.kind === 'agent_run') {
    return action.kind === 'open_agent_run'
      && Boolean(focus.agentRunId)
      && focus.agentRunId === action.agentRunId
  }
  return action.kind === 'open_approval'
    && (focus.approvalId ?? null) === (action.approvalId ?? null)
}

async function resolveNavigationPins(
  navigation: NavigationSnapshot,
  pins: NavigationPin[],
  client: Pick<RovaiApi, 'request'>
): Promise<{ pins: NavigationPin[]; camps: NavigationCampItem[] }> {
  const pinnedCampIds = new Set(
    pins.filter((pin) => pin.kind === 'camp').map((pin) => pin.targetKey)
  )
  const campById = new Map(
    allNavigationCamps(navigation)
      .filter((camp) => pinnedCampIds.has(camp.id))
      .map((camp) => [camp.id, camp])
  )
  const unresolvedCampIds = new Set(
    [...pinnedCampIds].filter((campId) => !campById.has(campId))
  )

  if (unresolvedCampIds.size > 0) {
    const rows = await client.request<NavigationCampRows>('navigation.camps', { campIds: [...unresolvedCampIds] })
    for (const camp of rows.camps) campById.set(camp.id, camp)
  }

  const validProjectKeys = new Set(navigation.projects.map((project) => project.projectKey))
  const validPins = pins.filter((pin) =>
    pin.kind === 'camp'
      ? campById.has(pin.targetKey)
      : validProjectKeys.has(pin.targetKey)
  )
  return {
    pins: validPins,
    camps: validPins
      .filter((pin) => pin.kind === 'camp')
      .flatMap((pin) => campById.get(pin.targetKey) ?? [])
  }
}

export function optimisticCampMessage(
  snapshot: CampSnapshot | null,
  commandId: string,
  draft: CampComposerDraftView,
  createdAt = new Date().toISOString()
): CampMessageView {
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
    content: composerDocumentToStructuredContent(draft.content),
    attachments: draft.attachments,
    addressMode: broadcast ? 'broadcast' : explicitlyMentionedIds.length > 0 ? 'explicit' : 'default',
    addressedAgentIds,
    replyToCampMessageId: draft.replyIntent?.replyToCampMessageId ?? null,
    campTurnId: null,
    presentation: null,
    createdAt,
    withdrawn: false,
    canWithdraw: false,
    version: 1
  }
}

export function campMessageSendParams(
  commandId: string,
  campId: string,
  draft: CampComposerDraftView
): {
  commandId: string
  campId: string
  content: CampComposerDraftView['content']
  sourceAttachments: Array<{
    id: string
    sourcePath: string
    displayName: string
    kind: 'file' | 'directory'
    mediaType: string | null
    observedByteSize: number | null
  }>
  quotes: CampComposerDraftView['quotes']
  replyToCampMessageId: string | null
  execution: {
    taskId: null
    purpose: string
    completionRole: 'required'
  }
} {
  const sourceAttachments = draft.attachments.map((attachment) => {
    if (!attachment.sourcePath) throw new Error('本地附件来源已不可用，请移除后重新添加。')
    return {
      id: attachment.id,
      sourcePath: attachment.sourcePath,
      displayName: attachment.displayName,
      kind: attachment.kind,
      mediaType: attachment.mediaType,
      observedByteSize: attachment.byteSize
    }
  })
  return {
    commandId,
    campId,
    content: draft.content,
    sourceAttachments,
    quotes: draft.quotes,
    replyToCampMessageId: draft.replyIntent?.replyToCampMessageId ?? null,
    execution: {
      taskId: null,
      purpose: campMessageExecutionPurpose(draft),
      completionRole: 'required'
    }
  }
}

export function campMessageExecutionPurpose(draft: CampComposerDraftView): string {
  return draft.body.trim() || 'Camp attachment-only message'
}

export function campCreationPreflightFromAgents(
  agents: AgentProfile[]
): CampCreationPreflight {
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
    .find((member) => member.runtimeReadiness === 'light_ready')
    ?.agentId ?? presentMembers[0]?.agentId ?? null
  const blockers: CampCreationPreflight['blockers'] = presentMembers.length === 0
    ? [{ code: 'no_present_members', detail: '当前没有在队的队员。' }]
    : []
  return {
    admissible: blockers.length === 0,
    presentMembers,
    initialLeadAgentId,
    blockers
  }
}

export function commandFailureMessage(result: StoredCommandResult): string {
  if (result.code === 'reply_recipient_required') {
    return '原作者当前不可接收，请选择其他成员。'
  }
  if (result.code === 'mention_target_unavailable') {
    return '消息未发送：一位收件人当前不可接收，请重新选择。'
  }
  if (result.code === 'camp_message.invalid_reply') {
    return '消息未发送：引用的消息当前不可用。请取消引用后重试。'
  }
  if (
    result.code === 'camp_message.no_addressable_member'
    || result.code === 'camp.default_lead_invariant'
    || result.code === 'camp.no_present_members'
  ) {
    return '当前无可用队员。'
  }
  if (result.code === 'agent_run.runtime_not_ready') {
    return '目标队员的 Agent 运行时暂不可用。'
  }
  if (result.code === 'camp.last_member_required') {
    return '会话至少保留 1 位队员。'
  }
  if (membershipConflictCode(result.code)) {
    return '名册已发生变化。请重新读取最新状态后再试。'
  }
  return localizeExecutionEngineTerms(stringField(result.payload, 'message') ?? `操作未完成：${result.code}`)
}

function membershipConflictCode(code: string): boolean {
  return code === 'camp.membership_generation_conflict'
    || code === 'camp.membership_version_conflict'
    || code === 'camp.member_not_found'
    || code === 'camp.member_not_active'
}

export function campDeleteCommand(
  camp: Pick<NavigationCampItem, 'id' | 'version'>
): { campId: string; expectedVersion: number; force: true } {
  return {
    campId: camp.id,
    expectedVersion: camp.version,
    force: true
  }
}

export function runtimeRecoveryFromCommandResult(
  campId: string,
  result: StoredCommandResult
): CampRuntimeRecovery | null {
  if (result.status !== 'rejected' || result.code !== 'agent_run.runtime_not_ready') return null
  const agentId = stringField(result.payload, 'agentId')
  const blockerCode = stringField(result.payload, 'blockerCode')
  if (!agentId || !blockerCode) return null
  return {
    campId,
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
