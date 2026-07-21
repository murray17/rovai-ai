use std::{
    collections::HashMap,
    path::Path,
    process::Stdio,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{Mutex, RwLock, mpsc, oneshot},
    time::timeout,
};

use crate::health;

#[derive(Debug)]
pub enum CodexIncoming {
    Message {
        task_id: String,
        message: Value,
    },
    Stderr {
        task_id: String,
        text: String,
    },
    Exited {
        task_id: String,
    },
    AgentRunMessage {
        agent_run_id: String,
        execution_epoch: i64,
        message: Value,
    },
    AgentRunStderr {
        agent_run_id: String,
        execution_epoch: i64,
        text: String,
    },
    AgentRunExited {
        agent_run_id: String,
        execution_epoch: i64,
    },
}

#[derive(Debug, Clone)]
enum CodexRuntimeOwner {
    LegacyTask {
        task_id: String,
    },
    AgentRun {
        agent_run_id: String,
        execution_epoch: i64,
    },
}

impl CodexRuntimeOwner {
    fn message(&self, message: Value) -> CodexIncoming {
        match self {
            Self::LegacyTask { task_id } => CodexIncoming::Message {
                task_id: task_id.clone(),
                message,
            },
            Self::AgentRun {
                agent_run_id,
                execution_epoch,
            } => CodexIncoming::AgentRunMessage {
                agent_run_id: agent_run_id.clone(),
                execution_epoch: *execution_epoch,
                message,
            },
        }
    }

    fn stderr(&self, text: String) -> CodexIncoming {
        match self {
            Self::LegacyTask { task_id } => CodexIncoming::Stderr {
                task_id: task_id.clone(),
                text,
            },
            Self::AgentRun {
                agent_run_id,
                execution_epoch,
            } => CodexIncoming::AgentRunStderr {
                agent_run_id: agent_run_id.clone(),
                execution_epoch: *execution_epoch,
                text,
            },
        }
    }

    fn exited(&self) -> CodexIncoming {
        match self {
            Self::LegacyTask { task_id } => CodexIncoming::Exited {
                task_id: task_id.clone(),
            },
            Self::AgentRun {
                agent_run_id,
                execution_epoch,
            } => CodexIncoming::AgentRunExited {
                agent_run_id: agent_run_id.clone(),
                execution_epoch: *execution_epoch,
            },
        }
    }

    fn agent_run_epoch(&self) -> Option<i64> {
        match self {
            Self::AgentRun {
                execution_epoch, ..
            } => Some(*execution_epoch),
            Self::LegacyTask { .. } => None,
        }
    }
}

pub struct CodexRuntime {
    owner: CodexRuntimeOwner,
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pending: Mutex<HashMap<u64, oneshot::Sender<std::result::Result<Value, String>>>>,
    next_id: AtomicU64,
    thread_id: RwLock<Option<String>>,
    turn_id: RwLock<Option<String>>,
    streamed_agent_text: Mutex<String>,
    completed_agent_message: RwLock<Option<String>>,
}

impl CodexRuntime {
    async fn spawn(
        owner: CodexRuntimeOwner,
        cwd: &Path,
        incoming: mpsc::UnboundedSender<CodexIncoming>,
    ) -> Result<Arc<Self>> {
        let codex_path = health::find_codex().context("Codex CLI was not found")?;
        let mut child = Command::new(&codex_path)
            .args(["app-server", "--listen", "stdio://"])
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .with_context(|| format!("failed to start {} app-server", codex_path.display()))?;

        let stdin = child
            .stdin
            .take()
            .context("Codex app-server stdin was unavailable")?;
        let stdout = child
            .stdout
            .take()
            .context("Codex app-server stdout was unavailable")?;
        let stderr = child
            .stderr
            .take()
            .context("Codex app-server stderr was unavailable")?;

        let runtime = Arc::new(Self {
            owner,
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            thread_id: RwLock::new(None),
            turn_id: RwLock::new(None),
            streamed_agent_text: Mutex::new(String::new()),
            completed_agent_message: RwLock::new(None),
        });

        Self::spawn_stdout_reader(runtime.clone(), stdout, incoming.clone());
        Self::spawn_stderr_reader(runtime.owner.clone(), stderr, incoming);

        runtime
            .rpc(
                "initialize",
                json!({
                    "clientInfo": {
                        "name": "lumen_ai",
                        "title": "Lumen AI",
                        "version": env!("CARGO_PKG_VERSION")
                    }
                }),
            )
            .await
            .context("Codex app-server initialize failed")?;
        runtime.notify("initialized", json!({})).await?;
        Ok(runtime)
    }

