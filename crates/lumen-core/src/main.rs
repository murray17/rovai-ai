mod acp;
mod antigravity;
mod claude;
mod codex;
mod git;
mod health;
mod team_runtime;

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
};

use acp::{AcpCliRuntimeAdapter, AcpIncoming, AcpRuntime};
use antigravity::{AntigravityAppRuntimeAdapter, AntigravityRunRequest};
use anyhow::{Context, Result};
use claude::{ClaudeCodeCliRuntimeAdapter, ClaudeCodeRunRequest};
use codex::{CodexAgentThreadOptions, CodexCliRuntimeAdapter, CodexIncoming, CodexRuntime};
use lumen_core::{
    action::{
        AcknowledgeRuntimeDeliveryCommand, AcquireRuntimeDeliveryCommand, ActionControlMode,
        ActionResultOutcome, ActionSafetyService, ApprovalDecision, ClaimActionCommand,
        ConfirmRuntimeRequestResolvedCommand, FailRuntimeDeliveryCommand,
        MarkActionDispatchStartedCommand, PrepareActionCommand, ReconcileRuntimeLossCommand,
        RecordActionResultCommand, RecordObservedActionCommand, ResolveActionApprovalCommand,
    },
    agent_profile::{
        AgentProfileService, ClearAgentProfileRuntimeCommand, CreateAdapterInstallationCommand,
        CreateAgentProfileCommand, RecordAdapterCapabilitySnapshotCommand,
        ReorderAgentProfilesCommand, RuntimeReadinessStatus, SetAgentProfileRuntimeCommand,
        SetAgentProfileStatusCommand, UpdateAdapterInstallationCommand, UpdateAgentProfileCommand,
    },
    agent_runtime_adapter::{
        AcpProbeObservation, AgentRuntimeAdapterRegistry, AntigravityProbeObservation,
        ClaudeCodeProbeObservation, CodexProbeObservation,
        executable_fingerprint as fingerprint_executable,
    },
    collaboration::{
        ChangeDefaultLeadCommand, CollaborationService, CreateCampFromFirstMessageCommand,
        CreateTaskCommand, DeleteCampCommand, ExecutionRequest, MessageAddressSpec,
        RenameCampCommand, RepositoryBindingInput, SendCampMessageCommand, TaskAssigneeFilter,
        TaskAssigneeUpdate, TaskListQuery, TaskStatus, UpdateTaskCommand,
    },
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandGatewayError, CommandResultStatus,
        DomainCommandGateway, canonical_json_digest,
    },
    context::{
        CharterDeliveryMode, ContextCompactionWork, ContextMaterialization, ContextService,
        DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES, MaterializeContextRequest, PreparedContext,
        RecordContextSummaryInput, SkillExposurePreparation,
    },
    db::Database,
    managed_blob::ManagedBlobStore,
    read_model::ReadModelService,
    runtime::{
        AcknowledgeAgentRunCancellationCommand, AgentRunCancellationCandidate, AgentRunExecution,
        AgentRunWorkspace, BindNativeSessionCommand, CancelCampTurnCommand, ClaimAgentRunCommand,
        ExecutionRuntimeService, FailAgentRunCommand, RestartNativeSessionCommand,
        SucceedAgentRunCommand,
    },
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
    sync::{Mutex, mpsc, oneshot},
    time::{Duration, MissedTickBehavior},
};

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
struct RepositoryInspectParams {
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SelectedProjectParams {
    project_path: String,
    repository: RepositoryBindingInput,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateCampFromFirstMessageParams {
    command_id: String,
    project: Option<SelectedProjectParams>,
    body: String,
    #[serde(default)]
    address: MessageAddressSpec,
    purpose: String,
    expected_output: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CampCreationReadyMember {
    agent_profile_id: String,
    handle: String,
    display_name: String,
    member_order: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CampIdParams {
    camp_id: String,
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
    repository_scope_id: Option<String>,
    offset: Option<usize>,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AcknowledgeCampViewedParams {
    camp_id: String,
    through_global_sequence: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecutionPreflightParams {
    camp_id: String,
    address: MessageAddressSpec,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendCampMessageParams {
    command_id: String,
    camp_id: String,
    body: String,
    address: MessageAddressSpec,
    reply_to_camp_message_id: Option<String>,
    execution: Option<ExecutionRequest>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartPreflightBlocker {
    code: String,
    detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartPreflightTarget {
    agent_profile_id: String,
    conversation_id: String,
    runtime_kind: String,
    executable_fingerprint: Option<String>,
    blockers: Vec<StartPreflightBlocker>,
    queue_conditions: Vec<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartPreflightResult {
    admissible: bool,
    checked_at: String,
    blockers: Vec<StartPreflightBlocker>,
    workspace: Option<AgentRunWorkspace>,
    targets: Vec<StartPreflightTarget>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct HealthCheckParams {
    #[serde(default)]
    refresh_runtime_probe: bool,
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
    decision: ApprovalDecision,
    reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentProfileIdParams {
    agent_profile_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RefreshAdapterInstallationParams {
    command_id: String,
    installation_id: String,
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

struct Core {
    database: Mutex<Database>,
    skill_library: SkillLibraryService,
    codex_cli: CodexCliRuntimeAdapter,
    opencode_cli: AcpCliRuntimeAdapter,
    copilot_cli: AcpCliRuntimeAdapter,
    claude_code_cli: ClaudeCodeCliRuntimeAdapter,
    antigravity_app: AntigravityAppRuntimeAdapter,
    data_dir: PathBuf,
}

enum AgentRunRuntime {
    Codex(Arc<CodexRuntime>),
    Acp(Arc<AcpRuntime>),
}

impl AgentRunRuntime {
    fn adapter_kind(&self) -> lumen_core::agent_profile::AdapterKind {
        match self {
            Self::Codex(_) => lumen_core::agent_profile::AdapterKind::CodexCli,
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
                            body: &summary,
                            generator_version: &work.generator_version,
                        },
                    ) {
                        let detail = format!("failed to persist generated summary: {error:#}");
                        if let Err(failure) = ContextService.fail_summary(
                            &mut database,
                            &work.attempt_id,
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
        let executable = Path::new(&work.runtime.executable_path);
        let current_fingerprint = fingerprint_executable(executable)
            .context("failed to fingerprint the Context Compaction Runtime")?;
        if current_fingerprint != work.runtime.executable_fingerprint {
            anyhow::bail!(
                "Runtime executable changed after Context Compaction was queued; refresh the installation and retry"
            );
        }
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
            lumen_core::agent_profile::AdapterKind::CodexCli => {
                CodexCliRuntimeAdapter::run_isolated_completion(&work.runtime, &root, &work.prompt)
                    .await?
            }
            lumen_core::agent_profile::AdapterKind::OpencodeCli
            | lumen_core::agent_profile::AdapterKind::CopilotCli => {
                AcpCliRuntimeAdapter::run_isolated_completion(&work.runtime, &root, &work.prompt)
                    .await?
            }
            lumen_core::agent_profile::AdapterKind::ClaudeCodeCli => {
                self.claude_code_cli
                    .run(ClaudeCodeRunRequest {
                        agent_run_id: format!("context-compaction:{}", work.attempt_id),
                        execution_epoch: 1,
                        workspace: AgentRunWorkspace {
                            execution_root: root.to_string_lossy().to_string(),
                            access: "read_only".to_string(),
                            isolation: "shared".to_string(),
                            repository_scope_id: None,
                            base_git_commit: None,
                        },
                        runtime: work.runtime.clone(),
                        prompt: work.prompt.clone(),
                        resumable_native_session_id: None,
                        new_native_session_id: None,
                        new_session_charter: None,
                        team_tool: None,
                        persist_session: false,
                    })
                    .await?
                    .final_output
            }
            lumen_core::agent_profile::AdapterKind::AntigravityApp => {
                self.antigravity_app
                    .run(AntigravityRunRequest {
                        agent_run_id: format!("context-compaction:{}", work.attempt_id),
                        execution_epoch: 1,
                        workspace: AgentRunWorkspace {
                            execution_root: root.to_string_lossy().to_string(),
                            access: "read_only".to_string(),
                            isolation: "shared".to_string(),
                            repository_scope_id: None,
                            base_git_commit: None,
                        },
                        runtime: work.runtime.clone(),
                        prompt: work.prompt.clone(),
                        resumable_native_session_id: None,
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
        self.copilot_cli
            .get_agent_run(agent_run_id, execution_epoch)
            .await
            .map(AgentRunRuntime::Acp)
    }

    fn acp_adapter(
        &self,
        kind: lumen_core::agent_profile::AdapterKind,
    ) -> Option<&AcpCliRuntimeAdapter> {
        match kind {
            lumen_core::agent_profile::AdapterKind::OpencodeCli => Some(&self.opencode_cli),
            lumen_core::agent_profile::AdapterKind::CopilotCli => Some(&self.copilot_cli),
            lumen_core::agent_profile::AdapterKind::CodexCli
            | lumen_core::agent_profile::AdapterKind::ClaudeCodeCli
            | lumen_core::agent_profile::AdapterKind::AntigravityApp => None,
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
                            "Lumen could not commit the Team Tool request".to_string(),
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
                "name": "Lumen AI",
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
                let mut database = self.database.lock().await;
                let execution = AgentProfileService::default().set_runtime(
                    &mut database,
                    &user_command_envelope(params.command_id, params.command),
                )?;
                self.reconcile_skills_best_effort(&mut database);
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
            "agents.status.set" => {
                let params: UserCommandParams<SetAgentProfileStatusCommand> =
                    serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                let execution = AgentProfileService::default().set_status(
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
                    Ok(lumen_core::command::CommandHandlerResult::applied(
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
                let active_count = profiles
                    .iter()
                    .filter(|profile| profile.status == "active")
                    .count();
                let ready_members = profiles
                    .into_iter()
                    .filter(|profile| {
                        profile.status == "active"
                            && profile.runtime_readiness.status == RuntimeReadinessStatus::Ready
                    })
                    .map(|profile| CampCreationReadyMember {
                        agent_profile_id: profile.id,
                        handle: profile.handle,
                        display_name: profile.display_name,
                        member_order: profile.member_order,
                    })
                    .collect::<Vec<_>>();
                let blockers = if active_count == 0 {
                    vec![json!({
                        "code": "no_active_members",
                        "detail": "请先创建或启用至少一位成员。",
                    })]
                } else if ready_members.is_empty() {
                    vec![json!({
                        "code": "no_runtime_ready_members",
                        "detail": "至少一位活跃成员需要配置可用的 Agent Runtime。",
                    })]
                } else {
                    Vec::new()
                };
                Ok(json!({
                    "admissible": blockers.is_empty(),
                    "readyMembers": ready_members,
                    "blockers": blockers,
                }))
            }
            "repositories.inspect" => {
                let params: RepositoryInspectParams =
                    serde_json::from_value(request.params.clone())?;
                let info = git::inspect_project(PathBuf::from(params.path).as_path()).await?;
                let name = info
                    .root_path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("Git Project");
                Ok(json!({
                    "name": name,
                    "projectPath": info.root_path,
                    "repository": {
                        "gitCommonDir": info.git_common_dir,
                        "objectFormat": info.object_format,
                    },
                }))
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
                        params.repository_scope_id.as_deref(),
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
            "camps.createFromFirstMessage" => {
                let params: CreateCampFromFirstMessageParams =
                    serde_json::from_value(request.params.clone())?;
                let project_path = params.project.as_ref().map_or_else(
                    || self.data_dir.join("lobby").to_string_lossy().to_string(),
                    |project| project.project_path.clone(),
                );
                let command = CreateCampFromFirstMessageCommand {
                    project_path,
                    repository: params
                        .project
                        .as_ref()
                        .map(|project| project.repository.clone()),
                    body: params.body,
                    address: params.address,
                    purpose: params.purpose,
                    expected_output: params.expected_output,
                };
                let envelope = user_command_envelope(params.command_id, command);
                if let Some(replay) = {
                    let database = self.database.lock().await;
                    DomainCommandGateway.replay_if_recorded(&database, &envelope)?
                } {
                    return Ok(serde_json::to_value(replay.result)?);
                }
                if params.project.is_some() {
                    validate_selected_repository(&envelope.payload).await?;
                } else {
                    std::fs::create_dir_all(&envelope.payload.project_path).with_context(|| {
                        format!(
                            "failed to create Lumen lobby at {}",
                            envelope.payload.project_path
                        )
                    })?;
                }
                let mut database = self.database.lock().await;
                let execution = CollaborationService::default()
                    .create_camp_from_first_message(&mut database, &envelope)?;
                self.reconcile_skills_best_effort(&mut database);
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
                Ok(serde_json::to_value(execution.result)?)
            }
            "camps.snapshot" => {
                let params: CampIdParams = serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                Ok(serde_json::to_value(
                    ReadModelService.camp_snapshot(&mut database, &params.camp_id)?,
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
                let envelope = CommandEnvelope {
                    command_id: params.command_id,
                    actor: ActorRef::User {
                        user_id: "local-user".to_string(),
                    },
                    camp_id: Some(params.camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: SendCampMessageCommand {
                        camp_id: params.camp_id,
                        body: params.body,
                        address: params.address,
                        reply_to_camp_message_id: params.reply_to_camp_message_id,
                        execution: params.execution,
                    },
                };
                if let Some(replay) = {
                    let database = self.database.lock().await;
                    DomainCommandGateway.replay_if_recorded(&database, &envelope)?
                } {
                    return Ok(json!({
                        "commandResult": replay.result,
                        "replayed": true,
                        "preflight": null,
                    }));
                }
                let preflight = if envelope.payload.execution.is_some() {
                    let preflight = self
                        .execution_preflight(&ExecutionPreflightParams {
                            camp_id: envelope.payload.camp_id.clone(),
                            address: envelope.payload.address.clone(),
                        })
                        .await?;
                    if !preflight.admissible {
                        return Ok(json!({
                            "commandResult": null,
                            "replayed": false,
                            "preflight": preflight,
                        }));
                    }
                    Some(preflight)
                } else {
                    None
                };
                let mut database = self.database.lock().await;
                let execution =
                    CollaborationService::default().send_camp_message(&mut database, &envelope)?;
                Ok(json!({
                    "commandResult": execution.result,
                    "replayed": execution.replayed,
                    "preflight": preflight,
                }))
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
                            decision: params.decision,
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
                Ok(json!({
                    "format": "lumen-diagnostics-v3",
                    "exportedAt": chrono::Utc::now().to_rfc3339(),
                    "appVersion": env!("CARGO_PKG_VERSION"),
                    "databasePath": database.path(),
                    "agents": agents,
                    "adapterInstallations": adapter_installations,
                    "camps": camps,
                    "navigation": navigation,
                }))
            }
            "health.check" => {
                let params: HealthCheckParams = serde_json::from_value(request.params.clone())?;
                let codex_probe = async {
                    if params.refresh_runtime_probe {
                        health::refresh_codex_runtime_probe().await
                    } else {
                        health::codex_runtime_probe().await
                    }
                };
                let opencode_probe = async {
                    if params.refresh_runtime_probe {
                        health::refresh_acp_runtime_probe(
                            lumen_core::agent_profile::AdapterKind::OpencodeCli,
                        )
                        .await
                    } else {
                        health::acp_runtime_probe(
                            lumen_core::agent_profile::AdapterKind::OpencodeCli,
                        )
                        .await
                    }
                };
                let copilot_probe = async {
                    if params.refresh_runtime_probe {
                        health::refresh_acp_runtime_probe(
                            lumen_core::agent_profile::AdapterKind::CopilotCli,
                        )
                        .await
                    } else {
                        health::acp_runtime_probe(
                            lumen_core::agent_profile::AdapterKind::CopilotCli,
                        )
                        .await
                    }
                };
                let claude_code_probe = async {
                    if params.refresh_runtime_probe {
                        health::refresh_claude_code_runtime_probe().await
                    } else {
                        health::claude_code_runtime_probe().await
                    }
                };
                let antigravity_probe = async {
                    if params.refresh_runtime_probe {
                        health::refresh_antigravity_runtime_probe().await
                    } else {
                        health::antigravity_runtime_probe().await
                    }
                };
                let (git, codex, opencode, copilot, claude_code, antigravity) = tokio::join!(
                    health::git_health(),
                    codex_probe,
                    opencode_probe,
                    copilot_probe,
                    claude_code_probe,
                    antigravity_probe
                );
                let database = self.database.lock().await;
                Ok(json!({
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
                    "codex": codex,
                    "runtimeCandidates": [codex, opencode, copilot, claude_code, antigravity],
                }))
            }
            method => anyhow::bail!("unsupported core method: {method}"),
        }
    }

    async fn execution_preflight(
        &self,
        params: &ExecutionPreflightParams,
    ) -> Result<StartPreflightResult> {
        let (context, profiles, installations) = {
            let database = self.database.lock().await;
            let context = CollaborationService::default().inspect_execution_targets(
                &database,
                &params.camp_id,
                &params.address,
            )?;
            let service = AgentProfileService::default();
            let mut profiles = HashMap::new();
            for target in &context.targets {
                if let Some(profile) = service.get_profile(&database, &target.agent_profile_id)? {
                    profiles.insert(target.agent_profile_id.clone(), profile);
                }
            }
            let installations = service
                .list_installations(&database)?
                .into_iter()
                .map(|installation| (installation.id.clone(), installation))
                .collect::<HashMap<_, _>>();
            (context, profiles, installations)
        };
        let mut blockers = context
            .addressing_blocker
            .map(|blocker| StartPreflightBlocker {
                code: "agent_unavailable".to_string(),
                detail: Some(blocker.detail),
            })
            .into_iter()
            .collect::<Vec<_>>();
        let (workspace, workspace_error) = inspect_preflight_workspace(
            &context.project_path,
            context.repository_git_common_dir.as_deref(),
            context.repository_scope_id.clone(),
        )
        .await;
        if let Some(detail) = workspace_error {
            blockers.push(StartPreflightBlocker {
                code: "workspace_invalid".to_string(),
                detail: Some(detail),
            });
        }
        let mut targets = Vec::with_capacity(context.targets.len());
        for target in context.targets {
            let mut blockers = Vec::new();
            let profile = profiles.get(&target.agent_profile_id);
            let runtime_preference =
                profile.and_then(|profile| profile.runtime_preference.as_ref());
            let installation =
                runtime_preference.and_then(|runtime| installations.get(&runtime.installation_id));
            let runtime_kind = installation
                .map(|installation| installation.adapter_kind.as_str().to_string())
                .unwrap_or_else(|| "unconfigured".to_string());
            let executable_fingerprint = installation
                .and_then(|installation| installation.snapshot.as_ref())
                .and_then(|snapshot| snapshot.executable_fingerprint.clone());

            match profile {
                None => blockers.push(StartPreflightBlocker {
                    code: "agent_unavailable".to_string(),
                    detail: Some("AgentProfile does not exist".to_string()),
                }),
                Some(profile)
                    if profile.runtime_readiness.status
                        != lumen_core::agent_profile::RuntimeReadinessStatus::Ready =>
                {
                    blockers.extend(profile.runtime_readiness.blockers.iter().map(|blocker| {
                        StartPreflightBlocker {
                            code: blocker.code.clone(),
                            detail: blocker.detail.clone(),
                        }
                    }));
                }
                Some(_) => match installation {
                    None => blockers.push(StartPreflightBlocker {
                        code: "adapter_installation_missing".to_string(),
                        detail: None,
                    }),
                    Some(installation) => {
                        let path = Path::new(&installation.executable_path);
                        if !path.is_file() {
                            blockers.push(StartPreflightBlocker {
                                code: "runtime_not_installed".to_string(),
                                detail: Some(installation.executable_path.clone()),
                            });
                        } else {
                            match fingerprint_executable(path) {
                                Ok(current)
                                    if executable_fingerprint.as_deref()
                                        == Some(current.as_str()) => {}
                                Ok(_) => blockers.push(StartPreflightBlocker {
                                    code: "runtime_snapshot_stale".to_string(),
                                    detail: Some(
                                        "Configured executable changed; refresh its capability snapshot"
                                            .to_string(),
                                    ),
                                }),
                                Err(error) => blockers.push(StartPreflightBlocker {
                                    code: "runtime_probe_failed".to_string(),
                                    detail: Some(error.to_string()),
                                }),
                            }
                        }
                    }
                },
            }
            let mut queue_conditions = Vec::new();
            if target.conversation_busy {
                queue_conditions.push("conversation_busy");
            }
            if target.earlier_run_queued {
                queue_conditions.push("earlier_run_queued");
            }
            targets.push(StartPreflightTarget {
                agent_profile_id: target.agent_profile_id,
                conversation_id: target.conversation_id,
                runtime_kind,
                executable_fingerprint,
                blockers,
                queue_conditions,
            });
        }
        let admissible = blockers.is_empty()
            && !targets.is_empty()
            && targets.iter().all(|target| target.blockers.is_empty());
        Ok(StartPreflightResult {
            admissible,
            checked_at: chrono::Utc::now().to_rfc3339(),
            blockers,
            workspace,
            targets,
        })
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
        let attempted_at = chrono::Utc::now().to_rfc3339();
        let registry = AgentRuntimeAdapterRegistry::default();
        let snapshot = match installation.adapter_kind {
            lumen_core::agent_profile::AdapterKind::CodexCli => {
                let probe =
                    health::codex_runtime_probe_at(Path::new(&installation.executable_path)).await;
                let authentication_status = probe_authentication_status(probe.status).to_string();
                let (raw_model_catalog, last_error) = if probe.status
                    == health::AgentRuntimeProbeStatus::Ready
                {
                    match health::codex_model_catalog(Path::new(&installation.executable_path))
                        .await
                    {
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
            kind @ (lumen_core::agent_profile::AdapterKind::OpencodeCli
            | lumen_core::agent_profile::AdapterKind::CopilotCli) => {
                let probe =
                    health::acp_capability_probe_at(Path::new(&installation.executable_path), kind)
                        .await;
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
            lumen_core::agent_profile::AdapterKind::ClaudeCodeCli => {
                let probe = health::claude_code_capability_probe_at(Path::new(
                    &installation.executable_path,
                ))
                .await;
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
            lumen_core::agent_profile::AdapterKind::AntigravityApp => {
                let probe = health::antigravity_capability_probe_at(Path::new(
                    &installation.executable_path,
                ))
                .await;
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
        for candidate in candidates {
            if !self.interrupt_cancelled_agent_run(&candidate).await {
                continue;
            }
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
                        },
                    },
                )
            };
            match acknowledgement {
                Ok(execution) if execution.result.status == CommandResultStatus::Applied => emit(
                    output,
                    "agent_run.cancelled",
                    json!({
                        "agentRunId": candidate.agent_run_id,
                        "executionEpoch": candidate.execution_epoch,
                        "result": execution.result,
                        "replayed": execution.replayed,
                    }),
                ),
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

    async fn interrupt_cancelled_agent_run(
        &self,
        candidate: &AgentRunCancellationCandidate,
    ) -> bool {
        if candidate.status == "queued" {
            return true;
        }
        if candidate.adapter_kind == "antigravity-app" {
            let interrupted = self
                .antigravity_app
                .interrupt(&candidate.agent_run_id, candidate.execution_epoch)
                .await;
            return interrupted
                || (candidate.status == "waiting"
                    && candidate.wait_reason.as_deref() == Some("runtime_recovery"));
        }
        if candidate.adapter_kind == "claude-code-cli" {
            let interrupted = self
                .claude_code_cli
                .interrupt(&candidate.agent_run_id, candidate.execution_epoch)
                .await;
            return interrupted
                || (candidate.status == "waiting"
                    && candidate.wait_reason.as_deref() == Some("runtime_recovery"));
        }
        let Some(runtime) = self
            .agent_run_runtime(&candidate.agent_run_id, candidate.execution_epoch)
            .await
        else {
            return candidate.status == "waiting"
                && candidate.wait_reason.as_deref() == Some("runtime_recovery");
        };
        if let Err(error) = runtime.cancel().await {
            eprintln!(
                "failed to interrupt AgentRun {}: {error:#}",
                candidate.agent_run_id
            );
            return false;
        }
        match runtime.adapter_kind() {
            lumen_core::agent_profile::AdapterKind::CodexCli => {
                self.codex_cli
                    .forget_agent_run(&candidate.agent_run_id, candidate.execution_epoch)
                    .await;
            }
            kind @ (lumen_core::agent_profile::AdapterKind::OpencodeCli
            | lumen_core::agent_profile::AdapterKind::CopilotCli) => {
                if let Some(adapter) = self.acp_adapter(kind) {
                    adapter
                        .forget_agent_run(&candidate.agent_run_id, candidate.execution_epoch)
                        .await;
                }
            }
            lumen_core::agent_profile::AdapterKind::AntigravityApp => unreachable!(),
            lumen_core::agent_profile::AdapterKind::ClaudeCodeCli => unreachable!(),
        }
        true
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
            let decision = payload["decision"].as_str().unwrap_or_default();
            let approved = matches!(decision, "approved" | "approved_by_policy");
            let denied = matches!(
                decision,
                "denied" | "denied_by_policy" | "expired" | "cancelled"
            );
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
            if approved
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
                                        "Lumen rejected the approved action because its concrete scope was unsafe"
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
            let response = if candidate.native_method == "session/request_permission" {
                acp::approval_result(&candidate.response_context, response_approved)
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
        candidate: &lumen_core::action::RuntimeDeliveryCandidate,
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
        charter_delivery_mode: CharterDeliveryMode,
        output: &mpsc::UnboundedSender<String>,
    ) -> Result<Option<PreparedContext>> {
        let materialization = {
            let mut database = self.database.lock().await;
            ContextService.materialize_with_skill_exposure(
                &mut database,
                &ManagedBlobStore::new(&self.data_dir),
                skill_exposure,
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
                    "Runtime returned a Native Input ID, but Lumen could not persist its acknowledgement: {acknowledgement_error}"
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
            std::env::current_exe().context("failed to locate the Lumen Agent Host executable")?,
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
        if execution.runtime.adapter_kind == lumen_core::agent_profile::AdapterKind::AntigravityApp
        {
            return self
                .launch_antigravity_agent_run(execution, &skill_exposure, output)
                .await;
        }
        if execution.runtime.adapter_kind == lumen_core::agent_profile::AdapterKind::ClaudeCodeCli {
            return self
                .launch_claude_code_agent_run(execution, &skill_exposure, output)
                .await;
        }
        if matches!(
            execution.runtime.adapter_kind,
            lumen_core::agent_profile::AdapterKind::OpencodeCli
                | lumen_core::agent_profile::AdapterKind::CopilotCli
        ) {
            return self
                .launch_acp_agent_run(execution, &skill_exposure, output)
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
        let executable_path = PathBuf::from(&execution.runtime.executable_path);
        let current_fingerprint = fingerprint_executable(&executable_path)
            .context("failed to fingerprint the frozen Runtime executable")?;
        if current_fingerprint != execution.runtime.executable_fingerprint {
            anyhow::bail!(
                "Runtime executable changed after AgentRun creation; refresh the installation and retry"
            );
        }
        let (initial_binding, initial_team_tool) =
            self.prepare_team_tool_runtime(execution, false).await?;
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
        let sandbox_mode = if execution.workspace.access == "read_only" {
            "read-only"
        } else {
            configured_sandbox
        };
        let approval_policy = permission_values
            .get("approval_policy")
            .and_then(Value::as_str)
            .context("Codex AgentRun requires approval_policy")?;
        let model = execution.runtime.model.model_id.as_str();
        let charter = {
            let database = self.database.lock().await;
            ContextService.session_charter(
                &database,
                &execution.agent_run_id,
                execution.execution_epoch,
            )
        }?;
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
                },
            )
            .await;
        let mut binding_credential = initial_binding;
        let thread_id = match thread {
            Ok(thread_id) => thread_id,
            Err(error) if resumable_session_id.is_some() => {
                let (replacement_binding, replacement_team_tool) =
                    self.prepare_team_tool_runtime(execution, true).await?;
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
        skill_exposure: &PreparedSkillExposure,
        output: &mpsc::UnboundedSender<String>,
    ) -> Result<()> {
        let execution_root = PathBuf::from(&execution.workspace.execution_root);
        if !execution_root.is_dir() {
            anyhow::bail!(
                "AgentRun execution directory no longer exists: {}",
                execution_root.display()
            );
        }
        let executable_path = PathBuf::from(&execution.runtime.executable_path);
        let current_fingerprint = fingerprint_executable(&executable_path)
            .context("failed to fingerprint the frozen Claude Code executable")?;
        if current_fingerprint != execution.runtime.executable_fingerprint {
            anyhow::bail!(
                "Runtime executable changed after AgentRun creation; refresh the installation and retry"
            );
        }

        // The credential identifies the long-lived Native Binding, not this
        // AgentRun. Core resolves the current active Run at every tool call.
        let (binding_credential, team_tool) =
            self.prepare_team_tool_runtime(execution, false).await?;
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
                runtime: execution.runtime.clone(),
                prompt: prepared_context.rendered_payload,
                resumable_native_session_id: (!is_new_session).then_some(native_session_id.clone()),
                new_native_session_id: is_new_session.then_some(native_session_id.clone()),
                new_session_charter: is_new_session.then_some(prepared_context.charter),
                team_tool: Some(team_tool),
                persist_session: true,
            })
            .await;
        let result = match result {
            Ok(result) => result,
            Err(error) => {
                let mut database = self.database.lock().await;
                ContextService.mark_input_delivery_unknown(
                    &mut database,
                    &delivery.id,
                    &format!("{error:#}"),
                )?;
                return Err(error).context("Claude Code non-interactive input outcome is unknown");
            }
        };
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
        skill_exposure: &PreparedSkillExposure,
        output: &mpsc::UnboundedSender<String>,
    ) -> Result<()> {
        let execution_root = PathBuf::from(&execution.workspace.execution_root);
        if !execution_root.is_dir() {
            anyhow::bail!(
                "AgentRun execution directory no longer exists: {}",
                execution_root.display()
            );
        }
        let executable_path = PathBuf::from(&execution.runtime.executable_path);
        let current_fingerprint = fingerprint_executable(&executable_path)
            .context("failed to fingerprint the frozen Antigravity companion executable")?;
        if current_fingerprint != execution.runtime.executable_fingerprint {
            anyhow::bail!(
                "Runtime executable changed after AgentRun creation; refresh the installation and retry"
            );
        }
        let Some(prepared_context) = self
            .materialize_agent_run_context(
                execution,
                skill_exposure,
                CharterDeliveryMode::FirstPayload,
                output,
            )
            .await?
        else {
            return Ok(());
        };
        let prompt = prepared_context.rendered_payload.clone();
        let resumable_session_id = execution.resumable_native_session_id().map(str::to_string);
        let proposed_binding_id = prepared_context
            .requires_new_native_session
            .then(|| uuid::Uuid::new_v4().to_string());
        let input_delivery = if let Some(proposed_binding_id) = proposed_binding_id.as_deref() {
            let mut database = self.database.lock().await;
            ContextService.prepare_input_delivery_for_future_binding(
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
                runtime: execution.runtime.clone(),
                prompt,
                resumable_native_session_id: resumable_session_id,
            })
            .await;
        let result = match result {
            Ok(result) => result,
            Err(error) => {
                let mut database = self.database.lock().await;
                ContextService.mark_input_delivery_unknown(
                    &mut database,
                    &input_delivery.id,
                    &format!("{error:#}"),
                )?;
                return Err(error)
                    .context("Antigravity companion non-interactive input outcome is unknown");
            }
        };

        let binding = {
            let mut database = self.database.lock().await;
            ExecutionRuntimeService::default().bind_native_session(
                &mut database,
                &CommandEnvelope {
                    command_id: uuid::Uuid::new_v4().to_string(),
                    actor: ActorRef::System {
                        component_id: "runtime-adapter:antigravity-app".to_string(),
                    },
                    camp_id: Some(execution.camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: BindNativeSessionCommand {
                        conversation_id: execution.conversation_id.clone(),
                        agent_run_id: execution.agent_run_id.clone(),
                        expected_conversation_version: execution.conversation_version,
                        expected_execution_epoch: execution.execution_epoch,
                        previous_adapter_installation_id: execution
                            .native_adapter_installation_id
                            .clone(),
                        previous_native_session_id: execution.native_session_id.clone(),
                        previous_binding_compatibility_digest: execution
                            .native_binding_compatibility_digest
                            .clone(),
                        proposed_binding_id: proposed_binding_id.clone(),
                        adapter_installation_id: execution.runtime.installation_id.clone(),
                        native_session_id: result.native_session_id.clone(),
                        binding_compatibility_digest: execution
                            .runtime
                            .binding_compatibility_digest
                            .clone(),
                    },
                },
            )
        };
        let binding = match binding {
            Ok(binding) => binding,
            Err(error) => {
                let mut database = self.database.lock().await;
                ContextService.mark_input_delivery_unknown(
                    &mut database,
                    &input_delivery.id,
                    &format!(
                        "Native Session binding failed after Antigravity execution: {error:#}"
                    ),
                )?;
                return Err(error);
            }
        };
        if binding.result.status == CommandResultStatus::Rejected {
            let mut database = self.database.lock().await;
            ContextService.mark_input_delivery_unknown(
                &mut database,
                &input_delivery.id,
                &format!(
                    "Native Session binding was rejected: {}",
                    binding.result.code
                ),
            )?;
            anyhow::bail!(
                "Antigravity Native Session binding was rejected: {}",
                binding.result.code
            );
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
        skill_exposure: &PreparedSkillExposure,
        output: &mpsc::UnboundedSender<String>,
    ) -> Result<()> {
        let execution_root = PathBuf::from(&execution.workspace.execution_root);
        if !execution_root.is_dir() {
            anyhow::bail!(
                "AgentRun execution directory no longer exists: {}",
                execution_root.display()
            );
        }
        let executable_path = PathBuf::from(&execution.runtime.executable_path);
        let current_fingerprint = fingerprint_executable(&executable_path)
            .context("failed to fingerprint the frozen Runtime executable")?;
        if current_fingerprint != execution.runtime.executable_fingerprint {
            anyhow::bail!(
                "Runtime executable changed after AgentRun creation; refresh the installation and retry"
            );
        }
        let adapter = self
            .acp_adapter(execution.runtime.adapter_kind)
            .context("AgentRun selected an unsupported ACP Adapter")?;
        let (initial_binding, initial_team_tool) =
            self.prepare_team_tool_runtime(execution, false).await?;
        let mut runtime = adapter
            .ensure_agent_run_runtime(
                &execution.agent_run_id,
                execution.execution_epoch,
                &execution.workspace,
                &execution.runtime,
                Some(&initial_team_tool),
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
            )
            .await;
        let mut binding_credential = initial_binding;
        let session_id = match session {
            Ok(session_id) => session_id,
            Err(error) if resumable_session_id.is_some() => {
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
                        &execution.runtime,
                        Some(&replacement_team_tool),
                    )
                    .await?;
                let session_id = runtime
                    .start_or_resume_session(
                        None,
                        supports_load,
                        model,
                        &execution.runtime.model.options,
                        Some(&replacement_team_tool),
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
            lumen_core::agent_profile::AdapterKind::CodexCli => {
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
            kind @ (lumen_core::agent_profile::AdapterKind::OpencodeCli
            | lumen_core::agent_profile::AdapterKind::CopilotCli) => {
                if let Some(adapter) = self.acp_adapter(kind) {
                    adapter
                        .forget_agent_run(&execution.agent_run_id, execution.execution_epoch)
                        .await;
                }
            }
            lumen_core::agent_profile::AdapterKind::AntigravityApp => {
                let _ = self
                    .antigravity_app
                    .interrupt(&execution.agent_run_id, execution.execution_epoch)
                    .await;
            }
            lumen_core::agent_profile::AdapterKind::ClaudeCodeCli => {
                let _ = self
                    .claude_code_cli
                    .interrupt(&execution.agent_run_id, execution.execution_epoch)
                    .await;
            }
        }
    }

    async fn fail_unmaterialized_agent_run(
        &self,
        candidate: &lumen_core::runtime::QueuedAgentRunCandidate,
        execution_epoch: i64,
        error: &anyhow::Error,
    ) {
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
}

async fn inspect_preflight_workspace(
    project_path: &str,
    expected_git_common_dir: Option<&str>,
    repository_scope_id: Option<String>,
) -> (Option<AgentRunWorkspace>, Option<String>) {
    let project_root = PathBuf::from(project_path);
    if !project_root.is_absolute() || !project_root.is_dir() {
        return (
            None,
            Some(format!("Camp project path is unavailable: {project_path}")),
        );
    }
    if repository_scope_id.is_none() {
        return (
            Some(AgentRunWorkspace {
                execution_root: project_path.to_string(),
                access: "write".to_string(),
                isolation: "shared".to_string(),
                repository_scope_id: None,
                base_git_commit: None,
            }),
            None,
        );
    }

    let info = match git::inspect_project(&project_root).await {
        Ok(info) => info,
        Err(error) => return (None, Some(format!("{error:#}"))),
    };
    if !same_filesystem_path(&project_root, &info.root_path) {
        return (
            None,
            Some("Camp path now resolves to a different Git worktree root".to_string()),
        );
    }
    let Some(expected_git_common_dir) = expected_git_common_dir else {
        return (
            None,
            Some("Camp repository binding is incomplete".to_string()),
        );
    };
    if !same_filesystem_path(Path::new(expected_git_common_dir), &info.git_common_dir) {
        return (
            None,
            Some("Camp path now belongs to a different Git repository".to_string()),
        );
    }
    (
        Some(AgentRunWorkspace {
            execution_root: project_path.to_string(),
            access: "write".to_string(),
            isolation: "shared".to_string(),
            repository_scope_id,
            base_git_commit: Some(info.head),
        }),
        None,
    )
}

async fn validate_selected_repository(command: &CreateCampFromFirstMessageCommand) -> Result<()> {
    let expected = command
        .repository
        .as_ref()
        .context("selected Git project has no repository identity")?;
    let project_path = PathBuf::from(&command.project_path);
    let info = git::inspect_project(&project_path).await?;
    if !same_filesystem_path(&project_path, &info.root_path) {
        anyhow::bail!("selected path no longer resolves to the same Git worktree root");
    }
    if !same_filesystem_path(Path::new(&expected.git_common_dir), &info.git_common_dir) {
        anyhow::bail!("selected path no longer belongs to the same Git repository");
    }
    if expected.object_format != info.object_format {
        anyhow::bail!("selected Git repository object format changed");
    }
    Ok(())
}

fn same_filesystem_path(left: &Path, right: &Path) -> bool {
    match (std::fs::canonicalize(left), std::fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
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

fn probe_authentication_status(status: health::AgentRuntimeProbeStatus) -> &'static str {
    match status {
        health::AgentRuntimeProbeStatus::AuthenticationRequired => "authentication_required",
        health::AgentRuntimeProbeStatus::Ready
        | health::AgentRuntimeProbeStatus::MissingCapabilities => "authenticated",
        health::AgentRuntimeProbeStatus::NotInstalled
        | health::AgentRuntimeProbeStatus::ProbeFailed => "unknown",
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    if std::env::args().nth(1).as_deref() == Some("team-mcp-bridge") {
        return run_team_mcp_bridge(TeamMcpBridgeConfig::from_environment()?).await;
    }
    let data_dir = parse_data_dir()?;
    let mut database = Database::open(&data_dir)?;
    let skill_library = SkillLibraryService::new(SkillLibraryService::default_root()?)?;
    skill_library.cleanup_expired_staging()?;
    skill_library.install_bundled_skills(&mut database)?;
    skill_library.cleanup_orphan_revisions(&database)?;
    SkillProjectionReconciler.reconcile_known_roots(&mut database, &skill_library)?;
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
        skill_library,
        codex_cli: CodexCliRuntimeAdapter::new(codex_tx),
        opencode_cli: AcpCliRuntimeAdapter::new(
            lumen_core::agent_profile::AdapterKind::OpencodeCli,
            acp_tx.clone(),
            data_dir.join("runtime/opencode"),
        )?,
        copilot_cli: AcpCliRuntimeAdapter::new(
            lumen_core::agent_profile::AdapterKind::CopilotCli,
            acp_tx,
            data_dir.join("runtime/copilot"),
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

    eprintln!("lumen-core {} ready", env!("CARGO_PKG_VERSION"));

    let stdin = BufReader::new(tokio::io::stdin());
    let mut lines = stdin.lines();

    while let Some(line) = lines.next_line().await? {
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

        let response = match core.handle(&request).await {
            Ok(result) => Response {
                id: request.id,
                result: Some(result),
                error: None,
            },
            Err(error) => Response {
                id: request.id,
                result: None,
                error: Some(ErrorBody {
                    code: "CORE_REQUEST_FAILED".into(),
                    message: format!("{error:#}"),
                }),
            },
        };

        output_tx
            .send(serde_json::to_string(&response)?)
            .map_err(|_| anyhow::anyhow!("output writer stopped unexpectedly"))?;
    }

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
    output_handle.await.context("output writer task failed")??;
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
    adapter_kind: lumen_core::agent_profile::AdapterKind,
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
    adapter_kind: lumen_core::agent_profile::AdapterKind,
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
                        .respond_error(id, -32000, &format!("Lumen file read rejected: {error:#}"))
                        .await
                }
            },
            "fs/write_text_file" => match runtime.write_text_file(&params).await {
                Ok(result) => runtime.respond(id, result).await,
                Err(error) => {
                    runtime
                        .respond_error(id, -32000, &format!("Lumen file write rejected: {error:#}"))
                        .await
                }
            },
            _ => {
                runtime
                    .respond_error(
                        id,
                        -32601,
                        "This ACP client request is not supported by Lumen v0.03",
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
    emit(
        output,
        event_type,
        json!({
            "agentRunId": agent_run_id,
            "executionEpoch": execution_epoch,
            "adapterKind": adapter_kind,
            "nativeMethod": method,
            "payload": payload,
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
    if method != "lumen/acp_prompt_completed" {
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
    if method == "lumen/acp_prompt_completed" {
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
    if execution.workspace.access == "read_only"
        && matches!(
            &action_request.input,
            lumen_core::action::CanonicalActionInput::FileWrite { .. }
                | lumen_core::action::CanonicalActionInput::FileDelete { .. }
                | lumen_core::action::CanonicalActionInput::ShellCommand { .. }
                | lumen_core::action::CanonicalActionInput::GitMutation { .. }
                | lumen_core::action::CanonicalActionInput::NetworkWrite { .. }
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
    match acp::approval_result(params, false) {
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
    adapter_kind: lumen_core::agent_profile::AdapterKind,
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
    adapter_kind: lumen_core::agent_profile::AdapterKind,
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
    adapter_kind: lumen_core::agent_profile::AdapterKind,
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
                "This app-server request is not supported by the Lumen AgentRuntimeAdapter";
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
    emit(
        output,
        event_type,
        json!({
            "agentRunId": agent_run_id,
            "executionEpoch": execution_epoch,
            "nativeMethod": method,
            "payload": payload,
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
    loop {
        tokio::select! {
            _ = interval.tick() => {
                core.dispatch_runtime_deliveries(&output).await;
                core.dispatch_agent_run_cancellations(&output).await;
                core.dispatch_context_compactions().await;
                core.dispatch_agent_runs(&output).await;
            },
            _ = skill_interval.tick() => {
                core.reconcile_skills_periodically().await;
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
        let core_socket = std::env::var_os("LUMEN_TEAM_CORE_SOCKET")
            .map(PathBuf::from)
            .context("LUMEN_TEAM_CORE_SOCKET is required for team-mcp-bridge")?;
        let native_binding_id = std::env::var("LUMEN_TEAM_NATIVE_BINDING_ID")
            .context("LUMEN_TEAM_NATIVE_BINDING_ID is required for team-mcp-bridge")?;
        let binding_credential = std::env::var("LUMEN_TEAM_BINDING_CREDENTIAL")
            .context("LUMEN_TEAM_BINDING_CREDENTIAL is required for team-mcp-bridge")?;
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
        .join(format!("lumen-team-{}", std::process::id()))
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
            "serverInfo": { "name": "lumen-team-tool", "version": env!("CARGO_PKG_VERSION") },
            "instructions": "Lumen Team tools provide private A2A execution requests and durable Camp Task management. A Task mutation never wakes its assignee."
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
                    "required": ["lumenTeamTool", "lumenTeamReceipt", "inboxMessageId", "targetAgentRunId", "correlationId", "a2aDepth", "remainingA2aHops", "remainingTurnA2aRuns", "status"],
                    "properties": {
                        "lumenTeamTool": {"const": TEAM_POST_MESSAGE_TOOL_NAME},
                        "lumenTeamReceipt": {"type": "string"},
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
                    "required": ["lumenTeamTool", "lumenTeamReceipt", "taskId", "status", "version"],
                    "properties": {
                        "lumenTeamTool": {"const": TEAM_CREATE_TASK_TOOL_NAME},
                        "lumenTeamReceipt": {"type": "string"},
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
                    "required": ["lumenTeamTool", "lumenTeamReceipt", "taskId", "status", "assigneeAgentId", "version"],
                    "properties": {
                        "lumenTeamTool": {"const": TEAM_UPDATE_TASK_TOOL_NAME},
                        "lumenTeamReceipt": {"type": "string"},
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
                    "required": ["lumenTeamTool", "lumenTeamReceipt", "tasks", "nextCursor", "truncated"],
                    "properties": {
                        "lumenTeamTool": {"const": TEAM_LIST_TASKS_TOOL_NAME},
                        "lumenTeamReceipt": {"type": "string"},
                        "tasks": {"type": "array", "items": {"type": "object"}},
                        "nextCursor": {"type": ["string", "null"]},
                        "truncated": {"type": "boolean"}
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
                        "lumenTeamTool": tool_name,
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
            "lumenTeamTool".to_string(),
            Value::String(tool_name.to_string()),
        );
    let audit_key = team_tool_completion_audit_key(&config.binding_credential)?;
    let receipt = team_tool_completion_receipt(&audit_key, &structured_content)?;
    structured_content["lumenTeamReceipt"] = Value::String(receipt);
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
            message: "Lumen Core Team Tool endpoint is unavailable".to_string(),
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
            message: "Lumen Core did not accept the Team Tool request".to_string(),
        })?;
    stream
        .write_all(b"\n")
        .await
        .map_err(|_| TeamToolIpcError {
            code: "team_tool.core_unavailable".to_string(),
            message: "Lumen Core did not accept the Team Tool request".to_string(),
        })?;
    let mut lines = BufReader::new(stream).lines();
    let response = lines
        .next_line()
        .await
        .map_err(|_| TeamToolIpcError {
            code: "team_tool.core_unavailable".to_string(),
            message: "Lumen Core Team Tool response was interrupted".to_string(),
        })?
        .ok_or_else(|| TeamToolIpcError {
            code: "team_tool.core_unavailable".to_string(),
            message: "Lumen Core closed the Team Tool connection without a result".to_string(),
        })?;
    let response =
        serde_json::from_str::<TeamToolIpcResponse>(&response).map_err(|_| TeamToolIpcError {
            code: "team_tool.invalid_core_response".to_string(),
            message: "Lumen Core returned a malformed Team Tool response".to_string(),
        })?;
    match (response.result, response.error) {
        (Some(result), None) => Ok(result),
        (None, Some(error)) => Err(error),
        _ => Err(TeamToolIpcError {
            code: "team_tool.invalid_core_response".to_string(),
            message: "Lumen Core returned an ambiguous Team Tool response".to_string(),
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
    dirs::data_local_dir()
        .map(|path| path.join("Lumen AI"))
        .context("could not determine a local data directory")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn team_mcp_bridge_lists_four_narrow_tools_without_identity_fields() {
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
        assert_eq!(tools.len(), 4);
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
            assert_eq!(request.input["recipientAgentId"], "agent-muwa");
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
                        "recipientAgentId": "agent-muwa",
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
                        "recipientAgentId": "agent-muwa",
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
            response["result"]["structuredContent"]["lumenTeamTool"],
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
                    "rawInput": {"command": "echo TOP_SECRET_INPUT"},
                    "rawOutput": {"stdout": "TOP_SECRET_OUTPUT"}
                }
            }),
        );
        let serialized = serde_json::to_string(&payload).expect("event payload should serialize");

        assert!(!serialized.contains("TOP_SECRET_INPUT"));
        assert!(!serialized.contains("TOP_SECRET_OUTPUT"));
        assert!(payload["rawInputDigest"].is_string());
        assert!(payload["rawOutputDigest"].is_string());
    }
}
