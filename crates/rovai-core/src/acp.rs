#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::{Component, Path, PathBuf},
    process::Stdio,
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
    agent_runtime_adapter::write_kiro_additive_agent_config,
    builtin_tool_transport::{BUILTIN_TOOL_CONTRACT_VERSION, builtin_tool_catalog_digest},
    command::canonical_json_digest,
    mcp::McpServerDefinition,
    runtime::{AgentRunWorkspace, PermissionSemantics},
    runtime_discovery::configure_active_runtime_command,
};
use serde_json::{Value, json};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{Mutex, RwLock, mpsc, oneshot},
    time::timeout,
};

use crate::{
    builtin_tool_runtime::BuiltinToolProcessConfig,
    health,
    runtime_fleet::{
        AgentRuntimeFleetManager, FleetAcquireRequest, FleetReleaseDisposition,
        RuntimeCompatibilityKey, RuntimeProcessHost,
    },
    runtime_mcp::{
        EphemeralMcpConfigFile, external_acp_server, remove_stale_mcp_configs,
        write_ephemeral_additive_mcp_config, write_ephemeral_copilot_config,
    },
};

#[derive(Debug)]
pub enum AcpIncoming {
    Message {
        adapter_kind: AdapterKind,
        host_instance_id: String,
        agent_run_id: String,
        execution_epoch: i64,
        message: Value,
    },
    HostDiagnostic {
        adapter_kind: AdapterKind,
        host_instance_id: String,
        text: String,
    },
    Exited {
        adapter_kind: AdapterKind,
        host_instance_id: String,
        agent_run_id: String,
        execution_epoch: i64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct AcpRuntimeOwner {
    agent_run_id: String,
    execution_epoch: i64,
}

impl AcpRuntimeOwner {
    fn message(
        &self,
        adapter_kind: AdapterKind,
        host_instance_id: &str,
        message: Value,
    ) -> AcpIncoming {
        AcpIncoming::Message {
            adapter_kind,
            host_instance_id: host_instance_id.to_string(),
            agent_run_id: self.agent_run_id.clone(),
            execution_epoch: self.execution_epoch,
            message,
        }
    }

    fn exited(&self, adapter_kind: AdapterKind, host_instance_id: &str) -> AcpIncoming {
        AcpIncoming::Exited {
            adapter_kind,
            host_instance_id: host_instance_id.to_string(),
            agent_run_id: self.agent_run_id.clone(),
            execution_epoch: self.execution_epoch,
        }
    }
}

#[derive(Debug, Clone)]
struct AcpSessionRoute {
    owner: AcpRuntimeOwner,
    active_prompt_id: Option<String>,
}

#[derive(Debug, Default)]
struct ObservedToolMetadata {
    native_kind: Option<String>,
    observation_digest: Option<String>,
    // Some ACP servers omit rawInput from the later permission request. Keep
    // the matching structured update in active-process memory only; durable
    // events and Action records continue to store digests, never this payload.
    raw_input: Option<Value>,
    locations: Option<Value>,
}

#[derive(Debug, Clone)]
pub struct ObservedAcpToolContext {
    native_kind: Option<String>,
    raw_input: Option<Value>,
    locations: Option<Value>,
}

enum PendingRpc {
    Response(oneshot::Sender<std::result::Result<Value, String>>),
    Prompt {
        owner: AcpRuntimeOwner,
        session_id: String,
        prompt_id: String,
    },
}

pub(crate) struct AcpHost {
    adapter_kind: AdapterKind,
    host_instance_id: String,
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pending: Mutex<HashMap<u64, PendingRpc>>,
    next_id: AtomicU64,
    routes: RwLock<HashMap<String, AcpSessionRoute>>,
    known_sessions: RwLock<HashSet<String>>,
    incoming: mpsc::UnboundedSender<AcpIncoming>,
    alive: AtomicBool,
    startup_diagnostics: Mutex<String>,
    private_config_root: Option<PathBuf>,
    ephemeral_config: Mutex<Option<EphemeralMcpConfigFile>>,
    executable_path: PathBuf,
    builtin_tools: Option<BuiltinToolProcessConfig>,
}

impl AcpHost {
    #[allow(clippy::too_many_arguments)]
    async fn spawn(
        cwd: &Path,
        workspace: &AgentRunWorkspace,
        permission_semantics: PermissionSemantics,
        frozen_runtime: &FrozenAgentRuntimeConfig,
        incoming: mpsc::UnboundedSender<AcpIncoming>,
        builtin_tools: Option<BuiltinToolProcessConfig>,
        allow_client_fs: bool,
        external_mcp_servers: &BTreeMap<String, McpServerDefinition>,
        private_runtime_dir: &Path,
        attachment_access_root: Option<&Path>,
    ) -> Result<Arc<Self>> {
        let private_config_root =
            prepare_private_host_config(private_runtime_dir, frozen_runtime.adapter_kind)?;
        let mut command = Command::new(&frozen_runtime.executable_path);
        configure_active_runtime_command(&mut command);
        if let Some(config) = &builtin_tools {
            config.configure_command(&mut command)?;
        }
        #[cfg(unix)]
        command.as_std_mut().process_group(0);
        let ephemeral_config = configure_runtime_command(
            &mut command,
            workspace,
            permission_semantics,
            frozen_runtime,
            !allow_client_fs,
            external_mcp_servers,
            private_runtime_dir,
            private_config_root.as_deref(),
            attachment_access_root,
        )
        .context("failed to configure ACP Runtime command")?;
        let process_working_directory = if frozen_runtime.adapter_kind == AdapterKind::KiroCli {
            private_config_root
                .as_deref()
                .context("Kiro Host isolation directory is missing")?
        } else {
            cwd
        };
        let mut child = command
            .current_dir(process_working_directory)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .with_context(|| {
                format!(
                    "failed to start {} as an ACP server",
                    frozen_runtime.executable_path
                )
            })?;
        let stdin = child.stdin.take().context("ACP stdin was unavailable")?;
        let stdout = child.stdout.take().context("ACP stdout was unavailable")?;
        let stderr = child.stderr.take().context("ACP stderr was unavailable")?;
        let host = Arc::new(Self {
            adapter_kind: frozen_runtime.adapter_kind,
            host_instance_id: uuid::Uuid::new_v4().to_string(),
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            routes: RwLock::new(HashMap::new()),
            known_sessions: RwLock::new(HashSet::new()),
            incoming,
            alive: AtomicBool::new(true),
            startup_diagnostics: Mutex::new(String::new()),
            private_config_root,
            ephemeral_config: Mutex::new(ephemeral_config),
            executable_path: PathBuf::from(&frozen_runtime.executable_path),
            builtin_tools,
        });
        Self::spawn_stdout_reader(host.clone(), stdout);
        Self::spawn_stderr_reader(host.clone(), stderr);
        let initialized = host
            .rpc(
                "initialize",
                json!({
                    "protocolVersion": 1,
                    "clientCapabilities": {
                        "fs": {
                            "readTextFile": allow_client_fs,
                            "writeTextFile": allow_client_fs
                        },
                        "terminal": false
                    },
                    "clientInfo": {
                        "name": "rovai",
                        "title": "Rovai-ai",
                        "version": env!("CARGO_PKG_VERSION")
                    }
                }),
            )
            .await;
        match initialized {
            Ok(result) if result.get("protocolVersion").and_then(Value::as_u64) == Some(1) => {
                if frozen_runtime.adapter_kind == AdapterKind::CopilotCli {
                    // Copilot eagerly loads --additional-mcp-config before it
                    // replies to initialize. Preserve the original minimal
                    // credential-file lifetime; native-config adapters retain
                    // their file because they may read it at Session creation.
                    host.ephemeral_config.lock().await.take();
                }
                Ok(host)
            }
            Ok(_) => {
                host.shutdown().await;
                bail!("Runtime did not negotiate ACP v1")
            }
            Err(error) => {
                tokio::time::sleep(Duration::from_millis(20)).await;
                let explicit_mcp_rejection = {
                    let diagnostic = host.startup_diagnostics.lock().await;
                    diagnostic_is_explicit_mcp_rejection(&diagnostic)
                };
                host.shutdown().await;
                if explicit_mcp_rejection {
                    bail!(
                        "mcp_config.explicit_rejection: ACP Runtime rejected its MCP configuration"
                    )
                }
                let diagnostic = host.startup_diagnostics.lock().await.clone();
                if diagnostic.is_empty() {
                    Err(error.context("ACP initialize failed"))
                } else {
                    Err(error.context(format!("ACP initialize failed ({diagnostic})")))
                }
            }
        }
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
                                host.send_host_diagnostic(format!(
                                    "ACP Host emitted invalid protocol JSON: {error}"
                                ));
                                continue;
                            }
                        };
                        if message.get("method").is_none()
                            && let Some(id) = message.get("id").and_then(Value::as_u64)
                        {
                            if let Some(pending) = host.pending.lock().await.remove(&id) {
                                host.complete_pending(id, pending, message).await;
                            }
                            continue;
                        }
                        let session_id =
                            message.pointer("/params/sessionId").and_then(Value::as_str);
                        let route = if let Some(session_id) = session_id {
                            host.routes.read().await.get(session_id).cloned()
                        } else {
                            None
                        };
                        if let Some(route) = route {
                            let _ = host.incoming.send(route.owner.message(
                                host.adapter_kind,
                                &host.host_instance_id,
                                message,
                            ));
                        } else if message.get("id").is_some() {
                            let id = message.get("id").cloned().unwrap_or(Value::Null);
                            let _ = host
                                .send(json!({
                                    "jsonrpc": "2.0",
                                    "id": id,
                                    "error": {
                                        "code": -32602,
                                        "message": "Rovai-ai has no active logical Conversation binding for this ACP Session"
                                    }
                                }))
                                .await;
                        }
                    }
                    Ok(Some(_)) => {}
                    Ok(None) => break,
                    Err(error) => {
                        host.send_host_diagnostic(format!("ACP stdout failed: {error}"));
                        break;
                    }
                }
            }
            host.alive.store(false, Ordering::Release);
            for (_, pending) in host.pending.lock().await.drain() {
                if let PendingRpc::Response(sender) = pending {
                    let _ = sender.send(Err("ACP Host exited".to_string()));
                }
            }
            for owner in host.owners().await {
                let _ = host
                    .incoming
                    .send(owner.exited(host.adapter_kind, &host.host_instance_id));
            }
        });
    }

    async fn complete_pending(&self, id: u64, pending: PendingRpc, message: Value) {
        let response = if let Some(error) = message.get("error") {
            Err(error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("ACP request failed")
                .to_string())
        } else {
            Ok(message.get("result").cloned().unwrap_or(Value::Null))
        };
        match pending {
            PendingRpc::Response(sender) => {
                let _ = sender.send(response);
            }
            PendingRpc::Prompt {
                owner,
                session_id,
                prompt_id,
            } => {
                let still_active = {
                    let mut routes = self.routes.write().await;
                    let Some(route) = routes.get_mut(&session_id) else {
                        return;
                    };
                    if route.owner != owner || route.active_prompt_id.as_deref() != Some(&prompt_id)
                    {
                        false
                    } else {
                        route.active_prompt_id = None;
                        true
                    }
                };
                if still_active {
                    let params = match response {
                        Ok(result) => json!({
                            "sessionId": session_id,
                            "promptId": prompt_id,
                            "requestId": id,
                            "result": result
                        }),
                        Err(error) => json!({
                            "sessionId": session_id,
                            "promptId": prompt_id,
                            "requestId": id,
                            "error": error
                        }),
                    };
                    let _ = self.incoming.send(owner.message(
                        self.adapter_kind,
                        &self.host_instance_id,
                        json!({
                            "jsonrpc": "2.0",
                            "method": "rovai/acp_prompt_completed",
                            "params": params
                        }),
                    ));
                }
            }
        }
    }

    fn spawn_stderr_reader(host: Arc<Self>, stderr: tokio::process::ChildStderr) {
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if !line.trim().is_empty() {
                    {
                        let mut diagnostic = host.startup_diagnostics.lock().await;
                        if diagnostic.len() < 8 * 1024 {
                            let remaining = 8 * 1024 - diagnostic.len();
                            diagnostic.push_str(&line.chars().take(remaining).collect::<String>());
                            diagnostic.push('\n');
                        }
                    }
                    host.send_host_diagnostic(line);
                }
            }
        });
    }

    async fn bind_session(&self, session_id: &str, owner: &AcpRuntimeOwner) -> Result<()> {
        let mut routes = self.routes.write().await;
        if let Some(existing) = routes.get(session_id)
            && &existing.owner != owner
        {
            bail!("ACP Native Session is already bound to another logical runtime");
        }
        routes.insert(
            session_id.to_string(),
            AcpSessionRoute {
                owner: owner.clone(),
                active_prompt_id: None,
            },
        );
        Ok(())
    }

    async fn knows_session(&self, session_id: &str) -> bool {
        self.known_sessions.read().await.contains(session_id)
    }

    async fn remember_session(&self, session_id: &str) {
        self.known_sessions
            .write()
            .await
            .insert(session_id.to_string());
    }

    async fn unbind_session(&self, session_id: &str, owner: &AcpRuntimeOwner) {
        let mut routes = self.routes.write().await;
        if routes.get(session_id).map(|route| &route.owner) == Some(owner) {
            routes.remove(session_id);
        }
    }

    async fn active_prompt(&self, session_id: &str, owner: &AcpRuntimeOwner) -> Option<String> {
        self.routes
            .read()
            .await
            .get(session_id)
            .filter(|route| &route.owner == owner)
            .and_then(|route| route.active_prompt_id.clone())
    }

    async fn owners(&self) -> HashSet<AcpRuntimeOwner> {
        self.routes
            .read()
            .await
            .values()
            .map(|route| route.owner.clone())
            .collect()
    }

    fn send_host_diagnostic(&self, text: String) {
        let _ = self.incoming.send(AcpIncoming::HostDiagnostic {
            adapter_kind: self.adapter_kind,
            host_instance_id: self.host_instance_id.clone(),
            text,
        });
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
        self.is_alive()
            && self.pending.lock().await.is_empty()
            && self.routes.read().await.is_empty()
    }

    pub(crate) async fn shutdown_and_reap(&self) {
        self.alive.store(false, Ordering::Release);
        let mut child = self.child.lock().await;
        let pid = child.id();
        #[cfg(unix)]
        if let Some(pid) = pid {
            unsafe {
                libc::killpg(pid as i32, libc::SIGTERM);
            }
        }
        #[cfg(not(unix))]
        let _ = child.start_kill();
        if timeout(Duration::from_secs(3), child.wait()).await.is_err() {
            #[cfg(unix)]
            if let Some(pid) = pid {
                unsafe {
                    libc::killpg(pid as i32, libc::SIGKILL);
                }
            }
            let _ = child.kill().await;
            let _ = timeout(Duration::from_secs(1), child.wait()).await;
        }
        if let Some(root) = self.private_config_root.as_ref() {
            let _ = std::fs::remove_dir_all(root);
        }
    }

    async fn rpc(&self, method: &str, params: Value) -> Result<Value> {
        if !self.is_alive() {
            bail!("ACP Host is not alive");
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        self.pending
            .lock()
            .await
            .insert(id, PendingRpc::Response(sender));
        if let Err(error) = self
            .send(json!({"jsonrpc": "2.0", "method": method, "id": id, "params": params}))
            .await
        {
            self.pending.lock().await.remove(&id);
            return Err(error);
        }
        let response = match timeout(Duration::from_secs(45), receiver).await {
            Ok(response) => {
                response.with_context(|| format!("ACP response channel closed: {method}"))?
            }
            Err(_) => {
                self.pending.lock().await.remove(&id);
                bail!("ACP request timed out: {method}");
            }
        };
        response.map_err(|message| anyhow::anyhow!("{method}: {message}"))
    }

    async fn start_prompt(
        &self,
        session_id: &str,
        owner: &AcpRuntimeOwner,
        text: &str,
    ) -> Result<String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        // ACP request IDs restart from 1 for every Host process. Team Tool
        // isolation intentionally creates a fresh Host for each AgentRun, while
        // a logical Native Binding can span many Runs. Include the Host identity
        // so RuntimeInputDelivery keeps a unique Native Input identity across
        // those resumptions.
        let prompt_id = acp_prompt_id(&self.host_instance_id, id);
        {
            let mut routes = self.routes.write().await;
            let route = routes
                .get_mut(session_id)
                .context("ACP Session has no logical runtime binding")?;
            if &route.owner != owner {
                bail!("ACP Session failed Host/Run fencing");
            }
            if route.active_prompt_id.is_some() {
                bail!("ACP Session already has an active prompt");
            }
            route.active_prompt_id = Some(prompt_id.clone());
        }
        self.pending.lock().await.insert(
            id,
            PendingRpc::Prompt {
                owner: owner.clone(),
                session_id: session_id.to_string(),
                prompt_id: prompt_id.clone(),
            },
        );
        if let Err(error) = self
            .send(json!({
                "jsonrpc": "2.0",
                "method": "session/prompt",
                "id": id,
                "params": {
                    "sessionId": session_id,
                    "prompt": [{"type": "text", "text": text}]
                }
            }))
            .await
        {
            self.pending.lock().await.remove(&id);
            if let Some(route) = self.routes.write().await.get_mut(session_id) {
                route.active_prompt_id = None;
            }
            return Err(error);
        }
        Ok(prompt_id)
    }

    #[allow(dead_code)] // Used when the v0.02 CancelAgentRun command is exposed by the Core API.
    async fn notify(&self, method: &str, params: Value) -> Result<()> {
        self.send(json!({"jsonrpc": "2.0", "method": method, "params": params}))
            .await
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

fn diagnostic_is_explicit_mcp_rejection(diagnostic: &str) -> bool {
    let diagnostic = diagnostic.to_ascii_lowercase();
    [
        "--additional-mcp-config",
        "--mcp-config",
        "mcp config",
        "mcp configuration",
    ]
    .iter()
    .any(|marker| diagnostic.contains(marker))
        && [
            "unknown option",
            "unrecognized option",
            "unsupported option",
            "invalid",
            "rejected",
        ]
        .iter()
        .any(|marker| diagnostic.contains(marker))
}

fn acp_prompt_id(host_instance_id: &str, request_id: u64) -> String {
    format!("acp-prompt-{host_instance_id}-{request_id}")
}

pub struct AcpRuntime {
    owner: AcpRuntimeOwner,
    host: Arc<AcpHost>,
    owns_host: bool,
    mcp_projection_digest: String,
    session_id: RwLock<Option<String>>,
    execution_root: PathBuf,
    attachment_access_root: Option<PathBuf>,
    workspace_access: String,
    streamed_agent_text: Mutex<String>,
    observed_tools: Mutex<HashMap<String, ObservedToolMetadata>>,
    authorized_file_writes: Mutex<HashSet<PathBuf>>,
}

impl AcpRuntime {
    #[allow(clippy::too_many_arguments)]
    fn from_host(
        owner: AcpRuntimeOwner,
        host: Arc<AcpHost>,
        owns_host: bool,
        mcp_projection_digest: String,
        execution_root: PathBuf,
        attachment_access_root: Option<PathBuf>,
        workspace_access: String,
    ) -> Arc<Self> {
        Arc::new(Self {
            owner,
            host,
            owns_host,
            mcp_projection_digest,
            session_id: RwLock::new(None),
            execution_root,
            attachment_access_root,
            workspace_access,
            streamed_agent_text: Mutex::new(String::new()),
            observed_tools: Mutex::new(HashMap::new()),
            authorized_file_writes: Mutex::new(HashSet::new()),
        })
    }

    pub async fn start_or_resume_session(
        &self,
        existing_session_id: Option<&str>,
        supports_load: bool,
        model: &str,
        model_options: &Value,
        external_mcp_servers: &BTreeMap<String, McpServerDefinition>,
    ) -> Result<String> {
        let cwd = self.execution_root.to_string_lossy().to_string();
        let additional_directories = session_additional_directories(
            self.host.adapter_kind,
            self.attachment_access_root.as_deref(),
        );
        let mcp_servers = if !matches!(
            self.host.adapter_kind,
            AdapterKind::CopilotCli
                | AdapterKind::KiroCli
                | AdapterKind::QoderCli
                | AdapterKind::CodebuddyCli
                | AdapterKind::QwenCode
        ) {
            external_mcp_servers
                .iter()
                .map(|(name, definition)| external_acp_server(name, definition))
                .collect()
        } else {
            // These adapters receive Rovai servers through their native
            // additive configuration channel rather than ACP session fields.
            Vec::new()
        };
        let session_id = if let Some(session_id) = existing_session_id
            && self.host.knows_session(session_id).await
        {
            // The Session still belongs to this live Host. Rebinding it does
            // not require the optional cross-process session/load capability.
            session_id.to_string()
        } else {
            let result = if let Some(session_id) = existing_session_id.filter(|_| supports_load) {
                self.host
                    .rpc(
                        "session/load",
                        json!({
                            "sessionId": session_id,
                            "cwd": cwd,
                            "mcpServers": mcp_servers,
                            "additionalDirectories": additional_directories,
                        }),
                    )
                    .await?
            } else {
                self.host
                    .rpc(
                        "session/new",
                        json!({
                            "cwd": cwd,
                            "mcpServers": mcp_servers,
                            "additionalDirectories": additional_directories,
                        }),
                    )
                    .await?
            };
            result
                .get("sessionId")
                .and_then(Value::as_str)
                .or(existing_session_id.filter(|_| supports_load))
                .context("ACP Session response did not include sessionId")?
                .to_string()
        };
        self.host.remember_session(&session_id).await;
        if self.host.adapter_kind == AdapterKind::KiroCli {
            self.set_model(&session_id, model).await?;
        } else {
            self.set_config_option(&session_id, "model", model).await?;
        }
        if self.host.adapter_kind == AdapterKind::KiroCli
            && model_options
                .as_object()
                .is_some_and(|options| !options.is_empty())
        {
            bail!("Kiro ACP does not support generic per-Session model options");
        }
        if self.host.adapter_kind != AdapterKind::KiroCli
            && let Some(options) = model_options.as_object()
        {
            for (key, value) in options {
                if let Some(value) = value.as_str() {
                    self.set_config_option(&session_id, key, value).await?;
                }
            }
        }
        self.host.bind_session(&session_id, &self.owner).await?;
        let previous_session_id = self.session_id.write().await.replace(session_id.clone());
        if let Some(previous_session_id) = previous_session_id
            && previous_session_id != session_id
        {
            self.host
                .unbind_session(&previous_session_id, &self.owner)
                .await;
        }
        Ok(session_id)
    }

    async fn set_config_option(
        &self,
        session_id: &str,
        config_id: &str,
        value: &str,
    ) -> Result<()> {
        self.host
            .rpc(
                "session/set_config_option",
                json!({
                    "sessionId": session_id,
                    "configId": config_id,
                    "type": "select",
                    "value": value
                }),
            )
            .await?;
        Ok(())
    }

    async fn set_model(&self, session_id: &str, model_id: &str) -> Result<()> {
        self.host
            .rpc(
                "session/set_model",
                json!({
                    "sessionId": session_id,
                    "modelId": model_id
                }),
            )
            .await?;
        Ok(())
    }

    pub async fn start_prompt(&self, text: &str) -> Result<String> {
        self.streamed_agent_text.lock().await.clear();
        let session_id = self
            .session_id()
            .await
            .context("ACP Session is not ready")?;
        self.host.start_prompt(&session_id, &self.owner, text).await
    }

    pub async fn cancel(&self) -> Result<()> {
        let session_id = self
            .session_id()
            .await
            .context("ACP Session is not ready")?;
        self.host
            .notify("session/cancel", json!({"sessionId": session_id}))
            .await
    }

    pub async fn respond(&self, id: Value, result: Value) -> Result<()> {
        self.host
            .send(json!({"jsonrpc": "2.0", "id": id, "result": result}))
            .await
    }

    pub async fn respond_error(&self, id: Value, code: i64, message: &str) -> Result<()> {
        self.host
            .send(json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {"code": code, "message": message}
            }))
            .await
    }

    pub async fn observe_message(
        &self,
        method: &str,
        params: &Value,
    ) -> Result<Option<CompletedAcpAction>> {
        if method != "session/update" {
            return Ok(None);
        }
        let Some(update) = params.get("update") else {
            return Ok(None);
        };
        if update.get("sessionUpdate").and_then(Value::as_str) == Some("agent_message_chunk")
            && let Some(text) = update.pointer("/content/text").and_then(Value::as_str)
        {
            self.streamed_agent_text.lock().await.push_str(text);
        }
        if !matches!(
            update.get("sessionUpdate").and_then(Value::as_str),
            Some("tool_call" | "tool_call_update")
        ) {
            return Ok(None);
        }
        let Some(native_item_id) = update.get("toolCallId").and_then(Value::as_str) else {
            return Ok(None);
        };
        let terminal = matches!(
            update.get("status").and_then(Value::as_str),
            Some("completed" | "failed")
        );
        let mut observations = self.observed_tools.lock().await;
        let observed = observations.entry(native_item_id.to_string()).or_default();
        if let Some(reported_kind) = update.get("kind").and_then(Value::as_str) {
            let raw_input = update.get("rawInput").cloned().unwrap_or_else(|| json!({}));
            observed.native_kind =
                Some(effective_action_kind(reported_kind, &raw_input).to_string());
        }
        if let Some(raw_input) = update.get("rawInput").filter(|value| !value.is_null()) {
            observed.raw_input = Some(raw_input.clone());
        }
        if let Some(locations) = update.get("locations").filter(|value| !value.is_null()) {
            observed.locations = Some(locations.clone());
        }
        if update.get("rawInput").is_some() || update.get("locations").is_some() {
            observed.observation_digest = Some(canonical_json_digest(&json!({
                "nativeItemId": native_item_id,
                "nativeKind": observed.native_kind.as_deref(),
                "rawInput": update.get("rawInput"),
                "locations": update.get("locations"),
            }))?);
        }
        if !terminal {
            return Ok(None);
        }
        let observed = observations.remove(native_item_id).unwrap_or_default();
        drop(observations);
        let Some(mut completion) = completed_action(params)? else {
            return Ok(None);
        };
        if let Some(native_kind) = observed.native_kind {
            completion.native_kind = native_kind;
        }
        if let Some(observation_digest) = observed.observation_digest {
            completion.observation_digest = observation_digest;
        }
        completion.effect_disposition = acp_effect_disposition(
            matches!(completion.outcome, ActionResultOutcome::Succeeded),
            &completion.native_kind,
        )
        .to_string();
        if let Some(result_data) = completion.result_data.as_object_mut() {
            result_data.insert(
                "kind".to_string(),
                Value::String(completion.native_kind.clone()),
            );
        }
        Ok(Some(completion))
    }

    pub async fn final_agent_message(&self) -> Option<String> {
        let text = self.streamed_agent_text.lock().await.trim().to_string();
        (!text.is_empty()).then_some(text)
    }

    pub async fn session_id(&self) -> Option<String> {
        self.session_id.read().await.clone()
    }

    pub async fn prompt_id(&self) -> Option<String> {
        let session_id = self.session_id().await?;
        self.host.active_prompt(&session_id, &self.owner).await
    }

    pub async fn observed_tool_context(
        &self,
        native_item_id: &str,
    ) -> Option<ObservedAcpToolContext> {
        self.observed_tools
            .lock()
            .await
            .get(native_item_id)
            .map(|observed| ObservedAcpToolContext {
                native_kind: observed.native_kind.clone(),
                raw_input: observed.raw_input.clone(),
                locations: observed.locations.clone(),
            })
    }

    pub fn host_instance_id(&self) -> &str {
        &self.host.host_instance_id
    }

    pub(crate) fn builtin_tool_process_config(&self) -> Option<&BuiltinToolProcessConfig> {
        self.host.builtin_tool_process_config()
    }

    pub fn adapter_kind(&self) -> AdapterKind {
        self.host.adapter_kind
    }

    pub fn execution_epoch(&self) -> i64 {
        self.owner.execution_epoch
    }

    pub async fn authorize_file_write(&self, request: &Value) -> Result<()> {
        if self.workspace_access == "read_only" {
            bail!("read-only AgentRun cannot authorize file writes");
        }
        for path in acp_tool_paths(request) {
            let scoped = scoped_path(&self.execution_root, &path)?;
            self.authorized_file_writes.lock().await.insert(scoped);
        }
        Ok(())
    }

    pub async fn read_text_file(&self, params: &Value) -> Result<Value> {
        let path = params
            .get("path")
            .and_then(Value::as_str)
            .context("fs/read_text_file has no path")?;
        let path = scoped_path(&self.execution_root, path)?;
        let content = std::fs::read_to_string(&path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        Ok(json!({"content": content}))
    }

    pub async fn write_text_file(&self, params: &Value) -> Result<Value> {
        if self.workspace_access == "read_only" {
            bail!("read-only AgentRun cannot write files");
        }
        let path = params
            .get("path")
            .and_then(Value::as_str)
            .context("fs/write_text_file has no path")?;
        let content = params
            .get("content")
            .and_then(Value::as_str)
            .context("fs/write_text_file has no content")?;
        let path = scoped_path(&self.execution_root, path)?;
        if !self.authorized_file_writes.lock().await.remove(&path) {
            bail!("file write has no matching one-time Rovai-ai authorization");
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path, content)
            .with_context(|| format!("failed to write {}", path.display()))?;
        Ok(json!({}))
    }

    pub async fn shutdown(&self) {
        if let Some(session_id) = self.session_id().await {
            self.host.unbind_session(&session_id, &self.owner).await;
        }
        if self.owns_host {
            self.host.shutdown().await;
        }
    }

    pub(crate) async fn detach(&self) {
        if let Some(session_id) = self.session_id().await {
            self.host.unbind_session(&session_id, &self.owner).await;
        }
    }
}