    fn spawn_stdout_reader(
        runtime: Arc<Self>,
        stdout: tokio::process::ChildStdout,
        incoming: mpsc::UnboundedSender<CodexIncoming>,
    ) {
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) if !line.trim().is_empty() => {
                        let message = match serde_json::from_str::<Value>(&line) {
                            Ok(message) => message,
                            Err(error) => {
                                let _ =
                                    incoming.send(runtime.owner.stderr(format!(
                                        "invalid app-server JSON: {error}: {line}"
                                    )));
                                continue;
                            }
                        };

                        let is_response = message.get("method").is_none()
                            && message.get("id").and_then(Value::as_u64).is_some();
                        if is_response {
                            let id = message["id"].as_u64().expect("checked above");
                            if let Some(sender) = runtime.pending.lock().await.remove(&id) {
                                let response = if let Some(error) = message.get("error") {
                                    Err(error
                                        .get("message")
                                        .and_then(Value::as_str)
                                        .unwrap_or("Codex request failed")
                                        .to_string())
                                } else {
                                    Ok(message.get("result").cloned().unwrap_or(Value::Null))
                                };
                                let _ = sender.send(response);
                            }
                        } else {
                            let _ = incoming.send(runtime.owner.message(message));
                        }
                    }
                    Ok(Some(_)) => {}
                    Ok(None) => break,
                    Err(error) => {
                        let _ = incoming.send(
                            runtime
                                .owner
                                .stderr(format!("app-server stdout failed: {error}")),
                        );
                        break;
                    }
                }
            }
            let _ = incoming.send(runtime.owner.exited());
        });
    }

    fn spawn_stderr_reader(
        owner: CodexRuntimeOwner,
        stderr: tokio::process::ChildStderr,
        incoming: mpsc::UnboundedSender<CodexIncoming>,
    ) {
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if !line.trim().is_empty() {
                    let _ = incoming.send(owner.stderr(line));
                }
            }
        });
    }

    pub async fn start_or_resume_thread(
        &self,
        cwd: &Path,
        existing_thread_id: Option<&str>,
    ) -> Result<String> {
        let instructions = concat!(
            "你是沐瓦，Lumen AI 的核心开发伙伴。",
            "直接在当前项目目录中工作；先检查 Git 状态并保留用户已有修改，再进行最小、可验证的实现。",
            "清楚报告运行的命令、验证结果、剩余风险和文件变更。",
            "不要重置、覆盖或丢弃不属于当前任务的修改。除非用户明确要求，不切换分支、创建 Worktree 或提交。",
            "Push、创建 PR、访问凭据或修改项目目录之外的文件属于高风险操作；仅在任务明确要求时通过 Lumen 发起逐次审批，批准前不得执行。"
        );
        self.start_or_resume_thread_with_config(
            cwd,
            existing_thread_id,
            instructions,
            "workspace-write",
            None,
        )
        .await
    }

    pub async fn start_or_resume_agent_thread(
        &self,
        cwd: &Path,
        existing_thread_id: Option<&str>,
        developer_instructions: &str,
        workspace_access: &str,
        model: Option<&str>,
    ) -> Result<String> {
        let sandbox = match workspace_access {
            "read_only" => "read-only",
            "write" => "workspace-write",
            value => bail!("unsupported AgentRun workspace access: {value}"),
        };
        self.start_or_resume_thread_with_config(
            cwd,
            existing_thread_id,
            developer_instructions,
            sandbox,
            model.filter(|model| *model != "default"),
        )
        .await
    }

    async fn start_or_resume_thread_with_config(
        &self,
        cwd: &Path,
        existing_thread_id: Option<&str>,
        developer_instructions: &str,
        sandbox: &str,
        model: Option<&str>,
    ) -> Result<String> {
        let cwd = cwd.to_string_lossy();
        let mut request = json!({
            "cwd": cwd,
            "approvalPolicy": "on-request",
            "approvalsReviewer": "user",
            "sandbox": sandbox,
            "developerInstructions": developer_instructions,
        });
        if let Some(model) = model {
            request
                .as_object_mut()
                .expect("thread request is an object")
                .insert("model".to_string(), Value::String(model.to_string()));
        }
        let result = if let Some(thread_id) = existing_thread_id {
            request
                .as_object_mut()
                .expect("thread request is an object")
                .insert("threadId".to_string(), Value::String(thread_id.to_string()));
            self.rpc("thread/resume", request).await?
        } else {
            self.rpc("thread/start", request).await?
        };
        let thread_id = result
            .pointer("/thread/id")
            .and_then(Value::as_str)
            .context("Codex thread response did not include thread.id")?
            .to_string();
        *self.thread_id.write().await = Some(thread_id.clone());
        Ok(thread_id)
    }

    pub async fn start_turn(&self, text: &str) -> Result<String> {
        self.streamed_agent_text.lock().await.clear();
        *self.completed_agent_message.write().await = None;
        let thread_id = self
            .thread_id()
            .await
            .context("Codex thread is not ready")?;
        let result = self
            .rpc(
                "turn/start",
                json!({
                    "threadId": thread_id,
                    "clientUserMessageId": uuid::Uuid::new_v4().to_string(),
                    "input": [{"type": "text", "text": text}]
                }),
            )
            .await?;
        let turn_id = result
            .pointer("/turn/id")
            .and_then(Value::as_str)
            .context("Codex turn response did not include turn.id")?
            .to_string();
        *self.turn_id.write().await = Some(turn_id.clone());
        Ok(turn_id)
    }

    pub async fn send_or_steer(&self, text: &str) -> Result<String> {
        let Some(turn_id) = self.turn_id().await else {
            return self.start_turn(text).await;
        };
        let thread_id = self
            .thread_id()
            .await
            .context("Codex thread is not ready")?;
        self.rpc(
            "turn/steer",
            json!({
                "threadId": thread_id,
                "expectedTurnId": turn_id,
                "clientUserMessageId": uuid::Uuid::new_v4().to_string(),
                "input": [{"type": "text", "text": text}]
            }),
        )
        .await?;
        Ok(turn_id)
    }

    pub async fn interrupt(&self) -> Result<()> {
        let thread_id = self
            .thread_id()
            .await
            .context("Codex thread is not ready")?;
        let turn_id = self
            .turn_id()
            .await
            .context("there is no active Codex turn")?;
        self.rpc(
            "turn/interrupt",
            json!({"threadId": thread_id, "turnId": turn_id}),
        )
        .await?;
        Ok(())
    }

    pub async fn clear_turn(&self, completed_turn_id: Option<&str>) {
        let mut current = self.turn_id.write().await;
        if completed_turn_id.is_none() || current.as_deref() == completed_turn_id {
            *current = None;
        }
    }

    pub async fn respond(&self, id: Value, result: Value) -> Result<()> {
        self.send(json!({"id": id, "result": result})).await
    }

    pub async fn respond_error(&self, id: Value, message: &str) -> Result<()> {
        self.send(json!({
            "id": id,
            "error": {"code": -32601, "message": message}
        }))
        .await
    }

    pub async fn thread_id(&self) -> Option<String> {
        self.thread_id.read().await.clone()
    }

    pub async fn turn_id(&self) -> Option<String> {
        self.turn_id.read().await.clone()
    }

    pub async fn observe_agent_message(&self, method: &str, params: &Value) {
        match method {
            "item/agentMessage/delta" => {
                if let Some(delta) = params.get("delta").and_then(Value::as_str) {
                    self.streamed_agent_text.lock().await.push_str(delta);
                }
            }
            "item/completed"
                if params.pointer("/item/type").and_then(Value::as_str) == Some("agentMessage") =>
            {
                if let Some(text) = params.pointer("/item/text").and_then(Value::as_str)
                    && !text.trim().is_empty()
                {
                    *self.completed_agent_message.write().await = Some(text.to_string());
                }
            }
            _ => {}
        }
    }

    pub async fn final_agent_message(&self) -> Option<String> {
        if let Some(message) = self.completed_agent_message.read().await.clone() {
            return Some(message);
        }
        let streamed = self.streamed_agent_text.lock().await.trim().to_string();
        (!streamed.is_empty()).then_some(streamed)
    }

    pub fn agent_run_epoch(&self) -> Option<i64> {
        self.owner.agent_run_epoch()
    }

    pub async fn shutdown(&self) {
        let mut child = self.child.lock().await;
        let _ = child.kill().await;
    }

    async fn rpc(&self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().await.insert(id, sender);
        if let Err(error) = self
            .send(json!({"method": method, "id": id, "params": params}))
            .await
        {
            self.pending.lock().await.remove(&id);
            return Err(error);
        }
        let response = timeout(Duration::from_secs(45), receiver)
            .await
            .with_context(|| format!("Codex request timed out: {method}"))?
            .with_context(|| format!("Codex response channel closed: {method}"))?;
        response.map_err(|message| anyhow::anyhow!("{method}: {message}"))
    }

    async fn notify(&self, method: &str, params: Value) -> Result<()> {
        self.send(json!({"method": method, "params": params})).await
    }

    async fn send(&self, message: Value) -> Result<()> {
        let mut stdin = self.stdin.lock().await;
        stdin
            .write_all(serde_json::to_string(&message)?.as_bytes())
            .await?;
        stdin.write_all(b"\n").await?;
        stdin.flush().await?;
        Ok(())
    }
}

