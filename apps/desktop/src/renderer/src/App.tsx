import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AdapterInstallation,
  AgentProfile,
  ActionApprovalView,
  AppearanceSnapshot,
  CampCreationPreflight,
  CampSnapshot,
  CoreEvent,
  EventBatch,
  HealthStatus,
  NavigationCampItem,
  NavigationSnapshot,
  MemoryProposal,
  SelectedProjectBinding,
  SendCampMessageResult,
  StartPreflightResult,
  StoredCommandResult,
  ThemePreference
} from '@contracts'
import { MembersView, RuntimeInstallationsPanel } from './MemberManagement'
import { CampWorkspace, NewConversationWorkspace } from './CampWorkspace'
import { CampNavigation, type CampDeleteAttempt } from './CampNavigation'
import { AppearanceSettings } from './AppearanceSettings'
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
  type LiveRuntimeEvent,
  RAIL_COLLAPSED_WIDTH,
  RAIL_EXPANDED_WIDTH,
  railExpandedFromWidth,
  railSnapWidth
} from './ui-model'

export { allNavigationCamps }

type LoadState = 'loading' | 'ready' | 'error'
export type View = 'compose' | 'camp' | 'members' | 'memory' | 'settings'
export type SettingsSection = 'skills' | 'mcp' | 'appearance' | 'diagnostics'

const RAIL_EXPANDED_STORAGE_KEY = 'rovai.rail-expanded'