pub struct AcpCliRuntimeAdapter {
    kind: AdapterKind,
    runtimes: Mutex<HashMap<String, Arc<AcpRuntime>>>,
    incoming: mpsc::UnboundedSender<AcpIncoming>,
    private_runtime_dir: PathBuf,
    fleet: Arc<AgentRuntimeFleetManager>,
}

impl AcpCliRuntimeAdapter {
    pub fn new(
        kind: AdapterKind,
        incoming: mpsc::UnboundedSender<AcpIncoming>,
        private_runtime_dir: PathBuf,
        fleet: Arc<AgentRuntimeFleetManager>,
    ) -> Result<Self> {
        if !launchable_acp_adapter(kind) {
            bail!("{} is not a launchable ACP Adapter", kind.as_str());
        }
        if matches!(
            kind,
            AdapterKind::CopilotCli
                | AdapterKind::KiroCli
                | AdapterKind::QoderCli
                | AdapterKind::CodebuddyCli
                | AdapterKind::QwenCode
        ) {
            remove_stale_mcp_configs(&private_runtime_dir)?;
        }
        Ok(Self {
            kind,
            runtimes: Mutex::new(HashMap::new()),
            incoming,
            private_runtime_dir,
            fleet,
        })
    }

    pub async fn run_isolated_completion(
        frozen_runtime: &FrozenAgentRuntimeConfig,
        cwd: &Path,
        prompt: &str,
    ) -> Result<String> {
        if !launchable_acp_adapter(frozen_runtime.adapter_kind) {
            bail!("ACP isolated completion received a non-ACP Adapter kind");
        }
        let workspace = AgentRunWorkspace {
            execution_root: cwd.to_string_lossy().to_string(),
            access: "read_only".to_string(),
            isolation: "shared".to_string(),
        };
        let (incoming, mut receiver) = mpsc::unbounded_channel();
        let private_runtime_dir = cwd.join(".rovai-runtime");
        let external_mcp_servers = BTreeMap::new();
        let host = AcpHost::spawn(
            cwd,
            &workspace,
            PermissionSemantics::CoreEnforcedV1,
            frozen_runtime,
            incoming,
            None,
            false,
            &external_mcp_servers,
            &private_runtime_dir,
            None,
        )
        .await?;
        let owner = AcpRuntimeOwner {
            agent_run_id: format!("context-compaction:{}", uuid::Uuid::new_v4()),
            execution_epoch: 1,
        };
        let runtime = AcpRuntime::from_host(
            owner.clone(),
            host.clone(),
            false,
            "sha256:isolated-empty-mcp".to_string(),
            cwd.to_path_buf(),
            None,
            "read_only".to_string(),
        );
        let result = timeout(Duration::from_secs(300), async {
            runtime
                .start_or_resume_session(
                    None,
                    false,
                    frozen_runtime.model.model_id.as_str(),
                    &frozen_runtime.model.options,
                    &external_mcp_servers,
                )
                .await
                .context("failed to start isolated ACP Session")?;
            runtime
                .start_prompt(prompt)
                .await
                .context("failed to start isolated ACP prompt")?;
            loop {
                let incoming = receiver
                    .recv()
                    .await
                    .context("isolated ACP event channel closed")?;
                match incoming {
                    AcpIncoming::Message {
                        agent_run_id,
                        execution_epoch,
                        message,
                        ..
                    } if agent_run_id == owner.agent_run_id
                        && execution_epoch == owner.execution_epoch =>
                    {
                        let method = message
                            .get("method")
                            .and_then(Value::as_str)
                            .unwrap_or("unknown");
                        let params = message.get("params").cloned().unwrap_or(Value::Null);
                        if let Some(id) = message.get("id").cloned() {
                            if method == "session/request_permission" {
                                match rejection_result(&params) {
                                    Ok(response) => {
                                        let _ = runtime.respond(id, response).await;
                                    }
                                    Err(error) => {
                                        let _ = runtime
                                            .respond_error(id, -32000, &format!("{error:#}"))
                                            .await;
                                    }
                                }
                            } else {
                                let _ = runtime
                                    .respond_error(
                                        id,
                                        -32601,
                                        "Tools are disabled for context compaction",
                                    )
                                    .await;
                            }
                            bail!("isolated ACP compactor requested a tool through {method}");
                        }
                        runtime.observe_message(method, &params).await?;
                        if isolated_acp_tool_event(method, &params) {
                            let _ = runtime.cancel().await;
                            bail!("isolated ACP compactor attempted a tool through {method}");
                        }
                        if method == "rovai/acp_prompt_completed" {
                            if let Some(error) = params.get("error").and_then(Value::as_str) {
                                bail!("isolated ACP prompt failed: {error}");
                            }
                            return runtime
                                .final_agent_message()
                                .await
                                .context("isolated ACP prompt produced no final response");
                        }
                    }
                    AcpIncoming::Exited {
                        agent_run_id,
                        execution_epoch,
                        ..
                    } if agent_run_id == owner.agent_run_id
                        && execution_epoch == owner.execution_epoch =>
                    {
                        bail!("isolated ACP Host exited before completion");
                    }
                    _ => {}
                }
            }
        })
        .await;
        let result = match result {
            Ok(result) => result,
            Err(_) => Err(anyhow::anyhow!("isolated ACP completion timed out")),
        };
        runtime.shutdown().await;
        host.shutdown().await;
        result
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn ensure_agent_run_runtime(
        &self,
        agent_run_id: &str,
        execution_epoch: i64,
        camp_id: &str,
        agent_id: &str,
        workspace: &AgentRunWorkspace,
        permission_semantics: PermissionSemantics,
        frozen_runtime: &FrozenAgentRuntimeConfig,
        builtin_tools: &BuiltinToolProcessConfig,
        external_mcp_servers: &BTreeMap<String, McpServerDefinition>,
        mcp_projection_digest: &str,
        attachment_access_root: &Path,
        runtime_compatibility_digest: &str,
    ) -> Result<Arc<AcpRuntime>> {
        if frozen_runtime.adapter_kind != self.kind {
            bail!("ACP Runtime received an AgentRun for another Adapter");
        }
        let existing = { self.runtimes.lock().await.get(agent_run_id).cloned() };
        if let Some(existing) = existing {
            if existing.execution_epoch() == execution_epoch
                && existing.host.is_alive()
                && existing.mcp_projection_digest == mcp_projection_digest
                && existing.attachment_access_root.as_deref() == Some(attachment_access_root)
            {
                return Ok(existing);
            }
            let old_epoch = existing.execution_epoch();
            existing.detach().await;
            self.runtimes.lock().await.remove(agent_run_id);
            self.fleet
                .release(agent_run_id, old_epoch, FleetReleaseDisposition::Stop)
                .await;
        }
        let execution_root = PathBuf::from(&workspace.execution_root);
        let fleet_lease = self
            .fleet
            .acquire(
                FleetAcquireRequest {
                    agent_run_id: agent_run_id.to_string(),
                    execution_epoch,
                    adapter_kind: self.kind,
                    compatibility: RuntimeCompatibilityKey {
                        camp_id: camp_id.to_string(),
                        agent_id: agent_id.to_string(),
                        runtime_compatibility_digest: runtime_compatibility_digest.to_string(),
                    },
                },
                || async {
                    let host = AcpHost::spawn(
                        &execution_root,
                        workspace,
                        permission_semantics,
                        frozen_runtime,
                        self.incoming.clone(),
                        Some(builtin_tools.clone()),
                        true,
                        external_mcp_servers,
                        &self.private_runtime_dir,
                        Some(attachment_access_root),
                    )
                    .await?;
                    Ok(RuntimeProcessHost::Acp(host))
                },
            )
            .await?;
        let _process_id = &fleet_lease.process_id;
        let _residency = fleet_lease.residency;
        let host = fleet_lease.host.into_acp()?;
        let runtime = AcpRuntime::from_host(
            AcpRuntimeOwner {
                agent_run_id: agent_run_id.to_string(),
                execution_epoch,
            },
            host,
            false,
            mcp_projection_digest.to_string(),
            execution_root,
            Some(attachment_access_root.to_path_buf()),
            if permission_semantics == PermissionSemantics::CoreEnforcedV1 {
                workspace.access.clone()
            } else {
                "runtime_managed".to_string()
            },
        );
        self.runtimes
            .lock()
            .await
            .insert(agent_run_id.to_string(), runtime.clone());
        Ok(runtime)
    }

    pub async fn get_agent_run(
        &self,
        agent_run_id: &str,
        execution_epoch: i64,
    ) -> Option<Arc<AcpRuntime>> {
        self.runtimes
            .lock()
            .await
            .get(agent_run_id)
            .filter(|runtime| runtime.execution_epoch() == execution_epoch)
            .cloned()
    }

    pub async fn get_agent_run_on_host(
        &self,
        host_instance_id: &str,
        agent_run_id: &str,
        execution_epoch: i64,
    ) -> Option<Arc<AcpRuntime>> {
        self.runtimes
            .lock()
            .await
            .get(agent_run_id)
            .filter(|runtime| {
                runtime.execution_epoch() == execution_epoch
                    && runtime.host_instance_id() == host_instance_id
            })
            .cloned()
    }

    pub async fn forget_agent_run(&self, agent_run_id: &str, execution_epoch: i64) {
        let runtime = {
            let mut runtimes = self.runtimes.lock().await;
            if runtimes
                .get(agent_run_id)
                .is_some_and(|runtime| runtime.execution_epoch() == execution_epoch)
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
            let mut runtimes = self.runtimes.lock().await;
            if runtimes
                .get(agent_run_id)
                .is_some_and(|runtime| runtime.execution_epoch() == execution_epoch)
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

    pub async fn shutdown_all(&self) {
        let runtimes = self
            .runtimes
            .lock()
            .await
            .drain()
            .map(|(_, runtime)| runtime)
            .collect::<Vec<_>>();
        for runtime in runtimes {
            runtime.detach().await;
        }
    }
}

pub(crate) fn runtime_compatibility_digest(
    frozen_runtime: &FrozenAgentRuntimeConfig,
    workspace: &AgentRunWorkspace,
    permission_semantics: PermissionSemantics,
    external_mcp_servers: &BTreeMap<String, McpServerDefinition>,
    mcp_projection_digest: &str,
    attachment_access_root: &Path,
) -> Result<String> {
    let execution_root = PathBuf::from(&workspace.execution_root)
        .canonicalize()
        .with_context(|| {
            format!(
                "failed to resolve execution root {}",
                workspace.execution_root
            )
        })?;
    canonical_json_digest(&json!({
        "schemaVersion": 1,
        "adapterKind": frozen_runtime.adapter_kind,
        "runtimeConfigDigest": frozen_runtime.config_digest,
        "hostConfigDigest": frozen_runtime.host_config_digest,
        "executionRoot": execution_root,
        "workspace": workspace,
        "permissionSemantics": permission_semantics,
        "builtinToolContractVersion": BUILTIN_TOOL_CONTRACT_VERSION,
        "builtinToolCatalogDigest": builtin_tool_catalog_digest()?,
        "externalMcpServers": external_mcp_servers,
        "mcpProjectionDigest": mcp_projection_digest,
        "attachmentAccessRoot": attachment_access_root,
    }))
}

fn isolated_acp_tool_event(method: &str, params: &Value) -> bool {
    method == "session/update"
        && matches!(
            params
                .pointer("/update/sessionUpdate")
                .and_then(Value::as_str),
            Some("tool_call" | "tool_call_update")
        )
}

fn prepare_private_host_config(
    private_runtime_dir: &Path,
    adapter_kind: AdapterKind,
) -> Result<Option<PathBuf>> {
    if adapter_kind != AdapterKind::KiroCli {
        return Ok(None);
    }
    let root = private_runtime_dir
        .join("acp-host")
        .join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&root).with_context(|| {
        format!(
            "failed to create private ACP Host directory {}",
            root.display()
        )
    })?;
    restrict_private_directory(&root)?;
    Ok(Some(root))
}

#[allow(clippy::too_many_arguments)]
fn configure_runtime_command(
    command: &mut Command,
    workspace: &AgentRunWorkspace,
    permission_semantics: PermissionSemantics,
    runtime: &FrozenAgentRuntimeConfig,
    isolated: bool,
    external_mcp_servers: &BTreeMap<String, McpServerDefinition>,
    private_runtime_dir: &Path,
    private_config_root: Option<&Path>,
    attachment_access_root: Option<&Path>,
) -> Result<Option<EphemeralMcpConfigFile>> {
    let values = runtime
        .permissions
        .values
        .as_object()
        .context("ACP permission configuration must be an object")?;
    match runtime.adapter_kind {
        AdapterKind::OpencodeCli => {
            let configured = values
                .get("permission")
                .and_then(Value::as_str)
                .context("OpenCode Runtime requires permission")?;
            let legacy_read_only = permission_semantics == PermissionSemantics::CoreEnforcedV1
                && workspace.access == "read_only";
            let effective = if legacy_read_only { "deny" } else { configured };
            let mut permission_rules = serde_json::Map::new();
            permission_rules.insert("*".to_string(), json!(effective));
            // Project Skills remain a native, read-only discovery mechanism even
            // when the AgentRun workspace denies ordinary tools. Loading a Skill
            // cannot widen the Runtime's Shell, filesystem, or network policy.
            permission_rules.insert("skill".to_string(), json!("allow"));
            permission_rules.insert("bash".to_string(), json!("allow"));
            let permission_rules = Value::Object(permission_rules);
            health::configure_acp_command(command, runtime.adapter_kind, false);
            command.env(
                "OPENCODE_CONFIG_CONTENT",
                serde_json::to_string(&json!({
                    "autoupdate": false,
                    "permission": permission_rules,
                    "agent": {
                        "build": {"permission": permission_rules},
                        "plan": {"permission": permission_rules}
                    }
                }))?,
            );
            // OpenCode receives Rovai servers through ACP session/new or
            // session/load while preserving its native configuration roots.
        }
        AdapterKind::CopilotCli => {
            let allow_all = values
                .get("allow_all")
                .and_then(Value::as_str)
                .context("Copilot Runtime requires allow_all")?
                == "on"
                && !(permission_semantics == PermissionSemantics::CoreEnforcedV1
                    && workspace.access == "read_only");
            health::configure_acp_command(command, runtime.adapter_kind, allow_all);
            if let Some(root) = attachment_access_root {
                command.arg("--add-dir").arg(root);
            }
            if isolated {
                command.args([
                    "--no-custom-instructions",
                    "--no-ask-user",
                    "--available-tools=",
                ]);
            }
            if !external_mcp_servers.is_empty() {
                let config =
                    write_ephemeral_copilot_config(private_runtime_dir, external_mcp_servers)?;
                command
                    .arg("--additional-mcp-config")
                    .arg(format!("@{}", config.path().to_string_lossy()));
                return Ok(Some(config));
            }
        }
        AdapterKind::KiroCli => {
            let private_config_root =
                private_config_root.context("Kiro Host isolation directory is missing")?;
            write_kiro_additive_agent_config(private_config_root, external_mcp_servers)?;
            health::configure_acp_command(command, runtime.adapter_kind, false);
            // Kiro discovers the Rovai Agent from the Host process working
            // directory. Native mcp.json sources remain enabled and the Agent
            // adds the Rovai definitions with whole-definition precedence.
        }
        AdapterKind::QoderCli | AdapterKind::CodebuddyCli | AdapterKind::QwenCode => {
            let configured = match runtime.adapter_kind {
                AdapterKind::QoderCli => values
                    .get("permission_mode")
                    .and_then(Value::as_str)
                    .context("Qoder Runtime requires permission_mode")?,
                AdapterKind::CodebuddyCli => values
                    .get("permission_mode")
                    .and_then(Value::as_str)
                    .context("CodeBuddy Runtime requires permission_mode")?,
                AdapterKind::QwenCode => values
                    .get("approval_mode")
                    .and_then(Value::as_str)
                    .context("Qwen Code Runtime requires approval_mode")?,
                _ => unreachable!(),
            };
            health::configure_acp_command(command, runtime.adapter_kind, false);
            let legacy_read_only = permission_semantics == PermissionSemantics::CoreEnforcedV1
                && workspace.access == "read_only";
            match runtime.adapter_kind {
                AdapterKind::QoderCli => {
                    command.arg("--permission-mode").arg(if legacy_read_only {
                        "dont_ask"
                    } else {
                        configured
                    });
                }
                AdapterKind::CodebuddyCli => {
                    command.arg("--permission-mode").arg(if legacy_read_only {
                        "dontAsk"
                    } else {
                        configured
                    });
                }
                AdapterKind::QwenCode => {
                    command.arg("--approval-mode").arg(if legacy_read_only {
                        "plan"
                    } else {
                        configured
                    });
                }
                _ => unreachable!(),
            }
            if !external_mcp_servers.is_empty() {
                let config =
                    write_ephemeral_additive_mcp_config(private_runtime_dir, external_mcp_servers)?;
                command.arg("--mcp-config").arg(config.path());
                return Ok(Some(config));
            }
        }
        AdapterKind::CodexCli | AdapterKind::ClaudeCodeCli | AdapterKind::AntigravityApp => {
            bail!("Runtime is not implemented through ACP")
        }
    }
    Ok(None)
}

fn launchable_acp_adapter(kind: AdapterKind) -> bool {
    kind.uses_acp()
}

fn session_additional_directories(
    adapter_kind: AdapterKind,
    attachment_access_root: Option<&Path>,
) -> Vec<String> {
    // Camp attachment roots intentionally have execute-only permissions so a
    // Runtime can open frozen opaque child paths without enumerating other Camp
    // attachments. Qoder 1.1.14 recursively lstat's every ACP additional root
    // during session/new and rejects that secure directory shape. The prompt
    // still carries each exact attachment path, and Rovai's ACP filesystem host
    // enforces that the path remains beneath this root.
    if adapter_kind == AdapterKind::QoderCli {
        return Vec::new();
    }
    attachment_access_root
        .iter()
        .map(|root| root.to_string_lossy().into_owned())
        .collect()
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

#[derive(Debug, Clone)]
pub struct InterceptedAcpActionRequest {
    pub action_id: String,
    pub native_action_id: String,
    pub input: CanonicalActionInput,
    pub runtime_request: RuntimeActionRequestBinding,
    pub reason: Option<String>,
}

pub struct InterceptedAcpActionContext<'a> {
    pub agent_run_id: &'a str,
    pub execution_epoch: i64,
    pub expected_session_id: &'a str,
    pub expected_prompt_id: &'a str,
    pub execution_root: &'a Path,
    pub permission_semantics: PermissionSemantics,
}

pub fn intercepted_action_request(
    context: &InterceptedAcpActionContext<'_>,
    native_request_id: Value,
    params: &Value,
    observed: Option<&ObservedAcpToolContext>,
) -> Result<InterceptedAcpActionRequest> {
    let session_id = params
        .get("sessionId")
        .and_then(Value::as_str)
        .context("ACP permission request has no sessionId")?;
    if session_id != context.expected_session_id {
        bail!("ACP permission request is outside the active Native Session");
    }
    let tool_call = params
        .get("toolCall")
        .context("ACP permission request has no toolCall")?;
    let mut effective_tool_call = tool_call.clone();
    if let Some(observed) = observed
        && let Some(object) = effective_tool_call.as_object_mut()
    {
        if object
            .get("kind")
            .is_none_or(|value| value.as_str().is_none())
            && let Some(kind) = observed.native_kind.as_deref()
        {
            object.insert("kind".to_string(), Value::String(kind.to_string()));
        }
        if object.get("rawInput").is_none_or(|value| {
            value.is_null() || value.as_object().is_some_and(|map| map.is_empty())
        }) && let Some(raw_input) = observed.raw_input.as_ref()
        {
            object.insert("rawInput".to_string(), raw_input.clone());
        }
        if object
            .get("locations")
            .is_none_or(|value| value.is_null() || value.as_array().is_some_and(Vec::is_empty))
            && let Some(locations) = observed.locations.as_ref()
        {
            object.insert("locations".to_string(), locations.clone());
        }
    }
    let native_item_id = tool_call
        .get("toolCallId")
        .and_then(Value::as_str)
        .context("ACP permission request has no stable toolCallId")?
        .to_string();
    // ACP permits a single tool call to issue more than one permission request
    // (for example, OpenCode can request directory access and then the write).
    // Keep the tool call as the result-correlation item, but give every native
    // permission request its own stable Action identity.
    let native_request_digest = canonical_json_digest(&json!({
        "nativeRequestId": &native_request_id,
    }))?;
    let native_action_id = format!("{native_item_id}:permission:{native_request_digest}");
    let request_digest = canonical_json_digest(&json!({
        "nativeMethod": "session/request_permission",
        "params": params,
    }))?;
    let reported_kind = effective_tool_call
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("other");
    let raw_input = effective_tool_call
        .get("rawInput")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let mut effective_params = params.clone();
    if let Some(object) = effective_params.as_object_mut() {
        object.insert("toolCall".to_string(), effective_tool_call.clone());
    }
    let root = context.execution_root.to_string_lossy().to_string();
    let kind = effective_action_kind(reported_kind, &raw_input);
    let input = match kind {
        "edit" | "move" => {
            let path = acp_tool_paths(&effective_params)
                .into_iter()
                .next()
                .unwrap_or_else(|| root.clone());
            CanonicalActionInput::FileWrite {
                path: requested_path(context, &path)?
                    .to_string_lossy()
                    .to_string(),
                operation: "patch".to_string(),
                content_digest: request_digest.clone(),
            }
        }
        "delete" => {
            let path = acp_tool_paths(&effective_params)
                .into_iter()
                .next()
                .unwrap_or_else(|| root.clone());
            CanonicalActionInput::FileDelete {
                path: requested_path(context, &path)?
                    .to_string_lossy()
                    .to_string(),
            }
        }
        "execute" => {
            let argv = match raw_input.get("command") {
                Some(Value::Array(values)) => values
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect::<Vec<_>>(),
                Some(Value::String(command)) => {
                    vec!["/bin/zsh".to_string(), "-lc".to_string(), command.clone()]
                }
                _ => Vec::new(),
            };
            if argv.is_empty() {
                CanonicalActionInput::RuntimePermissionGrant {
                    cwd: root.clone(),
                    permissions: json!({"acpToolCall": tool_call}),
                    request_digest: request_digest.clone(),
                }
            } else {
                CanonicalActionInput::ShellCommand {
                    argv,
                    cwd: requested_path(
                        context,
                        raw_input
                            .get("cwd")
                            .and_then(Value::as_str)
                            .unwrap_or(&root),
                    )?
                    .to_string_lossy()
                    .to_string(),
                    environment_refs: Vec::new(),
                }
            }
        }
        _ => CanonicalActionInput::RuntimePermissionGrant {
            cwd: root,
            permissions: json!({"acpToolCall": tool_call}),
            request_digest: request_digest.clone(),
        },
    };
    let action_id_digest = canonical_json_digest(&json!({
        "agentRunId": context.agent_run_id,
        "executionEpoch": context.execution_epoch,
        "nativeMethod": "session/request_permission",
        "nativeActionId": native_action_id,
        "nativeRequestId": native_request_id,
    }))?;
    Ok(InterceptedAcpActionRequest {
        action_id: format!("action-{action_id_digest}"),
        native_action_id: native_action_id.clone(),
        input,
        runtime_request: RuntimeActionRequestBinding {
            native_method: "session/request_permission".to_string(),
            native_request_id,
            native_item_id,
            native_thread_id: session_id.to_string(),
            native_turn_id: context.expected_prompt_id.to_string(),
            response_context: params.clone(),
            options: permission_options(params)?,
        },
        reason: tool_call
            .get("title")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

fn requested_path(context: &InterceptedAcpActionContext<'_>, value: &str) -> Result<PathBuf> {
    if context.permission_semantics == PermissionSemantics::CoreEnforcedV1 {
        return scoped_path(context.execution_root, value);
    }
    let path = Path::new(value);
    Ok(if path.is_absolute() {
        path.to_path_buf()
    } else {
        context.execution_root.join(path)
    })
}

fn effective_action_kind<'a>(reported_kind: &'a str, raw_input: &Value) -> &'a str {
    if matches!(reported_kind, "edit" | "move" | "delete" | "execute") {
        return reported_kind;
    }

    // OpenCode's ACP bridge currently reports an external-directory permission
    // request as `other`, even when the request belongs to a file-edit tool call.
    // The stable file target remains present in rawInput. Classify that narrow
    // shape as a write so it receives Rovai-ai's normal path and approval checks.
    if ["filepath", "filePath"]
        .iter()
        .any(|key| raw_input.get(key).and_then(Value::as_str).is_some())
    {
        return "edit";
    }

    reported_kind
}

fn permission_options(request: &Value) -> Result<Vec<RuntimePermissionOption>> {
    let options = request
        .get("options")
        .and_then(Value::as_array)
        .context("ACP permission request has no options")?;
    if options.is_empty() {
        bail!("ACP permission request has no options");
    }
    let mut frozen = Vec::with_capacity(options.len());
    let mut option_ids = std::collections::BTreeSet::new();
    for option in options {
        let option_id = option
            .get("optionId")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .context("ACP permission option has no stable optionId")?;
        if !option_ids.insert(option_id) {
            bail!("ACP permission option IDs are not unique");
        }
        let native_kind = option
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("other");
        let (kind, allows_action, fallback_label, consequence) = match native_kind {
            "allow_once" => (
                "allow_once",
                true,
                "允许一次",
                "仅允许当前请求；后续相同操作仍可能再次询问。",
            ),
            "allow_always" => (
                "other",
                true,
                "始终允许",
                "按 Runtime 原生语义持续允许该类请求，作用域由 Runtime 决定。",
            ),
            value if value.starts_with("allow") => (
                "other",
                true,
                "允许",
                "按 Runtime 原生语义允许该请求，具体生命周期由 Runtime 决定。",
            ),
            "reject_once" | "deny" => (
                "deny",
                false,
                "拒绝",
                "拒绝当前请求；Agent 可继续采用不需要该权限的方式。",
            ),
            value if value.starts_with("reject") || value.starts_with("deny") => {
                ("deny", false, "拒绝", "按 Runtime 原生语义拒绝该请求。")
            }
            "cancel" => (
                "cancel",
                false,
                "取消",
                "取消当前请求，不授予所申请的权限。",
            ),
            _ => (
                "other",
                false,
                "按 Runtime 选项处理",
                "选择该 Runtime 原生选项；其作用域和生命周期由 Runtime 决定。",
            ),
        };
        let label = option
            .get("name")
            .or_else(|| option.get("label"))
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(fallback_label);
        frozen.push(RuntimePermissionOption::from_native(
            option_id,
            kind,
            label,
            consequence,
            json!({"outcome": {"outcome": "selected", "optionId": option_id}}),
            allows_action,
        )?);
    }
    Ok(frozen)
}

pub fn approval_result(request: &Value, option_id: &str) -> Result<Value> {
    let options = request
        .get("options")
        .and_then(Value::as_array)
        .context("ACP permission request has no options")?;
    if !options
        .iter()
        .any(|option| option.get("optionId").and_then(Value::as_str) == Some(option_id))
    {
        bail!("ACP permission request has no matching optionId");
    }
    Ok(json!({"outcome": {"outcome": "selected", "optionId": option_id}}))
}

pub fn rejection_result(request: &Value) -> Result<Value> {
    let options = request
        .get("options")
        .and_then(Value::as_array)
        .context("ACP permission request has no options")?;
    let option_id = options
        .iter()
        .find(|option| {
            option
                .get("kind")
                .and_then(Value::as_str)
                .is_some_and(|kind| {
                    kind == "cancel" || kind.starts_with("reject") || kind.starts_with("deny")
                })
        })
        .and_then(|option| option.get("optionId"))
        .and_then(Value::as_str)
        .context("ACP permission request has no fail-closed option")?;
    approval_result(request, option_id)
}

pub fn legacy_approval_result(request: &Value, approved: bool) -> Result<Value> {
    let options = request
        .get("options")
        .and_then(Value::as_array)
        .context("ACP permission request has no options")?;
    let preferred = if approved {
        "allow_once"
    } else {
        "reject_once"
    };
    let fallback_prefix = if approved { "allow" } else { "reject" };
    let option_id = options
        .iter()
        .find(|option| option.get("kind").and_then(Value::as_str) == Some(preferred))
        .or_else(|| {
            options.iter().find(|option| {
                option
                    .get("kind")
                    .and_then(Value::as_str)
                    .is_some_and(|kind| {
                        kind.starts_with(fallback_prefix) && !kind.contains("always")
                    })
            })
        })
        .and_then(|option| option.get("optionId"))
        .and_then(Value::as_str)
        .with_context(|| format!("ACP request has no one-time {fallback_prefix} option"))?;
    approval_result(request, option_id)
}

#[derive(Debug, Clone)]
pub struct CompletedAcpAction {
    pub native_item_id: String,
    pub native_kind: String,
    pub observation_digest: String,
    pub outcome: ActionResultOutcome,
    pub result_code: String,
    pub result_summary: String,
    pub result_data: Value,
    pub effect_disposition: String,
}

pub fn completed_action(params: &Value) -> Result<Option<CompletedAcpAction>> {
    let update = match params.get("update") {
        Some(update)
            if update.get("sessionUpdate").and_then(Value::as_str) == Some("tool_call_update") =>
        {
            update
        }
        _ => return Ok(None),
    };
    let status = update
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("in_progress");
    if !matches!(status, "completed" | "failed") {
        return Ok(None);
    }
    let native_item_id = update
        .get("toolCallId")
        .and_then(Value::as_str)
        .context("ACP tool_call_update has no toolCallId")?
        .to_string();
    let succeeded = status == "completed";
    let raw_input_digest = update
        .get("rawInput")
        .map(canonical_json_digest)
        .transpose()?;
    let raw_output_digest = update
        .get("rawOutput")
        .map(canonical_json_digest)
        .transpose()?;
    let native_kind = update
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("other")
        .to_string();
    let observation_digest = canonical_json_digest(&json!({
        "nativeItemId": &native_item_id,
        "nativeKind": &native_kind,
        "rawInput": update.get("rawInput"),
        "locations": update.get("locations"),
    }))?;
    let effect_disposition = acp_effect_disposition(succeeded, &native_kind);
    Ok(Some(CompletedAcpAction {
        native_item_id: native_item_id.clone(),
        native_kind,
        observation_digest,
        outcome: if succeeded {
            ActionResultOutcome::Succeeded
        } else {
            ActionResultOutcome::Failed
        },
        result_code: format!("acp_tool_{status}"),
        result_summary: update
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or(if succeeded {
                "ACP tool call completed"
            } else {
                "ACP tool call failed"
            })
            .to_string(),
        // ActionExecution is durable audit state, not a transcript/blob store.
        // Keep verifiable digests and structural metadata without persisting
        // command output, file contents, or other potentially sensitive payloads.
        result_data: json!({
            "nativeItemId": native_item_id,
            "status": status,
            "kind": update.get("kind"),
            "title": update.get("title"),
            "locationCount": update
                .get("locations")
                .and_then(Value::as_array)
                .map_or(0, Vec::len),
            "rawInputDigest": raw_input_digest,
            "rawOutputDigest": raw_output_digest,
        }),
        effect_disposition: effect_disposition.to_string(),
    }))
}

fn acp_effect_disposition(succeeded: bool, native_kind: &str) -> &'static str {
    if succeeded {
        "complete"
    } else if native_kind == "execute" {
        // A failed process may still have changed external state before it
        // returned a non-successful result.
        "unknown"
    } else if matches!(native_kind, "edit" | "move" | "delete") {
        // A failed filesystem operation may have applied only part of its
        // requested change.
        "partial"
    } else {
        "none"
    }
}

pub fn is_potential_side_effect(kind: &str) -> bool {
    matches!(kind, "edit" | "move" | "delete" | "execute")
}

fn acp_tool_paths(request: &Value) -> Vec<String> {
    let tool_call = request.get("toolCall").unwrap_or(request);
    let mut result = tool_call
        .get("locations")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|location| location.get("path").and_then(Value::as_str))
        .map(str::to_string)
        .collect::<Vec<_>>();
    if let Some(raw) = tool_call.get("rawInput") {
        for key in ["filepath", "filePath", "path"] {
            if let Some(path) = raw.get(key).and_then(Value::as_str)
                && !result.iter().any(|value| value == path)
            {
                result.push(path.to_string());
            }
        }
    }
    result
}

fn scoped_path(root: &Path, value: &str) -> Result<PathBuf> {
    let root = root
        .canonicalize()
        .with_context(|| format!("AgentRun execution root does not exist: {}", root.display()))?;
    let candidate = Path::new(value);
    let joined = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        root.join(candidate)
    };
    let mut normalized = PathBuf::new();
    for component in joined.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    bail!("file path escapes the AgentRun execution root");
                }
            }
            value => normalized.push(value.as_os_str()),
        }
    }
    let canonical = canonicalize_allow_missing(&normalized)?;
    if !canonical.starts_with(&root) {
        bail!("file path resolves outside the AgentRun execution root");
    }
    Ok(canonical)
}

