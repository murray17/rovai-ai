import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AdapterInstallation,
  AdapterKind,
  AgentProfile,
  AgentRunView,
  ActionApprovalView,
  AppearanceSnapshot,
  CampActivationState,
  CampCreationPreflight,
  CampComposerDraftView,
  CampMessagePage,
  CampMessageAroundSnapshot,
  CampMessageView,
  CampOpenProjection,
  CampSnapshot,
  CreateCampRequest,
  CoreEvent,
  DesktopStartupSnapshot,
  EventBatch,
  GeneralPreferencesSnapshot,
  HealthStatus,
  NotificationActionView,
  NotificationEpisodeView,
  NavigationCampItem,
  NavigationCampPage,
  NavigationPin,
  NavigationPreferencesSnapshot,
  NavigationSnapshot,
  ProjectNavigationGroup,
  RestorableLocation,
  HearthReviewItem,
  SendCampMessageResult,
  StoredCommandResult,
  ThemePreference,
  WorkspaceInspection,
  WorkspaceSelection
} from '@contracts'
import {
  MembersView,
  RuntimeInstallationsPanel,
  type MembersViewHandle
} from './MemberManagement'
import {
  MemberSidebar,
  type MemberWorkspaceTab
} from './MemberSidebar'
import {
  CampWorkspace,
  QuickChatWorkspace,
  type CampMessageSendReceipt,
  type CampInspectorTab,
  type CampRuntimeRecovery,
  type NotificationFocusTarget,
  type VisibleNotificationSources
} from './CampWorkspace'
import {
  CampNavigation,
  type CampDeleteAttempt,
  type NavigationSettingsSection
} from './CampNavigation'
import { NewConversationDialog } from './NewConversationDialog'
import { AppearanceSettings } from './AppearanceSettings'
import {
  NotificationAttentionController,
  type NotificationNavigationResult
} from './NotificationAttentionController'
import {
  createNotificationPresentationCoordinator,
  type NotificationPresentationCoordinator
} from './NotificationPresentationCoordinator'
import { NotificationSettings } from './NotificationSettings'
import { SkillSettings } from './SkillSettings'
import { McpSettings } from './McpSettings'
import { SettingsPageHeader } from './SettingsPageHeader'
import { GeneralSettings } from './GeneralSettings'
import { MemoryLibrary } from './MemoryLibrary'
import { DiagnosticsCenter } from './DiagnosticsCenter'
import { localizeExecutionEngineTerms } from './product-copy'
import {
  applyAppearanceSnapshot,
  initialAppearanceSnapshot
} from './theme'
import {
  allNavigationCamps,
  campDayNumber,
  liveRuntimeEventFromCore,
  type LiveRuntimeEvent
} from './ui-model'
import {
  campExistsInAuthoritativeNavigation,
  restoredMemberId,
  startupTargetFromSnapshot
} from './startup-location'
import {
  currentProjectForCamp,
  currentProjectGroup,
  currentProjectWorkspace,
  navigationIncludingCurrentWorkspace,
  navigationWithoutRemovedProjects,
  persistCurrentProject,
  projectTargetKey,
  readCurrentProject,
  resolveNewConversationDefaults,
  shouldInvalidateNewConversationDefaults,
  type CurrentProject
} from './new-conversation-preferences'
import {
  memberReturnTargetForSource,
  type MemberReturnTarget
} from './member-return'

export { allNavigationCamps }

type LoadState = 'loading' | 'ready' | 'error'
type StartupStatus = 'loading' | 'waiting' | 'resolved'
export type View = 'compose' | 'camp' | 'members' | 'memory' | 'settings'
export type SettingsSection = NavigationSettingsSection
export type WindowDragStripPage = Extract<View, 'compose' | 'settings'>

