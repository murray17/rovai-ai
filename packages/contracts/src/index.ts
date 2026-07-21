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
  detail?: string | null
  path?: string | null
}

export type AgentRuntimeProbeStatus =
  | 'ready'
  | 'not_installed'
  | 'authentication_required'
  | 'missing_capabilities'
  | 'probe_failed'

export interface AgentRuntimeProbeResult {
  runtimeKind: 'codex'
  executablePath: string | null
  reportedVersion: string | null
  executableFingerprint: string | null
  status: AgentRuntimeProbeStatus
  capabilities: string[]
  missingCapabilities: string[]
  detail: string | null
  probedAt: string
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
  codex: AgentRuntimeProbeResult
}

export interface Project {
  id: string
  name: string
  kind: 'lobby' | 'git'
  rootPath: string
  gitCommonDir: string
  createdAt: string
  lastOpenedAt: string
}

export type TaskStatus =
  | 'draft'
  | 'pending'
  | 'preparing'
  | 'in_progress'
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
  executionRoot: string
  startBranch: string
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

export type StartPreflightBlockerCode =
  | 'runtime_not_installed'
  | 'runtime_authentication_required'
  | 'runtime_capability_missing'
  | 'runtime_probe_failed'
  | 'agent_unavailable'
  | 'workspace_invalid'

export interface StartPreflightResult {
  admissible: boolean
  checkedAt: string
  blockers: Array<{
    code: StartPreflightBlockerCode
    detail: string | null
  }>
  workspace: {
    executionRoot: string
    access: 'read_only' | 'write'
    isolation: 'shared' | 'git_worktree'
    repositoryScopeId: string | null
    baseGitCommit: string | null
  } | null
  targets: Array<{
    agentProfileId: string
    conversationId: string
    runtimeKind: string
    executableFingerprint: string | null
    blockers: Array<{
      code: StartPreflightBlockerCode
      detail: string | null
    }>
    queueConditions: Array<'conversation_busy' | 'earlier_run_queued'>
  }>
}

export interface StoredCommandResult {
  commandId: string
  commandType: string
  requestDigest: string
  requestDigestVersion: number
  status: 'applied' | 'accepted' | 'rejected'
  code: string
  payload: Record<string, unknown>
  resultEntity: { entityType: string; entityId: string } | null
  recordedAt: string
}

export interface CreateTaskAndQueueExecutionResult {
  execution: StoredCommandResult | null
  replayed: boolean
  preflight: StartPreflightResult | null
}

export interface SendCampMessageResult {
  commandResult: StoredCommandResult | null
  replayed: boolean
  preflight: StartPreflightResult | null
}

export interface CampListItem {
  id: string
  projectPath: string
  status: 'active' | 'archived'
  defaultLeadAgentId: string | null
  activeMemberCount: number
  openTaskCount: number
  updatedAt: string
}

export interface CampMemberView {
  agentProfileId: string
  handle: string
  displayName: string
  roleTitle: string
  accent: string
  membershipStatus: 'active' | 'left'
  profileStatus: 'active' | 'disabled' | 'archived'
  isDefaultLead: boolean
}

export interface CampTaskView {
  id: string
  title: string
  objective: string
  acceptanceCriteria: Array<{ id: string; text: string }>
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  readiness: 'ready' | 'blocked' | null
  blockers: string[]
  assigneeAgentId: string | null
  generation: number
  version: number
  createdAt: string
  updatedAt: string
  closedAt: string | null
}

export interface CampMessageView {
  id: string
  sequence: number
  authorType: 'user' | 'agent' | 'system'
  authorId: string
  sourceAgentRunId: string | null
  body: string
  addressMode: 'default' | 'explicit' | 'broadcast'
  addressedAgentProfileIds: string[]
  replyToCampMessageId: string | null
  campTurnId: string | null
  createdAt: string
}

