mod codex;
mod db;
mod git;
mod health;

use std::{path::PathBuf, sync::Arc};

use anyhow::{Context, Result};
use codex::{CodexIncoming, CodexManager, CodexRuntime};
use db::{Database, RuntimeSession, Task};
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
    project_id: String,
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
                        .get_project(&params.project_id)?
                        .context("project not found")?
                };
                let project_path = PathBuf::from(&project.root_path);
                let info = git::inspect_project(&project_path).await?;
                let task_id = uuid::Uuid::new_v4().to_string();
                let worktree = git::create_worktree(
                    &info.root_path,
                    &info.head,
                    &self.data_dir,
                    &project.id,
                    &task_id,
                )
                .await?;
                let title = params.title.unwrap_or_else(|| task_title(&params.goal));
                let database = self.database.lock().await;
                let task = database.insert_task(
                    &task_id,
                    &project.id,
                    &title,
                    params.goal.trim(),
                    &worktree.path,
                    &worktree.branch_name,
                    &info.head,
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
                let diff = git::diff(
                    PathBuf::from(task.worktree_path).as_path(),
                    &task.base_revision,
                )
                .await?;
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
                    database.update_task_status(&task.id, "preparing")?;
                }
                let outcome: Result<Value> = async {
                    let (task, session, runtime) = self.runtime_for_task(&params.task_id).await?;
                    let thread_id = self.ensure_thread(&task, &session, &runtime).await?;
                    let turn_id = runtime.start_turn(&task.goal).await?;
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
                    database.update_task_status(&task.id, "recovering")?
                };
                let worktree_path = PathBuf::from(&task.worktree_path);
                if !worktree_path.is_dir() {
                    anyhow::bail!(
                        "task Worktree no longer exists: {}",
                        worktree_path.display()
                    );
                }
                let diff = git::diff(&worktree_path, &task.base_revision).await?;
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
                    "format": "lumen-diagnostics-v1",
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
            let session = database.ensure_runtime_session(
                task_id,
                Some(&codex_version),
                PathBuf::from(&task.worktree_path).as_path(),
            )?;
            (task, session)
        };
        let runtime = self
            .codex
            .ensure_runtime(task_id, PathBuf::from(&task.worktree_path).as_path())
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
                PathBuf::from(&task.worktree_path).as_path(),
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
                        PathBuf::from(&task.worktree_path).as_path(),
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
                    .start_or_resume_thread(PathBuf::from(&task.worktree_path).as_path(), None)
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

fn resume_frame(task: &Task, diff: &git::GitDiff) -> String {
    let status = if diff.status.is_empty() {
        "（Worktree 当前没有未提交变更）".to_string()
    } else {
        diff.status.join("\n")
    };
    let stat = if diff.stat.trim().is_empty() {
        "（无 Diff 统计）"
    } else {
        diff.stat.trim()
    };
    format!(
        "这是 Lumen 在应用重启后生成的结构化 Resume Frame。不要重放完整历史，也不要假设上一个 Turn 仍在运行。\n\n顶层目标：\n{}\n\n任务起点：{}\n任务分支：{}\nWorktree：{}\n\n当前 Git 状态：\n{}\n\n当前 Diff 统计：\n{}\n\n请先检查现有文件和变更，保留已经正确完成的工作，再继续完成目标并运行必要验证。",
        task.goal, task.base_revision, task.branch_name, task.worktree_path, status, stat,
    )
}

#[tokio::main]
async fn main() -> Result<()> {
    let data_dir = parse_data_dir()?;
    let database = Database::open(&data_dir)?;
    let recovering_tasks = database.prepare_recovery()?;
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

    core.codex.shutdown_all().await;
    let _ = event_shutdown_tx.send(());
    let _ = event_handle.await;
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
            worktree_path: "/tmp/lumen-worktree".into(),
            branch_name: "lumen/task-1".into(),
            base_revision: "abc123".into(),
            created_at: "2026-07-17T00:00:00Z".into(),
            updated_at: "2026-07-17T00:00:00Z".into(),
            completed_at: None,
        };
        let diff = git::GitDiff {
            status: vec![" M README.md".into()],
            stat: "README.md | 1 +".into(),
            patch: "ignored transcript-sized patch".into(),
        };

        let frame = resume_frame(&task, &diff);
        assert!(frame.contains("完成诊断导出"));
        assert!(frame.contains(" M README.md"));
        assert!(!frame.contains("ignored transcript-sized patch"));
    }
}
