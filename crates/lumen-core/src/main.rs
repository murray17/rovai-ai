mod codex;
mod git;
mod health;

use std::{path::PathBuf, sync::Arc};

use anyhow::{Context, Result};
use codex::{CodexIncoming, CodexManager, CodexRuntime};
use lumen_core::{
    command::{ActorRef, CommandEnvelope},
    db::{Database, LOBBY_PROJECT_ID, RuntimeSession, Task},
    evidence::{CompleteTaskCommand, CriterionEvidenceInput, EvidenceService},
    read_model::ReadModelService,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter},
    sync::{Mutex, mpsc, oneshot},
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
                Ok(serde_json::to_value(database.list_agents()?)?)
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
                    let (task, session, runtime) = self.runtime_for_task(&params.task_id).await?;
                    let thread_id = self.ensure_thread(&task, &session, &runtime).await?;
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
                let (task, session, runtime) = self.runtime_for_task(&params.task_id).await?;
                let thread_id = self.ensure_thread(&task, &session, &runtime).await?;
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
                let (task, session, runtime) = self.runtime_for_task(&params.task_id).await?;
                self.ensure_thread(&task, &session, &runtime).await?;
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
                    "codexCompatibilityBaseline": codex::codex_version_baseline(),
                    "databasePath": database.path(),
                    "agents": database.list_agents()?,
                    "projects": projects,
                    "taskRecords": task_records,
                }))
            }
            "health.check" => {
                let (git, codex) = tokio::join!(health::git_health(), health::codex_health());
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

    async fn runtime_for_task(
        &self,
        task_id: &str,
    ) -> Result<(Task, RuntimeSession, Arc<CodexRuntime>)> {
        let codex_version = codex::verify_compatibility().await?;
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
        Ok((task, session, runtime))
    }

    async fn ensure_thread(
        &self,
        task: &Task,
        session: &RuntimeSession,
        runtime: &Arc<CodexRuntime>,
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
                        Some(codex::codex_version_baseline()),
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