pub struct CodexManager {
    legacy_runtimes: Mutex<HashMap<String, Arc<CodexRuntime>>>,
    agent_run_runtimes: Mutex<HashMap<String, Arc<CodexRuntime>>>,
    incoming: mpsc::UnboundedSender<CodexIncoming>,
}

impl CodexManager {
    pub fn new(incoming: mpsc::UnboundedSender<CodexIncoming>) -> Self {
        Self {
            legacy_runtimes: Mutex::new(HashMap::new()),
            agent_run_runtimes: Mutex::new(HashMap::new()),
            incoming,
        }
    }

    pub async fn ensure_runtime(&self, task_id: &str, cwd: &Path) -> Result<Arc<CodexRuntime>> {
        if let Some(runtime) = self.legacy_runtimes.lock().await.get(task_id).cloned() {
            return Ok(runtime);
        }
        let runtime = CodexRuntime::spawn(
            CodexRuntimeOwner::LegacyTask {
                task_id: task_id.to_string(),
            },
            cwd,
            self.incoming.clone(),
        )
        .await?;
        self.legacy_runtimes
            .lock()
            .await
            .insert(task_id.to_string(), runtime.clone());
        Ok(runtime)
    }

    pub async fn get(&self, task_id: &str) -> Option<Arc<CodexRuntime>> {
        self.legacy_runtimes.lock().await.get(task_id).cloned()
    }

