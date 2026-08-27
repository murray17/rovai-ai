use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};

use anyhow::{Context, Result, bail};
use rovai_core::{
    action::{
        ActionResultOutcome, CanonicalActionInput, RuntimeActionRequestBinding,
        RuntimePermissionOption,
    },
    agent_profile::{AdapterKind, FrozenAgentRuntimeConfig},
    agent_runtime_adapter::{
        AdapterRuntimeProjection, AdapterRuntimeResolutionInput, AgentRuntimeAdapter,
        AgentRuntimeAdapterRegistry, McpProjectionCapability, SkillDiscoveryCapability,
    },
    builtin_tool_transport::{BUILTIN_TOOL_CONTRACT_VERSION, builtin_tool_catalog_digest},
    camp_attachment_view::{
        CAMP_ATTACHMENT_VIEW_CONTRACT_VERSION, CampAttachmentRuntimeAuthorization,
    },
    command::canonical_json_digest,
    managed_process::{
        ManagedChildStderr, ManagedChildStdin, ManagedChildStdout, ManagedProcess,
        ManagedProcessLaunchSpec, ManagedProcessPurpose, ManagedStdinPolicy,
        ManagedWindowsArgvDialect,
    },
    mcp::McpServerDefinition,
    runtime_discovery::configure_active_runtime_command,
};
use serde_json::{Value, json};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::{Mutex, RwLock, mpsc, oneshot},
    time::timeout,
};

use crate::{
    builtin_tool_runtime::BuiltinToolProcessConfig,
    runtime_fleet::{
        AgentRuntimeFleetManager, FleetAcquireRequest, FleetReleaseDisposition,
        RuntimeCompatibilityKey, RuntimeProcessHost,
    },
};

