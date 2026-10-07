import type { CurrentUserProfileApi } from './current-user-profile'

import type { BuiltinMemberAvatarRole } from './member-avatar'

export * from './member-avatar'
export * from './current-user-profile'

export const THREAD_ID_PATTERN = /^rvcamp_[0-7][0123456789abcdefghjkmnpqrstvwxyz]{25}$/u

const THREAD_ID_PREFIX_LENGTH = 'rvcamp_'.length
const THREAD_ID_CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz'

export function isThreadId(value: unknown): value is string {
  if (typeof value !== 'string' || !THREAD_ID_PATTERN.test(value)) return false
  let decoded = 0n
  for (const character of value.slice(THREAD_ID_PREFIX_LENGTH)) {
    const digit = THREAD_ID_CROCKFORD.indexOf(character)
    if (digit < 0) return false
    decoded = (decoded << 5n) | BigInt(digit)
  }
  const version = Number((decoded >> 76n) & 0xfn)
  const variant = Number((decoded >> 62n) & 0x3n)
  return version === 7 && variant === 2
}

/** Legacy input helper; Thread IDs keep the existing physical encoding. */
export const isCampId = isThreadId

export type AdapterKind =
  | 'codex-cli'
  | 'pi'
  | 'opencode-cli'
  | 'copilot-cli'
  | 'claude-code-cli'
  | 'kiro-cli'
  | 'qoder-cli'
  | 'codebuddy-cli'
  | 'qwen-code'
  | 'trae-cn-cli'
  | 'cursor-agent'
  | 'kimi-code-cli'
  | 'grok-build'
  | 'zcode-app'
  | 'deepseek-harness'
  | 'cline-cli'
  | 'command-code-cli'
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
  description?: string | null
  runtimeMetadata?: Record<string, unknown> | null
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
    | 'light_ready'
    | 'light_failed'
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

export type RuntimeModelCatalogCacheStatus =
  | 'fresh'
  | 'stale'
  | 'expired'
  | 'unavailable'
  | 'invalidated'

export interface RuntimeModelCatalogCache {
  status: RuntimeModelCatalogCacheStatus
  observedAt: string | null
  revalidateAfter: string | null
  expiresAt: string | null
}

export interface RuntimeModelCatalogView {
  runtimeKind: AdapterKind
  cache: RuntimeModelCatalogCache
  models: ModelDescriptor[]
  refreshStatus: 'not_required' | 'scheduled' | 'joined' | 'completed' | 'failed' | 'deferred'
  diagnosticCode: string | null
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
  failure: RuntimeFailureView | null
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
  /** Static Adapter permission vocabulary, available before diagnostics. */
  permissionOptions?: PermissionOptionDescriptor[]
  snapshot: AdapterCapabilitySnapshot | null
  modelCatalog: RuntimeModelCatalogCache
  memberRuntimeDefaults: MemberRuntimeConfiguration | null
  lastProbeAttempt: AdapterProbeAttempt | null
  relocationHistory: AdapterRelocationAudit[]
  createdAt: string
  updatedAt: string
}

