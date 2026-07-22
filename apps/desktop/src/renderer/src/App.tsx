import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type {
  AdapterInstallation,
  AgentProfile,
  ActionApprovalView,
  Approval,
  CampCreationPreflight,
  CampListItem,
  CampSnapshot,
  CreateTaskAndQueueExecutionResult,
  CoreEvent,
  EventBatch,
  GitDiff,
  HealthStatus,
  NavigationCampItem,
  NavigationSnapshot,
  Project,
  SelectedProjectBinding,
  SendCampMessageResult,
  StartPreflightResult,
  StoredCommandResult,
  Task,
  TaskRunResult,
  TimelineEvent
} from '@contracts'
import { MembersView, RuntimeInstallationsPanel } from './MemberManagement'
import { CampWorkspace, NewConversationWorkspace } from './CampWorkspace'
import { TaskWorkspace } from './TaskWorkspace'
import { EmptyInline, StatusBadge } from './ui-elements'
import { relativeTime, statusLabel } from './ui-model'

type LoadState = 'loading' | 'ready' | 'error'
type View = 'home' | 'compose' | 'camp' | 'project' | 'task' | 'members' | 'diagnostics'

const EMPTY_DIFF: GitDiff = { status: [], isClean: true, changedFileCount: 0, stat: '', patch: '' }

