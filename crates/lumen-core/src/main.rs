mod codex;
mod git;
mod health;

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::{Context, Result};
use codex::{CodexIncoming, CodexManager, CodexRuntime};
use lumen_core::{
    action::{
        AcknowledgeRuntimeDeliveryCommand, AcquireRuntimeDeliveryCommand, ActionControlMode,
        ActionResultOutcome, ActionSafetyService, ApprovalDecision, ClaimActionCommand,
        ConfirmRuntimeRequestResolvedCommand, FailRuntimeDeliveryCommand,
        MarkActionDispatchStartedCommand, PrepareActionCommand, ReconcileRuntimeLossCommand,
        RecordActionResultCommand, ResolveActionApprovalCommand,
    },
    agent_profile::{
        AgentProfileService, ClearAgentProfileRuntimeCommand, CreateAdapterInstallationCommand,
        CreateAgentProfileCommand, SetAgentProfileRuntimeCommand, SetAgentProfileStatusCommand,
        UpdateAdapterInstallationCommand, UpdateAgentProfileCommand,
    },
    collaboration::{
        AcceptanceCriterionInput, CollaborationService, CreateTaskAndQueueExecutionCommand,
        ExecutionRequest, MessageAddressSpec, SendCampMessageCommand,
    },
    command::{
        ActorRef, CommandEnvelope, CommandResultStatus, DomainCommandGateway, canonical_json_digest,
    },
    db::{Database, LOBBY_PROJECT_ID, RuntimeSession, Task},
    evidence::{CompleteTaskCommand, CriterionEvidenceInput, EvidenceService},
    read_model::ReadModelService,
    runtime::{
        AgentRunExecution, AgentRunWorkspace, BindNativeSessionCommand, ClaimAgentRunCommand,
        ExecutionRuntimeService, FailAgentRunCommand, SucceedAgentRunCommand,
    },
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter},
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenProjectParams {
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateTaskParams {
    project_id: Option<String>,
    goal: String,
    title: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ListTasksParams {
    project_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskIdParams {
    task_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendTaskParams {
    task_id: String,
    text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolveApprovalParams {
    approval_id: String,
    decision: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListTaskDataParams {
    task_id: String,
    limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CampIdParams {
    camp_id: String,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateTaskAndQueueExecutionParams {
    command_id: String,
    camp_id: String,
    title: String,
    objective: String,
    #[serde(default)]
    acceptance_criteria: Vec<AcceptanceCriterionInput>,
    assignee_agent_id: String,
    dedup_key: Option<String>,
    purpose: String,
    expected_output: String,
    workspace: AgentRunWorkspace,
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
struct CompleteTaskV2Params {
    command_id: String,
    camp_id: String,
    task_id: String,
    expected_version: i64,
    semantic_attestation: bool,
    criterion_evidence: Vec<CriterionEvidenceInput>,
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
    codex: CodexManager,
    data_dir: PathBuf,
}

impl Core {
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
                Ok(serde_json::to_value(execution.result)?)
            }
            "camps.list" => {
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    ReadModelService.list_camps(&database)?,
                )?)
            }
            "camps.snapshot" => {
                let params: CampIdParams = serde_json::from_value(request.params.clone())?;
                let mut database = self.database.lock().await;
                Ok(serde_json::to_value(
                    ReadModelService.camp_snapshot(&mut database, &params.camp_id)?,
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
            "execution.preflight" => {
                let params: ExecutionPreflightParams =
                    serde_json::from_value(request.params.clone())?;
                Ok(serde_json::to_value(
                    self.execution_preflight(&params).await?,
                )?)
            }
            "projects.open" => {
                let params: OpenProjectParams = serde_json::from_value(request.params.clone())?;
                let info = git::inspect_project(PathBuf::from(params.path).as_path()).await?;
                let database = self.database.lock().await;
                let project = database.upsert_project(&info.root_path, &info.git_common_dir)?;
                Ok(serde_json::to_value(project)?)
            }
            "projects.list" => {
                let database = self.database.lock().await;
                Ok(serde_json::to_value(database.list_projects()?)?)
            }
            "tasks.create" => {
                let params: CreateTaskParams = serde_json::from_value(request.params.clone())?;
                if params.goal.trim().is_empty() {
                    anyhow::bail!("task goal cannot be empty");
                }
                let project = {
                    let database = self.database.lock().await;
                    database
                        .get_project(params.project_id.as_deref().unwrap_or(LOBBY_PROJECT_ID))?
                        .context("project not found")?
                };
                let project_path = PathBuf::from(&project.root_path);
                let (execution_root, start_branch, base_revision) = if project.kind == "lobby" {
                    std::fs::create_dir_all(&project_path).with_context(|| {
                        format!(
                            "failed to create default lobby at {}",
                            project_path.display()
                        )
                    })?;
                    (project_path, "lobby".to_string(), "lobby".to_string())
                } else {
                    let info = git::inspect_project(&project_path).await?;
                    (info.root_path, info.branch, info.head)
                };
                let task_id = uuid::Uuid::new_v4().to_string();
                let title = params.title.unwrap_or_else(|| task_title(&params.goal));
                let database = self.database.lock().await;
                let task = database.insert_task(
                    &task_id,
                    &project.id,
                    &title,
                    params.goal.trim(),
                    &execution_root,
                    &start_branch,
                    &base_revision,
                )?;
                database.record_event(
                    &task.id,
                    "task.created",
                    None,
                    &json!({
                        "contextKind": project.kind,
                        "executionRoot": task.execution_root,
                        "startBranch": task.start_branch,
                        "baseRevision": task.base_revision,
                    }),
                )?;
                Ok(serde_json::to_value(task)?)
            }
            "tasks.createAndQueueExecution" => {
                let params: CreateTaskAndQueueExecutionParams =
                    serde_json::from_value(request.params.clone())?;
                let envelope = task_execution_envelope(&params);
                if let Some(replay) = {
                    let database = self.database.lock().await;
                    DomainCommandGateway.replay_if_recorded(&database, &envelope)?
                } {
                    return Ok(json!({
                        "execution": replay.result,
                        "replayed": true,
                        "preflight": null,
                    }));
                }

                let preflight_params = ExecutionPreflightParams {
                    camp_id: params.camp_id.clone(),
                    address: MessageAddressSpec::Explicit {
                        agent_profile_ids: vec![params.assignee_agent_id.clone()],
                    },
                };
                let mut preflight = self.execution_preflight(&preflight_params).await?;
                if preflight.workspace.as_ref() != Some(&params.workspace) {
                    preflight.blockers.push(StartPreflightBlocker {
                        code: "workspace_invalid".to_string(),
                        detail: Some(
                            "Workspace changed after preflight; refresh before submitting"
                                .to_string(),
                        ),
                    });
                    preflight.admissible = false;
                }
                if !preflight.admissible {
                    return Ok(json!({
                        "execution": null,
                        "replayed": false,
                        "preflight": preflight,
                    }));
                }

                let execution = {
                    let mut database = self.database.lock().await;
                    CollaborationService::default()
                        .create_task_and_queue_execution(&mut database, &envelope)?
                };
                Ok(json!({
                    "execution": execution.result,
                    "replayed": execution.replayed,
                    "preflight": preflight,
                }))
            }
            "tasks.list" => {
                let params: ListTasksParams = serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    database.list_tasks(params.project_id.as_deref())?,
                )?)
            }
            "tasks.complete" => {
                let params: CompleteTaskV2Params = serde_json::from_value(request.params.clone())?;
                let envelope = CommandEnvelope {
                    command_id: params.command_id,
                    actor: ActorRef::User {
                        user_id: "local-user".to_string(),
                    },
                    camp_id: Some(params.camp_id),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: CompleteTaskCommand {
                        task_id: params.task_id,
                        expected_version: params.expected_version,
                        semantic_attestation: params.semantic_attestation,
                        criterion_evidence: params.criterion_evidence,
                    },
                };
                let mut database = self.database.lock().await;
                let execution =
                    EvidenceService::default().complete_task(&mut database, &envelope)?;
                Ok(serde_json::to_value(execution.result)?)
            }
            "tasks.get" => {
                let params: TaskIdParams = serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    database
                        .get_task(&params.task_id)?
                        .context("task not found")?,
                )?)
            }
            "tasks.diff" => {
                let params: TaskIdParams = serde_json::from_value(request.params.clone())?;
                let task = {
                    let database = self.database.lock().await;
                    database
                        .get_task(&params.task_id)?
                        .context("task not found")?
                };
                let diff = if task.project_id == LOBBY_PROJECT_ID {
                    git::GitDiff::empty()
                } else {
                    git::diff(
                        PathBuf::from(task.execution_root).as_path(),
                        &task.base_revision,
                    )
                    .await?
                };
                Ok(serde_json::to_value(diff)?)
            }
            "tasks.start" => {
                let params: TaskIdParams = serde_json::from_value(request.params.clone())?;
                {
                    let database = self.database.lock().await;
                    let task = database
                        .get_task(&params.task_id)?
                        .context("task not found")?;
                    if task.status != "draft" {
                        anyhow::bail!(
                            "task is {}, use resume or send instead of starting it again",
                            task.status
                        );
                    }
                    ensure_project_writer_available(&database, &task)?;
                    database.update_task_status(&task.id, "preparing")?;
                }
                let outcome: Result<Value> = async {
                    let (task, session, runtime, codex_version) =
                        self.runtime_for_task(&params.task_id).await?;
                    let thread_id = self
                        .ensure_thread(&task, &session, &runtime, &codex_version)
                        .await?;
                    let turn_id = runtime.start_turn(&task_start_prompt(&task)).await?;
                    let database = self.database.lock().await;
                    let task = database.update_task_status(&task.id, "running")?;
                    database.set_runtime_status(&task.id, "running")?;
                    database.record_event(
                        &task.id,
                        "user.message",
                        None,
                        &json!({"text": task.goal, "nativeTurnId": turn_id}),
                    )?;
                    Ok(json!({"task": task, "threadId": thread_id, "turnId": turn_id}))
                }
                .await;
                if let Err(error) = &outcome {
                    let database = self.database.lock().await;
                    let _ = database.update_task_status(&params.task_id, "failed");
                    let _ = database.record_event(
                        &params.task_id,
                        "error",
                        Some("task/start"),
                        &json!({"message": format!("{error:#}")}),
                    );
                }
                outcome
            }
            "tasks.resume" => {
                let params: TaskIdParams = serde_json::from_value(request.params.clone())?;
                let task = {
                    let database = self.database.lock().await;
                    let task = database
                        .get_task(&params.task_id)?
                        .context("task not found")?;
                    if !matches!(
                        task.status.as_str(),
                        "preparing" | "recovering" | "interrupted" | "failed"
                    ) {
                        anyhow::bail!("task is {} and does not need recovery", task.status);
                    }
                    ensure_project_writer_available(&database, &task)?;
                    database.update_task_status(&task.id, "recovering")?
                };
                let execution_root = PathBuf::from(&task.execution_root);
                if !execution_root.is_dir() {
                    anyhow::bail!(
                        "task execution directory no longer exists: {}",
                        execution_root.display()
                    );
                }
                let diff = if task.project_id == LOBBY_PROJECT_ID {
                    git::GitDiff::empty()
                } else {
                    git::diff(&execution_root, &task.base_revision).await?
                };
                let resume_frame = resume_frame(&task, &diff);
                let (task, session, runtime, codex_version) =
                    self.runtime_for_task(&params.task_id).await?;
                let thread_id = self
                    .ensure_thread(&task, &session, &runtime, &codex_version)
                    .await?;
                let turn_id = runtime.start_turn(&resume_frame).await?;
                let database = self.database.lock().await;
                let task = database.update_task_status(&task.id, "running")?;
                database.set_runtime_status(&task.id, "running")?;
                database.record_event(
                    &task.id,
                    "user.message",
                    Some("recovery/resume"),
                    &json!({"text": resume_frame, "nativeTurnId": turn_id, "isResumeFrame": true}),
                )?;
                Ok(json!({"task": task, "threadId": thread_id, "turnId": turn_id}))
            }
            "tasks.send" => {
                let params: SendTaskParams = serde_json::from_value(request.params.clone())?;
                if params.text.trim().is_empty() {
                    anyhow::bail!("message cannot be empty");
                }
                let (task, session, runtime, codex_version) =
                    self.runtime_for_task(&params.task_id).await?;
                self.ensure_thread(&task, &session, &runtime, &codex_version)
                    .await?;
                let turn_id = runtime.send_or_steer(params.text.trim()).await?;
                let database = self.database.lock().await;
                let task = database.update_task_status(&task.id, "running")?;
                database.set_runtime_status(&task.id, "running")?;
                database.record_event(
                    &task.id,
                    "user.message",
                    None,
                    &json!({"text": params.text.trim(), "nativeTurnId": turn_id}),
                )?;
                Ok(json!({"task": task, "turnId": turn_id}))
            }
            "tasks.interrupt" => {
                let params: TaskIdParams = serde_json::from_value(request.params.clone())?;
                let runtime = self
                    .codex
                    .get(&params.task_id)
                    .await
                    .context("task does not have a running Codex worker")?;
                runtime.interrupt().await?;
                let database = self.database.lock().await;
                let task = database.update_task_status(&params.task_id, "interrupted")?;
                database.set_runtime_status(&params.task_id, "interrupted")?;
                Ok(serde_json::to_value(task)?)
            }
            "events.list" => {
                let params: ListTaskDataParams = serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                Ok(serde_json::to_value(database.list_events(
                    &params.task_id,
                    params.limit.unwrap_or(500).clamp(1, 2_000),
                )?)?)
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
            "approvals.list" => {
                let params: ListTaskDataParams = serde_json::from_value(request.params.clone())?;
                let database = self.database.lock().await;
                Ok(serde_json::to_value(
                    database.list_approvals(&params.task_id)?,
                )?)
            }
            "approvals.resolve" => {
                let params: ResolveApprovalParams = serde_json::from_value(request.params.clone())?;
                let approval = {
                    let database = self.database.lock().await;
                    database
                        .get_approval(&params.approval_id)?
                        .context("approval not found")?
                };
                if approval.status != "pending" {
                    anyhow::bail!("approval has already been resolved");
                }
                let runtime = self
                    .codex
                    .get(&approval.task_id)
                    .await
                    .context("approval runtime is no longer available")?;
                let native_id: Value = serde_json::from_str(&approval.native_request_id)?;
                let result = codex::approval_result(
                    &approval.approval_type,
                    &approval.request,
                    &params.decision,
                )?;
                runtime.respond(native_id, result.clone()).await?;
                let database = self.database.lock().await;
                let status = if matches!(params.decision.as_str(), "decline" | "cancel") {
                    "declined"
                } else {
                    "approved"
                };
                let approval = database.resolve_approval(&approval.id, status, &result)?;
                database.update_task_status(&approval.task_id, "running")?;
                database.record_event(
                    &approval.task_id,
                    "approval.resolved",
                    Some(&approval.approval_type),
                    &serde_json::to_value(&approval)?,
                )?;
                Ok(serde_json::to_value(approval)?)
            }
            "diagnostics.export" => {
                let database = self.database.lock().await;
                let profile_service = AgentProfileService::default();
                let projects = database.list_projects()?;
                let tasks = database.list_tasks(None)?;
                let mut task_records = Vec::with_capacity(tasks.len());
                for task in tasks {
                    let events = database.list_events(&task.id, 2_000)?;
                    let approvals = database.list_approvals(&task.id)?;
                    task_records.push(json!({
                        "task": task,
                        "events": events,
                        "approvals": approvals,
                    }));
                }
                Ok(json!({
                    "format": "lumen-diagnostics-v2",
                    "exportedAt": chrono::Utc::now().to_rfc3339(),
                    "appVersion": env!("CARGO_PKG_VERSION"),
                    "runtimeAdapter": "legacy-codex-transition",
                    "databasePath": database.path(),
                    "agents": profile_service.list_profiles(&database)?,
                    "adapterInstallations": profile_service.list_installations(&database)?,
                    "projects": projects,
                    "taskRecords": task_records,
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
                let (git, codex) = tokio::join!(health::git_health(), codex_probe);
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
        let probe = health::codex_runtime_probe().await;
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
                Some(_) if runtime_kind != "codex-cli" => {
                    blockers.push(StartPreflightBlocker {
                        code: "runtime_adapter_not_implemented".to_string(),
                        detail: Some(format!(
                            "{runtime_kind} will be enabled by its v0.03 Adapter checkpoint"
                        )),
                    });
                }
                Some(_) => match probe.status {
                    health::AgentRuntimeProbeStatus::Ready => {}
                    health::AgentRuntimeProbeStatus::NotInstalled => {
                        blockers.push(StartPreflightBlocker {
                            code: "runtime_not_installed".to_string(),
                            detail: probe.detail.clone(),
                        })
                    }
                    health::AgentRuntimeProbeStatus::AuthenticationRequired => {
                        blockers.push(StartPreflightBlocker {
                            code: "runtime_authentication_required".to_string(),
                            detail: probe.detail.clone(),
                        })
                    }
                    health::AgentRuntimeProbeStatus::MissingCapabilities => {
                        blockers.push(StartPreflightBlocker {
                            code: "runtime_capability_missing".to_string(),
                            detail: probe.detail.clone(),
                        })
                    }
                    health::AgentRuntimeProbeStatus::ProbeFailed => {
                        blockers.push(StartPreflightBlocker {
                            code: "runtime_probe_failed".to_string(),
                            detail: probe.detail.clone(),
                        })
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

    async fn runtime_for_task(
        &self,
        task_id: &str,
    ) -> Result<(Task, RuntimeSession, Arc<CodexRuntime>, String)> {
        let codex_version = codex::verify_runtime_ready().await?;
        let (task, session) = {
            let database = self.database.lock().await;
            let task = database.get_task(task_id)?.context("task not found")?;
            ensure_project_writer_available(&database, &task)?;
            let execution_root = PathBuf::from(&task.execution_root);
            if !execution_root.is_dir() {
                anyhow::bail!(
                    "task execution directory no longer exists: {}",
                    execution_root.display()
                );
            }
            let session =
                database.ensure_runtime_session(task_id, Some(&codex_version), &execution_root)?;
            (task, session)
        };
        let runtime = self
            .codex
            .ensure_runtime(task_id, PathBuf::from(&task.execution_root).as_path())
            .await?;
        Ok((task, session, runtime, codex_version))
    }

    async fn ensure_thread(
        &self,
        task: &Task,
        session: &RuntimeSession,
        runtime: &Arc<CodexRuntime>,
        codex_version: &str,
    ) -> Result<String> {
        if let Some(thread_id) = runtime.thread_id().await {
            return Ok(thread_id);
        }
        let thread_id = runtime
            .start_or_resume_thread(
                PathBuf::from(&task.execution_root).as_path(),
                session.native_thread_id.as_deref(),
            )
            .await;
        let (thread_id, session_id) = match thread_id {
            Ok(thread_id) => (thread_id, session.id.clone()),
            Err(error) if session.native_thread_id.is_some() => {
                let next_session = {
                    let database = self.database.lock().await;
                    let next = database.create_next_runtime_session(
                        &task.id,
                        Some(codex_version),
                        PathBuf::from(&task.execution_root).as_path(),
                    )?;
                    database.record_event(
                        &task.id,
                        "runtime.state",
                        Some("session/generation-changed"),
                        &json!({
                            "status": "recovering",
                            "sessionGeneration": next.session_generation,
                            "reason": format!("native thread resume failed: {error:#}")
                        }),
                    )?;
                    next
                };
                let thread_id = runtime
                    .start_or_resume_thread(PathBuf::from(&task.execution_root).as_path(), None)
                    .await
                    .context("failed to start a replacement Codex thread")?;
                (thread_id, next_session.id)
            }
            Err(error) => return Err(error),
        };
        let database = self.database.lock().await;
        database.set_runtime_thread(&session_id, &thread_id, "ready")?;
        Ok(thread_id)
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
        if let Err(error) = codex::verify_runtime_ready().await {
            eprintln!("queued AgentRuns are waiting for Codex: {error:#}");
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
                .codex
                .get_agent_run(&candidate.agent_run_id, candidate.target_execution_epoch)
                .await
            else {
                continue;
            };
            let lease_owner = format!(
                "codex-delivery:{}:{}",
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
                            component_id: "runtime-adapter:codex".to_string(),
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
                    "codex-action:{}:{}",
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
                                component_id: "runtime-adapter:codex".to_string(),
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
                                component_id: "runtime-adapter:codex".to_string(),
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

            let response = codex::approval_result(
                &candidate.native_method,
                &candidate.response_context,
                if approved { "accept" } else { "decline" },
            );
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
                                component_id: "runtime-adapter:codex".to_string(),
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
                                    "Codex authorization response may not have been received"
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
                    &format!("Codex authorization response failed: {error:#}"),
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
                            component_id: "runtime-adapter:codex".to_string(),
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
        let mut database = self.database.lock().await;
        if let Err(failure) = ActionSafetyService::default().fail_runtime_delivery(
            &mut database,
            &CommandEnvelope {
                command_id: uuid::Uuid::new_v4().to_string(),
                actor: ActorRef::System {
                    component_id: "runtime-adapter:codex".to_string(),
                },
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

    async fn launch_agent_run(
        &self,
        execution: &AgentRunExecution,
        output: &mpsc::UnboundedSender<String>,
    ) -> Result<()> {
        if execution.effective_config["runtimeAdapter"].as_str() != Some("codex-app-server") {
            anyhow::bail!("AgentRun selected an unsupported Runtime Adapter");
        }
        let execution_root = PathBuf::from(&execution.workspace.execution_root);
        if !execution_root.is_dir() {
            anyhow::bail!(
                "AgentRun execution directory no longer exists: {}",
                execution_root.display()
            );
        }
        let runtime = self
            .codex
            .ensure_agent_run_runtime(
                &execution.agent_run_id,
                execution.execution_epoch,
                &execution_root,
            )
            .await?;
        let instructions = agent_run_developer_instructions(execution);
        let model = execution.effective_config["model"].as_str();
        let thread = runtime
            .start_or_resume_agent_thread(
                &execution_root,
                execution.native_session_id.as_deref(),
                &instructions,
                &execution.workspace.access,
                model,
            )
            .await;
        let thread_id = match thread {
            Ok(thread_id) => thread_id,
            Err(error) if execution.native_session_id.is_some() => runtime
                .start_or_resume_agent_thread(
                    &execution_root,
                    None,
                    &instructions,
                    &execution.workspace.access,
                    model,
                )
                .await
                .with_context(|| {
                    format!("failed to replace unavailable Native Session: {error:#}")
                })?,
            Err(error) => return Err(error),
        };
        let binding = {
            let mut database = self.database.lock().await;
            ExecutionRuntimeService::default().bind_native_session(
                &mut database,
                &CommandEnvelope {
                    command_id: uuid::Uuid::new_v4().to_string(),
                    actor: ActorRef::System {
                        component_id: "runtime-adapter:codex".to_string(),
                    },
                    camp_id: Some(execution.camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: BindNativeSessionCommand {
                        conversation_id: execution.conversation_id.clone(),
                        agent_run_id: execution.agent_run_id.clone(),
                        expected_conversation_version: execution.conversation_version,
                        expected_execution_epoch: execution.execution_epoch,
                        previous_native_session_id: execution.native_session_id.clone(),
                        native_session_id: thread_id.clone(),
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
        let native_turn_id = runtime
            .start_turn(&agent_run_input(execution))
            .await
            .context("failed to start Codex turn")?;
        emit(
            output,
            "agent_run.started",
            json!({
                "campId": execution.camp_id,
                "campTurnId": execution.camp_turn_id,
                "agentRunId": execution.agent_run_id,
                "agentProfileId": execution.agent_profile_id,
                "executionEpoch": execution.execution_epoch,
                "hostInstanceId": runtime.host_instance_id(),
                "nativeThreadId": thread_id,
                "nativeTurnId": native_turn_id,
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
                        component_id: "runtime-adapter:codex".to_string(),
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
        if let Some(runtime) = self
            .codex
            .get_agent_run(&execution.agent_run_id, execution.execution_epoch)
            .await
        {
            runtime.shutdown().await;
        }
        self.codex
            .forget_agent_run(&execution.agent_run_id, execution.execution_epoch)
            .await;
    }
}

fn agent_run_developer_instructions(execution: &AgentRunExecution) -> String {
    let role_description = execution.effective_config["roleDescription"]
        .as_str()
        .unwrap_or("Lumen Camp Agent");
    let instructions = execution.effective_config["instructions"]
        .as_str()
        .unwrap_or("");
    format!(
        "{role_description}\n\n{instructions}\n\n\
         你正在 Lumen Camp 中以 AgentProfile {} 执行一个有边界的 AgentRun。\
         只承担本轮 purpose 指定的职责；保留用户已有修改，不重置或覆盖不属于本轮的工作。\
         最终回复必须给出可公开给 Camp 的结论、实际验证和剩余风险。\
         你可以报告工作完成，但不能自行把 Task 或 CampTurn 改为完成；权威状态由 Lumen Core 提交。",
        execution.agent_profile_id
    )
}

fn agent_run_input(execution: &AgentRunExecution) -> String {
    let mut prompt = format!(
        "## AgentRun responsibility\n\nPurpose: {}\nExpected output: {}\n",
        execution.purpose, execution.expected_output
    );
    if let Some(task_id) = &execution.task_id {
        prompt.push_str(&format!("Task ID: {task_id}\n"));
    }
    prompt.push_str(
        "\n## Frozen logical conversation context\n\n\
         The following immutable message prefix was selected when this AgentRun was created. \
         Treat repeated material already present in a resumed native session as context, not a new request.\n",
    );
    for message in &execution.context_messages {
        prompt.push_str(&format!(
            "\n[{}:{}:{}]\n{}\n",
            message.sequence, message.author_type, message.author_id, message.body
        ));
    }
    prompt.push_str(
        "\nExecute the responsibility now and finish with one public Camp-ready answer.\n",
    );
    prompt
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

fn task_execution_envelope(
    params: &CreateTaskAndQueueExecutionParams,
) -> CommandEnvelope<CreateTaskAndQueueExecutionCommand> {
    CommandEnvelope {
        command_id: params.command_id.clone(),
        actor: ActorRef::User {
            user_id: "local-user".to_string(),
        },
        camp_id: Some(params.camp_id.clone()),
        expected_versions: Vec::new(),
        execution_epoch: None,
        payload: CreateTaskAndQueueExecutionCommand {
            camp_id: params.camp_id.clone(),
            title: params.title.clone(),
            objective: params.objective.clone(),
            acceptance_criteria: params.acceptance_criteria.clone(),
            assignee_agent_id: params.assignee_agent_id.clone(),
            dedup_key: params.dedup_key.clone(),
            purpose: params.purpose.clone(),
            expected_output: params.expected_output.clone(),
            workspace: params.workspace.clone(),
        },
    }
}

fn task_title(goal: &str) -> String {
    let first_line = goal.lines().next().unwrap_or("新任务").trim();
    let mut title = first_line.chars().take(48).collect::<String>();
    if first_line.chars().count() > 48 {
        title.push('…');
    }
    if title.is_empty() {
        "新任务".to_string()
    } else {
        title
    }
}

fn task_start_prompt(task: &Task) -> String {
    if task.project_id != LOBBY_PROJECT_ID {
        return task.goal.clone();
    }
    format!(
        "你正在 Lumen 的默认大厅中与用户对话。这里没有绑定任何用户项目，不要主动搜索、读取或修改用户项目目录。只使用用户在对话中明确提供的上下文；如需项目代码，请先建议用户显式选择项目。高风险操作仍需审批。\n\n用户目标：\n{}",
        task.goal
    )
}

fn ensure_project_writer_available(database: &Database, task: &Task) -> Result<()> {
    if let Some(active) = database.active_task_for_project(&task.project_id, &task.id)? {
        anyhow::bail!(
            "project already has an active coding task: {} ({})",
            active.title,
            active.status
        );
    }
    Ok(())
}

fn resume_frame(task: &Task, diff: &git::GitDiff) -> String {
    if task.project_id == LOBBY_PROJECT_ID {
        return format!(
            "这是 Lumen 在应用重启后为默认大厅对话生成的结构化 Resume Frame。不要重放完整历史，也不要假设上一个 Turn 仍在运行。\n\n顶层目标：\n{}\n\n此对话没有绑定用户项目。不要主动搜索、读取或修改任何用户项目目录；请根据已保存的目标和用户随后提供的上下文继续。",
            task.goal
        );
    }
    let status = if diff.status.is_empty() {
        "（项目目录当前没有未提交变更）".to_string()
    } else {
        diff.status.join("\n")
    };
    let stat = if diff.stat.trim().is_empty() {
        "（无 Diff 统计）"
    } else {
        diff.stat.trim()
    };
    format!(
        "这是 Lumen 在应用重启后生成的结构化 Resume Frame。不要重放完整历史，也不要假设上一个 Turn 仍在运行。\n\n顶层目标：\n{}\n\n任务起点：{}\n开始时分支：{}\n执行目录：{}\n\n当前 Git 状态：\n{}\n\n当前 Diff 统计：\n{}\n\n请先检查现有文件和变更，保留用户与 Agent 已经正确完成的工作；不要重置、覆盖或丢弃现有修改，再继续完成目标并运行必要验证。",
        task.goal, task.base_revision, task.start_branch, task.execution_root, status, stat,
    )
}

#[tokio::main]
async fn main() -> Result<()> {
    let data_dir = parse_data_dir()?;
    let mut database = Database::open(&data_dir)?;
    let lobby_root = data_dir.join("lobby");
    std::fs::create_dir_all(&lobby_root)
        .with_context(|| format!("failed to create default lobby at {}", lobby_root.display()))?;
    database.ensure_lobby_project(&lobby_root)?;
    let recovering_tasks = database.prepare_recovery()?;
    let v2_recovery = database.prepare_v2_recovery()?;
    if v2_recovery.runs_waiting_for_recovery != 0
        || v2_recovery.actions_returned_to_prepared != 0
        || v2_recovery.actions_marked_unknown != 0
        || v2_recovery.intercepted_actions_failed_closed != 0
        || v2_recovery.action_approvals_cancelled != 0
        || v2_recovery.deliveries_returned_to_pending != 0
        || v2_recovery.authorization_deliveries_failed_closed != 0
    {
        eprintln!(
            "v0.02 recovery prepared: {}",
            serde_json::to_string(&v2_recovery)?
        );
    }
    for task in &recovering_tasks {
        database.record_event(
            &task.id,
            "runtime.state",
            Some("application/restarted"),
            &json!({"status": "recovering", "requiresUserConfirmation": true}),
        )?;
    }
    let (codex_tx, codex_rx) = mpsc::unbounded_channel();
    let (output_tx, output_rx) = mpsc::unbounded_channel();
    let output_handle = tokio::spawn(write_output(output_rx));
    let (event_shutdown_tx, event_shutdown_rx) = oneshot::channel();
    let core = Arc::new(Core {
        database: Mutex::new(database),
        codex: CodexManager::new(codex_tx),
        data_dir,
    });
    let event_handle = tokio::spawn(process_codex_events(
        core.clone(),
        codex_rx,
        output_tx.clone(),
        event_shutdown_rx,
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
    let _ = event_shutdown_tx.send(());
    let _ = event_handle.await;
    core.codex.shutdown_all().await;
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
            CodexIncoming::Message { task_id, message } => {
                let method = message
                    .get("method")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
                    .to_string();
                let params = message.get("params").cloned().unwrap_or(Value::Null);
                if message.get("id").is_some() {
                    let id = message.get("id").cloned().unwrap_or(Value::Null);
                    if codex::is_approval_method(&method) {
                        let native_id =
                            serde_json::to_string(&id).unwrap_or_else(|_| "null".into());
                        let approval = {
                            let database = core.database.lock().await;
                            match database.insert_approval(&task_id, &native_id, &method, &params) {
                                Ok(approval) => {
                                    let _ =
                                        database.update_task_status(&task_id, "waiting_approval");
                                    let _ = database.record_event(
                                        &task_id,
                                        "approval.requested",
                                        Some(&method),
                                        &serde_json::to_value(&approval).unwrap_or(Value::Null),
                                    );
                                    Some(approval)
                                }
                                Err(error) => {
                                    eprintln!("failed to persist approval: {error:#}");
                                    None
                                }
                            }
                        };
                        if let Some(approval) = approval {
                            emit(
                                &output,
                                "approval.requested",
                                json!({"taskId": task_id, "approval": approval}),
                            );
                        } else if let Some(runtime) = core.codex.get(&task_id).await {
                            let _ = runtime
                                .respond_error(id, "Lumen could not persist this approval request")
                                .await;
                        }
                    } else if let Some(runtime) = core.codex.get(&task_id).await {
                        let _ = runtime
                            .respond_error(
                                id,
                                "This app-server request is not supported by Lumen v0.01",
                            )
                            .await;
                        emit(
                            &output,
                            "error",
                            json!({
                                "taskId": task_id,
                                "message": format!("Unsupported app-server request: {method}")
                            }),
                        );
                    }
                    continue;
                }

                let (event_type, payload) = codex::normalize_event(&method, &params);
                {
                    let database = core.database.lock().await;
                    let _ = database.record_event(&task_id, event_type, Some(&method), &payload);
                    if method == "turn/completed" {
                        let status = params
                            .pointer("/turn/status")
                            .and_then(Value::as_str)
                            .unwrap_or("completed");
                        let task_status = match status {
                            "interrupted" => "interrupted",
                            "failed" => "failed",
                            _ => "completed",
                        };
                        let _ = database.update_task_status(&task_id, task_status);
                        let _ = database.set_runtime_status(&task_id, task_status);
                    }
                }
                if method == "turn/completed"
                    && let Some(runtime) = core.codex.get(&task_id).await
                {
                    let completed_id = params.pointer("/turn/id").and_then(Value::as_str);
                    runtime.clear_turn(completed_id).await;
                }
                emit(
                    &output,
                    event_type,
                    json!({
                        "taskId": task_id,
                        "nativeMethod": method,
                        "payload": payload
                    }),
                );
            }
            CodexIncoming::Stderr { task_id, text } => {
                if !text.trim().is_empty() {
                    let database = core.database.lock().await;
                    let _ = database.record_event(
                        &task_id,
                        "runtime.log",
                        Some("stderr"),
                        &json!({"text": text}),
                    );
                }
            }
            CodexIncoming::Exited { task_id } => {
                core.codex.forget(&task_id).await;
                {
                    let database = core.database.lock().await;
                    let _ = database.set_runtime_status(&task_id, "interrupted");
                    if let Ok(Some(task)) = database.get_task(&task_id)
                        && matches!(
                            task.status.as_str(),
                            "running" | "waiting_approval" | "preparing"
                        )
                    {
                        let _ = database.update_task_status(&task_id, "interrupted");
                    }
                    let _ = database.record_event(
                        &task_id,
                        "runtime.state",
                        Some("process/exit"),
                        &json!({"status": "interrupted"}),
                    );
                }
                emit(
                    &output,
                    "runtime.state",
                    json!({"taskId": task_id, "status": "interrupted"}),
                );
            }
            CodexIncoming::AgentRunMessage {
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
            CodexIncoming::AgentRunStderr {
                host_instance_id,
                agent_run_id,
                execution_epoch,
                text,
            } => {
                if !text.trim().is_empty()
                    && core
                        .codex
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
            CodexIncoming::AgentRunExited {
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

async fn process_agent_run_codex_message(
    core: &Arc<Core>,
    output: &mpsc::UnboundedSender<String>,
    host_instance_id: &str,
    agent_run_id: &str,
    execution_epoch: i64,
    message: Value,
) {
    let Some(runtime) = core
        .codex
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
    core.codex
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
        .codex
        .get_agent_run_on_host(host_instance_id, agent_run_id, execution_epoch)
        .await
        .is_none()
    {
        return;
    }
    core.codex
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
    loop {
        tokio::select! {
            _ = interval.tick() => {
                core.dispatch_runtime_deliveries(&output).await;
                core.dispatch_agent_runs(&output).await;
            },
            _ = &mut shutdown => break,
        }
    }
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

    #[test]
    fn task_title_uses_first_line_and_has_a_stable_limit() {
        assert_eq!(task_title("修复审批交互\n并运行测试"), "修复审批交互");
        let title = task_title(&"路".repeat(60));
        assert_eq!(title.chars().count(), 49);
        assert!(title.ends_with('…'));
    }

    #[test]
    fn resume_frame_contains_state_not_transcript() {
        let task = Task {
            id: "task-1".into(),
            project_id: "project-1".into(),
            owner_agent_id: "agent-muwa".into(),
            title: "继续任务".into(),
            goal: "完成诊断导出".into(),
            status: "recovering".into(),
            execution_root: "/tmp/lumen-project".into(),
            start_branch: "main".into(),
            base_revision: "abc123".into(),
            created_at: "2026-07-17T00:00:00Z".into(),
            updated_at: "2026-07-17T00:00:00Z".into(),
            completed_at: None,
        };
        let diff = git::GitDiff {
            status: vec![" M README.md".into()],
            is_clean: false,
            changed_file_count: 1,
            stat: "README.md | 1 +".into(),
            patch: "ignored transcript-sized patch".into(),
        };

        let frame = resume_frame(&task, &diff);
        assert!(frame.contains("完成诊断导出"));
        assert!(frame.contains(" M README.md"));
        assert!(!frame.contains("ignored transcript-sized patch"));
    }

    #[test]
    fn lobby_prompt_has_no_implicit_project_access() {
        let task = Task {
            id: "task-lobby".into(),
            project_id: LOBBY_PROJECT_ID.into(),
            owner_agent_id: "agent-muwa".into(),
            title: "讨论方案".into(),
            goal: "帮我梳理产品方向".into(),
            status: "draft".into(),
            execution_root: "/tmp/lumen-lobby".into(),
            start_branch: "main".into(),
            base_revision: "abc123".into(),
            created_at: "2026-07-17T00:00:00Z".into(),
            updated_at: "2026-07-17T00:00:00Z".into(),
            completed_at: None,
        };

        let prompt = task_start_prompt(&task);
        let frame = resume_frame(&task, &git::GitDiff::empty());
        assert!(prompt.contains("没有绑定任何用户项目"));
        assert!(prompt.contains("帮我梳理产品方向"));
        assert!(frame.contains("默认大厅对话"));
        assert!(!frame.contains("当前 Git 状态"));
    }

    #[tokio::test]
    async fn task_creation_without_project_defaults_to_lobby() {
        let directory =
            std::env::temp_dir().join(format!("lumen-core-lobby-test-{}", uuid::Uuid::new_v4()));
        let database = Database::open(&directory).expect("database should open");
        let lobby_root = directory.join("lobby");
        std::fs::create_dir_all(&lobby_root).expect("lobby should initialize");
        database
            .ensure_lobby_project(&lobby_root)
            .expect("lobby should persist");
        let (codex_tx, _codex_rx) = mpsc::unbounded_channel();
        let core = Core {
            database: Mutex::new(database),
            codex: CodexManager::new(codex_tx),
            data_dir: directory.clone(),
        };
        let result = core
            .handle(&Request {
                id: Value::Null,
                method: "tasks.create".into(),
                params: json!({"goal": "梳理产品方向"}),
            })
            .await
            .expect("task should be created");

        assert_eq!(
            result.get("projectId").and_then(Value::as_str),
            Some(LOBBY_PROJECT_ID)
        );
        assert_eq!(
            result.get("executionRoot").and_then(Value::as_str),
            lobby_root.to_str()
        );
        drop(core);
        std::fs::remove_dir_all(directory).expect("temporary lobby should be removable");
    }
}
