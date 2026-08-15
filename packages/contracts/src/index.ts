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
  | 'trae-cn-cli'
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
    | 'installed_unverified'
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
  memberRuntimeDefaults: MemberRuntimeConfiguration | null
  lastProbeAttempt: AdapterProbeAttempt | null
  relocationHistory: AdapterRelocationAudit[]
  createdAt: string
  updatedAt: string
}

export interface MemberCampMembership {
  campId: string
  projectPath: string
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

export interface MemberRuntimeConfiguration {
  adapterKind: AdapterKind
  model: ModelSelection
  permissions: AdapterPermissionConfig
}

export type RuntimeReadinessStatus =
  | 'runtime_not_configured'
  | 'needs_attention'
  | 'installed_unverified'
  | 'ready'

export type MemberPresence = 'present' | 'away' | 'removed'

export interface AgentProfile {
  agentId: string
  displayName: string
  avatarRef: string | null
  accent: string | null
  teamRole: string
  professionalResponsibilities: string
  personalityTraits: string[]
  workingPrinciples: string
  growthTopic: string
  defaultCapabilities: string[]
  presence: MemberPresence
  runtimeConfiguration: MemberRuntimeConfiguration | null
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

export interface AgentProfileIdentityInput {
  displayName: string
  teamRole: string
  professionalResponsibilities: string
  personalityTraits: string[]
  workingPrinciples: string
  growthTopic: string
}

export interface CreateAgentProfileCommand extends AgentProfileIdentityInput {
  avatarRef?: string | null
}

export interface UpdateAgentProfileCommand extends AgentProfileIdentityInput {
  agentId: string
  expectedVersion: number
}

export interface SetAgentProfileAvatarCommand {
  agentId: string
  expectedVersion: number
  avatarRef: string | null
}

export interface SetMemberRuntimeConfigurationCommand {
  agentId: string
  expectedVersion: number
  adapterKind: AdapterKind
  model: ModelSelection
  permissions: AdapterPermissionConfig
}

export interface ClearMemberRuntimeConfigurationCommand {
  agentId: string
  expectedVersion: number
}

export interface SetMemberPresenceCommand {
  agentId: string
  expectedVersion: number
  presence: 'present' | 'away'
}

export interface RemoveMemberCommand {
  agentId: string
  expectedVersion: number
  confirmationName: string
}

export interface MemberRemovalPreview {
  agentId: string
  displayName: string
  version: number
  nonTerminalAgentRunCount: number
  currentCampMembershipCount: number
  openAssignedTaskCount: number
  defaultLeadCampCount: number
  removable: boolean
}

export interface ReorderAgentProfilesCommand {
  orderedAgentIds: string[]
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
  | 'installed_unverified'
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
  checking: boolean
  discovery: RuntimeDiscoveryObservation
  installationId: string | null
  reportedVersion: string | null
  diagnosticCode: string | null
  lastAttemptedAt?: string | null
  lastSuccessfulProbeAt?: string | null
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

export type DiagnosticStatus = 'ok' | 'attention' | 'unknown'
export type DiagnosticGroup = 'local_dependencies' | 'managed_content' | 'agent_runtimes'

export interface DiagnosticFact {
  key: string
  value: string
}

export interface DiagnosticCheck {
  id: string
  group: DiagnosticGroup
  subjectKind: string
  subjectId: string | null
  label: string
  status: DiagnosticStatus
  code: string
  detail: string
  observedAt: string
  stale: boolean
  facts: DiagnosticFact[]
}

export interface DiagnosticSummary {
  ok: number
  attention: number
  unknown: number
}

export interface DiagnosticsReport {
  schemaVersion: 1
  checkedAt: string
  summary: DiagnosticSummary
  checks: DiagnosticCheck[]
}

export type StartPreflightBlockerCode =
  | 'runtime_not_configured'
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

export type ProjectBindingKind = 'quick_chat' | 'directory'
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

export interface WorkspaceSelection {
  name: string
  projectPath: string
}

export interface WorkspaceInspection extends WorkspaceSelection {
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
    agentId: string
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

export type CampCollaborationMode = 'peer' | 'lead_coordinated'
export type CampActivationState = 'pending' | 'active'

export interface CreateCampRequest {
  commandId: string
  name: string | null
  workspace: { projectPath: string } | null
  memberAgentIds: string[]
  defaultLeadAgentId: string
  collaborationMode: CampCollaborationMode
  activationState: CampActivationState
}

export interface CampCreationPreflight {
  admissible: boolean
  presentMembers: Array<{
    agentId: string
    displayName: string
    memberOrder: number
    runtimeConfigured: boolean
    runtimeReadiness: RuntimeReadinessStatus
  }>
  initialLeadAgentId: string | null
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

export interface DiscardPendingCampCommand {
  campId: string
}

export interface CancelCampTurnCommand {
  campId: string
  campTurnId: string
  expectedVersion: number
}

export type NavigationCampMarker = 'loading' | 'unread_completed' | 'none'

export interface NavigationCampItem {
  id: string
  title: string
  activationState: CampActivationState
  projectBindingKind: ProjectBindingKind
  projectPath: string
  defaultLead: { agentId: string; displayName: string } | null
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
  schemaVersion: 3
  throughGlobalSequence: number
  quickChat: NavigationCampGroup
  projects: ProjectNavigationGroup[]
}

export interface NavigationCampPage {
  schemaVersion: 3
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
  agentId: string
  displayName: string
  avatarRef: string | null
  teamRole: string
  accent: string
  membershipStatus: 'active' | 'left'
  leaveRequestedAt: string | null
  profilePresence: MemberPresence
  memberOrder: number
  isDefaultLead: boolean
  version: number
}

export interface TaskView {
  taskId: string
  campId: string
  title: string
  description: string
  acceptanceCriteria: string[]
  status: 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled'
  assigneeAgentId: string | null
  blockedReason: string | null
  completionSummary: string | null
  cancelReason: string | null
  createdByType: 'user' | 'agent'
  createdById: string
  sourceAgentRunId: string | null
  closedByType: 'user' | 'agent' | null
  closedById: string | null
  closedByAgentRunId: string | null
  version: number
  createdAt: string
  updatedAt: string
  closedAt: string | null
  availableActions: Array<'update'>
}

export interface TaskListItem {
  taskId: string
  title: string
  status: TaskView['status']
  assigneeAgentId: string | null
  availableActions: Array<'update'>
}

export interface TaskListPage {
  tasks: TaskListItem[]
  nextCursor: string | null
  truncated: boolean
}

export type TaskStatus = TaskView['status']

export type TaskAssigneePatch =
  | { operation: 'unchanged' }
  | { operation: 'assign'; agentId: string }
  | { operation: 'clear' }

export type TaskAcceptanceCriteriaPatch =
  | { operation: 'unchanged' }
  | { operation: 'replace'; items: string[] }
  | { operation: 'clear' }

export type StructuredCampMessageSegment =
  | { kind: 'text'; text: string }
  | { kind: 'member_mention'; agentId: string }
  | { kind: 'all_members_mention' }
  | { kind: 'current_user_mention'; userId: 'local_user' }

export type StructuredCampMessageContent = StructuredCampMessageSegment[]

export interface CampMessageView {
  id: string
  sequence: number
  timelineGlobalSequence: number | null
  authorType: 'user' | 'agent' | 'system'
  authorId: string
  sourceAgentRunId: string | null
  body: string
  content: StructuredCampMessageContent
  attachments: CampMessageAttachmentView[]
  addressMode: 'default' | 'explicit' | 'broadcast'
  addressedAgentIds: string[]
  replyToCampMessageId: string | null
  campTurnId: string | null
  presentation: CampTimelinePresentation | null
  createdAt: string
}

export interface CampMessageAttachmentView {
  id: string
  displayName: string
  kind: 'file' | 'directory'
  fileCount: number
  mediaType: string
  byteSize: number
  previewKind: 'image' | 'none'
}

export interface PreparedAttachmentView extends CampMessageAttachmentView {
  state: 'ready' | 'error'
  errorMessage: string | null
  createdAt: string
}

export interface CampComposerDraftView {
  campId: string
  body: string
  content: StructuredCampMessageContent
  revision: number
  attachments: PreparedAttachmentView[]
  replyIntent: CampComposerReplyIntentView | null
  continuationIntent: CampComposerContinuationIntentView | null
  updatedAt: string | null
  expiresAt: string | null
}

export interface CampComposerContinuationIntentView {
  sourceCampMessageId: string
  recipient: {
    agentId: string
    displayName: string
    recipientAvailability: 'available' | 'unavailable'
  }
  recipientSelectionRequired: boolean
}

export interface CampComposerReplyIntentView {
  replyToCampMessageId: string
  targetState: 'available' | 'message_unavailable'
  author: {
    authorType: 'user' | 'agent' | 'system'
    authorId: string
    displayName: string
    recipientAvailability: 'available' | 'unavailable' | 'not_applicable'
  } | null
  excerpt: string | null
  recipientSelectionRequired: boolean
}

export type CampComposerReplyRecipient =
  | { kind: 'member'; agentId: string }
  | { kind: 'all_members' }

export interface AttachmentPreview {
  mediaType: string
  bytes: Uint8Array
}

export type CampTimelinePresentation =
  | {
      kind: 'task_event'
      taskId: string
      titleAtEvent: string
      fromStatus: TaskStatus | null
      toStatus: TaskStatus
      assigneeNameAtEvent: string | null
      occurredAt: string
    }

export interface CampTurnView {
  id: string
  triggerType: 'camp_message' | 'system_event'
  triggerId: string
  status: 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled'
  cancelRequestedAt: string | null
  aggregateReasonCode: 'required_run_incomplete' | null
  executionBudget: CampTurnExecutionBudgetView
  version: number
  createdAt: string
  updatedAt: string
  endedAt: string | null
}

export interface CampTurnExecutionBudgetView {
  schemaVersion: 1
  acceptedAt: string
  deadlineAt: string
  elapsedSeconds: number
  maxAgentRunResponsibilities: number
  maxAcceptedA2a: number
  allocatedAgentRunResponsibilities: number
  acceptedA2a: number
  exhaustedAt: string | null
  exhaustionReason: 'elapsed' | 'agent_run_responsibilities' | 'accepted_a2a' | null
  exhaustionCommandId: string | null
}

export interface AgentRunView {
  id: string
  campTurnId: string
  conversationId: string
  agentId: string
  taskId: string | null
  responsibilityKey: string
  responsibilityGeneration: number
  purpose: string
  completionRole: 'required' | 'optional'
  status: 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled'
  waitReason: string | null
  terminalResolutionSource: 'runtime_terminal' | null
  terminalReasonCode:
    | 'planned_shutdown_completed'
    | 'planned_shutdown_failed'
    | 'planned_shutdown_cancelled'
    | null
  executionEpoch: number
  permissionSemantics: 'core_enforced_v1' | 'runtime_managed_v2'
  invocationKind: 'direct' | 'a2a' | 'gather_completion'
  triggerDeliveryGeneration: number
  a2aParentAgentRunId: string | null
  a2aRootAgentRunId: string | null
  a2aDepth: number
  executionEvidenceCount: number
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

export interface CanonicalRuntimeActivityView {
  operationId: string
  activityDomain: string
  semanticKind: string | null
  toolName: string | null
  presentationHint: string | null
  phase: 'started' | 'progress' | 'terminal'
  outcome: 'succeeded' | 'failed' | 'denied' | 'cancelled' | 'not_executed' | 'unsettled' | 'unknown'
  credibility: 'core_verified' | 'runtime_structured' | 'runtime_reported' | 'unknown' | string
  coverageLevel: 'fine_grained' | 'run_level' | 'unknown'
  sourceAuthority: 'core' | 'runtime' | string
  sourceEvidenceIds: string[]
  classifierVersion: string
  firstEvidenceSequence: number
  lastEvidenceSequence: number
  revision: number
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
  canonical?: CanonicalRuntimeActivityView | null
}

export interface AgentRunExecutionEvidencePage {
  schemaVersion: 1
  agentRunId: string
  requestedAfterSequence: number
  nextAfterSequence: number
  throughSequence: number
  hasMore: boolean
  evidence: AgentRunExecutionEvidenceView[]
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
  bootstrapRedeliveryPresent: boolean
  bootstrapRedeliveryRevision: number | null
  bootstrapRedeliveryEvidenceId: string | null
  bootstrapRedeliveryEnvelopeVersion: 2 | null
  bootstrapRedeliveryFormatterVersion: 2 | null
}

export interface SkillExposureEntry {
  skillId: string
  name: string
  revisionId: string
  contentDigest: string
  groupKey: SkillDeliveryGroupKey
  deliveredViaGroupKey: SkillDeliveryGroupKey | null
  status: 'ready' | 'stale' | 'shadowed' | 'error'
  entryPath: string | null
  reasonCode: string | null
  conflictStatuses: string[]
}

export interface SkillExposureSnapshot {
  schemaVersion: 2
  skills: SkillExposureEntry[]
}

export interface McpExposureEntry {
  serverId: string
  name: string
  runtimeName: string
  transport: 'stdio' | 'streamable_http'
  configDigest: string
  status:
    | 'ready'
    | 'skipped_native_name_conflict'
    | 'disabled'
    | 'unassigned'
    | 'adapter_unsupported'
    | 'missing_environment'
    | 'invalid'
  reason: string | null
}

export interface McpExposureSnapshot {
  schemaVersion: 2
  configDigest: string
  configStatus: 'ready' | 'invalid'
  projectionMode: 'additive_per_run' | 'unsupported'
  sameNamePolicy: 'native_wins_skip' | 'rovai_wins' | null
  warnings: string[]
  servers: McpExposureEntry[]
}

export interface NativeSessionBootstrapEvidenceView {
  id: string
  conversationId: string
  nativeBindingId: string
  nativeBindingGeneration: number
  contractVersion: 'native_session_bootstrap_v3'
  bootstrapFormatterVersion: 3
  sessionCharterDigest: string
  memoryEntrypointDigest: string
  observedMemoryRevisions: unknown[]
  authorizationBasisDigest: string
  deliveryMode: 'native_append' | 'first_payload'
  createdAt: string
}

export interface CampAttachmentRefView {
  attachmentId: string
  path: string
  contentDigest: string
}

export interface RunNoticeRefView {
  code: string
  taskId?: string
}

export interface ContextManifestView {
  id: string
  agentRunId: string
  bootstrap: NativeSessionBootstrapEvidenceView
  nativeBindingGeneration: number
  campMessageBoundarySequence: number
  conversationMessageBoundarySequence: number
  historyFenceVersion: number
  globalPublicMessageBoundary: number
  historyCamps: ContextManifestHistoryCampView[]
  rawMessageCount: number
  previousAcceptedPublicBoundarySequence: number
  contextDeliveryProfileVersion: 3
  contextDeliveryProfile: {
    profileVersion: 3
    maxPublicMessages: number
    maxPublicHistoryChars: number
    maxMessageBodyChars: number
    maxPublicReferenceChainMessages: number
    maxSelfActiveTasks: number
  }
  contextDeliveryProfileDigest: string
  originatingPublicUserMessageRef: unknown | null
  recentMessageCount: number
  omittedMessageCount: number | null
  omittedMessageSequenceStart: number | null
  omittedMessageSequenceEnd: number | null
  omissionEntries: unknown[]
  collaborationStateDigest: string
  collaborationStateIncluded: boolean
  sharedMessageEvidence: unknown[]
  sharedMessageEvidenceDigest: string
  runNoticeRefs: RunNoticeRefView[]
  runNoticePayload: unknown
  runNoticeDigest: string
  currentInputSource: unknown
  attachmentRefs: CampAttachmentRefView[]
  attachmentDigest: string
  skillExposure: SkillExposureSnapshot
  skillExposureDigest: string
  mcpExposure: McpExposureSnapshot
  mcpExposureDigest: string
  mcpProjectionDigest: string
  selfActiveTaskEvidence: unknown
  selfActiveTaskEvidenceDigest: string
  formatterVersion: 15
  renderedPayloadDigest: string
  delivery: RuntimeInputDeliveryView | null
  createdAt: string
}

export interface ContextManifestHistoryCampView {
  campId: string
  campTitle: string
  lastVisibleActivityAt: string
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
  agentId: string
  adapterKind: AdapterKind | 'unknown'
  nativeMethod: string | null
  requestDigest: string | null
  permissionSemantics: 'core_enforced_v1' | 'runtime_managed_v2'
  options: RuntimePermissionOptionView[]
  status: 'pending' | 'approved' | 'denied' | 'cancelled' | 'expired'
  requestedForUserId: string
  resolvedByType: 'user' | 'system' | null
  resolvedById: string | null
  resolutionCode: string | null
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
  schemaVersion: 29
  throughGlobalSequence: number
  camp: {
    id: string
    title: string
    activationState: CampActivationState
    projectBindingKind: ProjectBindingKind
    projectPath: string
    defaultLeadAgentId: string | null
    version: number
    createdAt: string
    updatedAt: string
  }
  members: CampMemberView[]
  tasks: TaskView[]
  messages: CampMessageView[]
  messageDeliveries: MessageDeliveryView[]
  turns: CampTurnView[]
  agentRuns: AgentRunView[]
  executionEvidence: AgentRunExecutionEvidenceView[]
  contextManifests: ContextManifestView[]
  approvals: ActionApprovalView[]
  actions: ActionView[]
  timeline: DomainEventView[]
}

export interface CampOpenCollectionCoverage {
  loadedCount: number
  totalCount: number
  omittedCount: number
  complete: boolean
}

export interface CampOpenMessageCoverage extends CampOpenCollectionCoverage {
  oldestLoadedSequence: number | null
  newestLoadedSequence: number | null
  hasEarlier: boolean
}

export interface CampOpenProjection {
  schemaVersion: 1
  throughGlobalSequence: number
  camp: CampSnapshot['camp']
  members: CampMemberView[]
  tasks: TaskView[]
  messages: CampMessageView[]
  messageDeliveries: MessageDeliveryView[]
  turns: CampTurnView[]
  agentRuns: AgentRunView[]
  executionEvidence: AgentRunExecutionEvidenceView[]
  approvals: ActionApprovalView[]
  timeline: DomainEventView[]
  coverage: {
    tasks: CampOpenCollectionCoverage
    messages: CampOpenMessageCoverage
    messageDeliveries: CampOpenCollectionCoverage
    turns: CampOpenCollectionCoverage
    agentRuns: CampOpenCollectionCoverage
    executionEvidence: CampOpenCollectionCoverage
    approvals: CampOpenCollectionCoverage
    timeline: CampOpenCollectionCoverage
  }
}

export interface CampMessagePage {
  schemaVersion: 1
  campId: string
  throughGlobalSequence: number
  requestedBeforeSequence: number
  nextBeforeSequence: number | null
  hasMore: boolean
  messages: CampMessageView[]
}

export interface CampMessageAroundSnapshot {
  schemaVersion: 1
  throughGlobalSequence: number
  campId: string
  anchorMessageId: string
  sourceAvailable: boolean
  messages: CampMessageView[]
}

export interface CampMessageAroundParams {
  campId: string
  messageId: string
}

interface MessageDeliveryBaseView {
  id: string
  messageId: string
  campTurnId: string
  taskId: string | null
  recipientAgentId: string
  status: 'pending' | 'running' | 'settled' | 'failed' | 'cancelled' | 'interrupted_before_dispatch' | string
  dispatchPhase: 'never_attempted' | 'attempting' | 'attempted_waiting' | 'materialized' | 'terminal' | string
  waitCondition: 'target_busy' | 'runtime_unavailable' | 'capacity_unavailable' | null
  dispatchAttemptCount: number
  retryGeneration: number
  contextManifestId: string | null
  targetAgentRunId: string | null
  manualInterventionRequired: boolean
  failureCode: string | null
  version: number
  createdAt: string
  updatedAt: string
  endedAt: string | null
}

export type MessageDeliveryView = MessageDeliveryBaseView & (
  | {
      deliveryKind: 'public_a2a'
      dispatchDisposition: 'dispatch' | 'gather_captured'
      completionRole: 'required' | 'optional' | null
      gatherId: string | null
      gatherDispatchDeliveryId: string | null
      recipientCanonicalPosition: number
      edgeKind: 'forward' | 'return'
      targetParentAgentRunId: string | null
      returnToAgentRunId: string | null
    }
  | {
      deliveryKind: 'gather_completion'
      dispatchDisposition: 'dispatch'
      completionRole: 'required'
      gatherId: string
      targetConversationId: string
    }
)

export interface EventBatch {
  schemaVersion: 9
  requestedAfterGlobalSequence: number
  nextGlobalSequence: number
  throughGlobalSequence: number
  resetRequired: boolean
  hasMore: boolean
  events: DomainEventView[]
}

export type NotificationEpisodeKind = 'collaboration' | 'message' | 'approval'

export type NotificationSemantic =
  | 'approval_pending'
  | 'user_mention'
  | 'turn_completed'
  | 'turn_failed'
  | 'turn_incomplete'

export type NotificationEpisodeFilter = 'all' | 'unread'

export type NotificationReasonState =
  | 'pending'
  | 'resolved'
  | 'unacknowledged'
  | 'acknowledged'
  | 'unsatisfied'
  | 'satisfied'

export type NotificationActionKind =
  | 'open_approval'
  | 'open_camp_message'
  | 'open_camp_turn'
  | 'open_camp'
  | 'acknowledge_only'

export interface NotificationReasonView {
  semantic: NotificationSemantic
  occurrenceCount: number
  unacknowledgedCount: number
  state: NotificationReasonState
}

export interface NotificationMentionView {
  messageId: string
  authorId: string
  authorDisplayName: string | null
  summary: string | null
  available: boolean
}

export interface NotificationActionView {
  actionId: string
  kind: NotificationActionKind
  available: boolean
  campId: string
  campTurnId: string | null
  messageId: string | null
  approvalId: string | null
  acknowledgementId: string | null
  observedEpisodeVersion: number
}

export interface NotificationEpisodeView {
  id: string
  kind: NotificationEpisodeKind
  episodeVersion: number
  attentionRevision: number
  changeSequence: number
  camp: {
    id: string
    title: string
  }
  campTurnId: string | null
  primarySemantic: NotificationSemantic
  unread: boolean
  resolved: boolean
  satisfied: boolean
  pendingApprovalCount: number
  mentionCount: number
  unacknowledgedMentionCount: number
  mention: NotificationMentionView | null
  reasons: NotificationReasonView[]
  primaryAction: NotificationActionView
  secondaryActions: NotificationActionView[]
  createdAt: string
  updatedAt: string
}

export interface NotificationEpisodeInbox {
  schemaVersion: 6
  throughChangeSequence: number
  unreadCount: number
  items: NotificationEpisodeView[]
  nextCursor: string | null
}

export interface NotificationEpisodeChange {
  changeSequence: number
  episodeId: string
  episodeVersion: number
  attentionRevision: number
  operation: 'upsert' | 'remove'
  changeCause:
    | 'occurrence_admitted'
    | 'acknowledged'
    | 'satisfied'
    | 'resolved'
    | 'cleared'
    | 'retained'
  headsUpSignal: NotificationHeadsUpSignal | null
  headsUpInvalidation: NotificationHeadsUpInvalidation | null
  changedAt: string
  episode: NotificationEpisodeView | null
}

export interface NotificationHeadsUpSignal {
  semantic: NotificationSemantic
  admittedAttentionRevision: number
  action: NotificationActionView
  mention: NotificationMentionView | null
}

export type NotificationHeadsUpInvalidation =
  | {
    kind: 'source_state_changed'
    acknowledgementId: string
    throughAttentionRevision: null
  }
  | {
    kind: 'attention_cleared'
    acknowledgementId: null
    throughAttentionRevision: number
  }
  | {
    kind: 'episode_removed'
    acknowledgementId: null
    throughAttentionRevision: null
  }

export interface NotificationEpisodeChangeBatch {
  schemaVersion: 6
  requestedAfterChangeSequence: number
  nextChangeSequence: number
  throughChangeSequence: number
  resetRequired: boolean
  hasMore: boolean
  changes: NotificationEpisodeChange[]
}

export interface NotificationPreference {
  headsUpEnabled: boolean
  approvalHeadsUpEnabled: boolean
  userMentionHeadsUpEnabled: boolean
  turnCompletedHeadsUpEnabled: boolean
  turnIncompleteHeadsUpEnabled: boolean
  version: number
  updatedAt: string
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

export type StartupLocationMode = 'last_location' | 'quick_chat'

export type SettingsSection =
  | 'general'
  | 'skills'
  | 'mcp'
  | 'runtime'
  | 'appearance'
  | 'notifications'
  | 'diagnostics'

export type MemberWorkspaceLocationTab = 'identity' | 'runtime'

export type RestorableLocation =
  | { kind: 'quick_chat' }
  | { kind: 'camp'; campId: string }
  | { kind: 'members'; agentId: string | null; tab: MemberWorkspaceLocationTab }
  | { kind: 'memory' }

export interface NewConversationDefaults {
  memberAgentIds: string[]
  defaultLeadAgentId: string
}

export interface GeneralPreferencesSnapshot {
  schemaVersion: 2
  startupLocationMode: StartupLocationMode
  lastSettingsSection: SettingsSection
  newConversationDefaults: NewConversationDefaults | null
  newConversationDefaultsRequireConfirmation: boolean
  oneClickNewConversationEnabled: boolean
}

export interface DesktopStartupSnapshot {
  schemaVersion: 1
  sessionId: string
  startupLocationMode: StartupLocationMode
  lastSettingsSection: SettingsSection
  restorableLocation: RestorableLocation | null
  restorableLocationStatus: 'valid' | 'missing' | 'invalid'
}

export interface WindowResetCapability {
  canReset: boolean
  reason: 'fullscreen' | null
}

export interface WindowResetResult {
  performed: boolean
  reason: 'fullscreen' | null
}

export interface DesktopSessionApi {
  getStartupSnapshot(): Promise<DesktopStartupSnapshot>
  commitRestorableLocation(location: RestorableLocation): Promise<void>
}

export interface GeneralPreferencesApi {
  get(): Promise<GeneralPreferencesSnapshot>
  setStartupLocationMode(mode: StartupLocationMode): Promise<GeneralPreferencesSnapshot>
  setLastSettingsSection(section: SettingsSection): Promise<GeneralPreferencesSnapshot>
  setNewConversationDefaults(defaults: NewConversationDefaults): Promise<GeneralPreferencesSnapshot>
  setOneClickNewConversationEnabled(enabled: boolean): Promise<GeneralPreferencesSnapshot>
  invalidateNewConversationDefaults(): Promise<GeneralPreferencesSnapshot>
}

export interface WindowControlsApi {
  getResetCapability(): Promise<WindowResetCapability>
  resetBounds(): Promise<WindowResetResult>
}

export interface NavigationPin {
  kind: 'camp' | 'project'
  targetKey: string
  pinnedAt: string
}

export interface RemovedNavigationProject {
  targetKey: string
  removedAt: string
}

export interface NavigationPreferencesSnapshot {
  schemaVersion: 2
  pins: NavigationPin[]
  removedProjects: RemovedNavigationProject[]
}

export interface NavigationPreferencesApi {
  get(): Promise<NavigationPreferencesSnapshot>
  replacePins(pins: NavigationPin[]): Promise<NavigationPreferencesSnapshot>
  removeProject(targetKey: string, relatedCampIds: string[]): Promise<NavigationPreferencesSnapshot>
  restoreProject(targetKey: string): Promise<NavigationPreferencesSnapshot>
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

export type SkillOrigin = 'official' | 'imported'
export type SkillRevisionSourceType = 'bundled' | 'local_folder' | 'github'
export type SkillDeliveryGroupKey =
  | 'codex'
  | 'opencode'
  | 'copilot'
  | 'claude_compatible'
  | 'antigravity'
  | 'kiro'
  | 'qoder'
  | 'codebuddy'
  | 'qwen'

export interface SkillRiskSummary {
  executableFileCount: number
  scriptFileCount: number
  binaryCandidateCount: number
  declaredTools: string[]
}

export interface SkillRevisionView {
  id: string
  skillId: string
  revision: number
  name: string
  description: string
  sourceType: SkillRevisionSourceType
  contentDigest: string
  sourceMetadata: unknown
  riskSummary: SkillRiskSummary
  fileCount: number
  totalBytes: number
  installedAt: string
}

export interface SkillGroupAssignmentView {
  groupKey: SkillDeliveryGroupKey
  revisionId: string
  createdAt: string
  updatedAt: string
}

export interface SkillDeliveryGroupMemberView {
  agentId: string
  displayName: string
  avatarRef: string | null
  accent: string | null
}

export interface SkillDeliveryGroupView {
  key: SkillDeliveryGroupKey
  label: string
  relativePath: string
  adapterKinds: AdapterKind[]
  verification: 'verified' | 'documentation_only'
  members: SkillDeliveryGroupMemberView[]
}

export interface SkillView {
  id: string
  name: string
  origin: SkillOrigin
  managementPolicy: 'user_managed' | 'system_required'
  enabled: boolean
  lifecycleStatus: 'active' | 'deleting'
  currentRevision: SkillRevisionView
  groupAssignments: SkillGroupAssignmentView[]
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
  existingOrigin: SkillOrigin | null
  importAction: 'create' | 'update' | 'unchanged' | 'official_conflict'
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
  groupKey: SkillDeliveryGroupKey
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

export interface SetSkillGroupAssignmentsCommand {
  skillId: string
  expectedVersion: number
  groupKeys: SkillDeliveryGroupKey[]
}

export interface InspectGithubSkillImportParams {
  repositoryUrl: string
  subdirectory?: string | null
  gitRef?: string | null
}

export interface DeleteSkillCommand {
  skillId: string
  expectedVersion: number
}

export interface McpConfigIssue {
  code: string
  message: string
  field?: string
  line?: number
  column?: number
}

export interface McpServerView {
  serverId: string
  name: string
  transport: 'stdio' | 'streamable_http'
  endpoint: string
  enabled: boolean
  assignedAgentIds: string[]
  source: 'builtin' | 'user' | 'import'
  presetId: string | null
  riskLevel: 'standard' | 'high'
  riskAcknowledged: boolean
  definitionJson: string
}

export interface McpConfigView {
  path: string
  exists: boolean
  configDigest: string
  publicConfigJson: string
  servers: McpServerView[]
  fileIssue?: McpConfigIssue
  permissionIssue: boolean
}

export type McpMutationResult =
  | { status: 'ok'; configDigest: string; config: McpConfigView }
  | { status: 'conflict'; actualConfigDigest: string }
  | { status: 'invalid'; issues: McpConfigIssue[] }
  | { status: 'risk_acknowledgement_required'; serverId: string }

export interface CreateMcpServerParams {
  expectedConfigDigest: string
  definitionJson: string
}

export interface UpdateMcpServerParams {
  expectedConfigDigest: string
  serverId: string
  definitionJson: string
}

export interface SetMcpServerEnabledParams {
  expectedConfigDigest: string
  serverId: string
  enabled: boolean
  acknowledgeHighRisk?: boolean
}

export interface SetMcpAssignmentParams {
  expectedConfigDigest: string
  serverId: string
  agentId: string
  assigned: boolean
  acknowledgeHighRisk?: boolean
}

export interface DeleteMcpServerParams {
  expectedConfigDigest: string
  serverId: string
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
  kind: 'normalized' | 'dropped' | 'sensitive_value' | 'blocker'
  blocking: boolean
}

export interface McpImportCandidate {
  candidateId: string
  sourceKind: McpImportSourceKind
  sourcePath: string
  sourceName: string
  proposedName: string
  sourceDefinitionJson: string
  normalizedDefinitionJson: string | null
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
  replaceServerId?: string
  definitionJson: string
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
export type MemoryCreationOrigin = 'user' | 'agent' | 'accepted_hearth_review'
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
  createdFromHearthReviewItemId: string | null
  createdAt: string
  clearedAt: string | null
}

export interface MemoryRecord {
  id: string
  scope: MemoryScopeKind | null
  kind: MemoryKind | null
  creationOrigin: MemoryCreationOrigin | null
  companionAgentId: string | null
  relationshipAgentIds: string[]
  direction: MemoryDirection | null
  directedActorAgentId: string | null
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
  activeBodyBytes: number
  maxBodyBytes: number | null
  agentOriginCount: number
  agentOriginMaxCount: number
}

export interface MemoryLibraryView {
  memories: MemoryRecord[]
  capacities: MemoryCapacity[]
}

export type HearthReviewItemStatus = 'pending' | 'accepted' | 'rejected' | 'invalidated'
export type HearthReviewInvalidationReason = 'target_forgotten' | 'exact_candidate_published'

export interface HearthReviewItem {
  reviewItemId: string
  requestedAction: 'add' | 'revise'
  status: HearthReviewItemStatus
  stale: boolean
  version: number
  candidateKind: MemoryKind | null
  candidateBody: string | null
  candidateRetrievalKeys: string[] | null
  targetMemoryId: string | null
  baseRevisionId: string | null
  sourceAgentId: string
  sourceCampId: string
  sourceAgentRunId: string
  sourceExecutionEpoch: number
  acceptedMemoryId: string | null
  acceptedRevisionId: string | null
  resolvedByUserId: string | null
  invalidationReason: HearthReviewInvalidationReason | null
  editedBeforeAcceptance: boolean | null
  createdAt: string
  resolvedAt: string | null
}

export interface CreateMemoryCommand {
  scope: MemoryScopeKind
  kind: MemoryKind
  body: string
  retrievalKeys: string[]
  companionAgentId: string | null
  relationshipAgentIds: string[]
  direction: MemoryDirection | null
  directedActorAgentId: string | null
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

export interface ScheduleMemoryReviewCommand extends MemoryVersionCommand {
  reviewAfter: string | null
}

export interface AcceptHearthReviewItemCommand {
  reviewItemId: string
  expectedReviewItemVersion: number
  finalBody?: string
  finalRetrievalKeys?: string[]
}

export interface RejectHearthReviewItemCommand {
  reviewItemId: string
  expectedReviewItemVersion: number
}

export type CoreMethod =
  | 'health.check'
  | 'diagnostics.check'
  | 'runtime.discovery.rescan'
  | 'runtime.product.ensure'
  | 'runtime.product.check'
  | 'runtime.pendingExecution.cancel'
  | 'members.list'
  | 'members.get'
  | 'members.camps.list'
  | 'members.create'
  | 'members.update'
  | 'members.avatar.set'
  | 'members.runtime.set'
  | 'members.runtime.clear'
  | 'members.presence.set'
  | 'members.removalPreview'
  | 'members.remove'
  | 'members.reorder'
  | 'memory.list'
  | 'memory.get'
  | 'memory.create'
  | 'memory.revise'
  | 'memory.retire'
  | 'memory.reactivate'
  | 'memory.forget'
  | 'memory.supersede'
  | 'memory.review.schedule'
  | 'memory.hearthReviewItems.list'
  | 'memory.hearthReviewItems.accept'
  | 'memory.hearthReviewItems.reject'
  | 'memory.export'
  | 'runtime.installations.list'
  | 'runtime.installations.create'
  | 'runtime.installations.update'
  | 'runtime.installations.refresh'
  | 'skills.list'
  | 'skills.get'
  | 'skills.deliveryGroups.list'
  | 'skills.import.inspect'
  | 'skills.import.github.inspect'
  | 'skills.import.commit'
  | 'skills.setEnabled'
  | 'skills.setGroupAssignments'
  | 'skills.delete'
  | 'skills.projections.listIssues'
  | 'skills.reconcile'
  | 'skills.projectAccess.sync'
  | 'skills.projectAccess.remove'
  | 'skills.projectAccess.restore'
  | 'skills.revealLocation'
  | 'mcp.config.get'
  | 'mcp.config.repairPermissions'
  | 'mcp.servers.create'
  | 'mcp.servers.update'
  | 'mcp.servers.setEnabled'
  | 'mcp.assignments.set'
  | 'mcp.servers.delete'
  | 'mcp.import.scan'
  | 'mcp.import.commit'
  | 'conversations.restartNativeSession'
  | 'app.info'
  | 'camps.creationPreflight'
  | 'workspaces.validate'
  | 'workspaces.inspect'
  | 'navigation.snapshot'
  | 'navigation.groupCamps'
  | 'navigation.campViewed'
  | 'camps.create'
  | 'camps.discardPending'
  | 'camps.rename'
  | 'camps.changeDefaultLead'
  | 'camps.reconcileDefaultLead'
  | 'camps.exists'
  | 'camps.enter'
  | 'camps.open'
  | 'camps.delete'
  | 'campTurns.cancel'
  | 'agentRuns.resolveRecoveryBlocker'
  | 'camps.snapshot'
  | 'camp.messages.page'
  | 'camp.messages.around'
  | 'agentRunEvidence.getContent'
  | 'agentRunEvidence.list'
  | 'tasks.create'
  | 'tasks.update'
  | 'tasks.list'
  | 'tasks.get'
  | 'camp.composerDraft.get'
  | 'camp.composerDraft.save'
  | 'camp.composerDraft.startReply'
  | 'camp.composerDraft.cancelReply'
  | 'camp.composerDraft.resolveReplyRecipient'
  | 'camp.composerDraft.dismissContinuation'
  | 'camp.composerDraft.resolveContinuationRecipient'
  | 'camp.composerDraft.removeAttachment'
  | 'camp.composerDraft.discard'
  | 'camp.messages.send'
  | 'action.approvals.resolve'
  | 'notifications.inbox'
  | 'notifications.changesSince'
  | 'notifications.acknowledge'
  | 'notifications.acknowledgeVisibleSources'
  | 'notifications.markAllRead'
  | 'notifications.clear'
  | 'notifications.preference.get'
  | 'notifications.preference.update'
  | 'events.subscribe'
  | 'diagnostics.export'

export interface RovaiApi {
  request<T>(method: CoreMethod, params?: unknown): Promise<T>
  onEvent(listener: (event: CoreEvent) => void): () => void
  appearance: AppearanceApi
  desktopSession: DesktopSessionApi
  generalPreferences: GeneralPreferencesApi
  windowControls: WindowControlsApi
  navigationPreferences: NavigationPreferencesApi
  memberAvatars: MemberAvatarsApi
  composerAttachments: {
    prepare(campId: string, expectedRevision: number, file: File): Promise<CampComposerDraftView>
    preview(attachmentId: string): Promise<AttachmentPreview | null>
  }
  clipboard: {
    write(input: { text: string; html: string | null }): Promise<void>
  }
  selectWorkspaceDirectory(): Promise<WorkspaceSelection | null>
  selectRuntimeExecutable(): Promise<string | null>
  selectSkillImportDirectory(): Promise<string | null>
  revealSkill(skillId: string): Promise<void>
  revealMcpConfig(): Promise<void>
  exportMemory(): Promise<string | null>
  exportDiagnostics(): Promise<string | null>
  revealDiagnosticsExport(path: string): Promise<void>
  platform: NodeJS.Platform
}
