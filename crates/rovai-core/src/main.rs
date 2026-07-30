mod acp;
mod antigravity;
mod claude;
mod codex;
mod health;
mod team_runtime;

use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    future::Future,
    path::{Path, PathBuf},
    sync::Arc,
};

use acp::{AcpCliRuntimeAdapter, AcpIncoming, AcpRuntime};
use antigravity::{AntigravityAppRuntimeAdapter, AntigravityRunRequest};
use anyhow::{Context, Result};
use claude::{ClaudeCodeCliRuntimeAdapter, ClaudeCodeRunRequest};
use codex::{CodexAgentThreadOptions, CodexCliRuntimeAdapter, CodexIncoming, CodexRuntime};
use rovai_core::{
    action::{
        AcknowledgeRuntimeDeliveryCommand, AcquireRuntimeDeliveryCommand, ActionControlMode,
        ActionResultOutcome, ActionSafetyService, ClaimActionCommand,
        ConfirmRuntimeRequestResolvedCommand, FailRuntimeDeliveryCommand,
        MarkActionDispatchStartedCommand, PrepareActionCommand, ReconcileRuntimeLossCommand,
        RecordActionResultCommand, RecordObservedActionCommand, ResolveActionApprovalCommand,
    },
    agent_profile::{
        AdapterInstallationView, AdapterKind, AgentProfileService, ClearAgentProfileRuntimeCommand,
        CreateAdapterInstallationCommand, CreateAgentProfileCommand, ManagedProbeFailure,
        RecordAdapterCapabilitySnapshotCommand, RemoveMemberCommand, ReorderAgentProfilesCommand,
        RuntimeReadinessStatus, SetAgentProfileRuntimeCommand, SetMemberPresenceCommand,
        UpdateAdapterInstallationCommand, UpdateAgentProfileCommand, VerifiedManagedInstallation,
    },
    agent_runtime_adapter::{
        AcpProbeObservation, AgentRuntimeAdapterRegistry, AntigravityProbeObservation,
        ClaudeCodeProbeObservation, CodexProbeObservation, ExecutableIntegrityStatus,
        executable_fingerprint as fingerprint_executable, verify_executable_integrity,
    },
    collaboration::{
        CampCollaborationMode, ChangeDefaultLeadCommand, CollaborationService, CreateCampCommand,
        CreateTaskCommand, DeleteCampCommand, ExecutionRequest, MessageAddressSpec,
        ProjectBindingKind, ReconcileDefaultLeadCommand, RenameCampCommand, SendCampMessageCommand,
        TaskAssigneeFilter, TaskAssigneeUpdate, TaskListQuery, TaskStatus, UpdateTaskCommand,
    },
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandGatewayError, CommandResultStatus,
        DomainCommandGateway, canonical_json_digest,
    },
    context::{
        CharterDeliveryMode, ContextCompactionWork, ContextMaterialization, ContextService,
        ContextSummaryModelPreference, DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES,
        MaterializeContextRequest, PreparedContext, RecordContextSummaryInput,
        SkillExposurePreparation,
    },
    context_retrieval::{
        CONTEXT_GET_MESSAGE_THREAD_TOOL_NAME, CONTEXT_GET_MESSAGE_TOOL_NAME,
        CONTEXT_GET_MESSAGE_WINDOW_TOOL_NAME, CONTEXT_GET_SUMMARY_TOOL_NAME,
        CONTEXT_SEARCH_TOOL_NAME, ContextGetMessageInput, ContextGetMessageThreadInput,
        ContextGetMessageWindowInput, ContextGetSummaryInput, ContextRetrievalService,
        ContextSearchInput,
    },
    db::Database,
    execution_evidence::{AgentRunExecutionEvidence, ExecutionEvidenceService},
    git,
    managed_blob::ManagedBlobStore,
    mcp::{
        CommitMcpImportParams, CreateMcpServerParams, DeleteMcpServerParams, McpConfigStore,
        SetMcpServerEnabledParams, UpdateMcpServerParams,
    },
    mcp_import::McpImportScanner,
    mcp_projection::{McpProjectionRequest, McpProjectionService, PreparedMcpProjection},
    memory::{
        AcceptHearthMemoryProposalCommand, CreateMemoryCommand, ForgetMemoryCommand, MemoryService,
        ReactivateMemoryCommand, RejectHearthMemoryProposalCommand,
        RejectHearthMemoryProposalsCommand, RetireMemoryCommand, ReviseMemoryCommand,
        ScheduleMemoryReviewCommand, SetCampMemberMemoryWriteCommand, SetMemorySettingsCommand,
        SupersedeMemoriesCommand,
    },
    memory_retrieval::{
        MEMORY_READ_TOOL_NAME, MEMORY_SEARCH_TOOL_NAME, MemoryReadInput, MemoryRetrievalInvocation,
        MemoryRetrievalService, MemorySearchInput,
    },
    memory_tool::{
        HearthProposalToolInput, HearthProposalToolInvocation, MEMORY_PROPOSE_HEARTH_TOOL_NAME,
        MEMORY_WRITE_TOOL_NAME, MemoryToolService, MemoryWriteToolInput, MemoryWriteToolInvocation,
    },
    read_model::ReadModelService,
    runtime::{
        AcknowledgeAgentRunCancellationCommand, AgentRunCancellationCandidate, AgentRunExecution,
        AgentRunWorkspace, BindNativeSessionCommand, CancelCampTurnCommand, ClaimAgentRunCommand,
        ExecutionRuntimeService, FailAgentRunCommand, NativeSessionResumeDisposition,
        NativeSessionResumeFailure, PermissionSemantics,
        RecordCancelledAgentRunEndingGitObservationCommand, RejectAgentRunDispatchCommand,
        RestartNativeSessionCommand, SucceedAgentRunCommand,
    },
    runtime_discovery::{
        RuntimeDiscoveryObservation, RuntimeDiscoveryStatus, RuntimeSearchEnvironment,
        catalog_entries, discover_runtime_path, discover_runtime_version, is_executable_file,
        with_runtime_search_environment,
    },
    runtime_resolution::RuntimeResolutionService,
    skill::{
        CommitSkillImportCommand, DeleteSkillCommand, SetSkillEnabledCommand, SkillLibraryService,
    },
    skill_projection::{
        PreparedSkillExposure, ReconcileSkillProjectionsCommand, SkillProjectionReconciler,
    },
    team_tool::{
        TEAM_CREATE_TASK_TOOL_NAME, TEAM_LIST_TASKS_TOOL_NAME, TEAM_POST_MESSAGE_TOOL_NAME,
        TEAM_UPDATE_TASK_TOOL_NAME, TeamCreateTaskInput, TeamListTasksInput, TeamPostMessageInput,
        TeamTaskToolInvocation, TeamToolBindingCredential, TeamToolInvocation,
        TeamToolInvocationError, TeamToolService, TeamUpdateTaskInput,
    },
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use team_runtime::{
    TeamToolProcessConfig, team_tool_completion_audit_key, team_tool_completion_receipt,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter},
    net::{UnixListener, UnixStream},
    sync::{Mutex, Notify, RwLock, mpsc, oneshot},
    time::{Duration, MissedTickBehavior},
};

const RUNTIME_CANCELLATION_INTERRUPT_TIMEOUT: Duration = Duration::from_secs(2);
const RUNTIME_CANCELLATION_FENCE_TIMEOUT: Duration = Duration::from_secs(1);

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
            | "runtime.installations.refresh"
            | "runtime.discovery.rescan"
            | "runtime.product.check"
            | "camp.messages.send"
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
}