fn canonicalize_allow_missing(path: &Path) -> Result<PathBuf> {
    let mut cursor = path;
    let mut missing = Vec::new();
    while !cursor.exists() {
        let name = cursor
            .file_name()
            .context("file path has no existing ancestor")?;
        missing.push(name.to_os_string());
        cursor = cursor
            .parent()
            .context("file path has no existing ancestor")?;
    }
    let mut canonical = cursor.canonicalize()?;
    for name in missing.into_iter().rev() {
        canonical.push(name);
    }
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qoder_does_not_receive_the_execute_only_camp_attachment_root() {
        let root = Path::new("/tmp/rovai-camp-attachments/camp-id");
        assert!(session_additional_directories(AdapterKind::QoderCli, Some(root)).is_empty());
        assert_eq!(
            session_additional_directories(AdapterKind::CodebuddyCli, Some(root)),
            vec![root.to_string_lossy().into_owned()]
        );
    }

    #[test]
    fn prompt_identity_is_unique_across_isolated_hosts() {
        assert_ne!(
            acp_prompt_id("host-a", 1),
            acp_prompt_id("host-b", 1),
            "ACP request counters restart for each Host"
        );
        assert_eq!(acp_prompt_id("host-a", 1), "acp-prompt-host-a-1");
    }

    fn isolated_smoke_runtime(kind: AdapterKind, model_id: &str) -> FrozenAgentRuntimeConfig {
        let executable = health::find_adapter(kind).expect("Adapter CLI must be installed");
        let permission_values = match kind {
            AdapterKind::OpencodeCli => json!({"permission": "deny"}),
            AdapterKind::CopilotCli => json!({"allow_all": "off"}),
            AdapterKind::KiroCli => json!({}),
            AdapterKind::QoderCli => json!({"permission_mode": "default"}),
            AdapterKind::CodebuddyCli => json!({"permission_mode": "default"}),
            AdapterKind::QwenCode => json!({"approval_mode": "default"}),
            AdapterKind::CodexCli | AdapterKind::ClaudeCodeCli | AdapterKind::AntigravityApp => {
                unreachable!()
            }
        };
        FrozenAgentRuntimeConfig {
            adapter_kind: kind,
            installation_id: "smoke".to_string(),
            installation_generation: 1,
            search_environment_generation: 1,
            executable_path: executable.to_string_lossy().to_string(),
            auth_scope: "local-user".to_string(),
            reported_version: "smoke".to_string(),
            executable_fingerprint: rovai_core::agent_runtime_adapter::executable_fingerprint(
                &executable,
            )
            .expect("Adapter executable should be readable"),
            capabilities: vec!["acp.initialize".to_string()],
            protocol_version: "acp-v1".to_string(),
            model: rovai_core::agent_profile::ResolvedModelSelection {
                source: "explicit".to_string(),
                model_id: model_id.to_string(),
                options: json!({}),
            },
            permissions: rovai_core::agent_profile::AdapterPermissionConfig {
                adapter_kind: kind,
                schema_version: 1,
                values: permission_values,
            },
            native_session_compatibility_key: Some(format!("{}:acp-v1", kind.as_str())),
            binding_compatibility_digest: "smoke-binding".to_string(),
            host_config_digest: "smoke-host".to_string(),
            config_digest: "smoke-config".to_string(),
        }
    }

    #[tokio::test]
    #[ignore = "manual local Runtime smoke"]
    async fn isolated_opencode_completion_real_runtime_smoke() {
        let runtime = isolated_smoke_runtime(AdapterKind::OpencodeCli, "opencode/big-pickle");
        let directory = std::env::temp_dir().join(format!(
            "rovai-opencode-compaction-smoke-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let output = AcpCliRuntimeAdapter::run_isolated_completion(
            &runtime,
            &directory,
            "只输出这六个字：压缩路径可用",
        )
        .await
        .unwrap();
        assert!(output.contains("压缩路径可用"), "{output}");
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    #[ignore = "manual local Runtime smoke"]
    async fn isolated_copilot_completion_real_runtime_smoke() {
        let runtime = isolated_smoke_runtime(AdapterKind::CopilotCli, "auto");
        let directory = std::env::temp_dir().join(format!(
            "rovai-copilot-compaction-smoke-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let output = AcpCliRuntimeAdapter::run_isolated_completion(
            &runtime,
            &directory,
            "只输出这六个字：压缩路径可用",
        )
        .await
        .unwrap();
        assert!(output.contains("压缩路径可用"), "{output}");
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn approval_selects_the_exact_native_option_id() {
        let request = json!({
            "options": [
                {"optionId": "once", "kind": "allow_once"},
                {"optionId": "always", "kind": "allow_always"},
                {"optionId": "reject", "kind": "reject_once"}
            ]
        });
        assert_eq!(
            approval_result(&request, "always").expect("approval should map"),
            json!({"outcome": {"outcome": "selected", "optionId": "always"}})
        );
        assert_eq!(
            approval_result(&request, "reject").expect("denial should map"),
            json!({"outcome": {"outcome": "selected", "optionId": "reject"}})
        );
    }

    #[test]
    fn acp_edit_request_becomes_a_stable_file_action() {
        let root = std::env::temp_dir().join(format!("rovai-acp-action-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("temporary action root should exist");
        let target = root.join("source.rs");
        let request = json!({
            "sessionId": "session-1",
            "toolCall": {
                "toolCallId": "tool-1",
                "kind": "edit",
                "title": "Edit source",
                "rawInput": {"filepath": target},
                "locations": [{"path": target}]
            },
            "options": [{"optionId": "once", "kind": "allow_once"}]
        });
        let context = InterceptedAcpActionContext {
            agent_run_id: "run-1",
            execution_epoch: 2,
            expected_session_id: "session-1",
            expected_prompt_id: "prompt-1",
            execution_root: &root,
            permission_semantics: PermissionSemantics::RuntimeManagedV2,
        };
        let action = intercepted_action_request(&context, json!(7), &request, None)
            .expect("request should normalize");
        assert!(action.native_action_id.starts_with("tool-1:permission:"));
        assert_eq!(action.runtime_request.native_item_id, "tool-1");
        assert!(matches!(
            action.input,
            CanonicalActionInput::FileWrite { .. }
        ));
        assert_eq!(action.runtime_request.native_turn_id, "prompt-1");
        std::fs::remove_dir_all(root).expect("temporary action root should be removed");
    }

    #[test]
    fn opencode_external_directory_request_keeps_file_write_semantics() {
        let root = std::env::temp_dir().join(format!(
            "rovai-acp-opencode-action-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).expect("temporary action root should exist");
        let target = root.join("approved.txt");
        let request = json!({
            "sessionId": "session-1",
            "toolCall": {
                "toolCallId": "tool-1",
                "kind": "other",
                "title": root,
                "rawInput": {
                    "filepath": target,
                    "parentDir": root
                },
                "locations": [
                    {"path": target},
                    {"path": root}
                ]
            },
            "options": [{"optionId": "once", "kind": "allow_once"}]
        });
        let context = InterceptedAcpActionContext {
            agent_run_id: "run-1",
            execution_epoch: 2,
            expected_session_id: "session-1",
            expected_prompt_id: "prompt-1",
            execution_root: &root,
            permission_semantics: PermissionSemantics::RuntimeManagedV2,
        };
        let action = intercepted_action_request(&context, json!(7), &request, None)
            .expect("request should normalize");
        assert!(matches!(
            action.input,
            CanonicalActionInput::FileWrite { .. }
        ));
        std::fs::remove_dir_all(root).expect("temporary action root should be removed");
    }

    #[test]
    fn permission_request_reuses_the_matching_structured_tool_update() {
        let root = std::env::temp_dir().join(format!(
            "rovai-acp-observed-action-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).expect("temporary action root should exist");
        let target = root.join("approved.txt");
        let request = json!({
            "sessionId": "session-1",
            "toolCall": {
                "toolCallId": "tool-1",
                "kind": "execute",
                "title": "Read approved file"
            },
            "options": [{"optionId": "once", "kind": "allow_once"}]
        });
        let command = format!("cat {}", target.display());
        let observed = ObservedAcpToolContext {
            native_kind: Some("execute".to_string()),
            raw_input: Some(json!({
                "command": command,
                "cwd": root,
            })),
            locations: Some(json!([{"path": target}])),
        };
        let context = InterceptedAcpActionContext {
            agent_run_id: "run-1",
            execution_epoch: 2,
            expected_session_id: "session-1",
            expected_prompt_id: "prompt-1",
            execution_root: &root,
            permission_semantics: PermissionSemantics::RuntimeManagedV2,
        };
        let action = intercepted_action_request(&context, json!(7), &request, Some(&observed))
            .expect("request should reuse the matching observed tool input");
        assert!(matches!(
            action.input,
            CanonicalActionInput::ShellCommand { ref argv, ref cwd, .. }
                if argv == &vec!["/bin/zsh".to_string(), "-lc".to_string(), command]
                    && cwd == &root.to_string_lossy()
        ));
        std::fs::remove_dir_all(root).expect("temporary action root should be removed");
    }

    #[test]
    fn completed_action_persists_digests_instead_of_raw_tool_payloads() {
        let completion = completed_action(&json!({
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "tool-1",
                "status": "completed",
                "kind": "execute",
                "title": "Run command",
                "rawInput": {"command": "echo TOP_SECRET_INPUT"},
                "rawOutput": {"stdout": "TOP_SECRET_OUTPUT"}
            }
        }))
        .expect("completion should normalize")
        .expect("terminal tool update should create a result");

        let persisted = serde_json::to_string(&completion.result_data)
            .expect("normalized result should serialize");
        assert!(!persisted.contains("TOP_SECRET_INPUT"));
        assert!(!persisted.contains("TOP_SECRET_OUTPUT"));
        assert!(completion.result_data["rawInputDigest"].is_string());
        assert!(completion.result_data["rawOutputDigest"].is_string());
        assert_eq!(completion.native_kind, "execute");
        assert!(!completion.observation_digest.is_empty());
    }

    #[test]
    fn failed_side_effects_do_not_claim_that_nothing_happened() {
        let execute = completed_action(&json!({
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "tool-1",
                "status": "failed",
                "kind": "execute"
            }
        }))
        .expect("completion should normalize")
        .expect("terminal tool update should create a result");
        let edit = completed_action(&json!({
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "tool-2",
                "status": "failed",
                "kind": "edit"
            }
        }))
        .expect("completion should normalize")
        .expect("terminal tool update should create a result");

        assert_eq!(execute.effect_disposition, "unknown");
        assert_eq!(edit.effect_disposition, "partial");
    }
}
