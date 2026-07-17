export type AgentSlug = 'luoke' | 'muwa' | 'mianzhi' | 'qilu'

export interface AgentProfile {
  id: string
  slug: AgentSlug
  displayName: string
  species: string
  roleTitle: string
  roleContract: string
  accent: string
  runtimeEnabled: boolean
  status: 'available' | 'coming_soon'
}

export interface CommandHealth {
  installed: boolean
  version: string | null
  authenticated?: boolean | null
  compatible?: boolean | null
  detail?: string | null
  path?: string | null
}

export interface HealthStatus {
  core: {
    ok: boolean
    version: string
    dataDir: string
  }
  database: {
    ok: boolean
    path: string
  }
  git: CommandHealth
  codex: CommandHealth
}

export interface Project {
  id: string
  name: string
  rootPath: string
  gitCommonDir: string
  createdAt: string
  lastOpenedAt: string
}

export type TaskStatus =
  | 'draft'
  | 'preparing'
  | 'running'
  | 'waiting_approval'
  | 'interrupted'
  | 'recovering'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface Task {
  id: string
  projectId: string
  ownerAgentId: string
  title: string
  goal: string
  status: TaskStatus
  worktreePath: string
  branchName: string
  baseRevision: string
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface GitDiff {
  status: string[]
  isClean: boolean
  changedFileCount: number
  stat: string
  patch: string
}

export interface TimelineEvent {
  id: number
  taskId: string
  sequence: number
  eventType: string
  nativeMethod: string | null
  payload: unknown
  createdAt: string
}

export interface Approval {
  id: string
  taskId: string
  nativeRequestId: string
  approvalType: string
  reason: string | null
  request: Record<string, unknown>
  status: 'pending' | 'approved' | 'declined'
  decision: unknown | null
  requestedAt: string
  resolvedAt: string | null
}

export interface TaskRunResult {
  task: Task
  threadId?: string
  turnId: string
}

export interface CoreEvent<T = unknown> {
  method: string
  params: T
}

export type CoreMethod =
  | 'health.check'
  | 'agents.list'
  | 'app.info'
  | 'projects.open'
  | 'projects.list'
  | 'tasks.create'
  | 'tasks.list'
  | 'tasks.get'
  | 'tasks.diff'
  | 'tasks.start'
  | 'tasks.resume'
  | 'tasks.send'
  | 'tasks.interrupt'
  | 'events.list'
  | 'approvals.list'
  | 'approvals.resolve'
  | 'diagnostics.export'

export interface LumenApi {
  request<T>(method: CoreMethod, params?: unknown): Promise<T>
  onEvent(listener: (event: CoreEvent) => void): () => void
  selectProject(): Promise<Project | null>
  revealTaskWorktree(taskId: string): Promise<void>
  exportDiagnostics(): Promise<string | null>
  platform: NodeJS.Platform
}
