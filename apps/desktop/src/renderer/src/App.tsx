import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as Tabs from '@radix-ui/react-tabs'
import type {
  AgentProfile,
  Approval,
  CoreEvent,
  GitDiff,
  HealthStatus,
  Project,
  Task,
  TaskRunResult,
  TimelineEvent
} from '@contracts'

type LoadState = 'loading' | 'ready' | 'error'
type View = 'home' | 'project' | 'task' | 'diagnostics'

const EMPTY_DIFF: GitDiff = { status: [], isClean: true, changedFileCount: 0, stat: '', patch: '' }
const ACTIVE_STATUSES = new Set(['preparing', 'running', 'waiting_approval', 'recovering'])

export function App(): React.JSX.Element {
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [agents, setAgents] = useState<AgentProfile[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [diff, setDiff] = useState<GitDiff>(EMPTY_DIFF)
  const [state, setState] = useState<LoadState>('loading')
  const [view, setView] = useState<View>('home')
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadOverview = useCallback(async (showLoading = false): Promise<void> => {
    if (showLoading) setState('loading')
    setError(null)
    try {
      const [nextHealth, nextAgents, nextProjects, nextTasks] = await Promise.all([
        window.lumen.request<HealthStatus>('health.check'),
        window.lumen.request<AgentProfile[]>('agents.list'),
        window.lumen.request<Project[]>('projects.list'),
        window.lumen.request<Task[]>('tasks.list')
      ])
      setHealth(nextHealth)
      setAgents(nextAgents)
      setProjects(nextProjects)
      setTasks(nextTasks)
      setActiveProjectId((current) => current ?? nextProjects[0]?.id ?? null)
      setState('ready')
    } catch (nextError) {
      setError(errorMessage(nextError))
      setState('error')
    }
  }, [])

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

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null
  const activeTask = tasks.find((task) => task.id === activeTaskId) ?? null
  const projectTasks = activeProjectId
    ? tasks.filter((task) => task.projectId === activeProjectId)
    : []
  const pendingApprovalCount = approvals.filter((approval) => approval.status === 'pending').length
  const readyCount = useMemo(
    () => [health?.core.ok, health?.database.ok, health?.git.installed, codexReady(health)].filter(Boolean).length,
    [health]
  )

  const openProject = async (): Promise<void> => {
    setBusy('open-project')
    setError(null)
    try {
      const project = await window.lumen.selectProject()
      if (!project) return
      await loadOverview()
      setActiveProjectId(project.id)
      setActiveTaskId(null)
      setView('project')
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

  const chooseTask = (task: Task): void => {
    setActiveProjectId(task.projectId)
    setActiveTaskId(task.id)
    setEvents([])
    setApprovals([])
    setDiff(EMPTY_DIFF)
    setView('task')
  }

  const createTask = async (title: string, goal: string): Promise<void> => {
    if (!activeProjectId) throw new Error('请先打开一个 Git 项目。')
    setBusy('create-task')
    setError(null)
    try {
      const task = await window.lumen.request<Task>('tasks.create', {
        projectId: activeProjectId,
        title: title.trim() || undefined,
        goal: goal.trim()
      })
      setTasks((current) => [task, ...current])
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
        state={state}
        onRefresh={() => void loadOverview(true)}
      />
      <Sidebar
        view={view}
        state={state}
        health={health}
        projects={projects}
        tasks={tasks}
        activeProjectId={activeProjectId}
        activeTaskId={activeTaskId}
        onView={setView}
        onOpenProject={() => void openProject()}
        onProject={chooseProject}
        onTask={chooseTask}
      />

      <main className={`content ${view === 'task' ? 'task-content' : ''}`}>
        {error && (
          <div className="error-banner" role="alert">
            <strong>这一步没有完成</strong><span>{error}</span>
            <button aria-label="关闭错误" onClick={() => setError(null)}>×</button>
          </div>
        )}

        {view === 'home' && (
          <HomeView
            health={health}
            agents={agents}
            projects={projects}
            tasks={tasks}
            readyCount={readyCount}
            state={state}
            busy={busy}
            onOpenProject={() => void openProject()}
            onProject={chooseProject}
            onTask={chooseTask}
          />
        )}

        {view === 'project' && (
          <ProjectView
            project={activeProject}
            tasks={projectTasks}
            busy={busy}
            onOpenProject={() => void openProject()}
            onCreate={() => setCreateOpen(true)}
            onTask={chooseTask}
          />
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

        {view === 'task' && (!activeTask || !activeProject) && (
          <EmptyState title="还没有选择任务" body="从左侧选择一个任务，或先打开项目创建任务。" />
        )}

        {view === 'diagnostics' && (
          <DiagnosticsView
            health={health}
            readyCount={readyCount}
            busy={busy}
            onRefresh={() => void loadOverview(true)}
            onExport={() => void exportDiagnostics()}
          />
        )}
      </main>

      <CreateTaskDialog
        open={createOpen}
        project={activeProject}
        busy={busy === 'create-task'}
        onOpenChange={setCreateOpen}
        onSubmit={createTask}
      />
    </div>
  )
}

function AppHeader({
  view,
  project,
  task,
  state,
  onRefresh
}: {
  view: View
  project: Project | null
  task: Task | null
  state: LoadState
  onRefresh(): void
}): React.JSX.Element {
  const title = view === 'task' && task ? task.title : view === 'project' && project ? project.name : view === 'diagnostics' ? '设置与诊断' : '研发营地'
  return (
    <header className="topbar">
      <div className="brand-mark" aria-hidden="true"><span /></div>
      <div className="topbar-title">
        <p className="eyebrow">Lumen AI · v0.01</p>
        <h1>{title}</h1>
      </div>
      {view === 'task' && task && <StatusBadge status={task.status} />}
      <div className="topbar-actions">
        <span className="local-pill">仅本地执行记录</span>
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
  activeProjectId,
  activeTaskId,
  onView,
  onOpenProject,
  onProject,
  onTask
}: {
  view: View
  state: LoadState
  health: HealthStatus | null
  projects: Project[]
  tasks: Task[]
  activeProjectId: string | null
  activeTaskId: string | null
  onView(view: View): void
  onOpenProject(): void
  onProject(project: Project): void
  onTask(task: Task): void
}): React.JSX.Element {
  const visibleTasks = activeProjectId ? tasks.filter((task) => task.projectId === activeProjectId).slice(0, 8) : tasks.slice(0, 8)
  return (
    <aside className="sidebar">
      <nav aria-label="主导航">
        <button className={`nav-item ${view === 'home' ? 'active' : ''}`} onClick={() => onView('home')}><span>⌂</span>营地</button>
        <button className={`nav-item ${view === 'project' ? 'active' : ''}`} onClick={() => onView('project')}><span>◇</span>项目</button>
        <button className={`nav-item ${view === 'task' ? 'active' : ''}`} onClick={() => onView('task')}><span>✓</span>任务</button>
        <button className={`nav-item ${view === 'diagnostics' ? 'active' : ''}`} onClick={() => onView('diagnostics')}><span>◌</span>诊断</button>
      </nav>

      <div className="sidebar-group">
        <div className="sidebar-group-title"><span>项目</span><button onClick={onOpenProject}>＋</button></div>
        {projects.slice(0, 5).map((project) => (
          <button key={project.id} className={`sidebar-row ${project.id === activeProjectId ? 'selected' : ''}`} onClick={() => onProject(project)}>
            <span className="project-glyph">⌁</span><span className="truncate">{project.name}</span>
          </button>
        ))}
        {projects.length === 0 && <p className="sidebar-empty">尚未打开项目</p>}
      </div>

      <div className="sidebar-group task-group">
        <div className="sidebar-group-title"><span>最近任务</span></div>
        {visibleTasks.map((task) => (
          <button key={task.id} className={`sidebar-task ${task.id === activeTaskId ? 'selected' : ''}`} onClick={() => onTask(task)}>
            <i className={`task-dot status-${task.status}`} /><span className="truncate">{task.title}</span>
          </button>
        ))}
      </div>

      <div className="sidebar-footer">
        <div className={`status-orb ${state}`} />
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
  onOpenProject(): void
  onProject(project: Project): void
  onTask(task: Task): void
}): React.JSX.Element {
  return (
    <>
      <section className="hero-card">
        <div className="contour contour-one" /><div className="contour contour-two" />
        <div className="hero-copy">
          <span className="stamp">SELF BOOTSTRAP · 0.01</span>
          <h2>从这里，把 Lumen 的下一版交给沐瓦。</h2>
          <p>打开本地 Git 项目，Lumen 会为每个任务创建独立 Worktree，并通过你已登录的 Codex CLI 执行。</p>
          <button className="primary-button hero-action" onClick={onOpenProject} disabled={busy === 'open-project'}>
            {busy === 'open-project' ? '正在检查项目…' : '打开本地 Git 项目'}
          </button>
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
          )) : <EmptyInline text="任务会在独立 Worktree 中留下可审查的变化。" />}
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

function ProjectView({ project, tasks, busy, onOpenProject, onCreate, onTask }: {
  project: Project | null
  tasks: Task[]
  busy: string | null
  onOpenProject(): void
  onCreate(): void
  onTask(task: Task): void
}): React.JSX.Element {
  if (!project) return <EmptyState title="先打开一个 Git 项目" body="Lumen 只会在任务专用 Worktree 中让 Codex 修改代码。" action="打开项目" onAction={onOpenProject} />
  return (
    <>
      <section className="project-hero">
        <div><p className="eyebrow">ACTIVE PROJECT</p><h2>{project.name}</h2><code>{project.rootPath}</code></div>
        <div className="project-actions">
          <button className="quiet-button" onClick={onOpenProject}>切换项目</button>
          <button className="primary-button" onClick={onCreate} disabled={busy === 'create-task'}>＋ 新建沐瓦任务</button>
        </div>
      </section>
      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">WORKTREE TASKS</p><h2>项目任务</h2></div><span className="section-note">每个修改型任务拥有独立分支与 Worktree</span></div>
        <div className="task-card-list">
          {tasks.map((task) => (
            <button className="task-card" key={task.id} onClick={() => onTask(task)}>
              <div className="task-card-main"><StatusBadge status={task.status} /><h3>{task.title}</h3><p>{task.goal}</p></div>
              <div className="task-card-meta"><code>{task.branchName}</code><span>{relativeTime(task.updatedAt)}</span><b>→</b></div>
            </button>
          ))}
          {tasks.length === 0 && <EmptyState title="还没有任务" body="给沐瓦一个清晰、可验证的小目标。创建后会立即建立 Worktree 并启动 Codex。" action="新建任务" onAction={onCreate} />}
        </div>
      </section>
    </>
  )
}

function TaskWorkspace({
  project,
  task,
  events,
  approvals,
  diff,
  busy,
  pendingApprovalCount,
  onStartOrResume,
  onSend,
  onInterrupt,
  onApproval
}: {
  project: Project
  task: Task
  events: TimelineEvent[]
  approvals: Approval[]
  diff: GitDiff
  busy: string | null
  pendingApprovalCount: number
  onStartOrResume(): void
  onSend(text: string): Promise<void>
  onInterrupt(): void
  onApproval(approval: Approval, decision: string): Promise<void>
}): React.JSX.Element {
  const conversation = useMemo(() => buildConversation(events), [events])
  const activities = useMemo(() => buildActivities(events), [events])
  const canResume = ['draft', 'interrupted', 'recovering', 'failed'].includes(task.status)
  const isActive = ACTIVE_STATUSES.has(task.status)
  const [message, setMessage] = useState('')

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const value = message.trim()
    if (!value) return
    await onSend(value)
    setMessage('')
  }

  return (
    <section className="workspace-shell">
      <div className="workspace-heading">
        <div className="agent-identity"><span className="muwa-avatar">沐</span><div><p className="eyebrow">沐瓦 · CODEX RUNTIME</p><strong>{project.name}</strong></div></div>
        <div className="workspace-meta"><code>{task.branchName}</code><span className={`worktree-summary ${diff.isClean ? 'clean' : 'changed'}`} aria-live="polite">{diff.isClean ? 'Worktree 干净' : `已变更 ${diff.changedFileCount} 个文件`}</span><button className="quiet-button" onClick={() => void window.lumen.revealTaskWorktree(task.id)}>在 Finder 显示 Worktree</button></div>
      </div>

      {task.status === 'recovering' && (
        <div className="recovery-banner"><div><strong>发现上次未完成的任务</strong><span>Worktree 和审计记录已保留。确认后会恢复原生 Thread；失败时自动切换 Session Generation。</span></div><button className="primary-button" onClick={onStartOrResume} disabled={busy === 'task-runtime'}>确认并恢复</button></div>
      )}

      <div className="workspace-grid">
        <section className="timeline-pane">
          <div className="pane-title"><div><p className="eyebrow">TIMELINE</p><h2>任务对话</h2></div><StatusBadge status={task.status} /></div>
          <div className="timeline-scroll">
            <div className="goal-card"><span>任务目标</span><p>{task.goal}</p></div>
            {conversation.map((item) => <ConversationBubble item={item} key={item.id} />)}
            {conversation.length === 0 && <EmptyInline text={task.status === 'draft' ? '任务已创建，等待启动。' : '沐瓦正在准备上下文…'} />}
            {isActive && task.status !== 'waiting_approval' && <div className="thinking-row"><i /><span>沐瓦正在工作</span></div>}
          </div>
        </section>

        <aside className="activity-pane">
          <Tabs.Root defaultValue={pendingApprovalCount ? 'approvals' : 'activity'} className="activity-tabs">
            <Tabs.List className="tabs-list sticky-tabs">
              <Tabs.Trigger value="activity">活动 <small>{activities.length}</small></Tabs.Trigger>
              <Tabs.Trigger value="changes">变更 <small>{diff.changedFileCount}</small></Tabs.Trigger>
              <Tabs.Trigger value="approvals">审批 {pendingApprovalCount > 0 && <b>{pendingApprovalCount}</b>}</Tabs.Trigger>
              <Tabs.Trigger value="audit">审计</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="activity" className="tab-scroll activity-list">
              {activities.map((activity) => <ActivityRow activity={activity} key={activity.id} />)}
              {activities.length === 0 && <EmptyInline text="命令、文件和 Runtime 活动会出现在这里。" />}
            </Tabs.Content>
            <Tabs.Content value="changes" className="tab-scroll changes-panel">
              <DiffView diff={diff} />
            </Tabs.Content>
            <Tabs.Content value="approvals" className="tab-scroll approvals-panel">
              {approvals.map((approval) => <ApprovalCard approval={approval} busy={busy === `approval-${approval.id}`} onDecision={(decision) => onApproval(approval, decision)} key={approval.id} />)}
              {approvals.length === 0 && <EmptyInline text="当前没有审批请求。未知请求会默认失败关闭。" />}
            </Tabs.Content>
            <Tabs.Content value="audit" className="tab-scroll audit-list">
              {events.map((event) => <AuditRow event={event} key={event.id} />)}
            </Tabs.Content>
          </Tabs.Root>
        </aside>
      </div>

      <form className="composer" onSubmit={(event) => void submit(event)}>
        {canResume ? (
          <div className="resume-composer"><span>{task.status === 'draft' ? '任务尚未启动' : '当前 Turn 已停止，Worktree 仍然保留。'}</span><button type="button" className="primary-button" onClick={onStartOrResume} disabled={busy === 'task-runtime'}>{task.status === 'draft' ? '启动任务' : '继续任务'}</button></div>
        ) : (
          <>
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder={task.status === 'waiting_approval' ? '可先处理右侧审批，或追加约束…' : '给沐瓦追加指令…'} rows={2} disabled={busy === 'send-message'} onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }
            }} />
            <div className="composer-actions">
              {isActive && <button type="button" className="danger-button" onClick={onInterrupt} disabled={busy === 'interrupt'}>停止 Turn</button>}
              <button className="primary-button" type="submit" disabled={!message.trim() || busy === 'send-message'}>发送</button>
            </div>
          </>
        )}
      </form>
    </section>
  )
}

function CreateTaskDialog({ open, project, busy, onOpenChange, onSubmit }: {
  open: boolean
  project: Project | null
  busy: boolean
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
          <div className="dialog-heading"><div><p className="eyebrow">MUWA · CODING TASK</p><Dialog.Title>在独立 Worktree 中开始</Dialog.Title></div><Dialog.Close className="dialog-close" disabled={busy}>×</Dialog.Close></div>
          <Dialog.Description id="create-task-description">项目：{project?.name ?? '未选择'}。任务创建后，沐瓦会通过本机 Codex CLI 开始执行。</Dialog.Description>
          <form onSubmit={(event) => void submit(event)}>
            <label className="field-label">任务标题（可选）<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="留空时从目标自动生成" /></label>
            <label className="field-label">目标与验收标准<textarea value={goal} onChange={(event) => setGoal(event.target.value)} rows={7} placeholder="例如：为设置页增加 Codex 版本兼容提示，并运行 typecheck 验证。" autoFocus /></label>
            <div className="authorization-box"><strong>本次任务授权</strong><ul><li>读取项目，并在任务 Worktree 内创建、修改或删除文件</li><li>运行项目内已有的检查和测试</li><li>通过现有 Codex 登录访问模型服务</li><li>记录命令、文件变化、审批与错误</li></ul><label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />我理解主工作区不会被直接修改，高风险操作仍需逐次审批。</label></div>
            {submitError && <div className="inline-error">{submitError}</div>}
            <div className="dialog-actions"><Dialog.Close className="quiet-button" type="button" disabled={busy}>取消</Dialog.Close><button className="primary-button" disabled={!goal.trim() || !confirmed || busy}>{busy ? '正在创建 Worktree…' : '创建并启动任务'}</button></div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function DiagnosticsView({ health, readyCount, busy, onRefresh, onExport }: {
  health: HealthStatus | null
  readyCount: number
  busy: string | null
  onRefresh(): void
  onExport(): void
}): React.JSX.Element {
  return (
    <>
      <section className="project-hero"><div><p className="eyebrow">LOCAL DIAGNOSTICS</p><h2>设置与诊断</h2><p>这里不会展示 Codex Token 或其他原始凭据。</p></div><div className="project-actions"><button className="quiet-button" onClick={onRefresh}>重新检测</button><button className="primary-button" onClick={onExport} disabled={busy === 'export'}>{busy === 'export' ? '正在导出…' : '导出诊断 JSON'}</button></div></section>
      <section className="section-block"><div className="section-heading"><div><p className="eyebrow">RUNTIME HEALTH</p><h2>本地依赖</h2></div><span className="health-score">{readyCount}/4 ready</span></div><RuntimeHealth health={health} /></section>
      <section className="section-block diagnostics-card">
        <Diagnostic label="应用数据目录" value={health?.core.dataDir} />
        <Diagnostic label="SQLite 数据库" value={health?.database.path} />
        <Diagnostic label="Git" value={health?.git.version} />
        <Diagnostic label="Codex 路径" value={health?.codex.path} />
        <Diagnostic label="Codex 版本" value={`${health?.codex.version ?? '—'} · ${health?.codex.compatible === false ? '不兼容' : '兼容基线 0.144.5'}`} />
        <Diagnostic label="Codex 登录" value={health?.codex.detail ?? (health?.codex.authenticated ? '已登录' : '未知')} />
      </section>
    </>
  )
}

function RuntimeHealth({ health }: { health: HealthStatus | null }): React.JSX.Element {
  return (
    <div className="runtime-card health-grid">
      <HealthItem label="Rust Core" ok={health?.core.ok} detail={health?.core.version} />
      <HealthItem label="SQLite" ok={health?.database.ok} detail="WAL · bundled" />
      <HealthItem label="Git" ok={health?.git.installed} detail={health?.git.version} />
      <HealthItem label="Codex" ok={codexReady(health)} detail={health?.codex.compatible === false ? '版本不兼容' : health?.codex.version} />
    </div>
  )
}

function AgentCard({ agent }: { agent: AgentProfile }): React.JSX.Element {
  return (
    <article className="agent-card" style={{ '--agent-accent': agent.accent } as React.CSSProperties}>
      <div className="avatar-ring"><span>{agent.displayName.slice(0, 1)}</span></div>
      <div className="agent-title"><div><h3>{agent.displayName}</h3><span>{agent.species}</span></div><i className={agent.runtimeEnabled ? 'online' : ''} /></div>
      <strong>{agent.roleTitle}</strong><p>{agent.roleContract}</p>
      <div className="agent-footer"><span>{agent.runtimeEnabled ? 'Codex Runtime 可执行' : '身份已保存 · v0.02 开放'}</span></div>
    </article>
  )
}

type ConversationItem = { id: string; kind: 'user' | 'agent' | 'system' | 'error'; text: string; time: string }
type ActivityItem = { id: string; kind: string; title: string; detail: string; time: string; payload?: unknown }

function ConversationBubble({ item }: { item: ConversationItem }): React.JSX.Element {
  return (
    <article className={`conversation-bubble ${item.kind}`}>
      <div className="bubble-meta"><strong>{item.kind === 'user' ? '你' : item.kind === 'agent' ? '沐瓦' : item.kind === 'error' ? '错误' : 'Lumen'}</strong><time>{formatTime(item.time)}</time></div>
      <p>{item.text}</p>
    </article>
  )
}

function ActivityRow({ activity }: { activity: ActivityItem }): React.JSX.Element {
  return (
    <article className={`activity-row activity-${activity.kind}`}>
      <span className="activity-icon">{activityIcon(activity.kind)}</span>
      <div><div className="activity-row-title"><strong>{activity.title}</strong><time>{formatTime(activity.time)}</time></div>{activity.detail && <pre>{activity.detail}</pre>}{activity.payload !== undefined && <details><summary>原始参数</summary><pre>{jsonPreview(activity.payload)}</pre></details>}</div>
    </article>
  )
}

function ApprovalCard({ approval, busy, onDecision }: { approval: Approval; busy: boolean; onDecision(decision: string): Promise<void> }): React.JSX.Element {
  const command = deepString(approval.request, ['command']) ?? deepString(approval.request, ['item', 'command'])
  return (
    <article className={`approval-card ${approval.status}`}>
      <div className="approval-heading"><span>{approval.status === 'pending' ? '需要你的决定' : approval.status === 'approved' ? '已允许' : '已拒绝'}</span><time>{formatTime(approval.requestedAt)}</time></div>
      <h3>{approvalTitle(approval.approvalType)}</h3>
      <p>{approval.reason ?? 'Codex 请求执行超出当前自动授权范围的操作。'}</p>
      {command && <pre>{command}</pre>}
      <details><summary>查看完整参数</summary><pre>{jsonPreview(approval.request)}</pre></details>
      {approval.status === 'pending' && <div className="approval-actions"><button disabled={busy} onClick={() => void onDecision('decline')}>拒绝</button><button disabled={busy} onClick={() => void onDecision('cancel')}>拒绝并停止</button><button disabled={busy} onClick={() => void onDecision('accept')}>允许一次</button><button className="primary-button" disabled={busy} onClick={() => void onDecision('acceptForSession')}>本次任务允许</button></div>}
    </article>
  )
}

function DiffView({ diff }: { diff: GitDiff }): React.JSX.Element {
  if (!diff.status.length && !diff.patch.trim()) return <EmptyInline text="Worktree 相对任务起点没有文件变化。" />
  return (
    <div className="diff-view">
      <div className="changed-files">{diff.status.map((line, index) => <code key={`${line}-${index}`}>{line}</code>)}</div>
      {diff.stat && <pre className="diff-stat">{diff.stat}</pre>}
      {diff.patch && <pre className="diff-patch">{diff.patch}</pre>}
    </div>
  )
}

function AuditRow({ event }: { event: TimelineEvent }): React.JSX.Element {
  return <details className="audit-row"><summary><span>#{event.sequence} · {event.eventType}</span><time>{formatTime(event.createdAt)}</time></summary><code>{event.nativeMethod ?? 'lumen'}</code><pre>{jsonPreview(event.payload)}</pre></details>
}

function HealthItem({ label, ok, detail }: { label: string; ok?: boolean; detail?: string | null }): React.JSX.Element {
  return <div className="health-item"><span className={`health-indicator ${ok ? 'ok' : ''}`}>{ok ? '✓' : '·'}</span><div><strong>{label}</strong><span>{detail ?? '等待检测'}</span></div></div>
}

function Diagnostic({ label, value }: { label: string; value?: string | null }): React.JSX.Element {
  return <div className="diagnostic-row"><strong>{label}</strong><code>{value ?? '—'}</code></div>
}

function StatusBadge({ status }: { status: string }): React.JSX.Element {
  return <span className={`status-badge status-${status}`}><i />{statusLabel(status)}</span>
}

function EmptyState({ title, body, action, onAction }: { title: string; body: string; action?: string; onAction?(): void }): React.JSX.Element {
  return <section className="empty-state"><span>⌁</span><h2>{title}</h2><p>{body}</p>{action && onAction && <button className="primary-button" onClick={onAction}>{action}</button>}</section>
}

function EmptyInline({ text }: { text: string }): React.JSX.Element {
  return <div className="empty-inline">{text}</div>
}

export function buildConversation(events: TimelineEvent[]): ConversationItem[] {
  const result: ConversationItem[] = []
  const agentIndexes = new Map<string, number>()
  for (const event of events) {
    const payload = asRecord(event.payload)
    if (event.eventType === 'user.message') {
      const text = stringField(payload, 'text')
      if (text) result.push({ id: `event-${event.id}`, kind: 'user', text, time: event.createdAt })
      continue
    }
    if (event.eventType === 'agent.text.delta') {
      const delta = stringField(payload, 'delta')
      if (!delta) continue
      const key = `${stringField(payload, 'turnId') ?? 'turn'}:${stringField(payload, 'itemId') ?? event.id}`
      const existingIndex = agentIndexes.get(key)
      if (existingIndex === undefined) {
        agentIndexes.set(key, result.length)
        result.push({ id: `agent-${key}`, kind: 'agent', text: delta, time: event.createdAt })
      } else {
        result[existingIndex] = { ...result[existingIndex], text: result[existingIndex].text + delta, time: event.createdAt }
      }
      continue
    }
    if (event.eventType === 'error') {
      result.push({ id: `event-${event.id}`, kind: 'error', text: deepString(payload, ['message']) ?? jsonPreview(payload), time: event.createdAt })
      continue
    }
    if (event.nativeMethod === 'application/restarted' || event.nativeMethod === 'session/generation-changed') {
      result.push({ id: `event-${event.id}`, kind: 'system', text: event.nativeMethod === 'application/restarted' ? '应用已重启，任务等待你确认恢复。' : '原 Codex Thread 无法恢复，已切换到新的 Session Generation。', time: event.createdAt })
    }
  }
  return result
}

export function buildActivities(events: TimelineEvent[]): ActivityItem[] {
  const result: ActivityItem[] = []
  const outputIndexes = new Map<string, number>()
  for (const event of events) {
    const payload = asRecord(event.payload)
    if (event.eventType === 'command.output.delta') {
      const delta = stringField(payload, 'delta') ?? ''
      const key = stringField(payload, 'itemId') ?? `event-${event.id}`
      const index = outputIndexes.get(key)
      if (index === undefined) {
        outputIndexes.set(key, result.length)
        result.push({ id: `command-${key}`, kind: 'command', title: '命令输出', detail: delta, time: event.createdAt })
      } else {
        result[index] = { ...result[index], detail: `${result[index].detail}${delta}`, time: event.createdAt }
      }
      continue
    }
    if (event.eventType === 'activity.started' || event.eventType === 'activity.completed') {
      const item = asRecord(payload.item)
      const kind = stringField(item, 'type') ?? 'activity'
      if (kind === 'agentMessage' || kind === 'reasoning') continue
      const command = stringField(item, 'command') ?? deepString(item, ['command', 'command'])
      const status = stringField(item, 'status')
      result.push({
        id: `event-${event.id}`,
        kind: kind.toLowerCase().includes('file') ? 'file' : kind.toLowerCase().includes('command') ? 'command' : 'activity',
        title: `${friendlyItemType(kind)}${event.eventType.endsWith('completed') ? '完成' : '开始'}`,
        detail: command ?? status ?? '',
        time: event.createdAt,
        payload: item
      })
      continue
    }
    if (event.eventType === 'file.change.updated') {
      result.push({ id: `event-${event.id}`, kind: 'file', title: '文件 Patch 更新', detail: deepString(payload, ['itemId']) ?? '', time: event.createdAt, payload })
      continue
    }
    if (event.eventType.startsWith('approval.')) {
      result.push({ id: `event-${event.id}`, kind: 'approval', title: event.eventType === 'approval.requested' ? '请求审批' : '审批已处理', detail: event.nativeMethod ?? '', time: event.createdAt, payload })
      continue
    }
    if (event.eventType === 'runtime.log' || event.eventType === 'runtime.state' || event.eventType === 'turn.state') {
      result.push({ id: `event-${event.id}`, kind: 'runtime', title: event.eventType === 'turn.state' ? 'Turn 状态' : 'Runtime 状态', detail: stringField(payload, 'status') ?? stringField(payload, 'text') ?? '', time: event.createdAt, payload })
    }
  }
  return result.slice(-120)
}

function codexReady(health: HealthStatus | null): boolean {
  return Boolean(health?.codex.installed && health.codex.authenticated !== false && health.codex.compatible !== false)
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

function deepString(value: unknown, path: string[]): string | null {
  let current: unknown = value
  for (const part of path) current = asRecord(current)[part]
  if (typeof current === 'string') return current
  if (Array.isArray(current)) return current.filter((part) => typeof part === 'string').join(' ')
  return null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function jsonPreview(value: unknown): string {
  const text = JSON.stringify(value, null, 2) ?? String(value)
  return text.length > 8_000 ? `${text.slice(0, 8_000)}\n…（已截断）` : text
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date)
}

function relativeTime(value: string): string {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1_000)
  if (Math.abs(seconds) < 60) return '刚刚'
  const minutes = Math.round(seconds / 60)
  if (Math.abs(minutes) < 60) return new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' }).format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' }).format(hours, 'hour')
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(value))
}

function statusLabel(status: string): string {
  return ({ draft: '待启动', preparing: '准备中', running: '执行中', waiting_approval: '等待审批', interrupted: '已中断', recovering: '待恢复', completed: '已完成', failed: '失败', cancelled: '已取消' } as Record<string, string>)[status] ?? status
}

function friendlyItemType(type: string): string {
  const labels: Record<string, string> = { commandExecution: '命令', fileChange: '文件变更', mcpToolCall: 'MCP 调用', webSearch: 'Web 搜索', todoList: '计划', collabAgentToolCall: '协作调用' }
  return labels[type] ?? type
}

function activityIcon(kind: string): string {
  return ({ command: '›_', file: '±', approval: '!', runtime: '◌', activity: '·' } as Record<string, string>)[kind] ?? '·'
}

function approvalTitle(type: string): string {
  if (type.toLowerCase().includes('command') || type === 'execCommandApproval') return '运行高风险命令'
  if (type.toLowerCase().includes('file') || type === 'applyPatchApproval') return '应用文件变更'
  if (type.toLowerCase().includes('permission')) return '扩展 Runtime 权限'
  return 'Codex Runtime 请求'
}
