export * from './member-avatar'

export type AdapterKind =
  | 'codex-cli'
  | 'opencode-cli'
  | 'copilot-cli'
  | 'claude-code-cli'
  | 'kiro-cli'
  | 'qoder-cli'
  | 'codebuddy-cli'
  | 'qwen-code'
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
  probeStatus:
    | 'ready'
    | 'not_installed'
    | 'authentication_required'
    | 'missing_capabilities'
    | 'probe_failed'
  permissionSchemaVersion: number
  permissionSchemaDigest: string
  capabilities: string[]
  protocols: string[]
  models: ModelDescriptor[]
  permissionOptions: PermissionOptionDescriptor[]
  observedAt: string | null
  lastAttemptedAt: string
  lastSuccessfulProbeAt: string | null
  staleAt: string | null
  lastError: string | null
  nativeSessionCompatibilityKey: string | null
}

export type RuntimeProbeFailureClass =
  | 'none'
  | 'transient'
  | 'path_missing'
  | 'identity_changed'
  | 'authentication_required'
  | 'incompatible'

export interface AdapterProbeAttempt {
  id: string
  installationId: string
  status: 'ready' | 'failed'
  failureClass: RuntimeProbeFailureClass
  diagnosticCode: string | null
  candidatePath: string
  executableFingerprint: string | null
  attemptedAt: string
  retryAfter: string | null
}

export type InstallationSource =
  | 'manual'
  | 'env'
  | 'inherited_path'
  | 'login_shell'
  | 'known_location'
  | 'custom'

export type InstallationClass = 'managed_default' | 'custom'

export interface AdapterRelocationAudit {
  id: string
  installationId: string
  previousPath: string
  nextPath: string | null
  previousFingerprint: string | null
  nextFingerprint: string | null
  source: InstallationSource | null
  result: 'succeeded' | 'failed'
  diagnosticCode: string | null
  createdAt: string
}

export interface AdapterInstallation {
  id: string
  adapterKind: AdapterKind
  executablePath: string
  commandName: string
  installationClass: InstallationClass
  source: InstallationSource
  authScope: string
  enabled: boolean
  generation: number
  pathState: 'valid' | 'path_missing'
  version: number
  referencedProfileCount: number
  snapshot: AdapterCapabilitySnapshot | null
  lastProbeAttempt: AdapterProbeAttempt | null
  relocationHistory: AdapterRelocationAudit[]
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

export interface ProductRuntimeSelection {
  adapterKind: AdapterKind
}

export type RuntimeReadinessStatus =
  | 'runtime_not_configured'
  | 'selected_unresolved'
  | 'configuration_incomplete'
  | 'needs_attention'
  | 'ready'

export type MemberPresence = 'present' | 'away' | 'removed'

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
  presence: MemberPresence
  runtimeSelection: ProductRuntimeSelection | null
  runtimePreference: AgentRuntimePreference | null
  runtimeReadiness: {
    status: RuntimeReadinessStatus
    blockers: Array<{ code: string; detail: string | null }>
  }
  memberOrder: number
  version: number
  createdAt: string
  updatedAt: string
  removedAt: string | null
}

export interface CreateAgentProfileCommand {
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
  adapterKind: AdapterKind
}

export interface ClearAgentProfileRuntimeCommand {
  agentProfileId: string
  expectedVersion: number
}

export interface SetMemberPresenceCommand {
  agentProfileId: string
  expectedVersion: number
  presence: 'present' | 'away'
}

export interface RemoveMemberCommand {
  agentProfileId: string
  expectedVersion: number
  confirmationHandle: string
}

export interface MemberRemovalPreview {
  agentProfileId: string
  handle: string
  version: number
  nonTerminalAgentRunCount: number
  removable: boolean
}

export interface ReorderAgentProfilesCommand {
  orderedAgentProfileIds: string[]
}

export interface CreateAdapterInstallationCommand {
  adapterKind: AdapterKind
  executablePath: string
  commandName: string
  source: InstallationSource
  authScope: string
}

export interface UpdateAdapterInstallationCommand {
  installationId: string
  expectedVersion: number
  executablePath: string
  commandName: string
  source: InstallationSource
  authScope: string
  enabled: boolean
}

export interface ContextSummaryModelPreference {
  installationId: string
  model: ModelSelection
}