export function windowDragStripPage(view: View): WindowDragStripPage | null {
  return view === 'compose' || view === 'settings' ? view : null
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
  const messages = [...messagesById.values()].sort((left, right) =>
    left.sequence - right.sequence || left.id.localeCompare(right.id)
  )
  const loadedCount = messages.length
  const totalCount = Math.max(projection.coverage.messages.totalCount, loadedCount)
  const omittedCount = Math.max(0, totalCount - loadedCount)
  return {
    schemaVersion: 29,
    throughGlobalSequence: projection.throughGlobalSequence,
    camp: projection.camp,
    members: projection.members,
    tasks: projection.tasks,
    messages,
    messageDeliveries: projection.messageDeliveries,
    turns: projection.turns,
    agentRuns: projection.agentRuns,
    executionEvidence: projection.executionEvidence,
    contextManifests: [],
    approvals: projection.approvals,
    actions: [],
    timeline: projection.timeline,
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
const CAMP_INSPECTOR_VISIBILITY_KEY = 'rovai.camp.inspector.visibility'

export function campInspectorVisibleFromStoredValue(value: string | null): boolean {
  return value !== 'hidden'
}

export function campActivationStateForCreation(
  source: 'one_click' | 'dialog'
): CampActivationState {
  return source === 'one_click' ? 'pending' : 'active'
}

function initialCampInspectorVisibility(): boolean {
  try {
    return campInspectorVisibleFromStoredValue(window.localStorage.getItem(CAMP_INSPECTOR_VISIBILITY_KEY))
  } catch {
    return true
  }
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
  const snapshotTurnIds = new Set(snapshot.turns.map((turn) => turn.id))
  const next = new Set([...local].filter((turnId) => snapshotTurnIds.has(turnId)))
  for (const turn of snapshot.turns) {
    if (
      CANCELLABLE_TURN_STATUSES.has(turn.status)
      && turn.cancelRequestedAt !== null
    ) {
      next.add(turn.id)
    }
  }
  return next
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

export function ControlledShutdownOverlay(): React.JSX.Element {
  return (
    <div
      className="shutdown-scrim"
      role="dialog"
      aria-modal="true"
      aria-live="assertive"
      aria-labelledby="controlled-shutdown-title"
      aria-describedby="controlled-shutdown-description"
    >
      <section className="shutdown-card">
        <span className="shutdown-progress" aria-hidden="true"><i /></span>
        <div>
          <p className="settings-page-eyebrow">CONTROLLED SHUTDOWN</p>
          <h2 id="controlled-shutdown-title">正在停止运行并关闭 Rovai…</h2>
          <p id="controlled-shutdown-description">
            正在等待执行引擎返回可靠终态；无法确认的执行也会停止，并保留外部效果现场供下次核对。
          </p>
        </div>
      </section>
    </div>
  )
}

export function App(): React.JSX.Element {
  const [appearance, setAppearance] = useState<AppearanceSnapshot>(
    () => initialAppearanceSnapshot(document.documentElement)
  )
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [healthLoading, setHealthLoading] = useState(false)
  const [healthAttempted, setHealthAttempted] = useState(false)
  const [agents, setAgents] = useState<AgentProfile[]>([])
  const [installations, setInstallations] = useState<AdapterInstallation[]>([])
  const [navigation, setNavigation] = useState<NavigationSnapshot | null>(null)
  const [navigationPins, setNavigationPins] = useState<NavigationPin[]>([])
  const [removedProjectKeys, setRemovedProjectKeys] = useState<Set<string>>(() => new Set())
  const [pinnedCampItems, setPinnedCampItems] = useState<NavigationCampItem[]>([])
  const [pendingMemoryCount, setPendingMemoryCount] = useState(0)
  const [memoryReviewNotice, setMemoryReviewNotice] = useState(false)
  const [memoryAutoNotice, setMemoryAutoNotice] = useState<{
    count: number
    memoryId: string | null
    scope: 'companion' | 'relationship' | null
  }>({ count: 0, memoryId: null, scope: null })
  const [memoryRefreshKey, setMemoryRefreshKey] = useState(0)
  const [memoryFocusId, setMemoryFocusId] = useState<string | null>(null)
  const [memoryReviewDrawerSignal, setMemoryReviewDrawerSignal] = useState(0)
  const [campSnapshot, setCampSnapshotState] = useState<CampSurfaceSnapshot | null>(null)
  const [campInspectorVisible, setCampInspectorVisible] = useState(initialCampInspectorVisibility)
  const [campInspectorTab, setCampInspectorTab] = useState<CampInspectorTab>('tasks')
  const [optimisticCampMessages, setOptimisticCampMessages] = useState<OptimisticCampMessageEntry[]>([])
  const [cancellingTurnIds, setCancellingTurnIds] = useState<Set<string>>(() => new Set())
  const [state, setState] = useState<LoadState>('loading')
  const [shuttingDown, setShuttingDown] = useState(false)
  const [startupSnapshot, setStartupSnapshot] = useState<DesktopStartupSnapshot | null>(null)
  const [startupStatus, setStartupStatus] = useState<StartupStatus>('loading')
  const [startupError, setStartupError] = useState<string | null>(null)
  const [locationSaveError, setLocationSaveError] = useState<string | null>(null)
  const [view, setView] = useState<View>('compose')
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)
  const [memberTab, setMemberTab] = useState<MemberWorkspaceTab>('identity')
  const [memberRuntimeFocusRequest, setMemberRuntimeFocusRequest] = useState(0)
  const [memberReturnTarget, setMemberReturnTarget] = useState<MemberReturnTarget>({ kind: 'app' })
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general')
  const [generalPreferences, setGeneralPreferences] = useState<GeneralPreferencesSnapshot | null>(null)
  const [currentProject, setCurrentProject] = useState<CurrentProject>(() => readCurrentProject())
  const [currentWorkspaceHint, setCurrentWorkspaceHint] = useState<WorkspaceSelection | null>(null)
  const [activeCampId, setActiveCampId] = useState<string | null>(null)
  const [notificationFocus, setNotificationFocus] = useState<NotificationFocusTarget | null>(null)
  const [visibleNotificationSources, setVisibleNotificationSources] = useState<VisibleNotificationSources | null>(null)
  const [notificationAnchor, setNotificationAnchor] = useState<{
    campId: string
    messages: readonly CampMessageView[]
  } | null>(null)
  const [newConversationOpen, setNewConversationOpen] = useState(false)
  const [newConversationInitialWorkspace, setNewConversationInitialWorkspace] = useState<WorkspaceSelection | null>(null)
  const [newConversationInitialSelection, setNewConversationInitialSelection] = useState<GeneralPreferencesSnapshot['newConversationDefaults']>(null)
  const [newConversationAttention, setNewConversationAttention] = useState<string | null>(null)
  const [explainNewConversationSelectionAdjustments, setExplainNewConversationSelectionAdjustments] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
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
  const campViewedAcknowledgementKey = useRef<string | null>(null)
  const healthRequest = useRef<Promise<HealthStatus> | null>(null)
  const agentListRequest = useRef<Promise<AgentProfile[]> | null>(null)
  const navigationRequest = useRef<Promise<NavigationSnapshot> | null>(null)
  const overviewRequest = useRef<Promise<boolean> | null>(null)
  const startupSnapshotRequest = useRef<Promise<void> | null>(null)
  const lastMainView = useRef<View>('compose')
  const newConversationReturnFocus = useRef<HTMLElement | null>(null)
  const liveRuntimeEventSequence = useRef(0)
  const runtimeHealthRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const membersViewRef = useRef<MembersViewHandle>(null)
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

  const setCampSnapshot = useCallback((snapshot: CampSurfaceSnapshot | null): void => {
    campSnapshotRef.current = snapshot
    if (snapshot) rememberCampSnapshot(campSnapshotCache.current, snapshot)
    setCampSnapshotState(snapshot)
  }, [])

  const clearCampOpenFeedback = useCallback((): void => {
    if (campOpenFeedbackTimer.current !== null) {
      clearTimeout(campOpenFeedbackTimer.current)
      campOpenFeedbackTimer.current = null
    }
    setOpeningCampId(null)
  }, [])

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
    const traceId = crypto.randomUUID()
    const startedAt = performance.now()
    const method = mode === 'enter' ? 'camps.enter' : 'camps.open'
    console.info(`[camp-open] trace=${traceId} stage=renderer_request method=${method}`)
    const projection = mode === 'enter'
      ? await window.rovai.request<CampOpenProjection>('camps.enter', {
          traceId,
          commandId: crypto.randomUUID(),
          command: { campId }
        })
      : await window.rovai.request<CampOpenProjection>('camps.open', { traceId, campId })
    if (projection.schemaVersion !== 1) throw new Error('会话打开数据版本不兼容。')
    console.info(
      `[camp-open] trace=${traceId} stage=renderer_received method=${method} `
      + `elapsed_ms=${(performance.now() - startedAt).toFixed(1)} `
      + `schema=${projection.schemaVersion} high_water=${projection.throughGlobalSequence} `
      + `messages=${projection.messages.length} runs=${projection.agentRuns.length} `
      + `evidence=${projection.executionEvidence.length} timeline=${projection.timeline.length}`
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
    setSelectedMemberId(next?.agentId ?? null)
  }, [agents, selectedMemberId, view])

  useEffect(() => {
    try {
      window.localStorage.setItem(
        CAMP_INSPECTOR_VISIBILITY_KEY,
        campInspectorVisible ? 'visible' : 'hidden'
      )
    } catch {
      // A blocked storage area leaves the in-memory preference usable for this window.
    }
  }, [campInspectorVisible])

  const loadAgents = useCallback((): Promise<AgentProfile[]> => {
    if (agentListRequest.current) return agentListRequest.current
    const request = window.rovai.request<AgentProfile[]>('members.list')
      .then((nextAgents) => {
        setAgents(nextAgents)
        return nextAgents
      })
    agentListRequest.current = request
    void request.finally(() => {
      if (agentListRequest.current === request) agentListRequest.current = null
    }).catch(() => undefined)
    return request
  }, [])

  const loadNavigation = useCallback((): Promise<NavigationSnapshot> => {
    if (navigationRequest.current) return navigationRequest.current
    const request = window.rovai.request<NavigationSnapshot>('navigation.snapshot')
      .then((nextNavigation) => {
        setNavigation(nextNavigation)
        return nextNavigation
      })
    navigationRequest.current = request
    void request.finally(() => {
      if (navigationRequest.current === request) navigationRequest.current = null
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
        const nextInstallationsPromise = window.rovai
          .request<AdapterInstallation[]>('runtime.installations.list')
          .then((nextInstallations) => {
            setInstallations(nextInstallations)
            return nextInstallations
          })
        const nextMemoryReviewItemsPromise = window.rovai
          .request<HearthReviewItem[]>('memory.hearthReviewItems.list')
          .then((nextMemoryReviewItems) => {
            setPendingMemoryCount(
              nextMemoryReviewItems.filter((reviewItem) => reviewItem.status === 'pending').length
            )
            return nextMemoryReviewItems
          })
        const nextNavigationPreferencesPromise = window.rovai.navigationPreferences.get()

        const [nextNavigation, nextNavigationPreferences] = await Promise.all([
          nextNavigationPromise,
          nextNavigationPreferencesPromise
        ])
        const resolvedPins = await resolveNavigationPins(
          nextNavigation,
          nextNavigationPreferences.pins
        )
        let resolvedNavigationPreferences = nextNavigationPreferences
        if (resolvedPins.pins.length !== nextNavigationPreferences.pins.length) {
          resolvedNavigationPreferences = await window.rovai.navigationPreferences.replacePins(
            resolvedPins.pins
          )
        }
        setNavigationPins(resolvedPins.pins)
        setRemovedProjectKeys(new Set(
          resolvedNavigationPreferences.removedProjects.map((project) => project.targetKey)
        ))
        setPinnedCampItems(resolvedPins.camps)
        await Promise.all([
          nextAgentsPromise,
          nextInstallationsPromise,
          nextMemoryReviewItemsPromise
        ])
        setState('ready')
        return true
      } catch (nextError) {
        setError(errorMessage(nextError))
        setState('error')
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
    const request = window.rovai.request<HealthStatus>('health.check')
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

  const loadMemberData = useCallback(async (): Promise<void> => {
    const [, nextInstallations] = await Promise.all([
      loadAgents(),
      window.rovai.request<AdapterInstallation[]>('runtime.installations.list')
    ])
    setInstallations(nextInstallations)
  }, [loadAgents])

  const loadGeneralPreferences = useCallback(async (): Promise<void> => {
    setGeneralPreferences(await window.rovai.generalPreferences.get())
  }, [])

  const applyNavigationPreferences = useCallback((
    snapshot: NavigationPreferencesSnapshot
  ): void => {
    setNavigationPins(snapshot.pins)
    setRemovedProjectKeys(new Set(
      snapshot.removedProjects.map((project) => project.targetKey)
    ))
  }, [])

  const restoreNavigationProject = useCallback(async (projectPath: string): Promise<void> => {
    const targetKey = projectTargetKey(projectPath)
    setRemovedProjectKeys((current) => {
      if (!current.has(targetKey)) return current
      const next = new Set(current)
      next.delete(targetKey)
      return next
    })
    try {
      const snapshot = await window.rovai.navigationPreferences.restoreProject(targetKey)
      applyNavigationPreferences(snapshot)
    } catch (nextError) {
      // A local navigation preference must never block opening or creating the
      // Core-owned Camp. Keep the Project visible for this session and surface
      // that only its cross-restart restoration could not be saved.
      setError(`项目已重新显示，但侧栏恢复状态未能保存：${errorMessage(nextError)}`)
    }
  }, [applyNavigationPreferences])

  const loadStartupSnapshot = useCallback((): Promise<void> => {
    if (startupSnapshotRequest.current) return startupSnapshotRequest.current
    const request = (async (): Promise<void> => {
      try {
        const snapshot = await window.rovai.desktopSession.getStartupSnapshot()
        setStartupSnapshot(snapshot)
        setSettingsSection(snapshot.lastSettingsSection)
        setStartupError(null)
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
  }, [])

  const commitRestorableLocation = useCallback(async (
    location: RestorableLocation
  ): Promise<void> => {
    pendingRestorableLocation.current = location
    try {
      await window.rovai.desktopSession.commitRestorableLocation(location)
      if (JSON.stringify(pendingRestorableLocation.current) === JSON.stringify(location)) {
        setLocationSaveError(null)
      }
    } catch (nextError) {
      setLocationSaveError(errorMessage(nextError))
    }
  }, [])

  const activateCamp = useCallback(async (
    campId: string,
    options: {
      reconcileDefaultLead?: boolean
      preserveNotificationFocus?: boolean
      suppressErrors?: boolean
      anchoredMessages?: readonly CampMessageView[]
    } = {}
  ): Promise<boolean> => {
    const selectionGeneration = ++campSelectionGeneration.current
    clearCampOpenFeedback()
    const cachedSnapshot = activeCampIdRef.current === campId
      ? null
      : recentCampSnapshot(campSnapshotCache.current, campId)
    const previewSnapshot = campActivationPreview(
      campSnapshotRef.current,
      activeCampIdRef.current,
      cachedSnapshot,
      campId
    )
    const commitCampSurface = (snapshot: CampSurfaceSnapshot): void => {
      const snapshotProject = currentProjectForCamp(snapshot.camp)
      setCurrentProject(snapshotProject)
      persistCurrentProject(snapshotProject)
      campEventSequenceMarker.current = snapshot.throughGlobalSequence
      if (!options.preserveNotificationFocus) {
        setNotificationFocus(null)
        setNotificationAnchor(null)
      }
      if (options.anchoredMessages && options.anchoredMessages.length > 0) {
        setNotificationAnchor({
          campId,
          messages: options.anchoredMessages
        })
      }
      setActiveCampId(campId)
      setCampSnapshot(snapshot)
      lastMainView.current = 'camp'
      setView('camp')
    }
    if (previewSnapshot) {
      commitCampSurface(previewSnapshot)
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
      if (selectionGeneration !== campSelectionGeneration.current) return false
      clearCampOpenFeedback()
      commitCampSurface(snapshot)
      await afterNextPaint()
      if (selectionGeneration !== campSelectionGeneration.current) return false
      console.info(
        `[camp-open] trace=${traceId} stage=renderer_meaningful_paint `
        + `elapsed_ms=${(performance.now() - startedAt).toFixed(1)}`
      )
      void (async () => {
        if (snapshot.camp.projectBindingKind === 'directory') {
          await restoreNavigationProject(snapshot.camp.projectPath)
          if (selectionGeneration !== campSelectionGeneration.current) return
        }
        await loadNavigation()
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
      if (selectionGeneration === campSelectionGeneration.current) {
        clearCampOpenFeedback()
        if (options.suppressErrors) {
          setActiveCampId(null)
          setCampSnapshot(null)
          lastMainView.current = 'compose'
          setView('compose')
        } else {
          setError(errorMessage(nextError))
        }
      }
      return false
    }
  }, [clearCampOpenFeedback, loadNavigation, requestCampProjection, restoreNavigationProject, setCampSnapshot])

  const refreshActiveCampSnapshot = useCallback(async (campId: string): Promise<void> => {
    const { snapshot } = await requestCampProjection(campId, 'open')
    if (activeCampIdRef.current !== campId) return
    if (snapshot.throughGlobalSequence < campEventSequenceMarker.current) return
    campEventSequenceMarker.current = snapshot.throughGlobalSequence
    setCampSnapshot(snapshot)
  }, [requestCampProjection, setCampSnapshot])

  const loadEarlierCampMessages = useCallback(async (): Promise<void> => {
    const requestedSnapshot = campSnapshotRef.current
    const coverage = requestedSnapshot?.openCoverage?.messages
    const beforeSequence = coverage?.oldestLoadedSequence ?? null
    if (!requestedSnapshot || !coverage?.hasEarlier || beforeSequence === null) return
    const campId = requestedSnapshot.camp.id
    const selectionGeneration = campSelectionGeneration.current
    const page = await window.rovai.request<CampMessagePage>('camp.messages.page', {
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
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(null), 3_200)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (notificationFocus?.kind !== 'camp_message') setNotificationAnchor(null)
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
    void loadStartupSnapshot()
  }, [loadStartupSnapshot])

  useEffect(() => {
    void loadGeneralPreferences().catch((nextError) => setError(errorMessage(nextError)))
  }, [loadGeneralPreferences])

  useEffect(() => {
    if (
      !shouldInvalidateNewConversationDefaults(generalPreferences, agents, state === 'ready')
      || invalidatingNewConversationDefaults.current
    ) return
    invalidatingNewConversationDefaults.current = true
    void window.rovai.generalPreferences.invalidateNewConversationDefaults()
      .then(setGeneralPreferences)
      .catch((nextError) => setError(errorMessage(nextError)))
      .finally(() => { invalidatingNewConversationDefaults.current = false })
  }, [agents, generalPreferences, state])

  const currentProjectPath = currentProject.kind === 'directory'
    ? currentProject.projectPath
    : null
  const visibleNavigation = useMemo(
    () => navigationWithoutRemovedProjects(navigation, removedProjectKeys),
    [navigation, removedProjectKeys]
  )
  const authoritativeCurrentProjectPath = currentProjectGroup(
    visibleNavigation,
    currentProject
  )?.projectPath ?? null

  useEffect(() => {
    if (!visibleNavigation) return undefined
    if (
      currentProject.kind === 'directory'
      && removedProjectKeys.has(projectTargetKey(currentProject.projectPath))
    ) {
      const fallback: CurrentProject = { kind: 'quick_chat' }
      setCurrentProject(fallback)
      setCurrentWorkspaceHint(null)
      persistCurrentProject(fallback)
      return undefined
    }
    if (currentProject.kind === 'quick_chat' || authoritativeCurrentProjectPath) {
      setCurrentWorkspaceHint(null)
      return undefined
    }
    if (currentWorkspaceHint?.projectPath === currentProject.projectPath) return undefined

    let cancelled = false
    void window.rovai.request<WorkspaceInspection>('workspaces.inspect', {
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
    authoritativeCurrentProjectPath,
    currentProject.kind,
    currentProjectPath,
    currentWorkspaceHint?.projectPath,
    removedProjectKeys,
    visibleNavigation !== null
  ])

  useEffect(() => {
    // Resolve the frozen Main Window Session with only the authority required by
    // its target. The full Overview is deliberately not part of this startup gate.
    if (
      !startupSnapshot
      || startupResolvedSessionId.current === startupSnapshot.sessionId
    ) return
    let cancelled = false

    const showQuickChat = (): void => {
      cancelPendingCampActivation()
      setActiveCampId(null)
      setCampSnapshot(null)
      setNotificationFocus(null)
      lastMainView.current = 'compose'
      setView('compose')
    }

    const resolve = async (): Promise<void> => {
      const target = startupTargetFromSnapshot(startupSnapshot)
      if (target.kind === 'quick_chat') {
        showQuickChat()
      } else if (target.kind === 'memory') {
        cancelPendingCampActivation()
        setActiveCampId(null)
        setCampSnapshot(null)
        setMemoryFocusId(null)
        lastMainView.current = 'memory'
        setView('memory')
      } else if (target.kind === 'members') {
        const nextAgents = await loadAgents()
        if (cancelled) return
        cancelPendingCampActivation()
        setActiveCampId(null)
        setCampSnapshot(null)
        setSelectedMemberId(restoredMemberId(target.agentId, nextAgents))
        setMemberTab(target.tab)
        setMemberReturnTarget({ kind: 'app' })
        lastMainView.current = 'members'
        setView('members')
      } else {
        let opened: Awaited<ReturnType<typeof requestCampProjection>>
        try {
          opened = await requestCampProjection(target.campId, 'enter')
        } catch (snapshotError) {
          const authoritativeNavigation = await loadNavigation()
          if (cancelled) return
          const exists = await campExistsInAuthoritativeNavigation(
            target.campId,
            authoritativeNavigation,
            (projectPath, offset) => window.rovai.request<NavigationCampPage>(
              'navigation.groupCamps',
              { projectPath, offset, limit: 200 }
            )
          )
          if (!exists) {
            showQuickChat()
            if (!cancelled) {
              startupResolvedSessionId.current = startupSnapshot.sessionId
              setStartupStatus('resolved')
              setStartupError(null)
            }
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
        lastMainView.current = 'camp'
        setView('camp')
        startupResolvedSessionId.current = startupSnapshot.sessionId
        setStartupStatus('resolved')
        setStartupError(null)
        await afterNextPaint()
        if (cancelled || selectionGeneration !== campSelectionGeneration.current) return
        console.info(
          `[camp-open] trace=${traceId} stage=renderer_meaningful_paint source=startup `
          + `elapsed_ms=${(performance.now() - startedAt).toFixed(1)}`
        )
        void (async () => {
          if (snapshot.camp.projectBindingKind === 'directory') {
            await restoreNavigationProject(snapshot.camp.projectPath)
            if (cancelled || selectionGeneration !== campSelectionGeneration.current) return
          }
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
      if (cancelled) return
      startupResolvedSessionId.current = startupSnapshot.sessionId
      setStartupStatus('resolved')
      setStartupError(null)
    }

    setStartupStatus('loading')
    const resolution = resolve()
    // resolve() synchronously queues a restored Camp/Member authority request before
    // its first await. Defer Overview so those route-critical reads stay ahead of
    // sidebar, Runtime, Memory and pin hydration in Core's serialized queue.
    const overviewTimer = window.setTimeout(() => {
      void loadOverview(true)
    }, 0)
    void resolution.catch((nextError) => {
      if (cancelled) return
      setStartupStatus('waiting')
      setStartupError(errorMessage(nextError))
    })
    return () => {
      cancelled = true
      window.clearTimeout(overviewTimer)
    }
  }, [
    cancelPendingCampActivation,
    loadAgents,
    loadNavigation,
    loadOverview,
    requestCampProjection,
    restoreNavigationProject,
    setCampSnapshot,
    startupSnapshot
  ])

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
    let active = true
    const acceptSnapshot = (snapshot: AppearanceSnapshot): void => {
      applyAppearanceSnapshot(document.documentElement, snapshot)
      if (active) setAppearance(snapshot)
    }
    const unsubscribe = window.rovai.appearance.onChanged(acceptSnapshot)
    void window.rovai.appearance.get()
      .then(acceptSnapshot)
      .catch((nextError) => {
        if (active) setError(errorMessage(nextError))
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!shouldLoadRuntimeHealth(
      view,
      settingsSection,
      health !== null,
      healthAttempted
    )) return
    void loadHealth().catch((nextError) => setError(errorMessage(nextError)))
  }, [health, healthAttempted, loadHealth, settingsSection, view])

  useEffect(() => {
    if (state !== 'ready') return
    const timer = setInterval(() => {
      void loadNavigation().catch(() => undefined)
    }, 1_800)
    return () => clearInterval(timer)
  }, [loadNavigation, state])

  useEffect(() => {
    if (
      view !== 'camp'
      || !activeCampId
      || campSnapshot?.camp.id !== activeCampId
    ) return undefined
    const campId = activeCampId
    const throughGlobalSequence = campSnapshot.throughGlobalSequence
    const key = `${campId}:${throughGlobalSequence}`
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
      if (campViewedAcknowledgementKey.current === key) return
      campViewedAcknowledgementKey.current = key
      try {
        await window.rovai.request('navigation.campViewed', {
          campId,
          throughGlobalSequence
        })
        if (!cancelled) await loadNavigation()
      } catch {
        if (campViewedAcknowledgementKey.current === key) {
          campViewedAcknowledgementKey.current = null
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
    loadNavigation,
    view
  ])

  useEffect(() => {
    return window.rovai.onEvent((event: CoreEvent) => {
      const params = asRecord(event.params)
      const liveEvent = liveRuntimeEventFromCore(
        event,
        `live-${++liveRuntimeEventSequence.current}`
      )
      if (liveEvent) {
        setLiveRuntimeEvents((current) => [...current, liveEvent].slice(-600))
      }
      if (event.method === 'runtime.state') {
        const runtimeStatus = stringField(params, 'status')
        if (runtimeStatus === 'shutting_down') {
          setShuttingDown(true)
        } else if (runtimeStatus === 'crashed') {
          setState('error')
          setError(stringField(params, 'message') ?? '后台服务已停止。')
        } else if (runtimeStatus === 'starting' || runtimeStatus === 'restarting') {
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
        if (runtimeHealthRefreshTimer.current) clearTimeout(runtimeHealthRefreshTimer.current)
        runtimeHealthRefreshTimer.current = setTimeout(() => {
          runtimeHealthRefreshTimer.current = null
          void Promise.all([loadHealth(), loadMemberData()]).catch(() => undefined)
        }, 80)
      }
      if (event.method === 'agent_run.cancelled' || event.method === 'agent_run.recovery_blocker_resolved') {
        const eventCampId = stringField(params, 'campId')
        const campId = activeCampIdRef.current
        if (campId && (!eventCampId || eventCampId === campId)) {
          void refreshActiveCampSnapshot(campId).catch((nextError) => {
            if (activeCampIdRef.current === campId) setError(errorMessage(nextError))
          })
        }
      }
    })
  }, [loadHealth, loadMemberData, loadOverview, refreshActiveCampSnapshot])

  const displayNavigation = navigationIncludingCurrentWorkspace(
    visibleNavigation,
    currentProject,
    currentWorkspaceHint
  )
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
  const activeCampTitle = activeCamp?.title
    ?? (campSnapshot?.camp.id === activeCampId ? campSnapshot.camp.title : '')
  const activeCampContextLabel = activeCampProject?.name
    ?? (activeProjectPath === currentProjectPath ? currentProjectLabel : '快速对话')
  const activeCancellingTurnIds = useMemo(
    () => campSnapshot?.camp.id === activeCampId
      ? effectiveCancellingTurnIds(cancellingTurnIds, campSnapshot)
      : new Set<string>(),
    [activeCampId, campSnapshot, cancellingTurnIds]
  )
  const activeCampStopping = activeCancellingTurnIds.size > 0

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    if (!activeCampId || campSnapshot?.camp.id !== activeCampId) return undefined
    const campId = activeCampId

    const refreshSnapshot = async (): Promise<void> => {
      const { snapshot } = await requestCampProjection(campId, 'open')
      if (cancelled) return
      if (snapshot.throughGlobalSequence < campEventSequenceMarker.current) return
      campEventSequenceMarker.current = snapshot.throughGlobalSequence
      setCampSnapshot(snapshot)
    }

    const poll = async (): Promise<void> => {
      try {
        const batch = await window.rovai.request<EventBatch>('events.subscribe', {
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
          void window.rovai.request<HearthReviewItem[]>('memory.hearthReviewItems.list')
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
    explainInitialSelectionAdjustments = false
  ): void => {
    newConversationReturnFocus.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    setNewConversationInitialWorkspace(workspace)
    setNewConversationInitialSelection(generalPreferences?.newConversationDefaults ?? null)
    setNewConversationAttention(attentionMessage)
    setExplainNewConversationSelectionAdjustments(explainInitialSelectionAdjustments)
    setNewConversationOpen(true)
  }

  const requestNewConversation = async (
    workspace: WorkspaceSelection | null
  ): Promise<'created' | 'dialog' | 'ignored'> => {
    if (busy === 'create-camp') return 'ignored'
    const defaults = resolveNewConversationDefaults(generalPreferences, agents)
    if (generalPreferences?.oneClickNewConversationEnabled && defaults) {
      try {
        await createCamp({
          name: null,
          workspace: workspace ? { projectPath: workspace.projectPath } : null,
          memberAgentIds: defaults.defaults.memberAgentIds,
          defaultLeadAgentId: defaults.defaults.defaultLeadAgentId,
          collaborationMode: 'peer',
          activationState: campActivationStateForCreation('one_click')
        })
        return 'created'
      } catch (nextError) {
        openNewConversation(
          workspace,
          `一键创建未完成：${errorMessage(nextError)} 请重新确认项目、队员与默认负责人。`
        )
        return 'dialog'
      }
    }
    const explainInitialSelectionAdjustments = Boolean(
      generalPreferences?.newConversationDefaults && !defaults
    )
    openNewConversation(workspace, null, explainInitialSelectionAdjustments)
    return 'dialog'
  }

  const chooseWorkspaceDirectory = async (): Promise<WorkspaceSelection | null> => {
    setBusy('open-project')
    try {
      return await window.rovai.selectWorkspaceDirectory()
    } finally {
      setBusy(null)
    }
  }

  const openProject = async (): Promise<void> => {
    setError(null)
    try {
      const workspace = await chooseWorkspaceDirectory()
      if (workspace) {
        await restoreNavigationProject(workspace.projectPath)
        const outcome = await requestNewConversation(workspace)
        if (outcome === 'created') {
          chooseCurrentProject({ kind: 'directory', projectPath: workspace.projectPath }, workspace)
        }
      }
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
    const commit = (): void => {
      if (nextView !== 'camp') cancelPendingCampActivation()
      if (nextView === 'members' && viewRef.current !== 'members') {
        setMemberReturnTarget(memberReturnTargetForSource(
          viewRef.current,
          activeCampIdRef.current
            ? {
                campId: activeCampIdRef.current,
                contextLabel: activeCampContextLabel,
                title: activeCampTitle
              }
            : null
        ))
      }
      if (nextView !== 'settings') lastMainView.current = nextView
      if (nextView !== 'camp') setNotificationFocus(null)
      setView(nextView)
    }
    if (nextView === 'members') commit()
    else void requestMemberTransition(commit)
  }

  const chooseMember = (
    agentId: string,
    tab: MemberWorkspaceTab,
    focusRuntime: boolean
  ): void => {
    const commit = (): void => {
      setSelectedMemberId(agentId)
      setMemberTab(tab)
      if (focusRuntime) setMemberRuntimeFocusRequest((request) => request + 1)
    }
    if (selectedMemberId === agentId) commit()
    else void requestMemberTransition(commit)
  }

  const configureMemberRuntime = (agentId: string): void => {
    setRuntimeRecovery(null)
    setSelectedMemberId(agentId)
    setMemberTab('runtime')
    setMemberRuntimeFocusRequest((request) => request + 1)
    chooseView('members')
  }

  const openMemoryReviews = (): void => {
    setMemoryReviewNotice(false)
    setMemoryFocusId(null)
    setMemoryReviewDrawerSignal((current) => current + 1)
    chooseView('memory')
  }

  const openAutomaticMemory = (): void => {
    setMemoryFocusId(memoryAutoNotice.memoryId)
    setMemoryAutoNotice({ count: 0, memoryId: null, scope: null })
    chooseView('memory')
  }

  const closeSettings = (): void => {
    const target = lastMainView.current
    setView(target === 'camp' && !activeCampId ? 'compose' : target)
  }

  const chooseSettingsSection = (section: SettingsSection): void => {
    setSettingsSection(section)
    void window.rovai.generalPreferences.setLastSettingsSection(section)
      .catch((nextError) => setError(errorMessage(nextError)))
  }

  const commitMemoryLocation = useCallback((): void => {
    if (!startupResolvedSessionId.current || viewRef.current !== 'memory') return
    void commitRestorableLocation({ kind: 'memory' })
  }, [commitRestorableLocation])

  const retryStartup = (): void => {
    setStartupStatus('loading')
    setStartupError(null)
    void loadStartupSnapshot()
  }

  const closeMembers = (): void => {
    void requestMemberTransition(async () => {
      if (memberReturnTarget.kind === 'conversation') {
        await activateCamp(memberReturnTarget.campId, { suppressErrors: true })
        return
      }
      cancelPendingCampActivation()
      setActiveCampId(null)
      setCampSnapshot(null)
      setNotificationFocus(null)
      lastMainView.current = 'compose'
      setView('compose')
    })
  }

  const beginNewConversation = (): void => {
    void requestMemberTransition(async () => {
      cancelPendingCampActivation()
      await requestNewConversation(currentProjectWorkspace(displayNavigation, currentProject))
    })
  }

  const chooseCamp = (camp: NavigationCampItem): void => {
    void requestMemberTransition(() => {
      return activateCamp(camp.id, {
        reconcileDefaultLead: camp.activationState !== 'pending'
      }).then(() => undefined)
    })
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
        let anchoredMessages: readonly CampMessageView[] = []
        if (action.kind === 'open_camp_message') {
          if (!action.messageId) {
            result = {
              status: 'failed',
              message: '消息动作没有可用的精确定位目标。'
            }
            return
          }
          const around = await window.rovai.request<CampMessageAroundSnapshot>(
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
        const target: NotificationFocusTarget | null = action.kind === 'open_camp_message'
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
            : null
        setNotificationFocus(target ? { ...target, active: false } : null)
        const activated = await activateCamp(action.campId, {
          preserveNotificationFocus: target !== null,
          reconcileDefaultLead: true,
          suppressErrors: true,
          anchoredMessages
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
    if (!notificationPresentationRef.current?.complete(requestId)) return
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
      const snapshot = await window.rovai.navigationPreferences.replacePins(nextPins)
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
    setBusy(`remove-project-${project.projectKey}`)
    setError(null)
    try {
      const relatedPinnedCampIds = pinnedCampItems
        .filter((camp) => (
          camp.projectBindingKind === 'directory'
          && camp.projectPath === project.projectPath
        ))
        .map((camp) => camp.id)
      const snapshot = await window.rovai.navigationPreferences.removeProject(
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
      const removingActiveCamp = campSnapshot?.camp.id === activeCampId
        && campSnapshot.camp.projectBindingKind === 'directory'
        && campSnapshot.camp.projectPath === project.projectPath
      if (removingCurrent) {
        const fallback: CurrentProject = { kind: 'quick_chat' }
        setCurrentProject(fallback)
        setCurrentWorkspaceHint(null)
        persistCurrentProject(fallback)
      }
      if (removingActiveCamp) {
        cancelPendingCampActivation()
        setActiveCampId(null)
        setCampSnapshot(null)
        setNotificationFocus(null)
        lastMainView.current = 'compose'
        setView('compose')
      }
      if (removingCurrent || removingActiveCamp) {
        await commitRestorableLocation({ kind: 'quick_chat' })
      }
      setToast(`已从侧栏移除“${project.name}”`)
    } finally {
      setBusy(null)
    }
  }

  const renameCamp = async (camp: NavigationCampItem, title: string): Promise<void> => {
    setBusy(`rename-camp-${camp.id}`)
    setError(null)
    try {
      const result = await window.rovai.request<StoredCommandResult>('camps.rename', {
        commandId: crypto.randomUUID(),
        command: {
          campId: camp.id,
          title,
          expectedVersion: camp.version
        }
      })
      if (result.status === 'rejected') throw new Error(commandFailureMessage(result))
      await loadNavigation()
      if (activeCampId === camp.id) {
        const { snapshot } = await requestCampProjection(camp.id, 'open')
        campEventSequenceMarker.current = snapshot.throughGlobalSequence
        setCampSnapshot(snapshot)
      }
    } finally {
      setBusy(null)
    }
  }

  const deleteCamp = async (camp: NavigationCampItem): Promise<CampDeleteAttempt> => {
    setBusy(`delete-camp-${camp.id}`)
    setError(null)
    try {
      const result = await window.rovai.request<StoredCommandResult>('camps.delete', {
        commandId: crypto.randomUUID(),
        command: {
          campId: camp.id,
          expectedVersion: camp.version
        }
      })
      if (result.status === 'rejected') {
        if (result.code === 'camp.delete_blocked') {
          return { deleted: false, blockers: campDeleteBlockers(result.payload) }
        }
        throw new Error(commandFailureMessage(result))
      }
      campSnapshotCache.current.delete(camp.id)
      if (activeCampId === camp.id) {
        cancelPendingCampActivation()
        setActiveCampId(null)
        setCampSnapshot(null)
        lastMainView.current = 'compose'
        setView('compose')
      }
      await loadNavigation()
      return { deleted: true, blockers: [] }
    } finally {
      setBusy(null)
    }
  }

  const stopCampRuns = async (camp: NavigationCampItem | null = null): Promise<void> => {
    const campId = camp?.id ?? activeCampId
    if (!campId) return
    setError(null)
    let requestedTurnIds: string[] = []
    try {
      const snapshot = campSnapshot?.camp.id === campId
        ? campSnapshot
        : (await requestCampProjection(campId, 'open')).snapshot
      const cancellableIds = new Set(cancellableTurnIds(
        snapshot,
        camp ? 'camp_cleanup' : 'current_execution'
      ))
      const activeTurns = snapshot.turns.filter((turn) => cancellableIds.has(turn.id))
      requestedTurnIds = activeTurns.map((turn) => turn.id)
      if (requestedTurnIds.length === 0) return
      setCancellingTurnIds((current) => new Set([...current, ...requestedTurnIds]))
      await Promise.all(activeTurns.map(async (turn) => {
        const result = await window.rovai.request<StoredCommandResult>('campTurns.cancel', {
          commandId: crypto.randomUUID(),
          command: {
            campId,
            campTurnId: turn.id,
            expectedVersion: turn.version
          }
        })
        if (result.status === 'rejected') throw new Error(commandFailureMessage(result))
      }))
    } catch (nextError) {
      setCancellingTurnIds((current) =>
        new Set([...current].filter((turnId) => !requestedTurnIds.includes(turnId)))
      )
      setError(errorMessage(nextError))
      throw nextError
    }
  }

  const resolveAgentRunRecoveryBlocker = async (run: AgentRunView): Promise<void> => {
    const campId = activeCampId
    if (!campId || campSnapshot?.camp.id !== campId) return
    setError(null)
    try {
      const result = await window.rovai.request<StoredCommandResult>(
        'agentRuns.resolveRecoveryBlocker',
        {
          commandId: crypto.randomUUID(),
          command: {
            campId,
            agentRunId: run.id,
            expectedVersion: run.version
          }
        }
      )
      if (result.status === 'rejected') throw new Error(commandFailureMessage(result))
      await Promise.all([
        refreshActiveCampSnapshot(campId),
        loadNavigation()
      ])
      setToast('已按“结果未知”结束运行；原请求没有重发')
    } catch (nextError) {
      setError(errorMessage(nextError))
      throw nextError
    }
  }

  const changeDefaultLead = async (agentId: string): Promise<void> => {
    if (!activeCampId || campSnapshot?.camp.id !== activeCampId) return
    setBusy('change-default-lead')
    setError(null)
    try {
      const result = await window.rovai.request<StoredCommandResult>('camps.changeDefaultLead', {
        commandId: crypto.randomUUID(),
        command: {
          campId: activeCampId,
          successorAgentId: agentId,
          expectedVersion: campSnapshot.camp.version
        }
      })
      if (result.status === 'rejected') throw new Error(commandFailureMessage(result))
      const [{ snapshot }] = await Promise.all([
        requestCampProjection(activeCampId, 'open'),
        loadNavigation()
      ])
      campEventSequenceMarker.current = snapshot.throughGlobalSequence
      setCampSnapshot(snapshot)
    } catch (nextError) {
      setError(errorMessage(nextError))
      throw nextError
    } finally {
      setBusy(null)
    }
  }

  async function createCamp(
    draft: Omit<CreateCampRequest, 'commandId'>
  ): Promise<void> {
    setBusy('create-camp')
    try {
      if (draft.workspace) {
        await restoreNavigationProject(draft.workspace.projectPath)
      }
      const result = await window.rovai.request<StoredCommandResult>('camps.create', {
        commandId: crypto.randomUUID(),
        ...draft
      })
      if (result.status === 'rejected') throw new Error(commandFailureMessage(result))
      const campId = stringField(result.payload, 'campId')
      if (!campId) throw new Error('会话已创建，但暂时无法打开。请刷新会话列表后重试。')
      setNewConversationOpen(false)
      await activateCamp(campId, { reconcileDefaultLead: false })
    } finally {
      setBusy(null)
    }
  }

  const refreshPendingCampNavigation = (): void => {
    void loadNavigation().catch(() => undefined)
  }

  const settlePendingCampOnLeave = async (draft: CampComposerDraftView): Promise<void> => {
    if (draft.body.trim() || draft.attachments.length > 0 || draft.replyIntent) {
      await loadNavigation()
      return
    }
    const result = await window.rovai.request<StoredCommandResult>('camps.discardPending', {
      commandId: crypto.randomUUID(),
      command: { campId: draft.campId }
    })
    if (result.status === 'rejected' && result.code !== 'camp.pending_not_empty') {
      throw new Error(commandFailureMessage(result))
    }
    if (result.status !== 'rejected' && activeCampIdRef.current === draft.campId) {
      cancelPendingCampActivation()
      setActiveCampId(null)
      setCampSnapshot(null)
      if (lastMainView.current === 'camp') lastMainView.current = 'compose'
    }
    await loadNavigation()
  }

  const sendCampMessage = async (
    draft: CampComposerDraftView
  ): Promise<CampMessageSendReceipt | void> => {
    if (!activeCampId || draft.campId !== activeCampId || !draft.body.trim() || draft.revision < 1) return
    const campId = activeCampId
    const commandId = crypto.randomUUID()
    const selectionGeneration = campSelectionGeneration.current
    const optimisticMessage = optimisticCampMessage(
      campSnapshot?.camp.id === campId ? campSnapshot : null,
      commandId,
      draft
    )
    setOptimisticCampMessages((current) => [
      ...current,
      { campId, commandId, message: optimisticMessage }
    ])
    setBusy('camp-message')
    setError(null)
    setToast(null)
    setRuntimeRecovery((current) => current?.campId === campId ? null : current)
    let rejectedForRuntime = false
    try {
      const result = await window.rovai.request<SendCampMessageResult>(
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
      const campTurnId = stringField(result.commandResult.payload, 'campTurnId')
      const agentRunIds = stringArrayField(result.commandResult.payload, 'agentRunIds')
      const sequence = typeof result.commandResult.payload.sequence === 'number'
        ? result.commandResult.payload.sequence
        : optimisticMessage.sequence
      setOptimisticCampMessages((current) => current.map((entry) =>
        entry.commandId === commandId
          ? {
              ...entry,
              message: {
                ...entry.message,
                id: campMessageId ?? entry.message.id,
                sequence,
                campTurnId
              }
            }
          : entry
      ))
      void requestCampProjection(campId, 'open')
        .then(async ({ snapshot }) => {
          if (selectionGeneration !== campSelectionGeneration.current) return
          campEventSequenceMarker.current = snapshot.throughGlobalSequence
          setCampSnapshot(snapshot)
          setOptimisticCampMessages((current) =>
            current.filter((entry) => entry.commandId !== commandId)
          )
          if (selectionGeneration === campSelectionGeneration.current) await loadNavigation()
        })
        .catch((nextError) => setError(errorMessage(nextError)))
      return {
        campTurnId,
        agentRunIds,
        addressedAgentIds: optimisticMessage.addressedAgentIds
      }
    } catch (nextError) {
      setOptimisticCampMessages((current) =>
        current.filter((entry) => entry.commandId !== commandId)
      )
      if (!rejectedForRuntime) setToast(errorMessage(nextError))
      throw nextError
    } finally {
      setBusy(null)
    }
  }

  const resolveActionApproval = async (
    approval: ActionApprovalView,
    optionId: string
  ): Promise<void> => {
    if (!activeCampId) return
    setBusy(`action-approval-${approval.id}`)
    setError(null)
    try {
      const result = await window.rovai.request<StoredCommandResult>('action.approvals.resolve', {
        commandId: crypto.randomUUID(),
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

  const changeThemePreference = async (preference: ThemePreference): Promise<void> => {
    setBusy('appearance')
    setError(null)
    try {
      const snapshot = await window.rovai.appearance.setPreference(preference)
      applyAppearanceSnapshot(document.documentElement, snapshot)
      setAppearance(snapshot)
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const openCampInspector = (tab: CampInspectorTab): void => {
    setCampInspectorTab(tab)
    setCampInspectorVisible(true)
  }

  const focusCampApprovals = (): void => {
    setNotificationFocus({
      requestId: ++notificationFocusSequence.current,
      kind: 'approval',
      campTurnId: null,
      active: true
    })
  }

  const windowDragPage = windowDragStripPage(view)
  const visibleCampSnapshot = campSnapshot && activeCampId
    ? campSnapshotWithCurrentAnchor(campSnapshot, activeCampId, notificationAnchor)
    : campSnapshot
  const pageContentClassName: Record<View, string> = {
    compose: 'task-content compose-content',
    camp: 'task-content camp-content',
    members: 'members-content',
    memory: 'memory-content',
    settings: 'settings-content'
  }
  const startupGateVisible = startupStatus !== 'resolved'
  const inlineNotices = memoryReviewNotice || memoryAutoNotice.count > 0 || error || locationSaveError
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
          {error && (
            <div className="error-banner" role="alert">
              <span className="error-icon" aria-hidden="true">!</span>
              <div><strong>操作未完成</strong><span>{error}</span><small>项目文件和已经写入的审计记录不会因此丢失。</small></div>
              <div className="error-actions"><button className="quiet-button" onClick={() => void loadOverview()}>刷新状态</button><button className="icon-button" aria-label="关闭错误" onClick={() => setError(null)}>×</button></div>
            </div>
          )}
          {locationSaveError && (
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

  return (
    <div className="app-shell">
      <CampNavigation
        view={view}
        state={startupGateVisible ? 'loading' : state}
        navigation={displayNavigation}
        activeCampId={activeCampId}
        openingCampId={openingCampId}
        currentProjectKey={currentProjectKey}
        shellOnlyProjectPath={shellOnlyCurrentProjectPath}
        creatingConversation={busy === 'create-camp'}
        pins={navigationPins}
        pinnedCampItems={pinnedCampItems}
        settingsSection={settingsSection}
        onNewConversation={beginNewConversation}
        onMembers={() => chooseView('members')}
        onMemory={() => {
          setMemoryFocusId(null)
          chooseView('memory')
        }}
        pendingMemoryCount={pendingMemoryCount}
        memberSidebar={view === 'members' ? (
          <MemberSidebar
            agents={agents}
            runtimeAvailability={health?.runtimeAvailability ?? []}
            runtimeDiscoveryPending={health === null || healthLoading}
            selectedAgentId={selectedMemberId}
            returnTarget={memberReturnTarget}
            onBack={closeMembers}
            onSelect={chooseMember}
            onCreate={(trigger) => membersViewRef.current?.requestCreate(trigger)}
            onReload={loadMemberData}
          />
        ) : null}
        onSettings={() => chooseView('settings')}
        onSettingsSectionChange={chooseSettingsSection}
        onSettingsBack={closeSettings}
        onOpenProject={() => void openProject()}
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
          void requestMemberTransition(async () => {
            cancelPendingCampActivation()
            await requestNewConversation(project
              ? { name: project.name, projectPath: project.projectPath }
              : null)
          })
        }}
        onCamp={chooseCamp}
        onTogglePin={toggleNavigationPin}
        onRemoveProject={removeNavigationProject}
        onCampIdCopied={() => {
          setError(null)
          setToast('已复制会话 ID')
        }}
        onRename={renameCamp}
        onDelete={deleteCamp}
        onStop={stopCampRuns}
        onError={(nextError) => setError(errorMessage(nextError))}
      />
      {!startupGateVisible && view === 'camp' && <AppHeader
        campTitle={activeCampTitle || null}
        contextLabel={activeCampContextLabel}
        camp={campSnapshot?.camp.id === activeCampId ? campSnapshot : null}
        inspectorVisible={campSnapshot?.camp.activationState === 'active' && campInspectorVisible}
        onToggleInspector={() => setCampInspectorVisible((visible) => !visible)}
        onFocusApprovals={focusCampApprovals}
      />}
      {windowDragPage && <WindowDragStrip page={windowDragPage} />}

      <main className={`content ${pageContentClassName[view]}`}>
        {startupGateVisible && (
          <StartupGate
            waiting={startupStatus === 'waiting'}
            error={startupError}
            onRetry={retryStartup}
          />
        )}
        {!startupGateVisible && view !== 'members' && view !== 'memory' && inlineNotices}
        {!startupGateVisible && toast && (
          <div className="app-toast" role="status" aria-live="polite">
            <span>{toast}</span>
            <button className="icon-button" type="button" aria-label="关闭提示" onClick={() => setToast(null)}>×</button>
          </div>
        )}

        {!startupGateVisible && view === 'camp' && activeCampId && visibleCampSnapshot?.camp.id === activeCampId && (
          <CampWorkspace
            key={activeCampId}
            snapshot={visibleCampSnapshot}
            openCoverage={campSnapshot?.camp.id === activeCampId
              ? campSnapshot.openCoverage ?? null
              : null}
            messageHistory={campSnapshot?.camp.id === activeCampId
              ? campSnapshot.openCoverage?.messages ?? null
              : null}
            onLoadEarlierMessages={loadEarlierCampMessages}
            optimisticMessages={optimisticCampMessages
              .filter((entry) => entry.campId === activeCampId)
              .map((entry) => entry.message)}
            projectName={activeCampProject?.name ?? null}
            agents={agents}
            liveRuntimeEvents={liveRuntimeEvents}
            busy={busy === 'camp-message' || busy === 'change-default-lead' || busy?.startsWith('action-approval-') === true}
            onSend={sendCampMessage}
            onPendingDraftPersisted={refreshPendingCampNavigation}
            onPendingCampLeave={settlePendingCampOnLeave}
            onChangeLead={changeDefaultLead}
            onTasksChanged={() => activateCamp(activeCampId).then(() => undefined)}
            onResolveApproval={(approval, decision) => {
              void resolveActionApproval(approval, decision)
            }}
            onResolveRecoveryBlocker={resolveAgentRunRecoveryBlocker}
            cancellingTurnIds={activeCancellingTurnIds}
            stopping={activeCampStopping}
            onStop={() => void stopCampRuns()}
            inspectorVisible={visibleCampSnapshot.camp.activationState === 'active' && campInspectorVisible}
            inspectorTab={campInspectorTab}
            onInspectorTabChange={setCampInspectorTab}
            onOpenInspector={openCampInspector}
            notificationFocus={notificationFocus}
            onNotificationFocusPresented={completeNotificationNavigation}
            onVisibleNotificationSources={setVisibleNotificationSources}
            runtimeRecovery={runtimeRecovery?.campId === activeCampId ? runtimeRecovery : null}
            onConfigureRuntime={configureMemberRuntime}
            onDismissRuntimeRecovery={() => setRuntimeRecovery(null)}
          />
        )}

        {!startupGateVisible && view === 'compose' && (
          <QuickChatWorkspace
            agents={agents}
            recentCamps={visibleNavigation ? allNavigationCamps(visibleNavigation).slice(0, 5) : []}
            onOpenCamp={chooseCamp}
            onNewConversation={beginNewConversation}
          />
        )}

        {!startupGateVisible && view === 'memory' && (
          <MemoryLibrary
            agents={agents}
            topNotices={inlineNotices}
            refreshSignal={memoryRefreshKey}
            focusMemoryId={memoryFocusId}
            reviewDrawerSignal={memoryReviewDrawerSignal}
            onReviewDrawerSignalConsumed={() => setMemoryReviewDrawerSignal(0)}
            onPendingCountChange={setPendingMemoryCount}
            onReady={commitMemoryLocation}
          />
        )}

        {!startupGateVisible && view === 'settings' && (
          <SettingsView
            appearance={appearance}
            health={health}
            agents={agents}
            generalPreferences={generalPreferences}
            currentProjectLabel={currentProjectLabel}
            onGeneralPreferencesChange={setGeneralPreferences}
            installations={installations}
            busy={busy}
            section={settingsSection}
            onDiagnosticsNavigate={(section) => chooseSettingsSection(section)}
            onReload={async () => {
              await Promise.all([loadOverview(), loadHealth()])
            }}
            onThemeChange={(preference) => void changeThemePreference(preference)}
          />
        )}

        {!startupGateVisible && view === 'members' && (
          <MembersView
            ref={membersViewRef}
            agents={agents}
            topNotices={inlineNotices}
            installations={installations}
            runtimeAvailability={health?.runtimeAvailability ?? []}
            runtimeDiscoveryPending={health === null || healthLoading}
            selectedAgentId={selectedMemberId}
            activeTab={memberTab}
            runtimeFocusRequest={memberRuntimeFocusRequest}
            onSelectedAgentChange={(agentId, tab) => {
              setSelectedMemberId(agentId)
              setMemberTab(tab)
            }}
            onTabChange={setMemberTab}
            onReload={loadMemberData}
            onOpenRuntimeSettings={() => {
              chooseSettingsSection('runtime')
              chooseView('settings')
            }}
          />
        )}
      </main>

      <NewConversationDialog
        open={newConversationOpen}
        initialWorkspace={newConversationInitialWorkspace}
        initialSelection={newConversationInitialSelection}
        attentionMessage={newConversationAttention}
        explainInitialSelectionAdjustments={explainNewConversationSelectionAdjustments}
        projects={visibleNavigation?.projects ?? []}
        preflight={campCreationPreflight}
        agents={agents}
        busy={busy === 'create-camp' || busy === 'open-project'}
        returnFocusElement={newConversationReturnFocus.current}
        onOpenChange={setNewConversationOpen}
        onChooseWorkspaceDirectory={chooseWorkspaceDirectory}
        onWorkspaceSelected={(workspace) => restoreNavigationProject(workspace.projectPath)}
        onCreate={(draft) => createCamp({
          ...draft,
          activationState: campActivationStateForCreation('dialog')
        })}
      />
      <NotificationAttentionController
        enabled={!startupGateVisible}
        activeCampId={activeCampId}
        activeCampVisible={view === 'camp'
          && campSnapshot?.camp.id === activeCampId
          && !newConversationOpen
          && !shuttingDown}
        navigationActive={notificationFocus !== null}
        onNavigate={navigateFromNotification}
        onPresentNavigation={presentNotificationNavigation}
        onCancelNavigation={cancelNotificationNavigation}
        onRefreshVisibleCamp={refreshVisibleNotificationCamp}
        onError={setToast}
        visibleSources={visibleNotificationSources}
      />
      {shuttingDown && <ControlledShutdownOverlay />}
    </div>
  )
}

export function WindowDragStrip({
  page
}: {
  page: WindowDragStripPage
}): React.JSX.Element {
  return <div className={`window-drag-strip window-drag-strip-${page}`} aria-hidden="true" />
}

export function StartupGate({
  waiting,
  error,
  onRetry
}: {
  waiting: boolean
  error: string | null
  onRetry(): void
}): React.JSX.Element {
  return (
    <section className="startup-gate" aria-busy={!waiting} aria-live="polite">
      <span className="startup-gate-mark" aria-hidden="true">✦</span>
      <p className="settings-page-eyebrow">MAIN WINDOW SESSION</p>
      <h1>{waiting ? '暂时无法恢复上次位置' : '正在恢复上次位置'}</h1>
      <p>{waiting
        ? 'Rovai AI 会保留这次窗口冻结的恢复目标。后台服务恢复后将继续验证同一位置，不会清除或改走其他启动路线。'
        : '正在读取窗口偏好，并通过本地数据验证最近的稳定页面。'}</p>
      {error && <small role="alert">{error}</small>}
      {waiting && <button className="quiet-button" type="button" onClick={onRetry}>重试恢复</button>}
    </section>
  )
}

export function AppHeader({
  campTitle,
  contextLabel,
  camp,
  inspectorVisible,
  onToggleInspector,
  onFocusApprovals
}: {
  campTitle: string | null
  contextLabel: string | null
  camp: CampSnapshot | null
  inspectorVisible: boolean
  onToggleInspector(): void
  onFocusApprovals(): void
}): React.JSX.Element {
  const title = campTitle ?? '正在打开对话'
  const pendingApprovals = camp?.approvals.filter((approval) => approval.status === 'pending').length ?? 0
  const dayNumber = camp ? campDayNumber(camp.camp.createdAt) : null
  return (
    <header className="topbar">
      <div className="context-breadcrumb">
        {contextLabel && <span className="context-project">{contextLabel}</span>}
        {contextLabel && <span className="context-sep" aria-hidden="true">›</span>}
        <h1>{title}</h1>
      </div>
      {dayNumber !== null && <span className="context-day-badge">第 {dayNumber} 天</span>}
      {camp && camp.camp.activationState === 'active' && (
        <div className="topbar-context-actions">
          <div className="topbar-context-status" aria-live="polite">
            {pendingApprovals > 0 && (
              <button
                className="approval-badge"
                type="button"
                onClick={onFocusApprovals}
                aria-label={`待审批 ${pendingApprovals}，定位输入框上方审批`}
              >
                ◆ 待审批 {pendingApprovals}
              </button>
            )}
          </div>
          <button
            className={`topbar-inspector-toggle ${inspectorVisible ? 'is-visible' : 'is-hidden'}`}
            type="button"
            aria-label={inspectorVisible ? '隐藏右侧检查器' : '显示右侧检查器'}
            aria-pressed={inspectorVisible}
            title={inspectorVisible ? '隐藏右侧检查器' : '显示右侧检查器'}
            onClick={onToggleInspector}
          >
            {inspectorVisible
              ? (
                  <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 24 24">
                    <rect height="16" rx="2.5" width="17" x="3.5" y="4" />
                    <path d="M15 4v16" />
                    <path d="M15 4h3.5A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5H15z" fill="currentColor" opacity=".14" stroke="none" />
                    <path d="m17 9 3 3-3 3" />
                  </svg>
                )
              : (
                  <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 24 24">
                    <rect height="16" rx="2.5" width="17" x="3.5" y="4" />
                    <path d="M18 4v16" strokeDasharray="2 2" />
                    <path d="m16 9-3 3 3 3" />
                  </svg>
                )}
          </button>
        </div>
      )}
    </header>
  )
}

export function SettingsView({
  appearance,
  health,
  agents,
  generalPreferences,
  currentProjectLabel,
  onGeneralPreferencesChange,
  installations,
  busy,
  section,
  onDiagnosticsNavigate,
  onReload,
  onThemeChange
}: {
  appearance: AppearanceSnapshot
  health: HealthStatus | null
  agents: AgentProfile[]
  generalPreferences?: GeneralPreferencesSnapshot | null
  currentProjectLabel?: string
  onGeneralPreferencesChange?(preferences: GeneralPreferencesSnapshot): void
  installations: AdapterInstallation[]
  busy: string | null
  section: SettingsSection
  onDiagnosticsNavigate(section: 'mcp' | 'runtime', runtimeKind?: AdapterKind): void
  onReload(): Promise<void>
  onThemeChange(preference: ThemePreference): void
}): React.JSX.Element {
  return (
    <div className="settings-workbench">
      <div className={`settings-panel settings-panel-${section}`}>
        {section === 'general' && (
          <GeneralSettings
            agents={agents}
            initialPreferences={generalPreferences}
            currentProjectLabel={currentProjectLabel}
            onPreferencesChange={onGeneralPreferencesChange}
          />
        )}
        {section === 'skills' && <SkillSettings />}
        {section === 'mcp' && <McpSettings agents={agents} />}
        {section === 'runtime' && (
          <RuntimeInstallationsPanel health={health} installations={installations} onReload={onReload} />
        )}
        {section === 'appearance' && (
          <>
            <SettingsPageHeader
              eyebrow="Settings / Appearance"
              title="外观"
              description="瓷灰日间与 Steel Night 共享全部产品功能、语义色和交互边界。"
              aside={(
                <span className="settings-page-note">
                  当前 · {appearance.resolvedTheme === 'day' ? '瓷灰日间' : 'Steel Night'} · 偏好：{appearancePreferenceLabel(appearance.preference)}
                </span>
              )}
            />
            <AppearanceSettings
              appearance={appearance}
              disabled={busy === 'appearance'}
              onChange={onThemeChange}
            />
          </>
        )}
        {section === 'notifications' && (
          <NotificationSettings />
        )}
        {section === 'diagnostics' && (
          <DiagnosticsCenter onNavigate={onDiagnosticsNavigate} />
        )}
      </div>
    </div>
  )
}

function appearancePreferenceLabel(preference: ThemePreference): string {
  if (preference === 'system') return '跟随系统'
  if (preference === 'day') return '日间'
  return '夜间'
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

export function campSnapshotWithCurrentAnchor(
  snapshot: CampSnapshot,
  campId: string,
  anchor: { campId: string; messages: readonly CampMessageView[] } | null
): CampSnapshot {
  return anchor?.campId === campId
    ? campSnapshotWithAnchoredMessages(snapshot, anchor.messages)
    : snapshot
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
  return action.kind === 'open_approval'
    && (focus.approvalId ?? null) === (action.approvalId ?? null)
}

async function resolveNavigationPins(
  navigation: NavigationSnapshot,
  pins: NavigationPin[]
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
    const groups = [
      {
        projectPath: null as string | null,
        totalCount: navigation.quickChat.totalCount,
        knownCount: navigation.quickChat.recentCamps.length
      },
      ...navigation.projects.map((project) => ({
        projectPath: project.projectPath,
        totalCount: project.totalCount,
        knownCount: project.recentCamps.length
      }))
    ].filter((group) => group.totalCount > group.knownCount)

    await Promise.all(groups.map(async (group) => {
      let offset = 0
      for (;;) {
        if (unresolvedCampIds.size === 0) break
        const page = await window.rovai.request<NavigationCampPage>('navigation.groupCamps', {
          projectPath: group.projectPath,
          offset,
          limit: 200
        })
        if (page.schemaVersion !== 3) throw new Error('会话列表数据版本不兼容。')
        for (const camp of page.camps) {
          if (unresolvedCampIds.delete(camp.id)) campById.set(camp.id, camp)
        }
        if (unresolvedCampIds.size === 0 || page.nextOffset === null) break
        offset = page.nextOffset
      }
    }))
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
  const explicitlyMentionedIds = [...new Set(draft.content.flatMap((segment) =>
    segment.kind === 'member_mention' ? [segment.agentId] : []
  ))]
  const broadcast = draft.content.some((segment) => segment.kind === 'all_members_mention')
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
    body: draft.body,
    content: draft.content,
    attachments: draft.attachments,
    addressMode: broadcast ? 'broadcast' : explicitlyMentionedIds.length > 0 ? 'explicit' : 'default',
    addressedAgentIds,
    replyToCampMessageId: draft.replyIntent?.replyToCampMessageId ?? null,
    campTurnId: null,
    presentation: null,
    createdAt
  }
}

export function campMessageSendParams(
  commandId: string,
  campId: string,
  draft: CampComposerDraftView
): {
  commandId: string
  campId: string
  draftRevision: number
  execution: {
    taskId: null
    purpose: string
    completionRole: 'required'
  }
} {
  return {
    commandId,
    campId,
    draftRevision: draft.revision,
    execution: {
      taskId: null,
      purpose: draft.body.trim(),
      completionRole: 'required'
    }
  }
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
  return localizeExecutionEngineTerms(stringField(result.payload, 'message') ?? `操作未完成：${result.code}`)
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

function campDeleteBlockers(payload: Record<string, unknown>): Array<{ code: string; count: number }> {
  const blockers = payload.blockers
  if (!Array.isArray(blockers)) return []
  return blockers.flatMap((value) => {
    const blocker = asRecord(value)
    const code = stringField(blocker, 'code')
    const count = typeof blocker.count === 'number' ? blocker.count : null
    return code && count !== null ? [{ code, count }] : []
  })
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  return typeof value[key] === 'string' ? value[key] as string : null
}

function stringArrayField(value: Record<string, unknown>, key: string): string[] {
  return Array.isArray(value[key])
    ? value[key].filter((entry): entry is string => typeof entry === 'string')
    : []
}

function errorMessage(error: unknown): string {
  return localizeExecutionEngineTerms(error instanceof Error ? error.message : String(error))
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