export function App(): React.JSX.Element {
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [agents, setAgents] = useState<AgentProfile[]>([])
  const [installations, setInstallations] = useState<AdapterInstallation[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [camps, setCamps] = useState<CampListItem[]>([])
  const [navigation, setNavigation] = useState<NavigationSnapshot | null>(null)
  const [campSnapshot, setCampSnapshot] = useState<CampSnapshot | null>(null)
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [diff, setDiff] = useState<GitDiff>(EMPTY_DIFF)
  const [state, setState] = useState<LoadState>('loading')
  const [view, setView] = useState<View>('home')
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [activeCampId, setActiveCampId] = useState<string | null>(null)
  const [newConversationProject, setNewConversationProject] = useState<SelectedProjectBinding | null>(null)
  const [campCreationPreflight, setCampCreationPreflight] = useState<CampCreationPreflight | null>(null)
  const [newConversationCommandId, setNewConversationCommandId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [collaborationOpen, setCollaborationOpen] = useState(false)
  const [createContextId, setCreateContextId] = useState<string | null>(null)
  const [createCommandId, setCreateCommandId] = useState<string | null>(null)
  const [createPreflight, setCreatePreflight] = useState<StartPreflightResult | null>(null)
  const [createPreflightLoading, setCreatePreflightLoading] = useState(false)
  const [newConversationKey, setNewConversationKey] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const campCursor = useRef(0)
  const campSelectionGeneration = useRef(0)
  const startupRuntimeScanComplete = useRef(false)

  const loadOverview = useCallback(async (showLoading = false, refreshRuntimeProbe = false): Promise<void> => {
    if (showLoading) setState('loading')
    setError(null)
    try {
      const [nextHealth, nextAgents, nextInstallations, nextProjects, nextTasks, nextCamps, nextNavigation] = await Promise.all([
        window.lumen.request<HealthStatus>('health.check', { refreshRuntimeProbe }),
        window.lumen.request<AgentProfile[]>('agents.list'),
        window.lumen.request<AdapterInstallation[]>('runtime.installations.list'),
        window.lumen.request<Project[]>('projects.list'),
        window.lumen.request<Task[]>('tasks.list'),
        window.lumen.request<CampListItem[]>('camps.list'),
        window.lumen.request<NavigationSnapshot>('navigation.snapshot')
      ])
      setHealth(nextHealth)
      setAgents(nextAgents)
      setInstallations(nextInstallations)
      setProjects(nextProjects)
      setTasks(nextTasks)
      setCamps(nextCamps)
      setNavigation(nextNavigation)
      setActiveProjectId((current) => current ?? nextProjects.find((project) => project.kind === 'git')?.id ?? nextProjects[0]?.id ?? null)
      setState('ready')
    } catch (nextError) {
      setError(errorMessage(nextError))
      setState('error')
    }
  }, [])

  const loadNavigation = useCallback(async (): Promise<NavigationSnapshot> => {
    const nextNavigation = await window.lumen.request<NavigationSnapshot>('navigation.snapshot')
    setNavigation(nextNavigation)
    return nextNavigation
  }, [])

  const activateCamp = useCallback(async (campId: string): Promise<void> => {
    const selectionGeneration = ++campSelectionGeneration.current
    setActiveCampId(campId)
    setActiveTaskId(null)
    setView('camp')
    window.localStorage.setItem('lumen.activeCampId', campId)
    try {
      const snapshot = await window.lumen.request<CampSnapshot>('camps.snapshot', { campId })
      if (snapshot.schemaVersion !== 1) throw new Error('Camp snapshot schema is incompatible')
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

  const refreshTask = useCallback(async (taskId: string): Promise<void> => {
    const [nextTask, nextEvents, nextApprovals, nextDiff] = await Promise.all([
      window.lumen.request<Task>('tasks.get', { taskId }),
      window.lumen.request<TimelineEvent[]>('events.list', { taskId, limit: 1_000 }),
      window.lumen.request<Approval[]>('approvals.list', { taskId }),
      window.lumen.request<GitDiff>('tasks.diff', { taskId })
    ])
    setTasks((current) => replaceById(current, nextTask))
    setEvents(nextEvents)
    setApprovals(nextApprovals)
    setDiff(nextDiff)
  }, [])

  useEffect(() => {
    void loadOverview(true)
  }, [loadOverview])

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
    if (!navigation || activeCampId) return
    const rememberedCampId = window.localStorage.getItem('lumen.activeCampId')
    if (!rememberedCampId) return
    void activateCamp(rememberedCampId)
  }, [activateCamp, activeCampId, navigation])

  useEffect(() => {
    if (state !== 'ready') return
    const timer = setInterval(() => {
      void loadNavigation().catch(() => undefined)
    }, 1_800)
    return () => clearInterval(timer)
  }, [loadNavigation, state])

  useEffect(() => {
    if (!activeTaskId) return
    void refreshTask(activeTaskId).catch((nextError) => setError(errorMessage(nextError)))
    const timer = setInterval(() => {
      void refreshTask(activeTaskId).catch((nextError) => setError(errorMessage(nextError)))
    }, 1_800)
    return () => clearInterval(timer)
  }, [activeTaskId, refreshTask])

  useEffect(() => {
    return window.lumen.onEvent((event: CoreEvent) => {
      const params = asRecord(event.params)
      const eventTaskId = stringField(params, 'taskId')
      if (event.method === 'runtime.state' && !eventTaskId) {
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
      if (!activeTaskId || eventTaskId !== activeTaskId) return
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      refreshTimer.current = setTimeout(() => {
        void refreshTask(activeTaskId).catch((nextError) => setError(errorMessage(nextError)))
      }, 180)
    })
  }, [activeTaskId, loadOverview, refreshTask])

  const lobbyProject = projects.find((project) => project.kind === 'lobby') ?? null
  const gitProjects = projects.filter((project) => project.kind === 'git')
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null
  const activeGitProject = activeProject?.kind === 'git' ? activeProject : gitProjects[0] ?? null
  const createProject = gitProjects.find((project) => project.id === createContextId) ?? null
  const activeTask = tasks.find((task) => task.id === activeTaskId) ?? null
  const projectCamp = activeProject
    ? camps.find((camp) => camp.projectPath === activeProject.rootPath) ?? null
    : null
  const activeCamp = navigation
    ? allNavigationCamps(navigation).find((camp) => camp.id === activeCampId) ?? null
    : null
  const activeRepositoryScopeId = activeCamp?.repositoryScopeId
    ?? (campSnapshot?.camp.id === activeCampId ? campSnapshot.camp.repositoryScopeId : null)
  const activeCampProject = activeRepositoryScopeId && navigation
    ? navigation.projects.find((project) => project.repositoryScopeId === activeRepositoryScopeId) ?? null
    : null
  const projectTasks = activeGitProject
    ? tasks.filter((task) => task.projectId === activeGitProject.id)
    : []
  const pendingApprovalCount = approvals.filter((approval) => approval.status === 'pending').length
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
      if (snapshot.schemaVersion !== 1) throw new Error('Camp snapshot schema is incompatible')
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
        if (batch.schemaVersion !== 1 || batch.resetRequired || batch.events.length > 0) {
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
    try {
      const preflight = await window.lumen.request<CampCreationPreflight>('camps.creationPreflight')
      setCampCreationPreflight(preflight)
      if (!preflight.admissible) {
        throw new Error(preflight.blockers[0]?.detail ?? '当前没有 Runtime Ready 的成员。')
      }
      setNewConversationProject(project)
      setNewConversationCommandId(crypto.randomUUID())
      setActiveTaskId(null)
      setNewConversationKey((current) => current + 1)
      setView('compose')
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

  const chooseNewConversationProject = async (): Promise<void> => {
    setBusy('open-project')
    setError(null)
    try {
      const project = await window.lumen.selectProject()
      if (project) setNewConversationProject(project)
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const chooseProject = (project: Project): void => {
    setActiveProjectId(project.id)
    setActiveTaskId(null)
    setView('project')
  }

  const chooseView = (nextView: View): void => {
    if (nextView === 'project' && activeProject?.kind !== 'git') {
      setActiveProjectId(gitProjects[0]?.id ?? null)
    }
    setView(nextView)
  }

  const beginNewConversation = (): void => {
    const inheritedProject = view === 'camp' && activeCampProject && campSnapshot?.camp.id === activeCampId
      ? selectedProjectBinding(campSnapshot.camp.projectPath, activeCampProject)
      : null
    void enterNewConversation(inheritedProject)
  }

  const chooseCamp = (camp: NavigationCampItem): void => {
    void activateCamp(camp.id)
  }

  const openProjectTaskDialog = (projectId?: string | null): void => {
    const project = gitProjects.find((candidate) => candidate.id === projectId)
    if (!project) {
      setError('请先打开并进入一个 Git 项目。')
      return
    }
    const camp = camps.find((candidate) => candidate.projectPath === project.rootPath)
    if (!camp?.defaultLeadAgentId) {
      setError('当前项目 Camp 没有可用的 Default Lead，请刷新状态后重试。')
      return
    }
    const commandId = crypto.randomUUID()
    setCreateContextId(project.id)
    setCreateCommandId(commandId)
    setCreatePreflight(null)
    setCreatePreflightLoading(true)
    setCreateOpen(true)
    void window.lumen.request<StartPreflightResult>('execution.preflight', {
      campId: camp.id,
      address: {
        mode: 'explicit',
        agentProfileIds: [camp.defaultLeadAgentId]
      }
    }).then(setCreatePreflight).catch((nextError) => {
      setCreatePreflight(null)
      setError(errorMessage(nextError))
    }).finally(() => setCreatePreflightLoading(false))
  }

  const chooseTask = (task: Task): void => {
    setActiveProjectId(task.projectId)
    setActiveTaskId(task.id)
    setEvents([])
    setApprovals([])
    setDiff(EMPTY_DIFF)
    setView('task')
  }

  const createTask = async (projectId: string | null, title: string, goal: string): Promise<void> => {
    setBusy('create-task')
    setError(null)
    try {
      if (projectId) {
        const project = gitProjects.find((candidate) => candidate.id === projectId)
        const camp = project
          ? camps.find((candidate) => candidate.projectPath === project.rootPath)
          : null
        if (!project || !camp?.defaultLeadAgentId || !createCommandId) {
          throw new Error('项目 Camp 或 Default Lead 已失效，请关闭后重新打开任务对话框。')
        }
        if (!createPreflight?.admissible || !createPreflight.workspace) {
          throw new Error(preflightFailureMessage(createPreflight))
        }
        const objective = goal.trim()
        const result = await window.lumen.request<CreateTaskAndQueueExecutionResult>(
          'tasks.createAndQueueExecution',
          {
            commandId: createCommandId,
            campId: camp.id,
            title: title.trim() || titleFromObjective(objective),
            objective,
            acceptanceCriteria: [{
              id: 'requested-outcome',
              text: '完成用户描述的目标，并提供相关验证结果。'
            }],
            assigneeAgentId: camp.defaultLeadAgentId,
            dedupKey: `task-intake:${createCommandId}`,
            purpose: objective,
            expectedOutput: '完成实现，并报告修改内容与验证证据。',
            workspace: createPreflight.workspace
          }
        )
        if (!result.execution) {
          setCreatePreflight(result.preflight)
          throw new Error(preflightFailureMessage(result.preflight))
        }
        if (result.execution.status === 'rejected') {
          throw new Error(commandFailureMessage(result.execution))
        }
        const taskId = stringField(result.execution.payload, 'taskId')
        if (!taskId) throw new Error('Core 已受理命令，但没有返回 Task ID。')
        const task = await window.lumen.request<Task>('tasks.get', { taskId })
        setTasks((current) => replaceById(current, task))
        setActiveProjectId(task.projectId)
        setActiveTaskId(task.id)
        setCreateOpen(false)
        setView('task')
        await loadOverview()
        return
      }
      const task = await window.lumen.request<Task>('tasks.create', {
        ...(projectId ? { projectId } : {}),
        title: title.trim() || undefined,
        goal: goal.trim()
      })
      setTasks((current) => [task, ...current])
      setActiveProjectId(task.projectId)
      setActiveTaskId(task.id)
      setCreateOpen(false)
      setView('task')
      const result = await window.lumen.request<TaskRunResult>('tasks.start', { taskId: task.id })
      setTasks((current) => replaceById(current, result.task))
      await refreshTask(task.id)
    } catch (nextError) {
      setError(errorMessage(nextError))
      await loadOverview().catch(() => undefined)
      throw nextError
    } finally {
      setBusy(null)
    }
  }

  const createCampFromFirstMessage = async (body: string): Promise<void> => {
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

  const sendDefaultCampMessage = async (body: string): Promise<void> => {
    if (!activeCampId || !body.trim()) return
    setBusy('camp-default-message')
    setError(null)
    try {
      const result = await window.lumen.request<SendCampMessageResult>('camp.messages.send', {
        commandId: crypto.randomUUID(),
        campId: activeCampId,
        body,
        address: { mode: 'default' },
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

  const sendCampCollaboration = async (
    commandId: string,
    body: string,
    agentProfileIds: string[],
    execute: boolean
  ): Promise<void> => {
    if (!activeCampId || !body.trim() || agentProfileIds.length === 0) return
    setBusy('camp-message')
    setError(null)
    try {
      const result = await window.lumen.request<SendCampMessageResult>('camp.messages.send', {
        commandId,
        campId: activeCampId,
        body: body.trim(),
        address: { mode: 'explicit', agentProfileIds },
        replyToCampMessageId: null,
        execution: execute
          ? {
              taskId: null,
              purpose: body.trim(),
              expectedOutput: '向 Camp 公开回复各自的结论、依据与后续建议。',
              completionRole: 'required'
            }
          : null
      })
      if (!result.commandResult) throw new Error(preflightFailureMessage(result.preflight))
      if (result.commandResult.status === 'rejected') {
        throw new Error(commandFailureMessage(result.commandResult))
      }
      setCollaborationOpen(false)
    } catch (nextError) {
      setError(errorMessage(nextError))
      throw nextError
    } finally {
      setBusy(null)
    }
  }

  const startOrResumeTask = async (): Promise<void> => {
    if (!activeTask) return
    const method = activeTask.status === 'draft' ? 'tasks.start' : 'tasks.resume'
    setBusy('task-runtime')
    setError(null)
    try {
      const result = await window.lumen.request<TaskRunResult>(method, { taskId: activeTask.id })
      setTasks((current) => replaceById(current, result.task))
      await refreshTask(activeTask.id)
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const sendMessage = async (text: string): Promise<void> => {
    if (!activeTask || !text.trim()) return
    setBusy('send-message')
    setError(null)
    try {
      const result = await window.lumen.request<TaskRunResult>('tasks.send', {
        taskId: activeTask.id,
        text: text.trim()
      })
      setTasks((current) => replaceById(current, result.task))
      await refreshTask(activeTask.id)
    } catch (nextError) {
      setError(errorMessage(nextError))
      throw nextError
    } finally {
      setBusy(null)
    }
  }

  const interruptTask = async (): Promise<void> => {
    if (!activeTask) return
    setBusy('interrupt')
    setError(null)
    try {
      const task = await window.lumen.request<Task>('tasks.interrupt', { taskId: activeTask.id })
      setTasks((current) => replaceById(current, task))
      await refreshTask(activeTask.id)
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const resolveApproval = async (approval: Approval, decision: string): Promise<void> => {
    setBusy(`approval-${approval.id}`)
    setError(null)
    try {
      await window.lumen.request<Approval>('approvals.resolve', {
        approvalId: approval.id,
        decision
      })
      if (decision === 'cancel') {
        await window.lumen.request<Task>('tasks.interrupt', { taskId: approval.taskId })
      }
      await refreshTask(approval.taskId)
    } catch (nextError) {
      setError(errorMessage(nextError))
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

  return (
    <div className="app-shell">
      <AppHeader
        view={view}
        project={activeProject}
        task={activeTask}
        campTitle={activeCamp?.title ?? (campSnapshot?.camp.id === activeCampId ? campSnapshot.camp.title : null)}
        state={state}
        onNewConversation={beginNewConversation}
        onRefresh={() => void loadOverview(true)}
      />
      <Sidebar
        view={view}
        state={state}
        health={health}
        projects={gitProjects}
        tasks={tasks}
        navigation={navigation}
        activeProjectId={activeProjectId}
        activeTaskId={activeTaskId}
        activeCampId={activeCampId}
        onView={chooseView}
        onOpenProject={() => void openProject()}
        onProject={chooseProject}
        onTask={chooseTask}
        onCamp={chooseCamp}
      />

      <main className={`content ${view === 'task' || view === 'compose' || view === 'camp' ? 'task-content' : ''}`}>
        {error && (
          <div className="error-banner" role="alert">
            <span className="error-icon" aria-hidden="true">!</span>
            <div><strong>操作未完成</strong><span>{error}</span><small>项目文件和已经写入的审计记录不会因此丢失。</small></div>
            <div className="error-actions"><button className="quiet-button" onClick={() => void loadOverview()}>刷新状态</button><button className="icon-button" aria-label="关闭错误" onClick={() => setError(null)}>×</button></div>
          </div>
        )}

        {view === 'home' && (
          <HomeView
            health={health}
            agents={agents}
            projects={gitProjects}
            tasks={tasks}
            readyCount={readyCount}
            state={state}
            busy={busy}
            onNewConversation={beginNewConversation}
            onOpenProject={() => void openProject()}
            onProject={chooseProject}
            onTask={chooseTask}
          />
        )}

        {view === 'project' && (
          <ProjectView
            project={activeGitProject}
            tasks={projectTasks}
            camp={campSnapshot?.camp.id === projectCamp?.id ? campSnapshot : null}
            busy={busy}
            onOpenProject={() => void openProject()}
            onCreate={() => openProjectTaskDialog(activeGitProject?.id)}
            onCollaborate={() => setCollaborationOpen(true)}
            onResolveApproval={(approval, decision) => {
              void resolveActionApproval(approval, decision)
            }}
            onTask={chooseTask}
          />
        )}

        {view === 'camp' && activeCampId && campSnapshot?.camp.id === activeCampId && (
          <CampWorkspace
            snapshot={campSnapshot}
            projectName={activeCampProject?.name ?? null}
            busy={busy === 'camp-default-message' || busy?.startsWith('action-approval-') === true}
            onSend={sendDefaultCampMessage}
            onResolveApproval={(approval, decision) => {
              void resolveActionApproval(approval, decision)
            }}
          />
        )}

        {view === 'camp' && (!activeCampId || campSnapshot?.camp.id !== activeCampId) && (
          <EmptyState title="正在打开对话" body="Lumen 正在从 SQLite 权威快照恢复 Camp、成员与运行状态。" />
        )}

        {view === 'task' && activeTask && activeProject && (
          <TaskWorkspace
            project={activeProject}
            task={activeTask}
            events={events}
            approvals={approvals}
            diff={diff}
            busy={busy}
            pendingApprovalCount={pendingApprovalCount}
            onStartOrResume={() => void startOrResumeTask()}
            onSend={sendMessage}
            onInterrupt={() => void interruptTask()}
            onApproval={resolveApproval}
          />
        )}

        {view === 'compose' && campCreationPreflight && (
          <NewConversationWorkspace
            key={newConversationKey}
            project={newConversationProject}
            preflight={campCreationPreflight}
            busy={busy === 'create-camp' || busy === 'open-project'}
            onChooseProject={chooseNewConversationProject}
            onUseLobby={() => setNewConversationProject(null)}
            onSend={createCampFromFirstMessage}
          />
        )}

        {view === 'task' && (!activeTask || !activeProject) && (
          <EmptyState title="还没有选择对话" body="从左侧选择一个对话，或直接在默认大厅开始新对话。" action="新对话" onAction={beginNewConversation} />
        )}

        {view === 'diagnostics' && (
          <DiagnosticsView
            health={health}
            installations={installations}
            readyCount={readyCount}
            busy={busy}
            onRefresh={() => void loadOverview(true, true)}
            onExport={() => void exportDiagnostics()}
            onReload={() => loadOverview()}
          />
        )}

        {view === 'members' && (
          <MembersView
            agents={agents}
            installations={installations}
            onReload={() => loadOverview()}
          />
        )}
      </main>

      <CreateProjectTaskDialog
        open={createOpen}
        project={createProject}
        busy={busy === 'create-task'}
        preflight={createPreflight}
        preflightLoading={createPreflightLoading}
        onOpenChange={setCreateOpen}
        onSubmit={(title, goal) => createTask(createProject?.id ?? null, title, goal)}
      />
      <CampCollaborationDialog
        open={collaborationOpen}
        snapshot={campSnapshot?.camp.id === projectCamp?.id ? campSnapshot : null}
        busy={busy === 'camp-message'}
        onOpenChange={setCollaborationOpen}
        onSubmit={sendCampCollaboration}
      />
    </div>
  )
}

function AppHeader({
  view,
  project,
  task,
  campTitle,
  state,
  onNewConversation,
  onRefresh
}: {
  view: View
  project: Project | null
  task: Task | null
  campTitle: string | null
  state: LoadState
  onNewConversation(): void
  onRefresh(): void
}): React.JSX.Element {
  const title = view === 'camp' && campTitle ? campTitle : view === 'task' && task ? task.title : view === 'compose' ? '新对话' : view === 'project' && project ? project.name : view === 'members' ? '成员' : view === 'diagnostics' ? '设置与诊断' : '默认大厅'
  return (
    <header className="topbar">
      <div className="brand-mark" aria-hidden="true"><span /></div>
      <div className="topbar-title">
        <p className="eyebrow">Lumen AI · v0.03 MULTI-RUNTIME</p>
        <h1>{title}</h1>
      </div>
      {view === 'task' && task && <StatusBadge status={task.status} />}
      <div className="topbar-actions">
        <span className="local-pill">仅本地执行记录</span>
        <button className="primary-button" onClick={onNewConversation} disabled={state !== 'ready'}>＋ 新对话</button>
        <button className="quiet-button" onClick={onRefresh} disabled={state === 'loading'}>
          {state === 'loading' ? '连接中…' : '刷新'}
        </button>
      </div>
    </header>
  )
}

function Sidebar({
  view,
  state,
  health,
  projects,
  tasks,
  navigation,
  activeProjectId,
  activeTaskId,
  activeCampId,
  onView,
  onOpenProject,
  onProject,
  onTask,
  onCamp
}: {
  view: View
  state: LoadState
  health: HealthStatus | null
  projects: Project[]
  tasks: Task[]
  navigation: NavigationSnapshot | null
  activeProjectId: string | null
  activeTaskId: string | null
  activeCampId: string | null
  onView(view: View): void
  onOpenProject(): void
  onProject(project: Project): void
  onTask(task: Task): void
  onCamp(camp: NavigationCampItem): void
}): React.JSX.Element {
  const lobbyActive = view === 'home' || view === 'compose'
  const visibleTasks = (view === 'project' || view === 'task') && activeProjectId
    ? tasks.filter((task) => task.projectId === activeProjectId).slice(0, 8)
    : tasks.slice(0, 8)
  return (
    <aside className="sidebar">
      <nav aria-label="主导航">
        <button aria-current={lobbyActive ? 'page' : undefined} className={`nav-item ${lobbyActive ? 'active' : ''}`} onClick={() => onView('home')}><span aria-hidden="true">⌂</span>大厅</button>
        <button aria-current={view === 'project' ? 'page' : undefined} className={`nav-item ${view === 'project' ? 'active' : ''}`} onClick={() => onView('project')}><span aria-hidden="true">◇</span>项目</button>
        <button aria-current={view === 'task' ? 'page' : undefined} className={`nav-item ${view === 'task' ? 'active' : ''}`} onClick={() => onView('task')}><span aria-hidden="true">✓</span>任务</button>
        <button aria-current={view === 'members' ? 'page' : undefined} className={`nav-item ${view === 'members' ? 'active' : ''}`} onClick={() => onView('members')}><span aria-hidden="true">◎</span>成员</button>
        <button aria-current={view === 'diagnostics' ? 'page' : undefined} className={`nav-item ${view === 'diagnostics' ? 'active' : ''}`} onClick={() => onView('diagnostics')}><span aria-hidden="true">◌</span>诊断</button>
      </nav>

      <div className="sidebar-group">
        <div className="sidebar-group-title"><span>项目</span><button aria-label="打开本地 Git 项目" title="打开项目" onClick={onOpenProject}>＋</button></div>
        {projects.slice(0, 5).map((project) => (
          <button aria-current={project.id === activeProjectId ? 'true' : undefined} key={project.id} className={`sidebar-row ${project.id === activeProjectId ? 'selected' : ''}`} onClick={() => onProject(project)}>
            <span className="project-glyph" aria-hidden="true">⌁</span><span className="truncate">{project.name}</span>
          </button>
        ))}
        {projects.length === 0 && <p className="sidebar-empty">尚未打开项目</p>}
      </div>

      <div className="sidebar-group task-group">
        <div className="sidebar-group-title"><span>最近对话</span></div>
        {navigation && allNavigationCamps(navigation).slice(0, 8).map((camp) => (
          <button aria-current={camp.id === activeCampId ? 'true' : undefined} key={camp.id} className={`sidebar-task ${camp.id === activeCampId ? 'selected' : ''}`} onClick={() => onCamp(camp)}>
            <i aria-hidden="true" className={`task-dot camp-marker-${camp.marker}`} /><span className="truncate">{camp.title}</span><small>{relativeTime(camp.lastActivityAt)}</small>
          </button>
        ))}
        {navigation && allNavigationCamps(navigation).length === 0 && <p className="sidebar-empty">还没有对话</p>}
      </div>

      <div className="sidebar-group task-group legacy-task-group">
        <div className="sidebar-group-title"><span>最近任务</span></div>
        {visibleTasks.map((task) => (
          <button aria-current={task.id === activeTaskId ? 'true' : undefined} key={task.id} className={`sidebar-task ${task.id === activeTaskId ? 'selected' : ''}`} onClick={() => onTask(task)}>
            <i aria-hidden="true" className={`task-dot status-${task.status}`} /><span className="truncate">{task.title}</span><small>{statusLabel(task.status)}</small>
          </button>
        ))}
      </div>

      <div className="sidebar-footer">
        <div aria-hidden="true" className={`status-orb ${state}`} />
        <div>
          <strong>{state === 'ready' ? 'Core 已连接' : state === 'loading' ? '正在连接' : 'Core 需要检查'}</strong>
          <span>{health?.core.version ? `Lumen Core ${health.core.version}` : '本地核心服务'}</span>
        </div>
      </div>
    </aside>
  )
}

function HomeView({
  health,
  agents,
  projects,
  tasks,
  readyCount,
  state,
  busy,
  onNewConversation,
  onOpenProject,
  onProject,
  onTask
}: {
  health: HealthStatus | null
  agents: AgentProfile[]
  projects: Project[]
  tasks: Task[]
  readyCount: number
  state: LoadState
  busy: string | null
  onNewConversation(): void
  onOpenProject(): void
  onProject(project: Project): void
  onTask(task: Task): void
}): React.JSX.Element {
  return (
    <>
      <section className="hero-card">
        <div className="contour contour-one" /><div className="contour contour-two" />
        <div className="hero-copy">
          <span className="stamp">DEFAULT LOBBY · LOCAL</span>
          <h2>先在大厅聊清楚，再决定是否打开项目。</h2>
          <p>新对话默认不绑定任何项目，也不会读取项目文件。需要进入代码时，再显式选择一个本地 Git 项目。</p>
          <div className="hero-actions"><button className="primary-button" onClick={onNewConversation} disabled={state !== 'ready'}>{state === 'loading' ? '大厅初始化中…' : '＋ 开始新对话'}</button><button className="quiet-button" onClick={onOpenProject} disabled={busy === 'open-project'}>{busy === 'open-project' ? '正在检查项目…' : '打开本地 Git 项目'}</button></div>
        </div>
        <div className="lantern" aria-hidden="true"><div className="lantern-glow" /><div className="lantern-body" /></div>
      </section>

      <section className="overview-grid section-block">
        <div className="overview-card">
          <div className="section-heading compact"><div><p className="eyebrow">RECENT PROJECTS</p><h2>最近项目</h2></div></div>
          {projects.length ? projects.slice(0, 4).map((project) => (
            <button className="recent-row" key={project.id} onClick={() => onProject(project)}>
              <span className="recent-icon">⌁</span><span><strong>{project.name}</strong><small>{project.rootPath}</small></span><b>→</b>
            </button>
          )) : <EmptyInline text="打开第一个 Git 项目，开始自举。" />}
        </div>
        <div className="overview-card">
          <div className="section-heading compact"><div><p className="eyebrow">RECENT TASKS</p><h2>最近任务</h2></div></div>
          {tasks.length ? tasks.slice(0, 4).map((task) => (
            <button className="recent-row" key={task.id} onClick={() => onTask(task)}>
              <i className={`task-dot status-${task.status}`} /><span><strong>{task.title}</strong><small>{statusLabel(task.status)} · {relativeTime(task.updatedAt)}</small></span><b>→</b>
            </button>
          )) : <EmptyInline text="从默认大厅开始第一段对话，不需要先选择项目。" />}
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">COMPANIONS</p><h2>长期伙伴</h2></div><span className="section-note">身份持久保存 · Runtime 按需启动</span></div>
        <div className="agent-grid">
          {agents.map((agent) => <AgentCard agent={agent} key={agent.id} />)}
          {state === 'loading' && [0, 1, 2, 3].map((item) => <div className="agent-card skeleton" key={item} />)}
        </div>
      </section>

      <section className="section-block runtime-section">
        <div className="section-heading"><div><p className="eyebrow">RUNTIME HEALTH</p><h2>出发前检查</h2></div><span className="health-score">{readyCount}/4 ready</span></div>
        <RuntimeHealth health={health} />
      </section>
    </>
  )
}

function ProjectView({ project, tasks, camp, busy, onOpenProject, onCreate, onCollaborate, onResolveApproval, onTask }: {
  project: Project | null
  tasks: Task[]
  camp: CampSnapshot | null
  busy: string | null
  onOpenProject(): void
  onCreate(): void
  onCollaborate(): void
  onResolveApproval(approval: ActionApprovalView, decision: 'approve' | 'deny'): void
  onTask(task: Task): void
}): React.JSX.Element {
  if (!project) return <EmptyState title="先打开一个 Git 项目" body="Lumen 会把你选择的项目目录交给成员已配置的本机 Agent Runtime，并记录执行过程与文件变化。" action="打开项目" onAction={onOpenProject} />
  return (
    <>
      <section className="project-hero">
        <div><p className="eyebrow">ACTIVE PROJECT</p><h2>{project.name}</h2><code>{project.rootPath}</code></div>
        <div className="project-actions">
          <button className="quiet-button" onClick={onOpenProject}>切换项目</button>
          <button className="quiet-button" onClick={onCollaborate} disabled={!camp || busy === 'camp-message'}>发起协作</button>
          <button className="primary-button" onClick={onCreate} disabled={busy === 'create-task'}>＋ 新建项目任务</button>
        </div>
      </section>
      <CampTeamPanel
        snapshot={camp}
        busyApprovalId={busy?.startsWith('action-approval-') ? busy.slice('action-approval-'.length) : null}
        onResolveApproval={onResolveApproval}
      />
      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">PROJECT TASKS</p><h2>项目任务</h2></div><span className="section-note">Task 与 AgentRun 原子受理 · 同一 Conversation 顺序调度</span></div>
        <div className="task-card-list">
          {tasks.map((task) => (
            <button className="task-card" key={task.id} onClick={() => onTask(task)}>
              <div className="task-card-main"><StatusBadge status={task.status} /><h3>{task.title}</h3><p>{task.goal}</p></div>
              <div className="task-card-meta"><code title={task.executionRoot}>{task.startBranch}</code><span>{relativeTime(task.updatedAt)}</span><b>→</b></div>
            </button>
          ))}
          {tasks.length === 0 && <EmptyState title="还没有任务" body="给团队一个清晰、可验证的小目标。受理后由 Default Lead 获得首个执行职责。" action="新建任务" onAction={onCreate} />}
        </div>
      </section>
    </>
  )
}

export function CampTeamPanel({
  snapshot,
  busyApprovalId = null,
  onResolveApproval
}: {
  snapshot: CampSnapshot | null
  busyApprovalId?: string | null
  onResolveApproval?(approval: ActionApprovalView, decision: 'approve' | 'deny'): void
}): React.JSX.Element {
  if (!snapshot) {
    return (
      <section className="section-block camp-team-panel" aria-busy="true">
        <div className="section-heading"><div><p className="eyebrow">CAMP CONTROL PLANE</p><h2>协作运行面</h2></div></div>
        <EmptyInline text="正在读取同一 SQLite 快照中的成员、Task、AgentRun 与动作状态…" />
      </section>
    )
  }
  const latestRunByAgent = new Map<string, CampSnapshot['agentRuns'][number]>()
  for (const run of snapshot.agentRuns) {
    if (!latestRunByAgent.has(run.agentProfileId)) latestRunByAgent.set(run.agentProfileId, run)
  }
  const unresolvedActions = snapshot.actions.filter((action) => ['prepared', 'executing', 'unknown'].includes(action.status))
  const pendingApprovals = snapshot.approvals.filter((approval) => approval.status === 'pending')
  const memberById = new Map(snapshot.members.map((member) => [member.agentProfileId, member]))
  const recentMessages = snapshot.messages.slice(-8)
  return (
    <section className="section-block camp-team-panel" aria-label="Camp 多 Agent 控制面">
      <div className="section-heading">
        <div><p className="eyebrow">CAMP CONTROL PLANE</p><h2>协作运行面</h2></div>
        <span className="section-note">一致快照 #{snapshot.throughGlobalSequence}</span>
      </div>
      <div className="camp-facts">
        <div><span>成员</span><strong>{snapshot.members.filter((member) => member.membershipStatus === 'active').length}</strong></div>
        <div><span>开放 Task</span><strong>{snapshot.tasks.filter((task) => !['completed', 'cancelled'].includes(task.status)).length}</strong></div>
        <div><span>待审批</span><strong>{pendingApprovals.length}</strong></div>
        <div className={unresolvedActions.some((action) => action.status === 'unknown') ? 'fact-danger' : ''}><span>未收敛动作</span><strong>{unresolvedActions.length}</strong></div>
      </div>
      {pendingApprovals.length > 0 && (
        <div className="camp-approval-list" aria-label="待处理动作审批">
          {pendingApprovals.map((approval) => {
            const action = snapshot.actions.find((candidate) => candidate.id === approval.actionId)
            const run = action
              ? snapshot.agentRuns.find((candidate) => candidate.id === action.agentRunId)
              : undefined
            const member = run ? memberById.get(run.agentProfileId) : undefined
            const pending = busyApprovalId === approval.id
            return (
              <article className="camp-approval" key={approval.id} aria-labelledby={`approval-${approval.id}`}>
                <div className="camp-approval-copy">
                  <div className="camp-approval-title">
                    <span className="semantic-label semantic-label-warning">等待你的授权</span>
                    <code>{actionKindLabel(approval.actionKind)}</code>
                  </div>
                  <h3 id={`approval-${approval.id}`}>{approval.actionSummary}</h3>
                  <p>由 {member?.displayName ?? run?.agentProfileId ?? 'Agent'} 请求；批准仅对本次精确动作生效，不会扩大后续权限。</p>
                  <div className="camp-approval-input">
                    <span>规范化动作参数</span>
                    <pre>{formatCanonicalActionInput(approval.canonicalInput)}</pre>
                  </div>
                  <dl>
                    <div><dt>Action</dt><dd><code>{approval.actionId.slice(0, 18)}</code></dd></div>
                    {action && <div><dt>Digest</dt><dd><code>{action.actionDigest.slice(0, 18)}</code></dd></div>}
                    {run && <div><dt>职责</dt><dd>{run.purpose}</dd></div>}
                  </dl>
                </div>
                <div className="camp-approval-actions">
                  <button
                    className="quiet-button"
                    disabled={pending || !onResolveApproval}
                    onClick={() => onResolveApproval?.(approval, 'deny')}
                  >拒绝</button>
                  <button
                    className="approve-button"
                    disabled={pending || !onResolveApproval}
                    onClick={() => onResolveApproval?.(approval, 'approve')}
                  >{pending ? '处理中…' : '批准这一次'}</button>
                </div>
              </article>
            )
          })}
        </div>
      )}
      <div className="agent-lanes" aria-label="Agent 泳道">
        {snapshot.members.map((member) => {
          const run = latestRunByAgent.get(member.agentProfileId)
          return (
            <article className="agent-lane" key={member.agentProfileId}>
              <span className="lane-accent" style={{ backgroundColor: member.accent }} aria-hidden="true" />
              <div className="lane-agent"><strong>{member.displayName}</strong><span>{member.roleTitle}{member.isDefaultLead ? ' · Default Lead' : ''}</span></div>
              <div className="lane-responsibility"><span>{run?.purpose ?? '当前没有执行职责'}</span>{run?.taskId && <code>{run.taskId.slice(0, 8)}</code>}</div>
              <span className={`lane-status run-${run?.status ?? 'idle'}`}>{run ? run.waitReason ?? run.status : 'idle'}</span>
            </article>
          )
        })}
      </div>
      <div className="camp-discussion" aria-label="Camp 公共讨论">
        <div className="camp-discussion-heading"><strong>公共讨论</strong><span>{recentMessages.length ? `最近 ${recentMessages.length} 条` : '等待第一条消息'}</span></div>
        {recentMessages.map((message) => {
          const member = memberById.get(message.authorId)
          const author = message.authorType === 'user' ? '你' : member?.displayName ?? message.authorId
          return (
            <article className={`camp-message camp-message-${message.authorType}`} key={message.id}>
              <div><strong>{author}</strong><span>#{message.sequence}{message.sourceAgentRunId ? ' · AgentRun 输出' : ''}</span></div>
              <p>{message.body}</p>
            </article>
          )
        })}
        {recentMessages.length === 0 && <EmptyInline text="发送普通消息不会创建 CampTurn；只有明确请求执行时才会唤醒 Agent。" />}
      </div>
      {unresolvedActions.some((action) => action.status === 'unknown') && (
        <div className="camp-safety-alert" role="status"><strong>存在结果未知的副作用</strong><span>恢复与重试会保持阻塞，直到 Reconciler 给出可审计结论。</span></div>
      )}
    </section>
  )
}

function actionKindLabel(kind: string): string {
  return ({
    shell_command: 'Shell',
    file_write: 'File write',
    file_delete: 'File delete',
    git_mutation: 'Git',
    network_write: 'Network',
    network_access: 'Network access',
    mcp_tool: 'MCP',
    sensitive_read: 'Sensitive read',
    runtime_permission_grant: 'Runtime permission'
  } as Record<string, string>)[kind] ?? kind
}

function formatCanonicalActionInput(input: unknown): string {
  try {
    return JSON.stringify(input, null, 2) ?? String(input)
  } catch {
    return String(input)
  }
}

export function CampCollaborationDialog({
  open,
  snapshot,
  busy,
  onOpenChange,
  onSubmit
}: {
  open: boolean
  snapshot: CampSnapshot | null
  busy: boolean
  onOpenChange(open: boolean): void
  onSubmit(commandId: string, body: string, agentProfileIds: string[], execute: boolean): Promise<void>
}): React.JSX.Element {
  const [mode, setMode] = useState<'message' | 'execution'>('execution')
  const [body, setBody] = useState('')
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([])
  const [commandId, setCommandId] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [preflight, setPreflight] = useState<StartPreflightResult | null>(null)
  const [preflightLoading, setPreflightLoading] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const selectedKey = selectedAgentIds.join(',')

  useEffect(() => {
    if (!open) return
    setMode('execution')
    setBody('')
    setSelectedAgentIds(snapshot?.camp.defaultLeadAgentId ? [snapshot.camp.defaultLeadAgentId] : [])
    setCommandId(crypto.randomUUID())
    setConfirmed(false)
    setPreflight(null)
    setSubmitError(null)
  }, [open, snapshot?.camp.id])

  useEffect(() => {
    let cancelled = false
    if (!open || mode !== 'execution' || !snapshot || selectedAgentIds.length === 0) {
      setPreflight(null)
      setPreflightLoading(false)
      return () => { cancelled = true }
    }
    setPreflightLoading(true)
    void window.lumen.request<StartPreflightResult>('execution.preflight', {
      campId: snapshot.camp.id,
      address: { mode: 'explicit', agentProfileIds: selectedAgentIds }
    }).then((result) => {
      if (!cancelled) setPreflight(result)
    }).catch((nextError) => {
      if (!cancelled) {
        setPreflight(null)
        setSubmitError(errorMessage(nextError))
      }
    }).finally(() => {
      if (!cancelled) setPreflightLoading(false)
    })
    return () => { cancelled = true }
  }, [mode, open, selectedKey, snapshot?.camp.id])

  const toggleAgent = (agentProfileId: string): void => {
    setSelectedAgentIds((current) => current.includes(agentProfileId)
      ? current.filter((id) => id !== agentProfileId)
      : [...current, agentProfileId])
  }
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setSubmitError(null)
    try {
      await onSubmit(commandId, body, selectedAgentIds, mode === 'execution')
    } catch (nextError) {
      setSubmitError(errorMessage(nextError))
    }
  }
  const activeMembers = snapshot?.members.filter((member) =>
    member.membershipStatus === 'active' && member.profileStatus === 'active'
  ) ?? []
  const executionReady = mode === 'message'
    || (!preflightLoading && preflight?.admissible === true && confirmed)

  return (
    <Dialog.Root open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content" aria-describedby="camp-collaboration-description">
          <div className="dialog-heading"><div><p className="eyebrow">CAMP · MULTI-AGENT</p><Dialog.Title>发起 Camp 协作</Dialog.Title></div><Dialog.Close className="dialog-close" aria-label="关闭 Camp 协作" disabled={busy}>×</Dialog.Close></div>
          <Dialog.Description id="camp-collaboration-description">普通消息只进入公共上下文；执行请求会为每个选中的 Agent 创建独立 AgentRun。</Dialog.Description>
          <form onSubmit={(event) => void submit(event)}>
            <fieldset className="mode-selector">
              <legend>消息意图</legend>
              <label><input type="radio" name="camp-message-mode" checked={mode === 'execution'} onChange={() => setMode('execution')} /><span><strong>请求执行</strong><small>创建一个 CampTurn 与多个独立 AgentRun</small></span></label>
              <label><input type="radio" name="camp-message-mode" checked={mode === 'message'} onChange={() => setMode('message')} /><span><strong>仅发送消息</strong><small>只更新公共上下文，不唤醒 Runtime</small></span></label>
            </fieldset>
            <fieldset className="agent-selector">
              <legend>参与者</legend>
              {activeMembers.map((member) => (
                <label key={member.agentProfileId} style={{ '--agent-accent': member.accent } as React.CSSProperties}>
                  <input type="checkbox" checked={selectedAgentIds.includes(member.agentProfileId)} onChange={() => toggleAgent(member.agentProfileId)} />
                  <span className="selector-accent" aria-hidden="true" /><span><strong>{member.displayName}</strong><small>{member.roleTitle}{member.isDefaultLead ? ' · Default Lead' : ''}</small></span>
                </label>
              ))}
            </fieldset>
            <label className="field-label">公共消息<textarea value={body} onChange={(event) => setBody(event.target.value)} rows={6} placeholder={mode === 'execution' ? '明确说明希望每位 Agent 独立完成什么、需要什么结论。' : '这条消息只会进入 Camp 公共上下文。'} autoFocus /></label>
            {mode === 'execution' && <PreflightNotice preflight={preflight} loading={preflightLoading} />}
            {mode === 'execution' && (
              <div className="authorization-box"><strong>本次会启动 {selectedAgentIds.length} 个独立 AgentRun</strong><ul><li>每位 Agent 使用自己的 Conversation 与 Native Session</li><li>Core 根据 Agent 能力确定只读或可写 Sandbox</li><li>受限动作仍必须逐次进入 Action/Approval</li></ul><label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />我确认唤醒所选 Agent；它们的最终回复会公开写回当前 Camp。</label></div>
            )}
            {mode === 'message' && <div className="preflight-notice ready" role="status"><strong>仅记录公共消息</strong><span>提交后不会创建 CampTurn、AgentRun 或模型请求。</span></div>}
            {submitError && <div className="inline-error">{submitError}</div>}
            <div className="dialog-actions"><Dialog.Close className="quiet-button" type="button" disabled={busy}>取消</Dialog.Close><button className="primary-button" disabled={!snapshot || !commandId || !body.trim() || selectedAgentIds.length === 0 || busy || !executionReady}>{busy ? '正在提交…' : mode === 'execution' ? `唤醒 ${selectedAgentIds.length} 位 Agent` : '发送消息'}</button></div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function CreateProjectTaskDialog({
  open,
  project,
  busy,
  preflight,
  preflightLoading,
  onOpenChange,
  onSubmit
}: {
  open: boolean
  project: Project | null
  busy: boolean
  preflight: StartPreflightResult | null
  preflightLoading: boolean
  onOpenChange(open: boolean): void
  onSubmit(title: string, goal: string): Promise<void>
}): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [goal, setGoal] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setTitle('')
      setGoal('')
      setConfirmed(false)
      setSubmitError(null)
    }
  }, [open])

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setSubmitError(null)
    try {
      await onSubmit(title, goal)
    } catch (error) {
      setSubmitError(errorMessage(error))
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content" aria-describedby="create-task-description">
          <div className="dialog-heading"><div><p className="eyebrow">DEFAULT LEAD · PROJECT TASK</p><Dialog.Title>新建项目任务</Dialog.Title></div><Dialog.Close className="dialog-close" aria-label="关闭项目任务" disabled={busy}>×</Dialog.Close></div>
          <Dialog.Description id="create-task-description">当前任务将使用项目“{project?.name ?? '未找到'}”，由 Camp 的 Default Lead 接收首个执行职责。</Dialog.Description>
          <form onSubmit={(event) => void submit(event)}>
            <label className="field-label">任务标题（可选）<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="留空时从目标自动生成" /></label>
            <label className="field-label">希望团队在这个项目中完成什么？<textarea value={goal} onChange={(event) => setGoal(event.target.value)} rows={7} placeholder="例如：为设置页增加版本兼容提示，并运行 typecheck 验证。" autoFocus /></label>
            <PreflightNotice preflight={preflight} loading={preflightLoading} />
            <div className="authorization-box"><strong>当前项目：{project?.name ?? '未找到'}</strong><ul><li>读取并直接修改项目目录：<code>{project?.rootPath ?? '未选择'}</code></li><li>运行项目内已有的检查和测试</li><li>通过本机 Agent Runtime 访问模型服务</li><li>记录命令、文件变化、审批与错误</li></ul><label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />我理解 Default Lead 会在当前项目中执行首个职责，已有未提交改动可能出现在同一 Git Diff 中；高风险操作仍需逐次审批。</label></div>
            {submitError && <div className="inline-error">{submitError}</div>}
            <div className="dialog-actions"><Dialog.Close className="quiet-button" type="button" disabled={busy}>取消</Dialog.Close><button className="primary-button" disabled={!goal.trim() || !project || !confirmed || busy || preflightLoading || !preflight?.admissible || !preflight.workspace}>{busy ? '正在受理…' : preflightLoading ? '正在检查…' : '创建并排队'}</button></div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function PreflightNotice({ preflight, loading }: {
  preflight: StartPreflightResult | null
  loading: boolean
}): React.JSX.Element {
  if (loading) {
    return <div className="preflight-notice checking" role="status"><strong>正在检查执行条件</strong><span>验证 Agent、Runtime 能力与项目身份…</span></div>
  }
  if (!preflight) {
    return <div className="preflight-notice blocked" role="alert"><strong>尚未获得预检结果</strong><span>关闭对话框并重试，或前往诊断页检查 Core。</span></div>
  }
  const blockers = [
    ...preflight.blockers,
    ...preflight.targets.flatMap((target) => target.blockers)
  ]
  if (!preflight.admissible) {
    return (
      <div className="preflight-notice blocked" role="alert">
        <strong>当前不能受理执行</strong>
        {blockers.map((blocker, index) => <span key={`${blocker.code}-${index}`}>{preflightBlockerLabel(blocker.code)}{blocker.detail ? `：${blocker.detail}` : ''}</span>)}
      </div>
    )
  }
  const queueConditions = preflight.targets.flatMap((target) => target.queueConditions)
  return (
    <div className="preflight-notice ready" role="status">
      <strong>执行条件已就绪</strong>
      <span>{queueConditions.length ? '当前 Conversation 正忙，本次 AgentRun 将安全排队。' : '提交后会原子创建 Task、CampTurn 与首个 AgentRun。'}</span>
    </div>
  )
}

function DiagnosticsView({ health, installations, readyCount, busy, onRefresh, onExport, onReload }: {
  health: HealthStatus | null
  installations: AdapterInstallation[]
  readyCount: number
  busy: string | null
  onRefresh(): void
  onExport(): void
  onReload(): Promise<void>
}): React.JSX.Element {
  return (
    <>
      <section className="project-hero"><div><p className="eyebrow">LOCAL DIAGNOSTICS</p><h2>设置与诊断</h2><p>这里不会展示任何 Agent Runtime 的 Token、登录信息或其他原始凭据。</p></div><div className="project-actions"><button className="quiet-button" onClick={onRefresh}>重新检测</button><button className="primary-button" onClick={onExport} disabled={busy === 'export'}>{busy === 'export' ? '正在导出…' : '导出诊断 JSON'}</button></div></section>
      <section className="section-block"><div className="section-heading"><div><p className="eyebrow">RUNTIME HEALTH</p><h2>本地依赖</h2></div><span className="health-score">{readyCount}/4 ready</span></div><RuntimeHealth health={health} /></section>
      <section className="section-block diagnostics-card">
        <Diagnostic label="应用数据目录" value={health?.core.dataDir} />
        <Diagnostic label="SQLite 数据库" value={health?.database.path} />
        <Diagnostic label="Git" value={health?.git.version} />
        {(health?.runtimeCandidates ?? []).map((candidate) => (
          <Diagnostic key={candidate.runtimeKind} label={runtimeAdapterLabel(candidate.runtimeKind)} value={`${candidate.reportedVersion ?? '版本未知'} · ${runtimeProbeLabel(candidate.status)} · ${candidate.executablePath ?? '未发现路径'}`} />
        ))}
        <Diagnostic label="Runtime 能力" value={health ? runtimeCapabilitySummary(health) : null} />
      </section>
      <RuntimeInstallationsPanel health={health} installations={installations} onReload={onReload} />
    </>
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

function AgentCard({ agent }: { agent: AgentProfile }): React.JSX.Element {
  const runtimeReady = agent.runtimeReadiness.status === 'ready'
  return (
    <article className="agent-card" style={{ '--agent-accent': agent.accent ?? '#697078' } as React.CSSProperties}>
      <div className="avatar-ring"><span>{agent.displayName.slice(0, 1)}</span></div>
      <div className="agent-title"><div><h3>{agent.displayName}</h3><span>{agent.personaLabel ?? `@${agent.handle}`}</span></div><i className={runtimeReady ? 'online' : ''} /></div>
      <strong>{agent.roleTitle ?? '自定义成员'}</strong><p>{agent.roleDescription}</p>
      <div className="agent-footer"><span>{runtimeReady ? 'Runtime 可执行' : '尚未配置 Runtime'}</span></div>
    </article>
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

function selectedProjectBinding(
  projectPath: string,
  project: NavigationSnapshot['projects'][number]
): SelectedProjectBinding {
  return {
    name: project.name,
    projectPath,
    repository: {
      gitCommonDir: project.gitCommonDir,
      objectFormat: project.objectFormat
    }
  }
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
    'agy-cli': 'AGY CLI'
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

function titleFromObjective(objective: string): string {
  const firstLine = objective.split('\n', 1)[0]?.trim() || '新任务'
  return firstLine.length > 48 ? `${firstLine.slice(0, 48)}…` : firstLine
}

function replaceById<T extends { id: string }>(values: T[], value: T): T[] {
  return values.some((current) => current.id === value.id)
    ? values.map((current) => current.id === value.id ? value : current)
    : [value, ...values]
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