    pub async fn forget(&self, task_id: &str) {
        self.legacy_runtimes.lock().await.remove(task_id);
    }

    pub async fn ensure_agent_run_runtime(
        &self,
        agent_run_id: &str,
        execution_epoch: i64,
        cwd: &Path,
    ) -> Result<Arc<CodexRuntime>> {
        let existing = self
            .agent_run_runtimes
            .lock()
            .await
            .get(agent_run_id)
            .cloned();
        if let Some(runtime) = existing {
            if runtime.agent_run_epoch() == Some(execution_epoch) {
                return Ok(runtime);
            }
            runtime.shutdown().await;
            self.agent_run_runtimes.lock().await.remove(agent_run_id);
        }
        let runtime = CodexRuntime::spawn(
            CodexRuntimeOwner::AgentRun {
                agent_run_id: agent_run_id.to_string(),
                execution_epoch,
            },
            cwd,
            self.incoming.clone(),
        )
        .await?;
        self.agent_run_runtimes
            .lock()
            .await
            .insert(agent_run_id.to_string(), runtime.clone());
        Ok(runtime)
    }

    pub async fn get_agent_run(
        &self,
        agent_run_id: &str,
        execution_epoch: i64,
    ) -> Option<Arc<CodexRuntime>> {
        self.agent_run_runtimes
            .lock()
            .await
            .get(agent_run_id)
            .filter(|runtime| runtime.agent_run_epoch() == Some(execution_epoch))
            .cloned()
    }

    pub async fn forget_agent_run(&self, agent_run_id: &str, execution_epoch: i64) {
        let mut runtimes = self.agent_run_runtimes.lock().await;
        if runtimes
            .get(agent_run_id)
            .is_some_and(|runtime| runtime.agent_run_epoch() == Some(execution_epoch))
        {
            runtimes.remove(agent_run_id);
        }
    }

    pub async fn shutdown_all(&self) {
        let mut runtimes = self
            .legacy_runtimes
            .lock()
            .await
            .drain()
            .map(|(_, runtime)| runtime)
            .collect::<Vec<_>>();
        runtimes.extend(
            self.agent_run_runtimes
                .lock()
                .await
                .drain()
                .map(|(_, runtime)| runtime),
        );
        for runtime in runtimes {
            runtime.shutdown().await;
        }
    }
}

