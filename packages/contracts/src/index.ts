export type AdapterKind =
  | 'codex-cli'
  | 'opencode-cli'
  | 'copilot-cli'
  | 'claude-code-cli'
  | 'antigravity-app'

export type RuntimeOptionScope = 'run' | 'session' | 'host'

export interface RuntimeValueChoice {
  value: string
  label: string
}

export interface ModelOptionDescriptor {
  key: string
  label: string
  valueType: 'enum'
  values: RuntimeValueChoice[]
  defaultValue: string | null
  scope: RuntimeOptionScope
}

export interface ModelDescriptor {
  id: string
  displayName: string
  isDefault: boolean
  hidden: boolean
  deprecated: boolean
  options: ModelOptionDescriptor[]
}

export interface PermissionOptionDescriptor {
  key: string
  label: string
  description: string
  valueType: 'boolean' | 'enum' | 'string_list' | 'rule_list'
  choices: RuntimeValueChoice[]
  recommendedValue: unknown
  scope: RuntimeOptionScope
  risk: 'normal' | 'elevated' | 'dangerous'
  supported: boolean
  required: boolean
  unsupportedReason: string | null
}

export interface AdapterCapabilitySnapshot {
  reportedVersion: string | null
  executableFingerprint: string | null
  authenticationStatus: string
  probeStatus: string
  permissionSchemaVersion: number
  capabilities: string[]
  protocols: string[]
  models: ModelDescriptor[]
  permissionOptions: PermissionOptionDescriptor[]
  observedAt: string | null
  lastAttemptedAt: string
  staleAt: string | null
  lastError: string | null
}

export interface AdapterInstallation {
  id: string
  adapterKind: AdapterKind
  executablePath: string
  source: 'discovered' | 'custom'
  authScope: string
  enabled: boolean
  version: number
  referencedProfileCount: number
  snapshot: AdapterCapabilitySnapshot | null
  createdAt: string
  updatedAt: string
}

export interface AgentCampMembership {
  campId: string
  projectPath: string
  campStatus: 'active' | 'archived'
  membershipStatus: 'active' | 'left'
  isDefaultLead: boolean
  joinedAt: string
  leftAt: string | null
}

export type ModelSelection =
  | { mode: 'runtime_default' }
  | { mode: 'explicit'; modelId: string; options: Record<string, unknown> }

export interface AdapterPermissionConfig {
  adapterKind: AdapterKind
  schemaVersion: number
  values: Record<string, unknown>
}

export interface AgentRuntimePreference {
  installationId: string
  model: ModelSelection
  permissions: AdapterPermissionConfig
}

export type RuntimeReadinessStatus =
  | 'runtime_not_configured'
  | 'needs_attention'
  | 'ready'
  | 'profile_inactive'

