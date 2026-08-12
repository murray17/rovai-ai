mod acp;
mod antigravity;
mod builtin_tool_runtime;
mod claude;
mod codex;
mod health;
mod runtime_fleet;
mod runtime_mcp;

use std::{
    collections::{BTreeMap, BTreeSet},
    future::Future,
    path::{Path, PathBuf},
    sync::Arc,
};

use acp::{AcpCliRuntimeAdapter, AcpIncoming, AcpRuntime};
use antigravity::{
    AntigravityAppRuntimeAdapter, AntigravityDeliveredFailure, AntigravityInputAccepted,
    AntigravityRunRequest,
};
use anyhow::{Context, Result};
use builtin_tool_runtime::{
    BuiltinToolLeaseRegistry, BuiltinToolProcessConfig, builtin_tool_socket_path,
    bundled_cli_executable, request_digest,
};
use claude::{
    ClaudeCodeCliRuntimeAdapter, ClaudeCodeDeliveredFailure, ClaudeCodeInputAccepted,
    ClaudeCodeRunRequest,
};
use codex::{
    CodexAgentRunRuntimeRequest, CodexAgentThreadOptions, CodexCliRuntimeAdapter, CodexIncoming,
    CodexRuntime,
};
use rovai_core::{
    action::{
        AcknowledgeRuntimeDeliveryCommand, AcquireRuntimeDeliveryCommand, ActionControlMode,
        ActionResultOutcome, ActionSafetyService, ClaimActionCommand,
        ConfirmRuntimeRequestResolvedCommand, FailRuntimeDeliveryCommand,
        MarkActionDispatchStartedCommand, PrepareActionCommand, ReconcileRuntimeLossCommand,
        RecordActionResultCommand, RecordObservedActionCommand, ResolveActionApprovalCommand,
    },
    agent_profile::{
        AdapterInstallationView, AdapterKind, AgentProfileService,
        ClearMemberRuntimeConfigurationCommand, CreateAdapterInstallationCommand,
        CreateAgentProfileCommand, FrozenAgentRuntimeConfig, InstallationClass,
        ManagedProbeFailure, RecordAdapterCapabilitySnapshotCommand, RemoveMemberCommand,
        ReorderAgentProfilesCommand, RuntimeReadinessStatus, SetAgentProfileAvatarCommand,
        SetMemberPresenceCommand, SetMemberRuntimeConfigurationCommand,
        UpdateAdapterInstallationCommand, UpdateAgentProfileCommand, VerifiedManagedInstallation,
    },
    agent_runtime_adapter::{
        AcpProbeObservation, AgentRuntimeAdapterRegistry, AntigravityProbeObservation,
        ClaudeCodeProbeObservation, CodexProbeObservation, ExecutableIntegrityStatus,
        executable_fingerprint as fingerprint_executable, verify_executable_integrity,
    },
    builtin_tool_transport::{
        BUILTIN_TOOL_CONTRACT_VERSION, BUILTIN_TOOL_IPC_PROTOCOL_VERSION,
        BUILTIN_TOOL_MAX_IPC_REQUEST_BYTES, BuiltinToolError, BuiltinToolInvocationEnvelope,
        BuiltinToolIpcRequest, BuiltinToolIpcRequestBody, BuiltinToolIpcResponse,
        COMPACTION_HOOK_IPC_PROTOCOL_VERSION, CompactionHookIpcRequest, CompactionHookIpcResponse,
        builtin_tool_catalog_digest, builtin_tool_description, recovery_for_error_code,
    },
    camp_attachment::CampAttachmentStore,
    camp_content::StructuredCampMessageContent,
    camp_history::{
        CAMP_LIST_TOOL_NAME, CAMP_READ_TOOL_NAME, CAMP_SEARCH_TOOL_NAME, CampHistoryService,
        CampListInput, CampReadInput, CampSearchInput, HISTORY_SEARCH_TOOL_NAME,
        HistorySearchInput, invalid_input_error,
    },
    collaboration::{
        CampActivationState, CampCollaborationMode, ChangeDefaultLeadCommand, CollaborationService,
        CreateCampCommand, CreateTaskCommand, DeleteCampCommand, DiscardPendingCampCommand,
        ExecutionRequest, ProjectBindingKind, ReconcileDefaultLeadCommand, RenameCampCommand,
        SendUserCampDraftCommand, TaskAcceptanceCriteriaUpdate, TaskAssigneeFilter,
        TaskAssigneeUpdate, TaskListQuery, TaskStatus, UpdateTaskCommand,
    },
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandGatewayError, CommandResultStatus,
        DomainCommandGateway, canonical_json_digest,
    },
    compaction::{
        CompactionDetectorPolicy, CompactionObservationResult, DesiredCompactionDetectorPolicies,
        EstablishCompactionObserverLease, SubmitCompactionObservation,
        active_observer_lease_for_relay, admitted_hook_compaction_signal,
        establish_compaction_observer_lease, fence_active_observers_for_host,
        fence_active_observers_on_core_start, reconcile_compaction_observation_outbox,
        reconcile_detector_policies, submit_compaction_observation,
    },
    context::{
        CharterDeliveryMode, ContextMaterialization, ContextPayloadTooLarge, ContextService,
        DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES, MaterializeContextRequest, PreparedContext,
        RuntimeInputDelivery,
    },
    core_data_dir_lock::CoreDataDirLock,
    current_user::CURRENT_USER_ID,
    db::Database,
    diagnostics::{
        DiagnosticCheck, DiagnosticGroup, DiagnosticStatus, DiagnosticsReport, aggregate_counts,
        database_integrity_check, diagnostics_export_v5,
    },
    execution_budget::camp_turn_execution_budget_now,
    execution_evidence::{AgentRunExecutionEvidence, ExecutionEvidenceService},
    git,
    managed_blob::ManagedBlobStore,
    mcp::{
        CommitMcpImportParams, CreateMcpServerParams, DeleteMcpServerParams, McpConfigStore,
        SetMcpAssignmentParams, SetMcpServerEnabledParams, UpdateMcpServerParams,
    },
    mcp_import::McpImportScanner,
    mcp_projection::{McpProjectionRequest, McpProjectionService, PreparedMcpProjection},
    memory::{
        AcceptHearthMemoryProposalCommand, CreateMemoryCommand, ForgetMemoryCommand, MemoryService,
        ReactivateMemoryCommand, RejectHearthMemoryProposalCommand,
        RejectHearthMemoryProposalsCommand, RetireMemoryCommand, ReviseMemoryCommand,
        ScheduleMemoryReviewCommand, SupersedeMemoriesCommand,
    },
    memory_retrieval::{
        MEMORY_READ_TOOL_NAME, MEMORY_SEARCH_TOOL_NAME, MemoryReadInput, MemoryRetrievalInvocation,
        MemoryRetrievalService, MemorySearchInput,
    },
    memory_tool::{
        HearthProposalToolInput, HearthProposalToolInvocation, MEMORY_PROPOSE_HEARTH_TOOL_NAME,
        MEMORY_WRITE_TOOL_NAME, MemoryToolService, MemoryWriteToolInput, MemoryWriteToolInvocation,
    },
    message_delivery::{
        CAMP_MESSAGE_SEND_TOOL_NAME, CancelMessageDeliveryCommand, DeliveryDispatchTrigger,
        MessageDeliveryService, RetryMessageDeliveryCommand, dispatch_pending_for_recipient,
        mark_unstarted_deliveries_interrupted_before_dispatch, runtime_waiting_camps,
        runtime_waiting_recipients,
    },
    notification::{
        ClearInAppNotificationCommand, ClearReadInAppNotificationsCommand, InAppNotificationFilter,
        InAppNotificationService, MarkAllInAppNotificationsReadCommand,
        MarkCampInAppNotificationsReadCommand, MarkInAppNotificationReadCommand,
        UpdateInAppNotificationPreferenceCommand,
    },
    planned_shutdown::{
        ActiveExecutionKey, ActiveExecutionSnapshot, ExecutionLaunchPermit,
        PlannedShutdownCoordinator, RuntimeRouteBinding, RuntimeTerminalObservation,
        RuntimeTerminalOutcome, TerminalSettlementPermit,
    },
    read_model::{READ_MODEL_SCHEMA_VERSION, ReadModelService},
    runtime::{
        AcknowledgeAgentRunCancellationCommand, AgentRunCancellationCandidate, AgentRunExecution,
        BindNativeSessionCommand, CancelCampTurnCommand, ClaimAgentRunCommand,
        ExecutionRuntimeService, FailAgentRunCommand, MissingSendRecoveryBoundary,
        MissingSendRecoveryCandidate, NativeSessionResumeDisposition, NativeSessionResumeFailure,
        PermissionSemantics, PlannedShutdownAbortiveTerminal, RebindAgentRunRuntimeCommand,
        RecordCancelledAgentRunEndingGitObservationCommand, RejectAgentRunDispatchCommand,
        ResolveAcceptedInputRecoveryBlockerCommand, RestartNativeSessionCommand,
        SucceedAgentRunCommand,
    },
    runtime_discovery::{
        RuntimeDiscoveryObservation, RuntimeDiscoveryStatus, RuntimeSearchEnvironment,
        catalog_entries, discover_runtime_path, discover_runtime_version, is_executable_file,
        with_runtime_search_environment,
    },
    runtime_resolution::RuntimeResolutionService,
    skill::{
        CommitSkillImportCommand, DeleteSkillCommand, SetSkillEnabledCommand,
        SetSkillGroupAssignmentsCommand, SkillLibraryService,
    },
    skill_projection::{
        PreparedSkillExposure, ReconcileSkillProjectionsCommand, SkillProjectionReconciler,
    },
    team_tool::{
        BuiltinToolBindingCredential, CampMessageSendInput, CampMessageSendInvocation,
        TEAM_CREATE_TASK_TOOL_NAME, TEAM_GET_TASK_TOOL_NAME, TEAM_LIST_TASKS_TOOL_NAME,
        TEAM_UPDATE_TASK_TOOL_NAME, TeamCreateTaskInput, TeamGetTaskInput, TeamListTasksInput,
        TeamTaskToolInvocation, TeamToolInvocationError, TeamToolService, TeamUpdateTaskInput,
    },
    team_tool_catalog::validate_builtin_tool_input,
};
use runtime_fleet::{AgentRuntimeFleetConfig, AgentRuntimeFleetManager};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter},
    net::{UnixListener, UnixStream},
    sync::{Mutex, Notify, RwLock, mpsc, oneshot},
    time::{Duration, MissedTickBehavior},
};

const RUNTIME_CANCELLATION_INTERRUPT_TIMEOUT: Duration = Duration::from_secs(2);
const RUNTIME_CANCELLATION_FENCE_TIMEOUT: Duration = Duration::from_secs(1);
const PLANNED_SHUTDOWN_PROTOCOL_VERSION: u32 = 1;
const PLANNED_SHUTDOWN_MIN_DEADLINE_MS: u64 = 100;
const PLANNED_SHUTDOWN_MAX_DEADLINE_MS: u64 = 30_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlannedShutdownParams {
    protocol_version: u32,
    deadline_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlannedShutdownReport {
    protocol_version: u32,
    status: &'static str,
    deadline_expired: bool,
    active_executions_observed: usize,
    stop_requests_issued: usize,
    terminal_executions_settled: usize,
    unresolved_executions: usize,
}

fn parse_planned_shutdown_params(value: Value) -> Result<PlannedShutdownParams> {
    let params = serde_json::from_value::<PlannedShutdownParams>(value)
        .context("planned shutdown params are invalid")?;
    if params.protocol_version != PLANNED_SHUTDOWN_PROTOCOL_VERSION {
        anyhow::bail!("planned shutdown protocolVersion must be 1");
    }
    if !(PLANNED_SHUTDOWN_MIN_DEADLINE_MS..=PLANNED_SHUTDOWN_MAX_DEADLINE_MS)
        .contains(&params.deadline_ms)
    {
        anyhow::bail!(
            "planned shutdown deadlineMs must be between {} and {}",
            PLANNED_SHUTDOWN_MIN_DEADLINE_MS,
            PLANNED_SHUTDOWN_MAX_DEADLINE_MS
        );
    }
    Ok(params)
}

enum RuntimeIntegrityPreflight {
    Verified,
    DriftDetected(String),
}

struct RuntimeDispatchFailure {
    code: String,
    error: anyhow::Error,
    effective_version: Option<i64>,
}

fn runtime_blocker_is_refreshable(code: &str) -> bool {
    matches!(
        code,
        "runtime_snapshot_changed"
            | "runtime_snapshot_stale"
            | "runtime_path_invalid"
            | "runtime_probe_required"
    )
}

async fn run_with_cancellation_deadline<T>(
    deadline: Duration,
    operation: impl Future<Output = T>,
) -> Option<T> {
    tokio::time::timeout(deadline, operation).await.ok()
}

#[derive(Debug, Deserialize)]
struct Request {
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize)]
struct Response {
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<ErrorBody>,
}

#[derive(Debug, Serialize)]
struct ErrorBody {
    code: String,
    message: String,
}

fn request_runs_outside_main_queue(method: &str) -> bool {
    matches!(
        method,
        "health.check"
            | "diagnostics.check"
            | "diagnostics.export"
            | "runtime.installations.refresh"
            | "runtime.discovery.rescan"
            | "runtime.product.ensure"
            | "runtime.product.check"
            | "camp.messages.send"
            | "camp.attachments.prepareFromPath"
            | "campTurns.cancel"
            | "runtime.pendingExecution.cancel"
    )
}

async fn response_for_request(core: &Core, request: &Request) -> Response {
    match core.handle(request).await {
        Ok(result) => Response {
            id: request.id.clone(),
            result: Some(result),
            error: None,
        },
        Err(error) => Response {
            id: request.id.clone(),
            result: None,
            error: Some(ErrorBody {
                code: "CORE_REQUEST_FAILED".into(),
                message: format!("{error:#}"),
            }),
        },
    }
}

fn enqueue_response(output: &mpsc::UnboundedSender<String>, response: &Response) -> Result<()> {
    output
        .send(serde_json::to_string(response)?)
        .map_err(|_| anyhow::anyhow!("output writer stopped unexpectedly"))
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TeamToolIpcRequest {
    native_binding_id: String,
    binding_credential: String,
    runtime_tool_call_id: String,
    tool_name: String,
    input: Value,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TeamToolIpcResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<TeamToolIpcError>,
}

#[derive(Serialize, Deserialize)]
struct TeamToolIpcError {
    code: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<Value>,
}

#[derive(Debug)]
struct BuiltinOperationError {
    code: String,
    message: String,
    details: Option<Value>,
}

impl std::fmt::Display for BuiltinOperationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for BuiltinOperationError {}

#[derive(Debug, Deserialize)]
struct WorkspaceInspectParams {
    path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SelectedWorkspaceParams {
    project_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateCampParams {
    command_id: String,
    name: Option<String>,
    workspace: Option<SelectedWorkspaceParams>,
    member_agent_ids: Vec<String>,
    default_lead_agent_id: String,
    collaboration_mode: CampCollaborationMode,
    #[serde(default)]
    activation_state: CampActivationState,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CampCreationMember {
    agent_id: String,
    display_name: String,
    member_order: i64,
    runtime_configured: bool,
    runtime_readiness: RuntimeReadinessStatus,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CampIdParams {
    camp_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExecutionEvidenceContentParams {
    camp_id: String,
    evidence_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExecutionEvidenceListParams {
    camp_id: String,
    agent_run_id: String,
    #[serde(default)]
    after_sequence: i64,
    #[serde(default = "default_execution_evidence_page_limit")]
    limit: i64,
}

fn default_execution_evidence_page_limit() -> i64 {
    500
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillIdParams {
    skill_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SyncSkillProjectAccessParams {
    removed_execution_roots: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SkillProjectAccessParams {
    execution_root: String,
}

#[derive(Debug, Deserialize)]
struct InspectSkillImportParams {
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InspectGithubSkillImportParams {
    repository_url: String,
    #[serde(default)]
    subdirectory: Option<String>,
    #[serde(default)]
    git_ref: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateTaskParams {
    command_id: String,
    camp_id: String,
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    acceptance_criteria: Vec<String>,
    assignee_agent_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateTaskParams {
    command_id: String,
    camp_id: String,
    task_id: String,
    expected_version: i64,
    title: Option<String>,
    description: Option<String>,
    #[serde(default)]
    acceptance_criteria: TaskAcceptanceCriteriaUpdate,
    status: Option<TaskStatus>,
    #[serde(default)]
    assignee: TaskAssigneeUpdate,
    blocked_reason: Option<String>,
    completion_summary: Option<String>,
    cancel_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ListTasksParams {
    camp_id: String,
    statuses: Option<Vec<TaskStatus>>,
    #[serde(default)]
    assignee: TaskAssigneeFilter,
    #[serde(default)]
    limit: usize,
    cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GetTaskParams {
    camp_id: String,
    task_id: String,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct NavigationGroupCampsParams {
    project_path: Option<String>,
    offset: Option<usize>,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AcknowledgeCampViewedParams {
    camp_id: String,
    through_global_sequence: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SendCampMessageParams {
    command_id: String,
    camp_id: String,
    draft_revision: i64,
    reply_to_camp_message_id: Option<String>,
    execution: Option<ExecutionRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CampComposerDraftParams {
    camp_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveCampComposerDraftParams {
    camp_id: String,
    expected_revision: i64,
    content: StructuredCampMessageContent,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RemovePreparedAttachmentParams {
    camp_id: String,
    expected_revision: i64,
    attachment_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrepareAttachmentFromPathParams {
    camp_id: String,
    expected_revision: i64,
    source_path: String,
    display_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AttachmentPreviewSourceParams {
    attachment_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CancelPendingExecutionParams {
    intent_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubscribeEventsParams {
    camp_id: Option<String>,
    after_global_sequence: i64,
    limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NotificationInboxParams {
    #[serde(default = "default_notification_filter")]
    filter: InAppNotificationFilter,
    cursor: Option<String>,
    #[serde(default)]
    limit: usize,
}

fn default_notification_filter() -> InAppNotificationFilter {
    InAppNotificationFilter::All
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NotificationCreatedSinceParams {
    after_sequence: i64,
    #[serde(default)]
    limit: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolveActionApprovalParams {
    command_id: String,
    camp_id: String,
    approval_id: String,
    expected_version: i64,
    option_id: String,
    reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentIdParams {
    agent_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MemoryIdParams {
    memory_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RefreshAdapterInstallationParams {
    command_id: String,
    installation_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeDiscoveryRescanParams {
    #[serde(default)]
    interactive_shell: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CheckProductRuntimeParams {
    runtime_kind: rovai_core::agent_profile::AdapterKind,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserCommandParams<P> {
    command_id: String,
    command: P,
}

struct AgentRunServerRequest<'a> {
    agent_run_id: &'a str,
    execution_epoch: i64,
    method: &'a str,
    request_id: Value,
    params: &'a Value,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ProductRuntimeDiagnostic {
    status: &'static str,
    diagnostic_code: String,
    priority: u8,
    observed_at: chrono::DateTime<chrono::Utc>,
}

struct ClaudeInputAcceptanceTarget<'a> {
    delivery_id: &'a str,
    expected_native_session_id: &'a str,
    expected_native_turn_id: &'a str,
    is_new_session: bool,
}

struct Core {
    database: Mutex<Database>,
    output: mpsc::UnboundedSender<String>,
    runtime_search_environment: RwLock<Arc<RuntimeSearchEnvironment>>,
    runtime_discovery:
        RwLock<BTreeMap<rovai_core::agent_profile::AdapterKind, RuntimeDiscoveryObservation>>,
    runtime_product_diagnostics:
        RwLock<BTreeMap<rovai_core::agent_profile::AdapterKind, ProductRuntimeDiagnostic>>,
    runtime_checking: RwLock<BTreeSet<rovai_core::agent_profile::AdapterKind>>,
    runtime_checks_scheduled: RwLock<BTreeSet<rovai_core::agent_profile::AdapterKind>>,
    runtime_check_requests: mpsc::UnboundedSender<rovai_core::agent_profile::AdapterKind>,
    compaction_detector_policies: DesiredCompactionDetectorPolicies,
    runtime_resolution_notify: Notify,
    agent_run_cancellation_notify: Notify,
    pending_execution_recovery: Mutex<()>,
    skill_library: SkillLibraryService,
    mcp_config: McpConfigStore,
    mcp_projection: McpProjectionService,
    codex_cli: CodexCliRuntimeAdapter,
    opencode_cli: AcpCliRuntimeAdapter,
    copilot_cli: AcpCliRuntimeAdapter,
    kiro_cli: AcpCliRuntimeAdapter,
    qoder_cli: AcpCliRuntimeAdapter,
    codebuddy_cli: AcpCliRuntimeAdapter,
    qwen_code: AcpCliRuntimeAdapter,
    runtime_fleet: Arc<AgentRuntimeFleetManager>,
    builtin_tool_leases: Arc<BuiltinToolLeaseRegistry>,
    claude_code_cli: ClaudeCodeCliRuntimeAdapter,
    antigravity_app: AntigravityAppRuntimeAdapter,
    planned_shutdown: Arc<PlannedShutdownCoordinator>,
    agent_run_tasks: Mutex<tokio::task::JoinSet<()>>,
    data_dir: PathBuf,
}

struct PreparedRuntimeLaunch<'a> {
    execution: &'a AgentRunExecution,
    resume_disposition: NativeSessionResumeDisposition,
    skill_exposure: &'a PreparedSkillExposure,
    mcp_projection: &'a PreparedMcpProjection,
    attachment_access_root: &'a Path,
    output: &'a mpsc::UnboundedSender<String>,
    launch_permit: &'a mut ExecutionLaunchPermit,
}

enum AgentRunRuntime {
    Codex(Arc<CodexRuntime>),
    Acp(Arc<AcpRuntime>),
}

fn data_directory_check(data_dir: &Path, observed_at: &str) -> DiagnosticCheck {
    match std::fs::metadata(data_dir) {
        Ok(metadata) if metadata.is_dir() && !metadata.permissions().readonly() => {
            DiagnosticCheck::new(
                "data-directory",
                DiagnosticGroup::LocalDependencies,
                "data_directory",
                "应用数据目录",
                DiagnosticStatus::Ok,
                "data_directory_ready",
                "Application data directory is available to the running Core",
            )
            .with_observed_at(observed_at)
        }
        Ok(_) => DiagnosticCheck::new(
            "data-directory",
            DiagnosticGroup::LocalDependencies,
            "data_directory",
            "应用数据目录",
            DiagnosticStatus::Attention,
            "data_directory_not_writable",
            "Application data directory is not a writable directory",
        )
        .with_observed_at(observed_at),
        Err(_) => DiagnosticCheck::new(
            "data-directory",
            DiagnosticGroup::LocalDependencies,
            "data_directory",
            "应用数据目录",
            DiagnosticStatus::Unknown,
            "data_directory_inspection_failed",
            "Application data directory could not be confirmed",
        )
        .with_observed_at(observed_at),
    }
}

fn git_diagnostic_check(git: &Value, observed_at: &str) -> DiagnosticCheck {
    let installed = git
        .get("installed")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let version = git
        .get("version")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    if installed {
        DiagnosticCheck::new(
            "git",
            DiagnosticGroup::LocalDependencies,
            "git",
            "Git",
            DiagnosticStatus::Ok,
            "git_available",
            "Git is available from the current Runtime search environment",
        )
        .with_observed_at(observed_at)
        .with_fact("version", version)
    } else {
        DiagnosticCheck::new(
            "git",
            DiagnosticGroup::LocalDependencies,
            "git",
            "Git",
            DiagnosticStatus::Attention,
            "git_not_available",
            "Git is not available from the current Runtime search environment",
        )
        .with_observed_at(observed_at)
    }
}

fn runtime_diagnostic_checks(
    runtime_health: &Value,
    used_runtime_counts: &BTreeMap<AdapterKind, usize>,
    runtime_usage_known: bool,
    checked_at: &str,
) -> Vec<DiagnosticCheck> {
    let catalog = runtime_health
        .get("runtimeCatalog")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            Some((
                entry.get("runtimeKind")?.as_str()?.to_string(),
                entry.get("displayName")?.as_str()?.to_string(),
            ))
        })
        .collect::<BTreeMap<_, _>>();
    let availability = runtime_health
        .get("runtimeAvailability")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    AdapterKind::ALL
        .into_iter()
        .map(|kind| {
            let current = availability.iter().find(|candidate| {
                candidate.get("runtimeKind").and_then(Value::as_str) == Some(kind.as_str())
            });
            let runtime_status = current
                .and_then(|candidate| candidate.get("status"))
                .and_then(Value::as_str)
                .unwrap_or("detecting");
            let used_by = used_runtime_counts.get(&kind).copied().unwrap_or_default();
            let label = catalog
                .get(kind.as_str())
                .cloned()
                .unwrap_or_else(|| runtime_display_name(kind).to_string());
            let observed_at = current
                .and_then(|candidate| candidate.get("discovery"))
                .and_then(|discovery| discovery.get("observedAt"))
                .and_then(Value::as_str)
                .unwrap_or(checked_at);

            let (status, code, detail, stale) = if !runtime_usage_known {
                (
                    DiagnosticStatus::Unknown,
                    "runtime_usage_unavailable",
                    "Current member Runtime selections could not be read",
                    false,
                )
            } else if used_by == 0 {
                (
                    DiagnosticStatus::Ok,
                    "runtime_not_in_use",
                    "Runtime is not selected by any current member",
                    false,
                )
            } else {
                match runtime_status {
                    "ready" => (
                        DiagnosticStatus::Ok,
                        "runtime_ready",
                        "Runtime is available for current members",
                        false,
                    ),
                    "refresh_failed_using_last_success" => (
                        DiagnosticStatus::Unknown,
                        "runtime_refresh_failed_using_last_success",
                        "Latest check failed; the previous successful evidence is retained",
                        true,
                    ),
                    "detecting" | "found_uninspected" | "checking" => (
                        DiagnosticStatus::Unknown,
                        "runtime_check_incomplete",
                        "Current Runtime evidence is incomplete",
                        false,
                    ),
                    "authentication_required" => (
                        DiagnosticStatus::Attention,
                        "runtime_authentication_required",
                        "Runtime requires user authentication",
                        false,
                    ),
                    "missing" => (
                        DiagnosticStatus::Attention,
                        "runtime_missing",
                        "Runtime is selected by a current member but is not installed",
                        false,
                    ),
                    "incompatible" => (
                        DiagnosticStatus::Attention,
                        "runtime_incompatible",
                        "Installed Runtime version is not supported",
                        false,
                    ),
                    "path_missing" => (
                        DiagnosticStatus::Attention,
                        "runtime_path_missing",
                        "Configured Runtime executable is no longer available",
                        false,
                    ),
                    "disabled" => (
                        DiagnosticStatus::Attention,
                        "runtime_disabled",
                        "Runtime is disabled while current members still select it",
                        false,
                    ),
                    _ => (
                        DiagnosticStatus::Unknown,
                        "runtime_status_unknown",
                        "Runtime availability could not be confirmed",
                        false,
                    ),
                }
            };

            let mut check = DiagnosticCheck::new(
                format!("runtime:{}", kind.as_str()),
                DiagnosticGroup::AgentRuntimes,
                "runtime",
                label,
                status,
                code,
                detail,
            )
            .with_subject_id(kind.as_str())
            .with_observed_at(observed_at)
            .with_stale(stale)
            .with_fact("usedByMemberCount", used_by.to_string())
            .with_fact("availabilityStatus", runtime_status);
            if let Some(version) = current
                .and_then(|candidate| candidate.get("reportedVersion"))
                .and_then(Value::as_str)
            {
                check = check.with_fact("reportedVersion", version);
            }
            if let Some(code) = current
                .and_then(|candidate| candidate.get("diagnosticCode"))
                .and_then(Value::as_str)
            {
                check = check.with_fact("diagnosticCode", code);
            }
            if let Some(last_success) = current
                .and_then(|candidate| candidate.get("lastSuccessfulProbeAt"))
                .and_then(Value::as_str)
            {
                check = check.with_fact("lastSuccessfulProbeAt", last_success);
            }
            check
        })
        .collect()
}

fn runtime_display_name(kind: AdapterKind) -> &'static str {
    match kind {
        AdapterKind::CodexCli => "Codex CLI",
        AdapterKind::OpencodeCli => "OpenCode",
        AdapterKind::CopilotCli => "GitHub Copilot CLI",
        AdapterKind::ClaudeCodeCli => "Claude Code",
        AdapterKind::KiroCli => "Kiro CLI",
        AdapterKind::QoderCli => "Qoder CLI",
        AdapterKind::CodebuddyCli => "CodeBuddy CLI",
        AdapterKind::QwenCode => "Qwen Code",
        AdapterKind::AntigravityApp => "Antigravity",
    }
}

impl AgentRunRuntime {
    fn adapter_kind(&self) -> rovai_core::agent_profile::AdapterKind {
        match self {
            Self::Codex(_) => rovai_core::agent_profile::AdapterKind::CodexCli,
            Self::Acp(runtime) => runtime.adapter_kind(),
        }
    }

    fn component_id(&self) -> String {
        format!("runtime-adapter:{}", self.adapter_kind().as_str())
    }

    async fn respond(&self, id: Value, result: Value) -> Result<()> {
        match self {
            Self::Codex(runtime) => runtime.respond(id, result).await,
            Self::Acp(runtime) => runtime.respond(id, result).await,
        }
    }

    async fn authorize_file_write(&self, action_kind: &str, request: &Value) -> Result<()> {
        if let Self::Acp(runtime) = self
            && action_kind == "file_write"
        {
            runtime.authorize_file_write(request).await?;
        }
        Ok(())
    }

    async fn cancel(&self) -> Result<()> {
        match self {
            Self::Codex(runtime) => runtime.interrupt().await,
            Self::Acp(runtime) => runtime.cancel().await,
        }
    }
}

impl Core {
    fn known_agent_ids(database: &Database) -> Result<BTreeSet<String>> {
        AgentProfileService::default().all_profile_ids(database)
    }

    fn mark_skill_projections_dirty_best_effort(
        &self,
        database: &mut Database,
        cleanup_required: bool,
    ) {
        if let Err(error) =
            SkillProjectionReconciler.mark_observed_roots_dirty(database, cleanup_required)
        {
            eprintln!("failed to mark Skill projections dirty: {error:#}");
        }
    }

    async fn reconcile_skill_projection_after_run_terminal(&self, execution_root: &str) {
        let mut database = self.database.lock().await;
        if let Err(error) = SkillProjectionReconciler.reconcile_after_run_terminal(
            &mut database,
            &self.skill_library,
            Path::new(execution_root),
        ) {
            eprintln!(
                "failed to reconcile terminal AgentRun Skill projection for {execution_root}: {error:#}"
            );
        }
    }

    async fn cleanup_mcp_projections_best_effort(&self) {
        let database = self.database.lock().await;
        if let Err(error) = self.mcp_projection.cleanup_terminal_and_orphaned(&database) {
            eprintln!("failed to clean MCP Runtime projections: {error:#}");
        }
    }

    async fn forget_deleted_camp_runtimes(&self, camp_id: &str) {
        self.codex_cli.forget_camp(camp_id).await;
    }

    async fn expire_elapsed_execution_budgets(&self, output: &mpsc::UnboundedSender<String>) {
        let observed_now = camp_turn_execution_budget_now();
        let result = {
            let mut database = self.database.lock().await;
            ExecutionRuntimeService::default().expire_elapsed_camp_turn_execution_budgets(
                &mut database,
                observed_now,
                100,
            )
        };
        match result {
            Ok(expired) if expired.is_empty() => {}
            Ok(expired) => {
                emit(
                    output,
                    "camp_turn.execution_budgets_expired",
                    json!({ "turns": expired }),
                );
                self.agent_run_cancellation_notify.notify_one();
            }
            Err(error) => eprintln!("CampTurn Execution Budget expiry failed: {error:#}"),
        }
    }

    async fn run_runtime_discovery(&self) {
        let search = self.runtime_search_environment.read().await.clone();
        self.runtime_product_diagnostics.write().await.clear();
        {
            let mut observations = self.runtime_discovery.write().await;
            for kind in rovai_core::agent_profile::AdapterKind::ALL {
                let observation = RuntimeDiscoveryObservation::detecting(kind, search.generation());
                observations.insert(kind, observation.clone());
                emit(
                    &self.output,
                    "runtime.discovery.updated",
                    serde_json::to_value(observation).unwrap_or_else(|_| json!({})),
                );
            }
        }

        let mut path_tasks = tokio::task::JoinSet::new();
        for kind in rovai_core::agent_profile::AdapterKind::ALL {
            let search = search.clone();
            path_tasks.spawn_blocking(move || discover_runtime_path(kind, &search));
        }
        let mut version_tasks = tokio::task::JoinSet::new();
        while let Some(result) = path_tasks.join_next().await {
            match result {
                Ok(observation) => {
                    self.publish_runtime_discovery(observation.clone()).await;
                    if observation.discovery_status == RuntimeDiscoveryStatus::Found {
                        let search = search.clone();
                        version_tasks.spawn(async move {
                            let mut observation = observation;
                            discover_runtime_version(&mut observation, &search).await;
                            observation
                        });
                    }
                }
                Err(error) => {
                    eprintln!("Runtime quick discovery worker failed: {error}");
                }
            }
        }
        while let Some(result) = version_tasks.join_next().await {
            match result {
                Ok(observation) => self.publish_runtime_discovery(observation).await,
                Err(error) => eprintln!("Runtime version discovery worker failed: {error}"),
            }
        }
        emit(
            &self.output,
            "runtime.discovery.completed",
            json!({ "searchEnvironment": search.summary() }),
        );
        self.schedule_runtime_checks_after_discovery().await;
    }

    async fn publish_runtime_discovery(&self, observation: RuntimeDiscoveryObservation) {
        self.runtime_discovery
            .write()
            .await
            .insert(observation.runtime_kind, observation.clone());
        emit(
            &self.output,
            "runtime.discovery.updated",
            serde_json::to_value(observation).unwrap_or_else(|_| json!({})),
        );
    }

    async fn rescan_runtime_discovery(&self, interactive_shell: bool) -> Result<Value> {
        let generation = self
            .runtime_search_environment
            .read()
            .await
            .generation()
            .saturating_add(1);
        let search = tokio::task::spawn_blocking(move || {
            RuntimeSearchEnvironment::rescan(generation, interactive_shell)
        })
        .await
        .context("Runtime Search Environment worker failed")?;
        search.activate_for_runtime_commands();
        {
            let summary = search.summary();
            let mut database = self.database.lock().await;
            database.record_runtime_search_environment_generation(
                summary.generation,
                &summary.created_at,
            )?;
        }
        *self.runtime_search_environment.write().await = Arc::new(search);
        self.run_runtime_discovery().await;
        self.runtime_health_payload().await
    }

    async fn schedule_runtime_check(&self, kind: rovai_core::agent_profile::AdapterKind) -> bool {
        {
            let mut scheduled = self.runtime_checks_scheduled.write().await;
            if !scheduled.insert(kind) {
                return false;
            }
        }
        if self.runtime_check_requests.send(kind).is_err() {
            self.runtime_checks_scheduled.write().await.remove(&kind);
            return false;
        }
        emit(
            &self.output,
            "runtime.availability.updated",
            json!({ "runtimeKind": kind, "status": "checking" }),
        );
        true
    }

    async fn ensure_runtime_check(
        &self,
        kind: rovai_core::agent_profile::AdapterKind,
    ) -> Result<bool> {
        if self.runtime_checking.read().await.contains(&kind)
            || self.runtime_checks_scheduled.read().await.contains(&kind)
        {
            return Ok(false);
        }
        let installation = {
            let database = self.database.lock().await;
            AgentProfileService::default().managed_installation(&database, kind, "default")?
        };
        let now = chrono::Utc::now();
        let needed = if let Some(installation) = installation.as_ref() {
            registered_runtime_refresh_is_due(installation, now)
                && !probe_retry_is_deferred(installation, now)
        } else {
            let discovery = self.runtime_discovery.read().await.get(&kind).cloned();
            let cached_diagnostic = self
                .runtime_product_diagnostics
                .read()
                .await
                .get(&kind)
                .cloned();
            cached_diagnostic
                .as_ref()
                .is_none_or(|diagnostic| !product_runtime_diagnostic_is_fresh(diagnostic, now))
                && discovery.is_none_or(|observation| {
                    observation.discovery_status != RuntimeDiscoveryStatus::Missing
                })
        };
        Ok(needed && self.schedule_runtime_check(kind).await)
    }

    async fn runtime_health_payload(&self) -> Result<Value> {
        let observations = self.runtime_discovery.read().await.clone();
        let product_diagnostics = self.runtime_product_diagnostics.read().await.clone();
        let mut checking = self.runtime_checking.read().await.clone();
        checking.extend(self.runtime_checks_scheduled.read().await.iter().copied());
        let installations = {
            let database = self.database.lock().await;
            AgentProfileService::default().list_installations(&database)?
        };
        let availability =
            rovai_core::agent_profile::AdapterKind::ALL
                .into_iter()
                .map(|kind| {
                    let discovery = observations
                        .get(&kind)
                        .cloned()
                        .unwrap_or_else(|| RuntimeDiscoveryObservation::detecting(kind, 0));
                    let installation = installations.iter().find(|installation| {
                        installation.adapter_kind == kind
                            && installation.installation_class
                                == rovai_core::agent_profile::InstallationClass::ManagedDefault
                            && installation.auth_scope == "default"
                    });
                    let product_diagnostic = product_diagnostics.get(&kind);
                    let is_checking = checking.contains(&kind);
                    let status = product_runtime_availability_status(
                        discovery.discovery_status,
                        installation,
                        product_diagnostic,
                        is_checking,
                    );
                    json!({
                        "runtimeKind": kind,
                        "status": status,
                        "checking": is_checking,
                        "discovery": discovery,
                        "installationId": installation.map(|installation| &installation.id),
                        "reportedVersion": installation
                            .and_then(|installation| installation.snapshot.as_ref())
                            .and_then(|snapshot| snapshot.reported_version.as_deref())
                            .or_else(|| observations
                                .get(&kind)
                                .and_then(|observation| observation.reported_version.as_deref())),
                        "diagnosticCode": installation
                            .and_then(|installation| installation.last_probe_attempt.as_ref())
                            .and_then(|attempt| attempt.diagnostic_code.as_deref())
                            .or_else(|| product_diagnostic.map(|diagnostic| diagnostic.diagnostic_code.as_str()))
                            .or(discovery.diagnostic_code.as_deref()),
                        "lastAttemptedAt": installation
                            .and_then(|installation| installation.snapshot.as_ref())
                            .map(|snapshot| snapshot.last_attempted_at.as_str())
                            .or_else(|| installation
                                .and_then(|installation| installation.last_probe_attempt.as_ref())
                                .map(|attempt| attempt.attempted_at.as_str())),
                        "lastSuccessfulProbeAt": installation
                            .and_then(|installation| installation.snapshot.as_ref())
                            .and_then(|snapshot| snapshot.last_successful_probe_at.as_deref()),
                    })
                })
                .collect::<Vec<_>>();
        Ok(json!({
            "runtimeCatalog": catalog_entries(),
            "runtimeAvailability": availability,
            "searchEnvironment": self.runtime_search_environment.read().await.summary(),
        }))
    }

    async fn diagnostics_report(&self) -> DiagnosticsReport {
        let checked_at = chrono::Utc::now().to_rfc3339();
        let git_health = serde_json::to_value(health::git_health().await).unwrap_or_else(|_| {
            json!({
                "installed": false,
                "version": null,
                "detail": "git health serialization failed"
            })
        });
        let runtime_health = self.runtime_health_payload().await;

        let mut checks = vec![
            DiagnosticCheck::new(
                "core",
                DiagnosticGroup::LocalDependencies,
                "core",
                "Rust Core",
                DiagnosticStatus::Ok,
                "core_ready",
                "Core request channel is available",
            )
            .with_observed_at(&checked_at)
            .with_fact("version", env!("CARGO_PKG_VERSION")),
            data_directory_check(&self.data_dir, &checked_at),
            git_diagnostic_check(&git_health, &checked_at),
        ];

        let mut used_runtime_counts = BTreeMap::<AdapterKind, usize>::new();
        let runtime_usage_known;
        {
            let database = self.database.lock().await;
            checks.push(database_integrity_check(&database));

            match SkillProjectionReconciler.stored_diagnostic_summary(&database) {
                Ok((0, _)) => checks.push(
                    DiagnosticCheck::new(
                        "skill-projections",
                        DiagnosticGroup::ManagedContent,
                        "skill_projections",
                        "Skill 投影",
                        DiagnosticStatus::Ok,
                        "skill_projections_ready",
                        "Stored Skill projection state has no pending reconciliation",
                    )
                    .with_observed_at(&checked_at)
                    .with_fact("issueCount", "0"),
                ),
                Ok((issue_count, codes)) => {
                    let codes = codes.into_iter().collect::<Vec<_>>().join(",");
                    checks.push(
                        DiagnosticCheck::new(
                            "skill-projections",
                            DiagnosticGroup::ManagedContent,
                            "skill_projections",
                            "Skill 投影",
                            DiagnosticStatus::Attention,
                            "skill_projections_need_reconcile",
                            "Stored Skill projection state will reconcile on the next relevant Run or explicit repair",
                        )
                        .with_observed_at(&checked_at)
                        .with_fact("issueCount", issue_count.to_string())
                        .with_fact("issueCodes", codes),
                    );
                }
                Err(_) => checks.push(
                    DiagnosticCheck::new(
                        "skill-projections",
                        DiagnosticGroup::ManagedContent,
                        "skill_projections",
                        "Skill 投影",
                        DiagnosticStatus::Unknown,
                        "skill_projection_audit_failed",
                        "Stored Skill projection state could not be confirmed",
                    )
                    .with_observed_at(&checked_at),
                ),
            }

            let known_agents = Self::known_agent_ids(&database).unwrap_or_default();
            checks.push(match self.mcp_config.inspect(&known_agents) {
                Ok(config) if !config.exists => DiagnosticCheck::new(
                    "mcp-config",
                    DiagnosticGroup::ManagedContent,
                    "mcp_config",
                    "MCP 配置",
                    DiagnosticStatus::Ok,
                    "mcp_config_not_initialized",
                    "No MCP configuration exists and no external MCP is in use",
                )
                .with_observed_at(&checked_at)
                .with_fact("serverCount", "0"),
                Ok(config) if config.file_issue.is_some() => {
                    let issue = config.file_issue.expect("checked above");
                    DiagnosticCheck::new(
                        "mcp-config",
                        DiagnosticGroup::ManagedContent,
                        "mcp_config",
                        "MCP 配置",
                        DiagnosticStatus::Attention,
                        issue.code,
                        "MCP configuration is preserved but cannot be used",
                    )
                    .with_observed_at(&checked_at)
                }
                Ok(config) if config.permission_issue => DiagnosticCheck::new(
                    "mcp-config",
                    DiagnosticGroup::ManagedContent,
                    "mcp_config",
                    "MCP 配置",
                    DiagnosticStatus::Attention,
                    "mcp_config_permissions_too_broad",
                    "MCP configuration permissions are broader than the safe 0600 mode",
                )
                .with_observed_at(&checked_at)
                .with_fact("expectedMode", "0600"),
                Ok(config) => DiagnosticCheck::new(
                    "mcp-config",
                    DiagnosticGroup::ManagedContent,
                    "mcp_config",
                    "MCP 配置",
                    DiagnosticStatus::Ok,
                    "mcp_config_ready",
                    "MCP configuration is valid and uses safe file permissions",
                )
                .with_observed_at(&checked_at)
                .with_fact("serverCount", config.servers.len().to_string()),
                Err(_) => DiagnosticCheck::new(
                    "mcp-config",
                    DiagnosticGroup::ManagedContent,
                    "mcp_config",
                    "MCP 配置",
                    DiagnosticStatus::Unknown,
                    "mcp_config_inspection_failed",
                    "MCP configuration could not be confirmed",
                )
                .with_observed_at(&checked_at),
            });

            match AgentProfileService::default().selected_runtime_counts(&database) {
                Ok(counts) => {
                    used_runtime_counts = counts;
                    runtime_usage_known = true;
                }
                Err(_) => runtime_usage_known = false,
            }
        }

        match runtime_health {
            Ok(runtime_health) => checks.extend(runtime_diagnostic_checks(
                &runtime_health,
                &used_runtime_counts,
                runtime_usage_known,
                &checked_at,
            )),
            Err(_) => checks.extend(AdapterKind::ALL.into_iter().map(|kind| {
                DiagnosticCheck::new(
                    format!("runtime:{}", kind.as_str()),
                    DiagnosticGroup::AgentRuntimes,
                    "runtime",
                    runtime_display_name(kind),
                    DiagnosticStatus::Unknown,
                    "runtime_snapshot_unavailable",
                    "Current Runtime evidence could not be read",
                )
                .with_subject_id(kind.as_str())
                .with_observed_at(&checked_at)
                .with_fact(
                    "usedByMemberCount",
                    used_runtime_counts
                        .get(&kind)
                        .copied()
                        .unwrap_or_default()
                        .to_string(),
                )
            })),
        }

        DiagnosticsReport::new(checks)
    }

    async fn pump_runtime_ready_recipients(&self, kind: AdapterKind) -> Result<()> {
        let recipients = {
            let database = self.database.lock().await;
            runtime_waiting_recipients(&database, kind.as_str())?
        };
        for (camp_id, recipient_agent_id) in recipients {
            let mut database = self.database.lock().await;
            let _ = dispatch_pending_for_recipient(
                &mut database,
                &camp_id,
                &recipient_agent_id,
                DeliveryDispatchTrigger::RuntimeReady,
                true,
            )?;
        }
        Ok(())
    }

    async fn pump_runtime_ready_recipient(&self, recipient_agent_id: &str) -> Result<()> {
        let camps = {
            let database = self.database.lock().await;
            runtime_waiting_camps(&database, recipient_agent_id)?
        };
        for camp_id in camps {
            let mut database = self.database.lock().await;
            let _ = dispatch_pending_for_recipient(
                &mut database,
                &camp_id,
                recipient_agent_id,
                DeliveryDispatchTrigger::RuntimeReady,
                true,
            )?;
        }
        Ok(())
    }

    async fn resolve_product_runtime(
        &self,
        kind: rovai_core::agent_profile::AdapterKind,
    ) -> Result<bool> {
        {
            let mut checking = self.runtime_checking.write().await;
            if !checking.insert(kind) {
                drop(checking);
                loop {
                    let notified = self.runtime_resolution_notify.notified();
                    if !self.runtime_checking.read().await.contains(&kind) {
                        let database = self.database.lock().await;
                        return managed_runtime_is_ready(&database, kind);
                    }
                    tokio::time::timeout(Duration::from_secs(90), notified)
                        .await
                        .context("timed out waiting for the active Runtime resolution")?;
                }
            }
        }
        self.runtime_product_diagnostics.write().await.remove(&kind);
        emit(
            &self.output,
            "runtime.availability.updated",
            json!({ "runtimeKind": kind, "status": "checking" }),
        );
        let result = self.resolve_product_runtime_inner(kind).await;
        self.runtime_checking.write().await.remove(&kind);
        self.runtime_resolution_notify.notify_waiters();
        emit(
            &self.output,
            "runtime.availability.updated",
            json!({
                "runtimeKind": kind,
                "status": if result.as_ref().is_ok_and(|ready| *ready) {
                    "ready"
                } else {
                    "needs_attention"
                },
            }),
        );
        result
    }

    async fn resolve_product_runtime_inner(
        &self,
        kind: rovai_core::agent_profile::AdapterKind,
    ) -> Result<bool> {
        let (existing, search) = {
            let database = self.database.lock().await;
            (
                AgentProfileService::default().managed_installation(&database, kind, "default")?,
                self.runtime_search_environment.read().await.clone(),
            )
        };
        let mut unresolved_diagnostic = None;
        let mut candidates = Vec::new();
        if let Some(installation) = existing.as_ref() {
            candidates.push((
                PathBuf::from(&installation.executable_path),
                installation.source,
            ));
        }
        candidates.extend(
            search
                .candidates(kind, std::iter::empty())
                .into_iter()
                .map(|candidate| (candidate.path, candidate.source)),
        );
        let mut dedupe = BTreeSet::new();
        candidates.retain(|(path, _)| dedupe.insert(path.clone()));

        if candidates.is_empty() {
            let mut database = self.database.lock().await;
            AgentProfileService::default().record_managed_probe_failure(
                &mut database,
                ManagedProbeFailure {
                    adapter_kind: kind,
                    auth_scope: "default",
                    candidate_path: existing
                        .as_ref()
                        .map_or(kind.command_name(), |installation| {
                            installation.executable_path.as_str()
                        }),
                    fingerprint: None,
                    source: existing.as_ref().map(|installation| installation.source),
                    failure_class: "path_missing",
                    diagnostic_code: "runtime_path_missing",
                },
            )?;
            if existing.is_none() {
                note_product_runtime_diagnostic(
                    &mut unresolved_diagnostic,
                    "path_missing",
                    "runtime_path_missing",
                );
                if let Some(diagnostic) = unresolved_diagnostic {
                    self.runtime_product_diagnostics
                        .write()
                        .await
                        .insert(kind, diagnostic);
                }
            }
            return Ok(false);
        }

        for (path, source) in candidates {
            if !is_executable_file(&path) {
                note_product_runtime_diagnostic(
                    &mut unresolved_diagnostic,
                    "path_missing",
                    "runtime_path_missing",
                );
                if existing
                    .as_ref()
                    .is_some_and(|installation| Path::new(&installation.executable_path) == path)
                {
                    let mut database = self.database.lock().await;
                    AgentProfileService::default().record_managed_probe_failure(
                        &mut database,
                        ManagedProbeFailure {
                            adapter_kind: kind,
                            auth_scope: "default",
                            candidate_path: &path.to_string_lossy(),
                            fingerprint: None,
                            source: Some(source),
                            failure_class: "path_missing",
                            diagnostic_code: "runtime_path_missing",
                        },
                    )?;
                }
                continue;
            }
            let canonical = path.canonicalize().unwrap_or(path);
            let candidate_fingerprint = match fingerprint_executable(&canonical) {
                Ok(fingerprint) => fingerprint,
                Err(error) => {
                    eprintln!(
                        "Runtime fingerprint failed for {} at {}: {error:#}",
                        kind.as_str(),
                        canonical.display()
                    );
                    let mut database = self.database.lock().await;
                    AgentProfileService::default().record_managed_probe_failure(
                        &mut database,
                        ManagedProbeFailure {
                            adapter_kind: kind,
                            auth_scope: "default",
                            candidate_path: &canonical.to_string_lossy(),
                            fingerprint: None,
                            source: Some(source),
                            failure_class: "transient",
                            diagnostic_code: "runtime_fingerprint_failed",
                        },
                    )?;
                    note_product_runtime_diagnostic(
                        &mut unresolved_diagnostic,
                        "transient",
                        "runtime_fingerprint_failed",
                    );
                    continue;
                }
            };
            let identity_changed = existing
                .as_ref()
                .and_then(|installation| installation.snapshot.as_ref())
                .and_then(|snapshot| snapshot.executable_fingerprint.as_deref())
                .is_some_and(|previous| previous != candidate_fingerprint);
            let mut lightweight = RuntimeDiscoveryObservation {
                runtime_kind: kind,
                discovery_status: RuntimeDiscoveryStatus::Found,
                executable_path: Some(canonical.to_string_lossy().to_string()),
                source: Some(source),
                reported_version: None,
                executable_fingerprint: Some(candidate_fingerprint.clone()),
                search_generation: search.generation(),
                observed_at: chrono::Utc::now().to_rfc3339(),
                diagnostic_code: None,
            };
            discover_runtime_version(&mut lightweight, &search).await;
            if lightweight.reported_version.is_none() {
                let failure_class = if identity_changed {
                    "identity_changed"
                } else {
                    "transient"
                };
                let diagnostic_code = lightweight
                    .diagnostic_code
                    .as_deref()
                    .unwrap_or("runtime_version_failed");
                let mut database = self.database.lock().await;
                AgentProfileService::default().record_managed_probe_failure(
                    &mut database,
                    ManagedProbeFailure {
                        adapter_kind: kind,
                        auth_scope: "default",
                        candidate_path: &canonical.to_string_lossy(),
                        fingerprint: Some(&candidate_fingerprint),
                        source: Some(source),
                        failure_class,
                        diagnostic_code,
                    },
                )?;
                note_product_runtime_diagnostic(
                    &mut unresolved_diagnostic,
                    failure_class,
                    diagnostic_code,
                );
                continue;
            }
            let snapshot = match with_runtime_search_environment(
                &search,
                self.deep_probe_candidate(kind, &canonical),
            )
            .await
            {
                Ok(snapshot) => snapshot,
                Err(error) => {
                    eprintln!(
                        "Runtime deep probe construction failed for {} at {}: {error:#}",
                        kind.as_str(),
                        canonical.display()
                    );
                    let failure_class = if identity_changed {
                        "identity_changed"
                    } else {
                        "transient"
                    };
                    let diagnostic_code = if identity_changed {
                        "runtime_identity_changed"
                    } else {
                        "runtime_probe_transient_failure"
                    };
                    let mut database = self.database.lock().await;
                    AgentProfileService::default().record_managed_probe_failure(
                        &mut database,
                        ManagedProbeFailure {
                            adapter_kind: kind,
                            auth_scope: "default",
                            candidate_path: &canonical.to_string_lossy(),
                            fingerprint: Some(&candidate_fingerprint),
                            source: Some(source),
                            failure_class,
                            diagnostic_code,
                        },
                    )?;
                    note_product_runtime_diagnostic(
                        &mut unresolved_diagnostic,
                        failure_class,
                        diagnostic_code,
                    );
                    continue;
                }
            };
            if snapshot.probe_status == "ready" {
                let executable_path = canonical.to_string_lossy().to_string();
                let mut database = self.database.lock().await;
                AgentProfileService::default().commit_verified_managed_installation(
                    &mut database,
                    VerifiedManagedInstallation {
                        adapter_kind: kind,
                        executable_path: executable_path.clone(),
                        command_name: kind.command_name().to_string(),
                        source,
                        auth_scope: "default".to_string(),
                        snapshot: snapshot.clone(),
                    },
                )?;
                drop(database);
                self.publish_runtime_discovery(RuntimeDiscoveryObservation {
                    runtime_kind: kind,
                    discovery_status: RuntimeDiscoveryStatus::Found,
                    executable_path: Some(executable_path),
                    source: Some(source),
                    reported_version: snapshot.reported_version,
                    executable_fingerprint: snapshot.executable_fingerprint,
                    search_generation: search.generation(),
                    observed_at: chrono::Utc::now().to_rfc3339(),
                    diagnostic_code: None,
                })
                .await;
                self.runtime_product_diagnostics.write().await.remove(&kind);
                return Ok(true);
            }
            let (failure_class, diagnostic_code) = match snapshot.probe_status.as_str() {
                "not_installed" => ("path_missing", "runtime_path_missing"),
                "authentication_required" => {
                    ("authentication_required", "runtime_authentication_required")
                }
                "missing_capabilities" => ("incompatible", "runtime_capability_incompatible"),
                _ if identity_changed => ("identity_changed", "runtime_identity_changed"),
                _ => ("transient", "runtime_probe_transient_failure"),
            };
            let mut database = self.database.lock().await;
            AgentProfileService::default().record_managed_probe_failure(
                &mut database,
                ManagedProbeFailure {
                    adapter_kind: kind,
                    auth_scope: "default",
                    candidate_path: &canonical.to_string_lossy(),
                    fingerprint: snapshot
                        .executable_fingerprint
                        .as_deref()
                        .or(Some(candidate_fingerprint.as_str())),
                    source: Some(source),
                    failure_class,
                    diagnostic_code,
                },
            )?;
            note_product_runtime_diagnostic(
                &mut unresolved_diagnostic,
                failure_class,
                diagnostic_code,
            );
        }
        if existing.is_none()
            && let Some(diagnostic) = unresolved_diagnostic
        {
            self.runtime_product_diagnostics
                .write()
                .await
                .insert(kind, diagnostic);
        }
        Ok(false)
    }

    async fn schedule_runtime_checks_after_discovery(&self) {
        let observations = self.runtime_discovery.read().await.clone();
        let (selected, installations) = {
            let database = self.database.lock().await;
            let profiles = AgentProfileService::default()
                .list_profiles(&database)
                .unwrap_or_default();
            let selected = profiles
                .into_iter()
                .filter_map(|profile| {
                    profile
                        .runtime_configuration
                        .map(|configuration| configuration.adapter_kind)
                })
                .collect::<BTreeSet<_>>();
            let installations = AgentProfileService::default()
                .list_installations(&database)
                .unwrap_or_default();
            (selected, installations)
        };
        let now = chrono::Utc::now();
        let mut scheduled = observations
            .iter()
            .filter_map(|(kind, observation)| {
                (observation.discovery_status == RuntimeDiscoveryStatus::Found).then_some(*kind)
            })
            .collect::<BTreeSet<_>>();
        for kind in selected {
            if observations.get(&kind).is_none_or(|observation| {
                observation.discovery_status != RuntimeDiscoveryStatus::Missing
            }) {
                scheduled.insert(kind);
            }
        }
        for installation in &installations {
            if !installation.enabled
                || installation.installation_class
                    != rovai_core::agent_profile::InstallationClass::ManagedDefault
                || probe_retry_is_deferred(installation, now)
            {
                continue;
            }
            scheduled.insert(installation.adapter_kind);
        }
        for kind in scheduled {
            self.schedule_runtime_check(kind).await;
        }
    }

    async fn schedule_expired_runtime_checks(&self) {
        let observations = self.runtime_discovery.read().await.clone();
        let diagnostics = self.runtime_product_diagnostics.read().await.clone();
        let installations = {
            let database = self.database.lock().await;
            AgentProfileService::default()
                .list_installations(&database)
                .unwrap_or_default()
        };
        let now = chrono::Utc::now();
        let mut registered = BTreeSet::new();
        for installation in installations {
            registered.insert(installation.adapter_kind);
            if installation.enabled
                && installation.installation_class
                    == rovai_core::agent_profile::InstallationClass::ManagedDefault
                && registered_runtime_refresh_is_due(&installation, now)
                && !probe_retry_is_deferred(&installation, now)
            {
                self.schedule_runtime_check(installation.adapter_kind).await;
            }
        }
        for (kind, observation) in observations {
            if !registered.contains(&kind)
                && observation.discovery_status == RuntimeDiscoveryStatus::Found
                && diagnostics
                    .get(&kind)
                    .is_some_and(|diagnostic| !product_runtime_diagnostic_is_fresh(diagnostic, now))
            {
                self.schedule_runtime_check(kind).await;
            }
        }
    }

    async fn recover_pending_execution_intents(&self) {
        if self.planned_shutdown.is_draining() {
            return;
        }
        let Ok(_recovery_guard) = self.pending_execution_recovery.try_lock() else {
            return;
        };
        let intents = {
            let database = self.database.lock().await;
            RuntimeResolutionService
                .recoverable(&database, 100)
                .unwrap_or_else(|error| {
                    eprintln!("failed to load Pending Execution recovery work: {error:#}");
                    Vec::new()
                })
        };
        for intent in intents {
            let result: Result<Value> = match intent.request_method.as_str() {
                "camp.messages.send" => {
                    match serde_json::from_str::<SendCampMessageParams>(&intent.payload_json) {
                        Ok(params) => self.send_test_camp_message_request(params).await,
                        Err(error) => {
                            Err(error).context("persisted pending send request is invalid")
                        }
                    }
                }
                method => Err(anyhow::anyhow!(
                    "Pending Execution recovery does not support {method}"
                )),
            };
            match result {
                Ok(value)
                    if matches!(
                        value["commandResult"]["status"].as_str(),
                        Some("accepted" | "applied")
                    ) =>
                {
                    let mut database = self.database.lock().await;
                    let _ =
                        RuntimeResolutionService.retire_after_dispatch(&mut database, &intent.id);
                }
                Ok(_) => {
                    let mut database = self.database.lock().await;
                    let _ = RuntimeResolutionService.fail(
                        &mut database,
                        &intent.id,
                        "pending_execution_dispatch_rejected",
                        None,
                    );
                }
                Err(error) => {
                    eprintln!(
                        "failed to recover Pending Execution Intent {}: {error:#}",
                        intent.id
                    );
                    let mut database = self.database.lock().await;
                    let _ = RuntimeResolutionService.fail(
                        &mut database,
                        &intent.id,
                        "pending_execution_recovery_failed",
                        None,
                    );
                }
            }
        }
    }

    async fn agent_run_runtime(
        &self,
        agent_run_id: &str,
        execution_epoch: i64,
    ) -> Option<AgentRunRuntime> {
        if let Some(runtime) = self
            .codex_cli
            .get_agent_run(agent_run_id, execution_epoch)
            .await
        {
            return Some(AgentRunRuntime::Codex(runtime));
        }
        if let Some(runtime) = self
            .opencode_cli
            .get_agent_run(agent_run_id, execution_epoch)
            .await
        {
            return Some(AgentRunRuntime::Acp(runtime));
        }
        if let Some(runtime) = self
            .copilot_cli
            .get_agent_run(agent_run_id, execution_epoch)
            .await
        {
            return Some(AgentRunRuntime::Acp(runtime));
        }
        if let Some(runtime) = self
            .kiro_cli
            .get_agent_run(agent_run_id, execution_epoch)
            .await
        {
            return Some(AgentRunRuntime::Acp(runtime));
        }
        if let Some(runtime) = self
            .qoder_cli
            .get_agent_run(agent_run_id, execution_epoch)
            .await
        {
            return Some(AgentRunRuntime::Acp(runtime));
        }
        if let Some(runtime) = self
            .codebuddy_cli
            .get_agent_run(agent_run_id, execution_epoch)
            .await
        {
            return Some(AgentRunRuntime::Acp(runtime));
        }
        self.qwen_code
            .get_agent_run(agent_run_id, execution_epoch)
            .await
            .map(AgentRunRuntime::Acp)
    }

    async fn request_planned_stop(&self, execution: &ActiveExecutionSnapshot) -> bool {
        match execution.adapter_kind {
            AdapterKind::ClaudeCodeCli => {
                if !self
                    .planned_shutdown
                    .mark_planned_stop_requested(&execution.key)
                    .await
                {
                    return false;
                }
                self.claude_code_cli
                    .interrupt(&execution.key.agent_run_id, execution.key.execution_epoch)
                    .await
            }
            AdapterKind::AntigravityApp => {
                if !self
                    .planned_shutdown
                    .mark_planned_stop_requested(&execution.key)
                    .await
                {
                    return false;
                }
                self.antigravity_app
                    .interrupt(&execution.key.agent_run_id, execution.key.execution_epoch)
                    .await
            }
            _ => {
                let Some(runtime) = self
                    .agent_run_runtime(&execution.key.agent_run_id, execution.key.execution_epoch)
                    .await
                else {
                    return false;
                };
                if !self
                    .planned_shutdown
                    .mark_planned_stop_requested(&execution.key)
                    .await
                {
                    return false;
                }
                match run_with_cancellation_deadline(
                    RUNTIME_CANCELLATION_INTERRUPT_TIMEOUT,
                    runtime.cancel(),
                )
                .await
                {
                    Some(Ok(())) => {}
                    Some(Err(error)) => eprintln!(
                        "planned stop failed for AgentRun {}: {error:#}",
                        execution.key.agent_run_id
                    ),
                    None => eprintln!(
                        "planned stop timed out for AgentRun {}",
                        execution.key.agent_run_id
                    ),
                }
                true
            }
        }
    }

    async fn abort_agent_run_tasks(&self) {
        let mut tasks = self.agent_run_tasks.lock().await;
        tasks.abort_all();
        while tasks.join_next().await.is_some() {}
    }

    async fn shutdown_all_runtimes(&self) {
        tokio::join!(
            self.codex_cli.shutdown_all(),
            self.opencode_cli.shutdown_all(),
            self.copilot_cli.shutdown_all(),
            self.kiro_cli.shutdown_all(),
            self.qoder_cli.shutdown_all(),
            self.codebuddy_cli.shutdown_all(),
            self.qwen_code.shutdown_all(),
            self.claude_code_cli.shutdown_all(),
            self.antigravity_app.shutdown_all(),
        );
        self.runtime_fleet.shutdown_all().await;
    }

    fn acp_adapter(
        &self,
        kind: rovai_core::agent_profile::AdapterKind,
    ) -> Option<&AcpCliRuntimeAdapter> {
        match kind {
            rovai_core::agent_profile::AdapterKind::OpencodeCli => Some(&self.opencode_cli),
            rovai_core::agent_profile::AdapterKind::CopilotCli => Some(&self.copilot_cli),
            rovai_core::agent_profile::AdapterKind::KiroCli => Some(&self.kiro_cli),
            rovai_core::agent_profile::AdapterKind::QoderCli => Some(&self.qoder_cli),
            rovai_core::agent_profile::AdapterKind::CodebuddyCli => Some(&self.codebuddy_cli),
            rovai_core::agent_profile::AdapterKind::QwenCode => Some(&self.qwen_code),
            rovai_core::agent_profile::AdapterKind::CodexCli
            | rovai_core::agent_profile::AdapterKind::ClaudeCodeCli
            | rovai_core::agent_profile::AdapterKind::AntigravityApp => None,
        }
    }

    async fn handle_builtin_tool_ipc(
        &self,
        request: BuiltinToolIpcRequest,
    ) -> BuiltinToolIpcResponse {
        let BuiltinToolIpcRequest {
            ipc_protocol_version,
            auth,
            body,
        } = request;
        if ipc_protocol_version != BUILTIN_TOOL_IPC_PROTOCOL_VERSION {
            return BuiltinToolIpcResponse::ipc_error(
                "builtin_tool.unsupported_ipc_version",
                "Built-in Tool IPC protocol version is unsupported",
            );
        }
        let _invocation_guard = self.builtin_tool_leases.invocation_guard().await;
        let authorized = match self.builtin_tool_leases.authenticate(&auth).await {
            Ok(authorized) => authorized,
            Err(error) => return BuiltinToolIpcResponse::ipc_error(error.code, error.message),
        };
        match body {
            BuiltinToolIpcRequestBody::Invoke {
                request_id,
                operation,
                input,
            } => {
                if uuid::Uuid::parse_str(&request_id).is_err() {
                    return BuiltinToolIpcResponse::ipc_error(
                        "builtin_tool.invalid_request_id",
                        "requestId must be a UUID",
                    );
                }
                if builtin_tool_description(&operation).is_err() {
                    return BuiltinToolIpcResponse::ipc_error(
                        "builtin_tool.unknown_operation",
                        "Requested Built-in Tool operation is unavailable",
                    );
                }
                if validate_builtin_tool_input(&operation, &input).is_err() {
                    return builtin_tool_rejection(
                        &operation,
                        &request_id,
                        "builtin_tool.invalid_input",
                        "Command input does not match the accepted arguments.",
                    );
                }
                let digest = match request_digest(&operation, &input) {
                    Ok(digest) => digest,
                    Err(error) => {
                        eprintln!("failed to digest Built-in Tool request: {error:#}");
                        return BuiltinToolIpcResponse::ipc_error(
                            "builtin_tool.invalid_input",
                            "Operation input could not be normalized",
                        );
                    }
                };
                match self
                    .builtin_tool_leases
                    .replay(&auth, &request_id, &digest)
                    .await
                {
                    Ok(Some(envelope)) => {
                        return BuiltinToolIpcResponse::Envelope { envelope };
                    }
                    Ok(None) => {}
                    Err(error) => {
                        return builtin_tool_rejection(
                            &operation,
                            &request_id,
                            error.code,
                            error.message,
                        );
                    }
                }
                let domain_response = self
                    .handle_builtin_operation(
                        TeamToolIpcRequest {
                            native_binding_id: authorized.native_binding.native_binding_id.clone(),
                            binding_credential: authorized
                                .native_binding
                                .binding_credential
                                .clone(),
                            runtime_tool_call_id: format!("builtin-cli:{request_id}"),
                            tool_name: operation.clone(),
                            input,
                        },
                        Some((authorized.agent_run_id, authorized.execution_epoch)),
                        Some(request_id.clone()),
                    )
                    .await;
                if domain_response.error.as_ref().is_some_and(|error| {
                    matches!(
                        error.code.as_str(),
                        "team_tool.binding_fenced"
                            | "team_tool.runtime_not_frozen"
                            | "team_tool.invalid_attested_run"
                    )
                }) {
                    return BuiltinToolIpcResponse::ipc_error(
                        "builtin_tool.run_not_bound",
                        "Built-in Tool CLI is not bound to the current AgentRun",
                    );
                }
                let envelope = match (domain_response.result, domain_response.error) {
                    (Some(result), None) => {
                        BuiltinToolInvocationEnvelope::success(&operation, &request_id, result)
                    }
                    (None, Some(error)) => {
                        let code = canonical_builtin_error_code(&error.code);
                        BuiltinToolInvocationEnvelope::rejected(
                            &operation,
                            &request_id,
                            BuiltinToolError {
                                recovery: recovery_for_error_code(&code),
                                code,
                                message: error.message,
                                details: error.details,
                            },
                        )
                    }
                    _ => Err(anyhow::anyhow!(
                        "domain operation returned an invalid internal result"
                    )),
                };
                let envelope = match envelope {
                    Ok(envelope) => envelope,
                    Err(error) => {
                        eprintln!("failed to form Built-in Tool envelope: {error:#}");
                        return BuiltinToolIpcResponse::ipc_error(
                            "builtin_tool.internal_error",
                            "Rovai Core could not form the operation result",
                        );
                    }
                };
                if let Err(error) = self
                    .builtin_tool_leases
                    .record(&auth, &request_id, &digest, &envelope)
                    .await
                {
                    return BuiltinToolIpcResponse::ipc_error(error.code, error.message);
                }
                BuiltinToolIpcResponse::Envelope { envelope }
            }
        }
    }

    async fn handle_compaction_hook_ipc(
        &self,
        request: CompactionHookIpcRequest,
    ) -> CompactionHookIpcResponse {
        let rejected = || CompactionHookIpcResponse { accepted: false };
        if request.kind != "compaction_observation"
            || request.ipc_protocol_version != COMPACTION_HOOK_IPC_PROTOCOL_VERSION
            || uuid::Uuid::parse_str(&request.request_id).is_err()
            || !self
                .builtin_tool_leases
                .authenticate_process(&request.process_id, &request.process_token)
                .await
        {
            return rejected();
        }
        let Ok(adapter_kind) = request.adapter_kind.parse::<AdapterKind>() else {
            return rejected();
        };
        if request.native_session_id.trim().is_empty()
            || request.source_event_digest.trim().is_empty()
        {
            return rejected();
        }
        let native_session_id = request.native_session_id.as_str();
        let hook_event_name = request.hook_event_name.as_str();
        let compact_trigger = request.trigger.as_str();
        let Some((source_signal, admission_point)) =
            admitted_hook_compaction_signal(adapter_kind, hook_event_name, compact_trigger)
        else {
            return rejected();
        };
        let source_event_digest = request.source_event_digest;
        let source_observation_id = format!("{source_signal}:{source_event_digest}");
        let observed_at = chrono::Utc::now().to_rfc3339();
        let result = {
            let mut database = self.database.lock().await;
            let observer_lease_id = match active_observer_lease_for_relay(
                &database,
                adapter_kind,
                &request.host_instance_id,
                &request.process_id,
                native_session_id,
            ) {
                Ok(Some(lease_id)) => lease_id,
                Ok(None) | Err(_) => return rejected(),
            };
            submit_compaction_observation(
                &mut database,
                &SubmitCompactionObservation {
                    observer_lease_id: &observer_lease_id,
                    source_observation_id: &source_observation_id,
                    source_signal,
                    admission_point,
                    source_event_digest: &source_event_digest,
                    observed_at: &observed_at,
                },
            )
        };
        CompactionHookIpcResponse {
            accepted: matches!(
                result,
                Ok(CompactionObservationResult::Applied { .. })
                    | Ok(CompactionObservationResult::Duplicate { .. })
            ),
        }
    }

    async fn handle_builtin_operation(
        &self,
        mut request: TeamToolIpcRequest,
        attested_run: Option<(String, i64)>,
        evidence_request_id: Option<String>,
    ) -> TeamToolIpcResponse {
        let evidence_tool_name = request.tool_name.clone();
        let evidence_input_digest = canonical_json_digest(&request.input).ok();
        let evidence_tool_call_digest = canonical_json_digest(&json!({
            "runtimeToolCallId": request.runtime_tool_call_id,
            "tool": request.tool_name,
        }))
        .ok();
        let mut evidence_run = None;
        let mut evidence_replayed = false;
        let mut evidence_receipt_id = None;
        let result: Result<Value> = async {
            let mut database = self.database.lock().await;
            let service = TeamToolService::default();
            let authenticated_run = if request.tool_name == CAMP_MESSAGE_SEND_TOOL_NAME {
                service.authenticate_public_message_binding_or_recorded_scope(
                    &database,
                    &request.native_binding_id,
                    &request.binding_credential,
                    &request.runtime_tool_call_id,
                    attested_run
                        .as_ref()
                        .map(|(agent_run_id, execution_epoch)| {
                            (agent_run_id.as_str(), *execution_epoch)
                        }),
                )?
            } else if let Some((agent_run_id, execution_epoch)) = attested_run.as_ref() {
                service.authenticate_attested_binding(
                    &database,
                    &request.native_binding_id,
                    &request.binding_credential,
                    &request.runtime_tool_call_id,
                    agent_run_id,
                    *execution_epoch,
                )?
            } else {
                service.authenticate_read_binding(
                    &database,
                    &request.native_binding_id,
                    &request.binding_credential,
                    &request.runtime_tool_call_id,
                )?
            };
            evidence_run = Some(authenticated_run.clone());
            // Scope the request identity to the authenticated Run so retries in one
            // Run replay while a later Run cannot collide with the same request ID.
            request.runtime_tool_call_id = scoped_runtime_tool_call_id(
                &authenticated_run.agent_run_id,
                &request.runtime_tool_call_id,
            );
            let operation_result = match request.tool_name.as_str() {
                CAMP_MESSAGE_SEND_TOOL_NAME => {
                    let input = serde_json::from_value::<CampMessageSendInput>(request.input)
                        .context("camp.message.send input is invalid")?;
                    let invocation = CampMessageSendInvocation {
                        native_binding_id: request.native_binding_id,
                        binding_credential: request.binding_credential,
                        runtime_tool_call_id: request.runtime_tool_call_id,
                        input,
                    };
                    let execution =
                        if let Some((agent_run_id, execution_epoch)) = attested_run.as_ref() {
                            service.send_public_message_attested(
                                &mut database,
                                &invocation,
                                agent_run_id,
                                *execution_epoch,
                            )
                        } else {
                            service.send_public_message(&mut database, &invocation)
                        }?;
                    evidence_replayed = execution.replayed;
                    evidence_receipt_id = execution.result.payload["messageId"]
                        .as_str()
                        .map(str::to_string);
                    command_execution_payload(execution)
                }
                TEAM_CREATE_TASK_TOOL_NAME => {
                    let input = serde_json::from_value::<TeamCreateTaskInput>(request.input)
                        .context("private create_task input is invalid")?;
                    let invocation = TeamTaskToolInvocation {
                        native_binding_id: request.native_binding_id,
                        binding_credential: request.binding_credential,
                        runtime_tool_call_id: request.runtime_tool_call_id,
                        input,
                    };
                    let execution =
                        if let Some((agent_run_id, execution_epoch)) = attested_run.as_ref() {
                            service.create_task_attested(
                                &mut database,
                                &invocation,
                                agent_run_id,
                                *execution_epoch,
                            )
                        } else {
                            service.create_task(&mut database, &invocation)
                        }?;
                    evidence_replayed = execution.replayed;
                    command_execution_payload(execution)
                }
                TEAM_GET_TASK_TOOL_NAME => {
                    let input = serde_json::from_value::<TeamGetTaskInput>(request.input)
                        .context("private get_task input is invalid")?;
                    let invocation = TeamTaskToolInvocation {
                        native_binding_id: request.native_binding_id,
                        binding_credential: request.binding_credential,
                        runtime_tool_call_id: request.runtime_tool_call_id,
                        input,
                    };
                    let detail =
                        if let Some((agent_run_id, execution_epoch)) = attested_run.as_ref() {
                            service.get_task_attested(
                                &database,
                                &invocation,
                                agent_run_id,
                                *execution_epoch,
                            )
                        } else {
                            service.get_task(&database, &invocation)
                        }?;
                    serde_json::to_value(detail).map_err(Into::into)
                }
                TEAM_UPDATE_TASK_TOOL_NAME => {
                    let input = serde_json::from_value::<TeamUpdateTaskInput>(request.input)
                        .context("private update_task input is invalid")?;
                    let invocation = TeamTaskToolInvocation {
                        native_binding_id: request.native_binding_id,
                        binding_credential: request.binding_credential,
                        runtime_tool_call_id: request.runtime_tool_call_id,
                        input,
                    };
                    let execution =
                        if let Some((agent_run_id, execution_epoch)) = attested_run.as_ref() {
                            service.update_task_attested(
                                &mut database,
                                &invocation,
                                agent_run_id,
                                *execution_epoch,
                            )
                        } else {
                            service.update_task(&mut database, &invocation)
                        }?;
                    evidence_replayed = execution.replayed;
                    command_execution_payload(execution)
                }
                TEAM_LIST_TASKS_TOOL_NAME => {
                    let input = serde_json::from_value::<TeamListTasksInput>(request.input)
                        .context("private list_tasks input is invalid")?;
                    let invocation = TeamTaskToolInvocation {
                        native_binding_id: request.native_binding_id,
                        binding_credential: request.binding_credential,
                        runtime_tool_call_id: request.runtime_tool_call_id,
                        input,
                    };
                    let page = if let Some((agent_run_id, execution_epoch)) = attested_run.as_ref()
                    {
                        service.list_tasks_attested(
                            &database,
                            &invocation,
                            agent_run_id,
                            *execution_epoch,
                        )
                    } else {
                        service.list_tasks(&database, &invocation)
                    }?;
                    serde_json::to_value(page).map_err(Into::into)
                }
                MEMORY_WRITE_TOOL_NAME => {
                    let input = serde_json::from_value::<MemoryWriteToolInput>(request.input)
                        .context("private memory.write input is invalid")?;
                    let invocation = MemoryWriteToolInvocation {
                        native_binding_id: request.native_binding_id,
                        binding_credential: request.binding_credential,
                        runtime_tool_call_id: request.runtime_tool_call_id,
                        input,
                    };
                    let execution =
                        if let Some((agent_run_id, execution_epoch)) = attested_run.as_ref() {
                            MemoryToolService.write_attested(
                                &mut database,
                                &invocation,
                                agent_run_id,
                                *execution_epoch,
                            )
                        } else {
                            MemoryToolService.write(&mut database, &invocation)
                        }?;
                    evidence_replayed = execution.replayed;
                    command_execution_payload(execution)
                }
                MEMORY_PROPOSE_HEARTH_TOOL_NAME => {
                    let input = serde_json::from_value::<HearthProposalToolInput>(request.input)
                        .context("private memory.propose_hearth input is invalid")?;
                    let invocation = HearthProposalToolInvocation {
                        native_binding_id: request.native_binding_id,
                        binding_credential: request.binding_credential,
                        runtime_tool_call_id: request.runtime_tool_call_id,
                        input,
                    };
                    let execution =
                        if let Some((agent_run_id, execution_epoch)) = attested_run.as_ref() {
                            MemoryToolService.propose_hearth_attested(
                                &mut database,
                                &invocation,
                                agent_run_id,
                                *execution_epoch,
                            )
                        } else {
                            MemoryToolService.propose_hearth(&mut database, &invocation)
                        }?;
                    evidence_replayed = execution.replayed;
                    command_execution_payload(execution)
                }
                MEMORY_SEARCH_TOOL_NAME => {
                    let input = serde_json::from_value::<MemorySearchInput>(request.input)
                        .context("private memory.search input is invalid")?;
                    let invocation = MemoryRetrievalInvocation {
                        native_binding_id: request.native_binding_id,
                        binding_credential: request.binding_credential,
                        runtime_tool_call_id: request.runtime_tool_call_id,
                        input,
                    };
                    let output =
                        if let Some((agent_run_id, execution_epoch)) = attested_run.as_ref() {
                            MemoryRetrievalService.search_attested(
                                &mut database,
                                &invocation,
                                agent_run_id,
                                *execution_epoch,
                            )
                        } else {
                            MemoryRetrievalService.search(&mut database, &invocation)
                        }?;
                    serde_json::to_value(output).map_err(Into::into)
                }
                MEMORY_READ_TOOL_NAME => {
                    let input = serde_json::from_value::<MemoryReadInput>(request.input)
                        .context("private memory.read input is invalid")?;
                    let invocation = MemoryRetrievalInvocation {
                        native_binding_id: request.native_binding_id,
                        binding_credential: request.binding_credential,
                        runtime_tool_call_id: request.runtime_tool_call_id,
                        input,
                    };
                    let output =
                        if let Some((agent_run_id, execution_epoch)) = attested_run.as_ref() {
                            MemoryRetrievalService.read_attested(
                                &mut database,
                                &invocation,
                                agent_run_id,
                                *execution_epoch,
                            )
                        } else {
                            MemoryRetrievalService.read(&mut database, &invocation)
                        }?;
                    serde_json::to_value(output).map_err(Into::into)
                }
                CAMP_LIST_TOOL_NAME => {
                    let input = serde_json::from_value::<CampListInput>(request.input)
                        .map_err(|_| invalid_input_error("camp.list input is invalid"))?;
                    CampHistoryService.list_camps(&mut database, &authenticated_run, &input)
                }
                CAMP_SEARCH_TOOL_NAME => {
                    let input = serde_json::from_value::<CampSearchInput>(request.input)
                        .map_err(|_| invalid_input_error("camp.search input is invalid"))?;
                    CampHistoryService.search_current_camp(
                        &mut database,
                        &authenticated_run,
                        &input,
                    )
                }
                HISTORY_SEARCH_TOOL_NAME => {
                    let input = serde_json::from_value::<HistorySearchInput>(request.input)
                        .map_err(|_| invalid_input_error("history.search input is invalid"))?;
                    CampHistoryService.search_history(&mut database, &authenticated_run, &input)
                }
                CAMP_READ_TOOL_NAME => {
                    let input = serde_json::from_value::<CampReadInput>(request.input)
                        .map_err(|_| invalid_input_error("camp.read input is invalid"))?;
                    CampHistoryService.read(&mut database, &authenticated_run, &input)
                }
                _ => Err(anyhow::anyhow!("private built-in operation is unsupported")),
            }?;
            Ok(operation_result)
        }
        .await;
        if let (Some(authenticated_run), Some(tool_call_id)) =
            (evidence_run.as_ref(), evidence_tool_call_digest)
        {
            let classified_error = result.as_ref().err().map(classify_builtin_operation_error);
            let error_code = classified_error.as_ref().map(|(code, _, _)| code);
            let raw_output_digest = result
                .as_ref()
                .ok()
                .and_then(|output| canonical_json_digest(output).ok());
            let core_envelope = evidence_request_id
                .as_deref()
                .and_then(|request_id| match result.as_ref() {
                    Ok(output) => BuiltinToolInvocationEnvelope::success(
                        &evidence_tool_name,
                        request_id,
                        output.clone(),
                    )
                    .ok(),
                    Err(error) => {
                        let (code, message, details) = classify_builtin_operation_error(error);
                        let code = canonical_builtin_error_code(&code);
                        BuiltinToolInvocationEnvelope::rejected(
                            &evidence_tool_name,
                            request_id,
                            BuiltinToolError {
                                recovery: recovery_for_error_code(&code),
                                code,
                                message,
                                details,
                            },
                        )
                        .ok()
                    }
                });
            let evidence = json!({
                "toolCallId": tool_call_id,
                "status": if result.is_ok() { "completed" } else { "failed" },
                "kind": "builtin_tool_invocation",
                "title": evidence_tool_name,
                "sourceAuthority": "core",
                "canonicalTool": evidence_tool_name,
                "authorizationDecision": "allowed",
                "rawInputDigest": evidence_input_digest,
                "rawOutputDigest": raw_output_digest,
                "errorCode": error_code,
                "idempotentReplay": evidence_replayed,
                "receiptId": evidence_receipt_id,
                "coreEnvelope": core_envelope,
            });
            let evidence_result = {
                let mut database = self.database.lock().await;
                ExecutionEvidenceService.record_builtin_tool_result(
                    &mut database,
                    &ManagedBlobStore::new(&self.data_dir),
                    &authenticated_run.agent_run_id,
                    authenticated_run.execution_epoch,
                    &evidence,
                )
            };
            if let Err(error) = evidence_result {
                eprintln!("failed to record Built-in Tool result evidence: {error:#}");
            }
        }
        match result {
            Ok(result) => TeamToolIpcResponse {
                result: Some(result),
                error: None,
            },
            Err(error) => {
                let (code, message, details) = classify_builtin_operation_error(&error);
                if code == "team_tool.internal_error" {
                    eprintln!("Built-in Tool invocation failed internally: {error:#}");
                }
                TeamToolIpcResponse {
                    result: None,
                    error: Some(TeamToolIpcError {
                        code,
                        message,
                        details,
                    }),
                }
            }
        }
    }

    async fn handle(&self, request: &Request) -> Result<Value> {
        let _ = &request.params;
        match request.method.as_str() {
            "app.info" => Ok(json!({
                "name": "Rovai-ai",
                "version": env!("CARGO_PKG_VERSION"),
                "dataDir": self.data_dir,
            })),
            "members.list" => {
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    AgentProfileService::default().list_profiles(&database)?,
                )?)
            }
            "members.get" => {
                let params: AgentIdParams = serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                let profile = AgentProfileService::default()
                    .get_profile(&database, &params.agent_id)?
                    .context("AgentProfile does not exist")?;
                Ok(serde_json::to_value(profile)?)
            }
            "members.camps.list" => {
                let params: AgentIdParams = serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    AgentProfileService::default()
                        .list_camp_memberships(&database, &params.agent_id)?,
                )?)
            }
            "members.create" => {
                let params: UserCommandParams<CreateAgentProfileCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = AgentProfileService::default().create_profile(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "members.update" => {
                let params: UserCommandParams<UpdateAgentProfileCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = AgentProfileService::default().update_profile(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "members.avatar.set" => {
                let params: UserCommandParams<SetAgentProfileAvatarCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = AgentProfileService::default().set_avatar(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "members.runtime.set" => {
                let params: UserCommandParams<SetMemberRuntimeConfigurationCommand> =
                    serde_json::from_value(request.params.clone())?;
                let adapter_kind = params.command.adapter_kind;
                let agent_id = params.command.agent_id.clone();
                let (execution, needs_resolution) = {
                    let mut database = self.database.lock().await;
                    let execution = AgentProfileService::default().set_runtime(
                        &mut database,
                        &user_command_envelope(params.command_id, params.command),
                    )?;
                    let needs_resolution = execution.result.status == CommandResultStatus::Applied
                        && !managed_runtime_is_ready(&database, adapter_kind)?;
                    if execution.result.status == CommandResultStatus::Applied {
                        self.mark_skill_projections_dirty_best_effort(&mut database, true);
                    }
                    (execution, needs_resolution)
                };
                if execution.result.status == CommandResultStatus::Applied {
                    self.runtime_fleet
                        .invalidate_runtime_config(&agent_id)
                        .await;
                }
                if needs_resolution {
                    self.ensure_runtime_check(adapter_kind).await?;
                }
                if execution.result.status == CommandResultStatus::Applied && !needs_resolution {
                    self.pump_runtime_ready_recipient(&agent_id).await?;
                }
                Ok(serde_json::to_value(execution.result)?)
            }
            "members.runtime.clear" => {
                let params: UserCommandParams<ClearMemberRuntimeConfigurationCommand> =
                    serde_json::from_value(request.params.clone())?;
                let agent_id = params.command.agent_id.clone();
                let mut database = self.database.lock().await;
                let execution = AgentProfileService::default().clear_runtime(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                if execution.result.status == CommandResultStatus::Applied {
                    self.runtime_fleet
                        .invalidate_runtime_config(&agent_id)
                        .await;
                    self.mark_skill_projections_dirty_best_effort(&mut database, true);
                }
                Ok(serde_json::to_value(execution.result)?)
            }
            "message.delivery.retry" => {
                let params: UserCommandParams<RetryMessageDeliveryCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = MessageDeliveryService::default().retry(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "message.delivery.cancel" => {
                let params: UserCommandParams<CancelMessageDeliveryCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = MessageDeliveryService::default().cancel(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "members.presence.set" => {
                let params: UserCommandParams<SetMemberPresenceCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = AgentProfileService::default().set_presence(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                if execution.result.status == CommandResultStatus::Applied {
                    self.mark_skill_projections_dirty_best_effort(&mut database, true);
                }
                Ok(serde_json::to_value(execution.result)?)
            }
            "members.removalPreview" => {
                let params: AgentIdParams = serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    AgentProfileService::default()
                        .removal_preview(&database, &params.agent_id)?
                        .context("AgentProfile does not exist")?,
                )?)
            }
            "members.remove" => {
                let params: UserCommandParams<RemoveMemberCommand> =
                    serde_json::from_value(request.params.clone())?;
                let agent_id = params.command.agent_id.clone();
                let mut database = self.database.lock().await;
                let execution = AgentProfileService::default().remove_member(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                if execution.result.status == CommandResultStatus::Applied {
                    self.runtime_fleet.invalidate_member(&agent_id).await;
                    self.mark_skill_projections_dirty_best_effort(&mut database, true);
                }
                Ok(serde_json::to_value(execution.result)?)
            }
            "members.reorder" => {
                let params: UserCommandParams<ReorderAgentProfilesCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = AgentProfileService::default().reorder_profiles(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "memory.list" => {
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    MemoryService::default().list(&database)?,
                )?)
            }
            "memory.get" => {
                let params: MemoryIdParams = serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    MemoryService::default()
                        .get(&database, &params.memory_id)?
                        .context("Memory does not exist")?,
                )?)
            }
            "memory.create" => {
                let params: UserCommandParams<CreateMemoryCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = MemoryService::default().create(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "memory.revise" => {
                let params: UserCommandParams<ReviseMemoryCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = MemoryService::default().revise(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "memory.retire" => {
                let params: UserCommandParams<RetireMemoryCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = MemoryService::default().retire(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "memory.reactivate" => {
                let params: UserCommandParams<ReactivateMemoryCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = MemoryService::default().reactivate(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "memory.forget" => {
                let params: UserCommandParams<ForgetMemoryCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = MemoryService::default().forget(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "memory.supersede" => {
                let params: UserCommandParams<SupersedeMemoriesCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = MemoryService::default().supersede(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "memory.review.schedule" => {
                let params: UserCommandParams<ScheduleMemoryReviewCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = MemoryService::default().schedule_review(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "memory.hearthProposals.list" => {
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    MemoryService::default().list_hearth_proposals(&database)?,
                )?)
            }
            "memory.hearthProposals.accept" => {
                let params: UserCommandParams<AcceptHearthMemoryProposalCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = MemoryService::default().accept_hearth_proposal(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "memory.hearthProposals.reject" => {
                let params: UserCommandParams<RejectHearthMemoryProposalCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = MemoryService::default().reject_hearth_proposal(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "memory.hearthProposals.rejectBatch" => {
                let params: UserCommandParams<RejectHearthMemoryProposalsCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = MemoryService::default().reject_hearth_proposals(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "memory.export" => {
                let database = self.database.lock().await;
                MemoryService::default().export(&database)
            }
            "runtime.installations.list" => {
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    AgentProfileService::default().list_installations(&database)?,
                )?)
            }
            "runtime.installations.create" => {
                let params: UserCommandParams<CreateAdapterInstallationCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = AgentProfileService::default().create_installation(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "runtime.installations.update" => {
                let params: UserCommandParams<UpdateAdapterInstallationCommand> =
                    serde_json::from_value(request.params.clone())?;
                let adapter_kind = {
                    let database = self.database.lock().await;
                    AgentProfileService::default()
                        .list_installations(&database)?
                        .into_iter()
                        .find(|installation| installation.id == params.command.installation_id)
                        .map(|installation| installation.adapter_kind)
                };
                let mut database = self.database.lock().await;
                let execution = AgentProfileService::default().update_installation(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                if execution.result.status == CommandResultStatus::Applied
                    && let Some(adapter_kind) = adapter_kind
                {
                    self.runtime_fleet.invalidate_adapter(adapter_kind).await;
                    self.mark_skill_projections_dirty_best_effort(&mut database, true);
                }
                Ok(serde_json::to_value(execution.result)?)
            }
            "runtime.installations.refresh" => {
                let params: RefreshAdapterInstallationParams =
                    serde_json::from_value(request.params.clone())?;
                self.refresh_adapter_installation(params).await
            }
            "skills.list" => {
                let database = self.database.lock().await;
                Ok(serde_json::to_value(self.skill_library.list(&database)?)?)
            }
            "skills.get" => {
                let params: SkillIdParams = serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                let skill = self
                    .skill_library
                    .get(&database, &params.skill_id)?
                    .context("Skill does not exist")?;
                Ok(serde_json::to_value(skill)?)
            }
            "skills.deliveryGroups.list" => {
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    self.skill_library.list_delivery_groups(&database)?,
                )?)
            }
            "skills.projectAccess.sync" => {
                let params: SyncSkillProjectAccessParams =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                SkillProjectionReconciler.synchronize_removed_execution_roots(
                    &mut database,
                    &params.removed_execution_roots,
                )?;
                Ok(json!({
                    "removedRootCount": params.removed_execution_roots.len(),
                }))
            }
            "skills.projectAccess.remove" => {
                let params: SkillProjectAccessParams =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                Ok(serde_json::to_value(
                    SkillProjectionReconciler.remove_execution_root(
                        &mut database,
                        &self.skill_library,
                        Path::new(&params.execution_root),
                    )?,
                )?)
            }
            "skills.projectAccess.restore" => {
                let params: SkillProjectAccessParams =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                Ok(serde_json::to_value(
                    SkillProjectionReconciler
                        .restore_execution_root(&mut database, &params.execution_root)?,
                )?)
            }
            "skills.revealLocation" => {
                let params: SkillIdParams = serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                let path = self
                    .skill_library
                    .reveal_location(&database, &params.skill_id)?;
                Ok(json!({
                    "skillId": params.skill_id,
                    "path": path.to_string_lossy(),
                }))
            }
            "mcp.config.get" => {
                let database = self.database.lock().await;
                let known_agents = Self::known_agent_ids(&database)?;
                Ok(serde_json::to_value(self.mcp_config.get(&known_agents)?)?)
            }
            "mcp.config.repairPermissions" => {
                let database = self.database.lock().await;
                let known_agents = Self::known_agent_ids(&database)?;
                self.mcp_config.repair_permissions()?;
                Ok(serde_json::to_value(self.mcp_config.get(&known_agents)?)?)
            }
            "mcp.servers.create" => {
                let params: CreateMcpServerParams = serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                let known_agents = Self::known_agent_ids(&database)?;
                Ok(serde_json::to_value(
                    self.mcp_config.create(params, &known_agents)?,
                )?)
            }
            "mcp.servers.update" => {
                let params: UpdateMcpServerParams = serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                let known_agents = Self::known_agent_ids(&database)?;
                Ok(serde_json::to_value(
                    self.mcp_config.update(params, &known_agents)?,
                )?)
            }
            "mcp.servers.setEnabled" => {
                let params: SetMcpServerEnabledParams =
                    serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                let known_agents = Self::known_agent_ids(&database)?;
                Ok(serde_json::to_value(
                    self.mcp_config.set_enabled(params, &known_agents)?,
                )?)
            }
            "mcp.assignments.set" => {
                let params: SetMcpAssignmentParams =
                    serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                let known_agents = Self::known_agent_ids(&database)?;
                Ok(serde_json::to_value(
                    self.mcp_config.set_assignment(params, &known_agents)?,
                )?)
            }
            "mcp.servers.delete" => {
                let params: DeleteMcpServerParams = serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                let known_agents = Self::known_agent_ids(&database)?;
                Ok(serde_json::to_value(
                    self.mcp_config.delete(params, &known_agents)?,
                )?)
            }
            "mcp.import.scan" => {
                let database = self.database.lock().await;
                let known_agents = Self::known_agent_ids(&database)?;
                Ok(serde_json::to_value(
                    McpImportScanner.scan(&self.mcp_config, &known_agents)?,
                )?)
            }
            "mcp.import.commit" => {
                let params: CommitMcpImportParams = serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                let known_agents = Self::known_agent_ids(&database)?;
                Ok(serde_json::to_value(
                    self.mcp_config.commit_import(params, &known_agents)?,
                )?)
            }
            "skills.import.inspect" => {
                let params: InspectSkillImportParams =
                    serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    self.skill_library
                        .inspect_import(&database, Path::new(&params.path))?,
                )?)
            }
            "skills.import.github.inspect" => {
                let params: InspectGithubSkillImportParams =
                    serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    self.skill_library.inspect_github_import(
                        &database,
                        &params.repository_url,
                        params.subdirectory.as_deref(),
                        params.git_ref.as_deref(),
                    )?,
                )?)
            }
            "skills.import.commit" => {
                let params: UserCommandParams<CommitSkillImportCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = self.skill_library.commit_import(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                if execution.result.status == CommandResultStatus::Applied {
                    self.mark_skill_projections_dirty_best_effort(&mut database, false);
                }
                Ok(serde_json::to_value(execution.result)?)
            }
            "skills.setEnabled" => {
                let params: UserCommandParams<SetSkillEnabledCommand> =
                    serde_json::from_value(request.params.clone())?;
                let cleanup_required = !params.command.enabled;
                let mut database = self.database.lock().await;
                let execution = self.skill_library.set_enabled(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                if execution.result.status == CommandResultStatus::Applied {
                    self.mark_skill_projections_dirty_best_effort(&mut database, cleanup_required);
                }
                Ok(serde_json::to_value(execution.result)?)
            }
            "skills.setGroupAssignments" => {
                let params: UserCommandParams<SetSkillGroupAssignmentsCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = self.skill_library.set_group_assignments(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                if execution.result.status == CommandResultStatus::Applied {
                    self.mark_skill_projections_dirty_best_effort(&mut database, true);
                }
                Ok(serde_json::to_value(execution.result)?)
            }
            "skills.delete" => {
                let params: UserCommandParams<DeleteSkillCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = self.skill_library.request_delete(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                if execution.result.status == CommandResultStatus::Applied {
                    self.mark_skill_projections_dirty_best_effort(&mut database, true);
                    SkillProjectionReconciler
                        .finalize_unprojected_deletions(&mut database, &self.skill_library)?;
                }
                Ok(serde_json::to_value(execution.result)?)
            }
            "skills.projections.listIssues" => {
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    SkillProjectionReconciler.list_issues(&database)?,
                )?)
            }
            "skills.reconcile" => {
                let params: UserCommandParams<ReconcileSkillProjectionsCommand> =
                    serde_json::from_value(request.params.clone())?;
                let envelope = user_command_envelope(params.command_id, params.command);
                if let Some(replay) = {
                    let database = self.database.lock().await;
                    DomainCommandGateway.replay_if_recorded(&database, &envelope)?
                } {
                    return Ok(serde_json::to_value(replay.result)?);
                }
                let mut database = self.database.lock().await;
                let reports = SkillProjectionReconciler
                    .reconcile_known_roots(&mut database, &self.skill_library)?;
                let execution = DomainCommandGateway.execute(&mut database, &envelope, |_| {
                    Ok(rovai_core::command::CommandHandlerResult::applied(
                        "skill_projections_reconciled",
                        json!({
                            "rootCount": reports.len(),
                            "reports": reports,
                        }),
                        None,
                    ))
                })?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "conversations.restartNativeSession" => {
                let params: UserCommandParams<RestartNativeSessionCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = ExecutionRuntimeService::default().restart_native_session(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "camps.list" => {
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    ReadModelService.list_camps(&database)?,
                )?)
            }
            "camps.creationPreflight" => {
                let database = self.database.lock().await;
                let profiles = AgentProfileService::default().list_profiles(&database)?;
                let present_members = profiles
                    .into_iter()
                    .filter(|profile| profile.presence == "present")
                    .map(|profile| CampCreationMember {
                        agent_id: profile.agent_id,
                        display_name: profile.display_name,
                        member_order: profile.member_order,
                        runtime_configured: profile.runtime_configuration.is_some(),
                        runtime_readiness: profile.runtime_readiness.status,
                    })
                    .collect::<Vec<_>>();
                let initial_lead_agent_id = present_members
                    .iter()
                    .find(|member| member.runtime_readiness == RuntimeReadinessStatus::Ready)
                    .or_else(|| present_members.first())
                    .map(|member| member.agent_id.clone());
                let blockers = if present_members.is_empty() {
                    vec![json!({
                        "code": "no_present_members",
                        "detail": "当前没有在队的队员。",
                    })]
                } else {
                    Vec::new()
                };
                Ok(json!({
                    "admissible": blockers.is_empty(),
                    "presentMembers": present_members,
                    "initialLeadAgentId": initial_lead_agent_id,
                    "blockers": blockers,
                }))
            }
            "workspaces.inspect" => {
                let params: WorkspaceInspectParams =
                    serde_json::from_value(request.params.clone())?;
                let inspection = git::inspect_workspace(
                    PathBuf::from(params.path).as_path(),
                    &self.data_dir,
                    false,
                )
                .await?;
                Ok(serde_json::to_value(inspection)?)
            }
            "workspaces.validate" => {
                let params: WorkspaceInspectParams =
                    serde_json::from_value(request.params.clone())?;
                let selection = git::select_workspace(
                    PathBuf::from(params.path).as_path(),
                    &self.data_dir,
                    false,
                )?;
                Ok(serde_json::to_value(selection)?)
            }
            "navigation.snapshot" => {
                let mut database = self.database.lock().await;
                Ok(serde_json::to_value(
                    ReadModelService.navigation_snapshot(&mut database)?,
                )?)
            }
            "navigation.groupCamps" => {
                let params: NavigationGroupCampsParams =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                Ok(serde_json::to_value(
                    ReadModelService.navigation_group_camps(
                        &mut database,
                        params.project_path.as_deref(),
                        params.offset.unwrap_or(0),
                        params.limit.unwrap_or(100),
                    )?,
                )?)
            }
            "navigation.campViewed" => {
                let params: AcknowledgeCampViewedParams =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                Ok(serde_json::to_value(
                    ReadModelService.acknowledge_camp_viewed(
                        &mut database,
                        &params.camp_id,
                        params.through_global_sequence,
                    )?,
                )?)
            }
            "camps.create" => {
                let params: CreateCampParams = serde_json::from_value(request.params.clone())?;
                let (project_binding_kind, requested_path) = match &params.workspace {
                    Some(workspace) => (
                        ProjectBindingKind::Directory,
                        workspace.project_path.clone(),
                    ),
                    None => (
                        ProjectBindingKind::QuickChat,
                        self.data_dir
                            .join("quick-chat")
                            .to_string_lossy()
                            .to_string(),
                    ),
                };
                if project_binding_kind == ProjectBindingKind::QuickChat {
                    std::fs::create_dir_all(&requested_path).with_context(|| {
                        format!(
                            "failed to create Rovai-ai Quick Chat workspace at {requested_path}"
                        )
                    })?;
                }
                let inspection = git::inspect_workspace(
                    Path::new(&requested_path),
                    &self.data_dir,
                    project_binding_kind == ProjectBindingKind::QuickChat,
                )
                .await?;
                let command = CreateCampCommand {
                    name: params.name,
                    project_binding_kind,
                    project_path: inspection.project_path,
                    member_agent_ids: params.member_agent_ids,
                    default_lead_agent_id: params.default_lead_agent_id,
                    collaboration_mode: params.collaboration_mode,
                    activation_state: params.activation_state,
                };
                let mut database = self.database.lock().await;
                let execution = CollaborationService::default().create_camp(
                    &mut database,
                    &user_command_envelope(params.command_id, command),
                )?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "camps.rename" => {
                let params: UserCommandParams<RenameCampCommand> =
                    serde_json::from_value(request.params.clone())?;
                let camp_id = params.command.camp_id.clone();
                let mut database = self.database.lock().await;
                let execution = CollaborationService::default().rename_camp(
                    &mut database,
                    &user_camp_command_envelope(params.command_id, camp_id, params.command),
                )?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "camps.changeDefaultLead" => {
                let params: UserCommandParams<ChangeDefaultLeadCommand> =
                    serde_json::from_value(request.params.clone())?;
                let camp_id = params.command.camp_id.clone();
                let mut database = self.database.lock().await;
                let execution = CollaborationService::default().change_default_lead(
                    &mut database,
                    &user_camp_command_envelope(params.command_id, camp_id, params.command),
                )?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "camps.reconcileDefaultLead" => {
                let params: UserCommandParams<ReconcileDefaultLeadCommand> =
                    serde_json::from_value(request.params.clone())?;
                let camp_id = params.command.camp_id.clone();
                let mut database = self.database.lock().await;
                let execution = CollaborationService::default().reconcile_default_lead(
                    &mut database,
                    &user_camp_command_envelope(params.command_id, camp_id, params.command),
                )?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "camps.delete" => {
                let params: UserCommandParams<DeleteCampCommand> =
                    serde_json::from_value(request.params.clone())?;
                let camp_id = params.command.camp_id.clone();
                let mut database = self.database.lock().await;
                let execution = CollaborationService::default().delete_camp(
                    &mut database,
                    &user_camp_command_envelope(params.command_id, camp_id, params.command),
                )?;
                if execution.result.status == CommandResultStatus::Applied {
                    self.mark_skill_projections_dirty_best_effort(&mut database, true);
                }
                let should_remove_attachments =
                    execution.result.status == CommandResultStatus::Applied;
                let deleted_camp_id = execution
                    .result
                    .payload
                    .get("campId")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                drop(database);
                if should_remove_attachments && let Some(camp_id) = deleted_camp_id {
                    self.forget_deleted_camp_runtimes(&camp_id).await;
                    CampAttachmentStore::new(&self.data_dir).remove_camp(&camp_id)?;
                }
                Ok(serde_json::to_value(execution.result)?)
            }
            "camps.discardPending" => {
                let params: UserCommandParams<DiscardPendingCampCommand> =
                    serde_json::from_value(request.params.clone())?;
                let camp_id = params.command.camp_id.clone();
                let mut database = self.database.lock().await;
                let execution = CollaborationService::default().discard_pending_camp(
                    &mut database,
                    &user_camp_command_envelope(params.command_id, camp_id, params.command),
                )?;
                let discarded = execution.result.status == CommandResultStatus::Applied
                    && execution
                        .result
                        .payload
                        .get("discarded")
                        .and_then(Value::as_bool)
                        == Some(true);
                let discarded_camp_id = execution
                    .result
                    .payload
                    .get("campId")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                drop(database);
                if discarded && let Some(camp_id) = discarded_camp_id {
                    CampAttachmentStore::new(&self.data_dir).remove_camp(&camp_id)?;
                }
                Ok(serde_json::to_value(execution.result)?)
            }
            "campTurns.cancel" => {
                let params: UserCommandParams<CancelCampTurnCommand> =
                    serde_json::from_value(request.params.clone())?;
                let camp_id = params.command.camp_id.clone();
                let mut database = self.database.lock().await;
                let execution = ExecutionRuntimeService::default().request_camp_turn_cancellation(
                    &mut database,
                    &user_camp_command_envelope(params.command_id, camp_id, params.command),
                )?;
                let should_notify = execution.result.status == CommandResultStatus::Accepted;
                drop(database);
                if should_notify {
                    self.agent_run_cancellation_notify.notify_one();
                }
                Ok(serde_json::to_value(execution.result)?)
            }
            "agentRuns.resolveRecoveryBlocker" => {
                let params: UserCommandParams<ResolveAcceptedInputRecoveryBlockerCommand> =
                    serde_json::from_value(request.params.clone())?;
                let camp_id = params.command.camp_id.clone();
                let mut database = self.database.lock().await;
                let execution = ExecutionRuntimeService::default()
                    .resolve_accepted_input_recovery_blocker(
                        &mut database,
                        &user_camp_command_envelope(params.command_id, camp_id, params.command),
                    )?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "camps.snapshot" => {
                let params: CampIdParams = serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                Ok(serde_json::to_value(
                    ReadModelService.camp_snapshot(&mut database, &params.camp_id)?,
                )?)
            }
            "agentRunEvidence.getContent" => {
                let params: ExecutionEvidenceContentParams =
                    serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                let payload = ExecutionEvidenceService.read_full_payload(
                    &database,
                    &ManagedBlobStore::new(&self.data_dir),
                    &params.camp_id,
                    &params.evidence_id,
                )?;
                Ok(json!({ "evidenceId": params.evidence_id, "payload": payload }))
            }
            "agentRunEvidence.list" => {
                let params: ExecutionEvidenceListParams =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                Ok(serde_json::to_value(
                    ReadModelService.agent_run_execution_evidence_page(
                        &mut database,
                        &params.camp_id,
                        &params.agent_run_id,
                        params.after_sequence,
                        params.limit,
                    )?,
                )?)
            }
            "tasks.create" => {
                let params: CreateTaskParams = serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = CollaborationService::default().create_task(
                    &mut database,
                    &user_camp_command_envelope(
                        params.command_id,
                        params.camp_id.clone(),
                        CreateTaskCommand {
                            camp_id: params.camp_id,
                            title: params.title,
                            description: params.description,
                            acceptance_criteria: params.acceptance_criteria,
                            assignee_agent_id: params.assignee_agent_id,
                        },
                    ),
                )?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "tasks.update" => {
                let params: UpdateTaskParams = serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = CollaborationService::default().update_task(
                    &mut database,
                    &user_camp_command_envelope(
                        params.command_id,
                        params.camp_id,
                        UpdateTaskCommand {
                            task_id: params.task_id,
                            expected_version: params.expected_version,
                            title: params.title,
                            description: params.description,
                            acceptance_criteria: params.acceptance_criteria,
                            status: params.status,
                            assignee: params.assignee,
                            blocked_reason: params.blocked_reason,
                            completion_summary: params.completion_summary,
                            cancel_reason: params.cancel_reason,
                        },
                    ),
                )?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "tasks.list" => {
                let params: ListTasksParams = serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    CollaborationService::default().query_visible_tasks(
                        &database,
                        &params.camp_id,
                        &ActorRef::User {
                            user_id: CURRENT_USER_ID.to_string(),
                        },
                        None,
                        &TaskListQuery {
                            statuses: params.statuses,
                            assignee: params.assignee,
                            limit: params.limit,
                            cursor: params.cursor,
                        },
                    )?,
                )?)
            }
            "tasks.get" => {
                let params: GetTaskParams = serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    CollaborationService::default().get_visible_task(
                        &database,
                        &params.camp_id,
                        &params.task_id,
                        &ActorRef::User {
                            user_id: CURRENT_USER_ID.to_string(),
                        },
                        None,
                    )?,
                )?)
            }
            "camp.composerDraft.get" => {
                let params: CampComposerDraftParams =
                    serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    CampAttachmentStore::new(&self.data_dir)
                        .load_draft(&database, &params.camp_id)?,
                )?)
            }
            "camp.composerDraft.save" => {
                let params: SaveCampComposerDraftParams =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                Ok(serde_json::to_value(
                    CampAttachmentStore::new(&self.data_dir).save_content(
                        &mut database,
                        &params.camp_id,
                        params.expected_revision,
                        params.content,
                    )?,
                )?)
            }
            "camp.composerDraft.removeAttachment" => {
                let params: RemovePreparedAttachmentParams =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                Ok(serde_json::to_value(
                    CampAttachmentStore::new(&self.data_dir).remove_prepared(
                        &mut database,
                        &params.camp_id,
                        params.expected_revision,
                        &params.attachment_id,
                    )?,
                )?)
            }
            "camp.composerDraft.discard" => {
                let params: CampComposerDraftParams =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                CampAttachmentStore::new(&self.data_dir)
                    .discard_draft(&mut database, &params.camp_id)?;
                Ok(json!({ "discarded": true }))
            }
            "camp.attachments.prepareFromPath" => {
                let params: PrepareAttachmentFromPathParams =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                Ok(serde_json::to_value(
                    CampAttachmentStore::new(&self.data_dir).prepare_from_path(
                        &mut database,
                        &params.camp_id,
                        params.expected_revision,
                        Path::new(&params.source_path),
                        &params.display_name,
                    )?,
                )?)
            }
            "camp.attachments.previewSource" => {
                let params: AttachmentPreviewSourceParams =
                    serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                let source = CampAttachmentStore::new(&self.data_dir)
                    .preview_source(&database, &params.attachment_id)?;
                Ok(match source {
                    Some(source) => json!({
                        "path": source.path,
                        "mediaType": source.media_type,
                        "byteSize": source.byte_size,
                    }),
                    None => Value::Null,
                })
            }
            "camp.messages.send" => {
                let params: SendCampMessageParams = serde_json::from_value(request.params.clone())?;
                self.send_test_camp_message_request(params).await
            }
            "runtime.pendingExecution.cancel" => {
                let params: CancelPendingExecutionParams =
                    serde_json::from_value(request.params.clone())?;
                let view = {
                    let mut database = self.database.lock().await;
                    RuntimeResolutionService.cancel(&mut database, &params.intent_id)?
                };
                if let Some(view) = &view {
                    emit(
                        &self.output,
                        "runtime.pendingExecution.updated",
                        serde_json::to_value(view)?,
                    );
                }
                Ok(serde_json::to_value(view)?)
            }
            "action.approvals.resolve" => {
                let params: ResolveActionApprovalParams =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = ActionSafetyService::default().resolve_approval(
                    &mut database,
                    &CommandEnvelope {
                        command_id: params.command_id,
                        actor: ActorRef::User {
                            user_id: CURRENT_USER_ID.to_string(),
                        },
                        camp_id: Some(params.camp_id),
                        expected_versions: Vec::new(),
                        execution_epoch: None,
                        payload: ResolveActionApprovalCommand {
                            approval_id: params.approval_id,
                            option_id: params.option_id,
                            expected_version: params.expected_version,
                            reason: params.reason,
                        },
                    },
                )?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "notifications.inbox" => {
                let params: NotificationInboxParams =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                Ok(serde_json::to_value(
                    InAppNotificationService::default().inbox(
                        &mut database,
                        CURRENT_USER_ID,
                        params.filter,
                        params.cursor.as_deref(),
                        params.limit,
                    )?,
                )?)
            }
            "notifications.createdSince" => {
                let params: NotificationCreatedSinceParams =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                Ok(serde_json::to_value(
                    InAppNotificationService::default().created_since(
                        &mut database,
                        CURRENT_USER_ID,
                        params.after_sequence,
                        params.limit,
                    )?,
                )?)
            }
            "notifications.markRead" => {
                let params: UserCommandParams<MarkInAppNotificationReadCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = InAppNotificationService::default().mark_read(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                emit(&self.output, "in_app_notification.changed", json!({}));
                Ok(serde_json::to_value(execution.result)?)
            }
            "notifications.markCampRead" => {
                let params: UserCommandParams<MarkCampInAppNotificationsReadCommand> =
                    serde_json::from_value(request.params.clone())?;
                let camp_id = params.command.camp_id.clone();
                let mut database = self.database.lock().await;
                let execution = InAppNotificationService::default().mark_camp_read(
                    &mut database,
                    &user_camp_command_envelope(params.command_id, camp_id, params.command),
                )?;
                emit(&self.output, "in_app_notification.changed", json!({}));
                Ok(serde_json::to_value(execution.result)?)
            }
            "notifications.markAllRead" => {
                let params: UserCommandParams<MarkAllInAppNotificationsReadCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = InAppNotificationService::default().mark_all_read(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                emit(&self.output, "in_app_notification.changed", json!({}));
                Ok(serde_json::to_value(execution.result)?)
            }
            "notifications.clear" => {
                let params: UserCommandParams<ClearInAppNotificationCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = InAppNotificationService::default().clear(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                if let Err(error) =
                    InAppNotificationService::default().maintain_retention(&database)
                {
                    eprintln!("In-App Notification clear retention failed: {error:#}");
                }
                emit(&self.output, "in_app_notification.changed", json!({}));
                Ok(serde_json::to_value(execution.result)?)
            }
            "notifications.clearRead" => {
                let params: UserCommandParams<ClearReadInAppNotificationsCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = InAppNotificationService::default().clear_read(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                if let Err(error) =
                    InAppNotificationService::default().maintain_retention(&database)
                {
                    eprintln!("In-App Notification clear retention failed: {error:#}");
                }
                emit(&self.output, "in_app_notification.changed", json!({}));
                Ok(serde_json::to_value(execution.result)?)
            }
            "notifications.preference.get" => {
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    InAppNotificationService::default().preference(&database)?,
                )?)
            }
            "notifications.preference.update" => {
                let params: UserCommandParams<UpdateInAppNotificationPreferenceCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = InAppNotificationService::default().update_preference(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                emit(
                    &self.output,
                    "in_app_notification.preference_changed",
                    json!({}),
                );
                Ok(serde_json::to_value(execution.result)?)
            }
            "events.subscribe" => {
                let params: SubscribeEventsParams = serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                Ok(serde_json::to_value(ReadModelService.events_since(
                    &mut database,
                    params.camp_id.as_deref(),
                    params.after_global_sequence,
                    params.limit.unwrap_or(500),
                )?)?)
            }
            "diagnostics.check" => Ok(serde_json::to_value(self.diagnostics_report().await)?),
            "diagnostics.export" => {
                let report = self.diagnostics_report().await;
                let database = self.database.lock().await;
                let profile_service = AgentProfileService::default();
                let agents = profile_service.list_profiles(&database)?;
                let selected_runtime_counts = profile_service.selected_runtime_counts(&database)?;
                let camps = ReadModelService.list_camps(&database)?;
                let aggregate = aggregate_counts([
                    ("agentCount", agents.len()),
                    (
                        "currentAgentCount",
                        agents
                            .iter()
                            .filter(|agent| {
                                agent.removed_at.is_none() && agent.presence != "removed"
                            })
                            .count(),
                    ),
                    (
                        "configuredRuntimeMemberCount",
                        selected_runtime_counts.values().sum(),
                    ),
                    ("campCount", camps.len()),
                    ("runtimeCatalogCount", AdapterKind::ALL.len()),
                ]);
                Ok(diagnostics_export_v5(
                    env!("CARGO_PKG_VERSION"),
                    &report,
                    aggregate,
                ))
            }
            "runtime.discovery.rescan" => {
                let params: RuntimeDiscoveryRescanParams =
                    serde_json::from_value(request.params.clone())?;
                self.rescan_runtime_discovery(params.interactive_shell)
                    .await
            }
            "runtime.product.ensure" => {
                let params: CheckProductRuntimeParams =
                    serde_json::from_value(request.params.clone())?;
                let scheduled = self.ensure_runtime_check(params.runtime_kind).await?;
                Ok(json!({
                    "scheduled": scheduled,
                    "runtimeKind": params.runtime_kind,
                }))
            }
            "runtime.product.check" => {
                let params: CheckProductRuntimeParams =
                    serde_json::from_value(request.params.clone())?;
                let scheduled = self.schedule_runtime_check(params.runtime_kind).await;
                Ok(json!({
                    "scheduled": scheduled,
                    "runtimeKind": params.runtime_kind,
                }))
            }
            "health.check" => {
                let git = health::git_health().await;
                let database = self.database.lock().await;
                let mut payload = json!({
                    "core": {
                        "ok": true,
                        "version": env!("CARGO_PKG_VERSION"),
                        "dataDir": self.data_dir,
                        "readModelSchema": READ_MODEL_SCHEMA_VERSION,
                        "builtinToolContractVersion": BUILTIN_TOOL_CONTRACT_VERSION,
                        "builtinToolIpcProtocolVersion": BUILTIN_TOOL_IPC_PROTOCOL_VERSION,
                        "builtinToolCatalogDigest": builtin_tool_catalog_digest()?,
                    },
                    "database": {
                        "ok": true,
                        "path": database.path(),
                    },
                    "git": git,
                });
                drop(database);
                let runtime = self.runtime_health_payload().await?;
                if let (Some(payload), Some(runtime)) =
                    (payload.as_object_mut(), runtime.as_object())
                {
                    payload.extend(runtime.clone());
                }
                Ok(payload)
            }
            method => anyhow::bail!("unsupported core method: {method}"),
        }
    }

    async fn send_test_camp_message_request(&self, params: SendCampMessageParams) -> Result<Value> {
        let envelope = CommandEnvelope {
            command_id: params.command_id.clone(),
            actor: ActorRef::User {
                user_id: CURRENT_USER_ID.to_string(),
            },
            camp_id: Some(params.camp_id.clone()),
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload: SendUserCampDraftCommand {
                camp_id: params.camp_id.clone(),
                draft_revision: params.draft_revision,
                reply_to_camp_message_id: params.reply_to_camp_message_id.clone(),
                execution: params.execution.clone(),
            },
        };
        CollaborationService::validate_send_message_input(&envelope.payload)?;
        if let Some(replay) = {
            let database = self.database.lock().await;
            DomainCommandGateway.replay_if_recorded(&database, &envelope)?
        } {
            return Ok(json!({
                "commandResult": replay.result,
                "replayed": true,
                "preflight": null,
                "pendingExecution": null,
            }));
        }

        let execution = {
            let mut database = self.database.lock().await;
            let draft =
                CampAttachmentStore::new(&self.data_dir).load_draft(&database, &params.camp_id)?;
            if draft.revision == params.draft_revision {
                let attachment_ids = draft
                    .attachments
                    .iter()
                    .map(|attachment| attachment.id.clone())
                    .collect::<Vec<_>>();
                CampAttachmentStore::new(&self.data_dir).verify_send(
                    &database,
                    &params.camp_id,
                    &attachment_ids,
                )?;
            }
            CollaborationService::default().send_user_camp_draft(&mut database, &envelope)?
        };
        Ok(json!({
            "commandResult": execution.result,
            "replayed": execution.replayed,
            "preflight": null,
            "pendingExecution": null,
        }))
    }

    async fn deep_probe_candidate(
        &self,
        adapter_kind: rovai_core::agent_profile::AdapterKind,
        executable_path: &Path,
    ) -> Result<rovai_core::agent_profile::AdapterCapabilitySnapshot> {
        let attempted_at = chrono::Utc::now().to_rfc3339();
        let registry = AgentRuntimeAdapterRegistry::default();
        let snapshot = match adapter_kind {
            rovai_core::agent_profile::AdapterKind::CodexCli => {
                let probe = health::codex_runtime_probe_at(executable_path).await;
                let authentication_status = probe_authentication_status(probe.status).to_string();
                let (raw_model_catalog, last_error) = if probe.status
                    == health::AgentRuntimeProbeStatus::Ready
                {
                    match health::codex_model_catalog(executable_path).await {
                        Ok(catalog) => (Some(catalog), None),
                        Err(error) => (None, Some(format!("Codex model/list failed: {error:#}"))),
                    }
                } else {
                    (None, probe.detail.clone())
                };
                let status = if raw_model_catalog.is_some() {
                    "ready".to_string()
                } else if last_error
                    .as_deref()
                    .is_some_and(|error| error.starts_with("Codex model/list failed:"))
                {
                    "probe_failed".to_string()
                } else {
                    probe_status_name(probe.status).to_string()
                };
                registry.codex_capability_snapshot(CodexProbeObservation {
                    reported_version: probe.reported_version,
                    executable_fingerprint: probe.executable_fingerprint,
                    authentication_status,
                    probe_status: status,
                    capabilities: probe.capabilities,
                    raw_model_catalog,
                    attempted_at,
                    last_error,
                })?
            }
            kind @ (rovai_core::agent_profile::AdapterKind::OpencodeCli
            | rovai_core::agent_profile::AdapterKind::CopilotCli
            | rovai_core::agent_profile::AdapterKind::KiroCli
            | rovai_core::agent_profile::AdapterKind::QoderCli
            | rovai_core::agent_profile::AdapterKind::CodebuddyCli
            | rovai_core::agent_profile::AdapterKind::QwenCode) => {
                let probe = health::acp_capability_probe_at(executable_path, kind).await;
                registry.acp_capability_snapshot(AcpProbeObservation {
                    adapter_kind: kind,
                    reported_version: probe.result.reported_version,
                    executable_fingerprint: probe.result.executable_fingerprint,
                    authentication_status: probe_authentication_status(probe.result.status)
                        .to_string(),
                    probe_status: probe_status_name(probe.result.status).to_string(),
                    capabilities: probe.result.capabilities,
                    initialize_result: probe.initialize_result,
                    session_result: probe.session_result,
                    attempted_at,
                    last_error: probe.result.detail,
                })?
            }
            rovai_core::agent_profile::AdapterKind::ClaudeCodeCli => {
                let probe = health::claude_code_capability_probe_at(executable_path).await;
                registry.claude_code_capability_snapshot(ClaudeCodeProbeObservation {
                    reported_version: probe.result.reported_version,
                    executable_fingerprint: probe.result.executable_fingerprint,
                    authentication_status: probe_authentication_status(probe.result.status)
                        .to_string(),
                    probe_status: probe_status_name(probe.result.status).to_string(),
                    capabilities: probe.result.capabilities,
                    model_aliases: probe.model_aliases,
                    attempted_at,
                    last_error: probe.result.detail,
                })?
            }
            rovai_core::agent_profile::AdapterKind::AntigravityApp => {
                let probe = health::antigravity_capability_probe_at(executable_path).await;
                let builtin_cli_ready = bundled_cli_executable().is_ok_and(|path| path.is_file());
                registry.antigravity_capability_snapshot(AntigravityProbeObservation {
                    reported_version: probe.result.reported_version,
                    executable_fingerprint: probe.result.executable_fingerprint,
                    authentication_status: probe_authentication_status(probe.result.status)
                        .to_string(),
                    probe_status: probe_status_name(probe.result.status).to_string(),
                    capabilities: probe.result.capabilities,
                    models: probe.models,
                    builtin_cli_ready,
                    attempted_at,
                    last_error: probe.result.detail,
                })?
            }
        };
        Ok(snapshot)
    }

    async fn refresh_adapter_installation(
        &self,
        params: RefreshAdapterInstallationParams,
    ) -> Result<Value> {
        let installation = {
            let database = self.database.lock().await;
            AgentProfileService::default()
                .list_installations(&database)?
                .into_iter()
                .find(|installation| installation.id == params.installation_id)
                .context("Adapter installation does not exist")?
        };
        self.runtime_fleet
            .invalidate_adapter(installation.adapter_kind)
            .await;
        if installation.installation_class
            == rovai_core::agent_profile::InstallationClass::ManagedDefault
        {
            let ready = self
                .resolve_product_runtime(installation.adapter_kind)
                .await?;
            return Ok(json!({
                "status": if ready { "applied" } else { "rejected" },
                "code": if ready {
                    "adapter_installation.snapshot_recorded"
                } else {
                    "adapter_installation.probe_unavailable"
                },
                "payload": { "installationId": installation.id },
            }));
        }
        let search = self.runtime_search_environment.read().await.clone();
        let snapshot = with_runtime_search_environment(
            &search,
            self.deep_probe_candidate(
                installation.adapter_kind,
                Path::new(&installation.executable_path),
            ),
        )
        .await?;
        let mut database = self.database.lock().await;
        let execution = AgentProfileService::default().record_snapshot(
            &mut database,
            &user_command_envelope(
                params.command_id,
                RecordAdapterCapabilitySnapshotCommand {
                    installation_id: installation.id,
                    expected_installation_version: installation.version,
                    snapshot,
                },
            ),
        )?;
        Ok(serde_json::to_value(execution.result)?)
    }

    async fn dispatch_agent_runs(self: &Arc<Self>, output: &mpsc::UnboundedSender<String>) {
        let candidates = {
            let database = self.database.lock().await;
            match ExecutionRuntimeService::default().list_dispatchable_agent_runs(&database, 16) {
                Ok(candidates) => candidates,
                Err(error) => {
                    eprintln!("failed to scan dispatchable AgentRuns: {error:#}");
                    return;
                }
            }
        };
        if candidates.is_empty() {
            return;
        }
        let mut dispatch_tasks = tokio::task::JoinSet::new();
        for candidate in candidates {
            let core = self.clone();
            let output = output.clone();
            dispatch_tasks.spawn(async move {
                core.dispatch_agent_run_candidate(candidate, output).await;
            });
        }
        while let Some(result) = dispatch_tasks.join_next().await {
            if let Err(error) = result {
                eprintln!("AgentRun dispatch preparation worker failed: {error}");
            }
        }
    }

    async fn dispatch_agent_run_candidate(
        self: &Arc<Self>,
        mut candidate: rovai_core::runtime::QueuedAgentRunCandidate,
        output: mpsc::UnboundedSender<String>,
    ) {
        let Some(launch_permit) = self.planned_shutdown.enter_launch().await else {
            return;
        };
        let access_removed = {
            let database = self.database.lock().await;
            match SkillProjectionReconciler
                .execution_root_is_removed(&database, &candidate.project_path)
            {
                Ok(removed) => removed,
                Err(error) => {
                    eprintln!(
                        "failed to read Skill projection access for AgentRun {}: {error:#}",
                        candidate.agent_run_id
                    );
                    return;
                }
            }
        };
        if access_removed {
            return;
        }
        let workspace = candidate.execution_workspace();
        let workspace_path = match self.validate_dispatch_workspace(&candidate).await {
            Ok(path) => path,
            Err(error) => {
                self.reject_agent_run_dispatch(&candidate, "workspace_unavailable", &error)
                    .await;
                return;
            }
        };
        let runtime = match candidate.frozen_runtime() {
            Ok(runtime) => runtime,
            Err(error) => {
                self.reject_agent_run_dispatch(&candidate, "runtime_configuration_invalid", &error)
                    .await;
                return;
            }
        };
        match self.prepare_runtime_for_dispatch(&candidate, runtime).await {
            Ok((_runtime, effective_version)) => candidate.version = effective_version,
            Err(failure) => {
                if let Some(effective_version) = failure.effective_version {
                    candidate.version = effective_version;
                }
                self.reject_agent_run_dispatch(&candidate, &failure.code, &failure.error)
                    .await;
                return;
            }
        }
        let starting_git_observation = Some(git::observe_git(&workspace_path).await);
        let claim = {
            let mut database = self.database.lock().await;
            ExecutionRuntimeService::default().claim_agent_run(
                &mut database,
                &CommandEnvelope {
                    command_id: uuid::Uuid::new_v4().to_string(),
                    actor: ActorRef::System {
                        component_id: "agent-run-scheduler".to_string(),
                    },
                    camp_id: Some(candidate.camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: ClaimAgentRunCommand {
                        agent_run_id: candidate.agent_run_id.clone(),
                        expected_version: candidate.version,
                        lease_owner: format!(
                            "codex:{}:{}",
                            candidate.agent_run_id,
                            uuid::Uuid::new_v4()
                        ),
                        lease_seconds: 120,
                        workspace: Some(workspace),
                        starting_git_observation,
                    },
                },
            )
        };
        let claim = match claim {
            Ok(claim) if claim.result.status == CommandResultStatus::Accepted => claim,
            Ok(_) => return,
            Err(error) => {
                eprintln!(
                    "failed to claim AgentRun {}: {error:#}",
                    candidate.agent_run_id
                );
                return;
            }
        };
        let Some(execution_epoch) = claim.result.payload["executionEpoch"].as_i64() else {
            eprintln!(
                "AgentRun claim {} did not return executionEpoch",
                candidate.agent_run_id
            );
            return;
        };
        let execution = {
            let database = self.database.lock().await;
            ExecutionRuntimeService::default().load_agent_run_execution(
                &database,
                &candidate.agent_run_id,
                execution_epoch,
            )
        };
        let execution = match execution {
            Ok(Some(execution)) => execution,
            Ok(None) => {
                eprintln!(
                    "claimed AgentRun {} was fenced before dispatch",
                    candidate.agent_run_id
                );
                return;
            }
            Err(error) => {
                eprintln!(
                    "failed to materialize AgentRun {} input: {error:#}",
                    candidate.agent_run_id
                );
                self.fail_unmaterialized_agent_run(&candidate, execution_epoch, &error)
                    .await;
                return;
            }
        };
        let active_key =
            ActiveExecutionKey::new(&execution.agent_run_id, execution.execution_epoch);
        if !self
            .planned_shutdown
            .register_active(
                &launch_permit,
                active_key.clone(),
                execution.runtime.adapter_kind,
            )
            .await
        {
            let error = anyhow::anyhow!(
                "AgentRun execution could not enter the generation-local active registry"
            );
            self.fail_claimed_agent_run(
                &execution,
                "runtime_launch_admission_failed",
                &error,
                false,
            )
            .await;
            return;
        }
        let core = self.clone();
        let mut agent_run_tasks = self.agent_run_tasks.lock().await;
        while agent_run_tasks.try_join_next().is_some() {}
        agent_run_tasks.spawn(async move {
            let mut launch_permit = launch_permit;
            let launch_result = core
                .launch_agent_run(&execution, &output, &mut launch_permit)
                .await;
            if launch_result.is_ok() {
                core.planned_shutdown
                    .remove_active_if_unbound(&active_key)
                    .await;
                return;
            }
            if let Err(error) = launch_result {
                eprintln!(
                    "failed to launch AgentRun {}: {error:#}",
                    execution.agent_run_id
                );
                let delivered_one_shot_failure = error
                    .downcast_ref::<AntigravityDeliveredFailure>()
                    .map(|failure| (failure.native_turn_id.clone(), failure.error_code))
                    .or_else(|| {
                        error
                            .downcast_ref::<ClaudeCodeDeliveredFailure>()
                            .map(|failure| (failure.native_turn_id.clone(), failure.error_code))
                    });
                let runtime_terminal_observed = delivered_one_shot_failure.is_some();
                let error_code = if error.downcast_ref::<ContextPayloadTooLarge>().is_some() {
                    "context_payload_too_large"
                } else {
                    delivered_one_shot_failure
                        .as_ref()
                        .map(|(_, error_code)| *error_code)
                        .unwrap_or("runtime_launch_failed")
                };
                if core.planned_shutdown.is_draining() {
                    if let Some((native_turn_id, delivered_error_code)) =
                        delivered_one_shot_failure
                    {
                        let Some(_runtime_route_permit) =
                            core.planned_shutdown.enter_runtime_route().await
                        else {
                            return;
                        };
                        let binding = RuntimeRouteBinding {
                            route_identity: match execution.runtime.adapter_kind {
                                AdapterKind::ClaudeCodeCli => format!(
                                    "claude-code-process:{}:{}",
                                    execution.agent_run_id, execution.execution_epoch
                                ),
                                AdapterKind::AntigravityApp => format!(
                                    "agy-process:{}:{}",
                                    execution.agent_run_id, execution.execution_epoch
                                ),
                                _ => unreachable!(
                                    "only one-shot Adapters return one-shot terminal proof"
                                ),
                            },
                            adapter_turn_correlation: native_turn_id,
                            provider_turn_id: None,
                        };
                        match core
                            .admit_planned_shutdown_terminal(
                                &execution.agent_run_id,
                                execution.execution_epoch,
                                binding,
                                RuntimeTerminalOutcome::Failed,
                                delivered_error_code,
                            )
                            .await
                        {
                            Ok(Some(permit)) => {
                                match core
                                    .settle_planned_shutdown_abortive_terminal(
                                        &permit,
                                        PlannedShutdownAbortiveTerminal {
                                            agent_run_id: execution.agent_run_id.clone(),
                                            execution_epoch: execution.execution_epoch,
                                            outcome: RuntimeTerminalOutcome::Failed,
                                            error_code: delivered_error_code.to_string(),
                                            error_detail: Some(format!("{error:#}")),
                                            manual_retry_allowed: true,
                                        },
                                    )
                                    .await
                                {
                                    Ok(settlement) => {
                                        emit(
                                            &output,
                                            "agent_run.terminal",
                                            json!({
                                                "agentRunId": execution.agent_run_id,
                                                "executionEpoch": execution.execution_epoch,
                                                "adapterKind": execution.runtime.adapter_kind,
                                                "settlement": settlement,
                                            }),
                                        );
                                        core.reconcile_skill_projection_after_run_terminal(
                                            &execution.workspace.execution_root,
                                        )
                                        .await;
                                        core.planned_shutdown.remove_active(&active_key).await;
                                    }
                                    Err(settlement_error) => eprintln!(
                                        "failed to settle planned shutdown terminal for AgentRun {}: {settlement_error:#}",
                                        execution.agent_run_id
                                    ),
                                }
                            }
                            Ok(None) => {}
                            Err(admission_error) => eprintln!(
                                "planned shutdown terminal was fenced for AgentRun {}: {admission_error:#}",
                                execution.agent_run_id
                            ),
                        }
                    }
                    return;
                }
                core.fail_claimed_agent_run(
                    &execution,
                    error_code,
                    &error,
                    runtime_terminal_observed,
                )
                .await;
                core.planned_shutdown.remove_active(&active_key).await;
            }
        });
    }

    async fn validate_dispatch_workspace(
        &self,
        candidate: &rovai_core::runtime::QueuedAgentRunCandidate,
    ) -> Result<PathBuf> {
        let requested_path = PathBuf::from(&candidate.project_path);
        let validation_path = requested_path.clone();
        let data_dir = self.data_dir.clone();
        let allow_managed_quick_chat = candidate.project_binding_kind == "quick_chat";
        let canonical = tokio::task::spawn_blocking(move || {
            git::validate_workspace_directory(&validation_path, &data_dir, allow_managed_quick_chat)
        })
        .await
        .context("workspace safety worker failed")??;
        if canonical != requested_path {
            anyhow::bail!(
                "Camp project path no longer resolves to its persisted canonical directory"
            );
        }
        Ok(canonical)
    }

    async fn reject_agent_run_dispatch(
        &self,
        candidate: &rovai_core::runtime::QueuedAgentRunCandidate,
        error_code: &str,
        error: &anyhow::Error,
    ) {
        let rejection = {
            let mut database = self.database.lock().await;
            ExecutionRuntimeService::default().reject_agent_run_dispatch(
                &mut database,
                &CommandEnvelope {
                    command_id: uuid::Uuid::new_v4().to_string(),
                    actor: ActorRef::System {
                        component_id: "agent-run-scheduler".to_string(),
                    },
                    camp_id: Some(candidate.camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: RejectAgentRunDispatchCommand {
                        agent_run_id: candidate.agent_run_id.clone(),
                        expected_version: candidate.version,
                        error_code: error_code.to_string(),
                        error_detail: Some(format!("{error:#}")),
                        manual_retry_allowed: error_code != "context_payload_too_large",
                    },
                },
            )
        };
        match rejection {
            Ok(execution) if execution.result.status != CommandResultStatus::Rejected => {}
            Ok(_) => {}
            Err(rejection_error) => {
                eprintln!(
                    "failed to reject AgentRun {} before launch: {rejection_error:#}",
                    candidate.agent_run_id
                );
            }
        }
    }

    async fn dispatch_agent_run_cancellations(
        self: &Arc<Self>,
        output: &mpsc::UnboundedSender<String>,
    ) {
        let candidates = {
            let database = self.database.lock().await;
            match ExecutionRuntimeService::default().list_cancellation_candidates(&database, 32) {
                Ok(candidates) => candidates,
                Err(error) => {
                    eprintln!("failed to scan AgentRun cancellation candidates: {error:#}");
                    return;
                }
            }
        };
        let mut interrupt_tasks = tokio::task::JoinSet::new();
        for candidate in candidates {
            let core = self.clone();
            interrupt_tasks.spawn(async move {
                core.interrupt_cancelled_agent_run(&candidate).await;
                candidate
            });
        }
        while let Some(result) = interrupt_tasks.join_next().await {
            let candidate = match result {
                Ok(candidate) => candidate,
                Err(error) => {
                    eprintln!("AgentRun cancellation interrupt worker failed: {error}");
                    continue;
                }
            };
            let acknowledgement = {
                let mut database = self.database.lock().await;
                ExecutionRuntimeService::default().acknowledge_agent_run_cancellation(
                    &mut database,
                    &CommandEnvelope {
                        command_id: format!(
                            "runtime-cancellation-ack:{}:{}",
                            candidate.agent_run_id, candidate.execution_epoch
                        ),
                        actor: ActorRef::System {
                            component_id: "runtime-cancellation-coordinator".to_string(),
                        },
                        camp_id: Some(candidate.camp_id.clone()),
                        expected_versions: Vec::new(),
                        execution_epoch: None,
                        payload: AcknowledgeAgentRunCancellationCommand {
                            agent_run_id: candidate.agent_run_id.clone(),
                            expected_version: candidate.version,
                            execution_epoch: candidate.execution_epoch,
                            ending_git_observation: None,
                        },
                    },
                )
            };
            match acknowledgement {
                Ok(execution) if execution.result.status == CommandResultStatus::Applied => {
                    let accepted_input_outcome_unknown =
                        execution.result.code == "agent_run.accepted_input_outcome_unknown";
                    emit(
                        output,
                        if accepted_input_outcome_unknown {
                            "agent_run.recovery_blocker_resolved"
                        } else {
                            "agent_run.cancelled"
                        },
                        json!({
                            "campId": candidate.camp_id,
                            "campTurnId": candidate.camp_turn_id,
                            "agentRunId": candidate.agent_run_id,
                            "executionEpoch": candidate.execution_epoch,
                            "result": execution.result,
                            "replayed": execution.replayed,
                        }),
                    );
                    self.reconcile_skill_projection_after_run_terminal(&candidate.execution_root)
                        .await;
                    self.planned_shutdown
                        .remove_active(&ActiveExecutionKey::new(
                            &candidate.agent_run_id,
                            candidate.execution_epoch,
                        ))
                        .await;
                    if !accepted_input_outcome_unknown {
                        let core = self.clone();
                        tokio::spawn(async move {
                            core.record_cancelled_run_ending_git_observation(&candidate)
                                .await;
                        });
                    }
                }
                Ok(execution) if execution.result.code == "agent_run.cancellation_fenced" => {}
                Ok(execution) => eprintln!(
                    "AgentRun {} cancellation ACK was rejected: {}",
                    candidate.agent_run_id, execution.result.code
                ),
                Err(error) => eprintln!(
                    "failed to ACK AgentRun {} cancellation: {error:#}",
                    candidate.agent_run_id
                ),
            }
        }
    }

    async fn record_cancelled_run_ending_git_observation(
        &self,
        candidate: &AgentRunCancellationCandidate,
    ) {
        let Some(ending_git_observation) = self
            .observe_run_git(&candidate.project_binding_kind, &candidate.project_path)
            .await
        else {
            return;
        };
        let recording = {
            let mut database = self.database.lock().await;
            ExecutionRuntimeService::default().record_cancelled_agent_run_ending_git_observation(
                &mut database,
                &CommandEnvelope {
                    command_id: uuid::Uuid::new_v4().to_string(),
                    actor: ActorRef::System {
                        component_id: "agent-run-git-observer".to_string(),
                    },
                    camp_id: Some(candidate.camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: RecordCancelledAgentRunEndingGitObservationCommand {
                        agent_run_id: candidate.agent_run_id.clone(),
                        execution_epoch: candidate.execution_epoch,
                        ending_git_observation,
                    },
                },
            )
        };
        match recording {
            Ok(execution) if execution.result.status == CommandResultStatus::Applied => {}
            Ok(execution) => eprintln!(
                "AgentRun {} ending Git observation was rejected: {}",
                candidate.agent_run_id, execution.result.code
            ),
            Err(error) => eprintln!(
                "failed to record AgentRun {} ending Git observation: {error:#}",
                candidate.agent_run_id
            ),
        }
    }

    async fn interrupt_cancelled_agent_run(&self, candidate: &AgentRunCancellationCandidate) {
        if candidate.status == "queued" {
            return;
        }
        if candidate.adapter_kind == "antigravity-app" {
            if run_with_cancellation_deadline(
                RUNTIME_CANCELLATION_INTERRUPT_TIMEOUT,
                self.antigravity_app
                    .interrupt(&candidate.agent_run_id, candidate.execution_epoch),
            )
            .await
            .is_none()
            {
                eprintln!(
                    "Antigravity interrupt timed out for AgentRun {}; execution remains fenced",
                    candidate.agent_run_id
                );
            }
            return;
        }
        if candidate.adapter_kind == "claude-code-cli" {
            if run_with_cancellation_deadline(
                RUNTIME_CANCELLATION_INTERRUPT_TIMEOUT,
                self.claude_code_cli
                    .interrupt(&candidate.agent_run_id, candidate.execution_epoch),
            )
            .await
            .is_none()
            {
                eprintln!(
                    "Claude Code interrupt timed out for AgentRun {}; execution remains fenced",
                    candidate.agent_run_id
                );
            }
            return;
        }
        let Some(runtime) = self
            .agent_run_runtime(&candidate.agent_run_id, candidate.execution_epoch)
            .await
        else {
            return;
        };
        match run_with_cancellation_deadline(
            RUNTIME_CANCELLATION_INTERRUPT_TIMEOUT,
            runtime.cancel(),
        )
        .await
        {
            Some(Ok(())) => {}
            Some(Err(error)) => {
                eprintln!(
                    "failed to interrupt AgentRun {}: {error:#}",
                    candidate.agent_run_id
                );
            }
            None => {
                eprintln!(
                    "Runtime interrupt timed out for AgentRun {}; forcing logical Runtime fencing",
                    candidate.agent_run_id
                );
            }
        }
        let adapter_kind = runtime.adapter_kind();
        let fenced = run_with_cancellation_deadline(RUNTIME_CANCELLATION_FENCE_TIMEOUT, async {
            match adapter_kind {
                rovai_core::agent_profile::AdapterKind::CodexCli => {
                    self.codex_cli
                        .forget_agent_run(&candidate.agent_run_id, candidate.execution_epoch)
                        .await;
                }
                kind @ (rovai_core::agent_profile::AdapterKind::OpencodeCli
                | rovai_core::agent_profile::AdapterKind::CopilotCli
                | rovai_core::agent_profile::AdapterKind::KiroCli
                | rovai_core::agent_profile::AdapterKind::QoderCli
                | rovai_core::agent_profile::AdapterKind::CodebuddyCli
                | rovai_core::agent_profile::AdapterKind::QwenCode) => {
                    if let Some(adapter) = self.acp_adapter(kind) {
                        adapter
                            .forget_agent_run(&candidate.agent_run_id, candidate.execution_epoch)
                            .await;
                    }
                }
                rovai_core::agent_profile::AdapterKind::AntigravityApp => unreachable!(),
                rovai_core::agent_profile::AdapterKind::ClaudeCodeCli => unreachable!(),
            }
        })
        .await;
        if fenced.is_none() {
            eprintln!(
                "Runtime detach timed out for AgentRun {}; persisted cancellation fence remains authoritative",
                candidate.agent_run_id
            );
        }
    }

    async fn dispatch_runtime_deliveries(self: &Arc<Self>, output: &mpsc::UnboundedSender<String>) {
        let candidates = {
            let database = self.database.lock().await;
            match ActionSafetyService::default().list_runtime_delivery_candidates(&database, 32) {
                Ok(candidates) => candidates,
                Err(error) => {
                    eprintln!("failed to scan Runtime Delivery candidates: {error:#}");
                    return;
                }
            }
        };

        for candidate in candidates {
            let Some(runtime) = self
                .agent_run_runtime(&candidate.agent_run_id, candidate.target_execution_epoch)
                .await
            else {
                continue;
            };
            let component_id = runtime.component_id();
            let lease_owner = format!(
                "runtime-delivery:{}:{}",
                candidate.delivery_id,
                uuid::Uuid::new_v4()
            );
            let acquired = {
                let mut database = self.database.lock().await;
                ActionSafetyService::default().acquire_runtime_delivery(
                    &mut database,
                    &CommandEnvelope {
                        command_id: uuid::Uuid::new_v4().to_string(),
                        actor: ActorRef::System {
                            component_id: component_id.clone(),
                        },
                        camp_id: Some(candidate.camp_id.clone()),
                        expected_versions: Vec::new(),
                        execution_epoch: None,
                        payload: AcquireRuntimeDeliveryCommand {
                            delivery_id: candidate.delivery_id.clone(),
                            expected_version: candidate.delivery_version,
                            lease_owner: lease_owner.clone(),
                            lease_seconds: 30,
                        },
                    },
                )
            };
            let acquired = match acquired {
                Ok(execution) if execution.result.status == CommandResultStatus::Accepted => {
                    execution
                }
                Ok(_) => continue,
                Err(error) => {
                    eprintln!(
                        "failed to acquire Runtime Delivery {}: {error:#}",
                        candidate.delivery_id
                    );
                    continue;
                }
            };
            let payload_digest = match acquired.result.payload["payloadDigest"].as_str() {
                Some(value) => value.to_string(),
                None => {
                    eprintln!(
                        "Runtime Delivery {} has no payload digest",
                        candidate.delivery_id
                    );
                    continue;
                }
            };
            let payload = acquired.result.payload["payload"].clone();
            let runtime_managed =
                candidate.permission_semantics == PermissionSemantics::RuntimeManagedV2;
            let decision = payload["decision"].as_str().unwrap_or_default();
            let (approved, denied) = if runtime_managed {
                match payload["allowsAction"].as_bool() {
                    Some(true) => (true, false),
                    Some(false) => (false, true),
                    None => (false, false),
                }
            } else {
                (
                    matches!(decision, "approved" | "approved_by_policy"),
                    matches!(
                        decision,
                        "denied" | "denied_by_policy" | "expired" | "cancelled"
                    ),
                )
            };
            if !approved && !denied {
                self.fail_leased_runtime_delivery(
                    &candidate,
                    &payload_digest,
                    &lease_owner,
                    "Runtime authorization payload has an unsupported decision",
                )
                .await;
                continue;
            }
            let frozen_runtime_response = if runtime_managed {
                let response = payload["nativeResponse"].clone();
                let expected_digest = payload["nativeResponseDigest"].as_str();
                if response.is_null()
                    || expected_digest.is_none()
                    || canonical_json_digest(&response).ok().as_deref() != expected_digest
                {
                    self.fail_leased_runtime_delivery(
                        &candidate,
                        &payload_digest,
                        &lease_owner,
                        "Runtime authorization payload has no valid frozen native response",
                    )
                    .await;
                    continue;
                }
                Some(response)
            } else {
                None
            };

            let mut active_attempt = None;
            if approved {
                if candidate.action_status != "prepared" {
                    self.fail_leased_runtime_delivery(
                        &candidate,
                        &payload_digest,
                        &lease_owner,
                        "Approved intercepted Action is no longer prepared",
                    )
                    .await;
                    continue;
                }
                let action_lease_owner = format!(
                    "runtime-action:{}:{}",
                    candidate.action_id,
                    uuid::Uuid::new_v4()
                );
                let claimed = {
                    let mut database = self.database.lock().await;
                    ActionSafetyService::default().claim_action(
                        &mut database,
                        &CommandEnvelope {
                            command_id: uuid::Uuid::new_v4().to_string(),
                            actor: ActorRef::System {
                                component_id: component_id.clone(),
                            },
                            camp_id: Some(candidate.camp_id.clone()),
                            expected_versions: Vec::new(),
                            execution_epoch: None,
                            payload: ClaimActionCommand {
                                action_id: candidate.action_id.clone(),
                                expected_version: candidate.action_version,
                                lease_owner: action_lease_owner.clone(),
                                lease_seconds: 120,
                                authorization_delivery_id: Some(candidate.delivery_id.clone()),
                                authorization_delivery_lease_owner: Some(lease_owner.clone()),
                            },
                        },
                    )
                };
                let claimed = match claimed {
                    Ok(execution) if execution.result.status == CommandResultStatus::Accepted => {
                        execution
                    }
                    Ok(execution) => {
                        self.fail_leased_runtime_delivery(
                            &candidate,
                            &payload_digest,
                            &lease_owner,
                            &format!("Action claim rejected: {}", execution.result.code),
                        )
                        .await;
                        continue;
                    }
                    Err(error) => {
                        self.fail_leased_runtime_delivery(
                            &candidate,
                            &payload_digest,
                            &lease_owner,
                            &format!("Action claim failed: {error:#}"),
                        )
                        .await;
                        continue;
                    }
                };
                let Some(attempt_id) = claimed.result.payload["attemptId"].as_str() else {
                    self.fail_leased_runtime_delivery(
                        &candidate,
                        &payload_digest,
                        &lease_owner,
                        "Action claim returned no Attempt ID",
                    )
                    .await;
                    continue;
                };
                let Some(action_execution_epoch) =
                    claimed.result.payload["actionExecutionEpoch"].as_i64()
                else {
                    self.fail_leased_runtime_delivery(
                        &candidate,
                        &payload_digest,
                        &lease_owner,
                        "Action claim returned no execution epoch",
                    )
                    .await;
                    continue;
                };
                let attempt_id = attempt_id.to_string();
                let dispatch = {
                    let mut database = self.database.lock().await;
                    ActionSafetyService::default().mark_dispatch_started(
                        &mut database,
                        &CommandEnvelope {
                            command_id: format!(
                                "runtime-action-dispatch:{}:{attempt_id}",
                                candidate.action_id
                            ),
                            actor: ActorRef::System {
                                component_id: component_id.clone(),
                            },
                            camp_id: Some(candidate.camp_id.clone()),
                            expected_versions: Vec::new(),
                            execution_epoch: None,
                            payload: MarkActionDispatchStartedCommand {
                                action_id: candidate.action_id.clone(),
                                attempt_id: attempt_id.clone(),
                                action_execution_epoch,
                                lease_owner: action_lease_owner,
                            },
                        },
                    )
                };
                if !matches!(dispatch, Ok(ref value) if value.result.status == CommandResultStatus::Applied)
                {
                    self.fail_leased_runtime_delivery(
                        &candidate,
                        &payload_digest,
                        &lease_owner,
                        "Action dispatch marker could not be persisted",
                    )
                    .await;
                    continue;
                }
                active_attempt = Some((attempt_id, action_execution_epoch));
            }

            let mut response_approved = approved;
            if !runtime_managed
                && approved
                && let Err(error) = runtime
                    .authorize_file_write(&candidate.action_kind, &candidate.response_context)
                    .await
            {
                response_approved = false;
                if let Some((attempt_id, action_execution_epoch)) = active_attempt.clone() {
                    let result = {
                        let mut database = self.database.lock().await;
                        ActionSafetyService::default().record_result(
                            &mut database,
                            &CommandEnvelope {
                                command_id: format!(
                                    "runtime-action-authorization-rejected:{}:{attempt_id}",
                                    candidate.action_id
                                ),
                                actor: ActorRef::System {
                                    component_id: component_id.clone(),
                                },
                                camp_id: Some(candidate.camp_id.clone()),
                                expected_versions: Vec::new(),
                                execution_epoch: None,
                                payload: RecordActionResultCommand {
                                    action_id: candidate.action_id.clone(),
                                    attempt_id,
                                    action_execution_epoch,
                                    outcome: ActionResultOutcome::Failed,
                                    result_code: "runtime_scope_validation_failed".to_string(),
                                    result_summary:
                                        "Rovai-ai rejected the approved action because its concrete scope was unsafe"
                                            .to_string(),
                                    result_data: json!({"error": format!("{error:#}")}),
                                    effect_disposition: "none".to_string(),
                                },
                            },
                        )
                    };
                    if let Err(record_error) = result {
                        self.fail_leased_runtime_delivery(
                            &candidate,
                            &payload_digest,
                            &lease_owner,
                            &format!(
                                "Runtime write authorization and result recording failed: {error:#}; {record_error:#}"
                            ),
                        )
                        .await;
                        continue;
                    }
                    active_attempt = None;
                }
                emit(
                    output,
                    "action.scope_rejected",
                    json!({
                        "agentRunId": candidate.agent_run_id,
                        "executionEpoch": candidate.target_execution_epoch,
                        "actionId": candidate.action_id,
                        "error": format!("{error:#}"),
                    }),
                );
            }
            let response = if let Some(response) = frozen_runtime_response {
                Ok(response)
            } else if candidate.native_method == "session/request_permission" {
                acp::legacy_approval_result(&candidate.response_context, response_approved)
            } else {
                codex::approval_result(
                    &candidate.native_method,
                    &candidate.response_context,
                    if response_approved {
                        "accept"
                    } else {
                        "decline"
                    },
                )
            };
            let delivery_result = match response {
                Ok(response) => {
                    runtime
                        .respond(candidate.native_request_id.clone(), response)
                        .await
                }
                Err(error) => Err(error),
            };
            if let Err(error) = delivery_result {
                if let Some((attempt_id, action_execution_epoch)) = active_attempt {
                    let mut database = self.database.lock().await;
                    let _ = ActionSafetyService::default().record_result(
                        &mut database,
                        &CommandEnvelope {
                            command_id: format!(
                                "runtime-action-unknown:{}:{attempt_id}",
                                candidate.action_id
                            ),
                            actor: ActorRef::System {
                                component_id: component_id.clone(),
                            },
                            camp_id: Some(candidate.camp_id.clone()),
                            expected_versions: Vec::new(),
                            execution_epoch: None,
                            payload: RecordActionResultCommand {
                                action_id: candidate.action_id.clone(),
                                attempt_id,
                                action_execution_epoch,
                                outcome: ActionResultOutcome::Unknown,
                                result_code: "runtime_authorization_delivery_failed".to_string(),
                                result_summary:
                                    "Runtime authorization response may not have been received"
                                        .to_string(),
                                result_data: json!({ "error": error.to_string() }),
                                effect_disposition: "unknown".to_string(),
                            },
                        },
                    );
                }
                self.fail_leased_runtime_delivery(
                    &candidate,
                    &payload_digest,
                    &lease_owner,
                    &format!("Runtime authorization response failed: {error:#}"),
                )
                .await;
                continue;
            }

            let acknowledged = {
                let mut database = self.database.lock().await;
                ActionSafetyService::default().acknowledge_runtime_delivery(
                    &mut database,
                    &CommandEnvelope {
                        command_id: format!(
                            "runtime-delivery-ack:{}:{payload_digest}",
                            candidate.delivery_id
                        ),
                        actor: ActorRef::System {
                            component_id: component_id.clone(),
                        },
                        camp_id: Some(candidate.camp_id.clone()),
                        expected_versions: Vec::new(),
                        execution_epoch: None,
                        payload: AcknowledgeRuntimeDeliveryCommand {
                            delivery_id: candidate.delivery_id.clone(),
                            payload_digest,
                            target_execution_epoch: candidate.target_execution_epoch,
                            lease_owner,
                        },
                    },
                )
            };
            match acknowledged {
                Ok(execution) if execution.result.status == CommandResultStatus::Applied => emit(
                    output,
                    "runtime_delivery.acknowledged",
                    json!({
                        "agentRunId": candidate.agent_run_id,
                        "executionEpoch": candidate.target_execution_epoch,
                        "actionId": candidate.action_id,
                        "decision": decision,
                    }),
                ),
                Ok(execution) => eprintln!(
                    "Runtime Delivery {} ACK was rejected: {}",
                    candidate.delivery_id, execution.result.code
                ),
                Err(error) => eprintln!(
                    "failed to ACK Runtime Delivery {}: {error:#}",
                    candidate.delivery_id
                ),
            }
        }
    }

    async fn fail_leased_runtime_delivery(
        &self,
        candidate: &rovai_core::action::RuntimeDeliveryCandidate,
        payload_digest: &str,
        lease_owner: &str,
        error: &str,
    ) {
        let component_id = self
            .agent_run_runtime(&candidate.agent_run_id, candidate.target_execution_epoch)
            .await
            .map(|runtime| runtime.component_id())
            .unwrap_or_else(|| "runtime-delivery-coordinator".to_string());
        let mut database = self.database.lock().await;
        if let Err(failure) = ActionSafetyService::default().fail_runtime_delivery(
            &mut database,
            &CommandEnvelope {
                command_id: uuid::Uuid::new_v4().to_string(),
                actor: ActorRef::System { component_id },
                camp_id: Some(candidate.camp_id.clone()),
                expected_versions: Vec::new(),
                execution_epoch: None,
                payload: FailRuntimeDeliveryCommand {
                    delivery_id: candidate.delivery_id.clone(),
                    payload_digest: payload_digest.to_string(),
                    target_execution_epoch: candidate.target_execution_epoch,
                    lease_owner: lease_owner.to_string(),
                    error: error.to_string(),
                },
            },
        ) {
            eprintln!(
                "failed to mark Runtime Delivery {} failed: {failure:#}",
                candidate.delivery_id
            );
        }
    }

    async fn materialize_agent_run_context(
        &self,
        execution: &AgentRunExecution,
        skill_exposure: &PreparedSkillExposure,
        mcp_projection: &PreparedMcpProjection,
        charter_delivery_mode: CharterDeliveryMode,
        output: &mpsc::UnboundedSender<String>,
    ) -> Result<Option<PreparedContext>> {
        let materialization = {
            let mut database = self.database.lock().await;
            ContextService.materialize_with_exposures(
                &mut database,
                &ManagedBlobStore::new(&self.data_dir),
                skill_exposure,
                mcp_projection,
                &MaterializeContextRequest {
                    agent_run_id: &execution.agent_run_id,
                    execution_epoch: execution.execution_epoch,
                    charter_delivery_mode,
                    max_payload_bytes: DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES,
                },
            )
        }?;
        match materialization {
            ContextMaterialization::Ready(prepared) => Ok(Some(prepared)),
            ContextMaterialization::Waiting(wait) => {
                emit(
                    output,
                    "agent_run.context_waiting",
                    json!({
                        "campId": execution.camp_id,
                        "campTurnId": execution.camp_turn_id,
                        "agentRunId": execution.agent_run_id,
                        "executionEpoch": execution.execution_epoch,
                        "reason": wait.reason,
                    }),
                );
                Ok(None)
            }
        }
    }

    async fn materialize_and_prepare_agent_run_input(
        &self,
        execution: &AgentRunExecution,
        skill_exposure: &PreparedSkillExposure,
        mcp_projection: &PreparedMcpProjection,
        charter_delivery_mode: CharterDeliveryMode,
        output: &mpsc::UnboundedSender<String>,
    ) -> Result<Option<(PreparedContext, RuntimeInputDelivery)>> {
        let preparation = {
            // The Core database mutex is the logical Runtime Input preparation
            // boundary. A Compaction Observer cannot commit between selecting
            // the pending revision and persisting RuntimeInputDelivery.prepared.
            let mut database = self.database.lock().await;
            let materialization = ContextService.materialize_with_exposures(
                &mut database,
                &ManagedBlobStore::new(&self.data_dir),
                skill_exposure,
                mcp_projection,
                &MaterializeContextRequest {
                    agent_run_id: &execution.agent_run_id,
                    execution_epoch: execution.execution_epoch,
                    charter_delivery_mode,
                    max_payload_bytes: DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES,
                },
            )?;
            match materialization {
                ContextMaterialization::Ready(context) => {
                    let delivery = ContextService.prepare_input_delivery_for_context(
                        &mut database,
                        &execution.agent_run_id,
                        execution.execution_epoch,
                        &context,
                    )?;
                    Some(Ok((context, delivery)))
                }
                ContextMaterialization::Waiting(wait) => Some(Err(wait)),
            }
        };
        match preparation {
            Some(Ok(prepared)) => Ok(Some(prepared)),
            Some(Err(wait)) => {
                emit(
                    output,
                    "agent_run.context_waiting",
                    json!({
                        "campId": execution.camp_id,
                        "campTurnId": execution.camp_turn_id,
                        "agentRunId": execution.agent_run_id,
                        "executionEpoch": execution.execution_epoch,
                        "reason": wait.reason,
                    }),
                );
                Ok(None)
            }
            None => Ok(None),
        }
    }

    async fn prepare_agent_run_skill_exposure(
        &self,
        execution: &AgentRunExecution,
    ) -> Result<Option<PreparedSkillExposure>> {
        let exposure = {
            let mut database = self.database.lock().await;
            ContextService.prepare_skill_exposure(
                &mut database,
                &self.skill_library,
                &execution.agent_run_id,
                execution.execution_epoch,
            )
        }?;
        Ok(Some(exposure))
    }

    async fn prepare_agent_run_mcp_projection(
        &self,
        execution: &AgentRunExecution,
    ) -> Result<PreparedMcpProjection> {
        let execution_root = PathBuf::from(&execution.workspace.execution_root);
        let database = self.database.lock().await;
        self.mcp_projection.prepare(
            &database,
            &self.mcp_config,
            &McpProjectionRequest {
                agent_run_id: &execution.agent_run_id,
                execution_epoch: execution.execution_epoch,
                agent_id: &execution.agent_id,
                adapter_kind: execution.runtime.adapter_kind,
                reported_runtime_version: Some(&execution.runtime.reported_version),
                execution_root: &execution_root,
            },
        )
    }

    async fn persist_runtime_compatibility_digest(
        &self,
        execution: &AgentRunExecution,
        digest: &str,
    ) -> Result<()> {
        let mut database = self.database.lock().await;
        ExecutionRuntimeService::default().record_runtime_compatibility_digest(
            &mut database,
            &execution.agent_run_id,
            execution.execution_epoch,
            digest,
        )
    }

    async fn acknowledge_runtime_input(
        &self,
        delivery_id: &str,
        native_input_id: &str,
    ) -> Result<()> {
        let mut database = self.database.lock().await;
        if let Err(error) =
            ContextService.acknowledge_input_delivery(&mut database, delivery_id, native_input_id)
        {
            let acknowledgement_error = format!("{error:#}");
            if let Err(mark_error) = ContextService.mark_input_delivery_unknown(
                &mut database,
                delivery_id,
                &format!(
                    "Runtime returned a Native Input ID, but Rovai-ai could not persist its acknowledgement: {acknowledgement_error}"
                ),
            ) {
                anyhow::bail!(
                    "failed to persist Runtime Input acknowledgement ({acknowledgement_error}) and failed to mark it unknown ({mark_error:#})"
                );
            }
            anyhow::bail!(
                "Runtime Input acknowledgement could not be persisted: {acknowledgement_error}"
            );
        }
        Ok(())
    }

    async fn bind_active_runtime_route(
        &self,
        execution: &AgentRunExecution,
        binding: RuntimeRouteBinding,
    ) -> Result<()> {
        let key = ActiveExecutionKey::new(&execution.agent_run_id, execution.execution_epoch);
        if !self.planned_shutdown.bind_route(&key, binding).await {
            anyhow::bail!("Runtime route did not match the current generation active execution");
        }
        Ok(())
    }

    async fn admit_planned_shutdown_terminal(
        &self,
        agent_run_id: &str,
        execution_epoch: i64,
        binding: RuntimeRouteBinding,
        outcome: RuntimeTerminalOutcome,
        terminal_discriminator: &str,
    ) -> Result<Option<TerminalSettlementPermit>> {
        if !self.planned_shutdown.is_draining() {
            return Ok(None);
        }
        let fingerprint = format!(
            "{}:{agent_run_id}:{execution_epoch}:{}:{terminal_discriminator}",
            outcome.as_str(),
            binding.adapter_turn_correlation
        );
        self.planned_shutdown
            .admit_terminal(RuntimeTerminalObservation {
                key: ActiveExecutionKey::new(agent_run_id, execution_epoch),
                binding,
                outcome,
                fingerprint,
            })
            .await
            .map(Some)
            .map_err(|error| {
                anyhow::anyhow!("planned shutdown terminal observation was fenced: {error:?}")
            })
    }

    async fn settle_planned_shutdown_abortive_terminal(
        &self,
        permit: &TerminalSettlementPermit,
        terminal: PlannedShutdownAbortiveTerminal,
    ) -> Result<rovai_core::runtime::PlannedShutdownTerminalSettlement> {
        let mut database = self.database.lock().await;
        ExecutionRuntimeService::default().settle_planned_shutdown_abortive_terminal(
            &mut database,
            permit,
            &terminal,
        )
    }

    async fn prepare_builtin_tool_binding(
        &self,
        execution: &AgentRunExecution,
        force_new_binding: bool,
    ) -> Result<BuiltinToolBindingCredential> {
        Ok({
            let mut database = self.database.lock().await;
            TeamToolService::default().prepare_binding_credential(
                &mut database,
                &execution.agent_run_id,
                execution.execution_epoch,
                force_new_binding,
            )?
        })
    }

    fn prepare_builtin_tool_process_config(&self) -> Result<BuiltinToolProcessConfig> {
        BuiltinToolProcessConfig::create(
            &bundled_cli_executable()?,
            &builtin_tool_socket_path(),
            &self.data_dir.join("runtime"),
        )
    }

    async fn bind_builtin_tool_runtime(
        &self,
        config: &BuiltinToolProcessConfig,
        execution: &AgentRunExecution,
        credential: &BuiltinToolBindingCredential,
    ) -> Result<()> {
        self.builtin_tool_leases
            .bind(
                config,
                &execution.agent_run_id,
                execution.execution_epoch,
                credential,
            )
            .await?;
        Ok(())
    }

    async fn bind_prepared_native_session(
        &self,
        execution: &AgentRunExecution,
        credential: &BuiltinToolBindingCredential,
        native_session_id: &str,
    ) -> Result<()> {
        let binding = {
            let mut database = self.database.lock().await;
            ExecutionRuntimeService::default().bind_native_session(
                &mut database,
                &CommandEnvelope {
                    command_id: uuid::Uuid::new_v4().to_string(),
                    actor: ActorRef::System {
                        component_id: format!(
                            "runtime-adapter:{}",
                            execution.runtime.adapter_kind.as_str()
                        ),
                    },
                    camp_id: Some(execution.camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: BindNativeSessionCommand {
                        conversation_id: execution.conversation_id.clone(),
                        agent_run_id: execution.agent_run_id.clone(),
                        expected_conversation_version: credential.conversation_version,
                        expected_execution_epoch: execution.execution_epoch,
                        previous_adapter_installation_id: Some(
                            credential.adapter_installation_id.clone(),
                        ),
                        previous_native_session_id: credential.native_session_id.clone(),
                        previous_binding_compatibility_digest: Some(
                            credential.binding_compatibility_digest.clone(),
                        ),
                        proposed_binding_id: Some(credential.native_binding_id.clone()),
                        adapter_installation_id: credential.adapter_installation_id.clone(),
                        native_session_id: native_session_id.to_string(),
                        binding_compatibility_digest: credential
                            .binding_compatibility_digest
                            .clone(),
                    },
                },
            )
        }?;
        if binding.result.status == CommandResultStatus::Rejected {
            anyhow::bail!(
                "Native Session binding was rejected: {}",
                binding.result.code
            );
        }
        Ok(())
    }

    async fn settle_antigravity_input_acceptance(
        &self,
        execution: &AgentRunExecution,
        credential: &BuiltinToolBindingCredential,
        delivery_id: &str,
        accepted: &AntigravityInputAccepted,
        output: &mpsc::UnboundedSender<String>,
    ) -> Result<()> {
        let _runtime_route_permit = self
            .planned_shutdown
            .enter_runtime_route()
            .await
            .context("Antigravity Runtime route was fenced before input acceptance settled")?;
        self.bind_active_runtime_route(
            execution,
            RuntimeRouteBinding {
                route_identity: format!(
                    "agy-process:{}:{}",
                    execution.agent_run_id, execution.execution_epoch
                ),
                adapter_turn_correlation: accepted.native_turn_id.clone(),
                provider_turn_id: None,
            },
        )
        .await?;
        if let Err(error) = self
            .bind_prepared_native_session(execution, credential, &accepted.native_session_id)
            .await
        {
            let mut database = self.database.lock().await;
            ContextService.mark_input_delivery_unknown(
                &mut database,
                delivery_id,
                &format!(
                    "Native Session binding failed after accepted Antigravity input evidence: {error:#}"
                ),
            )?;
            return Err(error);
        }
        self.acknowledge_runtime_input(delivery_id, &accepted.native_turn_id)
            .await?;
        emit(
            output,
            "agent_run.native_session_bound",
            json!({
                "agentRunId": execution.agent_run_id,
                "executionEpoch": execution.execution_epoch,
                "adapterKind": execution.runtime.adapter_kind,
                "nativeThreadId": accepted.native_session_id,
                "nativeTurnId": accepted.native_turn_id,
            }),
        );
        Ok(())
    }

    async fn settle_claude_input_acceptance(
        &self,
        execution: &AgentRunExecution,
        credential: &BuiltinToolBindingCredential,
        target: &ClaudeInputAcceptanceTarget<'_>,
        accepted: &ClaudeCodeInputAccepted,
        output: &mpsc::UnboundedSender<String>,
    ) -> Result<()> {
        let _runtime_route_permit = self
            .planned_shutdown
            .enter_runtime_route()
            .await
            .context("Claude Code Runtime route was fenced before input acceptance settled")?;
        if accepted.native_session_id != target.expected_native_session_id
            || accepted.native_turn_id != target.expected_native_turn_id
        {
            anyhow::bail!("Claude Code accepted-input evidence identity did not match its Run");
        }
        self.bind_active_runtime_route(
            execution,
            RuntimeRouteBinding {
                route_identity: format!(
                    "claude-code-process:{}:{}",
                    execution.agent_run_id, execution.execution_epoch
                ),
                adapter_turn_correlation: accepted.native_turn_id.clone(),
                provider_turn_id: None,
            },
        )
        .await?;
        if !target.is_new_session
            && let Err(error) = self
                .bind_prepared_native_session(execution, credential, &accepted.native_session_id)
                .await
        {
            let mut database = self.database.lock().await;
            ContextService.mark_input_delivery_unknown(
                &mut database,
                target.delivery_id,
                &format!(
                    "Native Session binding failed after accepted Claude Code input evidence: {error:#}"
                ),
            )?;
            return Err(error);
        }
        self.acknowledge_runtime_input(target.delivery_id, &accepted.native_turn_id)
            .await?;
        emit(
            output,
            "agent_run.native_session_bound",
            json!({
                "agentRunId": execution.agent_run_id,
                "executionEpoch": execution.execution_epoch,
                "adapterKind": execution.runtime.adapter_kind,
                "nativeThreadId": accepted.native_session_id,
                "nativeTurnId": accepted.native_turn_id,
            }),
        );
        Ok(())
    }

    fn establish_acp_compaction_observer_best_effort(
        self: &Arc<Self>,
        execution: &AgentRunExecution,
        runtime: &Arc<AcpRuntime>,
        native_session_id: &str,
    ) {
        if self
            .compaction_detector_policies
            .policy_for(execution.runtime.adapter_kind)
            != Some(CompactionDetectorPolicy::BestEffort)
        {
            return;
        }
        let core = Arc::clone(self);
        let runtime = Arc::clone(runtime);
        let agent_run_id = execution.agent_run_id.clone();
        let execution_epoch = execution.execution_epoch;
        let adapter_kind = execution.runtime.adapter_kind;
        let host_instance_id = runtime.host_instance_id().to_string();
        let relay_process_id = runtime
            .builtin_tool_process_config()
            .map(BuiltinToolProcessConfig::process_id)
            .unwrap_or_default()
            .to_string();
        let native_session_id = native_session_id.to_string();
        tokio::spawn(async move {
            let lease = {
                let mut database = core.database.lock().await;
                establish_compaction_observer_lease(
                    &mut database,
                    &EstablishCompactionObserverLease {
                        agent_run_id: &agent_run_id,
                        execution_epoch,
                        adapter_kind,
                        host_instance_id: &host_instance_id,
                        relay_process_id: &relay_process_id,
                        native_session_id: &native_session_id,
                    },
                )
            };
            match lease {
                Ok(Some(lease)) => {
                    if let Err(error) = runtime.install_compaction_observer(lease).await {
                        eprintln!(
                            "{} Compaction Observer route is unavailable; AgentRun continues: {error:#}",
                            adapter_kind.as_str()
                        );
                    }
                }
                Ok(None) => {}
                Err(error) => eprintln!(
                    "{} Compaction Observer Lease is unavailable; AgentRun continues: {error:#}",
                    adapter_kind.as_str()
                ),
            }
        });
    }

    async fn prepare_runtime_for_dispatch(
        &self,
        candidate: &rovai_core::runtime::QueuedAgentRunCandidate,
        runtime: FrozenAgentRuntimeConfig,
    ) -> std::result::Result<(FrozenAgentRuntimeConfig, i64), RuntimeDispatchFailure> {
        let blocker = {
            let database = self.database.lock().await;
            AgentProfileService::default().runtime_dispatch_blocker(&database, &runtime)
        }
        .map_err(|error| RuntimeDispatchFailure {
            code: "runtime_configuration_invalid".to_string(),
            error,
            effective_version: None,
        })?;
        if let Some(blocker) = blocker {
            if runtime_blocker_is_refreshable(&blocker.code) {
                return self
                    .refresh_rebind_and_revalidate_runtime(candidate, runtime, &blocker.code)
                    .await;
            }
            return Err(RuntimeDispatchFailure {
                code: blocker.code,
                error: anyhow::anyhow!("{}", blocker.payload),
                effective_version: None,
            });
        }
        match self
            .inspect_runtime_integrity(&runtime)
            .await
            .map_err(|error| RuntimeDispatchFailure {
                code: "runtime_integrity_failed".to_string(),
                error,
                effective_version: None,
            })? {
            RuntimeIntegrityPreflight::Verified => Ok((runtime, candidate.version)),
            RuntimeIntegrityPreflight::DriftDetected(detail) => {
                self.refresh_rebind_and_revalidate_runtime(candidate, runtime, &detail)
                    .await
            }
        }
    }

    async fn refresh_rebind_and_revalidate_runtime(
        &self,
        candidate: &rovai_core::runtime::QueuedAgentRunCandidate,
        frozen_runtime: FrozenAgentRuntimeConfig,
        drift_reason: &str,
    ) -> std::result::Result<(FrozenAgentRuntimeConfig, i64), RuntimeDispatchFailure> {
        let installation = {
            let database = self.database.lock().await;
            AgentProfileService::default()
                .list_installations(&database)
                .and_then(|installations| {
                    installations
                        .into_iter()
                        .find(|installation| installation.id == frozen_runtime.installation_id)
                        .context("Runtime installation does not exist")
                })
        }
        .map_err(|error| RuntimeDispatchFailure {
            code: "runtime_integrity_failed".to_string(),
            error,
            effective_version: None,
        })?;
        if installation.adapter_kind != frozen_runtime.adapter_kind {
            return Err(RuntimeDispatchFailure {
                code: "runtime_integrity_failed".to_string(),
                error: anyhow::anyhow!(
                    "Runtime installation identity changed from {} to {}",
                    frozen_runtime.adapter_kind.as_str(),
                    installation.adapter_kind.as_str()
                ),
                effective_version: None,
            });
        }

        self.runtime_fleet
            .invalidate_adapter(frozen_runtime.adapter_kind)
            .await;
        let refresh = match installation.installation_class {
            InstallationClass::ManagedDefault => self
                .resolve_product_runtime(frozen_runtime.adapter_kind)
                .await
                .map(|_| ()),
            InstallationClass::Custom => {
                let search = self.runtime_search_environment.read().await.clone();
                let snapshot = with_runtime_search_environment(
                    &search,
                    self.deep_probe_candidate(
                        frozen_runtime.adapter_kind,
                        Path::new(&installation.executable_path),
                    ),
                )
                .await;
                match snapshot {
                    Ok(snapshot) => {
                        let mut database = self.database.lock().await;
                        AgentProfileService::default()
                            .record_snapshot(
                                &mut database,
                                &CommandEnvelope {
                                    command_id: uuid::Uuid::new_v4().to_string(),
                                    actor: ActorRef::System {
                                        component_id: "agent-run-scheduler".to_string(),
                                    },
                                    camp_id: Some(candidate.camp_id.clone()),
                                    expected_versions: Vec::new(),
                                    execution_epoch: None,
                                    payload: RecordAdapterCapabilitySnapshotCommand {
                                        installation_id: installation.id.clone(),
                                        expected_installation_version: installation.version,
                                        snapshot,
                                    },
                                },
                            )
                            .and_then(|execution| {
                                (execution.result.status == CommandResultStatus::Applied)
                                    .then_some(())
                                    .with_context(|| {
                                        format!(
                                            "Runtime refresh was rejected: {} {}",
                                            execution.result.code, execution.result.payload
                                        )
                                    })
                            })
                    }
                    Err(error) => Err(error),
                }
            }
        };
        if let Err(error) = refresh {
            self.schedule_runtime_check(frozen_runtime.adapter_kind)
                .await;
            return Err(RuntimeDispatchFailure {
                code: "runtime_refresh_failed".to_string(),
                error: error.context("Runtime drift refresh failed"),
                effective_version: None,
            });
        }

        let effective_runtime = {
            let database = self.database.lock().await;
            AgentProfileService::default().resolve_rebound_runtime(&database, &frozen_runtime)
        }
        .map_err(|error| RuntimeDispatchFailure {
            code: "runtime_configuration_invalid".to_string(),
            error,
            effective_version: None,
        })?
        .map_err(|blocker| RuntimeDispatchFailure {
            code: blocker.code,
            error: anyhow::anyhow!("{}", blocker.payload),
            effective_version: None,
        })?;

        let rebound = {
            let mut database = self.database.lock().await;
            ExecutionRuntimeService::default().rebind_agent_run_runtime(
                &mut database,
                &CommandEnvelope {
                    command_id: uuid::Uuid::new_v4().to_string(),
                    actor: ActorRef::System {
                        component_id: "agent-run-scheduler".to_string(),
                    },
                    camp_id: Some(candidate.camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: RebindAgentRunRuntimeCommand {
                        agent_run_id: candidate.agent_run_id.clone(),
                        expected_version: candidate.version,
                        drift_reason: drift_reason.to_string(),
                        effective_runtime: effective_runtime.clone(),
                    },
                },
            )
        }
        .map_err(|error| RuntimeDispatchFailure {
            code: "runtime_rebind_failed".to_string(),
            error,
            effective_version: None,
        })?;
        if rebound.result.status != CommandResultStatus::Applied {
            let code = match rebound.result.code.as_str() {
                "agent_run.runtime_identity_changed" | "agent_run.runtime_rebind_invalid" => {
                    "runtime_integrity_failed".to_string()
                }
                _ => rebound.result.code,
            };
            return Err(RuntimeDispatchFailure {
                code,
                error: anyhow::anyhow!("{}", rebound.result.payload),
                effective_version: None,
            });
        }
        let effective_version =
            rebound.result.payload["version"]
                .as_i64()
                .ok_or_else(|| RuntimeDispatchFailure {
                    code: "runtime_rebind_failed".to_string(),
                    error: anyhow::anyhow!("Runtime rebind did not return the AgentRun version"),
                    effective_version: None,
                })?;

        let blocker = {
            let database = self.database.lock().await;
            AgentProfileService::default().runtime_dispatch_blocker(&database, &effective_runtime)
        }
        .map_err(|error| RuntimeDispatchFailure {
            code: "runtime_configuration_invalid".to_string(),
            error,
            effective_version: Some(effective_version),
        })?;
        if let Some(blocker) = blocker {
            return Err(RuntimeDispatchFailure {
                code: blocker.code,
                error: anyhow::anyhow!("{}", blocker.payload),
                effective_version: Some(effective_version),
            });
        }
        match self
            .inspect_runtime_integrity(&effective_runtime)
            .await
            .map_err(|error| RuntimeDispatchFailure {
                code: "runtime_integrity_failed".to_string(),
                error,
                effective_version: Some(effective_version),
            })? {
            RuntimeIntegrityPreflight::Verified => Ok((effective_runtime, effective_version)),
            RuntimeIntegrityPreflight::DriftDetected(detail) => Err(RuntimeDispatchFailure {
                code: "runtime_integrity_failed".to_string(),
                error: anyhow::anyhow!(
                    "Runtime changed again during its bounded refresh: {detail}"
                ),
                effective_version: Some(effective_version),
            }),
        }
    }

    async fn inspect_runtime_integrity(
        &self,
        runtime: &FrozenAgentRuntimeConfig,
    ) -> Result<RuntimeIntegrityPreflight> {
        let verified = {
            let database = self.database.lock().await;
            AgentProfileService::default().verified_executable_identity(
                &database,
                &runtime.installation_id,
                &runtime.executable_path,
                &runtime.executable_fingerprint,
            )?
        };
        let executable_path_buf = PathBuf::from(&runtime.executable_path);
        let expected_fingerprint = runtime.executable_fingerprint.clone();
        let integrity = tokio::task::spawn_blocking(move || {
            verify_executable_integrity(
                &executable_path_buf,
                verified.as_ref(),
                &expected_fingerprint,
            )
        })
        .await
        .context("Runtime integrity worker failed")?;
        match integrity {
            Ok(ExecutableIntegrityStatus::Unchanged) => Ok(RuntimeIntegrityPreflight::Verified),
            Ok(ExecutableIntegrityStatus::Reverified(identity)) => {
                let mut database = self.database.lock().await;
                AgentProfileService::default().record_verified_executable_identity(
                    &mut database,
                    &runtime.installation_id,
                    &runtime.executable_path,
                    &runtime.executable_fingerprint,
                    &identity,
                )?;
                Ok(RuntimeIntegrityPreflight::Verified)
            }
            Ok(ExecutableIntegrityStatus::Changed) => {
                let mut database = self.database.lock().await;
                AgentProfileService::default().mark_runtime_integrity_changed(
                    &mut database,
                    &runtime.installation_id,
                    &runtime.executable_path,
                    &runtime.executable_fingerprint,
                )?;
                Ok(RuntimeIntegrityPreflight::DriftDetected(
                    "runtime_executable_fingerprint_changed".to_string(),
                ))
            }
            Err(_) => {
                let mut database = self.database.lock().await;
                AgentProfileService::default().mark_runtime_integrity_changed(
                    &mut database,
                    &runtime.installation_id,
                    &runtime.executable_path,
                    &runtime.executable_fingerprint,
                )?;
                Ok(RuntimeIntegrityPreflight::DriftDetected(
                    "runtime_executable_unavailable".to_string(),
                ))
            }
        }
    }

    async fn launch_agent_run(
        self: &Arc<Self>,
        execution: &AgentRunExecution,
        output: &mpsc::UnboundedSender<String>,
        launch_permit: &mut ExecutionLaunchPermit,
    ) -> Result<()> {
        let Some(skill_exposure) = self
            .prepare_agent_run_skill_exposure(execution)
            .await
            .context("failed to prepare AgentRun Skill exposure")?
        else {
            return Ok(());
        };
        let mut mcp_projection = self
            .prepare_agent_run_mcp_projection(execution)
            .await
            .context("failed to prepare AgentRun MCP projection")?;
        let attachment_access_root = CampAttachmentStore::new(&self.data_dir)
            .camp_root(&execution.camp_id)
            .context("failed to prepare the Camp Attachment access root")?;
        let resume_disposition = {
            let mut database = self.database.lock().await;
            ExecutionRuntimeService::default()
                .prepare_native_session_resume(&mut database, execution)
                .context("failed to prepare Native Session resume")?
        };
        if resume_disposition == NativeSessionResumeDisposition::Controlled {
            emit(
                output,
                "agent_run.native_session_resume_attempted",
                json!({
                    "agentRunId": execution.agent_run_id,
                    "conversationId": execution.conversation_id,
                    "adapterInstallationId": execution.runtime.installation_id,
                    "installationGeneration": execution.runtime.installation_generation,
                }),
            );
        }
        if execution.runtime.adapter_kind == rovai_core::agent_profile::AdapterKind::AntigravityApp
        {
            return self
                .launch_antigravity_agent_run(PreparedRuntimeLaunch {
                    execution,
                    resume_disposition,
                    skill_exposure: &skill_exposure,
                    mcp_projection: &mcp_projection,
                    attachment_access_root: &attachment_access_root,
                    output,
                    launch_permit,
                })
                .await;
        }
        if execution.runtime.adapter_kind == rovai_core::agent_profile::AdapterKind::ClaudeCodeCli {
            return self
                .launch_claude_code_agent_run(PreparedRuntimeLaunch {
                    execution,
                    resume_disposition,
                    skill_exposure: &skill_exposure,
                    mcp_projection: &mcp_projection,
                    attachment_access_root: &attachment_access_root,
                    output,
                    launch_permit,
                })
                .await;
        }
        if execution.runtime.adapter_kind.uses_acp() {
            return self
                .launch_acp_agent_run(PreparedRuntimeLaunch {
                    execution,
                    resume_disposition,
                    skill_exposure: &skill_exposure,
                    mcp_projection: &mcp_projection,
                    attachment_access_root: &attachment_access_root,
                    output,
                    launch_permit,
                })
                .await;
        }
        if execution.runtime.adapter_kind.as_str() != "codex-cli" {
            anyhow::bail!("AgentRun selected an unsupported Runtime Adapter");
        }
        let execution_root = PathBuf::from(&execution.workspace.execution_root);
        if !execution_root.is_dir() {
            anyhow::bail!(
                "AgentRun execution directory no longer exists: {}",
                execution_root.display()
            );
        }
        let initial_binding = self
            .prepare_builtin_tool_binding(
                execution,
                resume_disposition == NativeSessionResumeDisposition::New
                    && execution.native_session_id.is_some(),
            )
            .await?;
        let builtin_tools = self.prepare_builtin_tool_process_config()?;
        let runtime_compatibility_digest = codex::runtime_compatibility_digest(
            &execution.runtime,
            &execution_root,
            &attachment_access_root,
        )?;
        self.persist_runtime_compatibility_digest(execution, &runtime_compatibility_digest)
            .await?;
        let runtime = self
            .codex_cli
            .ensure_agent_run_runtime(CodexAgentRunRuntimeRequest {
                agent_run_id: &execution.agent_run_id,
                execution_epoch: execution.execution_epoch,
                camp_id: &execution.camp_id,
                agent_id: &execution.agent_id,
                cwd: &execution_root,
                frozen_runtime: &execution.runtime,
                runtime_compatibility_digest: &runtime_compatibility_digest,
                builtin_tools: &builtin_tools,
            })
            .await?;
        if !mcp_projection.servers.is_empty() {
            let native_mcp_server_names = runtime
                .discover_native_mcp_server_names(&execution_root)
                .await
                .context("failed to discover effective Codex native MCP names")?;
            mcp_projection.finalize_native_name_conflicts(&native_mcp_server_names)?;
        }
        let permission_values = execution
            .runtime
            .permissions
            .values
            .as_object()
            .context("AgentRun permission configuration must be an object")?;
        let configured_sandbox = permission_values
            .get("sandbox_mode")
            .and_then(Value::as_str)
            .context("Codex AgentRun requires sandbox_mode")?;
        let sandbox_mode = if execution.permission_semantics == PermissionSemantics::CoreEnforcedV1
            && execution.workspace.access == "read_only"
        {
            "read-only"
        } else {
            configured_sandbox
        };
        let approval_policy = permission_values
            .get("approval_policy")
            .and_then(Value::as_str)
            .context("Codex AgentRun requires approval_policy")?;
        let model = execution.runtime.model.model_id.as_str();
        let mut session_bootstrap = {
            let mut database = self.database.lock().await;
            ContextService
                .prepare_session_bootstrap(
                    &mut database,
                    &ManagedBlobStore::new(&self.data_dir),
                    &execution.agent_run_id,
                    execution.execution_epoch,
                    CharterDeliveryMode::NativeAppend,
                )?
                .payload
        };
        let resumable_session_id = initial_binding.native_session_id.clone();
        let mut binding_credential = initial_binding;
        let active_builtin_tools = runtime
            .builtin_tool_process_config()
            .context("Codex Runtime has no Built-in Tool process context")?
            .clone();
        self.bind_builtin_tool_runtime(&active_builtin_tools, execution, &binding_credential)
            .await?;
        let thread = runtime
            .start_or_resume_agent_thread(
                &execution_root,
                CodexAgentThreadOptions {
                    existing_thread_id: resumable_session_id.as_deref(),
                    developer_instructions: Some(session_bootstrap.as_str()),
                    sandbox_mode,
                    approval_policy,
                    model: Some(model),
                    attachment_access_root: &attachment_access_root,
                    external_mcp_servers: &mcp_projection.servers,
                },
            )
            .await;
        let thread_id = match thread {
            Ok(thread_id) => thread_id,
            Err(error) if resumable_session_id.is_some() => {
                if resume_disposition == NativeSessionResumeDisposition::Controlled {
                    let mut database = self.database.lock().await;
                    ExecutionRuntimeService::default().record_native_session_resume_failure(
                        &mut database,
                        execution,
                        classify_native_resume_failure(&error),
                    )?;
                }
                let replacement_binding =
                    self.prepare_builtin_tool_binding(execution, true).await?;
                let active_builtin_tools = runtime
                    .builtin_tool_process_config()
                    .context("Codex Runtime has no Built-in Tool process context")?
                    .clone();
                self.bind_builtin_tool_runtime(
                    &active_builtin_tools,
                    execution,
                    &replacement_binding,
                )
                .await?;
                session_bootstrap = {
                    let mut database = self.database.lock().await;
                    ContextService
                        .prepare_session_bootstrap(
                            &mut database,
                            &ManagedBlobStore::new(&self.data_dir),
                            &execution.agent_run_id,
                            execution.execution_epoch,
                            CharterDeliveryMode::NativeAppend,
                        )?
                        .payload
                };
                let thread_id = runtime
                    .start_or_resume_agent_thread(
                        &execution_root,
                        CodexAgentThreadOptions {
                            existing_thread_id: None,
                            developer_instructions: Some(session_bootstrap.as_str()),
                            sandbox_mode,
                            approval_policy,
                            model: Some(model),
                            attachment_access_root: &attachment_access_root,
                            external_mcp_servers: &mcp_projection.servers,
                        },
                    )
                    .await
                    .with_context(|| {
                        format!("failed to replace unavailable Native Session: {error:#}")
                    })?;
                binding_credential = replacement_binding;
                thread_id
            }
            Err(error) => return Err(error),
        };
        self.bind_prepared_native_session(execution, &binding_credential, &thread_id)
            .await?;
        let Some(prepared_context) = self
            .materialize_agent_run_context(
                execution,
                &skill_exposure,
                &mcp_projection,
                CharterDeliveryMode::NativeAppend,
                output,
            )
            .await?
        else {
            self.codex_cli
                .forget_agent_run(&execution.agent_run_id, execution.execution_epoch)
                .await;
            return Ok(());
        };
        let reasoning_effort = execution.runtime.model.options["reasoning_effort"].as_str();
        let delivery = {
            let mut database = self.database.lock().await;
            ContextService.prepare_input_delivery(
                &mut database,
                &execution.agent_run_id,
                execution.execution_epoch,
                &prepared_context.manifest_id,
            )
        }?;
        if delivery.status == "accepted" {
            anyhow::bail!(
                "accepted Codex input has no verified cross-process Native Turn reconciliation path"
            );
        }
        if delivery.status != "prepared" {
            anyhow::bail!("Runtime Input Delivery is not ready to send");
        }
        let native_turn_id = match runtime
            .start_turn_with_config(
                &prepared_context.rendered_payload,
                Some(model),
                reasoning_effort,
            )
            .await
        {
            Ok(native_turn_id) => native_turn_id,
            Err(error) => {
                let mut database = self.database.lock().await;
                ContextService.mark_input_delivery_unknown(
                    &mut database,
                    &delivery.id,
                    &format!("{error:#}"),
                )?;
                return Err(error).context("Codex input delivery outcome is unknown");
            }
        };
        self.bind_active_runtime_route(
            execution,
            RuntimeRouteBinding {
                route_identity: runtime.host_instance_id().to_string(),
                adapter_turn_correlation: native_turn_id.clone(),
                provider_turn_id: Some(native_turn_id.clone()),
            },
        )
        .await?;
        launch_permit.complete_handoff();
        self.acknowledge_runtime_input(&delivery.id, &native_turn_id)
            .await?;
        emit(
            output,
            "agent_run.started",
            json!({
                "campId": execution.camp_id,
                "campTurnId": execution.camp_turn_id,
                "agentRunId": execution.agent_run_id,
                "agentId": execution.agent_id,
                "executionEpoch": execution.execution_epoch,
                "adapterKind": execution.runtime.adapter_kind,
                "adapterInstallationId": execution.runtime.installation_id,
                "runtimeVersion": execution.runtime.reported_version,
                "modelId": execution.runtime.model.model_id,
                "modelOptions": execution.runtime.model.options,
                "hostInstanceId": runtime.host_instance_id(),
                "nativeThreadId": thread_id,
                "nativeTurnId": native_turn_id,
            }),
        );
        Ok(())
    }

    async fn launch_claude_code_agent_run(&self, launch: PreparedRuntimeLaunch<'_>) -> Result<()> {
        let PreparedRuntimeLaunch {
            execution,
            resume_disposition,
            skill_exposure,
            mcp_projection,
            attachment_access_root,
            output,
            launch_permit,
        } = launch;
        let execution_root = PathBuf::from(&execution.workspace.execution_root);
        if !execution_root.is_dir() {
            anyhow::bail!(
                "AgentRun execution directory no longer exists: {}",
                execution_root.display()
            );
        }
        // The credential identifies the long-lived Native Binding, not this
        // AgentRun. Core resolves the current active Run at every tool call.
        let binding_credential = self
            .prepare_builtin_tool_binding(
                execution,
                resume_disposition == NativeSessionResumeDisposition::New
                    && execution.native_session_id.is_some(),
            )
            .await?;
        let is_new_session = binding_credential.native_session_id.is_none();
        let native_session_id = binding_credential
            .native_session_id
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let Some(prepared_context) = self
            .materialize_agent_run_context(
                execution,
                skill_exposure,
                mcp_projection,
                CharterDeliveryMode::NativeAppend,
                output,
            )
            .await?
        else {
            return Ok(());
        };
        let session_bootstrap = {
            let mut database = self.database.lock().await;
            ContextService
                .prepare_session_bootstrap(
                    &mut database,
                    &ManagedBlobStore::new(&self.data_dir),
                    &execution.agent_run_id,
                    execution.execution_epoch,
                    CharterDeliveryMode::NativeAppend,
                )?
                .payload
        };
        if is_new_session {
            self.bind_prepared_native_session(execution, &binding_credential, &native_session_id)
                .await?;
        }
        let delivery = {
            let mut database = self.database.lock().await;
            ContextService.prepare_input_delivery(
                &mut database,
                &execution.agent_run_id,
                execution.execution_epoch,
                &prepared_context.manifest_id,
            )
        }?;
        if delivery.status == "accepted" {
            anyhow::bail!(
                "Claude Code cannot reattach to an already accepted one-shot input; create a successor AgentRun"
            );
        }
        if delivery.status != "prepared" {
            anyhow::bail!("Claude Code Runtime Input Delivery is not ready to send");
        }
        let native_turn_id = format!(
            "claude-code:{}:{}",
            execution.agent_run_id, execution.execution_epoch
        );
        let acceptance_target = ClaudeInputAcceptanceTarget {
            delivery_id: &delivery.id,
            expected_native_session_id: &native_session_id,
            expected_native_turn_id: &native_turn_id,
            is_new_session,
        };
        emit(
            output,
            "agent_run.started",
            json!({
                "campId": execution.camp_id,
                "campTurnId": execution.camp_turn_id,
                "agentRunId": execution.agent_run_id,
                "agentId": execution.agent_id,
                "executionEpoch": execution.execution_epoch,
                "adapterKind": execution.runtime.adapter_kind,
                "adapterInstallationId": execution.runtime.installation_id,
                "runtimeVersion": execution.runtime.reported_version,
                "modelId": execution.runtime.model.model_id,
                "modelOptions": execution.runtime.model.options,
                "hostInstanceId": format!(
                    "claude-code-process:{}:{}",
                    execution.agent_run_id, execution.execution_epoch
                ),
                "nativeThreadId": native_session_id,
                "nativeTurnId": native_turn_id,
            }),
        );
        let prompt = prepared_context.rendered_payload.clone();
        let builtin_tools = self.prepare_builtin_tool_process_config()?;
        self.bind_builtin_tool_runtime(&builtin_tools, execution, &binding_credential)
            .await?;
        let (input_accepted_sender, mut input_accepted_receiver) = mpsc::unbounded_channel();
        let (launch_handoff_sender, mut launch_handoff_receiver) = oneshot::channel();
        let run = self.claude_code_cli.run(ClaudeCodeRunRequest {
            agent_run_id: execution.agent_run_id.clone(),
            execution_epoch: execution.execution_epoch,
            workspace: execution.workspace.clone(),
            permission_semantics: execution.permission_semantics,
            runtime: execution.runtime.clone(),
            prompt: prompt.clone(),
            resumable_native_session_id: (!is_new_session).then_some(native_session_id.clone()),
            new_native_session_id: is_new_session.then_some(native_session_id.clone()),
            session_bootstrap: Some(session_bootstrap.clone()),
            builtin_tools: Some(builtin_tools.clone()),
            external_mcp_servers: mcp_projection.servers.clone(),
            attachment_access_root: Some(attachment_access_root.to_path_buf()),
            persist_session: true,
            input_accepted: Some(input_accepted_sender),
            launch_handoff: Some(launch_handoff_sender),
        });
        tokio::pin!(run);
        let mut early_result = tokio::select! {
            biased;
            handoff = &mut launch_handoff_receiver => {
                handoff.context("Claude Code launch handoff was lost")?;
                self.bind_active_runtime_route(
                    execution,
                    RuntimeRouteBinding {
                        route_identity: format!(
                            "claude-code-process:{}:{}",
                            execution.agent_run_id, execution.execution_epoch
                        ),
                        adapter_turn_correlation: native_turn_id.clone(),
                        provider_turn_id: None,
                    },
                )
                .await?;
                launch_permit.complete_handoff();
                None
            }
            result = &mut run => {
                Some(result)
            }
        };
        let result_and_acceptance: Result<_> = async {
            let mut accepted_input = None;
            let mut acceptance_channel_open = true;
            let result = loop {
                if let Some(result) = early_result.take() {
                    break result;
                }
                let (observed_acceptance, completed) = tokio::select! {
                    biased;
                    observed = input_accepted_receiver.recv(), if acceptance_channel_open => {
                        (Some(observed), None)
                    }
                    result = &mut run => (None, Some(result)),
                };
                if let Some(result) = completed {
                    break result;
                }
                acceptance_channel_open = false;
                let Some(Some(observed_acceptance)) = observed_acceptance else {
                    continue;
                };
                if let Err(error) = self
                    .settle_claude_input_acceptance(
                        execution,
                        &binding_credential,
                        &acceptance_target,
                        &observed_acceptance,
                        output,
                    )
                    .await
                {
                    let _ = self
                        .claude_code_cli
                        .interrupt(&execution.agent_run_id, execution.execution_epoch)
                        .await;
                    let _ = run.as_mut().await;
                    return Err(error);
                }
                accepted_input = Some(observed_acceptance);
            };
            if accepted_input.is_none()
                && let Ok(observed_acceptance) = input_accepted_receiver.try_recv()
            {
                self.settle_claude_input_acceptance(
                    execution,
                    &binding_credential,
                    &acceptance_target,
                    &observed_acceptance,
                    output,
                )
                .await?;
                accepted_input = Some(observed_acceptance);
            }
            Ok((result, accepted_input))
        }
        .await;
        self.builtin_tool_leases
            .unbind(
                builtin_tools.process_id(),
                &execution.agent_run_id,
                execution.execution_epoch,
            )
            .await;
        let (result, accepted_input) = result_and_acceptance?;
        let result = match result {
            Ok(result) => {
                if let Some(accepted) = accepted_input.as_ref()
                    && (accepted.native_session_id != result.native_session_id
                        || accepted.native_turn_id != result.native_turn_id)
                {
                    anyhow::bail!(
                        "Claude Code terminal identity did not match its accepted input evidence"
                    );
                }
                result
            }
            Err(error) => {
                if let Some(delivered) = error.downcast_ref::<ClaudeCodeDeliveredFailure>().cloned()
                {
                    if let Some(accepted) = accepted_input.as_ref()
                        && (accepted.native_session_id != delivered.native_session_id
                            || accepted.native_turn_id != delivered.native_turn_id)
                    {
                        anyhow::bail!(
                            "Claude Code terminal identity did not match its accepted input evidence"
                        );
                    }
                    if accepted_input.is_none() {
                        let observed_acceptance = ClaudeCodeInputAccepted {
                            native_session_id: delivered.native_session_id.clone(),
                            native_turn_id: delivered.native_turn_id.clone(),
                        };
                        self.settle_claude_input_acceptance(
                            execution,
                            &binding_credential,
                            &acceptance_target,
                            &observed_acceptance,
                            output,
                        )
                        .await?;
                    }
                    return Err(error).context(delivered.error_code);
                }
                if accepted_input.is_some() {
                    return Err(error).context("Claude Code failed after accepting its input");
                }
                let mut database = self.database.lock().await;
                if resume_disposition == NativeSessionResumeDisposition::Controlled {
                    ExecutionRuntimeService::default().record_native_session_resume_failure(
                        &mut database,
                        execution,
                        NativeSessionResumeFailure::Ambiguous,
                    )?;
                }
                ContextService.mark_input_delivery_unknown(
                    &mut database,
                    &delivery.id,
                    &format!("{error:#}"),
                )?;
                return Err(error).context("Claude Code non-interactive input outcome is unknown");
            }
        };
        if accepted_input.is_none() {
            self.settle_claude_input_acceptance(
                execution,
                &binding_credential,
                &acceptance_target,
                &ClaudeCodeInputAccepted {
                    native_session_id: result.native_session_id.clone(),
                    native_turn_id: result.native_turn_id.clone(),
                },
                output,
            )
            .await?;
        }
        self.complete_one_shot_agent_run(
            execution,
            &result.native_turn_id,
            &result.final_output,
            &MissingSendRecoveryCandidate::new(
                MissingSendRecoveryBoundary::ClaudeSuccessResult,
                result.final_output.clone(),
            ),
            output,
        )
        .await
    }

    async fn complete_one_shot_agent_run(
        &self,
        execution: &AgentRunExecution,
        native_turn_id: &str,
        final_output: &str,
        missing_send_recovery_candidate: &MissingSendRecoveryCandidate,
        output: &mpsc::UnboundedSender<String>,
    ) -> Result<()> {
        let _runtime_route_permit = self
            .planned_shutdown
            .enter_runtime_route()
            .await
            .context("one-shot Runtime route was fenced before terminal settlement")?;
        let route_identity = match execution.runtime.adapter_kind {
            AdapterKind::ClaudeCodeCli => format!(
                "claude-code-process:{}:{}",
                execution.agent_run_id, execution.execution_epoch
            ),
            AdapterKind::AntigravityApp => format!(
                "agy-process:{}:{}",
                execution.agent_run_id, execution.execution_epoch
            ),
            _ => anyhow::bail!("one-shot terminal used an unsupported Runtime Adapter"),
        };
        let terminal_discriminator = canonical_json_digest(&json!({
            "nativeTurnId": native_turn_id,
            "finalOutput": final_output,
        }))?;
        let planned_terminal_permit = self
            .admit_planned_shutdown_terminal(
                &execution.agent_run_id,
                execution.execution_epoch,
                RuntimeRouteBinding {
                    route_identity,
                    adapter_turn_correlation: native_turn_id.to_string(),
                    provider_turn_id: None,
                },
                RuntimeTerminalOutcome::Succeeded,
                &terminal_discriminator,
            )
            .await?;
        for attempt in 0..80 {
            let current = {
                let database = self.database.lock().await;
                ExecutionRuntimeService::default().load_agent_run_execution(
                    &database,
                    &execution.agent_run_id,
                    execution.execution_epoch,
                )
            }?;
            let Some(current) = current else {
                self.planned_shutdown
                    .remove_active(&ActiveExecutionKey::new(
                        &execution.agent_run_id,
                        execution.execution_epoch,
                    ))
                    .await;
                return Ok(());
            };
            let ending_git_observation = self
                .observe_run_git(&current.project_binding_kind, &current.project_path)
                .await;
            let terminal_envelope = CommandEnvelope {
                command_id: uuid::Uuid::new_v4().to_string(),
                actor: ActorRef::System {
                    component_id: format!(
                        "runtime-adapter:{}",
                        execution.runtime.adapter_kind.as_str()
                    ),
                },
                camp_id: Some(current.camp_id.clone()),
                expected_versions: Vec::new(),
                execution_epoch: None,
                payload: SucceedAgentRunCommand {
                    agent_run_id: current.agent_run_id.clone(),
                    expected_version: current.version,
                    execution_epoch: current.execution_epoch,
                    native_turn_id: native_turn_id.to_string(),
                    final_output: final_output.to_string(),
                    missing_send_recovery_candidate: Some(missing_send_recovery_candidate.clone()),
                    ending_git_observation,
                },
            };
            let terminal = {
                let mut database = self.database.lock().await;
                let service = ExecutionRuntimeService::default();
                match planned_terminal_permit.as_ref() {
                    Some(permit) => service.succeed_agent_run_during_planned_shutdown(
                        &mut database,
                        permit,
                        &terminal_envelope,
                    ),
                    None => service.succeed_agent_run(&mut database, &terminal_envelope),
                }
            }?;
            if terminal.result.status != CommandResultStatus::Rejected {
                emit(
                    output,
                    "agent_run.terminal",
                    json!({
                        "agentRunId": execution.agent_run_id,
                        "executionEpoch": execution.execution_epoch,
                        "adapterKind": execution.runtime.adapter_kind,
                        "result": terminal.result,
                        "replayed": terminal.replayed,
                    }),
                );
                self.reconcile_skill_projection_after_run_terminal(
                    &current.workspace.execution_root,
                )
                .await;
                self.planned_shutdown
                    .remove_active(&ActiveExecutionKey::new(
                        &execution.agent_run_id,
                        execution.execution_epoch,
                    ))
                    .await;
                return Ok(());
            }
            if attempt < 79
                && matches!(
                    terminal.result.code.as_str(),
                    "agent_run.version_conflict"
                        | "agent_run.terminal_fenced"
                        | "agent_run.terminal_safety_blocked"
                )
            {
                tokio::time::sleep(Duration::from_millis(25)).await;
                continue;
            }
            anyhow::bail!(
                "{} AgentRun completion was rejected: {}",
                execution.runtime.adapter_kind.as_str(),
                terminal.result.code
            );
        }
        anyhow::bail!(
            "{} AgentRun completion did not converge",
            execution.runtime.adapter_kind.as_str()
        )
    }

    async fn launch_antigravity_agent_run(&self, launch: PreparedRuntimeLaunch<'_>) -> Result<()> {
        let PreparedRuntimeLaunch {
            execution,
            resume_disposition,
            skill_exposure,
            mcp_projection,
            attachment_access_root,
            output,
            launch_permit,
        } = launch;
        let execution_root = PathBuf::from(&execution.workspace.execution_root);
        if !execution_root.is_dir() {
            anyhow::bail!(
                "AgentRun execution directory no longer exists: {}",
                execution_root.display()
            );
        }
        let binding_credential = {
            let mut database = self.database.lock().await;
            TeamToolService::default().prepare_binding_credential(
                &mut database,
                &execution.agent_run_id,
                execution.execution_epoch,
                resume_disposition == NativeSessionResumeDisposition::New
                    && execution.native_session_id.is_some(),
            )?
        };
        let Some(prepared_context) = self
            .materialize_agent_run_context(
                execution,
                skill_exposure,
                mcp_projection,
                CharterDeliveryMode::FirstPayload,
                output,
            )
            .await?
        else {
            return Ok(());
        };
        let prompt = prepared_context.runtime_payload.clone();
        let resumable_session_id = (resume_disposition != NativeSessionResumeDisposition::New)
            .then(|| execution.native_session_id.clone())
            .flatten();
        let proposed_binding_id = prepared_context
            .requires_new_native_session
            .then(|| binding_credential.native_binding_id.clone());
        let input_delivery = if let Some(proposed_binding_id) = proposed_binding_id.as_deref() {
            let mut database = self.database.lock().await;
            ContextService.prepare_input_delivery_for_binding(
                &mut database,
                &execution.agent_run_id,
                execution.execution_epoch,
                &prepared_context.manifest_id,
                proposed_binding_id,
            )?
        } else {
            let mut database = self.database.lock().await;
            ContextService.prepare_input_delivery(
                &mut database,
                &execution.agent_run_id,
                execution.execution_epoch,
                &prepared_context.manifest_id,
            )?
        };
        if input_delivery.status == "accepted" {
            anyhow::bail!(
                "Antigravity companion cannot reattach to an already accepted one-shot input; create a successor AgentRun"
            );
        }
        if input_delivery.status != "prepared" {
            anyhow::bail!("Antigravity Runtime Input Delivery is not ready to send");
        }
        let native_turn_id = format!(
            "agy:{}:{}",
            execution.agent_run_id, execution.execution_epoch
        );
        emit(
            output,
            "agent_run.started",
            json!({
                "campId": execution.camp_id,
                "campTurnId": execution.camp_turn_id,
                "agentRunId": execution.agent_run_id,
                "agentId": execution.agent_id,
                "executionEpoch": execution.execution_epoch,
                "adapterKind": execution.runtime.adapter_kind,
                "adapterInstallationId": execution.runtime.installation_id,
                "runtimeVersion": execution.runtime.reported_version,
                "modelId": execution.runtime.model.model_id,
                "modelOptions": execution.runtime.model.options,
                "hostInstanceId": format!("agy-process:{}:{}", execution.agent_run_id, execution.execution_epoch),
                "nativeThreadId": resumable_session_id,
                "nativeTurnId": native_turn_id,
            }),
        );
        let builtin_tools = self.prepare_builtin_tool_process_config()?;
        self.bind_builtin_tool_runtime(&builtin_tools, execution, &binding_credential)
            .await?;
        let (input_accepted_sender, mut input_accepted_receiver) = mpsc::unbounded_channel();
        let (launch_handoff_sender, mut launch_handoff_receiver) = oneshot::channel();
        let run = self.antigravity_app.run(AntigravityRunRequest {
            agent_run_id: execution.agent_run_id.clone(),
            execution_epoch: execution.execution_epoch,
            workspace: execution.workspace.clone(),
            permission_semantics: execution.permission_semantics,
            runtime: execution.runtime.clone(),
            prompt,
            resumable_native_session_id: resumable_session_id,
            attachment_access_root: Some(attachment_access_root.to_path_buf()),
            builtin_tools: Some(builtin_tools.clone()),
            input_accepted: Some(input_accepted_sender),
            launch_handoff: Some(launch_handoff_sender),
        });
        tokio::pin!(run);
        let mut early_result = tokio::select! {
            biased;
            handoff = &mut launch_handoff_receiver => {
                handoff.context("Antigravity launch handoff was lost")?;
                self.bind_active_runtime_route(
                    execution,
                    RuntimeRouteBinding {
                        route_identity: format!(
                            "agy-process:{}:{}",
                            execution.agent_run_id, execution.execution_epoch
                        ),
                        adapter_turn_correlation: native_turn_id.clone(),
                        provider_turn_id: None,
                    },
                )
                .await?;
                launch_permit.complete_handoff();
                None
            }
            result = &mut run => {
                Some(result)
            }
        };
        let result_and_acceptance: Result<_> = async {
            let mut accepted_input = None;
            let mut acceptance_channel_open = true;
            let result = loop {
                if let Some(result) = early_result.take() {
                    break result;
                }
                let (observed_acceptance, completed) = tokio::select! {
                    biased;
                    observed = input_accepted_receiver.recv(), if acceptance_channel_open => {
                        (Some(observed), None)
                    }
                    result = &mut run => (None, Some(result)),
                };
                if let Some(result) = completed {
                    break result;
                }
                acceptance_channel_open = false;
                let Some(Some(observed_acceptance)) = observed_acceptance else {
                    continue;
                };
                if let Err(error) = self
                    .settle_antigravity_input_acceptance(
                        execution,
                        &binding_credential,
                        &input_delivery.id,
                        &observed_acceptance,
                        output,
                    )
                    .await
                {
                    let _ = self
                        .antigravity_app
                        .interrupt(&execution.agent_run_id, execution.execution_epoch)
                        .await;
                    let _ = run.as_mut().await;
                    return Err(error);
                }
                accepted_input = Some(observed_acceptance);
            };
            // The adapter performs a final log scan before returning. Consume
            // evidence queued in the same scheduling turn even if completion
            // won the select race.
            if accepted_input.is_none()
                && let Ok(observed_acceptance) = input_accepted_receiver.try_recv()
            {
                self.settle_antigravity_input_acceptance(
                    execution,
                    &binding_credential,
                    &input_delivery.id,
                    &observed_acceptance,
                    output,
                )
                .await?;
                accepted_input = Some(observed_acceptance);
            }
            Ok((result, accepted_input))
        }
        .await;
        self.builtin_tool_leases
            .unbind(
                builtin_tools.process_id(),
                &execution.agent_run_id,
                execution.execution_epoch,
            )
            .await;
        let (result, accepted_input) = result_and_acceptance?;
        let result = match result {
            Ok(result) => {
                if let Some(accepted) = accepted_input.as_ref()
                    && (accepted.native_session_id != result.native_session_id
                        || accepted.native_turn_id != result.native_turn_id)
                {
                    return Err(anyhow::anyhow!(
                        "Antigravity terminal identity did not match its accepted input evidence"
                    ))
                    .context(AntigravityDeliveredFailure {
                        native_session_id: accepted.native_session_id.clone(),
                        native_turn_id: accepted.native_turn_id.clone(),
                        error_code: "runtime_native_session_mismatch",
                    });
                }
                result
            }
            Err(error) => {
                if let Some(accepted) = accepted_input.as_ref() {
                    if let Some(delivered) = error.downcast_ref::<AntigravityDeliveredFailure>()
                        && (delivered.native_session_id != accepted.native_session_id
                            || delivered.native_turn_id != accepted.native_turn_id)
                    {
                        return Err(error).context(AntigravityDeliveredFailure {
                            native_session_id: accepted.native_session_id.clone(),
                            native_turn_id: accepted.native_turn_id.clone(),
                            error_code: "runtime_native_session_mismatch",
                        });
                    }
                    if let Some(error_code) = error
                        .downcast_ref::<AntigravityDeliveredFailure>()
                        .map(|delivered| delivered.error_code)
                    {
                        return Err(error).context(error_code);
                    }
                    return Err(error).context(AntigravityDeliveredFailure {
                        native_session_id: accepted.native_session_id.clone(),
                        native_turn_id: accepted.native_turn_id.clone(),
                        error_code: "runtime_failed_after_input_accepted",
                    });
                }
                if let Some(delivered) =
                    error.downcast_ref::<AntigravityDeliveredFailure>().cloned()
                {
                    self.settle_antigravity_input_acceptance(
                        execution,
                        &binding_credential,
                        &input_delivery.id,
                        &AntigravityInputAccepted {
                            native_session_id: delivered.native_session_id.clone(),
                            native_turn_id: delivered.native_turn_id.clone(),
                        },
                        output,
                    )
                    .await?;
                    // The verified Native Session proves that the one-shot
                    // input was accepted. Return a deterministic Run failure
                    // to the scheduler; replaying it as delivery_unknown could
                    // duplicate edits or Team Tool effects.
                    return Err(error).context(delivered.error_code);
                }
                let mut database = self.database.lock().await;
                if resume_disposition == NativeSessionResumeDisposition::Controlled {
                    ExecutionRuntimeService::default().record_native_session_resume_failure(
                        &mut database,
                        execution,
                        NativeSessionResumeFailure::Ambiguous,
                    )?;
                }
                ContextService.mark_input_delivery_unknown(
                    &mut database,
                    &input_delivery.id,
                    &format!("{error:#}"),
                )?;
                return Err(error)
                    .context("Antigravity companion non-interactive input outcome is unknown");
            }
        };

        if accepted_input.is_none() {
            self.settle_antigravity_input_acceptance(
                execution,
                &binding_credential,
                &input_delivery.id,
                &AntigravityInputAccepted {
                    native_session_id: result.native_session_id.clone(),
                    native_turn_id: result.native_turn_id.clone(),
                },
                output,
            )
            .await?;
        }

        self.complete_one_shot_agent_run(
            execution,
            &result.native_turn_id,
            &result.final_output,
            &MissingSendRecoveryCandidate::new(
                MissingSendRecoveryBoundary::AntigravityPrintStdout,
                result.final_output.clone(),
            ),
            output,
        )
        .await
    }

    async fn launch_acp_agent_run(
        self: &Arc<Self>,
        launch: PreparedRuntimeLaunch<'_>,
    ) -> Result<()> {
        let PreparedRuntimeLaunch {
            execution,
            resume_disposition,
            skill_exposure,
            mcp_projection,
            attachment_access_root,
            output,
            launch_permit,
        } = launch;
        let execution_root = PathBuf::from(&execution.workspace.execution_root);
        if !execution_root.is_dir() {
            anyhow::bail!(
                "AgentRun execution directory no longer exists: {}",
                execution_root.display()
            );
        }
        let adapter = self
            .acp_adapter(execution.runtime.adapter_kind)
            .context("AgentRun selected an unsupported ACP Adapter")?;
        let initial_binding = self
            .prepare_builtin_tool_binding(
                execution,
                resume_disposition == NativeSessionResumeDisposition::New
                    && execution.native_session_id.is_some(),
            )
            .await?;
        let builtin_tools = self.prepare_builtin_tool_process_config()?;
        let mut runtime_compatibility_digest = acp::runtime_compatibility_digest(
            &execution.runtime,
            &execution.workspace,
            execution.permission_semantics,
            &mcp_projection.servers,
            &mcp_projection.projection_digest,
            attachment_access_root,
        )?;
        self.persist_runtime_compatibility_digest(execution, &runtime_compatibility_digest)
            .await?;
        let runtime_result = adapter
            .ensure_agent_run_runtime(
                &execution.agent_run_id,
                execution.execution_epoch,
                &execution.camp_id,
                &execution.agent_id,
                &execution.workspace,
                execution.permission_semantics,
                &execution.runtime,
                &builtin_tools,
                &mcp_projection.servers,
                &mcp_projection.projection_digest,
                attachment_access_root,
                &runtime_compatibility_digest,
            )
            .await;
        let mut runtime = runtime_result?;
        let active_builtin_tools = runtime
            .builtin_tool_process_config()
            .context("ACP Runtime has no Built-in Tool process context")?
            .clone();
        self.bind_builtin_tool_runtime(&active_builtin_tools, execution, &initial_binding)
            .await?;
        let resumable_session_id = initial_binding.native_session_id.clone();
        let supports_load = execution
            .runtime
            .capabilities
            .iter()
            .any(|capability| capability == "session.load");
        let model = execution.runtime.model.model_id.as_str();
        let session = runtime
            .start_or_resume_session(
                resumable_session_id.as_deref(),
                supports_load,
                model,
                &execution.runtime.model.options,
                &mcp_projection.servers,
            )
            .await;
        let mut binding_credential = initial_binding;
        let session_id = match session {
            Ok(session_id) => session_id,
            Err(error) if resumable_session_id.is_some() => {
                if resume_disposition == NativeSessionResumeDisposition::Controlled {
                    let mut database = self.database.lock().await;
                    ExecutionRuntimeService::default().record_native_session_resume_failure(
                        &mut database,
                        execution,
                        classify_native_resume_failure(&error),
                    )?;
                }
                adapter
                    .forget_agent_run(&execution.agent_run_id, execution.execution_epoch)
                    .await;
                let replacement_binding =
                    self.prepare_builtin_tool_binding(execution, true).await?;
                runtime_compatibility_digest = acp::runtime_compatibility_digest(
                    &execution.runtime,
                    &execution.workspace,
                    execution.permission_semantics,
                    &mcp_projection.servers,
                    &mcp_projection.projection_digest,
                    attachment_access_root,
                )?;
                self.persist_runtime_compatibility_digest(execution, &runtime_compatibility_digest)
                    .await?;
                runtime = adapter
                    .ensure_agent_run_runtime(
                        &execution.agent_run_id,
                        execution.execution_epoch,
                        &execution.camp_id,
                        &execution.agent_id,
                        &execution.workspace,
                        execution.permission_semantics,
                        &execution.runtime,
                        &builtin_tools,
                        &mcp_projection.servers,
                        &mcp_projection.projection_digest,
                        attachment_access_root,
                        &runtime_compatibility_digest,
                    )
                    .await?;
                let active_builtin_tools = runtime
                    .builtin_tool_process_config()
                    .context("ACP Runtime has no Built-in Tool process context")?
                    .clone();
                self.bind_builtin_tool_runtime(
                    &active_builtin_tools,
                    execution,
                    &replacement_binding,
                )
                .await?;
                let session_id = runtime
                    .start_or_resume_session(
                        None,
                        supports_load,
                        model,
                        &execution.runtime.model.options,
                        &mcp_projection.servers,
                    )
                    .await
                    .with_context(|| {
                        format!("failed to replace unavailable ACP Native Session: {error:#}")
                    })?;
                binding_credential = replacement_binding;
                session_id
            }
            Err(error) => return Err(error),
        };
        self.bind_prepared_native_session(execution, &binding_credential, &session_id)
            .await
            .context("failed to bind ACP Native Session")?;
        self.establish_acp_compaction_observer_best_effort(execution, &runtime, &session_id);
        let Some((prepared_context, delivery)) = self
            .materialize_and_prepare_agent_run_input(
                execution,
                skill_exposure,
                mcp_projection,
                CharterDeliveryMode::FirstPayload,
                output,
            )
            .await
            .context("failed to atomically prepare ACP AgentRun input")?
        else {
            adapter
                .forget_agent_run(&execution.agent_run_id, execution.execution_epoch)
                .await;
            return Ok(());
        };
        if delivery.status == "accepted" {
            anyhow::bail!(
                "accepted ACP input has no verified cross-process Native Turn reconciliation path"
            );
        }
        if delivery.status != "prepared" {
            anyhow::bail!("Runtime Input Delivery is not ready to send");
        }
        let native_prompt_id = match runtime
            .start_prompt(&delivery.id, &prepared_context.runtime_payload)
            .await
        {
            Ok(native_prompt_id) => native_prompt_id,
            Err(error) => {
                let mut database = self.database.lock().await;
                ContextService.mark_input_delivery_unknown(
                    &mut database,
                    &delivery.id,
                    &format!("{error:#}"),
                )?;
                return Err(error).context("ACP input delivery outcome is unknown");
            }
        };
        self.bind_active_runtime_route(
            execution,
            RuntimeRouteBinding {
                route_identity: runtime.host_instance_id().to_string(),
                adapter_turn_correlation: native_prompt_id.clone(),
                provider_turn_id: None,
            },
        )
        .await?;
        launch_permit.complete_handoff();
        emit(
            output,
            "agent_run.started",
            json!({
                "campId": execution.camp_id,
                "campTurnId": execution.camp_turn_id,
                "agentRunId": execution.agent_run_id,
                "agentId": execution.agent_id,
                "executionEpoch": execution.execution_epoch,
                "adapterKind": execution.runtime.adapter_kind,
                "adapterInstallationId": execution.runtime.installation_id,
                "runtimeVersion": execution.runtime.reported_version,
                "modelId": execution.runtime.model.model_id,
                "modelOptions": execution.runtime.model.options,
                "hostInstanceId": runtime.host_instance_id(),
                "nativeThreadId": session_id,
                "nativeTurnId": native_prompt_id,
            }),
        );
        Ok(())
    }

    async fn fail_claimed_agent_run(
        &self,
        execution: &AgentRunExecution,
        error_code: &str,
        error: &anyhow::Error,
        runtime_terminal_observed: bool,
    ) {
        let ending_git_observation = self
            .observe_run_git(&execution.project_binding_kind, &execution.project_path)
            .await;
        let failure = {
            let mut database = self.database.lock().await;
            let envelope = CommandEnvelope {
                command_id: uuid::Uuid::new_v4().to_string(),
                actor: ActorRef::System {
                    component_id: format!(
                        "runtime-adapter:{}",
                        execution.runtime.adapter_kind.as_str()
                    ),
                },
                camp_id: Some(execution.camp_id.clone()),
                expected_versions: Vec::new(),
                execution_epoch: None,
                payload: FailAgentRunCommand {
                    agent_run_id: execution.agent_run_id.clone(),
                    expected_version: execution.version,
                    execution_epoch: execution.execution_epoch,
                    error_code: error_code.to_string(),
                    error_detail: Some(format!("{error:#}")),
                    manual_retry_allowed: true,
                    ending_git_observation,
                },
            };
            let service = ExecutionRuntimeService::default();
            if runtime_terminal_observed {
                service.fail_agent_run(&mut database, &envelope)
            } else {
                service.fail_agent_run_without_runtime_terminal(&mut database, &envelope)
            }
        };
        let failure_persisted = match failure {
            Ok(execution) if execution.result.status != CommandResultStatus::Rejected => true,
            Ok(_) => false,
            Err(failure_error) => {
                eprintln!(
                    "failed to persist AgentRun {} launch failure: {failure_error:#}",
                    execution.agent_run_id
                );
                false
            }
        };
        if failure_persisted {
            self.reconcile_skill_projection_after_run_terminal(&execution.workspace.execution_root)
                .await;
        }
        match execution.runtime.adapter_kind {
            rovai_core::agent_profile::AdapterKind::CodexCli => {
                self.codex_cli
                    .forget_agent_run(&execution.agent_run_id, execution.execution_epoch)
                    .await;
            }
            kind @ (rovai_core::agent_profile::AdapterKind::OpencodeCli
            | rovai_core::agent_profile::AdapterKind::CopilotCli
            | rovai_core::agent_profile::AdapterKind::KiroCli
            | rovai_core::agent_profile::AdapterKind::QoderCli
            | rovai_core::agent_profile::AdapterKind::CodebuddyCli
            | rovai_core::agent_profile::AdapterKind::QwenCode) => {
                if let Some(adapter) = self.acp_adapter(kind) {
                    adapter
                        .forget_agent_run(&execution.agent_run_id, execution.execution_epoch)
                        .await;
                }
            }
            rovai_core::agent_profile::AdapterKind::AntigravityApp => {
                let _ = self
                    .antigravity_app
                    .interrupt(&execution.agent_run_id, execution.execution_epoch)
                    .await;
            }
            rovai_core::agent_profile::AdapterKind::ClaudeCodeCli => {
                let _ = self
                    .claude_code_cli
                    .interrupt(&execution.agent_run_id, execution.execution_epoch)
                    .await;
            }
        }
    }

    async fn fail_unmaterialized_agent_run(
        &self,
        candidate: &rovai_core::runtime::QueuedAgentRunCandidate,
        execution_epoch: i64,
        error: &anyhow::Error,
    ) {
        let ending_git_observation = self
            .observe_run_git(&candidate.project_binding_kind, &candidate.project_path)
            .await;
        let failure = {
            let mut database = self.database.lock().await;
            ExecutionRuntimeService::default().fail_agent_run_without_runtime_terminal(
                &mut database,
                &CommandEnvelope {
                    command_id: uuid::Uuid::new_v4().to_string(),
                    actor: ActorRef::System {
                        component_id: "runtime-adapter:configuration".to_string(),
                    },
                    camp_id: Some(candidate.camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: FailAgentRunCommand {
                        agent_run_id: candidate.agent_run_id.clone(),
                        expected_version: candidate.version + 1,
                        execution_epoch,
                        error_code: "runtime_configuration_invalid".to_string(),
                        error_detail: Some(format!("{error:#}")),
                        manual_retry_allowed: true,
                        ending_git_observation,
                    },
                },
            )
        };
        let failure_persisted = match failure {
            Ok(execution) if execution.result.status != CommandResultStatus::Rejected => true,
            Ok(_) => false,
            Err(failure_error) => {
                eprintln!(
                    "failed to close malformed AgentRun {}: {failure_error:#}",
                    candidate.agent_run_id
                );
                false
            }
        };
        if failure_persisted {
            self.reconcile_skill_projection_after_run_terminal(
                &candidate.execution_workspace().execution_root,
            )
            .await;
        }
    }

    async fn observe_run_git(
        &self,
        project_binding_kind: &str,
        project_path: &str,
    ) -> Option<git::GitObservation> {
        git::inspect_workspace(
            Path::new(project_path),
            &self.data_dir,
            project_binding_kind == "quick_chat",
        )
        .await
        .ok()
        .filter(|inspection| inspection.project_path == project_path)
        .map(|inspection| inspection.git_observation)
    }
}

fn user_command_envelope<P>(command_id: String, payload: P) -> CommandEnvelope<P> {
    CommandEnvelope {
        command_id,
        actor: ActorRef::User {
            user_id: CURRENT_USER_ID.to_string(),
        },
        camp_id: None,
        expected_versions: Vec::new(),
        execution_epoch: None,
        payload,
    }
}

fn user_camp_command_envelope<P>(
    command_id: String,
    camp_id: String,
    payload: P,
) -> CommandEnvelope<P> {
    CommandEnvelope {
        command_id,
        actor: ActorRef::User {
            user_id: CURRENT_USER_ID.to_string(),
        },
        camp_id: Some(camp_id),
        expected_versions: Vec::new(),
        execution_epoch: None,
        payload,
    }
}

fn probe_status_name(status: health::AgentRuntimeProbeStatus) -> &'static str {
    match status {
        health::AgentRuntimeProbeStatus::Ready => "ready",
        health::AgentRuntimeProbeStatus::NotInstalled => "not_installed",
        health::AgentRuntimeProbeStatus::AuthenticationRequired => "authentication_required",
        health::AgentRuntimeProbeStatus::MissingCapabilities => "missing_capabilities",
        health::AgentRuntimeProbeStatus::ProbeFailed => "probe_failed",
    }
}

fn note_product_runtime_diagnostic(
    current: &mut Option<ProductRuntimeDiagnostic>,
    failure_class: &str,
    diagnostic_code: &str,
) {
    let (status, priority) = match failure_class {
        "authentication_required" => ("authentication_required", 4),
        "identity_changed" | "incompatible" => ("incompatible", 3),
        "transient" => ("found_uninspected", 2),
        _ => ("missing", 1),
    };
    if current
        .as_ref()
        .is_some_and(|diagnostic| diagnostic.priority >= priority)
    {
        return;
    }
    *current = Some(ProductRuntimeDiagnostic {
        status,
        diagnostic_code: diagnostic_code.to_string(),
        priority,
        observed_at: chrono::Utc::now(),
    });
}

fn product_runtime_diagnostic_is_fresh(
    diagnostic: &ProductRuntimeDiagnostic,
    now: chrono::DateTime<chrono::Utc>,
) -> bool {
    now.signed_duration_since(diagnostic.observed_at) < chrono::Duration::hours(24)
}

fn product_runtime_availability_status(
    discovery_status: RuntimeDiscoveryStatus,
    installation: Option<&AdapterInstallationView>,
    product_diagnostic: Option<&ProductRuntimeDiagnostic>,
    checking: bool,
) -> &'static str {
    if let Some(installation) = installation {
        if !installation.enabled {
            return "disabled";
        }
        if installation.path_state == "path_missing" {
            return "path_missing";
        }
        if installation
            .last_probe_attempt
            .as_ref()
            .is_some_and(|attempt| {
                attempt.status == "failed" && attempt.failure_class == "authentication_required"
            })
        {
            return "authentication_required";
        }
        if installation
            .last_probe_attempt
            .as_ref()
            .is_some_and(|attempt| {
                attempt.status == "failed"
                    && matches!(
                        attempt.failure_class.as_str(),
                        "incompatible" | "identity_changed"
                    )
            })
        {
            return "incompatible";
        }
        if installation
            .snapshot
            .as_ref()
            .is_some_and(|snapshot| snapshot.probe_status == "ready" && snapshot.stale_at.is_none())
        {
            return if installation
                .last_probe_attempt
                .as_ref()
                .is_some_and(|attempt| {
                    attempt.status == "failed" && attempt.failure_class == "transient"
                }) {
                "refresh_failed_using_last_success"
            } else {
                "ready"
            };
        }
        if checking {
            return "checking";
        }
        return if discovery_status == RuntimeDiscoveryStatus::Found {
            "found_uninspected"
        } else {
            "missing"
        };
    }
    if let Some(diagnostic) = product_diagnostic {
        return diagnostic.status;
    }
    if checking {
        return "checking";
    }
    match discovery_status {
        RuntimeDiscoveryStatus::Detecting => "detecting",
        RuntimeDiscoveryStatus::Found => "found_uninspected",
        RuntimeDiscoveryStatus::Missing => "missing",
    }
}

fn managed_runtime_is_ready(database: &Database, kind: AdapterKind) -> Result<bool> {
    Ok(AgentProfileService::default()
        .managed_installation(database, kind, "default")?
        .as_ref()
        .is_some_and(managed_installation_is_usable))
}

fn managed_installation_is_usable(installation: &AdapterInstallationView) -> bool {
    installation.enabled
        && installation.path_state == "valid"
        && installation.snapshot.as_ref().is_some_and(|snapshot| {
            snapshot.probe_status == "ready"
                && snapshot.stale_at.is_none()
                && snapshot.authentication_status == "authenticated"
        })
}

fn probe_retry_is_deferred(
    installation: &AdapterInstallationView,
    now: chrono::DateTime<chrono::Utc>,
) -> bool {
    installation
        .last_probe_attempt
        .as_ref()
        .and_then(|attempt| attempt.retry_after.as_deref())
        .and_then(|retry_after| chrono::DateTime::parse_from_rfc3339(retry_after).ok())
        .is_some_and(|retry_after| retry_after.with_timezone(&chrono::Utc) > now)
}

fn registered_runtime_refresh_is_due(
    installation: &AdapterInstallationView,
    now: chrono::DateTime<chrono::Utc>,
) -> bool {
    if !managed_installation_is_usable(installation) {
        return true;
    }
    installation.snapshot.as_ref().is_none_or(|snapshot| {
        snapshot
            .last_successful_probe_at
            .as_deref()
            .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
            .is_none_or(|observed| {
                now.signed_duration_since(observed.with_timezone(&chrono::Utc))
                    >= chrono::Duration::hours(24)
            })
    })
}

fn classify_native_resume_failure(error: &anyhow::Error) -> NativeSessionResumeFailure {
    let diagnostic = error
        .chain()
        .map(|cause| cause.to_string().to_ascii_lowercase())
        .collect::<Vec<_>>()
        .join(" ");
    const EXPLICIT_INCOMPATIBILITY_MARKERS: [&str; 8] = [
        "unknown session",
        "session not found",
        "thread not found",
        "invalid session",
        "invalid thread",
        "session/load is not supported",
        "method not found",
        "incompatible",
    ];
    if EXPLICIT_INCOMPATIBILITY_MARKERS
        .iter()
        .any(|marker| diagnostic.contains(marker))
    {
        NativeSessionResumeFailure::Incompatible
    } else {
        // A timeout, transport failure, malformed reply, or other uncertain
        // outcome may have delivered input. The persistent fence prevents a
        // second controlled Resume for the same Installation generation.
        NativeSessionResumeFailure::Ambiguous
    }
}

fn probe_authentication_status(status: health::AgentRuntimeProbeStatus) -> &'static str {
    match status {
        health::AgentRuntimeProbeStatus::AuthenticationRequired => "authentication_required",
        health::AgentRuntimeProbeStatus::Ready
        | health::AgentRuntimeProbeStatus::MissingCapabilities => "authenticated",
        health::AgentRuntimeProbeStatus::NotInstalled
        | health::AgentRuntimeProbeStatus::ProbeFailed => "unknown",
    }
}

fn main() -> Result<()> {
    // This snapshot is intentionally captured before Tokio exists. Runtime discovery and every
    // child launch receive it explicitly; Rovai never mutates process-global PATH.
    let runtime_search_environment = Arc::new(RuntimeSearchEnvironment::capture_initial());
    runtime_search_environment.activate_for_runtime_commands();
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .context("failed to create Core Tokio Runtime")?;
    runtime.block_on(run_core(runtime_search_environment))
}

async fn run_core(runtime_search_environment: Arc<RuntimeSearchEnvironment>) -> Result<()> {
    let data_dir = parse_data_dir()?;
    let _data_dir_lock = CoreDataDirLock::acquire(&data_dir)?;
    let mcp_config_path = parse_mcp_config_path()?;
    let mut database = Database::open(&data_dir)?;
    SkillProjectionReconciler.synchronize_removed_execution_roots(
        &mut database,
        &parse_removed_skill_project_roots()?,
    )?;
    let compaction_detector_policies =
        DesiredCompactionDetectorPolicies::from_process_environment();
    for diagnostic in &compaction_detector_policies.diagnostics {
        eprintln!("Compaction detector policy diagnostic: {diagnostic}");
    }
    match reconcile_detector_policies(&mut database, &compaction_detector_policies) {
        Ok(reconciliation) if !reconciliation.changed_adapters.is_empty() => eprintln!(
            "Compaction detector policy reconciled for {} Runtime(s); {} stored Native Binding baseline requirement(s) created",
            reconciliation.changed_adapters.len(),
            reconciliation.baseline_requirements_created,
        ),
        Ok(_) => {}
        Err(error) => eprintln!(
            "Compaction detector policy reconciliation is unavailable; AgentRun admission remains enabled: {error:#}"
        ),
    }
    match reconcile_compaction_observation_outbox(&mut database, &data_dir.join("runtime"), None) {
        Ok(reconciliation)
            if reconciliation.applied > 0
                || reconciliation.duplicates > 0
                || reconciliation.discarded > 0 =>
        {
            eprintln!(
                "Compaction observation outbox reconciled: {} applied, {} duplicate, {} discarded, {} retained",
                reconciliation.applied,
                reconciliation.duplicates,
                reconciliation.discarded,
                reconciliation.retained,
            );
        }
        Ok(_) => {}
        Err(error) => eprintln!(
            "Compaction observation outbox reconciliation is unavailable; AgentRun admission remains enabled: {error:#}"
        ),
    }
    if let Err(error) = fence_active_observers_on_core_start(&mut database) {
        eprintln!(
            "Stale Compaction Observer fencing is unavailable; AgentRun admission remains enabled: {error:#}"
        );
    }
    let attachment_store = CampAttachmentStore::new(&data_dir);
    attachment_store.cleanup_expired(&mut database)?;
    let discarded_pending_camps =
        CollaborationService::default().discard_empty_pending_camps_on_startup(&mut database)?;
    for camp_id in &discarded_pending_camps {
        attachment_store.remove_camp(camp_id)?;
    }
    if !discarded_pending_camps.is_empty() {
        eprintln!(
            "Pending Camp startup cleanup discarded {} empty draft(s)",
            discarded_pending_camps.len()
        );
    }
    let search_summary = runtime_search_environment.summary();
    database.record_runtime_search_environment_generation(
        search_summary.generation,
        &search_summary.created_at,
    )?;
    let skill_library = SkillLibraryService::new(SkillLibraryService::default_root()?)?;
    let mcp_config = McpConfigStore::new(match mcp_config_path {
        Some(path) => path,
        None => McpConfigStore::default_path()?,
    });
    mcp_config.migrate_agent_ids(&database.agent_id_aliases()?)?;
    let mcp_projection = McpProjectionService::new(&data_dir);
    skill_library.cleanup_expired_staging()?;
    let bundled_skills_changed = skill_library.install_bundled_skills(&mut database)?;
    if bundled_skills_changed {
        SkillProjectionReconciler.mark_observed_roots_dirty(&mut database, false)?;
    }
    skill_library.cleanup_orphan_revisions(&database)?;
    mcp_projection.cleanup_terminal_and_orphaned(&database)?;
    let v2_recovery = database.prepare_v2_recovery()?;
    let interrupted_deliveries =
        mark_unstarted_deliveries_interrupted_before_dispatch(&mut database)?;
    if interrupted_deliveries != 0 {
        eprintln!(
            "Message Delivery startup recovery marked {interrupted_deliveries} unstarted Delivery rows as interrupted_before_dispatch"
        );
    }
    if v2_recovery.runs_waiting_for_recovery != 0
        || v2_recovery.accepted_input_recovery_blockers_created != 0
        || v2_recovery.actions_returned_to_prepared != 0
        || v2_recovery.actions_marked_unknown != 0
        || v2_recovery.intercepted_actions_failed_closed != 0
        || v2_recovery.action_approvals_cancelled != 0
        || v2_recovery.deliveries_returned_to_pending != 0
        || v2_recovery.authorization_deliveries_failed_closed != 0
        || v2_recovery.input_deliveries_marked_unknown != 0
    {
        eprintln!(
            "v0.02 recovery prepared: {}",
            serde_json::to_string(&v2_recovery)?
        );
    }
    let (codex_tx, codex_rx) = mpsc::unbounded_channel();
    let (acp_tx, acp_rx) = mpsc::unbounded_channel();
    let (output_tx, output_rx) = mpsc::unbounded_channel();
    let (runtime_check_tx, runtime_check_rx) = mpsc::unbounded_channel();
    let output_handle = tokio::spawn(write_output(output_rx));
    let (event_shutdown_tx, event_shutdown_rx) = oneshot::channel();
    let antigravity_app = AntigravityAppRuntimeAdapter::new(&data_dir)?;
    let claude_code_cli = ClaudeCodeCliRuntimeAdapter::new(&data_dir)?;
    let builtin_tool_leases = Arc::new(BuiltinToolLeaseRegistry::default());
    let runtime_fleet = Arc::new(AgentRuntimeFleetManager::new_with_builtin_tools(
        AgentRuntimeFleetConfig::default(),
        &data_dir,
        builtin_tool_leases.clone(),
    ));
    let planned_shutdown = PlannedShutdownCoordinator::new(uuid::Uuid::new_v4().to_string());
    let core = Arc::new(Core {
        database: Mutex::new(database),
        output: output_tx.clone(),
        runtime_search_environment: RwLock::new(runtime_search_environment.clone()),
        runtime_discovery: RwLock::new(
            rovai_core::agent_profile::AdapterKind::ALL
                .into_iter()
                .map(|kind| {
                    (
                        kind,
                        RuntimeDiscoveryObservation::detecting(
                            kind,
                            runtime_search_environment.generation(),
                        ),
                    )
                })
                .collect(),
        ),
        runtime_product_diagnostics: RwLock::new(BTreeMap::new()),
        runtime_checking: RwLock::new(BTreeSet::new()),
        runtime_checks_scheduled: RwLock::new(BTreeSet::new()),
        runtime_check_requests: runtime_check_tx,
        compaction_detector_policies: compaction_detector_policies.clone(),
        runtime_resolution_notify: Notify::new(),
        agent_run_cancellation_notify: Notify::new(),
        pending_execution_recovery: Mutex::new(()),
        skill_library,
        mcp_config,
        mcp_projection,
        codex_cli: CodexCliRuntimeAdapter::new(codex_tx, runtime_fleet.clone()),
        opencode_cli: AcpCliRuntimeAdapter::new(
            rovai_core::agent_profile::AdapterKind::OpencodeCli,
            acp_tx.clone(),
            data_dir.join("runtime/opencode"),
            runtime_fleet.clone(),
            compaction_detector_policies
                .policy_for(AdapterKind::OpencodeCli)
                .unwrap_or(CompactionDetectorPolicy::Disabled),
        )?,
        copilot_cli: AcpCliRuntimeAdapter::new(
            rovai_core::agent_profile::AdapterKind::CopilotCli,
            acp_tx.clone(),
            data_dir.join("runtime/copilot"),
            runtime_fleet.clone(),
            compaction_detector_policies
                .policy_for(AdapterKind::CopilotCli)
                .unwrap_or(CompactionDetectorPolicy::Disabled),
        )?,
        kiro_cli: AcpCliRuntimeAdapter::new(
            rovai_core::agent_profile::AdapterKind::KiroCli,
            acp_tx.clone(),
            data_dir.join("runtime/kiro"),
            runtime_fleet.clone(),
            compaction_detector_policies
                .policy_for(AdapterKind::KiroCli)
                .unwrap_or(CompactionDetectorPolicy::Disabled),
        )?,
        qoder_cli: AcpCliRuntimeAdapter::new(
            rovai_core::agent_profile::AdapterKind::QoderCli,
            acp_tx.clone(),
            data_dir.join("runtime/qoder"),
            runtime_fleet.clone(),
            compaction_detector_policies
                .policy_for(AdapterKind::QoderCli)
                .unwrap_or(CompactionDetectorPolicy::Disabled),
        )?,
        codebuddy_cli: AcpCliRuntimeAdapter::new(
            rovai_core::agent_profile::AdapterKind::CodebuddyCli,
            acp_tx.clone(),
            data_dir.join("runtime/codebuddy"),
            runtime_fleet.clone(),
            compaction_detector_policies
                .policy_for(AdapterKind::CodebuddyCli)
                .unwrap_or(CompactionDetectorPolicy::Disabled),
        )?,
        qwen_code: AcpCliRuntimeAdapter::new(
            rovai_core::agent_profile::AdapterKind::QwenCode,
            acp_tx,
            data_dir.join("runtime/qwen"),
            runtime_fleet.clone(),
            compaction_detector_policies
                .policy_for(AdapterKind::QwenCode)
                .unwrap_or(CompactionDetectorPolicy::Disabled),
        )?,
        claude_code_cli,
        antigravity_app,
        planned_shutdown,
        agent_run_tasks: Mutex::new(tokio::task::JoinSet::new()),
        runtime_fleet,
        builtin_tool_leases,
        data_dir,
    });
    let (fleet_sweeper_shutdown_tx, fleet_sweeper_shutdown_rx) = oneshot::channel();
    let mut fleet_sweeper_handle = tokio::spawn(
        core.runtime_fleet
            .clone()
            .run_idle_sweeper(fleet_sweeper_shutdown_rx),
    );
    let (builtin_tool_shutdown_tx, builtin_tool_shutdown_rx) = oneshot::channel();
    let builtin_tool_socket = builtin_tool_socket_path();
    let builtin_tool_listener = bind_builtin_tool_listener(&builtin_tool_socket)?;
    let builtin_tool_handle = tokio::spawn(serve_builtin_tool_ipc(
        core.clone(),
        builtin_tool_listener,
        builtin_tool_socket,
        builtin_tool_shutdown_rx,
    ));
    let event_handle = tokio::spawn(process_codex_events(
        core.clone(),
        codex_rx,
        output_tx.clone(),
        event_shutdown_rx,
    ));
    let (acp_shutdown_tx, acp_shutdown_rx) = oneshot::channel();
    let acp_event_handle = tokio::spawn(process_acp_events(
        core.clone(),
        acp_rx,
        output_tx.clone(),
        acp_shutdown_rx,
    ));
    let (scheduler_shutdown_tx, scheduler_shutdown_rx) = oneshot::channel();
    let mut scheduler_handle = tokio::spawn(process_agent_run_scheduler(
        core.clone(),
        output_tx.clone(),
        scheduler_shutdown_rx,
    ));
    let (runtime_check_shutdown_tx, runtime_check_shutdown_rx) = oneshot::channel();
    let mut runtime_check_handle = tokio::spawn(process_runtime_check_manager(
        core.clone(),
        runtime_check_rx,
        runtime_check_shutdown_rx,
    ));

    eprintln!("rovai-core {} ready", env!("CARGO_PKG_VERSION"));
    let runtime_discovery_core = core.clone();
    let runtime_discovery_handle = tokio::spawn(async move {
        runtime_discovery_core.run_runtime_discovery().await;
        runtime_discovery_core
            .recover_pending_execution_intents()
            .await;
    });

    let stdin = BufReader::new(tokio::io::stdin());
    let mut lines = stdin.lines();
    let mut background_requests = tokio::task::JoinSet::new();
    let mut planned_shutdown_request = None;

    loop {
        let line = match lines.next_line().await {
            Ok(Some(line)) => line,
            Ok(None) => break,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                tokio::time::sleep(Duration::from_millis(5)).await;
                continue;
            }
            Err(error) => return Err(error).context("failed reading Core stdin"),
        };
        while let Some(result) = background_requests.try_join_next() {
            if let Err(error) = result {
                eprintln!("background Core request failed: {error}");
            }
        }
        if line.trim().is_empty() {
            continue;
        }

        let request = match serde_json::from_str::<Request>(&line) {
            Ok(request) => request,
            Err(error) => {
                eprintln!("invalid request: {error}");
                continue;
            }
        };

        if request.method == "core.shutdown" {
            let parsed = parse_planned_shutdown_params(request.params.clone());
            match parsed {
                Ok(params) => {
                    planned_shutdown_request = Some((request.id, params));
                    break;
                }
                Err(error) => {
                    enqueue_response(
                        &output_tx,
                        &Response {
                            id: request.id,
                            result: None,
                            error: Some(ErrorBody {
                                code: "CORE_SHUTDOWN_INVALID".to_string(),
                                message: format!("{error:#}"),
                            }),
                        },
                    )?;
                    continue;
                }
            }
        }

        if request_runs_outside_main_queue(&request.method) {
            let request_core = core.clone();
            let request_output = output_tx.clone();
            background_requests.spawn(async move {
                let response = response_for_request(&request_core, &request).await;
                if let Err(error) = enqueue_response(&request_output, &response) {
                    eprintln!("failed to write background Core response: {error:#}");
                }
            });
            continue;
        }

        let response = response_for_request(&core, &request).await;
        enqueue_response(&output_tx, &response)?;
    }

    if let Some((request_id, params)) = planned_shutdown_request {
        let deadline = tokio::time::Instant::now() + Duration::from_millis(params.deadline_ms);
        let launch_quiesced =
            tokio::time::timeout_at(deadline, core.planned_shutdown.begin_drain())
                .await
                .is_ok();
        if !launch_quiesced {
            eprintln!("planned shutdown deadline reached while launch handoff was draining");
        }

        runtime_discovery_handle.abort();
        let _ = runtime_discovery_handle.await;

        let _ = scheduler_shutdown_tx.send(());
        let _ = runtime_check_shutdown_tx.send(());
        let _ = fleet_sweeper_shutdown_tx.send(());
        let scheduler_forced_abort = if !launch_quiesced {
            // The deadline can expire while a candidate or Adapter-specific launch
            // still owns a launch permit. Abort both task sets, then finish the
            // writer barrier before enumerating active executions. No prompt can
            // cross the handoff boundary after this point.
            scheduler_handle.abort();
            let _ = (&mut scheduler_handle).await;
            core.abort_agent_run_tasks().await;
            core.planned_shutdown.begin_drain().await;
            true
        } else {
            false
        };

        // Launch admission is already closed, so the active registry is stable.
        // Issue planned stops before waiting for unrelated requests or background
        // workers; they continue draining in parallel against the same deadline.
        let active = core.planned_shutdown.active_snapshots().await;
        let active_executions_observed = active.len();
        let mut stop_tasks = tokio::task::JoinSet::new();
        for execution in active {
            let core = core.clone();
            stop_tasks.spawn(async move { core.request_planned_stop(&execution).await });
        }
        let mut stop_requests_issued = 0;
        let stop_wait = async {
            while let Some(result) = stop_tasks.join_next().await {
                match result {
                    Ok(true) => stop_requests_issued += 1,
                    Ok(false) => {}
                    Err(error) => eprintln!("planned stop worker failed: {error}"),
                }
            }
        };
        let stop_wait_completed = tokio::time::timeout_at(deadline, stop_wait).await.is_ok();
        if !stop_wait_completed {
            stop_tasks.abort_all();
            while stop_tasks.join_next().await.is_some() {}
        }

        let background_requests_quiesced = tokio::time::timeout_at(deadline, async {
            while background_requests.join_next().await.is_some() {}
        })
        .await
        .is_ok();
        if !background_requests_quiesced {
            background_requests.abort_all();
            while background_requests.join_next().await.is_some() {}
        }
        let scheduler_quiesced = if scheduler_forced_abort {
            false
        } else if tokio::time::timeout_at(deadline, &mut scheduler_handle)
            .await
            .is_err()
        {
            scheduler_handle.abort();
            let _ = scheduler_handle.await;
            false
        } else {
            true
        };
        let runtime_checks_quiesced =
            if tokio::time::timeout_at(deadline, &mut runtime_check_handle)
                .await
                .is_err()
            {
                runtime_check_handle.abort();
                let _ = runtime_check_handle.await;
                false
            } else {
                true
            };
        let fleet_sweeper_quiesced = if tokio::time::timeout_at(deadline, &mut fleet_sweeper_handle)
            .await
            .is_err()
        {
            fleet_sweeper_handle.abort();
            let _ = fleet_sweeper_handle.await;
            false
        } else {
            true
        };

        let all_settled = core
            .planned_shutdown
            .wait_for_no_active_until(deadline)
            .await;
        core.planned_shutdown
            .close_terminal_admission_and_drain()
            .await;
        core.planned_shutdown.close_runtime_routes_and_drain().await;
        let drain_deadline_expired = tokio::time::Instant::now() >= deadline;
        let unresolved_executions = core.planned_shutdown.active_snapshots().await.len();
        let terminal_executions_settled =
            active_executions_observed.saturating_sub(unresolved_executions);
        let _ = core.builtin_tool_leases.fence_all().await;

        core.abort_agent_run_tasks().await;
        core.shutdown_all_runtimes().await;

        let _ = builtin_tool_shutdown_tx.send(());
        let _ = builtin_tool_handle.await;
        let _ = event_shutdown_tx.send(());
        let _ = event_handle.await;
        let _ = acp_shutdown_tx.send(());
        let _ = acp_event_handle.await;

        let report = PlannedShutdownReport {
            protocol_version: PLANNED_SHUTDOWN_PROTOCOL_VERSION,
            status: "completed",
            deadline_expired: drain_deadline_expired
                || !launch_quiesced
                || !background_requests_quiesced
                || !scheduler_quiesced
                || !runtime_checks_quiesced
                || !fleet_sweeper_quiesced
                || !stop_wait_completed
                || !all_settled,
            active_executions_observed,
            stop_requests_issued,
            terminal_executions_settled,
            unresolved_executions,
        };
        enqueue_response(
            &output_tx,
            &Response {
                id: request_id,
                result: Some(serde_json::to_value(report)?),
                error: None,
            },
        )?;
    } else {
        background_requests.abort_all();
        while background_requests.join_next().await.is_some() {}
        runtime_discovery_handle.abort();
        let _ = runtime_discovery_handle.await;
        let _ = scheduler_shutdown_tx.send(());
        let _ = scheduler_handle.await;
        let _ = runtime_check_shutdown_tx.send(());
        let _ = runtime_check_handle.await;
        let _ = fleet_sweeper_shutdown_tx.send(());
        let _ = fleet_sweeper_handle.await;
        core.abort_agent_run_tasks().await;
        core.shutdown_all_runtimes().await;
        let _ = builtin_tool_shutdown_tx.send(());
        let _ = builtin_tool_handle.await;
        let _ = event_shutdown_tx.send(());
        let _ = event_handle.await;
        let _ = acp_shutdown_tx.send(());
        let _ = acp_event_handle.await;
    }
    drop(core);
    drop(output_tx);
    output_handle
        .await
        .context("output writer task failed")?
        .context("failed writing Core stdout")?;
    Ok(())
}

async fn process_codex_events(
    core: Arc<Core>,
    mut receiver: mpsc::UnboundedReceiver<CodexIncoming>,
    output: mpsc::UnboundedSender<String>,
    mut shutdown: oneshot::Receiver<()>,
) {
    loop {
        let incoming = tokio::select! {
            incoming = receiver.recv() => match incoming {
                Some(incoming) => incoming,
                None => break,
            },
            _ = &mut shutdown => break,
        };
        let Some(_runtime_route_permit) = core.planned_shutdown.enter_runtime_route().await else {
            break;
        };
        match incoming {
            CodexIncoming::Message {
                host_instance_id,
                agent_run_id,
                execution_epoch,
                message,
            } => {
                process_agent_run_codex_message(
                    &core,
                    &output,
                    &host_instance_id,
                    &agent_run_id,
                    execution_epoch,
                    message,
                )
                .await;
            }
            CodexIncoming::Stderr {
                host_instance_id,
                agent_run_id,
                execution_epoch,
                text,
            } => {
                if !text.trim().is_empty()
                    && core
                        .codex_cli
                        .get_agent_run_on_host(&host_instance_id, &agent_run_id, execution_epoch)
                        .await
                        .is_some()
                {
                    emit(
                        &output,
                        "agent_run.log",
                        json!({
                            "agentRunId": agent_run_id,
                            "hostInstanceId": host_instance_id,
                            "executionEpoch": execution_epoch,
                            "stream": "stderr",
                            "text": text,
                        }),
                    );
                }
            }
            CodexIncoming::Exited {
                host_instance_id,
                agent_run_id,
                execution_epoch,
            } => {
                process_agent_run_exit(
                    &core,
                    &output,
                    &host_instance_id,
                    &agent_run_id,
                    execution_epoch,
                )
                .await;
            }
        }
    }
}

async fn process_acp_events(
    core: Arc<Core>,
    mut receiver: mpsc::UnboundedReceiver<AcpIncoming>,
    output: mpsc::UnboundedSender<String>,
    mut shutdown: oneshot::Receiver<()>,
) {
    loop {
        let incoming = tokio::select! {
            incoming = receiver.recv() => match incoming {
                Some(incoming) => incoming,
                None => break,
            },
            _ = &mut shutdown => break,
        };
        let Some(_runtime_route_permit) = core.planned_shutdown.enter_runtime_route().await else {
            break;
        };
        match incoming {
            AcpIncoming::InputAccepted {
                adapter_kind,
                host_instance_id,
                agent_run_id,
                execution_epoch,
                native_session_id,
                native_prompt_id,
                delivery_id,
            } => {
                process_acp_input_accepted(
                    &core,
                    adapter_kind,
                    &host_instance_id,
                    &agent_run_id,
                    execution_epoch,
                    &native_session_id,
                    &native_prompt_id,
                    &delivery_id,
                )
                .await;
            }
            AcpIncoming::InputNotAccepted {
                adapter_kind,
                host_instance_id,
                agent_run_id,
                execution_epoch,
                native_prompt_id,
                delivery_id,
                error,
            } => {
                process_acp_input_not_accepted(
                    &core,
                    adapter_kind,
                    &host_instance_id,
                    &agent_run_id,
                    execution_epoch,
                    &native_prompt_id,
                    &delivery_id,
                    &error,
                )
                .await;
            }
            AcpIncoming::Message {
                adapter_kind,
                host_instance_id,
                agent_run_id,
                execution_epoch,
                message,
            } => {
                process_agent_run_acp_message(
                    &core,
                    &output,
                    adapter_kind,
                    &host_instance_id,
                    &agent_run_id,
                    execution_epoch,
                    message,
                )
                .await;
            }
            AcpIncoming::HostDiagnostic {
                adapter_kind,
                host_instance_id,
                text,
            } => {
                emit(
                    &output,
                    "runtime.host.log",
                    json!({
                        "hostInstanceId": host_instance_id,
                        "adapterKind": adapter_kind,
                        "stream": "stderr",
                        "text": text,
                    }),
                );
            }
            AcpIncoming::Exited {
                adapter_kind,
                host_instance_id,
                agent_run_id,
                execution_epoch,
            } => {
                if let Err(error) = {
                    let mut database = core.database.lock().await;
                    reconcile_compaction_observation_outbox(
                        &mut database,
                        &core.data_dir.join("runtime"),
                        Some((adapter_kind, &host_instance_id)),
                    )
                } {
                    eprintln!(
                        "{} uncertain Compaction Observer reconciliation failed for {}: {error:#}",
                        adapter_kind.as_str(),
                        host_instance_id,
                    );
                }
                if let Err(error) = {
                    let mut database = core.database.lock().await;
                    fence_active_observers_for_host(
                        &mut database,
                        adapter_kind,
                        &host_instance_id,
                        "runtime_host_exited",
                    )
                } {
                    eprintln!(
                        "{} Compaction Observer Host fencing failed for {}: {error:#}",
                        adapter_kind.as_str(),
                        host_instance_id,
                    );
                }
                process_acp_agent_run_exit(
                    &core,
                    &output,
                    adapter_kind,
                    &host_instance_id,
                    &agent_run_id,
                    execution_epoch,
                )
                .await;
            }
            AcpIncoming::CompactionObservation {
                adapter_kind,
                host_instance_id,
                observer_lease_id,
                native_session_id,
                source_observation_id,
                source_signal,
                admission_point,
                source_event_digest,
                observed_at,
            } => {
                let result = {
                    let mut database = core.database.lock().await;
                    submit_compaction_observation(
                        &mut database,
                        &SubmitCompactionObservation {
                            observer_lease_id: &observer_lease_id,
                            source_observation_id: &source_observation_id,
                            source_signal: &source_signal,
                            admission_point: &admission_point,
                            source_event_digest: &source_event_digest,
                            observed_at: &observed_at,
                        },
                    )
                };
                match result {
                    Ok(CompactionObservationResult::Applied { requested_revision }) => {
                        eprintln!(
                            "{} Compaction Observer {} accepted {} for Native Session {} on Host {}; Bootstrap redelivery revision {} is pending",
                            adapter_kind.as_str(),
                            observer_lease_id,
                            source_signal,
                            native_session_id,
                            host_instance_id,
                            requested_revision,
                        );
                    }
                    Ok(CompactionObservationResult::Duplicate { .. })
                    | Ok(CompactionObservationResult::Fenced) => {}
                    Err(error) => eprintln!(
                        "{} Compaction Observer submission failed without blocking AgentRun: {error:#}",
                        adapter_kind.as_str()
                    ),
                }
            }
        }
    }
}

async fn acp_runtime_on_host(
    core: &Core,
    adapter_kind: rovai_core::agent_profile::AdapterKind,
    host_instance_id: &str,
    agent_run_id: &str,
    execution_epoch: i64,
) -> Option<Arc<AcpRuntime>> {
    core.acp_adapter(adapter_kind)?
        .get_agent_run_on_host(host_instance_id, agent_run_id, execution_epoch)
        .await
}

#[allow(clippy::too_many_arguments)]
async fn process_acp_input_accepted(
    core: &Arc<Core>,
    adapter_kind: rovai_core::agent_profile::AdapterKind,
    host_instance_id: &str,
    agent_run_id: &str,
    execution_epoch: i64,
    native_session_id: &str,
    native_prompt_id: &str,
    delivery_id: &str,
) {
    let Some(runtime) = acp_runtime_on_host(
        core,
        adapter_kind,
        host_instance_id,
        agent_run_id,
        execution_epoch,
    )
    .await
    else {
        return;
    };
    if runtime.session_id().await.as_deref() != Some(native_session_id) {
        let error = "ACP accepted-input evidence targeted another Native Session";
        let mark_result = {
            let mut database = core.database.lock().await;
            ContextService.mark_input_delivery_unknown(&mut database, delivery_id, error)
        };
        if let Err(mark_error) = mark_result {
            eprintln!(
                "failed to mark mismatched ACP input evidence unknown for AgentRun {agent_run_id}: {mark_error:#}"
            );
        }
        let _ = runtime.cancel().await;
        return;
    }
    if let Err(error) = core
        .acknowledge_runtime_input(delivery_id, native_prompt_id)
        .await
    {
        eprintln!("failed to persist ACP input acceptance for AgentRun {agent_run_id}: {error:#}");
        let _ = runtime.cancel().await;
    }
}

#[allow(clippy::too_many_arguments)]
async fn process_acp_input_not_accepted(
    core: &Arc<Core>,
    adapter_kind: rovai_core::agent_profile::AdapterKind,
    host_instance_id: &str,
    agent_run_id: &str,
    execution_epoch: i64,
    native_prompt_id: &str,
    delivery_id: &str,
    error: &str,
) {
    if acp_runtime_on_host(
        core,
        adapter_kind,
        host_instance_id,
        agent_run_id,
        execution_epoch,
    )
    .await
    .is_none()
    {
        return;
    }
    let result = {
        let mut database = core.database.lock().await;
        ContextService.mark_input_delivery_not_accepted(
            &mut database,
            delivery_id,
            &format!("ACP prompt {native_prompt_id} was rejected: {error}"),
        )
    };
    if let Err(mark_error) = result {
        eprintln!(
            "failed to persist ACP input rejection for AgentRun {agent_run_id}: {mark_error:#}"
        );
    }
}

async fn process_agent_run_acp_message(
    core: &Arc<Core>,
    output: &mpsc::UnboundedSender<String>,
    adapter_kind: rovai_core::agent_profile::AdapterKind,
    host_instance_id: &str,
    agent_run_id: &str,
    execution_epoch: i64,
    message: Value,
) {
    let Some(runtime) = acp_runtime_on_host(
        core,
        adapter_kind,
        host_instance_id,
        agent_run_id,
        execution_epoch,
    )
    .await
    else {
        return;
    };
    let method = message
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    if let Some(id) = message.get("id").cloned() {
        let result = match method.as_str() {
            "session/request_permission" => {
                process_agent_run_acp_approval_request(
                    core,
                    output,
                    &runtime,
                    agent_run_id,
                    execution_epoch,
                    id.clone(),
                    &params,
                )
                .await
            }
            "fs/read_text_file" => match runtime.read_text_file(&params).await {
                Ok(result) => runtime.respond(id, result).await,
                Err(error) => {
                    runtime
                        .respond_error(
                            id,
                            -32000,
                            &format!("Rovai-ai file read rejected: {error:#}"),
                        )
                        .await
                }
            },
            "fs/write_text_file" => match runtime.write_text_file(&params).await {
                Ok(result) => runtime.respond(id, result).await,
                Err(error) => {
                    runtime
                        .respond_error(
                            id,
                            -32000,
                            &format!("Rovai-ai file write rejected: {error:#}"),
                        )
                        .await
                }
            },
            _ => {
                runtime
                    .respond_error(
                        id,
                        -32601,
                        "This ACP client request is not supported by Rovai-ai v0.03",
                    )
                    .await
            }
        };
        if let Err(error) = result {
            eprintln!(
                "failed to handle ACP request {method} for AgentRun {agent_run_id}: {error:#}"
            );
        }
        return;
    }

    let completed_action = match runtime.observe_message(&method, &params).await {
        Ok(completion) => completion,
        Err(error) => {
            eprintln!("failed to normalize ACP Runtime event: {error:#}");
            None
        }
    };
    let (event_type, payload) = normalize_acp_event(&method, &params);
    let evidence =
        match persist_runtime_evidence(core, agent_run_id, execution_epoch, event_type, &payload)
            .await
        {
            Ok(evidence) => evidence,
            Err(error) => {
                eprintln!(
                    "failed to persist Runtime Evidence for AgentRun {agent_run_id}: {error:#}"
                );
                if ExecutionEvidenceService::is_runtime_evidence_event(event_type) {
                    return;
                }
                None
            }
        };
    if ExecutionEvidenceService::is_runtime_evidence_event(event_type) && evidence.is_none() {
        return;
    }
    let evidence_id = evidence.as_ref().map(|evidence| evidence.id.as_str());
    let public_payload = evidence
        .as_ref()
        .map(|evidence| &evidence.payload)
        .unwrap_or(&payload);
    emit(
        output,
        event_type,
        json!({
            "agentRunId": agent_run_id,
            "executionEpoch": execution_epoch,
            "adapterKind": adapter_kind,
            "nativeMethod": method,
            "evidenceId": evidence_id,
            "payload": public_payload,
            "canonical": evidence.as_ref().and_then(|evidence| evidence.canonical.as_ref()),
        }),
    );
    if let Some(completion) = completed_action
        && let Err(error) = record_acp_action_completion(
            core,
            output,
            adapter_kind,
            agent_run_id,
            execution_epoch,
            completion,
        )
        .await
    {
        eprintln!("failed to record ACP Action completion: {error:#}");
        let execution = {
            let database = core.database.lock().await;
            ExecutionRuntimeService::default().load_agent_run_execution(
                &database,
                agent_run_id,
                execution_epoch,
            )
        };
        if let Ok(Some(execution)) = execution {
            core.fail_claimed_agent_run(&execution, "action_audit_failed", &error, false)
                .await;
        }
        return;
    }
    if method != "rovai/acp_prompt_completed" {
        return;
    }
    if let Err(error) = persist_acp_prompt_completion(
        core,
        output,
        adapter_kind,
        &runtime,
        agent_run_id,
        execution_epoch,
        &params,
    )
    .await
    {
        eprintln!("failed to persist ACP prompt completion: {error:#}");
    }
}

fn normalize_acp_event(method: &str, params: &Value) -> (&'static str, Value) {
    if method == "rovai/acp_prompt_completed" {
        return ("runtime.turn.completed", params.clone());
    }
    if method != "session/update" {
        return ("runtime.event", params.clone());
    }
    let update = params.get("update").cloned().unwrap_or(Value::Null);
    match update.get("sessionUpdate").and_then(Value::as_str) {
        Some("agent_message_chunk") => {
            let update_message_id = update
                .get("messageId")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty());
            let content_message_id = update
                .pointer("/content/messageId")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty());
            let (message_id, message_id_source) = if let Some(message_id) = update_message_id {
                (Some(message_id), Some("update"))
            } else if let Some(message_id) = content_message_id {
                (Some(message_id), Some("content"))
            } else {
                (None, None)
            };
            (
                "agent.text.delta",
                json!({
                "delta": update.pointer("/content/text").and_then(Value::as_str).unwrap_or(""),
                "sessionId": params.get("sessionId"),
                "messageId": message_id,
                "messageIdSource": message_id_source,
                }),
            )
        }
        Some("agent_thought_chunk") => ("agent.thought.delta", update),
        Some("tool_call") | Some("tool_call_update") => (
            "runtime.action",
            json!({
                "sessionUpdate": update.get("sessionUpdate"),
                "toolCallId": update.get("toolCallId"),
                "toolName": update.get("toolName"),
                "status": update.get("status"),
                "kind": update.get("kind"),
                "title": update.get("title"),
                "locationCount": update
                    .get("locations")
                    .and_then(Value::as_array)
                    .map_or(0, Vec::len),
                "output": public_acp_tool_output(&update),
                "rawInputDigest": update
                    .get("rawInput")
                    .and_then(|value| canonical_json_digest(value).ok()),
                "rawOutputDigest": update
                    .get("rawOutput")
                    .and_then(|value| canonical_json_digest(value).ok()),
            }),
        ),
        Some("plan") => ("runtime.plan", update),
        Some("usage_update") => ("runtime.usage", update),
        _ => ("runtime.event", update),
    }
}

fn public_acp_tool_output(update: &Value) -> Option<String> {
    match update.get("content")? {
        Value::String(text) => Some(text.clone()),
        Value::Array(blocks) => {
            let text = blocks
                .iter()
                .filter_map(|block| match block {
                    Value::String(text) => Some(text.as_str()),
                    Value::Object(block)
                        if block
                            .get("type")
                            .and_then(Value::as_str)
                            .is_none_or(|kind| kind == "text") =>
                    {
                        block.get("text").and_then(Value::as_str).or_else(|| {
                            block
                                .get("content")
                                .and_then(|content| content.get("text"))
                                .and_then(Value::as_str)
                        })
                    }
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("\n");
            (!text.is_empty()).then_some(text)
        }
        Value::Object(block)
            if block
                .get("type")
                .and_then(Value::as_str)
                .is_none_or(|kind| kind == "text") =>
        {
            block
                .get("text")
                .and_then(Value::as_str)
                .or_else(|| {
                    block
                        .get("content")
                        .and_then(|content| content.get("text"))
                        .and_then(Value::as_str)
                })
                .map(str::to_string)
        }
        _ => None,
    }
}

async fn persist_runtime_evidence(
    core: &Core,
    agent_run_id: &str,
    execution_epoch: i64,
    event_type: &str,
    payload: &Value,
) -> Result<Option<AgentRunExecutionEvidence>> {
    if !ExecutionEvidenceService::is_runtime_evidence_event(event_type) {
        return Ok(None);
    }
    let mut database = core.database.lock().await;
    ExecutionEvidenceService.record_runtime_event(
        &mut database,
        &ManagedBlobStore::new(&core.data_dir),
        agent_run_id,
        execution_epoch,
        event_type,
        payload,
    )
}

async fn process_agent_run_acp_approval_request(
    core: &Arc<Core>,
    output: &mpsc::UnboundedSender<String>,
    runtime: &AcpRuntime,
    agent_run_id: &str,
    execution_epoch: i64,
    request_id: Value,
    params: &Value,
) -> Result<()> {
    let Some(native_session_id) = runtime.session_id().await else {
        reject_acp_request(
            output,
            runtime,
            agent_run_id,
            execution_epoch,
            request_id,
            params,
            "ACP Native Session is unavailable",
        )
        .await?;
        return Ok(());
    };
    let execution = {
        let database = core.database.lock().await;
        ExecutionRuntimeService::default().load_agent_run_execution(
            &database,
            agent_run_id,
            execution_epoch,
        )
    }?;
    let Some(execution) = execution else {
        reject_acp_request(
            output,
            runtime,
            agent_run_id,
            execution_epoch,
            request_id,
            params,
            "AgentRun is unavailable or fenced",
        )
        .await?;
        return Ok(());
    };
    let Some(native_prompt_id) = runtime.prompt_id().await else {
        reject_acp_request(
            output,
            runtime,
            agent_run_id,
            execution_epoch,
            request_id,
            params,
            "ACP permission request is outside an active prompt",
        )
        .await?;
        return Ok(());
    };
    let observed_tool_context = match params
        .pointer("/toolCall/toolCallId")
        .and_then(Value::as_str)
    {
        Some(native_item_id) => runtime.observed_tool_context(native_item_id).await,
        None => None,
    };
    let action_request = match acp::intercepted_action_request(
        &acp::InterceptedAcpActionContext {
            agent_run_id,
            execution_epoch,
            expected_session_id: &native_session_id,
            expected_prompt_id: &native_prompt_id,
            execution_root: Path::new(&execution.workspace.execution_root),
            permission_semantics: execution.permission_semantics,
        },
        request_id.clone(),
        params,
        observed_tool_context.as_ref(),
    ) {
        Ok(request) => request,
        Err(error) => {
            reject_acp_request(
                output,
                runtime,
                agent_run_id,
                execution_epoch,
                request_id,
                params,
                &format!("ACP Action request was rejected: {error}"),
            )
            .await?;
            return Ok(());
        }
    };
    if execution.permission_semantics == PermissionSemantics::CoreEnforcedV1
        && execution.workspace.access == "read_only"
        && matches!(
            &action_request.input,
            rovai_core::action::CanonicalActionInput::FileWrite { .. }
                | rovai_core::action::CanonicalActionInput::FileDelete { .. }
                | rovai_core::action::CanonicalActionInput::ShellCommand { .. }
                | rovai_core::action::CanonicalActionInput::GitMutation { .. }
                | rovai_core::action::CanonicalActionInput::NetworkWrite { .. }
        )
    {
        reject_acp_request(
            output,
            runtime,
            agent_run_id,
            execution_epoch,
            request_id,
            params,
            "read-only AgentRun rejected a mutating ACP tool request",
        )
        .await?;
        return Ok(());
    }
    if let rovai_core::action::CanonicalActionInput::GitMutation { workspace_path, .. } =
        &action_request.input
    {
        let inspection = git::inspect_workspace(
            Path::new(workspace_path),
            &core.data_dir,
            execution.project_binding_kind == "quick_chat",
        )
        .await;
        let git_available = inspection.as_ref().is_ok_and(|inspection| {
            inspection.project_path == execution.project_path
                && inspection.git_observation.state == git::GitCapabilityState::GitValid
        });
        if !git_available {
            reject_acp_request(
                output,
                runtime,
                agent_run_id,
                execution_epoch,
                request_id,
                params,
                "Git capability is unavailable for the current Camp workspace",
            )
            .await?;
            return Ok(());
        }
    }
    let request_reason = action_request.reason.clone();
    let preparation = {
        let mut database = core.database.lock().await;
        ActionSafetyService::default().prepare_action(
            &mut database,
            &CommandEnvelope {
                command_id: format!("runtime-action-prepare:{}", action_request.action_id),
                actor: ActorRef::Agent {
                    agent_id: execution.agent_id.clone(),
                    source_agent_run_id: agent_run_id.to_string(),
                },
                camp_id: Some(execution.camp_id.clone()),
                expected_versions: Vec::new(),
                execution_epoch: Some(execution_epoch),
                payload: PrepareActionCommand {
                    action_id: action_request.action_id.clone(),
                    input: action_request.input,
                    control_mode: ActionControlMode::Intercepted,
                    native_action_id: Some(action_request.native_action_id),
                    runtime_request: Some(action_request.runtime_request),
                    reason: request_reason.clone(),
                    execute_before: None,
                    requested_for_user_id: CURRENT_USER_ID.to_string(),
                },
            },
        )
    };
    let preparation = match preparation {
        Ok(preparation) if preparation.result.status != CommandResultStatus::Rejected => {
            preparation
        }
        Ok(preparation) => {
            reject_acp_request(
                output,
                runtime,
                agent_run_id,
                execution_epoch,
                request_id,
                params,
                &format!(
                    "Action admission rejected: {} · {}",
                    preparation.result.code, preparation.result.payload
                ),
            )
            .await?;
            return Ok(());
        }
        Err(error) => {
            reject_acp_request(
                output,
                runtime,
                agent_run_id,
                execution_epoch,
                request_id,
                params,
                "Action request could not be persisted safely",
            )
            .await?;
            return Err(error);
        }
    };
    emit(
        output,
        "action.prepared",
        json!({
            "agentRunId": agent_run_id,
            "executionEpoch": execution_epoch,
            "nativeMethod": "session/request_permission",
            "reason": request_reason,
            "result": preparation.result,
            "replayed": preparation.replayed,
        }),
    );
    Ok(())
}

async fn reject_acp_request(
    output: &mpsc::UnboundedSender<String>,
    runtime: &AcpRuntime,
    agent_run_id: &str,
    execution_epoch: i64,
    request_id: Value,
    params: &Value,
    reason: &str,
) -> Result<()> {
    match acp::rejection_result(params) {
        Ok(result) => runtime.respond(request_id, result).await?,
        Err(_) => runtime.respond_error(request_id, -32000, reason).await?,
    }
    emit(
        output,
        "agent_run.request_rejected",
        json!({
            "agentRunId": agent_run_id,
            "executionEpoch": execution_epoch,
            "nativeMethod": "session/request_permission",
            "reason": reason,
        }),
    );
    Ok(())
}

async fn record_acp_action_completion(
    core: &Arc<Core>,
    output: &mpsc::UnboundedSender<String>,
    adapter_kind: rovai_core::agent_profile::AdapterKind,
    agent_run_id: &str,
    execution_epoch: i64,
    completion: acp::CompletedAcpAction,
) -> Result<()> {
    let (attempts, execution) = {
        let database = core.database.lock().await;
        (
            ActionSafetyService::default().load_intercepted_action_attempts(
                &database,
                agent_run_id,
                execution_epoch,
                &completion.native_item_id,
            )?,
            ExecutionRuntimeService::default().load_agent_run_execution(
                &database,
                agent_run_id,
                execution_epoch,
            )?,
        )
    };
    if attempts.is_empty() && acp::is_potential_side_effect(&completion.native_kind) {
        let execution = execution.context("Observed ACP Action source AgentRun is unavailable")?;
        let action_id_digest = canonical_json_digest(&json!({
            "agentRunId": agent_run_id,
            "executionEpoch": execution_epoch,
            "nativeItemId": completion.native_item_id,
            "observationDigest": completion.observation_digest,
        }))?;
        let action_id = format!("action-{action_id_digest}");
        let recorded = {
            let mut database = core.database.lock().await;
            ActionSafetyService::default().record_observed_action(
                &mut database,
                &CommandEnvelope {
                    command_id: format!("runtime-action-observed:{action_id}"),
                    actor: ActorRef::Agent {
                        agent_id: execution.agent_id.clone(),
                        source_agent_run_id: agent_run_id.to_string(),
                    },
                    camp_id: Some(execution.camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: Some(execution_epoch),
                    payload: RecordObservedActionCommand {
                        action_id: action_id.clone(),
                        native_action_id: completion.native_item_id.clone(),
                        native_kind: completion.native_kind.clone(),
                        observation_digest: completion.observation_digest.clone(),
                        outcome: completion.outcome,
                        result_code: completion.result_code.clone(),
                        result_summary: completion.result_summary.clone(),
                        result_data: completion.result_data.clone(),
                        effect_disposition: completion.effect_disposition.clone(),
                    },
                },
            )
        }?;
        if recorded.result.status == CommandResultStatus::Rejected {
            anyhow::bail!(
                "Observed ACP Action was rejected: {} · {}",
                recorded.result.code,
                recorded.result.payload
            );
        }
        emit(
            output,
            "action.observed",
            json!({
                "agentRunId": agent_run_id,
                "executionEpoch": execution_epoch,
                "actionId": action_id,
                "nativeItemId": completion.native_item_id,
                "nativeKind": completion.native_kind,
                "result": recorded.result,
                "replayed": recorded.replayed,
                "guarantee": "observed",
            }),
        );
        return Ok(());
    }
    for attempt in attempts {
        let result = {
            let mut database = core.database.lock().await;
            ActionSafetyService::default().record_result(
                &mut database,
                &CommandEnvelope {
                    command_id: format!(
                        "runtime-action-result:{}:{}:{}",
                        attempt.action_id, attempt.attempt_id, attempt.action_execution_epoch
                    ),
                    actor: ActorRef::System {
                        component_id: format!("runtime-adapter:{}", adapter_kind.as_str()),
                    },
                    camp_id: Some(attempt.camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: RecordActionResultCommand {
                        action_id: attempt.action_id.clone(),
                        attempt_id: attempt.attempt_id.clone(),
                        action_execution_epoch: attempt.action_execution_epoch,
                        outcome: completion.outcome,
                        result_code: completion.result_code.clone(),
                        result_summary: completion.result_summary.clone(),
                        result_data: completion.result_data.clone(),
                        effect_disposition: completion.effect_disposition.clone(),
                    },
                },
            )
        };
        match result {
            Ok(execution) if execution.result.status != CommandResultStatus::Rejected => emit(
                output,
                "action.result_recorded",
                json!({
                    "agentRunId": agent_run_id,
                    "executionEpoch": execution_epoch,
                    "actionId": attempt.action_id,
                    "actionKind": attempt.action_kind,
                    "nativeItemId": completion.native_item_id,
                    "result": execution.result,
                    "replayed": execution.replayed,
                }),
            ),
            Ok(execution) => eprintln!(
                "ACP Action {} result was rejected: {}",
                attempt.action_id, execution.result.code
            ),
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

async fn persist_acp_prompt_completion(
    core: &Arc<Core>,
    output: &mpsc::UnboundedSender<String>,
    adapter_kind: rovai_core::agent_profile::AdapterKind,
    runtime: &AcpRuntime,
    agent_run_id: &str,
    execution_epoch: i64,
    params: &Value,
) -> Result<()> {
    let prompt_id = params
        .get("promptId")
        .and_then(Value::as_str)
        .context("ACP prompt completion has no promptId")?;
    let response_error = params.get("error").and_then(Value::as_str);
    let stop_reason = params
        .pointer("/result/stopReason")
        .and_then(Value::as_str)
        .unwrap_or(if response_error.is_some() {
            "runtime_error"
        } else {
            "unknown"
        });
    let final_agent_message = runtime.final_agent_message().await;
    let missing_send_recovery_candidate = if stop_reason == "end_turn" {
        runtime.missing_send_recovery_candidate().await.map(|body| {
            MissingSendRecoveryCandidate::new(
                MissingSendRecoveryBoundary::AcpEndTurnAssistantSuffix,
                body,
            )
        })
    } else {
        None
    };
    let planned_outcome = if stop_reason == "end_turn" && final_agent_message.is_some() {
        RuntimeTerminalOutcome::Succeeded
    } else if stop_reason == "cancelled" {
        RuntimeTerminalOutcome::Cancelled
    } else {
        RuntimeTerminalOutcome::Failed
    };
    let terminal_discriminator =
        canonical_json_digest(params).unwrap_or_else(|_| format!("{prompt_id}:{stop_reason}"));
    let planned_terminal_permit = core
        .admit_planned_shutdown_terminal(
            agent_run_id,
            execution_epoch,
            RuntimeRouteBinding {
                route_identity: runtime.host_instance_id().to_string(),
                adapter_turn_correlation: prompt_id.to_string(),
                provider_turn_id: None,
            },
            planned_outcome,
            &terminal_discriminator,
        )
        .await?;
    if let Some(permit) = planned_terminal_permit.as_ref()
        && planned_outcome != RuntimeTerminalOutcome::Succeeded
    {
        let terminal_execution_root = {
            let database = core.database.lock().await;
            ExecutionRuntimeService::default()
                .load_agent_run_execution(&database, agent_run_id, execution_epoch)?
                .map(|execution| execution.workspace.execution_root)
        };
        let settlement = core
            .settle_planned_shutdown_abortive_terminal(
                permit,
                PlannedShutdownAbortiveTerminal {
                    agent_run_id: agent_run_id.to_string(),
                    execution_epoch,
                    outcome: planned_outcome,
                    error_code: if stop_reason == "end_turn" {
                        "runtime_missing_final_output".to_string()
                    } else {
                        format!("runtime_prompt_{stop_reason}")
                    },
                    error_detail: Some(
                        response_error
                            .map(str::to_string)
                            .unwrap_or_else(|| format!("ACP prompt ended as {stop_reason}")),
                    ),
                    manual_retry_allowed: planned_outcome == RuntimeTerminalOutcome::Failed,
                },
            )
            .await?;
        emit(
            output,
            "agent_run.terminal",
            json!({
                "agentRunId": agent_run_id,
                "executionEpoch": execution_epoch,
                "adapterKind": adapter_kind,
                "settlement": settlement,
            }),
        );
        if let Some(execution_root) = terminal_execution_root {
            core.reconcile_skill_projection_after_run_terminal(&execution_root)
                .await;
        }
        if let Some(adapter) = core.acp_adapter(adapter_kind) {
            adapter
                .complete_agent_run(agent_run_id, execution_epoch)
                .await;
        }
        core.planned_shutdown
            .remove_active(&ActiveExecutionKey::new(agent_run_id, execution_epoch))
            .await;
        return Ok(());
    }
    for attempt in 0..80 {
        let execution = {
            let database = core.database.lock().await;
            ExecutionRuntimeService::default().load_agent_run_execution(
                &database,
                agent_run_id,
                execution_epoch,
            )
        }?;
        let Some(execution) = execution else {
            return Ok(());
        };
        let ending_git_observation = core
            .observe_run_git(&execution.project_binding_kind, &execution.project_path)
            .await;
        let terminal = if stop_reason == "end_turn" {
            if let Some(final_output) = final_agent_message.clone() {
                let mut database = core.database.lock().await;
                let envelope = CommandEnvelope {
                    command_id: uuid::Uuid::new_v4().to_string(),
                    actor: ActorRef::System {
                        component_id: format!("runtime-adapter:{}", adapter_kind.as_str()),
                    },
                    camp_id: Some(execution.camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: SucceedAgentRunCommand {
                        agent_run_id: agent_run_id.to_string(),
                        expected_version: execution.version,
                        execution_epoch,
                        native_turn_id: prompt_id.to_string(),
                        final_output,
                        missing_send_recovery_candidate: missing_send_recovery_candidate.clone(),
                        ending_git_observation: ending_git_observation.clone(),
                    },
                };
                let service = ExecutionRuntimeService::default();
                match planned_terminal_permit.as_ref() {
                    Some(permit) => service.succeed_agent_run_during_planned_shutdown(
                        &mut database,
                        permit,
                        &envelope,
                    ),
                    None => service.succeed_agent_run(&mut database, &envelope),
                }
            } else {
                let mut database = core.database.lock().await;
                ExecutionRuntimeService::default().fail_agent_run(
                    &mut database,
                    &CommandEnvelope {
                        command_id: uuid::Uuid::new_v4().to_string(),
                        actor: ActorRef::System {
                            component_id: format!("runtime-adapter:{}", adapter_kind.as_str()),
                        },
                        camp_id: Some(execution.camp_id.clone()),
                        expected_versions: Vec::new(),
                        execution_epoch: None,
                        payload: FailAgentRunCommand {
                            agent_run_id: agent_run_id.to_string(),
                            expected_version: execution.version,
                            execution_epoch,
                            error_code: "runtime_missing_final_output".to_string(),
                            error_detail: Some(
                                "ACP Runtime ended the prompt without an Agent message".to_string(),
                            ),
                            manual_retry_allowed: true,
                            ending_git_observation: ending_git_observation.clone(),
                        },
                    },
                )
            }
        } else {
            let mut database = core.database.lock().await;
            ExecutionRuntimeService::default().fail_agent_run(
                &mut database,
                &CommandEnvelope {
                    command_id: uuid::Uuid::new_v4().to_string(),
                    actor: ActorRef::System {
                        component_id: format!("runtime-adapter:{}", adapter_kind.as_str()),
                    },
                    camp_id: Some(execution.camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: FailAgentRunCommand {
                        agent_run_id: agent_run_id.to_string(),
                        expected_version: execution.version,
                        execution_epoch,
                        error_code: format!("runtime_prompt_{stop_reason}"),
                        error_detail: Some(
                            response_error
                                .map(str::to_string)
                                .unwrap_or_else(|| format!("ACP prompt ended as {stop_reason}")),
                        ),
                        manual_retry_allowed: stop_reason != "cancelled",
                        ending_git_observation,
                    },
                },
            )
        };
        match terminal {
            Ok(terminal) if terminal.result.status != CommandResultStatus::Rejected => {
                emit(
                    output,
                    "agent_run.terminal",
                    json!({
                        "agentRunId": agent_run_id,
                        "executionEpoch": execution_epoch,
                        "adapterKind": adapter_kind,
                        "result": terminal.result,
                        "replayed": terminal.replayed,
                    }),
                );
                core.reconcile_skill_projection_after_run_terminal(
                    &execution.workspace.execution_root,
                )
                .await;
                if let Some(adapter) = core.acp_adapter(adapter_kind) {
                    adapter
                        .complete_agent_run(agent_run_id, execution_epoch)
                        .await;
                }
                core.planned_shutdown
                    .remove_active(&ActiveExecutionKey::new(agent_run_id, execution_epoch))
                    .await;
                return Ok(());
            }
            Ok(terminal)
                if attempt < 79
                    && matches!(
                        terminal.result.code.as_str(),
                        "agent_run.version_conflict"
                            | "agent_run.terminal_fenced"
                            | "agent_run.terminal_safety_blocked"
                    ) =>
            {
                tokio::time::sleep(std::time::Duration::from_millis(25)).await;
            }
            Ok(terminal) => {
                emit(
                    output,
                    "agent_run.terminal_deferred",
                    json!({
                        "agentRunId": agent_run_id,
                        "executionEpoch": execution_epoch,
                        "result": terminal.result,
                    }),
                );
                return Ok(());
            }
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

async fn process_acp_agent_run_exit(
    core: &Arc<Core>,
    output: &mpsc::UnboundedSender<String>,
    adapter_kind: rovai_core::agent_profile::AdapterKind,
    host_instance_id: &str,
    agent_run_id: &str,
    execution_epoch: i64,
) {
    if core.planned_shutdown.is_draining() {
        return;
    }
    if acp_runtime_on_host(
        core,
        adapter_kind,
        host_instance_id,
        agent_run_id,
        execution_epoch,
    )
    .await
    .is_none()
    {
        return;
    }
    if let Some(adapter) = core.acp_adapter(adapter_kind) {
        adapter
            .forget_agent_run(agent_run_id, execution_epoch)
            .await;
    }
    core.planned_shutdown
        .remove_active(&ActiveExecutionKey::new(agent_run_id, execution_epoch))
        .await;
    let execution = {
        let database = core.database.lock().await;
        ExecutionRuntimeService::default().load_agent_run_execution(
            &database,
            agent_run_id,
            execution_epoch,
        )
    };
    let Ok(Some(execution)) = execution else {
        return;
    };
    let reason = format!("{}_host_exited", adapter_kind.as_str().replace('-', "_"));
    let recovery = {
        let mut database = core.database.lock().await;
        ActionSafetyService::default().reconcile_runtime_loss(
            &mut database,
            &CommandEnvelope {
                command_id: uuid::Uuid::new_v4().to_string(),
                actor: ActorRef::System {
                    component_id: "runtime-recovery-coordinator".to_string(),
                },
                camp_id: Some(execution.camp_id.clone()),
                expected_versions: Vec::new(),
                execution_epoch: None,
                payload: ReconcileRuntimeLossCommand {
                    agent_run_id: agent_run_id.to_string(),
                    expected_version: execution.version,
                    execution_epoch,
                    reason: reason.clone(),
                },
            },
        )
    };
    match recovery {
        Ok(recovery) if recovery.result.status != CommandResultStatus::Rejected => emit(
            output,
            "agent_run.recovering",
            json!({
                "agentRunId": agent_run_id,
                "executionEpoch": execution_epoch,
                "adapterKind": adapter_kind,
                "reason": reason,
            }),
        ),
        Ok(_) => {}
        Err(error) => eprintln!("failed to mark AgentRun {agent_run_id} for recovery: {error:#}"),
    }
}

async fn process_agent_run_codex_message(
    core: &Arc<Core>,
    output: &mpsc::UnboundedSender<String>,
    host_instance_id: &str,
    agent_run_id: &str,
    execution_epoch: i64,
    message: Value,
) {
    let Some(runtime) = core
        .codex_cli
        .get_agent_run_on_host(host_instance_id, agent_run_id, execution_epoch)
        .await
    else {
        return;
    };
    let method = message
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    if let Some(id) = message.get("id").cloned() {
        if codex::is_approval_method(&method) {
            let server_request = AgentRunServerRequest {
                agent_run_id,
                execution_epoch,
                method: &method,
                request_id: id,
                params: &params,
            };
            if let Err(error) =
                process_agent_run_approval_request(core, output, &runtime, &server_request).await
            {
                eprintln!(
                    "failed to admit intercepted Action for AgentRun {agent_run_id}: {error:#}"
                );
            }
        } else {
            let detail =
                "This app-server request is not supported by the Rovai-ai AgentRuntimeAdapter";
            let _ = runtime.respond_error(id, detail).await;
            emit(
                output,
                "agent_run.request_rejected",
                json!({
                    "agentRunId": agent_run_id,
                    "executionEpoch": execution_epoch,
                    "nativeMethod": method,
                    "reason": detail,
                }),
            );
        }
        return;
    }

    runtime.observe_agent_message(&method, &params).await;
    let (event_type, payload) = codex::normalize_event(&method, &params);
    let evidence =
        match persist_runtime_evidence(core, agent_run_id, execution_epoch, event_type, &payload)
            .await
        {
            Ok(evidence) => evidence,
            Err(error) => {
                eprintln!(
                    "failed to persist Runtime Evidence for AgentRun {agent_run_id}: {error:#}"
                );
                if ExecutionEvidenceService::is_runtime_evidence_event(event_type) {
                    return;
                }
                None
            }
        };
    if ExecutionEvidenceService::is_runtime_evidence_event(event_type) && evidence.is_none() {
        return;
    }
    let evidence_id = evidence.as_ref().map(|evidence| evidence.id.as_str());
    let public_payload = evidence
        .as_ref()
        .map(|evidence| &evidence.payload)
        .unwrap_or(&payload);
    emit(
        output,
        event_type,
        json!({
            "agentRunId": agent_run_id,
            "executionEpoch": execution_epoch,
            "nativeMethod": method,
            "evidenceId": evidence_id,
            "payload": public_payload,
            "canonical": evidence.as_ref().and_then(|evidence| evidence.canonical.as_ref()),
        }),
    );
    if method == "serverRequest/resolved" {
        let Some(native_thread_id) = params.get("threadId").and_then(Value::as_str) else {
            eprintln!(
                "ignored serverRequest/resolved without threadId for AgentRun {agent_run_id}"
            );
            return;
        };
        let Some(native_request_id) = params.get("requestId").cloned() else {
            eprintln!(
                "ignored serverRequest/resolved without requestId for AgentRun {agent_run_id}"
            );
            return;
        };
        let confirmation = {
            let mut database = core.database.lock().await;
            ActionSafetyService::default().confirm_runtime_request_resolved(
                &mut database,
                &CommandEnvelope {
                    command_id: format!(
                        "runtime-request-resolved:{agent_run_id}:{execution_epoch}:{}",
                        canonical_json_digest(&native_request_id)
                            .unwrap_or_else(|_| "invalid-request-id".to_string())
                    ),
                    actor: ActorRef::System {
                        component_id: "runtime-adapter:codex".to_string(),
                    },
                    camp_id: None,
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: ConfirmRuntimeRequestResolvedCommand {
                        agent_run_id: agent_run_id.to_string(),
                        execution_epoch,
                        native_thread_id: native_thread_id.to_string(),
                        native_request_id,
                    },
                },
            )
        };
        match confirmation {
            Ok(execution) if execution.result.status != CommandResultStatus::Rejected => emit(
                output,
                "runtime_request.resolved",
                json!({
                    "agentRunId": agent_run_id,
                    "executionEpoch": execution_epoch,
                    "result": execution.result,
                    "replayed": execution.replayed,
                }),
            ),
            Ok(execution) => eprintln!(
                "Runtime request confirmation was rejected for AgentRun {agent_run_id}: {}",
                execution.result.code
            ),
            Err(error) => eprintln!(
                "failed to confirm Runtime request for AgentRun {agent_run_id}: {error:#}"
            ),
        }
        return;
    }
    if method == "item/completed"
        && let Err(error) = record_intercepted_action_completion(
            core,
            output,
            &runtime,
            agent_run_id,
            execution_epoch,
            &params,
        )
        .await
    {
        eprintln!("failed to record intercepted Action completion: {error:#}");
    }
    if method != "turn/completed" {
        return;
    }
    let completed = match codex::completed_turn(&params) {
        Ok(completed) => completed,
        Err(error) => {
            eprintln!("invalid turn/completed for AgentRun {agent_run_id}: {error:#}");
            return;
        }
    };
    if runtime.turn_id().await.as_deref() != Some(completed.turn_id.as_str()) {
        eprintln!("ignored fenced native Turn completion for AgentRun {agent_run_id}");
        return;
    }
    let missing_send_recovery_candidate = completed.final_agent_message.clone().map(|body| {
        MissingSendRecoveryCandidate::new(MissingSendRecoveryBoundary::CodexCompletedTurn, body)
    });
    let final_agent_message = match completed.final_agent_message.clone() {
        Some(message) => Some(message),
        None => runtime.final_agent_message().await,
    };
    let planned_outcome = if completed.status == "completed" && final_agent_message.is_some() {
        RuntimeTerminalOutcome::Succeeded
    } else if matches!(completed.status.as_str(), "cancelled" | "interrupted") {
        RuntimeTerminalOutcome::Cancelled
    } else {
        RuntimeTerminalOutcome::Failed
    };
    let terminal_discriminator = canonical_json_digest(&params)
        .unwrap_or_else(|_| format!("{}:{}", completed.turn_id, completed.status));
    let planned_terminal_permit = match core
        .admit_planned_shutdown_terminal(
            agent_run_id,
            execution_epoch,
            RuntimeRouteBinding {
                route_identity: host_instance_id.to_string(),
                adapter_turn_correlation: completed.turn_id.clone(),
                provider_turn_id: Some(completed.turn_id.clone()),
            },
            planned_outcome,
            &terminal_discriminator,
        )
        .await
    {
        Ok(permit) => permit,
        Err(error) => {
            eprintln!(
                "planned shutdown fenced Codex terminal for AgentRun {agent_run_id}: {error:#}"
            );
            return;
        }
    };
    if let Some(permit) = planned_terminal_permit.as_ref()
        && planned_outcome != RuntimeTerminalOutcome::Succeeded
    {
        let terminal_execution_root = {
            let database = core.database.lock().await;
            ExecutionRuntimeService::default()
                .load_agent_run_execution(&database, agent_run_id, execution_epoch)
                .ok()
                .flatten()
                .map(|execution| execution.workspace.execution_root)
        };
        let error_code = if completed.status == "completed" {
            "runtime_missing_final_output".to_string()
        } else {
            format!("runtime_turn_{}", completed.status)
        };
        let error_detail = Some(match &completed.error {
            Some(error) => format!(
                "Codex Native Turn {} ended as {}: {}",
                completed.turn_id, completed.status, error
            ),
            None if completed.status == "completed" => {
                "Codex completed the Turn without an Agent message".to_string()
            }
            None => format!(
                "Codex Native Turn {} ended as {}",
                completed.turn_id, completed.status
            ),
        });
        match core
            .settle_planned_shutdown_abortive_terminal(
                permit,
                PlannedShutdownAbortiveTerminal {
                    agent_run_id: agent_run_id.to_string(),
                    execution_epoch,
                    outcome: planned_outcome,
                    error_code,
                    error_detail,
                    manual_retry_allowed: planned_outcome == RuntimeTerminalOutcome::Failed,
                },
            )
            .await
        {
            Ok(settlement) => {
                emit(
                    output,
                    "agent_run.terminal",
                    json!({
                        "agentRunId": agent_run_id,
                        "executionEpoch": execution_epoch,
                        "settlement": settlement,
                    }),
                );
                if let Some(execution_root) = terminal_execution_root {
                    core.reconcile_skill_projection_after_run_terminal(&execution_root)
                        .await;
                }
                runtime.clear_turn(Some(&completed.turn_id)).await;
                core.codex_cli
                    .complete_agent_run(agent_run_id, execution_epoch)
                    .await;
                core.planned_shutdown
                    .remove_active(&ActiveExecutionKey::new(agent_run_id, execution_epoch))
                    .await;
            }
            Err(error) => eprintln!(
                "failed to persist planned shutdown terminal for AgentRun {agent_run_id}: {error:#}"
            ),
        }
        return;
    }
    let mut terminal_persisted = false;
    let mut terminal_execution_root = None;
    for attempt in 0..80 {
        let execution = {
            let database = core.database.lock().await;
            ExecutionRuntimeService::default().load_agent_run_execution(
                &database,
                agent_run_id,
                execution_epoch,
            )
        };
        let execution = match execution {
            Ok(Some(execution)) => execution,
            Ok(None) => return,
            Err(error) => {
                eprintln!("failed to load terminal AgentRun {agent_run_id}: {error:#}");
                return;
            }
        };
        let ending_git_observation = core
            .observe_run_git(&execution.project_binding_kind, &execution.project_path)
            .await;
        let terminal = if completed.status == "completed" {
            if let Some(final_output) = final_agent_message.clone() {
                let mut database = core.database.lock().await;
                let envelope = CommandEnvelope {
                    command_id: uuid::Uuid::new_v4().to_string(),
                    actor: ActorRef::System {
                        component_id: "runtime-adapter:codex".to_string(),
                    },
                    camp_id: Some(execution.camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: SucceedAgentRunCommand {
                        agent_run_id: agent_run_id.to_string(),
                        expected_version: execution.version,
                        execution_epoch,
                        native_turn_id: completed.turn_id.clone(),
                        final_output,
                        missing_send_recovery_candidate: missing_send_recovery_candidate.clone(),
                        ending_git_observation: ending_git_observation.clone(),
                    },
                };
                let service = ExecutionRuntimeService::default();
                match planned_terminal_permit.as_ref() {
                    Some(permit) => service.succeed_agent_run_during_planned_shutdown(
                        &mut database,
                        permit,
                        &envelope,
                    ),
                    None => service.succeed_agent_run(&mut database, &envelope),
                }
            } else {
                let mut database = core.database.lock().await;
                ExecutionRuntimeService::default().fail_agent_run(
                    &mut database,
                    &CommandEnvelope {
                        command_id: uuid::Uuid::new_v4().to_string(),
                        actor: ActorRef::System {
                            component_id: "runtime-adapter:codex".to_string(),
                        },
                        camp_id: Some(execution.camp_id.clone()),
                        expected_versions: Vec::new(),
                        execution_epoch: None,
                        payload: FailAgentRunCommand {
                            agent_run_id: agent_run_id.to_string(),
                            expected_version: execution.version,
                            execution_epoch,
                            error_code: "runtime_missing_final_output".to_string(),
                            error_detail: Some(
                                "Codex completed the Turn without an Agent message".to_string(),
                            ),
                            manual_retry_allowed: true,
                            ending_git_observation: ending_git_observation.clone(),
                        },
                    },
                )
            }
        } else {
            let mut database = core.database.lock().await;
            ExecutionRuntimeService::default().fail_agent_run(
                &mut database,
                &CommandEnvelope {
                    command_id: uuid::Uuid::new_v4().to_string(),
                    actor: ActorRef::System {
                        component_id: "runtime-adapter:codex".to_string(),
                    },
                    camp_id: Some(execution.camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: FailAgentRunCommand {
                        agent_run_id: agent_run_id.to_string(),
                        expected_version: execution.version,
                        execution_epoch,
                        error_code: format!("runtime_turn_{}", completed.status),
                        error_detail: Some(match &completed.error {
                            Some(error) => format!(
                                "Codex Native Turn {} ended as {}: {}",
                                completed.turn_id, completed.status, error
                            ),
                            None => format!(
                                "Codex Native Turn {} ended as {}",
                                completed.turn_id, completed.status
                            ),
                        }),
                        manual_retry_allowed: true,
                        ending_git_observation,
                    },
                },
            )
        };
        match terminal {
            Ok(terminal) if terminal.result.status != CommandResultStatus::Rejected => {
                emit(
                    output,
                    "agent_run.terminal",
                    json!({
                        "agentRunId": agent_run_id,
                        "executionEpoch": execution_epoch,
                        "result": terminal.result,
                        "replayed": terminal.replayed,
                    }),
                );
                terminal_persisted = true;
                terminal_execution_root = Some(execution.workspace.execution_root.clone());
                break;
            }
            Ok(terminal)
                if attempt < 79
                    && matches!(
                        terminal.result.code.as_str(),
                        "agent_run.version_conflict"
                            | "agent_run.terminal_fenced"
                            | "agent_run.terminal_safety_blocked"
                    ) =>
            {
                tokio::time::sleep(std::time::Duration::from_millis(25)).await;
            }
            Ok(terminal) => {
                emit(
                    output,
                    "agent_run.terminal_deferred",
                    json!({
                        "agentRunId": agent_run_id,
                        "executionEpoch": execution_epoch,
                        "result": terminal.result,
                    }),
                );
                return;
            }
            Err(error) => {
                eprintln!("failed to persist terminal AgentRun {agent_run_id}: {error:#}");
                return;
            }
        }
    }
    if !terminal_persisted {
        return;
    }
    if let Some(execution_root) = terminal_execution_root {
        core.reconcile_skill_projection_after_run_terminal(&execution_root)
            .await;
    }
    runtime.clear_turn(Some(&completed.turn_id)).await;
    core.codex_cli
        .complete_agent_run(agent_run_id, execution_epoch)
        .await;
    core.planned_shutdown
        .remove_active(&ActiveExecutionKey::new(agent_run_id, execution_epoch))
        .await;
}

async fn process_agent_run_approval_request(
    core: &Arc<Core>,
    output: &mpsc::UnboundedSender<String>,
    runtime: &CodexRuntime,
    server_request: &AgentRunServerRequest<'_>,
) -> Result<()> {
    let Some(native_thread_id) = runtime.thread_id().await else {
        reject_agent_run_approval_request(
            output,
            runtime,
            server_request,
            "Codex Native Thread is unavailable",
        )
        .await?;
        return Ok(());
    };
    let Some(native_turn_id) = runtime.turn_id().await else {
        reject_agent_run_approval_request(
            output,
            runtime,
            server_request,
            "Codex Native Turn is unavailable",
        )
        .await?;
        return Ok(());
    };
    let execution = {
        let database = core.database.lock().await;
        ExecutionRuntimeService::default().load_agent_run_execution(
            &database,
            server_request.agent_run_id,
            server_request.execution_epoch,
        )
    };
    let execution = match execution {
        Ok(Some(execution)) => execution,
        Ok(None) => {
            reject_agent_run_approval_request(
                output,
                runtime,
                server_request,
                "AgentRun is unavailable or fenced",
            )
            .await?;
            return Ok(());
        }
        Err(error) => {
            reject_agent_run_approval_request(
                output,
                runtime,
                server_request,
                "AgentRun execution context could not be loaded",
            )
            .await?;
            return Err(error.context("failed to load intercepted Action context"));
        }
    };
    let prior_item = server_request
        .params
        .get("itemId")
        .or_else(|| server_request.params.get("callId"))
        .and_then(Value::as_str);
    let prior_item = match prior_item {
        Some(item_id) => runtime.action_item(item_id).await,
        None => None,
    };
    let action_request = match codex::intercepted_action_request(
        &codex::InterceptedActionContext {
            agent_run_id: server_request.agent_run_id,
            execution_epoch: server_request.execution_epoch,
            expected_thread_id: &native_thread_id,
            expected_turn_id: &native_turn_id,
            execution_root: Path::new(&execution.workspace.execution_root),
        },
        server_request.method,
        server_request.request_id.clone(),
        server_request.params,
        prior_item.as_ref(),
    ) {
        Ok(request) => request,
        Err(error) => {
            reject_agent_run_approval_request(
                output,
                runtime,
                server_request,
                &format!("Runtime Action request was rejected: {error}"),
            )
            .await?;
            return Ok(());
        }
    };
    let request_reason = action_request.reason.clone();
    let preparation = {
        let mut database = core.database.lock().await;
        ActionSafetyService::default().prepare_action(
            &mut database,
            &CommandEnvelope {
                command_id: format!("runtime-action-prepare:{}", action_request.action_id),
                actor: ActorRef::Agent {
                    agent_id: execution.agent_id.clone(),
                    source_agent_run_id: server_request.agent_run_id.to_string(),
                },
                camp_id: Some(execution.camp_id.clone()),
                expected_versions: Vec::new(),
                execution_epoch: Some(server_request.execution_epoch),
                payload: PrepareActionCommand {
                    action_id: action_request.action_id.clone(),
                    input: action_request.input,
                    control_mode: ActionControlMode::Intercepted,
                    native_action_id: Some(action_request.native_action_id),
                    runtime_request: Some(action_request.runtime_request),
                    reason: request_reason.clone(),
                    execute_before: None,
                    requested_for_user_id: CURRENT_USER_ID.to_string(),
                },
            },
        )
    };
    let preparation = match preparation {
        Ok(preparation) => preparation,
        Err(error) => {
            reject_agent_run_approval_request(
                output,
                runtime,
                server_request,
                "Action request could not be persisted safely",
            )
            .await?;
            return Err(error.context("failed to persist intercepted Action"));
        }
    };
    if preparation.result.status == CommandResultStatus::Rejected {
        reject_agent_run_approval_request(
            output,
            runtime,
            server_request,
            &format!("Action admission rejected: {}", preparation.result.code),
        )
        .await?;
        return Ok(());
    }

    emit(
        output,
        "action.prepared",
        json!({
            "agentRunId": server_request.agent_run_id,
            "executionEpoch": server_request.execution_epoch,
            "nativeMethod": server_request.method,
            "reason": request_reason,
            "result": preparation.result,
            "replayed": preparation.replayed,
        }),
    );
    Ok(())
}

async fn record_intercepted_action_completion(
    core: &Arc<Core>,
    output: &mpsc::UnboundedSender<String>,
    runtime: &CodexRuntime,
    agent_run_id: &str,
    execution_epoch: i64,
    params: &Value,
) -> Result<()> {
    let Some(thread_id) = runtime.thread_id().await else {
        return Ok(());
    };
    let Some(turn_id) = runtime.turn_id().await else {
        return Ok(());
    };
    let Some(completion) = codex::completed_intercepted_action(params, &thread_id, &turn_id)?
    else {
        return Ok(());
    };
    let attempts = {
        let database = core.database.lock().await;
        ActionSafetyService::default().load_intercepted_action_attempts(
            &database,
            agent_run_id,
            execution_epoch,
            &completion.native_item_id,
        )?
    };
    for attempt in attempts {
        let result = {
            let mut database = core.database.lock().await;
            ActionSafetyService::default().record_result(
                &mut database,
                &CommandEnvelope {
                    command_id: format!(
                        "runtime-action-result:{}:{}:{}",
                        attempt.action_id, attempt.attempt_id, attempt.action_execution_epoch
                    ),
                    actor: ActorRef::System {
                        component_id: "runtime-adapter:codex".to_string(),
                    },
                    camp_id: Some(attempt.camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: RecordActionResultCommand {
                        action_id: attempt.action_id.clone(),
                        attempt_id: attempt.attempt_id.clone(),
                        action_execution_epoch: attempt.action_execution_epoch,
                        outcome: completion.outcome,
                        result_code: completion.result_code.clone(),
                        result_summary: completion.result_summary.clone(),
                        result_data: completion.result_data.clone(),
                        effect_disposition: completion.effect_disposition.clone(),
                    },
                },
            )
        };
        match result {
            Ok(execution) if execution.result.status != CommandResultStatus::Rejected => emit(
                output,
                "action.result_recorded",
                json!({
                    "agentRunId": agent_run_id,
                    "executionEpoch": execution_epoch,
                    "actionId": attempt.action_id,
                    "actionKind": attempt.action_kind,
                    "nativeItemId": completion.native_item_id,
                    "result": execution.result,
                    "replayed": execution.replayed,
                }),
            ),
            Ok(execution) => eprintln!(
                "intercepted Action {} result was rejected: {}",
                attempt.action_id, execution.result.code
            ),
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

async fn reject_agent_run_approval_request(
    output: &mpsc::UnboundedSender<String>,
    runtime: &CodexRuntime,
    request: &AgentRunServerRequest<'_>,
    reason: &str,
) -> Result<()> {
    match codex::approval_result(request.method, request.params, "decline") {
        Ok(response) => {
            runtime
                .respond(request.request_id.clone(), response)
                .await?
        }
        Err(_) => {
            runtime
                .respond_error(request.request_id.clone(), reason)
                .await?
        }
    }
    emit(
        output,
        "agent_run.request_rejected",
        json!({
            "agentRunId": request.agent_run_id,
            "executionEpoch": request.execution_epoch,
            "nativeMethod": request.method,
            "reason": reason,
        }),
    );
    Ok(())
}

async fn process_agent_run_exit(
    core: &Arc<Core>,
    output: &mpsc::UnboundedSender<String>,
    host_instance_id: &str,
    agent_run_id: &str,
    execution_epoch: i64,
) {
    if core.planned_shutdown.is_draining() {
        return;
    }
    if core
        .codex_cli
        .get_agent_run_on_host(host_instance_id, agent_run_id, execution_epoch)
        .await
        .is_none()
    {
        return;
    }
    core.codex_cli
        .forget_agent_run(agent_run_id, execution_epoch)
        .await;
    core.planned_shutdown
        .remove_active(&ActiveExecutionKey::new(agent_run_id, execution_epoch))
        .await;
    let execution = {
        let database = core.database.lock().await;
        ExecutionRuntimeService::default().load_agent_run_execution(
            &database,
            agent_run_id,
            execution_epoch,
        )
    };
    let Ok(Some(execution)) = execution else {
        return;
    };
    let recovery = {
        let mut database = core.database.lock().await;
        ActionSafetyService::default().reconcile_runtime_loss(
            &mut database,
            &CommandEnvelope {
                command_id: uuid::Uuid::new_v4().to_string(),
                actor: ActorRef::System {
                    component_id: "runtime-recovery-coordinator".to_string(),
                },
                camp_id: Some(execution.camp_id.clone()),
                expected_versions: Vec::new(),
                execution_epoch: None,
                payload: ReconcileRuntimeLossCommand {
                    agent_run_id: agent_run_id.to_string(),
                    expected_version: execution.version,
                    execution_epoch,
                    reason: "codex_host_exited".to_string(),
                },
            },
        )
    };
    match recovery {
        Ok(recovery) if recovery.result.status != CommandResultStatus::Rejected => emit(
            output,
            "agent_run.recovering",
            json!({
                "agentRunId": agent_run_id,
                "executionEpoch": execution_epoch,
                "reason": "codex_host_exited",
            }),
        ),
        Ok(_) => {}
        Err(error) => eprintln!("failed to mark AgentRun {agent_run_id} for recovery: {error:#}"),
    }
}

async fn process_agent_run_scheduler(
    core: Arc<Core>,
    output: mpsc::UnboundedSender<String>,
    mut shutdown: oneshot::Receiver<()>,
) {
    let mut interval = tokio::time::interval(Duration::from_millis(500));
    interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut mcp_cleanup_interval = tokio::time::interval_at(
        tokio::time::Instant::now() + Duration::from_secs(30),
        Duration::from_secs(30),
    );
    mcp_cleanup_interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut pending_execution_interval = tokio::time::interval_at(
        tokio::time::Instant::now() + Duration::from_secs(15),
        Duration::from_secs(15),
    );
    pending_execution_interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            _ = interval.tick() => {
                core.expire_elapsed_execution_budgets(&output).await;
                core.dispatch_runtime_deliveries(&output).await;
                core.dispatch_agent_run_cancellations(&output).await;
                core.dispatch_agent_runs(&output).await;
            },
            _ = core.agent_run_cancellation_notify.notified() => {
                core.dispatch_agent_run_cancellations(&output).await;
            },
            _ = mcp_cleanup_interval.tick() => {
                core.cleanup_mcp_projections_best_effort().await;
            },
            _ = pending_execution_interval.tick() => {
                core.recover_pending_execution_intents().await;
            },
            _ = &mut shutdown => break,
        }
    }
}

async fn process_runtime_check_manager(
    core: Arc<Core>,
    mut requests: mpsc::UnboundedReceiver<AdapterKind>,
    mut shutdown: oneshot::Receiver<()>,
) {
    let mut checks = tokio::task::JoinSet::new();
    let mut expiry_interval = tokio::time::interval_at(
        tokio::time::Instant::now() + Duration::from_secs(60),
        Duration::from_secs(60),
    );
    expiry_interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            request = requests.recv() => {
                let Some(kind) = request else { break };
                let check_core = core.clone();
                checks.spawn(async move {
                    let result = check_core.resolve_product_runtime(kind).await;
                    check_core.runtime_checks_scheduled.write().await.remove(&kind);
                    (kind, result)
                });
            },
            completed = checks.join_next(), if !checks.is_empty() => {
                match completed {
                    Some(Ok((kind, Err(error)))) => {
                        eprintln!(
                            "background Runtime check failed for {}: {error:#}",
                            kind.as_str()
                        );
                    }
                    Some(Ok((kind, Ok(true)))) => {
                        if let Err(error) = core.pump_runtime_ready_recipients(kind).await {
                            eprintln!(
                                "failed to pump Message Deliveries after Runtime {} became ready: {error:#}",
                                kind.as_str()
                            );
                        }
                    }
                    Some(Err(error)) => {
                        eprintln!("background Runtime check worker failed: {error}");
                    }
                    _ => {}
                }
            },
            _ = expiry_interval.tick() => {
                core.schedule_expired_runtime_checks().await;
            },
            _ = &mut shutdown => break,
        }
    }
    checks.abort_all();
    while checks.join_next().await.is_some() {}
    core.runtime_checks_scheduled.write().await.clear();
}

#[cfg(unix)]
fn restrict_private_directory(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    Ok(())
}

#[cfg(not(unix))]
fn restrict_private_directory(_path: &Path) -> Result<()> {
    Ok(())
}

fn emit(output: &mpsc::UnboundedSender<String>, method: &str, params: Value) {
    let message = json!({"method": method, "params": params});
    if let Ok(serialized) = serde_json::to_string(&message) {
        let _ = output.send(serialized);
    }
}

async fn write_output(mut receiver: mpsc::UnboundedReceiver<String>) -> Result<()> {
    let mut output = BufWriter::new(tokio::io::stdout());
    while let Some(line) = receiver.recv().await {
        output.write_all(line.as_bytes()).await?;
        output.write_all(b"\n").await?;
        output.flush().await?;
    }
    output.flush().await?;
    Ok(())
}

fn bind_builtin_tool_listener(socket_path: &Path) -> Result<UnixListener> {
    let directory = socket_path
        .parent()
        .context("Built-in Tool socket path has no parent directory")?;
    std::fs::create_dir_all(directory).with_context(|| {
        format!(
            "failed to create private Built-in Tool directory {}",
            directory.display()
        )
    })?;
    restrict_private_directory(directory)?;
    if socket_path.exists() {
        std::fs::remove_file(socket_path).with_context(|| {
            format!(
                "failed to remove stale Built-in Tool socket {}",
                socket_path.display()
            )
        })?;
    }
    let listener = UnixListener::bind(socket_path).with_context(|| {
        format!(
            "failed to bind private Built-in Tool socket {}",
            socket_path.display()
        )
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(socket_path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(listener)
}

async fn serve_builtin_tool_ipc(
    core: Arc<Core>,
    listener: UnixListener,
    socket_path: PathBuf,
    mut shutdown: oneshot::Receiver<()>,
) {
    loop {
        let accepted = tokio::select! {
            accepted = listener.accept() => accepted,
            _ = &mut shutdown => break,
        };
        let (stream, _) = match accepted {
            Ok(stream) => stream,
            Err(error) => {
                eprintln!("Built-in Tool IPC accept failed: {error:#}");
                continue;
            }
        };
        let core = core.clone();
        tokio::spawn(async move {
            if let Err(error) = handle_builtin_tool_connection(core, stream).await {
                eprintln!("Built-in Tool IPC request failed: {error:#}");
            }
        });
    }
    drop(listener);
    let _ = std::fs::remove_file(socket_path);
}

async fn handle_builtin_tool_connection(core: Arc<Core>, stream: UnixStream) -> Result<()> {
    let (reader, mut writer) = stream.into_split();
    let mut lines = BufReader::new(reader).lines();
    let response = match lines.next_line().await? {
        Some(line) if line.len() <= BUILTIN_TOOL_MAX_IPC_REQUEST_BYTES => {
            let value = serde_json::from_str::<Value>(&line).ok();
            if value
                .as_ref()
                .and_then(|value| value.get("kind"))
                .and_then(Value::as_str)
                == Some("compaction_observation")
            {
                let response = match value.and_then(|value| {
                    serde_json::from_value::<CompactionHookIpcRequest>(value).ok()
                }) {
                    Some(request) => core.handle_compaction_hook_ipc(request).await,
                    None => CompactionHookIpcResponse { accepted: false },
                };
                serde_json::to_value(response)?
            } else {
                let response = match value
                    .and_then(|value| serde_json::from_value::<BuiltinToolIpcRequest>(value).ok())
                {
                    Some(request) => core.handle_builtin_tool_ipc(request).await,
                    None => BuiltinToolIpcResponse::ipc_error(
                        "builtin_tool.invalid_ipc_request",
                        "Built-in Tool IPC request is malformed",
                    ),
                };
                serde_json::to_value(response)?
            }
        }
        Some(_) => serde_json::to_value(BuiltinToolIpcResponse::ipc_error(
            "builtin_tool.ipc_request_too_large",
            "Built-in Tool IPC request exceeds 1 MiB",
        ))?,
        None => return Ok(()),
    };
    writer
        .write_all(serde_json::to_string(&response)?.as_bytes())
        .await?;
    writer.write_all(b"\n").await?;
    writer.shutdown().await?;
    Ok(())
}

fn command_rejection_message(payload: &Value) -> String {
    payload
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("Built-in Tool request was rejected")
        .to_string()
}

fn scoped_runtime_tool_call_id(agent_run_id: &str, provider_tool_call_id: &str) -> String {
    format!("agent-run:{agent_run_id}:{provider_tool_call_id}")
}

fn command_execution_payload(execution: CommandExecution) -> Result<Value> {
    if execution.result.status != CommandResultStatus::Rejected {
        return Ok(execution.result.payload);
    }
    let code = execution.result.code;
    Err(BuiltinOperationError {
        details: command_rejection_details(&code, &execution.result.payload),
        code,
        message: command_rejection_message(&execution.result.payload),
    }
    .into())
}

fn command_rejection_details(code: &str, payload: &Value) -> Option<Value> {
    if code.starts_with("message.") {
        return payload.get("details").cloned();
    }
    let allowed_fields: &[&str] = match code {
        "task.version_conflict" => &["taskId", "currentVersion"],
        "memory.version_conflict" => &["memoryId", "currentVersion"],
        _ => return None,
    };
    let details = allowed_fields
        .iter()
        .filter_map(|field| {
            payload
                .get(*field)
                .cloned()
                .map(|value| ((*field).to_string(), value))
        })
        .collect::<serde_json::Map<_, _>>();
    (!details.is_empty()).then_some(Value::Object(details))
}

fn classify_builtin_operation_error(error: &anyhow::Error) -> (String, String, Option<Value>) {
    if let Some(error) = error.downcast_ref::<BuiltinOperationError>() {
        return (
            error.code.clone(),
            error.message.clone(),
            error.details.clone(),
        );
    }
    if let Some(error) = error.downcast_ref::<TeamToolInvocationError>() {
        return (error.code.clone(), error.message.clone(), None);
    }
    if error.downcast_ref::<CommandGatewayError>().is_some() {
        return (
            "team_tool.idempotency_conflict".to_string(),
            "Runtime Tool Call ID was reused with different input".to_string(),
            None,
        );
    }
    (
        "team_tool.internal_error".to_string(),
        "Rovai-ai could not commit the Built-in Tool request".to_string(),
        None,
    )
}

fn canonical_builtin_error_code(code: &str) -> String {
    match code {
        "team_tool.idempotency_conflict" => "builtin_tool.idempotency_conflict".to_string(),
        "team_tool.invalid_input" => "builtin_tool.invalid_input".to_string(),
        "team_tool.internal_error" => "builtin_tool.internal_error".to_string(),
        _ => code.to_string(),
    }
}

fn builtin_tool_rejection(
    operation: &str,
    request_id: &str,
    code: &str,
    message: &str,
) -> BuiltinToolIpcResponse {
    match BuiltinToolInvocationEnvelope::rejected(
        operation,
        request_id,
        BuiltinToolError {
            code: code.to_string(),
            message: message.to_string(),
            recovery: recovery_for_error_code(code),
            details: None,
        },
    ) {
        Ok(envelope) => BuiltinToolIpcResponse::Envelope { envelope },
        Err(error) => {
            eprintln!("failed to form Built-in Tool rejection envelope: {error:#}");
            BuiltinToolIpcResponse::ipc_error(
                "builtin_tool.internal_error",
                "Rovai Core could not form the operation error",
            )
        }
    }
}

fn parse_data_dir() -> Result<PathBuf> {
    parse_data_dir_from(std::env::args().skip(1))
}

fn parse_removed_skill_project_roots() -> Result<Vec<String>> {
    parse_removed_skill_project_roots_from(std::env::args().skip(1))
}

fn parse_removed_skill_project_roots_from(
    args: impl IntoIterator<Item = String>,
) -> Result<Vec<String>> {
    let mut args = args.into_iter();
    let mut roots = BTreeSet::new();
    while let Some(arg) = args.next() {
        if arg != "--removed-skill-project-root" {
            continue;
        }
        let root = args
            .next()
            .context("--removed-skill-project-root requires a path")?;
        let path = Path::new(&root);
        if !path.is_absolute()
            || path.components().any(|component| {
                matches!(
                    component,
                    std::path::Component::CurDir | std::path::Component::ParentDir
                )
            })
        {
            anyhow::bail!("--removed-skill-project-root requires a normalized absolute path");
        }
        roots.insert(root);
    }
    Ok(roots.into_iter().collect())
}

fn parse_data_dir_from(args: impl IntoIterator<Item = String>) -> Result<PathBuf> {
    let mut args = args.into_iter();
    let mut data_dir = None;
    while let Some(arg) = args.next() {
        if arg == "--data-dir" {
            let path = args
                .next()
                .map(PathBuf::from)
                .context("--data-dir requires a path")?;
            if !path.is_absolute() {
                anyhow::bail!("--data-dir requires an absolute path");
            }
            if data_dir.replace(path).is_some() {
                anyhow::bail!("--data-dir may be provided only once");
            }
        }
    }
    data_dir.context(
        "rovai-core requires an explicit absolute --data-dir; refusing to infer daily userData",
    )
}

fn parse_mcp_config_path() -> Result<Option<PathBuf>> {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--mcp-config-path" {
            let path = args
                .next()
                .map(PathBuf::from)
                .context("--mcp-config-path requires a path")?;
            if !path.is_absolute() {
                anyhow::bail!("--mcp-config-path requires an absolute path");
            }
            return Ok(Some(path));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn planned_shutdown_request_is_closed_versioned_and_bounded() {
        let valid = parse_planned_shutdown_params(json!({
            "protocolVersion": 1,
            "deadlineMs": 10_000,
        }))
        .unwrap();
        assert_eq!(valid.deadline_ms, 10_000);
        assert!(
            parse_planned_shutdown_params(json!({
                "protocolVersion": 2,
                "deadlineMs": 10_000,
            }))
            .unwrap_err()
            .to_string()
            .contains("protocolVersion")
        );
        assert!(
            parse_planned_shutdown_params(json!({
                "protocolVersion": 1,
                "deadlineMs": 99,
            }))
            .unwrap_err()
            .to_string()
            .contains("deadlineMs")
        );
        assert!(
            parse_planned_shutdown_params(json!({
                "protocolVersion": 1,
                "deadlineMs": 10_000,
                "rendererAuthority": true,
            }))
            .is_err()
        );
    }

    #[test]
    fn core_data_directory_must_be_explicit_absolute_and_unique() {
        let directory = std::env::temp_dir().join("rovai-core-explicit-data");
        assert_eq!(
            parse_data_dir_from(vec![
                "--data-dir".to_string(),
                directory.to_string_lossy().into_owned(),
            ])
            .unwrap(),
            directory
        );
        assert!(
            format!("{:#}", parse_data_dir_from(Vec::new()).unwrap_err())
                .contains("refusing to infer daily userData")
        );
        assert!(
            format!(
                "{:#}",
                parse_data_dir_from(vec!["--data-dir".to_string(), "relative-data".to_string(),])
                    .unwrap_err()
            )
            .contains("absolute path")
        );
        assert!(
            format!(
                "{:#}",
                parse_data_dir_from(vec![
                    "--data-dir".to_string(),
                    directory.to_string_lossy().into_owned(),
                    "--data-dir".to_string(),
                    directory.to_string_lossy().into_owned(),
                ])
                .unwrap_err()
            )
            .contains("only once")
        );
    }

    #[test]
    fn removed_skill_project_roots_are_explicit_normalized_and_deduplicated() {
        let first = std::env::temp_dir().join("rovai-removed-project-a");
        let second = std::env::temp_dir().join("rovai-removed-project-b");
        let parsed = parse_removed_skill_project_roots_from(vec![
            "--data-dir".to_string(),
            std::env::temp_dir()
                .join("rovai-core-data")
                .to_string_lossy()
                .into_owned(),
            "--removed-skill-project-root".to_string(),
            second.to_string_lossy().into_owned(),
            "--removed-skill-project-root".to_string(),
            first.to_string_lossy().into_owned(),
            "--removed-skill-project-root".to_string(),
            second.to_string_lossy().into_owned(),
        ])
        .unwrap();
        assert_eq!(
            parsed,
            vec![
                first.to_string_lossy().into_owned(),
                second.to_string_lossy().into_owned(),
            ]
        );
        assert!(
            parse_removed_skill_project_roots_from(vec![
                "--removed-skill-project-root".to_string(),
                "relative/project".to_string(),
            ])
            .unwrap_err()
            .to_string()
            .contains("normalized absolute path")
        );
    }

    #[test]
    fn provider_tool_call_ids_are_scoped_to_the_authenticated_agent_run() {
        let first = scoped_runtime_tool_call_id("run-a", "mcp-jsonrpc:same");
        assert_eq!(
            first,
            scoped_runtime_tool_call_id("run-a", "mcp-jsonrpc:same")
        );
        assert_ne!(
            first,
            scoped_runtime_tool_call_id("run-b", "mcp-jsonrpc:same")
        );
    }

    fn managed_runtime_fixture(
        last_successful_probe_at: &str,
        retry_after: Option<&str>,
    ) -> AdapterInstallationView {
        AdapterInstallationView {
            id: "managed-codex".to_string(),
            adapter_kind: AdapterKind::CodexCli,
            executable_path: "/opt/homebrew/bin/codex".to_string(),
            command_name: "codex".to_string(),
            installation_class: rovai_core::agent_profile::InstallationClass::ManagedDefault,
            source: rovai_core::agent_profile::InstallationSource::InheritedPath,
            auth_scope: "default".to_string(),
            enabled: true,
            generation: 1,
            path_state: "valid".to_string(),
            version: 1,
            referenced_profile_count: 1,
            snapshot: Some(rovai_core::agent_profile::AdapterCapabilitySnapshot {
                reported_version: Some("1.2.3".to_string()),
                executable_fingerprint: Some("sha256:test".to_string()),
                authentication_status: "authenticated".to_string(),
                probe_status: "ready".to_string(),
                permission_schema_version: 1,
                permission_schema_digest: "sha256:permissions".to_string(),
                capabilities: Vec::new(),
                protocols: Vec::new(),
                models: Vec::new(),
                permission_options: Vec::new(),
                observed_at: Some(last_successful_probe_at.to_string()),
                last_attempted_at: last_successful_probe_at.to_string(),
                last_successful_probe_at: Some(last_successful_probe_at.to_string()),
                stale_at: None,
                last_error: None,
                native_session_compatibility_key: Some("codex-cli:app-server-v2".to_string()),
            }),
            member_runtime_defaults: None,
            last_probe_attempt: retry_after.map(|retry_after| {
                rovai_core::agent_profile::AdapterProbeAttempt {
                    id: "attempt-1".to_string(),
                    installation_id: "managed-codex".to_string(),
                    status: "failed".to_string(),
                    failure_class: "transient".to_string(),
                    diagnostic_code: Some("runtime_probe_transient_failure".to_string()),
                    candidate_path: "/opt/homebrew/bin/codex".to_string(),
                    executable_fingerprint: Some("sha256:test".to_string()),
                    attempted_at: last_successful_probe_at.to_string(),
                    retry_after: Some(retry_after.to_string()),
                }
            }),
            relocation_history: Vec::new(),
            created_at: last_successful_probe_at.to_string(),
            updated_at: last_successful_probe_at.to_string(),
        }
    }

    #[test]
    fn registered_runtime_refresh_uses_the_last_successful_probe_and_retry_backoff() {
        let now = chrono::Utc::now();
        let fresh =
            managed_runtime_fixture(&(now - chrono::Duration::hours(23)).to_rfc3339(), None);
        assert!(!registered_runtime_refresh_is_due(&fresh, now));

        let due = managed_runtime_fixture(&(now - chrono::Duration::hours(24)).to_rfc3339(), None);
        assert!(registered_runtime_refresh_is_due(&due, now));

        let retry_at = (now + chrono::Duration::minutes(5)).to_rfc3339();
        let deferred = managed_runtime_fixture(
            &(now - chrono::Duration::hours(30)).to_rfc3339(),
            Some(&retry_at),
        );
        assert!(registered_runtime_refresh_is_due(&deferred, now));
        assert!(probe_retry_is_deferred(&deferred, now));
        assert!(
            managed_installation_is_usable(&deferred),
            "a transient refresh failure retains the last successful snapshot"
        );
    }

    #[test]
    fn availability_prefers_a_usable_cached_result_while_background_refresh_runs() {
        let now = chrono::Utc::now();
        let installation =
            managed_runtime_fixture(&(now - chrono::Duration::hours(25)).to_rfc3339(), None);
        assert_eq!(
            product_runtime_availability_status(
                RuntimeDiscoveryStatus::Found,
                Some(&installation),
                None,
                true,
            ),
            "ready"
        );
        assert_eq!(
            product_runtime_availability_status(RuntimeDiscoveryStatus::Found, None, None, true,),
            "checking"
        );
    }

    #[test]
    fn unregistered_product_probe_diagnostics_preserve_the_most_actionable_status() {
        let mut diagnostic = None;
        note_product_runtime_diagnostic(&mut diagnostic, "path_missing", "runtime_path_missing");
        note_product_runtime_diagnostic(
            &mut diagnostic,
            "authentication_required",
            "runtime_authentication_required",
        );
        note_product_runtime_diagnostic(
            &mut diagnostic,
            "transient",
            "runtime_probe_transient_failure",
        );
        let diagnostic = diagnostic.expect("diagnostic");
        assert_eq!(diagnostic.status, "authentication_required");
        assert_eq!(
            diagnostic.diagnostic_code,
            "runtime_authentication_required"
        );
        assert_eq!(diagnostic.priority, 4);
        assert!(product_runtime_diagnostic_is_fresh(
            &diagnostic,
            chrono::Utc::now()
        ));
        assert!(!product_runtime_diagnostic_is_fresh(
            &diagnostic,
            diagnostic.observed_at + chrono::Duration::hours(24)
        ));
    }

    #[test]
    fn diagnostics_only_escalate_unavailable_runtimes_selected_by_current_members() {
        let runtime_health = json!({
            "runtimeCatalog": [{
                "runtimeKind": "codex-cli",
                "displayName": "Codex CLI"
            }],
            "runtimeAvailability": [{
                "runtimeKind": "codex-cli",
                "status": "missing",
                "discovery": { "observedAt": "2026-08-09T08:00:00Z" }
            }]
        });
        let unused = runtime_diagnostic_checks(
            &runtime_health,
            &BTreeMap::new(),
            true,
            "2026-08-09T08:00:00Z",
        );
        let unused_codex = unused
            .iter()
            .find(|check| check.subject_id.as_deref() == Some("codex-cli"))
            .unwrap();
        assert_eq!(unused_codex.status, DiagnosticStatus::Ok);
        assert_eq!(unused_codex.code, "runtime_not_in_use");

        let used = runtime_diagnostic_checks(
            &runtime_health,
            &BTreeMap::from([(AdapterKind::CodexCli, 2)]),
            true,
            "2026-08-09T08:00:00Z",
        );
        let used_codex = used
            .iter()
            .find(|check| check.subject_id.as_deref() == Some("codex-cli"))
            .unwrap();
        assert_eq!(used_codex.status, DiagnosticStatus::Attention);
        assert_eq!(used_codex.code, "runtime_missing");
        assert_eq!(
            used_codex
                .facts
                .iter()
                .find(|fact| fact.key == "usedByMemberCount")
                .map(|fact| fact.value.as_str()),
            Some("2")
        );
    }

    #[test]
    fn diagnostics_keep_incomplete_runtime_evidence_out_of_the_issue_state() {
        let runtime_health = json!({
            "runtimeCatalog": [],
            "runtimeAvailability": [{
                "runtimeKind": "codex-cli",
                "status": "checking",
                "discovery": { "observedAt": "2026-08-09T08:00:00Z" }
            }]
        });
        let checks = runtime_diagnostic_checks(
            &runtime_health,
            &BTreeMap::from([(AdapterKind::CodexCli, 1)]),
            true,
            "2026-08-09T08:00:00Z",
        );
        let codex = checks
            .iter()
            .find(|check| check.subject_id.as_deref() == Some("codex-cli"))
            .unwrap();
        assert_eq!(codex.status, DiagnosticStatus::Unknown);
        assert_eq!(codex.code, "runtime_check_incomplete");
    }

    #[test]
    fn controlled_native_resume_classifies_only_explicit_rejection_as_incompatible() {
        assert_eq!(
            classify_native_resume_failure(&anyhow::anyhow!("session not found")),
            NativeSessionResumeFailure::Incompatible
        );
        assert_eq!(
            classify_native_resume_failure(&anyhow::anyhow!("resume timed out")),
            NativeSessionResumeFailure::Ambiguous
        );
        assert_eq!(
            classify_native_resume_failure(&anyhow::anyhow!("malformed provider reply")),
            NativeSessionResumeFailure::Ambiguous
        );
    }

    #[test]
    fn runtime_probes_do_not_occupy_the_interactive_request_queue() {
        assert!(request_runs_outside_main_queue("health.check"));
        assert!(request_runs_outside_main_queue("diagnostics.check"));
        assert!(request_runs_outside_main_queue("diagnostics.export"));
        assert!(request_runs_outside_main_queue(
            "runtime.installations.refresh"
        ));
        assert!(request_runs_outside_main_queue("runtime.discovery.rescan"));
        assert!(request_runs_outside_main_queue("runtime.product.ensure"));
        assert!(request_runs_outside_main_queue("runtime.product.check"));
        assert!(!request_runs_outside_main_queue("camps.snapshot"));
        assert!(!request_runs_outside_main_queue(
            "camps.reconcileDefaultLead"
        ));
        assert!(request_runs_outside_main_queue("camp.messages.send"));
        assert!(request_runs_outside_main_queue("campTurns.cancel"));
        assert!(request_runs_outside_main_queue(
            "runtime.pendingExecution.cancel"
        ));
    }

    #[tokio::test]
    async fn cancellation_operations_use_an_independent_short_deadline() {
        assert_eq!(
            RUNTIME_CANCELLATION_INTERRUPT_TIMEOUT,
            Duration::from_secs(2)
        );
        assert_eq!(
            run_with_cancellation_deadline(Duration::from_millis(50), async { "ack" }).await,
            Some("ack")
        );
        assert!(
            run_with_cancellation_deadline(Duration::from_millis(5), std::future::pending::<()>(),)
                .await
                .is_none()
        );
    }

    #[test]
    fn acp_tool_events_expose_digests_not_raw_payloads() {
        let (_, payload) = normalize_acp_event(
            "session/update",
            &json!({
                "update": {
                    "sessionUpdate": "tool_call_update",
                    "toolCallId": "tool-1",
                    "toolName": "execute",
                    "status": "completed",
                    "kind": "execute",
                    "title": "Run command",
                    "content": [{"type": "text", "text": "Visible tool progress"}],
                    "rawInput": {"command": "echo TOP_SECRET_INPUT"},
                    "rawOutput": {"stdout": "TOP_SECRET_OUTPUT"}
                }
            }),
        );
        let serialized = serde_json::to_string(&payload).expect("event payload should serialize");

        assert!(!serialized.contains("TOP_SECRET_INPUT"));
        assert!(!serialized.contains("TOP_SECRET_OUTPUT"));
        assert_eq!(payload["output"], "Visible tool progress");
        assert_eq!(payload["toolName"], "execute");
        assert!(payload["rawInputDigest"].is_string());
        assert!(payload["rawOutputDigest"].is_string());
    }

    #[test]
    fn acp_agent_message_events_preserve_only_safe_message_identity_metadata() {
        let (_, update_identity) = normalize_acp_event(
            "session/update",
            &json!({
                "sessionId": "session-1",
                "update": {
                    "sessionUpdate": "agent_message_chunk",
                    "messageId": "message-1",
                    "content": {"type": "text", "text": "final"}
                }
            }),
        );
        assert_eq!(update_identity["messageId"], "message-1");
        assert_eq!(update_identity["messageIdSource"], "update");

        let (_, content_identity) = normalize_acp_event(
            "session/update",
            &json!({
                "sessionId": "session-1",
                "update": {
                    "sessionUpdate": "agent_message_chunk",
                    "content": {"type": "text", "text": "final", "messageId": "message-2"}
                }
            }),
        );
        assert_eq!(content_identity["messageId"], "message-2");
        assert_eq!(content_identity["messageIdSource"], "content");

        let (_, anonymous) = normalize_acp_event(
            "session/update",
            &json!({
                "sessionId": "session-1",
                "update": {
                    "sessionUpdate": "agent_message_chunk",
                    "content": {"type": "text", "text": "final"}
                }
            }),
        );
        assert!(anonymous["messageId"].is_null());
        assert!(anonymous["messageIdSource"].is_null());

        let (_, invalid_identity) = normalize_acp_event(
            "session/update",
            &json!({
                "sessionId": "session-1",
                "update": {
                    "sessionUpdate": "agent_message_chunk",
                    "messageId": {"unexpected": "raw metadata"},
                    "content": {"type": "text", "text": "final", "messageId": "   "}
                }
            }),
        );
        assert!(invalid_identity["messageId"].is_null());
        assert!(invalid_identity["messageIdSource"].is_null());
    }

    #[test]
    fn builtin_operation_errors_publish_only_allowlisted_conflict_details() {
        assert_eq!(
            command_rejection_details(
                "task.version_conflict",
                &json!({
                    "message": "stale",
                    "taskId": "task-1",
                    "currentVersion": 4,
                    "internalSql": "must-not-leak",
                }),
            ),
            Some(json!({"taskId": "task-1", "currentVersion": 4}))
        );
        assert_eq!(
            command_rejection_details(
                "task.not_found",
                &json!({"taskId": "task-1", "currentVersion": 4}),
            ),
            None
        );
    }
}
