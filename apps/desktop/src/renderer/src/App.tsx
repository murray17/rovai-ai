import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AdapterInstallation,
  AgentProfile,
  ActionApprovalView,
  AppearanceSnapshot,
  CampCreationPreflight,
  CampMessageView,
  CampSnapshot,
  CreateCampRequest,
  CoreEvent,
  EventBatch,
  HealthStatus,
  InAppNotificationInbox,
  InAppNotificationView,
  NavigationCampItem,
  NavigationCampPage,
  NavigationPin,
  NavigationSnapshot,
  HearthMemoryProposal,
  PreparedAttachmentView,
  SendCampMessageResult,
  StoredCommandResult,
  ThemePreference,
  WorkspaceInspection
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
  type CampInspectorTab,
  type NotificationFocusTarget
} from './CampWorkspace'
import {
  CampNavigation,
  type CampDeleteAttempt,
  type NavigationSettingsSection
} from './CampNavigation'
import { NewConversationDialog } from './NewConversationDialog'
import { AppearanceSettings } from './AppearanceSettings'
import { NotificationCenter } from './NotificationCenter'
import { NotificationSettings } from './NotificationSettings'
import { SkillSettings } from './SkillSettings'
import { McpSettings } from './McpSettings'
import { MemoryLibrary } from './MemoryLibrary'
import { formatMentionDisplayText } from './AgentMentionTextarea'
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
import { runtimeAvailabilityPresentation } from './runtime-status'

export { allNavigationCamps }

type LoadState = 'loading' | 'ready' | 'error'
export type View = 'compose' | 'camp' | 'members' | 'memory' | 'settings'
export type SettingsSection = NavigationSettingsSection

interface OptimisticCampMessageEntry {
  campId: string
  commandId: string
  message: CampMessageView
}

const CANCELLABLE_TURN_STATUSES = new Set<CampSnapshot['turns'][number]['status']>([
  'running',
  'waiting'
])
const CAMP_INSPECTOR_VISIBILITY_KEY = 'rovai.camp.inspector.visibility'

export function campInspectorVisibleFromStoredValue(value: string | null): boolean {
  return value !== 'hidden'
}

function initialCampInspectorVisibility(): boolean {
  try {
    return campInspectorVisibleFromStoredValue(window.localStorage.getItem(CAMP_INSPECTOR_VISIBILITY_KEY))
  } catch {
    return true
  }
}