export interface MemberThreadMembership {
  threadId: string
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
  | 'light_ready'
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
  currentThreadMembershipCount: number
  openAssignedTaskCount: number
  defaultLeadThreadCount: number
  soleMemberThreadCount: number
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

export interface RuntimeEnvironmentVariable { name: string; value: string }

export interface RuntimeStartupConfiguration {
  programPath: string | null
  environment: RuntimeEnvironmentVariable[]
}

export interface RuntimeStartupSettings {
  runtimeKind: AdapterKind
  revision: number
  configuration: RuntimeStartupConfiguration
  reconnectRequired: boolean
}
export interface RuntimeStartupFieldEdit { path: string[]; before: unknown; after: unknown; label: string }
export interface RuntimeStartupFieldConflict extends RuntimeStartupFieldEdit { current: unknown }

export interface RuntimeStartupInspection {
  status: 'missing' | 'recognized' | 'version_unverified' | 'authentication_required' | 'ready' | 'check_failed'
  executablePath: string | null
  reportedVersion: string | null
  searchEnvironment?: HealthStatus['searchEnvironment']
}

export type RuntimeDiscoveryStatus = 'detecting' | 'found' | 'missing'

export type RuntimeSearchPathSource =
  | 'inherited_path'
  | 'user_registry_path'
  | 'machine_registry_path'
  | 'login_shell'
  | 'known_location'

export type RuntimeDiscoveryEntrypointKind =
  | 'native_executable'
  | 'npm_cmd_shim'
  | 'pnpm_cmd_shim'
  | 'windows_command_shim'

export type RuntimeCandidateExtension = 'native' | 'exe' | 'cmd' | 'bat'

export interface RuntimeDiscoveryObservation {
  runtimeKind: AdapterKind
  discoveryStatus: RuntimeDiscoveryStatus
  executablePath: string | null
  source: Exclude<InstallationSource, 'custom'> | null
  reportedVersion: string | null
  executableFingerprint: string | null
  searchPathSource: RuntimeSearchPathSource | null
  entrypointKind: RuntimeDiscoveryEntrypointKind | null
  candidateExtension: RuntimeCandidateExtension | null
  resolvedNativeTarget: boolean
  versionProbeSucceeded: boolean | null
  searchGeneration: number
  observedAt: string
  diagnosticCode: string | null
}

export interface ProductRuntimeCatalogEntry {
  runtimeKind: AdapterKind
  displayName: string
  commandName: string
}

export type HostPlatformKey = 'macos-arm64' | 'macos-x64' | 'windows-x64' | 'linux-x64'

export type RuntimePlatformAdmissionStatus = 'qualified' | 'preview' | 'not_qualified' | 'unsupported'

export type RuntimePlatformAdmissionReasonCode =
  | 'runtime_platform.qualification_evidence_missing'
  | 'runtime_platform.adapter_not_implemented'
  | 'runtime_platform.upstream_unsupported'
  | 'runtime_platform.authentication_unqualified'
  | 'runtime_platform.session_unqualified'
  | 'runtime_platform.builtin_transport_unqualified'
  | 'runtime_platform.lifecycle_unqualified'
  | 'runtime_platform.filesystem_semantics_unqualified'

export interface RuntimePlatformAdmission {
  runtimeKind: AdapterKind
  platform: HostPlatformKey
  status: RuntimePlatformAdmissionStatus
  reasonCode: RuntimePlatformAdmissionReasonCode | null
  evidenceRevision: string | null
}

export type ProductRuntimeAvailabilityStatus =
  | 'detecting'
  | 'missing'
  | 'found_uninspected'
  | 'light_ready'
  | 'installed_unverified'
  | 'checking'
  | 'ready'
  | 'authentication_required'
  | 'incompatible'
  | 'needs_attention'
  | 'path_missing'
  | 'disabled'
  | 'refresh_failed_using_last_success'

export type RuntimeFailureOrigin =
  | 'runtime'
  | 'compatibility'
  | 'environment'
  | 'rovai'
  | 'unknown'

export type RuntimeFailurePhase =
  | 'spawn'
  | 'authentication'
  | 'model_catalog'
  | 'execution'
  | 'terminal'

export interface RuntimeFailureView {
  runtimeKind: AdapterKind
  origin: RuntimeFailureOrigin
  phase: RuntimeFailurePhase
  code: string
  summary: string
  detail: string | null
  retryable: boolean
}

export interface ProductRuntimeAvailability {
  runtimeKind: AdapterKind
  status: ProductRuntimeAvailabilityStatus
  checking: boolean
  discovery: RuntimeDiscoveryObservation
  installationId: string | null
  reportedVersion: string | null
  diagnosticCode: string | null
  failure: RuntimeFailureView | null
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
  hostPlatform: HostPlatformKey
  runtimeCatalog: ProductRuntimeCatalogEntry[]
  runtimePlatformAdmission: RuntimePlatformAdmission[]
  runtimeAvailability: ProductRuntimeAvailability[]
  searchEnvironment: {
    diagnosticCodes?: string[]
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

export type MonitoringRange = '24h' | '7d' | '30d'

export interface MonitoringFilter {
  range: MonitoringRange
  runtimeKind?: AdapterKind
  providerKey?: string
  modelKey?: string
  costKind?: string
}

export interface RuntimeUsageCoverageValue {
  eligibleRuns: number
  observedRuns: number
}

export interface RuntimeUsageMoneyValue {
  amount: string
  currency: string
  kind: string
  source: string
}

export interface RuntimeUsageCostSummary {
  run: RuntimeUsageMoneyValue[]
  reconciliation: RuntimeUsageMoneyValue[]
  latestReconciledAt: string | null
  difference: Array<{ amount: string; currency: string }>
}

export interface RuntimeUsageSummary {
  promptInputTotalTokens: number | null
  uncachedInputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  outputTokens: number | null
  reasoningOutputTokens: number | null
  cacheReadShare: number | null
  requestCacheHitRate: number | null
  cost: RuntimeUsageCostSummary | null
}

export interface RuntimeUsageTrendPoint {
  bucketStartAt: string
  promptInputTotalTokens: number | null
  uncachedInputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  outputTokens: number | null
  reasoningOutputTokens: number | null
  cacheReadShare: number | null
  requestCacheHitRate: number | null
  cost: RuntimeUsageMoneyValue[] | null
}

export interface RuntimeUsageBreakdownRow {
  runtimeKind: string
  providerKey: string | null
  modelKey: string | null
  promptInputTotalTokens: number | null
  uncachedInputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  outputTokens: number | null
  reasoningOutputTokens: number | null
  cacheReadShare: number | null
  requestCacheHitRate: number | null
  cost: RuntimeUsageMoneyValue[]
  coverage: RuntimeUsageCoverageValue
}

export interface RuntimeUsageSnapshot {
  schemaVersion: 2
  collection: {
    epoch: string
    startedAt: string
  }
  range: {
    from: string
    to: string
  }
  summary: RuntimeUsageSummary
  trend: RuntimeUsageTrendPoint[]
  byRuntime: RuntimeUsageBreakdownRow[]
  byModel: RuntimeUsageBreakdownRow[]
  coverage: {
    promptInputTotalTokens: RuntimeUsageCoverageValue
    uncachedInputTokens: RuntimeUsageCoverageValue
    cacheReadTokens: RuntimeUsageCoverageValue
    cacheWriteTokens: RuntimeUsageCoverageValue
    outputTokens: RuntimeUsageCoverageValue
    reasoningOutputTokens: RuntimeUsageCoverageValue
    requestCacheHitRate: RuntimeUsageCoverageValue
    cost: RuntimeUsageCoverageValue
  }
}

export interface RuntimeExecutionMetricsSnapshot {
  schemaVersion: 1
  runs: Array<{
    agentRunId: string
    executionEpoch: number
    promptInputTotalTokens: number | null
    outputTokens: number | null
    cacheReadTokens: number | null
    cacheWriteTokens: number | null
    finalizedAt: string | null
    lastObservedAt: string | null
    /** Coverage of received Input/Output contributions; missing/legacy evidence is not complete. */
    inputOutputComplete?: boolean
  }>
  sessions: Array<{
    conversationId: string
    agentId: string
    sessionGeneration: number
    runtimeKind: AdapterKind
    modelKey: string | null
    usedTokens: number | null
    windowTokens: number | null
    /** Independently observed native fraction; never used to infer token quantities. */
    nativeRatio?: number | null
    source: string
    dialectId: string
    observedAt: string
  }>
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

export interface ThreadDeletionIssue {
  operationId: string
  attentionRevision: number
}

export interface CreateTaskAndQueueExecutionResult {
  execution: StoredCommandResult | null
  replayed: boolean
  preflight: StartPreflightResult | null
}

export interface SendThreadMessageResult {
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
  requestMethod: 'thread.messages.send'
  threadId: string | null
  status: PendingExecutionIntentStatus
  diagnosticCode: string | null
  attemptCount: number
  retryAfter: string | null
}

export type ThreadCollaborationMode = 'peer' | 'lead_coordinated'
export type ThreadActivationState = 'pending' | 'active'

export interface CreateThreadRequest {
  commandId: string
  name: string | null
  workspace: { projectPath: string } | null
  memberAgentIds: string[]
  defaultLeadAgentId: string
  collaborationMode: ThreadCollaborationMode
  activationState: ThreadActivationState
}

export interface ThreadCreationPreflight {
  admissible: boolean
  presentMembers: Array<{
    agentId: string
    displayName: string
    memberOrder: number
    runtimeConfigured: boolean
    runtimeReadiness: RuntimeReadinessStatus
  }>
  initialLeadAgentId: string | null
  lastMemberCreationHelperAgentId?: string | null
  blockers: Array<{
    code: 'no_present_members'
    detail: string
  }>
}

export interface RenameThreadCommand {
  threadId: string
  title: string
  expectedVersion: number
}

export interface ChangeDefaultLeadCommand {
  threadId: string
  successorAgentId: string
  expectedVersion: number
}

export interface ReconcileDefaultLeadCommand {
  threadId: string
}

export interface DeleteThreadCommand {
  threadId: string
  expectedVersion: number
  force?: boolean
  workspaceDisposition?: 'retain' | 'cleanup'
}

export interface DiscardPendingThreadCommand {
  threadId: string
}

export interface CancelThreadTurnCommand {
  threadId: string
  threadTurnId: string
  expectedVersion: number
}

export interface OpenSingleChatCommand {
  threadId: string
  agentId: string
}

export interface SendSingleChatMessageCommand {
  threadId: string
  conversationId: string
  body: string
  draftRevision: number
}

export interface EndSingleChatCommand {
  threadId: string
  conversationId: string
}

export interface SingleChatConversationView {
  id: string
  threadId: string
  agentId: string
  version: number
  status: 'active' | 'ended'
  lastMessageSequence: number
  lastAcceptedPublicBoundarySequence: number
  activeAgentRunId: string | null
  createdAt: string
  updatedAt: string
  endedAt: string | null
}

export interface SingleChatMessageView {
  quotes: MessageQuoteSnapshot[]
  id: string
  sequence: number
  authorType: 'user' | 'agent' | 'system'
  authorId: string
  body: string
  attachments: ThreadMessageAttachmentView[]
  agentRunId: string | null
  createdAt: string
}

export interface SingleChatRunView {
  id: string
  threadTurnId: string
  triggerConversationMessageId: string
  status: 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled'
  version: number
  executionEpoch: number
  cancelRequestedAt: string | null
  lastErrorCode: string | null
  createdAt: string
  startedAt: string | null
  endedAt: string | null
  finalConversationMessageId: string | null
  executionEvidenceCount: number
  executionEvidenceChangeSequence: number
}

export interface SingleChatSnapshot {
  conversation: SingleChatConversationView
  approvals: ActionApprovalView[]
  messages: SingleChatMessageView[]
  draft: SingleChatComposerDraftView
  pendingInputs: SingleChatPendingInputsView
  agentRuns: SingleChatRunView[]
  executionEvidence: AgentRunExecutionEvidenceView[]
}

export interface SingleChatComposerDraftView {
  quotes: MessageQuoteSnapshot[]
  revision: number
  attachments: LocalAttachmentSourceView[]
  updatedAt: string | null
}

export interface SingleChatPendingInputView {
  quotes: MessageQuoteSnapshot[]
  id: string
  conversationId: string
  enqueueSequence: number
  revision: number
  state: 'queued' | 'needs_repair'
  body: string
  lastAttemptErrorCode: string | null
  attachments: LocalAttachmentSourceView[]
}

export interface SingleChatPendingInputEditSessionView {
  workingQuotes: MessageQuoteSnapshot[]
  pendingInputId: string
  editToken: string
  basePendingRevision: number
  recoveryRequired: boolean
  workingBody: string
  workingAttachments: LocalAttachmentSourceView[]
}

export interface SingleChatPendingInputsView {
  executionActive: boolean
  items: SingleChatPendingInputView[]
  editSession: SingleChatPendingInputEditSessionView | null
}

export type SingleChatPendingInputEditAction =
  | { type: 'return_to_composer'; expectedDraftRevision: number }
  | { type: 'quote'; action: MessageQuoteAction }
  | { type: 'begin' | 'takeover' | 'cancel' | 'delete' }
  | { type: 'save'; body: string }
  | { type: 'remove_attachment'; attachmentRefId: string }
  | { type: 'reorder_attachments'; attachmentRefIds: string[] }

export interface EditSingleChatPendingInputCommand {
  threadId: string
  conversationId: string
  pendingInputId: string
  expectedRevision: number
  editToken: string | null
  action: SingleChatPendingInputEditAction
}

export type NavigationThreadMarker = 'loading' | 'unread_completed' | 'none'

export type ThreadChannelSource =
  | { provider: 'feishu' | 'lark'; conversationKind: 'p2p' | 'group' | 'topic' }
  | { provider: 'dingtalk'; conversationKind: 'p2p' | 'group' }

export interface NavigationThreadItem {
  id: string
  title: string
  channelSource?: ThreadChannelSource | null
  activationState: ThreadActivationState
  projectBindingKind: ProjectBindingKind
  projectPath: string
  defaultLead: { agentId: string; displayName: string } | null
  marker: NavigationThreadMarker
  lastActivityAt: string
  lastActivityGlobalSequence: number
  latestCompletionGlobalSequence: number
  /** Saved read boundary; older clients/fixtures may omit it. */
  lastSeenGlobalSequence?: number
  version: number
}

export type NavigationThreadTarget = Pick<NavigationThreadItem,
  'id' | 'title' | 'channelSource' | 'activationState' | 'projectBindingKind' | 'projectPath'>

export interface NavigationThreadGroup {
  totalCount: number
  recentThreads: NavigationThreadItem[]
}

export interface ProjectNavigationGroup {
  projectKey: string
  name: string
  projectPath: string
  lastActivityAt: string
  lastActivityGlobalSequence: number
  totalCount: number
  recentThreads: NavigationThreadItem[]
}

export interface NavigationSnapshotRequest {
  /** Full prefix sizes by canonical group key; omitted groups default to five. */
  groupLimits?: Record<string, number>
  /** Omitted means a complete snapshot; present means only these authoritative groups. */
  groupKeys?: string[]
}

export interface NavigationSnapshot {
  schemaVersion: 3
  throughGlobalSequence: number
  quickChat: NavigationThreadGroup
  projects: ProjectNavigationGroup[]
}

export interface NavigationThreadPage {
  schemaVersion: 3
  throughGlobalSequence: number
  projectPath: string | null
  totalCount: number
  nextOffset: number | null
  threads: NavigationThreadItem[]
}

export interface NavigationThreadRows {
  throughGlobalSequence: number
  groupKeys: string[]
  threads: NavigationThreadItem[]
}

export interface ThreadViewedAcknowledgement {
  threadId: string
  lastSeenGlobalSequence: number
  changed: boolean
  navigation: NavigationThreadRows
}

export interface ThreadMemberFastView {
  runtimeBindingRevision: string
  fastOverride: boolean | null
  runtimeDefaultFast: boolean | null
}

export interface ThreadMemberView {
  fast?: ThreadMemberFastView

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

export interface ThreadMembershipReconciliationView {
  id: string
  agentId: string
  membershipVersion: number
  status: 'reconciling'
  reasonCode: string
  targetRunCount: number
  settledRunCount: number
  createdAt: string
  updatedAt: string
}

export interface AddThreadMemberCommand {
  threadId: string
  agentId: string
  expectedMembershipGeneration: number
  capabilityOverrides?: Record<string, unknown>
}

export interface RemoveThreadMemberCommand {
  threadId: string
  agentId: string
  expectedMembershipGeneration: number
  expectedMembershipVersion: number
  replacementDefaultLeadAgentId?: string | null
  reason?: string | null
}

export interface ThreadMemberRemovalPreview {
  threadId: string
  agentId: string
  displayName: string
  membershipGeneration: number
  membershipVersion: number
  isDefaultLead: boolean
  nextDefaultLeadAgentId: string | null
  nonTerminalAgentRunCount: number
  openAssignedTaskCount: number
  pendingDeliveryCount: number
  runningDeliveryCount: number
  removable: boolean
  blockerCode: 'camp.member_not_active' | 'camp.last_member_required' | null
}

export interface TaskView {
  taskId: string
  threadId: string
  title: string
  description: string
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

export type StructuredThreadMessageSegment =
  | { kind: 'text'; text: string }
  | { kind: 'member_mention'; agentId: string }
  | { kind: 'all_members_mention' }
  | { kind: 'current_user_mention'; userId: 'local_user' }
  | { kind: 'skill_mention'; skillId: string; nameAtSend: string }
  | {
      kind: 'external_quote'
      senderDisplayName: string
      body: string
      attachmentSummaries: Array<{ name: string; mediaType: string | null }>
      contentDigest: `sha256:${string}`
    }

export type StructuredThreadMessageContent = StructuredThreadMessageSegment[]

export interface ComposerDocument {
  version: 2
  segments: ComposerSegment[]
}

export type ComposerSegment =
  | { kind: 'text'; text: string }
  | { kind: 'atom'; atom: ComposerAtom }

export type ComposerAtom =
  | MemberComposerAtom
  | AllMembersComposerAtom
  | SkillComposerAtom

export interface MemberComposerAtom {
  type: 'member'
  agentId: string
  labelFallback?: string
}

export interface AllMembersComposerAtom {
  type: 'all_members'
}

export interface SkillComposerAtom {
  type: 'skill'
  skillId: string
  nameAtSend: string
}

export type SkillSelectionOmissionReason =
  | 'missing_at_send'
  | 'inactive_at_send'
  | 'disabled_at_send'
  | 'name_mismatch_at_send'
  | 'runtime_group_unassigned_at_send'

export type CurrentInputSkillOmissionReason =
  | 'not_eligible_at_send'
  | 'missing_at_start'
  | 'inactive_at_start'
  | 'disabled_at_start'
  | 'name_mismatch_at_start'
  | 'runtime_group_unassigned_at_start'
  | 'exposure_missing'
  | 'exposure_name_mismatch'
  | 'exposure_not_ready'
  | 'exposure_group_incompatible'
  | 'skill_file_unavailable'

export type RunSkillAvailabilityView =
  | { state: 'missing' }
  | {
      state: 'present'
      active: boolean
      enabled: boolean
      name: string
      matchingGroupKeys: string[]
    }

export interface CurrentInputSkillResolutionEntry {
  skillId: string
  nameAtSend: string
  firstSegmentIndex: number
  eligibleAtSend: boolean
  sendOmissionReason?: SkillSelectionOmissionReason
  runAvailability: RunSkillAvailabilityView
  outcome: 'included' | 'omitted'
  reason?: CurrentInputSkillOmissionReason
  path?: string
  revisionId?: string
  contentDigest?: string
  groupKey?: string
  deliveredViaGroupKey?: string
}

export interface CurrentInputSkillResolution {
  schemaVersion: 1
  selectionSnapshotDigest: string
  skillExposureDigest: string
  entries: CurrentInputSkillResolutionEntry[]
}

export interface ThreadMessageView {
  missionStart?: {missionId: string; title: string; description: string}
  quotes: MessageQuoteSnapshot[]
  id: string
  sequence: number
  timelineGlobalSequence: number | null
  authorType: 'user' | 'agent' | 'system' | 'external_principal'
  authorId: string
  authorDisplayName?: string | null
  sourceAgentRunId: string | null
  /** Read-only source Run metadata; absent in older projections. Never inferred from a profile. */
  runtimeModel?: ThreadMessageRuntimeModelView | null
  body: string
  content: StructuredThreadMessageContent
  attachments: ThreadMessageAttachmentView[]
  addressMode: 'default' | 'explicit' | 'broadcast'
  addressedAgentIds: string[]
  replyToThreadMessageId: string | null
  threadTurnId: string | null
  presentation: ThreadTimelinePresentation | null
  createdAt: string
  withdrawn: boolean
  canWithdraw: boolean
  version: number
}

export interface ThreadMessageRuntimeModelView {
  adapterKind: string
  /** Null means the Run used Agent defaults with no native model observation. */
  modelId: string | null
  reasoningEffort: string | null
}

export interface ThreadMessageAttachmentView {
  id: string
  displayName: string
  kind: 'file' | 'directory'
  fileCount: number | null
  mediaType: string | null
  byteSize: number | null
  previewKind: 'image' | 'none'
  availability: LocalAttachmentAvailability
  /** Present only while an unsent local Composer owns this attachment. */
  sourcePath?: string
}

export type LocalAttachmentAvailability =
  | 'unknown'
  | 'available'
  | 'missing'
  | 'unreadable'
  | 'kind_changed'

export type LocalAttachmentSourceView = ThreadMessageAttachmentView

export type LocalAttachmentOwnerLocator =
  | { owner: 'composer'; threadId: string; attachmentRefId: string }
  | { owner: 'pending'; threadId: string; pendingInputId: string; attachmentRefId: string }
  | {
      owner: 'pending_edit'
      threadId: string
      pendingInputId: string
      editToken: string
      attachmentRefId: string
    }
  | { owner: 'message'; threadId: string; messageId: string; attachmentRefId: string }
  | { owner: 'mission'; threadId: string; missionId: string; attachmentRefId: string }
  | {
      owner: 'single_chat_composer'
      threadId: string
      conversationId: string
      attachmentRefId: string
    }
  | {
      owner: 'single_chat_pending'
      threadId: string
      conversationId: string
      pendingInputId: string
      attachmentRefId: string
    }
  | {
      owner: 'single_chat_pending_edit'
      threadId: string
      conversationId: string
      pendingInputId: string
      editToken: string
      attachmentRefId: string
    }
  | {
      owner: 'single_chat_message'
      threadId: string
      conversationId: string
      conversationMessageId: string
      attachmentRefId: string
    }

export interface MessageQuoteSnapshot {
  version: 1
  quoteId: string
  source: { scope: 'camp' | 'single_chat'; campId: string; conversationId?: string; messageId: string }
  authorAtCapture: { type: 'user'; displayName: string } | { type: 'agent'; agentId: string; displayName: string }
  text: string
  format: 'plain_text'
  capturedAt: string
  sourceContentDigest: string
  /** Internal, immutable selection anchor. Never projected into model input. */
  locator?: { projectionVersion: 1; startScalar: number; endScalar: number; projectionDigest: string }
  snapshotDigest: string
}

export interface MessageQuoteSelection {
  currentUserDisplayName?: string
  messageId: string
  bodyAtSelection: string
  startScalar: number
  endScalar: number
  text: string
}

export type MessageQuoteAction =
  | { type: 'add'; selection: MessageQuoteSelection }
  | { type: 'remove' | 'restore'; quoteId: string }

export interface ThreadComposerDraftView {
  /** Host-owned editor identity; independent of a short-lived authentication Session. */
  draftId?: string
  quotes: MessageQuoteSnapshot[]
  threadId: string
  body: string
  content: ComposerDocument
  revision: number
  attachments: LocalAttachmentSourceView[]
  replyIntent: ThreadComposerReplyIntentView | null
  continuationIntent: ThreadComposerContinuationIntentView | null
  updatedAt: string | null
  expiresAt: string | null
}

export interface PendingThreadInputView {
  quotes: MessageQuoteSnapshot[]
  id: string
  threadId: string
  enqueueSequence: number
  revision: number
  state: 'queued' | 'needs_repair'
  content: ComposerDocument
  body: string
  replyIntent: ThreadComposerReplyIntentView | null
  recipientSelectionRequired: boolean
  lastAttemptErrorCode: string | null
  attachments: LocalAttachmentSourceView[]
}

export interface PendingInputEditSession {
  /** Same Owner may explicitly take over this lease; no foreign working state is exposed. */
  foreignClient?: boolean
  workingQuotes: MessageQuoteSnapshot[]
  pendingInputId: string
  editToken: string
  basePendingRevision: number
  recoveryRequired: boolean
  workingAttachments: LocalAttachmentSourceView[]
}

export interface ThreadPendingInputsView {
  threadId: string
  executionActive: boolean
  items: PendingThreadInputView[]
  editSession: PendingInputEditSession | null
  submissionOutcomes?: PendingThreadInputSubmissionOutcome[]
}

export interface PendingThreadInputSubmissionOutcome {
  pendingInputId: string
  state: 'queued' | 'needs_repair' | 'published' | 'cancelled' | 'missing'
  threadTurnId: string | null
  addressedAgentIds: string[]
}

export type PendingInputEditAction =
  | { type: 'return_to_composer'; expectedDraftRevision: number }
  | { type: 'quote'; action: MessageQuoteAction }
  | { type: 'begin' | 'takeover' | 'cancel' | 'delete' }
  | {
      type: 'save'
      content: ComposerDocument
      replyToThreadMessageId: string | null
      recipientSelectionRequired: boolean
    }
  | { type: 'remove_attachment'; attachmentRefId: string }
  | { type: 'reorder_attachments'; attachmentRefIds: string[] }

export interface ThreadComposerContinuationIntentView {
  sourceThreadMessageId: string
  recipient: {
    agentId: string
    displayName: string
    recipientAvailability: 'available' | 'unavailable'
  }
  recipientSelectionRequired: boolean
}

export interface ThreadComposerReplyIntentView {
  replyToThreadMessageId: string
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

export type ThreadComposerReplyRecipient =
  | { kind: 'member'; agentId: string }
  | { kind: 'all_members' }

export interface AttachmentPreview {
  mediaType: string
  bytes: Uint8Array
}

export interface AttachmentPreviewResult {
  preview: AttachmentPreview | null
  availability: LocalAttachmentAvailability
}

export type AttachmentActionError = 'target_unavailable' | 'open_failed' | 'reveal_failed'

export interface AttachmentOpenResult {
  opened: boolean
  error: AttachmentActionError | null
  availability: LocalAttachmentAvailability
}

export interface AttachmentRevealResult {
  revealed: boolean
  error: AttachmentActionError | null
  availability: LocalAttachmentAvailability
}

export type OpenFilePreviewRequest =
  | {
      kind: 'skill_reference'
      threadId: string
      skillId: string
      rawReference: 'SKILL.md'
    }
  | {
      kind: 'message_reference'
      threadId: string
      messageId: string
      rawReference: string
    }
  | {
      kind: 'camp_workspace'
      threadId: string
      rawReference: string
    }
  | {
      kind: 'attachment'
      threadId: string
      locator: LocalAttachmentOwnerLocator
    }
  | {
      kind: 'run_evidence'
      threadId: string
      agentRunId: string
      executionEpoch: number
      evidenceFileId: string
      action: 'review' | 'open_current'
    }
  | {
      kind: 'run_activity_file'
      threadId: string
      agentRunId: string
      executionEpoch: number
      evidenceId: string
      rawReference: string
    }
  | {
      kind: 'child_of_handle'
      parentHandleId: string
      rawReference: string
      allowSystemOpen?: boolean
    }
  | {
      kind: 'authorized_root'
      threadId: string
      rootGrantId: string
      rawReference: string
    }

export type RestoreFilePreviewRequest = Extract<OpenFilePreviewRequest, {
  kind: 'skill_reference' | 'message_reference' | 'camp_workspace' | 'attachment' | 'run_evidence' | 'run_activity_file'
}>

export interface ReopenFilePreviewRequest {
  threadId: string
  reopenToken: string
}

export interface FileLocationTarget {
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
  heading?: string
  htmlFragment?: string
}

export interface ParsedFileReference {
  raw: string
  pathPart: string
  query?: string
  fragment?: string
  target?: FileLocationTarget
  pathKind:
    | 'unix_absolute'
    | 'windows_absolute'
    | 'unc'
    | 'home_relative'
    | 'relative'
    | 'file_uri'
}

export type FilePreviewKind =
  | 'markdown'
  | 'html'
  | 'code'
  | 'text'
  | 'paged_text'
  | 'image'
  | 'svg'
  | 'patch'

export type FilePreviewCapability =
  | 'download'
  | 'read'
  | 'read_child'
  | 'open_in_system'
  | 'preview_asset'

export type FilePreviewPathPresentation =
  | 'project_relative'
  | 'external'
  | 'file_name_only'

export interface FileContentVersion {
  size: number
  mtimeMs: number
  fileId?: string
}

export interface ResolvedFilePreview {
  handleId: string
  reopenToken: string
  previewKey: string
  restoreRequest?: RestoreFilePreviewRequest
  displayPath: string
  absolutePath?: string
  pathPresentation: FilePreviewPathPresentation
  fileName: string
  size: number
  mime: string
  extension: string
  kind: FilePreviewKind
  hasExternalUpdate: boolean
  contentVersion: FileContentVersion
  contentGeneration: string
  capabilities: FilePreviewCapability[]
  target?: FileLocationTarget
}

export type OpenFilePreviewResult =
  | {
      kind: 'evidence_review'
      threadId: string
      agentRunId: string
      executionEpoch: number
      evidenceFileId: string
    }
  | { kind: 'file_preview'; file: ResolvedFilePreview }
  | { kind: 'opened_in_system'; fileName: string }

export type FilePreviewErrorCode =
  | 'preview_timeout'
  | 'source_not_authorized'
  | 'reference_not_clickable'
  | 'file_not_found'
  | 'authorization_required'
  | 'too_many_open_files'
  | 'evidence_identity_unavailable'
  | 'not_regular_file'
  | 'outside_authorized_root'
  | 'file_too_large'
  | 'decode_failed'
  | 'read_failed'
  | 'open_failed'
  | 'reveal_failed'
  | 'attachment_missing'
  | 'attachment_unreadable'
  | 'attachment_kind_changed'

export interface FilePreviewErrorPayload {
  code: FilePreviewErrorCode
  message: string
  displayReference?: string
  retryable: boolean
  authorizationChallenge?: FilePreviewAuthorizationChallenge
}

export type FilePreviewOperationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: FilePreviewErrorPayload }

export interface FilePreviewAuthorizationChallenge {
  pendingOpenId: string
  threadId: string
  displayReference: string
  expiresAt: number
}

export interface FilePreviewRootGrantResult {
  rootGrantId: string
  displayName: string
  result: OpenFilePreviewResult
}

export interface FilePreviewTextContent {
  text: string
  contentGeneration: string
  contentVersion: FileContentVersion
}

export interface FilePreviewPageContent extends FilePreviewTextContent {
  startOffset: number
  endOffset: number
  startLine: number
  hasPrevious: boolean
  hasNext: boolean
}

export interface FilePreviewBinaryContent {
  bytes: Uint8Array
  mime: string
  contentGeneration: string
  contentVersion: FileContentVersion
}

export interface FilePreviewHtmlSite {
  previewId: string
  generation: string
  origin: string
  entryUrl: string
  documentUrl: string
  /** Trusted Web HTML bootstrapped at the host origin, sharing native browser storage. */
  sandboxedDocument?: string
  contentGeneration: string
  contentVersion: FileContentVersion
}

export interface FilePreviewHtmlDocument {
  html: string
  tabToken: string
  bridgeToken: string
  assetBasePath: string
  contentGeneration: string
  contentVersion: FileContentVersion
}

export interface FilePreviewExternalUpdateEvent {
  threadId: string
  previewKeys: string[]
}

/** Window-local preview retention. Usage is a user-action sequence, never an I/O timestamp. */
export interface FilePreviewRetentionState {
  sessions: { threadId: string; previewSessionId: string }[]
  handles: { handleId: string; previewSessionId: string; tabId: string; lastUsed: number; visible: boolean; busy: boolean; recoverable: boolean }[]
}

export interface FilePreviewApi {
  /** Browser image bytes resolved under the current, generation-bound parent. */
  readChildImage?(request: { handleId: string; expectedGeneration: string; rawReference: string }): Promise<FilePreviewOperationResult<FilePreviewBinaryContent>>

  /** Native capability ownership; stateless browser adapters do not need a native registry. */
  updateRetention?(state: FilePreviewRetentionState): Promise<void>
  onResourcesReleased?(listener: (event: { handleIds: string[] }) => void): () => void
  bindThread(threadId: string | null): Promise<void>
  open(request: OpenFilePreviewRequest): Promise<FilePreviewOperationResult<OpenFilePreviewResult>>
  restore(request: RestoreFilePreviewRequest): Promise<FilePreviewOperationResult<OpenFilePreviewResult>>
  reopen(request: ReopenFilePreviewRequest): Promise<FilePreviewOperationResult<OpenFilePreviewResult>>
  readText(request: { handleId: string; expectedGeneration: string }): Promise<FilePreviewOperationResult<FilePreviewTextContent>>
  readPage(request: { handleId: string; expectedGeneration: string; offset: number; maxBytes?: number }): Promise<FilePreviewOperationResult<FilePreviewPageContent>>
  resolveLine(request: { handleId: string; expectedGeneration: string; line: number }): Promise<FilePreviewOperationResult<{ offset: number; line: number; contentGeneration: string }>>
  readBinary(request: { handleId: string; expectedGeneration: string }): Promise<FilePreviewOperationResult<FilePreviewBinaryContent>>
  prepareHtmlSite(request: { handleId: string; expectedGeneration: string }): Promise<FilePreviewOperationResult<FilePreviewHtmlSite>>
  releaseHtmlSite(request: { previewId: string }): Promise<{ released: true }>
  prepareHtml(request: { handleId: string; expectedGeneration: string }): Promise<FilePreviewOperationResult<FilePreviewHtmlDocument>>
  reload(request: { handleId: string; reopenToken: string; expectedGeneration: string }): Promise<FilePreviewOperationResult<ResolvedFilePreview>>
  release(request: { handleId: string }): Promise<{ released: true }>
  download?(request: { handleId: string; expectedGeneration: string }): Promise<FilePreviewOperationResult<{ started: true }>>
  openInSystem(request: { handleId: string }): Promise<FilePreviewOperationResult<{ opened: true }>>
  revealInFolder(request: { handleId: string }): Promise<FilePreviewOperationResult<{ revealed: true }>>
  copyPath(request: { handleId: string; format: 'display' | 'absolute' }): Promise<FilePreviewOperationResult<{ copied: true }>>
  chooseAuthorizedRoot(request: { threadId: string; pendingOpenId: string }): Promise<FilePreviewOperationResult<FilePreviewRootGrantResult | null>>
  onExternalUpdate(listener: (event: FilePreviewExternalUpdateEvent) => void): () => void
}

/** Creation-time snapshot, independent of the current member's configuration and presence. */
export interface MemberCreationView {
  creationId: string
  /** Authenticated creating Run; absent only on receipts written before Run association. */
  sourceAgentRunId?: string | null
  agentId: string
  displayName: string
  avatarRef: string | null
  teamRole: string
  professionalResponsibilities: string
  personalityTraits: string[]
  creatorAgentId: string
  creatorDisplayName: string
  createdAt: string
}

export type ThreadTimelinePresentation =
  | {
      kind: 'task_event'
      taskId: string
      titleAtEvent: string
      fromStatus: TaskStatus | null
      toStatus: TaskStatus
      assigneeNameAtEvent: string | null
      occurredAt: string
    }

export interface ThreadTurnView {
  id: string
  triggerType: 'camp_message' | 'system_event'
  triggerId: string
  status: 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled'
  cancelRequestedAt: string | null
  aggregateReasonCode: 'required_run_incomplete' | null
  executionBudget: ThreadTurnExecutionBudgetView
  version: number
  createdAt: string
  updatedAt: string
  endedAt: string | null
}

export interface ThreadTurnExecutionBudgetView {
  schemaVersion: 1
  acceptedAt: string
  deadlineAt: string | null
  elapsedSeconds: number | null
  maxAgentRunResponsibilities: number
  maxAcceptedA2a: number
  allocatedAgentRunResponsibilities: number
  acceptedA2a: number
  exhaustedAt: string | null
  exhaustionReason: 'elapsed' | 'agent_run_responsibilities' | 'accepted_a2a' | null
  exhaustionCommandId: string | null
}

export type AgentRunCancelReasonCode =
  | 'camp_turn_cancelled'
  | 'execution_budget_exhausted'
  | 'user_requested_agent_run_stop'
  | 'single_chat_ended'

export interface AgentRunView {
  id: string
  threadTurnId: string | null
  inputMessageIds?: string[]
  anchorMessageId?: string | null
  /** Core-rendered title source, independent of the loaded conversation page. */
  inputSummary?: string | null
  conversationId: string
  agentId: string
  taskId: string | null
  responsibilityKey: string
  responsibilityGeneration: number
  purpose: string
  completionRole: 'required' | 'optional'
  status: 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled'
  waitReason: string | null
  cancelRequestedAt: string | null
  cancelReasonCode: AgentRunCancelReasonCode | null
  cancelAcknowledgedAt: string | null
  terminalResolutionSource: 'runtime_terminal' | null
  terminalReasonCode:
    | 'planned_shutdown_completed'
    | 'planned_shutdown_failed'
    | 'planned_shutdown_cancelled'
    | 'runtime_interrupted'
    | 'agent_unavailable'
    | 'member_away'
    | 'member_removed'
    | 'runtime_not_configured'
    | 'runtime_configuration_invalid'
    | 'runtime_configuration_adapter_mismatch'
    | 'conversation_runtime_override_unsupported'
    | 'adapter_installation_missing'
    | 'adapter_installation_disabled'
    | 'runtime_permission_adapter_mismatch'
    | 'runtime_permission_schema_mismatch'
    | 'runtime_permission_values_invalid'
    | 'runtime_permission_option_unknown'
    | 'runtime_permission_option_unsupported'
    | 'runtime_permission_value_invalid'
    | 'runtime_permission_value_required'
    | 'runtime_model_options_invalid'
    | 'runtime_model_unavailable'
    | 'runtime_model_option_unknown'
    | 'runtime_model_option_invalid'
    | 'runtime_adapter_not_implemented'
    | null
  failure: RuntimeFailureView | null
  runtimeModel: { modelId: string | null } | null
  executionEpoch: number
  permissionSemantics: 'core_enforced_v1' | 'runtime_managed_v2'
  invocationKind: 'direct' | 'a2a' | 'gather_completion' | 'single_chat' | 'batch'
  triggerDeliveryGeneration: number
  a2aParentAgentRunId: string | null
  a2aRootAgentRunId: string | null
  a2aDepth: number
  executionEvidenceCount: number
  executionEvidenceChangeSequence: number
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

export interface AgentRunDiagnosticView {
  schemaVersion: 1
  agentRunId: string
  executionEpoch: number
  threadId: string
  threadTurnId: string | null
  conversationId: string
  agentId: string
  status: AgentRunView['status']
  waitReason: string | null
  failure: RuntimeFailureView | null
  version: number
  createdAt: string
  startedAt: string | null
  endedAt: string | null
  runtime: {
    adapterKind: AdapterKind
    runtimeInstallationId: string | null
    effectiveConfigDigest: string
    bindingCompatibilityDigest: string | null
    permissionSemantics: AgentRunView['permissionSemantics']
    observedModelId: string | null
  }
  output: {
    finalOutputDigest: string | null
    finalThreadMessageId: string | null
    publicOutput: string | null
    unavailableReason: 'run_not_succeeded' | 'not_published' | 'published_message_unavailable' | null
  }
  git: {
    starting: AgentRunDiagnosticGitObservation | null
    ending: AgentRunDiagnosticGitObservation | null
  }
  contextManifest: {
    manifestId: string | null
    renderedPayloadDigest: string | null
    charterDeliveryMode: 'native_append' | 'first_payload' | null
    threadMessageBoundarySequence: number | null
    skillExposureDigest: string | null
    mcpExposureDigest: string | null
    mcpProjectionDigest: string | null
    attachmentDigest: string | null
  }
  evidence: {
    count: number
    firstEvidenceSequence: number | null
    lastEvidenceSequence: number | null
  }
  observedThroughGlobalSequence: number
}

export interface AgentRunDiagnosticGitObservation {
  state: GitCapabilityState
  objectFormat: string | null
  headCommit: string | null
  branch: string | null
  dirty: boolean | null
  observedAt: string
}

export interface CanonicalRuntimeDiffEntryView {
  path: string
  changeKind: 'add' | 'delete' | 'update'
  additions: number
  deletions: number
  diff: string
}

export interface CanonicalRuntimeDiffProjectionView {
  schemaVersion: 1
  source: 'runtime_reported'
  revision: number
  sourceEvidenceIds: string[]
  status: 'available' | 'unavailable' | 'conflict'
  semanticKind?: 'unified_diff_snapshot' | 'complete_patch_snapshot' | 'exact_mutation' | 'reported_mutation' | 'complete_before_after'
  entries?: CanonicalRuntimeDiffEntryView[]
  safeReasonCode?: string
}

export interface CanonicalRuntimeActivityView {
  operationId: string
  activityDomain: string
  semanticKind: string | null
  toolName: string | null
  presentationHint: string | null
  diffProjection?: CanonicalRuntimeDiffProjectionView | null
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
  operationId?: string | null
  revision?: number | null
  changeSequence?: number | null
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
  /** True only when ordinary Tool output bytes were permanently discarded; absent is historical/unknown. */
  outputTruncated?: boolean | null
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

/** Logical execution items, ordered by their stable first evidence sequence. */
export interface AgentRunExecutionWindowPage {
  schemaVersion: 2
  threadId: string
  agentRunId: string
  requestedBeforeSequence: number | null
  requestedAfterSequence?: number | null
  nextAfterSequence?: number | null
  nextBeforeSequence: number | null
  throughSequence: number
  throughChangeSequence: number
  runtimePhase?: 'thinking' | 'executing'
  hasMore: boolean
  /** Unfinished operations older than the first page remain visible, outside the cursor. */
  activeEvidence?: AgentRunExecutionEvidenceView[]
  /** Commands contain display metadata; isTruncated marks deferred payload/diff, not lost Tool output. */
  evidence: AgentRunExecutionEvidenceView[]
}

export interface AgentRunExecutionWindowChanges {
  schemaVersion: 2
  threadId: string
  agentRunId: string
  requestedAfterChangeSequence: number
  nextAfterChangeSequence: number
  throughSequence: number
  throughChangeSequence: number
  runtimePhase?: 'thinking' | 'executing'
  hasMore: boolean
  evidence: AgentRunExecutionEvidenceView[]
  /** In-place updates of previously loaded, unfinished evidence (including text). */
  refreshedEvidence: AgentRunExecutionEvidenceView[]
}

/** A read-time presentation boundary; tools inside it have a separate cursor. */
export interface AgentRunExecutionBlock {
  key: string
  kind: 'item' | 'toolGroup'
  sequence: number
  lastSequence: number
  changeSequence: number
  toolCount: number
  counts: Record<'completed' | 'failed' | 'stopped' | 'recorded' | 'running' | 'waiting', number>
  /** One root item, or latest/active operations with their proven Shell supports (at most four rows). */
  evidence: AgentRunExecutionEvidenceView[]
}

export interface AgentRunExecutionBlockPage extends Omit<AgentRunExecutionWindowPage, 'schemaVersion' | 'evidence' | 'activeEvidence'> {
  schemaVersion: 3
  blocks: AgentRunExecutionBlock[]
  activeBlocks?: AgentRunExecutionBlock[]
}

export interface AgentRunExecutionBlockChanges extends Omit<AgentRunExecutionWindowChanges, 'schemaVersion' | 'evidence' | 'refreshedEvidence'> {
  schemaVersion: 3
  blocks: AgentRunExecutionBlock[]
  /** Watched in-memory text may grow without advancing the durable change cursor. */
  refreshedBlocks?: AgentRunExecutionBlock[]
}

export interface AgentRunExecutionGroupPage {
  schemaVersion: 3
  threadId: string
  agentRunId: string
  groupSequence: number
  requestedBeforeSequence: number | null
  requestedAfterSequence: number | null
  nextBeforeSequence: number | null
  nextAfterSequence: number | null
  throughChangeSequence: number
  hasMore: boolean
  evidence: AgentRunExecutionEvidenceView[]
}

export interface ExecutionConsolePage {
  pageIndex: number
  pageCount: number
  body: string
}

export interface RuntimeInputDeliveryView {
  id: string
  executionEpoch: number
  status: 'prepared' | 'accepted' | 'delivery_unknown' | 'not_accepted'
  nativeInputId: string | null
  boundaryThreadMessageSequence: number
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

export interface ThreadAttachmentRefView {
  attachmentId: string
  path: string
  contentDigest?: string
}

export interface RunFactRefView {
  missionId?: string
  fact: 'camp_resources' | 'attachment_output_root' | 'mission' | 'task_context' | 'session_continuity' | 'external_effect' | 'gather' | 'delegation'
  taskId?: string
}

export interface ContextManifestView {
  id: string
  agentRunId: string
  bootstrap: NativeSessionBootstrapEvidenceView
  nativeBindingGeneration: number
  threadMessageBoundarySequence: number
  conversationMessageBoundarySequence: number
  historyFenceVersion: number
  globalPublicMessageBoundary: number
  historyThreads: ContextManifestHistoryThreadView[]
  rawMessageCount: number
  previousAcceptedPublicBoundarySequence: number
  contextDeliveryProfileVersion: 4 | 5 | 6 | 7 | 8
  contextDeliveryProfile: {
    profileVersion: 4 | 5 | 6 | 7 | 8
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
  runFactRefs: RunFactRefView[]
  runFactPayload: unknown
  runFactDigest: string
  workspaceFact?: { workingDirectory: string; branch?: string | null } | null
  workspaceFactDigest?: string | null
  workspaceFactIncluded?: boolean
  currentInputSource: unknown
  attachmentRefs: ThreadAttachmentRefView[]
  attachmentDigest: string
  skillExposure: SkillExposureSnapshot
  skillExposureDigest: string
  currentInputSkillResolution: CurrentInputSkillResolution
  currentInputSkillResolutionDigest: string
  messageProjectionAudience: 'agent_v1' | 'agent_v2'
  a2aGuidanceEvidence: unknown
  a2aGuidanceEvidenceDigest: string
  mcpExposure: McpExposureSnapshot
  mcpExposureDigest: string
  mcpProjectionDigest: string
  selfActiveTaskEvidence: unknown
  selfActiveTaskEvidenceDigest: string
  formatterVersion: 22 | 23 | 24 | 25
  renderedPayloadDigest: string
  delivery: RuntimeInputDeliveryView | null
  createdAt: string
}

export interface ContextManifestHistoryThreadView {
  threadId: string
  threadTitle: string
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
  threadId: string | null
  entityType: string | null
  entityId: string | null
  actorType: string | null
  actorId: string | null
  sourceAgentRunId: string | null
  executionEpoch: number | null
  payload: unknown
  createdAt: string
}

export type AgentRunFileChangePresentationKind =
  | 'full_net_diff'
  | 'exact_mutations'
  | 'reported_mutations'
  | 'operation_only'
  | 'operation_history'

export interface AgentRunChangedFileSummaryView {
  evidenceFileId: string
  path: string
  changeKind: string
  presentationKind: AgentRunFileChangePresentationKind
  operationCount: number
  additions?: number
  deletions?: number
}

export interface AgentRunFileChangesView {
  schemaVersion: 2 | 3
  agentRunId: string
  executionEpoch: number
  sourceChangeSequence?: number
  revision?: number
  isStale?: boolean
  files: AgentRunChangedFileSummaryView[]
  fileCount: number
  operationCount: number
  additions?: number
  deletions?: number
  completedAt: string
}

export interface AgentRunFileChangeBlockView {
  sequence: number
  semantics: 'full_net_diff' | 'full_before_after' | 'unified_diff_snapshot' | 'exact_mutation' | 'reported_mutation' | 'operation_only'
  changeKind: string
  additions?: number
  deletions?: number
  diff?: string
}

export interface AgentRunChangedFileDetailView extends AgentRunChangedFileSummaryView {
  blocks: AgentRunFileChangeBlockView[]
}

export interface AgentRunFileChangesDetailView {
  schemaVersion: 2 | 3
  card: AgentRunFileChangesView
  files: AgentRunChangedFileDetailView[]
}

export interface AgentRunImageView {
  id: string
  displayName: string
  mediaType: string
  byteSize: number
}

export interface AgentRunImagesView {
  agentRunId: string
  executionEpoch: number
  createdAt: string
  images: AgentRunImageView[]
}

export interface AgentRunImageContent {
  mediaType: string
  data: string
}

export const THREAD_SNAPSHOT_SCHEMA_VERSION = 35

export interface ThreadSnapshot {
  schemaVersion: typeof THREAD_SNAPSHOT_SCHEMA_VERSION
  throughGlobalSequence: number
  thread: {
    id: string
    title: string
    missionId?: string | null
    channelSource?: ThreadChannelSource | null
    activationState: ThreadActivationState
    projectBindingKind: ProjectBindingKind
    projectPath: string
    defaultLeadAgentId: string | null
    membershipGeneration: number
    version: number
    createdAt: string
    updatedAt: string
  }
  members: ThreadMemberView[]
  membershipReconciliations: ThreadMembershipReconciliationView[]
  tasks: TaskView[]
  memberCreations?: MemberCreationView[]
  messages: ThreadMessageView[]
  messageDeliveries: MessageDeliveryView[]
  turns: ThreadTurnView[]
  agentRuns: AgentRunView[]
  executionEvidence: AgentRunExecutionEvidenceView[]
  agentRunFileChanges: AgentRunFileChangesView[]
  agentRunImages?: AgentRunImagesView[]
  contextManifests: ContextManifestView[]
  approvals: ActionApprovalView[]
  actions: ActionView[]
  timeline: DomainEventView[]
}

export interface ThreadOpenCollectionCoverage {
  loadedCount: number
  totalCount: number
  omittedCount: number
  complete: boolean
}

export interface ThreadOpenMessageCoverage extends ThreadOpenCollectionCoverage {
  oldestLoadedSequence: number | null
  newestLoadedSequence: number | null
  hasEarlier: boolean
}

export interface ThreadOpenProjection {
  schemaVersion: 8
  throughGlobalSequence: number
  thread: ThreadSnapshot['thread']
  members: ThreadMemberView[]
  membershipReconciliations: ThreadMembershipReconciliationView[]
  tasks: TaskView[]
  memberCreations?: MemberCreationView[]
  messages: ThreadMessageView[]
  messageDeliveries: MessageDeliveryView[]
  turns: ThreadTurnView[]
  agentRuns: AgentRunView[]
  executionEvidence: AgentRunExecutionEvidenceView[]
  agentRunFileChanges: AgentRunFileChangesView[]
  agentRunImages?: AgentRunImagesView[]
  approvals: ActionApprovalView[]
  coverage: {
    tasks: ThreadOpenCollectionCoverage
    messages: ThreadOpenMessageCoverage
    messageDeliveries: ThreadOpenCollectionCoverage
    turns: ThreadOpenCollectionCoverage
    agentRuns: ThreadOpenCollectionCoverage
    approvals: ThreadOpenCollectionCoverage
  }
}

export interface ThreadMessagePage {
  schemaVersion: 1
  threadId: string
  throughGlobalSequence: number
  requestedBeforeSequence: number
  nextBeforeSequence: number | null
  hasMore: boolean
  messages: ThreadMessageView[]
}

export interface ThreadMessageAroundSnapshot {
  schemaVersion: 1
  throughGlobalSequence: number
  threadId: string
  anchorMessageId: string
  sourceAvailable: boolean
  messages: ThreadMessageView[]
}

export interface ThreadMessageAroundParams {
  threadId: string
  messageId: string
}

export interface ThreadMessageFindMatch {
  messageId: string
  messageSequence: number
  occurrenceIndex: number
  startOffset: number
  endOffset: number
}

export interface ThreadMessageFindSnapshot {
  schemaVersion: 1
  throughGlobalSequence: number
  threadId: string
  query: string
  totalMatchCount: number
  selectedMatchIndex: number | null
  match: ThreadMessageFindMatch | null
}

export interface ThreadMessageFindParams {
  threadId: string
  query: string
  selectedMatchIndex?: number | null
  anchorMessageId?: string | null
}

interface MessageDeliveryBaseView {
  id: string
  messageId: string
  threadTurnId: string | null
  taskId: string | null
  recipientAgentId: string
  recipientMembershipVersionAtAdmission: number | null
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
      sourceAgentRunId?: string
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

export type NotificationEpisodeKind = 'collaboration' | 'message' | 'approval' | 'round' | 'mission' | 'task' | 'single_chat'

export type NotificationSemantic =
  | 'approval_pending'
  | 'user_mention'
  | 'turn_completed'
  | 'turn_failed'
  | 'turn_incomplete'
  | 'round_completed'
  | 'single_chat_reply'
  | 'mission_needs_you'
  | 'mission_status_changed'
  | 'task_status_changed'

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
  | 'open_agent_run'
  | 'open_single_chat'
  | 'open_camp'
  | 'acknowledge_only'
  | 'open_mission'
  | 'open_task'

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

export interface NotificationSingleChatSource {
  conversationId: string
  agentId: string
  agentDisplayName: string
  agentRunId: string
}

export interface NotificationSubject {
  kind: 'round' | 'mission' | 'task'
  id: string
  title: string
  status: string | null
  sourceMessageId: string | null
  sourceAgentRunId: string | null
  relatedRunIds: string[]
}

export interface NotificationActionView {
  actionId: string
  kind: NotificationActionKind
  available: boolean
  threadId: string
  threadTurnId: string | null
  agentRunId: string | null
  messageId: string | null
  approvalId: string | null
  acknowledgementId: string | null
  observedEpisodeVersion: number
  singleChat?: NotificationSingleChatSource | null
  subject?: NotificationSubject | null
}

export interface NotificationEpisodeView {
  id: string
  kind: NotificationEpisodeKind
  episodeVersion: number
  attentionRevision: number
  changeSequence: number
  thread: {
    id: string
    title: string
    channelSource?: ThreadChannelSource | null
  }
  threadTurnId: string | null
  agentRunId: string | null
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
  schemaVersion: 9
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
  schemaVersion: 9
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
  singleChatHeadsUpEnabled: boolean
  missionNeedsYouHeadsUpEnabled: boolean
  missionStatusHeadsUpEnabled: boolean
  taskStatusHeadsUpEnabled: boolean
  missionStatuses: Exclude<MissionStatus, 'needs_you'>[]
  taskStatuses: TaskStatus[]
  version: number
  updatedAt: string
}

export interface CoreEvent<T = unknown> {
  method: string
  params: T
}

export interface StructuredError {
  code: string
  message: string
  retryable: boolean
  details: unknown
}

export type RovaiRequestFailureKind =
  | 'domain_rejection'
  | 'infrastructure_failure'
  | 'full_core_unavailable'
  | 'shutdown'

export interface RovaiRequestFailure extends StructuredError {
  kind: RovaiRequestFailureKind
  generation: number
}

export type RovaiRequestTransport<T> =
  | { kind: 'value'; value: T }
  | { kind: 'failure'; failure: RovaiRequestFailure }

export type RuntimeMode = 'bootstrap_only' | 'full_core'
export type FullCoreState =
  | 'idle'
  | 'starting'
  | 'ready'
  | 'blocked'
  | 'crashed'
  | 'shutting_down'

export type StartupPhase =
  | 'lease'
  | 'assessing_authority'
  | 'preparing_runtime_storage'
  | 'preparing_windows_data_root'
  | 'recovering_authority'
  | 'opening_authority'
  | 'initializing_authority'
  | 'migrating_authority'
  | 'migration_failed'

export type AuthorityState =
  | { kind: 'unknown' }
  | { kind: 'assessing' }
  | { kind: 'confirmed_absent' }
  | { kind: 'admitted' }
  | { kind: 'current'; origin?: 'existing' | 'initialized' | 'migrated' }
  | { kind: 'migration_required' }
  | { kind: 'migration_failed' }
  | { kind: 'owned_by_active_core'; dataDir: string; owner: unknown }
  | { kind: 'blocked'; reason: unknown }

export interface DesktopCapabilities {
  authoritativeWorkspace: boolean
  coreRequests: boolean
  localPreferences: boolean
  supervisorStatus: boolean
  diagnosticsExport: boolean
  fullCoreRetry: boolean
}

export interface SupervisorSnapshot {
  schemaVersion: 1
  revision: number
  generation: number
  runtimeMode: RuntimeMode
  fullCoreState: FullCoreState
  authorityState: AuthorityState
  startupPhase: StartupPhase | null
  restartAttempt: number
  capabilities: DesktopCapabilities
  localDegradations: StructuredError[]
  coreSubsystems: CoreSubsystemSnapshot[]
  lastError: StructuredError | null
  migrationProgress: unknown | null
}

export interface CoreSubsystemSnapshot {
  id: string
  state: 'initializing' | 'ready' | 'degraded'
  error: StructuredError | null
}

export interface SupervisorApi {
  getSnapshot(): Promise<SupervisorSnapshot>
  retryFullCore(): Promise<SupervisorSnapshot>
  onChanged(listener: (snapshot: SupervisorSnapshot) => void): () => void
}

export type ThemePreference = 'system' | 'day' | 'night'
export type ResolvedTheme = 'day' | 'night'

export interface AppearancePreferences {
  preference: ThemePreference
  chatFontSize: number
  documentFontSize: number
  codeFontSize: number
  readingDensity: 'standard' | 'relaxed'
  motionPreference: 'system' | 'reduce'
  zoomPercentage: number
}

export interface AppearanceSnapshot extends AppearancePreferences {
  resolvedTheme: ResolvedTheme
  degradation?: StructuredError | null
}

export interface AppearanceApi {
  get(): Promise<AppearanceSnapshot>
  setPreference(preference: ThemePreference): Promise<AppearanceSnapshot>
  updatePreferences(preferences: Partial<AppearancePreferences>): Promise<AppearanceSnapshot>
  onChanged(listener: (snapshot: AppearanceSnapshot) => void): () => void
}

export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'up_to_date'
  | 'downloading'
  | 'ready_to_install'
  | 'installing'
  | 'check_failed'
  | 'download_failed'
  | 'install_failed'

export type AppUpdateFailureReason =
  | 'release_unpublished'
  | 'restart_unconfirmed'
  | 'network'
  | 'updater_unavailable'
  | 'invalid_release'
  | 'download_failed'
  | 'install_failed'

export type AppUpdateCheckSource = 'startup' | 'interval' | 'manual'

export interface AppUpdateRelease {
  version: string
  releaseName: string | null
  releaseDate: string | null
  releaseNotes: string | null
}

export interface AppUpdatePrompt {
  id: string
  version: string
}

export interface AppUpdateSnapshot {
  currentVersion: string
  /** Desktop supplies this from its bundled notes; older and Server snapshots may omit it. */
  currentRelease?: AppUpdateRelease | null
  status: AppUpdateStatus
  availableRelease: AppUpdateRelease | null
  lastCheckSource: AppUpdateCheckSource | null
  checkedAt: string | null
  lastSuccessfulCheckAt: string | null
  downloadPercent: number | null
  transferredBytes: number | null
  totalBytes: number | null
  bytesPerSecond: number | null
  failureReason: AppUpdateFailureReason | null
  pendingPrompt: AppUpdatePrompt | null
}

export interface AppUpdatesApi {
  get(): Promise<AppUpdateSnapshot>
  check(): Promise<AppUpdateSnapshot>
  download(): Promise<AppUpdateSnapshot>
  install(): Promise<boolean>
  dismissPrompt(promptId: string): Promise<boolean>
  onChanged(listener: (snapshot: AppUpdateSnapshot) => void): () => void
}

export type StartupLocationMode = 'last_location' | 'quick_chat'

export type ExecutionConsolePlacement = 'right' | 'inspector' | 'bottom'

export type SettingsSection =
  | 'remote'
  | 'general'
  | 'skills'
  | 'toolbox'
  | 'mcp'
  | 'runtime'
  | 'channels'
  | 'appearance'
  | 'notifications'
  | 'monitoring'
  | 'diagnostics'
  | 'about'

export type ChannelKind = 'feishu' | 'lark' | 'dingtalk'

export type ChannelHostStatus = 'unavailable' | 'ready'

export type ChannelConnectionStatus = 'not_connected' | 'connected' | 'session_expired'

export type ChannelPublicationStatus =
  | 'unpublished'
  | 'provisioning'
  | 'published'
  | 'failed'
  | 'disabled'

export type ChannelConversationKind = 'p2p' | 'group' | 'topic'

export type ChannelQrAttemptPurpose = 'account_login'

/** A presentation-only viewport in the trusted Rovai Renderer, never a URL. */
export interface ChannelLoginViewBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ChannelQrAttemptView {
  kind?: ChannelKind
  attemptId: string
  purpose: ChannelQrAttemptPurpose
  agentId: string | null
  stage:
    | 'loading_local_session'
    | 'preparing'
    | 'awaiting_scan'
    | 'awaiting_refresh'
    | 'scan_confirmed'
    | 'completing_login'
    | 'awaiting_interaction'
    | 'inspecting_identity'
    | 'saving_local_session'
    | 'connected'
    | 'expired'
    | 'cancelled'
    | 'failed'
  qrDataUrl: string | null
  /** Server-provided expiry only. */
  expiresAt: string | null
  /** Legacy local deadline metadata; the login dialog does not display it. */
  waitUntil?: string | null
  /** Local transaction acknowledgement is unknown; cancellation stays locked. */
  commitUncertain?: boolean
  detail: string
}

export interface ChannelAccountView {
  accountId: string
  userName: string | null
  email?: string
  tenantName: string | null
  brand: 'feishu' | 'lark' | 'dingtalk'
  connectedAt: string
  lastVerifiedAt: string
}

export interface ChannelConnectionView {
  /** Latest runtime inspection; absent older snapshots are unknown. */
  sessionStatus?: 'valid' | 'invalid' | 'unavailable' | 'unknown'
  status: ChannelConnectionStatus
  account: ChannelAccountView | null
}

export interface ChannelMemberBotView {
  /** Durable Bot publication fact, even if a later connection/retry failed. */
  published?: boolean
  /** Live transport observation, independent of durable publication status. */
  connectionStatus?: 'online' | 'offline' | 'unknown'
  agentId: string
  publicationStatus: ChannelPublicationStatus
  botDisplayName: string | null
  appId: string | null
  managementUrl: string | null
  failureCode: string | null
}

export interface MemberBotProvisioningView {
  kind?: ChannelKind
  publicationIntentId: string
  agentId: string
  stage:
    | 'verifying_session'
    | 'creating_app'
    | 'activating_app'
    | 'configuring_permissions'
    | 'waiting_configuration'
    | 'publishing_version'
    | 'verifying_configuration'
    | 'connecting_bot'
    | 'completed'
    | 'failed'
    | 'unknown_remote_state'
  detail: string
  remoteAppId: string | null
  failureCode: string | null
  approvalCandidates?: Array<{ userId: string; displayName: string }>
}

export interface ChannelProviderView {
  kind: ChannelKind
  displayName: string
  hostStatus: ChannelHostStatus
  connection: ChannelConnectionView
  memberBots: ChannelMemberBotView[]
  /** This provider's original publication progress; independent of other providers. */
  provisioning?: MemberBotProvisioningView | null
  pendingBindingCount?: number
  bindingIssueCount?: number
}

export interface ChannelSettingsSnapshot {
  schemaVersion: 4
  channels: ChannelProviderView[]
  pendingBindingCount: number
  bindingIssueCount: number
  activeQrAttempt: ChannelQrAttemptView | null
  activeProvisioning: MemberBotProvisioningView | null
}

export type ExecutionWebServerState =
  | 'disabled'
  | 'no_published_bot'
  | 'starting'
  | 'ready'
  | 'port_conflict'
  | 'no_lan_address'
  | 'error'

export interface ExecutionWebSettingsSnapshot {
  schemaVersion: 1
  enabled: boolean
  port: number
  server: {
    state: ExecutionWebServerState
    address: string | null
    errorCode: string | null
  }
}

export interface ChannelsApi {
  get(): Promise<ChannelSettingsSnapshot>
  getExecutionWebSettings(): Promise<ExecutionWebSettingsSnapshot>
  setExecutionWebSettings(
    settings: Pick<ExecutionWebSettingsSnapshot, 'enabled' | 'port'>
  ): Promise<ExecutionWebSettingsSnapshot>
  connect(kind?: ChannelKind): Promise<ChannelSettingsSnapshot>
  disconnect(kind?: ChannelKind): Promise<ChannelSettingsSnapshot>
  publishMemberBot(agentId: string, kind?: ChannelKind): Promise<ChannelSettingsSnapshot>
  retryMemberBot(agentId: string, kind?: ChannelKind): Promise<ChannelSettingsSnapshot>
  selectPublicationApprover(
    agentId: string,
    userId: string,
    kind?: ChannelKind
  ): Promise<ChannelSettingsSnapshot>
  cancelQrAttempt(attemptId: string): Promise<ChannelSettingsSnapshot>
  setLoginViewBounds(attemptId: string, bounds: ChannelLoginViewBounds | null): Promise<void>
  refreshLoginQr(attemptId: string): Promise<void>
  onChanged(listener: (snapshot: ChannelSettingsSnapshot) => void): () => void
  onExecutionWebSettingsChanged(
    listener: (snapshot: ExecutionWebSettingsSnapshot) => void
  ): () => void
}

export type MemberWorkspaceLocationTab = 'identity' | 'runtime'

export type RestorableLocation =
  | { kind: 'quick_chat' }
  | { kind: 'camp'; threadId: string }
  | { kind: 'members'; agentId: string | null; tab: MemberWorkspaceLocationTab }
  | { kind: 'memory' }

export interface NewConversationDefaults {
  memberAgentIds: string[]
  defaultLeadAgentId: string
}

export type InterfaceLanguage = 'zh-CN' | 'en'

export interface GeneralPreferencesSnapshot {
  schemaVersion: 5
  interfaceLanguage: InterfaceLanguage
  startupLocationMode: StartupLocationMode
  lastSettingsSection: SettingsSection
  executionConsolePlacement: ExecutionConsolePlacement
  newConversationDefaults: NewConversationDefaults | null
  newConversationDefaultsRequireConfirmation: boolean
  oneClickNewConversationEnabled: boolean
  worldMapEnabled: boolean
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

export type WindowCloseBehavior = 'ask' | 'tray' | 'exit'
export interface WindowCloseSnapshot {
  revision: number
  behavior: WindowCloseBehavior
  promptId: number | null
  busy: boolean
  error: 'load_failed' | 'tray_unavailable' | 'save_failed' | 'quit_failed' | null
}
export interface WindowCloseResponse {
  promptId: number
  action: 'tray' | 'exit' | 'cancel'
  remember: boolean
}
/** Windows Desktop only. Main owns the preference, prompt identity and native tray. */
export interface WindowCloseApi {
  get(): Promise<WindowCloseSnapshot>
  setBehavior(behavior: WindowCloseBehavior): Promise<WindowCloseSnapshot>
  respond(response: WindowCloseResponse): Promise<WindowCloseSnapshot>
  onChanged(listener: (snapshot: WindowCloseSnapshot) => void): () => void
}

export interface WindowResetResult {
  performed: boolean
  reason: 'fullscreen' | null
}

export interface DesktopSessionApi {
  getStartupSnapshot(): Promise<DesktopStartupSnapshot>
  getInterfaceLanguage(): Promise<InterfaceLanguage>
  commitRestorableLocation(location: RestorableLocation): Promise<void>
}

export interface GeneralPreferencesApi {
  get(): Promise<GeneralPreferencesSnapshot>
  setInterfaceLanguage(language: InterfaceLanguage): Promise<GeneralPreferencesSnapshot>
  setStartupLocationMode(mode: StartupLocationMode): Promise<GeneralPreferencesSnapshot>
  setLastSettingsSection(section: SettingsSection): Promise<GeneralPreferencesSnapshot>
  setExecutionConsolePlacement(placement: ExecutionConsolePlacement): Promise<GeneralPreferencesSnapshot>
  /** Saves the team atomically with enabling one-click when requested; otherwise preserves its current flag. */
  setNewConversationDefaults(defaults: NewConversationDefaults, enableOneClick?: boolean): Promise<GeneralPreferencesSnapshot>
  setOneClickNewConversationEnabled(enabled: boolean): Promise<GeneralPreferencesSnapshot>
  setWorldMapEnabled(enabled: boolean): Promise<GeneralPreferencesSnapshot>
  invalidateNewConversationDefaults(expectedDefaults?: NewConversationDefaults | null): Promise<GeneralPreferencesSnapshot>
}

export type OnboardingStep = 'welcome' | 'member' | 'runtime'

export interface OnboardingRuntimeSelection {
  adapterKind: AdapterKind
  model: ModelSelection | null
}

export interface OnboardingProvisioningOperation {
  memberCommandId: string
  runtimeCommandId: string
  campCommandId: string
  runtimePermissions: AdapterPermissionConfig
  memberAgentId: string | null
  memberVersionBeforeRuntime: number | null
  memberVersionAfterRuntime: number | null
  runtimeCopies: OnboardingRuntimeCopy[] | null
  quickChatThreadId: string | null
}

export interface OnboardingRuntimeCopyTarget {
  agentId: string
  expectedVersion: number
}

export interface OnboardingRuntimeCopy extends OnboardingRuntimeCopyTarget {
  commandId: string
  status: 'pending' | 'applied' | 'skipped'
}

export type OnboardingRuntimeCopyOutcome = 'applied' | 'skipped' | 'retry'

export type OnboardingSnapshot =
  | {
      schemaVersion: 3
      status: 'uninitialized'
    }
  | {
      schemaVersion: 3
      status: 'in_progress'
      step: OnboardingStep
      selectedMemberRole: BuiltinMemberAvatarRole | null
      runtimeSelection: OnboardingRuntimeSelection | null
      provisioning: OnboardingProvisioningOperation | null
    }
  | {
      schemaVersion: 3
      status: 'completed'
      origin: 'onboarding' | 'runtime_deferred' | 'existing_installation'
      completedAt: string
      selectedMemberRole: BuiltinMemberAvatarRole | null
      memberAgentId: string | null
      quickChatThreadId: string | null
    }

export interface OnboardingApi {
  get(): Promise<OnboardingSnapshot>
  showWelcome(): Promise<OnboardingSnapshot>
  completeWelcome(): Promise<OnboardingSnapshot>
  selectMember(role: BuiltinMemberAvatarRole): Promise<OnboardingSnapshot>
  showMemberSelection(): Promise<OnboardingSnapshot>
  completeMemberSelection(): Promise<OnboardingSnapshot>
  setRuntimeSelection(selection: OnboardingRuntimeSelection | null): Promise<OnboardingSnapshot>
  deferRuntimeSetup(): Promise<OnboardingSnapshot>
  beginProvisioning(
    selection: OnboardingRuntimeSelection,
    runtimePermissions: AdapterPermissionConfig
  ): Promise<OnboardingSnapshot>
  recordProvisionedMember(agentId: string, version: number): Promise<OnboardingSnapshot>
  recordProvisionedRuntime(version: number): Promise<OnboardingSnapshot>
  prepareRuntimeCopies(targets: OnboardingRuntimeCopyTarget[]): Promise<OnboardingSnapshot>
  recordRuntimeCopy(agentId: string, commandId: string, outcome: OnboardingRuntimeCopyOutcome): Promise<OnboardingSnapshot>
  recordProvisionedThread(threadId: string): Promise<OnboardingSnapshot>
  complete(): Promise<OnboardingSnapshot>
}

export interface WindowControlsApi {
  onNavigationRequested?(listener: (direction: 'back' | 'forward') => void): () => void
  onCloseTabRequested(listener: () => boolean): () => void
  getResetCapability(): Promise<WindowResetCapability>
  resetBounds(): Promise<WindowResetResult>
  popupApplicationMenu(request: WindowsApplicationMenuPopupRequest): Promise<boolean>
  onPageZoomChanged(listener: (percentage: number) => void): () => void
}

export type WindowsApplicationMenuSection = 'file' | 'edit' | 'view' | 'window'

export interface WindowsApplicationMenuPopupRequest {
  section: WindowsApplicationMenuSection
  x: number
  y: number
  sourceType: 'mouse' | 'keyboard'
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

export interface NavigationThreadReadState {
  /** Explicit local reminder; viewing new replies does not clear this intent. */
  manualUnread: boolean
  /** Explicit mark-read boundary; never changes Core's observed read cursor. */
  readThroughGlobalSequence: number
}

export interface NavigationPreferencesSnapshot {
  schemaVersion: 5
  pins: NavigationPin[]
  removedProjects: RemovedNavigationProject[]
  projectOrder: string[] | null
  projectNames: Record<string, string>
  threadReadStates: Record<string, NavigationThreadReadState>
}

export interface NavigationPreferencesApi {
  get(): Promise<NavigationPreferencesSnapshot>
  setThreadReadState(threadId: string, state: NavigationThreadReadState | null): Promise<NavigationPreferencesSnapshot>
  onChanged(listener: (snapshot: NavigationPreferencesSnapshot) => void): () => void
  replacePins(pins: NavigationPin[]): Promise<NavigationPreferencesSnapshot>
  synchronizeProjectOrder(projectKeys: string[]): Promise<NavigationPreferencesSnapshot>
  setProjectName(targetKey: string, name: string | null): Promise<NavigationPreferencesSnapshot>
  removeProject(targetKey: string, relatedThreadIds: string[]): Promise<NavigationPreferencesSnapshot>
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

export interface NativeSkillView {
  id: string
  name: string
  description: string
  entryPath: string
  canonicalPath: string
  sourceScope: 'user' | 'project'
  adapterKind: AdapterKind
}

export interface NativeSkillScan {
  skills: NativeSkillView[]
  errors: string[]
}

export interface ToolboxSkillView {
  name: string
  description: string | null
  memberIds: string[]
  version: string
  sourceError: string | null
}

export interface ComposerSkillCandidate {
  id: string
  name: string
  description: string
  source: 'toolbox' | 'native'
  sourceScope?: 'user' | 'project'
  entryPath: string
  memberIds: string[]
}

export interface ComposerSkillCandidates {
  skills: ComposerSkillCandidate[]
  errors: string[]
}

export type SkillRevisionSourceType = 'bundled' | 'local_folder' | 'github'
export type SkillDeliveryGroupKey =
  | 'codex'
  | 'pi'
  | 'opencode'
  | 'copilot'
  | 'claude_compatible'
  | 'antigravity'
  | 'kiro'
  | 'qoder'
  | 'codebuddy'
  | 'qwen'
  | 'trae'
  | 'cursor'
  | 'kimi'
  | 'grok'
  | 'zcode'
  | 'dsh'

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

export type SkillContentRequest =
  | { source: 'installed'; skillId: string; revisionId: string; path?: string }
  | { source: 'import'; stagingToken: string; candidateName: string; expectedDigest: string; path?: string }

export interface SkillContentView {
  path: string
  content: string | null
  status: 'text' | 'binary' | 'too_large'
  files: { path: string; bytes: number }[]
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
  source: 'user' | 'import'
  riskLevel: 'standard' | 'high'
  riskAcknowledged: boolean
  definitionJson: string
  configurationIssues?: McpConfigIssue[]
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

/** Ephemeral response to the user's explicit Show action; never persist in receipts or events. */
export type McpRevealResult =
  | { status: 'ok'; serverId: string; configDigest: string; definitionJson: string }
  | { status: 'conflict'; actualConfigDigest: string }
  | { status: 'invalid'; issues: McpConfigIssue[] }

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
  kind: 'normalized' | 'dropped' | 'needs_configuration' | 'blocker'
  blocking: boolean
}

export interface McpImportCandidate {
  /** Backend-proven identical name and private definition within this scan. */
  duplicateOfCandidateId?: string
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
  sourceThreadId: string | null
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
  sourceThreadId: string
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

export type AutomationNotifyChannel = 'feishu' | 'lark' | 'dingtalk'
export type AutomationWeekday =
  | 'monday' | 'tuesday' | 'wednesday' | 'thursday'
  | 'friday' | 'saturday' | 'sunday'

export type AutomationSchedule =
  | { kind: 'daily'; at: string }
  | { kind: 'weekdays'; at: string }
  | { kind: 'weekly'; weekday: AutomationWeekday; at: string }
  | { kind: 'once'; date: string; at: string }
  | { kind: 'cron'; expression: string }
  | { kind: 'manual' }

export type AutomationProjectRef =
  | { kind: 'quick_chat' }
  | { kind: 'directory'; path: string }

export interface AutomationRunSummary {
  runId: string
  status: 'running' | 'cancelling' | 'completed' | 'failed' | 'skipped'
  reason: string | null
  scheduledFor: string
  threadId: string | null
  resultMessageId: string | null
  notificationStatus: 'none' | 'pending' | 'sent' | 'failed' | 'partial'
  createdAt: string
  endedAt: string | null
}

export interface AutomationView {
  automationId: string
  version: number
  name: string
  prompt: string
  enabled: boolean
  memberId: string
  projectRef: AutomationProjectRef
  schedule: AutomationSchedule
  notifyChannels: AutomationNotifyChannel[]
  nextRunAt: string | null
  lastRun: AutomationRunSummary | null
  createdAt: string
  updatedAt: string
}

export interface AutomationListPage {
  automations: AutomationView[]
  nextCursor: string | null
  truncated: boolean
}

export interface AutomationRunListPage {
  runs: AutomationRunSummary[]
  nextCursor: string | null
  truncated: boolean
}

export interface CreateAutomationCommand {
  name?: string
  prompt: string
  memberId: string
  projectRef: AutomationProjectRef
  schedule: AutomationSchedule
  notifyChannels: AutomationNotifyChannel[]
}

export interface UpdateAutomationCommand {
  automationId: string
  expectedVersion: number
  name?: string
  prompt?: string
  memberId?: string
  projectRef?: AutomationProjectRef
  schedule?: AutomationSchedule
  notifyChannels?: AutomationNotifyChannel[]
  enabled?: boolean
}

export type CoreMethod =
  | 'preferences.newConversation.get'
  | 'preferences.newConversation.setDefaults'
  | 'preferences.newConversation.setOneClick'
  | 'preferences.newConversation.invalidate'
  | 'preferences.newConversation.initialize'

  | 'health.check'
  | 'diagnostics.check'
  | 'monitoring.snapshot'
  | 'monitoring.execution'
  | 'runtime.discovery.rescan'
  | 'runtime.networkRecovery.wake'
  | 'runtime.subsystems.get'
  | 'runtime.subsystems.retry'
  | 'runtime.product.ensure'
  | 'runtime.product.check'
  | 'runtime.startup.get'
  | 'runtime.startup.inspect'
  | 'runtime.startup.check'
  | 'runtime.startup.save'
  | 'runtime.modelCatalog.open'
  | 'runtime.pendingExecution.cancel'
  | 'members.list'
  | 'members.get'
  | 'members.threads.list'
  | 'members.create'
  | 'members.update'
  | 'memberAvatars.read'
  | 'memberAvatars.save'
  | 'members.avatar.set'
  | 'members.runtime.set'
  | 'members.runtime.clear'
  | 'members.presence.set'
  | 'members.removalPreview'
  | 'members.remove'
  | 'members.reorder'
  | 'automations.list'
  | 'automations.get'
  | 'automations.runs.list'
  | 'missions.workspace.cleanup'
  | 'missions.cleanup.list'
  | 'missions.cleanup.retry'
  | 'missions.list'
  | 'missions.get'
  | 'missions.activity'
  | 'missions.delivery'
  | 'missions.changes'
  | 'missions.fileDiff'
  | 'missions.diffSession.release'
  | 'missions.create'
  | 'missions.update'
  | 'missions.status'
  | 'missions.start'
  | 'missions.linkPr'
  | 'automations.create'
  | 'automations.update'
  | 'automations.configureTimeLimit'
  | 'automations.close'
  | 'automations.delete'
  | 'automations.run'
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
  | 'toolbox.list'
  | 'toolbox.read'
  | 'toolbox.setMembers'
  | 'nativeSkills.list'
  | 'nativeSkills.read'
  | 'skills.candidates'
  | 'skills.content.read'
  | 'skills.deliveryGroups.list'
  | 'skills.import.inspect'
  | 'skills.import.github.inspect'
  | 'skills.import.commit'
  | 'skills.setEnabled'
  | 'skills.setGroupAssignments'
  | 'skills.delete'
  | 'skills.projections.listIssues'
  | 'skills.reconcile'
  | 'skills.cleanupLegacyEntries'
  | 'skills.projectAccess.sync'
  | 'skills.projectAccess.remove'
  | 'skills.projectAccess.restore'
  | 'skills.revealLocation'
  | 'mcp.config.get'
  | 'mcp.servers.reveal'
  | 'mcp.servers.setMembers'
  | 'mcp.config.repairPermissions'
  | 'mcp.servers.create'
  | 'mcp.servers.update'
  | 'mcp.servers.setEnabled'
  | 'mcp.assignments.set'
  | 'mcp.servers.delete'
  | 'mcp.import.scan'
  | 'mcp.import.commit'
  | 'conversations.restartNativeSession'
  | 'channels.credentials.get'
  | 'channels.credentials.listPublished'
  | 'channels.credentials.delete'
  | 'channels.developerSession.get'
  | 'channels.developerSession.replace'
  | 'channels.developerSession.delete'
  | 'channels.feishu.snapshot'
  | 'channels.feishu.account.upsert'
  | 'channels.feishu.account.commitConnection'
  | 'channels.feishu.account.disconnect'
  | 'channels.feishu.account.expire'
  | 'channels.feishu.publicationIntent.create'
  | 'channels.feishu.publicationIntent.advance'
  | 'channels.feishu.publicationIntent.storeCredential'
  | 'channels.feishu.memberBot.upsert'
  | 'channels.feishu.owner.verify'
  | 'channels.feishu.dm.startNew'
  | 'channels.feishu.pendingBinding.resolve'
  | 'channels.lark.snapshot'
  | 'channels.lark.account.upsert'
  | 'channels.lark.account.commitConnection'
  | 'channels.lark.account.disconnect'
  | 'channels.lark.account.expire'
  | 'channels.lark.publicationIntent.create'
  | 'channels.lark.publicationIntent.advance'
  | 'channels.lark.publicationIntent.storeCredential'
  | 'channels.lark.memberBot.upsert'
  | 'channels.lark.owner.verify'
  | 'channels.lark.dm.startNew'
  | 'channels.lark.pendingBinding.resolve'
  | 'channels.lark.inbound.observe'
  | 'channels.lark.inbound.attachments.complete'
  | 'channels.lark.inbound.finalize'
  | 'channels.lark.roster.reconcile'
  | 'channels.lark.deliveries.settle'
  | 'channels.lark.host.tick'
  | 'channels.lark.executionConsole.page.authorize'
  | 'channels.lark.executionConsole.recentOutput.authorize'
  | 'channels.lark.executionConsole.agentRun.cancel'
  | 'channels.dingtalk.snapshot'
  | 'channels.dingtalk.account.upsert'
  | 'channels.dingtalk.account.commitConnection'
  | 'channels.dingtalk.account.disconnect'
  | 'channels.dingtalk.account.expire'
  | 'channels.dingtalk.publicationIntent.create'
  | 'channels.dingtalk.publicationIntent.advance'
  | 'channels.dingtalk.publicationIntent.storeCredential'
  | 'channels.dingtalk.memberBot.upsert'
  | 'channels.dingtalk.owner.verify'
  | 'channels.dingtalk.dm.startNew'
  | 'channels.dingtalk.pendingBinding.resolve'
  | 'channels.dingtalk.cardActionContext'
  | 'channels.dingtalk.inbound.observe'
  | 'channels.dingtalk.inbound.attachments.complete'
  | 'channels.dingtalk.roster.reconcile'
  | 'channels.dingtalk.inbound.finalize'
  | 'channels.dingtalk.host.tick'
  | 'channels.dingtalk.executionConsole.page.authorize'
  | 'channels.dingtalk.executionConsole.recentOutput.authorize'
  | 'channels.dingtalk.executionConsole.agentRun.cancel'
  | 'channels.dingtalk.deliveries.settle'
  | 'channels.membership.add'
  | 'channels.membership.remove'
  | 'channels.inbound.observe'
  | 'channels.roster.reconcile'
  | 'channels.inbound.finalize'
  | 'channels.inbound.attachments.complete'
  | 'channels.host.tick'
  | 'channels.executionConsole.source'
  | 'channels.executionConsole.page.authorize'
  | 'channels.executionConsole.recentOutput.authorize'
  | 'channels.executionConsole.agentRun.cancel'
  | 'channels.executionConsole.webSnapshot'
  | 'channels.deliveries.settle'
  | 'thread.attachments.desktopOpenTarget'
  | 'thread.attachments.location'
  | 'app.info'
  | 'threads.creationPreflight'
  | 'workspaces.validate'
  | 'workspaces.inspect'
  | 'navigation.snapshot'
  | 'navigation.threads'
  | 'navigation.groupThreads'
  | 'navigation.findThread'
  | 'navigation.campViewed'
  | 'threads.create'
  | 'threads.discardPending'
  | 'threads.pendingDraft.setPresence'
  | 'threads.rename'
  | 'threads.members.fast.check'
  | 'threads.members.fast.set'
  | 'threads.members.add'
  | 'threads.members.removalPreview'
  | 'threads.members.remove'
  | 'threads.changeDefaultLead'
  | 'threads.reconcileDefaultLead'
  | 'threads.exists'
  | 'threads.enter'
  | 'threads.open'
  | 'threads.delete'
  | 'threads.deletionIssues'
  | 'threads.retryDeletion'
  | 'singleChat.list'
  | 'singleChat.get'
  | 'singleChat.open'
  | 'singleChat.send'
  | 'singleChat.end'
  | 'singleChat.sourceAttachments.addFromPath'
  | 'singleChat.composerDraft.removeAttachment'
  | 'singleChat.pendingInputs.addSourceAttachmentFromPath'
  | 'singleChat.pendingInputs.edit'
  | 'agentRuns.cancel'
  | 'agentRuns.diagnostic.get'
  | 'executionTrace.export'
  | 'threads.snapshot'
  | 'agentRunFileChanges.get'
  | 'agentRunImages.read'
  | 'thread.messages.page'
  | 'thread.messages.around'
  | 'thread.messages.find'
  | 'thread.messages.withdraw'
  | 'agentRunEvidence.getContent'
  | 'agentRunEvidence.list'
  | 'agentRunExecution.page'
  | 'agentRunExecution.changes'
  | 'tasks.create'
  | 'tasks.update'
  | 'tasks.list'
  | 'tasks.get'
  | 'messageQuotes.mutateDraft'
  | 'messageQuotes.capture'
  | 'thread.messages.send'
  | 'thread.messages.withdraw'
  | 'userAutomation.thread.send'
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

export type HostWebStatus = {
  addresses?: { origin: string; interface: string; recommended: boolean }[]
  listen?: string
  enabled: boolean
  origin?: string
  sessions?: number
  sessionLifetimeSeconds?: number
}

export type HostWebStartInput = {
  listen: string
  publicOrigin?: string
  allowInsecureLan: boolean
}

export interface HostWebApi {
  loginTicket(): Promise<{ ticket: string; expiresInSeconds: number }>
  token(): Promise<{ administratorToken: string }>
  status(): Promise<HostWebStatus>
  start(input: HostWebStartInput): Promise<HostWebStatus & { administratorToken: string }>
  stop(): Promise<HostWebStatus>
  rotate(): Promise<HostWebStatus & { administratorToken: string }>
}

export interface RovaiApi {
  /** Local Desktop owner only; absent on the public Web capability. */
  hostWeb?: HostWebApi
  request<T>(method: CoreMethod, params?: unknown): Promise<T>
  onEvent(listener: (event: CoreEvent) => void): () => void
  appLifecycle: {
    onPrepareQuit(listener: () => void | Promise<void>): () => void
  }
  supervisor: SupervisorApi
  userAutomation: {
    onOpenThread(listener: (request: { threadId: string }) => void): () => void
  }
  appearance: AppearanceApi
  appUpdates: AppUpdatesApi
  desktopSession: DesktopSessionApi
  currentUserProfile: CurrentUserProfileApi
  generalPreferences: GeneralPreferencesApi
  channels: ChannelsApi
  onboarding: OnboardingApi
  windowControls: WindowControlsApi
  windowClose?: WindowCloseApi
  navigationPreferences: NavigationPreferencesApi
  memberAvatars: MemberAvatarsApi
  composerAttachments: {
    prepare(threadId: string, expectedRevision: number, file: File): Promise<LocalAttachmentSourceView>
    preview(locator: LocalAttachmentOwnerLocator): Promise<AttachmentPreviewResult>
    /** Desktop-local authority restore; absent on remote/browser adapters. */
    restore?(threadId: string, attachments: LocalAttachmentSourceView[]): Promise<LocalAttachmentSourceView[]>
    /** Releases Desktop-local authority after remove, send, or Thread deletion. */
    discard?(threadId: string, attachmentRefIds?: string[]): Promise<void>
    location?(locator: LocalAttachmentOwnerLocator): Promise<string | null>
  }
  missionAttachments: MissionAttachmentsApi
  singleChatAttachments: {
    prepare(
      conversationId: string,
      expectedDraftRevision: number,
      file: File
    ): Promise<SingleChatSnapshot>
    preparePending(input: {
      threadId: string
      conversationId: string
      pendingInputId: string
      expectedRevision: number
      editToken: string
    }, file: File): Promise<SingleChatSnapshot>
    remove(
      conversationId: string,
      expectedDraftRevision: number,
      attachmentRefId: string
    ): Promise<SingleChatSnapshot>
  }
  attachments: {
    open(locator: LocalAttachmentOwnerLocator): Promise<AttachmentOpenResult>
    reveal(locator: LocalAttachmentOwnerLocator): Promise<AttachmentRevealResult>
  }
  filePreview: FilePreviewApi
  clipboard: {
    write(input: { text: string; html: string | null }): Promise<void>
  }
  selectWorkspaceDirectory(): Promise<WorkspaceSelection | null>
  revealProjectDirectory(projectPath: string): Promise<void>
  selectRuntimeExecutable(): Promise<string | null>
  selectSkillImportDirectory(): Promise<string | null>
  revealSkill(skillId: string): Promise<void>
  revealMcpConfig(): Promise<void>
  exportMemory(): Promise<string | null>
  exportDiagnostics(): Promise<string | null>
  revealDiagnosticsExport(path: string): Promise<void>
  exportMonitoring(filter: MonitoringFilter): Promise<string | null>
  revealMonitoringExport(path: string): Promise<void>
  platform: NodeJS.Platform
}

export type MissionStatus = 'needs_you' | 'not_started' | 'in_progress' | 'completed'
export interface MissionInfo { missionId: string; title: string; description: string; status: MissionStatus; sourceMessageId: string | null }
export interface MissionWorkspaceCleanupView { state: 'cleaning' | 'failed' | 'cleaned'; worktreeRemoved: boolean; branchRemoved: boolean; diagnostic: string | null }
export interface MissionRecord extends MissionInfo { number: number; hasUnread: boolean; threadId: string; projectPath: string; projectBindingKind: ProjectBindingKind; detailsVersion: number; tags: string[]; attachments: LocalAttachmentSourceView[]; createdAt: string; updatedAt: string; memberAgentIds: string[]; defaultLeadAgentId: string | null; runningAgentIds: string[]; startAvailable: boolean; workspaceEverCreated: boolean; workspaceResourcesPresent: boolean; cleanupAvailable: boolean; workspaceCleanup?: MissionWorkspaceCleanupView }
export interface MissionCreate { title: string; description: string; projectPath: string; projectBindingKind: ProjectBindingKind; memberAgentIds: string[]; defaultLeadAgentId: string; tags: string[] }
export interface MissionUpdate { missionId: string; title?: string; description?: string; tags?: string[]; expectedDetailsVersion?: number }
export interface MissionAttachmentDraft { id: string; file: File; kindHint: 'file' | 'directory' }
export interface MissionAttachmentsApi {
  create(commandId: string, command: MissionCreate, attachments: MissionAttachmentDraft[]): Promise<StoredCommandResult>
  update(commandId: string, command: MissionUpdate, keepAttachmentIds: string[], attachments: MissionAttachmentDraft[]): Promise<StoredCommandResult>
}
export interface MissionActivity { id: number; kind: string; actorType: string; actorId: string; changes: Record<string, unknown>; createdAt: string }
export interface MissionWorkspace { id: string; missionId: string; threadId: string; executionHostId: string; sourceDirectory: string; repositoryRoot: string; gitCommonDir: string; worktreePath: string; workingDirectory: string; baseBranch: string | null; managedBranch: string; baseSha: string; state: 'preparing' | 'ready' | 'cleaned' | 'cleanup_pending' | 'cleanup_failed'; cleanupWorktreeRemoved: boolean; cleanupBranchRemoved: boolean; diagnostic: string | null }
export interface MissionDelivery { threadId: string; workingDirectory: string; git: boolean; workspace: MissionWorkspace | null; pullRequests: { id: string; url: string; title: string; createdAt: string }[]; files: { attachmentId: string; displayName: string; kind: 'file' | 'directory'; fileCount: number; mediaType: string; byteSize: number; previewKind: 'image' | 'none'; messageId: string; agentId: string; createdAt: string }[] }
export interface MissionChangedFile { id: string; path: string; oldPath: string | null; kind: 'added' | 'deleted' | 'renamed' | 'copied' | 'type_changed' | 'unmerged' | 'modified'; additions: number | null; deletions: number | null; binary: boolean; oldMode: string; newMode: string }
export type CheckoutState = { kind: 'branch'; branch: string; head: string } | { kind: 'detached'; head: string } | { kind: 'unavailable' }
export interface MissionWorkspaceChangesView { checkoutState: CheckoutState; viewId: string | null; files: MissionChangedFile[] | null; diffError: string | null }
export interface MissionFileDiff { file: MissionChangedFile; patch: string; hunks: { oldStart: number; newStart: number; lines: { kind: 'addition' | 'deletion' | 'context' | 'metadata'; text: string; oldLine: number | null; newLine: number | null }[] }[] }
