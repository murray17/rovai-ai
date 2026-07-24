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
import {
  applyAppearanceSnapshot,
  initialAppearanceSnapshot
} from './theme'

type LoadState = 'loading' | 'ready' | 'error'
type View = 'compose' | 'camp' | 'members' | 'settings'

export function App(): React.JSX.Element {
  const [appearance, setAppearance] = useState<AppearanceSnapshot>(
    () => initialAppearanceSnapshot(document.documentElement)
  )
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [agents, setAgents] = useState<AgentProfile[]>([])
  const [installations, setInstallations] = useState<AdapterInstallation[]>([])
  const [navigation, setNavigation] = useState<NavigationSnapshot | null>(null)
  const [campSnapshot, setCampSnapshot] = useState<CampSnapshot | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [view, setView] = useState<View>('compose')
  const [activeCampId, setActiveCampId] = useState<string | null>(null)
  const [newConversationProject, setNewConversationProject] = useState<SelectedProjectBinding | null>(null)
  const [campCreationPreflight, setCampCreationPreflight] = useState<CampCreationPreflight | null>(null)
  const [newConversationCommandId, setNewConversationCommandId] = useState<string | null>(() => crypto.randomUUID())
  const [newConversationKey, setNewConversationKey] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const campCursor = useRef(0)
  const campSelectionGeneration = useRef(0)
  const startupRuntimeScanComplete = useRef(false)

  const loadOverview = useCallback(async (showLoading = false, refreshRuntimeProbe = false): Promise<void> => {
    if (showLoading) setState('loading')
    setError(null)
    try {
      const [nextAgents, nextInstallations, nextNavigation, nextPreflight] = await Promise.all([
        window.lumen.request<AgentProfile[]>('agents.list'),
        window.lumen.request<AdapterInstallation[]>('runtime.installations.list'),
        window.lumen.request<NavigationSnapshot>('navigation.snapshot'),
        window.lumen.request<CampCreationPreflight>('camps.creationPreflight')
      ])
      setAgents(nextAgents)
      setInstallations(nextInstallations)
      setNavigation(nextNavigation)
      setCampCreationPreflight(nextPreflight)
      setState('ready')
      const nextHealth = await window.lumen.request<HealthStatus>('health.check', { refreshRuntimeProbe })
      setHealth(nextHealth)
    } catch (nextError) {
      setError(errorMessage(nextError))
      setState('error')
    }
  }, [])

  const loadMemberData = useCallback(async (): Promise<void> => {
    const [nextAgents, nextInstallations] = await Promise.all([
      window.lumen.request<AgentProfile[]>('agents.list'),
      window.lumen.request<AdapterInstallation[]>('runtime.installations.list')
    ])
    setAgents(nextAgents)
    setInstallations(nextInstallations)
  }, [])

  const loadNavigation = useCallback(async (): Promise<NavigationSnapshot> => {
    const nextNavigation = await window.lumen.request<NavigationSnapshot>('navigation.snapshot')
    setNavigation(nextNavigation)
    return nextNavigation
  }, [])

  const activateCamp = useCallback(async (campId: string): Promise<void> => {
    const selectionGeneration = ++campSelectionGeneration.current
    setActiveCampId(campId)
    setView('camp')
    try {
      const snapshot = await window.lumen.request<CampSnapshot>('camps.snapshot', { campId })
      if (snapshot.schemaVersion !== 6) throw new Error('Camp snapshot schema is incompatible')
      if (selectionGeneration !== campSelectionGeneration.current) return
      campCursor.current = snapshot.throughGlobalSequence
      setCampSnapshot(snapshot)
      await window.lumen.request('navigation.campViewed', {
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
  }, [loadNavigation])

  useEffect(() => {
    void loadOverview(true)
  }, [loadOverview])

  useEffect(() => {
    let active = true
    const acceptSnapshot = (snapshot: AppearanceSnapshot): void => {
      applyAppearanceSnapshot(document.documentElement, snapshot)
      if (active) setAppearance(snapshot)
    }
    const unsubscribe = window.lumen.appearance.onChanged(acceptSnapshot)
    void window.lumen.appearance.get()
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
    if (state !== 'ready' || startupRuntimeScanComplete.current) return
    startupRuntimeScanComplete.current = true
    const refreshable = installations.filter((installation) =>
      installation.enabled
    )
    if (refreshable.length === 0) return
    void Promise.allSettled(refreshable.map((installation) =>
      window.lumen.request<StoredCommandResult>('runtime.installations.refresh', {
        commandId: crypto.randomUUID(),
        installationId: installation.id
      })
    )).then(() => loadOverview()).catch(() => undefined)
  }, [installations, loadOverview, state])

  useEffect(() => {
    if (state !== 'ready') return
    const timer = setInterval(() => {
      void loadNavigation().catch(() => undefined)
    }, 1_800)
    return () => clearInterval(timer)
  }, [loadNavigation, state])

  useEffect(() => {
    return window.lumen.onEvent((event: CoreEvent) => {
      const params = asRecord(event.params)
      if (event.method === 'runtime.state') {
        const runtimeStatus = stringField(params, 'status')
        if (runtimeStatus === 'crashed') {
          setState('error')
          setError(stringField(params, 'message') ?? 'Rust Core 已停止。')
        } else if (runtimeStatus === 'starting' || runtimeStatus === 'restarting') {
          setState('loading')
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
    setCampSnapshot(null)
    campCursor.current = 0
    if (!activeCampId) return undefined
    const campId = activeCampId

    const refreshSnapshot = async (): Promise<void> => {
      const snapshot = await window.lumen.request<CampSnapshot>('camps.snapshot', {
        campId
      })
      if (snapshot.schemaVersion !== 6) throw new Error('Camp snapshot schema is incompatible')
      if (cancelled) return
      campCursor.current = snapshot.throughGlobalSequence
      setCampSnapshot(snapshot)
      await window.lumen.request('navigation.campViewed', {
        campId,
        throughGlobalSequence: snapshot.throughGlobalSequence
      })
      if (!cancelled) await loadNavigation()
    }

    const poll = async (): Promise<void> => {
      try {
        const batch = await window.lumen.request<EventBatch>('events.subscribe', {
          campId,
          afterGlobalSequence: campCursor.current,
          limit: 250
        })
        if (cancelled) return
        if (batch.schemaVersion !== 6 || batch.resetRequired || batch.events.length > 0) {
          await refreshSnapshot()
        } else {
          campCursor.current = batch.nextGlobalSequence
        }
      } catch (nextError) {
        if (!cancelled) setError(errorMessage(nextError))
      } finally {
        if (!cancelled) timer = setTimeout(() => void poll(), 1_400)
      }
    }

    void refreshSnapshot()
      .then(() => poll())
      .catch((nextError) => {
        if (!cancelled) {
          setError(errorMessage(nextError))
          timer = setTimeout(() => void poll(), 1_400)
        }
      })
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [activeCampId, loadNavigation])

  const enterNewConversation = async (project: SelectedProjectBinding | null): Promise<void> => {
    setBusy('new-conversation')
    setError(null)
    setNewConversationProject(project)
    setNewConversationCommandId(crypto.randomUUID())
    setNewConversationKey((current) => current + 1)
    setView('compose')
    try {
      const preflight = await window.lumen.request<CampCreationPreflight>('camps.creationPreflight')
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
      const project = await window.lumen.selectProject()
      if (!project) return
      await enterNewConversation(project)
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const chooseView = (nextView: View): void => {
    setView(nextView)
  }

  const beginNewConversation = (): void => {
    void enterNewConversation(null)
  }

  const chooseCamp = (camp: NavigationCampItem): void => {
    void activateCamp(camp.id)
  }

  const renameCamp = async (camp: NavigationCampItem, title: string): Promise<void> => {
    setBusy(`rename-camp-${camp.id}`)
    setError(null)
    try {
      const result = await window.lumen.request<StoredCommandResult>('camps.rename', {
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
        const snapshot = await window.lumen.request<CampSnapshot>('camps.snapshot', { campId: camp.id })
        campCursor.current = snapshot.throughGlobalSequence
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
      const result = await window.lumen.request<StoredCommandResult>('camps.delete', {
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
        : await window.lumen.request<CampSnapshot>('camps.snapshot', { campId })
      const activeTurns = snapshot.turns.filter((turn) => ['running', 'waiting'].includes(turn.status))
      for (const turn of activeTurns) {
        const result = await window.lumen.request<StoredCommandResult>('campTurns.cancel', {
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
      const result = await window.lumen.request<StoredCommandResult>('camps.changeDefaultLead', {
        commandId: crypto.randomUUID(),
        command: {
          campId: activeCampId,
          successorAgentId: agentProfileId,
          expectedVersion: campSnapshot.camp.version
        }
      })
      if (result.status === 'rejected') throw new Error(commandFailureMessage(result))
      const [snapshot] = await Promise.all([
        window.lumen.request<CampSnapshot>('camps.snapshot', { campId: activeCampId }),
        loadNavigation()
      ])
      campCursor.current = snapshot.throughGlobalSequence
      setCampSnapshot(snapshot)
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
      const preflight = await window.lumen.request<CampCreationPreflight>('camps.creationPreflight')
      setCampCreationPreflight(preflight)
      if (!preflight.admissible) {
        throw new Error(preflight.blockers[0]?.detail ?? '当前没有 Runtime Ready 的成员。')
      }
      const result = await window.lumen.request<StoredCommandResult>('camps.createFromFirstMessage', {
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
      await loadNavigation()
      await activateCamp(campId)
      setNewConversationCommandId(null)
    } catch (nextError) {
      setError(errorMessage(nextError))
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
      const result = await window.lumen.request<SendCampMessageResult>('camp.messages.send', {
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
      setError(errorMessage(nextError))
      throw nextError
    } finally {
      setBusy(null)
    }
  }

  const resolveActionApproval = async (
    approval: ActionApprovalView,
    decision: 'approve' | 'deny'
  ): Promise<void> => {
    if (!activeCampId) return
    setBusy(`action-approval-${approval.id}`)
    setError(null)
    try {
      const result = await window.lumen.request<StoredCommandResult>('action.approvals.resolve', {
        commandId: crypto.randomUUID(),
        campId: activeCampId,
        approvalId: approval.id,
        expectedVersion: approval.version,
        decision,
        reason: decision === 'approve'
          ? '用户批准当前精确动作。'
          : '用户拒绝当前精确动作。'
      })
      if (result.status === 'rejected') throw new Error(commandFailureMessage(result))
      const snapshot = await window.lumen.request<CampSnapshot>('camps.snapshot', {
        campId: activeCampId
      })
      campCursor.current = snapshot.throughGlobalSequence
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
      await window.lumen.exportDiagnostics()
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
      const snapshot = await window.lumen.appearance.setPreference(preference)
      applyAppearanceSnapshot(document.documentElement, snapshot)
      setAppearance(snapshot)
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="app-shell">
      <AppHeader
        view={view}
        campTitle={activeCamp?.title ?? (campSnapshot?.camp.id === activeCampId ? campSnapshot.camp.title : null)}
        contextLabel={view === 'camp'
          ? activeCampProject?.name ?? '大厅'
          : view === 'compose'
            ? newConversationProject?.name ?? '大厅'
            : null}
        camp={view === 'camp' && campSnapshot?.camp.id === activeCampId ? campSnapshot : null}
        stopping={busy?.startsWith('stop-camp-') ?? false}
        onStop={() => void stopCampRuns()}
      />
      <CampNavigation
        view={view}
        state={state}
        navigation={navigation}
        activeCampId={activeCampId}
        onNewConversation={beginNewConversation}
        onMembers={() => chooseView('members')}
        onSettings={() => chooseView('settings')}
        onOpenProject={() => void openProject()}
        onCamp={chooseCamp}
        onRename={renameCamp}
        onDelete={deleteCamp}
        onStop={stopCampRuns}
        onError={(nextError) => setError(errorMessage(nextError))}
      />

      <main className={`content ${view === 'compose' || view === 'camp' ? 'task-content' : ''}`}>
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
            busy={busy === 'camp-message' || busy === 'change-default-lead' || busy?.startsWith('action-approval-') === true}
            onSend={sendCampMessage}
            onChangeLead={changeDefaultLead}
            onTasksChanged={() => activateCamp(activeCampId)}
            onResolveApproval={(approval, decision) => {
              void resolveActionApproval(approval, decision)
            }}
          />
        )}

        {view === 'camp' && (!activeCampId || campSnapshot?.camp.id !== activeCampId) && (
          <EmptyState title="正在打开对话" body="Lumen 正在从 SQLite 权威快照恢复 Camp、成员与运行状态。" />
        )}

        {view === 'compose' && campCreationPreflight && (
          <NewConversationWorkspace
            key={newConversationKey}
            project={newConversationProject}
            preflight={campCreationPreflight}
            busy={busy === 'create-camp' || busy === 'open-project' || busy === 'new-conversation'}
            onOpenMembers={() => chooseView('members')}
            onSend={createCampFromFirstMessage}
          />
        )}

        {view === 'compose' && !campCreationPreflight && (
          <EmptyState title="正在准备大厅" body="Lumen 正在读取本机成员与 Runtime 状态。" />
        )}

        {view === 'settings' && (
          <SettingsView
            appearance={appearance}
            health={health}
            installations={installations}
            readyCount={readyCount}
            busy={busy}
            onRefresh={() => void loadOverview(true, true)}
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
            runtimeDiscoveryPending={health === null}
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
  const title = view === 'camp' && campTitle ? campTitle : view === 'compose' ? '新对话' : view === 'members' ? '成员' : '设置'
  const activeRuns = camp?.agentRuns.filter((run) => ['queued', 'running', 'waiting'].includes(run.status)).length ?? 0
  const pendingApprovals = camp?.approvals.filter((approval) => approval.status === 'pending').length ?? 0
  return (
    <header className="topbar">
      <div className="topbar-title">
        <p className="eyebrow">{contextLabel ? `${contextLabel} / ${view === 'compose' ? '临时对话' : '当前对话'}` : 'Lumen AI · v0.08'}</p>
        <h1>{title}</h1>
      </div>
      {camp && (
        <div className="topbar-context-actions">
          <div className="topbar-context-status" aria-live="polite"><span>{activeRuns > 0 ? `${activeRuns} 个 AgentRun 正在执行` : '当前没有运行'}</span>{pendingApprovals > 0 && <b>{pendingApprovals} 项待审批</b>}</div>
          {activeRuns > 0 && <button className="quiet-button compact" type="button" onClick={onStop} disabled={stopping}>{stopping ? '正在停止…' : '停止当前运行'}</button>}
        </div>
      )}
    </header>
  )
}

function SettingsView({
  appearance,
  health,
  installations,
  readyCount,
  busy,
  onRefresh,
  onExport,
  onReload,
  onThemeChange
}: {
  appearance: AppearanceSnapshot
  health: HealthStatus | null
  installations: AdapterInstallation[]
  readyCount: number
  busy: string | null
  onRefresh(): void
  onExport(): void
  onReload(): Promise<void>
  onThemeChange(preference: ThemePreference): void
}): React.JSX.Element {
  const [section, setSection] = useState<'skills' | 'appearance' | 'diagnostics'>('skills')
  return (
    <div className="settings-workbench">
      <nav className="settings-subnav" aria-label="设置分类">
        <button type="button" className={section === 'skills' ? 'active' : ''} aria-current={section === 'skills' ? 'page' : undefined} onClick={() => setSection('skills')}><span aria-hidden="true">◇</span><strong>技能</strong><small>本机 Skill Library</small></button>
        <button type="button" className={section === 'appearance' ? 'active' : ''} aria-current={section === 'appearance' ? 'page' : undefined} onClick={() => setSection('appearance')}><span aria-hidden="true">◐</span><strong>外观</strong><small>白昼、夜间与系统</small></button>
        <button type="button" className={section === 'diagnostics' ? 'active' : ''} aria-current={section === 'diagnostics' ? 'page' : undefined} onClick={() => setSection('diagnostics')}><span aria-hidden="true">⌁</span><strong>诊断</strong><small>Core 与 Agent Runtime</small></button>
      </nav>
      <div className="settings-panel">
        {section === 'skills' && <SkillSettings />}
        {section === 'appearance' && (
          <>
            <section className="project-hero">
              <div><p className="eyebrow">HEARTH &amp; CAMP</p><h2>外观</h2><p>白昼与夜间共享相同的信息架构、组件尺寸和语义状态。</p></div>
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
            <section className="project-hero"><div><p className="eyebrow">LOCAL DIAGNOSTICS</p><h2>诊断</h2><p>这里不会展示任何 Agent Runtime 的 Token、登录信息或其他原始凭据。</p></div><div className="project-actions"><button className="quiet-button" onClick={onRefresh}>重新检测</button><button className="primary-button" onClick={onExport} disabled={busy === 'export'}>{busy === 'export' ? '正在导出…' : '导出诊断 JSON'}</button></div></section>
            <section className="section-block"><div className="section-heading"><div><p className="eyebrow">RUNTIME HEALTH</p><h2>本地依赖</h2></div><span className="health-score">{readyCount}/4 就绪</span></div><RuntimeHealth health={health} /></section>
            <section className="section-block diagnostics-card">
              <Diagnostic label="应用数据目录" value={health?.core.dataDir} />
              <Diagnostic label="SQLite 数据库" value={health?.database.path} />
              <Diagnostic label="Git" value={health?.git.version} />
              {(health?.runtimeCandidates ?? []).map((candidate) => (
                <Diagnostic key={candidate.runtimeKind} label={runtimeAdapterLabel(candidate.runtimeKind)} value={`${candidate.reportedVersion ?? '版本未知'} · ${runtimeProbeLabel(candidate.status)} · ${candidate.executablePath ?? '未发现路径'}`} />
              ))}
              <Diagnostic label="Agent Runtime 能力" value={health ? runtimeCapabilitySummary(health) : null} />
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
      <HealthItem label="Agent Runtime" ok={runtimeReady(health)} detail={health ? runtimeHealthSummary(health) : null} />
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

export function allNavigationCamps(navigation: NavigationSnapshot): NavigationCampItem[] {
  return [
    ...navigation.lobby.recentCamps,
    ...navigation.projects.flatMap((project) => project.recentCamps)
  ].sort((left, right) => {
    if (left.lastActivityGlobalSequence !== right.lastActivityGlobalSequence) {
      return right.lastActivityGlobalSequence - left.lastActivityGlobalSequence
    }
    return right.id.localeCompare(left.id)
  })
}

function runtimeHealthSummary(health: HealthStatus): string {
  const candidates = health.runtimeCandidates ?? [health.codex]
  const ready = candidates.filter((candidate) => candidate.status === 'ready')
  return ready.length
    ? ready.map((candidate) => `${runtimeAdapterLabel(candidate.runtimeKind)} ${candidate.reportedVersion ?? ''}`.trim()).join(' · ')
    : '尚无可执行 Adapter'
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
    runtime_not_configured: '成员尚未配置 Runtime',
    runtime_configuration_incomplete: '成员 Runtime 配置不完整',
    runtime_probe_required: '成员 Runtime 需要重新探测',
    runtime_snapshot_stale: '成员 Runtime 能力快照已过期',
    runtime_model_unavailable: '成员选择的模型当前不可用',
    runtime_model_option_unknown: '成员模型参数已不受支持',
    runtime_model_option_invalid: '成员模型参数值已失效',
    runtime_permission_schema_mismatch: '成员权限配置版本已失效',
    runtime_permission_option_unknown: '成员权限字段已不受支持',
    runtime_permission_option_unsupported: '成员权限选项当前不可执行',
    runtime_permission_value_invalid: '成员权限值已失效',
    runtime_permission_value_required: '成员缺少必填权限值',
    runtime_permission_adapter_mismatch: '成员权限配置与 Adapter 不匹配',
    adapter_installation_missing: '成员引用的 Runtime 安装不存在',
    adapter_installation_disabled: '成员引用的 Runtime 安装已禁用',
    runtime_adapter_not_implemented: '该 Runtime Adapter 尚未实现',
    runtime_not_installed: '未找到本机 Agent Runtime',
    runtime_authentication_required: 'Agent Runtime 需要登录',
    runtime_capability_missing: 'Agent Runtime 缺少必需能力',
    runtime_probe_failed: 'Agent Runtime 探测失败',
    agent_unavailable: '目标 Agent 当前不可用',
    workspace_invalid: '项目执行目录无效'
  } as Record<string, string>)[code] ?? code
}

function preflightFailureMessage(preflight: StartPreflightResult | null): string {
  if (!preflight) return '启动预检尚未完成，请稍后重试。'
  const blocker = preflight.blockers[0] ?? preflight.targets.flatMap((target) => target.blockers)[0]
  return blocker
    ? `${preflightBlockerLabel(blocker.code)}${blocker.detail ? `：${blocker.detail}` : ''}`
    : '当前执行条件不满足，请刷新预检。'
}

function commandFailureMessage(result: StoredCommandResult): string {
  return stringField(result.payload, 'message') ?? `Core 拒绝了命令：${result.code}`
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
  return error instanceof Error ? error.message : String(error)
}
