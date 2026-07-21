use std::{
    collections::{HashMap, HashSet},
    path::Path,
    process::Stdio,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};

use anyhow::{Context, Result, bail};
use lumen_core::{
    action::{ActionResultOutcome, CanonicalActionInput, RuntimeActionRequestBinding},
    agent_profile::{AdapterKind, FrozenAgentRuntimeConfig},
    agent_runtime_adapter::{
        AdapterRuntimeProjection, AdapterRuntimeResolutionInput, AgentRuntimeAdapter,
        AgentRuntimeAdapterRegistry,
    },
    command::canonical_json_digest,
    runtime::RuntimeHostKey,
};
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
        host_instance_id: String,
        agent_run_id: String,
        execution_epoch: i64,
        message: Value,
    },
    AgentRunStderr {
        host_instance_id: String,
        agent_run_id: String,
        execution_epoch: i64,
        text: String,
    },
    AgentRunExited {
        host_instance_id: String,
        agent_run_id: String,
        execution_epoch: i64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
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
    fn message(&self, host_instance_id: &str, message: Value) -> CodexIncoming {
        match self {
            Self::LegacyTask { task_id } => CodexIncoming::Message {
                task_id: task_id.clone(),
                message,
            },
            Self::AgentRun {
                agent_run_id,
                execution_epoch,
            } => CodexIncoming::AgentRunMessage {
                host_instance_id: host_instance_id.to_string(),
                agent_run_id: agent_run_id.clone(),
                execution_epoch: *execution_epoch,
                message,
            },
        }
    }

    fn stderr(&self, host_instance_id: &str, text: String) -> CodexIncoming {
        match self {
            Self::LegacyTask { task_id } => CodexIncoming::Stderr {
                task_id: task_id.clone(),
                text,
            },
            Self::AgentRun {
                agent_run_id,
                execution_epoch,
            } => CodexIncoming::AgentRunStderr {
                host_instance_id: host_instance_id.to_string(),
                agent_run_id: agent_run_id.clone(),
                execution_epoch: *execution_epoch,
                text,
            },
        }
    }

    fn exited(&self, host_instance_id: &str) -> CodexIncoming {
        match self {
            Self::LegacyTask { task_id } => CodexIncoming::Exited {
                task_id: task_id.clone(),
            },
            Self::AgentRun {
                agent_run_id,
                execution_epoch,
            } => CodexIncoming::AgentRunExited {
                host_instance_id: host_instance_id.to_string(),
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

struct CodexHost {
    host_instance_id: String,
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pending: Mutex<HashMap<u64, PendingRpc>>,
    next_id: AtomicU64,
    routes: RwLock<HashMap<String, CodexThreadRoute>>,
    incoming: mpsc::UnboundedSender<CodexIncoming>,
    alive: AtomicBool,
}

#[derive(Debug, Clone)]
struct CodexThreadRoute {
    owner: CodexRuntimeOwner,
    active_turn_id: Option<String>,
}

impl CodexThreadRoute {
    fn owner_for_message(&self, message_turn_id: Option<&str>) -> Option<CodexRuntimeOwner> {
        if message_turn_id.is_some() && self.active_turn_id.as_deref() != message_turn_id {
            None
        } else {
            Some(self.owner.clone())
        }
    }
}

struct PendingRpc {
    sender: oneshot::Sender<std::result::Result<Value, String>>,
    turn_activation: Option<(String, CodexRuntimeOwner)>,
}

impl CodexHost {
    async fn spawn(
        cwd: &Path,
        incoming: mpsc::UnboundedSender<CodexIncoming>,
    ) -> Result<Arc<Self>> {
        let codex_path = health::find_codex().context("Codex CLI was not found")?;
        Self::spawn_with_executable(&codex_path, cwd, incoming).await
    }

    async fn spawn_with_executable(
        codex_path: &Path,
        cwd: &Path,
        incoming: mpsc::UnboundedSender<CodexIncoming>,
    ) -> Result<Arc<Self>> {
        let mut child = Command::new(codex_path)
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
        let host = Arc::new(Self {
            host_instance_id: uuid::Uuid::new_v4().to_string(),
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            routes: RwLock::new(HashMap::new()),
            incoming,
            alive: AtomicBool::new(true),
        });
        Self::spawn_stdout_reader(host.clone(), stdout);
        Self::spawn_stderr_reader(host.clone(), stderr);
        let initialized = host
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
            .context("Codex app-server initialize failed");
        if let Err(error) = initialized {
            host.shutdown().await;
            return Err(error);
        }
        if let Err(error) = host.notify("initialized", json!({})).await {
            host.shutdown().await;
            return Err(error.context("Codex app-server initialized notification failed"));
        }
        Ok(host)
    }

    fn spawn_stdout_reader(host: Arc<Self>, stdout: tokio::process::ChildStdout) {
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) if !line.trim().is_empty() => {
                        let message = match serde_json::from_str::<Value>(&line) {
                            Ok(message) => message,
                            Err(error) => {
                                host.broadcast_stderr(format!(
                                    "invalid app-server JSON: {error}: {line}"
                                ))
                                .await;
                                continue;
                            }
                        };
                        let is_response = message.get("method").is_none()
                            && message.get("id").and_then(Value::as_u64).is_some();
                        if is_response {
                            let id = message["id"].as_u64().expect("checked above");
                            if let Some(pending) = host.pending.lock().await.remove(&id) {
                                let mut response = if let Some(error) = message.get("error") {
                                    Err(error
                                        .get("message")
                                        .and_then(Value::as_str)
                                        .unwrap_or("Codex request failed")
                                        .to_string())
                                } else {
                                    Ok(message.get("result").cloned().unwrap_or(Value::Null))
                                };
                                if let (Ok(result), Some((thread_id, owner))) =
                                    (response.clone(), pending.turn_activation)
                                {
                                    response = match result
                                        .pointer("/turn/id")
                                        .and_then(Value::as_str)
                                    {
                                        Some(turn_id) => host
                                            .activate_turn(&thread_id, &owner, turn_id)
                                            .await
                                            .map(|_| result)
                                            .map_err(|error| error.to_string()),
                                        None => Err("Codex turn response did not include turn.id"
                                            .to_string()),
                                    };
                                }
                                let _ = pending.sender.send(response);
                            }
                            continue;
                        }
                        let thread_id = message
                            .pointer("/params/threadId")
                            .and_then(Value::as_str)
                            .or_else(|| {
                                message.pointer("/params/thread/id").and_then(Value::as_str)
                            });
                        let route = if let Some(thread_id) = thread_id {
                            host.routes.read().await.get(thread_id).cloned()
                        } else {
                            None
                        };
                        let message_turn_id = message
                            .pointer("/params/turnId")
                            .and_then(Value::as_str)
                            .or_else(|| message.pointer("/params/turn/id").and_then(Value::as_str));
                        let owner =
                            route.and_then(|route| route.owner_for_message(message_turn_id));
                        if let Some(owner) = owner {
                            let _ = host
                                .incoming
                                .send(owner.message(&host.host_instance_id, message));
                        } else if message.get("id").is_some() {
                            let id = message.get("id").cloned().unwrap_or(Value::Null);
                            let _ = host
                                .send(json!({
                                    "id": id,
                                    "error": {
                                        "code": -32601,
                                        "message": "Lumen has no active Native Thread binding for this request"
                                    }
                                }))
                                .await;
                        }
                    }
                    Ok(Some(_)) => {}
                    Ok(None) => break,
                    Err(error) => {
                        host.broadcast_stderr(format!("app-server stdout failed: {error}"))
                            .await;
                        break;
                    }
                }
            }
            host.alive.store(false, Ordering::Release);
            for (_, pending) in host.pending.lock().await.drain() {
                let _ = pending
                    .sender
                    .send(Err("Codex app-server exited".to_string()));
            }
            let owners = host.owners().await;
            for owner in owners {
                let _ = host.incoming.send(owner.exited(&host.host_instance_id));
            }
        });
    }

    fn spawn_stderr_reader(host: Arc<Self>, stderr: tokio::process::ChildStderr) {
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if !line.trim().is_empty() {
                    host.broadcast_stderr(line).await;
                }
            }
        });
    }

    async fn bind_thread(&self, thread_id: &str, owner: &CodexRuntimeOwner) -> Result<()> {
        let mut routes = self.routes.write().await;
        if let Some(existing) = routes.get(thread_id)
            && &existing.owner != owner
        {
            bail!("Codex Native Thread is already bound to another logical runtime");
        }
        routes.insert(
            thread_id.to_string(),
            CodexThreadRoute {
                owner: owner.clone(),
                active_turn_id: None,
            },
        );
        Ok(())
    }

    async fn activate_turn(
        &self,
        thread_id: &str,
        owner: &CodexRuntimeOwner,
        turn_id: &str,
    ) -> Result<()> {
        let mut routes = self.routes.write().await;
        let route = routes
            .get_mut(thread_id)
            .context("Codex Native Thread has no logical runtime binding")?;
        if &route.owner != owner
            || route
                .active_turn_id
                .as_deref()
                .is_some_and(|active| active != turn_id)
        {
            bail!("Codex Native Turn failed Host/Thread/Run fencing");
        }
        route.active_turn_id = Some(turn_id.to_string());
        Ok(())
    }

    async fn deactivate_turn(
        &self,
        thread_id: &str,
        owner: &CodexRuntimeOwner,
        completed_turn_id: Option<&str>,
    ) {
        let mut routes = self.routes.write().await;
        let Some(route) = routes.get_mut(thread_id) else {
            return;
        };
        if &route.owner == owner
            && (completed_turn_id.is_none() || route.active_turn_id.as_deref() == completed_turn_id)
        {
            route.active_turn_id = None;
        }
    }

    async fn active_turn(&self, thread_id: &str, owner: &CodexRuntimeOwner) -> Option<String> {
        self.routes
            .read()
            .await
            .get(thread_id)
            .filter(|route| &route.owner == owner)
            .and_then(|route| route.active_turn_id.clone())
    }

    async fn unbind_thread(&self, thread_id: &str, owner: &CodexRuntimeOwner) {
        let mut routes = self.routes.write().await;
        if routes.get(thread_id).map(|route| &route.owner) == Some(owner) {
            routes.remove(thread_id);
        }
    }

    async fn owners(&self) -> HashSet<CodexRuntimeOwner> {
        self.routes
            .read()
            .await
            .values()
            .map(|route| route.owner.clone())
            .collect()
    }

    async fn broadcast_stderr(&self, text: String) {
        for owner in self.owners().await {
            let _ = self
                .incoming
                .send(owner.stderr(&self.host_instance_id, text.clone()));
        }
    }

    fn is_alive(&self) -> bool {
        self.alive.load(Ordering::Acquire)
    }

    async fn shutdown(&self) {
        self.alive.store(false, Ordering::Release);
        let mut child = self.child.lock().await;
        let _ = child.kill().await;
    }

    async fn rpc(&self, method: &str, params: Value) -> Result<Value> {
        self.rpc_inner(method, params, None).await
    }

    async fn rpc_start_turn(
        &self,
        thread_id: &str,
        owner: &CodexRuntimeOwner,
        params: Value,
    ) -> Result<Value> {
        self.rpc_inner(
            "turn/start",
            params,
            Some((thread_id.to_string(), owner.clone())),
        )
        .await
    }

    async fn rpc_inner(
        &self,
        method: &str,
        params: Value,
        turn_activation: Option<(String, CodexRuntimeOwner)>,
    ) -> Result<Value> {
        if !self.is_alive() {
            bail!("Codex app-server Host is not alive");
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().await.insert(
            id,
            PendingRpc {
                sender,
                turn_activation,
            },
        );
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

pub struct CodexRuntime {
    owner: CodexRuntimeOwner,
    host: Arc<CodexHost>,
    owns_host: bool,
    thread_id: RwLock<Option<String>>,
    action_items: Mutex<HashMap<String, Value>>,
    streamed_agent_text: Mutex<String>,
    completed_agent_message: RwLock<Option<String>>,
}

impl CodexRuntime {
    async fn spawn(
        owner: CodexRuntimeOwner,
        cwd: &Path,
        incoming: mpsc::UnboundedSender<CodexIncoming>,
    ) -> Result<Arc<Self>> {
        let host = CodexHost::spawn(cwd, incoming).await?;
        Ok(Self::from_host(owner, host, true))
    }

    fn from_host(owner: CodexRuntimeOwner, host: Arc<CodexHost>, owns_host: bool) -> Arc<Self> {
        Arc::new(Self {
            owner,
            host,
            owns_host,
            thread_id: RwLock::new(None),
            action_items: Mutex::new(HashMap::new()),
            streamed_agent_text: Mutex::new(String::new()),
            completed_agent_message: RwLock::new(None),
        })
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
            "on-request",
            None,
        )
        .await
    }

    pub async fn start_or_resume_agent_thread(
        &self,
        cwd: &Path,
        existing_thread_id: Option<&str>,
        developer_instructions: &str,
        sandbox_mode: &str,
        approval_policy: &str,
        model: Option<&str>,
    ) -> Result<String> {
        self.start_or_resume_thread_with_config(
            cwd,
            existing_thread_id,
            developer_instructions,
            sandbox_mode,
            approval_policy,
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
        approval_policy: &str,
        model: Option<&str>,
    ) -> Result<String> {
        let cwd = cwd.to_string_lossy();
        let mut request = json!({
            "cwd": cwd,
            "approvalPolicy": approval_policy,
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
        self.host.bind_thread(&thread_id, &self.owner).await?;
        *self.thread_id.write().await = Some(thread_id.clone());
        Ok(thread_id)
    }

    pub async fn start_turn(&self, text: &str) -> Result<String> {
        self.start_turn_with_config(text, None, None).await
    }

    pub async fn start_turn_with_config(
        &self,
        text: &str,
        model: Option<&str>,
        reasoning_effort: Option<&str>,
    ) -> Result<String> {
        self.streamed_agent_text.lock().await.clear();
        *self.completed_agent_message.write().await = None;
        let thread_id = self
            .thread_id()
            .await
            .context("Codex thread is not ready")?;
        let mut request = json!({
            "threadId": thread_id,
            "clientUserMessageId": uuid::Uuid::new_v4().to_string(),
            "input": [{"type": "text", "text": text}]
        });
        if let Some(model) = model {
            request
                .as_object_mut()
                .expect("turn request is an object")
                .insert("model".to_string(), Value::String(model.to_string()));
        }
        if let Some(reasoning_effort) = reasoning_effort {
            request
                .as_object_mut()
                .expect("turn request is an object")
                .insert(
                    "effort".to_string(),
                    Value::String(reasoning_effort.to_string()),
                );
        }
        let result = self
            .host
            .rpc_start_turn(&thread_id, &self.owner, request)
            .await?;
        let turn_id = result
            .pointer("/turn/id")
            .and_then(Value::as_str)
            .context("Codex turn response did not include turn.id")?
            .to_string();
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
        if let Some(thread_id) = self.thread_id().await {
            self.host
                .deactivate_turn(&thread_id, &self.owner, completed_turn_id)
                .await;
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
        let thread_id = self.thread_id().await?;
        self.host.active_turn(&thread_id, &self.owner).await
    }

    pub async fn observe_agent_message(&self, method: &str, params: &Value) {
        match method {
            "item/started" => {
                if let Some(item) = params.get("item")
                    && let Some(item_id) = item.get("id").and_then(Value::as_str)
                    && matches!(
                        item.get("type").and_then(Value::as_str),
                        Some("commandExecution" | "fileChange")
                    )
                {
                    self.action_items
                        .lock()
                        .await
                        .insert(item_id.to_string(), item.clone());
                }
            }
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

    pub async fn action_item(&self, item_id: &str) -> Option<Value> {
        self.action_items.lock().await.get(item_id).cloned()
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
        if let Some(thread_id) = self.thread_id().await {
            self.host.unbind_thread(&thread_id, &self.owner).await;
        }
        if self.owns_host {
            self.host.shutdown().await;
        }
    }

    pub fn host_instance_id(&self) -> &str {
        &self.host.host_instance_id
    }

    async fn rpc(&self, method: &str, params: Value) -> Result<Value> {
        self.host.rpc(method, params).await
    }

    async fn send(&self, message: Value) -> Result<()> {
        self.host.send(message).await
    }
}

pub struct CodexCliRuntimeAdapter {
    legacy_runtimes: Mutex<HashMap<String, Arc<CodexRuntime>>>,
    agent_run_runtimes: Mutex<HashMap<String, Arc<CodexRuntime>>>,
    agent_hosts: Mutex<HashMap<RuntimeHostKey, Arc<CodexHost>>>,
    incoming: mpsc::UnboundedSender<CodexIncoming>,
}

impl AgentRuntimeAdapter for CodexCliRuntimeAdapter {
    fn kind(&self) -> AdapterKind {
        AdapterKind::CodexCli
    }

    fn resolve_runtime(
        &self,
        input: AdapterRuntimeResolutionInput<'_>,
    ) -> Result<AdapterRuntimeProjection> {
        AgentRuntimeAdapterRegistry::default().resolve_runtime(self.kind(), input)
    }
}

impl CodexCliRuntimeAdapter {
    pub fn new(incoming: mpsc::UnboundedSender<CodexIncoming>) -> Self {
        Self {
            legacy_runtimes: Mutex::new(HashMap::new()),
            agent_run_runtimes: Mutex::new(HashMap::new()),
            agent_hosts: Mutex::new(HashMap::new()),
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
        frozen_runtime: &FrozenAgentRuntimeConfig,
    ) -> Result<Arc<CodexRuntime>> {
        if frozen_runtime.adapter_kind != AdapterKind::CodexCli {
            bail!("Codex Runtime received a non-Codex AgentRun");
        }
        let existing = self
            .agent_run_runtimes
            .lock()
            .await
            .get(agent_run_id)
            .cloned();
        if let Some(runtime) = existing {
            if runtime.agent_run_epoch() == Some(execution_epoch) && runtime.host.is_alive() {
                return Ok(runtime);
            }
            runtime.shutdown().await;
            self.agent_run_runtimes.lock().await.remove(agent_run_id);
        }
        let key = codex_agent_host_key(frozen_runtime)?;
        let host = {
            let mut hosts = self.agent_hosts.lock().await;
            if let Some(host) = hosts.get(&key)
                && host.is_alive()
            {
                host.clone()
            } else {
                hosts.remove(&key);
                let host = CodexHost::spawn_with_executable(
                    Path::new(&frozen_runtime.executable_path),
                    cwd,
                    self.incoming.clone(),
                )
                .await?;
                hosts.insert(key, host.clone());
                host
            }
        };
        let runtime = CodexRuntime::from_host(
            CodexRuntimeOwner::AgentRun {
                agent_run_id: agent_run_id.to_string(),
                execution_epoch,
            },
            host,
            false,
        );
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

    pub async fn get_agent_run_on_host(
        &self,
        host_instance_id: &str,
        agent_run_id: &str,
        execution_epoch: i64,
    ) -> Option<Arc<CodexRuntime>> {
        self.agent_run_runtimes
            .lock()
            .await
            .get(agent_run_id)
            .filter(|runtime| {
                runtime.agent_run_epoch() == Some(execution_epoch)
                    && runtime.host_instance_id() == host_instance_id
            })
            .cloned()
    }

    pub async fn forget_agent_run(&self, agent_run_id: &str, execution_epoch: i64) {
        let runtime = {
            let mut runtimes = self.agent_run_runtimes.lock().await;
            if runtimes
                .get(agent_run_id)
                .is_some_and(|runtime| runtime.agent_run_epoch() == Some(execution_epoch))
            {
                runtimes.remove(agent_run_id)
            } else {
                None
            }
        };
        if let Some(runtime) = runtime {
            runtime.shutdown().await;
        }
    }

    pub async fn shutdown_all(&self) {
        let legacy_runtimes = self
            .legacy_runtimes
            .lock()
            .await
            .drain()
            .map(|(_, runtime)| runtime)
            .collect::<Vec<_>>();
        let agent_runtimes = self
            .agent_run_runtimes
            .lock()
            .await
            .drain()
            .map(|(_, runtime)| runtime)
            .collect::<Vec<_>>();
        let hosts = self
            .agent_hosts
            .lock()
            .await
            .drain()
            .map(|(_, host)| host)
            .collect::<Vec<_>>();
        for runtime in legacy_runtimes {
            runtime.shutdown().await;
        }
        for runtime in agent_runtimes {
            runtime.shutdown().await;
        }
        for host in hosts {
            host.shutdown().await;
        }
    }
}

fn codex_agent_host_key(runtime: &FrozenAgentRuntimeConfig) -> Result<RuntimeHostKey> {
    let key = RuntimeHostKey {
        adapter_kind: runtime.adapter_kind.as_str().to_string(),
        protocol_version: runtime.protocol_version.clone(),
        auth_scope: runtime.auth_scope.clone(),
        process_config_digest: runtime.host_config_digest.clone(),
    };
    key.validate()?;
    Ok(key)
}

#[derive(Debug, Clone)]
pub struct InterceptedActionRequest {
    pub action_id: String,
    pub native_action_id: String,
    pub input: CanonicalActionInput,
    pub runtime_request: RuntimeActionRequestBinding,
    pub reason: Option<String>,
}

pub struct InterceptedActionContext<'a> {
    pub agent_run_id: &'a str,
    pub execution_epoch: i64,
    pub expected_thread_id: &'a str,
    pub expected_turn_id: &'a str,
    pub execution_root: &'a Path,
}

pub fn intercepted_action_request(
    context: &InterceptedActionContext<'_>,
    native_method: &str,
    native_request_id: Value,
    params: &Value,
    prior_item: Option<&Value>,
) -> Result<InterceptedActionRequest> {
    if !is_approval_method(native_method) {
        bail!("unsupported intercepted Action request: {native_method}");
    }
    let current_protocol = native_method.starts_with("item/");
    let thread_id = params
        .get("threadId")
        .or_else(|| params.get("conversationId"))
        .and_then(Value::as_str)
        .or((!current_protocol).then_some(context.expected_thread_id))
        .context("Runtime approval request has no Native Thread ID")?;
    let turn_id = params
        .get("turnId")
        .and_then(Value::as_str)
        .or((!current_protocol).then_some(context.expected_turn_id))
        .context("Runtime approval request has no Native Turn ID")?;
    if thread_id != context.expected_thread_id || turn_id != context.expected_turn_id {
        bail!("Runtime approval request is outside the active Native Thread or Turn");
    }
    let native_item_id = params
        .get("itemId")
        .or_else(|| params.get("callId"))
        .and_then(Value::as_str)
        .context("Runtime approval request has no stable Item ID")?
        .to_string();
    let native_action_id = params
        .get("approvalId")
        .and_then(Value::as_str)
        .unwrap_or(&native_item_id)
        .to_string();
    let request_digest = canonical_json_digest(&json!({
        "nativeMethod": native_method,
        "params": params,
        "priorItem": prior_item,
    }))?;
    let root = context.execution_root.to_string_lossy().to_string();
    let input = match native_method {
        "item/commandExecution/requestApproval" => {
            if let Some(network) = params
                .get("networkApprovalContext")
                .and_then(Value::as_object)
            {
                let host = network
                    .get("host")
                    .and_then(Value::as_str)
                    .context("Network approval has no host")?;
                let protocol = network
                    .get("protocol")
                    .and_then(Value::as_str)
                    .context("Network approval has no protocol")?;
                CanonicalActionInput::NetworkAccess {
                    protocol: protocol.to_string(),
                    host: host.to_string(),
                    port: network
                        .get("port")
                        .and_then(Value::as_u64)
                        .and_then(|port| u16::try_from(port).ok()),
                }
            } else {
                let command = params
                    .get("command")
                    .and_then(Value::as_str)
                    .or_else(|| prior_item?.get("command").and_then(Value::as_str))
                    .context("Command approval has no command in the request or preceding item")?;
                if command.trim().is_empty() {
                    bail!("Command approval command is empty");
                }
                CanonicalActionInput::ShellCommand {
                    argv: vec![
                        "/bin/zsh".to_string(),
                        "-lc".to_string(),
                        command.to_string(),
                    ],
                    cwd: params
                        .get("cwd")
                        .and_then(Value::as_str)
                        .unwrap_or(&root)
                        .to_string(),
                    environment_refs: params
                        .get("environmentId")
                        .and_then(Value::as_str)
                        .map(|value| vec![value.to_string()])
                        .unwrap_or_default(),
                }
            }
        }
        "execCommandApproval" => {
            let argv = params
                .get("command")
                .and_then(Value::as_array)
                .context("Legacy command approval has no argv")?
                .iter()
                .map(|value| {
                    value
                        .as_str()
                        .map(str::to_string)
                        .context("Legacy command argv contains a non-string value")
                })
                .collect::<Result<Vec<_>>>()?;
            CanonicalActionInput::ShellCommand {
                argv,
                cwd: params
                    .get("cwd")
                    .and_then(Value::as_str)
                    .unwrap_or(&root)
                    .to_string(),
                environment_refs: Vec::new(),
            }
        }
        "item/fileChange/requestApproval" | "applyPatchApproval" => {
            CanonicalActionInput::FileWrite {
                path: params
                    .get("grantRoot")
                    .and_then(Value::as_str)
                    .unwrap_or(&root)
                    .to_string(),
                operation: "patch".to_string(),
                content_digest: request_digest.clone(),
            }
        }
        "item/permissions/requestApproval" => CanonicalActionInput::RuntimePermissionGrant {
            cwd: params
                .get("cwd")
                .and_then(Value::as_str)
                .unwrap_or(&root)
                .to_string(),
            permissions: params
                .get("permissions")
                .cloned()
                .filter(Value::is_object)
                .context("Runtime permission approval has no permission profile")?,
            request_digest: request_digest.clone(),
        },
        value => bail!("unsupported intercepted Action method: {value}"),
    };
    let action_id_digest = canonical_json_digest(&json!({
        "agentRunId": context.agent_run_id,
        "executionEpoch": context.execution_epoch,
        "nativeMethod": native_method,
        "nativeActionId": native_action_id,
        "nativeRequestId": native_request_id,
    }))?;
    let response_context = if native_method == "item/permissions/requestApproval" {
        json!({ "permissions": params["permissions"] })
    } else {
        json!({})
    };
    Ok(InterceptedActionRequest {
        action_id: format!("action-{action_id_digest}"),
        native_action_id,
        input,
        runtime_request: RuntimeActionRequestBinding {
            native_method: native_method.to_string(),
            native_request_id,
            native_item_id,
            native_thread_id: thread_id.to_string(),
            native_turn_id: turn_id.to_string(),
            response_context,
        },
        reason: params
            .get("reason")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
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

#[derive(Debug, Clone)]
pub struct CompletedInterceptedAction {
    pub native_item_id: String,
    pub outcome: ActionResultOutcome,
    pub result_code: String,
    pub result_summary: String,
    pub result_data: Value,
    pub effect_disposition: String,
}

pub fn completed_intercepted_action(
    params: &Value,
    expected_thread_id: &str,
    expected_turn_id: &str,
) -> Result<Option<CompletedInterceptedAction>> {
    let thread_id = params
        .get("threadId")
        .and_then(Value::as_str)
        .context("item/completed did not include threadId")?;
    let turn_id = params
        .get("turnId")
        .and_then(Value::as_str)
        .context("item/completed did not include turnId")?;
    if thread_id != expected_thread_id || turn_id != expected_turn_id {
        bail!("completed Runtime item is outside the active Native Thread or Turn");
    }
    let item = params
        .get("item")
        .and_then(Value::as_object)
        .context("item/completed did not include an item")?;
    let item_type = item
        .get("type")
        .and_then(Value::as_str)
        .context("completed Runtime item has no type")?;
    if !matches!(item_type, "commandExecution" | "fileChange") {
        return Ok(None);
    }
    let native_item_id = item
        .get("id")
        .and_then(Value::as_str)
        .context("completed Runtime Action has no Item ID")?
        .to_string();
    let status = item
        .get("status")
        .and_then(Value::as_str)
        .context("completed Runtime Action has no status")?;
    let exit_code = item.get("exitCode").and_then(Value::as_i64);
    let output_digest = item
        .get("aggregatedOutput")
        .and_then(Value::as_str)
        .map(|output| canonical_json_digest(&Value::String(output.to_string())))
        .transpose()?;
    let changes_digest = item.get("changes").map(canonical_json_digest).transpose()?;
    let (outcome, result_code, result_summary, effect_disposition) =
        match (item_type, status, exit_code) {
            ("commandExecution", "completed", Some(0)) => (
                ActionResultOutcome::Succeeded,
                "command_exit_0",
                "Command completed successfully",
                "complete",
            ),
            ("commandExecution", "completed", Some(code)) => (
                ActionResultOutcome::Failed,
                "command_exit_nonzero",
                if code == 1 {
                    "Command exited with code 1"
                } else {
                    "Command exited with a non-zero status"
                },
                "unknown",
            ),
            ("commandExecution", "completed", None) => (
                ActionResultOutcome::Unknown,
                "command_exit_unknown",
                "Command completed without an exit code",
                "unknown",
            ),
            ("commandExecution", "failed", _) => (
                ActionResultOutcome::Failed,
                "command_failed",
                "Command execution failed",
                "unknown",
            ),
            ("commandExecution", "declined", _) => (
                ActionResultOutcome::Failed,
                "command_declined",
                "Command execution was declined by the Runtime",
                "none",
            ),
            ("fileChange", "completed", _) => (
                ActionResultOutcome::Succeeded,
                "file_change_completed",
                "File change completed successfully",
                "complete",
            ),
            ("fileChange", "failed", _) => (
                ActionResultOutcome::Failed,
                "file_change_failed",
                "File change failed",
                "partial",
            ),
            ("fileChange", "declined", _) => (
                ActionResultOutcome::Failed,
                "file_change_declined",
                "File change was declined by the Runtime",
                "none",
            ),
            (_, "inProgress", _) => (
                ActionResultOutcome::Unknown,
                "runtime_item_incomplete",
                "Runtime completed an item notification with an in-progress status",
                "unknown",
            ),
            _ => bail!("unsupported completed Runtime Action status: {item_type}/{status}"),
        };
    Ok(Some(CompletedInterceptedAction {
        native_item_id,
        outcome,
        result_code: result_code.to_string(),
        result_summary: result_summary.to_string(),
        result_data: json!({
            "nativeItemType": item_type,
            "nativeStatus": status,
            "exitCode": exit_code,
            "durationMs": item.get("durationMs").cloned().unwrap_or(Value::Null),
            "outputDigest": output_digest,
            "changesDigest": changes_digest,
        }),
        effect_disposition: effect_disposition.to_string(),
    }))
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
    fn shared_host_route_rejects_events_from_an_old_native_turn() {
        let route = CodexThreadRoute {
            owner: CodexRuntimeOwner::AgentRun {
                agent_run_id: "run-current".to_string(),
                execution_epoch: 4,
            },
            active_turn_id: Some("turn-current".to_string()),
        };
        assert!(route.owner_for_message(Some("turn-old")).is_none());
        assert!(matches!(
            route.owner_for_message(Some("turn-current")),
            Some(CodexRuntimeOwner::AgentRun {
                ref agent_run_id,
                execution_epoch: 4,
            }) if agent_run_id == "run-current"
        ));
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
    fn command_approval_is_bound_to_the_active_run_thread_and_turn() {
        let request = intercepted_action_request(
            &InterceptedActionContext {
                agent_run_id: "run-1",
                execution_epoch: 7,
                expected_thread_id: "thread-1",
                expected_turn_id: "turn-1",
                execution_root: Path::new("/tmp/lumen-workspace"),
            },
            "item/commandExecution/requestApproval",
            json!(91),
            &json!({
                "threadId": "thread-1",
                "turnId": "turn-1",
                "itemId": "item-1",
                "command": "cargo test",
                "cwd": "/tmp/lumen-workspace",
                "startedAtMs": 1,
            }),
            None,
        )
        .expect("valid approval should canonicalize");
        assert_eq!(request.native_action_id, "item-1");
        assert_eq!(request.runtime_request.native_item_id, "item-1");
        assert_eq!(request.runtime_request.native_request_id, json!(91));
        assert!(matches!(
            request.input,
            CanonicalActionInput::ShellCommand { ref argv, ref cwd, .. }
                if argv == &["/bin/zsh", "-lc", "cargo test"]
                    && cwd == "/tmp/lumen-workspace"
        ));

        let fenced = intercepted_action_request(
            &InterceptedActionContext {
                agent_run_id: "run-1",
                execution_epoch: 7,
                expected_thread_id: "thread-1",
                expected_turn_id: "turn-1",
                execution_root: Path::new("/tmp/lumen-workspace"),
            },
            "item/commandExecution/requestApproval",
            json!(92),
            &json!({
                "threadId": "old-thread",
                "turnId": "turn-1",
                "itemId": "item-2",
                "command": "cargo test",
                "cwd": "/tmp/lumen-workspace",
                "startedAtMs": 1,
            }),
            None,
        );
        assert!(fenced.is_err());
    }

    #[test]
    fn command_approval_uses_the_preceding_item_when_request_omits_command() {
        let request = intercepted_action_request(
            &InterceptedActionContext {
                agent_run_id: "run-1",
                execution_epoch: 7,
                expected_thread_id: "thread-1",
                expected_turn_id: "turn-1",
                execution_root: Path::new("/tmp/lumen-workspace"),
            },
            "item/commandExecution/requestApproval",
            json!(93),
            &json!({
                "threadId": "thread-1",
                "turnId": "turn-1",
                "itemId": "item-3",
                "cwd": "/tmp/lumen-workspace",
            }),
            Some(&json!({
                "id": "item-3",
                "type": "commandExecution",
                "command": "cargo clippy",
            })),
        )
        .expect("the preceding item should complete the approval request");
        assert!(matches!(
            request.input,
            CanonicalActionInput::ShellCommand { ref argv, .. }
                if argv == &["/bin/zsh", "-lc", "cargo clippy"]
        ));
    }

    #[test]
    fn network_approval_is_not_misclassified_as_a_shell_command() {
        let request = intercepted_action_request(
            &InterceptedActionContext {
                agent_run_id: "run-1",
                execution_epoch: 7,
                expected_thread_id: "thread-1",
                expected_turn_id: "turn-1",
                execution_root: Path::new("/tmp/lumen-workspace"),
            },
            "item/commandExecution/requestApproval",
            json!(94),
            &json!({
                "threadId": "thread-1",
                "turnId": "turn-1",
                "itemId": "item-4",
                "networkApprovalContext": {
                    "protocol": "https",
                    "host": "api.example.com",
                    "port": 443,
                },
            }),
            None,
        )
        .expect("network approval should canonicalize independently");
        assert!(matches!(
            request.input,
            CanonicalActionInput::NetworkAccess {
                ref protocol,
                ref host,
                port: Some(443),
            } if protocol == "https" && host == "api.example.com"
        ));
    }

    #[test]
    fn completed_command_is_normalized_without_persisting_raw_output() {
        let completed = completed_intercepted_action(
            &json!({
                "threadId": "thread-1",
                "turnId": "turn-1",
                "item": {
                    "id": "item-1",
                    "type": "commandExecution",
                    "status": "completed",
                    "exitCode": 0,
                    "durationMs": 42,
                    "aggregatedOutput": "secret output"
                }
            }),
            "thread-1",
            "turn-1",
        )
        .expect("valid completion should normalize")
        .expect("command is an intercepted Action type");
        assert_eq!(completed.native_item_id, "item-1");
        assert!(matches!(completed.outcome, ActionResultOutcome::Succeeded));
        assert_eq!(completed.effect_disposition, "complete");
        assert_eq!(completed.result_data["exitCode"], 0);
        assert!(completed.result_data["outputDigest"].is_string());
        assert!(!completed.result_data.to_string().contains("secret output"));
    }

    #[test]
    fn completed_action_from_an_old_turn_is_fenced() {
        let completed = completed_intercepted_action(
            &json!({
                "threadId": "thread-1",
                "turnId": "old-turn",
                "item": {
                    "id": "item-1",
                    "type": "fileChange",
                    "status": "completed",
                    "changes": []
                }
            }),
            "thread-1",
            "turn-1",
        );
        assert!(completed.is_err());
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