export interface AgentProfile {
  id: string
  handle: string
  displayName: string
  avatarRef: string | null
  personaLabel: string | null
  accent: string | null
  roleTitle: string | null
  roleDescription: string
  instructions: string
  defaultCapabilities: string[]
  status: 'active' | 'disabled' | 'archived'
  runtimePreference: AgentRuntimePreference | null
  runtimeReadiness: {
    status: RuntimeReadinessStatus
    blockers: Array<{ code: string; detail: string | null }>
  }
  memberOrder: number
  version: number
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export interface CreateAgentProfileCommand {
  handle: string
  displayName: string
  avatarRef: string | null
  personaLabel: string | null
  accent: string | null
  roleTitle: string | null
  roleDescription: string
  instructions: string
  defaultCapabilities: string[]
}

export interface UpdateAgentProfileCommand extends CreateAgentProfileCommand {
  agentProfileId: string
  expectedVersion: number
}

export interface SetAgentProfileRuntimeCommand {
  agentProfileId: string
  expectedVersion: number
  runtime: AgentRuntimePreference
}

export interface ClearAgentProfileRuntimeCommand {
  agentProfileId: string
  expectedVersion: number
}

export interface SetAgentProfileStatusCommand {
  agentProfileId: string
  expectedVersion: number
  status: 'active' | 'disabled' | 'archived'
  defaultLeadSuccessors: Array<{ campId: string; agentProfileId: string }>
}

export interface ReorderAgentProfilesCommand {
  orderedAgentProfileIds: string[]
}

export interface CreateAdapterInstallationCommand {
  adapterKind: AdapterKind
  executablePath: string
  source: 'discovered' | 'custom'
  authScope: string
}

export interface UpdateAdapterInstallationCommand {
  installationId: string
  expectedVersion: number
  executablePath: string
  source: 'discovered' | 'custom'
  authScope: string
  enabled: boolean
}

export interface UserCommandRequest<T> {
  commandId: string
  command: T
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
  runtimeKind: AdapterKind
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
  runtimeCandidates: AgentRuntimeProbeResult[]
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
  | 'runtime_not_configured'
  | 'runtime_configuration_incomplete'
  | 'runtime_probe_required'
  | 'runtime_snapshot_stale'
  | 'runtime_model_unavailable'
  | 'runtime_model_option_unknown'
  | 'runtime_model_option_invalid'
  | 'runtime_permission_schema_mismatch'
  | 'runtime_permission_option_unknown'
  | 'runtime_permission_option_unsupported'
  | 'runtime_permission_value_invalid'
  | 'runtime_permission_value_required'
  | 'runtime_permission_adapter_mismatch'
  | 'adapter_installation_missing'
  | 'adapter_installation_disabled'
  | 'runtime_adapter_not_implemented'
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

export type MessageAddressSpec =
  | { mode: 'default' }
  | { mode: 'explicit'; agentProfileIds: string[] }
  | { mode: 'broadcast' }

export interface RepositoryBindingInput {
  gitCommonDir: string
  objectFormat: 'sha1' | 'sha256'
}

export interface SelectedProjectBinding {
  name: string
  projectPath: string
  repository: RepositoryBindingInput
}

export interface CampCreationPreflight {
  admissible: boolean
  readyMembers: Array<{
    agentProfileId: string
    handle: string
    displayName: string
    memberOrder: number
  }>
  blockers: Array<{
    code: 'no_active_members' | 'no_runtime_ready_members'
    detail: string
  }>
}

export interface CreateCampFromFirstMessageRequest {
  commandId: string
  project: SelectedProjectBinding | null
  body: string
  address: MessageAddressSpec
  purpose: string
  expectedOutput: string
}

export interface CreateCampFromFirstMessageCommand {
  projectPath: string
  repository: RepositoryBindingInput | null
  body: string
  address: MessageAddressSpec
  purpose: string
  expectedOutput: string
}

export interface RenameCampCommand {
  campId: string
  title: string
  expectedVersion: number
}

export interface ChangeDefaultLeadCommand {
  campId: string
  successorAgentId: string
  expectedVersion: number
}

export interface DeleteCampCommand {
  campId: string
  expectedVersion: number
}

export interface CancelCampTurnCommand {
  campId: string
  campTurnId: string
  expectedVersion: number
}

export interface CampListItem {
  id: string
  title: string
  projectPath: string
  status: 'active' | 'archived'
  defaultLeadAgentId: string | null
  activeMemberCount: number
  openTaskCount: number
  updatedAt: string
}

export type NavigationCampMarker = 'loading' | 'unread_completed' | 'none'

export interface NavigationCampItem {
  id: string
  title: string
  projectPath: string
  repositoryScopeId: string | null
  repositoryGitCommonDir: string | null
  repositoryObjectFormat: 'sha1' | 'sha256' | null
  defaultLead: { agentProfileId: string; displayName: string } | null
  marker: NavigationCampMarker
  lastActivityAt: string
  lastActivityGlobalSequence: number
  latestCompletionGlobalSequence: number
  version: number
}

export interface NavigationCampGroup {
  totalCount: number
  recentCamps: NavigationCampItem[]
}

export interface ProjectNavigationGroup {
  repositoryScopeId: string
  name: string
  projectPath: string
  gitCommonDir: string
  objectFormat: 'sha1' | 'sha256'
  lastActivityAt: string
  lastActivityGlobalSequence: number
  totalCount: number
  recentCamps: NavigationCampItem[]
}

export interface NavigationSnapshot {
  schemaVersion: 1
  throughGlobalSequence: number
  lobby: NavigationCampGroup
  projects: ProjectNavigationGroup[]
}

export interface NavigationCampPage {
  schemaVersion: 1
  throughGlobalSequence: number
  repositoryScopeId: string | null
  totalCount: number
  nextOffset: number | null
  camps: NavigationCampItem[]
}

export interface CampViewedAcknowledgement {
  campId: string
  lastSeenGlobalSequence: number
}

export interface CampMemberView {
  agentProfileId: string
  handle: string
  displayName: string
  roleTitle: string
  accent: string
  membershipStatus: 'active' | 'left'
  profileStatus: 'active' | 'disabled' | 'archived'
  memberOrder: number
  isDefaultLead: boolean
}

export interface CampTaskView {
  id: string
  title: string
  description: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  assigneeAgentId: string | null
  createdByType: 'user' | 'agent'
  createdById: string
  sourceAgentRunId: string | null
  version: number
  createdAt: string
  updatedAt: string
  closedAt: string | null
  availableActions: Array<'update'>
}

export interface TaskListPage {
  tasks: CampTaskView[]
  nextCursor: string | null
  truncated: boolean
}

export type CampTaskStatus = CampTaskView['status']

export type TaskAssigneePatch =
  | { operation: 'unchanged' }
  | { operation: 'assign'; agentProfileId: string }
  | { operation: 'clear' }

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
  invocationKind: 'direct' | 'a2a'
  a2aParentAgentRunId: string | null
  a2aRootAgentRunId: string | null
  a2aDepth: number
  sourceInboxMessageId: string | null
  workspace: Record<string, unknown> | null
  version: number
  createdAt: string
  startedAt: string | null
  endedAt: string | null
  updatedAt: string
}

export interface InboxMessageView {
  id: string
  senderAgentId: string
  recipientAgentId: string
  body: string
  sourceAgentRunId: string | null
  targetAgentRunId: string | null
  inReplyToMessageId: string | null
  correlationId: string
  recipientMessageId: string | null
  deliveredAt: string | null
  failedAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export interface ContextSummaryView {
  id: string
  summaryKind: 'bootstrap' | 'unread'
  fromCampMessageSequence: number
  throughCampMessageSequence: number
  generatorAdapterKind: string
  generatorModel: unknown
  generatorVersion: string
  createdAt: string
}

export interface ContextAttachmentMetadataView {
  attachmentId: string
  name: string
  mediaType: string
  byteSize: number
  locationRef: string
  contentDigest: string
}

export interface RuntimeInputDeliveryView {
  id: string
  executionEpoch: number
  status: 'prepared' | 'accepted' | 'delivery_unknown' | 'not_accepted'
  nativeInputId: string | null
  boundaryCampMessageSequence: number
  preparedAt: string
  acceptedAt: string | null
  resolvedAt: string | null
  lastError: string | null
  updatedAt: string
}

export interface ContextManifestView {
  id: string
  agentRunId: string
  nativeBindingGeneration: number
  campMessageBoundarySequence: number
  conversationMessageBoundarySequence: number
  contextMode: 'bootstrap' | 'incremental' | null
  rawMessageCount: number
  summaries: ContextSummaryView[]
  attachments: ContextAttachmentMetadataView[]
  workBriefDigest: string
  taskContextDigest: string
  charterDigest: string
  memberStateDigest: string
  formatterVersion: number
  renderedPayloadDigest: string
  delivery: RuntimeInputDeliveryView | null
  createdAt: string
}

export interface ContextCompactionView {
  id: string
  agentRunId: string
  summaryKind: 'bootstrap' | 'unread'
  fromCampMessageSequence: number
  throughCampMessageSequence: number
  adapterKind: string
  model: unknown
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  generatedSummaryId: string | null
  errorCode: string | null
  createdAt: string
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
  schemaVersion: 4
  throughGlobalSequence: number
  camp: {
    id: string
    title: string
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
  inboxMessages: InboxMessageView[]
  contextManifests: ContextManifestView[]
  contextCompactions: ContextCompactionView[]
  approvals: ActionApprovalView[]
  actions: ActionView[]
  timeline: DomainEventView[]
}

export interface EventBatch {
  schemaVersion: 4
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
  | 'agents.get'
  | 'agents.memberships.list'
  | 'agents.create'
  | 'agents.update'
  | 'agents.runtime.set'
  | 'agents.runtime.clear'
  | 'agents.status.set'
  | 'agents.reorder'
  | 'runtime.installations.list'
  | 'runtime.installations.create'
  | 'runtime.installations.update'
  | 'runtime.installations.refresh'
  | 'app.info'
  | 'camps.creationPreflight'
  | 'repositories.inspect'
  | 'navigation.snapshot'
  | 'navigation.groupCamps'
  | 'navigation.campViewed'
  | 'camps.createFromFirstMessage'
  | 'camps.rename'
  | 'camps.changeDefaultLead'
  | 'camps.delete'
  | 'campTurns.cancel'
  | 'camps.snapshot'
  | 'tasks.create'
  | 'tasks.update'
  | 'tasks.list'
  | 'tasks.get'
  | 'camp.messages.send'
  | 'action.approvals.resolve'
  | 'execution.preflight'
  | 'events.subscribe'
  | 'diagnostics.export'

export interface LumenApi {
  request<T>(method: CoreMethod, params?: unknown): Promise<T>
  onEvent(listener: (event: CoreEvent) => void): () => void
  selectProject(): Promise<SelectedProjectBinding | null>
  selectRuntimeExecutable(): Promise<string | null>
  exportDiagnostics(): Promise<string | null>
  platform: NodeJS.Platform
}