export interface ContextSummaryModelConfig {
  preference: ContextSummaryModelPreference | null
  version: number
  updatedAt: string | null
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

export type RuntimeDiscoveryStatus = 'detecting' | 'found' | 'missing'

export interface RuntimeDiscoveryObservation {
  runtimeKind: AdapterKind
  discoveryStatus: RuntimeDiscoveryStatus
  executablePath: string | null
  source: Exclude<InstallationSource, 'custom'> | null
  reportedVersion: string | null
  executableFingerprint: string | null
  searchGeneration: number
  observedAt: string
  diagnosticCode: string | null
}

export interface ProductRuntimeCatalogEntry {
  runtimeKind: AdapterKind
  displayName: string
  commandName: string
}

export type ProductRuntimeAvailabilityStatus =
  | 'detecting'
  | 'missing'
  | 'found_uninspected'
  | 'checking'
  | 'ready'
  | 'authentication_required'
  | 'incompatible'
  | 'path_missing'
  | 'disabled'
  | 'refresh_failed_using_last_success'

export interface ProductRuntimeAvailability {
  runtimeKind: AdapterKind
  status: ProductRuntimeAvailabilityStatus
  discovery: RuntimeDiscoveryObservation
  installationId: string | null
  reportedVersion: string | null
  diagnosticCode: string | null
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
  runtimeCatalog: ProductRuntimeCatalogEntry[]
  runtimeAvailability: ProductRuntimeAvailability[]
  searchEnvironment: {
    generation: number
    createdAt: string
    pathEntryCount: number
    shell: {
      status: 'captured' | 'unavailable' | 'timed_out' | 'failed'
      interactive: boolean
      shellName: string | null
      entryCount: number
      elapsedMillis: number
    }
  }
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

export type ProjectBindingKind = 'lobby' | 'directory'
export type GitCapabilityState = 'not_git' | 'git_valid' | 'git_invalid'

export interface GitObservation {
  state: GitCapabilityState
  repositoryRoot: string | null
  gitCommonDir: string | null
  objectFormat: 'sha1' | 'sha256' | null
  headCommit: string | null
  branch: string | null
  dirty: boolean | null
  observedAt: string
  diagnostic?: string
}

export interface WorkspaceInspection {
  name: string
  projectPath: string
  gitObservation: GitObservation
}

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
  } | null
  gitObservation: GitObservation | null
  targets: Array<{
    agentProfileId: string
    conversationId: string | null
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
  pendingExecution: PendingExecutionIntentView | null
}

export type PendingExecutionIntentStatus =
  | 'pending'
  | 'resolving'
  | 'failed'
  | 'cancelled'
  | 'consumed'

export interface PendingExecutionIntentView {
  id: string
  requestMethod: 'camp.messages.send'
  campId: string | null
  status: PendingExecutionIntentStatus
  diagnosticCode: string | null
  attemptCount: number
  retryAfter: string | null
}

export type MessageAddressSpec =
  | { mode: 'default' }
  | { mode: 'explicit'; agentProfileIds: string[] }
  | { mode: 'broadcast' }

export type CampCollaborationMode = 'peer' | 'lead_coordinated'

export interface CreateCampRequest {
  commandId: string
  name: string | null
  workspace: { projectPath: string } | null
  memberAgentProfileIds: string[]
  defaultLeadAgentProfileId: string
  collaborationMode: CampCollaborationMode
}

export interface CampCreationPreflight {
  admissible: boolean
  presentMembers: Array<{
    agentProfileId: string
    handle: string
    displayName: string
    memberOrder: number
    runtimeConfigured: boolean
    runtimeReadiness: RuntimeReadinessStatus
  }>
  initialLeadAgentProfileId: string | null
  blockers: Array<{
    code: 'no_present_members'
    detail: string
  }>
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

export interface ReconcileDefaultLeadCommand {
  campId: string
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
  projectBindingKind: ProjectBindingKind
  projectPath: string
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
  projectKey: string
  name: string
  projectPath: string
  lastActivityAt: string
  lastActivityGlobalSequence: number
  totalCount: number
  recentCamps: NavigationCampItem[]
}

export interface NavigationSnapshot {
  schemaVersion: 2
  throughGlobalSequence: number
  lobby: NavigationCampGroup
  projects: ProjectNavigationGroup[]
}

export interface NavigationCampPage {
  schemaVersion: 2
  throughGlobalSequence: number
  projectPath: string | null
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
  avatarRef: string | null
  roleTitle: string
  accent: string
  membershipStatus: 'active' | 'left'
  profilePresence: MemberPresence
  memberOrder: number
  isDefaultLead: boolean
  memoryWriteEnabled: boolean
  version: number
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
  presentation: CampTimelinePresentation | null
  createdAt: string
}

export type CampTimelinePresentation =
  | {
      kind: 'task_event'
      taskId: string
      titleAtEvent: string
      fromStatus: CampTaskStatus | null
      toStatus: CampTaskStatus
      assigneeNameAtEvent: string | null
      occurredAt: string
    }
  | {
      kind: 'a2a_event'
      event: 'request_accepted' | 'result_received' | 'stopped' | 'failed'
      senderNameAtEvent: string
      recipientNameAtEvent: string
      occurredAt: string
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
  permissionSemantics: 'core_enforced_v1' | 'runtime_managed_v2'
  invocationKind: 'direct' | 'a2a'
  a2aParentAgentRunId: string | null
  a2aRootAgentRunId: string | null
  a2aDepth: number
  sourceInboxMessageId: string | null
  hasUnsettledExternalEffects: boolean
  workspace: {
    path: string
  } | null
  startingGitObservation: GitObservation | null
  endingGitObservation: GitObservation | null
  version: number
  createdAt: string
  startedAt: string | null
  endedAt: string | null
  updatedAt: string
}

export interface AgentRunExecutionEvidenceView {
  id: string
  agentRunId: string
  executionEpoch: number
  sequence: number
  eventType: string
  kind:
    | 'reasoning_summary'
    | 'narration'
    | 'plan'
    | 'step'
    | 'tool_call'
    | 'tool_result'
    | 'command'
    | 'file_change'
  phase: 'started' | 'updated' | 'completed' | 'failed'
  payload: unknown
  contentBlobId: string | null
  contentByteCount: number
  isTruncated: boolean
  occurredAt: string
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
  level: 'segment' | 'epoch'
  fromSequence: number
  throughSequence: number
  sourceDigest: string
  inputTruncated: boolean
  generatorAdapterKind: string
  generatorModel: unknown
  generatorVersion: string
  createdAt: string
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

export interface SkillExposureEntry {
  skillId: string
  name: string
  revisionId: string
  contentDigest: string
  nativeRootKind: string
  status: 'ready' | 'stale' | 'shadowed' | 'unsupported' | 'error'
  entryPath: string | null
  reasonCode: string | null
}

export interface SkillExposureSnapshot {
  schemaVersion: 1
  skills: SkillExposureEntry[]
}

export interface McpExposureEntry {
  name: string
  transport: 'stdio' | 'streamable_http'
  configDigest: string
  status:
    | 'ready'
    | 'disabled'
    | 'unassigned'
    | 'adapter_unsupported'
    | 'missing_environment'
    | 'invalid'
  reason: string | null
}

export interface McpExposureSnapshot {
  schemaVersion: 1
  configDigest: string
  configStatus: 'ready' | 'invalid'
  warnings: string[]
  servers: McpExposureEntry[]
}

export interface NativeSessionBootstrapEvidenceView {
  id: string
  conversationId: string
  nativeBindingId: string
  nativeBindingGeneration: number
  contractVersion: 'native_session_bootstrap_v1'
  bootstrapFormatterVersion: 1
  sessionCharterDigest: string
  memoryEntrypointDigest: string
  observedMemoryRevisions: unknown[]
  authorizationBasisDigest: string
  deliveryMode: 'native_append' | 'first_payload'
  createdAt: string
}

export interface RunAttachmentProjectionView {
  projectionId: string
  attachmentId: string
  blobId: string
  projectedPath: string
  contentDigest: string
}

export interface ContextManifestView {
  id: string
  agentRunId: string
  bootstrap: NativeSessionBootstrapEvidenceView
  nativeBindingGeneration: number
  campMessageBoundarySequence: number
  conversationMessageBoundarySequence: number
  rawMessageCount: number
  summaries: ContextSummaryView[]
  coverageBaselineSequence: number | null
  collaborationStateDigest: string
  runNoticeRefs: string[]
  runNoticeDigest: string
  currentInputSource: unknown
  attachmentProjections: RunAttachmentProjectionView[]
  attachmentProjectionDigest: string
  skillExposure: SkillExposureSnapshot
  skillExposureDigest: string
  mcpExposure: McpExposureSnapshot
  mcpExposureDigest: string
  mcpProjectionDigest: string
  formatterVersion: 4
  renderedPayloadDigest: string
  delivery: RuntimeInputDeliveryView | null
  createdAt: string
}

export interface ContextCompactionView {
  id: string
  level: 'segment' | 'epoch'
  fromSequence: number
  throughSequence: number
  adapterKind: string
  model: unknown
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  generatedSummaryId: string | null
  errorCode: string | null
  retryCount: number
  waiterCount: number
  leaseExpiresAt: string | null
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
  reason: string | null
  agentRunId: string
  agentProfileId: string
  adapterKind: AdapterKind | 'unknown'
  nativeMethod: string | null
  requestDigest: string | null
  permissionSemantics: 'core_enforced_v1' | 'runtime_managed_v2'
  options: RuntimePermissionOptionView[]
  status: 'pending' | 'approved' | 'denied' | 'cancelled' | 'expired'
  requestedForUserId: string
  version: number
  requestedAt: string
  resolvedAt: string | null
}

export interface RuntimePermissionOptionView {
  optionId: string
  kind: 'allow_once' | 'allow_session' | 'deny' | 'cancel' | 'other'
  label: string
  consequence: string
  nativeResponseDigest: string
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
  schemaVersion: 10
  throughGlobalSequence: number
  camp: {
    id: string
    title: string
    projectBindingKind: ProjectBindingKind
    projectPath: string
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
  executionEvidence: AgentRunExecutionEvidenceView[]
  inboxMessages: InboxMessageView[]
  contextManifests: ContextManifestView[]
  contextCompactions: ContextCompactionView[]
  approvals: ActionApprovalView[]
  actions: ActionView[]
  timeline: DomainEventView[]
}

export interface EventBatch {
  schemaVersion: 9
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

export type ThemePreference = 'system' | 'day' | 'night'
export type ResolvedTheme = 'day' | 'night'

export interface AppearanceSnapshot {
  preference: ThemePreference
  resolvedTheme: ResolvedTheme
}

export interface AppearanceApi {
  get(): Promise<AppearanceSnapshot>
  setPreference(preference: ThemePreference): Promise<AppearanceSnapshot>
  onChanged(listener: (snapshot: AppearanceSnapshot) => void): () => void
}

export interface MemberAvatarCrop {
  centerX: number
  centerY: number
  size: number
}

export type MemberAvatarInputMediaType = 'image/png' | 'image/jpeg'

export interface MemberAvatarSourceSelection {
  displayName: string
  mediaType: MemberAvatarInputMediaType
  bytes: Uint8Array
  inspectedWidth: number
  inspectedHeight: number
  byteLength: number
}

export interface SaveMemberAvatarAssetInput {
  sourcePng: Uint8Array
  iconPng: Uint8Array
  sourceWidth: number
  sourceHeight: number
  crop: MemberAvatarCrop
}

export interface MemberAvatarAssetSummary {
  avatarRef: string
  sourceWidth: number
  sourceHeight: number
  crop: MemberAvatarCrop
}

export interface MemberAvatarRendition {
  mediaType: 'image/png'
  bytes: Uint8Array
  width: number
  height: number
  crop: MemberAvatarCrop
}

export interface MemberAvatarsApi {
  selectSource(): Promise<MemberAvatarSourceSelection | null>
  save(input: SaveMemberAvatarAssetInput): Promise<MemberAvatarAssetSummary>
  read(
    avatarRef: string,
    rendition: 'icon' | 'portrait'
  ): Promise<MemberAvatarRendition | null>
}

export type SkillSourceKind = 'bundled' | 'imported'
export type NativeSkillRootKind = 'agents' | 'claude' | 'antigravity'

export interface SkillRiskSummary {
  executableFileCount: number
  scriptFileCount: number
  binaryCandidateCount: number
  declaredTools: string[]
}

export interface SkillRevisionView {
  id: string
  skillId: string
  name: string
  description: string
  contentDigest: string
  sourceMetadata: unknown
  riskSummary: SkillRiskSummary
  fileCount: number
  totalBytes: number
  installedAt: string
}

export interface SkillView {
  id: string
  name: string
  sourceKind: SkillSourceKind
  enabled: boolean
  lifecycleStatus: 'active' | 'deleting'
  currentRevision: SkillRevisionView
  version: number
  createdAt: string
  updatedAt: string
  deletionRequestedAt: string | null
}

export interface SkillImportCandidate {
  name: string
  description: string
  contentDigest: string
  riskSummary: SkillRiskSummary
  fileCount: number
  totalBytes: number
  sourcePath: string
  existingSkillId: string | null
  existingSkillVersion: number | null
  existingSourceKind: SkillSourceKind | null
  importAction: 'create' | 'update' | 'unchanged' | 'bundled_conflict'
}

export interface RejectedSkillImportCandidate {
  sourcePath: string
  code: string
  message: string
}

export interface SkillImportInspection {
  stagingToken: string
  sourcePath: string
  candidates: SkillImportCandidate[]
  rejectedCandidates: RejectedSkillImportCandidate[]
  expiresAt: string
}

export interface SkillProjectionIssue {
  executionRoot: string
  nativeRootKind: NativeSkillRootKind
  skillId: string
  skillName: string
  revisionId: string
  entryPath: string
  state: string
  errorCode: string | null
  observedAt: string
}

export interface CommitSkillImportCommand {
  stagingToken: string
  candidateName: string
  expectedDigest: string
  expectedSkillVersion: number | null
  confirmUpdate: boolean
}

export interface SetSkillEnabledCommand {
  skillId: string
  expectedVersion: number
  enabled: boolean
}

export interface DeleteSkillCommand {
  skillId: string
  expectedVersion: number
}

export interface McpEditableValue {
  value: string | null
  preserveStored: boolean
}

export type McpServerInput =
  | {
      transport: 'stdio'
      enabled: boolean
      agentProfileIds: string[]
      command: string
      args: string[]
      cwd: string | null
      env: Record<string, McpEditableValue>
      missingValues: string[]
    }
  | {
      transport: 'streamable_http'
      enabled: boolean
      agentProfileIds: string[]
      url: string
      headers: Record<string, McpEditableValue>
      missingValues: string[]
    }

export interface McpConfigValueView {
  value: string | null
  hasStoredValue: boolean
  sensitive: boolean
}

export interface McpConfigIssue {
  code: string
  message: string
  field?: string
  line?: number
  column?: number
}

export type McpServerView =
  | {
      transport: 'stdio'
      name: string
      enabled: boolean
      agentProfileIds: string[]
      command: string
      args: string[]
      cwd: string | null
      env: Record<string, McpConfigValueView>
      missingValues: string[]
      issues: McpConfigIssue[]
    }
  | {
      transport: 'streamable_http'
      name: string
      enabled: boolean
      agentProfileIds: string[]
      url: string
      headers: Record<string, McpConfigValueView>
      missingValues: string[]
      issues: McpConfigIssue[]
    }

export interface McpConfigView {
  path: string
  exists: boolean
  configDigest: string
  servers: McpServerView[]
  fileIssue?: McpConfigIssue
  permissionIssue: boolean
}

export type McpMutationResult =
  | { status: 'ok'; configDigest: string; config: McpConfigView }
  | { status: 'conflict'; actualConfigDigest: string }
  | { status: 'invalid'; issues: McpConfigIssue[] }

export interface CreateMcpServerParams {
  expectedConfigDigest: string
  name: string
  definition: McpServerInput
}

export interface UpdateMcpServerParams {
  expectedConfigDigest: string
  name: string
  newName: string
  definition: McpServerInput
}

export interface SetMcpServerEnabledParams {
  expectedConfigDigest: string
  name: string
  enabled: boolean
}

export interface DeleteMcpServerParams {
  expectedConfigDigest: string
  name: string
}

export type McpImportSourceKind =
  | 'codex'
  | 'claude_code'
  | 'opencode'
  | 'copilot'
  | 'antigravity'
  | 'cursor'

export interface McpImportIssue {
  code: string
  message: string
  field: string | null
  blocking: boolean
  requiresConfirmation: boolean
}

export interface McpImportCandidate {
  candidateId: string
  sourceKind: McpImportSourceKind
  sourcePath: string
  sourceName: string
  proposedName: string
  normalizedDefinition: McpServerInput | null
  sourceEnabled: boolean | null
  compatibility: 'portable' | 'needs_input' | 'unsupported'
  issues: McpImportIssue[]
  conflict: 'none' | 'same' | 'name_conflict' | 'duplicate_definition'
}

export interface McpImportSourceView {
  sourceKind: McpImportSourceKind
  sourcePath: string
  status: 'missing' | 'loaded' | 'invalid'
  candidateCount: number
  issue: McpImportIssue | null
}

export interface McpImportInspection {
  configDigest: string
  sources: McpImportSourceView[]
  candidates: McpImportCandidate[]
}

export interface McpImportSelection {
  candidateId: string
  action: 'create' | 'replace'
  name: string
  definition: McpServerInput
  acceptAllTools: boolean
  hasNonportableToolFilter: boolean
  hasBlockingIssues: boolean
}

export interface CommitMcpImportParams {
  expectedConfigDigest: string
  selections: McpImportSelection[]
}

export interface RestartNativeSessionCommand {
  conversationId: string
  expectedVersion: number
}

export type MemoryScopeKind = 'hearth' | 'companion' | 'relationship'
export type MemoryKind = 'preference' | 'agreement' | 'lesson'
export type MemoryDirection = 'mutual' | 'directed'
export type MemoryLifecycle = 'active' | 'retired' | 'forgotten'
export type MemoryCreationOrigin = 'user' | 'agent' | 'accepted_hearth_proposal'
export type MemoryRevisionActorKind = 'user' | 'agent'

export interface MemoryRevision {
  id: string
  body: string | null
  bodyUtf8Bytes: number | null
  retrievalKeys: string[]
  actorKind: MemoryRevisionActorKind | null
  actorId: string | null
  sourceCampId: string | null
  sourceAgentRunId: string | null
  sourceExecutionEpoch: number | null
  createdFromHearthProposalId: string | null
  createdAt: string
  clearedAt: string | null
}

export interface MemoryRecord {
  id: string
  scope: MemoryScopeKind | null
  kind: MemoryKind | null
  creationOrigin: MemoryCreationOrigin | null
  companionAgentProfileId: string | null
  relationshipAgentProfileIds: string[]
  direction: MemoryDirection | null
  directedActorAgentProfileId: string | null
  lifecycle: MemoryLifecycle
  currentRevisionId: string | null
  currentBody: string | null
  currentBodyUtf8Bytes: number | null
  currentRetrievalKeys: string[]
  reviewAfter: string | null
  reviewDue: boolean
  outgoingSuccessorIds: string[]
  incomingPredecessorIds: string[]
  version: number
  createdAt: string
  updatedAt: string
  retiredAt: string | null
  forgottenAt: string | null
  revisions: MemoryRevision[]
}

export interface MemoryCapacity {
  scope: MemoryScopeKind
  scopeKey: string
  activeCount: number
  maxCount: number
  agentOriginCount: number
  agentOriginMaxCount: number
}

export interface MemoryLibraryView {
  memories: MemoryRecord[]
  capacities: MemoryCapacity[]
}

export interface MemorySettings {
  agentMemoryWritesEnabled: boolean
  version: number
  updatedAt: string
}

export interface HearthMemoryProposal {
  id: string
  action: 'add' | 'revise'
  status: 'pending' | 'accepted' | 'rejected'
  kind: MemoryKind | null
  body: string | null
  retrievalKeys: string[]
  targetMemoryId: string | null
  baseRevisionId: string | null
  proposedByAgentProfileId: string
  sourceCampId: string
  sourceAgentRunId: string
  sourceExecutionEpoch: number
  sourceUnavailable: boolean
  stale: boolean
  acceptedMemoryId: string | null
  acceptedRevisionId: string | null
  resolvedByUserId: string | null
  version: number
  proposedAt: string
  resolvedAt: string | null
}

export interface CreateMemoryCommand {
  scope: MemoryScopeKind
  kind: MemoryKind
  body: string
  retrievalKeys: string[]
  companionAgentProfileId: string | null
  relationshipAgentProfileIds: string[]
  direction: MemoryDirection | null
  directedActorAgentProfileId: string | null
  reviewAfter: string | null
}

export interface ReviseMemoryCommand {
  memoryId: string
  expectedVersion: number
  baseRevisionId: string
  body: string
  retrievalKeys: string[]
  reviewAfter: string | null
}

export interface MemoryVersionCommand {
  memoryId: string
  expectedVersion: number
}

export interface SetMemorySettingsCommand {
  expectedVersion: number
  agentMemoryWritesEnabled: boolean
}

export interface ScheduleMemoryReviewCommand extends MemoryVersionCommand {
  reviewAfter: string | null
}

export interface AcceptHearthMemoryProposalCommand {
  proposalId: string
  expectedVersion: number
  finalKind: MemoryKind | null
  finalBody: string | null
  finalRetrievalKeys: string[] | null
}

export interface RejectHearthMemoryProposalCommand {
  proposalId: string
  expectedVersion: number
}

export interface RejectHearthMemoryProposalsCommand {
  proposals: Array<{ proposalId: string; expectedVersion: number }>
}

export type CoreMethod =
  | 'health.check'
  | 'runtime.discovery.rescan'
  | 'runtime.product.check'
  | 'runtime.pendingExecution.cancel'
  | 'agents.list'
  | 'agents.get'
  | 'agents.memberships.list'
  | 'agents.create'
  | 'agents.update'
  | 'agents.runtime.set'
  | 'agents.runtime.clear'
  | 'agents.presence.set'
  | 'agents.removalPreview'
  | 'agents.remove'
  | 'agents.reorder'
  | 'memory.list'
  | 'memory.get'
  | 'memory.settings.get'
  | 'memory.settings.set'
  | 'memory.create'
  | 'memory.revise'
  | 'memory.retire'
  | 'memory.reactivate'
  | 'memory.forget'
  | 'memory.supersede'
  | 'memory.review.schedule'
  | 'memory.hearthProposals.list'
  | 'memory.hearthProposals.accept'
  | 'memory.hearthProposals.reject'
  | 'memory.hearthProposals.rejectBatch'
  | 'memory.export'
  | 'campMembers.memoryWrite.set'
  | 'runtime.installations.list'
  | 'runtime.installations.create'
  | 'runtime.installations.update'
  | 'runtime.installations.refresh'
  | 'context.summaryModel.get'
  | 'context.summaryModel.set'
  | 'skills.list'
  | 'skills.get'
  | 'skills.import.inspect'
  | 'skills.import.commit'
  | 'skills.setEnabled'
  | 'skills.delete'
  | 'skills.projections.listIssues'
  | 'skills.reconcile'
  | 'skills.revealLocation'
  | 'mcp.config.get'
  | 'mcp.config.repairPermissions'
  | 'mcp.servers.create'
  | 'mcp.servers.update'
  | 'mcp.servers.setEnabled'
  | 'mcp.servers.delete'
  | 'mcp.import.scan'
  | 'mcp.import.commit'
  | 'conversations.restartNativeSession'
  | 'app.info'
  | 'camps.creationPreflight'
  | 'workspaces.inspect'
  | 'navigation.snapshot'
  | 'navigation.groupCamps'
  | 'navigation.campViewed'
  | 'camps.create'
  | 'camps.rename'
  | 'camps.changeDefaultLead'
  | 'camps.reconcileDefaultLead'
  | 'camps.delete'
  | 'campTurns.cancel'
  | 'camps.snapshot'
  | 'agentRunEvidence.getContent'
  | 'tasks.create'
  | 'tasks.update'
  | 'tasks.list'
  | 'tasks.get'
  | 'camp.messages.send'
  | 'action.approvals.resolve'
  | 'events.subscribe'
  | 'diagnostics.export'

export interface RovaiApi {
  request<T>(method: CoreMethod, params?: unknown): Promise<T>
  onEvent(listener: (event: CoreEvent) => void): () => void
  appearance: AppearanceApi
  memberAvatars: MemberAvatarsApi
  selectWorkspaceDirectory(): Promise<WorkspaceInspection | null>
  selectRuntimeExecutable(): Promise<string | null>
  selectSkillImportDirectory(): Promise<string | null>
  revealSkill(skillId: string): Promise<void>
  revealMcpConfig(): Promise<void>
  exportMemory(): Promise<string | null>
  exportDiagnostics(): Promise<string | null>
  platform: NodeJS.Platform
}