pub fn approval_result(method: &str, request: &Value, decision: &str) -> Result<Value> {
    match method {
        "item/commandExecution/requestApproval" | "execCommandApproval" => Ok(json!({
            "decision": match decision {
                "accept" => "accept",
                "acceptForSession" => "acceptForSession",
                "decline" => "decline",
                "cancel" => "cancel",
                value => bail!("unsupported command approval decision: {value}"),
            }
        })),
        "item/fileChange/requestApproval" | "applyPatchApproval" => Ok(json!({
            "decision": match decision {
                "accept" => "accept",
                "acceptForSession" => "acceptForSession",
                "decline" => "decline",
                "cancel" => "cancel",
                value => bail!("unsupported file approval decision: {value}"),
            }
        })),
        "item/permissions/requestApproval" => {
            let permissions = if matches!(decision, "accept" | "acceptForSession") {
                request
                    .get("permissions")
                    .cloned()
                    .unwrap_or_else(|| json!({}))
            } else {
                json!({})
            };
            Ok(json!({
                "permissions": permissions,
                "scope": if decision == "acceptForSession" { "session" } else { "turn" },
                "strictAutoReview": true
            }))
        }
        value => bail!("unsupported approval method: {value}"),
    }
}

pub fn is_approval_method(method: &str) -> bool {
    matches!(
        method,
        "item/commandExecution/requestApproval"
            | "item/fileChange/requestApproval"
            | "item/permissions/requestApproval"
            | "execCommandApproval"
            | "applyPatchApproval"
    )
}

pub fn normalize_event(method: &str, params: &Value) -> (&'static str, Value) {
    match method {
        "item/agentMessage/delta" => ("agent.text.delta", params.clone()),
        "item/commandExecution/outputDelta" | "command/exec/outputDelta" => {
            ("command.output.delta", params.clone())
        }
        "item/fileChange/patchUpdated" => ("file.change.updated", params.clone()),
        "turn/started" => ("turn.state", json!({"status": "running", "native": params})),
        "turn/completed" => (
            "turn.state",
            json!({"status": "completed", "native": params}),
        ),
        "thread/status/changed" => ("runtime.state", params.clone()),
        "error" => ("error", params.clone()),
        "item/started" => ("activity.started", params.clone()),
        "item/completed" => ("activity.completed", params.clone()),
        _ => (
            "runtime.native",
            json!({"method": method, "params": params}),
        ),
    }
}

pub struct CompletedTurn {
    pub turn_id: String,
    pub status: String,
    pub final_agent_message: Option<String>,
}

pub fn completed_turn(params: &Value) -> Result<CompletedTurn> {
    let turn = params
        .get("turn")
        .and_then(Value::as_object)
        .context("turn/completed did not include turn")?;
    let turn_id = turn
        .get("id")
        .and_then(Value::as_str)
        .context("turn/completed did not include turn.id")?
        .to_string();
    let status = turn
        .get("status")
        .and_then(Value::as_str)
        .context("turn/completed did not include turn.status")?
        .to_string();
    let final_agent_message = turn
        .get("items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("agentMessage"))
        .filter_map(|item| item.get("text").and_then(Value::as_str))
        .rfind(|text| !text.trim().is_empty())
        .map(str::to_string);
    Ok(CompletedTurn {
        turn_id,
        status,
        final_agent_message,
    })
}

pub async fn verify_runtime_ready() -> Result<String> {
    let probe = health::codex_runtime_probe().await;
    if !probe.is_ready() {
        bail!(
            "Codex runtime probe is {:?}: {}",
            probe.status,
            probe
                .detail
                .as_deref()
                .unwrap_or("required Codex app-server capabilities are unavailable")
        );
    }
    probe
        .reported_version
        .context("Codex runtime probe did not report a version")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_approval_fails_closed() {
        let result = approval_result("unknown/request", &json!({}), "accept");
        assert!(result.is_err());
    }

    #[test]
    fn command_session_approval_maps_to_codex_shape() {
        let result = approval_result(
            "item/commandExecution/requestApproval",
            &json!({}),
            "acceptForSession",
        )
        .expect("known approval should map");
        assert_eq!(result, json!({"decision": "acceptForSession"}));
    }

    #[test]
    fn completed_turn_uses_the_authoritative_last_agent_message() {
        let completed = completed_turn(&json!({
            "threadId": "thread-1",
            "turn": {
                "id": "turn-1",
                "status": "completed",
                "items": [
                    {"id": "m1", "type": "agentMessage", "text": "draft"},
                    {"id": "tool", "type": "commandExecution"},
                    {"id": "m2", "type": "agentMessage", "text": "final"}
                ]
            }
        }))
        .unwrap();
        assert_eq!(completed.turn_id, "turn-1");
        assert_eq!(completed.status, "completed");
        assert_eq!(completed.final_agent_message.as_deref(), Some("final"));
    }
}
