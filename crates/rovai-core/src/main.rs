mod acp;
mod antigravity;
mod builtin_tool_runtime;
mod claude;
mod codex;
mod core_subsystems;
mod health;
mod runtime_fleet;
mod runtime_mcp;

use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    future::Future,
    path::{Path, PathBuf},
    sync::Arc,
    time::Instant,
};

use acp::{AcpCliRuntimeAdapter, AcpIncoming, AcpLiveModelValidationError, AcpRuntime};
use antigravity::{
    AntigravityAppRuntimeAdapter, AntigravityDeliveredFailure, AntigravityInputAccepted,
    AntigravityRunRequest,
};
use anyhow::{Context, Result};
use builtin_tool_runtime::{
    BuiltinToolLeaseRegistry, BuiltinToolProcessConfig, builtin_tool_endpoint,
    bundled_cli_executable, request_digest,
};
use claude::{
    ClaudeCodeCliRuntimeAdapter, ClaudeCodeDeliveredFailure, ClaudeCodeInputAccepted,
    ClaudeCodeRunRequest,
};
use codex::{
    CodexAgentRunRuntimeRequest, CodexAgentThreadOptions, CodexCliRuntimeAdapter, CodexIncoming,
    CodexLiveModelValidationError, CodexRuntime,
};
use core_subsystems::{
    CoreSubsystems, SubsystemInitialization, SubsystemUnavailable, runtime_subsystem_id,
};
#[cfg(target_os = "macos")]
use rovai_core::managed_process::configure_user_automation_denial_root;
use rovai_core::{
    action::{
        AcknowledgeRuntimeDeliveryCommand, AcquireRuntimeDeliveryCommand, ActionControlMode,
        ActionResultOutcome, ActionSafetyService, ClaimActionCommand,
        ConfirmRuntimeRequestResolvedCommand, FailRuntimeDeliveryCommand,
        MarkActionDispatchStartedCommand, PrepareActionCommand, ReconcileRuntimeLossCommand,
        RecordActionResultCommand, RecordObservedActionCommand, ResolveActionApprovalCommand,
    },
    agent_profile::{
        AdapterCapabilitySnapshot, AdapterInstallationView, AdapterKind, AdapterProbeAttempt,
        AgentProfileService, ClearMemberRuntimeConfigurationCommand,
        CreateAdapterInstallationCommand, CreateAgentProfileCommand, DiscoveredManagedInstallation,
        FrozenAgentRuntimeConfig, InstallationClass, InstallationSource, ManagedProbeFailure,
        RecordAdapterCapabilitySnapshotCommand, RemoveMemberCommand, ReorderAgentProfilesCommand,
        RuntimeEntrypointLocatorIdentity, RuntimeModelCatalogCacheStatus, RuntimeReadinessStatus,
        SetAgentProfileAvatarCommand, SetMemberPresenceCommand,
        SetMemberRuntimeConfigurationCommand, UpdateAdapterInstallationCommand,
        UpdateAgentProfileCommand, VerifiedManagedInstallation,
    },
    agent_run_file_change::{self, AgentRunFileChangeProjector},
    agent_runtime_adapter::{
        AcpProbeObservation, AgentRuntimeAdapterRegistry, AntigravityProbeObservation,
        ClaudeCodeProbeObservation, CodexProbeObservation, ExecutableIntegrityStatus,
        executable_fingerprint as fingerprint_executable, observe_executable_file_identity,
        verify_executable_integrity,
    },
    authority_migration::{AuthorityMigrationProgress, AuthorityMigrationRunner},
    builtin_tool_evidence_projection::{
        BUILTIN_TOOL_EVIDENCE_PROJECTION_SCHEMA_VERSION, project_builtin_tool_invocation,
    },
    builtin_tool_transport::{
        BUILTIN_TOOL_CONTRACT_VERSION, BUILTIN_TOOL_IPC_PROTOCOL_VERSION,
        BUILTIN_TOOL_MAX_IPC_REQUEST_BYTES, BuiltinToolError, BuiltinToolInvocationEnvelope,
        BuiltinToolIpcRequest, BuiltinToolIpcRequestBody, BuiltinToolIpcResponse,
        COMPACTION_HOOK_IPC_PROTOCOL_VERSION, CompactionHookIpcRequest, CompactionHookIpcResponse,
        builtin_tool_catalog_digest, builtin_tool_description, recovery_for_error_code,
    },
    camp_attachment::{CampAttachmentStore, CampComposerReplyRecipient},
    camp_attachment_publication::{AuthorityAttachment, unresolved_publication_camp_ids},
    camp_attachment_view::{
        CampAttachmentRuntimeAuthorization, CampAttachmentViewStore, PreparedCampAttachmentCleanup,
    },
    camp_content::StructuredCampMessageContent,
    camp_history::{
        CAMP_LIST_TOOL_NAME, CAMP_READ_TOOL_NAME, CAMP_SEARCH_TOOL_NAME, CampHistoryService,
        CampListInput, CampReadInput, CampSearchInput, HISTORY_SEARCH_TOOL_NAME,
        HistorySearchInput, invalid_input_error,
    },
    camp_id::CampId,
    camp_open::CampOpenService,
    collaboration::{
        AddCampMemberCommand, CampActivationState, CampCollaborationMode, ChangeDefaultLeadCommand,
        CollaborationService, CreateCampCommand, CreateTaskCommand, DeleteCampCommand,
        DiscardPendingCampCommand, ExecutionRequest, ProjectBindingKind,
        ReconcileDefaultLeadCommand, RemoveCampMemberCommand, RenameCampCommand,
        SendUserAutomationCampMessageCommand, SendUserCampDraftCommand,
        TaskAcceptanceCriteriaUpdate, TaskAssigneeFilter, TaskAssigneeUpdate, TaskListQuery,
        TaskStatus, UpdateTaskCommand,
    },
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandGatewayError, CommandHandlerResult,
        CommandResultStatus, DomainCommandGateway, canonical_json_digest,
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
        RuntimeInputDelivery, charter_delivery_mode_for_adapter,
    },
    core_data_dir_lock::{CoreDataDirLease, CoreDataDirLeaseAcquisition},
    current_user::CURRENT_USER_ID,
    database_admission::{AdmissionAssessment, AuthorityBlock, DatabaseAdmission},
    db::{Database, DatabaseInitializeError, DatabaseMigrationError, DatabaseOpenError},
    diagnostics::{
        DiagnosticCheck, DiagnosticGroup, DiagnosticStatus, DiagnosticsReport, aggregate_counts,
        database_integrity_check, diagnostics_export_v5,
    },
    execution_budget::camp_turn_execution_budget_now,
    execution_evidence::{
        AgentRunExecutionEvidence, ExecutionEvidenceService, PreparedRuntimeEvidence,
        RUNTIME_EVIDENCE_DELTA_BATCH_MAX_BYTES, RecordedExecutionEvidence,
    },
    file_preview_authority::{ResolveFilePreviewSourceParams, resolve_file_preview_source},
    git,
    managed_attachment::ManagedAttachmentStore,
    managed_blob::ManagedBlobStore,
    mcp::{
        CommitMcpImportParams, CreateMcpServerParams, DeleteMcpServerParams, McpConfigStore,
        SetMcpAssignmentParams, SetMcpServerEnabledParams, UpdateMcpServerParams,
    },
    mcp_import::McpImportScanner,
    mcp_projection::{McpProjectionRequest, McpProjectionService, PreparedMcpProjection},
    member_studio::{MEMBER_CREATE_TOOL_NAME, MemberCreateError, MemberCreateInput, create_member},
    memory::{
        AcceptHearthReviewItemCommand, CreateMemoryCommand, ForgetMemoryCommand, MemoryService,
        ReactivateMemoryCommand, RejectHearthReviewItemCommand, RetireMemoryCommand,
        ReviseMemoryCommand, ScheduleMemoryReviewCommand, SupersedeMemoriesCommand,
    },
    memory_retrieval::{
        MEMORY_READ_TOOL_NAME, MEMORY_SEARCH_TOOL_NAME, MEMORY_VIEW_TOOL_NAME, MemoryReadInput,
        MemoryRetrievalInvocation, MemoryRetrievalService, MemorySearchInput, MemoryViewInput,
    },
    memory_tool::{
        MEMORY_WRITE_TOOL_NAME, MemoryToolService, MemoryWriteToolInput, MemoryWriteToolInvocation,
    },
    message_delivery::{
        CAMP_MESSAGE_SEND_TOOL_NAME, CancelMessageDeliveryCommand, DeliveryDispatchTrigger,
        MessageDeliveryService, RetryMessageDeliveryCommand, dispatch_accepted_deliveries,
        dispatch_pending_for_recipient, mark_unstarted_deliveries_interrupted_before_dispatch,
        runtime_waiting_camps, runtime_waiting_recipients,
    },
    monitoring::{
        MonitoringFilter, MonitoringService, ParsedRuntimeUsage, RuntimeUsageBuffer,
        RuntimeUsageFlushTarget, acp_usage_source_identity, codex_usage_source_identity,
        parse_acp_usage_message, parse_claude_result_usage, parse_codex_usage_message,
    },
    notification::{
        AcknowledgeNotificationEpisodeCommand, AcknowledgeVisibleNotificationSourcesCommand,
        ClearNotificationEpisodeCommand, MarkAllNotificationEpisodesReadCommand,
        NotificationEpisodeFilter, NotificationEpisodeService, UpdateNotificationPreferenceCommand,
    },
    planned_shutdown::{
        ActiveExecutionKey, ActiveExecutionSnapshot, ExecutionLaunchPermit,
        PlannedShutdownCoordinator, RuntimeRouteBinding, RuntimeTerminalAdmission,
        RuntimeTerminalObservation, RuntimeTerminalOutcome, TerminalSettlementPermit,
    },
    platform::{
        HostPlatformKey,
        local_ipc::{LocalIpcListener, LocalIpcStream},
        prepare_windows_data_root,
    },
    read_model::{CampOpenProjection, READ_MODEL_SCHEMA_VERSION, ReadModelService},
    runtime::{
        AcknowledgeAgentRunCancellationCommand, AgentRunCancellationCandidate, AgentRunExecution,
        AgentRunWorkspace, BindNativeSessionCommand, CampRuntimeCleanupTarget,
        CancelAgentRunCommand, CancelCampTurnCommand, ClaimAgentRunCommand,
        ExecutionRuntimeService, FailAgentRunCommand, MissingSendRecoveryBoundary,
        MissingSendRecoveryCandidate, NativeSessionResumeDisposition, NativeSessionResumeFailure,
        PermissionSemantics, PlannedShutdownAbortiveTerminal, RebindAgentRunRuntimeCommand,
        RecordCancelledAgentRunEndingGitObservationCommand, RecordObservedRuntimeModelCommand,
        RejectAgentRunDispatchCommand, ResolveAcceptedInputRecoveryBlockerCommand,
        RestartNativeSessionCommand, SucceedAgentRunCommand,
    },
    runtime_discovery::{
        RuntimeDiscoveryObservation, RuntimeDiscoveryStatus, RuntimeExecutableCandidate,
        RuntimeLaunchPurpose, RuntimeSearchEnvironment, catalog_entries, discover_runtime_path,
        discover_runtime_path_with_manual_candidates, discover_runtime_version,
        is_runtime_entrypoint_file, runtime_launch_allowed, runtime_visible_path,
        with_runtime_search_environment,
    },
    runtime_failure::{
        RuntimeFailureError, RuntimeFailureOrigin, RuntimeFailurePhase, RuntimeFailureView,
        public_runtime_failure_from_output,
    },
    runtime_platform_admission::RuntimePlatformAdmission,
    runtime_resolution::RuntimeResolutionService,
    runtime_search_operation,
    skill::{
        CommitSkillImportCommand, DeleteSkillCommand, SetSkillEnabledCommand,
        SetSkillGroupAssignmentsCommand, SkillLibraryService,
    },
    skill_projection::{
        PreparedSkillExposure, ReconcileSkillProjectionsCommand, SkillProjectionGateBusy,
        SkillProjectionReconciler,
    },
    team_tool::{
        BuiltinToolBindingCredential, CampMessageSendInput, CampMessageSendInvocation, GatherInput,
        GatherInvocation, TEAM_CREATE_TASK_TOOL_NAME, TEAM_GET_TASK_TOOL_NAME,
        TEAM_LIST_TASKS_TOOL_NAME, TEAM_UPDATE_TASK_TOOL_NAME, TeamCreateTaskInput,
        TeamGetTaskInput, TeamListTasksInput, TeamTaskToolInvocation, TeamToolInvocationError,
        TeamToolService, TeamUpdateTaskInput,
    },
    team_tool_catalog::validate_builtin_tool_input,
};
use runtime_fleet::{AgentRuntimeFleetConfig, AgentRuntimeFleetManager};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, BufWriter},
    sync::{Mutex, Notify, RwLock, mpsc, oneshot},
    time::{Duration, MissedTickBehavior},
};

const RUNTIME_CANCELLATION_INTERRUPT_TIMEOUT: Duration = Duration::from_secs(2);
const RUNTIME_CANCELLATION_FENCE_TIMEOUT: Duration = Duration::from_secs(1);
const RUNTIME_CANCELLATION_INGRESS_FLUSH_TIMEOUT: Duration = Duration::from_secs(5);
const PLANNED_SHUTDOWN_PROTOCOL_VERSION: u32 = 3;
const PLANNED_SHUTDOWN_MIN_DEADLINE_MS: u64 = 100;
const PLANNED_SHUTDOWN_MAX_DEADLINE_MS: u64 = 30_000;
const PLANNED_SHUTDOWN_CLEANUP_RESERVE: Duration = Duration::from_secs(2);
const PLANNED_SHUTDOWN_OUTPUT_RESERVE: Duration = Duration::from_millis(250);
const PLANNED_SHUTDOWN_GUARD_GRACE: Duration = Duration::from_millis(250);
const PLANNED_SHUTDOWN_FENCE_SETTLEMENT_RESERVE: Duration = Duration::from_secs(1);
const PLANNED_SHUTDOWN_INTERRUPT_GRACE: Duration = Duration::from_millis(600);
const PLANNED_SHUTDOWN_RUNTIME_REAP_GRACE: Duration = Duration::from_secs(2);
const RUNTIME_USAGE_FLUSH_INTERVAL: Duration = Duration::from_secs(4);
const RUNTIME_EVIDENCE_DELTA_BATCH_WINDOW: Duration = Duration::from_millis(25);
const RUNTIME_EVIDENCE_DELTA_BATCH_MAX_ITEMS: usize = 32;
const CAMP_ATTACHMENT_VIEW_MUTATION_DEADLINE: Duration = Duration::from_secs(55);
const CAMP_ATTACHMENT_VIEW_QUIESCENCE_POLL_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RuntimeCancellationIngressFence {
    Flushed,
    Unproven,
}

struct CampAttachmentReadAdmission {
    camp_id: String,
}

impl CampAttachmentReadAdmission {
    fn for_camp(camp_id: &str) -> Self {
        Self {
            camp_id: camp_id.to_string(),
        }
    }

    fn prove(&self, camp_id: &str) -> Result<()> {
        if self.camp_id != camp_id {
            anyhow::bail!("Camp Attachment read admission does not match the AgentRun Camp");
        }
        Ok(())
    }
}

fn release_agent_run_attachment_admission(
    admission: CampAttachmentReadAdmission,
    projection_requests: &mpsc::UnboundedSender<String>,
) -> bool {
    let camp_id = admission.camp_id.clone();
    drop(admission);
    projection_requests.send(camp_id).is_ok()
}

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
    cancelled_agent_runs_settled: usize,
    unsettled_effect_agent_runs: usize,
    controlled_shutdown_cycle_persisted: bool,
    unresolved_executions: usize,
}

enum OutputControl {
    CloseAndFlush(oneshot::Sender<Result<()>>),
}

fn parse_planned_shutdown_params(value: Value) -> Result<PlannedShutdownParams> {
    let params = serde_json::from_value::<PlannedShutdownParams>(value)
        .context("planned shutdown params are invalid")?;
    if params.protocol_version != PLANNED_SHUTDOWN_PROTOCOL_VERSION {
        anyhow::bail!(
            "planned shutdown protocolVersion must be {}",
            PLANNED_SHUTDOWN_PROTOCOL_VERSION
        );
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

fn canonical_runtime_path(path: &Path) -> PathBuf {
    runtime_visible_path(path.canonicalize().unwrap_or_else(|_| path.to_path_buf()))
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
    kind: &'static str,
    code: String,
    message: String,
    retryable: bool,
    details: Value,
}

fn request_error_body(error: &anyhow::Error) -> ErrorBody {
    if let Some(error) = error.downcast_ref::<SubsystemUnavailable>() {
        return ErrorBody {
            kind: "infrastructure_failure",
            code: "subsystem_unavailable".to_owned(),
            message: error.to_string(),
            retryable: true,
            details: json!({ "subsystem": error.id, "state": error.state }),
        };
    }
    if let Some(error) = error.downcast_ref::<CommandGatewayError>() {
        let code = match error {
            CommandGatewayError::InvalidEnvelope(_) => "COMMAND_ENVELOPE_INVALID",
            CommandGatewayError::IdempotencyConflict { .. } => "COMMAND_IDEMPOTENCY_CONFLICT",
        };
        return ErrorBody {
            kind: "domain_rejection",
            code: code.to_string(),
            message: error.to_string(),
            retryable: false,
            details: json!({}),
        };
    }
    let retryable = error.chain().any(|cause| {
        cause
            .downcast_ref::<rusqlite::Error>()
            .is_some_and(|error| {
                matches!(
                    error,
                    rusqlite::Error::SqliteFailure(sqlite, _)
                        if matches!(
                            sqlite.code,
                            rusqlite::ErrorCode::DatabaseBusy
                                | rusqlite::ErrorCode::DatabaseLocked
                        )
                )
            })
    });
    ErrorBody {
        kind: "infrastructure_failure",
        code: "CORE_REQUEST_FAILED".to_string(),
        message: format!("{error:#}"),
        retryable,
        details: json!({}),
    }
}

fn write_startup_frame(
    status: &str,
    phase: Option<&str>,
    authority_state: Value,
    error: Option<Value>,
    progress: Option<Value>,
) -> Result<()> {
    use std::io::Write as _;

    let mut frame = serde_json::Map::from_iter([
        (
            "kind".to_string(),
            Value::String("core_startup".to_string()),
        ),
        ("schemaVersion".to_string(), Value::from(1)),
        ("status".to_string(), Value::String(status.to_string())),
        ("authorityState".to_string(), authority_state),
    ]);
    if let Some(phase) = phase {
        frame.insert("phase".to_string(), Value::String(phase.to_string()));
    }
    if let Some(error) = error {
        frame.insert("error".to_string(), error);
    }
    if let Some(progress) = progress {
        frame.insert("progress".to_string(), progress);
    }
    let stdout = std::io::stdout();
    let mut output = stdout.lock();
    serde_json::to_writer(&mut output, &Value::Object(frame))?;
    output.write_all(b"\n")?;
    output.flush()?;
    Ok(())
}

fn structured_startup_error(
    code: &str,
    message: impl Into<String>,
    retryable: bool,
    details: Value,
) -> Value {
    json!({
        "code": code,
        "message": message.into(),
        "retryable": retryable,
        "details": details,
    })
}

fn write_authority_block(block: &AuthorityBlock) -> Result<()> {
    write_startup_frame(
        "blocked",
        None,
        json!({ "kind": "blocked", "reason": block }),
        None,
        None,
    )
}

fn write_database_open_refusal(error: &DatabaseOpenError) -> Result<()> {
    if let Some(block) = error.authority_block() {
        return write_authority_block(block);
    }
    write_startup_frame(
        "failed",
        None,
        json!({ "kind": "unknown" }),
        Some(structured_startup_error(
            error.code(),
            error.to_string(),
            false,
            json!({ "stage": "database_open" }),
        )),
        None,
    )
}

fn write_database_initialize_refusal(error: &DatabaseInitializeError) -> Result<()> {
    if let Some(block) = error.authority_block() {
        return write_authority_block(block);
    }
    write_startup_frame(
        "failed",
        None,
        json!({ "kind": "confirmed_absent" }),
        Some(structured_startup_error(
            error.code(),
            error.to_string(),
            false,
            json!({ "stage": "database_initialize" }),
        )),
        None,
    )
}

fn write_database_migration_refusal(error: &DatabaseMigrationError) -> Result<()> {
    let authority_state = match error.authority_block() {
        Some(block) => json!({ "kind": "blocked", "reason": block }),
        None => json!({ "kind": "migration_failed" }),
    };
    write_startup_frame(
        "blocked",
        Some("migration_failed"),
        authority_state,
        Some(structured_startup_error(
            error.code(),
            error.to_string(),
            error.retryable(),
            json!({ "stage": "database_migration" }),
        )),
        None,
    )
}

fn request_runs_outside_main_queue(method: &str) -> bool {
    matches!(
        method,
        "health.check"
            | "diagnostics.check"
            | "diagnostics.export"
            | "monitoring.snapshot"
            | "runtime.installations.refresh"
            | "runtime.discovery.rescan"
            | "runtime.product.ensure"
            | "runtime.product.check"
            | "runtime.modelCatalog.open"
            | "camp.messages.send"
            | "userAutomation.camp.send"
            | "camp.attachments.prepareFromPath"
            | "camp.attachments.previewSource"
            | "camp.attachments.desktopOpenTarget"
            | "campTurns.cancel"
            | "agentRuns.cancel"
            | "runtime.pendingExecution.cancel"
            | "runtime.subsystems.retry"
    )
}

async fn response_for_request(core: &Core, request: &Request) -> Response {
    match core.handle(request).await {
        Ok(result) => {
            if request_did_invalidate_navigation(core, request, &result).await {
                emit_navigation_invalidated(
                    &core.output,
                    &request.method,
                    navigation_request_camp_id(&request.params),
                );
            }
            Response {
                id: request.id.clone(),
                result: Some(result),
                error: None,
            }
        }
        Err(error) => Response {
            id: request.id.clone(),
            result: None,
            error: Some(request_error_body(&error)),
        },
    }
}

fn request_invalidates_navigation(method: &str) -> bool {
    matches!(
        method,
        "members.update"
            | "members.remove"
            | "navigation.campViewed"
            | "camps.create"
            | "camps.discardPending"
            | "camps.rename"
            | "camps.members.add"
            | "camps.members.remove"
            | "camps.changeDefaultLead"
            | "camps.reconcileDefaultLead"
            | "camps.enter"
            | "camps.delete"
            | "camp.composerDraft.save"
            | "camp.composerDraft.startReply"
            | "camp.composerDraft.cancelReply"
            | "camp.composerDraft.resolveReplyRecipient"
            | "camp.composerDraft.dismissContinuation"
            | "camp.composerDraft.resolveContinuationRecipient"
            | "camp.composerDraft.removeAttachment"
            | "camp.composerDraft.discard"
            | "camp.attachments.prepareFromPath"
            | "camp.messages.send"
            | "userAutomation.camp.send"
            | "campTurns.cancel"
            | "agentRuns.cancel"
            | "agentRuns.resolveRecoveryBlocker"
    )
}

fn navigation_invalidation_emitted_at_commit_boundary(method: &str) -> bool {
    matches!(
        method,
        "camps.create"
            | "camps.discardPending"
            | "camp.composerDraft.removeAttachment"
            | "camp.composerDraft.discard"
            | "camp.attachments.prepareFromPath"
            | "camp.messages.send"
    )
}

fn navigation_invalidation_requires_pending_camp(method: &str) -> bool {
    matches!(
        method,
        "camp.composerDraft.save"
            | "camp.composerDraft.startReply"
            | "camp.composerDraft.cancelReply"
            | "camp.composerDraft.resolveReplyRecipient"
            | "camp.composerDraft.dismissContinuation"
            | "camp.composerDraft.resolveContinuationRecipient"
            | "camp.composerDraft.removeAttachment"
            | "camp.composerDraft.discard"
            | "camp.attachments.prepareFromPath"
    )
}

async fn request_did_invalidate_navigation(core: &Core, request: &Request, result: &Value) -> bool {
    if !request_invalidates_navigation(&request.method)
        || navigation_invalidation_emitted_at_commit_boundary(&request.method)
        || navigation_mutation_was_rejected(result)
    {
        return false;
    }
    if !navigation_invalidation_requires_pending_camp(&request.method) {
        return true;
    }
    let Some(camp_id) = navigation_request_camp_id(&request.params) else {
        return true;
    };
    let database = core.database.lock().await;
    match ReadModelService.camp_is_pending(&database, camp_id) {
        Ok(pending) => pending,
        Err(error) => {
            eprintln!(
                "failed to scope Navigation invalidation for Camp {camp_id}; invalidating conservatively: {error:#}"
            );
            true
        }
    }
}

async fn emit_navigation_invalidated_for_pending_camp(
    database: &Mutex<Database>,
    output: &mpsc::UnboundedSender<String>,
    reason: &str,
    camp_id: &str,
) {
    let should_emit = {
        let database = database.lock().await;
        match ReadModelService.camp_is_pending(&database, camp_id) {
            Ok(pending) => pending,
            Err(error) => {
                eprintln!(
                    "failed to scope Navigation invalidation for Camp {camp_id}; invalidating conservatively: {error:#}"
                );
                true
            }
        }
    };
    if should_emit {
        emit_navigation_invalidated(output, reason, Some(camp_id));
    }
}

fn navigation_mutation_was_rejected(result: &Value) -> bool {
    result.get("status").and_then(Value::as_str) == Some("rejected")
        || result
            .get("commandResult")
            .and_then(|command_result| command_result.get("status"))
            .and_then(Value::as_str)
            == Some("rejected")
}

fn navigation_request_camp_id(params: &Value) -> Option<&str> {
    params.get("campId").and_then(Value::as_str).or_else(|| {
        params
            .get("command")
            .and_then(|command| command.get("campId"))
            .and_then(Value::as_str)
    })
}

fn enqueue_response(output: &mpsc::UnboundedSender<String>, response: &Response) -> Result<()> {
    output
        .send(serde_json::to_string(response)?)
        .map_err(|_| anyhow::anyhow!("output writer stopped unexpectedly"))
}

async fn join_or_abort_until(
    handle: &mut tokio::task::JoinHandle<impl Send>,
    graceful_deadline: tokio::time::Instant,
    abort_deadline: tokio::time::Instant,
) -> bool {
    if tokio::time::timeout_at(graceful_deadline, &mut *handle)
        .await
        .is_ok()
    {
        true
    } else {
        handle.abort();
        tokio::time::timeout_at(abort_deadline, &mut *handle)
            .await
            .is_ok()
    }
}

async fn drain_join_set_until<T: 'static>(
    tasks: &mut tokio::task::JoinSet<T>,
    graceful_deadline: tokio::time::Instant,
    abort_deadline: tokio::time::Instant,
) -> bool {
    if tokio::time::timeout_at(graceful_deadline, async {
        while tasks.join_next().await.is_some() {}
    })
    .await
    .is_ok()
    {
        true
    } else {
        tasks.abort_all();
        tokio::time::timeout_at(abort_deadline, async {
            while tasks.join_next().await.is_some() {}
        })
        .await
        .is_ok()
    }
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
    camp_id: CampId,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AgentRunFileChangesParams {
    camp_id: CampId,
    agent_run_id: String,
    execution_epoch: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CampMemberRemovalPreviewParams {
    camp_id: CampId,
    agent_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CampEnterParams {
    trace_id: String,
    command_id: String,
    command: ReconcileDefaultLeadCommand,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CampOpenParams {
    trace_id: String,
    camp_id: CampId,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CampMessagePageParams {
    camp_id: CampId,
    before_sequence: i64,
    through_global_sequence: i64,
    #[serde(default = "default_camp_message_page_limit")]
    limit: i64,
}

fn default_camp_message_page_limit() -> i64 {
    50
}

fn normalized_camp_open_trace_id(trace_id: &str) -> Result<String> {
    uuid::Uuid::parse_str(trace_id)
        .map(|trace_id| trace_id.to_string())
        .context("Camp open traceId must be a UUID")
}

struct CampOpenLogMetrics {
    lock_ms: u128,
    reconcile_ms: u128,
    projection_ms: u128,
    serialization_ms: u128,
    payload_bytes: usize,
}

fn log_camp_open_projection(
    trace_id: &str,
    method: &str,
    metrics: &CampOpenLogMetrics,
    projection: &CampOpenProjection,
) {
    let CampOpenLogMetrics {
        lock_ms,
        reconcile_ms,
        projection_ms,
        serialization_ms,
        payload_bytes,
    } = metrics;
    eprintln!(
        "[camp-open] trace={trace_id} method={method} lock_ms={lock_ms} \
         reconcile_ms={reconcile_ms} projection_ms={projection_ms} \
         serialization_ms={serialization_ms} payload_bytes={payload_bytes} \
         schema={} high_water={} messages={} runs={} evidence={} timeline={}",
        projection.schema_version,
        projection.through_global_sequence,
        projection.messages.len(),
        projection.agent_runs.len(),
        projection.execution_evidence.len(),
        projection.timeline.len(),
    );
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CampMessageAroundParams {
    camp_id: CampId,
    message_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CampMessageFindParams {
    camp_id: CampId,
    query: String,
    selected_match_index: Option<i64>,
    anchor_message_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExecutionEvidenceContentParams {
    camp_id: CampId,
    evidence_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExecutionEvidenceListParams {
    camp_id: CampId,
    agent_run_id: String,
    #[serde(default)]
    after_sequence: i64,
    #[serde(default = "default_execution_evidence_page_limit")]
    limit: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AgentRunDiagnosticParams {
    agent_run_id: String,
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
    camp_id: CampId,
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
    camp_id: CampId,
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
    camp_id: CampId,
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
    camp_id: CampId,
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
    camp_id: CampId,
    through_global_sequence: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SendCampMessageParams {
    command_id: String,
    camp_id: CampId,
    draft_revision: i64,
    execution: Option<ExecutionRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SendUserAutomationCampMessageParams {
    command_id: String,
    camp_id: CampId,
    agent_id: String,
    body: String,
    execution: Option<ExecutionRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CampComposerDraftParams {
    camp_id: CampId,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveCampComposerDraftParams {
    camp_id: CampId,
    expected_revision: i64,
    content: StructuredCampMessageContent,
    continuation_source_message_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StartCampComposerReplyParams {
    camp_id: CampId,
    expected_revision: i64,
    reply_to_camp_message_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MutateCampComposerReplyParams {
    camp_id: CampId,
    expected_revision: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResolveCampComposerReplyRecipientParams {
    camp_id: CampId,
    expected_revision: i64,
    recipient: CampComposerReplyRecipient,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DismissCampComposerContinuationParams {
    camp_id: CampId,
    expected_revision: i64,
    source_camp_message_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResolveCampComposerContinuationRecipientParams {
    camp_id: CampId,
    expected_revision: i64,
    agent_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RemovePreparedAttachmentParams {
    camp_id: CampId,
    expected_revision: i64,
    attachment_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrepareAttachmentFromPathParams {
    camp_id: CampId,
    expected_revision: i64,
    source_path: String,
    display_name: String,
}

async fn prepare_composer_attachment_from_path(
    database: &Mutex<Database>,
    output: &mpsc::UnboundedSender<String>,
    data_dir: &Path,
    params: PrepareAttachmentFromPathParams,
) -> Result<Value> {
    let store = CampAttachmentStore::new(data_dir);
    let plan = {
        let database = database.lock().await;
        store.plan_prepare_from_path(
            &database,
            params.camp_id.as_str(),
            params.expected_revision,
            Path::new(&params.source_path),
            &params.display_name,
        )?
    };
    let filesystem_store = store.clone();
    let prepared =
        tokio::task::spawn_blocking(move || filesystem_store.prepare_from_path_filesystem(plan))
            .await
            .context("Camp Attachment preparation task failed")??;

    let commit = {
        let mut database = database.lock().await;
        store.commit_prepared_attachment(&mut database, &prepared)
    };
    if let Err(error) = commit {
        let cleanup_store = store.clone();
        if let Err(cleanup_error) = tokio::task::spawn_blocking(move || {
            cleanup_store.cleanup_uncommitted_prepared_attachment(prepared)
        })
        .await
        {
            eprintln!("Uncommitted Prepared Attachment cleanup task failed: {cleanup_error}");
        }
        return Err(error);
    }
    emit_navigation_invalidated_for_pending_camp(
        database,
        output,
        "camp.attachments.prepareFromPath",
        params.camp_id.as_str(),
    )
    .await;

    let draft = {
        let database = database.lock().await;
        store.load_draft(&database, params.camp_id.as_str())?
    };
    Ok(serde_json::to_value(draft)?)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AttachmentPreviewSourceParams {
    attachment_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DesktopAttachmentTargetParams {
    camp_id: CampId,
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
    camp_id: Option<CampId>,
    after_global_sequence: i64,
    limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NotificationInboxParams {
    #[serde(default = "default_notification_filter")]
    filter: NotificationEpisodeFilter,
    cursor: Option<String>,
    #[serde(default)]
    limit: usize,
}

fn default_notification_filter() -> NotificationEpisodeFilter {
    NotificationEpisodeFilter::All
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NotificationChangesSinceParams {
    after_change_sequence: i64,
    #[serde(default)]
    limit: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolveActionApprovalParams {
    command_id: String,
    camp_id: CampId,
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
    failure: Option<RuntimeFailureView>,
}

struct RuntimeDeepProbeResult {
    snapshot: rovai_core::agent_profile::AdapterCapabilitySnapshot,
    failure: Option<RuntimeFailureView>,
}

const RUNTIME_CHECK_TOTAL_DEADLINE: Duration = Duration::from_secs(90);
const RUNTIME_CHECK_MAX_CONCURRENCY: usize = 2;
const RUNTIME_PROBE_UPDATE_RETRY_DELAY: Duration = Duration::from_millis(300);
const RUNTIME_PROBE_MAX_EXECUTIONS: usize = 2;
const RUNTIME_CHECK_EXECUTION_COOLDOWN: Duration = Duration::from_secs(3);

fn apply_entrypoint_locator_compatibility(
    snapshot: &mut AdapterCapabilitySnapshot,
    identity: Option<&RuntimeEntrypointLocatorIdentity>,
) {
    let Some(identity) = identity else {
        return;
    };
    let base = snapshot
        .native_session_compatibility_key
        .take()
        .unwrap_or_else(|| "runtime-entrypoint".to_string());
    snapshot.native_session_compatibility_key = Some(format!(
        "{base}:windows-resolved-command-shim-v1:{}",
        identity.compatibility_fingerprint
    ));
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RuntimeCheckOutcome {
    Ready,
    StableFailure,
    Superseded,
}

impl RuntimeCheckOutcome {
    fn is_ready(self) -> bool {
        self == Self::Ready
    }

    fn public_status(self) -> &'static str {
        match self {
            Self::Ready => "ready",
            Self::StableFailure => "stable_failure",
            Self::Superseded => "deferred",
        }
    }
}

#[derive(Default)]
struct RuntimeCheckExecutionDeferrals {
    deferred_until: HashMap<AdapterKind, tokio::time::Instant>,
}

impl RuntimeCheckExecutionDeferrals {
    fn should_defer(&mut self, runtime_kind: AdapterKind, trigger: RuntimeCheckTrigger) -> bool {
        self.should_defer_at(runtime_kind, trigger, tokio::time::Instant::now())
    }

    fn should_defer_at(
        &mut self,
        runtime_kind: AdapterKind,
        trigger: RuntimeCheckTrigger,
        now: tokio::time::Instant,
    ) -> bool {
        if trigger == RuntimeCheckTrigger::Execution {
            match self.deferred_until.get(&runtime_kind).copied() {
                Some(deferred_until) if now < deferred_until => true,
                Some(_) => {
                    self.deferred_until.remove(&runtime_kind);
                    false
                }
                None => false,
            }
        } else {
            self.deferred_until.remove(&runtime_kind);
            false
        }
    }

    fn record(
        &mut self,
        runtime_kind: AdapterKind,
        trigger: RuntimeCheckTrigger,
        outcome: &std::result::Result<RuntimeCheckOutcome, String>,
    ) {
        self.record_at(runtime_kind, trigger, outcome, tokio::time::Instant::now());
    }

    fn record_at(
        &mut self,
        runtime_kind: AdapterKind,
        trigger: RuntimeCheckTrigger,
        outcome: &std::result::Result<RuntimeCheckOutcome, String>,
        now: tokio::time::Instant,
    ) {
        if trigger == RuntimeCheckTrigger::Execution
            && outcome.as_ref() == Ok(&RuntimeCheckOutcome::Superseded)
        {
            self.deferred_until
                .insert(runtime_kind, now + RUNTIME_CHECK_EXECUTION_COOLDOWN);
        }
    }
}

enum IdentityCheckedProbe<T> {
    Stable(std::result::Result<T, anyhow::Error>),
    Superseded,
}

async fn run_identity_checked_probe<T>(
    executable_path: &Path,
    probe: impl Future<Output = Result<T>>,
) -> IdentityCheckedProbe<T> {
    let before = observe_executable_file_identity(executable_path).ok();
    let result = probe.await;
    let superseded = before.as_ref().is_some_and(|before| {
        observe_executable_file_identity(executable_path)
            .map(|after| after != *before)
            .unwrap_or(true)
    });
    if superseded {
        IdentityCheckedProbe::Superseded
    } else {
        IdentityCheckedProbe::Stable(result)
    }
}

fn runtime_probe_update_retry_at(
    now: tokio::time::Instant,
    deadline: tokio::time::Instant,
) -> Option<tokio::time::Instant> {
    (now < deadline).then_some(std::cmp::min(
        now + RUNTIME_PROBE_UPDATE_RETRY_DELAY,
        deadline,
    ))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum RuntimeCheckTrigger {
    CatalogOpen,
    UserCheck,
    Execution,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RuntimeCheckActivity {
    attempt_id: String,
    runtime_kind: AdapterKind,
    deadline: chrono::DateTime<chrono::Utc>,
    running: bool,
}

struct RuntimeCheckRequest {
    runtime_kind: AdapterKind,
    purpose: RuntimeLaunchPurpose,
    trigger: RuntimeCheckTrigger,
    acknowledged: oneshot::Sender<bool>,
    completion: Option<oneshot::Sender<std::result::Result<RuntimeCheckOutcome, String>>>,
}

struct RuntimeCheckAttempt {
    attempt_id: String,
    runtime_kind: AdapterKind,
    purpose: RuntimeLaunchPurpose,
    trigger: RuntimeCheckTrigger,
    started_at: tokio::time::Instant,
    deadline: tokio::time::Instant,
    waiters: Vec<oneshot::Sender<std::result::Result<RuntimeCheckOutcome, String>>>,
}

struct RuntimeCheckWorkerResult {
    attempt_id: String,
    runtime_kind: AdapterKind,
    result: std::result::Result<RuntimeCheckOutcome, String>,
    finalization: RuntimeCheckFinalization,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RuntimeCheckFinalization {
    Product,
    Supervisor,
    CleanupOnly,
}

fn windows_runtime_qualification_allows(runtime_kind: AdapterKind) -> bool {
    #[cfg(all(debug_assertions, target_os = "windows"))]
    {
        std::env::var("ROVAI_WINDOWS_RUNTIME_QUALIFICATION_ADAPTER")
            .ok()
            .is_some_and(|candidates| {
                candidates
                    .split(',')
                    .any(|candidate| candidate.trim() == runtime_kind.as_str())
            })
    }

    #[cfg(not(all(debug_assertions, target_os = "windows")))]
    {
        let _ = runtime_kind;
        false
    }
}

const WINDOWS_LOCAL_QUALIFICATION_EVIDENCE_REVISION: &str =
    "local-debug:windows-runtime-qualification-adapter";

fn apply_windows_runtime_qualification_override(
    admission: RuntimePlatformAdmission,
    locally_qualified: bool,
) -> RuntimePlatformAdmission {
    if locally_qualified && admission.platform() == HostPlatformKey::WindowsX64 {
        RuntimePlatformAdmission::qualified(
            admission.runtime_kind(),
            admission.platform(),
            WINDOWS_LOCAL_QUALIFICATION_EVIDENCE_REVISION,
        )
    } else {
        admission
    }
}

fn current_runtime_platform_admission(
    runtime_kind: AdapterKind,
) -> Option<RuntimePlatformAdmission> {
    AgentRuntimeAdapterRegistry::default()
        .current_platform_admission(runtime_kind)
        .map(|admission| {
            apply_windows_runtime_qualification_override(
                admission,
                windows_runtime_qualification_allows(runtime_kind),
            )
        })
}

fn runtime_platform_admission_matrix() -> Vec<RuntimePlatformAdmission> {
    AgentRuntimeAdapterRegistry::default()
        .platform_admission_matrix()
        .into_iter()
        .map(|admission| {
            let locally_qualified = windows_runtime_qualification_allows(admission.runtime_kind());
            apply_windows_runtime_qualification_override(admission, locally_qualified)
        })
        .collect()
}

fn current_platform_qualified_runtime_kinds() -> Vec<AdapterKind> {
    AdapterKind::ALL
        .into_iter()
        .filter(|kind| {
            windows_runtime_qualification_allows(*kind)
                || current_runtime_platform_admission(*kind)
                    .as_ref()
                    .is_some_and(RuntimePlatformAdmission::is_qualified)
        })
        .collect()
}

fn current_runtime_platform_blocker(runtime_kind: AdapterKind) -> Option<CommandHandlerResult> {
    if windows_runtime_qualification_allows(runtime_kind) {
        return None;
    }
    match current_runtime_platform_admission(runtime_kind) {
        Some(admission) if admission.is_qualified() => None,
        Some(admission) => Some(CommandHandlerResult::rejected(
            admission
                .blocker_code()
                .expect("a denied Runtime platform admission has a blocker code"),
            json!({
                "field": "runtime",
                "runtimeKind": runtime_kind,
                "platformAdmission": admission,
            }),
        )),
        None => Some(CommandHandlerResult::rejected(
            "runtime_platform_unsupported",
            json!({
                "field": "runtime",
                "runtimeKind": runtime_kind,
                "platform": null,
                "reasonCode": "runtime_platform.adapter_not_implemented",
            }),
        )),
    }
}

struct ClaudeInputAcceptanceTarget<'a> {
    delivery_id: &'a str,
    expected_native_session_id: &'a str,
    expected_native_turn_id: &'a str,
    is_new_session: bool,
}

struct Core {
    database: Mutex<Database>,
    subsystems: CoreSubsystems,
    subsystem_initialization: Mutex<SubsystemInitialization>,
    startup_skill_execution_roots: Vec<String>,
    startup_pending_camp_ids: Vec<String>,
    builtin_tool_listener: Mutex<Option<LocalIpcListener>>,
    builtin_tool_listener_notify: Notify,
    runtime_usage: Mutex<RuntimeUsageBuffer>,
    runtime_usage_flush: Mutex<()>,
    output: mpsc::UnboundedSender<String>,
    runtime_search_environment: RwLock<Arc<RuntimeSearchEnvironment>>,
    runtime_discovery:
        RwLock<BTreeMap<rovai_core::agent_profile::AdapterKind, RuntimeDiscoveryObservation>>,
    runtime_product_diagnostics:
        RwLock<BTreeMap<rovai_core::agent_profile::AdapterKind, ProductRuntimeDiagnostic>>,
    runtime_check_activity:
        RwLock<BTreeMap<rovai_core::agent_profile::AdapterKind, RuntimeCheckActivity>>,
    runtime_check_requests: mpsc::UnboundedSender<RuntimeCheckRequest>,
    attachment_projection_requests: mpsc::UnboundedSender<String>,
    compaction_detector_policies: DesiredCompactionDetectorPolicies,
    agent_run_cancellation_notify: Notify,
    pending_execution_recovery: Mutex<()>,
    skill_library: SkillLibraryService,
    mcp_config: Result<McpConfigStore>,
    mcp_projection: McpProjectionService,
    codex_cli: CodexCliRuntimeAdapter,
    opencode_cli: AcpCliRuntimeAdapter,
    copilot_cli: AcpCliRuntimeAdapter,
    kiro_cli: AcpCliRuntimeAdapter,
    qoder_cli: AcpCliRuntimeAdapter,
    codebuddy_cli: AcpCliRuntimeAdapter,
    qwen_code: AcpCliRuntimeAdapter,
    trae_cn_cli: AcpCliRuntimeAdapter,
    cursor_agent: AcpCliRuntimeAdapter,
    kimi_code_cli: AcpCliRuntimeAdapter,
    grok_build: AcpCliRuntimeAdapter,
    runtime_fleet: Arc<AgentRuntimeFleetManager>,
    builtin_tool_leases: Arc<BuiltinToolLeaseRegistry>,
    claude_code_cli: ClaudeCodeCliRuntimeAdapter,
    antigravity_app: AntigravityAppRuntimeAdapter,
    planned_shutdown: Arc<PlannedShutdownCoordinator>,
    agent_run_tasks: Mutex<tokio::task::JoinSet<()>>,
    attachment_views: CampAttachmentViewStore,
    attachment_view_gates: Mutex<HashMap<String, Arc<RwLock<()>>>>,
    data_dir: PathBuf,
}

struct PreparedRuntimeLaunch<'a> {
    execution: &'a AgentRunExecution,
    resume_disposition: NativeSessionResumeDisposition,
    skill_exposure: &'a PreparedSkillExposure,
    mcp_projection: &'a PreparedMcpProjection,
    attachment_admission: &'a CampAttachmentReadAdmission,
    attachment_authorization: &'a CampAttachmentRuntimeAuthorization,
    output: &'a mpsc::UnboundedSender<String>,
    launch_permit: &'a mut ExecutionLaunchPermit,
}

#[derive(Clone, Copy)]
struct CampAttachmentRunAccess<'a> {
    admission: &'a CampAttachmentReadAdmission,
    authorization: &'a CampAttachmentRuntimeAuthorization,
}

impl CampAttachmentRunAccess<'_> {
    fn prove(self, execution: &AgentRunExecution) -> Result<()> {
        self.admission.prove(&execution.camp_id)?;
        if self.authorization.camp_id != execution.camp_id {
            anyhow::bail!("Camp Attachment Runtime authorization does not match the AgentRun Camp");
        }
        Ok(())
    }
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
    let qualified_runtime_kinds = match (
        runtime_health.get("hostPlatform").and_then(Value::as_str),
        runtime_health
            .get("runtimePlatformAdmission")
            .and_then(Value::as_array),
    ) {
        (Some(host_platform), Some(admission)) => Some(
            admission
                .iter()
                .filter(|row| {
                    row.get("platform").and_then(Value::as_str) == Some(host_platform)
                        && row.get("status").and_then(Value::as_str) == Some("qualified")
                })
                .filter_map(|row| row.get("runtimeKind")?.as_str().map(str::to_string))
                .collect::<BTreeSet<_>>(),
        ),
        _ => None,
    };

    AdapterKind::ALL
        .into_iter()
        .filter(|kind| {
            qualified_runtime_kinds
                .as_ref()
                .is_none_or(|qualified| qualified.contains(kind.as_str()))
        })
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
                    "light_ready" => (
                        DiagnosticStatus::Unknown,
                        "runtime_verification_deferred",
                        "Runtime executable is available; login and capabilities are verified on demand",
                        false,
                    ),
                    "installed_unverified" => (
                        DiagnosticStatus::Unknown,
                        "runtime_verification_deferred",
                        "Runtime is installed; login and capabilities will be verified by the first real task",
                        false,
                    ),
                    "authentication_required" => (
                        DiagnosticStatus::Attention,
                        "runtime_authentication_required",
                        "Runtime requires user authentication",
                        false,
                    ),
                    "needs_attention" => (
                        DiagnosticStatus::Attention,
                        "runtime_needs_attention",
                        "The latest Runtime check requires user attention",
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
        AdapterKind::TraeCnCli => "TRAE CLI",
        AdapterKind::CursorAgent => "Cursor Agent",
        AdapterKind::KimiCodeCli => "Kimi Code",
        AdapterKind::GrokBuild => "Grok Build",
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

    async fn cancel(&self) -> Result<()> {
        match self {
            Self::Codex(runtime) => runtime.interrupt().await,
            Self::Acp(runtime) => runtime.cancel().await,
        }
    }

    async fn detach_and_flush_ingress(&self) -> bool {
        match self {
            Self::Codex(runtime) => runtime.detach_and_flush_ingress().await,
            Self::Acp(runtime) => runtime.detach_and_flush_ingress().await,
        }
    }
}

impl Core {
    async fn attachment_view_gate(&self, camp_id: &str) -> Arc<RwLock<()>> {
        let mut gates = self.attachment_view_gates.lock().await;
        gates
            .entry(camp_id.to_string())
            .or_insert_with(|| Arc::new(RwLock::new(())))
            .clone()
    }

    async fn acquire_camp_attachment_mutation(
        &self,
        camp_id: &str,
    ) -> Result<(tokio::sync::OwnedRwLockWriteGuard<()>, tokio::time::Instant)> {
        let deadline = tokio::time::Instant::now() + CAMP_ATTACHMENT_VIEW_MUTATION_DEADLINE;
        let gate = self.attachment_view_gate(camp_id).await;
        let guard = tokio::time::timeout_at(deadline, gate.write_owned())
            .await
            .map_err(|_| anyhow::anyhow!("camp_attachment_view_busy"))?;
        Ok((guard, deadline))
    }

    async fn verified_camp_attachment_admission(
        &self,
        camp_id: &str,
        workspace: &Path,
    ) -> Result<(
        CampAttachmentReadAdmission,
        CampAttachmentRuntimeAuthorization,
    )> {
        let authorization = self
            .verified_camp_runtime_authorization(camp_id, workspace)
            .await?;
        Ok((
            CampAttachmentReadAdmission::for_camp(camp_id),
            authorization,
        ))
    }

    async fn wait_for_camp_attachment_quiescence(
        &self,
        camp_id: &str,
        deadline: tokio::time::Instant,
    ) -> Result<()> {
        loop {
            let has_active_runtime = {
                let database = self.database.lock().await;
                self.attachment_views
                    .camp_has_active_runtime(&database, camp_id)?
            };
            if !has_active_runtime
                && self
                    .runtime_fleet
                    .fence_camp_for_attachment_mutation(camp_id)
                    .await
                    .is_ok()
            {
                return Ok(());
            }
            if tokio::time::Instant::now() >= deadline {
                anyhow::bail!("camp_attachment_view_busy");
            }
            tokio::time::sleep(CAMP_ATTACHMENT_VIEW_QUIESCENCE_POLL_INTERVAL).await;
        }
    }

    async fn finish_camp_attachment_cleanup(
        &self,
        cleanup: Option<&PreparedCampAttachmentCleanup>,
    ) -> Result<()> {
        let Some(cleanup) = cleanup else {
            return Ok(());
        };
        let mut database = self.database.lock().await;
        self.attachment_views
            .commit_camp_delete_cleanup(&mut database, cleanup)?;
        self.attachment_views
            .complete_camp_delete_cleanup(&mut database, cleanup)
    }

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

    async fn stop_deleted_camp_runtime_kind(
        &self,
        targets: &[CampRuntimeCleanupTarget],
        adapter_kind: AdapterKind,
    ) {
        for target in targets
            .iter()
            .filter(|target| target.adapter_kind == adapter_kind)
        {
            match adapter_kind {
                AdapterKind::CodexCli => {
                    self.codex_cli
                        .forget_agent_run(&target.agent_run_id, target.execution_epoch)
                        .await;
                }
                kind if kind.uses_acp() => {
                    if let Some(adapter) = self.acp_adapter(kind) {
                        adapter
                            .forget_agent_run(&target.agent_run_id, target.execution_epoch)
                            .await;
                    }
                }
                AdapterKind::ClaudeCodeCli => {
                    self.claude_code_cli
                        .interrupt(&target.agent_run_id, target.execution_epoch)
                        .await;
                }
                AdapterKind::AntigravityApp => {
                    self.antigravity_app
                        .interrupt(&target.agent_run_id, target.execution_epoch)
                        .await;
                }
                _ => unreachable!("all Adapter kinds are handled"),
            }
        }
    }

    async fn stop_deleted_camp_runtimes(&self, targets: &[CampRuntimeCleanupTarget]) {
        tokio::join!(
            self.stop_deleted_camp_runtime_kind(targets, AdapterKind::CodexCli),
            self.stop_deleted_camp_runtime_kind(targets, AdapterKind::OpencodeCli),
            self.stop_deleted_camp_runtime_kind(targets, AdapterKind::CopilotCli),
            self.stop_deleted_camp_runtime_kind(targets, AdapterKind::ClaudeCodeCli),
            self.stop_deleted_camp_runtime_kind(targets, AdapterKind::AntigravityApp),
            self.stop_deleted_camp_runtime_kind(targets, AdapterKind::KiroCli),
            self.stop_deleted_camp_runtime_kind(targets, AdapterKind::QoderCli),
            self.stop_deleted_camp_runtime_kind(targets, AdapterKind::CodebuddyCli),
            self.stop_deleted_camp_runtime_kind(targets, AdapterKind::QwenCode),
            self.stop_deleted_camp_runtime_kind(targets, AdapterKind::TraeCnCli),
            self.stop_deleted_camp_runtime_kind(targets, AdapterKind::CursorAgent),
            self.stop_deleted_camp_runtime_kind(targets, AdapterKind::KimiCodeCli),
            self.stop_deleted_camp_runtime_kind(targets, AdapterKind::GrokBuild),
        );
        for target in targets {
            self.planned_shutdown
                .remove_active(&ActiveExecutionKey::new(
                    &target.agent_run_id,
                    target.execution_epoch,
                ))
                .await;
        }
    }

    async fn expire_elapsed_execution_budgets(&self, output: &mpsc::UnboundedSender<String>) {
        let observed_now = camp_turn_execution_budget_now();
        let result = {
            let mut database = self.database.lock().await;
            ExecutionRuntimeService::default().expire_elapsed_camp_turn_execution_budgets(
                &mut database,
                observed_now,
                chrono::Utc::now(),
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
        let qualified_runtime_kinds = current_platform_qualified_runtime_kinds();
        self.runtime_product_diagnostics.write().await.clear();
        let managed_installations = {
            let database = self.database.lock().await;
            let service = AgentProfileService::default();
            match service.list_installations(&database) {
                Ok(installations) => {
                    let mut managed = HashMap::new();
                    for installation in installations.into_iter().filter(|installation| {
                        installation.installation_class == InstallationClass::ManagedDefault
                            && installation.auth_scope == "default"
                    }) {
                        let locator = match service
                            .runtime_entrypoint_locator_identity(&database, &installation.id)
                        {
                            Ok(locator) => locator,
                            Err(error) => {
                                eprintln!(
                                    "failed to load Runtime entrypoint locator for {}: {error:#}",
                                    installation.adapter_kind.as_str()
                                );
                                continue;
                            }
                        };
                        managed.insert(installation.adapter_kind, (installation, locator));
                    }
                    managed
                }
                Err(error) => {
                    eprintln!("failed to load managed Runtime discovery fallbacks: {error:#}");
                    HashMap::new()
                }
            }
        };
        {
            let mut observations = self.runtime_discovery.write().await;
            observations.retain(|kind, _| qualified_runtime_kinds.contains(kind));
            for kind in qualified_runtime_kinds.iter().copied() {
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
        let mut path_attempts = HashMap::new();
        for kind in qualified_runtime_kinds {
            let search = search.clone();
            let managed_installation = managed_installations.get(&kind).cloned();
            let handle = path_tasks.spawn_blocking(move || {
                let explicit_saved_path = managed_installation
                    .as_ref()
                    .filter(|(installation, _)| {
                        matches!(
                            installation.source,
                            InstallationSource::Manual | InstallationSource::Custom
                        )
                    })
                    .map(|(installation, locator)| {
                        locator
                            .as_ref()
                            .map(|identity| PathBuf::from(&identity.canonical_shim_path))
                            .unwrap_or_else(|| PathBuf::from(&installation.executable_path))
                    });
                let mut observation = if let Some(saved_path) = explicit_saved_path {
                    let mut observation =
                        discover_runtime_path_with_manual_candidates(kind, &search, [saved_path]);
                    if observation.discovery_status == RuntimeDiscoveryStatus::Found {
                        observation.source = managed_installation
                            .as_ref()
                            .map(|(installation, _)| installation.source);
                    }
                    observation
                } else {
                    discover_runtime_path(kind, &search)
                };
                let mut missing_managed_installation = None;
                if observation.discovery_status == RuntimeDiscoveryStatus::Missing
                    && let Some((installation, locator)) = managed_installation
                {
                    let saved_path = locator
                        .as_ref()
                        .map(|identity| PathBuf::from(&identity.canonical_shim_path))
                        .unwrap_or_else(|| PathBuf::from(&installation.executable_path));
                    let saved_candidate = search
                        .candidates(kind, [saved_path])
                        .into_iter()
                        .find(|candidate| is_runtime_entrypoint_file(&candidate.path));
                    if let Some(candidate) = saved_candidate {
                        let canonical = canonical_runtime_path(&candidate.path);
                        match fingerprint_executable(&canonical) {
                            Ok(fingerprint) => {
                                observation.discovery_status = RuntimeDiscoveryStatus::Found;
                                observation.executable_path =
                                    Some(canonical.to_string_lossy().to_string());
                                observation.source = Some(installation.source);
                                observation.executable_fingerprint = Some(fingerprint);
                                observation.search_path_source = candidate.search_path_source;
                                observation.entrypoint_kind = Some(candidate.entrypoint_kind);
                                observation.candidate_extension =
                                    Some(candidate.candidate_extension);
                                observation.resolved_native_target =
                                    candidate.resolved_native_target;
                                observation.entrypoint_locator_identity =
                                    candidate.entrypoint_locator_identity;
                                observation.diagnostic_code = None;
                            }
                            Err(_) => {
                                observation.diagnostic_code =
                                    Some("runtime_executable_fingerprint_failed".to_string());
                            }
                        }
                    } else {
                        missing_managed_installation =
                            Some((installation.id, installation.executable_path));
                    }
                }
                (observation, missing_managed_installation)
            });
            path_attempts.insert(handle.id(), kind);
        }
        let mut version_tasks = tokio::task::JoinSet::new();
        let mut version_attempts = HashMap::new();
        while let Some(result) = path_tasks.join_next_with_id().await {
            match result {
                Ok((task_id, (observation, missing_managed_installation))) => {
                    path_attempts.remove(&task_id);
                    if let Some((installation_id, expected_executable_path)) =
                        missing_managed_installation
                    {
                        let mut database = self.database.lock().await;
                        if let Err(error) = AgentProfileService::default()
                            .mark_managed_installation_path_missing_if_current(
                                &mut database,
                                observation.runtime_kind,
                                "default",
                                &installation_id,
                                &expected_executable_path,
                                observation.search_generation,
                            )
                        {
                            eprintln!(
                                "failed to mark missing managed Runtime path for {}: {error:#}",
                                observation.runtime_kind.as_str()
                            );
                        }
                    }
                    if observation.discovery_status == RuntimeDiscoveryStatus::Found {
                        let search = search.clone();
                        let fallback = observation.clone();
                        let handle = version_tasks.spawn(async move {
                            let mut observation = observation;
                            discover_runtime_version(&mut observation, &search).await;
                            observation
                        });
                        version_attempts.insert(handle.id(), fallback);
                    } else {
                        self.publish_runtime_discovery(observation).await;
                    }
                }
                Err(error) => {
                    if let Some(kind) = path_attempts.remove(&error.id())
                        && self.runtime_search_environment.read().await.generation()
                            == search.generation()
                    {
                        self.runtime_product_diagnostics.write().await.insert(
                            kind,
                            ProductRuntimeDiagnostic {
                                status: "needs_attention",
                                diagnostic_code: if error.is_cancelled() {
                                    "runtime_path_discovery_cancelled"
                                } else if error.is_panic() {
                                    "runtime_path_discovery_worker_panicked"
                                } else {
                                    "runtime_path_discovery_join_failed"
                                }
                                .to_string(),
                                priority: 2,
                                failure: None,
                            },
                        );
                        let mut observation =
                            RuntimeDiscoveryObservation::detecting(kind, search.generation());
                        observation.discovery_status = RuntimeDiscoveryStatus::Missing;
                        observation.diagnostic_code =
                            Some("runtime_path_discovery_supervisor_failure".to_string());
                        self.publish_runtime_discovery(observation).await;
                    }
                    eprintln!("Runtime quick discovery worker failed: {error}");
                }
            }
        }
        while let Some(result) = version_tasks.join_next_with_id().await {
            match result {
                Ok((task_id, observation)) => {
                    version_attempts.remove(&task_id);
                    self.publish_runtime_discovery(observation).await;
                }
                Err(error) => {
                    let task_id = error.id();
                    if let Some(mut observation) = version_attempts.remove(&task_id) {
                        observation.reported_version = None;
                        observation.diagnostic_code = Some(
                            if error.is_cancelled() {
                                "runtime_light_probe_cancelled"
                            } else if error.is_panic() {
                                "runtime_light_probe_worker_panicked"
                            } else {
                                "runtime_light_probe_join_failed"
                            }
                            .to_string(),
                        );
                        observation.observed_at = chrono::Utc::now().to_rfc3339();
                        self.publish_runtime_discovery(observation).await;
                    }
                    eprintln!("Runtime version discovery worker failed: {error}");
                }
            }
        }
        emit(
            &self.output,
            "runtime.discovery.completed",
            json!({ "searchEnvironment": search.summary() }),
        );
    }

    async fn publish_runtime_discovery(&self, observation: RuntimeDiscoveryObservation) {
        if self.runtime_search_environment.read().await.generation()
            != observation.search_generation
        {
            return;
        }
        if observation.discovery_status == RuntimeDiscoveryStatus::Found
            && let Err(error) = self.persist_light_discovery(&observation).await
        {
            eprintln!(
                "failed to persist bounded Runtime discovery for {}: {error:#}",
                observation.runtime_kind.as_str()
            );
        }
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

    async fn publish_verified_runtime_discovery(&self, observation: RuntimeDiscoveryObservation) {
        if self.runtime_search_environment.read().await.generation()
            != observation.search_generation
        {
            return;
        }
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

    async fn persist_light_discovery(
        &self,
        observation: &RuntimeDiscoveryObservation,
    ) -> Result<()> {
        let executable_path = observation
            .executable_path
            .as_deref()
            .context("light Runtime discovery did not include executablePath")?;
        let executable_fingerprint = observation
            .executable_fingerprint
            .as_deref()
            .context("light Runtime discovery did not include executableFingerprint")?;
        let source = observation
            .source
            .context("light Runtime discovery did not include source")?;
        let registry = AgentRuntimeAdapterRegistry::default();
        let mut snapshot =
            if observation.reported_version.is_some() && observation.diagnostic_code.is_none() {
                registry.light_ready_snapshot(
                    observation.runtime_kind,
                    observation.reported_version.clone(),
                    executable_fingerprint.to_string(),
                    observation.observed_at.clone(),
                )?
            } else {
                registry.light_failed_snapshot(
                    observation.runtime_kind,
                    observation.reported_version.clone(),
                    executable_fingerprint.to_string(),
                    observation.observed_at.clone(),
                    observation
                        .diagnostic_code
                        .clone()
                        .unwrap_or_else(|| "runtime_light_probe_incomplete".to_string()),
                )?
            };
        apply_entrypoint_locator_compatibility(
            &mut snapshot,
            observation.entrypoint_locator_identity.as_ref(),
        );
        let mut database = self.database.lock().await;
        AgentProfileService::default().commit_discovered_managed_installation(
            &mut database,
            DiscoveredManagedInstallation {
                adapter_kind: observation.runtime_kind,
                executable_path: executable_path.to_string(),
                command_name: observation.runtime_kind.command_name().to_string(),
                source,
                auth_scope: "default".to_string(),
                snapshot,
                entrypoint_locator_identity: observation.entrypoint_locator_identity.clone(),
            },
        )?;
        Ok(())
    }

    async fn commit_rebound_runtime_candidate(
        &self,
        kind: AdapterKind,
        executable_path: &Path,
        executable_fingerprint: &str,
        source: InstallationSource,
        candidate: &RuntimeExecutableCandidate,
        search_generation: u64,
    ) -> Result<()> {
        let observed_at = chrono::Utc::now().to_rfc3339();
        let mut snapshot = AgentRuntimeAdapterRegistry::default().light_ready_snapshot(
            kind,
            None,
            executable_fingerprint.to_string(),
            observed_at.clone(),
        )?;
        apply_entrypoint_locator_compatibility(
            &mut snapshot,
            candidate.entrypoint_locator_identity.as_ref(),
        );
        {
            let mut database = self.database.lock().await;
            AgentProfileService::default().commit_discovered_managed_installation(
                &mut database,
                DiscoveredManagedInstallation {
                    adapter_kind: kind,
                    executable_path: executable_path.to_string_lossy().to_string(),
                    command_name: kind.command_name().to_string(),
                    source,
                    auth_scope: "default".to_string(),
                    snapshot,
                    entrypoint_locator_identity: candidate.entrypoint_locator_identity.clone(),
                },
            )?;
        }
        self.runtime_product_diagnostics.write().await.remove(&kind);
        self.publish_verified_runtime_discovery(RuntimeDiscoveryObservation {
            runtime_kind: kind,
            discovery_status: RuntimeDiscoveryStatus::Found,
            executable_path: Some(executable_path.to_string_lossy().to_string()),
            source: Some(source),
            reported_version: None,
            executable_fingerprint: Some(executable_fingerprint.to_string()),
            search_path_source: candidate.search_path_source,
            entrypoint_kind: Some(candidate.entrypoint_kind),
            candidate_extension: Some(candidate.candidate_extension),
            resolved_native_target: candidate.resolved_native_target,
            version_probe_succeeded: None,
            search_generation,
            observed_at,
            diagnostic_code: None,
            entrypoint_locator_identity: candidate.entrypoint_locator_identity.clone(),
        })
        .await;
        Ok(())
    }

    async fn runtime_probe_identity_is_current(
        &self,
        kind: AdapterKind,
        search_generation: u64,
        executable_path: &Path,
        executable_fingerprint: &str,
    ) -> bool {
        if self.runtime_search_environment.read().await.generation() != search_generation {
            return false;
        }
        let discovery = self.runtime_discovery.read().await;
        let Some(observation) = discovery.get(&kind) else {
            return true;
        };
        let observation_targets_candidate =
            observation
                .executable_path
                .as_deref()
                .is_some_and(|observed_path| {
                    canonical_runtime_path(Path::new(observed_path))
                        == canonical_runtime_path(executable_path)
                });
        !observation_targets_candidate
            || observation
                .executable_fingerprint
                .as_deref()
                .is_none_or(|current| current == executable_fingerprint)
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

    async fn open_runtime_model_catalog(&self, kind: AdapterKind) -> Result<Value> {
        let initial = {
            let database = self.database.lock().await;
            AgentProfileService::default().managed_installation(&database, kind, "default")?
        };
        let cache_status = initial
            .as_ref()
            .map(|installation| installation.model_catalog.status)
            .unwrap_or(RuntimeModelCatalogCacheStatus::Unavailable);
        let refresh_status = match cache_status {
            RuntimeModelCatalogCacheStatus::Fresh => "not_required",
            RuntimeModelCatalogCacheStatus::Stale => {
                if self
                    .enqueue_runtime_check(
                        kind,
                        RuntimeLaunchPurpose::AvailabilityCheck,
                        RuntimeCheckTrigger::CatalogOpen,
                    )
                    .await?
                {
                    "scheduled"
                } else {
                    "joined"
                }
            }
            RuntimeModelCatalogCacheStatus::Expired
            | RuntimeModelCatalogCacheStatus::Unavailable
            | RuntimeModelCatalogCacheStatus::Invalidated => {
                match self
                    .await_runtime_check(
                        kind,
                        RuntimeLaunchPurpose::AvailabilityCheck,
                        RuntimeCheckTrigger::CatalogOpen,
                    )
                    .await?
                {
                    RuntimeCheckOutcome::Ready => "completed",
                    RuntimeCheckOutcome::StableFailure => "failed",
                    RuntimeCheckOutcome::Superseded => "deferred",
                }
            }
        };
        self.runtime_model_catalog_payload(kind, refresh_status)
            .await
    }

    async fn runtime_model_catalog_payload(
        &self,
        kind: AdapterKind,
        refresh_status: &str,
    ) -> Result<Value> {
        let installation = {
            let database = self.database.lock().await;
            AgentProfileService::default().managed_installation(&database, kind, "default")?
        };
        let diagnostic = self
            .runtime_product_diagnostics
            .read()
            .await
            .get(&kind)
            .cloned();
        let Some(installation) = installation else {
            return Ok(json!({
                "runtimeKind": kind,
                "cache": {
                    "status": "unavailable",
                    "observedAt": null,
                    "revalidateAfter": null,
                    "expiresAt": null,
                },
                "models": [],
                "refreshStatus": refresh_status,
                "diagnosticCode": diagnostic.map(|value| value.diagnostic_code),
            }));
        };
        let models = if installation.model_catalog.is_serviceable() {
            installation
                .snapshot
                .as_ref()
                .map(|snapshot| snapshot.models.clone())
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        Ok(json!({
            "runtimeKind": kind,
            "cache": installation.model_catalog,
            "models": models,
            "refreshStatus": refresh_status,
            "diagnosticCode": installation
                .last_probe_attempt
                .as_ref()
                .filter(|attempt| attempt.status == "failed")
                .and_then(|attempt| attempt.diagnostic_code.clone())
                .or_else(|| diagnostic.map(|value| value.diagnostic_code)),
        }))
    }

    async fn record_runtime_check_manager_failure(
        &self,
        kind: AdapterKind,
        diagnostic_code: &str,
    ) -> Result<()> {
        let mut database = self.database.lock().await;
        let installation =
            AgentProfileService::default().managed_installation(&database, kind, "default")?;
        let Some(installation) = installation else {
            return Ok(());
        };
        let fingerprint = installation
            .snapshot
            .as_ref()
            .and_then(|snapshot| snapshot.executable_fingerprint.clone());
        AgentProfileService::default().record_managed_probe_failure(
            &mut database,
            ManagedProbeFailure {
                adapter_kind: kind,
                auth_scope: "default",
                candidate_path: &installation.executable_path,
                fingerprint: fingerprint.as_deref(),
                source: Some(installation.source),
                failure_class: "transient",
                diagnostic_code,
                failure: None,
            },
        )
    }

    async fn ensure_runtime_check(
        &self,
        _kind: rovai_core::agent_profile::AdapterKind,
    ) -> Result<bool> {
        // `ensure` is retained for wire compatibility with older Renderers. Passive page loads,
        // selection changes and discovery refreshes never authorize a deep Runtime check.
        Ok(false)
    }

    async fn enqueue_runtime_check(
        &self,
        kind: AdapterKind,
        purpose: RuntimeLaunchPurpose,
        trigger: RuntimeCheckTrigger,
    ) -> Result<bool> {
        if current_runtime_platform_blocker(kind).is_some() {
            return Ok(false);
        }
        let (acknowledged, acknowledgement) = oneshot::channel();
        self.runtime_check_requests
            .send(RuntimeCheckRequest {
                runtime_kind: kind,
                purpose,
                trigger,
                acknowledged,
                completion: None,
            })
            .map_err(|_| anyhow::anyhow!("Runtime check manager is unavailable"))?;
        tokio::time::timeout(Duration::from_secs(2), acknowledgement)
            .await
            .context("Runtime check manager did not acknowledge the request")?
            .context("Runtime check manager dropped the acknowledgement")
    }

    async fn await_runtime_check(
        &self,
        kind: AdapterKind,
        purpose: RuntimeLaunchPurpose,
        trigger: RuntimeCheckTrigger,
    ) -> Result<RuntimeCheckOutcome> {
        if let Some(blocker) = current_runtime_platform_blocker(kind) {
            anyhow::bail!("{}: {}", blocker.code, blocker.payload);
        }
        let (acknowledged, acknowledgement) = oneshot::channel();
        let (completed, completion) = oneshot::channel();
        self.runtime_check_requests
            .send(RuntimeCheckRequest {
                runtime_kind: kind,
                purpose,
                trigger,
                acknowledged,
                completion: Some(completed),
            })
            .map_err(|_| anyhow::anyhow!("Runtime check manager is unavailable"))?;
        tokio::time::timeout(Duration::from_secs(2), acknowledgement)
            .await
            .context("Runtime check manager did not acknowledge the request")?
            .context("Runtime check manager dropped the acknowledgement")?;
        tokio::time::timeout(
            RUNTIME_CHECK_TOTAL_DEADLINE + Duration::from_secs(3),
            completion,
        )
        .await
        .context("Runtime check attempt exceeded its manager deadline")?
        .context("Runtime check manager dropped the completion")?
        .map_err(anyhow::Error::msg)
    }

    async fn current_runtime_availability_status(&self, kind: AdapterKind) -> &'static str {
        let discovery_status = self
            .runtime_discovery
            .read()
            .await
            .get(&kind)
            .map(|observation| observation.discovery_status)
            .unwrap_or(RuntimeDiscoveryStatus::Detecting);
        let product_diagnostic = self
            .runtime_product_diagnostics
            .read()
            .await
            .get(&kind)
            .cloned();
        let installation = {
            let database = self.database.lock().await;
            AgentProfileService::default()
                .managed_installation(&database, kind, "default")
                .ok()
                .flatten()
        };
        product_runtime_availability_status(
            discovery_status,
            installation.as_ref(),
            product_diagnostic.as_ref(),
            false,
        )
    }

    async fn runtime_health_payload(&self) -> Result<Value> {
        let host_platform = HostPlatformKey::current();
        let platform_admission = runtime_platform_admission_matrix();
        let qualified_runtime_kinds = current_platform_qualified_runtime_kinds();
        let observations = self.runtime_discovery.read().await.clone();
        let product_diagnostics = self.runtime_product_diagnostics.read().await.clone();
        let checking = self.runtime_check_activity.read().await.clone();
        let installations = {
            let database = self.database.lock().await;
            AgentProfileService::default().list_installations(&database)?
        };
        let availability =
            qualified_runtime_kinds
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
                    let relevant_probe_attempt = installation
                        .and_then(relevant_failed_runtime_probe_attempt);
                    let is_checking = checking.get(&kind).is_some_and(|activity| {
                        activity.runtime_kind == kind && activity.deadline > chrono::Utc::now()
                    });
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
                        "diagnosticCode": relevant_probe_attempt
                            .and_then(|attempt| attempt.diagnostic_code.as_deref())
                            .or_else(|| product_diagnostic.map(|diagnostic| diagnostic.diagnostic_code.as_str()))
                            .or(discovery.diagnostic_code.as_deref()),
                        "failure": relevant_probe_attempt
                            .and_then(|attempt| attempt.failure.as_ref())
                            .or_else(|| product_diagnostic.and_then(|diagnostic| diagnostic.failure.as_ref())),
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
            "hostPlatform": host_platform,
            "runtimeCatalog": catalog_entries(),
            "runtimePlatformAdmission": platform_admission,
            "runtimeAvailability": availability,
            "searchEnvironment": self.runtime_search_environment.read().await.summary(),
        }))
    }

    async fn diagnostics_report(&self) -> DiagnosticsReport {
        let checked_at = chrono::Utc::now().to_rfc3339();
        let git_path = self
            .runtime_search_environment
            .read()
            .await
            .resolve_command_path("git");
        let git_health =
            serde_json::to_value(health::git_health(git_path).await).unwrap_or_else(|_| {
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
            checks.push(
                match self
                    .mcp_config()
                    .and_then(|config| config.inspect(&known_agents))
                {
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
                },
            );

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
            Err(_) => checks.extend(current_platform_qualified_runtime_kinds().into_iter().map(
                |kind| {
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
                },
            )),
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

    async fn run_product_runtime_resolution(
        &self,
        kind: rovai_core::agent_profile::AdapterKind,
        purpose: RuntimeLaunchPurpose,
        deadline: tokio::time::Instant,
    ) -> Result<RuntimeCheckOutcome> {
        let (existing, existing_entrypoint_locator, search) = {
            let database = self.database.lock().await;
            let service = AgentProfileService::default();
            let existing = service.managed_installation(&database, kind, "default")?;
            let existing_entrypoint_locator = existing
                .as_ref()
                .map(|installation| {
                    service.runtime_entrypoint_locator_identity(&database, &installation.id)
                })
                .transpose()?
                .flatten();
            (
                existing,
                existing_entrypoint_locator,
                self.runtime_search_environment.read().await.clone(),
            )
        };
        let existing_canonical_path = existing
            .as_ref()
            .map(|installation| canonical_runtime_path(Path::new(&installation.executable_path)));
        let mut unresolved_diagnostic = None;
        let candidates = if let Some(installation) = existing.as_ref().filter(|installation| {
            matches!(
                installation.source,
                InstallationSource::Manual | InstallationSource::Custom
            )
        }) {
            let explicit_path = existing_entrypoint_locator
                .as_ref()
                .map(|identity| PathBuf::from(&identity.canonical_shim_path))
                .unwrap_or_else(|| PathBuf::from(&installation.executable_path));
            search.candidates(kind, [explicit_path])
        } else {
            search.candidates(kind, std::iter::empty())
        };

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
                    failure: availability_environment_failure(
                        kind,
                        "runtime_executable_unavailable",
                        "Runtime 可执行文件不可用",
                    )
                    .as_ref(),
                },
            )?;
            if existing.is_none() {
                note_product_runtime_diagnostic(
                    &mut unresolved_diagnostic,
                    "path_missing",
                    "runtime_path_missing",
                    availability_environment_failure(
                        kind,
                        "runtime_executable_unavailable",
                        "Runtime 可执行文件不可用",
                    ),
                );
                if let Some(diagnostic) = unresolved_diagnostic {
                    self.runtime_product_diagnostics
                        .write()
                        .await
                        .insert(kind, diagnostic);
                }
            }
            return Ok(RuntimeCheckOutcome::StableFailure);
        }

        'candidate: for candidate in candidates {
            let path = &candidate.path;
            let source = candidate.source;
            if !is_runtime_entrypoint_file(path) {
                note_product_runtime_diagnostic(
                    &mut unresolved_diagnostic,
                    "path_missing",
                    "runtime_path_missing",
                    availability_environment_failure(
                        kind,
                        "runtime_executable_unavailable",
                        "Runtime 可执行文件不可用",
                    ),
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
                            failure: availability_environment_failure(
                                kind,
                                "runtime_executable_unavailable",
                                "Runtime 可执行文件不可用",
                            )
                            .as_ref(),
                        },
                    )?;
                }
                continue;
            }
            let mut canonical = canonical_runtime_path(path);
            let mut candidate_fingerprint = match fingerprint_executable(&canonical) {
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
                            failure: availability_environment_failure(
                                kind,
                                "runtime_executable_unavailable",
                                "无法读取 Runtime 可执行文件",
                            )
                            .as_ref(),
                        },
                    )?;
                    note_product_runtime_diagnostic(
                        &mut unresolved_diagnostic,
                        "transient",
                        "runtime_fingerprint_failed",
                        availability_environment_failure(
                            kind,
                            "runtime_executable_unavailable",
                            "无法读取 Runtime 可执行文件",
                        ),
                    );
                    continue;
                }
            };
            let targets_current_installation = existing_canonical_path.as_ref() == Some(&canonical);
            let executable_identity_changed = existing
                .as_ref()
                .and_then(|installation| installation.snapshot.as_ref())
                .and_then(|snapshot| snapshot.executable_fingerprint.as_deref())
                != Some(candidate_fingerprint.as_str());
            let locator_identity_changed = existing_entrypoint_locator
                .as_ref()
                .map(|identity| identity.compatibility_fingerprint.as_str())
                != candidate
                    .entrypoint_locator_identity
                    .as_ref()
                    .map(|identity| identity.compatibility_fingerprint.as_str());
            let mut identity_changed = targets_current_installation
                && (executable_identity_changed || locator_identity_changed);
            if identity_changed {
                self.commit_rebound_runtime_candidate(
                    kind,
                    &canonical,
                    &candidate_fingerprint,
                    source,
                    &candidate,
                    search.generation(),
                )
                .await?;
                identity_changed = false;
            }
            let mut probe_execution_count = 0;
            let deep_probe = loop {
                probe_execution_count += 1;
                let checked = run_identity_checked_probe(
                    &canonical,
                    with_runtime_search_environment(
                        &search,
                        self.deep_probe_candidate(kind, &canonical, purpose),
                    ),
                )
                .await;
                let checked = match checked {
                    IdentityCheckedProbe::Stable(Ok(deep_probe))
                        if deep_probe
                            .snapshot
                            .executable_fingerprint
                            .as_deref()
                            .is_some_and(|fingerprint| fingerprint != candidate_fingerprint) =>
                    {
                        IdentityCheckedProbe::Superseded
                    }
                    other => other,
                };
                match checked {
                    IdentityCheckedProbe::Stable(Ok(deep_probe)) => break deep_probe,
                    IdentityCheckedProbe::Stable(Err(error)) => {
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
                        let diagnostic_code = if !targets_current_installation {
                            "runtime_alternate_candidate_probe_failed"
                        } else if identity_changed {
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
                                failure: None,
                            },
                        )?;
                        note_product_runtime_diagnostic(
                            &mut unresolved_diagnostic,
                            failure_class,
                            diagnostic_code,
                            None,
                        );
                        continue 'candidate;
                    }
                    IdentityCheckedProbe::Superseded => {
                        eprintln!(
                            "runtime_probe_superseded_by_runtime_update runtime_kind={} path={} probe_execution={probe_execution_count}",
                            kind.as_str(),
                            canonical.display(),
                        );
                        if probe_execution_count >= RUNTIME_PROBE_MAX_EXECUTIONS {
                            return Ok(RuntimeCheckOutcome::Superseded);
                        }
                        let now = tokio::time::Instant::now();
                        let Some(retry_at) = runtime_probe_update_retry_at(now, deadline) else {
                            return Ok(RuntimeCheckOutcome::Superseded);
                        };
                        tokio::time::sleep_until(retry_at).await;
                        if tokio::time::Instant::now() >= deadline {
                            return Ok(RuntimeCheckOutcome::Superseded);
                        }
                        if self.runtime_search_environment.read().await.generation()
                            != search.generation()
                        {
                            return Ok(RuntimeCheckOutcome::Superseded);
                        }
                        if !is_runtime_entrypoint_file(path) {
                            let rebound_path = canonical_runtime_path(path);
                            let mut database = self.database.lock().await;
                            AgentProfileService::default().record_managed_probe_failure(
                                &mut database,
                                ManagedProbeFailure {
                                    adapter_kind: kind,
                                    auth_scope: "default",
                                    candidate_path: &rebound_path.to_string_lossy(),
                                    fingerprint: None,
                                    source: Some(source),
                                    failure_class: "path_missing",
                                    diagnostic_code: "runtime_path_missing",
                                    failure: availability_environment_failure(
                                        kind,
                                        "runtime_executable_unavailable",
                                        "Runtime 可执行文件不可用",
                                    )
                                    .as_ref(),
                                },
                            )?;
                            note_product_runtime_diagnostic(
                                &mut unresolved_diagnostic,
                                "path_missing",
                                "runtime_path_missing",
                                availability_environment_failure(
                                    kind,
                                    "runtime_executable_unavailable",
                                    "Runtime 可执行文件不可用",
                                ),
                            );
                            continue 'candidate;
                        }
                        canonical = canonical_runtime_path(path);
                        candidate_fingerprint = match fingerprint_executable(&canonical) {
                            Ok(fingerprint) => fingerprint,
                            Err(error) => {
                                eprintln!(
                                    "Runtime rebound fingerprint failed for {} at {}: {error:#}",
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
                                        failure: availability_environment_failure(
                                            kind,
                                            "runtime_executable_unavailable",
                                            "无法读取 Runtime 可执行文件",
                                        )
                                        .as_ref(),
                                    },
                                )?;
                                note_product_runtime_diagnostic(
                                    &mut unresolved_diagnostic,
                                    "transient",
                                    "runtime_fingerprint_failed",
                                    availability_environment_failure(
                                        kind,
                                        "runtime_executable_unavailable",
                                        "无法读取 Runtime 可执行文件",
                                    ),
                                );
                                continue 'candidate;
                            }
                        };
                        identity_changed = targets_current_installation
                            && existing
                                .as_ref()
                                .and_then(|installation| installation.snapshot.as_ref())
                                .and_then(|snapshot| snapshot.executable_fingerprint.as_deref())
                                != Some(candidate_fingerprint.as_str());
                        if targets_current_installation {
                            self.commit_rebound_runtime_candidate(
                                kind,
                                &canonical,
                                &candidate_fingerprint,
                                source,
                                &candidate,
                                search.generation(),
                            )
                            .await?;
                            identity_changed = false;
                        }
                    }
                }
            };
            let RuntimeDeepProbeResult {
                mut snapshot,
                failure,
            } = deep_probe;
            if !candidate.entrypoint_locator_identity_is_current() {
                return Ok(RuntimeCheckOutcome::Superseded);
            }
            apply_entrypoint_locator_compatibility(
                &mut snapshot,
                candidate.entrypoint_locator_identity.as_ref(),
            );
            if !self
                .runtime_probe_identity_is_current(
                    kind,
                    search.generation(),
                    &canonical,
                    &candidate_fingerprint,
                )
                .await
            {
                return Ok(RuntimeCheckOutcome::Superseded);
            }
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
                        entrypoint_locator_identity: candidate.entrypoint_locator_identity.clone(),
                    },
                )?;
                drop(database);
                self.publish_verified_runtime_discovery(RuntimeDiscoveryObservation {
                    runtime_kind: kind,
                    discovery_status: RuntimeDiscoveryStatus::Found,
                    executable_path: Some(executable_path),
                    source: Some(source),
                    reported_version: snapshot.reported_version,
                    executable_fingerprint: snapshot.executable_fingerprint,
                    search_path_source: candidate.search_path_source,
                    entrypoint_kind: Some(candidate.entrypoint_kind),
                    candidate_extension: Some(candidate.candidate_extension),
                    resolved_native_target: candidate.resolved_native_target,
                    version_probe_succeeded: Some(true),
                    search_generation: search.generation(),
                    observed_at: chrono::Utc::now().to_rfc3339(),
                    diagnostic_code: None,
                    entrypoint_locator_identity: candidate.entrypoint_locator_identity.clone(),
                })
                .await;
                self.runtime_product_diagnostics.write().await.remove(&kind);
                return Ok(RuntimeCheckOutcome::Ready);
            }
            let (failure_class, diagnostic_code) = match snapshot.probe_status.as_str() {
                _ if !targets_current_installation => {
                    ("transient", "runtime_alternate_candidate_probe_failed")
                }
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
                    failure: failure.as_ref(),
                },
            )?;
            note_product_runtime_diagnostic(
                &mut unresolved_diagnostic,
                failure_class,
                diagnostic_code,
                failure,
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
        Ok(RuntimeCheckOutcome::StableFailure)
    }

    async fn recover_pending_execution_intents(&self) {
        if self.planned_shutdown.shutdown_started() {
            return;
        }
        if ["skills", "mcp", "attachments", "builtin-tools"]
            .iter()
            .any(|id| self.subsystems.require(id).is_err())
        {
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
        if let Some(runtime) = self
            .qwen_code
            .get_agent_run(agent_run_id, execution_epoch)
            .await
        {
            return Some(AgentRunRuntime::Acp(runtime));
        }
        if let Some(runtime) = self
            .trae_cn_cli
            .get_agent_run(agent_run_id, execution_epoch)
            .await
        {
            return Some(AgentRunRuntime::Acp(runtime));
        }
        if let Some(runtime) = self
            .cursor_agent
            .get_agent_run(agent_run_id, execution_epoch)
            .await
        {
            return Some(AgentRunRuntime::Acp(runtime));
        }
        if let Some(runtime) = self
            .kimi_code_cli
            .get_agent_run(agent_run_id, execution_epoch)
            .await
        {
            return Some(AgentRunRuntime::Acp(runtime));
        }
        self.grok_build
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

    async fn abort_agent_run_tasks_until(&self, deadline: tokio::time::Instant) -> bool {
        if !self.abort_agent_run_tasks_now_until(deadline).await {
            return false;
        }
        self.drain_agent_run_tasks_until(deadline).await
    }

    async fn abort_agent_run_tasks_now_until(&self, deadline: tokio::time::Instant) -> bool {
        let Ok(mut tasks) = tokio::time::timeout_at(deadline, self.agent_run_tasks.lock()).await
        else {
            return false;
        };
        tasks.abort_all();
        true
    }

    async fn drain_agent_run_tasks_until(&self, deadline: tokio::time::Instant) -> bool {
        let Ok(mut tasks) = tokio::time::timeout_at(deadline, self.agent_run_tasks.lock()).await
        else {
            return false;
        };
        tokio::time::timeout_at(deadline, async {
            while tasks.join_next().await.is_some() {}
        })
        .await
        .is_ok()
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
            self.trae_cn_cli.shutdown_all(),
            self.cursor_agent.shutdown_all(),
            self.kimi_code_cli.shutdown_all(),
            self.grok_build.shutdown_all(),
            self.claude_code_cli.shutdown_all(),
            self.antigravity_app.shutdown_all(),
        );
        self.runtime_fleet.shutdown_all().await;
    }

    async fn shutdown_all_runtimes_until(&self, deadline: tokio::time::Instant) -> bool {
        let adapters_quiesced = tokio::time::timeout_at(deadline, async {
            tokio::join!(
                self.codex_cli.shutdown_all(),
                self.opencode_cli.shutdown_all(),
                self.copilot_cli.shutdown_all(),
                self.kiro_cli.shutdown_all(),
                self.qoder_cli.shutdown_all(),
                self.codebuddy_cli.shutdown_all(),
                self.qwen_code.shutdown_all(),
                self.trae_cn_cli.shutdown_all(),
                self.cursor_agent.shutdown_all(),
                self.kimi_code_cli.shutdown_all(),
                self.grok_build.shutdown_all(),
                self.claude_code_cli.shutdown_all(),
                self.antigravity_app.shutdown_all(),
            );
        })
        .await
        .is_ok();
        let fleet = self.runtime_fleet.shutdown_all_until(deadline).await;
        adapters_quiesced && fleet.all_reaped() && !fleet.deadline_expired
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
            rovai_core::agent_profile::AdapterKind::TraeCnCli => Some(&self.trae_cn_cli),
            rovai_core::agent_profile::AdapterKind::CursorAgent => Some(&self.cursor_agent),
            rovai_core::agent_profile::AdapterKind::KimiCodeCli => Some(&self.kimi_code_cli),
            rovai_core::agent_profile::AdapterKind::GrokBuild => Some(&self.grok_build),
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
        let invocation_guard = self.builtin_tool_leases.invocation_guard().await;
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
                let mut frozen_files = Vec::<AuthorityAttachment>::new();
                let mut managed_attachment_ingest_intent_id = None::<String>;
                if operation == CAMP_MESSAGE_SEND_TOOL_NAME {
                    let send_input =
                        match serde_json::from_value::<CampMessageSendInput>(input.clone()) {
                            Ok(input) => input,
                            Err(_) => {
                                return builtin_tool_rejection(
                                    &operation,
                                    &request_id,
                                    "builtin_tool.invalid_input",
                                    "Command input does not match the accepted arguments.",
                                );
                            }
                        };
                    let scoped_tool_call_id = scoped_runtime_tool_call_id(
                        &authorized.agent_run_id,
                        &format!("builtin-cli:{request_id}"),
                    );
                    let domain_command_id = match TeamToolService::default().binding_command_id(
                        &authorized.native_binding.native_binding_id,
                        &authorized.native_binding.binding_credential,
                        &scoped_tool_call_id,
                    ) {
                        Ok(command_id) => command_id,
                        Err(error) => {
                            return BuiltinToolIpcResponse::ipc_error(
                                "builtin_tool.internal_error",
                                format!("Could not derive attachment ingest identity: {error:#}"),
                            );
                        }
                    };
                    let domain_recorded = {
                        let database = self.database.lock().await;
                        TeamToolService::default()
                            .recorded_binding_command_exists(&database, &domain_command_id)
                            .unwrap_or(false)
                    };
                    if !send_input.files.is_empty() && !domain_recorded {
                        let scope = {
                            let database = self.database.lock().await;
                            TeamToolService::default().agent_file_ingress_scope(
                                &database,
                                &authorized.agent_run_id,
                                authorized.execution_epoch,
                            )
                        };
                        let (camp_id, workspace) = match scope {
                            Ok(Some(scope)) => scope,
                            _ => {
                                return BuiltinToolIpcResponse::ipc_error(
                                    "builtin_tool.run_not_bound",
                                    "Built-in Tool CLI is not bound to the current AgentRun",
                                );
                            }
                        };
                        let (managed_store, ingest_plan) = {
                            let mut database = self.database.lock().await;
                            let managed_store = ManagedAttachmentStore::for_database(&database);
                            let plan = match managed_store.begin_agent_ingest(
                                &mut database,
                                &camp_id,
                                &domain_command_id,
                                send_input.files.len(),
                            ) {
                                Ok(Some(plan)) => plan,
                                Ok(None) => {
                                    return BuiltinToolIpcResponse::ipc_error(
                                        "builtin_tool.internal_error",
                                        "Managed Attachment ingest unexpectedly had no files",
                                    );
                                }
                                Err(error) => {
                                    return builtin_tool_rejection(
                                        &operation,
                                        &request_id,
                                        "builtin_tool.invalid_input",
                                        &format!("Attachment ingest was rejected: {error:#}"),
                                    );
                                }
                            };
                            (managed_store, plan)
                        };
                        let run_tmp = authorized.run_tmp.clone();
                        let files = send_input.files.clone();
                        let materializer = managed_store.clone();
                        let materialization_plan = ingest_plan.clone();
                        drop(invocation_guard);
                        let prepared = match tokio::task::spawn_blocking(move || {
                            materializer.materialize_agent(
                                &materialization_plan,
                                &files,
                                workspace.path(),
                                &run_tmp,
                            )
                        })
                        .await
                        {
                            Ok(Ok(prepared)) => prepared,
                            Ok(Err(error)) => {
                                let mut database = self.database.lock().await;
                                let _ = managed_store.abandon(
                                    &mut database,
                                    ingest_plan.intent_id(),
                                    "copy_failed",
                                );
                                return builtin_tool_rejection(
                                    &operation,
                                    &request_id,
                                    "builtin_tool.invalid_input",
                                    &format!("Attachment source was rejected: {error:#}"),
                                );
                            }
                            Err(error) => {
                                let mut database = self.database.lock().await;
                                let _ = managed_store.abandon(
                                    &mut database,
                                    ingest_plan.intent_id(),
                                    "copy_failed",
                                );
                                return BuiltinToolIpcResponse::ipc_error(
                                    "builtin_tool.internal_error",
                                    format!("Attachment ingest task failed: {error}"),
                                );
                            }
                        };
                        if let Err(error) = {
                            let mut database = self.database.lock().await;
                            managed_store.record_promoted(&mut database, &prepared)
                        } {
                            let mut database = self.database.lock().await;
                            let _ = managed_store.abandon(
                                &mut database,
                                prepared.intent_id(),
                                "promote_failed",
                            );
                            return BuiltinToolIpcResponse::ipc_error(
                                "builtin_tool.internal_error",
                                format!("Attachment promote receipt could not be saved: {error:#}"),
                            );
                        }
                        frozen_files = prepared.attachments();
                        managed_attachment_ingest_intent_id =
                            Some(prepared.intent_id().to_string());
                        let reauthorized = self.builtin_tool_leases.authenticate(&auth).await;
                        if !matches!(
                            reauthorized,
                            Ok(ref current)
                                if current.agent_run_id == authorized.agent_run_id
                                    && current.execution_epoch == authorized.execution_epoch
                                    && current.native_binding.native_binding_id
                                        == authorized.native_binding.native_binding_id
                                    && current.run_tmp == authorized.run_tmp
                        ) {
                            let mut database = self.database.lock().await;
                            let _ = managed_store.abandon(
                                &mut database,
                                prepared.intent_id(),
                                "source_invalid",
                            );
                            return BuiltinToolIpcResponse::ipc_error(
                                "builtin_tool.run_not_bound",
                                "Built-in Tool CLI is not bound to the current AgentRun",
                            );
                        }
                    } else {
                        drop(invocation_guard);
                    }
                } else {
                    drop(invocation_guard);
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
                        frozen_files.clone(),
                        managed_attachment_ingest_intent_id.clone(),
                    )
                    .await;
                if let Some(intent_id) = managed_attachment_ingest_intent_id.as_deref() {
                    let mut database = self.database.lock().await;
                    let managed_store = ManagedAttachmentStore::for_database(&database);
                    let adopted = managed_store
                        .intent_is_committed(&database, intent_id)
                        .unwrap_or(false);
                    if !adopted {
                        let _ = managed_store.abandon(
                            &mut database,
                            intent_id,
                            "message_commit_failed",
                        );
                    }
                }
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
        frozen_files: Vec<AuthorityAttachment>,
        managed_attachment_ingest_intent_id: Option<String>,
    ) -> TeamToolIpcResponse {
        let evidence_tool_name = request.tool_name.clone();
        let evidence_input = request.input.clone();
        let evidence_input_digest = canonical_json_digest(&request.input).ok();
        let mut evidence_tool_call_digest = None;
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
            evidence_tool_call_digest = canonical_json_digest(&json!({
                "runtimeToolCallId": request.runtime_tool_call_id,
                "tool": request.tool_name,
            }))
            .ok();
            let input_digest = evidence_input_digest
                .as_deref()
                .context("Built-in Tool input digest is unavailable")?;
            let tool_call_id = evidence_tool_call_digest
                .as_deref()
                .context("Built-in Tool Call identity is unavailable")?;
            let operation_projection = project_builtin_tool_invocation(
                &evidence_tool_name,
                &evidence_input,
                None,
                input_digest,
                None,
            )?;
            let started_evidence = json!({
                "toolCallId": tool_call_id,
                "status": "started",
                "kind": "builtin_tool_invocation",
                "title": evidence_tool_name,
                "sourceAuthority": "core",
                "canonicalTool": evidence_tool_name,
                "authorizationDecision": "allowed",
                "rawInputDigest": input_digest,
                "rawOutputDigest": null,
                "errorCode": null,
                "idempotentReplay": false,
                "receiptId": null,
                "operationProjection": operation_projection,
            });
            ExecutionEvidenceService
                .record_builtin_tool_started(
                    &mut database,
                    &ManagedBlobStore::new(&self.data_dir),
                    &authenticated_run.agent_run_id,
                    authenticated_run.execution_epoch,
                    &started_evidence,
                )?
                .context("Built-in Tool start evidence was not durably admitted")?;
            let operation_result = match request.tool_name.as_str() {
                CAMP_MESSAGE_SEND_TOOL_NAME => {
                    let input = serde_json::from_value::<CampMessageSendInput>(request.input)
                        .context("camp.message.send input is invalid")?;
                    let invocation = CampMessageSendInvocation {
                        native_binding_id: request.native_binding_id,
                        binding_credential: request.binding_credential,
                        runtime_tool_call_id: request.runtime_tool_call_id,
                        input,
                        frozen_files,
                        managed_attachment_ingest_intent_id,
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
                rovai_core::gather::GATHER_TOOL_NAME => {
                    let input = serde_json::from_value::<GatherInput>(request.input)
                        .context("team.gather input is invalid")?;
                    let invocation = GatherInvocation {
                        native_binding_id: request.native_binding_id,
                        binding_credential: request.binding_credential,
                        runtime_tool_call_id: request.runtime_tool_call_id,
                        input,
                    };
                    let execution =
                        if let Some((agent_run_id, execution_epoch)) = attested_run.as_ref() {
                            service.gather_attested(
                                &mut database,
                                &invocation,
                                agent_run_id,
                                *execution_epoch,
                            )
                        } else {
                            service.gather(&mut database, &invocation)
                        }?;
                    evidence_replayed = execution.replayed;
                    evidence_receipt_id = execution.result.payload["gatherId"]
                        .as_str()
                        .map(str::to_string);
                    command_execution_payload(execution)
                }
                MEMBER_CREATE_TOOL_NAME => {
                    let input = serde_json::from_value::<MemberCreateInput>(request.input)
                        .context("member.create input is invalid")?;
                    let outcome =
                        create_member(&mut database, &self.data_dir, &authenticated_run, input)?;
                    evidence_replayed = outcome.execution.replayed;
                    evidence_receipt_id = outcome.execution.result.payload["agentId"]
                        .as_str()
                        .map(str::to_string);
                    let avatar_ref = outcome.avatar_ref;
                    let mut payload = command_execution_payload(outcome.execution)?;
                    let object = payload
                        .as_object_mut()
                        .context("member.create result is not an object")?;
                    object.insert(
                        "avatarStatus".to_string(),
                        Value::String(if avatar_ref.is_some() {
                            "saved".to_string()
                        } else {
                            "not_requested".to_string()
                        }),
                    );
                    object.insert(
                        "avatarRef".to_string(),
                        avatar_ref.map(Value::String).unwrap_or(Value::Null),
                    );
                    Ok(payload)
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
                MEMORY_VIEW_TOOL_NAME => {
                    let input = serde_json::from_value::<MemoryViewInput>(request.input)
                        .context("private memory.view input is invalid")?;
                    let invocation = MemoryRetrievalInvocation {
                        native_binding_id: request.native_binding_id,
                        binding_credential: request.binding_credential,
                        runtime_tool_call_id: request.runtime_tool_call_id,
                        input,
                    };
                    let output =
                        if let Some((agent_run_id, execution_epoch)) = attested_run.as_ref() {
                            MemoryRetrievalService.view_attested(
                                &mut database,
                                &invocation,
                                agent_run_id,
                                *execution_epoch,
                            )
                        } else {
                            MemoryRetrievalService.view(&mut database, &invocation)
                        }?;
                    serde_json::to_value(output).map_err(Into::into)
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
                    CampHistoryService.search_camp(&mut database, &authenticated_run, &input)
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
            let operation_projection = evidence_input_digest.as_deref().and_then(|input_digest| {
                match project_builtin_tool_invocation(
                    &evidence_tool_name,
                    &evidence_input,
                    result.as_ref().ok(),
                    input_digest,
                    raw_output_digest.as_deref(),
                ) {
                    Ok(projection) => Some(projection),
                    Err(error) => {
                        eprintln!(
                            "failed to project Built-in Tool measurement evidence: {error:#}"
                        );
                        None
                    }
                }
            });
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
                "operationProjection": operation_projection,
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
            match evidence_result {
                Ok(Some(_)) | Ok(None) => {}
                Err(error) => {
                    eprintln!("failed to record Built-in Tool result evidence: {error:#}");
                }
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
        if request.method.starts_with("skills.") {
            self.subsystems.require("skills")?;
        }
        if request.method.starts_with("mcp.") && request.method != "mcp.config.repairPermissions" {
            self.subsystems.require("mcp")?;
        }
        if request.method.starts_with("camp.attachments.") {
            self.subsystems.require("attachments")?;
        }
        let _ = &request.params;
        match request.method.as_str() {
            "runtime.subsystems.get" => Ok(serde_json::to_value(self.subsystems.snapshot())?),
            "runtime.subsystems.retry" => {
                self.initialize_optional_subsystems().await;
                Ok(serde_json::to_value(self.subsystems.snapshot())?)
            }
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
                if let Some(blocker) = current_runtime_platform_blocker(params.command.adapter_kind)
                {
                    return Ok(serde_json::to_value(blocker)?);
                }
                let agent_id = params.command.agent_id.clone();
                let execution = {
                    let mut database = self.database.lock().await;
                    let execution = AgentProfileService::default().set_runtime(
                        &mut database,
                        &user_command_envelope(params.command_id, params.command),
                    )?;
                    if execution.result.status == CommandResultStatus::Applied {
                        self.mark_skill_projections_dirty_best_effort(&mut database, true);
                    }
                    execution
                };
                if execution.result.status == CommandResultStatus::Applied {
                    self.runtime_fleet
                        .invalidate_runtime_config(&agent_id)
                        .await;
                }
                if execution.result.status == CommandResultStatus::Applied {
                    self.pump_runtime_ready_recipient(&agent_id).await?;
                }
                Ok(serde_json::to_value(execution.result)?)
            }
            "members.runtime.clear" => {
                let params: UserCommandParams<ClearMemberRuntimeConfigurationCommand> =
                    serde_json::from_value(request.params.clone())?;
                let agent_id = params.command.agent_id.clone();
                let configured_runtime_kind = {
                    let database = self.database.lock().await;
                    AgentProfileService::default()
                        .get_profile(&database, &agent_id)?
                        .and_then(|profile| {
                            profile
                                .runtime_configuration
                                .map(|configuration| configuration.adapter_kind)
                        })
                };
                if let Some(blocker) =
                    configured_runtime_kind.and_then(current_runtime_platform_blocker)
                {
                    return Ok(serde_json::to_value(blocker)?);
                }
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
            "memory.hearthReviewItems.list" => {
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    MemoryService::default().list_hearth_review_items(&database)?,
                )?)
            }
            "memory.hearthReviewItems.accept" => {
                let params: UserCommandParams<AcceptHearthReviewItemCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = MemoryService::default().accept_hearth_review_item(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "memory.hearthReviewItems.reject" => {
                let params: UserCommandParams<RejectHearthReviewItemCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = MemoryService::default().reject_hearth_review_item(
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
                if let Some(blocker) = current_runtime_platform_blocker(params.command.adapter_kind)
                {
                    return Ok(serde_json::to_value(blocker)?);
                }
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
                if let Some(blocker) = adapter_kind.and_then(current_runtime_platform_blocker) {
                    return Ok(serde_json::to_value(blocker)?);
                }
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
                Ok(serde_json::to_value(
                    self.mcp_config()?.get(&known_agents)?,
                )?)
            }
            "mcp.config.repairPermissions" => {
                let database = self.database.lock().await;
                let known_agents = Self::known_agent_ids(&database)?;
                self.mcp_config()?.repair_permissions()?;
                Ok(serde_json::to_value(
                    self.mcp_config()?.get(&known_agents)?,
                )?)
            }
            "mcp.servers.create" => {
                let params: CreateMcpServerParams = serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                let known_agents = Self::known_agent_ids(&database)?;
                Ok(serde_json::to_value(
                    self.mcp_config()?.create(params, &known_agents)?,
                )?)
            }
            "mcp.servers.update" => {
                let params: UpdateMcpServerParams = serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                let known_agents = Self::known_agent_ids(&database)?;
                Ok(serde_json::to_value(
                    self.mcp_config()?.update(params, &known_agents)?,
                )?)
            }
            "mcp.servers.setEnabled" => {
                let params: SetMcpServerEnabledParams =
                    serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                let known_agents = Self::known_agent_ids(&database)?;
                Ok(serde_json::to_value(
                    self.mcp_config()?.set_enabled(params, &known_agents)?,
                )?)
            }
            "mcp.assignments.set" => {
                let params: SetMcpAssignmentParams =
                    serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                let known_agents = Self::known_agent_ids(&database)?;
                Ok(serde_json::to_value(
                    self.mcp_config()?.set_assignment(params, &known_agents)?,
                )?)
            }
            "mcp.servers.delete" => {
                let params: DeleteMcpServerParams = serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                let known_agents = Self::known_agent_ids(&database)?;
                Ok(serde_json::to_value(
                    self.mcp_config()?.delete(params, &known_agents)?,
                )?)
            }
            "mcp.import.scan" => {
                let database = self.database.lock().await;
                let known_agents = Self::known_agent_ids(&database)?;
                Ok(serde_json::to_value(
                    McpImportScanner.scan(self.mcp_config()?, &known_agents)?,
                )?)
            }
            "mcp.import.commit" => {
                let params: CommitMcpImportParams = serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                let known_agents = Self::known_agent_ids(&database)?;
                Ok(serde_json::to_value(
                    self.mcp_config()?.commit_import(params, &known_agents)?,
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
                    .or_else(|| {
                        present_members.iter().find(|member| {
                            matches!(
                                member.runtime_readiness,
                                RuntimeReadinessStatus::LightReady
                                    | RuntimeReadinessStatus::InstalledUnverified
                            )
                        })
                    })
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
                        params.camp_id.as_str(),
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
                if execution.result.status == CommandResultStatus::Applied
                    && let Some(camp_id) = execution.result.payload["campId"].as_str()
                {
                    emit_navigation_invalidated(&self.output, "camps.create", Some(camp_id));
                    self.attachment_views
                        .ensure_empty_camp_ready(&mut database, camp_id)?;
                }
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
            "camps.members.add" => {
                let params: UserCommandParams<AddCampMemberCommand> =
                    serde_json::from_value(request.params.clone())?;
                let camp_id = params.command.camp_id.clone();
                let mut database = self.database.lock().await;
                let execution = CollaborationService::default().add_camp_member(
                    &mut database,
                    &user_camp_command_envelope(params.command_id, camp_id, params.command),
                )?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "camps.members.removalPreview" => {
                let params: CampMemberRemovalPreviewParams =
                    serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    CollaborationService::default().camp_member_removal_preview(
                        &database,
                        params.camp_id.as_str(),
                        &params.agent_id,
                    )?,
                )?)
            }
            "camps.members.remove" => {
                let params: UserCommandParams<RemoveCampMemberCommand> =
                    serde_json::from_value(request.params.clone())?;
                let camp_id = params.command.camp_id.clone();
                let mut database = self.database.lock().await;
                let execution = CollaborationService::default().remove_camp_member(
                    &mut database,
                    &user_camp_command_envelope(params.command_id, camp_id, params.command),
                )?;
                let should_dispatch_cancellation = execution.result.status
                    != CommandResultStatus::Rejected
                    && execution.result.payload["cancelRequestedRunCount"]
                        .as_u64()
                        .is_some_and(|count| count > 0);
                drop(database);
                if should_dispatch_cancellation {
                    self.agent_run_cancellation_notify.notify_one();
                }
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
            "camps.exists" => {
                let params: CampIdParams = serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    ReadModelService.camp_exists(&database, params.camp_id.as_str())?,
                )?)
            }
            "camps.enter" => {
                let params: CampEnterParams = serde_json::from_value(request.params.clone())?;
                let trace_id = normalized_camp_open_trace_id(&params.trace_id)?;
                let camp_id = params.command.camp_id.clone();
                let lock_started_at = std::time::Instant::now();
                let mut database = self.database.lock().await;
                let lock_ms = lock_started_at.elapsed().as_millis();
                let outcome = CampOpenService.enter(
                    &mut database,
                    &user_camp_command_envelope(params.command_id, camp_id, params.command),
                )?;
                let projection = outcome.projection;
                let reconcile_ms = outcome
                    .reconcile_duration
                    .map(|duration| duration.as_millis())
                    .unwrap_or(0);
                let projection_ms = outcome.projection_duration.as_millis();
                let serialization_started_at = std::time::Instant::now();
                let value = serde_json::to_value(&projection)?;
                let payload_bytes = serde_json::to_vec(&value)?.len();
                let serialization_ms = serialization_started_at.elapsed().as_millis();
                log_camp_open_projection(
                    &trace_id,
                    "camps.enter",
                    &CampOpenLogMetrics {
                        lock_ms,
                        reconcile_ms,
                        projection_ms,
                        serialization_ms,
                        payload_bytes,
                    },
                    &projection,
                );
                Ok(value)
            }
            "camps.open" => {
                let params: CampOpenParams = serde_json::from_value(request.params.clone())?;
                let trace_id = normalized_camp_open_trace_id(&params.trace_id)?;
                let lock_started_at = std::time::Instant::now();
                let mut database = self.database.lock().await;
                let lock_ms = lock_started_at.elapsed().as_millis();
                let outcome = CampOpenService.open(&mut database, params.camp_id.as_str())?;
                let projection = outcome.projection;
                let projection_ms = outcome.projection_duration.as_millis();
                let serialization_started_at = std::time::Instant::now();
                let value = serde_json::to_value(&projection)?;
                let payload_bytes = serde_json::to_vec(&value)?.len();
                let serialization_ms = serialization_started_at.elapsed().as_millis();
                log_camp_open_projection(
                    &trace_id,
                    "camps.open",
                    &CampOpenLogMetrics {
                        lock_ms,
                        reconcile_ms: 0,
                        projection_ms,
                        serialization_ms,
                        payload_bytes,
                    },
                    &projection,
                );
                Ok(value)
            }
            "camps.delete" => {
                let params: UserCommandParams<DeleteCampCommand> =
                    serde_json::from_value(request.params.clone())?;
                let camp_id = params.command.camp_id.clone();
                let command_id = params.command_id.clone();
                let force = params.command.force;
                let runtime_cleanup_targets = if force {
                    let database = self.database.lock().await;
                    ExecutionRuntimeService::default()
                        .list_camp_runtime_cleanup_targets(&database, &camp_id)?
                } else {
                    Vec::new()
                };
                if force {
                    self.stop_deleted_camp_runtimes(&runtime_cleanup_targets)
                        .await;
                    self.runtime_fleet
                        .force_fence_camp_for_deletion(&camp_id)
                        .await?;
                }
                let (_view_mutation, _) = self.acquire_camp_attachment_mutation(&camp_id).await?;
                let mut database = self.database.lock().await;
                let cleanup = self.attachment_views.prepare_camp_delete_cleanup(
                    &mut database,
                    &camp_id,
                    &command_id,
                )?;
                drop(database);
                if !force
                    && let Err(error) = self
                        .runtime_fleet
                        .fence_camp_for_attachment_mutation(&camp_id)
                        .await
                {
                    if let Some(cleanup) = cleanup.as_ref() {
                        let mut database = self.database.lock().await;
                        self.attachment_views
                            .cancel_camp_delete_cleanup(&mut database, cleanup)?;
                    }
                    return Err(error);
                }
                let mut database = self.database.lock().await;
                let execution = CollaborationService::default().delete_camp(
                    &mut database,
                    &user_camp_command_envelope(params.command_id, camp_id, params.command),
                )?;
                if execution.result.status == CommandResultStatus::Applied {
                    self.mark_skill_projections_dirty_best_effort(&mut database, true);
                } else if let Some(cleanup) = cleanup.as_ref() {
                    self.attachment_views
                        .cancel_camp_delete_cleanup(&mut database, cleanup)?;
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
                    if let Err(error) = self.finish_camp_attachment_cleanup(cleanup.as_ref()).await
                    {
                        eprintln!(
                            "Camp {camp_id} was deleted but Runtime Attachment View cleanup failed: {error:#}"
                        );
                    }
                    if let Err(error) =
                        CampAttachmentStore::new(&self.data_dir).remove_camp(&camp_id)
                    {
                        eprintln!(
                            "Camp {camp_id} was deleted but managed attachment cleanup failed: {error:#}"
                        );
                    }
                }
                Ok(serde_json::to_value(execution.result)?)
            }
            "camps.discardPending" => {
                let params: UserCommandParams<DiscardPendingCampCommand> =
                    serde_json::from_value(request.params.clone())?;
                let camp_id = params.command.camp_id.clone();
                let command_id = params.command_id.clone();
                let (_view_mutation, _) = self.acquire_camp_attachment_mutation(&camp_id).await?;
                let mut database = self.database.lock().await;
                let cleanup = self.attachment_views.prepare_camp_delete_cleanup(
                    &mut database,
                    &camp_id,
                    &command_id,
                )?;
                drop(database);
                if let Err(error) = self
                    .runtime_fleet
                    .fence_camp_for_attachment_mutation(&camp_id)
                    .await
                {
                    if let Some(cleanup) = cleanup.as_ref() {
                        let mut database = self.database.lock().await;
                        self.attachment_views
                            .cancel_camp_delete_cleanup(&mut database, cleanup)?;
                    }
                    return Err(error);
                }
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
                if !discarded && let Some(cleanup) = cleanup.as_ref() {
                    self.attachment_views
                        .cancel_camp_delete_cleanup(&mut database, cleanup)?;
                }
                drop(database);
                if discarded {
                    emit_navigation_invalidated(
                        &self.output,
                        "camps.discardPending",
                        discarded_camp_id.as_deref(),
                    );
                }
                if discarded && let Some(camp_id) = discarded_camp_id {
                    self.finish_camp_attachment_cleanup(cleanup.as_ref())
                        .await?;
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
            "agentRuns.cancel" => {
                let params: UserCommandParams<CancelAgentRunCommand> =
                    serde_json::from_value(request.params.clone())?;
                let camp_id = params.command.camp_id.clone();
                let mut database = self.database.lock().await;
                let execution = ExecutionRuntimeService::default().request_agent_run_cancellation(
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
                    ReadModelService.camp_snapshot(&mut database, params.camp_id.as_str())?,
                )?)
            }
            "agentRunFileChanges.get" => {
                let params: AgentRunFileChangesParams =
                    serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    agent_run_file_change::read_run_file_changes(
                        &database,
                        &ManagedBlobStore::new(&self.data_dir),
                        params.camp_id.as_str(),
                        &params.agent_run_id,
                        params.execution_epoch,
                    )?,
                )?)
            }
            "camp.messages.page" => {
                let params: CampMessagePageParams = serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                Ok(serde_json::to_value(ReadModelService.camp_messages_page(
                    &mut database,
                    params.camp_id.as_str(),
                    params.before_sequence,
                    params.through_global_sequence,
                    params.limit,
                )?)?)
            }
            "camp.messages.around" => {
                let params: CampMessageAroundParams =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                Ok(serde_json::to_value(
                    ReadModelService.camp_messages_around(
                        &mut database,
                        params.camp_id.as_str(),
                        &params.message_id,
                    )?,
                )?)
            }
            "camp.messages.find" => {
                let params: CampMessageFindParams = serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                Ok(serde_json::to_value(ReadModelService.camp_messages_find(
                    &mut database,
                    params.camp_id.as_str(),
                    &params.query,
                    params.selected_match_index,
                    params.anchor_message_id.as_deref(),
                )?)?)
            }
            "agentRunEvidence.getContent" => {
                let params: ExecutionEvidenceContentParams =
                    serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                let payload = ExecutionEvidenceService.read_full_payload(
                    &database,
                    &ManagedBlobStore::new(&self.data_dir),
                    params.camp_id.as_str(),
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
                        params.camp_id.as_str(),
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
                        params.camp_id.to_string(),
                        CreateTaskCommand {
                            camp_id: params.camp_id.to_string(),
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
                        params.camp_id.to_string(),
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
                        params.camp_id.as_str(),
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
                        params.camp_id.as_str(),
                        &params.task_id,
                        &ActorRef::User {
                            user_id: CURRENT_USER_ID.to_string(),
                        },
                        None,
                    )?,
                )?)
            }
            "camp.pendingInputs.get" => {
                let params: CampIdParams = serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    rovai_core::pending_camp_input::read_queue(&database, params.camp_id.as_str())?,
                )?)
            }
            "camp.pendingInputs.edit" => {
                let params: UserCommandParams<
                    rovai_core::pending_camp_input::EditPendingCampInputCommand,
                > = serde_json::from_value(request.params.clone())?;
                let camp_id = params.command.camp_id.clone();
                let mut database = self.database.lock().await;
                let execution = rovai_core::pending_camp_input::edit_input(
                    &mut database,
                    &user_camp_command_envelope(params.command_id, camp_id, params.command),
                )?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "camp.composerDraft.get" => {
                let params: CampComposerDraftParams =
                    serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    CampAttachmentStore::new(&self.data_dir)
                        .load_draft(&database, params.camp_id.as_str())?,
                )?)
            }
            "camp.composerDraft.save" => {
                let params: SaveCampComposerDraftParams =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                Ok(serde_json::to_value(
                    CampAttachmentStore::new(&self.data_dir).save_content_with_continuation(
                        &mut database,
                        params.camp_id.as_str(),
                        params.expected_revision,
                        params.content,
                        params.continuation_source_message_id.as_deref(),
                    )?,
                )?)
            }
            "camp.composerDraft.startReply" => {
                let params: StartCampComposerReplyParams =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                Ok(serde_json::to_value(
                    CampAttachmentStore::new(&self.data_dir).start_reply(
                        &mut database,
                        params.camp_id.as_str(),
                        params.expected_revision,
                        &params.reply_to_camp_message_id,
                    )?,
                )?)
            }
            "camp.composerDraft.cancelReply" => {
                let params: MutateCampComposerReplyParams =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                Ok(serde_json::to_value(
                    CampAttachmentStore::new(&self.data_dir).cancel_reply(
                        &mut database,
                        params.camp_id.as_str(),
                        params.expected_revision,
                    )?,
                )?)
            }
            "camp.composerDraft.resolveReplyRecipient" => {
                let params: ResolveCampComposerReplyRecipientParams =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                Ok(serde_json::to_value(
                    CampAttachmentStore::new(&self.data_dir).resolve_reply_recipient(
                        &mut database,
                        params.camp_id.as_str(),
                        params.expected_revision,
                        params.recipient,
                    )?,
                )?)
            }
            "camp.composerDraft.dismissContinuation" => {
                let params: DismissCampComposerContinuationParams =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                Ok(serde_json::to_value(
                    CampAttachmentStore::new(&self.data_dir).dismiss_continuation(
                        &mut database,
                        params.camp_id.as_str(),
                        params.expected_revision,
                        &params.source_camp_message_id,
                    )?,
                )?)
            }
            "camp.composerDraft.resolveContinuationRecipient" => {
                let params: ResolveCampComposerContinuationRecipientParams =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                Ok(serde_json::to_value(
                    CampAttachmentStore::new(&self.data_dir).resolve_continuation_recipient(
                        &mut database,
                        params.camp_id.as_str(),
                        params.expected_revision,
                        &params.agent_id,
                    )?,
                )?)
            }
            "camp.composerDraft.removeAttachment" => {
                let params: RemovePreparedAttachmentParams =
                    serde_json::from_value(request.params.clone())?;
                let store = CampAttachmentStore::new(&self.data_dir);
                let (draft, cleanup) = {
                    let mut database = self.database.lock().await;
                    store.remove_prepared_from_database(
                        &mut database,
                        params.camp_id.as_str(),
                        params.expected_revision,
                        &params.attachment_id,
                    )?
                };
                emit_navigation_invalidated_for_pending_camp(
                    &self.database,
                    &self.output,
                    "camp.composerDraft.removeAttachment",
                    params.camp_id.as_str(),
                )
                .await;
                let cleanup_store = store.clone();
                if let Err(error) = tokio::task::spawn_blocking(move || {
                    cleanup_store.cleanup_detached_attachments(cleanup)
                })
                .await
                .context("Prepared Attachment cleanup task failed")?
                {
                    eprintln!(
                        "Prepared Attachment {} was removed from Draft {}, but its superseded file could not be cleaned immediately: {error:#}",
                        params.attachment_id, params.camp_id
                    );
                }
                Ok(serde_json::to_value(draft)?)
            }
            "camp.composerDraft.discard" => {
                let params: CampComposerDraftParams =
                    serde_json::from_value(request.params.clone())?;
                let store = CampAttachmentStore::new(&self.data_dir);
                let cleanup = {
                    let mut database = self.database.lock().await;
                    store.discard_draft_from_database(&mut database, params.camp_id.as_str())?
                };
                emit_navigation_invalidated_for_pending_camp(
                    &self.database,
                    &self.output,
                    "camp.composerDraft.discard",
                    params.camp_id.as_str(),
                )
                .await;
                tokio::task::spawn_blocking(move || store.cleanup_detached_attachments(cleanup))
                    .await
                    .context("Camp Composer Draft cleanup task failed")??;
                Ok(json!({ "discarded": true }))
            }
            "camp.attachments.prepareFromPath" => {
                let params: PrepareAttachmentFromPathParams =
                    serde_json::from_value(request.params.clone())?;
                prepare_composer_attachment_from_path(
                    &self.database,
                    &self.output,
                    &self.data_dir,
                    params,
                )
                .await
            }
            "camp.attachments.previewSource" => {
                let params: AttachmentPreviewSourceParams =
                    serde_json::from_value(request.params.clone())?;
                let store = CampAttachmentStore::new(&self.data_dir);
                let candidate = {
                    let database = self.database.lock().await;
                    store.preview_candidate(&database, &params.attachment_id)?
                };
                let source = match candidate {
                    Some(candidate) => Some(
                        tokio::task::spawn_blocking(move || {
                            store.verify_preview_candidate(candidate)
                        })
                        .await
                        .context("Attachment preview verification task failed")??,
                    ),
                    None => None,
                };
                Ok(match source {
                    Some(source) => json!({
                        "path": source.path,
                        "mediaType": source.media_type,
                        "byteSize": source.byte_size,
                    }),
                    None => Value::Null,
                })
            }
            "camp.attachments.desktopOpenTarget" => {
                let params: DesktopAttachmentTargetParams =
                    serde_json::from_value(request.params.clone())?;
                let store = CampAttachmentStore::new(&self.data_dir);
                let candidate = {
                    let database = self.database.lock().await;
                    store.desktop_open_candidate(
                        &database,
                        params.camp_id.as_str(),
                        &params.attachment_id,
                    )?
                };
                let Some(candidate) = candidate else {
                    return Ok(Value::Null);
                };
                let target = tokio::task::spawn_blocking(move || {
                    store.verify_desktop_open_candidate(candidate)
                })
                .await
                .context("Desktop Attachment target verification task failed")??;
                Ok(serde_json::to_value(target)?)
            }
            "filePreview.resolveSource" => {
                let params: ResolveFilePreviewSourceParams =
                    serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                Ok(serde_json::to_value(resolve_file_preview_source(
                    &database,
                    &ManagedBlobStore::new(&self.data_dir),
                    params,
                )?)?)
            }
            "camp.messages.send" => {
                let params: SendCampMessageParams = serde_json::from_value(request.params.clone())?;
                self.send_test_camp_message_request(params).await
            }
            "userAutomation.camp.send" => {
                let params: SendUserAutomationCampMessageParams =
                    serde_json::from_value(request.params.clone())?;
                self.send_user_automation_camp_message_request(params).await
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
                        camp_id: Some(params.camp_id.to_string()),
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
                    NotificationEpisodeService::default().inbox(
                        &mut database,
                        CURRENT_USER_ID,
                        params.filter,
                        params.cursor.as_deref(),
                        params.limit,
                    )?,
                )?)
            }
            "notifications.changesSince" => {
                let params: NotificationChangesSinceParams =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                Ok(serde_json::to_value(
                    NotificationEpisodeService::default().changes_since(
                        &mut database,
                        CURRENT_USER_ID,
                        params.after_change_sequence,
                        params.limit,
                    )?,
                )?)
            }
            "notifications.acknowledge" => {
                let params: UserCommandParams<AcknowledgeNotificationEpisodeCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = NotificationEpisodeService::default().acknowledge(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                emit(&self.output, "notification_episode.changed", json!({}));
                Ok(serde_json::to_value(execution.result)?)
            }
            "notifications.acknowledgeVisibleSources" => {
                let params: UserCommandParams<AcknowledgeVisibleNotificationSourcesCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = NotificationEpisodeService::default().acknowledge_visible_sources(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                emit(&self.output, "notification_episode.changed", json!({}));
                Ok(serde_json::to_value(execution.result)?)
            }
            "notifications.markAllRead" => {
                let params: UserCommandParams<MarkAllNotificationEpisodesReadCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = NotificationEpisodeService::default().mark_all_read(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                emit(&self.output, "notification_episode.changed", json!({}));
                Ok(serde_json::to_value(execution.result)?)
            }
            "notifications.clear" => {
                let params: UserCommandParams<ClearNotificationEpisodeCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = NotificationEpisodeService::default().clear(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                if let Err(error) =
                    NotificationEpisodeService::default().maintain_retention(&database)
                {
                    eprintln!("Notification Episode clear retention failed: {error:#}");
                }
                emit(&self.output, "notification_episode.changed", json!({}));
                Ok(serde_json::to_value(execution.result)?)
            }
            "notifications.preference.get" => {
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    NotificationEpisodeService::default().preference(&database)?,
                )?)
            }
            "notifications.preference.update" => {
                let params: UserCommandParams<UpdateNotificationPreferenceCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = NotificationEpisodeService::default().update_preference(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                emit(
                    &self.output,
                    "notification_episode.preference_changed",
                    json!({}),
                );
                Ok(serde_json::to_value(execution.result)?)
            }
            "events.subscribe" => {
                let params: SubscribeEventsParams = serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                Ok(serde_json::to_value(ReadModelService.events_since(
                    &mut database,
                    params.camp_id.as_ref().map(CampId::as_str),
                    params.after_global_sequence,
                    params.limit.unwrap_or(500),
                )?)?)
            }
            "agentRuns.diagnostic.get" => {
                let params: AgentRunDiagnosticParams =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                Ok(serde_json::to_value(
                    ReadModelService.agent_run_diagnostic(&mut database, &params.agent_run_id)?,
                )?)
            }
            "diagnostics.check" => Ok(serde_json::to_value(self.diagnostics_report().await)?),
            "monitoring.snapshot" => {
                let filter: MonitoringFilter = serde_json::from_value(request.params.clone())?;
                let lock_wait_started = Instant::now();
                let mut database = self.database.lock().await;
                let lock_wait_millis = lock_wait_started.elapsed().as_millis();
                let query_started = Instant::now();
                let result = MonitoringService::snapshot(&mut database, &filter);
                let query_millis = query_started.elapsed().as_millis();
                drop(database);
                eprintln!(
                    "[monitoring] operation=snapshot range={} lock_wait_ms={} query_ms={} total_ms={} outcome={}",
                    filter.range,
                    lock_wait_millis,
                    query_millis,
                    lock_wait_millis + query_millis,
                    if result.is_ok() { "ok" } else { "error" },
                );
                result
            }
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
                let outcome = self
                    .await_runtime_check(
                        params.runtime_kind,
                        RuntimeLaunchPurpose::AvailabilityCheck,
                        RuntimeCheckTrigger::UserCheck,
                    )
                    .await?;
                Ok(json!({
                    "scheduled": true,
                    "completed": true,
                    "ready": outcome.is_ready(),
                    "outcome": outcome.public_status(),
                    "status": outcome.public_status(),
                    "runtimeKind": params.runtime_kind,
                }))
            }
            "runtime.modelCatalog.open" => {
                let params: CheckProductRuntimeParams =
                    serde_json::from_value(request.params.clone())?;
                self.open_runtime_model_catalog(params.runtime_kind).await
            }
            "health.check" => {
                let git_path = self
                    .runtime_search_environment
                    .read()
                    .await
                    .resolve_command_path("git");
                let git = health::git_health(git_path).await;
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
                        "builtinToolEvidenceProjectionVersion":
                            BUILTIN_TOOL_EVIDENCE_PROJECTION_SCHEMA_VERSION,
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
            camp_id: Some(params.camp_id.to_string()),
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload: SendUserCampDraftCommand {
                camp_id: params.camp_id.to_string(),
                draft_revision: params.draft_revision,
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

        // Queue admission has no file side effects. In particular, do not copy an
        // attachment only to reject it because this Camp cannot send directly.
        let queued = {
            let mut database = self.database.lock().await;
            if rovai_core::pending_camp_input::requires_queue(&database, params.camp_id.as_str())? {
                Some(
                    CollaborationService::default().send_user_camp_draft_with_managed_ingest(
                        &mut database,
                        &envelope,
                        None,
                    )?,
                )
            } else {
                None
            }
        };
        if let Some(execution) = queued {
            return Ok(
                json!({"commandResult": execution.result, "replayed": execution.replayed, "preflight": null, "pendingExecution": null}),
            );
        }
        let (managed_store, ingest_plan) = {
            let mut database = self.database.lock().await;
            let managed_store = ManagedAttachmentStore::for_database(&database);
            let plan = managed_store.begin_current_composer_ingest(
                &mut database,
                params.camp_id.as_str(),
                &params.command_id,
                params.draft_revision,
            )?;
            (managed_store, plan)
        };
        let prepared_ingest = if let Some(plan) = ingest_plan {
            let materializer = managed_store.clone();
            let authority_store = CampAttachmentStore::new(&self.data_dir);
            let materialization_plan = plan.clone();
            let prepared = match tokio::task::spawn_blocking(move || {
                materializer.materialize_composer(&authority_store, &materialization_plan)
            })
            .await
            .context("Managed Attachment Composer ingest task failed")?
            {
                Ok(prepared) => prepared,
                Err(error) => {
                    let mut database = self.database.lock().await;
                    let _ = managed_store.abandon(&mut database, plan.intent_id(), "copy_failed");
                    return Err(error);
                }
            };
            if let Err(error) = {
                let mut database = self.database.lock().await;
                managed_store.record_promoted(&mut database, &prepared)
            } {
                let mut database = self.database.lock().await;
                let _ =
                    managed_store.abandon(&mut database, prepared.intent_id(), "promote_failed");
                return Err(error);
            }
            Some(prepared)
        } else {
            None
        };
        let execution_result = {
            let mut database = self.database.lock().await;
            CollaborationService::default().send_user_camp_draft_with_managed_ingest(
                &mut database,
                &envelope,
                prepared_ingest
                    .as_ref()
                    .map(|prepared| prepared.intent_id()),
            )
        };
        let execution = match execution_result {
            Ok(execution) if execution.result.status != CommandResultStatus::Rejected => execution,
            Ok(execution) => {
                if let Some(prepared) = prepared_ingest.as_ref() {
                    let mut database = self.database.lock().await;
                    let _ = managed_store.abandon(
                        &mut database,
                        prepared.intent_id(),
                        "message_commit_failed",
                    );
                }
                execution
            }
            Err(error) => {
                if let Some(prepared) = prepared_ingest.as_ref() {
                    let mut database = self.database.lock().await;
                    let _ = managed_store.abandon(
                        &mut database,
                        prepared.intent_id(),
                        "message_commit_failed",
                    );
                }
                return Err(error);
            }
        };
        if execution.result.status != CommandResultStatus::Rejected {
            emit_navigation_invalidated(
                &self.output,
                "camp.messages.send",
                Some(params.camp_id.as_str()),
            );
        }
        if let Some(prepared) = prepared_ingest {
            let cleanup_store = managed_store.clone();
            let authority_store = CampAttachmentStore::new(&self.data_dir);
            if let Err(error) = tokio::task::spawn_blocking(move || {
                cleanup_store.cleanup_committed_composer_sources(&authority_store, &prepared)
            })
            .await
            .context("Managed Attachment Composer source cleanup task failed")?
            {
                eprintln!("Committed Composer source cleanup was deferred: {error:#}");
            }
        }
        Ok(json!({
            "commandResult": execution.result,
            "replayed": execution.replayed,
            "preflight": null,
            "pendingExecution": null,
        }))
    }

    async fn send_user_automation_camp_message_request(
        &self,
        params: SendUserAutomationCampMessageParams,
    ) -> Result<Value> {
        let camp_id = params.camp_id.to_string();
        let envelope = CommandEnvelope {
            command_id: params.command_id,
            actor: ActorRef::User {
                user_id: CURRENT_USER_ID.to_string(),
            },
            camp_id: Some(camp_id.clone()),
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload: SendUserAutomationCampMessageCommand {
                camp_id: camp_id.clone(),
                agent_id: params.agent_id,
                body: params.body,
                execution: params.execution,
            },
        };
        let execution = {
            let mut database = self.database.lock().await;
            CollaborationService::default()
                .send_user_automation_camp_message(&mut database, &envelope)?
        };
        if execution.result.status != CommandResultStatus::Rejected {
            self.request_camp_attachment_projection(&camp_id);
        }
        Ok(json!({
            "commandResult": execution.result,
            "replayed": execution.replayed,
            "preflight": null,
            "pendingExecution": null,
        }))
    }

    fn request_camp_attachment_projection(&self, camp_id: &str) {
        if self
            .attachment_projection_requests
            .send(camp_id.to_string())
            .is_err()
        {
            eprintln!(
                "Camp Attachment projection worker is unavailable; {camp_id} remains recoverable"
            );
        }
    }

    async fn drive_camp_attachment_publications(&self, camp_id: &str) -> Result<()> {
        loop {
            let plan = {
                let mut database = self.database.lock().await;
                self.attachment_views
                    .plan_queued_publication(&mut database, camp_id)?
            };
            let Some(plan) = plan else {
                return Ok(());
            };
            let operation_id = plan.operation_id().to_string();
            let attachment_store = CampAttachmentStore::new(&self.data_dir);
            let copied = match tokio::task::spawn_blocking(move || {
                CampAttachmentViewStore::copy_publication(&attachment_store, plan)
            })
            .await
            {
                Ok(Ok(copied)) => copied,
                Ok(Err(error)) => {
                    let recipients = {
                        let mut database = self.database.lock().await;
                        self.attachment_views
                            .resolve_semantic_publication_terminal_failure(
                                &mut database,
                                &operation_id,
                                "camp_attachment_view_source_invalid",
                            )?
                    };
                    let recipients = recipients.into_iter().collect::<BTreeSet<_>>();
                    for (recipient_camp_id, recipient_agent_id) in recipients {
                        let mut database = self.database.lock().await;
                        let _ = dispatch_pending_for_recipient(
                            &mut database,
                            &recipient_camp_id,
                            &recipient_agent_id,
                            DeliveryDispatchTrigger::TargetRunEnded,
                            true,
                        )?;
                    }
                    eprintln!(
                        "Camp Attachment publication {operation_id} terminalized after an invalid Authority source: {error:#}"
                    );
                    continue;
                }
                Err(error) => {
                    let mut database = self.database.lock().await;
                    self.attachment_views
                        .mark_semantic_publication_recovery_required(
                            &mut database,
                            &operation_id,
                            "camp_attachment_view_copy_task_failed",
                        )?;
                    return Err(error).context("Camp Attachment View copy task failed");
                }
            };
            let projection = async {
                let publication = {
                    let mut database = self.database.lock().await;
                    self.attachment_views
                        .finish_publication_staging(&mut database, copied)?
                };
                let (view_mutation, mutation_deadline) =
                    self.acquire_camp_attachment_mutation(camp_id).await?;
                self.wait_for_camp_attachment_quiescence(camp_id, mutation_deadline)
                    .await?;
                {
                    let mut database = self.database.lock().await;
                    self.attachment_views
                        .gate_publication(&mut database, &publication)?;
                    self.attachment_views
                        .promote_publication(&mut database, &publication)?;
                }
                drop(view_mutation);
                let delivery_ids = {
                    let mut database = self.database.lock().await;
                    let delivery_ids = self
                        .attachment_views
                        .resolve_semantic_publication_success(&mut database, &operation_id)?;
                    self.attachment_views
                        .finish_semantic_publication(&mut database, &operation_id)?;
                    delivery_ids
                };
                if !delivery_ids.is_empty() {
                    let mut database = self.database.lock().await;
                    dispatch_accepted_deliveries(&mut database, &delivery_ids)?;
                }
                Ok::<(), anyhow::Error>(())
            }
            .await;
            if let Err(error) = projection {
                let recovery = {
                    let mut database = self.database.lock().await;
                    self.attachment_views
                        .mark_semantic_publication_recovery_required(
                            &mut database,
                            &operation_id,
                            "camp_attachment_view_projection_failed",
                        )
                };
                if let Err(recovery_error) = recovery {
                    eprintln!(
                        "Camp Attachment publication {operation_id} could not persist recovery state: {recovery_error:#}"
                    );
                }
                return Err(error);
            }
        }
    }

    async fn deep_probe_candidate(
        &self,
        adapter_kind: rovai_core::agent_profile::AdapterKind,
        executable_path: &Path,
        purpose: RuntimeLaunchPurpose,
    ) -> Result<RuntimeDeepProbeResult> {
        if let Some(blocker) = current_runtime_platform_blocker(adapter_kind) {
            anyhow::bail!("{}: {}", blocker.code, blocker.payload);
        }
        if !runtime_launch_allowed(adapter_kind, purpose) {
            anyhow::bail!("runtime_launch_disallowed_for_{purpose:?}");
        }
        let attempted_at = chrono::Utc::now().to_rfc3339();
        let registry = AgentRuntimeAdapterRegistry::default();
        let (snapshot, failure) = match adapter_kind {
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
                (
                    registry.codex_capability_snapshot(CodexProbeObservation {
                        reported_version: probe.reported_version,
                        executable_fingerprint: probe.executable_fingerprint,
                        authentication_status,
                        probe_status: status,
                        capabilities: probe.capabilities,
                        raw_model_catalog,
                        attempted_at,
                        last_error,
                    })?,
                    None,
                )
            }
            kind @ (rovai_core::agent_profile::AdapterKind::OpencodeCli
            | rovai_core::agent_profile::AdapterKind::CopilotCli
            | rovai_core::agent_profile::AdapterKind::KiroCli
            | rovai_core::agent_profile::AdapterKind::QoderCli
            | rovai_core::agent_profile::AdapterKind::CodebuddyCli
            | rovai_core::agent_profile::AdapterKind::QwenCode
            | rovai_core::agent_profile::AdapterKind::TraeCnCli
            | rovai_core::agent_profile::AdapterKind::CursorAgent
            | rovai_core::agent_profile::AdapterKind::KimiCodeCli
            | rovai_core::agent_profile::AdapterKind::GrokBuild) => {
                let probe =
                    health::acp_capability_probe_at_for_purpose(executable_path, kind, purpose)
                        .await;
                (
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
                    })?,
                    None,
                )
            }
            rovai_core::agent_profile::AdapterKind::ClaudeCodeCli => {
                let probe = health::claude_code_capability_probe_at(executable_path).await;
                let failure = probe.result.failure.clone();
                let snapshot =
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
                    })?;
                (snapshot, failure)
            }
            rovai_core::agent_profile::AdapterKind::AntigravityApp => {
                let probe = health::antigravity_capability_probe_at(executable_path).await;
                let failure = probe.result.failure.clone();
                let builtin_cli_ready = bundled_cli_executable().is_ok_and(|path| path.is_file());
                let snapshot =
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
                    })?;
                (snapshot, failure)
            }
        };
        Ok(RuntimeDeepProbeResult { snapshot, failure })
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
        if let Some(blocker) = current_runtime_platform_blocker(installation.adapter_kind) {
            return Ok(serde_json::to_value(blocker)?);
        }
        self.runtime_fleet
            .invalidate_adapter(installation.adapter_kind)
            .await;
        if installation.installation_class
            == rovai_core::agent_profile::InstallationClass::ManagedDefault
        {
            let outcome = self
                .await_runtime_check(
                    installation.adapter_kind,
                    RuntimeLaunchPurpose::InstallationRefresh,
                    RuntimeCheckTrigger::UserCheck,
                )
                .await?;
            return Ok(json!({
                "status": if outcome.is_ready() { "applied" } else { "rejected" },
                "code": if outcome.is_ready() {
                    "adapter_installation.snapshot_recorded"
                } else if outcome == RuntimeCheckOutcome::Superseded {
                    "adapter_installation.refresh_deferred"
                } else {
                    "adapter_installation.probe_unavailable"
                },
                "payload": { "installationId": installation.id },
            }));
        }
        let search = self.runtime_search_environment.read().await.clone();
        let deep_probe = with_runtime_search_environment(
            &search,
            self.deep_probe_candidate(
                installation.adapter_kind,
                Path::new(&installation.executable_path),
                RuntimeLaunchPurpose::InstallationRefresh,
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
                    snapshot: deep_probe.snapshot,
                    failure: deep_probe.failure,
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
        // Keep queued work intact while dependencies initialize or need repair.
        // In particular, do not classify it as a failed provider dispatch.
        let runtime_kind = candidate
            .frozen_runtime()
            .ok()
            .map(|runtime| runtime.adapter_kind);
        if runtime_kind.is_some_and(|kind| self.require_execution_subsystems(kind).is_err()) {
            return;
        }
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
                self.reject_agent_run_dispatch(
                    &output,
                    &candidate,
                    "workspace_unavailable",
                    &error,
                )
                .await;
                return;
            }
        };
        let runtime = match candidate.frozen_runtime() {
            Ok(runtime) => runtime,
            Err(error) => {
                self.reject_agent_run_dispatch(
                    &output,
                    &candidate,
                    "runtime_configuration_invalid",
                    &error,
                )
                .await;
                return;
            }
        };
        match self
            .prepare_runtime_for_dispatch(&candidate, runtime, &workspace)
            .await
        {
            Ok((_runtime, effective_version)) => candidate.version = effective_version,
            Err(failure) => {
                if failure.code == "runtime_check_deferred" {
                    return;
                }
                if let Some(effective_version) = failure.effective_version {
                    candidate.version = effective_version;
                }
                self.reject_agent_run_dispatch(&output, &candidate, &failure.code, &failure.error)
                    .await;
                return;
            }
        }
        let starting_git_observation = Some(git::observe_git(&workspace_path).await);
        let (attachment_view_admission, attachment_authorization) = match self
            .verified_camp_attachment_admission(&candidate.camp_id, &workspace_path)
            .await
        {
            Ok(admission) => admission,
            Err(error) => {
                self.reject_agent_run_dispatch(
                    &output,
                    &candidate,
                    "camp_attachment_view_unavailable",
                    &error,
                )
                .await;
                return;
            }
        };
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
                self.project_agent_run_file_changes_after_terminal(
                    &candidate.agent_run_id,
                    execution_epoch,
                )
                .await;
                return;
            }
            Err(error) => {
                eprintln!(
                    "failed to materialize AgentRun {} input: {error:#}",
                    candidate.agent_run_id
                );
                self.fail_unmaterialized_agent_run(&output, &candidate, execution_epoch, &error)
                    .await;
                return;
            }
        };
        let monitoring_run = {
            let mut database = self.database.lock().await;
            match MonitoringService::enroll_run(&mut database, &execution) {
                Ok(run) => run,
                Err(error) => {
                    eprintln!(
                        "failed to enroll AgentRun {} in Runtime Monitoring: {error:#}",
                        execution.agent_run_id
                    );
                    None
                }
            }
        };
        if let Some(run) = monitoring_run {
            self.runtime_usage.lock().await.register_run(run);
        }
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
                &output,
                &execution,
                "runtime_launch_admission_failed",
                &error,
                false,
                None,
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
                .launch_agent_run(
                    &execution,
                    &attachment_view_admission,
                    &attachment_authorization,
                    &output,
                    &mut launch_permit,
                )
                .await;
            // New Runs carry only a Camp-scoped root proof. Their terminal path may wake legacy
            // recovery work, but no legacy View admission is held across the Run lifecycle.
            if !release_agent_run_attachment_admission(
                attachment_view_admission,
                &core.attachment_projection_requests,
            ) {
                eprintln!(
                    "Camp Attachment projection worker is unavailable; {} remains recoverable",
                    execution.camp_id
                );
            }
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
                    .map(|failure| {
                        (
                            failure.native_turn_id.clone(),
                            failure.error_code.clone(),
                            failure.failure.clone(),
                        )
                    })
                    .or_else(|| {
                        error
                            .downcast_ref::<ClaudeCodeDeliveredFailure>()
                            .map(|failure| {
                                (
                                    failure.native_turn_id.clone(),
                                    failure.error_code.clone(),
                                    failure.failure.clone(),
                                )
                            })
                    });
                let runtime_terminal_observed = delivered_one_shot_failure.is_some();
                let public_failure = delivered_one_shot_failure
                    .as_ref()
                    .map(|(_, _, failure)| failure.clone())
                    .or_else(|| {
                        error
                            .downcast_ref::<RuntimeFailureError>()
                            .map(|error| error.failure.clone())
                    });
                let error_code = if error.downcast_ref::<ContextPayloadTooLarge>().is_some() {
                    "context_payload_too_large".to_string()
                } else if let Some(model_error) =
                    error.downcast_ref::<AcpLiveModelValidationError>()
                {
                    model_error.code.to_string()
                } else if let Some(model_error) =
                    error.downcast_ref::<CodexLiveModelValidationError>()
                {
                    model_error.code.to_string()
                } else {
                    public_failure
                        .as_ref()
                        .map(|failure| failure.code.clone())
                        .unwrap_or_else(|| "runtime_launch_failed".to_string())
                };
                let public_failure = public_failure.or_else(|| {
                    unknown_one_shot_runtime_failure(
                        execution.runtime.adapter_kind,
                        &error_code,
                    )
                });
                if let Some((native_turn_id, delivered_error_code, delivered_failure)) =
                    delivered_one_shot_failure
                {
                    let ending_git_observation = core
                        .observe_run_git(
                            &execution.project_binding_kind,
                            &execution.project_path,
                        )
                        .await;
                    let Some(mut runtime_route_permit) =
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
                    let mut terminal_admission = match core
                        .admit_planned_shutdown_terminal(
                            &execution.agent_run_id,
                            execution.execution_epoch,
                            binding,
                            RuntimeTerminalOutcome::Failed,
                            &delivered_error_code,
                        )
                        .await
                    {
                        Ok(admission) => admission,
                        Err(admission_error) => {
                            eprintln!(
                                "planned shutdown terminal was fenced for AgentRun {}: {admission_error:#}",
                                execution.agent_run_id
                            );
                            return;
                        }
                    };
                    match terminal_admission.planned_permit() {
                        Some(permit) => {
                            match core
                                .settle_planned_shutdown_abortive_terminal(
                                    permit,
                                    PlannedShutdownAbortiveTerminal {
                                        agent_run_id: execution.agent_run_id.clone(),
                                        execution_epoch: execution.execution_epoch,
                                        outcome: RuntimeTerminalOutcome::Failed,
                                        error_code: delivered_error_code.to_string(),
                                        error_detail: Some(format!("{error:#}")),
                                        failure: Some(delivered_failure.clone()),
                                        manual_retry_allowed: true,
                                    },
                                )
                                .await
                            {
                                Ok(settlement) => {
                                    core.planned_shutdown.remove_active(&active_key).await;
                                    terminal_admission.complete_settlement();
                                    runtime_route_permit.complete_callback();
                                    emit_agent_run_terminal(
                                        &output,
                                        Some(&execution.camp_id),
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
                                }
                                Err(settlement_error) => eprintln!(
                                    "failed to settle planned shutdown terminal for AgentRun {}: {settlement_error:#}",
                                    execution.agent_run_id
                                ),
                            }
                        }
                        None => {
                            let failure_persisted = core
                                .persist_claimed_agent_run_failure(
                                    &execution,
                                    &delivered_error_code,
                                    &error,
                                    true,
                                    Some(delivered_failure),
                                    ending_git_observation,
                                )
                                .await;
                            if failure_persisted {
                                emit_agent_run_terminal(
                                    &output,
                                    Some(&execution.camp_id),
                                    json!({
                                        "campId": execution.camp_id,
                                        "campTurnId": execution.camp_turn_id,
                                        "agentRunId": execution.agent_run_id,
                                        "executionEpoch": execution.execution_epoch,
                                        "adapterKind": execution.runtime.adapter_kind,
                                        "reasonCode": delivered_error_code,
                                    }),
                                );
                                core.planned_shutdown.remove_active(&active_key).await;
                            }
                            terminal_admission.complete_settlement();
                            runtime_route_permit.complete_callback();
                            core.finish_claimed_agent_run_failure(
                                &execution,
                                failure_persisted,
                                true,
                            )
                            .await;
                        }
                    }
                    return;
                }
                if core
                    .planned_shutdown
                    .must_preserve_unresolved_after_nonterminal_error(&active_key)
                    .await
                {
                    eprintln!(
                        "preserving unresolved accepted input for AgentRun {} after non-terminal Runtime error",
                        execution.agent_run_id
                    );
                    return;
                }
                core.fail_claimed_agent_run(
                    &output,
                    &execution,
                    &error_code,
                    &error,
                    runtime_terminal_observed,
                    public_failure,
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
        output: &mpsc::UnboundedSender<String>,
        candidate: &rovai_core::runtime::QueuedAgentRunCandidate,
        error_code: &str,
        error: &anyhow::Error,
    ) {
        let public_failure = dispatch_public_failure(candidate, error_code);
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
                        failure: public_failure,
                        manual_retry_allowed: error_code != "context_payload_too_large",
                    },
                },
            )
        };
        match rejection {
            Ok(execution) if execution.result.status != CommandResultStatus::Rejected => {
                emit_agent_run_terminal(
                    output,
                    Some(&candidate.camp_id),
                    json!({
                        "campId": candidate.camp_id,
                        "campTurnId": candidate.camp_turn_id,
                        "agentRunId": candidate.agent_run_id,
                        "reasonCode": error_code,
                        "result": execution.result,
                        "replayed": execution.replayed,
                    }),
                );
            }
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
                let ingress_fence = core.interrupt_cancelled_agent_run(&candidate).await;
                (candidate, ingress_fence)
            });
        }
        while let Some(result) = interrupt_tasks.join_next().await {
            let (candidate, ingress_fence) = match result {
                Ok(result) => result,
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
                    emit_navigation_invalidated(
                        output,
                        if accepted_input_outcome_unknown {
                            "agent_run.recovery_blocker_resolved"
                        } else {
                            "agent_run.cancelled"
                        },
                        Some(&candidate.camp_id),
                    );
                    self.reconcile_skill_projection_after_run_terminal(&candidate.execution_root)
                        .await;
                    self.planned_shutdown
                        .remove_active(&ActiveExecutionKey::new(
                            &candidate.agent_run_id,
                            candidate.execution_epoch,
                        ))
                        .await;
                    if ingress_fence == RuntimeCancellationIngressFence::Flushed {
                        self.project_agent_run_file_changes_after_terminal(
                            &candidate.agent_run_id,
                            candidate.execution_epoch,
                        )
                        .await;
                    } else {
                        eprintln!(
                            "AgentRun {} cancellation ingress did not flush; file-change projection remains recoverable instead of freezing no_changes",
                            candidate.agent_run_id
                        );
                    }
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

    async fn interrupt_cancelled_agent_run(
        &self,
        candidate: &AgentRunCancellationCandidate,
    ) -> RuntimeCancellationIngressFence {
        if candidate.status == "queued" {
            return RuntimeCancellationIngressFence::Flushed;
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
            return if self
                .antigravity_app
                .wait_for_agent_run_quiescence(
                    &candidate.agent_run_id,
                    candidate.execution_epoch,
                    RUNTIME_CANCELLATION_FENCE_TIMEOUT,
                )
                .await
            {
                RuntimeCancellationIngressFence::Flushed
            } else {
                RuntimeCancellationIngressFence::Unproven
            };
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
            return if self
                .claude_code_cli
                .wait_for_agent_run_quiescence(
                    &candidate.agent_run_id,
                    candidate.execution_epoch,
                    RUNTIME_CANCELLATION_FENCE_TIMEOUT,
                )
                .await
            {
                RuntimeCancellationIngressFence::Flushed
            } else {
                RuntimeCancellationIngressFence::Unproven
            };
        }
        let Some(runtime) = self
            .agent_run_runtime(&candidate.agent_run_id, candidate.execution_epoch)
            .await
        else {
            return RuntimeCancellationIngressFence::Unproven;
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
        let ingress_flushed = run_with_cancellation_deadline(
            RUNTIME_CANCELLATION_INGRESS_FLUSH_TIMEOUT,
            runtime.detach_and_flush_ingress(),
        )
        .await;
        if ingress_flushed != Some(true) {
            eprintln!(
                "Runtime ingress flush timed out for AgentRun {}; file-change projection will remain recoverable",
                candidate.agent_run_id
            );
        }
        let adapter_kind = runtime.adapter_kind();
        let stopped = run_with_cancellation_deadline(RUNTIME_CANCELLATION_FENCE_TIMEOUT, async {
            match adapter_kind {
                rovai_core::agent_profile::AdapterKind::CodexCli => {
                    self.codex_cli
                        .forget_agent_run(&candidate.agent_run_id, candidate.execution_epoch)
                        .await
                }
                kind @ (rovai_core::agent_profile::AdapterKind::OpencodeCli
                | rovai_core::agent_profile::AdapterKind::CopilotCli
                | rovai_core::agent_profile::AdapterKind::KiroCli
                | rovai_core::agent_profile::AdapterKind::QoderCli
                | rovai_core::agent_profile::AdapterKind::CodebuddyCli
                | rovai_core::agent_profile::AdapterKind::QwenCode
                | rovai_core::agent_profile::AdapterKind::TraeCnCli
                | rovai_core::agent_profile::AdapterKind::CursorAgent
                | rovai_core::agent_profile::AdapterKind::KimiCodeCli
                | rovai_core::agent_profile::AdapterKind::GrokBuild) => {
                    if let Some(adapter) = self.acp_adapter(kind) {
                        adapter
                            .forget_agent_run(&candidate.agent_run_id, candidate.execution_epoch)
                            .await
                    } else {
                        false
                    }
                }
                rovai_core::agent_profile::AdapterKind::AntigravityApp => unreachable!(),
                rovai_core::agent_profile::AdapterKind::ClaudeCodeCli => unreachable!(),
            }
        })
        .await;
        if stopped != Some(true) {
            eprintln!(
                "Runtime detach timed out for AgentRun {}; persisted cancellation fence remains authoritative",
                candidate.agent_run_id
            );
        }
        if ingress_flushed == Some(true) {
            RuntimeCancellationIngressFence::Flushed
        } else {
            RuntimeCancellationIngressFence::Unproven
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

            let response = if let Some(response) = frozen_runtime_response {
                Ok(response)
            } else if candidate.native_method == "session/request_permission" {
                acp::legacy_approval_result(&candidate.response_context, approved)
            } else {
                codex::approval_result(
                    &candidate.native_method,
                    &candidate.response_context,
                    if approved { "accept" } else { "decline" },
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
        attachment_access: CampAttachmentRunAccess<'_>,
        skill_exposure: &PreparedSkillExposure,
        mcp_projection: &PreparedMcpProjection,
        charter_delivery_mode: CharterDeliveryMode,
        output: &mpsc::UnboundedSender<String>,
    ) -> Result<Option<PreparedContext>> {
        attachment_access.prove(execution)?;
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
        attachment_access: CampAttachmentRunAccess<'_>,
        skill_exposure: &PreparedSkillExposure,
        mcp_projection: &PreparedMcpProjection,
        charter_delivery_mode: CharterDeliveryMode,
        output: &mpsc::UnboundedSender<String>,
    ) -> Result<Option<(PreparedContext, RuntimeInputDelivery)>> {
        attachment_access.prove(execution)?;
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
        self.subsystems.require("skills")?;
        loop {
            let result = {
                let mut database = self.database.lock().await;
                ContextService.prepare_skill_exposure(
                    &mut database,
                    &self.skill_library,
                    &execution.agent_run_id,
                    execution.execution_epoch,
                )
            };
            match result {
                Ok(exposure) => return Ok(Some(exposure)),
                Err(error) if error.downcast_ref::<SkillProjectionGateBusy>().is_some() => {
                    // The database mutex is deliberately released while an
                    // already-launched Windows Runtime keeps the shared root
                    // registration. Its terminal hook (or this retry after a
                    // restart) can then perform the exclusive projection update.
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
                Err(error) => return Err(error),
            }
        }
    }

    async fn prepare_agent_run_mcp_projection(
        &self,
        execution: &AgentRunExecution,
    ) -> Result<PreparedMcpProjection> {
        self.subsystems.require("mcp")?;
        let execution_root = PathBuf::from(&execution.workspace.execution_root);
        let mut projection = {
            let database = self.database.lock().await;
            self.mcp_projection.prepare(
                &database,
                self.mcp_config()?,
                &McpProjectionRequest {
                    agent_run_id: &execution.agent_run_id,
                    execution_epoch: execution.execution_epoch,
                    agent_id: &execution.agent_id,
                    adapter_kind: execution.runtime.adapter_kind,
                    reported_runtime_version: execution.runtime.reported_version.as_deref(),
                    execution_root: &execution_root,
                },
            )?
        };
        if execution.runtime.adapter_kind == AdapterKind::GrokBuild
            && !projection.servers.is_empty()
        {
            let native_names = health::inspect_grok_native_mcp_server_names(
                Path::new(&execution.runtime.executable_path),
                &execution_root,
            )
            .await
            .context("failed to discover effective Grok native MCP names")?;
            projection.finalize_native_name_conflicts(&native_names)?;
        }
        Ok(projection)
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

    async fn complete_active_runtime_route_handoff(
        &self,
        execution: &AgentRunExecution,
        binding: RuntimeRouteBinding,
        launch_permit: &mut ExecutionLaunchPermit,
    ) -> Result<()> {
        let key = ActiveExecutionKey::new(&execution.agent_run_id, execution.execution_epoch);
        if !self
            .planned_shutdown
            .complete_handoff(launch_permit, &key, binding)
            .await
        {
            anyhow::bail!("Runtime route did not match the current generation launch handoff");
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
    ) -> Result<RuntimeTerminalAdmission> {
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

    async fn prepare_initial_builtin_tool_binding(
        &self,
        execution: &AgentRunExecution,
        resume_disposition: NativeSessionResumeDisposition,
    ) -> Result<BuiltinToolBindingCredential> {
        Ok({
            let mut database = self.database.lock().await;
            let service = TeamToolService::default();
            match resume_disposition {
                NativeSessionResumeDisposition::Controlled => service
                    .prepare_controlled_resume_binding_credential(
                        &mut database,
                        &execution.agent_run_id,
                        execution.execution_epoch,
                    )?,
                NativeSessionResumeDisposition::New => service.prepare_binding_credential(
                    &mut database,
                    &execution.agent_run_id,
                    execution.execution_epoch,
                    execution.native_session_id.is_some(),
                )?,
                NativeSessionResumeDisposition::Compatible => service.prepare_binding_credential(
                    &mut database,
                    &execution.agent_run_id,
                    execution.execution_epoch,
                    false,
                )?,
            }
        })
    }

    async fn prepare_grok_native_session_rules(
        &self,
        execution: &AgentRunExecution,
        credential: &BuiltinToolBindingCredential,
    ) -> Result<String> {
        if execution.runtime.adapter_kind != AdapterKind::GrokBuild {
            anyhow::bail!("Grok native rules may only be prepared for grok-build");
        }
        let prepared = {
            let mut database = self.database.lock().await;
            ContextService.prepare_session_bootstrap(
                &mut database,
                &ManagedBlobStore::new(&self.data_dir),
                &execution.agent_run_id,
                execution.execution_epoch,
                CharterDeliveryMode::NativeAppend,
            )?
        };
        if prepared.native_binding_id != credential.native_binding_id
            || prepared.native_binding_generation != credential.native_binding_generation
            || prepared.delivery_mode != CharterDeliveryMode::NativeAppend
        {
            anyhow::bail!("Grok native rules Bootstrap does not match the prepared Native Binding");
        }
        if prepared.payload.trim().is_empty() {
            anyhow::bail!("Grok native rules Bootstrap is empty");
        }
        Ok(prepared.payload)
    }

    fn prepare_builtin_tool_process_config(&self) -> Result<BuiltinToolProcessConfig> {
        BuiltinToolProcessConfig::create(
            &bundled_cli_executable()?,
            &builtin_tool_endpoint(),
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
                Path::new(&execution.workspace.execution_root),
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

    async fn establish_acp_compaction_observer_best_effort(
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
        let adapter_kind = execution.runtime.adapter_kind;
        let host_instance_id = runtime.host_instance_id().to_string();
        let relay_process_id = runtime
            .builtin_tool_process_config()
            .map(BuiltinToolProcessConfig::process_id)
            .unwrap_or_default()
            .to_string();
        let lease = {
            let mut database = self.database.lock().await;
            establish_compaction_observer_lease(
                &mut database,
                &EstablishCompactionObserverLease {
                    agent_run_id: &execution.agent_run_id,
                    execution_epoch: execution.execution_epoch,
                    adapter_kind,
                    host_instance_id: &host_instance_id,
                    relay_process_id: &relay_process_id,
                    native_session_id,
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
    }

    async fn prepare_runtime_for_dispatch(
        &self,
        candidate: &rovai_core::runtime::QueuedAgentRunCandidate,
        runtime: FrozenAgentRuntimeConfig,
        workspace: &AgentRunWorkspace,
    ) -> std::result::Result<(FrozenAgentRuntimeConfig, i64), RuntimeDispatchFailure> {
        if let Some(blocker) = current_runtime_platform_blocker(runtime.adapter_kind) {
            return Err(RuntimeDispatchFailure {
                code: blocker.code,
                error: anyhow::anyhow!("{}", blocker.payload),
                effective_version: None,
            });
        }
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
                    .refresh_rebind_and_revalidate_runtime(
                        candidate,
                        runtime,
                        workspace,
                        &blocker.code,
                    )
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
            RuntimeIntegrityPreflight::Verified => {
                let effective_runtime =
                    acp::freeze_native_session_compatibility(runtime.clone(), workspace).map_err(
                        |error| RuntimeDispatchFailure {
                            code: "runtime_configuration_invalid".to_string(),
                            error,
                            effective_version: None,
                        },
                    )?;
                if effective_runtime == runtime {
                    Ok((runtime, candidate.version))
                } else {
                    self.persist_dispatch_runtime_rebind(
                        candidate,
                        effective_runtime,
                        "runtime_session_compatibility_frozen",
                    )
                    .await
                }
            }
            RuntimeIntegrityPreflight::DriftDetected(detail) => {
                self.refresh_rebind_and_revalidate_runtime(candidate, runtime, workspace, &detail)
                    .await
            }
        }
    }

    async fn refresh_rebind_and_revalidate_runtime(
        &self,
        candidate: &rovai_core::runtime::QueuedAgentRunCandidate,
        frozen_runtime: FrozenAgentRuntimeConfig,
        workspace: &AgentRunWorkspace,
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
            InstallationClass::ManagedDefault => match self
                .await_runtime_check(
                    frozen_runtime.adapter_kind,
                    RuntimeLaunchPurpose::DispatchPreflight,
                    RuntimeCheckTrigger::Execution,
                )
                .await
            {
                Ok(RuntimeCheckOutcome::Ready | RuntimeCheckOutcome::StableFailure) => Ok(()),
                Ok(RuntimeCheckOutcome::Superseded) => {
                    return Err(RuntimeDispatchFailure {
                        code: "runtime_check_deferred".to_string(),
                        error: anyhow::anyhow!("Runtime update superseded the dispatch preflight"),
                        effective_version: None,
                    });
                }
                Err(error) => Err(error),
            },
            InstallationClass::Custom => {
                let search = self.runtime_search_environment.read().await.clone();
                let deep_probe = with_runtime_search_environment(
                    &search,
                    self.deep_probe_candidate(
                        frozen_runtime.adapter_kind,
                        Path::new(&installation.executable_path),
                        RuntimeLaunchPurpose::DispatchPreflight,
                    ),
                )
                .await;
                match deep_probe {
                    Ok(deep_probe) => {
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
                                        snapshot: deep_probe.snapshot,
                                        failure: deep_probe.failure,
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
        let effective_runtime =
            acp::freeze_native_session_compatibility(effective_runtime, workspace).map_err(
                |error| RuntimeDispatchFailure {
                    code: "runtime_configuration_invalid".to_string(),
                    error,
                    effective_version: None,
                },
            )?;

        self.persist_dispatch_runtime_rebind(candidate, effective_runtime, drift_reason)
            .await
    }

    async fn persist_dispatch_runtime_rebind(
        &self,
        candidate: &rovai_core::runtime::QueuedAgentRunCandidate,
        effective_runtime: FrozenAgentRuntimeConfig,
        drift_reason: &str,
    ) -> std::result::Result<(FrozenAgentRuntimeConfig, i64), RuntimeDispatchFailure> {
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

    async fn verified_camp_runtime_authorization(
        &self,
        camp_id: &str,
        workspace: &Path,
    ) -> Result<CampAttachmentRuntimeAuthorization> {
        self.subsystems.require("attachments")?;
        let database = self.database.lock().await;
        self.attachment_views
            .camp_root_runtime_authorization(&database, camp_id, Some(workspace))
    }

    async fn launch_agent_run(
        self: &Arc<Self>,
        execution: &AgentRunExecution,
        attachment_admission: &CampAttachmentReadAdmission,
        attachment_authorization: &CampAttachmentRuntimeAuthorization,
        output: &mpsc::UnboundedSender<String>,
        launch_permit: &mut ExecutionLaunchPermit,
    ) -> Result<()> {
        self.require_execution_subsystems(execution.runtime.adapter_kind)?;
        attachment_admission.prove(&execution.camp_id)?;
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
        let attachment_access = CampAttachmentRunAccess {
            admission: attachment_admission,
            authorization: attachment_authorization,
        };
        let attachment_access_root = attachment_authorization.attachment_root.clone();
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
                    attachment_admission,
                    attachment_authorization,
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
                    attachment_admission,
                    attachment_authorization,
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
                    attachment_admission,
                    attachment_authorization,
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
            .prepare_initial_builtin_tool_binding(execution, resume_disposition)
            .await?;
        let builtin_tools = self.prepare_builtin_tool_process_config()?;
        let runtime_compatibility_digest = codex::runtime_compatibility_digest(
            &execution.runtime,
            &execution_root,
            attachment_authorization,
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
        let explicit_model = match execution.runtime.model.source.as_str() {
            "explicit" => {
                runtime.validate_explicit_model(model).await?;
                Some(model)
            }
            "runtime_default" => None,
            _ => anyhow::bail!("Codex model source is invalid"),
        };
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
                    model: explicit_model,
                    attachment_access_root: &attachment_access_root,
                    external_mcp_servers: &mcp_projection.servers,
                },
            )
            .await;
        let thread_id = match thread {
            Ok(thread_id) => thread_id,
            Err(error) if resumable_session_id.is_some() => {
                if resume_disposition != NativeSessionResumeDisposition::New {
                    let failure = classify_native_resume_failure(&error);
                    let mut database = self.database.lock().await;
                    if resume_disposition == NativeSessionResumeDisposition::Controlled {
                        ExecutionRuntimeService::default().record_native_session_resume_failure(
                            &mut database,
                            execution,
                            failure,
                        )?;
                    }
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
                            model: explicit_model,
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
                attachment_access,
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
            ContextService.prepare_input_delivery_for_context(
                &mut database,
                &execution.agent_run_id,
                execution.execution_epoch,
                &prepared_context,
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
                explicit_model,
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
        self.complete_active_runtime_route_handoff(
            execution,
            RuntimeRouteBinding {
                route_identity: runtime.host_instance_id().to_string(),
                adapter_turn_correlation: native_turn_id.clone(),
                provider_turn_id: Some(native_turn_id.clone()),
            },
            launch_permit,
        )
        .await?;
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
        emit_navigation_invalidated(output, "agent_run.started", Some(&execution.camp_id));
        record_available_runtime_model(
            self,
            output,
            AdapterKind::CodexCli,
            &execution.camp_id,
            &execution.agent_run_id,
            execution.execution_epoch,
            runtime.observed_model_id().await,
        )
        .await;
        Ok(())
    }

    async fn launch_claude_code_agent_run(&self, launch: PreparedRuntimeLaunch<'_>) -> Result<()> {
        let PreparedRuntimeLaunch {
            execution,
            resume_disposition,
            skill_exposure,
            mcp_projection,
            attachment_admission,
            attachment_authorization,
            output,
            launch_permit,
        } = launch;
        let attachment_access = CampAttachmentRunAccess {
            admission: attachment_admission,
            authorization: attachment_authorization,
        };
        let attachment_access_root = &attachment_authorization.attachment_root;
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
            .prepare_initial_builtin_tool_binding(execution, resume_disposition)
            .await?;
        let is_new_session = binding_credential.native_session_id.is_none();
        let native_session_id = binding_credential
            .native_session_id
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let Some(prepared_context) = self
            .materialize_agent_run_context(
                execution,
                attachment_access,
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
            ContextService.prepare_input_delivery_for_context(
                &mut database,
                &execution.agent_run_id,
                execution.execution_epoch,
                &prepared_context,
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
        emit_navigation_invalidated(output, "agent_run.started", Some(&execution.camp_id));
        let prompt = prepared_context.rendered_payload.clone();
        let builtin_tools = self.prepare_builtin_tool_process_config()?;
        self.bind_builtin_tool_runtime(&builtin_tools, execution, &binding_credential)
            .await?;
        let (input_accepted_sender, mut input_accepted_receiver) = mpsc::unbounded_channel();
        let (runtime_event_sender, mut runtime_event_receiver) = mpsc::unbounded_channel();
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
            runtime_events: Some(runtime_event_sender),
            launch_handoff: Some(launch_handoff_sender),
        });
        tokio::pin!(run);
        let mut early_result = tokio::select! {
            biased;
            handoff = &mut launch_handoff_receiver => {
                handoff.context("Claude Code launch handoff was lost")?;
                self.complete_active_runtime_route_handoff(
                    execution,
                    RuntimeRouteBinding {
                        route_identity: format!(
                            "claude-code-process:{}:{}",
                            execution.agent_run_id, execution.execution_epoch
                        ),
                        adapter_turn_correlation: native_turn_id.clone(),
                        provider_turn_id: None,
                    },
                    launch_permit,
                )
                .await?;
                None
            }
            result = &mut run => {
                Some(result)
            }
        };
        let result_and_acceptance: Result<_> = async {
            let mut accepted_input = None;
            let mut acceptance_channel_open = true;
            let mut runtime_event_channel_open = true;
            let result = loop {
                if let Some(result) = early_result.take() {
                    break result;
                }
                tokio::select! {
                    biased;
                    observed = input_accepted_receiver.recv(), if acceptance_channel_open => {
                        acceptance_channel_open = false;
                        let Some(observed_acceptance) = observed else {
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
                    }
                    runtime_event = runtime_event_receiver.recv(), if runtime_event_channel_open => {
                        let Some(runtime_event) = runtime_event else {
                            runtime_event_channel_open = false;
                            continue;
                        };
                        if let Err(error) = process_runtime_event(
                            self,
                            output,
                            RuntimeEventScope {
                                adapter_kind: AdapterKind::ClaudeCodeCli,
                                camp_id: &execution.camp_id,
                                agent_run_id: &execution.agent_run_id,
                                execution_epoch: execution.execution_epoch,
                                managed_output_root: Some(builtin_tools.run_tmp()),
                            },
                            runtime_event.event_type,
                            &runtime_event.payload,
                        ).await {
                            eprintln!(
                                "failed to persist Claude Code Runtime Evidence for AgentRun {}: {error:#}",
                                execution.agent_run_id
                            );
                        }
                    }
                    result = &mut run => break result,
                }
            };
            while let Ok(runtime_event) = runtime_event_receiver.try_recv() {
                if let Err(error) = process_runtime_event(
                    self,
                    output,
                    RuntimeEventScope {
                        adapter_kind: AdapterKind::ClaudeCodeCli,
                        camp_id: &execution.camp_id,
                        agent_run_id: &execution.agent_run_id,
                        execution_epoch: execution.execution_epoch,
                        managed_output_root: Some(builtin_tools.run_tmp()),
                    },
                    runtime_event.event_type,
                    &runtime_event.payload,
                )
                .await
                {
                    eprintln!(
                        "failed to persist queued Claude Code Runtime Evidence for AgentRun {}: {error:#}",
                        execution.agent_run_id
                    );
                }
            }
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
                    return Err(anyhow::anyhow!(
                        "Claude Code terminal identity did not match its accepted input evidence"
                    ))
                    .context(ClaudeCodeDeliveredFailure {
                        native_session_id: accepted.native_session_id.clone(),
                        native_turn_id: accepted.native_turn_id.clone(),
                        error_code: "runtime_session_incompatible".to_string(),
                        failure: RuntimeFailureView::new(
                            AdapterKind::ClaudeCodeCli,
                            RuntimeFailureOrigin::Compatibility,
                            RuntimeFailurePhase::Terminal,
                            "runtime_session_incompatible",
                            "Claude Code 返回了另一个会话的结果",
                            None,
                            false,
                        ),
                    });
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
                        return Err(error).context(ClaudeCodeDeliveredFailure {
                            native_session_id: accepted.native_session_id.clone(),
                            native_turn_id: accepted.native_turn_id.clone(),
                            error_code: "runtime_session_incompatible".to_string(),
                            failure: RuntimeFailureView::new(
                                AdapterKind::ClaudeCodeCli,
                                RuntimeFailureOrigin::Compatibility,
                                RuntimeFailurePhase::Terminal,
                                "runtime_session_incompatible",
                                "Claude Code 返回了另一个会话的结果",
                                None,
                                false,
                            ),
                        });
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
        if let Some(usage) = result.usage.as_ref() {
            let observations = parse_claude_result_usage(usage);
            if let Err(error) = buffer_runtime_usage(
                self,
                &execution.agent_run_id,
                execution.execution_epoch,
                &format!(
                    "claude-result:{}:{}",
                    result.native_session_id, result.native_turn_id
                ),
                &observations,
            )
            .await
            {
                eprintln!(
                    "failed to persist Claude Code Usage for AgentRun {}: {error:#}",
                    execution.agent_run_id
                );
            }
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
        if let Err(error) = flush_runtime_monitoring_run(
            self,
            &execution.agent_run_id,
            execution.execution_epoch,
            "terminal_flush",
        )
        .await
        {
            eprintln!(
                "failed to flush Runtime monitoring before terminal settlement for AgentRun {}: {error:#}",
                execution.agent_run_id
            );
        }
        let mut runtime_route_permit = self
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
        let mut terminal_admission = self
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
                terminal_admission.complete_settlement();
                runtime_route_permit.complete_callback();
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
                match terminal_admission.planned_permit() {
                    Some(permit) => service.succeed_agent_run_during_planned_shutdown(
                        &mut database,
                        permit,
                        &terminal_envelope,
                    ),
                    None => service.succeed_agent_run(&mut database, &terminal_envelope),
                }
            }?;
            if terminal.result.status != CommandResultStatus::Rejected {
                self.planned_shutdown
                    .remove_active(&ActiveExecutionKey::new(
                        &execution.agent_run_id,
                        execution.execution_epoch,
                    ))
                    .await;
                terminal_admission.complete_settlement();
                runtime_route_permit.complete_callback();
                emit_agent_run_terminal(
                    output,
                    Some(&current.camp_id),
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
                self.project_agent_run_file_changes_after_terminal(
                    &current.agent_run_id,
                    current.execution_epoch,
                )
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
            attachment_admission,
            attachment_authorization,
            output,
            launch_permit,
        } = launch;
        let attachment_access = CampAttachmentRunAccess {
            admission: attachment_admission,
            authorization: attachment_authorization,
        };
        let attachment_access_root = &attachment_authorization.attachment_root;
        let execution_root = PathBuf::from(&execution.workspace.execution_root);
        if !execution_root.is_dir() {
            anyhow::bail!(
                "AgentRun execution directory no longer exists: {}",
                execution_root.display()
            );
        }
        let binding_credential = self
            .prepare_initial_builtin_tool_binding(execution, resume_disposition)
            .await?;
        let Some(prepared_context) = self
            .materialize_agent_run_context(
                execution,
                attachment_access,
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
            ContextService.prepare_input_delivery_for_binding_context(
                &mut database,
                &execution.agent_run_id,
                execution.execution_epoch,
                &prepared_context,
                proposed_binding_id,
            )?
        } else {
            let mut database = self.database.lock().await;
            ContextService.prepare_input_delivery_for_context(
                &mut database,
                &execution.agent_run_id,
                execution.execution_epoch,
                &prepared_context,
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
        emit_navigation_invalidated(output, "agent_run.started", Some(&execution.camp_id));
        let builtin_tools = self.prepare_builtin_tool_process_config()?;
        self.bind_builtin_tool_runtime(&builtin_tools, execution, &binding_credential)
            .await?;
        let (input_accepted_sender, mut input_accepted_receiver) = mpsc::unbounded_channel();
        let (runtime_event_sender, mut runtime_event_receiver) = mpsc::unbounded_channel();
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
            runtime_events: Some(runtime_event_sender),
            launch_handoff: Some(launch_handoff_sender),
        });
        tokio::pin!(run);
        let mut early_result = tokio::select! {
            biased;
            handoff = &mut launch_handoff_receiver => {
                handoff.context("Antigravity launch handoff was lost")?;
                self.complete_active_runtime_route_handoff(
                    execution,
                    RuntimeRouteBinding {
                        route_identity: format!(
                            "agy-process:{}:{}",
                            execution.agent_run_id, execution.execution_epoch
                        ),
                        adapter_turn_correlation: native_turn_id.clone(),
                        provider_turn_id: None,
                    },
                    launch_permit,
                )
                .await?;
                None
            }
            result = &mut run => {
                Some(result)
            }
        };
        let result_and_acceptance: Result<_> = async {
            let mut accepted_input = None;
            let mut acceptance_channel_open = true;
            let mut runtime_event_channel_open = true;
            let result = loop {
                if let Some(result) = early_result.take() {
                    break result;
                }
                tokio::select! {
                    biased;
                    observed = input_accepted_receiver.recv(), if acceptance_channel_open => {
                        acceptance_channel_open = false;
                        let Some(observed_acceptance) = observed else {
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
                    }
                    runtime_event = runtime_event_receiver.recv(), if runtime_event_channel_open => {
                        let Some(runtime_event) = runtime_event else {
                            runtime_event_channel_open = false;
                            continue;
                        };
                        if let Err(error) = process_runtime_event(
                            self,
                            output,
                            RuntimeEventScope {
                                adapter_kind: AdapterKind::AntigravityApp,
                                camp_id: &execution.camp_id,
                                agent_run_id: &execution.agent_run_id,
                                execution_epoch: execution.execution_epoch,
                                managed_output_root: Some(builtin_tools.run_tmp()),
                            },
                            runtime_event.event_type,
                            &runtime_event.payload,
                        ).await {
                            eprintln!(
                                "failed to persist Antigravity Runtime Evidence for AgentRun {}: {error:#}",
                                execution.agent_run_id
                            );
                        }
                    }
                    result = &mut run => break result,
                }
            };
            while let Ok(runtime_event) = runtime_event_receiver.try_recv() {
                if let Err(error) = process_runtime_event(
                    self,
                    output,
                    RuntimeEventScope {
                        adapter_kind: AdapterKind::AntigravityApp,
                        camp_id: &execution.camp_id,
                        agent_run_id: &execution.agent_run_id,
                        execution_epoch: execution.execution_epoch,
                        managed_output_root: Some(builtin_tools.run_tmp()),
                    },
                    runtime_event.event_type,
                    &runtime_event.payload,
                )
                .await
                {
                    eprintln!(
                        "failed to persist queued Antigravity Runtime Evidence for AgentRun {}: {error:#}",
                        execution.agent_run_id
                    );
                }
            }
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
                        error_code: "runtime_native_session_mismatch".to_string(),
                        failure: RuntimeFailureView::new(
                            AdapterKind::AntigravityApp,
                            RuntimeFailureOrigin::Compatibility,
                            RuntimeFailurePhase::Terminal,
                            "runtime_native_session_mismatch",
                            "Antigravity 返回了另一个会话的结果",
                            None,
                            false,
                        ),
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
                            error_code: "runtime_native_session_mismatch".to_string(),
                            failure: RuntimeFailureView::new(
                                AdapterKind::AntigravityApp,
                                RuntimeFailureOrigin::Compatibility,
                                RuntimeFailurePhase::Terminal,
                                "runtime_native_session_mismatch",
                                "Antigravity 返回了另一个会话的结果",
                                None,
                                false,
                            ),
                        });
                    }
                    if let Some(error_code) = error
                        .downcast_ref::<AntigravityDeliveredFailure>()
                        .map(|delivered| delivered.error_code.clone())
                    {
                        return Err(error).context(error_code);
                    }
                    return Err(error).context(AntigravityDeliveredFailure {
                        native_session_id: accepted.native_session_id.clone(),
                        native_turn_id: accepted.native_turn_id.clone(),
                        error_code: "runtime_failed_after_input_accepted".to_string(),
                        failure: RuntimeFailureView::new(
                            AdapterKind::AntigravityApp,
                            RuntimeFailureOrigin::Unknown,
                            RuntimeFailurePhase::Execution,
                            "runtime_failed_after_input_accepted",
                            "Antigravity 接受输入后未能完成运行",
                            None,
                            true,
                        ),
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
            attachment_admission,
            attachment_authorization,
            output,
            launch_permit,
        } = launch;
        let attachment_access = CampAttachmentRunAccess {
            admission: attachment_admission,
            authorization: attachment_authorization,
        };
        let attachment_access_root = &attachment_authorization.attachment_root;
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
            .prepare_initial_builtin_tool_binding(execution, resume_disposition)
            .await?;
        let builtin_tools = self.prepare_builtin_tool_process_config()?;
        let mut runtime_compatibility_digest = acp::runtime_compatibility_digest(
            &execution.runtime,
            &execution.workspace,
            execution.permission_semantics,
            &mcp_projection.servers,
            &mcp_projection.projection_digest,
            attachment_authorization,
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
        let session_capabilities = acp::AcpSessionCapabilities {
            can_resume: execution
                .runtime
                .capabilities
                .iter()
                .any(|capability| capability == "session.resume"),
            can_load_history: execution
                .runtime
                .capabilities
                .iter()
                .any(|capability| capability == "session.load"),
        };
        let mut binding_credential = initial_binding;
        let mut session_continuation = runtime
            .session_continuation(
                binding_credential.native_session_id.as_deref(),
                session_capabilities,
            )
            .await;
        if binding_credential.native_session_id.is_some()
            && session_continuation == acp::AcpSessionContinuation::New
        {
            binding_credential = self.prepare_builtin_tool_binding(execution, true).await?;
            session_continuation = acp::AcpSessionContinuation::New;
        }
        let charter_delivery_mode =
            charter_delivery_mode_for_adapter(execution.runtime.adapter_kind);
        let new_session_native_rules = if execution.runtime.adapter_kind == AdapterKind::GrokBuild
            && session_continuation == acp::AcpSessionContinuation::New
        {
            Some(
                self.prepare_grok_native_session_rules(execution, &binding_credential)
                    .await?,
            )
        } else {
            None
        };
        self.bind_builtin_tool_runtime(&active_builtin_tools, execution, &binding_credential)
            .await?;
        let resumable_session_id = binding_credential.native_session_id.clone();
        let model = execution.runtime.model.model_id.as_str();
        let session = runtime
            .start_or_resume_session_with_native_rules(
                resumable_session_id.as_deref(),
                session_capabilities,
                &execution.runtime.model.source,
                model,
                &execution.runtime.model.options,
                &mcp_projection.servers,
                new_session_native_rules.as_deref(),
            )
            .await;
        let session_id = match session {
            Ok(session_id) => session_id,
            Err(error)
                if resumable_session_id.is_some()
                    && error
                        .downcast_ref::<AcpLiveModelValidationError>()
                        .is_none() =>
            {
                let failure = classify_native_resume_failure(&error);
                eprintln!(
                    "{} Native Session {:?} failed for AgentRun {}; continuity is lost and a new Session will be created: {error:#}",
                    execution.runtime.adapter_kind.as_str(),
                    session_continuation,
                    execution.agent_run_id,
                );
                if resume_disposition != NativeSessionResumeDisposition::New {
                    let mut database = self.database.lock().await;
                    if resume_disposition == NativeSessionResumeDisposition::Controlled {
                        ExecutionRuntimeService::default().record_native_session_resume_failure(
                            &mut database,
                            execution,
                            failure,
                        )?;
                    }
                }
                {
                    let mut database = self.database.lock().await;
                    ExecutionRuntimeService::default().record_native_session_continuity_lost(
                        &mut database,
                        execution,
                        match session_continuation {
                            acp::AcpSessionContinuation::ReuseSameHost => "same_host_reuse",
                            acp::AcpSessionContinuation::Resume => "acp_session_resume",
                            acp::AcpSessionContinuation::HistoryRestore => "acp_history_restore",
                            acp::AcpSessionContinuation::New => "new_session",
                        },
                        failure,
                    )?;
                }
                adapter
                    .forget_agent_run(&execution.agent_run_id, execution.execution_epoch)
                    .await;
                let replacement_binding =
                    self.prepare_builtin_tool_binding(execution, true).await?;
                let replacement_native_rules =
                    if execution.runtime.adapter_kind == AdapterKind::GrokBuild {
                        Some(
                            self.prepare_grok_native_session_rules(execution, &replacement_binding)
                                .await?,
                        )
                    } else {
                        None
                    };
                runtime_compatibility_digest = acp::runtime_compatibility_digest(
                    &execution.runtime,
                    &execution.workspace,
                    execution.permission_semantics,
                    &mcp_projection.servers,
                    &mcp_projection.projection_digest,
                    attachment_authorization,
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
                    .start_or_resume_session_with_native_rules(
                        None,
                        session_capabilities,
                        &execution.runtime.model.source,
                        model,
                        &execution.runtime.model.options,
                        &mcp_projection.servers,
                        replacement_native_rules.as_deref(),
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
        self.establish_acp_compaction_observer_best_effort(execution, &runtime, &session_id)
            .await;
        let Some((prepared_context, delivery)) = self
            .materialize_and_prepare_agent_run_input(
                execution,
                attachment_access,
                skill_exposure,
                mcp_projection,
                charter_delivery_mode,
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
        runtime
            .arm_grok_auto_compact_for_acceptance_if_requested()
            .await?;
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
        self.complete_active_runtime_route_handoff(
            execution,
            RuntimeRouteBinding {
                route_identity: runtime.host_instance_id().to_string(),
                adapter_turn_correlation: native_prompt_id.clone(),
                provider_turn_id: None,
            },
            launch_permit,
        )
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
                "nativeThreadId": session_id,
                "nativeTurnId": native_prompt_id,
            }),
        );
        emit_navigation_invalidated(output, "agent_run.started", Some(&execution.camp_id));
        record_available_runtime_model(
            self,
            output,
            execution.runtime.adapter_kind,
            &execution.camp_id,
            &execution.agent_run_id,
            execution.execution_epoch,
            runtime.observed_model_id().await,
        )
        .await;
        Ok(())
    }

    async fn fail_claimed_agent_run(
        &self,
        output: &mpsc::UnboundedSender<String>,
        execution: &AgentRunExecution,
        error_code: &str,
        error: &anyhow::Error,
        runtime_terminal_observed: bool,
        public_failure: Option<RuntimeFailureView>,
    ) {
        let file_change_ingress_flushed = match self
            .agent_run_runtime(&execution.agent_run_id, execution.execution_epoch)
            .await
        {
            Some(runtime) => run_with_cancellation_deadline(
                RUNTIME_CANCELLATION_INGRESS_FLUSH_TIMEOUT,
                runtime.detach_and_flush_ingress(),
            )
            .await
            .is_some_and(|flushed| flushed),
            // A failure before the Adapter registered a Runtime cannot have a
            // routed Runtime file event waiting in Core's ingress queue.
            None => true,
        };
        if let Err(flush_error) = flush_runtime_monitoring_run(
            self,
            &execution.agent_run_id,
            execution.execution_epoch,
            "terminal_flush",
        )
        .await
        {
            eprintln!(
                "failed to flush Runtime monitoring before failing AgentRun {}: {flush_error:#}",
                execution.agent_run_id
            );
        }
        let ending_git_observation = self
            .observe_run_git(&execution.project_binding_kind, &execution.project_path)
            .await;
        if let Some(adapter) = self.acp_adapter(execution.runtime.adapter_kind) {
            adapter
                .prepare_agent_run_terminal_visibility(
                    &execution.agent_run_id,
                    execution.execution_epoch,
                )
                .await;
        }
        let failure_persisted = self
            .persist_claimed_agent_run_failure(
                execution,
                error_code,
                error,
                runtime_terminal_observed,
                public_failure,
                ending_git_observation,
            )
            .await;
        if failure_persisted {
            emit_agent_run_terminal(
                output,
                Some(&execution.camp_id),
                json!({
                    "campId": execution.camp_id,
                    "campTurnId": execution.camp_turn_id,
                    "agentRunId": execution.agent_run_id,
                    "executionEpoch": execution.execution_epoch,
                    "adapterKind": execution.runtime.adapter_kind,
                    "reasonCode": error_code,
                }),
            );
        }
        self.finish_claimed_agent_run_failure(
            execution,
            failure_persisted,
            file_change_ingress_flushed,
        )
        .await;
    }

    async fn persist_claimed_agent_run_failure(
        &self,
        execution: &AgentRunExecution,
        error_code: &str,
        error: &anyhow::Error,
        runtime_terminal_observed: bool,
        public_failure: Option<RuntimeFailureView>,
        ending_git_observation: Option<git::GitObservation>,
    ) -> bool {
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
                    failure: public_failure,
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
        match failure {
            Ok(terminal) if terminal.result.status != CommandResultStatus::Rejected => true,
            Ok(_) => false,
            Err(failure_error) => {
                eprintln!(
                    "failed to persist AgentRun {} launch failure: {failure_error:#}",
                    execution.agent_run_id
                );
                false
            }
        }
    }

    async fn finish_claimed_agent_run_failure(
        &self,
        execution: &AgentRunExecution,
        failure_persisted: bool,
        file_change_ingress_flushed: bool,
    ) {
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
            | rovai_core::agent_profile::AdapterKind::QwenCode
            | rovai_core::agent_profile::AdapterKind::TraeCnCli
            | rovai_core::agent_profile::AdapterKind::CursorAgent
            | rovai_core::agent_profile::AdapterKind::KimiCodeCli
            | rovai_core::agent_profile::AdapterKind::GrokBuild) => {
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
        if failure_persisted && file_change_ingress_flushed {
            self.project_agent_run_file_changes_after_terminal(
                &execution.agent_run_id,
                execution.execution_epoch,
            )
            .await;
        } else if failure_persisted {
            eprintln!(
                "AgentRun {} failure ingress did not flush; file-change projection remains recoverable instead of freezing no_changes",
                execution.agent_run_id
            );
        }
    }

    async fn fail_unmaterialized_agent_run(
        &self,
        output: &mpsc::UnboundedSender<String>,
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
                        failure: None,
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
            emit_agent_run_terminal(
                output,
                Some(&candidate.camp_id),
                json!({
                    "campId": candidate.camp_id,
                    "campTurnId": candidate.camp_turn_id,
                    "agentRunId": candidate.agent_run_id,
                    "executionEpoch": execution_epoch,
                    "reasonCode": "runtime_configuration_invalid",
                }),
            );
            self.reconcile_skill_projection_after_run_terminal(
                &candidate.execution_workspace().execution_root,
            )
            .await;
            self.project_agent_run_file_changes_after_terminal(
                &candidate.agent_run_id,
                execution_epoch,
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

    async fn project_agent_run_file_changes_after_terminal(
        &self,
        agent_run_id: &str,
        execution_epoch: i64,
    ) -> Option<agent_run_file_change::AgentRunFileChangesView> {
        let projection = {
            let mut database = self.database.lock().await;
            AgentRunFileChangeProjector.project_terminal_run(
                &mut database,
                &ManagedBlobStore::new(&self.data_dir),
                agent_run_id,
                execution_epoch,
            )
        };
        match projection {
            Ok(Some(view)) => {
                emit(
                    &self.output,
                    "agent_run.file_changes_completed",
                    serde_json::to_value(&view).unwrap_or_else(|_| {
                        json!({
                            "agentRunId": agent_run_id,
                            "executionEpoch": execution_epoch,
                        })
                    }),
                );
                Some(view)
            }
            Ok(None) => None,
            Err(error) => {
                eprintln!(
                    "AgentRun file-change projection failed for {agent_run_id}/{execution_epoch}: {error:#}"
                );
                None
            }
        }
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
    failure: Option<RuntimeFailureView>,
) {
    let (status, priority) = match failure_class {
        "authentication_required" => ("authentication_required", 4),
        "identity_changed" | "incompatible" => ("incompatible", 3),
        "transient" => ("needs_attention", 2),
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
        failure,
    });
}

fn product_runtime_availability_status(
    discovery_status: RuntimeDiscoveryStatus,
    installation: Option<&AdapterInstallationView>,
    product_diagnostic: Option<&ProductRuntimeDiagnostic>,
    checking: bool,
) -> &'static str {
    if let Some(installation) = installation {
        let failed_attempt = relevant_failed_runtime_probe_attempt(installation);
        if !installation.enabled {
            return "disabled";
        }
        if installation.path_state == "path_missing" {
            return "path_missing";
        }
        if installation
            .snapshot
            .as_ref()
            .is_some_and(|snapshot| snapshot.probe_status == "ready" && snapshot.stale_at.is_none())
        {
            if checking {
                return "ready";
            }
            return if product_diagnostic.is_some()
                || failed_attempt.is_some_and(|attempt| attempt.failure_class == "transient")
            {
                "refresh_failed_using_last_success"
            } else {
                "ready"
            };
        }
        if checking {
            return "checking";
        }
        if let Some(diagnostic) = product_diagnostic {
            return diagnostic.status;
        }
        if installation
            .snapshot
            .as_ref()
            .is_some_and(|snapshot| snapshot.probe_status == "installed_unverified")
        {
            let snapshot_fingerprint = installation
                .snapshot
                .as_ref()
                .and_then(|snapshot| snapshot.executable_fingerprint.as_deref());
            if failed_attempt.is_some_and(|attempt| {
                attempt.executable_fingerprint.as_deref() == snapshot_fingerprint
                    && attempt.failure_class == "authentication_required"
            }) {
                return "authentication_required";
            }
            if failed_attempt.is_some_and(|attempt| {
                attempt.executable_fingerprint.as_deref() == snapshot_fingerprint
                    && matches!(
                        attempt.failure_class.as_str(),
                        "incompatible" | "identity_changed"
                    )
            }) {
                return "incompatible";
            }
            if failed_attempt.is_some_and(|attempt| {
                attempt.executable_fingerprint.as_deref() == snapshot_fingerprint
            }) {
                return "needs_attention";
            }
            return "installed_unverified";
        }
        if installation.snapshot.as_ref().is_some_and(|snapshot| {
            snapshot.probe_status == "light_ready" && snapshot.stale_at.is_none()
        }) {
            let snapshot_fingerprint = installation
                .snapshot
                .as_ref()
                .and_then(|snapshot| snapshot.executable_fingerprint.as_deref());
            if failed_attempt.is_some_and(|attempt| {
                attempt.executable_fingerprint.as_deref() == snapshot_fingerprint
                    && attempt.failure_class == "authentication_required"
            }) {
                return "authentication_required";
            }
            if failed_attempt.is_some_and(|attempt| {
                attempt.executable_fingerprint.as_deref() == snapshot_fingerprint
                    && matches!(
                        attempt.failure_class.as_str(),
                        "incompatible" | "identity_changed"
                    )
            }) {
                return "incompatible";
            }
            if failed_attempt.is_some_and(|attempt| {
                attempt.executable_fingerprint.as_deref() == snapshot_fingerprint
            }) {
                return "needs_attention";
            }
            return "light_ready";
        }
        if installation.snapshot.as_ref().is_some_and(|snapshot| {
            snapshot.probe_status == "light_failed" && snapshot.stale_at.is_none()
        }) {
            return "needs_attention";
        }
        if failed_attempt.is_some_and(|attempt| attempt.failure_class == "authentication_required")
        {
            return "authentication_required";
        }
        if failed_attempt.is_some_and(|attempt| {
            matches!(
                attempt.failure_class.as_str(),
                "incompatible" | "identity_changed"
            )
        }) {
            return "incompatible";
        }
        return if discovery_status == RuntimeDiscoveryStatus::Found {
            "found_uninspected"
        } else {
            "missing"
        };
    }
    if checking {
        return "checking";
    }
    if let Some(diagnostic) = product_diagnostic {
        return diagnostic.status;
    }
    match discovery_status {
        RuntimeDiscoveryStatus::Detecting => "detecting",
        RuntimeDiscoveryStatus::Found => "found_uninspected",
        RuntimeDiscoveryStatus::Missing => "missing",
    }
}

fn relevant_failed_runtime_probe_attempt(
    installation: &AdapterInstallationView,
) -> Option<&AdapterProbeAttempt> {
    // Probe attempts outlive discovery snapshots. Only failures that still describe
    // the current executable and have not been superseded may affect public status.
    let attempt = installation
        .last_probe_attempt
        .as_ref()
        .filter(|attempt| attempt.status == "failed")?;
    if let Some(snapshot) = installation.snapshot.as_ref() {
        if attempt.executable_fingerprint.as_deref() != snapshot.executable_fingerprint.as_deref() {
            return None;
        }
        if snapshot
            .last_successful_probe_at
            .as_deref()
            .is_some_and(|last_success| runtime_attempt_precedes(attempt, last_success))
        {
            return None;
        }
    }
    Some(attempt)
}

fn runtime_attempt_precedes(attempt: &AdapterProbeAttempt, timestamp: &str) -> bool {
    let Ok(attempted_at) = chrono::DateTime::parse_from_rfc3339(&attempt.attempted_at) else {
        return false;
    };
    let Ok(last_successful_at) = chrono::DateTime::parse_from_rfc3339(timestamp) else {
        return false;
    };
    attempted_at < last_successful_at
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
    if let Some(root) = parse_windows_data_root_preparation()? {
        let layout = prepare_windows_data_root(&root)?;
        println!("{}", serde_json::to_string(&layout)?);
        return Ok(());
    }
    let startup_started_at = Instant::now();
    // This snapshot is intentionally captured before Tokio exists. Runtime discovery and every
    // child launch receive it explicitly; Rovai never mutates process-global PATH.
    let runtime_search_started_at = Instant::now();
    let runtime_search_environment = Arc::new(RuntimeSearchEnvironment::capture_initial());
    runtime_search_environment.activate_for_runtime_commands();
    eprintln!(
        "[startup] stage=runtime_search_ready duration_ms={} elapsed_ms={}",
        runtime_search_started_at.elapsed().as_millis(),
        startup_started_at.elapsed().as_millis(),
    );
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .context("failed to create Core Tokio Runtime")?;
    let result = runtime.block_on(run_core(runtime_search_environment, startup_started_at));
    runtime.shutdown_timeout(Duration::from_millis(250));
    result
}

async fn process_attachment_projection_worker(
    core: Arc<Core>,
    mut requests: mpsc::UnboundedReceiver<String>,
    mut shutdown: oneshot::Receiver<()>,
) {
    let mut active_camps = HashSet::new();
    let mut rerun_camps = HashSet::new();
    let mut tasks = tokio::task::JoinSet::new();
    loop {
        tokio::select! {
            biased;
            _ = &mut shutdown => break,
            camp_id = requests.recv() => {
                let Some(camp_id) = camp_id else { break };
                if active_camps.insert(camp_id.clone()) {
                    spawn_attachment_projection_task(&mut tasks, core.clone(), camp_id);
                } else {
                    rerun_camps.insert(camp_id);
                }
            }
            completed = tasks.join_next(), if !tasks.is_empty() => {
                match completed {
                    Some(Ok((camp_id, result))) => {
                        active_camps.remove(&camp_id);
                        if let Err(error) = result {
                            eprintln!("Camp Attachment projection for {camp_id} requires recovery: {error:#}");
                        }
                        if rerun_camps.remove(&camp_id) {
                            active_camps.insert(camp_id.clone());
                            spawn_attachment_projection_task(&mut tasks, core.clone(), camp_id);
                        }
                    }
                    Some(Err(error)) => {
                        eprintln!("Camp Attachment projection task failed: {error}");
                    }
                    None => {}
                }
            }
        }
    }
    while let Some(completed) = tasks.join_next().await {
        match completed {
            Ok((camp_id, Err(error))) => eprintln!(
                "Camp Attachment projection for {camp_id} requires recovery during shutdown: {error:#}"
            ),
            Ok((_, Ok(()))) => {}
            Err(error) => {
                eprintln!("Camp Attachment projection task failed during shutdown: {error}")
            }
        }
    }
}

fn spawn_attachment_projection_task(
    tasks: &mut tokio::task::JoinSet<(String, Result<()>)>,
    core: Arc<Core>,
    camp_id: String,
) {
    tasks.spawn(async move {
        let result = core.drive_camp_attachment_publications(&camp_id).await;
        (camp_id, result)
    });
}

async fn run_core(
    runtime_search_environment: Arc<RuntimeSearchEnvironment>,
    startup_started_at: Instant,
) -> Result<()> {
    let data_dir = parse_data_dir()?;
    let skill_library_root = parse_skill_library_root()?;
    let data_dir_lease = match CoreDataDirLease::try_acquire(&data_dir) {
        Ok(CoreDataDirLeaseAcquisition::Acquired(lease)) => lease,
        Ok(CoreDataDirLeaseAcquisition::OwnedByActiveCore { data_dir, owner }) => {
            write_startup_frame(
                "blocked",
                Some("lease"),
                json!({
                    "kind": "owned_by_active_core",
                    "dataDir": data_dir,
                    "owner": owner,
                }),
                None,
                None,
            )?;
            return Ok(());
        }
        Err(error) => {
            write_startup_frame(
                "failed",
                Some("lease"),
                json!({ "kind": "unknown" }),
                Some(structured_startup_error(
                    "core_data_dir_lease_infrastructure_failed",
                    error.to_string(),
                    false,
                    json!({ "stage": error.stage }),
                )),
                None,
            )?;
            return Ok(());
        }
    };
    write_startup_frame(
        "phase",
        Some("assessing_authority"),
        json!({ "kind": "assessing" }),
        None,
        None,
    )?;
    let admission = match DatabaseAdmission::assess(&data_dir_lease) {
        Ok(AdmissionAssessment::Blocked(block)) => {
            write_authority_block(&block)?;
            return Ok(());
        }
        Ok(admission) => admission,
        Err(error) => {
            write_startup_frame(
                "failed",
                Some("assessing_authority"),
                json!({ "kind": "unknown" }),
                Some(structured_startup_error(
                    &error.code,
                    error.message,
                    false,
                    json!({ "stage": "database_admission" }),
                )),
                None,
            )?;
            return Ok(());
        }
    };
    #[cfg(target_os = "macos")]
    configure_user_automation_denial_root(&data_dir.join("automation-v1"))?;
    let runtime_camp_files_root = parse_runtime_camp_files_root()?;
    let attachment_views = match CampAttachmentViewStore::admit(
        &runtime_camp_files_root,
        &data_dir,
        std::slice::from_ref(&skill_library_root),
    ) {
        Ok(store) => store,
        Err(error) => {
            write_startup_frame(
                "failed",
                Some("preparing_runtime_storage"),
                json!({ "kind": "admitted" }),
                Some(structured_startup_error(
                    "runtime_camp_files_root_admission_failed",
                    format!("{error:#}"),
                    false,
                    json!({ "stage": "runtime_storage" }),
                )),
                None,
            )?;
            return Ok(());
        }
    };
    let mcp_config_path = parse_mcp_config_path()?;
    let database_started_at = Instant::now();
    let (mut database, authority_origin) = match admission {
        AdmissionAssessment::AdmittedExisting(ticket) => {
            write_startup_frame(
                "phase",
                Some("opening_authority"),
                json!({ "kind": "admitted" }),
                None,
                None,
            )?;
            match Database::open_admitted_with_runtime_camp_files_root(
                *ticket,
                attachment_views.root(),
                attachment_views.root_identity_digest(),
            ) {
                Ok(database) => (database, "existing"),
                Err(error) => {
                    write_database_open_refusal(&error)?;
                    return Ok(());
                }
            }
        }
        AdmissionAssessment::Initializable(ticket) => {
            write_startup_frame(
                "phase",
                Some("initializing_authority"),
                json!({ "kind": "confirmed_absent" }),
                None,
                None,
            )?;
            match Database::initialize_new_with_runtime_camp_files_root(
                *ticket,
                attachment_views.root(),
                attachment_views.root_identity_digest(),
            ) {
                Ok(database) => (database, "initialized"),
                Err(error) => {
                    write_database_initialize_refusal(&error)?;
                    return Ok(());
                }
            }
        }
        AdmissionAssessment::RequiresMigration(ticket) => {
            write_startup_frame(
                "phase",
                Some("migrating_authority"),
                json!({ "kind": "migration_required" }),
                None,
                None,
            )?;
            let migration = AuthorityMigrationRunner::run_with_progress(
                *ticket,
                attachment_views.root(),
                attachment_views.root_identity_digest(),
                |progress: AuthorityMigrationProgress| {
                    let _ = write_startup_frame(
                        "phase",
                        Some("migrating_authority"),
                        json!({ "kind": "migration_required" }),
                        None,
                        serde_json::to_value(progress).ok(),
                    );
                },
            );
            match migration {
                Ok(database) => (database, "migrated"),
                Err(error) => {
                    write_database_migration_refusal(&error)?;
                    return Ok(());
                }
            }
        }
        AdmissionAssessment::Blocked(_) => {
            unreachable!("blocked admission returns before Runtime storage side effects")
        }
    };
    eprintln!(
        "[startup] stage=database_ready duration_ms={} elapsed_ms={}",
        database_started_at.elapsed().as_millis(),
        startup_started_at.elapsed().as_millis(),
    );
    // These recoveries fence durable execution/input state. Unlike optional
    // filesystem maintenance, their failure cannot expose normal execution.
    let compaction_detector_policies =
        DesiredCompactionDetectorPolicies::from_process_environment();
    let recovery = (|| -> Result<_> {
        rovai_core::pending_camp_input::recover_edit_sessions(&database)?;
        let controlled = ExecutionRuntimeService::default()
            .recover_interrupted_controlled_shutdowns(&mut database)?;
        // Preserve the existing best-effort observer semantics and ordering:
        // replay old signals before fencing old leases, and never repeat the
        // process-start fence after new Runtime observers can be registered.
        for diagnostic in &compaction_detector_policies.diagnostics {
            eprintln!("Compaction detector policy diagnostic: {diagnostic}");
        }
        if let Err(error) =
            reconcile_detector_policies(&mut database, &compaction_detector_policies)
        {
            eprintln!("Compaction policy reconciliation unavailable: {error:#}");
        }
        if let Err(error) =
            reconcile_compaction_observation_outbox(&mut database, &data_dir.join("runtime"), None)
        {
            eprintln!("Compaction observation outbox reconciliation unavailable: {error:#}");
        }
        if let Err(error) = fence_active_observers_on_core_start(&mut database) {
            eprintln!("Stale Compaction Observer fencing unavailable: {error:#}");
        }
        database.prepare_v2_recovery()?;
        mark_unstarted_deliveries_interrupted_before_dispatch(&mut database)?;
        Ok(controlled)
    })();
    let controlled_shutdown_recovery = match recovery {
        Ok(recovery) => recovery,
        Err(error) => {
            write_startup_frame(
                "failed",
                Some("recovering_authority"),
                json!({ "kind": "admitted" }),
                Some(structured_startup_error(
                    "authority_recovery_failed",
                    format!("{error:#}"),
                    true,
                    json!({ "stage": "authority_recovery" }),
                )),
                None,
            )?;
            return Ok(());
        }
    };
    // Freeze candidate IDs before exposing RPC, then recheck eligibility at
    // deletion time. A failed optional snapshot skips cleanup for this boot;
    // neither fail authority readiness nor rescan newly created Camps on retry.
    let startup_pending_camp_ids = CollaborationService::default()
        .snapshot_pending_camps_for_startup_cleanup(&database)
        .unwrap_or_else(|error| {
            eprintln!("Startup pending Camp cleanup skipped: {error:#}");
            Vec::new()
        });
    let startup_skill_execution_roots = controlled_shutdown_recovery
        .fenced_agent_runs
        .iter()
        .map(|run| run.execution_root.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let skill_library = SkillLibraryService::deferred(skill_library_root);
    let mcp_config = mcp_config_path
        .map_or_else(McpConfigStore::default_path, Ok)
        .map(McpConfigStore::new);
    let mcp_projection = McpProjectionService::new(&data_dir);
    let (codex_tx, codex_rx) = mpsc::unbounded_channel();
    let (acp_tx, acp_rx) = mpsc::unbounded_channel();
    let (output_tx, output_rx) = mpsc::unbounded_channel();
    let (output_control_tx, output_control_rx) = mpsc::channel(1);
    let (runtime_check_tx, runtime_check_rx) = mpsc::unbounded_channel();
    let (attachment_projection_tx, attachment_projection_rx) = mpsc::unbounded_channel();
    let output_handle = tokio::spawn(write_output(output_rx, output_control_rx));
    let (event_shutdown_tx, event_shutdown_rx) = oneshot::channel();
    let antigravity_app = AntigravityAppRuntimeAdapter::deferred(&data_dir);
    let claude_code_cli = ClaudeCodeCliRuntimeAdapter::deferred(&data_dir);
    let builtin_tool_leases = Arc::new(BuiltinToolLeaseRegistry::default());
    let runtime_fleet = Arc::new(AgentRuntimeFleetManager::new_with_builtin_tools(
        AgentRuntimeFleetConfig::default(),
        &data_dir,
        builtin_tool_leases.clone(),
    ));
    let planned_shutdown = PlannedShutdownCoordinator::new(uuid::Uuid::new_v4().to_string());
    let core = Arc::new(Core {
        database: Mutex::new(database),
        subsystems: CoreSubsystems::new(),
        subsystem_initialization: Mutex::new(SubsystemInitialization::default()),
        startup_skill_execution_roots,
        startup_pending_camp_ids,
        builtin_tool_listener: Mutex::new(None),
        builtin_tool_listener_notify: Notify::new(),
        runtime_usage: Mutex::new(RuntimeUsageBuffer::default()),
        runtime_usage_flush: Mutex::new(()),
        output: output_tx.clone(),
        runtime_search_environment: RwLock::new(runtime_search_environment.clone()),
        runtime_discovery: RwLock::new(
            current_platform_qualified_runtime_kinds()
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
        runtime_check_activity: RwLock::new(BTreeMap::new()),
        runtime_check_requests: runtime_check_tx,
        attachment_projection_requests: attachment_projection_tx,
        compaction_detector_policies: compaction_detector_policies.clone(),
        agent_run_cancellation_notify: Notify::new(),
        pending_execution_recovery: Mutex::new(()),
        skill_library,
        mcp_config,
        mcp_projection,
        codex_cli: CodexCliRuntimeAdapter::new(codex_tx, runtime_fleet.clone()),
        opencode_cli: AcpCliRuntimeAdapter::deferred(
            rovai_core::agent_profile::AdapterKind::OpencodeCli,
            acp_tx.clone(),
            data_dir.join("runtime/opencode"),
            runtime_fleet.clone(),
            compaction_detector_policies
                .policy_for(AdapterKind::OpencodeCli)
                .unwrap_or(CompactionDetectorPolicy::Disabled),
        ),
        copilot_cli: AcpCliRuntimeAdapter::deferred(
            rovai_core::agent_profile::AdapterKind::CopilotCli,
            acp_tx.clone(),
            data_dir.join("runtime/copilot"),
            runtime_fleet.clone(),
            compaction_detector_policies
                .policy_for(AdapterKind::CopilotCli)
                .unwrap_or(CompactionDetectorPolicy::Disabled),
        ),
        kiro_cli: AcpCliRuntimeAdapter::deferred(
            rovai_core::agent_profile::AdapterKind::KiroCli,
            acp_tx.clone(),
            data_dir.join("runtime/kiro"),
            runtime_fleet.clone(),
            compaction_detector_policies
                .policy_for(AdapterKind::KiroCli)
                .unwrap_or(CompactionDetectorPolicy::Disabled),
        ),
        qoder_cli: AcpCliRuntimeAdapter::deferred(
            rovai_core::agent_profile::AdapterKind::QoderCli,
            acp_tx.clone(),
            data_dir.join("runtime/qoder"),
            runtime_fleet.clone(),
            compaction_detector_policies
                .policy_for(AdapterKind::QoderCli)
                .unwrap_or(CompactionDetectorPolicy::Disabled),
        ),
        codebuddy_cli: AcpCliRuntimeAdapter::deferred(
            rovai_core::agent_profile::AdapterKind::CodebuddyCli,
            acp_tx.clone(),
            data_dir.join("runtime/codebuddy"),
            runtime_fleet.clone(),
            compaction_detector_policies
                .policy_for(AdapterKind::CodebuddyCli)
                .unwrap_or(CompactionDetectorPolicy::Disabled),
        ),
        qwen_code: AcpCliRuntimeAdapter::deferred(
            rovai_core::agent_profile::AdapterKind::QwenCode,
            acp_tx.clone(),
            data_dir.join("runtime/qwen"),
            runtime_fleet.clone(),
            compaction_detector_policies
                .policy_for(AdapterKind::QwenCode)
                .unwrap_or(CompactionDetectorPolicy::Disabled),
        ),
        trae_cn_cli: AcpCliRuntimeAdapter::deferred(
            rovai_core::agent_profile::AdapterKind::TraeCnCli,
            acp_tx.clone(),
            data_dir.join("runtime/trae-cn"),
            runtime_fleet.clone(),
            CompactionDetectorPolicy::Disabled,
        ),
        cursor_agent: AcpCliRuntimeAdapter::deferred(
            rovai_core::agent_profile::AdapterKind::CursorAgent,
            acp_tx.clone(),
            data_dir.join("runtime/cursor"),
            runtime_fleet.clone(),
            CompactionDetectorPolicy::Disabled,
        ),
        kimi_code_cli: AcpCliRuntimeAdapter::deferred(
            rovai_core::agent_profile::AdapterKind::KimiCodeCli,
            acp_tx.clone(),
            data_dir.join("runtime/kimi-code"),
            runtime_fleet.clone(),
            compaction_detector_policies
                .policy_for(AdapterKind::KimiCodeCli)
                .unwrap_or(CompactionDetectorPolicy::Disabled),
        ),
        grok_build: AcpCliRuntimeAdapter::deferred(
            rovai_core::agent_profile::AdapterKind::GrokBuild,
            acp_tx,
            data_dir.join("runtime/grok-build"),
            runtime_fleet.clone(),
            compaction_detector_policies
                .policy_for(AdapterKind::GrokBuild)
                .unwrap_or(CompactionDetectorPolicy::Disabled),
        ),
        claude_code_cli,
        antigravity_app,
        planned_shutdown,
        agent_run_tasks: Mutex::new(tokio::task::JoinSet::new()),
        attachment_views,
        attachment_view_gates: Mutex::new(HashMap::new()),
        runtime_fleet,
        builtin_tool_leases,
        data_dir,
    });
    let (attachment_projection_shutdown_tx, attachment_projection_shutdown_rx) = oneshot::channel();
    let mut attachment_projection_handle = tokio::spawn(process_attachment_projection_worker(
        core.clone(),
        attachment_projection_rx,
        attachment_projection_shutdown_rx,
    ));
    let (fleet_sweeper_shutdown_tx, fleet_sweeper_shutdown_rx) = oneshot::channel();
    let mut fleet_sweeper_handle = tokio::spawn(
        core.runtime_fleet
            .clone()
            .run_idle_sweeper(fleet_sweeper_shutdown_rx),
    );
    let (builtin_tool_shutdown_tx, builtin_tool_shutdown_rx) = oneshot::channel();
    let mut builtin_tool_handle = tokio::spawn(serve_builtin_tool_ipc(
        core.clone(),
        builtin_tool_shutdown_rx,
    ));
    let mut event_handle = tokio::spawn(process_codex_events(
        core.clone(),
        codex_rx,
        output_tx.clone(),
        event_shutdown_rx,
    ));
    let (acp_shutdown_tx, acp_shutdown_rx) = oneshot::channel();
    let mut acp_event_handle = tokio::spawn(process_acp_events(
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
    let (runtime_usage_shutdown_tx, runtime_usage_shutdown_rx) = oneshot::channel();
    let mut runtime_usage_handle = tokio::spawn(process_runtime_usage_flusher(
        core.clone(),
        runtime_usage_shutdown_rx,
    ));

    output_tx
        .send(serde_json::to_string(&json!({
            "kind": "core_startup",
            "schemaVersion": 1,
            "status": "ready",
            "authorityState": { "kind": "current", "origin": authority_origin },
            "subsystems": core.subsystems.snapshot(),
        }))?)
        .map_err(|_| anyhow::anyhow!("failed to publish structured Core ready frame"))?;
    eprintln!(
        "[startup] stage=core_ready elapsed_ms={}",
        startup_started_at.elapsed().as_millis(),
    );
    eprintln!("rovai-core {} ready", env!("CARGO_PKG_VERSION"));
    let runtime_discovery_core = core.clone();
    let mut runtime_discovery_handle = tokio::spawn(async move {
        runtime_discovery_core
            .initialize_optional_subsystems()
            .await;
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
                                kind: "domain_rejection",
                                code: "CORE_SHUTDOWN_INVALID".to_string(),
                                message: format!("{error:#}"),
                                retryable: false,
                                details: json!({}),
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
        let shutdown_started_at = tokio::time::Instant::now();
        let deadline = shutdown_started_at + Duration::from_millis(params.deadline_ms);
        let cleanup_reserve = std::cmp::min(
            PLANNED_SHUTDOWN_CLEANUP_RESERVE,
            Duration::from_millis(params.deadline_ms / 4),
        );
        let settlement_deadline = deadline.checked_sub(cleanup_reserve).unwrap_or(deadline);
        let output_deadline = deadline
            .checked_sub(std::cmp::min(
                PLANNED_SHUTDOWN_OUTPUT_RESERVE,
                cleanup_reserve / 4,
            ))
            .unwrap_or(deadline);
        let fence_settlement_deadline = output_deadline
            .checked_sub(std::cmp::min(
                PLANNED_SHUTDOWN_FENCE_SETTLEMENT_RESERVE,
                cleanup_reserve / 2,
            ))
            .unwrap_or(output_deadline);
        let mut deadline_expired = false;

        // Persist the user's controlled-shutdown intent before the in-memory
        // launch gate closes. A crash in either direction is therefore
        // recoverable: every Run present before the next startup is fenced by
        // this cycle, including a launch that was already crossing handoff.
        let controlled_shutdown_cycle_persisted =
            match tokio::time::timeout_at(settlement_deadline, async {
                let mut database = core.database.lock().await;
                ExecutionRuntimeService::default().record_controlled_shutdown_cycle(
                    &mut database,
                    core.planned_shutdown.generation(),
                    PLANNED_SHUTDOWN_PROTOCOL_VERSION,
                )
            })
            .await
            {
                Ok(Ok(())) => true,
                Ok(Err(error)) => {
                    eprintln!("controlled shutdown intent persistence failed: {error:#}");
                    deadline_expired = true;
                    false
                }
                Err(_) => {
                    eprintln!("controlled shutdown intent persistence exceeded its deadline");
                    deadline_expired = true;
                    false
                }
            };
        // This store is the launch-admission linearization point. Worker stop
        // signals follow it, so no new recovery or scheduler launch can enter.
        core.planned_shutdown.close_launch_admission();
        let _ = scheduler_shutdown_tx.send(());
        let _ = attachment_projection_shutdown_tx.send(());
        let _ = runtime_check_shutdown_tx.send(());
        let _ = fleet_sweeper_shutdown_tx.send(());
        runtime_discovery_handle.abort();

        let launch_grace_deadline = std::cmp::min(
            settlement_deadline,
            tokio::time::Instant::now() + PLANNED_SHUTDOWN_INTERRUPT_GRACE,
        );
        let mut launch_quiesced = core
            .planned_shutdown
            .finish_launch_closure_until(launch_grace_deadline)
            .await;
        if !launch_quiesced {
            eprintln!("planned shutdown launch handoff exceeded the prompt cancellation grace");
            deadline_expired = true;
            scheduler_handle.abort();
            let launch_abort_deadline = std::cmp::min(
                fence_settlement_deadline,
                tokio::time::Instant::now() + PLANNED_SHUTDOWN_GUARD_GRACE,
            );
            let _ = core
                .abort_agent_run_tasks_until(launch_abort_deadline)
                .await;
            launch_quiesced = core
                .planned_shutdown
                .finish_launch_closure_until(launch_abort_deadline)
                .await;
        }

        // A stable snapshot is only available after the launch writer barrier.
        // If it missed the settlement budget, do not manufacture stop authority;
        // later fencing leaves any accepted input unresolved for startup recovery.
        let active = if launch_quiesced {
            match tokio::time::timeout_at(
                std::cmp::min(
                    fence_settlement_deadline,
                    tokio::time::Instant::now() + PLANNED_SHUTDOWN_GUARD_GRACE,
                ),
                core.planned_shutdown.active_snapshots(),
            )
            .await
            {
                Ok(active) => active,
                Err(_) => {
                    deadline_expired = true;
                    Vec::new()
                }
            }
        } else {
            Vec::new()
        };
        let mut active_executions_observed = active.len();

        // Exit is the product-level cancellation linearization point. Once the
        // stable active snapshot exists, no new Runtime terminal or callback may
        // win over cancel-all settlement. Native interruption remains best effort
        // and is followed by bounded process reap rather than terminal waiting.
        core.planned_shutdown
            .close_terminal_and_runtime_route_admission();
        let interrupt_deadline = std::cmp::min(
            settlement_deadline,
            tokio::time::Instant::now() + PLANNED_SHUTDOWN_INTERRUPT_GRACE,
        );
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
        let stop_tasks_quiesced = if tokio::time::timeout_at(interrupt_deadline, stop_wait)
            .await
            .is_ok()
        {
            true
        } else {
            stop_tasks.abort_all();
            tokio::time::timeout_at(fence_settlement_deadline, async {
                while stop_tasks.join_next().await.is_some() {}
            })
            .await
            .is_ok()
        };

        let background_requests_quiesced = drain_join_set_until(
            &mut background_requests,
            interrupt_deadline,
            fence_settlement_deadline,
        )
        .await;
        let scheduler_quiesced = join_or_abort_until(
            &mut scheduler_handle,
            interrupt_deadline,
            fence_settlement_deadline,
        )
        .await;
        let attachment_projection_quiesced = join_or_abort_until(
            &mut attachment_projection_handle,
            interrupt_deadline,
            fence_settlement_deadline,
        )
        .await;
        let runtime_checks_quiesced = join_or_abort_until(
            &mut runtime_check_handle,
            interrupt_deadline,
            fence_settlement_deadline,
        )
        .await;
        let fleet_sweeper_quiesced = join_or_abort_until(
            &mut fleet_sweeper_handle,
            interrupt_deadline,
            fence_settlement_deadline,
        )
        .await;
        let runtime_discovery_quiesced = join_or_abort_until(
            &mut runtime_discovery_handle,
            interrupt_deadline,
            fence_settlement_deadline,
        )
        .await;

        // Admissions are already closed at the cancel-all cutoff. Abort their
        // tracked owners, drain any guard admitted before the cutoff, then make
        // the durable cancellation terminal authoritative.
        let _ = event_shutdown_tx.send(());
        let _ = acp_shutdown_tx.send(());
        let _ = builtin_tool_shutdown_tx.send(());
        event_handle.abort();
        acp_event_handle.abort();
        let agent_tasks_aborted = core
            .abort_agent_run_tasks_now_until(std::cmp::min(
                fence_settlement_deadline,
                tokio::time::Instant::now() + PLANNED_SHUTDOWN_GUARD_GRACE,
            ))
            .await;
        let (terminal_drained, routes_drained) = core
            .planned_shutdown
            .drain_terminal_and_runtime_routes_until(fence_settlement_deadline)
            .await;
        if !terminal_drained || !routes_drained {
            deadline_expired = true;
        }
        let guard_grace_deadline = std::cmp::min(
            fence_settlement_deadline,
            tokio::time::Instant::now() + PLANNED_SHUTDOWN_GUARD_GRACE,
        );
        let builtin_tool_quiesced = join_or_abort_until(
            &mut builtin_tool_handle,
            guard_grace_deadline,
            fence_settlement_deadline,
        )
        .await;
        let builtin_tools_fenced = core
            .builtin_tool_leases
            .fence_all_until(fence_settlement_deadline)
            .await
            .is_some();
        let agent_tasks_quiesced = agent_tasks_aborted
            && core
                .drain_agent_run_tasks_until(fence_settlement_deadline)
                .await;
        let event_quiesced = join_or_abort_until(
            &mut event_handle,
            tokio::time::Instant::now(),
            fence_settlement_deadline,
        )
        .await;
        let acp_event_quiesced = join_or_abort_until(
            &mut acp_event_handle,
            tokio::time::Instant::now(),
            fence_settlement_deadline,
        )
        .await;
        let _ = runtime_usage_shutdown_tx.send(());
        let runtime_usage_quiesced = join_or_abort_until(
            &mut runtime_usage_handle,
            guard_grace_deadline,
            fence_settlement_deadline,
        )
        .await;

        let unresolved_executions_before_fence = match tokio::time::timeout_at(
            fence_settlement_deadline,
            core.planned_shutdown.active_snapshots(),
        )
        .await
        {
            Ok(active) => active.len(),
            Err(_) => {
                deadline_expired = true;
                active_executions_observed
            }
        };
        active_executions_observed =
            active_executions_observed.max(unresolved_executions_before_fence);
        let terminal_executions_settled =
            active_executions_observed.saturating_sub(unresolved_executions_before_fence);
        let fence_prerequisites_quiesced = controlled_shutdown_cycle_persisted
            && launch_quiesced
            && terminal_drained
            && routes_drained
            && runtime_discovery_quiesced
            && background_requests_quiesced
            && scheduler_quiesced
            && attachment_projection_quiesced
            && runtime_checks_quiesced
            && fleet_sweeper_quiesced
            && builtin_tool_quiesced
            && builtin_tools_fenced
            && agent_tasks_quiesced
            && event_quiesced
            && acp_event_quiesced
            && runtime_usage_quiesced;
        let controlled_fence_settlement = if fence_prerequisites_quiesced {
            Some(
                tokio::time::timeout_at(output_deadline, async {
                    let mut database = core.database.lock().await;
                    ExecutionRuntimeService::default().settle_controlled_shutdown_cycle(
                        &mut database,
                        core.planned_shutdown.generation(),
                    )
                })
                .await,
            )
        } else {
            eprintln!(
                "controlled shutdown left its durable cycle pending because execution writers did not quiesce"
            );
            deadline_expired = true;
            None
        };
        let (cancelled_agent_runs_settled, unsettled_effect_agent_runs) =
            match controlled_fence_settlement {
                Some(Ok(Ok(settlement))) => {
                    let unsettled = settlement
                        .fenced_agent_runs
                        .iter()
                        .filter(|run| run.has_unsettled_external_effects)
                        .count();
                    (settlement.fenced_agent_runs.len(), unsettled)
                }
                Some(Ok(Err(error))) => {
                    eprintln!("controlled shutdown fence settlement failed: {error:#}");
                    deadline_expired = true;
                    (0, 0)
                }
                Some(Err(_)) => {
                    eprintln!("controlled shutdown fence settlement exceeded its deadline");
                    deadline_expired = true;
                    (0, 0)
                }
                None => (0, 0),
            };
        let unresolved_executions = match tokio::time::timeout_at(output_deadline, async {
            let database = core.database.lock().await;
            ExecutionRuntimeService::default().count_nonterminal_agent_runs(&database)
        })
        .await
        {
            Ok(Ok(count)) => count,
            Ok(Err(error)) => {
                eprintln!("controlled shutdown could not count unresolved AgentRuns: {error:#}");
                deadline_expired = true;
                unresolved_executions_before_fence
            }
            Err(_) => {
                eprintln!("controlled shutdown unresolved AgentRun count exceeded its deadline");
                deadline_expired = true;
                unresolved_executions_before_fence
            }
        };
        let runtime_reap_deadline = std::cmp::min(
            output_deadline,
            tokio::time::Instant::now() + PLANNED_SHUTDOWN_RUNTIME_REAP_GRACE,
        );
        let runtimes_quiesced = core
            .shutdown_all_runtimes_until(runtime_reap_deadline)
            .await;

        deadline_expired |= tokio::time::Instant::now() >= deadline
            || !launch_quiesced
            || !terminal_drained
            || !routes_drained
            || !runtime_discovery_quiesced
            || !background_requests_quiesced
            || !scheduler_quiesced
            || !attachment_projection_quiesced
            || !runtime_checks_quiesced
            || !fleet_sweeper_quiesced
            || !stop_tasks_quiesced
            || !builtin_tool_quiesced
            || !builtin_tools_fenced
            || !agent_tasks_quiesced
            || !runtimes_quiesced
            || !event_quiesced
            || !acp_event_quiesced
            || !runtime_usage_quiesced;

        let report = PlannedShutdownReport {
            protocol_version: PLANNED_SHUTDOWN_PROTOCOL_VERSION,
            status: "completed",
            deadline_expired,
            active_executions_observed,
            stop_requests_issued,
            terminal_executions_settled,
            cancelled_agent_runs_settled,
            unsettled_effect_agent_runs,
            controlled_shutdown_cycle_persisted,
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

        let (flush_tx, flush_rx) = oneshot::channel();
        if tokio::time::timeout_at(
            deadline,
            output_control_tx.send(OutputControl::CloseAndFlush(flush_tx)),
        )
        .await
        .is_ok_and(|result| result.is_ok())
        {
            match tokio::time::timeout_at(deadline, flush_rx).await {
                Ok(Ok(Ok(()))) => {}
                _ => output_handle.abort(),
            }
        } else {
            output_handle.abort();
        }
    } else {
        background_requests.abort_all();
        while background_requests.join_next().await.is_some() {}
        runtime_discovery_handle.abort();
        let _ = runtime_discovery_handle.await;
        let _ = scheduler_shutdown_tx.send(());
        let _ = scheduler_handle.await;
        let _ = attachment_projection_shutdown_tx.send(());
        let _ = attachment_projection_handle.await;
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
        let _ = runtime_usage_shutdown_tx.send(());
        let _ = runtime_usage_handle.await;
        let (flush_tx, flush_rx) = oneshot::channel();
        output_control_tx
            .send(OutputControl::CloseAndFlush(flush_tx))
            .await
            .context("output writer stopped before Core stdout could close")?;
        flush_rx
            .await
            .context("output writer stopped before Core stdout was flushed")??;
    }
    drop(core);
    drop(output_tx);
    if !output_handle.is_finished() {
        output_handle.abort();
    }
    Ok(())
}

fn codex_delta_batch_identity(incoming: &CodexIncoming) -> Option<(&str, &str, i64)> {
    let CodexIncoming::Message {
        host_instance_id,
        agent_run_id,
        execution_epoch,
        message,
    } = incoming
    else {
        return None;
    };
    if message.get("id").is_some() {
        return None;
    }
    let method = message.get("method").and_then(Value::as_str)?;
    matches!(
        method,
        "item/agentMessage/delta"
            | "item/reasoning/summaryTextDelta"
            | "item/plan/delta"
            | "item/fileChange/patchUpdated"
    )
    .then_some((
        host_instance_id.as_str(),
        agent_run_id.as_str(),
        *execution_epoch,
    ))
}

fn is_codex_command_output_delta_notification(message: &Value) -> bool {
    message.get("id").is_none()
        && message
            .get("method")
            .and_then(Value::as_str)
            .is_some_and(|method| {
                matches!(
                    method,
                    "item/commandExecution/outputDelta" | "command/exec/outputDelta"
                )
            })
}

fn acp_delta_batch_identity(
    incoming: &AcpIncoming,
) -> Option<(AdapterKind, &str, &str, i64, &str, &str, &str)> {
    let AcpIncoming::Message {
        adapter_kind,
        host_instance_id,
        agent_run_id,
        execution_epoch,
        native_session_id,
        native_prompt_id,
        delivery_id,
        message,
        ..
    } = incoming
    else {
        return None;
    };
    if message.get("id").is_some()
        || message.get("method").and_then(Value::as_str) != Some("session/update")
    {
        return None;
    }
    let session_update = message
        .pointer("/params/update/sessionUpdate")
        .and_then(Value::as_str);
    matches!(
        session_update,
        Some("agent_message_chunk" | "agent_thought_chunk")
    )
    .then_some((
        *adapter_kind,
        host_instance_id.as_str(),
        agent_run_id.as_str(),
        *execution_epoch,
        native_session_id.as_str(),
        native_prompt_id.as_str(),
        delivery_id.as_str(),
    ))
}

struct PreparedRuntimeDeltaMessage {
    native_method: String,
    params: Value,
    evidence: PreparedRuntimeEvidence,
}

struct AcpRuntimeDeltaMessage {
    native_session_id: String,
    native_prompt_id: String,
    delivery_id: String,
    sequence: u64,
    message: Value,
}

fn prepare_codex_delta_batch(
    messages: &[Value],
) -> Result<Option<Vec<PreparedRuntimeDeltaMessage>>> {
    let mut total_bytes = 0_usize;
    let mut prepared = Vec::with_capacity(messages.len());
    for message in messages {
        let native_method = message
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        let (event_type, payload) = codex::normalize_event(&native_method, &params);
        let Some(evidence) =
            ExecutionEvidenceService.prepare_runtime_event(event_type, &payload)?
        else {
            return Ok(None);
        };
        if !evidence.is_inline_delta_batchable() {
            return Ok(None);
        }
        let next_bytes = evidence.content_byte_count();
        if !runtime_delta_batch_accepts_next(prepared.len(), total_bytes, next_bytes) {
            return Ok(None);
        }
        total_bytes = total_bytes
            .checked_add(next_bytes)
            .context("Codex Evidence batch size overflow")?;
        prepared.push(PreparedRuntimeDeltaMessage {
            native_method,
            params,
            evidence,
        });
    }
    Ok(Some(prepared))
}

fn prepare_acp_delta_batch(
    adapter_kind: AdapterKind,
    messages: &[AcpRuntimeDeltaMessage],
) -> Result<Option<Vec<PreparedRuntimeDeltaMessage>>> {
    let mut total_bytes = 0_usize;
    let mut prepared = Vec::with_capacity(messages.len());
    for incoming in messages {
        let message = &incoming.message;
        let native_method = message
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        let (event_type, payload) = normalize_acp_event(adapter_kind, &native_method, &params);
        let Some(evidence) =
            ExecutionEvidenceService.prepare_runtime_event(event_type, &payload)?
        else {
            return Ok(None);
        };
        if !evidence.is_inline_delta_batchable() {
            return Ok(None);
        }
        let next_bytes = evidence.content_byte_count();
        if !runtime_delta_batch_accepts_next(prepared.len(), total_bytes, next_bytes) {
            return Ok(None);
        }
        total_bytes = total_bytes
            .checked_add(next_bytes)
            .context("ACP Evidence batch size overflow")?;
        prepared.push(PreparedRuntimeDeltaMessage {
            native_method,
            params,
            evidence,
        });
    }
    Ok(Some(prepared))
}

fn runtime_delta_batch_accepts_next(
    current_items: usize,
    current_bytes: usize,
    next_bytes: usize,
) -> bool {
    current_items < RUNTIME_EVIDENCE_DELTA_BATCH_MAX_ITEMS
        && current_bytes
            .checked_add(next_bytes)
            .is_some_and(|total| total <= RUNTIME_EVIDENCE_DELTA_BATCH_MAX_BYTES)
}

async fn process_codex_events(
    core: Arc<Core>,
    mut receiver: mpsc::UnboundedReceiver<CodexIncoming>,
    output: mpsc::UnboundedSender<String>,
    mut shutdown: oneshot::Receiver<()>,
) {
    let mut pending = None;
    loop {
        let incoming = match pending.take() {
            Some(incoming) => incoming,
            None => tokio::select! {
                incoming = receiver.recv() => match incoming {
                    Some(incoming) => incoming,
                    None => break,
                },
                _ = &mut shutdown => break,
            },
        };
        let incoming = match incoming {
            CodexIncoming::IngressBarrier { completion } => {
                let _ = completion.send(());
                continue;
            }
            incoming => incoming,
        };
        if let CodexIncoming::Message { message, .. } = &incoming
            && is_codex_command_output_delta_notification(message)
        {
            continue;
        }
        let Some(mut runtime_route_permit) = core.planned_shutdown.enter_runtime_route().await
        else {
            break;
        };
        if let Some((host_instance_id, agent_run_id, execution_epoch)) =
            codex_delta_batch_identity(&incoming)
                .map(|(host, run, epoch)| (host.to_string(), run.to_string(), epoch))
        {
            let CodexIncoming::Message { message, .. } = incoming else {
                unreachable!("Codex Delta batch identity requires a Message")
            };
            let mut messages = vec![message];
            let deadline = tokio::time::Instant::now() + RUNTIME_EVIDENCE_DELTA_BATCH_WINDOW;
            let mut stop_after_batch = false;
            while messages.len() < RUNTIME_EVIDENCE_DELTA_BATCH_MAX_ITEMS {
                if tokio::time::Instant::now() >= deadline {
                    break;
                }
                let next = tokio::select! {
                    _ = &mut shutdown => {
                        stop_after_batch = true;
                        None
                    },
                    _ = tokio::time::sleep_until(deadline) => None,
                    incoming = receiver.recv() => match incoming {
                        Some(incoming) => Some(incoming),
                        None => {
                            stop_after_batch = true;
                            None
                        }
                    },
                };
                let Some(next) = next else {
                    break;
                };
                let same_batch = codex_delta_batch_identity(&next).is_some_and(
                    |(next_host, next_run, next_epoch)| {
                        next_host == host_instance_id
                            && next_run == agent_run_id
                            && next_epoch == execution_epoch
                    },
                );
                if !same_batch {
                    pending = Some(next);
                    break;
                }
                let CodexIncoming::Message { message, .. } = next else {
                    unreachable!("Codex Delta batch identity requires a Message")
                };
                messages.push(message);
            }
            process_agent_run_codex_delta_batch(
                &core,
                &output,
                &host_instance_id,
                &agent_run_id,
                execution_epoch,
                messages,
                &mut runtime_route_permit,
            )
            .await;
            if stop_after_batch {
                break;
            }
            continue;
        }
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
                    &mut runtime_route_permit,
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
            CodexIncoming::IngressBarrier { .. } => {
                unreachable!("Codex ingress barriers are handled before Runtime routing")
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
    let mut pending = None;
    loop {
        let incoming = match pending.take() {
            Some(incoming) => incoming,
            None => tokio::select! {
                incoming = receiver.recv() => match incoming {
                    Some(incoming) => incoming,
                    None => break,
                },
                _ = &mut shutdown => break,
            },
        };
        let incoming = match incoming {
            AcpIncoming::IngressBarrier { completion } => {
                let _ = completion.send(());
                continue;
            }
            incoming => incoming,
        };
        let Some(mut runtime_route_permit) = core.planned_shutdown.enter_runtime_route().await
        else {
            break;
        };
        if let Some((
            adapter_kind,
            host_instance_id,
            agent_run_id,
            execution_epoch,
            batch_session_id,
            batch_prompt_id,
            batch_delivery_id,
        )) = acp_delta_batch_identity(&incoming).map(
            |(adapter, host, run, epoch, session, prompt, delivery)| {
                (
                    adapter,
                    host.to_string(),
                    run.to_string(),
                    epoch,
                    session.to_string(),
                    prompt.to_string(),
                    delivery.to_string(),
                )
            },
        ) {
            let AcpIncoming::Message {
                native_session_id,
                native_prompt_id,
                delivery_id,
                sequence,
                message,
                ..
            } = incoming
            else {
                unreachable!("ACP Delta batch identity requires a Message")
            };
            let mut messages = vec![AcpRuntimeDeltaMessage {
                native_session_id,
                native_prompt_id,
                delivery_id,
                sequence,
                message,
            }];
            let deadline = tokio::time::Instant::now() + RUNTIME_EVIDENCE_DELTA_BATCH_WINDOW;
            let mut stop_after_batch = false;
            while messages.len() < RUNTIME_EVIDENCE_DELTA_BATCH_MAX_ITEMS {
                if tokio::time::Instant::now() >= deadline {
                    break;
                }
                let next = tokio::select! {
                    _ = &mut shutdown => {
                        stop_after_batch = true;
                        None
                    },
                    _ = tokio::time::sleep_until(deadline) => None,
                    incoming = receiver.recv() => match incoming {
                        Some(incoming) => Some(incoming),
                        None => {
                            stop_after_batch = true;
                            None
                        }
                    },
                };
                let Some(next) = next else {
                    break;
                };
                let same_batch = acp_delta_batch_identity(&next).is_some_and(
                    |(
                        next_adapter,
                        next_host,
                        next_run,
                        next_epoch,
                        next_session,
                        next_prompt,
                        next_delivery,
                    )| {
                        next_adapter == adapter_kind
                            && next_host == host_instance_id
                            && next_run == agent_run_id
                            && next_epoch == execution_epoch
                            && next_session == batch_session_id
                            && next_prompt == batch_prompt_id
                            && next_delivery == batch_delivery_id
                    },
                );
                if !same_batch {
                    pending = Some(next);
                    break;
                }
                let AcpIncoming::Message {
                    native_session_id,
                    native_prompt_id,
                    delivery_id,
                    sequence,
                    message,
                    ..
                } = next
                else {
                    unreachable!("ACP Delta batch identity requires a Message")
                };
                messages.push(AcpRuntimeDeltaMessage {
                    native_session_id,
                    native_prompt_id,
                    delivery_id,
                    sequence,
                    message,
                });
            }
            process_agent_run_acp_delta_batch(
                &core,
                &output,
                adapter_kind,
                &host_instance_id,
                &agent_run_id,
                execution_epoch,
                messages,
                &mut runtime_route_permit,
            )
            .await;
            if stop_after_batch {
                break;
            }
            continue;
        }
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
                native_error_code,
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
                    native_error_code,
                    &error,
                )
                .await;
            }
            AcpIncoming::Message {
                adapter_kind,
                host_instance_id,
                agent_run_id,
                execution_epoch,
                native_session_id,
                native_prompt_id,
                delivery_id,
                sequence,
                message,
            } => {
                process_agent_run_acp_message(
                    &core,
                    &output,
                    adapter_kind,
                    &host_instance_id,
                    &agent_run_id,
                    execution_epoch,
                    &native_session_id,
                    &native_prompt_id,
                    &delivery_id,
                    sequence,
                    message,
                    &mut runtime_route_permit,
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
            AcpIncoming::IngressBarrier { .. } => {
                unreachable!("ACP ingress barriers are handled before Runtime routing")
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
    native_error_code: Option<i64>,
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
            &format!(
                "ACP prompt {native_prompt_id} was rejected{}: {error}",
                native_error_code.map_or_else(String::new, |code| format!(" ({code})")),
            ),
        )
    };
    if let Err(mark_error) = result {
        eprintln!(
            "failed to persist ACP input rejection for AgentRun {agent_run_id}: {mark_error:#}"
        );
    }
}

#[allow(clippy::too_many_arguments)]
async fn process_agent_run_acp_delta_batch(
    core: &Arc<Core>,
    output: &mpsc::UnboundedSender<String>,
    adapter_kind: AdapterKind,
    host_instance_id: &str,
    agent_run_id: &str,
    execution_epoch: i64,
    messages: Vec<AcpRuntimeDeltaMessage>,
    runtime_route_permit: &mut rovai_core::planned_shutdown::RuntimeRoutePermit,
) {
    let prepared = match prepare_acp_delta_batch(adapter_kind, &messages) {
        Ok(Some(prepared)) => prepared,
        Ok(None) => {
            for incoming in messages {
                process_agent_run_acp_message(
                    core,
                    output,
                    adapter_kind,
                    host_instance_id,
                    agent_run_id,
                    execution_epoch,
                    &incoming.native_session_id,
                    &incoming.native_prompt_id,
                    &incoming.delivery_id,
                    incoming.sequence,
                    incoming.message,
                    runtime_route_permit,
                )
                .await;
            }
            return;
        }
        Err(error) => {
            eprintln!(
                "failed to prepare ACP Runtime Evidence batch for AgentRun {agent_run_id}: {error:#}"
            );
            for incoming in messages {
                process_agent_run_acp_message(
                    core,
                    output,
                    adapter_kind,
                    host_instance_id,
                    agent_run_id,
                    execution_epoch,
                    &incoming.native_session_id,
                    &incoming.native_prompt_id,
                    &incoming.delivery_id,
                    incoming.sequence,
                    incoming.message,
                    runtime_route_permit,
                )
                .await;
            }
            return;
        }
    };
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
    let Some(first) = messages.first() else {
        return;
    };
    if !runtime
        .matches_prompt_fence(
            &first.native_session_id,
            &first.native_prompt_id,
            &first.delivery_id,
        )
        .await
    {
        eprintln!(
            "dropped fenced ACP Delta batch for AgentRun {agent_run_id} at Session sequence {}",
            first.sequence
        );
        return;
    }
    let evidence = match persist_prepared_runtime_evidence_batch(
        core,
        agent_run_id,
        execution_epoch,
        prepared
            .iter()
            .map(|message| message.evidence.clone())
            .collect(),
    )
    .await
    {
        Ok(evidence) => evidence,
        Err(error) => {
            eprintln!(
                "failed to persist ACP Runtime Evidence batch for AgentRun {agent_run_id}; falling back to individual Evidence: {error:#}"
            );
            for incoming in messages {
                process_agent_run_acp_message(
                    core,
                    output,
                    adapter_kind,
                    host_instance_id,
                    agent_run_id,
                    execution_epoch,
                    &incoming.native_session_id,
                    &incoming.native_prompt_id,
                    &incoming.delivery_id,
                    incoming.sequence,
                    incoming.message,
                    runtime_route_permit,
                )
                .await;
            }
            return;
        }
    };
    let mut completions = Vec::with_capacity(prepared.len());
    for (message, incoming) in prepared.iter().zip(&messages) {
        let completion = match runtime
            .observe_message(
                &incoming.native_prompt_id,
                &message.native_method,
                &message.params,
            )
            .await
        {
            Ok(completion) => completion,
            Err(error) => {
                eprintln!("failed to normalize ACP Runtime Delta: {error:#}");
                None
            }
        };
        completions.push(completion);
    }
    for ((message, evidence), completion) in prepared.into_iter().zip(evidence).zip(completions) {
        let Some(evidence) = evidence else {
            continue;
        };
        emit(
            output,
            &evidence.event_type,
            json!({
                "agentRunId": agent_run_id,
                "executionEpoch": execution_epoch,
                "adapterKind": adapter_kind,
                "nativeMethod": message.native_method,
                "evidenceId": evidence.id,
                "payload": evidence.payload,
                "canonical": evidence.canonical,
            }),
        );
        if let Some(completion) = completion
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
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn process_agent_run_acp_message(
    core: &Arc<Core>,
    output: &mpsc::UnboundedSender<String>,
    adapter_kind: rovai_core::agent_profile::AdapterKind,
    host_instance_id: &str,
    agent_run_id: &str,
    execution_epoch: i64,
    native_session_id: &str,
    native_prompt_id: &str,
    delivery_id: &str,
    sequence: u64,
    message: Value,
    runtime_route_permit: &mut rovai_core::planned_shutdown::RuntimeRoutePermit,
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
    if !runtime
        .matches_prompt_fence(native_session_id, native_prompt_id, delivery_id)
        .await
    {
        eprintln!(
            "dropped fenced ACP message for AgentRun {agent_run_id} at Session sequence {sequence}"
        );
        return;
    }
    let method = message
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    if let Some(id) = message.get("id").cloned() {
        if method == "session/request_permission"
            && let Err(error) = runtime
                .observe_message(native_prompt_id, &method, &params)
                .await
        {
            eprintln!("failed to observe ACP permission request: {error:#}");
        }
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
                        .respond_error(id, -32000, &format!("Rovai-ai file read failed: {error:#}"))
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
                            &format!("Rovai-ai file write failed: {error:#}"),
                        )
                        .await
                }
            },
            "cursor/ask_question" if adapter_kind == AdapterKind::CursorAgent => {
                runtime
                    .respond(id, json!({"outcome": {"outcome": "skipped"}}))
                    .await
            }
            "cursor/create_plan" if adapter_kind == AdapterKind::CursorAgent => {
                runtime
                    .respond(
                        id,
                        json!({
                            "outcome": {
                                "outcome": "rejected",
                                "reason": "Rovai-ai does not yet expose Cursor Plan Review"
                            }
                        }),
                    )
                    .await
            }
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

    let usage = parse_acp_usage_message(adapter_kind, runtime.reported_version(), &method, &params);
    if !usage.is_empty()
        && let Err(error) = buffer_runtime_usage(
            core,
            agent_run_id,
            execution_epoch,
            &acp_usage_source_identity(adapter_kind, &method, &params)
                .unwrap_or_else(|error| {
                    eprintln!(
                        "failed to derive {} Usage identity for AgentRun {agent_run_id}: {error:#}",
                        adapter_kind.as_str()
                    );
                    None
                })
                .unwrap_or_else(|| {
                    canonical_json_digest(&message).unwrap_or_else(|_| {
                        format!("acp:{method}:{agent_run_id}:{execution_epoch}")
                    })
                }),
            &usage,
        )
        .await
    {
        eprintln!(
            "failed to persist {} Usage for AgentRun {agent_run_id}: {error:#}",
            adapter_kind.as_str()
        );
    }
    let completed_action = match runtime
        .observe_message(native_prompt_id, &method, &params)
        .await
    {
        Ok(completion) => completion,
        Err(error) => {
            eprintln!("failed to normalize ACP Runtime event: {error:#}");
            None
        }
    };
    let (event_type, payload) = normalize_acp_event_with_completion(
        adapter_kind,
        &method,
        &params,
        completed_action.as_ref(),
    );
    if event_type == "runtime.usage" {
        return;
    }
    let evidence = match persist_runtime_evidence(
        core,
        agent_run_id,
        execution_epoch,
        runtime
            .builtin_tool_process_config()
            .map(BuiltinToolProcessConfig::run_tmp),
        event_type,
        &payload,
    )
    .await
    {
        Ok(evidence) => evidence,
        Err(error) => {
            eprintln!("failed to persist Runtime Evidence for AgentRun {agent_run_id}: {error:#}");
            if ExecutionEvidenceService::is_durable_runtime_evidence_event(event_type) {
                return;
            }
            None
        }
    };
    if ExecutionEvidenceService::is_durable_runtime_evidence_event(event_type) && evidence.is_none()
    {
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
            core.fail_claimed_agent_run(
                output,
                &execution,
                "action_audit_failed",
                &error,
                false,
                None,
            )
            .await;
        }
        return;
    }
    if method != "rovai/acp_prompt_completed" {
        return;
    }
    if let Err(error) =
        flush_runtime_monitoring_run(core, agent_run_id, execution_epoch, "terminal_flush").await
    {
        eprintln!("failed to flush ACP monitoring for AgentRun {agent_run_id}: {error:#}");
    }
    if let Err(error) = persist_acp_prompt_completion(
        core,
        output,
        adapter_kind,
        &runtime,
        agent_run_id,
        execution_epoch,
        &params,
        runtime_route_permit,
    )
    .await
    {
        eprintln!("failed to persist ACP prompt completion: {error:#}");
    }
}

fn normalize_acp_event(
    adapter_kind: AdapterKind,
    method: &str,
    params: &Value,
) -> (&'static str, Value) {
    normalize_acp_event_with_completion(adapter_kind, method, params, None)
}

fn normalize_acp_event_with_completion(
    adapter_kind: AdapterKind,
    method: &str,
    params: &Value,
    completion: Option<&acp::CompletedAcpAction>,
) -> (&'static str, Value) {
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
        Some("tool_call") | Some("tool_call_update") => {
            let public_command =
                acp::public_acp_shell_command(adapter_kind, update.get("rawInput"))
                    .or_else(|| completion.and_then(|value| value.public_command.clone()));
            let native_kind = acp::public_acp_tool_kind(adapter_kind, &update).or_else(|| {
                completion
                    .map(|value| value.native_kind.as_str())
                    .filter(|kind| *kind != "other")
                    .map(str::to_string)
            });
            let public_status = completion
                .and_then(|value| value.result_data.get("status"))
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| {
                    acp::effective_acp_tool_status(
                        &update,
                        native_kind.as_deref().unwrap_or("other"),
                    )
                });
            let search_operation_candidate = native_kind
                .as_deref()
                .and_then(|kind| {
                    runtime_search_operation::acp_web_search_candidate(
                        adapter_kind,
                        update.get("sessionUpdate").and_then(Value::as_str),
                        &public_status,
                        kind,
                        update.get("rawInput"),
                    )
                })
                .or_else(|| {
                    completion.and_then(|value| value.public_search_operation_candidate.clone())
                });
            let public_kind = native_kind;
            let mut payload = json!({
                "sessionUpdate": update.get("sessionUpdate"),
                "toolCallId": update.get("toolCallId"),
                "toolName": update.get("toolName"),
                "status": public_status,
                "kind": public_kind,
                "title": update.get("title"),
                "locationCount": update
                    .get("locations")
                    .and_then(Value::as_array)
                    .map_or(0, Vec::len),
                "output": public_acp_tool_output(&update),
                "input": public_command,
                "rawInputDigest": update
                    .get("rawInput")
                    .and_then(|value| canonical_json_digest(value).ok())
                    .or_else(|| completion
                        .and_then(|value| value.result_data.get("rawInputDigest"))
                        .and_then(Value::as_str)
                        .map(str::to_string)),
                "rawOutputDigest": update
                    .get("rawOutput")
                    .and_then(|value| canonical_json_digest(value).ok()),
            });
            runtime_search_operation::insert_candidate(&mut payload, search_operation_candidate);
            if public_status == "completed"
                && let Some(path) =
                    completion.and_then(|value| value.public_file_operation_path.as_ref())
            {
                payload["runtimeFileOperation"] = json!({
                    "adapterKind": adapter_kind.as_str(),
                    "protocolFamily": "acp-v1",
                    "sourceEventKind": "session/update.tool_call_update.completed",
                    "operationKind": "write",
                    "path": path,
                });
            }
            if public_status == "completed"
                && let Some(changes) =
                    completion.and_then(|value| value.public_file_changes.as_ref())
            {
                payload["runtimeDiff"] = json!({
                    "adapterKind": adapter_kind.as_str(),
                    "protocolFamily": "acp-v1",
                    "sourceEventKind": "session/update.tool_call_update.completed",
                    "semanticKind": "complete_before_after",
                    "entries": changes,
                });
            }
            ("runtime.action", payload)
        }
        Some("plan") => ("runtime.plan", update),
        Some("usage_update") => ("runtime.usage", update),
        _ => ("runtime.event", update),
    }
}

fn public_acp_tool_output(update: &Value) -> Option<String> {
    public_acp_content_text(update.get("content")).or_else(|| {
        let raw_output = update.get("rawOutput")?.as_object()?;
        let mut public = Vec::new();
        for field in ["stdout", "stderr", "output", "text"] {
            let Some(text) = public_acp_content_text(raw_output.get(field)) else {
                continue;
            };
            if !public.iter().any(|existing| existing == &text) {
                public.push(text);
            }
        }
        (!public.is_empty()).then(|| public.join("\n"))
    })
}

fn public_acp_content_text(value: Option<&Value>) -> Option<String> {
    let value = value?;
    match value {
        Value::String(text) => nonempty_public_text(text),
        Value::Array(blocks) => {
            let text = blocks
                .iter()
                .filter_map(|block| public_acp_content_text(Some(block)))
                .collect::<Vec<_>>()
                .join("\n");
            nonempty_public_text(&text)
        }
        Value::Object(block) => match block.get("type").and_then(Value::as_str) {
            Some("content") => public_acp_content_text(block.get("content")),
            Some("text") => block
                .get("text")
                .and_then(Value::as_str)
                .and_then(nonempty_public_text),
            // ACP terminal content is only a display anchor owned by the Agent.
            // A Runtime-specific Client Terminal bridge may serve its output
            // directly on the protocol, but terminalId (and diff/resource
            // payloads) are never public command output by themselves.
            Some("terminal" | "diff" | "image" | "audio" | "resource" | "resource_link") => None,
            Some(_) => None,
            // Preserve the small legacy shapes emitted by older ACP adapters,
            // while still refusing to walk arbitrary untyped object fields.
            None => block
                .get("text")
                .and_then(Value::as_str)
                .and_then(nonempty_public_text)
                .or_else(|| public_acp_content_text(block.get("content"))),
        },
        _ => None,
    }
}

fn nonempty_public_text(text: &str) -> Option<String> {
    (!text.is_empty()).then(|| text.to_string())
}

async fn record_runtime_model_observation(
    core: &Core,
    output: &mpsc::UnboundedSender<String>,
    adapter_kind: AdapterKind,
    camp_id: &str,
    agent_run_id: &str,
    execution_epoch: i64,
    model_id: &str,
) -> Result<bool> {
    let model_id = model_id.trim();
    let command_id = format!(
        "runtime-model-observation:{agent_run_id}:{execution_epoch}:{}",
        canonical_json_digest(&json!({ "modelId": model_id }))?
    );
    let execution = {
        let mut database = core.database.lock().await;
        ExecutionRuntimeService::default().record_observed_runtime_model(
            &mut database,
            &CommandEnvelope {
                command_id,
                actor: ActorRef::System {
                    component_id: format!("runtime-adapter:{}", adapter_kind.as_str()),
                },
                camp_id: Some(camp_id.to_string()),
                expected_versions: Vec::new(),
                execution_epoch: None,
                payload: RecordObservedRuntimeModelCommand {
                    agent_run_id: agent_run_id.to_string(),
                    execution_epoch,
                    model_id: model_id.to_string(),
                },
            },
        )?
    };
    if execution.result.status == CommandResultStatus::Rejected {
        anyhow::bail!(
            "Runtime model observation was rejected: {}",
            execution.result.code
        );
    }
    let changed = execution.result.payload["changed"]
        .as_bool()
        .unwrap_or(false);
    if changed {
        emit(
            output,
            "agent_run.runtime_model_observed",
            json!({
                "campId": camp_id,
                "agentRunId": agent_run_id,
                "executionEpoch": execution_epoch,
                "adapterKind": adapter_kind,
                "modelId": model_id,
            }),
        );
    }
    Ok(changed)
}

async fn record_available_runtime_model(
    core: &Core,
    output: &mpsc::UnboundedSender<String>,
    adapter_kind: AdapterKind,
    camp_id: &str,
    agent_run_id: &str,
    execution_epoch: i64,
    model_id: Option<String>,
) {
    let Some(model_id) = model_id else {
        return;
    };
    if let Err(error) = record_runtime_model_observation(
        core,
        output,
        adapter_kind,
        camp_id,
        agent_run_id,
        execution_epoch,
        &model_id,
    )
    .await
    {
        eprintln!(
            "failed to persist {adapter_kind:?} Runtime model observation for AgentRun {agent_run_id}: {error:#}"
        );
    }
}

#[derive(Clone, Copy)]
struct RuntimeEventScope<'a> {
    adapter_kind: AdapterKind,
    camp_id: &'a str,
    agent_run_id: &'a str,
    execution_epoch: i64,
    managed_output_root: Option<&'a Path>,
}

async fn process_runtime_event(
    core: &Core,
    output: &mpsc::UnboundedSender<String>,
    scope: RuntimeEventScope<'_>,
    event_type: &str,
    payload: &Value,
) -> Result<()> {
    let Some(_runtime_route_permit) = core.planned_shutdown.enter_runtime_route().await else {
        return Ok(());
    };
    if event_type == "runtime.model.observed" {
        let model_id = payload
            .get("modelId")
            .and_then(Value::as_str)
            .context("Runtime model observation omitted modelId")?;
        record_runtime_model_observation(
            core,
            output,
            scope.adapter_kind,
            scope.camp_id,
            scope.agent_run_id,
            scope.execution_epoch,
            model_id,
        )
        .await?;
        return Ok(());
    }
    let Some(evidence) = persist_runtime_evidence(
        core,
        scope.agent_run_id,
        scope.execution_epoch,
        scope.managed_output_root,
        event_type,
        payload,
    )
    .await?
    else {
        return Ok(());
    };
    emit(
        output,
        event_type,
        json!({
            "agentRunId": scope.agent_run_id,
            "executionEpoch": scope.execution_epoch,
            "adapterKind": scope.adapter_kind,
            "nativeMethod": "stream-json",
            "evidenceId": evidence.id,
            "payload": evidence.payload,
            "canonical": evidence.canonical,
        }),
    );
    Ok(())
}

async fn persist_runtime_evidence(
    core: &Core,
    agent_run_id: &str,
    execution_epoch: i64,
    managed_output_root: Option<&Path>,
    event_type: &str,
    payload: &Value,
) -> Result<Option<AgentRunExecutionEvidence>> {
    if !ExecutionEvidenceService::is_durable_runtime_evidence_event(event_type) {
        return Ok(None);
    }
    let mut database = core.database.lock().await;
    let recorded = ExecutionEvidenceService.record_runtime_event_with_managed_output_root(
        &mut database,
        &ManagedBlobStore::new(&core.data_dir),
        agent_run_id,
        execution_epoch,
        event_type,
        payload,
        managed_output_root,
    )?;
    Ok(recorded.map(RecordedExecutionEvidence::into_evidence))
}

async fn persist_prepared_runtime_evidence_batch(
    core: &Core,
    agent_run_id: &str,
    execution_epoch: i64,
    prepared: Vec<PreparedRuntimeEvidence>,
) -> Result<Vec<Option<AgentRunExecutionEvidence>>> {
    let mut database = core.database.lock().await;
    let recorded = ExecutionEvidenceService.record_prepared_runtime_event_batch(
        &mut database,
        agent_run_id,
        execution_epoch,
        prepared,
    )?;
    drop(database);
    Ok(recorded
        .into_iter()
        .map(|recorded| recorded.map(RecordedExecutionEvidence::into_evidence))
        .collect())
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
        Some(native_item_id) => {
            runtime
                .observed_tool_context(&native_prompt_id, native_item_id)
                .await
        }
        None => None,
    };
    let action_request = match acp::intercepted_action_request(
        &acp::InterceptedAcpActionContext {
            adapter_kind: runtime.adapter_kind(),
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
    if execution.permission_semantics == PermissionSemantics::RuntimeManagedV2
        && acp::automatically_allows_permission_requests(
            execution.runtime.adapter_kind,
            &execution.runtime.permissions.values,
        )
    {
        match acp::legacy_approval_result(params, true) {
            Ok(response) => runtime.respond(request_id, response).await?,
            Err(error) => {
                reject_acp_request(
                    output,
                    runtime,
                    agent_run_id,
                    execution_epoch,
                    request_id,
                    params,
                    &format!("ACP automatic permission response was rejected: {error}"),
                )
                .await?;
            }
        }
        return Ok(());
    }
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

#[allow(clippy::too_many_arguments)]
async fn persist_acp_prompt_completion(
    core: &Arc<Core>,
    output: &mpsc::UnboundedSender<String>,
    adapter_kind: rovai_core::agent_profile::AdapterKind,
    runtime: &AcpRuntime,
    agent_run_id: &str,
    execution_epoch: i64,
    params: &Value,
    runtime_route_permit: &mut rovai_core::planned_shutdown::RuntimeRoutePermit,
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
    let final_agent_message = runtime.final_agent_message(prompt_id).await;
    let missing_send_recovery_candidate = if stop_reason == "end_turn" {
        runtime
            .missing_send_recovery_candidate(prompt_id)
            .await
            .map(|body| {
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
    let delivery_status = if planned_outcome == RuntimeTerminalOutcome::Failed {
        let delivery_id = params
            .get("deliveryId")
            .and_then(Value::as_str)
            .context("ACP prompt completion has no deliveryId")?;
        let database = core.database.lock().await;
        ContextService.runtime_input_delivery_status(&database, delivery_id)?
    } else {
        None
    };
    let manual_retry_allowed =
        acp_prompt_manual_retry_allowed(planned_outcome, delivery_status.as_deref());
    let base_error_code = if stop_reason == "end_turn" {
        "runtime_missing_final_output".to_string()
    } else {
        format!("runtime_prompt_{stop_reason}")
    };
    let error_detail = response_error
        .map(str::to_string)
        .unwrap_or_else(|| format!("ACP prompt ended as {stop_reason}"));
    let mut public_failure = response_error.map(|detail| {
        public_runtime_failure_from_output(
            adapter_kind,
            RuntimeFailureOrigin::Runtime,
            RuntimeFailurePhase::Execution,
            &base_error_code,
            &format!("{} 未能完成运行", runtime_display_name(adapter_kind)),
            Some(detail),
            &[(&core.data_dir, "<data-dir>")],
            manual_retry_allowed,
        )
    });
    if let Some(failure) = public_failure.as_mut() {
        // Provider retryability never overrides Core's delivery/effect safety. Once the input
        // was accepted, a successor instruction is required instead of replaying the Run.
        failure.retryable &= manual_retry_allowed;
    }
    let error_code = public_failure
        .as_ref()
        .map(|failure| failure.code.clone())
        .unwrap_or(base_error_code);
    let terminal_discriminator =
        canonical_json_digest(params).unwrap_or_else(|_| format!("{prompt_id}:{stop_reason}"));
    if !core.planned_shutdown.shutdown_started() {
        runtime_route_permit.complete_callback();
        if let Some(adapter) = core.acp_adapter(adapter_kind) {
            adapter
                .prepare_agent_run_terminal_visibility(agent_run_id, execution_epoch)
                .await;
        }
        *runtime_route_permit = core
            .planned_shutdown
            .enter_runtime_route()
            .await
            .context("ACP terminal route was fenced during Host release")?;
    }
    let mut terminal_admission = core
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
    if let Some(permit) = terminal_admission.planned_permit()
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
                    error_code: error_code.clone(),
                    error_detail: Some(error_detail.clone()),
                    failure: public_failure.clone(),
                    manual_retry_allowed,
                },
            )
            .await?;
        core.planned_shutdown
            .remove_active(&ActiveExecutionKey::new(agent_run_id, execution_epoch))
            .await;
        terminal_admission.complete_settlement();
        runtime_route_permit.complete_callback();
        emit_agent_run_terminal(
            output,
            None,
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
        core.project_agent_run_file_changes_after_terminal(agent_run_id, execution_epoch)
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
                match terminal_admission.planned_permit() {
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
                            failure: public_failure.clone(),
                            manual_retry_allowed,
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
                        error_code: error_code.clone(),
                        error_detail: Some(error_detail.clone()),
                        failure: public_failure.clone(),
                        manual_retry_allowed,
                        ending_git_observation,
                    },
                },
            )
        };
        match terminal {
            Ok(terminal) if terminal.result.status != CommandResultStatus::Rejected => {
                core.planned_shutdown
                    .remove_active(&ActiveExecutionKey::new(agent_run_id, execution_epoch))
                    .await;
                terminal_admission.complete_settlement();
                runtime_route_permit.complete_callback();
                emit_agent_run_terminal(
                    output,
                    Some(&execution.camp_id),
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
                core.project_agent_run_file_changes_after_terminal(agent_run_id, execution_epoch)
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

fn acp_prompt_manual_retry_allowed(
    outcome: RuntimeTerminalOutcome,
    delivery_status: Option<&str>,
) -> bool {
    outcome == RuntimeTerminalOutcome::Failed && delivery_status == Some("not_accepted")
}

async fn process_acp_agent_run_exit(
    core: &Arc<Core>,
    output: &mpsc::UnboundedSender<String>,
    adapter_kind: rovai_core::agent_profile::AdapterKind,
    host_instance_id: &str,
    agent_run_id: &str,
    execution_epoch: i64,
) {
    if core.planned_shutdown.shutdown_started() {
        return;
    }
    if let Err(error) =
        flush_runtime_monitoring_run(core, agent_run_id, execution_epoch, "host_exit_flush").await
    {
        eprintln!(
            "failed to flush ACP monitoring after Host exit for AgentRun {agent_run_id}: {error:#}"
        );
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

async fn buffer_runtime_usage(
    core: &Core,
    agent_run_id: &str,
    execution_epoch: i64,
    source_identity: &str,
    observations: &[ParsedRuntimeUsage],
) -> Result<()> {
    if observations.is_empty() {
        return Ok(());
    }
    core.runtime_usage.lock().await.observe_registered_run(
        agent_run_id,
        execution_epoch,
        source_identity,
        observations,
        Instant::now(),
    )?;
    Ok(())
}

async fn flush_runtime_usage(
    core: &Core,
    target: RuntimeUsageFlushTarget,
    reason: &'static str,
    notify_monitoring: bool,
) -> Result<usize> {
    // A terminal flush must observe the result of any periodic flush that
    // already drained this Run before deciding that its bookkeeping is idle.
    let _flush_guard = core.runtime_usage_flush.lock().await;
    let batches = {
        let mut usage = core.runtime_usage.lock().await;
        let batches = usage.drain(target.clone());
        if batches.is_empty() {
            usage.finish_idle_target_after_flush(&target);
        }
        batches
    };
    if batches.is_empty() {
        return Ok(0);
    }
    let persistence = {
        let mut database = core.database.lock().await;
        MonitoringService::record_usage_batches(&mut database, &batches)
    };
    match persistence {
        Ok(inserted) => {
            let mut usage = core.runtime_usage.lock().await;
            usage.finish_idle_target_after_flush(&target);
            drop(usage);
            if inserted > 0 && notify_monitoring {
                emit(
                    &core.output,
                    "monitoring.changed",
                    json!({ "reason": reason, "observationCount": inserted }),
                );
            }
            Ok(inserted)
        }
        Err(error) => {
            core.runtime_usage.lock().await.restore(batches)?;
            Err(error)
        }
    }
}

async fn flush_runtime_monitoring_run(
    core: &Core,
    agent_run_id: &str,
    execution_epoch: i64,
    reason: &'static str,
) -> Result<usize> {
    flush_runtime_usage(
        core,
        RuntimeUsageFlushTarget::Run {
            agent_run_id: agent_run_id.to_string(),
            execution_epoch,
        },
        reason,
        true,
    )
    .await
}

async fn process_runtime_usage_flusher(core: Arc<Core>, mut shutdown: oneshot::Receiver<()>) {
    let mut interval = tokio::time::interval_at(
        tokio::time::Instant::now() + RUNTIME_USAGE_FLUSH_INTERVAL,
        RUNTIME_USAGE_FLUSH_INTERVAL,
    );
    interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut retention_interval = tokio::time::interval_at(
        tokio::time::Instant::now() + Duration::from_secs(24 * 60 * 60),
        Duration::from_secs(24 * 60 * 60),
    );
    retention_interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            _ = interval.tick() => {
                if let Err(error) = flush_runtime_usage(
                    &core,
                    RuntimeUsageFlushTarget::Periodic,
                    "usage_flush",
                    false,
                ).await {
                    eprintln!("periodic Runtime Usage flush failed: {error:#}");
                }
            }
            _ = retention_interval.tick() => {
                let result = {
                    let mut database = core.database.lock().await;
                    MonitoringService::purge_expired(&mut database)
                };
                if let Err(error) = result {
                    eprintln!("Runtime Usage retention cleanup failed: {error:#}");
                }
            }
            _ = &mut shutdown => {
                if let Err(error) = flush_runtime_usage(
                    &core,
                    RuntimeUsageFlushTarget::All,
                    "shutdown_flush",
                    false,
                ).await {
                    eprintln!("terminal Runtime Usage shutdown flush failed: {error:#}");
                }
                break;
            }
        }
    }
}

async fn process_agent_run_codex_delta_batch(
    core: &Arc<Core>,
    output: &mpsc::UnboundedSender<String>,
    host_instance_id: &str,
    agent_run_id: &str,
    execution_epoch: i64,
    messages: Vec<Value>,
    runtime_route_permit: &mut rovai_core::planned_shutdown::RuntimeRoutePermit,
) {
    let prepared = match prepare_codex_delta_batch(&messages) {
        Ok(Some(prepared)) => prepared,
        Ok(None) => {
            for message in messages {
                process_agent_run_codex_message(
                    core,
                    output,
                    host_instance_id,
                    agent_run_id,
                    execution_epoch,
                    message,
                    runtime_route_permit,
                )
                .await;
            }
            return;
        }
        Err(error) => {
            eprintln!(
                "failed to prepare Codex Runtime Evidence batch for AgentRun {agent_run_id}: {error:#}"
            );
            for message in messages {
                process_agent_run_codex_message(
                    core,
                    output,
                    host_instance_id,
                    agent_run_id,
                    execution_epoch,
                    message,
                    runtime_route_permit,
                )
                .await;
            }
            return;
        }
    };
    let Some(runtime) = core
        .codex_cli
        .get_agent_run_on_host(host_instance_id, agent_run_id, execution_epoch)
        .await
    else {
        return;
    };
    let evidence = match persist_prepared_runtime_evidence_batch(
        core,
        agent_run_id,
        execution_epoch,
        prepared
            .iter()
            .map(|message| message.evidence.clone())
            .collect(),
    )
    .await
    {
        Ok(evidence) => evidence,
        Err(error) => {
            eprintln!(
                "failed to persist Codex Runtime Evidence batch for AgentRun {agent_run_id}; falling back to individual Evidence: {error:#}"
            );
            for message in messages {
                process_agent_run_codex_message(
                    core,
                    output,
                    host_instance_id,
                    agent_run_id,
                    execution_epoch,
                    message,
                    runtime_route_permit,
                )
                .await;
            }
            return;
        }
    };
    for message in &prepared {
        runtime
            .observe_agent_message(&message.native_method, &message.params)
            .await;
    }
    for (message, evidence) in prepared.into_iter().zip(evidence) {
        let Some(evidence) = evidence else {
            continue;
        };
        emit(
            output,
            &evidence.event_type,
            json!({
                "agentRunId": agent_run_id,
                "executionEpoch": execution_epoch,
                "nativeMethod": message.native_method,
                "evidenceId": evidence.id,
                "payload": evidence.payload,
                "canonical": evidence.canonical,
            }),
        );
    }
}

async fn persist_interrupted_codex_activities(
    core: &Core,
    output: &mpsc::UnboundedSender<String>,
    runtime: &CodexRuntime,
    agent_run_id: &str,
    execution_epoch: i64,
) -> Result<usize> {
    let mut inserted = 0_usize;
    for mut item in runtime.open_action_items().await {
        let Some(item_fields) = item.as_object_mut() else {
            continue;
        };
        item_fields.insert(
            "status".to_string(),
            Value::String("interrupted".to_string()),
        );
        if item_fields.get("type").and_then(Value::as_str) == Some("commandExecution") {
            item_fields.insert("aggregatedOutput".to_string(), Value::Null);
        }
        let payload = json!({
            "reasonCode": "runtime_interrupted",
            "item": item,
        });
        let recorded = {
            let mut database = core.database.lock().await;
            ExecutionEvidenceService.record_interrupted_runtime_activity(
                &mut database,
                &ManagedBlobStore::new(&core.data_dir),
                agent_run_id,
                execution_epoch,
                &payload,
            )?
        };
        let Some(recorded) = recorded else {
            continue;
        };
        inserted += usize::from(recorded.inserted);
        let evidence = recorded.into_evidence();
        emit(
            output,
            &evidence.event_type,
            json!({
                "agentRunId": agent_run_id,
                "executionEpoch": execution_epoch,
                "nativeMethod": "turn/completed",
                "evidenceId": evidence.id,
                "payload": evidence.payload,
                "canonical": evidence.canonical,
            }),
        );
    }
    Ok(inserted)
}

async fn process_agent_run_codex_message(
    core: &Arc<Core>,
    output: &mpsc::UnboundedSender<String>,
    host_instance_id: &str,
    agent_run_id: &str,
    execution_epoch: i64,
    message: Value,
    runtime_route_permit: &mut rovai_core::planned_shutdown::RuntimeRoutePermit,
) {
    if is_codex_command_output_delta_notification(&message) {
        return;
    }
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

    let usage = parse_codex_usage_message(&method, &params);
    if !usage.is_empty()
        && let Err(error) = buffer_runtime_usage(
            core,
            agent_run_id,
            execution_epoch,
            &codex_usage_source_identity(&params)
                .or_else(|_| canonical_json_digest(&message))
                .unwrap_or_else(|_| format!("codex:{method}:{agent_run_id}:{execution_epoch}")),
            &usage,
        )
        .await
    {
        eprintln!("failed to persist Codex Usage for AgentRun {agent_run_id}: {error:#}");
    }
    if method == "thread/tokenUsage/updated" {
        return;
    }
    let (event_type, payload) = codex::normalize_event(&method, &params);
    runtime.observe_agent_message(&method, &params).await;
    let evidence = match persist_runtime_evidence(
        core,
        agent_run_id,
        execution_epoch,
        runtime
            .builtin_tool_process_config()
            .map(BuiltinToolProcessConfig::run_tmp),
        event_type,
        &payload,
    )
    .await
    {
        Ok(evidence) => evidence,
        Err(error) => {
            eprintln!("failed to persist Runtime Evidence for AgentRun {agent_run_id}: {error:#}");
            if ExecutionEvidenceService::is_durable_runtime_evidence_event(event_type) {
                return;
            }
            None
        }
    };
    if ExecutionEvidenceService::is_durable_runtime_evidence_event(event_type) && evidence.is_none()
    {
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
    if let Some(diff) = runtime.take_turn_diff(&completed.turn_id).await {
        const MAX_CODEX_RUN_DIFF_BYTES: usize = 8 * 1024 * 1024;
        if diff.len() <= MAX_CODEX_RUN_DIFF_BYTES {
            let payload = json!({
                "eventId": format!("codex-turn-diff:{}", completed.turn_id),
                "runtimeRunDiff": {
                    "schemaVersion": 1,
                    "source": "runtime_reported",
                    "status": "available",
                    "semanticKind": "unified_diff_snapshot",
                    "diff": diff,
                    "sourceMetadata": {
                        "adapterKind": "codex-cli",
                        "protocolFamily": "codex-app-server",
                        "sourceEventKind": "turn/diff/updated+turn/completed",
                        "nativeTurnId": completed.turn_id,
                    }
                }
            });
            let persisted = {
                let mut database = core.database.lock().await;
                ExecutionEvidenceService.record_terminal_run_diff_snapshot_with_managed_output_root(
                    &mut database,
                    &ManagedBlobStore::new(&core.data_dir),
                    agent_run_id,
                    execution_epoch,
                    &payload,
                    runtime
                        .builtin_tool_process_config()
                        .map(BuiltinToolProcessConfig::run_tmp),
                )
            };
            if let Err(error) = persisted {
                eprintln!(
                    "failed to persist Codex Turn diff snapshot for AgentRun {agent_run_id}: {error:#}"
                );
            }
        } else {
            eprintln!("ignored oversized Codex Turn diff snapshot for AgentRun {agent_run_id}");
        }
    }
    if completed.status == "interrupted"
        && let Err(error) = persist_interrupted_codex_activities(
            core,
            output,
            &runtime,
            agent_run_id,
            execution_epoch,
        )
        .await
    {
        eprintln!(
            "failed to persist interrupted Runtime Activities for AgentRun {agent_run_id}: {error:#}"
        );
    }
    if let Err(error) =
        flush_runtime_monitoring_run(core, agent_run_id, execution_epoch, "terminal_flush").await
    {
        eprintln!("failed to flush Codex monitoring for AgentRun {agent_run_id}: {error:#}");
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
    } else if completed.status == "cancelled" {
        RuntimeTerminalOutcome::Cancelled
    } else if completed.status == "interrupted" {
        RuntimeTerminalOutcome::Interrupted
    } else {
        RuntimeTerminalOutcome::Failed
    };
    let terminal_discriminator = canonical_json_digest(&params)
        .unwrap_or_else(|_| format!("{}:{}", completed.turn_id, completed.status));
    let mut terminal_admission = match core
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
    if let Some(permit) = terminal_admission.planned_permit()
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
        let error_code = match completed.status.as_str() {
            "completed" => "runtime_missing_final_output".to_string(),
            "interrupted" => "runtime_interrupted".to_string(),
            status => format!("runtime_turn_{status}"),
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
                    failure: None,
                    manual_retry_allowed: planned_outcome == RuntimeTerminalOutcome::Failed,
                },
            )
            .await
        {
            Ok(settlement) => {
                core.planned_shutdown
                    .remove_active(&ActiveExecutionKey::new(agent_run_id, execution_epoch))
                    .await;
                terminal_admission.complete_settlement();
                runtime_route_permit.complete_callback();
                emit_agent_run_terminal(
                    output,
                    None,
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
                core.project_agent_run_file_changes_after_terminal(agent_run_id, execution_epoch)
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
                match terminal_admission.planned_permit() {
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
                            failure: None,
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
                        error_code: if completed.status == "interrupted" {
                            "runtime_interrupted".to_string()
                        } else {
                            format!("runtime_turn_{}", completed.status)
                        },
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
                        failure: None,
                        manual_retry_allowed: true,
                        ending_git_observation,
                    },
                },
            )
        };
        match terminal {
            Ok(terminal) if terminal.result.status != CommandResultStatus::Rejected => {
                core.planned_shutdown
                    .remove_active(&ActiveExecutionKey::new(agent_run_id, execution_epoch))
                    .await;
                terminal_admission.complete_settlement();
                runtime_route_permit.complete_callback();
                emit_agent_run_terminal(
                    output,
                    Some(&execution.camp_id),
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
    core.project_agent_run_file_changes_after_terminal(agent_run_id, execution_epoch)
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
    if core.planned_shutdown.shutdown_started() {
        return;
    }
    if let Err(error) =
        flush_runtime_monitoring_run(core, agent_run_id, execution_epoch, "host_exit_flush").await
    {
        eprintln!(
            "failed to flush Codex monitoring after Host exit for AgentRun {agent_run_id}: {error:#}"
        );
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

async fn dispatch_pending_camp_inputs(core: &Core) {
    let mut database = core.database.lock().await;
    let heads = match rovai_core::pending_camp_input::ready_heads(&database) {
        Ok(heads) => heads,
        Err(error) => {
            eprintln!("Pending Camp Input admission failed: {error:#}");
            return;
        }
    };
    for command in heads {
        let camp_id = command.camp_id.clone();
        let envelope =
            user_camp_command_envelope(uuid::Uuid::new_v4().to_string(), camp_id.clone(), command);
        match CollaborationService::default().send_pending_camp_input(&mut database, &envelope) {
            Ok(execution) if execution.result.status != CommandResultStatus::Rejected => {
                emit_navigation_invalidated(
                    &core.output,
                    "camp.pendingInputs.published",
                    Some(&camp_id),
                );
            }
            Ok(_) => {}
            Err(error) => eprintln!("Pending Camp Input publication paused: {error:#}"),
        }
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
                dispatch_pending_camp_inputs(&core).await;
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
    mut requests: mpsc::UnboundedReceiver<RuntimeCheckRequest>,
    mut shutdown: oneshot::Receiver<()>,
) {
    let mut checks: tokio::task::JoinSet<RuntimeCheckWorkerResult> = tokio::task::JoinSet::new();
    let mut active: HashMap<tokio::task::Id, RuntimeCheckAttempt> = HashMap::new();
    let mut pending: Vec<RuntimeCheckAttempt> = Vec::new();
    let mut execution_deferrals = RuntimeCheckExecutionDeferrals::default();
    loop {
        tokio::select! {
            request = requests.recv() => {
                let Some(request) = request else { break };
                if execution_deferrals.should_defer(request.runtime_kind, request.trigger) {
                    if let Some(completion) = request.completion {
                        let _ = completion.send(Ok(RuntimeCheckOutcome::Superseded));
                    }
                    let _ = request.acknowledged.send(false);
                    continue;
                }
                if let Some(existing) = pending
                    .iter_mut()
                    .find(|attempt| attempt.runtime_kind == request.runtime_kind)
                {
                    if request.trigger > existing.trigger {
                        existing.trigger = request.trigger;
                        existing.purpose = request.purpose;
                    }
                    if let Some(completion) = request.completion {
                        existing.waiters.push(completion);
                    }
                    let _ = request.acknowledged.send(false);
                    continue;
                }
                if let Some(existing) = active
                    .values_mut()
                    .find(|attempt| attempt.runtime_kind == request.runtime_kind)
                {
                    if request.trigger > existing.trigger {
                        existing.trigger = request.trigger;
                    }
                    if let Some(completion) = request.completion {
                        existing.waiters.push(completion);
                    }
                    let _ = request.acknowledged.send(false);
                    continue;
                }

                let attempt_id = uuid::Uuid::new_v4().to_string();
                let started_at = tokio::time::Instant::now();
                let deadline = started_at + RUNTIME_CHECK_TOTAL_DEADLINE;
                let deadline_at = chrono::Utc::now()
                    + chrono::Duration::from_std(RUNTIME_CHECK_TOTAL_DEADLINE)
                        .unwrap_or_else(|_| chrono::Duration::seconds(90));
                let mut waiters = Vec::new();
                if let Some(completion) = request.completion {
                    waiters.push(completion);
                }
                let attempt = RuntimeCheckAttempt {
                    attempt_id: attempt_id.clone(),
                    runtime_kind: request.runtime_kind,
                    purpose: request.purpose,
                    trigger: request.trigger,
                    started_at,
                    deadline,
                    waiters,
                };
                core.runtime_check_activity.write().await.insert(
                    request.runtime_kind,
                    RuntimeCheckActivity {
                        attempt_id,
                        runtime_kind: request.runtime_kind,
                        deadline: deadline_at,
                        running: false,
                    },
                );
                emit(
                    &core.output,
                    "runtime.availability.updated",
                    json!({ "runtimeKind": request.runtime_kind, "status": "checking" }),
                );
                pending.push(attempt);
                let _ = request.acknowledged.send(true);
            },
            completed = checks.join_next_with_id(), if !checks.is_empty() => {
                match completed {
                    Some(Ok((task_id, worker))) => {
                        if let Some(attempt) = active.remove(&task_id) {
                            if worker.attempt_id != attempt.attempt_id
                                || worker.runtime_kind != attempt.runtime_kind
                            {
                                finalize_runtime_check(
                                    &core,
                                    attempt,
                                    Err("runtime_check_attempt_identity_mismatch".to_string()),
                                    RuntimeCheckFinalization::Supervisor,
                                )
                                .await;
                            } else {
                                execution_deferrals.record(
                                    attempt.runtime_kind,
                                    attempt.trigger,
                                    &worker.result,
                                );
                                finalize_runtime_check(
                                    &core,
                                    attempt,
                                    worker.result,
                                    worker.finalization,
                                )
                                .await;
                            }
                        }
                    }
                    Some(Err(error)) => {
                        let task_id = error.id();
                        if let Some(attempt) = active.remove(&task_id) {
                            let diagnostic = if error.is_cancelled() {
                                "runtime_check_cancelled"
                            } else if error.is_panic() {
                                "runtime_check_worker_panicked"
                            } else {
                                "runtime_check_join_failed"
                            };
                            let finalization = if error.is_cancelled() {
                                RuntimeCheckFinalization::CleanupOnly
                            } else {
                                RuntimeCheckFinalization::Supervisor
                            };
                            finalize_runtime_check(
                                &core,
                                attempt,
                                Err(diagnostic.to_string()),
                                finalization,
                            )
                            .await;
                        }
                    }
                    None => {}
                }
            },
            _ = &mut shutdown => break,
        }

        while runtime_check_has_capacity(active.len()) && !pending.is_empty() {
            let next = pending
                .iter()
                .enumerate()
                .max_by_key(|(_, attempt)| attempt.trigger)
                .map(|(index, _)| index)
                .expect("pending Runtime attempt index must exist");
            let attempt = pending.swap_remove(next);
            if let Some(activity) = core
                .runtime_check_activity
                .write()
                .await
                .get_mut(&attempt.runtime_kind)
                .filter(|activity| activity.attempt_id == attempt.attempt_id)
            {
                activity.running = true;
            }
            let check_core = core.clone();
            let worker_attempt_id = attempt.attempt_id.clone();
            let worker_kind = attempt.runtime_kind;
            let worker_purpose = attempt.purpose;
            let worker_deadline = attempt.deadline;
            let abort_handle = checks.spawn(async move {
                let (result, finalization) = match tokio::time::timeout_at(
                    worker_deadline,
                    check_core.run_product_runtime_resolution(
                        worker_kind,
                        worker_purpose,
                        worker_deadline,
                    ),
                )
                .await
                {
                    Ok(Ok(outcome)) => (Ok(outcome), RuntimeCheckFinalization::Product),
                    Ok(Err(error)) => (
                        Err(format!("runtime_check_failed: {error:#}")),
                        RuntimeCheckFinalization::Product,
                    ),
                    Err(_) => (
                        Err("runtime_check_timed_out".to_string()),
                        RuntimeCheckFinalization::Supervisor,
                    ),
                };
                RuntimeCheckWorkerResult {
                    attempt_id: worker_attempt_id,
                    runtime_kind: worker_kind,
                    result,
                    finalization,
                }
            });
            active.insert(abort_handle.id(), attempt);
        }
    }

    checks.abort_all();
    while let Some(completed) = checks.join_next_with_id().await {
        let task_id = match completed {
            Ok((task_id, _)) => task_id,
            Err(error) => error.id(),
        };
        if let Some(attempt) = active.remove(&task_id) {
            finalize_runtime_check(
                &core,
                attempt,
                Err("runtime_check_shutdown".to_string()),
                RuntimeCheckFinalization::CleanupOnly,
            )
            .await;
        }
    }
    for attempt in pending {
        finalize_runtime_check(
            &core,
            attempt,
            Err("runtime_check_shutdown".to_string()),
            RuntimeCheckFinalization::CleanupOnly,
        )
        .await;
    }
}

async fn finalize_runtime_check(
    core: &Core,
    attempt: RuntimeCheckAttempt,
    result: std::result::Result<RuntimeCheckOutcome, String>,
    finalization: RuntimeCheckFinalization,
) {
    let owns_terminal = {
        let mut activity = core.runtime_check_activity.write().await;
        take_runtime_check_activity(&mut activity, attempt.runtime_kind, &attempt.attempt_id)
    };
    if !owns_terminal {
        for waiter in attempt.waiters {
            let _ = waiter.send(result.clone());
        }
        return;
    }

    if let Err(diagnostic_code) = &result
        && runtime_check_writes_diagnostic(finalization)
    {
        if finalization == RuntimeCheckFinalization::Supervisor
            && let Err(error) = core
                .record_runtime_check_manager_failure(attempt.runtime_kind, diagnostic_code)
                .await
        {
            eprintln!(
                "failed to persist Runtime check supervisor failure for {}: {error:#}",
                attempt.runtime_kind.as_str()
            );
        }
        core.runtime_product_diagnostics
            .write()
            .await
            .entry(attempt.runtime_kind)
            .or_insert_with(|| ProductRuntimeDiagnostic {
                status: "needs_attention",
                diagnostic_code: diagnostic_code.clone(),
                priority: 2,
                failure: None,
            });
        eprintln!(
            "Runtime check {} for {} finalized with {} after {} ms",
            attempt.attempt_id,
            attempt.runtime_kind.as_str(),
            diagnostic_code,
            attempt.started_at.elapsed().as_millis(),
        );
    }

    let event_status = core
        .current_runtime_availability_status(attempt.runtime_kind)
        .await;
    emit(
        &core.output,
        "runtime.availability.updated",
        json!({
            "runtimeKind": attempt.runtime_kind,
            "status": event_status,
        }),
    );

    if result
        .as_ref()
        .is_ok_and(|outcome| *outcome == RuntimeCheckOutcome::Ready)
        && let Err(error) = core
            .pump_runtime_ready_recipients(attempt.runtime_kind)
            .await
    {
        eprintln!(
            "failed to pump Message Deliveries after Runtime {} became ready: {error:#}",
            attempt.runtime_kind.as_str()
        );
    }
    for waiter in attempt.waiters {
        let _ = waiter.send(result.clone());
    }
}

fn take_runtime_check_activity(
    activity: &mut BTreeMap<AdapterKind, RuntimeCheckActivity>,
    runtime_kind: AdapterKind,
    attempt_id: &str,
) -> bool {
    if activity
        .get(&runtime_kind)
        .is_some_and(|current| current.attempt_id == attempt_id)
    {
        activity.remove(&runtime_kind);
        true
    } else {
        false
    }
}

fn runtime_check_has_capacity(active_count: usize) -> bool {
    active_count < RUNTIME_CHECK_MAX_CONCURRENCY
}

fn unknown_one_shot_runtime_failure(
    runtime_kind: AdapterKind,
    error_code: &str,
) -> Option<RuntimeFailureView> {
    let runtime_name = match runtime_kind {
        AdapterKind::ClaudeCodeCli => "Claude Code",
        AdapterKind::AntigravityApp => "Antigravity",
        _ => return None,
    };
    let (origin, summary, retryable) = if error_code == "context_payload_too_large" {
        (
            RuntimeFailureOrigin::Rovai,
            "Rovai 无法安全生成本次 Runtime 输入".to_string(),
            false,
        )
    } else {
        (
            RuntimeFailureOrigin::Unknown,
            format!("{runtime_name} 未能完成运行"),
            true,
        )
    };
    Some(RuntimeFailureView::new(
        runtime_kind,
        origin,
        RuntimeFailurePhase::Execution,
        error_code,
        summary,
        None,
        retryable,
    ))
}

fn availability_environment_failure(
    runtime_kind: AdapterKind,
    error_code: &str,
    summary: &str,
) -> Option<RuntimeFailureView> {
    let runtime_name = match runtime_kind {
        AdapterKind::ClaudeCodeCli => "Claude Code",
        AdapterKind::AntigravityApp => "Antigravity",
        _ => return None,
    };
    Some(RuntimeFailureView::new(
        runtime_kind,
        RuntimeFailureOrigin::Environment,
        RuntimeFailurePhase::Spawn,
        error_code,
        summary.replace("Runtime", runtime_name),
        None,
        true,
    ))
}

fn dispatch_public_failure(
    candidate: &rovai_core::runtime::QueuedAgentRunCandidate,
    error_code: &str,
) -> Option<RuntimeFailureView> {
    let runtime_kind = candidate
        .effective_config
        .get("adapterKind")
        .cloned()
        .and_then(|value| serde_json::from_value::<AdapterKind>(value).ok())?;
    let runtime_name = match runtime_kind {
        AdapterKind::ClaudeCodeCli => "Claude Code",
        AdapterKind::AntigravityApp => "Antigravity",
        _ => return None,
    };
    let (origin, phase, summary, retryable) = match error_code {
        "workspace_unavailable" => (
            RuntimeFailureOrigin::Environment,
            RuntimeFailurePhase::Spawn,
            format!("{runtime_name} 的执行目录不可用"),
            false,
        ),
        "runtime_configuration_invalid" => (
            RuntimeFailureOrigin::Rovai,
            RuntimeFailurePhase::Spawn,
            "Rovai 无法生成有效的 Runtime 配置".to_string(),
            false,
        ),
        "runtime_authentication_required" => (
            RuntimeFailureOrigin::Runtime,
            RuntimeFailurePhase::Authentication,
            format!("需要登录 {runtime_name}"),
            true,
        ),
        code if code.contains("path")
            || code.contains("executable")
            || code.contains("fingerprint") =>
        {
            (
                RuntimeFailureOrigin::Environment,
                RuntimeFailurePhase::Spawn,
                format!("{runtime_name} 的本机运行环境不可用"),
                false,
            )
        }
        code if code.contains("incompatible") || code.contains("capability") => (
            RuntimeFailureOrigin::Compatibility,
            RuntimeFailurePhase::Execution,
            format!("当前 {runtime_name} 版本与 Rovai 集成不兼容"),
            false,
        ),
        _ => (
            RuntimeFailureOrigin::Unknown,
            RuntimeFailurePhase::Spawn,
            format!("{runtime_name} 未能开始运行"),
            true,
        ),
    };
    Some(RuntimeFailureView::new(
        runtime_kind,
        origin,
        phase,
        error_code,
        summary,
        None,
        retryable,
    ))
}

fn runtime_check_writes_diagnostic(finalization: RuntimeCheckFinalization) -> bool {
    finalization != RuntimeCheckFinalization::CleanupOnly
}

fn emit(output: &mpsc::UnboundedSender<String>, method: &str, params: Value) {
    let message = json!({"method": method, "params": params});
    if let Ok(serialized) = serde_json::to_string(&message) {
        let _ = output.send(serialized);
    }
}

fn emit_navigation_invalidated(
    output: &mpsc::UnboundedSender<String>,
    reason: &str,
    camp_id: Option<&str>,
) {
    emit(
        output,
        "navigation.invalidated",
        match camp_id {
            Some(camp_id) => json!({ "reason": reason, "campId": camp_id }),
            None => json!({ "reason": reason }),
        },
    );
}

fn emit_agent_run_terminal(
    output: &mpsc::UnboundedSender<String>,
    camp_id: Option<&str>,
    params: Value,
) {
    emit(output, "agent_run.terminal", params);
    emit_navigation_invalidated(output, "agent_run.terminal", camp_id);
}

async fn write_output(
    mut receiver: mpsc::UnboundedReceiver<String>,
    mut control: mpsc::Receiver<OutputControl>,
) -> Result<()> {
    let mut output = BufWriter::new(tokio::io::stdout());
    loop {
        let line = tokio::select! {
            biased;
            command = control.recv() => match command {
                Some(OutputControl::CloseAndFlush(acknowledged)) => {
                    receiver.close();
                    while let Some(line) = receiver.recv().await {
                        output.write_all(line.as_bytes()).await?;
                        output.write_all(b"\n").await?;
                    }
                    let result = output.flush().await.context("failed to flush Core stdout");
                    let _ = acknowledged.send(result);
                    return Ok(());
                }
                None => receiver.recv().await,
            },
            line = receiver.recv() => line,
        };
        let Some(line) = line else {
            break;
        };
        output.write_all(line.as_bytes()).await?;
        output.write_all(b"\n").await?;
        output.flush().await?;
    }
    output.flush().await?;
    Ok(())
}

async fn serve_builtin_tool_ipc(core: Arc<Core>, mut shutdown: oneshot::Receiver<()>) {
    let mut connections = tokio::task::JoinSet::new();
    loop {
        // A failed bind disables execution, not the authority/RPC server. The
        // initializer publishes a new listener after an explicit feature retry.
        let mut listener = loop {
            if let Some(listener) = core.builtin_tool_listener.lock().await.take() {
                break listener;
            }
            tokio::select! {
                _ = core.builtin_tool_listener_notify.notified() => {},
                _ = &mut shutdown => return,
            }
        };
        let admission_error = loop {
            let accepted = tokio::select! {
                accepted = listener.accept() => accepted,
                _ = &mut shutdown => return,
                completed = connections.join_next(), if !connections.is_empty() => {
                    if let Some(Err(error)) = completed {
                        eprintln!("Built-in Tool IPC worker failed: {error}");
                    }
                    continue;
                },
            };
            let stream = match accepted {
                Ok(stream) => stream,
                Err(error) => {
                    eprintln!("Built-in Tool IPC accept failed: {error:#}");
                    if error.closes_admission() {
                        break error;
                    }
                    continue;
                }
            };
            let core = core.clone();
            connections.spawn(async move {
                if let Err(error) = handle_builtin_tool_connection(core, stream).await {
                    eprintln!("Built-in Tool IPC request failed: {error:#}");
                }
            });
        };
        drop(listener);
        connections.abort_all();
        while connections.try_join_next().is_some() {}
        core.finish_subsystem("builtin-tools", Err(admission_error.into()));
    }
}

async fn handle_builtin_tool_connection(core: Arc<Core>, stream: LocalIpcStream) -> Result<()> {
    let (reader, mut writer) = tokio::io::split(stream);
    let reader = BufReader::new(reader);
    let mut limited = reader.take((BUILTIN_TOOL_MAX_IPC_REQUEST_BYTES + 2) as u64);
    let mut frame = Vec::new();
    let read = limited.read_until(b'\n', &mut frame).await?;
    let oversized = frame.len() > BUILTIN_TOOL_MAX_IPC_REQUEST_BYTES + 1;
    let line = if read > 0 && frame.last() == Some(&b'\n') && !oversized {
        frame.pop();
        if frame.last() == Some(&b'\r') {
            frame.pop();
        }
        String::from_utf8(frame).ok()
    } else {
        None
    };
    let response = match line {
        Some(line) => {
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
        None if oversized => serde_json::to_value(BuiltinToolIpcResponse::ipc_error(
            "builtin_tool.ipc_request_too_large",
            "Built-in Tool IPC request exceeds 1 MiB",
        ))?,
        None if read == 0 => return Ok(()),
        None => serde_json::to_value(BuiltinToolIpcResponse::ipc_error(
            "builtin_tool.invalid_ipc_request",
            "Built-in Tool IPC request is malformed",
        ))?,
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
        "agent_profile.display_name_conflict" => &["displayName"],
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
    if let Some(error) = error.downcast_ref::<MemberCreateError>() {
        return (
            error.code.to_string(),
            error.message.to_string(),
            error.details.clone(),
        );
    }
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

fn parse_runtime_camp_files_root() -> Result<PathBuf> {
    parse_runtime_camp_files_root_from(std::env::args().skip(1))
}

fn parse_windows_data_root_preparation() -> Result<Option<PathBuf>> {
    parse_windows_data_root_preparation_from(std::env::args().skip(1))
}

fn parse_windows_data_root_preparation_from(
    args: impl IntoIterator<Item = String>,
) -> Result<Option<PathBuf>> {
    let mut args = args.into_iter();
    let mut root = None;
    let mut has_data_dir = false;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--prepare-windows-data-root" => {
                let path = args
                    .next()
                    .map(PathBuf::from)
                    .context("--prepare-windows-data-root requires a path")?;
                if !path.is_absolute()
                    || path.components().any(|component| {
                        matches!(
                            component,
                            std::path::Component::CurDir | std::path::Component::ParentDir
                        )
                    })
                {
                    anyhow::bail!(
                        "--prepare-windows-data-root requires a normalized absolute path"
                    );
                }
                if root.replace(path).is_some() {
                    anyhow::bail!("--prepare-windows-data-root may be provided only once");
                }
            }
            "--data-dir" => {
                has_data_dir = true;
            }
            _ => {}
        }
    }
    if root.is_some() && has_data_dir {
        anyhow::bail!("--prepare-windows-data-root and --data-dir are mutually exclusive");
    }
    Ok(root)
}

fn parse_skill_library_root() -> Result<PathBuf> {
    match parse_skill_library_root_from(std::env::args().skip(1))? {
        SkillLibraryRootSelection::Explicit(root) => Ok(root),
        SkillLibraryRootSelection::Default => SkillLibraryService::default_root(),
    }
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

fn parse_runtime_camp_files_root_from(args: impl IntoIterator<Item = String>) -> Result<PathBuf> {
    let mut args = args.into_iter();
    let mut root = None;
    while let Some(arg) = args.next() {
        if arg == "--runtime-camp-files-root" {
            let path = args
                .next()
                .map(PathBuf::from)
                .context("--runtime-camp-files-root requires a path")?;
            if !path.is_absolute()
                || path.components().any(|component| {
                    matches!(
                        component,
                        std::path::Component::CurDir | std::path::Component::ParentDir
                    )
                })
            {
                anyhow::bail!("--runtime-camp-files-root requires a normalized absolute path");
            }
            if root.replace(path).is_some() {
                anyhow::bail!("--runtime-camp-files-root may be provided only once");
            }
        }
    }
    root.context(
        "rovai-core requires an explicit absolute --runtime-camp-files-root; refusing to infer a shared Home root",
    )
}

#[derive(Debug, PartialEq, Eq)]
enum SkillLibraryRootSelection {
    Explicit(PathBuf),
    Default,
}

fn parse_skill_library_root_from(
    args: impl IntoIterator<Item = String>,
) -> Result<SkillLibraryRootSelection> {
    let mut args = args.into_iter();
    let mut skill_library_root = None;
    let mut use_default_skill_library = false;
    while let Some(arg) = args.next() {
        if arg == "--use-default-skill-library" {
            if use_default_skill_library {
                anyhow::bail!("--use-default-skill-library may be provided only once");
            }
            use_default_skill_library = true;
        } else if arg == "--skill-library-root" {
            let path = args
                .next()
                .map(PathBuf::from)
                .context("--skill-library-root requires a path")?;
            if !path.is_absolute()
                || path.components().any(|component| {
                    matches!(
                        component,
                        std::path::Component::CurDir | std::path::Component::ParentDir
                    )
                })
            {
                anyhow::bail!("--skill-library-root requires a normalized absolute path");
            }
            if skill_library_root.replace(path).is_some() {
                anyhow::bail!("--skill-library-root may be provided only once");
            }
        }
    }
    match (skill_library_root, use_default_skill_library) {
        (Some(_), true) => anyhow::bail!(
            "--skill-library-root and --use-default-skill-library are mutually exclusive"
        ),
        (Some(root), false) => Ok(SkillLibraryRootSelection::Explicit(root)),
        (None, true) => Ok(SkillLibraryRootSelection::Default),
        (None, false) => anyhow::bail!(
            "rovai-core requires exactly one Skill Library selection: pass an explicit absolute --skill-library-root for isolated instances or --use-default-skill-library for the daily App"
        ),
    }
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
    #[cfg(feature = "slow-tests")]
    use std::fs;

    #[test]
    fn acp_prompt_failure_is_retryable_only_when_input_was_not_accepted() {
        assert!(acp_prompt_manual_retry_allowed(
            RuntimeTerminalOutcome::Failed,
            Some("not_accepted")
        ));
        for delivery_status in [Some("accepted"), Some("delivery_unknown"), None] {
            assert!(!acp_prompt_manual_retry_allowed(
                RuntimeTerminalOutcome::Failed,
                delivery_status,
            ));
        }
        assert!(!acp_prompt_manual_retry_allowed(
            RuntimeTerminalOutcome::Cancelled,
            Some("not_accepted")
        ));
    }

    #[cfg(feature = "slow-tests")]
    #[tokio::test]
    async fn composer_prepare_releases_database_mutex_during_authority_file_io() {
        let fixture = std::env::temp_dir().join(format!(
            "rovai-composer-database-lock-test-{}",
            uuid::Uuid::new_v4()
        ));
        let data_dir = fixture.join("data");
        let source = fixture.join("source.txt");
        fs::create_dir_all(&fixture).unwrap();
        fs::write(&source, b"lock-free filesystem phase").unwrap();

        let database = Mutex::new(Database::open(&data_dir).unwrap());
        let camp_id = "rvcamp_01h47kvsy5fk1shh6w1g60eecf";
        {
            let database = database.lock().await;
            rovai_core::camp_attachment::insert_test_camp(&database, camp_id);
        }

        let pause =
            rovai_core::camp_attachment::install_composer_prepare_test_pause(&data_dir, camp_id);
        let (output, _receiver) = mpsc::unbounded_channel();
        let prepare = prepare_composer_attachment_from_path(
            &database,
            &output,
            &data_dir,
            PrepareAttachmentFromPathParams {
                camp_id: CampId::parse(camp_id).unwrap(),
                expected_revision: 0,
                source_path: source.to_string_lossy().into_owned(),
                display_name: "source.txt".to_string(),
            },
        );
        let observe_database = async {
            let filesystem_phase_started = tokio::time::timeout(Duration::from_secs(2), async {
                while !pause.started() {
                    tokio::task::yield_now().await;
                }
            })
            .await
            .is_ok();
            let database_was_available = if filesystem_phase_started {
                match tokio::time::timeout(Duration::from_secs(1), database.lock()).await {
                    Ok(database) => {
                        drop(database);
                        true
                    }
                    Err(_) => false,
                }
            } else {
                false
            };
            pause.release();
            database_was_available
        };

        let (prepared, database_was_available) = tokio::join!(prepare, observe_database);
        rovai_core::camp_attachment::remove_composer_prepare_test_pause(&data_dir, camp_id);
        assert!(
            database_was_available,
            "Authority gate wait and file I/O must not retain the global Database mutex"
        );
        assert_eq!(
            prepared.unwrap()["attachments"].as_array().unwrap().len(),
            1
        );

        CampAttachmentStore::new(&data_dir)
            .remove_camp(camp_id)
            .unwrap();
        drop(database);
        fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn runtime_check_activity_has_two_slots_and_one_terminal_owner() {
        assert!(runtime_check_has_capacity(0));
        assert!(runtime_check_has_capacity(1));
        assert!(!runtime_check_has_capacity(2));

        let mut activity = BTreeMap::from([(
            AdapterKind::QwenCode,
            RuntimeCheckActivity {
                attempt_id: "attempt-new".to_string(),
                runtime_kind: AdapterKind::QwenCode,
                deadline: chrono::Utc::now(),
                running: true,
            },
        )]);
        assert!(!take_runtime_check_activity(
            &mut activity,
            AdapterKind::QwenCode,
            "attempt-old",
        ));
        assert!(take_runtime_check_activity(
            &mut activity,
            AdapterKind::QwenCode,
            "attempt-new",
        ));
        assert!(!take_runtime_check_activity(
            &mut activity,
            AdapterKind::QwenCode,
            "attempt-new",
        ));
        assert!(activity.is_empty());
        assert!(RuntimeCheckOutcome::Ready.is_ready());
        assert_eq!(
            RuntimeCheckOutcome::StableFailure.public_status(),
            "stable_failure"
        );
        assert_eq!(RuntimeCheckOutcome::Superseded.public_status(), "deferred");
    }

    #[test]
    fn superseded_execution_uses_a_bounded_cooldown_and_recovers_automatically() {
        let runtime_kind = AdapterKind::QwenCode;
        let mut deferrals = RuntimeCheckExecutionDeferrals::default();
        let now = tokio::time::Instant::now();
        assert!(!deferrals.should_defer_at(runtime_kind, RuntimeCheckTrigger::Execution, now));

        deferrals.record_at(
            runtime_kind,
            RuntimeCheckTrigger::Execution,
            &Ok(RuntimeCheckOutcome::Superseded),
            now,
        );
        assert!(deferrals.should_defer_at(runtime_kind, RuntimeCheckTrigger::Execution, now));
        assert!(deferrals.should_defer_at(
            runtime_kind,
            RuntimeCheckTrigger::Execution,
            now + RUNTIME_CHECK_EXECUTION_COOLDOWN - Duration::from_millis(1)
        ));
        assert!(!deferrals.should_defer_at(
            runtime_kind,
            RuntimeCheckTrigger::Execution,
            now + RUNTIME_CHECK_EXECUTION_COOLDOWN
        ));
        assert!(!deferrals.should_defer_at(
            runtime_kind,
            RuntimeCheckTrigger::Execution,
            now + RUNTIME_CHECK_EXECUTION_COOLDOWN + Duration::from_secs(1)
        ));

        deferrals.record_at(
            runtime_kind,
            RuntimeCheckTrigger::Execution,
            &Ok(RuntimeCheckOutcome::Superseded),
            now,
        );
        assert!(!deferrals.should_defer_at(runtime_kind, RuntimeCheckTrigger::CatalogOpen, now));
        assert!(!deferrals.should_defer_at(runtime_kind, RuntimeCheckTrigger::Execution, now));

        deferrals.record_at(
            runtime_kind,
            RuntimeCheckTrigger::UserCheck,
            &Ok(RuntimeCheckOutcome::Superseded),
            now,
        );
        assert!(!deferrals.should_defer_at(runtime_kind, RuntimeCheckTrigger::Execution, now));
    }

    #[cfg(all(target_os = "macos", feature = "slow-tests"))]
    fn runtime_resolution_test_core(root: &Path) -> Result<Core> {
        let data_dir = root.join("data");
        let skill_library_root = root.join("skills");
        let runtime_camp_files_root = root.join("runtime-files");
        std::fs::create_dir_all(&data_dir)?;
        std::fs::create_dir_all(&skill_library_root)?;
        let attachment_views =
            CampAttachmentViewStore::for_isolated_test_root(&runtime_camp_files_root)?;
        let database = Database::open_with_runtime_camp_files_root(
            &data_dir,
            attachment_views.root(),
            attachment_views.root_identity_digest(),
        )?;
        let skill_library = SkillLibraryService::new(skill_library_root)?;
        let mcp_config = McpConfigStore::new(root.join("mcp.json"));
        let mcp_projection = McpProjectionService::new(&data_dir);
        let compaction_detector_policies =
            DesiredCompactionDetectorPolicies::from_process_environment();
        let (output, _output_rx) = mpsc::unbounded_channel();
        let (runtime_check_requests, _runtime_check_rx) = mpsc::unbounded_channel();
        let (attachment_projection_requests, _attachment_projection_rx) = mpsc::unbounded_channel();
        let (codex_tx, _codex_rx) = mpsc::unbounded_channel();
        let (acp_tx, _acp_rx) = mpsc::unbounded_channel();
        let builtin_tool_leases = Arc::new(BuiltinToolLeaseRegistry::default());
        let runtime_fleet = Arc::new(AgentRuntimeFleetManager::new_with_builtin_tools(
            AgentRuntimeFleetConfig::default(),
            &data_dir,
            builtin_tool_leases.clone(),
        ));

        Ok(Core {
            database: Mutex::new(database),
            subsystems: CoreSubsystems::ready_for_test(),
            subsystem_initialization: Mutex::new(SubsystemInitialization::default()),
            startup_skill_execution_roots: Vec::new(),
            startup_pending_camp_ids: Vec::new(),
            builtin_tool_listener: Mutex::new(None),
            builtin_tool_listener_notify: Notify::new(),
            runtime_usage: Mutex::new(RuntimeUsageBuffer::default()),
            runtime_usage_flush: Mutex::new(()),
            output,
            runtime_search_environment: RwLock::new(Arc::new(
                RuntimeSearchEnvironment::for_test_paths(1, Vec::new()),
            )),
            runtime_discovery: RwLock::new(BTreeMap::new()),
            runtime_product_diagnostics: RwLock::new(BTreeMap::new()),
            runtime_check_activity: RwLock::new(BTreeMap::new()),
            runtime_check_requests,
            attachment_projection_requests,
            compaction_detector_policies: compaction_detector_policies.clone(),
            agent_run_cancellation_notify: Notify::new(),
            pending_execution_recovery: Mutex::new(()),
            skill_library,
            mcp_config: Ok(mcp_config),
            mcp_projection,
            codex_cli: CodexCliRuntimeAdapter::new(codex_tx, runtime_fleet.clone()),
            opencode_cli: AcpCliRuntimeAdapter::new(
                AdapterKind::OpencodeCli,
                acp_tx.clone(),
                data_dir.join("runtime/opencode"),
                runtime_fleet.clone(),
                compaction_detector_policies
                    .policy_for(AdapterKind::OpencodeCli)
                    .unwrap_or(CompactionDetectorPolicy::Disabled),
            )?,
            copilot_cli: AcpCliRuntimeAdapter::new(
                AdapterKind::CopilotCli,
                acp_tx.clone(),
                data_dir.join("runtime/copilot"),
                runtime_fleet.clone(),
                compaction_detector_policies
                    .policy_for(AdapterKind::CopilotCli)
                    .unwrap_or(CompactionDetectorPolicy::Disabled),
            )?,
            kiro_cli: AcpCliRuntimeAdapter::new(
                AdapterKind::KiroCli,
                acp_tx.clone(),
                data_dir.join("runtime/kiro"),
                runtime_fleet.clone(),
                compaction_detector_policies
                    .policy_for(AdapterKind::KiroCli)
                    .unwrap_or(CompactionDetectorPolicy::Disabled),
            )?,
            qoder_cli: AcpCliRuntimeAdapter::new(
                AdapterKind::QoderCli,
                acp_tx.clone(),
                data_dir.join("runtime/qoder"),
                runtime_fleet.clone(),
                compaction_detector_policies
                    .policy_for(AdapterKind::QoderCli)
                    .unwrap_or(CompactionDetectorPolicy::Disabled),
            )?,
            codebuddy_cli: AcpCliRuntimeAdapter::new(
                AdapterKind::CodebuddyCli,
                acp_tx.clone(),
                data_dir.join("runtime/codebuddy"),
                runtime_fleet.clone(),
                compaction_detector_policies
                    .policy_for(AdapterKind::CodebuddyCli)
                    .unwrap_or(CompactionDetectorPolicy::Disabled),
            )?,
            qwen_code: AcpCliRuntimeAdapter::new(
                AdapterKind::QwenCode,
                acp_tx.clone(),
                data_dir.join("runtime/qwen"),
                runtime_fleet.clone(),
                compaction_detector_policies
                    .policy_for(AdapterKind::QwenCode)
                    .unwrap_or(CompactionDetectorPolicy::Disabled),
            )?,
            trae_cn_cli: AcpCliRuntimeAdapter::new(
                AdapterKind::TraeCnCli,
                acp_tx.clone(),
                data_dir.join("runtime/trae-cn"),
                runtime_fleet.clone(),
                CompactionDetectorPolicy::Disabled,
            )?,
            cursor_agent: AcpCliRuntimeAdapter::new(
                AdapterKind::CursorAgent,
                acp_tx.clone(),
                data_dir.join("runtime/cursor"),
                runtime_fleet.clone(),
                CompactionDetectorPolicy::Disabled,
            )?,
            kimi_code_cli: AcpCliRuntimeAdapter::new(
                AdapterKind::KimiCodeCli,
                acp_tx.clone(),
                data_dir.join("runtime/kimi-code"),
                runtime_fleet.clone(),
                compaction_detector_policies
                    .policy_for(AdapterKind::KimiCodeCli)
                    .unwrap_or(CompactionDetectorPolicy::Disabled),
            )?,
            grok_build: AcpCliRuntimeAdapter::new(
                AdapterKind::GrokBuild,
                acp_tx,
                data_dir.join("runtime/grok-build"),
                runtime_fleet.clone(),
                compaction_detector_policies
                    .policy_for(AdapterKind::GrokBuild)
                    .unwrap_or(CompactionDetectorPolicy::Disabled),
            )?,
            claude_code_cli: ClaudeCodeCliRuntimeAdapter::new(&data_dir)?,
            antigravity_app: AntigravityAppRuntimeAdapter::new(&data_dir)?,
            planned_shutdown: PlannedShutdownCoordinator::new(uuid::Uuid::new_v4().to_string()),
            agent_run_tasks: Mutex::new(tokio::task::JoinSet::new()),
            attachment_views,
            attachment_view_gates: Mutex::new(HashMap::new()),
            data_dir,
            runtime_fleet,
            builtin_tool_leases,
        })
    }

    #[cfg(all(target_os = "macos", feature = "slow-tests"))]
    fn write_runtime_resolution_executable(path: &Path, body: &str) {
        use std::os::unix::fs::PermissionsExt;

        std::fs::write(path, body).unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).unwrap();
    }

    #[cfg(all(target_os = "macos", feature = "slow-tests"))]
    async fn seed_runtime_resolution_installation(core: &Core, executable: &Path) -> String {
        let fingerprint = fingerprint_executable(executable).unwrap();
        let snapshot = AgentRuntimeAdapterRegistry::default()
            .light_ready_snapshot(
                AdapterKind::TraeCnCli,
                Some("trae-cli version obsolete".to_string()),
                fingerprint.clone(),
                chrono::Utc::now().to_rfc3339(),
            )
            .unwrap();
        let mut database = core.database.lock().await;
        AgentProfileService::default()
            .commit_discovered_managed_installation(
                &mut database,
                DiscoveredManagedInstallation {
                    adapter_kind: AdapterKind::TraeCnCli,
                    executable_path: executable.to_string_lossy().to_string(),
                    command_name: AdapterKind::TraeCnCli.command_name().to_string(),
                    source: InstallationSource::Manual,
                    auth_scope: "default".to_string(),
                    snapshot,
                    entrypoint_locator_identity: None,
                },
            )
            .unwrap();
        fingerprint
    }

    #[cfg(all(target_os = "macos", feature = "slow-tests"))]
    fn replacing_runtime_script(runtime: &Path, replacement: &Path, invocations: &Path) -> String {
        format!(
            "#!/bin/sh\nprintf 'old:%s\\n' \"$*\" >> '{}'\nif [ \"$1\" = \"--version\" ]; then\n  /bin/mv '{}' '{}'\n  exit 1\nfi\nexit 1\n",
            invocations.display(),
            replacement.display(),
            runtime.display(),
        )
    }

    #[cfg(all(target_os = "macos", feature = "slow-tests"))]
    fn stable_runtime_script(invocations: &Path, ready: bool) -> String {
        if !ready {
            return format!(
                "#!/bin/sh\nprintf 'new:%s\\n' \"$*\" >> '{}'\nif [ \"$1\" = \"--version\" ]; then\n  printf '%s\\n' 'trae-cli version stable-failure'\n  exit 0\nfi\nexit 1\n",
                invocations.display(),
            );
        }
        format!(
            r#"#!/bin/sh
printf 'new:%s\n' "$*" >> '{}'
if [ "$1" = "--version" ]; then
  printf '%s\n' 'trae-cli version stable-ready'
  exit 0
fi
IFS= read -r _initialize || exit 1
printf '%s\n' '{{"jsonrpc":"2.0","id":1,"result":{{"protocolVersion":1,"agentCapabilities":{{"loadSession":true}}}}}}'
IFS= read -r _session || exit 1
printf '%s\n' '{{"jsonrpc":"2.0","id":2,"result":{{"sessionId":"session-runtime-update","configOptions":[{{"id":"model","currentValue":"GLM-5.2","options":[{{"value":"GLM-5.2","name":"GLM-5.2"}}]}}],"modes":{{"currentModeId":"default","availableModes":[{{"id":"default","name":"Default"}},{{"id":"bypass_permissions","name":"Bypass permissions"}}]}}}}}}'
while IFS= read -r _ignored; do :; done
"#,
            invocations.display(),
        )
    }

    #[cfg(all(target_os = "macos", feature = "slow-tests"))]
    #[tokio::test]
    async fn runtime_check_manager_rebinds_after_version_replacement_and_commits_ready() {
        let root = std::env::temp_dir().join(format!(
            "rovai-runtime-manager-rebind-ready-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let runtime = root.join("traecli");
        let replacement = root.join("replacement");
        let invocations = root.join("invocations.log");
        write_runtime_resolution_executable(
            &replacement,
            &stable_runtime_script(&invocations, true),
        );
        let rebound_fingerprint = fingerprint_executable(&replacement).unwrap();
        write_runtime_resolution_executable(
            &runtime,
            &replacing_runtime_script(&runtime, &replacement, &invocations),
        );
        let core = runtime_resolution_test_core(&root).unwrap();
        let obsolete_fingerprint = seed_runtime_resolution_installation(&core, &runtime).await;

        let outcome = core
            .run_product_runtime_resolution(
                AdapterKind::TraeCnCli,
                RuntimeLaunchPurpose::AvailabilityCheck,
                tokio::time::Instant::now() + RUNTIME_CHECK_TOTAL_DEADLINE,
            )
            .await
            .unwrap();

        assert_eq!(outcome, RuntimeCheckOutcome::Ready);
        assert_ne!(obsolete_fingerprint, rebound_fingerprint);
        let database = core.database.lock().await;
        let installation = AgentProfileService::default()
            .managed_installation(&database, AdapterKind::TraeCnCli, "default")
            .unwrap()
            .unwrap();
        assert_eq!(
            installation
                .snapshot
                .as_ref()
                .and_then(|snapshot| snapshot.executable_fingerprint.as_deref()),
            Some(rebound_fingerprint.as_str())
        );
        assert_eq!(
            installation
                .snapshot
                .as_ref()
                .map(|snapshot| snapshot.probe_status.as_str()),
            Some("ready")
        );
        drop(database);
        assert_eq!(
            std::fs::read_to_string(&invocations)
                .unwrap()
                .lines()
                .filter(|line| line.ends_with("--version"))
                .count(),
            2
        );
        drop(core);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(all(target_os = "macos", feature = "slow-tests"))]
    #[tokio::test]
    async fn runtime_check_manager_binds_stable_failure_to_rebound_fingerprint() {
        let root = std::env::temp_dir().join(format!(
            "rovai-runtime-manager-rebind-failure-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let runtime = root.join("traecli");
        let replacement = root.join("replacement");
        let invocations = root.join("invocations.log");
        write_runtime_resolution_executable(
            &replacement,
            &stable_runtime_script(&invocations, false),
        );
        let rebound_fingerprint = fingerprint_executable(&replacement).unwrap();
        write_runtime_resolution_executable(
            &runtime,
            &replacing_runtime_script(&runtime, &replacement, &invocations),
        );
        let core = runtime_resolution_test_core(&root).unwrap();
        let obsolete_fingerprint = seed_runtime_resolution_installation(&core, &runtime).await;

        let outcome = core
            .run_product_runtime_resolution(
                AdapterKind::TraeCnCli,
                RuntimeLaunchPurpose::AvailabilityCheck,
                tokio::time::Instant::now() + RUNTIME_CHECK_TOTAL_DEADLINE,
            )
            .await
            .unwrap();

        assert_eq!(outcome, RuntimeCheckOutcome::StableFailure);
        assert_ne!(obsolete_fingerprint, rebound_fingerprint);
        let database = core.database.lock().await;
        let installation = AgentProfileService::default()
            .managed_installation(&database, AdapterKind::TraeCnCli, "default")
            .unwrap()
            .unwrap();
        assert_eq!(
            installation
                .snapshot
                .as_ref()
                .and_then(|snapshot| snapshot.executable_fingerprint.as_deref()),
            Some(rebound_fingerprint.as_str())
        );
        assert_eq!(
            installation
                .last_probe_attempt
                .as_ref()
                .and_then(|attempt| attempt.executable_fingerprint.as_deref()),
            Some(rebound_fingerprint.as_str())
        );
        assert_eq!(
            installation
                .last_probe_attempt
                .as_ref()
                .map(|attempt| attempt.status.as_str()),
            Some("failed")
        );
        drop(database);
        assert_eq!(
            std::fs::read_to_string(&invocations)
                .unwrap()
                .lines()
                .filter(|line| line.ends_with("--version"))
                .count(),
            2
        );
        drop(core);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn identity_checked_probe_discards_updated_results_and_keeps_stable_errors() {
        use std::os::unix::fs::PermissionsExt;

        fn write_executable(path: &Path, body: &[u8]) {
            std::fs::write(path, body).unwrap();
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).unwrap();
        }

        let directory = std::env::temp_dir().join(format!(
            "rovai-runtime-probe-identity-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let executable = directory.join("fake-runtime");
        write_executable(&executable, b"#!/bin/sh\nexit 0\n");

        let replacement = directory.join("replacement");
        let replaced = run_identity_checked_probe(&executable, async {
            write_executable(&replacement, b"#!/bin/sh\nexit 1\n");
            std::fs::rename(&replacement, &executable).unwrap();
            Ok::<_, anyhow::Error>("obsolete-success")
        })
        .await;
        assert!(matches!(replaced, IdentityCheckedProbe::Superseded));

        let updater_holds_stdout = run_identity_checked_probe(&executable, async {
            write_executable(&replacement, b"#!/bin/sh\nexit 2\n");
            std::fs::rename(&replacement, &executable).unwrap();
            Err::<(), _>(anyhow::anyhow!("runtime_probe_stdout_cleanup_timed_out"))
        })
        .await;
        assert!(matches!(
            updater_holds_stdout,
            IdentityCheckedProbe::Superseded
        ));

        let stable_cleanup_timeout = run_identity_checked_probe(&executable, async {
            Err::<(), _>(anyhow::anyhow!("runtime_probe_stderr_cleanup_timed_out"))
        })
        .await;
        assert!(matches!(
            stable_cleanup_timeout,
            IdentityCheckedProbe::Stable(Err(_))
        ));

        let unverifiable_after = run_identity_checked_probe(&executable, async {
            std::fs::remove_file(&executable).unwrap();
            Err::<(), _>(anyhow::anyhow!("probe_failed_while_runtime_updated"))
        })
        .await;
        assert!(matches!(
            unverifiable_after,
            IdentityCheckedProbe::Superseded
        ));

        let missing_before = directory.join("missing-runtime");
        let existing_behavior = run_identity_checked_probe(&missing_before, async {
            Err::<(), _>(anyhow::anyhow!("runtime_path_missing"))
        })
        .await;
        assert!(matches!(
            existing_behavior,
            IdentityCheckedProbe::Stable(Err(_))
        ));
        assert_eq!(RUNTIME_PROBE_MAX_EXECUTIONS, 2);

        let now = tokio::time::Instant::now();
        let short_deadline = now + Duration::from_millis(100);
        assert_eq!(
            runtime_probe_update_retry_at(now, short_deadline),
            Some(short_deadline)
        );
        let full_deadline = now + Duration::from_secs(1);
        assert_eq!(
            runtime_probe_update_retry_at(now, full_deadline),
            Some(now + RUNTIME_PROBE_UPDATE_RETRY_DELAY)
        );
        assert_eq!(runtime_probe_update_retry_at(full_deadline, now), None);

        std::fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn runtime_check_task_ids_clear_activity_after_success_panic_abort_and_shutdown() {
        let mut tasks = tokio::task::JoinSet::new();
        let success = tasks.spawn(async {});
        let panic = tasks.spawn(async { panic!("injected Runtime check panic") });
        let aborted = tasks.spawn(async { std::future::pending::<()>().await });
        let mut task_kinds = HashMap::from([
            (success.id(), AdapterKind::CodexCli),
            (panic.id(), AdapterKind::QwenCode),
            (aborted.id(), AdapterKind::ClaudeCodeCli),
        ]);
        let mut activity = task_kinds
            .iter()
            .map(|(task_id, runtime_kind)| {
                (
                    *runtime_kind,
                    RuntimeCheckActivity {
                        attempt_id: format!("attempt-{task_id}"),
                        runtime_kind: *runtime_kind,
                        deadline: chrono::Utc::now(),
                        running: true,
                    },
                )
            })
            .collect::<BTreeMap<_, _>>();
        aborted.abort();

        let mut terminal_events = 0;
        while let Some(completed) = tasks.join_next_with_id().await {
            let task_id = match completed {
                Ok((task_id, ())) => task_id,
                Err(error) => error.id(),
            };
            let runtime_kind = task_kinds
                .remove(&task_id)
                .expect("task id must retain its Runtime attempt");
            terminal_events += usize::from(take_runtime_check_activity(
                &mut activity,
                runtime_kind,
                &format!("attempt-{task_id}"),
            ));
        }
        let shutdown_kind = AdapterKind::TraeCnCli;
        activity.insert(
            shutdown_kind,
            RuntimeCheckActivity {
                attempt_id: "attempt-shutdown".to_string(),
                runtime_kind: shutdown_kind,
                deadline: chrono::Utc::now(),
                running: false,
            },
        );
        terminal_events += usize::from(take_runtime_check_activity(
            &mut activity,
            shutdown_kind,
            "attempt-shutdown",
        ));

        assert_eq!(terminal_events, 4);
        assert!(task_kinds.is_empty());
        assert!(activity.is_empty());
        assert!(runtime_check_writes_diagnostic(
            RuntimeCheckFinalization::Product
        ));
        assert!(runtime_check_writes_diagnostic(
            RuntimeCheckFinalization::Supervisor
        ));
        assert!(!runtime_check_writes_diagnostic(
            RuntimeCheckFinalization::CleanupOnly
        ));
    }

    #[cfg(all(target_os = "macos", feature = "slow-tests"))]
    #[tokio::test]
    async fn v2_dispatch_admission_ignores_broken_legacy_view_and_managed_payload() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!(
            "rovai-dispatch-attachment-degradation-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let workspace = root.join("workspace");
        fs::create_dir_all(&workspace).unwrap();
        let core = runtime_resolution_test_core(&root).unwrap();
        let source = root.join("published.txt");
        fs::write(&source, b"published before authority loss").unwrap();

        let camp_id = {
            let mut database = core.database.lock().await;
            let agent_id = AgentProfileService::default()
                .list_profiles(&database)
                .unwrap()
                .into_iter()
                .next()
                .expect("the startup database should include a default member")
                .agent_id;
            let created = CollaborationService::default()
                .create_camp(
                    &mut database,
                    &CommandEnvelope {
                        command_id: uuid::Uuid::new_v4().to_string(),
                        actor: ActorRef::User {
                            user_id: "test-user".to_string(),
                        },
                        camp_id: None,
                        expected_versions: Vec::new(),
                        execution_epoch: None,
                        payload: CreateCampCommand {
                            name: None,
                            project_binding_kind: ProjectBindingKind::Directory,
                            project_path: workspace.display().to_string(),
                            member_agent_ids: vec![agent_id.clone()],
                            default_lead_agent_id: agent_id,
                            collaboration_mode: CampCollaborationMode::Peer,
                            activation_state: CampActivationState::Active,
                        },
                    },
                )
                .unwrap();
            let camp_id = created.result.payload["campId"]
                .as_str()
                .unwrap()
                .to_string();
            core.attachment_views
                .ensure_empty_camp_ready(&mut database, &camp_id)
                .unwrap();
            CampAttachmentStore::new(&core.data_dir)
                .save_body(&mut database, &camp_id, "Use the published attachment")
                .unwrap();
            camp_id
        };
        let prepared = prepare_composer_attachment_from_path(
            &core.database,
            &core.output,
            &core.data_dir,
            PrepareAttachmentFromPathParams {
                camp_id: CampId::parse(&camp_id).unwrap(),
                expected_revision: 1,
                source_path: source.display().to_string(),
                display_name: "published.txt".to_string(),
            },
        )
        .await
        .unwrap();
        let draft_revision = prepared["revision"].as_i64().unwrap();
        let attachment_id = prepared["attachments"][0]["id"]
            .as_str()
            .unwrap()
            .to_string();
        core.send_test_camp_message_request(SendCampMessageParams {
            command_id: uuid::Uuid::new_v4().to_string(),
            camp_id: CampId::parse(&camp_id).unwrap(),
            draft_revision,
            execution: None,
        })
        .await
        .unwrap();
        let attachment_store = CampAttachmentStore::new(&core.data_dir);
        let managed_candidate = {
            let database = core.database.lock().await;
            attachment_store
                .desktop_open_candidate(&database, &camp_id, &attachment_id)
                .unwrap()
                .unwrap()
        };
        let managed_path = attachment_store
            .verify_desktop_open_candidate(managed_candidate)
            .unwrap()
            .path;
        let initial_authorization = core
            .verified_camp_runtime_authorization(&camp_id, &workspace)
            .await
            .unwrap();
        assert!(managed_path.starts_with(&initial_authorization.attachment_root));
        assert!(managed_path.is_file());

        let payload_container = managed_path.parent().unwrap();
        fs::set_permissions(payload_container, fs::Permissions::from_mode(0o700)).unwrap();
        fs::remove_file(&managed_path).unwrap();
        fs::set_permissions(payload_container, fs::Permissions::from_mode(0o500)).unwrap();
        {
            let mut database = core.database.lock().await;
            core.attachment_views
                .mark_legacy_view_broken_for_test(&mut database, &camp_id)
                .unwrap();
        }

        let (admission, authorization) = core
            .verified_camp_attachment_admission(&camp_id, &workspace)
            .await
            .expect("dispatch admission should omit the invalid attachment and keep Camp runnable");
        admission.prove(&camp_id).unwrap();
        assert_eq!(authorization.camp_id, camp_id);
        assert!(authorization.attachment_root.is_dir());
        {
            let database = core.database.lock().await;
            assert!(
                core.attachment_views
                    .verify_camp_ready(&database, &camp_id)
                    .is_err()
            );
        }

        let view_attachment_root = authorization.attachment_root.clone();
        drop(admission);
        fs::set_permissions(payload_container, fs::Permissions::from_mode(0o700)).unwrap();
        fs::set_permissions(
            payload_container.parent().unwrap(),
            fs::Permissions::from_mode(0o700),
        )
        .unwrap();
        CampAttachmentStore::new(&core.data_dir)
            .remove_camp(&camp_id)
            .unwrap();
        drop(core);
        fs::set_permissions(&view_attachment_root, fs::Permissions::from_mode(0o700)).unwrap();
        fs::set_permissions(
            view_attachment_root.parent().unwrap(),
            fs::Permissions::from_mode(0o700),
        )
        .unwrap();
        fs::set_permissions(
            view_attachment_root.parent().unwrap().parent().unwrap(),
            fs::Permissions::from_mode(0o700),
        )
        .unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn agent_run_attachment_admission_is_camp_scoped_without_a_generation_gate() {
        let admission = CampAttachmentReadAdmission::for_camp("rvcamp_test");
        admission.prove("rvcamp_test").unwrap();
        assert!(admission.prove("rvcamp_other").is_err());
        let (projection_tx, mut projection_rx) = mpsc::unbounded_channel();
        assert!(release_agent_run_attachment_admission(
            admission,
            &projection_tx
        ));
        assert_eq!(projection_rx.try_recv().as_deref(), Ok("rvcamp_test"));
    }

    #[test]
    fn runtime_delta_batching_is_bounded_and_stops_at_durable_boundaries() {
        fn codex_message(host: &str, run: &str, epoch: i64, method: &str) -> CodexIncoming {
            CodexIncoming::Message {
                host_instance_id: host.to_string(),
                agent_run_id: run.to_string(),
                execution_epoch: epoch,
                message: json!({
                    "method": method,
                    "params": {"itemId": "message-1", "delta": "hello"}
                }),
            }
        }

        type AcpRoute<'a> = (
            AdapterKind,
            &'a str,
            &'a str,
            i64,
            &'a str,
            &'a str,
            &'a str,
        );

        fn acp_message(route: AcpRoute<'_>, update: &str) -> AcpIncoming {
            let (adapter, host, run, epoch, session, prompt, delivery) = route;
            AcpIncoming::Message {
                adapter_kind: adapter,
                host_instance_id: host.to_string(),
                agent_run_id: run.to_string(),
                execution_epoch: epoch,
                native_session_id: session.to_string(),
                native_prompt_id: prompt.to_string(),
                delivery_id: delivery.to_string(),
                sequence: 4,
                message: json!({
                    "method": "session/update",
                    "params": {
                        "update": {
                            "sessionUpdate": update,
                            "content": {"type": "text", "text": "world"},
                            "toolCallId": "tool-1",
                            "status": "completed"
                        }
                    }
                }),
            }
        }

        let codex_delta = codex_message("codex-host", "run-1", 2, "item/agentMessage/delta");
        assert_eq!(
            codex_delta_batch_identity(&codex_delta),
            Some(("codex-host", "run-1", 2))
        );
        for different_route in [
            codex_message("other-host", "run-1", 2, "item/agentMessage/delta"),
            codex_message("codex-host", "run-2", 2, "item/agentMessage/delta"),
            codex_message("codex-host", "run-1", 3, "item/agentMessage/delta"),
        ] {
            assert_ne!(
                codex_delta_batch_identity(&different_route),
                codex_delta_batch_identity(&codex_delta)
            );
        }
        let codex_terminal = codex_message("codex-host", "run-1", 2, "item/completed");
        assert!(codex_delta_batch_identity(&codex_terminal).is_none());
        let command_output_delta = CodexIncoming::Message {
            host_instance_id: "codex-host".to_string(),
            agent_run_id: "run-1".to_string(),
            execution_epoch: 2,
            message: json!({
                "method": "item/commandExecution/outputDelta",
                "params": {
                    "threadId": "thread-1",
                    "turnId": "turn-1",
                    "itemId": "command-1",
                    "delta": "line one\n",
                }
            }),
        };
        assert!(codex_delta_batch_identity(&command_output_delta).is_none());
        let CodexIncoming::Message {
            message: command_output_message,
            ..
        } = command_output_delta
        else {
            unreachable!()
        };
        assert!(is_codex_command_output_delta_notification(
            &command_output_message
        ));
        let legacy_output_delta = json!({
            "method": "command/exec/outputDelta",
            "params": {"itemId": "command-1", "delta": "legacy"}
        });
        assert!(is_codex_command_output_delta_notification(
            &legacy_output_delta
        ));
        let id_bearing_output_delta = json!({
            "id": 7,
            "method": "item/commandExecution/outputDelta",
            "params": {"threadId": "thread-1", "turnId": "turn-1", "itemId": "command-1", "delta": "request"}
        });
        assert!(!is_codex_command_output_delta_notification(
            &id_bearing_output_delta
        ));
        assert!(
            prepare_codex_delta_batch(std::slice::from_ref(&command_output_message))
                .unwrap()
                .is_none()
        );

        let acp_delta = acp_message(
            (
                AdapterKind::OpencodeCli,
                "acp-host",
                "run-2",
                3,
                "session-1",
                "prompt-1",
                "delivery-1",
            ),
            "agent_message_chunk",
        );
        assert_eq!(
            acp_delta_batch_identity(&acp_delta),
            Some((
                AdapterKind::OpencodeCli,
                "acp-host",
                "run-2",
                3,
                "session-1",
                "prompt-1",
                "delivery-1"
            ))
        );
        for different_route in [
            acp_message(
                (
                    AdapterKind::CopilotCli,
                    "acp-host",
                    "run-2",
                    3,
                    "session-1",
                    "prompt-1",
                    "delivery-1",
                ),
                "agent_message_chunk",
            ),
            acp_message(
                (
                    AdapterKind::OpencodeCli,
                    "other-host",
                    "run-2",
                    3,
                    "session-1",
                    "prompt-1",
                    "delivery-1",
                ),
                "agent_message_chunk",
            ),
            acp_message(
                (
                    AdapterKind::OpencodeCli,
                    "acp-host",
                    "run-3",
                    3,
                    "session-1",
                    "prompt-1",
                    "delivery-1",
                ),
                "agent_message_chunk",
            ),
            acp_message(
                (
                    AdapterKind::OpencodeCli,
                    "acp-host",
                    "run-2",
                    4,
                    "session-1",
                    "prompt-1",
                    "delivery-1",
                ),
                "agent_message_chunk",
            ),
            acp_message(
                (
                    AdapterKind::OpencodeCli,
                    "acp-host",
                    "run-2",
                    3,
                    "session-2",
                    "prompt-1",
                    "delivery-1",
                ),
                "agent_message_chunk",
            ),
            acp_message(
                (
                    AdapterKind::OpencodeCli,
                    "acp-host",
                    "run-2",
                    3,
                    "session-1",
                    "prompt-2",
                    "delivery-1",
                ),
                "agent_message_chunk",
            ),
            acp_message(
                (
                    AdapterKind::OpencodeCli,
                    "acp-host",
                    "run-2",
                    3,
                    "session-1",
                    "prompt-1",
                    "delivery-2",
                ),
                "agent_message_chunk",
            ),
        ] {
            assert_ne!(
                acp_delta_batch_identity(&different_route),
                acp_delta_batch_identity(&acp_delta)
            );
        }
        let acp_tool_terminal = acp_message(
            (
                AdapterKind::OpencodeCli,
                "acp-host",
                "run-2",
                3,
                "session-1",
                "prompt-1",
                "delivery-1",
            ),
            "tool_call_update",
        );
        assert!(acp_delta_batch_identity(&acp_tool_terminal).is_none());

        let CodexIncoming::Message { message, .. } = codex_delta else {
            unreachable!()
        };
        let mut item_bounded_batch = vec![message; RUNTIME_EVIDENCE_DELTA_BATCH_MAX_ITEMS];
        assert!(
            prepare_codex_delta_batch(&item_bounded_batch)
                .unwrap()
                .is_some()
        );
        item_bounded_batch.push(item_bounded_batch[0].clone());
        assert!(
            prepare_codex_delta_batch(&item_bounded_batch)
                .unwrap()
                .is_none()
        );

        let oversized_delta = json!({
            "method": "item/agentMessage/delta",
            "params": {
                "itemId": "message-oversized",
                "delta": "x".repeat(RUNTIME_EVIDENCE_DELTA_BATCH_MAX_BYTES)
            }
        });
        assert!(
            prepare_codex_delta_batch(&[oversized_delta])
                .unwrap()
                .is_none()
        );
        let CodexIncoming::Message {
            message: terminal_message,
            ..
        } = codex_terminal
        else {
            unreachable!()
        };
        assert!(
            prepare_codex_delta_batch(&[terminal_message])
                .unwrap()
                .is_none()
        );

        let AcpIncoming::Message {
            native_session_id,
            native_prompt_id,
            delivery_id,
            sequence,
            message,
            ..
        } = acp_delta
        else {
            unreachable!()
        };
        assert!(
            prepare_acp_delta_batch(
                AdapterKind::OpencodeCli,
                &[AcpRuntimeDeltaMessage {
                    native_session_id,
                    native_prompt_id,
                    delivery_id,
                    sequence,
                    message,
                }]
            )
            .unwrap()
            .is_some()
        );
        let AcpIncoming::Message {
            native_session_id,
            native_prompt_id,
            delivery_id,
            sequence,
            message,
            ..
        } = acp_tool_terminal
        else {
            unreachable!()
        };
        assert!(
            prepare_acp_delta_batch(
                AdapterKind::OpencodeCli,
                &[AcpRuntimeDeltaMessage {
                    native_session_id,
                    native_prompt_id,
                    delivery_id,
                    sequence,
                    message,
                }]
            )
            .unwrap()
            .is_none()
        );
    }

    #[test]
    fn planned_shutdown_request_is_closed_versioned_and_bounded() {
        let valid = parse_planned_shutdown_params(json!({
            "protocolVersion": 3,
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
                "protocolVersion": 3,
                "deadlineMs": 99,
            }))
            .unwrap_err()
            .to_string()
            .contains("deadlineMs")
        );
        assert!(
            parse_planned_shutdown_params(json!({
                "protocolVersion": 3,
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
    fn runtime_camp_files_root_must_be_explicit_normalized_absolute_and_unique() {
        let root = std::env::temp_dir().join("rovai-runtime-camp-files-root");
        assert_eq!(
            parse_runtime_camp_files_root_from(vec![
                "--runtime-camp-files-root".to_string(),
                root.to_string_lossy().into_owned(),
            ])
            .unwrap(),
            root
        );
        assert!(
            parse_runtime_camp_files_root_from(Vec::new())
                .unwrap_err()
                .to_string()
                .contains("refusing to infer a shared Home root")
        );
        assert!(
            parse_runtime_camp_files_root_from(vec![
                "--runtime-camp-files-root".to_string(),
                "relative-root".to_string(),
            ])
            .unwrap_err()
            .to_string()
            .contains("normalized absolute")
        );
        assert!(
            parse_runtime_camp_files_root_from(vec![
                "--runtime-camp-files-root".to_string(),
                root.join("..").to_string_lossy().into_owned(),
            ])
            .unwrap_err()
            .to_string()
            .contains("normalized absolute")
        );
        assert!(
            parse_runtime_camp_files_root_from(vec![
                "--runtime-camp-files-root".to_string(),
                root.to_string_lossy().into_owned(),
                "--runtime-camp-files-root".to_string(),
                root.to_string_lossy().into_owned(),
            ])
            .unwrap_err()
            .to_string()
            .contains("only once")
        );
    }

    #[test]
    fn windows_data_root_preparation_is_explicit_absolute_and_exclusive() {
        let root = std::env::temp_dir().join("rovai-windows-data-root");
        assert_eq!(
            parse_windows_data_root_preparation_from(vec![
                "--prepare-windows-data-root".to_string(),
                root.to_string_lossy().into_owned(),
            ])
            .unwrap(),
            Some(root.clone())
        );
        assert_eq!(
            parse_windows_data_root_preparation_from(Vec::new()).unwrap(),
            None
        );
        assert!(
            parse_windows_data_root_preparation_from(vec![
                "--prepare-windows-data-root".to_string(),
                "relative-root".to_string(),
            ])
            .unwrap_err()
            .to_string()
            .contains("normalized absolute")
        );
        assert!(
            parse_windows_data_root_preparation_from(vec![
                "--prepare-windows-data-root".to_string(),
                root.to_string_lossy().into_owned(),
                "--data-dir".to_string(),
                root.join("Core").to_string_lossy().into_owned(),
            ])
            .unwrap_err()
            .to_string()
            .contains("mutually exclusive")
        );
        assert!(
            parse_windows_data_root_preparation_from(vec![
                "--data-dir".to_string(),
                root.join("Core").to_string_lossy().into_owned(),
                "--prepare-windows-data-root".to_string(),
                root.to_string_lossy().into_owned(),
            ])
            .unwrap_err()
            .to_string()
            .contains("mutually exclusive")
        );
    }

    #[test]
    fn skill_library_selection_is_explicit_exclusive_and_normalized() {
        assert!(
            parse_skill_library_root_from(Vec::new())
                .unwrap_err()
                .to_string()
                .contains("requires exactly one Skill Library selection")
        );
        let directory = std::env::temp_dir().join("rovai-core-isolated-skill-library");
        assert_eq!(
            parse_skill_library_root_from(vec![
                "--skill-library-root".to_string(),
                directory.to_string_lossy().into_owned(),
            ])
            .unwrap(),
            SkillLibraryRootSelection::Explicit(directory.clone())
        );
        assert_eq!(
            parse_skill_library_root_from(vec!["--use-default-skill-library".to_string()]).unwrap(),
            SkillLibraryRootSelection::Default
        );
        assert!(
            parse_skill_library_root_from(vec![
                "--skill-library-root".to_string(),
                "relative/skills".to_string(),
            ])
            .unwrap_err()
            .to_string()
            .contains("normalized absolute path")
        );
        assert!(
            parse_skill_library_root_from(vec![
                "--skill-library-root".to_string(),
                directory.to_string_lossy().into_owned(),
                "--skill-library-root".to_string(),
                directory.to_string_lossy().into_owned(),
            ])
            .unwrap_err()
            .to_string()
            .contains("only once")
        );
        assert!(
            parse_skill_library_root_from(vec![
                "--use-default-skill-library".to_string(),
                "--use-default-skill-library".to_string(),
            ])
            .unwrap_err()
            .to_string()
            .contains("only once")
        );
        assert!(
            parse_skill_library_root_from(vec![
                "--skill-library-root".to_string(),
                directory.to_string_lossy().into_owned(),
                "--use-default-skill-library".to_string(),
            ])
            .unwrap_err()
            .to_string()
            .contains("mutually exclusive")
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
            model_catalog: rovai_core::agent_profile::RuntimeModelCatalogCacheView {
                status: RuntimeModelCatalogCacheStatus::Fresh,
                observed_at: Some(last_successful_probe_at.to_string()),
                revalidate_after: None,
                expires_at: None,
            },
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
                    failure: None,
                }
            }),
            relocation_history: Vec::new(),
            created_at: last_successful_probe_at.to_string(),
            updated_at: last_successful_probe_at.to_string(),
        }
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

        let mut light_ready = managed_runtime_fixture(&now.to_rfc3339(), None);
        let snapshot = light_ready.snapshot.as_mut().unwrap();
        snapshot.probe_status = "light_ready".to_string();
        snapshot.authentication_status = "unknown".to_string();
        snapshot.last_successful_probe_at = None;
        light_ready.last_probe_attempt = Some(rovai_core::agent_profile::AdapterProbeAttempt {
            id: "attempt-authentication-required".to_string(),
            installation_id: light_ready.id.clone(),
            status: "failed".to_string(),
            failure_class: "authentication_required".to_string(),
            diagnostic_code: Some("runtime_authentication_required".to_string()),
            candidate_path: light_ready.executable_path.clone(),
            executable_fingerprint: Some("sha256:test".to_string()),
            attempted_at: now.to_rfc3339(),
            retry_after: None,
            failure: None,
        });
        assert_eq!(
            product_runtime_availability_status(
                RuntimeDiscoveryStatus::Found,
                Some(&light_ready),
                None,
                true,
            ),
            "checking"
        );
        assert_eq!(
            product_runtime_availability_status(
                RuntimeDiscoveryStatus::Found,
                Some(&light_ready),
                None,
                false,
            ),
            "authentication_required"
        );

        light_ready.last_probe_attempt = None;
        let diagnostic = ProductRuntimeDiagnostic {
            status: "needs_attention",
            diagnostic_code: "runtime_probe_transient_failure".to_string(),
            priority: 2,
            failure: None,
        };
        assert_eq!(
            product_runtime_availability_status(
                RuntimeDiscoveryStatus::Found,
                Some(&light_ready),
                Some(&diagnostic),
                true,
            ),
            "checking"
        );

        light_ready.path_state = "path_missing".to_string();
        assert_eq!(
            product_runtime_availability_status(
                RuntimeDiscoveryStatus::Missing,
                Some(&light_ready),
                None,
                true,
            ),
            "path_missing"
        );
    }

    #[test]
    fn trae_version_failures_follow_uniform_runtime_status_rules() {
        let now = chrono::Utc::now();
        let mut installation = managed_runtime_fixture(&now.to_rfc3339(), None);
        installation.adapter_kind = AdapterKind::TraeCnCli;
        installation.last_probe_attempt = Some(rovai_core::agent_profile::AdapterProbeAttempt {
            id: "current-trae-version-timeout".to_string(),
            installation_id: installation.id.clone(),
            status: "failed".to_string(),
            failure_class: "transient".to_string(),
            diagnostic_code: Some("runtime_version_timed_out".to_string()),
            candidate_path: installation.executable_path.clone(),
            executable_fingerprint: Some("sha256:test".to_string()),
            attempted_at: (now + chrono::Duration::seconds(1)).to_rfc3339(),
            retry_after: None,
            failure: None,
        });
        assert!(relevant_failed_runtime_probe_attempt(&installation).is_some());
        assert_eq!(
            product_runtime_availability_status(
                RuntimeDiscoveryStatus::Found,
                Some(&installation),
                None,
                false,
            ),
            "refresh_failed_using_last_success"
        );

        let snapshot = installation.snapshot.as_mut().unwrap();
        snapshot.probe_status = "installed_unverified".to_string();
        snapshot.authentication_status = "unknown".to_string();
        snapshot.reported_version = None;
        snapshot.models.clear();
        snapshot.capabilities.clear();
        snapshot.protocols.clear();
        snapshot.last_successful_probe_at = None;

        assert_eq!(
            product_runtime_availability_status(
                RuntimeDiscoveryStatus::Found,
                Some(&installation),
                None,
                false,
            ),
            "needs_attention"
        );
    }

    #[test]
    fn later_success_supersedes_an_older_failed_attempt_for_every_runtime() {
        let now = chrono::Utc::now();
        let mut installation = managed_runtime_fixture(&now.to_rfc3339(), None);
        installation.last_probe_attempt = Some(rovai_core::agent_profile::AdapterProbeAttempt {
            id: "attempt-before-success".to_string(),
            installation_id: installation.id.clone(),
            status: "failed".to_string(),
            failure_class: "transient".to_string(),
            diagnostic_code: Some("runtime_probe_timed_out".to_string()),
            candidate_path: installation.executable_path.clone(),
            executable_fingerprint: Some("sha256:test".to_string()),
            attempted_at: (now - chrono::Duration::seconds(1)).to_rfc3339(),
            retry_after: None,
            failure: None,
        });

        assert!(relevant_failed_runtime_probe_attempt(&installation).is_none());
        assert_eq!(
            product_runtime_availability_status(
                RuntimeDiscoveryStatus::Found,
                Some(&installation),
                None,
                false,
            ),
            "ready"
        );
    }

    #[test]
    fn light_ready_is_available_until_an_explicit_check_fails_for_the_same_fingerprint() {
        let now = chrono::Utc::now();
        let mut installation = managed_runtime_fixture(&now.to_rfc3339(), None);
        let snapshot = installation.snapshot.as_mut().unwrap();
        snapshot.probe_status = "light_ready".to_string();
        snapshot.authentication_status = "unknown".to_string();
        snapshot.models.clear();
        snapshot.capabilities.clear();
        snapshot.protocols.clear();
        snapshot.last_successful_probe_at = None;

        assert_eq!(
            product_runtime_availability_status(
                RuntimeDiscoveryStatus::Found,
                Some(&installation),
                None,
                false,
            ),
            "light_ready"
        );
        installation.last_probe_attempt = Some(rovai_core::agent_profile::AdapterProbeAttempt {
            id: "attempt-light-failed".to_string(),
            installation_id: installation.id.clone(),
            status: "failed".to_string(),
            failure_class: "transient".to_string(),
            diagnostic_code: Some("runtime_probe_transient_failure".to_string()),
            candidate_path: installation.executable_path.clone(),
            executable_fingerprint: Some("sha256:test".to_string()),
            attempted_at: (now + chrono::Duration::seconds(1)).to_rfc3339(),
            retry_after: None,
            failure: None,
        });
        assert_eq!(
            product_runtime_availability_status(
                RuntimeDiscoveryStatus::Found,
                Some(&installation),
                None,
                false,
            ),
            "needs_attention"
        );
    }

    #[test]
    fn unregistered_product_probe_diagnostics_preserve_the_most_actionable_status() {
        let mut diagnostic = None;
        note_product_runtime_diagnostic(
            &mut diagnostic,
            "path_missing",
            "runtime_path_missing",
            None,
        );
        note_product_runtime_diagnostic(
            &mut diagnostic,
            "authentication_required",
            "runtime_authentication_required",
            None,
        );
        note_product_runtime_diagnostic(
            &mut diagnostic,
            "transient",
            "runtime_probe_transient_failure",
            None,
        );
        let diagnostic = diagnostic.expect("diagnostic");
        assert_eq!(diagnostic.status, "authentication_required");
        assert_eq!(
            diagnostic.diagnostic_code,
            "runtime_authentication_required"
        );
        assert_eq!(diagnostic.priority, 4);
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

        let trae_health = json!({
            "runtimeCatalog": [],
            "runtimeAvailability": [{
                "runtimeKind": "trae-cn-cli",
                "status": "installed_unverified",
                "discovery": { "observedAt": "2026-08-09T08:00:00Z" }
            }]
        });
        let checks = runtime_diagnostic_checks(
            &trae_health,
            &BTreeMap::from([(AdapterKind::TraeCnCli, 1)]),
            true,
            "2026-08-09T08:00:00Z",
        );
        let trae = checks
            .iter()
            .find(|check| check.subject_id.as_deref() == Some("trae-cn-cli"))
            .unwrap();
        assert_eq!(trae.status, DiagnosticStatus::Unknown);
        assert_eq!(trae.code, "runtime_verification_deferred");
    }

    #[test]
    fn diagnostics_do_not_invent_machine_health_for_platform_denied_runtimes() {
        let runtime_health = json!({
            "hostPlatform": "windows-x64",
            "runtimeCatalog": [{
                "runtimeKind": "codex-cli",
                "displayName": "Codex CLI"
            }],
            "runtimePlatformAdmission": [{
                "runtimeKind": "codex-cli",
                "platform": "windows-x64",
                "status": "not_qualified",
                "reasonCode": "runtime_platform.qualification_evidence_missing",
                "evidenceRevision": null
            }],
            "runtimeAvailability": []
        });

        assert!(
            runtime_diagnostic_checks(
                &runtime_health,
                &BTreeMap::from([(AdapterKind::CodexCli, 1)]),
                true,
                "2026-08-18T00:00:00Z",
            )
            .is_empty()
        );
    }

    #[test]
    fn local_windows_qualification_updates_the_projected_admission_only_when_allowed() {
        let registry = AgentRuntimeAdapterRegistry::default();
        let denied = apply_windows_runtime_qualification_override(
            registry.platform_admission(AdapterKind::CursorAgent, HostPlatformKey::WindowsX64),
            false,
        );
        assert!(!denied.is_qualified());
        assert_eq!(denied.evidence_revision(), None);

        let qualified = apply_windows_runtime_qualification_override(
            registry.platform_admission(AdapterKind::CursorAgent, HostPlatformKey::WindowsX64),
            true,
        );
        assert!(qualified.is_qualified());
        assert_eq!(
            qualified.evidence_revision(),
            Some(WINDOWS_LOCAL_QUALIFICATION_EVIDENCE_REVISION)
        );

        let macos = apply_windows_runtime_qualification_override(
            registry.platform_admission(AdapterKind::CodexCli, HostPlatformKey::MacosArm64),
            true,
        );
        assert!(macos.is_qualified());
        assert_ne!(
            macos.evidence_revision(),
            Some(WINDOWS_LOCAL_QUALIFICATION_EVIDENCE_REVISION)
        );
    }

    #[test]
    fn diagnostics_keep_qualified_platform_rows_when_machine_evidence_is_missing() {
        let runtime_health = json!({
            "hostPlatform": "macos-arm64",
            "runtimeCatalog": [{
                "runtimeKind": "codex-cli",
                "displayName": "Codex CLI"
            }],
            "runtimePlatformAdmission": [{
                "runtimeKind": "codex-cli",
                "platform": "macos-arm64",
                "status": "qualified",
                "reasonCode": null,
                "evidenceRevision": "sha256:test-evidence"
            }],
            "runtimeAvailability": []
        });

        let checks = runtime_diagnostic_checks(
            &runtime_health,
            &BTreeMap::from([(AdapterKind::CodexCli, 1)]),
            true,
            "2026-08-18T00:00:00Z",
        );
        assert_eq!(checks.len(), 1);
        assert_eq!(checks[0].code, "runtime_check_incomplete");
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
        assert!(request_runs_outside_main_queue("monitoring.snapshot"));
        assert!(!request_runs_outside_main_queue("monitoring.summary"));
        assert!(request_runs_outside_main_queue(
            "runtime.installations.refresh"
        ));
        assert!(request_runs_outside_main_queue("runtime.discovery.rescan"));
        assert!(request_runs_outside_main_queue("runtime.product.ensure"));
        assert!(request_runs_outside_main_queue("runtime.product.check"));
        assert!(!request_runs_outside_main_queue("camps.snapshot"));
        assert!(!request_runs_outside_main_queue("camps.enter"));
        assert!(!request_runs_outside_main_queue("camps.open"));
        assert!(!request_runs_outside_main_queue("camp.messages.page"));
        assert!(!request_runs_outside_main_queue(
            "camps.reconcileDefaultLead"
        ));
        assert!(request_runs_outside_main_queue("camp.messages.send"));
        assert!(request_runs_outside_main_queue("userAutomation.camp.send"));
        assert!(request_runs_outside_main_queue("campTurns.cancel"));
        assert!(request_runs_outside_main_queue("agentRuns.cancel"));
        assert!(request_runs_outside_main_queue(
            "runtime.pendingExecution.cancel"
        ));
    }

    #[test]
    fn navigation_invalidation_covers_projection_writes_but_not_reads() {
        for method in [
            "members.update",
            "members.remove",
            "navigation.campViewed",
            "camps.create",
            "camps.rename",
            "camps.enter",
            "camps.delete",
            "camp.composerDraft.save",
            "camp.attachments.prepareFromPath",
            "camp.messages.send",
            "userAutomation.camp.send",
            "campTurns.cancel",
            "agentRuns.cancel",
            "agentRuns.resolveRecoveryBlocker",
        ] {
            assert!(request_invalidates_navigation(method), "{method}");
        }
        for method in [
            "navigation.snapshot",
            "navigation.groupCamps",
            "camps.open",
            "camp.messages.page",
            "health.check",
        ] {
            assert!(!request_invalidates_navigation(method), "{method}");
        }
        for method in [
            "camps.create",
            "camps.discardPending",
            "camp.composerDraft.removeAttachment",
            "camp.composerDraft.discard",
            "camp.attachments.prepareFromPath",
            "camp.messages.send",
        ] {
            assert!(
                navigation_invalidation_emitted_at_commit_boundary(method),
                "{method}"
            );
        }
        assert!(!navigation_invalidation_emitted_at_commit_boundary(
            "camps.rename"
        ));
    }

    #[test]
    fn navigation_invalidation_skips_rejected_commands_and_preserves_camp_scope() {
        assert!(navigation_mutation_was_rejected(
            &json!({ "status": "rejected" })
        ));
        assert!(navigation_mutation_was_rejected(&json!({
            "commandResult": { "status": "rejected" }
        })));
        assert!(!navigation_mutation_was_rejected(
            &json!({ "status": "applied" })
        ));
        assert_eq!(
            navigation_request_camp_id(&json!({
                "command": { "campId": "rvcamp_test" }
            })),
            Some("rvcamp_test")
        );

        let (output, mut receiver) = mpsc::unbounded_channel();
        emit_agent_run_terminal(
            &output,
            Some("rvcamp_test"),
            json!({ "agentRunId": "run-test" }),
        );
        let terminal: Value = serde_json::from_str(&receiver.try_recv().unwrap()).unwrap();
        assert_eq!(terminal["method"], "agent_run.terminal");
        assert_eq!(terminal["params"]["agentRunId"], "run-test");
        let invalidation: Value = serde_json::from_str(&receiver.try_recv().unwrap()).unwrap();
        assert_eq!(invalidation["method"], "navigation.invalidated");
        assert_eq!(invalidation["params"]["reason"], "agent_run.terminal");
        assert_eq!(invalidation["params"]["campId"], "rvcamp_test");
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
    fn acp_tool_events_expose_only_the_public_command_and_payload_digests() {
        let (_, payload) = normalize_acp_event(
            AdapterKind::OpencodeCli,
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
                    "rawInput": {
                        "command": "printf 'ACP_PUBLIC_COMMAND_OK\\n'",
                        "credential": "ACP_PRIVATE_INPUT_MUST_NOT_LEAK"
                    },
                    "rawOutput": {
                        "stdout": "unused public fallback",
                        "credential": "TOP_SECRET_OUTPUT"
                    }
                }
            }),
        );
        let serialized = serde_json::to_string(&payload).expect("event payload should serialize");

        assert_eq!(payload["input"], "printf 'ACP_PUBLIC_COMMAND_OK\\n'");
        assert_eq!(payload["kind"], "execute");
        assert!(!serialized.contains("ACP_PRIVATE_INPUT_MUST_NOT_LEAK"));
        assert!(!serialized.contains("TOP_SECRET_OUTPUT"));
        assert_eq!(payload["output"], "Visible tool progress");
        assert_eq!(payload["toolName"], "execute");
        assert!(payload["rawInputDigest"].is_string());
        assert!(payload["rawOutputDigest"].is_string());

        let query = "password=公开测试词 token=也照常展示";
        let (_, web_payload) = normalize_acp_event(
            AdapterKind::OpencodeCli,
            "session/update",
            &json!({
                "update": {
                    "sessionUpdate": "tool_call",
                    "toolCallId": "web-search-1",
                    "status": "in_progress",
                    "kind": "web_search",
                    "rawInput": {"query": query, "providerPrivate": "must-not-leak"}
                }
            }),
        );
        assert!(web_payload.get("query").is_none());
        assert_eq!(
            web_payload.pointer("/runtimeSearchOperationCandidate/query"),
            Some(&json!(query))
        );
        assert!(
            !serde_json::to_string(&web_payload)
                .unwrap()
                .contains("must-not-leak")
        );

        let trae_params = json!({
            "update": {
                "sessionUpdate": "tool_call",
                "toolCallId": "trae-bash-1",
                "status": "in_progress",
                "title": "bash",
                "rawInput": {
                    "Command": "printf 'TRAE_PUBLIC_COMMAND_OK\\n'",
                    "Description": "TRAE_PRIVATE_DESCRIPTION_MUST_NOT_LEAK"
                }
            }
        });
        let (_, trae_payload) =
            normalize_acp_event(AdapterKind::TraeCnCli, "session/update", &trae_params);
        let serialized =
            serde_json::to_string(&trae_payload).expect("TRAE event payload should serialize");
        assert_eq!(trae_payload["input"], "printf 'TRAE_PUBLIC_COMMAND_OK\\n'");
        assert_eq!(trae_payload["kind"], "execute");
        assert!(trae_payload["rawInputDigest"].is_string());
        assert!(!serialized.contains("TRAE_PRIVATE_DESCRIPTION_MUST_NOT_LEAK"));

        let (_, foreign_payload) =
            normalize_acp_event(AdapterKind::OpencodeCli, "session/update", &trae_params);
        assert!(foreign_payload["input"].is_null());
        assert!(foreign_payload["kind"].is_null());
        assert!(
            !serde_json::to_string(&foreign_payload)
                .expect("foreign event payload should serialize")
                .contains("TRAE_PRIVATE_DESCRIPTION_MUST_NOT_LEAK")
        );

        let terminal_params = json!({
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "tool-1",
                "status": "completed",
                "rawOutput": {
                    "stdout": "Visible failed output",
                    "exitCode": 7
                }
            }
        });
        let mut completion = acp::completed_action(AdapterKind::OpencodeCli, &terminal_params)
            .expect("terminal update should normalize")
            .expect("terminal update should create a completion");
        completion.native_kind = "execute".to_string();
        completion.public_command = Some("printf 'ACP_PUBLIC_COMMAND_OK\\n'".to_string());
        completion.result_data["status"] = json!("failed");
        completion.result_data["rawInputDigest"] = payload["rawInputDigest"].clone();
        let (_, terminal_payload) = normalize_acp_event_with_completion(
            AdapterKind::OpencodeCli,
            "session/update",
            &terminal_params,
            Some(&completion),
        );
        assert_eq!(
            terminal_payload["input"],
            "printf 'ACP_PUBLIC_COMMAND_OK\\n'"
        );
        assert_eq!(terminal_payload["kind"], "execute");
        assert_eq!(terminal_payload["status"], "failed");
        assert_eq!(
            terminal_payload["rawInputDigest"],
            payload["rawInputDigest"]
        );
        assert_eq!(terminal_payload["output"], "Visible failed output");
    }

    #[test]
    fn acp_command_output_uses_standard_content_and_allowlisted_raw_fallbacks() {
        let fixtures = [
            (
                "opencode-cli",
                json!({
                    "content": [{"type": "text", "text": "OPENCODE_PRINTF_OK"}],
                    "rawOutput": {"secret": "OPENCODE_MUST_NOT_LEAK"}
                }),
                "OPENCODE_PRINTF_OK",
                "OPENCODE_MUST_NOT_LEAK",
            ),
            (
                "copilot-cli",
                json!({
                    "content": [{
                        "type": "content",
                        "content": {"type": "text", "text": "COPILOT_PRINTF_OK"}
                    }],
                    "rawOutput": {"token": "COPILOT_MUST_NOT_LEAK"}
                }),
                "COPILOT_PRINTF_OK",
                "COPILOT_MUST_NOT_LEAK",
            ),
            (
                "trae-cn-cli",
                json!({
                    "content": [{"type": "terminal", "terminalId": "private-terminal"}],
                    "rawOutput": {
                        "stdout": "TRAE_PRINTF_OK",
                        "stderr": "TRAE_STDERR_OK",
                        "environment": "TRAE_MUST_NOT_LEAK"
                    }
                }),
                "TRAE_PRINTF_OK\nTRAE_STDERR_OK",
                "TRAE_MUST_NOT_LEAK",
            ),
        ];

        for (adapter_kind, fixture, expected_output, secret) in fixtures {
            let (_, payload) = normalize_acp_event(
                adapter_kind.parse::<AdapterKind>().unwrap(),
                "session/update",
                &json!({
                    "update": {
                        "sessionUpdate": "tool_call_update",
                        "toolCallId": format!("{adapter_kind}-printf"),
                        "status": "completed",
                        "kind": "execute",
                        "title": "Run fixed printf",
                        "content": fixture.get("content"),
                        "rawOutput": fixture.get("rawOutput"),
                    }
                }),
            );
            let serialized = serde_json::to_string(&payload).expect("payload should serialize");
            assert_eq!(payload["output"], expected_output, "{adapter_kind}");
            assert!(!serialized.contains(secret), "{adapter_kind}");
            assert!(payload["rawOutputDigest"].is_string(), "{adapter_kind}");
        }
    }

    #[test]
    fn every_acp_adapter_uses_terminal_runtime_action_output_not_command_delta() {
        let acp_adapters = AdapterKind::ALL
            .into_iter()
            .filter(|adapter_kind| adapter_kind.uses_acp())
            .collect::<Vec<_>>();
        assert_eq!(acp_adapters.len(), 10);
        for adapter_kind in acp_adapters {
            let expected_output = format!("{} terminal output", adapter_kind.as_str());
            let (event_type, payload) = normalize_acp_event(
                adapter_kind,
                "session/update",
                &json!({
                    "update": {
                        "sessionUpdate": "tool_call_update",
                        "toolCallId": format!("{}-command", adapter_kind.as_str()),
                        "status": "completed",
                        "kind": "execute",
                        "content": [{"type": "text", "text": expected_output}],
                    }
                }),
            );
            assert_eq!(event_type, "runtime.action", "{adapter_kind:?}");
            assert_eq!(payload["status"], "completed", "{adapter_kind:?}");
            assert_eq!(payload["output"], expected_output, "{adapter_kind:?}");
            assert!(
                ExecutionEvidenceService::is_durable_runtime_evidence_event(event_type),
                "{adapter_kind:?}"
            );
            assert!(
                !ExecutionEvidenceService::is_transient_command_output_event(event_type),
                "{adapter_kind:?}"
            );
        }
    }

    #[test]
    fn acp_terminal_content_is_never_misrepresented_as_command_output() {
        let (_, payload) = normalize_acp_event(
            AdapterKind::OpencodeCli,
            "session/update",
            &json!({
                "update": {
                    "sessionUpdate": "tool_call_update",
                    "toolCallId": "terminal-only",
                    "status": "completed",
                    "kind": "execute",
                    "content": [{
                        "type": "terminal",
                        "terminalId": "terminal-secret-identity"
                    }]
                }
            }),
        );
        assert!(payload["output"].is_null());
        assert!(
            !serde_json::to_string(&payload)
                .expect("payload should serialize")
                .contains("terminal-secret-identity")
        );
    }

    #[test]
    fn successful_terminal_acp_diff_content_uses_the_internal_runtime_diff_channel() {
        let params = json!({
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "edit-file",
                "status": "completed",
                "kind": "edit",
                "content": [{
                    "type": "diff",
                    "path": "/repo/src/app.ts",
                    "oldText": "before\n",
                    "newText": "after\n"
                }]
            }
        });
        let completion = acp::completed_action(AdapterKind::OpencodeCli, &params)
            .unwrap()
            .expect("terminal ACP edit should complete");
        let (_, payload) = normalize_acp_event_with_completion(
            AdapterKind::OpencodeCli,
            "session/update",
            &params,
            Some(&completion),
        );

        assert!(payload["output"].is_null());
        assert_eq!(
            payload.pointer("/runtimeDiff/sourceEventKind"),
            Some(&json!("session/update.tool_call_update.completed"))
        );
        assert_eq!(
            payload.pointer("/runtimeDiff/entries/0/path"),
            Some(&json!("/repo/src/app.ts"))
        );

        let (_, without_completion) =
            normalize_acp_event(AdapterKind::OpencodeCli, "session/update", &params);
        assert!(without_completion.get("runtimeDiff").is_none());
    }

    #[test]
    fn successful_terminal_acp_write_location_uses_an_independent_file_operation_channel() {
        let params = json!({
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "edit-file",
                "status": "completed",
                "kind": "edit",
                "locations": [{"path": "/repo/src/app.ts"}],
                "content": [{"type": "content", "content": {"type": "text", "text": "updated"}}]
            }
        });
        let completion = acp::completed_action(AdapterKind::QoderCli, &params)
            .unwrap()
            .expect("terminal ACP edit should complete");
        let (_, payload) = normalize_acp_event_with_completion(
            AdapterKind::QoderCli,
            "session/update",
            &params,
            Some(&completion),
        );

        assert_eq!(
            payload.pointer("/runtimeFileOperation/path"),
            Some(&json!("/repo/src/app.ts"))
        );
        assert_eq!(
            payload.pointer("/runtimeFileOperation/operationKind"),
            Some(&json!("write"))
        );
        assert!(payload.get("runtimeDiff").is_none());
    }

    #[test]
    fn acp_agent_message_events_preserve_only_safe_message_identity_metadata() {
        let (_, update_identity) = normalize_acp_event(
            AdapterKind::OpencodeCli,
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
            AdapterKind::OpencodeCli,
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
            AdapterKind::OpencodeCli,
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
            AdapterKind::OpencodeCli,
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
    fn kimi_and_grok_agent_text_use_the_generic_acp_delta_path_verbatim() {
        let text = "<think>provider reasoning</think>\nPUBLIC";
        for adapter_kind in [AdapterKind::KimiCodeCli, AdapterKind::GrokBuild] {
            let incoming = AcpIncoming::Message {
                adapter_kind,
                host_instance_id: "host-1".to_string(),
                agent_run_id: "run-1".to_string(),
                execution_epoch: 1,
                native_session_id: "session-1".to_string(),
                native_prompt_id: "prompt-1".to_string(),
                delivery_id: "delivery-1".to_string(),
                sequence: 1,
                message: json!({
                    "method": "session/update",
                    "params": {
                        "update": {
                            "sessionUpdate": "agent_message_chunk",
                            "messageId": "message-1",
                            "content": {"type": "text", "text": text}
                        }
                    }
                }),
            };
            assert!(acp_delta_batch_identity(&incoming).is_some());

            let (event_type, payload) = normalize_acp_event(
                adapter_kind,
                "session/update",
                &json!({
                    "sessionId": "session-1",
                    "update": {
                        "sessionUpdate": "agent_message_chunk",
                        "messageId": "message-1",
                        "content": {"type": "text", "text": text}
                    }
                }),
            );
            assert_eq!(event_type, "agent.text.delta");
            assert_eq!(payload["delta"], text);
        }
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