export function cancellableTurnIds(snapshot: Pick<CampSnapshot, 'turns'>): string[] {
  return snapshot.turns
    .filter((turn) => CANCELLABLE_TURN_STATUSES.has(turn.status))
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
      || (view === 'settings' && (settingsSection === 'runtime' || settingsSection === 'diagnostics'))
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
  const [pinnedCampItems, setPinnedCampItems] = useState<NavigationCampItem[]>([])
  const [pendingMemoryCount, setPendingMemoryCount] = useState(0)
  const [memoryProposalNotice, setMemoryProposalNotice] = useState(false)
  const [memoryAutoNotice, setMemoryAutoNotice] = useState<{
    count: number
    memoryId: string | null
    scope: 'companion' | 'relationship' | null
  }>({ count: 0, memoryId: null, scope: null })
  const [memoryRefreshKey, setMemoryRefreshKey] = useState(0)
  const [memoryFocusId, setMemoryFocusId] = useState<string | null>(null)
  const [memoryProposalDrawerSignal, setMemoryProposalDrawerSignal] = useState(0)
  const [campSnapshot, setCampSnapshot] = useState<CampSnapshot | null>(null)
  const [campInspectorVisible, setCampInspectorVisible] = useState(initialCampInspectorVisibility)
  const [campInspectorTab, setCampInspectorTab] = useState<CampInspectorTab>('activity')
  const [optimisticCampMessages, setOptimisticCampMessages] = useState<OptimisticCampMessageEntry[]>([])
  const [cancellingTurnIds, setCancellingTurnIds] = useState<Set<string>>(() => new Set())
  const [state, setState] = useState<LoadState>('loading')
  const [view, setView] = useState<View>('compose')
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)
  const [memberTab, setMemberTab] = useState<MemberWorkspaceTab>('identity')
  const [memberRuntimeFocusRequest, setMemberRuntimeFocusRequest] = useState(0)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('skills')
  const [activeCampId, setActiveCampId] = useState<string | null>(null)
  const [notificationOpen, setNotificationOpen] = useState(false)
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0)
  const [notificationRefreshSignal, setNotificationRefreshSignal] = useState(0)
  const [notificationFocus, setNotificationFocus] = useState<NotificationFocusTarget | null>(null)
  const [newConversationOpen, setNewConversationOpen] = useState(false)
  const [newConversationInitialWorkspace, setNewConversationInitialWorkspace] = useState<WorkspaceInspection | null>(null)
  const [activeWorkspaceInspection, setActiveWorkspaceInspection] = useState<WorkspaceInspection | 'unavailable' | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [liveRuntimeEvents, setLiveRuntimeEvents] = useState<LiveRuntimeEvent[]>([])
  const campEventSequenceMarker = useRef(0)
  const campSelectionGeneration = useRef(0)
  const activeCampIdRef = useRef<string | null>(null)
  const viewRef = useRef<View>('compose')
  const notificationButtonRef = useRef<HTMLButtonElement>(null)
  const notificationFocusSequence = useRef(0)
  const healthRequest = useRef<Promise<HealthStatus> | null>(null)
  const lastMainView = useRef<View>('compose')
  const newConversationReturnFocus = useRef<HTMLElement | null>(null)
  const liveRuntimeEventSequence = useRef(0)
  const runtimeHealthRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const membersViewRef = useRef<MembersViewHandle>(null)
  const campCreationPreflight = useMemo(
    () => campCreationPreflightFromAgents(agents),
    [agents]
  )
  activeCampIdRef.current = activeCampId
  viewRef.current = view

  useEffect(() => {
    if (view !== 'members') return
    const manageable = agents.filter((agent) => agent.presence !== 'removed' && agent.removedAt === null)
    if (selectedMemberId && manageable.some((agent) => agent.id === selectedMemberId)) return
    const next = manageable.find((agent) => agent.presence === 'present')
      ?? manageable.find((agent) => agent.presence === 'away')
      ?? null
    setSelectedMemberId(next?.id ?? null)
    setMemberTab('identity')
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

  const loadOverview = useCallback(async (showLoading = false): Promise<void> => {
    if (showLoading) setState('loading')
    setError(null)
    try {
      const [
        nextAgents,
        nextInstallations,
        nextNavigation,
        nextMemoryProposals,
        nextNavigationPins
      ] = await Promise.all([
        window.rovai.request<AgentProfile[]>('agents.list'),
        window.rovai.request<AdapterInstallation[]>('runtime.installations.list'),
        window.rovai.request<NavigationSnapshot>('navigation.snapshot'),
        window.rovai.request<HearthMemoryProposal[]>('memory.hearthProposals.list'),
        window.rovai.navigationPins.get()
      ])
      const resolvedPins = await resolveNavigationPins(nextNavigation, nextNavigationPins.pins)
      if (resolvedPins.pins.length !== nextNavigationPins.pins.length) {
        await window.rovai.navigationPins.replace(resolvedPins.pins)
      }
      setAgents(nextAgents)
      setInstallations(nextInstallations)
      setNavigation(nextNavigation)
      setNavigationPins(resolvedPins.pins)
      setPinnedCampItems(resolvedPins.camps)
      setPendingMemoryCount(nextMemoryProposals.filter((proposal) => proposal.status === 'pending').length)
      setState('ready')
    } catch (nextError) {
      setError(errorMessage(nextError))
      setState('error')
    }
  }, [])

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
    const [nextAgents, nextInstallations] = await Promise.all([
      window.rovai.request<AgentProfile[]>('agents.list'),
      window.rovai.request<AdapterInstallation[]>('runtime.installations.list')
    ])
    setAgents(nextAgents)
    setInstallations(nextInstallations)
  }, [])

  const loadNavigation = useCallback(async (): Promise<NavigationSnapshot> => {
    const nextNavigation = await window.rovai.request<NavigationSnapshot>('navigation.snapshot')
    setNavigation(nextNavigation)
    return nextNavigation
  }, [])

  const activateCamp = useCallback(async (
    campId: string,
    options: {
      reconcileDefaultLead?: boolean
      preserveNotificationFocus?: boolean
      suppressErrors?: boolean
    } = {}
  ): Promise<void> => {
    const selectionGeneration = ++campSelectionGeneration.current
    if (!options.preserveNotificationFocus) setNotificationFocus(null)
    if (activeCampId !== campId) {
      setCampSnapshot(null)
      campEventSequenceMarker.current = 0
    }
    setActiveCampId(campId)
    lastMainView.current = 'camp'
    setView('camp')
    try {
      if (options.reconcileDefaultLead !== false) {
        const reconciliation = await window.rovai.request<StoredCommandResult>('camps.reconcileDefaultLead', {
          commandId: crypto.randomUUID(),
          command: { campId }
        })
        if (reconciliation.status === 'rejected') throw new Error(commandFailureMessage(reconciliation))
      }
      const notificationBoundary = await window.rovai.request<InAppNotificationInbox>(
        'notifications.inbox',
        { filter: 'all', limit: 1 }
      ).then((inbox) => inbox.schemaVersion === 1 ? inbox.throughSequence : null)
        .catch(() => null)
      const snapshot = await window.rovai.request<CampSnapshot>('camps.snapshot', { campId })
      if (snapshot.schemaVersion !== 12) throw new Error('Camp snapshot schema is incompatible')
      if (selectionGeneration !== campSelectionGeneration.current) return
      campEventSequenceMarker.current = snapshot.throughGlobalSequence
      setCampSnapshot(snapshot)
      await afterNextPaint()
      if (selectionGeneration === campSelectionGeneration.current && notificationBoundary !== null) {
        void window.rovai.request<StoredCommandResult>('notifications.markCampRead', {
          commandId: crypto.randomUUID(),
          command: {
            campId,
            throughSequence: notificationBoundary
          }
        }).then(() => setNotificationRefreshSignal((signal) => signal + 1))
          .catch(() => undefined)
      }
      await window.rovai.request('navigation.campViewed', {
        campId,
        throughGlobalSequence: snapshot.throughGlobalSequence
      })
      if (selectionGeneration !== campSelectionGeneration.current) return
      await loadNavigation()
    } catch (nextError) {
      if (selectionGeneration === campSelectionGeneration.current) {
        if (options.suppressErrors) {
          setActiveCampId(null)
          setCampSnapshot(null)
          lastMainView.current = 'compose'
          setView('compose')
        } else {
          setError(errorMessage(nextError))
        }
      }
    }
  }, [activeCampId, loadNavigation])

  const refreshActiveCampSnapshot = useCallback(async (campId: string): Promise<void> => {
    const snapshot = await window.rovai.request<CampSnapshot>('camps.snapshot', { campId })
    if (snapshot.schemaVersion !== 12) throw new Error('Camp snapshot schema is incompatible')
    if (activeCampIdRef.current !== campId) return
    if (snapshot.throughGlobalSequence < campEventSequenceMarker.current) return
    campEventSequenceMarker.current = snapshot.throughGlobalSequence
    setCampSnapshot(snapshot)
  }, [])

  const refreshVisibleNotificationCamp = useCallback(async (campId: string): Promise<boolean> => {
    if (activeCampIdRef.current !== campId || viewRef.current !== 'camp') return false
    await refreshActiveCampSnapshot(campId)
    await afterNextPaint()
    return activeCampIdRef.current === campId && viewRef.current === 'camp'
  }, [refreshActiveCampSnapshot])

  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(null), 3_200)
    return () => clearTimeout(timer)
  }, [toast])

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
    void loadOverview(true)
  }, [loadOverview])

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
        if (runtimeStatus === 'crashed') {
          setState('error')
          setError(stringField(params, 'message') ?? 'Rust Core 已停止。')
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
      if (event.method === 'agent_run.cancelled') {
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

  const activeCamp = navigation
    ? allNavigationCamps(navigation).find((camp) => camp.id === activeCampId) ?? null
    : null
  const activeProjectPath = activeCamp?.projectBindingKind === 'directory'
    ? activeCamp.projectPath
    : campSnapshot?.camp.id === activeCampId
      && campSnapshot.camp.projectBindingKind === 'directory'
      ? campSnapshot.camp.projectPath
      : null
  const activeCampProject = activeProjectPath && navigation
    ? navigation.projects.find((project) => project.projectPath === activeProjectPath) ?? null
    : null
  const activeCancellingTurnIds = useMemo(
    () => campSnapshot?.camp.id === activeCampId
      ? effectiveCancellingTurnIds(cancellingTurnIds, campSnapshot)
      : new Set<string>(),
    [activeCampId, campSnapshot, cancellingTurnIds]
  )
  const activeCampStopping = activeCancellingTurnIds.size > 0

  useEffect(() => {
    let cancelled = false
    const camp = campSnapshot?.camp.id === activeCampId ? campSnapshot.camp : null
    if (!camp || camp.projectBindingKind !== 'directory') {
      setActiveWorkspaceInspection(null)
      return undefined
    }
    setActiveWorkspaceInspection(null)
    void window.rovai.request<WorkspaceInspection>('workspaces.inspect', {
      path: camp.projectPath
    }).then((inspection) => {
      if (!cancelled) setActiveWorkspaceInspection(inspection)
    }).catch(() => {
      if (!cancelled) setActiveWorkspaceInspection('unavailable')
    })
    return () => {
      cancelled = true
    }
  }, [activeCampId, campSnapshot?.camp.id, campSnapshot?.camp.projectBindingKind, campSnapshot?.camp.projectPath])
  const readyCount = useMemo(
    () => [health?.core.ok, health?.database.ok, health?.git.installed, runtimeReady(health)].filter(Boolean).length,
    [health]
  )

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    if (!activeCampId || campSnapshot?.camp.id !== activeCampId) return undefined
    const campId = activeCampId

    const refreshSnapshot = async (): Promise<void> => {
      const snapshot = await window.rovai.request<CampSnapshot>('camps.snapshot', {
        campId
      })
      if (snapshot.schemaVersion !== 12) throw new Error('Camp snapshot schema is incompatible')
      if (cancelled) return
      campEventSequenceMarker.current = snapshot.throughGlobalSequence
      setCampSnapshot(snapshot)
      await window.rovai.request('navigation.campViewed', {
        campId,
        throughGlobalSequence: snapshot.throughGlobalSequence
      })
      if (!cancelled) await loadNavigation()
    }

    const poll = async (): Promise<void> => {
      try {
        const batch = await window.rovai.request<EventBatch>('events.subscribe', {
          campId,
          afterGlobalSequence: campEventSequenceMarker.current,
          limit: 250
        })
        if (cancelled) return
        const proposalSaved = batch.events.some((event) =>
          event.eventType === 'memory.hearth_proposal_created'
        )
        const autoAppliedEvents = batch.events.filter((event) =>
          event.eventType === 'memory.agent_created' || event.eventType === 'memory.agent_revised'
        )
        if (proposalSaved || autoAppliedEvents.length > 0) {
          if (proposalSaved) setMemoryProposalNotice(true)
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
          void window.rovai.request<HearthMemoryProposal[]>('memory.hearthProposals.list')
            .then((proposals) => setPendingMemoryCount(
              proposals.filter((proposal) => proposal.status === 'pending').length
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
  }, [activeCampId, campSnapshot?.camp.id, loadNavigation])

  const refreshDiagnostics = async (): Promise<void> => {
    setError(null)
    try {
      await window.rovai.request('runtime.discovery.rescan', {
        interactiveShell: true
      })
      await Promise.all([loadOverview(), loadHealth()])
    } catch (nextError) {
      setError(errorMessage(nextError))
    }
  }

  const openNewConversation = (workspace: WorkspaceInspection | null): void => {
    newConversationReturnFocus.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    setNewConversationInitialWorkspace(workspace)
    setNewConversationOpen(true)
  }

  const chooseWorkspaceDirectory = async (): Promise<WorkspaceInspection | null> => {
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
      if (workspace) openNewConversation(workspace)
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

  const openMemoryProposals = (): void => {
    setMemoryProposalNotice(false)
    setMemoryFocusId(null)
    setMemoryProposalDrawerSignal((current) => current + 1)
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

  const beginNewConversation = (): void => {
    void requestMemberTransition(() => openNewConversation(null))
  }

  const chooseCamp = (camp: NavigationCampItem): void => {
    void requestMemberTransition(() => {
      lastMainView.current = 'camp'
      setNotificationFocus(null)
      return activateCamp(camp.id)
    })
  }

  const navigateFromNotification = useCallback(async (
    notification: InAppNotificationView
  ): Promise<void> => {
    await requestMemberTransition(async () => {
      const target: NotificationFocusTarget | null = notification.kind === 'runtime_permission_attention'
        ? notification.attentionState === 'pending'
          ? {
            requestId: ++notificationFocusSequence.current,
            kind: 'approval',
            campTurnId: null
          }
          : null
        : notification.sourceAvailable && notification.campTurnId
          ? {
            requestId: ++notificationFocusSequence.current,
            kind: 'camp_turn',
            campTurnId: notification.campTurnId
          }
          : null
      setNotificationFocus(target)
      if (target?.kind === 'approval') {
        setCampInspectorTab('approvals')
        setCampInspectorVisible(true)
      }
      await activateCamp(notification.camp.id, {
        preserveNotificationFocus: target !== null,
        reconcileDefaultLead: notification.camp.status === 'active',
        suppressErrors: true
      })
    })
  }, [activateCamp, requestMemberTransition])

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
      const snapshot = await window.rovai.navigationPins.replace(nextPins)
      setNavigationPins(snapshot.pins)
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
        const snapshot = await window.rovai.request<CampSnapshot>('camps.snapshot', { campId: camp.id })
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
      if (activeCampId === camp.id) {
        campSelectionGeneration.current += 1
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
        : await window.rovai.request<CampSnapshot>('camps.snapshot', { campId })
      const activeTurns = snapshot.turns.filter((turn) => CANCELLABLE_TURN_STATUSES.has(turn.status))
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

  const changeDefaultLead = async (agentProfileId: string): Promise<void> => {
    if (!activeCampId || campSnapshot?.camp.id !== activeCampId) return
    setBusy('change-default-lead')
    setError(null)
    try {
      const result = await window.rovai.request<StoredCommandResult>('camps.changeDefaultLead', {
        commandId: crypto.randomUUID(),
        command: {
          campId: activeCampId,
          successorAgentId: agentProfileId,
          expectedVersion: campSnapshot.camp.version
        }
      })
      if (result.status === 'rejected') throw new Error(commandFailureMessage(result))
      const [snapshot] = await Promise.all([
        window.rovai.request<CampSnapshot>('camps.snapshot', { campId: activeCampId }),
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

  const setCampMemberMemoryWrite = async (
    agentProfileId: string,
    expectedVersion: number,
    enabled: boolean
  ): Promise<void> => {
    if (!activeCampId) return
    setBusy(`memory-capability-${agentProfileId}`)
    setError(null)
    try {
      const result = await window.rovai.request<StoredCommandResult>('campMembers.memoryWrite.set', {
        commandId: crypto.randomUUID(),
        command: { campId: activeCampId, agentProfileId, expectedVersion, enabled }
      })
      if (result.status === 'rejected') throw new Error(commandFailureMessage(result))
      await activateCamp(activeCampId)
    } catch (nextError) {
      setError(errorMessage(nextError))
      throw nextError
    } finally {
      setBusy(null)
    }
  }

  const createCamp = async (
    draft: Omit<CreateCampRequest, 'commandId'>
  ): Promise<void> => {
    setBusy('create-camp')
    try {
      const result = await window.rovai.request<StoredCommandResult>('camps.create', {
        commandId: crypto.randomUUID(),
        ...draft
      })
      if (result.status === 'rejected') throw new Error(commandFailureMessage(result))
      const campId = stringField(result.payload, 'campId')
      if (!campId) throw new Error('Core 已创建 Camp，但没有返回 Camp ID。')
      setNewConversationOpen(false)
      await activateCamp(campId, { reconcileDefaultLead: false })
    } finally {
      setBusy(null)
    }
  }

  const sendCampMessage = async (
    body: string,
    agentProfileIds: string[],
    attachments: PreparedAttachmentView[]
  ): Promise<void> => {
    if (!activeCampId || !body.trim()) return
    const campId = activeCampId
    const commandId = crypto.randomUUID()
    const selectionGeneration = campSelectionGeneration.current
    const optimisticMessage = optimisticCampMessage(
      campSnapshot?.camp.id === campId ? campSnapshot : null,
      commandId,
      body,
      agentProfileIds,
      attachments
    )
    setOptimisticCampMessages((current) => [
      ...current,
      { campId, commandId, message: optimisticMessage }
    ])
    setBusy('camp-message')
    setError(null)
    try {
      const result = await window.rovai.request<SendCampMessageResult>('camp.messages.send', {
        commandId,
        campId,
        body,
        preparedAttachmentIds: attachments.map((attachment) => attachment.id),
        address: agentProfileIds.length > 0
          ? { mode: 'explicit', agentProfileIds }
          : { mode: 'default' },
        replyToCampMessageId: null,
        execution: {
          taskId: null,
          purpose: body.trim(),
          expectedOutput: '在当前 Camp 公共上下文中给出完整、可追溯的回复。',
          completionRole: 'required'
        }
      })
      if (!result.commandResult) {
        throw new Error('Core 未返回消息提交结果。')
      }
      if (result.commandResult.status === 'rejected') throw new Error(commandFailureMessage(result.commandResult))
      const campMessageId = stringField(result.commandResult.payload, 'campMessageId')
      const campTurnId = stringField(result.commandResult.payload, 'campTurnId')
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
      void window.rovai.request<CampSnapshot>('camps.snapshot', { campId })
        .then(async (snapshot) => {
          if (snapshot.schemaVersion !== 12) throw new Error('Camp snapshot schema is incompatible')
          if (selectionGeneration !== campSelectionGeneration.current) return
          campEventSequenceMarker.current = snapshot.throughGlobalSequence
          setCampSnapshot(snapshot)
          setOptimisticCampMessages((current) =>
            current.filter((entry) => entry.commandId !== commandId)
          )
          await window.rovai.request('navigation.campViewed', {
            campId,
            throughGlobalSequence: snapshot.throughGlobalSequence
          })
          if (selectionGeneration === campSelectionGeneration.current) await loadNavigation()
        })
        .catch((nextError) => setError(errorMessage(nextError)))
    } catch (nextError) {
      setOptimisticCampMessages((current) =>
        current.filter((entry) => entry.commandId !== commandId)
      )
      setToast(errorMessage(nextError))
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
      const snapshot = await window.rovai.request<CampSnapshot>('camps.snapshot', {
        campId: activeCampId
      })
      campEventSequenceMarker.current = snapshot.throughGlobalSequence
      setCampSnapshot(snapshot)
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const exportDiagnostics = async (): Promise<void> => {
    setBusy('export')
    setError(null)
    try {
      await window.rovai.exportDiagnostics()
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

  const showAppHeader = view === 'camp' || view === 'members' || view === 'memory'

  return (
    <div className="app-shell">
      <CampNavigation
        view={view}
        state={state}
        navigation={navigation}
        agents={agents}
        activeCampId={activeCampId}
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
        notificationUnreadCount={notificationUnreadCount}
        notificationButtonRef={notificationButtonRef}
        onNotifications={() => setNotificationOpen(true)}
        memberSidebar={view === 'members' ? (
          <MemberSidebar
            agents={agents}
            runtimeAvailability={health?.runtimeAvailability ?? []}
            runtimeDiscoveryPending={health === null || healthLoading}
            selectedAgentId={selectedMemberId}
            onSelect={chooseMember}
            onCreate={(trigger) => membersViewRef.current?.requestCreate(trigger)}
            onReload={loadMemberData}
          />
        ) : null}
        onSettings={() => chooseView('settings')}
        onSettingsSectionChange={setSettingsSection}
        onSettingsBack={closeSettings}
        onOpenProject={() => void openProject()}
        onCamp={chooseCamp}
        onTogglePin={(kind, targetKey, camp) => void toggleNavigationPin(kind, targetKey, camp)}
        onRename={renameCamp}
        onDelete={deleteCamp}
        onStop={stopCampRuns}
        onError={(nextError) => setError(errorMessage(nextError))}
      />
      {showAppHeader && <AppHeader
        view={view}
        campTitle={formatMentionDisplayText(
          activeCamp?.title ?? (campSnapshot?.camp.id === activeCampId ? campSnapshot.camp.title : ''),
          agents
        ) || null}
        contextLabel={view === 'camp' ? activeCampProject?.name ?? '快速对话' : null}
        camp={view === 'camp' && campSnapshot?.camp.id === activeCampId ? campSnapshot : null}
        stopping={activeCampStopping}
        inspectorVisible={campInspectorVisible}
        onToggleInspector={() => setCampInspectorVisible((visible) => !visible)}
        onOpenInspector={openCampInspector}
      />}

      <main className={`content ${view === 'compose' || view === 'camp' ? 'task-content' : ''} ${showAppHeader ? '' : 'content-without-app-header'} ${view === 'settings' ? 'settings-content' : ''} ${view === 'memory' ? 'memory-content' : ''} ${view === 'members' ? 'members-content' : ''}`}>
        {memoryProposalNotice && (
          <div className="memory-proposal-notice" role="status">
            <div><strong>伙伴提出了一条记忆建议</strong><span>提案尚未生效，你可以稍后在“记忆”中逐条确认。</span></div>
            <div><button className="quiet-button compact" type="button" onClick={openMemoryProposals}>查看提案</button><button className="icon-button" type="button" aria-label="暂时忽略记忆提案提示" onClick={() => setMemoryProposalNotice(false)}>×</button></div>
          </div>
        )}
      {memoryAutoNotice.count > 0 && (
          <div className="memory-proposal-notice memory-auto-applied-notice" role="status" aria-live="polite">
            <div><strong>已自动形成 {memoryAutoNotice.count} 条{memoryAutoNotice.count === 1 ? memoryAutoNotice.scope === 'relationship' ? '协作默契' : memoryAutoNotice.scope === 'companion' ? '伙伴经验' : '记忆' : '记忆'}</strong><span>已立即用于后续协作，你可以随时查看、修订、停止沿用或遗忘。</span></div>
            <div><button className="quiet-button compact" type="button" onClick={openAutomaticMemory}>查看</button><button className="icon-button" type="button" aria-label="关闭自动形成提示" onClick={() => setMemoryAutoNotice({ count: 0, memoryId: null, scope: null })}>×</button></div>
          </div>
        )}
        {toast && (
          <div className="app-toast" role="status" aria-live="polite">
            <span>{toast}</span>
            <button className="icon-button" type="button" aria-label="关闭提示" onClick={() => setToast(null)}>×</button>
          </div>
        )}
        {error && (
          <div className="error-banner" role="alert">
            <span className="error-icon" aria-hidden="true">!</span>
            <div><strong>操作未完成</strong><span>{error}</span><small>项目文件和已经写入的审计记录不会因此丢失。</small></div>
            <div className="error-actions"><button className="quiet-button" onClick={() => void loadOverview()}>刷新状态</button><button className="icon-button" aria-label="关闭错误" onClick={() => setError(null)}>×</button></div>
          </div>
        )}

        {view === 'camp' && activeCampId && campSnapshot?.camp.id === activeCampId && (
          <CampWorkspace
            snapshot={campSnapshot}
            optimisticMessages={optimisticCampMessages
              .filter((entry) => entry.campId === activeCampId)
              .map((entry) => entry.message)}
            projectName={activeCampProject?.name ?? null}
            workspaceInspection={activeWorkspaceInspection}
            agents={agents}
            liveRuntimeEvents={liveRuntimeEvents}
            busy={busy === 'camp-message' || busy === 'change-default-lead' || busy?.startsWith('action-approval-') === true}
            onSend={sendCampMessage}
            onChangeLead={changeDefaultLead}
            onSetMemoryWrite={setCampMemberMemoryWrite}
            onTasksChanged={() => activateCamp(activeCampId)}
            onResolveApproval={(approval, decision) => {
              void resolveActionApproval(approval, decision)
            }}
            cancellingTurnIds={activeCancellingTurnIds}
            stopping={activeCampStopping}
            onStop={() => void stopCampRuns()}
            inspectorVisible={campInspectorVisible}
            inspectorTab={campInspectorTab}
            onInspectorTabChange={setCampInspectorTab}
            onOpenInspector={openCampInspector}
            notificationFocus={notificationFocus}
          />
        )}

        {view === 'camp' && (!activeCampId || campSnapshot?.camp.id !== activeCampId) && (
          <EmptyState title="正在打开对话" body="Rovai-ai 正在从 SQLite 权威快照恢复 Camp、队员与运行状态。" />
        )}

        {view === 'compose' && (
          <QuickChatWorkspace
            agents={agents}
            recentCamps={navigation ? allNavigationCamps(navigation).slice(0, 5) : []}
            onOpenCamp={chooseCamp}
            onNewConversation={beginNewConversation}
          />
        )}

        {view === 'memory' && (
          <MemoryLibrary
            agents={agents}
            refreshSignal={memoryRefreshKey}
            focusMemoryId={memoryFocusId}
            proposalDrawerSignal={memoryProposalDrawerSignal}
            onProposalDrawerSignalConsumed={() => setMemoryProposalDrawerSignal(0)}
            onPendingCountChange={setPendingMemoryCount}
          />
        )}

        {view === 'settings' && (
          <SettingsView
            appearance={appearance}
            health={health}
            agents={agents}
            installations={installations}
            readyCount={readyCount}
            busy={busy}
            section={settingsSection}
            onRefresh={() => void refreshDiagnostics()}
            onExport={() => void exportDiagnostics()}
            onReload={async () => {
              await Promise.all([loadOverview(), loadHealth()])
            }}
            onThemeChange={(preference) => void changeThemePreference(preference)}
          />
        )}

        {view === 'members' && (
          <MembersView
            ref={membersViewRef}
            agents={agents}
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
              setSettingsSection('runtime')
              chooseView('settings')
            }}
          />
        )}
      </main>

      <NewConversationDialog
        open={newConversationOpen}
        initialWorkspace={newConversationInitialWorkspace}
        projects={navigation?.projects ?? []}
        preflight={campCreationPreflight}
        agents={agents}
        busy={busy === 'create-camp' || busy === 'open-project'}
        returnFocusElement={newConversationReturnFocus.current}
        onOpenChange={setNewConversationOpen}
        onChooseWorkspaceDirectory={chooseWorkspaceDirectory}
        onCreate={createCamp}
      />
      <NotificationCenter
        open={notificationOpen}
        onOpenChange={setNotificationOpen}
        activeCampId={activeCampId}
        activeCampVisible={view === 'camp' && campSnapshot?.camp.id === activeCampId}
        refreshSignal={notificationRefreshSignal}
        triggerRef={notificationButtonRef}
        onUnreadCountChange={setNotificationUnreadCount}
        onNavigate={navigateFromNotification}
        onRefreshVisibleCamp={refreshVisibleNotificationCamp}
      />
    </div>
  )
}

export function AppHeader({
  view,
  campTitle,
  contextLabel,
  camp,
  stopping,
  inspectorVisible,
  onToggleInspector,
  onOpenInspector
}: {
  view: View
  campTitle: string | null
  contextLabel: string | null
  camp: CampSnapshot | null
  stopping: boolean
  inspectorVisible: boolean
  onToggleInspector(): void
  onOpenInspector(tab: CampInspectorTab): void
}): React.JSX.Element {
  const title = view === 'camp' && campTitle
    ? campTitle
    : view === 'compose'
      ? '快速对话'
      : view === 'members'
        ? '队员'
        : view === 'memory'
          ? '记忆'
          : '设置'
  const activeRuns = camp?.agentRuns.filter((run) => ['queued', 'running', 'waiting'].includes(run.status)).length ?? 0
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
      {camp && (
        <div className="topbar-context-actions">
          <div className="topbar-context-status" aria-live="polite">
            {activeRuns > 0
              ? (
                  <button
                    className={`run-badge ${stopping ? 'stopping' : ''}`}
                    type="button"
                    onClick={() => onOpenInspector('activity')}
                    aria-label={`${stopping ? '正在停止' : '运行中'} ${activeRuns}，打开活动检查器`}
                  >
                    <i aria-hidden="true" />{stopping ? '正在停止' : '运行中'} {activeRuns}
                  </button>
                )
              : <span className="sr-only">当前没有运行</span>}
            {pendingApprovals > 0 && (
              <button
                className="approval-badge"
                type="button"
                onClick={() => onOpenInspector('approvals')}
                aria-label={`待审批 ${pendingApprovals}，打开审批检查器`}
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
  installations,
  readyCount,
  busy,
  section,
  onRefresh,
  onExport,
  onReload,
  onThemeChange
}: {
  appearance: AppearanceSnapshot
  health: HealthStatus | null
  agents: AgentProfile[]
  installations: AdapterInstallation[]
  readyCount: number
  busy: string | null
  section: SettingsSection
  onRefresh(): void
  onExport(): void
  onReload(): Promise<void>
  onThemeChange(preference: ThemePreference): void
}): React.JSX.Element {
  return (
    <div className="settings-workbench">
      <div className="settings-panel">
        {section === 'skills' && <SkillSettings />}
        {section === 'mcp' && <McpSettings agents={agents} />}
        {section === 'runtime' && (
          <>
            <section className="project-hero">
              <div><h2>Agent 运行时</h2><p>选择产品、检查可用性并管理 Rovai 自动发现的本机入口。</p></div>
            </section>
            <RuntimeInstallationsPanel health={health} installations={installations} onReload={onReload} />
          </>
        )}
        {section === 'appearance' && (
          <>
            <section className="project-hero">
              <div><h2>外观</h2><p>北极晨光 Day 已覆盖全部页面；Night 偏好暂时同样解析为 Day。</p></div>
            </section>
            <AppearanceSettings
              appearance={appearance}
              disabled={busy === 'appearance'}
              onChange={onThemeChange}
            />
          </>
        )}
        {section === 'notifications' && <NotificationSettings />}
        {section === 'diagnostics' && (
          <>
            <section className="project-hero"><div><h2>诊断</h2><p>这里不会展示任何 Agent 运行时的 Token、登录信息或其他原始凭据。</p></div><div className="project-actions"><button className="quiet-button" onClick={onRefresh}>重新检测</button><button className="primary-button" onClick={onExport} disabled={busy === 'export'}>{busy === 'export' ? '正在导出…' : '导出诊断 JSON'}</button></div></section>
            <section className="section-block"><div className="section-heading"><div><h2>本地依赖</h2></div><span className="health-score">{readyCount}/4 就绪</span></div><RuntimeHealth health={health} /></section>
            <section className="section-block diagnostics-card">
              <Diagnostic label="应用数据目录" value={health?.core.dataDir} />
              <Diagnostic label="SQLite 数据库" value={health?.database.path} />
              <Diagnostic label="Git" value={health?.git.version} />
              {(health?.runtimeAvailability ?? []).map((candidate) => (
                <Diagnostic key={candidate.runtimeKind} label={runtimeAdapterLabel(candidate.runtimeKind)} value={`${candidate.reportedVersion ?? '版本未知'} · ${runtimeAvailabilityPresentation(candidate).label}`} />
              ))}
              <Diagnostic label="Agent 运行时能力" value={health ? runtimeCapabilitySummary(health) : null} />
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function RuntimeHealth({ health }: { health: HealthStatus | null }): React.JSX.Element {
  return (
    <div className="runtime-card health-grid">
      <HealthItem label="Rust Core" ok={health?.core.ok} detail={health?.core.version} />
      <HealthItem label="SQLite" ok={health?.database.ok} detail="WAL · bundled" />
      <HealthItem label="Git" ok={health?.git.installed} detail={health?.git.version} />
      <HealthItem label="Agent 运行时" ok={runtimeReady(health)} detail={health ? runtimeHealthSummary(health) : null} />
    </div>
  )
}

function HealthItem({ label, ok, detail }: { label: string; ok?: boolean; detail?: string | null }): React.JSX.Element {
  return <div className="health-item"><span className={`health-indicator ${ok ? 'ok' : ''}`}>{ok ? '✓' : '·'}</span><div><strong>{label}</strong><span>{detail ?? '等待检测'}</span></div></div>
}

function Diagnostic({ label, value }: { label: string; value?: string | null }): React.JSX.Element {
  return <div className="diagnostic-row"><strong>{label}</strong><code>{value ?? '—'}</code></div>
}

function EmptyState({ title, body, action, onAction }: { title: string; body: string; action?: string; onAction?(): void }): React.JSX.Element {
  return <section className="empty-state"><span>⌁</span><h2>{title}</h2><p>{body}</p>{action && onAction && <button className="primary-button" onClick={onAction}>{action}</button>}</section>
}

function runtimeReady(health: HealthStatus | null): boolean {
  return health?.runtimeAvailability.some((candidate) =>
    runtimeAvailabilityPresentation(candidate).status === 'available'
  ) ?? false
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

  if (campById.size < pinnedCampIds.size) {
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
        const page = await window.rovai.request<NavigationCampPage>('navigation.groupCamps', {
          projectPath: group.projectPath,
          offset,
          limit: 200
        })
        if (page.schemaVersion !== 2) throw new Error('Navigation group schema is incompatible')
        for (const camp of page.camps) {
          if (pinnedCampIds.has(camp.id)) campById.set(camp.id, camp)
        }
        if (page.nextOffset === null) break
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
  body: string,
  agentProfileIds: string[],
  attachments: CampMessageView['attachments'] = [],
  createdAt = new Date().toISOString()
): CampMessageView {
  const defaultLeadId = snapshot?.members.find((member) => member.isDefaultLead)?.agentProfileId
  const sequence = Math.max(0, ...(snapshot?.messages.map((message) => message.sequence) ?? [])) + 1
  return {
    id: `optimistic:${commandId}`,
    sequence,
    timelineGlobalSequence: null,
    authorType: 'user',
    authorId: 'local-user',
    sourceAgentRunId: null,
    body,
    attachments,
    addressMode: agentProfileIds.length > 0 ? 'explicit' : 'default',
    addressedAgentProfileIds: agentProfileIds.length > 0
      ? [...new Set(agentProfileIds)]
      : defaultLeadId ? [defaultLeadId] : [],
    replyToCampMessageId: null,
    campTurnId: null,
    presentation: null,
    createdAt
  }
}

export function campCreationPreflightFromAgents(
  agents: AgentProfile[]
): CampCreationPreflight {
  const presentMembers = agents
    .filter((agent) => agent.presence === 'present')
    .sort((left, right) => left.memberOrder - right.memberOrder || left.id.localeCompare(right.id))
    .map((agent) => ({
      agentProfileId: agent.id,
      handle: agent.handle,
      displayName: agent.displayName,
      memberOrder: agent.memberOrder,
      runtimeConfigured: agent.runtimeSelection !== null,
      runtimeReadiness: agent.runtimeReadiness.status
    }))
  const initialLeadAgentProfileId = presentMembers
    .find((member) => member.runtimeReadiness === 'ready')
    ?.agentProfileId ?? presentMembers[0]?.agentProfileId ?? null
  const blockers: CampCreationPreflight['blockers'] = presentMembers.length === 0
    ? [{ code: 'no_present_members', detail: '当前没有在队的队员。' }]
    : []
  return {
    admissible: blockers.length === 0,
    presentMembers,
    initialLeadAgentProfileId,
    blockers
  }
}

function runtimeHealthSummary(health: HealthStatus): string {
  const ready = health.runtimeAvailability.filter((candidate) =>
    runtimeAvailabilityPresentation(candidate).status === 'available'
  )
  return ready.length
    ? ready.map((candidate) => `${runtimeAdapterLabel(candidate.runtimeKind)} ${candidate.reportedVersion ?? ''}`.trim()).join(' · ')
    : '尚无可用 Agent 运行时'
}

function runtimeCapabilitySummary(health: HealthStatus): string {
  return health.runtimeAvailability
    .map((candidate) => `${runtimeAdapterLabel(candidate.runtimeKind)} ${runtimeAvailabilityPresentation(candidate).label}`)
    .join(' · ')
}

function runtimeAdapterLabel(kind: string): string {
  return ({
    'codex-cli': 'Codex CLI',
    'opencode-cli': 'OpenCode',
    'copilot-cli': 'GitHub Copilot',
    'claude-code-cli': 'Claude Code',
    'kiro-cli': 'Kiro',
    'qoder-cli': 'Qoder',
    'codebuddy-cli': 'CodeBuddy',
    'qwen-code': 'Qwen Code',
    'antigravity-app': 'Antigravity'
  } as Record<string, string>)[kind] ?? kind
}

export function commandFailureMessage(result: StoredCommandResult): string {
  if (
    result.code === 'camp_message.no_addressable_member'
    || result.code === 'camp.default_lead_invariant'
    || result.code === 'camp.no_present_members'
  ) {
    return '当前无可用队员。'
  }
  return localizeExecutionEngineTerms(stringField(result.payload, 'message') ?? `Core 拒绝了命令：${result.code}`)
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

function errorMessage(error: unknown): string {
  return localizeExecutionEngineTerms(error instanceof Error ? error.message : String(error))
}

function afterNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve())
    })
  })
}