export interface CampTurnView {
  id: string
  triggerType: 'camp_message' | 'inbox_message' | 'system_event'
  triggerId: string
  status: 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled'
  cancelRequestedAt: string | null
  version: number
  createdAt: string
  updatedAt: string
  endedAt: string | null
}

export interface AgentRunView {
  id: string
  campTurnId: string
  conversationId: string
  agentProfileId: string
  taskId: string | null
  responsibilityKey: string
  responsibilityGeneration: number
  purpose: string
  expectedOutput: string
  completionRole: 'required' | 'optional'
  status: 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled'
  waitReason: string | null
  executionEpoch: number
  workspace: Record<string, unknown> | null
  version: number
  createdAt: string
  startedAt: string | null
  endedAt: string | null
  updatedAt: string
}

export interface ActionView {
  id: string
  agentRunId: string
  actionKind: string
  actionSummary: string
  controlMode: 'mediated' | 'intercepted' | 'observed'
  policyDecision: 'allow' | 'ask' | 'deny' | 'observed'
  status: 'prepared' | 'executing' | 'succeeded' | 'failed' | 'unknown' | 'not_executed'
  actionDigest: string
  effectDisposition: 'none' | 'complete' | 'partial' | 'unknown' | null
  notExecutedReason: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface ActionApprovalView {
  id: string
  actionId: string
  actionKind: string
  actionSummary: string
  canonicalInput: unknown
  status: 'pending' | 'approved' | 'denied' | 'cancelled' | 'expired'
  requestedForUserId: string
  version: number
  requestedAt: string
  resolvedAt: string | null
}

export interface DomainEventView {
  globalSequence: number
  eventId: string | null
  eventType: string
  campId: string | null
  entityType: string | null
  entityId: string | null
  actorType: string | null
  actorId: string | null
  sourceAgentRunId: string | null
  executionEpoch: number | null
  payload: unknown
  createdAt: string
}

export interface CampSnapshot {
  schemaVersion: 1
  throughGlobalSequence: number
  camp: {
    id: string
    projectPath: string
    repositoryScopeId: string | null
    repositoryObjectFormat: string | null
    defaultLeadAgentId: string | null
    status: 'active' | 'archived'
    version: number
    createdAt: string
    updatedAt: string
  }
  members: CampMemberView[]
  tasks: CampTaskView[]
  messages: CampMessageView[]
  turns: CampTurnView[]
  agentRuns: AgentRunView[]
  approvals: ActionApprovalView[]
  actions: ActionView[]
  timeline: DomainEventView[]
}

export interface EventBatch {
  schemaVersion: 1
  requestedAfterGlobalSequence: number
  nextGlobalSequence: number
  throughGlobalSequence: number
  resetRequired: boolean
  hasMore: boolean
  events: DomainEventView[]
}

export interface CoreEvent<T = unknown> {
  method: string
  params: T
}

export type CoreMethod =
  | 'health.check'
  | 'agents.list'
  | 'app.info'
  | 'camps.list'
  | 'camps.snapshot'
  | 'camp.messages.send'
  | 'action.approvals.resolve'
  | 'execution.preflight'
  | 'projects.open'
  | 'projects.list'
  | 'tasks.create'
  | 'tasks.createAndQueueExecution'
  | 'tasks.list'
  | 'tasks.complete'
  | 'tasks.get'
  | 'tasks.diff'
  | 'tasks.start'
  | 'tasks.resume'
  | 'tasks.send'
  | 'tasks.interrupt'
  | 'events.list'
  | 'events.subscribe'
  | 'approvals.list'
  | 'approvals.resolve'
  | 'diagnostics.export'

export interface LumenApi {
  request<T>(method: CoreMethod, params?: unknown): Promise<T>
  onEvent(listener: (event: CoreEvent) => void): () => void
  selectProject(): Promise<Project | null>
  revealTaskWorkspace(taskId: string): Promise<void>
  exportDiagnostics(): Promise<string | null>
  platform: NodeJS.Platform
}
