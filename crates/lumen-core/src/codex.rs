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
    Message { task_id: String, message: Value },
    Stderr { task_id: String, text: String },
    Exited { task_id: String },
}

pub struct CodexRuntime {
    task_id: String,
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pending: Mutex<HashMap<u64, oneshot::Sender<std::result::Result<Value, String>>>>,
    next_id: AtomicU64,
    thread_id: RwLock<Option<String>>,
    turn_id: RwLock<Option<String>>,
}

impl CodexRuntime {
    async fn spawn(
        task_id: &str,
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
            task_id: task_id.to_string(),
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            thread_id: RwLock::new(None),
            turn_id: RwLock::new(None),
        });

        Self::spawn_stdout_reader(runtime.clone(), stdout, incoming.clone());
        Self::spawn_stderr_reader(task_id.to_string(), stderr, incoming);

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
                                let _ = incoming.send(CodexIncoming::Stderr {
                                    task_id: runtime.task_id.clone(),
                                    text: format!("invalid app-server JSON: {error}: {line}"),
                                });
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
                            let _ = incoming.send(CodexIncoming::Message {
                                task_id: runtime.task_id.clone(),
                                message,
                            });
                        }
                    }
                    Ok(Some(_)) => {}
                    Ok(None) => break,
                    Err(error) => {
                        let _ = incoming.send(CodexIncoming::Stderr {
                            task_id: runtime.task_id.clone(),
                            text: format!("app-server stdout failed: {error}"),
                        });
                        break;
                    }
                }
            }
            let _ = incoming.send(CodexIncoming::Exited {
                task_id: runtime.task_id.clone(),
            });
        });
    }

    fn spawn_stderr_reader(
        task_id: String,
        stderr: tokio::process::ChildStderr,
        incoming: mpsc::UnboundedSender<CodexIncoming>,
    ) {
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if !line.trim().is_empty() {
                    let _ = incoming.send(CodexIncoming::Stderr {
                        task_id: task_id.clone(),
                        text: line,
                    });
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
        let cwd = cwd.to_string_lossy();
        let result = if let Some(thread_id) = existing_thread_id {
            self.rpc(
                "thread/resume",
                json!({
                    "threadId": thread_id,
                    "cwd": cwd,
                    "approvalPolicy": "on-request",
                    "approvalsReviewer": "user",
                    "sandbox": "workspace-write",
                    "developerInstructions": instructions
                }),
            )
            .await?
        } else {
            self.rpc(
                "thread/start",
                json!({
                    "cwd": cwd,
                    "approvalPolicy": "on-request",
                    "approvalsReviewer": "user",
                    "sandbox": "workspace-write",
                    "developerInstructions": instructions
                }),
            )
            .await?
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
    runtimes: Mutex<HashMap<String, Arc<CodexRuntime>>>,
    incoming: mpsc::UnboundedSender<CodexIncoming>,
}

impl CodexManager {
    pub fn new(incoming: mpsc::UnboundedSender<CodexIncoming>) -> Self {
        Self {
            runtimes: Mutex::new(HashMap::new()),
            incoming,
        }
    }

    pub async fn ensure_runtime(&self, task_id: &str, cwd: &Path) -> Result<Arc<CodexRuntime>> {
        if let Some(runtime) = self.runtimes.lock().await.get(task_id).cloned() {
            return Ok(runtime);
        }
        let runtime = CodexRuntime::spawn(task_id, cwd, self.incoming.clone()).await?;
        self.runtimes
            .lock()
            .await
            .insert(task_id.to_string(), runtime.clone());
        Ok(runtime)
    }

    pub async fn get(&self, task_id: &str) -> Option<Arc<CodexRuntime>> {
        self.runtimes.lock().await.get(task_id).cloned()
    }

    pub async fn forget(&self, task_id: &str) {
        self.runtimes.lock().await.remove(task_id);
    }

    pub async fn shutdown_all(&self) {
        let runtimes = self
            .runtimes
            .lock()
            .await
            .drain()
            .map(|(_, runtime)| runtime)
            .collect::<Vec<_>>();
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
}