#[derive(Debug)]
pub enum CodexIncoming {
    Message {
        host_instance_id: String,
        agent_run_id: String,
        execution_epoch: i64,
        message: Value,
    },
    Stderr {
        host_instance_id: String,
        agent_run_id: String,
        execution_epoch: i64,
        text: String,
    },
    Exited {
        host_instance_id: String,
        agent_run_id: String,
        execution_epoch: i64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum CodexRuntimeOwner {
    AgentRun {
        agent_run_id: String,
        execution_epoch: i64,
    },
}

impl CodexRuntimeOwner {
    fn message(&self, host_instance_id: &str, message: Value) -> CodexIncoming {
        match self {
            Self::AgentRun {
                agent_run_id,
                execution_epoch,
            } => CodexIncoming::Message {
                host_instance_id: host_instance_id.to_string(),
                agent_run_id: agent_run_id.clone(),
                execution_epoch: *execution_epoch,
                message,
            },
        }
    }

    fn stderr(&self, host_instance_id: &str, text: String) -> CodexIncoming {
        match self {
            Self::AgentRun {
                agent_run_id,
                execution_epoch,
            } => CodexIncoming::Stderr {
                host_instance_id: host_instance_id.to_string(),
                agent_run_id: agent_run_id.clone(),
                execution_epoch: *execution_epoch,
                text,
            },
        }
    }

    fn exited(&self, host_instance_id: &str) -> CodexIncoming {
        match self {
            Self::AgentRun {
                agent_run_id,
                execution_epoch,
            } => CodexIncoming::Exited {
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
        }
    }
}

pub(crate) struct CodexHost {
    host_instance_id: String,
    child: Mutex<ManagedProcess>,
    stdin: Mutex<ManagedChildStdin>,
    pending: Mutex<HashMap<u64, PendingRpc>>,
    next_id: AtomicU64,
    routes: CodexThreadRoutes,
    incoming: mpsc::UnboundedSender<CodexIncoming>,
    alive: AtomicBool,
    executable_path: PathBuf,
    builtin_tools: Option<BuiltinToolProcessConfig>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CodexIngressDisposition {
    Forward,
    DropCurrentDelta,
    DropRejectedDelta,
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

#[derive(Default)]
struct CodexThreadRoutes {
    inner: RwLock<HashMap<String, CodexThreadRoute>>,
}

impl CodexThreadRoutes {
    async fn bind_thread(&self, thread_id: &str, owner: &CodexRuntimeOwner) -> Result<()> {
        let mut routes = self.inner.write().await;
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
        let mut routes = self.inner.write().await;
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
        let mut routes = self.inner.write().await;
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
        self.inner
            .read()
            .await
            .get(thread_id)
            .filter(|route| &route.owner == owner)
            .and_then(|route| route.active_turn_id.clone())
    }

    async fn unbind_thread(&self, thread_id: &str, owner: &CodexRuntimeOwner) {
        let mut routes = self.inner.write().await;
        if routes.get(thread_id).map(|route| &route.owner) == Some(owner) {
            routes.remove(thread_id);
        }
    }

    async fn owners(&self) -> HashSet<CodexRuntimeOwner> {
        self.inner
            .read()
            .await
            .values()
            .map(|route| route.owner.clone())
            .collect()
    }

    async fn is_empty(&self) -> bool {
        self.inner.read().await.is_empty()
    }

    async fn ingress_route(
        &self,
        message: &Value,
    ) -> (CodexIngressDisposition, Option<CodexRuntimeOwner>) {
        let routes = self.inner.read().await;
        let disposition = codex_ingress_disposition(message, &routes);
        if disposition != CodexIngressDisposition::Forward {
            return (disposition, None);
        }
        let thread_id = message
            .pointer("/params/threadId")
            .and_then(Value::as_str)
            .or_else(|| message.pointer("/params/thread/id").and_then(Value::as_str));
        let turn_id = message
            .pointer("/params/turnId")
            .and_then(Value::as_str)
            .or_else(|| message.pointer("/params/turn/id").and_then(Value::as_str));
        let owner = thread_id
            .and_then(|thread_id| routes.get(thread_id))
            .and_then(|route| route.owner_for_message(turn_id));
        (disposition, owner)
    }
}

fn codex_ingress_disposition(
    message: &Value,
    routes: &HashMap<String, CodexThreadRoute>,
) -> CodexIngressDisposition {
    if message.get("id").is_some() {
        return CodexIngressDisposition::Forward;
    }
    match message.get("method").and_then(Value::as_str) {
        Some("command/exec/outputDelta") => CodexIngressDisposition::DropRejectedDelta,
        Some("item/commandExecution/outputDelta") => {
            let Some(thread_id) = message.pointer("/params/threadId").and_then(Value::as_str)
            else {
                return CodexIngressDisposition::DropRejectedDelta;
            };
            let Some(turn_id) = message.pointer("/params/turnId").and_then(Value::as_str) else {
                return CodexIngressDisposition::DropRejectedDelta;
            };
            if !message
                .pointer("/params/itemId")
                .and_then(Value::as_str)
                .is_some_and(|item_id| !item_id.trim().is_empty())
            {
                return CodexIngressDisposition::DropRejectedDelta;
            }
            if routes
                .get(thread_id)
                .is_some_and(|route| route.active_turn_id.as_deref() == Some(turn_id))
            {
                CodexIngressDisposition::DropCurrentDelta
            } else {
                CodexIngressDisposition::DropRejectedDelta
            }
        }
        _ => CodexIngressDisposition::Forward,
    }
}

async fn route_codex_stdout_ingress(
    host_instance_id: &str,
    routes: &CodexThreadRoutes,
    incoming: &mpsc::UnboundedSender<CodexIncoming>,
    message: Value,
) -> (CodexIngressDisposition, Option<Value>) {
    let request_id = message.get("id").cloned();
    let (disposition, owner) = routes.ingress_route(&message).await;
    match disposition {
        CodexIngressDisposition::DropCurrentDelta | CodexIngressDisposition::DropRejectedDelta => {
            (disposition, None)
        }
        CodexIngressDisposition::Forward => {
            if let Some(owner) = owner {
                let _ = incoming.send(owner.message(host_instance_id, message));
                (disposition, None)
            } else {
                (disposition, request_id)
            }
        }
    }
}

struct PendingRpc {
    sender: oneshot::Sender<std::result::Result<Value, String>>,
    turn_activation: Option<(String, CodexRuntimeOwner)>,
}

impl CodexHost {
    async fn spawn_with_executable(
        codex_path: &Path,
        cwd: &Path,
        incoming: mpsc::UnboundedSender<CodexIncoming>,
        builtin_tools: Option<BuiltinToolProcessConfig>,
    ) -> Result<Arc<Self>> {
        let mut command = Command::new(codex_path);
        configure_active_runtime_command(&mut command);
        if let Some(config) = &builtin_tools {
            config.configure_command(&mut command)?;
        }
        command
            .args(["app-server", "--listen", "stdio://"])
            .current_dir(cwd);
        let spec = ManagedProcessLaunchSpec::capture(
            &command,
            ManagedProcessPurpose::RuntimeHost,
            ManagedStdinPolicy::Piped,
            ManagedWindowsArgvDialect::MicrosoftCrt,
            "runtime-host:codex-cli",
        )?;
        let mut child = ManagedProcess::spawn(spec)
            .with_context(|| format!("failed to start {} app-server", codex_path.display()))?;
        let stdin = child
            .take_stdin()
            .context("Codex app-server stdin was unavailable")?;
        let stdout = child
            .take_stdout()
            .context("Codex app-server stdout was unavailable")?;
        let stderr = child
            .take_stderr()
            .context("Codex app-server stderr was unavailable")?;
        let host = Arc::new(Self {
            host_instance_id: uuid::Uuid::new_v4().to_string(),
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            routes: CodexThreadRoutes::default(),
            incoming,
            alive: AtomicBool::new(true),
            executable_path: codex_path.to_path_buf(),
            builtin_tools,
        });
        Self::spawn_stdout_reader(host.clone(), stdout);
        Self::spawn_stderr_reader(host.clone(), stderr);
        let initialized = host
            .rpc(
                "initialize",
                json!({
                    "clientInfo": {
                        "name": "rovai",
                        "title": "Rovai-ai",
                        "version": env!("CARGO_PKG_VERSION")
                    },
                    "capabilities": {
                        "experimentalApi": true
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

    fn spawn_stdout_reader(host: Arc<Self>, stdout: ManagedChildStdout) {
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
                        let (disposition, unrouted_request_id) = route_codex_stdout_ingress(
                            &host.host_instance_id,
                            &host.routes,
                            &host.incoming,
                            message,
                        )
                        .await;
                        match disposition {
                            CodexIngressDisposition::DropCurrentDelta
                            | CodexIngressDisposition::DropRejectedDelta => continue,
                            CodexIngressDisposition::Forward => {}
                        }
                        if let Some(id) = unrouted_request_id {
                            let _ = host
                                .send(json!({
                                    "id": id,
                                    "error": {
                                        "code": -32601,
                                        "message": "Rovai-ai has no active Native Thread binding for this request"
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

    fn spawn_stderr_reader(host: Arc<Self>, stderr: ManagedChildStderr) {
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
        self.routes.bind_thread(thread_id, owner).await
    }

    async fn activate_turn(
        &self,
        thread_id: &str,
        owner: &CodexRuntimeOwner,
        turn_id: &str,
    ) -> Result<()> {
        self.routes.activate_turn(thread_id, owner, turn_id).await
    }

    async fn deactivate_turn(
        &self,
        thread_id: &str,
        owner: &CodexRuntimeOwner,
        completed_turn_id: Option<&str>,
    ) {
        self.routes
            .deactivate_turn(thread_id, owner, completed_turn_id)
            .await;
    }

    async fn active_turn(&self, thread_id: &str, owner: &CodexRuntimeOwner) -> Option<String> {
        self.routes.active_turn(thread_id, owner).await
    }

    async fn unbind_thread(&self, thread_id: &str, owner: &CodexRuntimeOwner) {
        self.routes.unbind_thread(thread_id, owner).await;
    }

    async fn owners(&self) -> HashSet<CodexRuntimeOwner> {
        self.routes.owners().await
    }

    async fn broadcast_stderr(&self, text: String) {
        for owner in self.owners().await {
            let _ = self
                .incoming
                .send(owner.stderr(&self.host_instance_id, text.clone()));
        }
    }

    pub(crate) fn host_instance_id(&self) -> &str {
        &self.host_instance_id
    }

    pub(crate) fn pid(&self) -> Option<u32> {
        self.child.try_lock().ok().and_then(|child| child.id())
    }

    pub(crate) fn executable_path(&self) -> &Path {
        &self.executable_path
    }

    pub(crate) fn builtin_tool_process_config(&self) -> Option<&BuiltinToolProcessConfig> {
        self.builtin_tools.as_ref()
    }

    pub(crate) fn is_alive(&self) -> bool {
        self.alive.load(Ordering::Acquire)
    }

    async fn shutdown(&self) {
        self.shutdown_and_reap().await;
    }

    pub(crate) async fn is_quiescent(&self) -> bool {
        self.is_alive() && self.pending.lock().await.is_empty() && self.routes.is_empty().await
    }

    pub(crate) async fn shutdown_and_reap(&self) {
        self.alive.store(false, Ordering::Release);
        let mut child = self.child.lock().await;
        let _ = child.request_graceful_termination();
        if timeout(Duration::from_secs(3), child.wait()).await.is_err() {
            let _ = child.force_terminate_tree();
            let _ = timeout(Duration::from_secs(1), child.wait()).await;
        }
        let _ = child.force_terminate_tree();
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
    camp_id: Option<String>,
    host: Arc<CodexHost>,
    thread_id: RwLock<Option<String>>,
    observed_model_id: RwLock<Option<String>>,
    action_items: Mutex<HashMap<String, Value>>,
    streamed_agent_text: Mutex<String>,
    completed_agent_message: RwLock<Option<String>>,
}

#[derive(Debug)]
pub(crate) struct CodexLiveModelValidationError {
    pub code: &'static str,
    model_id: String,
    detail: String,
}

impl std::fmt::Display for CodexLiveModelValidationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "{} for explicit model {}: {}",
            self.code, self.model_id, self.detail
        )
    }
}

impl std::error::Error for CodexLiveModelValidationError {}

struct CodexThreadStartOptions<'a> {
    developer_instructions: Option<&'a str>,
    sandbox: &'a str,
    approval_policy: &'a str,
    model: Option<&'a str>,
    config: Option<Value>,
    runtime_workspace_roots: Option<Vec<String>>,
    ephemeral: bool,
}

pub struct CodexAgentThreadOptions<'a> {
    pub existing_thread_id: Option<&'a str>,
    pub developer_instructions: Option<&'a str>,
    pub sandbox_mode: &'a str,
    pub approval_policy: &'a str,
    pub model: Option<&'a str>,
    pub attachment_access_root: &'a Path,
    pub external_mcp_servers: &'a BTreeMap<String, McpServerDefinition>,
}

impl CodexRuntime {
    fn from_host(
        owner: CodexRuntimeOwner,
        camp_id: Option<String>,
        host: Arc<CodexHost>,
    ) -> Arc<Self> {
        Arc::new(Self {
            owner,
            camp_id,
            host,
            thread_id: RwLock::new(None),
            observed_model_id: RwLock::new(None),
            action_items: Mutex::new(HashMap::new()),
            streamed_agent_text: Mutex::new(String::new()),
            completed_agent_message: RwLock::new(None),
        })
    }

    pub async fn start_or_resume_agent_thread(
        &self,
        cwd: &Path,
        options: CodexAgentThreadOptions<'_>,
    ) -> Result<String> {
        let run_tmp = self
            .host
            .builtin_tool_process_config()
            .context("Codex Runtime has no Built-in Tool Run tmp")?
            .run_tmp();
        self.start_or_resume_thread_with_config(
            cwd,
            options.existing_thread_id,
            CodexThreadStartOptions {
                developer_instructions: options.developer_instructions,
                sandbox: options.sandbox_mode,
                approval_policy: options.approval_policy,
                model: options.model.filter(|model| *model != "default"),
                config: if options.external_mcp_servers.is_empty() {
                    None
                } else {
                    Some(codex_mcp_session_config(options.external_mcp_servers)?)
                },
                runtime_workspace_roots: Some(agent_runtime_workspace_roots(
                    cwd,
                    options.attachment_access_root,
                    run_tmp,
                )),
                ephemeral: false,
            },
        )
        .await
    }

    pub async fn discover_native_mcp_server_names(
        &self,
        cwd: &Path,
    ) -> Result<std::collections::BTreeSet<String>> {
        let response = self
            .rpc(
                "config/read",
                json!({
                    "cwd": cwd.to_string_lossy(),
                    "includeLayers": true,
                }),
            )
            .await?;
        native_mcp_server_names_from_config_read(&response)
    }

    pub async fn validate_explicit_model(&self, model_id: &str) -> Result<()> {
        let mut cursor: Option<String> = None;
        let mut pages = 0_u8;
        loop {
            let response = self
                .rpc(
                    "model/list",
                    json!({
                        "cursor": cursor,
                        "includeHidden": true,
                        "limit": 100,
                    }),
                )
                .await
                .map_err(|error| {
                    anyhow::Error::new(CodexLiveModelValidationError {
                        code: "runtime_model_catalog_unavailable",
                        model_id: model_id.to_string(),
                        detail: error.to_string(),
                    })
                })?;
            let models = response
                .get("data")
                .and_then(Value::as_array)
                .ok_or_else(|| {
                    anyhow::Error::new(CodexLiveModelValidationError {
                        code: "runtime_model_catalog_unavailable",
                        model_id: model_id.to_string(),
                        detail: "model/list did not return data".to_string(),
                    })
                })?;
            if models.iter().any(|model| {
                model.get("id").and_then(Value::as_str) == Some(model_id)
                    && !model
                        .get("hidden")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
            }) {
                return Ok(());
            }
            cursor = response
                .get("nextCursor")
                .and_then(Value::as_str)
                .map(str::to_string);
            if cursor.is_none() {
                return Err(anyhow::Error::new(CodexLiveModelValidationError {
                    code: "runtime_model_unavailable",
                    model_id: model_id.to_string(),
                    detail: "the real Codex host did not advertise the saved model".to_string(),
                }));
            }
            pages = pages.saturating_add(1);
            if pages >= 100 {
                return Err(anyhow::Error::new(CodexLiveModelValidationError {
                    code: "runtime_model_catalog_unavailable",
                    model_id: model_id.to_string(),
                    detail: "model/list exceeded the pagination safety limit".to_string(),
                }));
            }
        }
    }

    async fn start_or_resume_thread_with_config(
        &self,
        cwd: &Path,
        existing_thread_id: Option<&str>,
        options: CodexThreadStartOptions<'_>,
    ) -> Result<String> {
        let (method, request) = thread_start_or_resume_request(cwd, existing_thread_id, options)?;
        let result = self.rpc(method, request).await?;
        let observed_model_id = runtime_model_id_from_thread_response(&result);
        let thread_id = result
            .pointer("/thread/id")
            .and_then(Value::as_str)
            .context("Codex thread response did not include thread.id")?
            .to_string();
        self.host.bind_thread(&thread_id, &self.owner).await?;
        *self.thread_id.write().await = Some(thread_id.clone());
        *self.observed_model_id.write().await = observed_model_id;
        Ok(thread_id)
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
        let request = turn_start_request(&thread_id, text, model, reasoning_effort);
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

    pub async fn observed_model_id(&self) -> Option<String> {
        self.observed_model_id.read().await.clone()
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
            "item/completed" => {
                if params.pointer("/item/type").and_then(Value::as_str) == Some("agentMessage") {
                    if let Some(text) = params.pointer("/item/text").and_then(Value::as_str)
                        && !text.trim().is_empty()
                    {
                        *self.completed_agent_message.write().await = Some(text.to_string());
                    }
                } else if let Some(item_id) = params.pointer("/item/id").and_then(Value::as_str) {
                    self.action_items.lock().await.remove(item_id);
                }
            }
            _ => {}
        }
    }

    pub async fn action_item(&self, item_id: &str) -> Option<Value> {
        self.action_items.lock().await.get(item_id).cloned()
    }

    pub async fn open_action_items(&self) -> Vec<Value> {
        let mut items = self
            .action_items
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        items.sort_by(|left, right| {
            left.get("id")
                .and_then(Value::as_str)
                .cmp(&right.get("id").and_then(Value::as_str))
        });
        items
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

    pub(crate) async fn detach(&self) {
        if let Some(thread_id) = self.thread_id().await {
            self.host.unbind_thread(&thread_id, &self.owner).await;
        }
    }

    pub fn host_instance_id(&self) -> &str {
        &self.host.host_instance_id
    }

    pub(crate) fn builtin_tool_process_config(&self) -> Option<&BuiltinToolProcessConfig> {
        self.host.builtin_tool_process_config()
    }

    #[cfg(test)]
    pub async fn process_id(&self) -> Option<u32> {
        self.host.child.lock().await.id()
    }

    fn belongs_to_camp(&self, camp_id: &str) -> bool {
        self.camp_id.as_deref() == Some(camp_id)
    }

    async fn rpc(&self, method: &str, params: Value) -> Result<Value> {
        self.host.rpc(method, params).await
    }

    async fn send(&self, message: Value) -> Result<()> {
        self.host.send(message).await
    }
}

fn agent_runtime_workspace_roots(
    execution_root: &Path,
    attachment_access_root: &Path,
    run_tmp: &Path,
) -> Vec<String> {
    [execution_root, attachment_access_root, run_tmp]
        .into_iter()
        .map(|root| root.to_string_lossy().into_owned())
        .collect()
}

fn runtime_model_id_from_thread_response(response: &Value) -> Option<String> {
    response
        .get("model")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|model_id| !model_id.is_empty())
        .map(str::to_string)
}

fn thread_start_or_resume_request(
    cwd: &Path,
    existing_thread_id: Option<&str>,
    options: CodexThreadStartOptions<'_>,
) -> Result<(&'static str, Value)> {
    let mut request = json!({
        "cwd": cwd.to_string_lossy(),
        "approvalPolicy": options.approval_policy,
        "approvalsReviewer": "user",
        "sandbox": options.sandbox,
    });
    if let Some(developer_instructions) = options.developer_instructions {
        request
            .as_object_mut()
            .expect("thread request is an object")
            .insert(
                "developerInstructions".to_string(),
                Value::String(developer_instructions.to_string()),
            );
    }
    if let Some(model) = options.model {
        request
            .as_object_mut()
            .expect("thread request is an object")
            .insert("model".to_string(), Value::String(model.to_string()));
    }
    if let Some(config) = options.config {
        request
            .as_object_mut()
            .expect("thread request is an object")
            .insert("config".to_string(), config);
    }
    if let Some(runtime_workspace_roots) = options.runtime_workspace_roots {
        request
            .as_object_mut()
            .expect("thread request is an object")
            .insert(
                "runtimeWorkspaceRoots".to_string(),
                serde_json::to_value(runtime_workspace_roots)?,
            );
    }
    if options.ephemeral {
        request
            .as_object_mut()
            .expect("thread request is an object")
            .insert("ephemeral".to_string(), Value::Bool(true));
    }
    if let Some(thread_id) = existing_thread_id {
        request
            .as_object_mut()
            .expect("thread request is an object")
            .insert("threadId".to_string(), Value::String(thread_id.to_string()));
        Ok(("thread/resume", request))
    } else {
        Ok(("thread/start", request))
    }
}

fn codex_mcp_session_config(
    external_mcp_servers: &BTreeMap<String, McpServerDefinition>,
) -> Result<Value> {
    let mut servers = serde_json::Map::new();
    for (name, definition) in external_mcp_servers {
        if name.trim().is_empty() || name.contains('\0') {
            bail!("invalid Codex MCP server name");
        }
        let value = match definition {
            McpServerDefinition::Stdio {
                command,
                args,
                cwd,
                env,
            } => json!({
                "command": command,
                "args": args,
                "cwd": cwd,
                "env": env,
                "enabled": true,
            }),
            McpServerDefinition::StreamableHttp { url, headers } => json!({
                "url": url,
                "http_headers": headers,
                "enabled": true,
            }),
        };
        servers.insert(name.clone(), value);
    }
    Ok(json!({"mcp_servers": servers}))
}

fn native_mcp_server_names_from_config_read(
    response: &Value,
) -> Result<std::collections::BTreeSet<String>> {
    let mut names = std::collections::BTreeSet::new();
    let mut recognized_shape = false;
    if let Some(config) = response.get("config").and_then(Value::as_object) {
        recognized_shape = true;
        names.extend(
            config
                .get("mcp_servers")
                .or_else(|| config.get("mcpServers"))
                .and_then(Value::as_object)
                .into_iter()
                .flat_map(|servers| servers.keys().cloned()),
        );
    }
    if let Some(layers) = response.get("layers").and_then(Value::as_array) {
        recognized_shape = true;
        for layer in layers {
            if let Some(servers) = layer
                .get("config")
                .and_then(Value::as_object)
                .and_then(|config| {
                    config
                        .get("mcp_servers")
                        .or_else(|| config.get("mcpServers"))
                })
                .and_then(Value::as_object)
            {
                names.extend(servers.keys().cloned());
            }
        }
    }
    if let Some(origins) = response.get("origins").and_then(Value::as_object) {
        recognized_shape = true;
        for key in origins.keys() {
            let Some(remainder) = key
                .strip_prefix("mcp_servers.")
                .or_else(|| key.strip_prefix("mcpServers."))
            else {
                continue;
            };
            if let Some(name) = remainder.split('.').next().filter(|name| !name.is_empty()) {
                names.insert(name.to_string());
            }
        }
    }
    if !recognized_shape {
        anyhow::bail!("Codex config/read omitted effective config and layers");
    }
    Ok(names)
}

pub struct CodexCliRuntimeAdapter {
    agent_run_runtimes: Mutex<HashMap<String, Arc<CodexRuntime>>>,
    runtime_creation: Mutex<()>,
    incoming: mpsc::UnboundedSender<CodexIncoming>,
    fleet: Arc<AgentRuntimeFleetManager>,
}

pub struct CodexAgentRunRuntimeRequest<'a> {
    pub agent_run_id: &'a str,
    pub execution_epoch: i64,
    pub camp_id: &'a str,
    pub agent_id: &'a str,
    pub cwd: &'a Path,
    pub frozen_runtime: &'a FrozenAgentRuntimeConfig,
    pub runtime_compatibility_digest: &'a str,
    pub builtin_tools: &'a BuiltinToolProcessConfig,
}

impl AgentRuntimeAdapter for CodexCliRuntimeAdapter {
    fn kind(&self) -> AdapterKind {
        AdapterKind::CodexCli
    }

    fn skill_discovery(&self) -> SkillDiscoveryCapability {
        AgentRuntimeAdapterRegistry::default().skill_discovery(self.kind())
    }

    fn mcp_projection(&self) -> McpProjectionCapability {
        AgentRuntimeAdapterRegistry::default().mcp_projection(self.kind())
    }

    fn resolve_runtime(
        &self,
        input: AdapterRuntimeResolutionInput<'_>,
    ) -> Result<AdapterRuntimeProjection> {
        AgentRuntimeAdapterRegistry::default().resolve_runtime(self.kind(), input)
    }
}

impl CodexCliRuntimeAdapter {
    pub fn new(
        incoming: mpsc::UnboundedSender<CodexIncoming>,
        fleet: Arc<AgentRuntimeFleetManager>,
    ) -> Self {
        Self {
            agent_run_runtimes: Mutex::new(HashMap::new()),
            runtime_creation: Mutex::new(()),
            incoming,
            fleet,
        }
    }

    pub async fn ensure_agent_run_runtime(
        &self,
        request: CodexAgentRunRuntimeRequest<'_>,
    ) -> Result<Arc<CodexRuntime>> {
        let CodexAgentRunRuntimeRequest {
            agent_run_id,
            execution_epoch,
            camp_id,
            agent_id,
            cwd,
            frozen_runtime,
            runtime_compatibility_digest,
            builtin_tools,
        } = request;
        if frozen_runtime.adapter_kind != AdapterKind::CodexCli {
            bail!("Codex Runtime received a non-Codex AgentRun");
        }
        let _creation = self.runtime_creation.lock().await;
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
            let old_epoch = runtime.agent_run_epoch().unwrap_or(execution_epoch);
            runtime.detach().await;
            self.agent_run_runtimes.lock().await.remove(agent_run_id);
            self.fleet
                .release(agent_run_id, old_epoch, FleetReleaseDisposition::Stop)
                .await;
        }
        let fleet_lease = self
            .fleet
            .acquire(
                FleetAcquireRequest {
                    agent_run_id: agent_run_id.to_string(),
                    execution_epoch,
                    adapter_kind: AdapterKind::CodexCli,
                    compatibility: RuntimeCompatibilityKey {
                        camp_id: camp_id.to_string(),
                        agent_id: agent_id.to_string(),
                        runtime_compatibility_digest: runtime_compatibility_digest.to_string(),
                    },
                },
                || async {
                    let host = CodexHost::spawn_with_executable(
                        Path::new(&frozen_runtime.executable_path),
                        cwd,
                        self.incoming.clone(),
                        Some(builtin_tools.clone()),
                    )
                    .await?;
                    Ok(RuntimeProcessHost::Codex(host))
                },
            )
            .await?;
        let _process_id = &fleet_lease.process_id;
        let _residency = fleet_lease.residency;
        let host = fleet_lease.host.into_codex()?;
        let runtime = CodexRuntime::from_host(
            CodexRuntimeOwner::AgentRun {
                agent_run_id: agent_run_id.to_string(),
                execution_epoch,
            },
            Some(camp_id.to_string()),
            host,
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
            runtime.detach().await;
        }
        self.fleet
            .release(agent_run_id, execution_epoch, FleetReleaseDisposition::Stop)
            .await;
    }

    pub async fn complete_agent_run(&self, agent_run_id: &str, execution_epoch: i64) {
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
            runtime.detach().await;
        }
        self.fleet
            .release(
                agent_run_id,
                execution_epoch,
                FleetReleaseDisposition::Reusable,
            )
            .await;
    }

    pub async fn forget_camp(&self, camp_id: &str) {
        let runtimes = {
            let mut active = self.agent_run_runtimes.lock().await;
            let ids = active
                .iter()
                .filter_map(|(agent_run_id, runtime)| {
                    runtime
                        .belongs_to_camp(camp_id)
                        .then_some(agent_run_id.clone())
                })
                .collect::<Vec<_>>();
            ids.into_iter()
                .filter_map(|agent_run_id| active.remove(&agent_run_id))
                .collect::<Vec<_>>()
        };
        for runtime in runtimes {
            runtime.detach().await;
        }
        self.fleet.invalidate_camp(camp_id).await;
    }

    pub async fn shutdown_all(&self) {
        let agent_runtimes = self
            .agent_run_runtimes
            .lock()
            .await
            .drain()
            .map(|(_, runtime)| runtime)
            .collect::<Vec<_>>();
        for runtime in agent_runtimes {
            runtime.detach().await;
        }
    }
}

pub(crate) fn runtime_compatibility_digest(
    frozen_runtime: &FrozenAgentRuntimeConfig,
    cwd: &Path,
    attachment_authorization: &CampAttachmentRuntimeAuthorization,
) -> Result<String> {
    let cwd = cwd
        .canonicalize()
        .with_context(|| format!("failed to resolve execution root {}", cwd.display()))?;
    canonical_json_digest(&json!({
        "schemaVersion": 2,
        "adapterKind": frozen_runtime.adapter_kind,
        "runtimeConfigDigest": frozen_runtime.config_digest,
        "hostConfigDigest": frozen_runtime.host_config_digest,
        "executionRoot": cwd,
        "builtinToolContractVersion": BUILTIN_TOOL_CONTRACT_VERSION,
        "builtinToolCatalogDigest": builtin_tool_catalog_digest()?,
        "campAttachmentViewContractVersion": CAMP_ATTACHMENT_VIEW_CONTRACT_VERSION,
        "campAttachmentRoot": attachment_authorization.attachment_root,
        "campAttachmentVisibilityMode": attachment_authorization.visibility_mode.as_str(),
        "campAttachmentGeneration": attachment_authorization
            .visibility_mode
            .compatibility_generation(attachment_authorization.generation),
    }))
}

fn turn_start_request(
    thread_id: &str,
    text: &str,
    model: Option<&str>,
    reasoning_effort: Option<&str>,
) -> Value {
    let mut request = json!({
        "threadId": thread_id,
        "clientUserMessageId": uuid::Uuid::new_v4().to_string(),
        "input": [{"type": "text", "text": text}],
        "summary": "auto"
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
    request
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
    // Keep the complete Runtime request private to Core so the frozen request
    // digest and the eventual native response are bound to the exact shape
    // received from Codex. The public Approval read model exposes only the
    // canonical action summary and safe option metadata.
    let response_context = params.clone();
    let options = approval_options(native_method, &response_context)?;
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
            options,
        },
        reason: params
            .get("reason")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

fn approval_options(method: &str, request: &Value) -> Result<Vec<RuntimePermissionOption>> {
    let decisions = if method == "item/permissions/requestApproval" {
        &[
            (
                "decline",
                "deny",
                "拒绝",
                "拒绝当前权限请求，不向 Runtime 授予所申请权限。",
                false,
            ),
            (
                "accept",
                "allow_once",
                "允许一次",
                "仅允许当前请求；后续请求仍可能再次询问。",
                true,
            ),
            (
                "acceptForSession",
                "allow_session",
                "本 Session 允许",
                "允许当前 Native Session 内使用该权限，不修改 Agent 的长期配置。",
                true,
            ),
        ][..]
    } else {
        &[
            (
                "cancel",
                "cancel",
                "取消",
                "取消当前请求，不执行该操作。",
                false,
            ),
            (
                "decline",
                "deny",
                "拒绝",
                "拒绝当前操作；Agent 可继续采用其他方式。",
                false,
            ),
            (
                "accept",
                "allow_once",
                "允许一次",
                "仅允许当前操作；后续相同操作仍可能再次询问。",
                true,
            ),
            (
                "acceptForSession",
                "allow_session",
                "本 Session 允许",
                "允许当前 Native Session 内的同类操作，不修改 Agent 的长期配置。",
                true,
            ),
        ][..]
    };
    decisions
        .iter()
        .map(|(option_id, kind, label, consequence, allows_action)| {
            RuntimePermissionOption::from_native(
                *option_id,
                *kind,
                *label,
                *consequence,
                approval_result(method, request, option_id)?,
                *allows_action,
            )
        })
        .collect()
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
        "item/reasoning/summaryTextDelta" => ("agent.reasoning.summary.delta", params.clone()),
        "turn/plan/updated" => ("runtime.plan", params.clone()),
        "item/plan/delta" => ("runtime.plan.delta", params.clone()),
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
        "item/completed" => ("activity.completed", completed_activity_payload(params)),
        _ => (
            "runtime.native",
            json!({"method": method, "params": params}),
        ),
    }
}

fn completed_activity_payload(params: &Value) -> Value {
    let mut payload = params.clone();
    let Some(item) = params.get("item") else {
        return payload;
    };
    if item.get("type").and_then(Value::as_str) != Some("fileChange")
        || item.get("status").and_then(Value::as_str) != Some("completed")
    {
        return payload;
    }
    let Some(changes) = item.get("changes").and_then(Value::as_array) else {
        return payload;
    };
    if changes.is_empty() {
        return payload;
    }
    payload["runtimeDiff"] = json!({
        "adapterKind": "codex-cli",
        "protocolFamily": "codex-app-server",
        "sourceEventKind": "item/completed.fileChange.completed",
        "semanticKind": "codex_file_change_snapshot",
        "entries": changes,
    });
    payload
}

pub struct CompletedTurn {
    pub turn_id: String,
    pub status: String,
    pub final_agent_message: Option<String>,
    pub error: Option<Value>,
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
    let error = turn.get("error").filter(|value| !value.is_null()).cloned();
    Ok(CompletedTurn {
        turn_id,
        status,
        final_agent_message,
        error,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    fn make_test_executable(path: &Path, body: &str) {
        use std::os::unix::fs::PermissionsExt;

        std::fs::write(path, body).unwrap();
        let mut permissions = std::fs::metadata(path).unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(path, permissions).unwrap();
    }

    fn bootstrap_thread_options<'a>(bootstrap: &'a str) -> CodexThreadStartOptions<'a> {
        CodexThreadStartOptions {
            developer_instructions: Some(bootstrap),
            sandbox: "workspace-write",
            approval_policy: "never",
            model: Some("test-model"),
            config: None,
            runtime_workspace_roots: None,
            ephemeral: false,
        }
    }

    #[test]
    fn only_completed_file_change_items_create_runtime_diff_candidates() {
        let completed = completed_activity_payload(&json!({
            "item": {
                "id": "change-1",
                "type": "fileChange",
                "status": "completed",
                "changes": [{
                    "path": "src/app.ts",
                    "kind": {"type": "update"},
                    "diff": "@@ -1 +1 @@\n-old\n+new\n"
                }]
            }
        }));
        assert_eq!(
            completed.pointer("/runtimeDiff/sourceEventKind"),
            Some(&json!("item/completed.fileChange.completed"))
        );
        assert_eq!(
            completed.pointer("/runtimeDiff/entries/0/path"),
            Some(&json!("src/app.ts"))
        );

        for payload in [
            json!({"item": {"type": "fileChange", "status": "inProgress", "changes": [{"path": "src/app.ts", "diff": "+partial"}]}}),
            json!({"item": {"type": "commandExecution", "status": "completed", "changes": [{"path": "src/app.ts", "diff": "+guessed"}]}}),
            json!({"item": {"type": "fileChange", "status": "completed", "changes": []}}),
        ] {
            assert!(
                completed_activity_payload(&payload)
                    .get("runtimeDiff")
                    .is_none()
            );
        }
    }

    #[test]
    fn start_and_resume_requests_both_include_developer_instructions() {
        let (start_method, start) = thread_start_or_resume_request(
            Path::new("/tmp/rovai-codex-test"),
            None,
            bootstrap_thread_options("bootstrap-start"),
        )
        .unwrap();
        assert_eq!(start_method, "thread/start");
        assert_eq!(start["developerInstructions"], "bootstrap-start");
        assert!(start.get("threadId").is_none());

        let (resume_method, resume) = thread_start_or_resume_request(
            Path::new("/tmp/rovai-codex-test"),
            Some("thread-existing"),
            bootstrap_thread_options("bootstrap-latest"),
        )
        .unwrap();
        assert_eq!(resume_method, "thread/resume");
        assert_eq!(resume["threadId"], "thread-existing");
        assert_eq!(resume["developerInstructions"], "bootstrap-latest");
    }

    #[test]
    fn agent_workspace_roots_include_execution_attachment_and_run_tmp() {
        assert_eq!(
            agent_runtime_workspace_roots(
                Path::new("/tmp/rovai-workspace"),
                Path::new("/tmp/rovai-attachments"),
                Path::new("/tmp/rovai-run-tmp"),
            ),
            vec![
                "/tmp/rovai-workspace".to_string(),
                "/tmp/rovai-attachments".to_string(),
                "/tmp/rovai-run-tmp".to_string(),
            ]
        );
    }

    #[test]
    fn thread_response_exposes_only_a_nonempty_runtime_model() {
        assert_eq!(
            runtime_model_id_from_thread_response(&json!({
                "thread": {"id": "thread-1"},
                "model": "gpt-5.6"
            })),
            Some("gpt-5.6".to_string())
        );
        assert_eq!(
            runtime_model_id_from_thread_response(&json!({
                "thread": {"id": "thread-1"},
                "model": "  "
            })),
            None
        );
        assert_eq!(
            runtime_model_id_from_thread_response(&json!({"thread": {"id": "thread-1"}})),
            None
        );
    }

    #[test]
    fn config_read_discovery_collects_effective_layered_and_origin_native_names() {
        let effective = json!({
            "config": {
                "mcp_servers": {
                    "docs": {"command": "node"},
                    "remote": {"url": "https://example.test/mcp"}
                }
            }
        });
        assert_eq!(
            native_mcp_server_names_from_config_read(&effective).unwrap(),
            ["docs".to_string(), "remote".to_string()]
                .into_iter()
                .collect()
        );

        let layered = json!({
            "layers": [
                {"disabledReason": null, "config": {"mcp_servers": {"native": {}}}},
                {"disabledReason": "project trust pending", "config": {"mcp_servers": {"reserved": {}}}}
            ]
        });
        assert_eq!(
            native_mcp_server_names_from_config_read(&layered).unwrap(),
            ["native".to_string(), "reserved".to_string()]
                .into_iter()
                .collect()
        );

        let effective_omits_mcp_but_layer_preserves_it = json!({
            "config": {"model": "gpt-5.6-sol"},
            "layers": [
                {"disabledReason": null, "config": {"mcpServers": {"project_docs": {}}}}
            ]
        });
        assert_eq!(
            native_mcp_server_names_from_config_read(&effective_omits_mcp_but_layer_preserves_it)
                .unwrap(),
            ["project_docs".to_string()].into_iter().collect()
        );

        let origins_preserve_omitted_mcp = json!({
            "config": {"model": "gpt-5.6-sol"},
            "origins": {
                "mcp_servers.project_docs.command": {"name": {"type": "project"}},
                "mcpServers.remote.url": {"name": {"type": "user"}}
            }
        });
        assert_eq!(
            native_mcp_server_names_from_config_read(&origins_preserve_omitted_mcp).unwrap(),
            ["project_docs".to_string(), "remote".to_string()]
                .into_iter()
                .collect()
        );
    }

    #[test]
    fn session_config_contains_only_finalized_additive_servers() {
        let config = codex_mcp_session_config(&BTreeMap::from([(
            "rovai_docs".to_string(),
            McpServerDefinition::StreamableHttp {
                url: "https://example.test/mcp".to_string(),
                headers: BTreeMap::new(),
            },
        )]))
        .unwrap();
        assert_eq!(
            config.pointer("/mcp_servers/rovai_docs/url"),
            Some(&json!("https://example.test/mcp"))
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn real_host_catalog_rejects_a_missing_explicit_model_without_fallback() {
        let root = std::env::temp_dir().join(format!(
            "rovai-codex-live-model-validation-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let executable = root.join("codex");
        make_test_executable(
            &executable,
            r#"#!/bin/sh
IFS= read -r initialize || exit 1
printf '%s\n' '{"id":1,"result":{}}'
IFS= read -r initialized || exit 1
IFS= read -r model_list || exit 1
printf '%s\n' '{"id":2,"result":{"data":[{"id":"gpt-current","hidden":false}],"nextCursor":null}}'
while IFS= read -r ignored; do :; done
"#,
        );
        let (incoming, _receiver) = mpsc::unbounded_channel();
        let host = CodexHost::spawn_with_executable(&executable, &root, incoming, None)
            .await
            .unwrap();
        let runtime = CodexRuntime::from_host(
            CodexRuntimeOwner::AgentRun {
                agent_run_id: "run-live-model-validation".to_string(),
                execution_epoch: 1,
            },
            Some("camp-live-model-validation".to_string()),
            host.clone(),
        );

        let error = runtime
            .validate_explicit_model("claude-opus-5")
            .await
            .expect_err("a model absent from the real host catalog must fail closed");
        let validation = error
            .downcast_ref::<CodexLiveModelValidationError>()
            .expect("the launch layer needs a typed model failure");
        assert_eq!(validation.code, "runtime_model_unavailable");

        host.shutdown().await;
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    #[ignore = "manual local Runtime smoke"]
    async fn agent_runs_use_distinct_processes_and_native_home_sessions() {
        let executable = crate::health::find_codex().expect("Codex CLI must be installed");
        let directory = std::env::temp_dir().join(format!(
            "rovai-codex-agent-run-process-smoke-{}",
            uuid::Uuid::new_v4()
        ));
        let workspace = directory.join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        std::fs::write(
            workspace.join("AGENTS.md"),
            "# Native Home smoke instruction\n",
        )
        .unwrap();
        let runtime_config = FrozenAgentRuntimeConfig {
            adapter_kind: AdapterKind::CodexCli,
            installation_id: "smoke".to_string(),
            installation_generation: 1,
            search_environment_generation: 1,
            executable_path: executable.to_string_lossy().to_string(),
            auth_scope: "local_user".to_string(),
            reported_version: Some("smoke".to_string()),
            executable_fingerprint: rovai_core::agent_runtime_adapter::executable_fingerprint(
                &executable,
            )
            .unwrap(),
            capabilities: vec!["codex.app_server_v2".to_string()],
            protocol_version: "codex-app-server-v2".to_string(),
            model: rovai_core::agent_profile::ResolvedModelSelection {
                source: "runtime_default".to_string(),
                model_id: "default".to_string(),
                options: json!({}),
            },
            permissions: rovai_core::agent_profile::AdapterPermissionConfig {
                adapter_kind: AdapterKind::CodexCli,
                schema_version: 1,
                values: json!({}),
            },
            native_session_compatibility_key: Some("codex-cli:app-server-v2".to_string()),
            binding_compatibility_digest: "smoke-binding".to_string(),
            host_config_digest: "smoke-host".to_string(),
            config_digest: "smoke-config".to_string(),
        };
        let fleet = Arc::new(AgentRuntimeFleetManager::new(Default::default()));
        let (incoming, mut receiver) = mpsc::unbounded_channel();
        let adapter = CodexCliRuntimeAdapter::new(incoming, fleet);
        let endpoint = rovai_core::builtin_tool_transport::LocalIpcEndpoint::UnixSocket {
            path: directory
                .join("builtin.sock")
                .to_string_lossy()
                .into_owned(),
        };
        let first_builtin_tools =
            BuiltinToolProcessConfig::create(&executable, &endpoint, &directory).unwrap();
        let first = adapter
            .ensure_agent_run_runtime(CodexAgentRunRuntimeRequest {
                agent_run_id: "run-1",
                execution_epoch: 1,
                camp_id: "camp-1",
                agent_id: "agent-1",
                cwd: &workspace,
                frozen_runtime: &runtime_config,
                runtime_compatibility_digest: "test-digest-agent-1",
                builtin_tools: &first_builtin_tools,
            })
            .await
            .unwrap();
        let second_builtin_tools =
            BuiltinToolProcessConfig::create(&executable, &endpoint, &directory).unwrap();
        let second = adapter
            .ensure_agent_run_runtime(CodexAgentRunRuntimeRequest {
                agent_run_id: "run-2",
                execution_epoch: 1,
                camp_id: "camp-1",
                agent_id: "agent-2",
                cwd: &workspace,
                frozen_runtime: &runtime_config,
                runtime_compatibility_digest: "test-digest-agent-2",
                builtin_tools: &second_builtin_tools,
            })
            .await
            .unwrap();
        assert_ne!(first.process_id().await, second.process_id().await);
        let (start_method, start_request) = thread_start_or_resume_request(
            &workspace,
            None,
            CodexThreadStartOptions {
                developer_instructions: None,
                sandbox: "read-only",
                approval_policy: "never",
                model: None,
                config: None,
                runtime_workspace_roots: None,
                ephemeral: false,
            },
        )
        .unwrap();
        let started = first.rpc(start_method, start_request).await.unwrap();
        let thread_id = started
            .pointer("/thread/id")
            .and_then(Value::as_str)
            .unwrap()
            .to_string();
        first
            .host
            .bind_thread(&thread_id, &first.owner)
            .await
            .unwrap();
        *first.thread_id.write().await = Some(thread_id.clone());
        assert!(
            started["instructionSources"]
                .as_array()
                .unwrap()
                .iter()
                .any(|source| source
                    .as_str()
                    .is_some_and(|source| source.ends_with("/AGENTS.md")))
        );
        let native_turn_id = first
            .start_turn_with_config("Reply exactly: session-persisted", None, None)
            .await
            .unwrap();
        timeout(Duration::from_secs(180), async {
            loop {
                match receiver.recv().await.unwrap() {
                    CodexIncoming::Message {
                        agent_run_id,
                        execution_epoch,
                        message,
                        ..
                    } if agent_run_id == "run-1" && execution_epoch == 1 => {
                        let method = message.get("method").and_then(Value::as_str).unwrap_or("");
                        let params = message.get("params").cloned().unwrap_or(Value::Null);
                        if let Some(id) = message.get("id").cloned() {
                            first
                                .respond_error(id, "Tools are disabled in the Runtime smoke")
                                .await
                                .unwrap();
                        }
                        first.observe_agent_message(method, &params).await;
                        if method == "turn/completed" {
                            assert_eq!(
                                params.pointer("/turn/status").and_then(Value::as_str),
                                Some("completed")
                            );
                            first.clear_turn(Some(&native_turn_id)).await;
                            break;
                        }
                    }
                    CodexIncoming::Exited { agent_run_id, .. } if agent_run_id == "run-1" => {
                        panic!("Codex Host exited before persisting the smoke Session")
                    }
                    _ => {}
                }
            }
        })
        .await
        .unwrap();
        let first_host = first.host_instance_id().to_string();
        adapter.complete_agent_run("run-1", 1).await;
        let successor_builtin_tools =
            BuiltinToolProcessConfig::create(&executable, &endpoint, &directory).unwrap();
        let successor = adapter
            .ensure_agent_run_runtime(CodexAgentRunRuntimeRequest {
                agent_run_id: "run-3",
                execution_epoch: 1,
                camp_id: "camp-1",
                agent_id: "agent-1",
                cwd: &workspace,
                frozen_runtime: &runtime_config,
                runtime_compatibility_digest: "test-digest-agent-1",
                builtin_tools: &successor_builtin_tools,
            })
            .await
            .unwrap();
        assert_eq!(successor.host_instance_id(), first_host);
        let (resume_method, resume_request) = thread_start_or_resume_request(
            &workspace,
            Some(&thread_id),
            CodexThreadStartOptions {
                developer_instructions: None,
                sandbox: "read-only",
                approval_policy: "never",
                model: None,
                config: None,
                runtime_workspace_roots: None,
                ephemeral: false,
            },
        )
        .unwrap();
        let resumed = successor.rpc(resume_method, resume_request).await.unwrap();
        assert_eq!(
            resumed.pointer("/thread/id").and_then(Value::as_str),
            Some(thread_id.as_str())
        );
        assert!(
            resumed["instructionSources"]
                .as_array()
                .unwrap()
                .iter()
                .any(|source| source
                    .as_str()
                    .is_some_and(|source| source.ends_with("/AGENTS.md")))
        );
        adapter.shutdown_all().await;
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn unknown_approval_fails_closed() {
        let result = approval_result("unknown/request", &json!({}), "accept");
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn stdout_ingress_drops_command_output_flood_and_preserves_terminal_events() {
        let owner = CodexRuntimeOwner::AgentRun {
            agent_run_id: "run-current".to_string(),
            execution_epoch: 4,
        };
        let routes = CodexThreadRoutes::default();
        routes.bind_thread("thread-current", &owner).await.unwrap();
        routes
            .activate_turn("thread-current", &owner, "turn-current")
            .await
            .unwrap();
        let (incoming, mut receiver) = mpsc::unbounded_channel();
        let output_delta = json!({
            "method": "item/commandExecution/outputDelta",
            "params": {
                "threadId": "thread-current",
                "turnId": "turn-current",
                "itemId": "command-1",
                "delta": "line one\n",
            }
        });

        for _ in 0..100_000 {
            let (disposition, unrouted_request_id) = route_codex_stdout_ingress(
                "host-current",
                &routes,
                &incoming,
                output_delta.clone(),
            )
            .await;
            assert_eq!(disposition, CodexIngressDisposition::DropCurrentDelta);
            assert!(unrouted_request_id.is_none());
        }
        assert!(matches!(
            receiver.try_recv(),
            Err(mpsc::error::TryRecvError::Empty)
        ));

        let item_completed = json!({
            "method": "item/completed",
            "params": {
                "threadId": "thread-current",
                "turnId": "turn-current",
                "item": {
                    "id": "command-1",
                    "type": "commandExecution",
                    "command": "cargo test",
                    "status": "completed",
                    "exitCode": 0,
                    "aggregatedOutput": "terminal output",
                }
            }
        });
        let turn_completed = json!({
            "method": "turn/completed",
            "params": {
                "threadId": "thread-current",
                "turn": {"id": "turn-current", "status": "completed"}
            }
        });
        for message in [item_completed, turn_completed] {
            let (disposition, unrouted_request_id) =
                route_codex_stdout_ingress("host-current", &routes, &incoming, message).await;
            assert_eq!(disposition, CodexIngressDisposition::Forward);
            assert!(unrouted_request_id.is_none());
        }
        let CodexIncoming::Message {
            agent_run_id,
            execution_epoch,
            message,
            ..
        } = receiver.try_recv().unwrap()
        else {
            panic!("item/completed must remain a semantic Message");
        };
        assert_eq!(agent_run_id, "run-current");
        assert_eq!(execution_epoch, 4);
        assert_eq!(message["method"], "item/completed");
        assert_eq!(
            message["params"]["item"]["aggregatedOutput"],
            "terminal output"
        );
        let CodexIncoming::Message { message, .. } = receiver.try_recv().unwrap() else {
            panic!("turn/completed must remain a terminal Message");
        };
        assert_eq!(message["method"], "turn/completed");
        assert!(matches!(
            receiver.try_recv(),
            Err(mpsc::error::TryRecvError::Empty)
        ));

        let old_turn_delta = json!({
            "method": "item/commandExecution/outputDelta",
            "params": {
                "threadId": "thread-current",
                "turnId": "turn-old",
                "itemId": "command-1",
                "delta": "late",
            }
        });
        let rejected_deltas = [
            old_turn_delta,
            json!({
                "method": "item/commandExecution/outputDelta",
                "params": {"turnId": "turn-current", "itemId": "command-1", "delta": "late"}
            }),
            json!({
                "method": "item/commandExecution/outputDelta",
                "params": {"threadId": "thread-current", "itemId": "command-1", "delta": "late"}
            }),
            json!({
                "method": "item/commandExecution/outputDelta",
                "params": {"threadId": "thread-current", "turnId": "turn-current", "delta": "late"}
            }),
            json!({
                "method": "item/commandExecution/outputDelta",
                "params": {"threadId": "thread-current", "turnId": "turn-current", "itemId": "  ", "delta": "late"}
            }),
            json!({
                "method": "command/exec/outputDelta",
                "params": {"itemId": "command-1", "delta": "legacy"}
            }),
        ];
        for message in rejected_deltas {
            let (disposition, unrouted_request_id) =
                route_codex_stdout_ingress("host-current", &routes, &incoming, message).await;
            assert_eq!(disposition, CodexIngressDisposition::DropRejectedDelta);
            assert!(unrouted_request_id.is_none());
        }
        assert!(matches!(
            receiver.try_recv(),
            Err(mpsc::error::TryRecvError::Empty)
        ));

        let mut server_request = output_delta.clone();
        server_request["id"] = json!(91);
        let (disposition, unrouted_request_id) =
            route_codex_stdout_ingress("host-current", &routes, &incoming, server_request).await;
        assert_eq!(disposition, CodexIngressDisposition::Forward);
        assert!(unrouted_request_id.is_none());
        let CodexIncoming::Message { message, .. } = receiver.try_recv().unwrap() else {
            panic!("an id-bearing outputDelta method must reach request routing");
        };
        assert_eq!(message["id"], 91);

        routes
            .deactivate_turn("thread-current", &owner, Some("turn-current"))
            .await;
        let (disposition, _) =
            route_codex_stdout_ingress("host-current", &routes, &incoming, output_delta.clone())
                .await;
        assert_eq!(disposition, CodexIngressDisposition::DropRejectedDelta);
        routes
            .activate_turn("thread-current", &owner, "turn-current")
            .await
            .unwrap();
        routes.unbind_thread("thread-current", &owner).await;
        let (disposition, _) =
            route_codex_stdout_ingress("host-current", &routes, &incoming, output_delta).await;
        assert_eq!(disposition, CodexIngressDisposition::DropRejectedDelta);
        assert!(matches!(
            receiver.try_recv(),
            Err(mpsc::error::TryRecvError::Empty)
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
                execution_root: Path::new("/tmp/rovai-workspace"),
            },
            "item/commandExecution/requestApproval",
            json!(91),
            &json!({
                "threadId": "thread-1",
                "turnId": "turn-1",
                "itemId": "item-1",
                "command": "cargo test",
                "cwd": "/tmp/rovai-workspace",
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
                    && cwd == "/tmp/rovai-workspace"
        ));

        let fenced = intercepted_action_request(
            &InterceptedActionContext {
                agent_run_id: "run-1",
                execution_epoch: 7,
                expected_thread_id: "thread-1",
                expected_turn_id: "turn-1",
                execution_root: Path::new("/tmp/rovai-workspace"),
            },
            "item/commandExecution/requestApproval",
            json!(92),
            &json!({
                "threadId": "old-thread",
                "turnId": "turn-1",
                "itemId": "item-2",
                "command": "cargo test",
                "cwd": "/tmp/rovai-workspace",
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
                execution_root: Path::new("/tmp/rovai-workspace"),
            },
            "item/commandExecution/requestApproval",
            json!(93),
            &json!({
                "threadId": "thread-1",
                "turnId": "turn-1",
                "itemId": "item-3",
                "cwd": "/tmp/rovai-workspace",
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
                execution_root: Path::new("/tmp/rovai-workspace"),
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
        let terminal_params = json!({
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
        });
        let completed = completed_intercepted_action(&terminal_params, "thread-1", "turn-1")
            .expect("valid completion should normalize")
            .expect("command is an intercepted Action type");
        assert_eq!(completed.native_item_id, "item-1");
        assert!(matches!(completed.outcome, ActionResultOutcome::Succeeded));
        assert_eq!(completed.effect_disposition, "complete");
        assert_eq!(completed.result_data["exitCode"], 0);
        assert!(completed.result_data["outputDigest"].is_string());
        assert!(!completed.result_data.to_string().contains("secret output"));

        let (delta_event_type, _) = normalize_event(
            "item/commandExecution/outputDelta",
            &json!({
                "threadId": "thread-1",
                "turnId": "turn-1",
                "itemId": "item-1",
                "delta": "secret",
            }),
        );
        assert_eq!(delta_event_type, "command.output.delta");
        let (terminal_event_type, terminal_payload) =
            normalize_event("item/completed", &terminal_params);
        assert_eq!(terminal_event_type, "activity.completed");
        assert_eq!(terminal_payload["item"]["status"], "completed");
        assert_eq!(terminal_payload["item"]["exitCode"], 0);
        assert_eq!(
            terminal_payload["item"]["aggregatedOutput"],
            "secret output"
        );
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
        assert_eq!(completed.error, None);
    }

    #[test]
    fn completed_turn_preserves_runtime_error_details() {
        let completed = completed_turn(&json!({
            "threadId": "thread-1",
            "turn": {
                "id": "turn-1",
                "status": "failed",
                "items": [],
                "error": {
                    "message": "model unavailable",
                    "codexErrorInfo": "serverOverloaded"
                }
            }
        }))
        .unwrap();
        assert_eq!(
            completed.error,
            Some(json!({
                "message": "model unavailable",
                "codexErrorInfo": "serverOverloaded"
            }))
        );
    }

    #[test]
    fn turn_requests_enable_provider_reasoning_summaries() {
        let request = turn_start_request(
            "thread-1",
            "inspect the project",
            Some("gpt-5.6"),
            Some("high"),
        );
        assert_eq!(request["threadId"], "thread-1");
        assert_eq!(request["summary"], "auto");
        assert_eq!(request["model"], "gpt-5.6");
        assert_eq!(request["effort"], "high");
    }

    #[test]
    fn reasoning_summary_and_plan_notifications_are_normalized_for_the_ui() {
        let reasoning = json!({
            "threadId": "thread-1",
            "turnId": "turn-1",
            "itemId": "reasoning-1",
            "delta": "检查现有实现",
            "summaryIndex": 0
        });
        let plan = json!({
            "threadId": "thread-1",
            "turnId": "turn-1",
            "explanation": "先定位，再验证",
            "plan": [{"step": "检查代码", "status": "inProgress"}]
        });
        assert_eq!(
            normalize_event("item/reasoning/summaryTextDelta", &reasoning),
            ("agent.reasoning.summary.delta", reasoning)
        );
        assert_eq!(
            normalize_event("turn/plan/updated", &plan),
            ("runtime.plan", plan)
        );
    }
}