struct TeamMcpBridgeConfig {
    core_socket: PathBuf,
    native_binding_id: String,
    binding_credential: String,
}

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
    member_agent_profile_ids: Vec<String>,
    default_lead_agent_profile_id: String,
    collaboration_mode: CampCollaborationMode,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CampCreationMember {
    agent_profile_id: String,
    handle: String,
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
#[serde(rename_all = "camelCase")]
struct SkillIdParams {
    skill_id: String,
}

#[derive(Debug, Deserialize)]
struct InspectSkillImportParams {
    path: String,
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
    assignee_agent_id: Option<String>,
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
    status: Option<TaskStatus>,
    #[serde(default)]
    assignee: TaskAssigneeUpdate,
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
#[serde(rename_all = "camelCase")]
struct SendCampMessageParams {
    command_id: String,
    camp_id: String,
    body: String,
    address: MessageAddressSpec,
    reply_to_camp_message_id: Option<String>,
    execution: Option<ExecutionRequest>,
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
struct AgentProfileIdParams {
    agent_profile_id: String,
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetContextSummaryModelParams {
    expected_version: i64,
    preference: Option<ContextSummaryModelPreference>,
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
    claude_code_cli: ClaudeCodeCliRuntimeAdapter,
    antigravity_app: AntigravityAppRuntimeAdapter,
    data_dir: PathBuf,
}

enum AgentRunRuntime {
    Codex(Arc<CodexRuntime>),
    Acp(Arc<AcpRuntime>),
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
    fn known_agent_profile_ids(database: &Database) -> Result<BTreeSet<String>> {
        AgentProfileService::default().all_profile_ids(database)
    }

    fn reconcile_skills_best_effort(&self, database: &mut Database) {
        if let Err(error) =
            SkillProjectionReconciler.reconcile_known_roots(database, &self.skill_library)
        {
            eprintln!("failed to reconcile Skill projections after a state change: {error:#}");
        }
    }

    async fn reconcile_skills_periodically(&self) {
        let mut database = self.database.lock().await;
        self.reconcile_skills_best_effort(&mut database);
    }

    async fn cleanup_mcp_projections_best_effort(&self) {
        let database = self.database.lock().await;
        if let Err(error) = self.mcp_projection.cleanup_terminal_and_orphaned(&database) {
            eprintln!("failed to clean MCP Runtime projections: {error:#}");
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
        self.force_refresh_selected_and_registered_runtimes().await;
        self.runtime_health_payload().await
    }

    async fn runtime_health_payload(&self) -> Result<Value> {
        let observations = self.runtime_discovery.read().await.clone();
        let product_diagnostics = self.runtime_product_diagnostics.read().await.clone();
        let checking = self.runtime_checking.read().await.clone();
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
                    let status =
                        if checking.contains(&kind) {
                            "checking"
                        } else if let Some(installation) = installation {
                            if !installation.enabled {
                                "disabled"
                            } else if installation.path_state == "path_missing" {
                                "path_missing"
                            } else if installation.last_probe_attempt.as_ref().is_some_and(
                                |attempt| {
                                    attempt.status == "failed"
                                        && attempt.failure_class == "authentication_required"
                                },
                            ) {
                                "authentication_required"
                            } else if installation.last_probe_attempt.as_ref().is_some_and(
                                |attempt| {
                                    attempt.status == "failed"
                                        && matches!(
                                            attempt.failure_class.as_str(),
                                            "incompatible" | "identity_changed"
                                        )
                                },
                            ) {
                                "incompatible"
                            } else if installation.snapshot.as_ref().is_some_and(|snapshot| {
                                snapshot.probe_status == "ready" && snapshot.stale_at.is_none()
                            }) {
                                if installation
                                    .last_probe_attempt
                                    .as_ref()
                                    .is_some_and(|attempt| {
                                        attempt.status == "failed"
                                            && attempt.failure_class == "transient"
                                    })
                                {
                                    "refresh_failed_using_last_success"
                                } else {
                                    "ready"
                                }
                            } else if discovery.discovery_status == RuntimeDiscoveryStatus::Found {
                                "found_uninspected"
                            } else {
                                "missing"
                            }
                        } else if let Some(diagnostic) = product_diagnostic {
                            diagnostic.status
                        } else {
                            match discovery.discovery_status {
                                RuntimeDiscoveryStatus::Detecting => "detecting",
                                RuntimeDiscoveryStatus::Found => "found_uninspected",
                                RuntimeDiscoveryStatus::Missing => "missing",
                            }
                        };
                    json!({
                        "runtimeKind": kind,
                        "status": status,
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
                    })
                })
                .collect::<Vec<_>>();
        Ok(json!({
            "runtimeCatalog": catalog_entries(),
            "runtimeAvailability": availability,
            "searchEnvironment": self.runtime_search_environment.read().await.summary(),
        }))
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

    async fn refresh_registered_runtimes_after_discovery(&self) {
        let (selected, installations) = {
            let database = self.database.lock().await;
            let profiles = AgentProfileService::default()
                .list_profiles(&database)
                .unwrap_or_default();
            let selected = profiles
                .into_iter()
                .filter_map(|profile| {
                    profile
                        .runtime_selection
                        .map(|selection| selection.adapter_kind)
                })
                .collect::<BTreeSet<_>>();
            let installations = AgentProfileService::default()
                .list_installations(&database)
                .unwrap_or_default();
            (selected, installations)
        };
        let now = chrono::Utc::now();
        let managed_by_kind = installations
            .iter()
            .filter(|installation| {
                installation.installation_class
                    == rovai_core::agent_profile::InstallationClass::ManagedDefault
            })
            .map(|installation| (installation.adapter_kind, installation))
            .collect::<HashMap<_, _>>();
        let mut scheduled = BTreeSet::new();
        for kind in selected {
            if managed_by_kind
                .get(&kind)
                .is_none_or(|installation| !managed_installation_is_usable(installation))
                && managed_by_kind
                    .get(&kind)
                    .is_none_or(|installation| !probe_retry_is_deferred(installation, now))
            {
                scheduled.insert(kind);
            }
        }
        for installation in &installations {
            if !installation.enabled
                || installation.installation_class
                    != rovai_core::agent_profile::InstallationClass::ManagedDefault
            {
                continue;
            }
            if registered_runtime_refresh_is_due(installation, now)
                && !probe_retry_is_deferred(installation, now)
            {
                scheduled.insert(installation.adapter_kind);
            }
        }
        for kind in scheduled {
            if let Err(error) = self.resolve_product_runtime(kind).await {
                eprintln!(
                    "background Runtime resolution failed for {}: {error:#}",
                    kind.as_str()
                );
            }
        }
    }

    async fn force_refresh_selected_and_registered_runtimes(&self) {
        let scheduled = {
            let database = self.database.lock().await;
            let mut scheduled = AgentProfileService::default()
                .list_profiles(&database)
                .unwrap_or_default()
                .into_iter()
                .filter_map(|profile| {
                    profile
                        .runtime_selection
                        .map(|selection| selection.adapter_kind)
                })
                .collect::<BTreeSet<_>>();
            scheduled.extend(
                AgentProfileService::default()
                    .list_installations(&database)
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|installation| {
                        installation.enabled
                            && installation.installation_class
                                == rovai_core::agent_profile::InstallationClass::ManagedDefault
                    })
                    .map(|installation| installation.adapter_kind),
            );
            scheduled
        };
        for kind in scheduled {
            if let Err(error) = self.resolve_product_runtime(kind).await {
                eprintln!(
                    "explicit Runtime refresh failed for {}: {error:#}",
                    kind.as_str()
                );
            }
        }
    }

    async fn recover_pending_execution_intents(&self) {
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
                    match serde_json::from_str::<SendCampMessageParams>(&intent.payload_json)
                        .context("persisted pending send request is invalid")
                    {
                        Ok(params) => self.send_camp_message_request(params).await,
                        Err(error) => Err(error),
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

    async fn dispatch_context_compactions(self: &Arc<Self>) {
        let work = {
            let mut database = self.database.lock().await;
            ContextService.claim_next_compaction(&mut database)
        };
        let work = match work {
            Ok(Some(work)) => work,
            Ok(None) => return,
            Err(error) => {
                eprintln!("failed to claim Context Compaction: {error:#}");
                return;
            }
        };
        let core = self.clone();
        tokio::spawn(async move {
            let result = core.run_context_compaction(&work).await;
            let mut database = core.database.lock().await;
            match result {
                Ok(summary) => {
                    if let Err(error) = ContextService.record_summary(
                        &mut database,
                        &RecordContextSummaryInput {
                            compaction_attempt_id: &work.attempt_id,
                            lease_owner: &work.lease_owner,
                            body: &summary,
                            generator_version: &work.generator_version,
                        },
                    ) {
                        let detail = format!("failed to persist generated summary: {error:#}");
                        if let Err(failure) = ContextService.fail_summary(
                            &mut database,
                            &work.attempt_id,
                            &work.lease_owner,
                            "context_compaction_result_invalid",
                            &detail,
                        ) {
                            eprintln!(
                                "failed to close invalid Context Compaction {}: {failure:#}",
                                work.attempt_id
                            );
                        }
                    }
                }
                Err(error) => {
                    if let Err(failure) = ContextService.fail_summary(
                        &mut database,
                        &work.attempt_id,
                        &work.lease_owner,
                        "context_compaction_failed",
                        &format!("{error:#}"),
                    ) {
                        eprintln!(
                            "failed to persist Context Compaction {} failure: {failure:#}",
                            work.attempt_id
                        );
                    }
                }
            }
        });
    }

    async fn run_context_compaction(&self, work: &ContextCompactionWork) -> Result<String> {
        self.verify_runtime_integrity(
            &work.runtime.installation_id,
            &work.runtime.executable_path,
            &work.runtime.executable_fingerprint,
        )
        .await?;
        let root = self
            .data_dir
            .join("runtime-private")
            .join("context-compaction")
            .join(&work.attempt_id);
        std::fs::create_dir_all(&root).with_context(|| {
            format!(
                "failed to create isolated Context Compaction directory {}",
                root.display()
            )
        })?;
        restrict_private_directory(&root)?;
        let _cleanup = RemoveDirectoryOnDrop(root.clone());
        let summary = match work.runtime.adapter_kind {
            rovai_core::agent_profile::AdapterKind::CodexCli => {
                CodexCliRuntimeAdapter::run_isolated_completion(&work.runtime, &root, &work.prompt)
                    .await?
            }
            rovai_core::agent_profile::AdapterKind::OpencodeCli
            | rovai_core::agent_profile::AdapterKind::CopilotCli
            | rovai_core::agent_profile::AdapterKind::KiroCli
            | rovai_core::agent_profile::AdapterKind::QoderCli
            | rovai_core::agent_profile::AdapterKind::CodebuddyCli
            | rovai_core::agent_profile::AdapterKind::QwenCode => {
                AcpCliRuntimeAdapter::run_isolated_completion(&work.runtime, &root, &work.prompt)
                    .await?
            }
            rovai_core::agent_profile::AdapterKind::ClaudeCodeCli => {
                self.claude_code_cli
                    .run(ClaudeCodeRunRequest {
                        agent_run_id: format!("context-compaction:{}", work.attempt_id),
                        execution_epoch: 1,
                        workspace: AgentRunWorkspace {
                            execution_root: root.to_string_lossy().to_string(),
                            access: "read_only".to_string(),
                            isolation: "shared".to_string(),
                        },
                        permission_semantics: PermissionSemantics::CoreEnforcedV1,
                        runtime: work.runtime.clone(),
                        prompt: work.prompt.clone(),
                        resumable_native_session_id: None,
                        new_native_session_id: None,
                        new_session_charter: None,
                        team_tool: None,
                        external_mcp_servers: BTreeMap::new(),
                        attachment_projection_root: None,
                        persist_session: false,
                    })
                    .await?
                    .final_output
            }
            rovai_core::agent_profile::AdapterKind::AntigravityApp => {
                self.antigravity_app
                    .run(AntigravityRunRequest {
                        agent_run_id: format!("context-compaction:{}", work.attempt_id),
                        execution_epoch: 1,
                        workspace: AgentRunWorkspace {
                            execution_root: root.to_string_lossy().to_string(),
                            access: "read_only".to_string(),
                            isolation: "shared".to_string(),
                        },
                        permission_semantics: PermissionSemantics::CoreEnforcedV1,
                        runtime: work.runtime.clone(),
                        prompt: work.prompt.clone(),
                        resumable_native_session_id: None,
                        attachment_projection_root: None,
                    })
                    .await?
                    .final_output
            }
        };
        let summary = summary.trim();
        if summary.is_empty() {
            anyhow::bail!("Context Compaction produced an empty summary");
        }
        Ok(summary.to_string())
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

    async fn handle_team_tool_ipc(&self, request: TeamToolIpcRequest) -> TeamToolIpcResponse {
        let result: Result<Value> = async {
            let mut database = self.database.lock().await;
            let service = TeamToolService::default();
            match request.tool_name.as_str() {
                TEAM_POST_MESSAGE_TOOL_NAME => {
                    let input = serde_json::from_value::<TeamPostMessageInput>(request.input)
                        .context("private post_message input is invalid")?;
                    service
                        .post_message(
                            &mut database,
                            &TeamToolInvocation {
                                native_binding_id: request.native_binding_id,
                                binding_credential: request.binding_credential,
                                runtime_tool_call_id: request.runtime_tool_call_id,
                                input,
                            },
                        )
                        .and_then(command_execution_payload)
                }
                TEAM_CREATE_TASK_TOOL_NAME => {
                    let input = serde_json::from_value::<TeamCreateTaskInput>(request.input)
                        .context("private create_task input is invalid")?;
                    service
                        .create_task(
                            &mut database,
                            &TeamTaskToolInvocation {
                                native_binding_id: request.native_binding_id,
                                binding_credential: request.binding_credential,
                                runtime_tool_call_id: request.runtime_tool_call_id,
                                input,
                            },
                        )
                        .and_then(command_execution_payload)
                }
                TEAM_UPDATE_TASK_TOOL_NAME => {
                    let input = serde_json::from_value::<TeamUpdateTaskInput>(request.input)
                        .context("private update_task input is invalid")?;
                    service
                        .update_task(
                            &mut database,
                            &TeamTaskToolInvocation {
                                native_binding_id: request.native_binding_id,
                                binding_credential: request.binding_credential,
                                runtime_tool_call_id: request.runtime_tool_call_id,
                                input,
                            },
                        )
                        .and_then(command_execution_payload)
                }
                TEAM_LIST_TASKS_TOOL_NAME => {
                    let input = serde_json::from_value::<TeamListTasksInput>(request.input)
                        .context("private list_tasks input is invalid")?;
                    service
                        .list_tasks(
                            &database,
                            &TeamTaskToolInvocation {
                                native_binding_id: request.native_binding_id,
                                binding_credential: request.binding_credential,
                                runtime_tool_call_id: request.runtime_tool_call_id,
                                input,
                            },
                        )
                        .and_then(|page| serde_json::to_value(page).map_err(Into::into))
                }
                MEMORY_WRITE_TOOL_NAME => {
                    let input = serde_json::from_value::<MemoryWriteToolInput>(request.input)
                        .context("private memory.write input is invalid")?;
                    let execution = MemoryToolService.write(
                        &mut database,
                        &MemoryWriteToolInvocation {
                            native_binding_id: request.native_binding_id,
                            binding_credential: request.binding_credential,
                            runtime_tool_call_id: request.runtime_tool_call_id,
                            input,
                        },
                    )?;
                    command_execution_payload(execution)
                }
                MEMORY_PROPOSE_HEARTH_TOOL_NAME => {
                    let input = serde_json::from_value::<HearthProposalToolInput>(request.input)
                        .context("private memory.propose_hearth input is invalid")?;
                    MemoryToolService
                        .propose_hearth(
                            &mut database,
                            &HearthProposalToolInvocation {
                                native_binding_id: request.native_binding_id,
                                binding_credential: request.binding_credential,
                                runtime_tool_call_id: request.runtime_tool_call_id,
                                input,
                            },
                        )
                        .and_then(command_execution_payload)
                }
                MEMORY_SEARCH_TOOL_NAME => {
                    let input = serde_json::from_value::<MemorySearchInput>(request.input)
                        .context("private memory.search input is invalid")?;
                    serde_json::to_value(MemoryRetrievalService.search(
                        &mut database,
                        &MemoryRetrievalInvocation {
                            native_binding_id: request.native_binding_id,
                            binding_credential: request.binding_credential,
                            runtime_tool_call_id: request.runtime_tool_call_id,
                            input,
                        },
                    )?)
                    .map_err(Into::into)
                }
                MEMORY_READ_TOOL_NAME => {
                    let input = serde_json::from_value::<MemoryReadInput>(request.input)
                        .context("private memory.read input is invalid")?;
                    serde_json::to_value(MemoryRetrievalService.read(
                        &mut database,
                        &MemoryRetrievalInvocation {
                            native_binding_id: request.native_binding_id,
                            binding_credential: request.binding_credential,
                            runtime_tool_call_id: request.runtime_tool_call_id,
                            input,
                        },
                    )?)
                    .map_err(Into::into)
                }
                CONTEXT_SEARCH_TOOL_NAME => {
                    let input = serde_json::from_value::<ContextSearchInput>(request.input)
                        .context("private context.search input is invalid")?;
                    let run = service.authenticate_read_binding(
                        &database,
                        &request.native_binding_id,
                        &request.binding_credential,
                        &request.runtime_tool_call_id,
                    )?;
                    ContextRetrievalService.search(&database, &run, &input)
                }
                CONTEXT_GET_MESSAGE_TOOL_NAME => {
                    let input = serde_json::from_value::<ContextGetMessageInput>(request.input)
                        .context("private context.get_message input is invalid")?;
                    let run = service.authenticate_read_binding(
                        &database,
                        &request.native_binding_id,
                        &request.binding_credential,
                        &request.runtime_tool_call_id,
                    )?;
                    ContextRetrievalService.get_message(&database, &run, &input)
                }
                CONTEXT_GET_MESSAGE_WINDOW_TOOL_NAME => {
                    let input =
                        serde_json::from_value::<ContextGetMessageWindowInput>(request.input)
                            .context("private context.get_message_window input is invalid")?;
                    let run = service.authenticate_read_binding(
                        &database,
                        &request.native_binding_id,
                        &request.binding_credential,
                        &request.runtime_tool_call_id,
                    )?;
                    ContextRetrievalService.get_message_window(&database, &run, &input)
                }
                CONTEXT_GET_MESSAGE_THREAD_TOOL_NAME => {
                    let input =
                        serde_json::from_value::<ContextGetMessageThreadInput>(request.input)
                            .context("private context.get_message_thread input is invalid")?;
                    let run = service.authenticate_read_binding(
                        &database,
                        &request.native_binding_id,
                        &request.binding_credential,
                        &request.runtime_tool_call_id,
                    )?;
                    ContextRetrievalService.get_message_thread(&database, &run, &input)
                }
                CONTEXT_GET_SUMMARY_TOOL_NAME => {
                    let input = serde_json::from_value::<ContextGetSummaryInput>(request.input)
                        .context("private context.get_summary input is invalid")?;
                    let run = service.authenticate_read_binding(
                        &database,
                        &request.native_binding_id,
                        &request.binding_credential,
                        &request.runtime_tool_call_id,
                    )?;
                    ContextRetrievalService.get_summary(&database, &run, &input)
                }
                _ => Err(anyhow::anyhow!("private Team Tool name is unsupported")),
            }
        }
        .await;
        match result {
            Ok(result) => TeamToolIpcResponse {
                result: Some(result),
                error: None,
            },
            Err(error) => {
                let (code, message) =
                    if let Some(error) = error.downcast_ref::<TeamToolInvocationError>() {
                        (error.code.clone(), error.message.clone())
                    } else if error.downcast_ref::<CommandGatewayError>().is_some() {
                        (
                            "team_tool.idempotency_conflict".to_string(),
                            "Runtime Tool Call ID was reused with different input".to_string(),
                        )
                    } else {
                        eprintln!("Team Tool invocation failed internally: {error:#}");
                        (
                            "team_tool.internal_error".to_string(),
                            "Rovai-ai could not commit the Team Tool request".to_string(),
                        )
                    };
                TeamToolIpcResponse {
                    result: None,
                    error: Some(TeamToolIpcError { code, message }),
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
            "agents.list" => {
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    AgentProfileService::default().list_profiles(&database)?,
                )?)
            }
            "agents.get" => {
                let params: AgentProfileIdParams = serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                let profile = AgentProfileService::default()
                    .get_profile(&database, &params.agent_profile_id)?
                    .context("AgentProfile does not exist")?;
                Ok(serde_json::to_value(profile)?)
            }
            "agents.memberships.list" => {
                let params: AgentProfileIdParams = serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    AgentProfileService::default()
                        .list_camp_memberships(&database, &params.agent_profile_id)?,
                )?)
            }
            "agents.create" => {
                let params: UserCommandParams<CreateAgentProfileCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = AgentProfileService::default().create_profile(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "agents.update" => {
                let params: UserCommandParams<UpdateAgentProfileCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = AgentProfileService::default().update_profile(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "agents.runtime.set" => {
                let params: UserCommandParams<SetAgentProfileRuntimeCommand> =
                    serde_json::from_value(request.params.clone())?;
                let adapter_kind = params.command.adapter_kind;
                let (execution, needs_resolution) = {
                    let mut database = self.database.lock().await;
                    let execution = AgentProfileService::default().set_runtime(
                        &mut database,
                        &user_command_envelope(params.command_id, params.command),
                    )?;
                    let needs_resolution = execution.result.status == CommandResultStatus::Applied
                        && !managed_runtime_is_ready(&database, adapter_kind)?;
                    (execution, needs_resolution)
                };
                if needs_resolution
                    && let Err(error) = self.resolve_product_runtime(adapter_kind).await
                {
                    eprintln!(
                        "selected Product Runtime resolution failed for {}: {error:#}",
                        adapter_kind.as_str()
                    );
                }
                if execution.result.status == CommandResultStatus::Applied {
                    let mut database = self.database.lock().await;
                    self.reconcile_skills_best_effort(&mut database);
                }
                Ok(serde_json::to_value(execution.result)?)
            }
            "agents.runtime.clear" => {
                let params: UserCommandParams<ClearAgentProfileRuntimeCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = AgentProfileService::default().clear_runtime(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                self.reconcile_skills_best_effort(&mut database);
                Ok(serde_json::to_value(execution.result)?)
            }
            "agents.presence.set" => {
                let params: UserCommandParams<SetMemberPresenceCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = AgentProfileService::default().set_presence(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                self.reconcile_skills_best_effort(&mut database);
                Ok(serde_json::to_value(execution.result)?)
            }
            "agents.removalPreview" => {
                let params: AgentProfileIdParams = serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    AgentProfileService::default()
                        .removal_preview(&database, &params.agent_profile_id)?
                        .context("AgentProfile does not exist")?,
                )?)
            }
            "agents.remove" => {
                let params: UserCommandParams<RemoveMemberCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = AgentProfileService::default().remove_member(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                self.reconcile_skills_best_effort(&mut database);
                Ok(serde_json::to_value(execution.result)?)
            }
            "agents.reorder" => {
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
            "memory.settings.get" => {
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    MemoryService::default().get_settings(&database)?,
                )?)
            }
            "memory.settings.set" => {
                let params: UserCommandParams<SetMemorySettingsCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = MemoryService::default().set_settings(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                Ok(serde_json::to_value(execution.result)?)
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
            "campMembers.memoryWrite.set" => {
                let params: UserCommandParams<SetCampMemberMemoryWriteCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = MemoryService::default().set_member_memory_write(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                Ok(serde_json::to_value(execution.result)?)
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
                let mut database = self.database.lock().await;
                let execution = AgentProfileService::default().update_installation(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                self.reconcile_skills_best_effort(&mut database);
                Ok(serde_json::to_value(execution.result)?)
            }
            "runtime.installations.refresh" => {
                let params: RefreshAdapterInstallationParams =
                    serde_json::from_value(request.params.clone())?;
                self.refresh_adapter_installation(params).await
            }
            "context.summaryModel.get" => {
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    ContextService.summary_model_config(&database)?,
                )?)
            }
            "context.summaryModel.set" => {
                let params: SetContextSummaryModelParams =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                Ok(serde_json::to_value(
                    ContextService.set_summary_model_config(
                        &mut database,
                        params.expected_version,
                        params.preference.as_ref(),
                    )?,
                )?)
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
                let known_agents = Self::known_agent_profile_ids(&database)?;
                Ok(serde_json::to_value(self.mcp_config.get(&known_agents)?)?)
            }
            "mcp.config.repairPermissions" => {
                let database = self.database.lock().await;
                let known_agents = Self::known_agent_profile_ids(&database)?;
                self.mcp_config.repair_permissions()?;
                Ok(serde_json::to_value(self.mcp_config.get(&known_agents)?)?)
            }
            "mcp.servers.create" => {
                let params: CreateMcpServerParams = serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                let known_agents = Self::known_agent_profile_ids(&database)?;
                Ok(serde_json::to_value(
                    self.mcp_config.create(params, &known_agents)?,
                )?)
            }
            "mcp.servers.update" => {
                let params: UpdateMcpServerParams = serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                let known_agents = Self::known_agent_profile_ids(&database)?;
                Ok(serde_json::to_value(
                    self.mcp_config.update(params, &known_agents)?,
                )?)
            }
            "mcp.servers.setEnabled" => {
                let params: SetMcpServerEnabledParams =
                    serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                let known_agents = Self::known_agent_profile_ids(&database)?;
                Ok(serde_json::to_value(
                    self.mcp_config.set_enabled(params, &known_agents)?,
                )?)
            }
            "mcp.servers.delete" => {
                let params: DeleteMcpServerParams = serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                let known_agents = Self::known_agent_profile_ids(&database)?;
                Ok(serde_json::to_value(
                    self.mcp_config.delete(params, &known_agents)?,
                )?)
            }
            "mcp.import.scan" => {
                let database = self.database.lock().await;
                let profiles = AgentProfileService::default().list_profiles(&database)?;
                let known_agents = Self::known_agent_profile_ids(&database)?;
                let active_agents = profiles
                    .into_iter()
                    .filter(|profile| profile.presence == "present")
                    .map(|profile| profile.id)
                    .collect::<Vec<_>>();
                Ok(serde_json::to_value(McpImportScanner.scan(
                    &self.mcp_config,
                    &known_agents,
                    &active_agents,
                )?)?)
            }
            "mcp.import.commit" => {
                let params: CommitMcpImportParams = serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                let known_agents = Self::known_agent_profile_ids(&database)?;
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
            "skills.import.commit" => {
                let params: UserCommandParams<CommitSkillImportCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = self.skill_library.commit_import(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                self.reconcile_skills_best_effort(&mut database);
                Ok(serde_json::to_value(execution.result)?)
            }
            "skills.setEnabled" => {
                let params: UserCommandParams<SetSkillEnabledCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = self.skill_library.set_enabled(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                self.reconcile_skills_best_effort(&mut database);
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
                self.reconcile_skills_best_effort(&mut database);
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
                        agent_profile_id: profile.id,
                        handle: profile.handle,
                        display_name: profile.display_name,
                        member_order: profile.member_order,
                        runtime_configured: profile.runtime_preference.is_some(),
                        runtime_readiness: profile.runtime_readiness.status,
                    })
                    .collect::<Vec<_>>();
                let initial_lead_agent_profile_id = present_members
                    .iter()
                    .find(|member| member.runtime_readiness == RuntimeReadinessStatus::Ready)
                    .or_else(|| present_members.first())
                    .map(|member| member.agent_profile_id.clone());
                let blockers = if present_members.is_empty() {
                    vec![json!({
                        "code": "no_present_members",
                        "detail": "当前没有在队成员。",
                    })]
                } else {
                    Vec::new()
                };
                Ok(json!({
                    "admissible": blockers.is_empty(),
                    "presentMembers": present_members,
                    "initialLeadAgentProfileId": initial_lead_agent_profile_id,
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
                        self.data_dir.join("quick-chat").to_string_lossy().to_string(),
                    ),
                };
                if project_binding_kind == ProjectBindingKind::QuickChat {
                    std::fs::create_dir_all(&requested_path).with_context(|| {
                        format!("failed to create Rovai-ai Quick Chat workspace at {requested_path}")
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
                    member_agent_profile_ids: params.member_agent_profile_ids,
                    default_lead_agent_profile_id: params.default_lead_agent_profile_id,
                    collaboration_mode: params.collaboration_mode,
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
                self.reconcile_skills_best_effort(&mut database);
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
                            status: params.status,
                            assignee: params.assignee,
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
                            user_id: "local-user".to_string(),
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
                            user_id: "local-user".to_string(),
                        },
                        None,
                    )?,
                )?)
            }
            "camp.messages.send" => {
                let params: SendCampMessageParams = serde_json::from_value(request.params.clone())?;
                self.send_camp_message_request(params).await
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
                            user_id: "local-user".to_string(),
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
            "diagnostics.export" => {
                let mut database = self.database.lock().await;
                let profile_service = AgentProfileService::default();
                let agents = profile_service.list_profiles(&database)?;
                let adapter_installations = profile_service.list_installations(&database)?;
                let camps = ReadModelService.list_camps(&database)?;
                let navigation = ReadModelService.navigation_snapshot(&mut database)?;
                let memory_diagnostics = MemoryService::default().diagnostics(&database)?;
                Ok(json!({
                    "format": "rovai-diagnostics-v4",
                    "exportedAt": chrono::Utc::now().to_rfc3339(),
                    "appVersion": env!("CARGO_PKG_VERSION"),
                    "databasePath": database.path(),
                    "agents": agents,
                    "adapterInstallations": adapter_installations,
                    "camps": camps,
                    "navigation": navigation,
                    "memory": memory_diagnostics,
                }))
            }
            "runtime.discovery.rescan" => {
                let params: RuntimeDiscoveryRescanParams =
                    serde_json::from_value(request.params.clone())?;
                self.rescan_runtime_discovery(params.interactive_shell)
                    .await
            }
            "runtime.product.check" => {
                let params: CheckProductRuntimeParams =
                    serde_json::from_value(request.params.clone())?;
                let ready = self.resolve_product_runtime(params.runtime_kind).await?;
                let health = self.runtime_health_payload().await?;
                Ok(json!({
                    "ready": ready,
                    "runtimeKind": params.runtime_kind,
                    "runtimeAvailability": health["runtimeAvailability"],
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

    async fn send_camp_message_request(&self, params: SendCampMessageParams) -> Result<Value> {
        let envelope = CommandEnvelope {
            command_id: params.command_id.clone(),
            actor: ActorRef::User {
                user_id: "local-user".to_string(),
            },
            camp_id: Some(params.camp_id.clone()),
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload: SendCampMessageCommand {
                camp_id: params.camp_id.clone(),
                body: params.body.clone(),
                address: params.address.clone(),
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
            CollaborationService::default().send_camp_message(&mut database, &envelope)?
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
                registry.antigravity_capability_snapshot(AntigravityProbeObservation {
                    reported_version: probe.result.reported_version,
                    executable_fingerprint: probe.result.executable_fingerprint,
                    authentication_status: probe_authentication_status(probe.result.status)
                        .to_string(),
                    probe_status: probe_status_name(probe.result.status).to_string(),
                    capabilities: probe.result.capabilities,
                    models: probe.models,
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
        for candidate in candidates {
            let workspace = candidate.execution_workspace();
            let workspace_path = match self.validate_dispatch_workspace(&candidate).await {
                Ok(path) => path,
                Err(error) => {
                    self.reject_agent_run_dispatch(&candidate, "workspace_unavailable", &error)
                        .await;
                    continue;
                }
            };
            let runtime = match candidate.frozen_runtime() {
                Ok(runtime) => runtime,
                Err(error) => {
                    self.reject_agent_run_dispatch(
                        &candidate,
                        "runtime_configuration_invalid",
                        &error,
                    )
                    .await;
                    continue;
                }
            };
            let runtime_blocker = {
                let database = self.database.lock().await;
                AgentProfileService::default().runtime_dispatch_blocker(&database, &runtime)
            };
            match runtime_blocker {
                Ok(Some(blocker)) => {
                    let error = anyhow::anyhow!("{}", blocker.payload);
                    self.reject_agent_run_dispatch(&candidate, &blocker.code, &error)
                        .await;
                    continue;
                }
                Ok(None) => {}
                Err(error) => {
                    self.reject_agent_run_dispatch(
                        &candidate,
                        "runtime_configuration_invalid",
                        &error,
                    )
                    .await;
                    continue;
                }
            }
            if let Err(error) = self
                .verify_runtime_integrity(
                    &runtime.installation_id,
                    &runtime.executable_path,
                    &runtime.executable_fingerprint,
                )
                .await
            {
                self.reject_agent_run_dispatch(&candidate, "runtime_integrity_failed", &error)
                    .await;
                continue;
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
                Ok(_) => continue,
                Err(error) => {
                    eprintln!(
                        "failed to claim AgentRun {}: {error:#}",
                        candidate.agent_run_id
                    );
                    continue;
                }
            };
            let Some(execution_epoch) = claim.result.payload["executionEpoch"].as_i64() else {
                eprintln!(
                    "AgentRun claim {} did not return executionEpoch",
                    candidate.agent_run_id
                );
                continue;
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
                    continue;
                }
                Err(error) => {
                    eprintln!(
                        "failed to materialize AgentRun {} input: {error:#}",
                        candidate.agent_run_id
                    );
                    self.fail_unmaterialized_agent_run(&candidate, execution_epoch, &error)
                        .await;
                    continue;
                }
            };
            let core = self.clone();
            let output = output.clone();
            tokio::spawn(async move {
                if let Err(error) = core.launch_agent_run(&execution, &output).await {
                    eprintln!(
                        "failed to launch AgentRun {}: {error:#}",
                        execution.agent_run_id
                    );
                    core.fail_claimed_agent_run(&execution, "runtime_launch_failed", &error)
                        .await;
                }
            });
        }
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
            git::validate_workspace_directory(
                &validation_path,
                &data_dir,
                allow_managed_quick_chat,
            )
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
                        manual_retry_allowed: true,
                    },
                },
            )
        };
        if let Err(rejection_error) = rejection {
            eprintln!(
                "failed to reject AgentRun {} before launch: {rejection_error:#}",
                candidate.agent_run_id
            );
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
                    emit(
                        output,
                        "agent_run.cancelled",
                        json!({
                            "campId": candidate.camp_id,
                            "campTurnId": candidate.camp_turn_id,
                            "agentRunId": candidate.agent_run_id,
                            "executionEpoch": candidate.execution_epoch,
                            "result": execution.result,
                            "replayed": execution.replayed,
                        }),
                    );
                    let core = self.clone();
                    tokio::spawn(async move {
                        core.record_cancelled_run_ending_git_observation(&candidate)
                            .await;
                    });
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
                        "compactionAttemptId": wait.compaction_attempt_id,
                    }),
                );
                Ok(None)
            }
        }
    }

    async fn prepare_agent_run_skill_exposure(
        &self,
        execution: &AgentRunExecution,
        output: &mpsc::UnboundedSender<String>,
    ) -> Result<Option<PreparedSkillExposure>> {
        let preparation = {
            let mut database = self.database.lock().await;
            ContextService.prepare_skill_exposure(
                &mut database,
                &self.skill_library,
                &execution.agent_run_id,
                execution.execution_epoch,
            )
        }?;
        match preparation {
            SkillExposurePreparation::Ready(exposure) => Ok(Some(exposure)),
            SkillExposurePreparation::Waiting(wait) => {
                emit(
                    output,
                    "agent_run.context_waiting",
                    json!({
                        "campId": execution.camp_id,
                        "campTurnId": execution.camp_turn_id,
                        "agentRunId": execution.agent_run_id,
                        "executionEpoch": execution.execution_epoch,
                        "reason": wait.reason,
                        "compactionAttemptId": wait.compaction_attempt_id,
                    }),
                );
                Ok(None)
            }
        }
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
                agent_profile_id: &execution.agent_profile_id,
                adapter_kind: execution.runtime.adapter_kind,
                execution_root: &execution_root,
            },
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

    async fn prepare_team_tool_runtime(
        &self,
        execution: &AgentRunExecution,
        force_new_binding: bool,
    ) -> Result<(TeamToolBindingCredential, TeamToolProcessConfig)> {
        let credential = {
            let mut database = self.database.lock().await;
            TeamToolService::default().prepare_binding_credential(
                &mut database,
                &execution.agent_run_id,
                execution.execution_epoch,
                force_new_binding,
            )?
        };
        let process_config = TeamToolProcessConfig::new(
            std::env::current_exe()
                .context("failed to locate the Rovai-ai Agent Host executable")?,
            team_tool_socket_path(&self.data_dir),
            &credential,
        )?;
        Ok((credential, process_config))
    }

    async fn bind_prepared_native_session(
        &self,
        execution: &AgentRunExecution,
        credential: &TeamToolBindingCredential,
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

    async fn verify_runtime_integrity(
        &self,
        installation_id: &str,
        executable_path: &str,
        executable_fingerprint: &str,
    ) -> Result<()> {
        let verified = {
            let database = self.database.lock().await;
            AgentProfileService::default().verified_executable_identity(
                &database,
                installation_id,
                executable_path,
                executable_fingerprint,
            )?
        };
        let executable_path_buf = PathBuf::from(executable_path);
        let expected_fingerprint = executable_fingerprint.to_string();
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
            Ok(ExecutableIntegrityStatus::Unchanged) => Ok(()),
            Ok(ExecutableIntegrityStatus::Reverified(identity)) => {
                let mut database = self.database.lock().await;
                AgentProfileService::default().record_verified_executable_identity(
                    &mut database,
                    installation_id,
                    executable_path,
                    executable_fingerprint,
                    &identity,
                )?;
                Ok(())
            }
            Ok(ExecutableIntegrityStatus::Changed) => {
                let mut database = self.database.lock().await;
                AgentProfileService::default().mark_runtime_integrity_changed(
                    &mut database,
                    installation_id,
                    executable_path,
                    executable_fingerprint,
                )?;
                anyhow::bail!(
                    "Runtime executable changed after AgentRun creation; refresh the installation and retry"
                )
            }
            Err(error) => {
                let mut database = self.database.lock().await;
                AgentProfileService::default().mark_runtime_integrity_changed(
                    &mut database,
                    installation_id,
                    executable_path,
                    executable_fingerprint,
                )?;
                Err(error).context("Runtime executable is unavailable at launch")
            }
        }
    }

    async fn launch_agent_run(
        &self,
        execution: &AgentRunExecution,
        output: &mpsc::UnboundedSender<String>,
    ) -> Result<()> {
        let Some(skill_exposure) = self
            .prepare_agent_run_skill_exposure(execution, output)
            .await?
        else {
            return Ok(());
        };
        let mcp_projection = self.prepare_agent_run_mcp_projection(execution).await?;
        let attachment_projection_root = ManagedBlobStore::new(&self.data_dir)
            .run_attachment_projection_root(&execution.agent_run_id)
            .context("failed to prepare the Run Attachment Projection access root")?;
        let resume_disposition = {
            let mut database = self.database.lock().await;
            ExecutionRuntimeService::default()
                .prepare_native_session_resume(&mut database, execution)?
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
                .launch_antigravity_agent_run(
                    execution,
                    resume_disposition,
                    &skill_exposure,
                    &mcp_projection,
                    &attachment_projection_root,
                    output,
                )
                .await;
        }
        if execution.runtime.adapter_kind == rovai_core::agent_profile::AdapterKind::ClaudeCodeCli {
            return self
                .launch_claude_code_agent_run(
                    execution,
                    resume_disposition,
                    &skill_exposure,
                    &mcp_projection,
                    &attachment_projection_root,
                    output,
                )
                .await;
        }
        if matches!(
            execution.runtime.adapter_kind,
            rovai_core::agent_profile::AdapterKind::OpencodeCli
                | rovai_core::agent_profile::AdapterKind::CopilotCli
                | rovai_core::agent_profile::AdapterKind::QoderCli
                | rovai_core::agent_profile::AdapterKind::CodebuddyCli
                | rovai_core::agent_profile::AdapterKind::QwenCode
        ) {
            return self
                .launch_acp_agent_run(
                    execution,
                    resume_disposition,
                    &skill_exposure,
                    &mcp_projection,
                    &attachment_projection_root,
                    output,
                )
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
        let (initial_binding, initial_team_tool) = self
            .prepare_team_tool_runtime(
                execution,
                resume_disposition == NativeSessionResumeDisposition::New
                    && execution.native_session_id.is_some(),
            )
            .await?;
        let runtime = self
            .codex_cli
            .ensure_agent_run_runtime(
                &execution.agent_run_id,
                execution.execution_epoch,
                &execution_root,
                &execution.runtime,
            )
            .await?;
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
        let mut charter = {
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
        let thread = runtime
            .start_or_resume_agent_thread(
                &execution_root,
                CodexAgentThreadOptions {
                    existing_thread_id: resumable_session_id.as_deref(),
                    developer_instructions: resumable_session_id
                        .is_none()
                        .then_some(charter.as_str()),
                    sandbox_mode,
                    approval_policy,
                    model: Some(model),
                    team_tool: Some(&initial_team_tool),
                    external_mcp_servers: &mcp_projection.servers,
                    attachment_projection_root: &attachment_projection_root,
                },
            )
            .await;
        let mut binding_credential = initial_binding;
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
                let (replacement_binding, replacement_team_tool) =
                    self.prepare_team_tool_runtime(execution, true).await?;
                charter = {
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
                            developer_instructions: Some(charter.as_str()),
                            sandbox_mode,
                            approval_policy,
                            model: Some(model),
                            team_tool: Some(&replacement_team_tool),
                            external_mcp_servers: &mcp_projection.servers,
                            attachment_projection_root: &attachment_projection_root,
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
            runtime.shutdown().await;
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
            emit(
                output,
                "agent_run.input_resumed",
                json!({
                    "campId": execution.camp_id,
                    "campTurnId": execution.camp_turn_id,
                    "agentRunId": execution.agent_run_id,
                    "agentProfileId": execution.agent_profile_id,
                    "executionEpoch": execution.execution_epoch,
                    "adapterKind": execution.runtime.adapter_kind,
                    "nativeThreadId": thread_id,
                    "nativeTurnId": delivery.native_input_id,
                    "contextManifestId": prepared_context.manifest_id,
                }),
            );
            return Ok(());
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
        self.acknowledge_runtime_input(&delivery.id, &native_turn_id)
            .await?;
        emit(
            output,
            "agent_run.started",
            json!({
                "campId": execution.camp_id,
                "campTurnId": execution.camp_turn_id,
                "agentRunId": execution.agent_run_id,
                "agentProfileId": execution.agent_profile_id,
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

    async fn launch_claude_code_agent_run(
        &self,
        execution: &AgentRunExecution,
        resume_disposition: NativeSessionResumeDisposition,
        skill_exposure: &PreparedSkillExposure,
        mcp_projection: &PreparedMcpProjection,
        attachment_projection_root: &Path,
        output: &mpsc::UnboundedSender<String>,
    ) -> Result<()> {
        let execution_root = PathBuf::from(&execution.workspace.execution_root);
        if !execution_root.is_dir() {
            anyhow::bail!(
                "AgentRun execution directory no longer exists: {}",
                execution_root.display()
            );
        }
        // The credential identifies the long-lived Native Binding, not this
        // AgentRun. Core resolves the current active Run at every tool call.
        let (binding_credential, team_tool) = self
            .prepare_team_tool_runtime(
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
        if is_new_session {
            self.bind_prepared_native_session(execution, &binding_credential, &native_session_id)
                .await?;
        }
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
        emit(
            output,
            "agent_run.started",
            json!({
                "campId": execution.camp_id,
                "campTurnId": execution.camp_turn_id,
                "agentRunId": execution.agent_run_id,
                "agentProfileId": execution.agent_profile_id,
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
        let result = self
            .claude_code_cli
            .run(ClaudeCodeRunRequest {
                agent_run_id: execution.agent_run_id.clone(),
                execution_epoch: execution.execution_epoch,
                workspace: execution.workspace.clone(),
                permission_semantics: execution.permission_semantics,
                runtime: execution.runtime.clone(),
                prompt: prepared_context.rendered_payload,
                resumable_native_session_id: (!is_new_session).then_some(native_session_id.clone()),
                new_native_session_id: is_new_session.then_some(native_session_id.clone()),
                new_session_charter: is_new_session.then_some(prepared_context.charter),
                team_tool: Some(team_tool),
                external_mcp_servers: mcp_projection.servers.clone(),
                attachment_projection_root: Some(attachment_projection_root.to_path_buf()),
                persist_session: true,
            })
            .await;
        let result = match result {
            Ok(result) => result,
            Err(error) => {
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
        if !is_new_session {
            self.bind_prepared_native_session(
                execution,
                &binding_credential,
                &result.native_session_id,
            )
            .await?;
        }
        self.acknowledge_runtime_input(&delivery.id, &result.native_turn_id)
            .await?;
        emit(
            output,
            "agent_run.native_session_bound",
            json!({
                "agentRunId": execution.agent_run_id,
                "executionEpoch": execution.execution_epoch,
                "adapterKind": execution.runtime.adapter_kind,
                "nativeThreadId": result.native_session_id,
                "nativeTurnId": result.native_turn_id,
            }),
        );
        self.complete_one_shot_agent_run(
            execution,
            &result.native_turn_id,
            &result.final_output,
            output,
        )
        .await
    }

    async fn complete_one_shot_agent_run(
        &self,
        execution: &AgentRunExecution,
        native_turn_id: &str,
        final_output: &str,
        output: &mpsc::UnboundedSender<String>,
    ) -> Result<()> {
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
                return Ok(());
            };
            let ending_git_observation = self
                .observe_run_git(&current.project_binding_kind, &current.project_path)
                .await;
            let terminal = {
                let mut database = self.database.lock().await;
                ExecutionRuntimeService::default().succeed_agent_run(
                    &mut database,
                    &CommandEnvelope {
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
                            ending_git_observation,
                        },
                    },
                )
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

    async fn launch_antigravity_agent_run(
        &self,
        execution: &AgentRunExecution,
        resume_disposition: NativeSessionResumeDisposition,
        skill_exposure: &PreparedSkillExposure,
        mcp_projection: &PreparedMcpProjection,
        attachment_projection_root: &Path,
        output: &mpsc::UnboundedSender<String>,
    ) -> Result<()> {
        let execution_root = PathBuf::from(&execution.workspace.execution_root);
        if !execution_root.is_dir() {
            anyhow::bail!(
                "AgentRun execution directory no longer exists: {}",
                execution_root.display()
            );
        }
        let binding_credential = {
            let mut database = self.database.lock().await;
            TeamToolService::default().prepare_native_binding_credential(
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
        let prompt = prepared_context.rendered_payload.clone();
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
                "agentProfileId": execution.agent_profile_id,
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
        let result = self
            .antigravity_app
            .run(AntigravityRunRequest {
                agent_run_id: execution.agent_run_id.clone(),
                execution_epoch: execution.execution_epoch,
                workspace: execution.workspace.clone(),
                permission_semantics: execution.permission_semantics,
                runtime: execution.runtime.clone(),
                prompt,
                resumable_native_session_id: resumable_session_id,
                attachment_projection_root: Some(attachment_projection_root.to_path_buf()),
            })
            .await;
        let result = match result {
            Ok(result) => result,
            Err(error) => {
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

        if let Err(error) = self
            .bind_prepared_native_session(execution, &binding_credential, &result.native_session_id)
            .await
        {
            let mut database = self.database.lock().await;
            ContextService.mark_input_delivery_unknown(
                &mut database,
                &input_delivery.id,
                &format!("Native Session binding failed after Antigravity execution: {error:#}"),
            )?;
            return Err(error);
        }
        self.acknowledge_runtime_input(&input_delivery.id, &result.native_turn_id)
            .await?;
        emit(
            output,
            "agent_run.native_session_bound",
            json!({
                "agentRunId": execution.agent_run_id,
                "executionEpoch": execution.execution_epoch,
                "adapterKind": execution.runtime.adapter_kind,
                "nativeThreadId": result.native_session_id,
                "nativeTurnId": result.native_turn_id,
            }),
        );

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
                return Ok(());
            };
            let ending_git_observation = self
                .observe_run_git(&current.project_binding_kind, &current.project_path)
                .await;
            let terminal = {
                let mut database = self.database.lock().await;
                ExecutionRuntimeService::default().succeed_agent_run(
                    &mut database,
                    &CommandEnvelope {
                        command_id: uuid::Uuid::new_v4().to_string(),
                        actor: ActorRef::System {
                            component_id: "runtime-adapter:antigravity-app".to_string(),
                        },
                        camp_id: Some(current.camp_id.clone()),
                        expected_versions: Vec::new(),
                        execution_epoch: None,
                        payload: SucceedAgentRunCommand {
                            agent_run_id: current.agent_run_id.clone(),
                            expected_version: current.version,
                            execution_epoch: current.execution_epoch,
                            native_turn_id: result.native_turn_id.clone(),
                            final_output: result.final_output.clone(),
                            ending_git_observation,
                        },
                    },
                )
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
                "Antigravity AgentRun completion was rejected: {}",
                terminal.result.code
            );
        }
        anyhow::bail!("Antigravity AgentRun completion did not converge")
    }

    async fn launch_acp_agent_run(
        &self,
        execution: &AgentRunExecution,
        resume_disposition: NativeSessionResumeDisposition,
        skill_exposure: &PreparedSkillExposure,
        mcp_projection: &PreparedMcpProjection,
        attachment_projection_root: &Path,
        output: &mpsc::UnboundedSender<String>,
    ) -> Result<()> {
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
        let (initial_binding, initial_team_tool) = self
            .prepare_team_tool_runtime(
                execution,
                resume_disposition == NativeSessionResumeDisposition::New
                    && execution.native_session_id.is_some(),
            )
            .await?;
        let mut runtime = adapter
            .ensure_agent_run_runtime(
                &execution.agent_run_id,
                execution.execution_epoch,
                &execution.workspace,
                execution.permission_semantics,
                &execution.runtime,
                Some(&initial_team_tool),
                &mcp_projection.servers,
                &mcp_projection.projection_digest,
                attachment_projection_root,
            )
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
                Some(&initial_team_tool),
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
                let (replacement_binding, replacement_team_tool) =
                    self.prepare_team_tool_runtime(execution, true).await?;
                runtime = adapter
                    .ensure_agent_run_runtime(
                        &execution.agent_run_id,
                        execution.execution_epoch,
                        &execution.workspace,
                        execution.permission_semantics,
                        &execution.runtime,
                        Some(&replacement_team_tool),
                        &mcp_projection.servers,
                        &mcp_projection.projection_digest,
                        attachment_projection_root,
                    )
                    .await?;
                let session_id = runtime
                    .start_or_resume_session(
                        None,
                        supports_load,
                        model,
                        &execution.runtime.model.options,
                        Some(&replacement_team_tool),
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
            .await?;
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
            adapter
                .forget_agent_run(&execution.agent_run_id, execution.execution_epoch)
                .await;
            return Ok(());
        };
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
            emit(
                output,
                "agent_run.input_resumed",
                json!({
                    "campId": execution.camp_id,
                    "campTurnId": execution.camp_turn_id,
                    "agentRunId": execution.agent_run_id,
                    "agentProfileId": execution.agent_profile_id,
                    "executionEpoch": execution.execution_epoch,
                    "adapterKind": execution.runtime.adapter_kind,
                    "nativeThreadId": session_id,
                    "nativeTurnId": delivery.native_input_id,
                    "contextManifestId": prepared_context.manifest_id,
                }),
            );
            return Ok(());
        }
        if delivery.status != "prepared" {
            anyhow::bail!("Runtime Input Delivery is not ready to send");
        }
        let native_prompt_id = match runtime
            .start_prompt(&prepared_context.rendered_payload)
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
        self.acknowledge_runtime_input(&delivery.id, &native_prompt_id)
            .await?;
        emit(
            output,
            "agent_run.started",
            json!({
                "campId": execution.camp_id,
                "campTurnId": execution.camp_turn_id,
                "agentRunId": execution.agent_run_id,
                "agentProfileId": execution.agent_profile_id,
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
    ) {
        let ending_git_observation = self
            .observe_run_git(&execution.project_binding_kind, &execution.project_path)
            .await;
        let failure = {
            let mut database = self.database.lock().await;
            ExecutionRuntimeService::default().fail_agent_run(
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
                    payload: FailAgentRunCommand {
                        agent_run_id: execution.agent_run_id.clone(),
                        expected_version: execution.version,
                        execution_epoch: execution.execution_epoch,
                        error_code: error_code.to_string(),
                        error_detail: Some(format!("{error:#}")),
                        manual_retry_allowed: true,
                        ending_git_observation,
                    },
                },
            )
        };
        if let Err(failure_error) = failure {
            eprintln!(
                "failed to persist AgentRun {} launch failure: {failure_error:#}",
                execution.agent_run_id
            );
        }
        match execution.runtime.adapter_kind {
            rovai_core::agent_profile::AdapterKind::CodexCli => {
                if let Some(runtime) = self
                    .codex_cli
                    .get_agent_run(&execution.agent_run_id, execution.execution_epoch)
                    .await
                {
                    runtime.shutdown().await;
                }
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
            ExecutionRuntimeService::default().fail_agent_run(
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
        if let Err(failure_error) = failure {
            eprintln!(
                "failed to close malformed AgentRun {}: {failure_error:#}",
                candidate.agent_run_id
            );
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
            user_id: "local-user".to_string(),
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
            user_id: "local-user".to_string(),
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
    });
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
    if std::env::args().nth(1).as_deref() == Some("team-mcp-bridge") {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .context("failed to create Team MCP bridge Tokio Runtime")?;
        return runtime.block_on(run_team_mcp_bridge(TeamMcpBridgeConfig::from_environment()?));
    }
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
    let mut database = Database::open(&data_dir)?;
    let search_summary = runtime_search_environment.summary();
    database.record_runtime_search_environment_generation(
        search_summary.generation,
        &search_summary.created_at,
    )?;
    let skill_library = SkillLibraryService::new(SkillLibraryService::default_root()?)?;
    let mcp_config = McpConfigStore::new(McpConfigStore::default_path()?);
    let mcp_projection = McpProjectionService::new(&data_dir);
    skill_library.cleanup_expired_staging()?;
    skill_library.install_bundled_skills(&mut database)?;
    skill_library.cleanup_orphan_revisions(&database)?;
    SkillProjectionReconciler.reconcile_known_roots(&mut database, &skill_library)?;
    mcp_projection.cleanup_terminal_and_orphaned(&database)?;
    let v2_recovery = database.prepare_v2_recovery()?;
    if v2_recovery.runs_waiting_for_recovery != 0
        || v2_recovery.actions_returned_to_prepared != 0
        || v2_recovery.actions_marked_unknown != 0
        || v2_recovery.intercepted_actions_failed_closed != 0
        || v2_recovery.action_approvals_cancelled != 0
        || v2_recovery.deliveries_returned_to_pending != 0
        || v2_recovery.authorization_deliveries_failed_closed != 0
        || v2_recovery.input_deliveries_marked_unknown != 0
        || v2_recovery.compaction_attempts_requeued != 0
    {
        eprintln!(
            "v0.02 recovery prepared: {}",
            serde_json::to_string(&v2_recovery)?
        );
    }
    let (codex_tx, codex_rx) = mpsc::unbounded_channel();
    let (acp_tx, acp_rx) = mpsc::unbounded_channel();
    let (output_tx, output_rx) = mpsc::unbounded_channel();
    let output_handle = tokio::spawn(write_output(output_rx));
    let (event_shutdown_tx, event_shutdown_rx) = oneshot::channel();
    let antigravity_app = AntigravityAppRuntimeAdapter::new(&data_dir)?;
    let claude_code_cli = ClaudeCodeCliRuntimeAdapter::new(&data_dir)?;
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
        runtime_resolution_notify: Notify::new(),
        agent_run_cancellation_notify: Notify::new(),
        pending_execution_recovery: Mutex::new(()),
        skill_library,
        mcp_config,
        mcp_projection,
        codex_cli: CodexCliRuntimeAdapter::new(codex_tx),
        opencode_cli: AcpCliRuntimeAdapter::new(
            rovai_core::agent_profile::AdapterKind::OpencodeCli,
            acp_tx.clone(),
            data_dir.join("runtime/opencode"),
        )?,
        copilot_cli: AcpCliRuntimeAdapter::new(
            rovai_core::agent_profile::AdapterKind::CopilotCli,
            acp_tx.clone(),
            data_dir.join("runtime/copilot"),
        )?,
        kiro_cli: AcpCliRuntimeAdapter::new(
            rovai_core::agent_profile::AdapterKind::KiroCli,
            acp_tx.clone(),
            data_dir.join("runtime/kiro"),
        )?,
        qoder_cli: AcpCliRuntimeAdapter::new(
            rovai_core::agent_profile::AdapterKind::QoderCli,
            acp_tx.clone(),
            data_dir.join("runtime/qoder"),
        )?,
        codebuddy_cli: AcpCliRuntimeAdapter::new(
            rovai_core::agent_profile::AdapterKind::CodebuddyCli,
            acp_tx.clone(),
            data_dir.join("runtime/codebuddy"),
        )?,
        qwen_code: AcpCliRuntimeAdapter::new(
            rovai_core::agent_profile::AdapterKind::QwenCode,
            acp_tx,
            data_dir.join("runtime/qwen"),
        )?,
        claude_code_cli,
        antigravity_app,
        data_dir,
    });
    let (team_tool_shutdown_tx, team_tool_shutdown_rx) = oneshot::channel();
    let team_tool_socket = team_tool_socket_path(&core.data_dir);
    let team_tool_listener = bind_team_tool_listener(&team_tool_socket)?;
    let team_tool_handle = tokio::spawn(serve_team_tool_ipc(
        core.clone(),
        team_tool_listener,
        team_tool_socket,
        team_tool_shutdown_rx,
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
    let scheduler_handle = tokio::spawn(process_agent_run_scheduler(
        core.clone(),
        output_tx.clone(),
        scheduler_shutdown_rx,
    ));

    eprintln!("rovai-core {} ready", env!("CARGO_PKG_VERSION"));
    let runtime_discovery_core = core.clone();
    tokio::spawn(async move {
        runtime_discovery_core.run_runtime_discovery().await;
        runtime_discovery_core
            .refresh_registered_runtimes_after_discovery()
            .await;
        runtime_discovery_core
            .recover_pending_execution_intents()
            .await;
    });

    let stdin = BufReader::new(tokio::io::stdin());
    let mut lines = stdin.lines();
    let mut background_requests = tokio::task::JoinSet::new();

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

    background_requests.abort_all();
    while background_requests.join_next().await.is_some() {}
    let _ = scheduler_shutdown_tx.send(());
    let _ = scheduler_handle.await;
    let _ = team_tool_shutdown_tx.send(());
    let _ = team_tool_handle.await;
    let _ = event_shutdown_tx.send(());
    let _ = event_handle.await;
    let _ = acp_shutdown_tx.send(());
    let _ = acp_event_handle.await;
    core.codex_cli.shutdown_all().await;
    core.opencode_cli.shutdown_all().await;
    core.copilot_cli.shutdown_all().await;
    core.claude_code_cli.shutdown_all().await;
    core.antigravity_app.shutdown_all().await;
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
        match incoming {
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
            core.fail_claimed_agent_run(&execution, "action_audit_failed", &error)
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
        Some("agent_message_chunk") => (
            "agent.text.delta",
            json!({
                "delta": update.pointer("/content/text").and_then(Value::as_str).unwrap_or(""),
                "sessionId": params.get("sessionId"),
            }),
        ),
        Some("agent_thought_chunk") => ("agent.thought.delta", update),
        Some("tool_call") | Some("tool_call_update") => (
            "runtime.action",
            json!({
                "sessionUpdate": update.get("sessionUpdate"),
                "toolCallId": update.get("toolCallId"),
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
                    agent_profile_id: execution.agent_profile_id.clone(),
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
                    requested_for_user_id: "local-user".to_string(),
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
                        agent_profile_id: execution.agent_profile_id.clone(),
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
                ExecutionRuntimeService::default().succeed_agent_run(
                    &mut database,
                    &CommandEnvelope {
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
                            ending_git_observation: ending_git_observation.clone(),
                        },
                    },
                )
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
                runtime.shutdown().await;
                if let Some(adapter) = core.acp_adapter(adapter_kind) {
                    adapter
                        .forget_agent_run(agent_run_id, execution_epoch)
                        .await;
                }
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
    let final_agent_message = match completed.final_agent_message.clone() {
        Some(message) => Some(message),
        None => runtime.final_agent_message().await,
    };
    let mut terminal_persisted = false;
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
                ExecutionRuntimeService::default().succeed_agent_run(
                    &mut database,
                    &CommandEnvelope {
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
                            ending_git_observation: ending_git_observation.clone(),
                        },
                    },
                )
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
                        error_detail: Some(format!(
                            "Codex Native Turn {} ended as {}",
                            completed.turn_id, completed.status
                        )),
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
    runtime.clear_turn(Some(&completed.turn_id)).await;
    runtime.shutdown().await;
    core.codex_cli
        .forget_agent_run(agent_run_id, execution_epoch)
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
                    agent_profile_id: execution.agent_profile_id.clone(),
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
                    requested_for_user_id: "local-user".to_string(),
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
    let mut skill_interval = tokio::time::interval_at(
        tokio::time::Instant::now() + Duration::from_secs(30),
        Duration::from_secs(30),
    );
    skill_interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut pending_execution_interval = tokio::time::interval_at(
        tokio::time::Instant::now() + Duration::from_secs(15),
        Duration::from_secs(15),
    );
    pending_execution_interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            _ = interval.tick() => {
                core.dispatch_runtime_deliveries(&output).await;
                core.dispatch_agent_run_cancellations(&output).await;
                core.dispatch_context_compactions().await;
                core.dispatch_agent_runs(&output).await;
            },
            _ = core.agent_run_cancellation_notify.notified() => {
                core.dispatch_agent_run_cancellations(&output).await;
            },
            _ = skill_interval.tick() => {
                core.reconcile_skills_periodically().await;
                core.cleanup_mcp_projections_best_effort().await;
            },
            _ = pending_execution_interval.tick() => {
                core.recover_pending_execution_intents().await;
            },
            _ = &mut shutdown => break,
        }
    }
}

struct RemoveDirectoryOnDrop(PathBuf);

impl Drop for RemoveDirectoryOnDrop {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
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

impl TeamMcpBridgeConfig {
    fn from_environment() -> Result<Self> {
        let core_socket = std::env::var_os("ROVAI_TEAM_CORE_SOCKET")
            .or_else(|| std::env::var_os("HORIZONWARD_TEAM_CORE_SOCKET"))
            .or_else(|| std::env::var_os("LUMEN_TEAM_CORE_SOCKET"))
            .map(PathBuf::from)
            .context("ROVAI_TEAM_CORE_SOCKET is required for team-mcp-bridge")?;
        let native_binding_id = std::env::var("ROVAI_TEAM_NATIVE_BINDING_ID")
            .or_else(|_| std::env::var("HORIZONWARD_TEAM_NATIVE_BINDING_ID"))
            .or_else(|_| std::env::var("LUMEN_TEAM_NATIVE_BINDING_ID"))
            .context("ROVAI_TEAM_NATIVE_BINDING_ID is required for team-mcp-bridge")?;
        let binding_credential = std::env::var("ROVAI_TEAM_BINDING_CREDENTIAL")
            .or_else(|_| std::env::var("HORIZONWARD_TEAM_BINDING_CREDENTIAL"))
            .or_else(|_| std::env::var("LUMEN_TEAM_BINDING_CREDENTIAL"))
            .context("ROVAI_TEAM_BINDING_CREDENTIAL is required for team-mcp-bridge")?;
        if native_binding_id.trim().is_empty() || binding_credential.trim().is_empty() {
            anyhow::bail!("Team MCP Bridge binding environment must not be empty");
        }
        Ok(Self {
            core_socket,
            native_binding_id,
            binding_credential,
        })
    }
}

fn team_tool_socket_path(_data_dir: &Path) -> PathBuf {
    // macOS limits sockaddr_un paths to roughly one hundred bytes. Application
    // Support paths can exceed that before the socket name is appended, so the
    // private endpoint uses a short per-process directory instead.
    PathBuf::from("/tmp")
        .join(format!("rovai-team-{}", std::process::id()))
        .join("core.sock")
}

fn bind_team_tool_listener(socket_path: &Path) -> Result<UnixListener> {
    let directory = socket_path
        .parent()
        .context("Team Tool socket path has no parent directory")?;
    std::fs::create_dir_all(directory).with_context(|| {
        format!(
            "failed to create private Team Tool directory {}",
            directory.display()
        )
    })?;
    restrict_private_directory(directory)?;
    if socket_path.exists() {
        std::fs::remove_file(socket_path).with_context(|| {
            format!(
                "failed to remove stale Team Tool socket {}",
                socket_path.display()
            )
        })?;
    }
    let listener = UnixListener::bind(socket_path).with_context(|| {
        format!(
            "failed to bind private Team Tool socket {}",
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

async fn serve_team_tool_ipc(
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
                eprintln!("Team Tool IPC accept failed: {error:#}");
                continue;
            }
        };
        let core = core.clone();
        tokio::spawn(async move {
            if let Err(error) = handle_team_tool_connection(core, stream).await {
                eprintln!("Team Tool IPC request failed: {error:#}");
            }
        });
    }
    drop(listener);
    let _ = std::fs::remove_file(socket_path);
}

async fn handle_team_tool_connection(core: Arc<Core>, stream: UnixStream) -> Result<()> {
    let (reader, mut writer) = stream.into_split();
    let mut lines = BufReader::new(reader).lines();
    let response = match lines.next_line().await? {
        Some(line) if line.len() <= 128 * 1024 => {
            match serde_json::from_str::<TeamToolIpcRequest>(&line) {
                Ok(request) => core.handle_team_tool_ipc(request).await,
                Err(_) => TeamToolIpcResponse {
                    result: None,
                    error: Some(TeamToolIpcError {
                        code: "team_tool.invalid_ipc_request".to_string(),
                        message: "Private Team Tool request is malformed".to_string(),
                    }),
                },
            }
        }
        Some(_) => TeamToolIpcResponse {
            result: None,
            error: Some(TeamToolIpcError {
                code: "team_tool.ipc_request_too_large".to_string(),
                message: "Private Team Tool request exceeds 128 KiB".to_string(),
            }),
        },
        None => return Ok(()),
    };
    writer
        .write_all(serde_json::to_string(&response)?.as_bytes())
        .await?;
    writer.write_all(b"\n").await?;
    writer.shutdown().await?;
    Ok(())
}

async fn run_team_mcp_bridge(config: TeamMcpBridgeConfig) -> Result<()> {
    let stdin = BufReader::new(tokio::io::stdin());
    let mut lines = stdin.lines();
    let mut output = BufWriter::new(tokio::io::stdout());
    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        let request = match serde_json::from_str::<Value>(&line) {
            Ok(request) => request,
            Err(_) => {
                write_mcp_response(
                    &mut output,
                    &json!({
                        "jsonrpc": "2.0",
                        "id": null,
                        "error": {"code": -32700, "message": "Parse error"}
                    }),
                )
                .await?;
                continue;
            }
        };
        if let Some(response) = handle_team_mcp_request(&config, &request).await {
            write_mcp_response(&mut output, &response).await?;
        }
    }
    output.flush().await?;
    Ok(())
}

async fn handle_team_mcp_request(config: &TeamMcpBridgeConfig, request: &Value) -> Option<Value> {
    let id = request.get("id").cloned()?;
    let method = request.get("method").and_then(Value::as_str);
    let result = match method {
        Some("initialize") => Ok(json!({
            "protocolVersion": request
                .pointer("/params/protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or("2025-06-18"),
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": { "name": "rovai-team-tool", "version": env!("CARGO_PKG_VERSION") },
            "instructions": "Rovai-ai Team tools provide private A2A execution requests and durable Camp Task management. A Task mutation never wakes its assignee."
        })),
        Some("ping") => Ok(json!({})),
        Some("tools/list") => Ok(json!({ "tools": [
            {
                "name": TEAM_POST_MESSAGE_TOOL_NAME,
                "title": "Request work from a Camp member",
                "description": "Send a private execution request to another active Agent in the same Camp and queue one asynchronous AgentRun. Success means queued, not completed.",
                "inputSchema": TeamToolService::input_schema(),
                "outputSchema": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["rovaiTeamTool", "rovaiTeamReceipt", "inboxMessageId", "targetAgentRunId", "correlationId", "a2aDepth", "remainingA2aHops", "remainingTurnA2aRuns", "status"],
                    "properties": {
                        "rovaiTeamTool": {"const": TEAM_POST_MESSAGE_TOOL_NAME},
                        "rovaiTeamReceipt": {"type": "string"},
                        "inboxMessageId": {"type": "string"},
                        "targetAgentRunId": {"type": "string"},
                        "correlationId": {"type": "string"},
                        "a2aDepth": {"type": "integer"},
                        "remainingA2aHops": {"type": "integer"},
                        "remainingTurnA2aRuns": {"type": "integer"},
                        "depthWarning": {"type": ["boolean", "null"]},
                        "turnQuotaWarning": {"type": ["boolean", "null"]},
                        "status": {"const": "queued"}
                    }
                }
            },
            {
                "name": TEAM_CREATE_TASK_TOOL_NAME,
                "title": "Create a durable Camp Task",
                "description": "Create a long-lived responsibility. Assignment records ownership but does not notify or wake the assignee.",
                "inputSchema": TeamToolService::create_task_input_schema(),
                "outputSchema": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["rovaiTeamTool", "rovaiTeamReceipt", "taskId", "status", "version"],
                    "properties": {
                        "rovaiTeamTool": {"const": TEAM_CREATE_TASK_TOOL_NAME},
                        "rovaiTeamReceipt": {"type": "string"},
                        "taskId": {"type": "string"},
                        "status": {"const": "pending"},
                        "version": {"type": "integer"}
                    }
                }
            },
            {
                "name": TEAM_UPDATE_TASK_TOOL_NAME,
                "title": "Update a durable Camp Task",
                "description": "Atomically edit an authorized non-terminal Task using its current version. A successful update does not wake an assignee.",
                "inputSchema": TeamToolService::update_task_input_schema(),
                "outputSchema": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["rovaiTeamTool", "rovaiTeamReceipt", "taskId", "status", "assigneeAgentId", "version"],
                    "properties": {
                        "rovaiTeamTool": {"const": TEAM_UPDATE_TASK_TOOL_NAME},
                        "rovaiTeamReceipt": {"type": "string"},
                        "taskId": {"type": "string"},
                        "status": {"type": "string", "enum": ["pending", "in_progress", "completed", "cancelled"]},
                        "assigneeAgentId": {"type": ["string", "null"]},
                        "version": {"type": "integer"}
                    }
                }
            },
            {
                "name": TEAM_LIST_TASKS_TOOL_NAME,
                "title": "List visible Camp Tasks",
                "description": "Read Tasks visible to the current Agent. Lead sees all; other members see their own and unassigned Tasks.",
                "inputSchema": TeamToolService::list_tasks_input_schema(),
                "outputSchema": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["rovaiTeamTool", "rovaiTeamReceipt", "tasks", "nextCursor", "truncated"],
                    "properties": {
                        "rovaiTeamTool": {"const": TEAM_LIST_TASKS_TOOL_NAME},
                        "rovaiTeamReceipt": {"type": "string"},
                        "tasks": {"type": "array", "items": {"type": "object"}},
                        "nextCursor": {"type": ["string", "null"]},
                        "truncated": {"type": "boolean"}
                    }
                }
            },
            {
                "name": CONTEXT_SEARCH_TOOL_NAME,
                "title": "Search frozen Camp context",
                "description": "Search public Camp messages and shared summaries without crossing this AgentRun's frozen message boundary.",
                "inputSchema": ContextRetrievalService::search_input_schema(),
                "outputSchema": {
                    "type": "object",
                    "required": ["rovaiTeamTool", "rovaiTeamReceipt", "results", "truncated", "boundarySequence"],
                    "properties": {
                        "rovaiTeamTool": {"const": CONTEXT_SEARCH_TOOL_NAME},
                        "rovaiTeamReceipt": {"type": "string"},
                        "results": {"type": "array"},
                        "truncated": {"type": "boolean"},
                        "boundarySequence": {"type": "integer"}
                    }
                }
            },
            {
                "name": CONTEXT_GET_MESSAGE_TOOL_NAME,
                "title": "Read one frozen Camp message",
                "description": "Read one visible public Camp message, with a bounded body slice and attachment metadata.",
                "inputSchema": ContextRetrievalService::get_message_input_schema(),
                "outputSchema": {
                    "type": "object",
                    "required": ["rovaiTeamTool", "rovaiTeamReceipt", "messageId", "sequence", "body", "bodyLength", "bodyTruncated"],
                    "properties": {
                        "rovaiTeamTool": {"const": CONTEXT_GET_MESSAGE_TOOL_NAME},
                        "rovaiTeamReceipt": {"type": "string"},
                        "messageId": {"type": "string"},
                        "sequence": {"type": "integer"},
                        "body": {"type": "string"},
                        "bodyLength": {"type": "integer"},
                        "bodyTruncated": {"type": "boolean"}
                    }
                }
            },
            {
                "name": CONTEXT_GET_MESSAGE_WINDOW_TOOL_NAME,
                "title": "Read a frozen message window",
                "description": "Read the bounded chronological neighborhood around one visible Camp message.",
                "inputSchema": ContextRetrievalService::get_message_window_input_schema(),
                "outputSchema": {
                    "type": "object",
                    "required": ["rovaiTeamTool", "rovaiTeamReceipt", "messages", "truncated", "boundarySequence"],
                    "properties": {
                        "rovaiTeamTool": {"const": CONTEXT_GET_MESSAGE_WINDOW_TOOL_NAME},
                        "rovaiTeamReceipt": {"type": "string"},
                        "messages": {"type": "array"},
                        "truncated": {"type": "boolean"},
                        "boundarySequence": {"type": "integer"}
                    }
                }
            },
            {
                "name": CONTEXT_GET_MESSAGE_THREAD_TOOL_NAME,
                "title": "Read a frozen reply thread",
                "description": "Read a visible Camp root message and its visible recursive replies in sequence order.",
                "inputSchema": ContextRetrievalService::get_message_thread_input_schema(),
                "outputSchema": {
                    "type": "object",
                    "required": ["rovaiTeamTool", "rovaiTeamReceipt", "messages", "truncated", "boundarySequence"],
                    "properties": {
                        "rovaiTeamTool": {"const": CONTEXT_GET_MESSAGE_THREAD_TOOL_NAME},
                        "rovaiTeamReceipt": {"type": "string"},
                        "messages": {"type": "array"},
                        "truncated": {"type": "boolean"},
                        "boundarySequence": {"type": "integer"}
                    }
                }
            },
            {
                "name": CONTEXT_GET_SUMMARY_TOOL_NAME,
                "title": "Read one frozen Camp summary",
                "description": "Read a Segment or Epoch only when its full coverage range ends at or before this AgentRun's boundary.",
                "inputSchema": ContextRetrievalService::get_summary_input_schema(),
                "outputSchema": {
                    "type": "object",
                    "required": ["rovaiTeamTool", "rovaiTeamReceipt", "summaryId", "level", "fromSequence", "throughSequence", "body"],
                    "properties": {
                        "rovaiTeamTool": {"const": CONTEXT_GET_SUMMARY_TOOL_NAME},
                        "rovaiTeamReceipt": {"type": "string"},
                        "summaryId": {"type": "string"},
                        "level": {"type": "string", "enum": ["segment", "epoch"]},
                        "fromSequence": {"type": "integer"},
                        "throughSequence": {"type": "integer"},
                        "body": {"type": "string"}
                    }
                }
            },
            {
                "name": MEMORY_SEARCH_TOOL_NAME,
                "title": "Search current Memory",
                "description": "Search active Memory that is currently accessible to this Agent. Results are discovery hints and do not include full bodies.",
                "inputSchema": MemoryRetrievalService::search_input_schema(),
                "outputSchema": {
                    "type": "object",
                    "required": ["rovaiTeamTool", "rovaiTeamReceipt", "results"],
                    "properties": {
                        "rovaiTeamTool": {"const": MEMORY_SEARCH_TOOL_NAME},
                        "rovaiTeamReceipt": {"type": "string"},
                        "results": {"type": "array"}
                    }
                }
            },
            {
                "name": MEMORY_READ_TOOL_NAME,
                "title": "Read current Memory",
                "description": "Resolve stable Memory IDs against current Revision, lifecycle, Camp access, and Presence. Stale/deleted results never return old bodies.",
                "inputSchema": MemoryRetrievalService::read_input_schema(),
                "outputSchema": {
                    "type": "object",
                    "required": ["rovaiTeamTool", "rovaiTeamReceipt", "memories"],
                    "properties": {
                        "rovaiTeamTool": {"const": MEMORY_READ_TOOL_NAME},
                        "rovaiTeamReceipt": {"type": "string"},
                        "memories": {"type": "array"}
                    }
                }
            },
            {
                "name": MEMORY_WRITE_TOOL_NAME,
                "title": "Write active partner Memory",
                "description": "Add an active Companion/Relationship Memory or publish a Revision to an accessible one. Hearth is not writable through this tool.",
                "inputSchema": MemoryToolService::write_input_schema(),
                "outputSchema": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["rovaiTeamTool", "rovaiTeamReceipt", "action", "memoryId", "revisionId", "effective"],
                    "properties": {
                        "rovaiTeamTool": {"const": MEMORY_WRITE_TOOL_NAME},
                        "rovaiTeamReceipt": {"type": "string"},
                        "action": {"type": "string", "enum": ["add", "revise"]},
                        "memoryId": {"type": "string"},
                        "revisionId": {"type": "string"},
                        "effective": {"const": true}
                    }
                }
            },
            {
                "name": MEMORY_PROPOSE_HEARTH_TOOL_NAME,
                "title": "Propose Hearth Memory",
                "description": "Submit one Hearth add or revise proposal. It is not effective until the user accepts it.",
                "inputSchema": MemoryToolService::propose_hearth_input_schema(),
                "outputSchema": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["rovaiTeamTool", "rovaiTeamReceipt", "proposalId", "status", "effective"],
                    "properties": {
                        "rovaiTeamTool": {"const": MEMORY_PROPOSE_HEARTH_TOOL_NAME},
                        "rovaiTeamReceipt": {"type": "string"},
                        "proposalId": {"type": "string"},
                        "status": {"const": "pending"},
                        "effective": {"const": false}
                    }
                }
            }
        ] })),
        Some("tools/call") => {
            let tool_name = request
                .pointer("/params/name")
                .and_then(Value::as_str)
                .unwrap_or_default();
            match call_team_tool(config, request).await {
                Ok(result) => sign_team_tool_structured_content(config, tool_name, result)
                    .map(|result| json!({
                        "content": [{
                            "type": "text",
                            "text": serde_json::to_string(&result).unwrap_or_else(|_| "Team request queued".to_string())
                        }],
                        "structuredContent": result,
                        "isError": false
                    }))
                    .map_err(|_| (-32603, "Team Tool receipt generation failed")),
                Err(error) => {
                    let error_text = format!("{}: {}", error.code, error.message);
                    let structured_content = json!({
                        "rovaiTeamTool": tool_name,
                        "errorCode": error.code
                    });
                    sign_team_tool_structured_content(config, tool_name, structured_content)
                        .map(|structured_content| json!({
                            "content": [{
                                "type": "text",
                                "text": error_text
                            }],
                            "structuredContent": structured_content,
                            "isError": true
                        }))
                        .map_err(|_| (-32603, "Team Tool receipt generation failed"))
                }
            }
        }
        Some(_) => Err((-32601, "Method not found")),
        None => Err((-32600, "Invalid Request")),
    };
    Some(match result {
        Ok(result) => json!({"jsonrpc": "2.0", "id": id, "result": result}),
        Err((code, message)) => {
            json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}})
        }
    })
}

fn sign_team_tool_structured_content(
    config: &TeamMcpBridgeConfig,
    tool_name: &str,
    mut structured_content: Value,
) -> Result<Value> {
    structured_content
        .as_object_mut()
        .context("Team Tool structured content must be an object")?
        .insert(
            "rovaiTeamTool".to_string(),
            Value::String(tool_name.to_string()),
        );
    let audit_key = team_tool_completion_audit_key(&config.binding_credential)?;
    let receipt = team_tool_completion_receipt(&audit_key, &structured_content)?;
    structured_content["rovaiTeamReceipt"] = Value::String(receipt);
    Ok(structured_content)
}

async fn call_team_tool(
    config: &TeamMcpBridgeConfig,
    request: &Value,
) -> std::result::Result<Value, TeamToolIpcError> {
    let name = request
        .pointer("/params/name")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let input = request
        .pointer("/params/arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let valid = match name {
        TEAM_POST_MESSAGE_TOOL_NAME => {
            serde_json::from_value::<TeamPostMessageInput>(input.clone()).map(|_| ())
        }
        TEAM_CREATE_TASK_TOOL_NAME => {
            serde_json::from_value::<TeamCreateTaskInput>(input.clone()).map(|_| ())
        }
        TEAM_UPDATE_TASK_TOOL_NAME => {
            serde_json::from_value::<TeamUpdateTaskInput>(input.clone()).map(|_| ())
        }
        TEAM_LIST_TASKS_TOOL_NAME => {
            serde_json::from_value::<TeamListTasksInput>(input.clone()).map(|_| ())
        }
        MEMORY_WRITE_TOOL_NAME => {
            serde_json::from_value::<MemoryWriteToolInput>(input.clone()).map(|_| ())
        }
        MEMORY_PROPOSE_HEARTH_TOOL_NAME => {
            serde_json::from_value::<HearthProposalToolInput>(input.clone()).map(|_| ())
        }
        MEMORY_SEARCH_TOOL_NAME => {
            serde_json::from_value::<MemorySearchInput>(input.clone()).map(|_| ())
        }
        MEMORY_READ_TOOL_NAME => {
            serde_json::from_value::<MemoryReadInput>(input.clone()).map(|_| ())
        }
        CONTEXT_SEARCH_TOOL_NAME => {
            serde_json::from_value::<ContextSearchInput>(input.clone()).map(|_| ())
        }
        CONTEXT_GET_MESSAGE_TOOL_NAME => {
            serde_json::from_value::<ContextGetMessageInput>(input.clone()).map(|_| ())
        }
        CONTEXT_GET_MESSAGE_WINDOW_TOOL_NAME => {
            serde_json::from_value::<ContextGetMessageWindowInput>(input.clone()).map(|_| ())
        }
        CONTEXT_GET_MESSAGE_THREAD_TOOL_NAME => {
            serde_json::from_value::<ContextGetMessageThreadInput>(input.clone()).map(|_| ())
        }
        CONTEXT_GET_SUMMARY_TOOL_NAME => {
            serde_json::from_value::<ContextGetSummaryInput>(input.clone()).map(|_| ())
        }
        _ => {
            return Err(TeamToolIpcError {
                code: "team_tool.unknown_tool".to_string(),
                message: "Requested Team Tool is unavailable".to_string(),
            });
        }
    };
    valid.map_err(|_| TeamToolIpcError {
        code: "team_tool.invalid_input".to_string(),
        message: format!("{name} arguments do not match the narrow Tool schema"),
    })?;
    let request_id = request.get("id").cloned().unwrap_or(Value::Null);
    let call_digest = canonical_json_digest(&request_id).map_err(|_| TeamToolIpcError {
        code: "team_tool.invalid_tool_call_id".to_string(),
        message: "Runtime Tool Call ID could not be normalized".to_string(),
    })?;
    let ipc_request = TeamToolIpcRequest {
        native_binding_id: config.native_binding_id.clone(),
        binding_credential: config.binding_credential.clone(),
        runtime_tool_call_id: format!("mcp-jsonrpc:{call_digest}"),
        tool_name: name.to_string(),
        input,
    };
    let mut stream = UnixStream::connect(&config.core_socket)
        .await
        .map_err(|_| TeamToolIpcError {
            code: "team_tool.core_unavailable".to_string(),
            message: "Rovai-ai Core Team Tool endpoint is unavailable".to_string(),
        })?;
    let serialized = serde_json::to_string(&ipc_request).map_err(|_| TeamToolIpcError {
        code: "team_tool.invalid_ipc_request".to_string(),
        message: "Team Tool request could not be encoded".to_string(),
    })?;
    stream
        .write_all(serialized.as_bytes())
        .await
        .map_err(|_| TeamToolIpcError {
            code: "team_tool.core_unavailable".to_string(),
            message: "Rovai-ai Core did not accept the Team Tool request".to_string(),
        })?;
    stream
        .write_all(b"\n")
        .await
        .map_err(|_| TeamToolIpcError {
            code: "team_tool.core_unavailable".to_string(),
            message: "Rovai-ai Core did not accept the Team Tool request".to_string(),
        })?;
    let mut lines = BufReader::new(stream).lines();
    let response = lines
        .next_line()
        .await
        .map_err(|_| TeamToolIpcError {
            code: "team_tool.core_unavailable".to_string(),
            message: "Rovai-ai Core Team Tool response was interrupted".to_string(),
        })?
        .ok_or_else(|| TeamToolIpcError {
            code: "team_tool.core_unavailable".to_string(),
            message: "Rovai-ai Core closed the Team Tool connection without a result".to_string(),
        })?;
    let response =
        serde_json::from_str::<TeamToolIpcResponse>(&response).map_err(|_| TeamToolIpcError {
            code: "team_tool.invalid_core_response".to_string(),
            message: "Rovai-ai Core returned a malformed Team Tool response".to_string(),
        })?;
    match (response.result, response.error) {
        (Some(result), None) => Ok(result),
        (None, Some(error)) => Err(error),
        _ => Err(TeamToolIpcError {
            code: "team_tool.invalid_core_response".to_string(),
            message: "Rovai-ai Core returned an ambiguous Team Tool response".to_string(),
        }),
    }
}

async fn write_mcp_response(
    output: &mut BufWriter<tokio::io::Stdout>,
    response: &Value,
) -> Result<()> {
    output
        .write_all(serde_json::to_string(response)?.as_bytes())
        .await?;
    output.write_all(b"\n").await?;
    output.flush().await?;
    Ok(())
}

fn command_rejection_message(payload: &Value) -> String {
    payload
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("Team Tool request was rejected")
        .to_string()
}

fn command_execution_payload(execution: CommandExecution) -> Result<Value> {
    if execution.result.status != CommandResultStatus::Rejected {
        return Ok(execution.result.payload);
    }
    Err(TeamToolInvocationError {
        code: execution.result.code,
        message: command_rejection_message(&execution.result.payload),
    }
    .into())
}

fn parse_data_dir() -> Result<PathBuf> {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--data-dir" {
            return args
                .next()
                .map(PathBuf::from)
                .context("--data-dir requires a path");
        }
    }
    let root = dirs::data_local_dir().context("could not determine a local data directory")?;
    Ok(rovai_core::brand::preferred_or_existing_legacy_paths(
        root.join(rovai_core::brand::PRODUCT_NAME),
        rovai_core::brand::LEGACY_PRODUCT_NAMES.map(|name| root.join(name)),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(
            diagnostic,
            Some(ProductRuntimeDiagnostic {
                status: "authentication_required",
                diagnostic_code: "runtime_authentication_required".to_string(),
                priority: 4,
            })
        );
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
        assert!(request_runs_outside_main_queue(
            "runtime.installations.refresh"
        ));
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

    #[tokio::test]
    async fn team_mcp_bridge_lists_memory_v1_tools_without_identity_fields() {
        let config = TeamMcpBridgeConfig {
            core_socket: PathBuf::from("/tmp/not-used.sock"),
            native_binding_id: uuid::Uuid::new_v4().to_string(),
            binding_credential: "not-used".to_string(),
        };
        let response = handle_team_mcp_request(
            &config,
            &json!({"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}),
        )
        .await
        .unwrap();
        let tools = response["result"]["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 13);
        assert_eq!(
            tools
                .iter()
                .map(|tool| tool["name"].as_str().unwrap())
                .collect::<Vec<_>>(),
            [
                TEAM_POST_MESSAGE_TOOL_NAME,
                TEAM_CREATE_TASK_TOOL_NAME,
                TEAM_UPDATE_TASK_TOOL_NAME,
                TEAM_LIST_TASKS_TOOL_NAME,
                CONTEXT_SEARCH_TOOL_NAME,
                CONTEXT_GET_MESSAGE_TOOL_NAME,
                CONTEXT_GET_MESSAGE_WINDOW_TOOL_NAME,
                CONTEXT_GET_MESSAGE_THREAD_TOOL_NAME,
                CONTEXT_GET_SUMMARY_TOOL_NAME,
                MEMORY_SEARCH_TOOL_NAME,
                MEMORY_READ_TOOL_NAME,
                MEMORY_WRITE_TOOL_NAME,
                MEMORY_PROPOSE_HEARTH_TOOL_NAME,
            ]
        );
        for tool in tools {
            let properties = tool["inputSchema"]["properties"].as_object().unwrap();
            for forbidden in [
                "senderAgentId",
                "campId",
                "sourceAgentRunId",
                "executionEpoch",
                "commandId",
            ] {
                assert!(!properties.contains_key(forbidden));
            }
        }
        assert!(
            !tools[0]["inputSchema"]["properties"]
                .as_object()
                .unwrap()
                .contains_key("taskId")
        );
    }

    #[tokio::test]
    async fn team_mcp_bridge_forwards_binding_privately_and_returns_structured_result() {
        let directory =
            PathBuf::from("/tmp").join(format!("ltt-{}", &uuid::Uuid::new_v4().to_string()[..8]));
        std::fs::create_dir_all(&directory).unwrap();
        let socket = directory.join("core.sock");
        let listener = UnixListener::bind(&socket).unwrap();
        let binding_id = uuid::Uuid::new_v4().to_string();
        let credential = "private-bridge-secret".to_string();
        let expected_binding = binding_id.clone();
        let expected_credential = credential.clone();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let (reader, mut writer) = stream.into_split();
            let mut lines = BufReader::new(reader).lines();
            let line = lines.next_line().await.unwrap().unwrap();
            let request: TeamToolIpcRequest = serde_json::from_str(&line).unwrap();
            assert_eq!(request.native_binding_id, expected_binding);
            assert_eq!(request.binding_credential, expected_credential);
            assert!(request.runtime_tool_call_id.starts_with("mcp-jsonrpc:"));
            assert_eq!(request.tool_name, TEAM_POST_MESSAGE_TOOL_NAME);
            assert_eq!(request.input["recipient"], "agent-muwa");
            assert_eq!(request.input["body"], "Please review this change");
            writer
                .write_all(
                    serde_json::to_string(&TeamToolIpcResponse {
                        result: Some(json!({
                            "inboxMessageId": "inbox-1",
                            "targetAgentRunId": "run-2",
                            "correlationId": "correlation-1",
                            "a2aDepth": 1,
                            "remainingA2aHops": 4,
                            "remainingTurnA2aRuns": 15,
                            "status": "queued"
                        })),
                        error: None,
                    })
                    .unwrap()
                    .as_bytes(),
                )
                .await
                .unwrap();
            writer.write_all(b"\n").await.unwrap();
        });
        let config = TeamMcpBridgeConfig {
            core_socket: socket.clone(),
            native_binding_id: binding_id,
            binding_credential: credential,
        };
        let response = handle_team_mcp_request(
            &config,
            &json!({
                "jsonrpc": "2.0",
                "id": "tool-call-7",
                "method": "tools/call",
                "params": {
                    "name": "team.post_message",
                    "arguments": {
                        "recipient": "agent-muwa",
                        "body": "Please review this change"
                    }
                }
            }),
        )
        .await
        .unwrap();
        server.await.unwrap();
        assert_eq!(response["result"]["isError"], false);
        assert_eq!(
            response["result"]["structuredContent"]["targetAgentRunId"],
            "run-2"
        );
        assert!(
            !serde_json::to_string(&response)
                .unwrap()
                .contains("private-bridge-secret")
        );
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn team_mcp_bridge_rejects_forged_identity_fields_before_core_ipc() {
        let config = TeamMcpBridgeConfig {
            core_socket: PathBuf::from("/tmp/socket-must-not-be-opened"),
            native_binding_id: uuid::Uuid::new_v4().to_string(),
            binding_credential: "secret".to_string(),
        };
        let response = handle_team_mcp_request(
            &config,
            &json!({
                "jsonrpc": "2.0",
                "id": 9,
                "method": "tools/call",
                "params": {
                    "name": "team.post_message",
                    "arguments": {
                        "recipient": "agent-muwa",
                        "body": "Try to forge identity",
                        "senderAgentId": "agent-luoke",
                        "executionEpoch": 99
                    }
                }
            }),
        )
        .await
        .unwrap();
        assert_eq!(response["result"]["isError"], true);
        assert_eq!(
            response["result"]["structuredContent"]["rovaiTeamTool"],
            TEAM_POST_MESSAGE_TOOL_NAME
        );
        assert_eq!(
            response["result"]["structuredContent"]["errorCode"],
            "team_tool.invalid_input"
        );
        assert!(
            response["result"]["content"][0]["text"]
                .as_str()
                .unwrap()
                .contains("team_tool.invalid_input")
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
        assert!(payload["rawInputDigest"].is_string());
        assert!(payload["rawOutputDigest"].is_string());
    }
}