export function shouldLoadRuntimeHealth(
  view: View,
  settingsSection: SettingsSection,
  hasHealth: boolean,
  healthAttempted: boolean
): boolean {
  return !hasHealth
    && !healthAttempted
    && (view === 'members' || (view === 'settings' && settingsSection === 'diagnostics'))
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
  const [state, setState] = useState<LoadState>('loading')
  const [view, setView] = useState<View>('compose')
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('skills')
  const [activeCampId, setActiveCampId] = useState<string | null>(null)
  const [newConversationProject, setNewConversationProject] = useState<SelectedProjectBinding | null>(null)
  const [campCreationPreflight, setCampCreationPreflight] = useState<CampCreationPreflight | null>(null)
  const [newConversationCommandId, setNewConversationCommandId] = useState<string | null>(() => crypto.randomUUID())
  const [newConversationKey, setNewConversationKey] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [liveRuntimeEvents, setLiveRuntimeEvents] = useState<LiveRuntimeEvent[]>([])
  const [railWidth, setRailWidth] = useState(() =>
    window.localStorage.getItem(RAIL_EXPANDED_STORAGE_KEY) === '1'
      ? RAIL_EXPANDED_WIDTH
      : RAIL_COLLAPSED_WIDTH
  )
  const campEventSequenceMarker = useRef(0)
  const campSelectionGeneration = useRef(0)
  const healthRequest = useRef<Promise<HealthStatus> | null>(null)
  const lastMainView = useRef<View>('compose')
  const liveRuntimeEventSequence = useRef(0)

  const sidebarHidden = view === 'settings' || view === 'members' || view === 'memory'

  const loadOverview = useCallback(async (showLoading = false): Promise<void> => {
    if (showLoading) setState('loading')
    setError(null)
    try {
      const [
        nextAgents,
        nextInstallations,
        nextNavigation,
        nextMemoryProposals
      ] = await Promise.all([
        window.rovai.request<AgentProfile[]>('agents.list'),
        window.rovai.request<AdapterInstallation[]>('runtime.installations.list'),
        window.rovai.request<NavigationSnapshot>('navigation.snapshot'),
        window.rovai.request<MemoryProposal[]>('memory.proposals.list')
      ])
      setAgents(nextAgents)
      setInstallations(nextInstallations)
      setNavigation(nextNavigation)
      setCampCreationPreflight(campCreationPreflightFromAgents(nextAgents))
      setPendingMemoryCount(nextMemoryProposals.filter((proposal) => proposal.status === 'pending').length)
      setState('ready')
    } catch (nextError) {
      setError(errorMessage(nextError))
      setState('error')
    }
  }, [])

  const loadHealth = useCallback((refreshRuntimeProbe = false): Promise<HealthStatus> => {
    if (healthRequest.current) return healthRequest.current
    setHealthAttempted(true)
    setHealthLoading(true)
    const request = window.rovai.request<HealthStatus>('health.check', { refreshRuntimeProbe })
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
    options: { reconcileDefaultLead?: boolean } = {}
  ): Promise<void> => {
    const selectionGeneration = ++campSelectionGeneration.current
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
      const snapshot = await window.rovai.request<CampSnapshot>('camps.snapshot', { campId })
      if (snapshot.schemaVersion !== 9) throw new Error('Camp snapshot schema is incompatible')
      if (selectionGeneration !== campSelectionGeneration.current) return
      campEventSequenceMarker.current = snapshot.throughGlobalSequence
      setCampSnapshot(snapshot)
      await window.rovai.request('navigation.campViewed', {
        campId,
        throughGlobalSequence: snapshot.throughGlobalSequence
      })
      if (selectionGeneration !== campSelectionGeneration.current) return
      await loadNavigation()
    } catch (nextError) {
      if (selectionGeneration === campSelectionGeneration.current) {
        setError(errorMessage(nextError))
      }
    }
  }, [activeCampId, loadNavigation])

  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(null), 3_200)
    return () => clearTimeout(timer)
  }, [toast])

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
    })
  }, [loadOverview])

  const activeCamp = navigation
    ? allNavigationCamps(navigation).find((camp) => camp.id === activeCampId) ?? null
    : null
  const activeRepositoryScopeId = activeCamp?.repositoryScopeId
    ?? (campSnapshot?.camp.id === activeCampId ? campSnapshot.camp.repositoryScopeId : null)
  const activeCampProject = activeRepositoryScopeId && navigation
    ? navigation.projects.find((project) => project.repositoryScopeId === activeRepositoryScopeId) ?? null
    : null
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
      if (snapshot.schemaVersion !== 9) throw new Error('Camp snapshot schema is incompatible')
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
          event.eventType === 'memory.proposal_saved'
        )
        const autoAppliedEvents = batch.events.filter((event) =>
          event.eventType === 'memory.proposal_auto_applied'
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
          void window.rovai.request<MemoryProposal[]>('memory.proposals.list')
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
      await Promise.all([
        loadOverview(),
        loadHealth(true)
      ])
    } catch (nextError) {
      setError(errorMessage(nextError))
    }
  }

  const enterNewConversation = async (project: SelectedProjectBinding | null): Promise<void> => {
    setBusy('new-conversation')
    setError(null)
    setNewConversationProject(project)
    setNewConversationCommandId(crypto.randomUUID())
    setNewConversationKey((current) => current + 1)
    lastMainView.current = 'compose'
    setView('compose')
    try {
      const preflight = await window.rovai.request<CampCreationPreflight>('camps.creationPreflight')
      setCampCreationPreflight(preflight)
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const openProject = async (): Promise<void> => {
    setBusy('open-project')
    setError(null)
    try {
      const project = await window.rovai.selectProject()
      if (!project) return
      await enterNewConversation(project)
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const chooseView = (nextView: View): void => {
    if (nextView !== 'settings') lastMainView.current = nextView
    setView(nextView)
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

  const commitRailWidth = (width: number): void => {
    const snapped = railSnapWidth(width)
    setRailWidth(snapped)
    window.localStorage.setItem(
      RAIL_EXPANDED_STORAGE_KEY,
      railExpandedFromWidth(snapped) ? '1' : '0'
    )
  }

  const beginNewConversation = (): void => {
    void enterNewConversation(null)
  }

  const chooseCamp = (camp: NavigationCampItem): void => {
    lastMainView.current = 'camp'
    void activateCamp(camp.id)
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
        setNewConversationProject(null)
        setNewConversationCommandId(crypto.randomUUID())
        setNewConversationKey((current) => current + 1)
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
    setBusy(`stop-camp-${campId}`)
    setError(null)
    try {
      const snapshot = campSnapshot?.camp.id === campId
        ? campSnapshot
        : await window.rovai.request<CampSnapshot>('camps.snapshot', { campId })
      const activeTurns = snapshot.turns.filter((turn) => ['running', 'waiting'].includes(turn.status))
      for (const turn of activeTurns) {
        const result = await window.rovai.request<StoredCommandResult>('campTurns.cancel', {
          commandId: crypto.randomUUID(),
          command: {
            campId,
            campTurnId: turn.id,
            expectedVersion: turn.version
          }
        })
        if (result.status === 'rejected') throw new Error(commandFailureMessage(result))
      }
      await loadNavigation()
      if (activeCampId === campId) await activateCamp(campId)
    } catch (nextError) {
      setError(errorMessage(nextError))
      throw nextError
    } finally {
      setBusy(null)
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

  const setCampMemberMemoryProposal = async (
    agentProfileId: string,
    expectedVersion: number,
    enabled: boolean
  ): Promise<void> => {
    if (!activeCampId) return
    setBusy(`memory-capability-${agentProfileId}`)
    setError(null)
    try {
      const result = await window.rovai.request<StoredCommandResult>('campMembers.memoryProposal.set', {
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

  const createCampFromFirstMessage = async (
    body: string,
    agentProfileIds: string[]
  ): Promise<void> => {
    if (!body.trim() || !newConversationCommandId) return
    setBusy('create-camp')
    setError(null)
    try {
      const result = await window.rovai.request<StoredCommandResult>('camps.createFromFirstMessage', {
        commandId: newConversationCommandId,
        project: newConversationProject,
        body,
        address: agentProfileIds.length > 0
          ? { mode: 'explicit', agentProfileIds }
          : { mode: 'default' },
        purpose: body.trim(),
        expectedOutput: '在当前 Camp 公共上下文中给出完整、可追溯的回复。'
      })
      if (result.status === 'rejected') throw new Error(commandFailureMessage(result))
      const campId = stringField(result.payload, 'campId')
      if (!campId) throw new Error('Core 已受理首条消息，但没有返回 Camp ID。')
      await activateCamp(campId, { reconcileDefaultLead: false })
      setNewConversationCommandId(null)
    } catch (nextError) {
      setToast(errorMessage(nextError))
      throw nextError
    } finally {
      setBusy(null)
    }
  }

  const sendCampMessage = async (
    body: string,
    agentProfileIds: string[]
  ): Promise<void> => {
    if (!activeCampId || !body.trim()) return
    setBusy('camp-message')
    setError(null)
    try {
      const result = await window.rovai.request<SendCampMessageResult>('camp.messages.send', {
        commandId: crypto.randomUUID(),
        campId: activeCampId,
        body,
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
      if (!result.commandResult) throw new Error(preflightFailureMessage(result.preflight))
      if (result.commandResult.status === 'rejected') throw new Error(commandFailureMessage(result.commandResult))
    } catch (nextError) {
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
        reason: `用户选择执行引擎原生选项：${optionId}。`
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

  return (
    <div
      className={`app-shell ${sidebarHidden ? 'sidebar-hidden' : ''}`}
      style={{ '--rail-width': `${railWidth}px` } as React.CSSProperties}
    >
      <CampNavigation
        view={view}
        state={state}
        navigation={navigation}
        agents={agents}
        activeCampId={activeCampId}
        sidebarHidden={sidebarHidden}
        railWidth={railWidth}
        onRailWidthLive={setRailWidth}
        onRailWidthCommit={commitRailWidth}
        onNewConversation={beginNewConversation}
        onMembers={() => chooseView('members')}
        onMemory={() => {
          setMemoryFocusId(null)
          chooseView('memory')
        }}
        pendingMemoryCount={pendingMemoryCount}
        onSettings={() => chooseView('settings')}
        onOpenProject={() => void openProject()}
        onCamp={chooseCamp}
        onRename={renameCamp}
        onDelete={deleteCamp}
        onStop={stopCampRuns}
        onError={(nextError) => setError(errorMessage(nextError))}
      />
      <AppHeader
        view={view}
        campTitle={formatMentionDisplayText(
          activeCamp?.title ?? (campSnapshot?.camp.id === activeCampId ? campSnapshot.camp.title : ''),
          agents
        ) || null}
        contextLabel={view === 'camp'
          ? activeCampProject?.name ?? '大厅'
          : view === 'compose'
            ? newConversationProject?.name ?? '大厅'
            : null}
        camp={view === 'camp' && campSnapshot?.camp.id === activeCampId ? campSnapshot : null}
        stopping={busy?.startsWith('stop-camp-') ?? false}
        onStop={() => void stopCampRuns()}
      />

      <main className={`content ${view === 'compose' || view === 'camp' ? 'task-content' : ''} ${view === 'settings' ? 'settings-content' : ''} ${view === 'memory' ? 'memory-content' : ''}`}>
        {memoryProposalNotice && (
          <div className="memory-proposal-notice" role="status">
            <div><strong>伙伴提出了一条长期记忆建议</strong><span>提案尚未生效，你可以稍后在“长期记忆”中逐条确认。</span></div>
            <div><button className="quiet-button compact" type="button" onClick={openMemoryProposals}>查看提案</button><button className="icon-button" type="button" aria-label="暂时忽略记忆提案提示" onClick={() => setMemoryProposalNotice(false)}>×</button></div>
          </div>
        )}
      {memoryAutoNotice.count > 0 && (
          <div className="memory-proposal-notice memory-auto-applied-notice" role="status" aria-live="polite">
            <div><strong>已自动形成 {memoryAutoNotice.count} 条{memoryAutoNotice.count === 1 ? memoryAutoNotice.scope === 'relationship' ? '协作默契' : memoryAutoNotice.scope === 'companion' ? '伙伴经验' : '长期记忆' : '长期记忆'}</strong><span>已立即用于后续协作，你可以随时查看、修订、停止沿用或遗忘。</span></div>
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
            projectName={activeCampProject?.name ?? null}
            agents={agents}
            liveRuntimeEvents={liveRuntimeEvents}
            busy={busy === 'camp-message' || busy === 'change-default-lead' || busy?.startsWith('action-approval-') === true}
            onSend={sendCampMessage}
            onChangeLead={changeDefaultLead}
            onSetMemoryProposal={setCampMemberMemoryProposal}
            onTasksChanged={() => activateCamp(activeCampId)}
            onResolveApproval={(approval, decision) => {
              void resolveActionApproval(approval, decision)
            }}
            stopping={busy?.startsWith('stop-camp-') ?? false}
            onStop={() => void stopCampRuns()}
          />
        )}

        {view === 'camp' && (!activeCampId || campSnapshot?.camp.id !== activeCampId) && (
          <EmptyState title="正在打开对话" body="Rovai-ai 正在从 SQLite 权威快照恢复 Camp、成员与运行状态。" />
        )}

        {view === 'compose' && campCreationPreflight && (
          <NewConversationWorkspace
            key={newConversationKey}
            draftId={newConversationCommandId ?? 'new-conversation'}
            project={newConversationProject}
            preflight={campCreationPreflight}
            agents={agents}
            busy={busy === 'create-camp' || busy === 'open-project' || busy === 'new-conversation'}
            recentCamps={navigation ? allNavigationCamps(navigation).slice(0, 5) : []}
            onOpenCamp={chooseCamp}
            onOpenMembers={() => chooseView('members')}
            onSend={createCampFromFirstMessage}
          />
        )}

        {view === 'compose' && !campCreationPreflight && (
          <EmptyState title="正在准备大厅" body="Rovai-ai 正在读取本机成员与执行引擎状态。" />
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
            onSectionChange={setSettingsSection}
            onBack={closeSettings}
            onRefresh={() => void refreshDiagnostics()}
            onExport={() => void exportDiagnostics()}
            onReload={() => loadOverview()}
            onThemeChange={(preference) => void changeThemePreference(preference)}
          />
        )}

        {view === 'members' && (
          <MembersView
            agents={agents}
            installations={installations}
            runtimeCandidates={health?.runtimeCandidates ?? []}
            runtimeDiscoveryPending={health === null && (!healthAttempted || healthLoading)}
            onReload={loadMemberData}
            onOpenRuntimeSettings={() => chooseView('settings')}
          />
        )}
      </main>

    </div>
  )
}

function AppHeader({
  view,
  campTitle,
  contextLabel,
  camp,
  stopping,
  onStop
}: {
  view: View
  campTitle: string | null
  contextLabel: string | null
  camp: CampSnapshot | null
  stopping: boolean
  onStop(): void
}): React.JSX.Element {
  const title = view === 'camp' && campTitle
    ? campTitle
    : view === 'compose'
      ? '新对话'
      : view === 'members'
        ? '成员'
        : view === 'memory'
          ? '长期记忆'
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
              ? <b className="run-badge"><i aria-hidden="true" />RUN {activeRuns}</b>
              : <span className="sr-only">当前没有运行</span>}
            {pendingApprovals > 0 && <b className="approval-badge">◆ APPROVAL {pendingApprovals}</b>}
          </div>
          {activeRuns > 0 && <button className="quiet-button compact" type="button" onClick={onStop} disabled={stopping}>{stopping ? '正在停止…' : '停止'}</button>}
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
  onSectionChange,
  onBack,
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
  onSectionChange(section: SettingsSection): void
  onBack(): void
  onRefresh(): void
  onExport(): void
  onReload(): Promise<void>
  onThemeChange(preference: ThemePreference): void
}): React.JSX.Element {
  return (
    <div className="settings-workbench">
      <nav className="settings-subnav" aria-label="设置分类">
        <button type="button" className="settings-back" onClick={onBack}><span aria-hidden="true">←</span>返回 App</button>
        <button type="button" className={section === 'skills' ? 'active' : ''} aria-current={section === 'skills' ? 'page' : undefined} onClick={() => onSectionChange('skills')}><span aria-hidden="true">◇</span><strong>技能</strong></button>
        <button type="button" className={section === 'mcp' ? 'active' : ''} aria-current={section === 'mcp' ? 'page' : undefined} onClick={() => onSectionChange('mcp')}><span aria-hidden="true">⌘</span><strong>MCP</strong></button>
        <button type="button" className={section === 'appearance' ? 'active' : ''} aria-current={section === 'appearance' ? 'page' : undefined} onClick={() => onSectionChange('appearance')}><span aria-hidden="true">◐</span><strong>外观</strong></button>
        <button type="button" className={section === 'diagnostics' ? 'active' : ''} aria-current={section === 'diagnostics' ? 'page' : undefined} onClick={() => onSectionChange('diagnostics')}><span aria-hidden="true">⌁</span><strong>诊断</strong></button>
      </nav>
      <div className="settings-panel">
        {section === 'skills' && <SkillSettings />}
        {section === 'mcp' && <McpSettings agents={agents} />}
        {section === 'appearance' && (
          <>
            <section className="project-hero">
              <div><h2>外观</h2><p>晨线与夜航共享相同的信息架构、组件尺寸和语义状态。</p></div>
            </section>
            <AppearanceSettings
              appearance={appearance}
              disabled={busy === 'appearance'}
              onChange={onThemeChange}
            />
          </>
        )}
        {section === 'diagnostics' && (
          <>
            <section className="project-hero"><div><h2>诊断</h2><p>这里不会展示任何执行引擎的 Token、登录信息或其他原始凭据。</p></div><div className="project-actions"><button className="quiet-button" onClick={onRefresh}>重新检测</button><button className="primary-button" onClick={onExport} disabled={busy === 'export'}>{busy === 'export' ? '正在导出…' : '导出诊断 JSON'}</button></div></section>
            <section className="section-block"><div className="section-heading"><div><h2>本地依赖</h2></div><span className="health-score">{readyCount}/4 就绪</span></div><RuntimeHealth health={health} /></section>
            <section className="section-block diagnostics-card">
              <Diagnostic label="应用数据目录" value={health?.core.dataDir} />
              <Diagnostic label="SQLite 数据库" value={health?.database.path} />
              <Diagnostic label="Git" value={health?.git.version} />
              {(health?.runtimeCandidates ?? []).map((candidate) => (
                <Diagnostic key={candidate.runtimeKind} label={runtimeAdapterLabel(candidate.runtimeKind)} value={`${candidate.reportedVersion ?? '版本未知'} · ${runtimeProbeLabel(candidate.status)} · ${candidate.executablePath ?? '未发现路径'}`} />
              ))}
              <Diagnostic label="执行引擎能力" value={health ? runtimeCapabilitySummary(health) : null} />
            </section>
            <RuntimeInstallationsPanel health={health} installations={installations} onReload={onReload} />
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
      <HealthItem label="执行引擎" ok={runtimeReady(health)} detail={health ? runtimeHealthSummary(health) : null} />
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
  return health?.runtimeCandidates.some((candidate) => candidate.status === 'ready') ?? health?.codex.status === 'ready'
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
      runtimeConfigured: agent.runtimePreference !== null,
      runtimeReadiness: agent.runtimeReadiness.status
    }))
  const initialLeadAgentProfileId = presentMembers
    .find((member) => member.runtimeConfigured)
    ?.agentProfileId ?? null
  const blockers: CampCreationPreflight['blockers'] = presentMembers.length === 0
    ? [{ code: 'no_present_members', detail: '当前没有在队成员。' }]
    : initialLeadAgentProfileId === null
      ? [{
          code: 'no_runtime_configured_members',
          detail: '当前无可用成员：请先为至少一位在队成员配置执行引擎。'
        }]
      : []
  return {
    admissible: blockers.length === 0,
    presentMembers,
    initialLeadAgentProfileId,
    blockers
  }
}

function runtimeHealthSummary(health: HealthStatus): string {
  const candidates = health.runtimeCandidates ?? [health.codex]
  const ready = candidates.filter((candidate) => candidate.status === 'ready')
  return ready.length
    ? ready.map((candidate) => `${runtimeAdapterLabel(candidate.runtimeKind)} ${candidate.reportedVersion ?? ''}`.trim()).join(' · ')
    : '尚无可用执行引擎'
}

function runtimeCapabilitySummary(health: HealthStatus): string {
  const candidates = health.runtimeCandidates ?? [health.codex]
  return candidates.map((candidate) => `${runtimeAdapterLabel(candidate.runtimeKind)} ${candidate.capabilities.length} 项`).join(' · ')
}

function runtimeAdapterLabel(kind: string): string {
  return ({
    'codex-cli': 'Codex CLI',
    'opencode-cli': 'OpenCode CLI',
    'copilot-cli': 'Copilot CLI',
    'claude-code-cli': 'Claude Code CLI',
    'antigravity-app': 'Antigravity App'
  } as Record<string, string>)[kind] ?? kind
}

function runtimeProbeLabel(status: HealthStatus['codex']['status']): string {
  switch (status) {
    case 'ready': return '能力探测通过'
    case 'not_installed': return '未安装'
    case 'authentication_required': return '需要登录'
    case 'missing_capabilities': return '缺少必需能力'
    case 'probe_failed': return '探测失败'
  }
}

function preflightBlockerLabel(code: string): string {
  return ({
    runtime_not_configured: '成员尚未配置执行引擎',
    runtime_configuration_incomplete: '成员执行引擎配置不完整',
    runtime_probe_required: '成员执行引擎需要重新探测',
    runtime_snapshot_stale: '成员执行引擎能力快照已过期',
    runtime_model_unavailable: '成员选择的模型当前不可用',
    runtime_model_option_unknown: '成员模型参数已不受支持',
    runtime_model_option_invalid: '成员模型参数值已失效',
    runtime_permission_schema_mismatch: '成员权限配置版本已失效',
    runtime_permission_option_unknown: '成员权限字段已不受支持',
    runtime_permission_option_unsupported: '成员权限选项当前不可执行',
    runtime_permission_value_invalid: '成员权限值已失效',
    runtime_permission_value_required: '成员缺少必填权限值',
    runtime_permission_adapter_mismatch: '成员权限配置与执行引擎不匹配',
    adapter_installation_missing: '成员引用的执行引擎不存在',
    adapter_installation_disabled: '成员引用的执行引擎已禁用',
    runtime_adapter_not_implemented: '该执行引擎适配器尚未实现',
    runtime_not_installed: '未找到本机执行引擎',
    runtime_authentication_required: '执行引擎需要登录',
    runtime_capability_missing: '执行引擎缺少必需能力',
    runtime_probe_failed: '执行引擎探测失败',
    agent_unavailable: '目标 Agent 当前不可用',
    workspace_invalid: '项目执行目录无效'
  } as Record<string, string>)[code] ?? code
}

function preflightFailureMessage(preflight: StartPreflightResult | null): string {
  if (!preflight) return '启动预检尚未完成，请稍后重试。'
  const blocker = preflight.blockers[0] ?? preflight.targets.flatMap((target) => target.blockers)[0]
  if (blocker?.code === 'agent_unavailable') return '当前无可用成员。'
  return blocker
    ? `${preflightBlockerLabel(blocker.code)}${blocker.detail ? `：${localizeExecutionEngineTerms(blocker.detail)}` : ''}`
    : '当前执行条件不满足，请刷新预检。'
}

export function commandFailureMessage(result: StoredCommandResult): string {
  if (result.code === 'camp_message.no_addressable_member' || result.code === 'camp.default_lead_invariant') {
    return '当前无可用成员。'
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
