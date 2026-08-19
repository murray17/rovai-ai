use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs::OpenOptions,
    io::Write,
    path::{Component, Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use anyhow::{Context, Result, bail};
#[cfg(test)]
use rovai_core::agent_runtime_adapter::TRAE_RUNTIME_DEFAULT_MODEL_ID;
use rovai_core::{
    action::{
        ActionResultOutcome, CanonicalActionInput, RuntimeActionRequestBinding,
        RuntimePermissionOption,
    },
    agent_profile::{AdapterKind, FrozenAgentRuntimeConfig},
    agent_runtime_adapter::{
        acp_model_catalog_from_session, acp_runtime_model_id_from_session,
        write_kiro_additive_agent_config,
    },
    builtin_tool_transport::{BUILTIN_TOOL_CONTRACT_VERSION, builtin_tool_catalog_digest},
    camp_attachment_view::{
        CAMP_ATTACHMENT_VIEW_CONTRACT_VERSION, CampAttachmentRuntimeAuthorization,
    },
    command::canonical_json_digest,
    compaction::{CompactionDetectorPolicy, CompactionObserverLease},
    managed_process::{
        ManagedChildStderr, ManagedChildStdin, ManagedChildStdout, ManagedProcess,
        ManagedProcessLaunchSpec, ManagedProcessPurpose, ManagedStdinPolicy,
        ManagedWindowsArgvDialect,
    },
    mcp::McpServerDefinition,
    runtime::{AgentRunWorkspace, PermissionSemantics},
    runtime_discovery::{
        RuntimeLaunchPurpose, configure_active_runtime_command, runtime_launch_allowed,
    },
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
    InputAccepted {
        adapter_kind: AdapterKind,
        host_instance_id: String,
        agent_run_id: String,
        execution_epoch: i64,
        native_session_id: String,
        native_prompt_id: String,
        delivery_id: String,
    },
    InputNotAccepted {
        adapter_kind: AdapterKind,
        host_instance_id: String,
        agent_run_id: String,
        execution_epoch: i64,
        native_prompt_id: String,
        delivery_id: String,
        error: String,
    },
    Message {
        adapter_kind: AdapterKind,
        host_instance_id: String,
        agent_run_id: String,
        execution_epoch: i64,
        native_session_id: String,
        native_prompt_id: String,
        delivery_id: String,
        sequence: u64,
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
    CompactionObservation {
        adapter_kind: AdapterKind,
        host_instance_id: String,
        observer_lease_id: String,
        native_session_id: String,
        source_observation_id: String,
        source_signal: String,
        admission_point: String,
        source_event_digest: String,
        observed_at: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct AcpRuntimeOwner {
    agent_run_id: String,
    execution_epoch: i64,
}

impl AcpRuntimeOwner {
    fn input_accepted(
        &self,
        adapter_kind: AdapterKind,
        host_instance_id: &str,
        native_session_id: &str,
        active_prompt: &AcpActivePrompt,
    ) -> AcpIncoming {
        AcpIncoming::InputAccepted {
            adapter_kind,
            host_instance_id: host_instance_id.to_string(),
            agent_run_id: self.agent_run_id.clone(),
            execution_epoch: self.execution_epoch,
            native_session_id: native_session_id.to_string(),
            native_prompt_id: active_prompt.prompt_id.clone(),
            delivery_id: active_prompt.delivery_id.clone(),
        }
    }

    fn input_not_accepted(
        &self,
        adapter_kind: AdapterKind,
        host_instance_id: &str,
        active_prompt: &AcpActivePrompt,
        error: String,
    ) -> AcpIncoming {
        AcpIncoming::InputNotAccepted {
            adapter_kind,
            host_instance_id: host_instance_id.to_string(),
            agent_run_id: self.agent_run_id.clone(),
            execution_epoch: self.execution_epoch,
            native_prompt_id: active_prompt.prompt_id.clone(),
            delivery_id: active_prompt.delivery_id.clone(),
            error,
        }
    }

    fn message(
        &self,
        adapter_kind: AdapterKind,
        host_instance_id: &str,
        native_session_id: &str,
        active_prompt: &AcpActivePrompt,
        sequence: u64,
        message: Value,
    ) -> AcpIncoming {
        AcpIncoming::Message {
            adapter_kind,
            host_instance_id: host_instance_id.to_string(),
            agent_run_id: self.agent_run_id.clone(),
            execution_epoch: self.execution_epoch,
            native_session_id: native_session_id.to_string(),
            native_prompt_id: active_prompt.prompt_id.clone(),
            delivery_id: active_prompt.delivery_id.clone(),
            sequence,
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
    phase: AcpSessionPhase,
    sequence: u64,
}

#[derive(Debug, Clone)]
enum AcpSessionPhase {
    LoadingReplay {
        replay_event_count: u64,
        replay_byte_count: u64,
        started_at: Instant,
    },
    Ready,
    PromptActive(AcpActivePrompt),
    PromptCompleted(AcpActivePrompt),
    ProtocolViolated {
        reason: String,
    },
}

impl AcpSessionPhase {
    fn loading_replay() -> Self {
        Self::LoadingReplay {
            replay_event_count: 0,
            replay_byte_count: 0,
            started_at: Instant::now(),
        }
    }
}

#[derive(Debug, Clone)]
struct AcpActivePrompt {
    prompt_id: String,
    delivery_id: String,
    acceptance_emitted: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AcpSessionContinuation {
    ReuseSameHost,
    Resume,
    New,
    HistoryRestore,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct AcpSessionCapabilities {
    pub can_resume: bool,
    pub can_load_history: bool,
}

enum AcpSessionMessageRoute {
    Forward {
        owner: AcpRuntimeOwner,
        active_prompt: AcpActivePrompt,
        sequence: u64,
    },
    ReplayQuarantined,
    Quarantined(String),
    ReplayRejected(String),
    Missing,
}

const ACP_HISTORY_RESTORE_MAX_EVENTS: u64 = 4_096;
const ACP_HISTORY_RESTORE_MAX_BYTES: u64 = 8 * 1024 * 1024;
const ACP_HISTORY_RESTORE_TIMEOUT: Duration = Duration::from_secs(30);

fn replay_budget_violation(
    event_count: u64,
    byte_count: u64,
    elapsed: Duration,
) -> Option<&'static str> {
    if event_count > ACP_HISTORY_RESTORE_MAX_EVENTS {
        Some("ACP History Restore exceeded its replay event limit")
    } else if byte_count > ACP_HISTORY_RESTORE_MAX_BYTES {
        Some("ACP History Restore exceeded its replay byte limit")
    } else if elapsed > ACP_HISTORY_RESTORE_TIMEOUT {
        Some("ACP History Restore exceeded its replay time limit")
    } else {
        None
    }
}

#[derive(Debug, Clone)]
struct AcpCompactionObserverRoute {
    lease: CompactionObserverLease,
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

#[derive(Debug)]
struct AcpPromptObservation {
    prompt_id: String,
    delivery_id: String,
    streamed_agent_text: String,
    missing_send_recovery: AcpMissingSendRecoveryCollector,
    observed_tools: HashMap<String, ObservedToolMetadata>,
}

impl AcpPromptObservation {
    fn new(prompt_id: String, delivery_id: String) -> Self {
        Self {
            prompt_id,
            delivery_id,
            streamed_agent_text: String::new(),
            missing_send_recovery: AcpMissingSendRecoveryCollector::default(),
            observed_tools: HashMap::new(),
        }
    }
}

struct AcpPreparedPrompt {
    request_id: u64,
    prompt_id: String,
}

#[derive(Debug, Clone)]
pub struct ObservedAcpToolContext {
    native_kind: Option<String>,
    raw_input: Option<Value>,
    locations: Option<Value>,
}

enum PendingRpc {
    Response {
        method: String,
        sender: oneshot::Sender<std::result::Result<Value, String>>,
    },
    Prompt {
        owner: AcpRuntimeOwner,
        session_id: String,
        prompt_id: String,
    },
}

pub(crate) struct AcpHost {
    adapter_kind: AdapterKind,
    reported_version: Option<String>,
    host_instance_id: String,
    child: Mutex<ManagedProcess>,
    stdin: Mutex<ManagedChildStdin>,
    pending: Mutex<HashMap<u64, PendingRpc>>,
    next_id: AtomicU64,
    next_compaction_observation_sequence: AtomicU64,
    routes: RwLock<HashMap<String, AcpSessionRoute>>,
    compaction_observers: RwLock<HashMap<String, AcpCompactionObserverRoute>>,
    known_sessions: RwLock<HashSet<String>>,
    session_results: RwLock<HashMap<String, Value>>,
    incoming: mpsc::UnboundedSender<AcpIncoming>,
    alive: AtomicBool,
    protocol_violated: AtomicBool,
    initialize_result: RwLock<Option<Value>>,
    startup_diagnostics: Mutex<String>,
    private_config_root: Option<PathBuf>,
    detector_config_root: Option<PathBuf>,
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
        compaction_detector_policy: CompactionDetectorPolicy,
        allow_client_fs: bool,
        external_mcp_servers: &BTreeMap<String, McpServerDefinition>,
        private_runtime_dir: &Path,
        attachment_access_root: Option<&Path>,
    ) -> Result<Arc<Self>> {
        if !runtime_launch_allowed(
            frozen_runtime.adapter_kind,
            RuntimeLaunchPurpose::AgentExecution,
        ) {
            bail!("Runtime launch policy rejected Agent execution");
        }
        let private_config_root =
            prepare_private_host_config(private_runtime_dir, frozen_runtime.adapter_kind)?;
        let host_instance_id = uuid::Uuid::new_v4().to_string();
        let mut command = Command::new(&frozen_runtime.executable_path);
        configure_active_runtime_command(&mut command);
        if let Some(config) = &builtin_tools {
            config.configure_command(&mut command)?;
        }
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
        let detector_config_root = if compaction_detector_policy
            == CompactionDetectorPolicy::BestEffort
        {
            match builtin_tools.as_ref() {
                Some(builtin_tools) => match configure_compaction_detector_command(
                    &mut command,
                    frozen_runtime.adapter_kind,
                    &host_instance_id,
                    builtin_tools,
                    private_runtime_dir,
                    cwd,
                ) {
                    Ok(root) => root,
                    Err(error) => {
                        eprintln!(
                            "{} compaction detector configuration is unavailable; Runtime startup continues: {error:#}",
                            frozen_runtime.adapter_kind.as_str()
                        );
                        None
                    }
                },
                None => None,
            }
        } else {
            None
        };
        let process_working_directory = if frozen_runtime.adapter_kind == AdapterKind::KiroCli {
            private_config_root
                .as_deref()
                .context("Kiro Host isolation directory is missing")?
        } else {
            cwd
        };
        command.current_dir(process_working_directory);
        let spec = ManagedProcessLaunchSpec::capture(
            &command,
            ManagedProcessPurpose::RuntimeHost,
            ManagedStdinPolicy::Piped,
            ManagedWindowsArgvDialect::MicrosoftCrt,
            format!("runtime-host:{}", frozen_runtime.adapter_kind.as_str()),
        )?;
        let mut child = ManagedProcess::spawn(spec).with_context(|| {
            format!(
                "failed to start {} as an ACP server",
                frozen_runtime.executable_path
            )
        })?;
        let stdin = child.take_stdin().context("ACP stdin was unavailable")?;
        let stdout = child.take_stdout().context("ACP stdout was unavailable")?;
        let stderr = child.take_stderr().context("ACP stderr was unavailable")?;
        let host = Arc::new(Self {
            adapter_kind: frozen_runtime.adapter_kind,
            reported_version: frozen_runtime.reported_version.clone(),
            host_instance_id,
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            next_compaction_observation_sequence: AtomicU64::new(1),
            routes: RwLock::new(HashMap::new()),
            compaction_observers: RwLock::new(HashMap::new()),
            known_sessions: RwLock::new(HashSet::new()),
            session_results: RwLock::new(HashMap::new()),
            incoming,
            alive: AtomicBool::new(true),
            protocol_violated: AtomicBool::new(false),
            initialize_result: RwLock::new(None),
            startup_diagnostics: Mutex::new(String::new()),
            private_config_root,
            detector_config_root,
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
                *host.initialize_result.write().await = Some(result);
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

    fn spawn_stdout_reader(host: Arc<Self>, stdout: ManagedChildStdout) {
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) if !line.trim().is_empty() => {
                        let message = match serde_json::from_str::<Value>(&line) {
                            Ok(message) => message,
                            Err(error) => {
                                let reason =
                                    format!("ACP Host emitted invalid protocol JSON: {error}");
                                if host.has_loading_replay().await {
                                    host.reject_loading_replay(reason.clone()).await;
                                    eprintln!("{reason}");
                                    continue;
                                }
                                host.send_host_diagnostic(reason);
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
                        let session_id = message
                            .pointer("/params/sessionId")
                            .and_then(Value::as_str)
                            .map(str::to_string);
                        let route = match session_id.as_deref() {
                            Some(session_id) => {
                                host.route_session_message(session_id, line.len()).await
                            }
                            None => AcpSessionMessageRoute::Missing,
                        };
                        match route {
                            AcpSessionMessageRoute::Forward {
                                owner,
                                active_prompt,
                                sequence,
                            } => {
                                let session_id = session_id
                                    .as_deref()
                                    .expect("forwarded ACP route has Session ID");
                                host.forward_compaction_observation(session_id, &message)
                                    .await;
                                let _ = host.incoming.send(owner.message(
                                    host.adapter_kind,
                                    &host.host_instance_id,
                                    session_id,
                                    &active_prompt,
                                    sequence,
                                    message,
                                ));
                            }
                            AcpSessionMessageRoute::ReplayQuarantined => {
                                if message.get("id").is_some() {
                                    let id = message.get("id").cloned().unwrap_or(Value::Null);
                                    let _ = host
                                        .send(json!({
                                            "jsonrpc": "2.0",
                                            "id": id,
                                            "error": {
                                                "code": -32602,
                                                "message": "Rovai-ai quarantined an ACP History Restore request"
                                            }
                                        }))
                                        .await;
                                }
                            }
                            AcpSessionMessageRoute::Quarantined(reason) => {
                                host.send_host_diagnostic(format!(
                                    "ACP Session message was quarantined: {reason}"
                                ));
                                if message.get("id").is_some() {
                                    let id = message.get("id").cloned().unwrap_or(Value::Null);
                                    let _ = host
                                        .send(json!({
                                            "jsonrpc": "2.0",
                                            "id": id,
                                            "error": {
                                                "code": -32602,
                                                "message": "Rovai-ai has no active prompt for this ACP Session"
                                            }
                                        }))
                                    .await;
                                }
                            }
                            AcpSessionMessageRoute::ReplayRejected(reason) => {
                                eprintln!("ACP Session replay was rejected: {reason}");
                                host.reject_loading_replay(reason).await;
                            }
                            AcpSessionMessageRoute::Missing
                                if session_id.is_some() && host.has_loading_replay().await =>
                            {
                                let reason =
                                    "ACP History Restore emitted an event for another Session"
                                        .to_string();
                                eprintln!("{reason}");
                                host.reject_loading_replay(reason).await;
                            }
                            AcpSessionMessageRoute::Missing if message.get("id").is_some() => {
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
                            AcpSessionMessageRoute::Missing => {}
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
                if let PendingRpc::Response { sender, .. } = pending {
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
            PendingRpc::Response { sender, .. } => {
                let _ = sender.send(response);
            }
            PendingRpc::Prompt {
                owner,
                session_id,
                prompt_id,
            } => {
                let active_prompt = {
                    let mut routes = self.routes.write().await;
                    let Some(route) = routes.get_mut(&session_id) else {
                        return;
                    };
                    let AcpSessionPhase::PromptActive(active_prompt) = &mut route.phase else {
                        return;
                    };
                    if route.owner != owner || active_prompt.prompt_id != prompt_id {
                        return;
                    }
                    let should_emit_acceptance = !active_prompt.acceptance_emitted;
                    active_prompt.acceptance_emitted = true;
                    let active_prompt = active_prompt.clone();
                    route.phase = AcpSessionPhase::PromptCompleted(active_prompt.clone());
                    route.sequence = route.sequence.saturating_add(1);
                    Some((active_prompt, should_emit_acceptance, route.sequence))
                };
                if let Some((active_prompt, should_emit_acceptance, sequence)) = active_prompt {
                    match &response {
                        Ok(_) if should_emit_acceptance => {
                            let _ = self.incoming.send(owner.input_accepted(
                                self.adapter_kind,
                                &self.host_instance_id,
                                &session_id,
                                &active_prompt,
                            ));
                        }
                        Err(error) if should_emit_acceptance => {
                            let _ = self.incoming.send(owner.input_not_accepted(
                                self.adapter_kind,
                                &self.host_instance_id,
                                &active_prompt,
                                error.clone(),
                            ));
                        }
                        _ => {}
                    }
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
                        &session_id,
                        &active_prompt,
                        sequence,
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

    fn spawn_stderr_reader(host: Arc<Self>, stderr: ManagedChildStderr) {
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

    async fn bind_session(
        &self,
        session_id: &str,
        owner: &AcpRuntimeOwner,
        phase: AcpSessionPhase,
    ) -> Result<()> {
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
                phase,
                sequence: 0,
            },
        );
        Ok(())
    }

    async fn mark_session_ready(&self, session_id: &str, owner: &AcpRuntimeOwner) -> Result<()> {
        let mut routes = self.routes.write().await;
        let route = routes
            .get_mut(session_id)
            .context("ACP Session has no loading route")?;
        if &route.owner != owner || !matches!(route.phase, AcpSessionPhase::LoadingReplay { .. }) {
            bail!("ACP Session loading route failed Host/Run fencing");
        }
        route.phase = AcpSessionPhase::Ready;
        Ok(())
    }

    async fn route_session_message(
        &self,
        session_id: &str,
        message_bytes: usize,
    ) -> AcpSessionMessageRoute {
        let mut routes = self.routes.write().await;
        let Some(route) = routes.get_mut(session_id) else {
            return AcpSessionMessageRoute::Missing;
        };
        match &mut route.phase {
            AcpSessionPhase::PromptActive(active_prompt) => {
                route.sequence = route.sequence.saturating_add(1);
                AcpSessionMessageRoute::Forward {
                    owner: route.owner.clone(),
                    active_prompt: active_prompt.clone(),
                    sequence: route.sequence,
                }
            }
            AcpSessionPhase::LoadingReplay {
                replay_event_count,
                replay_byte_count,
                started_at,
            } => {
                let event_count = replay_event_count.saturating_add(1);
                let byte_count = replay_byte_count
                    .saturating_add(u64::try_from(message_bytes).unwrap_or(u64::MAX));
                if let Some(reason) =
                    replay_budget_violation(event_count, byte_count, started_at.elapsed())
                {
                    let reason = reason.to_string();
                    route.phase = AcpSessionPhase::ProtocolViolated {
                        reason: reason.clone(),
                    };
                    self.protocol_violated.store(true, Ordering::Release);
                    return AcpSessionMessageRoute::ReplayRejected(reason);
                }
                *replay_event_count = event_count;
                *replay_byte_count = byte_count;
                AcpSessionMessageRoute::ReplayQuarantined
            }
            AcpSessionPhase::Ready => {
                let reason = "session-scoped message arrived without an active prompt".to_string();
                route.phase = AcpSessionPhase::ProtocolViolated {
                    reason: reason.clone(),
                };
                self.protocol_violated.store(true, Ordering::Release);
                AcpSessionMessageRoute::Quarantined(reason)
            }
            AcpSessionPhase::PromptCompleted(_) => {
                let reason = "session-scoped message arrived after prompt completion".to_string();
                route.phase = AcpSessionPhase::ProtocolViolated {
                    reason: reason.clone(),
                };
                self.protocol_violated.store(true, Ordering::Release);
                AcpSessionMessageRoute::Quarantined(reason)
            }
            AcpSessionPhase::ProtocolViolated { reason } => {
                AcpSessionMessageRoute::Quarantined(reason.clone())
            }
        }
    }

    async fn has_loading_replay(&self) -> bool {
        self.routes
            .read()
            .await
            .values()
            .any(|route| matches!(route.phase, AcpSessionPhase::LoadingReplay { .. }))
    }

    async fn reject_loading_replay(&self, reason: String) {
        {
            let mut routes = self.routes.write().await;
            for route in routes.values_mut() {
                if matches!(route.phase, AcpSessionPhase::LoadingReplay { .. }) {
                    route.phase = AcpSessionPhase::ProtocolViolated {
                        reason: reason.clone(),
                    };
                }
            }
        }
        self.protocol_violated.store(true, Ordering::Release);
        let rejected = {
            let mut pending = self.pending.lock().await;
            let ids = pending
                .iter()
                .filter_map(|(id, request)| match request {
                    PendingRpc::Response { method, .. }
                        if matches!(method.as_str(), "session/load" | "session/resume") =>
                    {
                        Some(*id)
                    }
                    _ => None,
                })
                .collect::<Vec<_>>();
            ids.into_iter()
                .filter_map(|id| pending.remove(&id))
                .collect::<Vec<_>>()
        };
        for request in rejected {
            if let PendingRpc::Response { sender, .. } = request {
                let _ = sender.send(Err(reason.clone()));
            }
        }
    }

    async fn knows_session(&self, session_id: &str) -> bool {
        self.known_sessions.read().await.contains(session_id)
    }

    async fn remember_session(&self, session_id: &str, result: Option<&Value>) {
        self.known_sessions
            .write()
            .await
            .insert(session_id.to_string());
        if let Some(result) = result {
            self.session_results
                .write()
                .await
                .insert(session_id.to_string(), result.clone());
        }
    }

    async fn session_result(&self, session_id: &str) -> Option<Value> {
        self.session_results.read().await.get(session_id).cloned()
    }

    async fn install_compaction_observer(&self, lease: CompactionObserverLease) -> Result<()> {
        if lease.adapter_kind != self.adapter_kind
            || lease.host_instance_id != self.host_instance_id
            || lease.native_session_id.trim().is_empty()
        {
            bail!("Compaction Observer Lease does not belong to this ACP Host");
        }
        self.compaction_observers.write().await.insert(
            lease.native_session_id.clone(),
            AcpCompactionObserverRoute { lease },
        );
        Ok(())
    }

    async fn forward_compaction_observation(&self, session_id: &str, message: &Value) {
        let Some(detected) = detect_acp_compaction_signal(self.adapter_kind, message) else {
            return;
        };
        let route = self
            .compaction_observers
            .read()
            .await
            .get(session_id)
            .cloned();
        let Some(route) = route else {
            return;
        };
        let sequence = self
            .next_compaction_observation_sequence
            .fetch_add(1, Ordering::Relaxed);
        let runtime_occurrence = detected.runtime_occurrence_id.as_deref().map_or_else(
            || format!("host:{}:{sequence}", self.host_instance_id),
            |occurrence| format!("runtime:{occurrence}"),
        );
        let source_observation_id = format!("{}:{runtime_occurrence}", detected.source_signal);
        let source_event_digest = match canonical_json_digest(&json!({
            "schemaVersion": 1,
            "adapterKind": self.adapter_kind.as_str(),
            "nativeSessionId": session_id,
            "sourceSignal": detected.source_signal,
            "admissionPoint": detected.admission_point,
            "runtimeOccurrence": runtime_occurrence,
        })) {
            Ok(digest) => digest,
            Err(error) => {
                self.send_host_diagnostic(format!(
                    "ACP compaction observation could not be digested: {error:#}"
                ));
                return;
            }
        };
        let _ = self.incoming.send(AcpIncoming::CompactionObservation {
            adapter_kind: self.adapter_kind,
            host_instance_id: self.host_instance_id.clone(),
            observer_lease_id: route.lease.id,
            native_session_id: session_id.to_string(),
            source_observation_id,
            source_signal: detected.source_signal.to_string(),
            admission_point: detected.admission_point.to_string(),
            source_event_digest,
            observed_at: chrono::Utc::now().to_rfc3339(),
        });
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
            .and_then(|route| match &route.phase {
                AcpSessionPhase::PromptActive(active_prompt)
                | AcpSessionPhase::PromptCompleted(active_prompt) => {
                    Some(active_prompt.prompt_id.clone())
                }
                AcpSessionPhase::LoadingReplay { .. }
                | AcpSessionPhase::Ready
                | AcpSessionPhase::ProtocolViolated { .. } => None,
            })
    }

    async fn matches_prompt_fence(
        &self,
        session_id: &str,
        owner: &AcpRuntimeOwner,
        prompt_id: &str,
        delivery_id: &str,
    ) -> bool {
        self.routes
            .read()
            .await
            .get(session_id)
            .filter(|route| &route.owner == owner)
            .and_then(|route| match &route.phase {
                AcpSessionPhase::PromptActive(active_prompt)
                | AcpSessionPhase::PromptCompleted(active_prompt) => Some(active_prompt),
                AcpSessionPhase::LoadingReplay { .. }
                | AcpSessionPhase::Ready
                | AcpSessionPhase::ProtocolViolated { .. } => None,
            })
            .is_some_and(|active_prompt| {
                active_prompt.prompt_id == prompt_id && active_prompt.delivery_id == delivery_id
            })
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
            && !self.protocol_violated.load(Ordering::Acquire)
            && self.pending.lock().await.is_empty()
            && self.routes.read().await.is_empty()
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
        if let Some(root) = self.private_config_root.as_ref() {
            let _ = std::fs::remove_dir_all(root);
        }
        if let Some(root) = self.detector_config_root.as_ref() {
            let _ = std::fs::remove_dir_all(root);
        }
    }

    async fn rpc(&self, method: &str, params: Value) -> Result<Value> {
        self.rpc_with_timeout(method, params, Duration::from_secs(45))
            .await
    }

    async fn rpc_with_timeout(
        &self,
        method: &str,
        params: Value,
        deadline: Duration,
    ) -> Result<Value> {
        if !self.is_alive() {
            bail!("ACP Host is not alive");
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().await.insert(
            id,
            PendingRpc::Response {
                method: method.to_string(),
                sender,
            },
        );
        if let Err(error) = self
            .send(json!({"jsonrpc": "2.0", "method": method, "id": id, "params": params}))
            .await
        {
            self.pending.lock().await.remove(&id);
            return Err(error);
        }
        let response = match timeout(deadline, receiver).await {
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

    async fn prepare_prompt(
        &self,
        session_id: &str,
        owner: &AcpRuntimeOwner,
        delivery_id: &str,
    ) -> Result<AcpPreparedPrompt> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        // ACP request IDs restart from 1 for every Host process. A logical
        // Native Binding can span warm or replacement Hosts, so include Host
        // identity in the Native Input correlation.
        let prompt_id = acp_prompt_id(&self.host_instance_id, id);
        {
            let mut routes = self.routes.write().await;
            let route = routes
                .get_mut(session_id)
                .context("ACP Session has no logical runtime binding")?;
            if &route.owner != owner {
                bail!("ACP Session failed Host/Run fencing");
            }
            if !matches!(route.phase, AcpSessionPhase::Ready) {
                bail!("ACP Session already has an active prompt");
            }
            route.phase = AcpSessionPhase::PromptActive(AcpActivePrompt {
                prompt_id: prompt_id.clone(),
                delivery_id: delivery_id.to_string(),
                acceptance_emitted: false,
            });
        }
        self.pending.lock().await.insert(
            id,
            PendingRpc::Prompt {
                owner: owner.clone(),
                session_id: session_id.to_string(),
                prompt_id: prompt_id.clone(),
            },
        );
        Ok(AcpPreparedPrompt {
            request_id: id,
            prompt_id,
        })
    }

    async fn dispatch_prepared_prompt(
        &self,
        session_id: &str,
        prepared: &AcpPreparedPrompt,
        text: &str,
    ) -> Result<()> {
        if let Err(error) = self
            .send(json!({
                "jsonrpc": "2.0",
                "method": "session/prompt",
                "id": prepared.request_id,
                "params": {
                    "sessionId": session_id,
                    "prompt": [{"type": "text", "text": text}]
                }
            }))
            .await
        {
            self.pending.lock().await.remove(&prepared.request_id);
            if let Some(route) = self.routes.write().await.get_mut(session_id)
                && matches!(route.phase, AcpSessionPhase::PromptActive(_))
            {
                route.phase = AcpSessionPhase::Ready;
            }
            return Err(error);
        }
        Ok(())
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

#[derive(Debug, Clone, PartialEq, Eq)]
struct DetectedAcpCompactionSignal {
    source_signal: &'static str,
    admission_point: &'static str,
    runtime_occurrence_id: Option<String>,
}

fn detect_acp_compaction_signal(
    adapter_kind: AdapterKind,
    message: &Value,
) -> Option<DetectedAcpCompactionSignal> {
    let method = message.get("method").and_then(Value::as_str)?;
    let runtime_occurrence_id = message
        .pointer("/params/compactionId")
        .or_else(|| message.pointer("/params/operationId"))
        .or_else(|| message.pointer("/params/id"))
        .and_then(|value| {
            value
                .as_str()
                .map(ToOwned::to_owned)
                .or_else(|| value.as_i64().map(|value| value.to_string()))
        });
    match adapter_kind {
        AdapterKind::KiroCli if method == "_kiro.dev/compaction/status" => {
            let status = message
                .pointer("/params/status/type")
                .or_else(|| message.pointer("/params/status"))
                .or_else(|| message.pointer("/params/state"))
                .or_else(|| message.pointer("/params/phase"))
                .and_then(Value::as_str)?;
            matches!(
                status,
                "completed" | "complete" | "succeeded" | "success" | "compacted"
            )
            .then_some(DetectedAcpCompactionSignal {
                source_signal: "_kiro.dev/compaction/status",
                admission_point: "completed",
                runtime_occurrence_id,
            })
        }
        _ => None,
    }
}

#[derive(Debug, Default)]
struct AcpMissingSendRecoveryCollector {
    state: AcpMissingSendRecoveryState,
}

#[derive(Debug, Default)]
enum AcpMissingSendRecoveryState {
    #[default]
    Empty,
    Anonymous(String),
    Identified {
        message_id: String,
        text: String,
    },
    Ambiguous,
}

impl AcpMissingSendRecoveryCollector {
    fn clear(&mut self) {
        self.state = AcpMissingSendRecoveryState::Empty;
    }

    fn observe_tool_activity(&mut self) {
        // Only assistant text after the latest tool boundary may be recovered.
        self.clear();
    }

    fn observe_assistant_chunk(&mut self, message_id: Option<&str>, text: &str) {
        if text.is_empty() {
            return;
        }
        self.state = match (std::mem::take(&mut self.state), message_id) {
            (AcpMissingSendRecoveryState::Empty, Some(message_id)) => {
                AcpMissingSendRecoveryState::Identified {
                    message_id: message_id.to_string(),
                    text: text.to_string(),
                }
            }
            (AcpMissingSendRecoveryState::Empty, None) => {
                AcpMissingSendRecoveryState::Anonymous(text.to_string())
            }
            (AcpMissingSendRecoveryState::Anonymous(mut current), None) => {
                current.push_str(text);
                AcpMissingSendRecoveryState::Anonymous(current)
            }
            (AcpMissingSendRecoveryState::Anonymous(_), Some(_)) => {
                AcpMissingSendRecoveryState::Ambiguous
            }
            (
                AcpMissingSendRecoveryState::Identified {
                    message_id: current_id,
                    text: mut current,
                },
                Some(message_id),
            ) if current_id == message_id => {
                current.push_str(text);
                AcpMissingSendRecoveryState::Identified {
                    message_id: current_id,
                    text: current,
                }
            }
            (AcpMissingSendRecoveryState::Identified { .. }, Some(message_id)) => {
                // A new, explicit message identity is the latest assistant
                // candidate and supersedes the earlier assistant message.
                AcpMissingSendRecoveryState::Identified {
                    message_id: message_id.to_string(),
                    text: text.to_string(),
                }
            }
            (AcpMissingSendRecoveryState::Identified { .. }, None)
            | (AcpMissingSendRecoveryState::Ambiguous, _) => AcpMissingSendRecoveryState::Ambiguous,
        };
    }

    fn candidate(&self) -> Option<String> {
        let text = match &self.state {
            AcpMissingSendRecoveryState::Anonymous(text)
            | AcpMissingSendRecoveryState::Identified { text, .. } => text,
            AcpMissingSendRecoveryState::Empty | AcpMissingSendRecoveryState::Ambiguous => {
                return None;
            }
        };
        let text = text.trim().to_string();
        (!text.is_empty()).then_some(text)
    }
}

pub struct AcpRuntime {
    owner: AcpRuntimeOwner,
    host: Arc<AcpHost>,
    runtime_compatibility_digest: String,
    mcp_projection_digest: String,
    session_id: RwLock<Option<String>>,
    session_result: RwLock<Option<Value>>,
    execution_root: PathBuf,
    attachment_access_root: Option<PathBuf>,
    workspace_access: String,
    active_observation: Mutex<Option<AcpPromptObservation>>,
    authorized_file_writes: Mutex<HashSet<PathBuf>>,
}

#[derive(Debug)]
pub(crate) struct AcpLiveModelValidationError {
    pub code: &'static str,
    model_id: String,
    detail: String,
}

impl std::fmt::Display for AcpLiveModelValidationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "{} for explicit model {}: {}",
            self.code, self.model_id, self.detail
        )
    }
}

impl std::error::Error for AcpLiveModelValidationError {}

fn select_acp_session_continuation(
    adapter_kind: AdapterKind,
    same_host_knows_session: bool,
    existing_session_id: Option<&str>,
    capabilities: AcpSessionCapabilities,
) -> AcpSessionContinuation {
    if same_host_knows_session {
        return AcpSessionContinuation::ReuseSameHost;
    }
    if existing_session_id.is_none() {
        return AcpSessionContinuation::New;
    }
    if capabilities.can_resume {
        return AcpSessionContinuation::Resume;
    }
    if capabilities.can_load_history && history_restore_allowed(adapter_kind) {
        return AcpSessionContinuation::HistoryRestore;
    }
    AcpSessionContinuation::New
}

fn history_restore_allowed(adapter_kind: AdapterKind) -> bool {
    matches!(
        adapter_kind,
        AdapterKind::OpencodeCli
            | AdapterKind::CopilotCli
            | AdapterKind::KiroCli
            | AdapterKind::QoderCli
            | AdapterKind::CodebuddyCli
            | AdapterKind::QwenCode
            | AdapterKind::TraeCnCli
    )
}

impl AcpRuntime {
    #[allow(clippy::too_many_arguments)]
    fn from_host(
        owner: AcpRuntimeOwner,
        host: Arc<AcpHost>,
        runtime_compatibility_digest: String,
        mcp_projection_digest: String,
        execution_root: PathBuf,
        attachment_access_root: Option<PathBuf>,
        workspace_access: String,
    ) -> Arc<Self> {
        Arc::new(Self {
            owner,
            host,
            runtime_compatibility_digest,
            mcp_projection_digest,
            session_id: RwLock::new(None),
            session_result: RwLock::new(None),
            execution_root,
            attachment_access_root,
            workspace_access,
            active_observation: Mutex::new(None),
            authorized_file_writes: Mutex::new(HashSet::new()),
        })
    }

    pub(crate) async fn session_continuation(
        &self,
        existing_session_id: Option<&str>,
        capabilities: AcpSessionCapabilities,
    ) -> AcpSessionContinuation {
        let same_host_knows_session = match existing_session_id {
            Some(session_id) => self.host.knows_session(session_id).await,
            None => false,
        };
        select_acp_session_continuation(
            self.host.adapter_kind,
            same_host_knows_session,
            existing_session_id,
            capabilities,
        )
    }

    pub async fn start_or_resume_session(
        &self,
        existing_session_id: Option<&str>,
        capabilities: AcpSessionCapabilities,
        model_source: &str,
        model: &str,
        model_options: &Value,
        external_mcp_servers: &BTreeMap<String, McpServerDefinition>,
    ) -> Result<String> {
        let cwd = self.execution_root.to_string_lossy().to_string();
        let additional_directories =
            session_additional_directories(self.attachment_access_root.as_deref())?;
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
        let continuation = self
            .session_continuation(existing_session_id, capabilities)
            .await;
        let (session_id, prebound_session) = match continuation {
            AcpSessionContinuation::ReuseSameHost => (
                existing_session_id
                    .context("same-Host ACP continuation has no Session ID")?
                    .to_string(),
                false,
            ),
            AcpSessionContinuation::Resume | AcpSessionContinuation::HistoryRestore => {
                let existing_session_id =
                    existing_session_id.context("cross-Host ACP continuation has no Session ID")?;
                self.host
                    .bind_session(
                        existing_session_id,
                        &self.owner,
                        AcpSessionPhase::loading_replay(),
                    )
                    .await?;
                let method = if continuation == AcpSessionContinuation::Resume {
                    "session/resume"
                } else {
                    "session/load"
                };
                let result = match self
                    .host
                    .rpc_with_timeout(
                        method,
                        json!({
                            "sessionId": existing_session_id,
                            "cwd": cwd,
                            "mcpServers": mcp_servers,
                            "additionalDirectories": additional_directories,
                        }),
                        ACP_HISTORY_RESTORE_TIMEOUT,
                    )
                    .await
                {
                    Ok(result) => result,
                    Err(error) => {
                        self.host
                            .unbind_session(existing_session_id, &self.owner)
                            .await;
                        return Err(error);
                    }
                };
                if let Some(returned_session_id) = result.get("sessionId").and_then(Value::as_str)
                    && returned_session_id != existing_session_id
                {
                    let reason = format!(
                        "ACP {method} returned a different Session ID than the exact restore target"
                    );
                    self.host.reject_loading_replay(reason.clone()).await;
                    bail!(reason);
                }
                *self.session_result.write().await = Some(result);
                (existing_session_id.to_string(), true)
            }
            AcpSessionContinuation::New => {
                let result = self
                    .host
                    .rpc(
                        "session/new",
                        json!({
                            "cwd": cwd,
                            "mcpServers": mcp_servers,
                            "additionalDirectories": additional_directories,
                        }),
                    )
                    .await?;
                *self.session_result.write().await = Some(result.clone());
                let session_id = result
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .context("ACP Session response did not include sessionId")?
                    .to_string();
                (session_id, false)
            }
        };
        if self.session_result.read().await.is_none()
            && let Some(result) = self.host.session_result(&session_id).await
        {
            *self.session_result.write().await = Some(result);
        }
        let session_result = self.session_result.read().await.clone();
        self.host
            .remember_session(&session_id, session_result.as_ref())
            .await;
        if model_source == "explicit" {
            let session_result = session_result.as_ref().ok_or_else(|| {
                anyhow::Error::new(AcpLiveModelValidationError {
                    code: "runtime_model_catalog_unavailable",
                    model_id: model.to_string(),
                    detail: "the real ACP Session did not expose its catalog".to_string(),
                })
            })?;
            let models = acp_model_catalog_from_session(session_result).map_err(|error| {
                anyhow::Error::new(AcpLiveModelValidationError {
                    code: "runtime_model_catalog_unavailable",
                    model_id: model.to_string(),
                    detail: error.to_string(),
                })
            })?;
            if !models.iter().any(|candidate| {
                candidate.id == model && !candidate.hidden && !candidate.deprecated
            }) {
                return Err(anyhow::Error::new(AcpLiveModelValidationError {
                    code: "runtime_model_unavailable",
                    model_id: model.to_string(),
                    detail: "the real ACP Session did not advertise the saved model".to_string(),
                }));
            }
            if self.host.adapter_kind == AdapterKind::KiroCli {
                self.set_model(&session_id, model).await?;
            } else {
                self.set_config_option(&session_id, "model", model).await?;
            }
        } else if model_source != "runtime_default" {
            bail!("ACP model source is invalid");
        }
        if model_source == "explicit"
            && self.host.adapter_kind == AdapterKind::KiroCli
            && model_options
                .as_object()
                .is_some_and(|options| !options.is_empty())
        {
            bail!("Kiro ACP does not support generic per-Session model options");
        }
        if model_source == "explicit"
            && self.host.adapter_kind != AdapterKind::KiroCli
            && let Some(options) = model_options.as_object()
        {
            for (key, value) in options {
                if let Some(value) = value.as_str() {
                    self.set_config_option(&session_id, key, value).await?;
                }
            }
        }
        if prebound_session {
            self.host
                .mark_session_ready(&session_id, &self.owner)
                .await?;
        } else {
            self.host
                .bind_session(&session_id, &self.owner, AcpSessionPhase::Ready)
                .await?;
        }
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

    pub async fn observed_model_id(&self) -> Option<String> {
        self.session_result
            .read()
            .await
            .as_ref()
            .and_then(acp_runtime_model_id_from_session)
    }

    #[cfg(test)]
    async fn verification_evidence(&self) -> Option<(Value, Value)> {
        let initialize = self.host.initialize_result.read().await.clone()?;
        let session = self.session_result.read().await.clone()?;
        Some((initialize, session))
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

    pub async fn start_prompt(&self, delivery_id: &str, text: &str) -> Result<String> {
        let session_id = self
            .session_id()
            .await
            .context("ACP Session is not ready")?;
        let prepared = self
            .host
            .prepare_prompt(&session_id, &self.owner, delivery_id)
            .await?;
        *self.active_observation.lock().await = Some(AcpPromptObservation::new(
            prepared.prompt_id.clone(),
            delivery_id.to_string(),
        ));
        if let Err(error) = self
            .host
            .dispatch_prepared_prompt(&session_id, &prepared, text)
            .await
        {
            let mut observation = self.active_observation.lock().await;
            if observation
                .as_ref()
                .is_some_and(|observation| observation.prompt_id == prepared.prompt_id)
            {
                *observation = None;
            }
            return Err(error);
        }
        Ok(prepared.prompt_id)
    }

    pub async fn install_compaction_observer(&self, lease: CompactionObserverLease) -> Result<()> {
        let session_id = self
            .session_id()
            .await
            .context("ACP Session is not ready for Compaction Observer establishment")?;
        if lease.native_session_id != session_id {
            bail!("Compaction Observer Lease targets another ACP Session");
        }
        self.host.install_compaction_observer(lease).await
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
        native_prompt_id: &str,
        method: &str,
        params: &Value,
    ) -> Result<Option<CompletedAcpAction>> {
        let mut observation = self.active_observation.lock().await;
        let observation = observation
            .as_mut()
            .context("ACP event arrived without an active Prompt observation")?;
        if observation.prompt_id != native_prompt_id {
            bail!("ACP event targeted a stale Prompt observation");
        }
        if method == "session/request_permission" {
            observation.missing_send_recovery.observe_tool_activity();
            return Ok(None);
        }
        if method != "session/update" {
            return Ok(None);
        }
        let Some(update) = params.get("update") else {
            return Ok(None);
        };
        let session_update = update.get("sessionUpdate").and_then(Value::as_str);
        if session_update == Some("agent_message_chunk")
            && let Some(text) = update.pointer("/content/text").and_then(Value::as_str)
        {
            observation.streamed_agent_text.push_str(text);
            let message_id = update
                .get("messageId")
                .or_else(|| update.pointer("/content/messageId"))
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty());
            observation
                .missing_send_recovery
                .observe_assistant_chunk(message_id, text);
        }
        if matches!(session_update, Some("tool_call" | "tool_call_update")) {
            observation.missing_send_recovery.observe_tool_activity();
        }
        if !matches!(session_update, Some("tool_call" | "tool_call_update")) {
            return Ok(None);
        }
        let Some(native_item_id) = update.get("toolCallId").and_then(Value::as_str) else {
            return Ok(None);
        };
        let terminal = matches!(
            update.get("status").and_then(Value::as_str),
            Some("completed" | "failed")
        );
        let observed = observation
            .observed_tools
            .entry(native_item_id.to_string())
            .or_default();
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
        let observed = observation
            .observed_tools
            .remove(native_item_id)
            .unwrap_or_default();
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

    pub async fn final_agent_message(&self, native_prompt_id: &str) -> Option<String> {
        let observation = self.active_observation.lock().await;
        let observation = observation
            .as_ref()
            .filter(|observation| observation.prompt_id == native_prompt_id)?;
        let text = observation.streamed_agent_text.trim().to_string();
        (!text.is_empty()).then_some(text)
    }

    pub async fn missing_send_recovery_candidate(&self, native_prompt_id: &str) -> Option<String> {
        self.active_observation
            .lock()
            .await
            .as_ref()
            .filter(|observation| observation.prompt_id == native_prompt_id)
            .and_then(|observation| observation.missing_send_recovery.candidate())
    }

    pub async fn session_id(&self) -> Option<String> {
        self.session_id.read().await.clone()
    }

    pub async fn prompt_id(&self) -> Option<String> {
        let session_id = self.session_id().await?;
        self.host.active_prompt(&session_id, &self.owner).await
    }

    pub async fn matches_prompt_fence(
        &self,
        native_session_id: &str,
        native_prompt_id: &str,
        delivery_id: &str,
    ) -> bool {
        if self.session_id().await.as_deref() != Some(native_session_id) {
            return false;
        }
        if !self
            .host
            .matches_prompt_fence(
                native_session_id,
                &self.owner,
                native_prompt_id,
                delivery_id,
            )
            .await
        {
            return false;
        }
        self.active_observation
            .lock()
            .await
            .as_ref()
            .is_some_and(|observation| {
                observation.prompt_id == native_prompt_id && observation.delivery_id == delivery_id
            })
    }

    pub async fn observed_tool_context(
        &self,
        native_prompt_id: &str,
        native_item_id: &str,
    ) -> Option<ObservedAcpToolContext> {
        self.active_observation
            .lock()
            .await
            .as_ref()
            .filter(|observation| observation.prompt_id == native_prompt_id)
            .and_then(|observation| observation.observed_tools.get(native_item_id))
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

    pub fn reported_version(&self) -> Option<&str> {
        self.host.reported_version.as_deref()
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

    pub(crate) async fn detach(&self) {
        *self.active_observation.lock().await = None;
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
    compaction_detector_policy: CompactionDetectorPolicy,
}

impl AcpCliRuntimeAdapter {
    pub fn new(
        kind: AdapterKind,
        incoming: mpsc::UnboundedSender<AcpIncoming>,
        private_runtime_dir: PathBuf,
        fleet: Arc<AgentRuntimeFleetManager>,
        compaction_detector_policy: CompactionDetectorPolicy,
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
            compaction_detector_policy,
        })
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
                && existing.runtime_compatibility_digest == runtime_compatibility_digest
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
                        self.compaction_detector_policy,
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
            runtime_compatibility_digest.to_string(),
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
                completed_run_release_disposition(self.kind),
            )
            .await;
    }

    pub async fn prepare_agent_run_terminal_visibility(
        &self,
        agent_run_id: &str,
        execution_epoch: i64,
    ) {
        if matches!(self.kind, AdapterKind::KiroCli | AdapterKind::TraeCnCli) {
            // Kiro must finish Host teardown, while TRAE must publish its
            // quiescent Host to the warm LRU, before a durable terminal lets a
            // successor Run compete for a process. complete_agent_run is
            // idempotent, so the common post-terminal cleanup remains safe.
            self.complete_agent_run(agent_run_id, execution_epoch).await;
        }
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

fn completed_run_release_disposition(adapter_kind: AdapterKind) -> FleetReleaseDisposition {
    if adapter_kind == AdapterKind::KiroCli {
        // Kiro keeps a Native Session locked for the lifetime of its ACP
        // process. Stop the Host here so the successor process can load the
        // persisted Session without extending locked state across AgentRuns.
        FleetReleaseDisposition::Stop
    } else {
        FleetReleaseDisposition::Reusable
    }
}

pub(crate) fn runtime_compatibility_digest(
    frozen_runtime: &FrozenAgentRuntimeConfig,
    workspace: &AgentRunWorkspace,
    permission_semantics: PermissionSemantics,
    external_mcp_servers: &BTreeMap<String, McpServerDefinition>,
    mcp_projection_digest: &str,
    attachment_authorization: &CampAttachmentRuntimeAuthorization,
) -> Result<String> {
    let execution_root = PathBuf::from(&workspace.execution_root)
        .canonicalize()
        .with_context(|| {
            format!(
                "failed to resolve execution root {}",
                workspace.execution_root
            )
        })?;
    // TRAE's first real AgentRun upgrades an installed-unverified snapshot to
    // Ready and therefore changes the full frozen config digest. Its MCP
    // projection file digest is also Run-local because the file includes the
    // AgentRun ID. Neither value is a Host launch input. Keep TRAE warm
    // compatibility on the dedicated Host digest and the concrete resolved MCP
    // server set below.
    let excludes_run_local_digests = frozen_runtime.adapter_kind == AdapterKind::TraeCnCli;
    let runtime_config_digest =
        (!excludes_run_local_digests).then_some(frozen_runtime.config_digest.as_str());
    let mcp_projection_compatibility_digest =
        (!excludes_run_local_digests).then_some(mcp_projection_digest);
    canonical_json_digest(&json!({
        "schemaVersion": 3,
        "adapterKind": frozen_runtime.adapter_kind,
        "runtimeConfigDigest": runtime_config_digest,
        "hostConfigDigest": frozen_runtime.host_config_digest,
        "executionRoot": execution_root,
        "workspace": workspace,
        "permissionSemantics": permission_semantics,
        "builtinToolContractVersion": BUILTIN_TOOL_CONTRACT_VERSION,
        "builtinToolCatalogDigest": builtin_tool_catalog_digest()?,
        "externalMcpServers": external_mcp_servers,
        "mcpProjectionDigest": mcp_projection_compatibility_digest,
        "campAttachmentViewContractVersion": CAMP_ATTACHMENT_VIEW_CONTRACT_VERSION,
        "campAttachmentRoot": attachment_authorization.attachment_root,
        "campAttachmentVisibilityMode": attachment_authorization.visibility_mode.as_str(),
        "campAttachmentGeneration": attachment_authorization
            .visibility_mode
            .compatibility_generation(attachment_authorization.generation),
    }))
}

pub(crate) fn freeze_history_restore_compatibility(
    mut frozen_runtime: FrozenAgentRuntimeConfig,
    workspace: &AgentRunWorkspace,
) -> Result<FrozenAgentRuntimeConfig> {
    if frozen_runtime.adapter_kind != AdapterKind::TraeCnCli {
        return Ok(frozen_runtime);
    }
    let execution_root = PathBuf::from(&workspace.execution_root)
        .canonicalize()
        .with_context(|| {
            format!(
                "failed to resolve TRAE History Restore workspace {}",
                workspace.execution_root
            )
        })?;
    let compatibility_digest = canonical_json_digest(&json!({
        "schemaVersion": 1,
        "adapterKind": frozen_runtime.adapter_kind,
        "installationId": &frozen_runtime.installation_id,
        "protocolVersion": &frozen_runtime.protocol_version,
        "executableFingerprint": &frozen_runtime.executable_fingerprint,
        "hostConfigDigest": &frozen_runtime.host_config_digest,
        "workspace": {
            "executionRoot": execution_root,
            "access": &workspace.access,
            "isolation": &workspace.isolation,
        },
        "model": &frozen_runtime.model,
        "permissions": &frozen_runtime.permissions,
    }))?;
    let compatibility_key = format!("trae-cn-cli:history-restore-v1:{compatibility_digest}");
    if frozen_runtime.native_session_compatibility_key.as_deref()
        == Some(compatibility_key.as_str())
    {
        return Ok(frozen_runtime);
    }
    frozen_runtime.native_session_compatibility_key = Some(compatibility_key);
    frozen_runtime.config_digest.clear();
    frozen_runtime.config_digest = canonical_json_digest(&serde_json::to_value(&frozen_runtime)?)?;
    Ok(frozen_runtime)
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
            let trust_all_tools = values
                .get("trust_all_tools")
                .and_then(Value::as_str)
                .context("Kiro Runtime requires trust_all_tools")?
                == "on"
                && !(permission_semantics == PermissionSemantics::CoreEnforcedV1
                    && workspace.access == "read_only");
            health::configure_acp_command(command, runtime.adapter_kind, trust_all_tools);
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
        AdapterKind::TraeCnCli => {
            let configured = values
                .get("permission_mode")
                .and_then(Value::as_str)
                .context("TRAE CLI CN Runtime requires permission_mode")?;
            health::configure_acp_command(command, runtime.adapter_kind, false);
            let legacy_read_only = permission_semantics == PermissionSemantics::CoreEnforcedV1
                && workspace.access == "read_only";
            command.arg("--permission-mode").arg(if legacy_read_only {
                "plan"
            } else {
                configured
            });
            // TRAE receives Rovai MCP definitions through session/new or
            // session/load. Native MCP configuration remains untouched.
        }
        AdapterKind::CodexCli | AdapterKind::ClaudeCodeCli | AdapterKind::AntigravityApp => {
            bail!("Runtime is not implemented through ACP")
        }
    }
    Ok(None)
}

fn configure_compaction_detector_command(
    command: &mut Command,
    adapter_kind: AdapterKind,
    host_instance_id: &str,
    builtin_tools: &BuiltinToolProcessConfig,
    private_runtime_dir: &Path,
    runtime_cwd: &Path,
) -> Result<Option<PathBuf>> {
    if adapter_kind == AdapterKind::KiroCli {
        // Kiro emits its structured compaction lifecycle notification directly
        // on the ACP transport, so it needs no Runtime-side Hook installation.
        return Ok(None);
    }
    if !matches!(
        adapter_kind,
        AdapterKind::OpencodeCli
            | AdapterKind::CopilotCli
            | AdapterKind::QoderCli
            | AdapterKind::CodebuddyCli
            | AdapterKind::QwenCode
    ) {
        return Ok(None);
    }

    #[cfg(not(unix))]
    {
        let _ = (
            command,
            host_instance_id,
            builtin_tools,
            private_runtime_dir,
            runtime_cwd,
        );
        bail!("Runtime Hook relay is not implemented on this platform");
    }

    #[cfg(unix)]
    {
        let root = private_runtime_dir
            .join("compaction-detector")
            .join(host_instance_id);
        std::fs::create_dir_all(&root).with_context(|| {
            format!(
                "failed to create Compaction Detector directory {}",
                root.display()
            )
        })?;
        restrict_private_directory(&root)?;
        let hook_command = format!(
            "{} __compaction-hook --adapter-kind {} --host-instance-id {} --source-signal {}",
            quote_posix_shell_word(&builtin_tools.cli_executable().to_string_lossy()),
            quote_posix_shell_word(adapter_kind.as_str()),
            quote_posix_shell_word(host_instance_id),
            quote_posix_shell_word(match adapter_kind {
                AdapterKind::CopilotCli => "preCompact",
                AdapterKind::QoderCli | AdapterKind::QwenCode => "PostCompact",
                AdapterKind::CodebuddyCli => "SessionStart",
                AdapterKind::OpencodeCli => "session.compacted",
                _ => unreachable!(),
            }),
        );
        match adapter_kind {
            AdapterKind::OpencodeCli => {
                let plugin_path = root.join("opencode-compaction-observer.ts");
                let cli = serde_json::to_string(
                    &builtin_tools.cli_executable().to_string_lossy().as_ref(),
                )?;
                let host = serde_json::to_string(host_instance_id)?;
                write_private_text_file(
                    &plugin_path,
                    &format!(
                        r#"export const RovaiCompactionObserver = async () => ({{
  event: async ({{ event }}) => {{
    if (event?.type !== "session.compacted") return
    const sessionId = event?.properties?.sessionID
    if (typeof sessionId !== "string" || sessionId.length === 0) return
    const child = Bun.spawn([
      {cli}, "__compaction-hook", "--adapter-kind", "opencode-cli",
      "--host-instance-id", {host}, "--source-signal", "session.compacted"
    ], {{ stdin: "pipe", stdout: "ignore", stderr: "ignore" }})
    child.stdin.write(JSON.stringify({{
      session_id: sessionId,
      hook_event_name: "session.compacted",
      trigger: "completed",
      observation_id: crypto.randomUUID(),
      timestamp: Date.now()
    }}))
    child.stdin.end()
    await child.exited
  }}
}})
"#,
                    ),
                )?;
                let config = command
                    .as_std()
                    .get_envs()
                    .find(|(key, _)| *key == "OPENCODE_CONFIG_CONTENT")
                    .and_then(|(_, value)| value)
                    .context("OpenCode Runtime config content is missing")?
                    .to_str()
                    .context("OpenCode Runtime config content is not UTF-8")?;
                let mut config: Value = serde_json::from_str(config)?;
                append_opencode_compaction_plugin(&mut config, &plugin_path)?;
                command.env("OPENCODE_CONFIG_CONTENT", serde_json::to_string(&config)?);
            }
            AdapterKind::CopilotCli => {
                let plugin_root = root.join("copilot-plugin");
                std::fs::create_dir_all(&plugin_root)?;
                restrict_private_directory(&plugin_root)?;
                write_private_json_file(
                    &plugin_root.join("plugin.json"),
                    &json!({
                        "name": "rovai-bootstrap-redelivery-observer",
                        "description": "Rovai Native Session compaction observer",
                        "version": "0.48.0",
                        "hooks": "hooks.json"
                    }),
                )?;
                write_private_json_file(
                    &plugin_root.join("hooks.json"),
                    &json!({
                        "version": 1,
                        "hooks": {
                            "preCompact": [{
                                "type": "command",
                                "bash": hook_command,
                                "timeoutSec": 3
                            }]
                        }
                    }),
                )?;
                command.arg("--plugin-dir").arg(plugin_root);
            }
            AdapterKind::QoderCli => {
                let settings_path = root.join("additional-settings.json");
                write_private_json_file(
                    &settings_path,
                    &qoder_post_compact_hook_settings(&hook_command),
                )?;
                command.arg("--settings").arg(settings_path);
            }
            AdapterKind::CodebuddyCli => {
                let plugin_root = root.join("codebuddy-plugin");
                let manifest_root = plugin_root.join(".codebuddy-plugin");
                let hooks_root = plugin_root.join("hooks");
                std::fs::create_dir_all(&manifest_root)?;
                std::fs::create_dir_all(&hooks_root)?;
                restrict_private_directory(&plugin_root)?;
                restrict_private_directory(&manifest_root)?;
                restrict_private_directory(&hooks_root)?;
                write_private_json_file(
                    &manifest_root.join("plugin.json"),
                    &json!({
                        "name": "rovai-bootstrap-redelivery-observer",
                        "description": "Rovai Native Session compaction observer",
                        "version": "0.48.0",
                        "hooks": "./hooks/hooks.json"
                    }),
                )?;
                write_private_json_file(
                    &hooks_root.join("hooks.json"),
                    &codebuddy_compaction_hook_settings(&hook_command),
                )?;
                command.arg("--plugin-dir").arg(plugin_root);
            }
            AdapterKind::QwenCode => {
                let (private_home, source_home, mut settings) =
                    prepare_qwen_private_home(&root, runtime_cwd)?;
                append_post_compact_hook(&mut settings, &hook_command)?;
                write_private_json_file(&private_home.join("settings.json"), &settings)?;
                command.env("QWEN_HOME", &private_home);
                if std::env::var_os("QWEN_RUNTIME_DIR").is_none() {
                    command.env("QWEN_RUNTIME_DIR", source_home);
                }
            }
            _ => unreachable!(),
        }
        Ok(Some(root))
    }
}

fn qoder_post_compact_hook_settings(hook_command: &str) -> Value {
    json!({"hooks": {"PostCompact": [{
        "matcher": "manual|auto",
        "hooks": [{
            "type": "command",
            "command": hook_command
        }]
    }]}})
}

fn codebuddy_compaction_hook_settings(hook_command: &str) -> Value {
    // CodeBuddy 2.133.1 completes emergency automatic compaction before
    // emitting SessionStart(source=compact). Its separate pre-message strategy
    // bypasses PreCompact, PostCompact and this event; the release documents
    // that target-version coverage gap instead of inferring it from tokens.
    json!({"hooks": {"SessionStart": [{
        "matcher": "compact",
        "hooks": [{
            "type": "command",
            "command": hook_command
        }]
    }]}})
}

fn append_post_compact_hook(settings: &mut Value, hook_command: &str) -> Result<()> {
    let settings = settings
        .as_object_mut()
        .context("Qwen user settings must be a JSON object")?;
    let hooks = settings
        .entry("hooks")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .context("Qwen user settings hooks must be a JSON object")?;
    let post_compact = hooks
        .entry("PostCompact")
        .or_insert_with(|| json!([]))
        .as_array_mut()
        .context("Qwen user settings PostCompact hooks must be an array")?;
    post_compact.push(json!({
        // Qwen's trigger matcher is an exact comparison, not a regular
        // expression. `*` admits both documented trigger values while the
        // relay still validates that the payload says `manual` or `auto`.
        "matcher": "*",
        "hooks": [{
            "type": "command",
            "command": hook_command,
            "name": "rovai-bootstrap-redelivery-observer",
            "timeout": 3000,
            "async": false
        }]
    }));
    Ok(())
}

fn append_opencode_compaction_plugin(config: &mut Value, plugin_path: &Path) -> Result<()> {
    let config = config
        .as_object_mut()
        .context("OpenCode Runtime config content must be an object")?;
    let plugins = config
        .entry("plugin")
        .or_insert_with(|| json!([]))
        .as_array_mut()
        .context("OpenCode Runtime config plugins must be an array")?;
    plugins.push(Value::String(plugin_path.to_string_lossy().into_owned()));
    Ok(())
}

#[cfg(unix)]
fn prepare_qwen_private_home(
    detector_root: &Path,
    runtime_cwd: &Path,
) -> Result<(PathBuf, PathBuf, Value)> {
    use std::os::unix::fs::symlink;

    let source_home = match std::env::var_os("QWEN_HOME") {
        Some(configured) => {
            let configured = PathBuf::from(configured);
            if configured.is_absolute() {
                configured
            } else if configured == Path::new("~") {
                PathBuf::from(
                    std::env::var_os("HOME").context("Qwen Runtime has no home directory")?,
                )
            } else if let Ok(relative_to_home) = configured.strip_prefix("~/") {
                PathBuf::from(
                    std::env::var_os("HOME").context("Qwen Runtime has no home directory")?,
                )
                .join(relative_to_home)
            } else {
                runtime_cwd.join(configured)
            }
        }
        None => {
            PathBuf::from(std::env::var_os("HOME").context("Qwen Runtime has no home directory")?)
                .join(".qwen")
        }
    };
    let private_home = detector_root.join("qwen-home");
    std::fs::create_dir_all(&private_home)?;
    restrict_private_directory(&private_home)?;
    if source_home.is_dir() {
        for entry in std::fs::read_dir(&source_home)? {
            let entry = entry?;
            if entry.file_name() == "settings.json" {
                continue;
            }
            symlink(entry.path(), private_home.join(entry.file_name())).with_context(|| {
                format!(
                    "failed to project Qwen user configuration {}",
                    entry.path().display()
                )
            })?;
        }
    }
    let settings_path = source_home.join("settings.json");
    let settings = if settings_path.exists() {
        let text = std::fs::read_to_string(&settings_path)
            .with_context(|| format!("failed to read {}", settings_path.display()))?;
        json5::from_str(&text)
            .with_context(|| format!("invalid Qwen user settings {}", settings_path.display()))?
    } else {
        json!({})
    };
    Ok((private_home, source_home, settings))
}

fn write_private_json_file(path: &Path, value: &Value) -> Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .with_context(|| format!("failed to create {}", path.display()))?;
    serde_json::to_writer(&mut file, value)
        .with_context(|| format!("failed to write {}", path.display()))?;
    file.write_all(b"\n")?;
    file.flush()?;
    Ok(())
}

fn write_private_text_file(path: &Path, value: &str) -> Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .with_context(|| format!("failed to create {}", path.display()))?;
    file.write_all(value.as_bytes())
        .with_context(|| format!("failed to write {}", path.display()))?;
    file.flush()?;
    Ok(())
}

fn quote_posix_shell_word(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn launchable_acp_adapter(kind: AdapterKind) -> bool {
    kind.uses_acp()
}

fn session_additional_directories(attachment_access_root: Option<&Path>) -> Result<Vec<String>> {
    let root = attachment_access_root.context(
        "camp_attachment_view_runtime_unsupported: ACP Session has no exact Camp attachment root",
    )?;
    Ok(vec![root.to_string_lossy().into_owned()])
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

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::runtime_fleet::AgentRuntimeFleetConfig;
    use rovai_core::agent_profile::{AdapterPermissionConfig, ResolvedModelSelection};
    use std::os::unix::fs::PermissionsExt;

    fn make_executable(path: &Path, body: &str) {
        std::fs::write(path, body).unwrap();
        let mut permissions = std::fs::metadata(path).unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(path, permissions).unwrap();
    }

    fn exact_attachment_root(root: &Path) -> PathBuf {
        let attachment_root = root.join("attachments");
        std::fs::create_dir_all(&attachment_root).unwrap();
        attachment_root
    }

    fn frozen_trae_runtime(executable: &Path) -> FrozenAgentRuntimeConfig {
        FrozenAgentRuntimeConfig {
            adapter_kind: AdapterKind::TraeCnCli,
            installation_id: "installation-trae".to_string(),
            installation_generation: 1,
            search_environment_generation: 1,
            executable_path: executable.to_string_lossy().to_string(),
            auth_scope: "default".to_string(),
            reported_version: None,
            executable_fingerprint: "sha256:static".to_string(),
            capabilities: Vec::new(),
            protocol_version: "acp-v1".to_string(),
            model: ResolvedModelSelection {
                source: "runtime_default".to_string(),
                model_id: TRAE_RUNTIME_DEFAULT_MODEL_ID.to_string(),
                options: json!({}),
            },
            permissions: AdapterPermissionConfig {
                adapter_kind: AdapterKind::TraeCnCli,
                schema_version: 1,
                values: json!({"permission_mode": "default"}),
            },
            native_session_compatibility_key: None,
            binding_compatibility_digest: "sha256:binding".to_string(),
            host_config_digest: "sha256:host".to_string(),
            config_digest: "sha256:config".to_string(),
        }
    }

    fn frozen_kiro_runtime() -> FrozenAgentRuntimeConfig {
        FrozenAgentRuntimeConfig {
            adapter_kind: AdapterKind::KiroCli,
            installation_id: "installation-kiro".to_string(),
            installation_generation: 1,
            search_environment_generation: 1,
            executable_path: "/usr/bin/true".to_string(),
            auth_scope: "default".to_string(),
            reported_version: Some("2.16.1".to_string()),
            executable_fingerprint: "sha256:kiro".to_string(),
            capabilities: Vec::new(),
            protocol_version: "acp-v1".to_string(),
            model: ResolvedModelSelection {
                source: "runtime_default".to_string(),
                model_id: "kiro-cli://runtime-default".to_string(),
                options: json!({}),
            },
            permissions: AdapterPermissionConfig {
                adapter_kind: AdapterKind::KiroCli,
                schema_version: 1,
                values: json!({"trust_all_tools": "on"}),
            },
            native_session_compatibility_key: Some("kiro-cli:acp-v1".to_string()),
            binding_compatibility_digest: "sha256:binding".to_string(),
            host_config_digest: "sha256:host".to_string(),
            config_digest: "sha256:config".to_string(),
        }
    }

    #[test]
    fn kiro_effective_launch_trusts_all_only_for_non_legacy_read_only_runs() {
        let root = std::env::temp_dir().join(format!("rovai-kiro-launch-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let runtime = frozen_kiro_runtime();
        let configure = |workspace: &AgentRunWorkspace| {
            let mut command = Command::new("/usr/bin/true");
            configure_runtime_command(
                &mut command,
                workspace,
                PermissionSemantics::CoreEnforcedV1,
                &runtime,
                true,
                &BTreeMap::new(),
                &root,
                Some(&root),
                None,
            )
            .unwrap();
            command
                .as_std()
                .get_args()
                .map(|value| value.to_string_lossy().to_string())
                .collect::<Vec<_>>()
        };
        let writable = AgentRunWorkspace::runtime_managed_path(root.to_string_lossy().to_string());
        let mut read_only = writable.clone();
        read_only.access = "read_only".to_string();

        assert!(
            configure(&writable)
                .iter()
                .any(|arg| arg == "--trust-all-tools")
        );
        assert!(
            !configure(&read_only)
                .iter()
                .any(|arg| arg == "--trust-all-tools")
        );

        std::fs::remove_dir_all(root).unwrap();
    }

    async fn receive_through_prompt_completion(
        receiver: &mut mpsc::UnboundedReceiver<AcpIncoming>,
    ) {
        loop {
            let incoming = receiver.recv().await.expect("ACP Host stopped early");
            if matches!(
                incoming,
                AcpIncoming::Message { ref message, .. }
                    if message.get("method").and_then(Value::as_str)
                        == Some("rovai/acp_prompt_completed")
            ) {
                return;
            }
        }
    }

    #[tokio::test]
    async fn trae_agent_execution_starts_one_session_process_without_a_diagnostic_child() {
        let root =
            std::env::temp_dir().join(format!("rovai-trae-agent-process-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let executable = root.join("traecli");
        let invocation_log = root.join("invocations");
        make_executable(
            &executable,
            &format!(
                r#"#!/bin/sh
printf '%s\n' "$*" >> '{}'
IFS= read -r initialize || exit 1
printf '%s\n' '{{"jsonrpc":"2.0","id":1,"result":{{"protocolVersion":1,"agentCapabilities":{{"loadSession":true}}}}}}'
IFS= read -r session || exit 1
printf '%s\n' '{{"jsonrpc":"2.0","id":2,"result":{{"sessionId":"session-real","models":{{"currentModelId":"trae-default","availableModels":[{{"modelId":"trae-default","name":"TRAE Default"}}]}},"configOptions":[{{"id":"model","currentValue":"trae-default","options":[{{"value":"trae-default","name":"TRAE Default"}}]}}],"modes":{{"currentModeId":"default","availableModes":[{{"id":"default","name":"Default"}}]}}}}}}'
while IFS= read -r ignored; do :; done
"#,
                invocation_log.display()
            ),
        );

        let frozen = frozen_trae_runtime(&executable);
        let workspace = AgentRunWorkspace::runtime_managed_path(root.to_string_lossy().to_string());
        let (incoming, _receiver) = mpsc::unbounded_channel();
        let host = AcpHost::spawn(
            &root,
            &workspace,
            PermissionSemantics::RuntimeManagedV2,
            &frozen,
            incoming,
            None,
            CompactionDetectorPolicy::Disabled,
            true,
            &BTreeMap::new(),
            &root.join("private"),
            None,
        )
        .await
        .unwrap();
        let runtime = AcpRuntime::from_host(
            AcpRuntimeOwner {
                agent_run_id: "agent-run-trae".to_string(),
                execution_epoch: 1,
            },
            host.clone(),
            "sha256:compatibility".to_string(),
            "sha256:mcp".to_string(),
            root.clone(),
            Some(exact_attachment_root(&root)),
            "runtime_managed".to_string(),
        );
        let session_id = runtime
            .start_or_resume_session(
                None,
                AcpSessionCapabilities::default(),
                "runtime_default",
                TRAE_RUNTIME_DEFAULT_MODEL_ID,
                &json!({}),
                &BTreeMap::new(),
            )
            .await
            .unwrap();
        assert_eq!(session_id, "session-real");
        let (initialize, session) = runtime.verification_evidence().await.unwrap();
        assert_eq!(initialize["protocolVersion"], 1);
        assert_eq!(session["sessionId"], "session-real");
        host.shutdown().await;

        let invocations = std::fs::read_to_string(&invocation_log).unwrap();
        assert_eq!(invocations.lines().count(), 1);
        assert_eq!(invocations.trim(), "acp serve --permission-mode default");
        assert!(!invocations.contains("--version"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn real_acp_session_catalog_rejects_a_missing_explicit_model_without_fallback() {
        let root = std::env::temp_dir().join(format!(
            "rovai-acp-live-model-validation-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let executable = root.join("traecli");
        make_executable(
            &executable,
            r#"#!/bin/sh
IFS= read -r initialize || exit 1
printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentCapabilities":{}}}'
IFS= read -r session || exit 1
printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"sessionId":"session-live-model","models":{"currentModelId":"trae-default","availableModels":[{"modelId":"trae-default","name":"TRAE Default"}]}}}'
while IFS= read -r ignored; do :; done
"#,
        );
        let frozen = frozen_trae_runtime(&executable);
        let workspace = AgentRunWorkspace::runtime_managed_path(root.to_string_lossy().to_string());
        let (incoming, _receiver) = mpsc::unbounded_channel();
        let host = AcpHost::spawn(
            &root,
            &workspace,
            PermissionSemantics::RuntimeManagedV2,
            &frozen,
            incoming,
            None,
            CompactionDetectorPolicy::Disabled,
            true,
            &BTreeMap::new(),
            &root.join("private"),
            None,
        )
        .await
        .unwrap();
        let runtime = AcpRuntime::from_host(
            AcpRuntimeOwner {
                agent_run_id: "run-live-model-validation".to_string(),
                execution_epoch: 1,
            },
            host.clone(),
            "sha256:compatibility".to_string(),
            "sha256:mcp".to_string(),
            root.clone(),
            Some(exact_attachment_root(&root)),
            "runtime_managed".to_string(),
        );

        let error = runtime
            .start_or_resume_session(
                None,
                AcpSessionCapabilities::default(),
                "explicit",
                "claude-opus-5",
                &json!({}),
                &BTreeMap::new(),
            )
            .await
            .expect_err("a model absent from the real Session catalog must fail closed");
        let validation = error
            .downcast_ref::<AcpLiveModelValidationError>()
            .expect("the launch layer needs a typed model failure");
        assert_eq!(validation.code, "runtime_model_unavailable");

        host.shutdown().await;
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn history_restore_replay_is_quarantined_and_prompt_response_is_the_only_ack() {
        let root = std::env::temp_dir().join(format!(
            "rovai-acp-resume-quarantine-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let executable = root.join("traecli");
        let protocol_log = root.join("protocol.jsonl");
        make_executable(
            &executable,
            &format!(
                r#"#!/bin/sh
IFS= read -r initialize || exit 1
printf '%s\n' "$initialize" >> '{}'
printf '%s\n' '{{"jsonrpc":"2.0","id":1,"result":{{"protocolVersion":1,"agentCapabilities":{{"loadSession":true,"sessionCapabilities":{{"resume":{{}}}}}}}}}}'
IFS= read -r resume || exit 1
printf '%s\n' "$resume" >> '{}'
printf '%s\n' '{{"jsonrpc":"2.0","method":"session/update","params":{{"sessionId":"session-old","update":{{"sessionUpdate":"agent_message_chunk","content":{{"type":"text","text":"historical"}}}}}}}}'
printf '%s\n' '{{"jsonrpc":"2.0","method":"session/update","params":{{"sessionId":"session-old","update":{{"sessionUpdate":"tool_call","toolCallId":"historical-tool","kind":"execute","title":"historical"}}}}}}'
printf '%s\n' '{{"jsonrpc":"2.0","method":"session/update","params":{{"sessionId":"session-old","update":{{"sessionUpdate":"usage_update","used":999}}}}}}'
printf '%s\n' '{{"jsonrpc":"2.0","id":90,"method":"session/request_permission","params":{{"sessionId":"session-old","toolCall":{{"toolCallId":"historical-tool"}},"options":[]}}}}'
IFS= read -r quarantined_permission || exit 1
printf '%s\n' '{{"jsonrpc":"2.0","id":2,"result":{{}}}}'
IFS= read -r prompt || exit 1
printf '%s\n' "$prompt" >> '{}'
printf '%s\n' '{{"jsonrpc":"2.0","method":"session/update","params":{{"sessionId":"session-old","update":{{"sessionUpdate":"agent_message_chunk","content":{{"type":"text","text":"current"}}}}}}}}'
printf '%s\n' '{{"jsonrpc":"2.0","id":3,"result":{{"stopReason":"end_turn"}}}}'
while IFS= read -r ignored; do :; done
"#,
                protocol_log.display(),
                protocol_log.display(),
                protocol_log.display(),
            ),
        );

        let frozen = frozen_trae_runtime(&executable);
        let workspace = AgentRunWorkspace::runtime_managed_path(root.to_string_lossy().to_string());
        let (incoming, mut receiver) = mpsc::unbounded_channel();
        let host = AcpHost::spawn(
            &root,
            &workspace,
            PermissionSemantics::RuntimeManagedV2,
            &frozen,
            incoming,
            None,
            CompactionDetectorPolicy::Disabled,
            true,
            &BTreeMap::new(),
            &root.join("private"),
            None,
        )
        .await
        .unwrap();
        let runtime = AcpRuntime::from_host(
            AcpRuntimeOwner {
                agent_run_id: "agent-run-resume".to_string(),
                execution_epoch: 1,
            },
            host.clone(),
            "sha256:compatibility".to_string(),
            "sha256:mcp".to_string(),
            root.clone(),
            Some(exact_attachment_root(&root)),
            "runtime_managed".to_string(),
        );
        let session_id = runtime
            .start_or_resume_session(
                Some("session-old"),
                AcpSessionCapabilities {
                    can_resume: false,
                    can_load_history: true,
                },
                "runtime_default",
                TRAE_RUNTIME_DEFAULT_MODEL_ID,
                &json!({}),
                &BTreeMap::new(),
            )
            .await
            .unwrap();
        assert_eq!(session_id, "session-old");
        assert!(receiver.try_recv().is_err());

        let prompt_id = runtime
            .start_prompt("delivery-current", "continue")
            .await
            .unwrap();
        let first = receiver
            .recv()
            .await
            .expect("current prompt update missing");
        assert!(matches!(
            first,
            AcpIncoming::Message {
                native_session_id,
                native_prompt_id,
                delivery_id,
                sequence: 1,
                message,
                ..
            } if native_session_id == "session-old"
                && native_prompt_id == prompt_id
                && delivery_id == "delivery-current"
                && message.pointer("/params/update/content/text").and_then(Value::as_str)
                    == Some("current")
        ));
        assert!(matches!(
            receiver.recv().await,
            Some(AcpIncoming::InputAccepted {
                native_session_id,
                native_prompt_id,
                delivery_id,
                ..
            }) if native_session_id == "session-old"
                && native_prompt_id == prompt_id
                && delivery_id == "delivery-current"
        ));
        assert!(matches!(
            receiver.recv().await,
            Some(AcpIncoming::Message {
                sequence: 2,
                message,
                ..
            }) if message.get("method").and_then(Value::as_str)
                == Some("rovai/acp_prompt_completed")
        ));
        host.shutdown().await;

        let protocol = std::fs::read_to_string(&protocol_log).unwrap();
        assert!(protocol.contains("\"method\":\"session/load\""));
        assert!(!protocol.contains("\"method\":\"session/resume\""));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn history_restore_protocol_anomalies_fail_closed() {
        for (case_name, restore_response, expected_error) in [
            ("invalid-json", "not-json-history", "invalid protocol JSON"),
            (
                "different-session-id",
                r#"{"jsonrpc":"2.0","id":2,"result":{"sessionId":"session-other"}}"#,
                "different Session ID",
            ),
        ] {
            let root = std::env::temp_dir().join(format!(
                "rovai-acp-history-restore-{case_name}-{}",
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&root).unwrap();
            let executable = root.join("traecli");
            let script = r#"#!/bin/sh
IFS= read -r initialize || exit 1
printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true}}}'
IFS= read -r load || exit 1
printf '%s\n' '__RESTORE_RESPONSE__'
while IFS= read -r ignored; do :; done
"#
            .replace("__RESTORE_RESPONSE__", restore_response);
            make_executable(&executable, &script);

            let frozen = frozen_trae_runtime(&executable);
            let workspace =
                AgentRunWorkspace::runtime_managed_path(root.to_string_lossy().to_string());
            let (incoming, mut receiver) = mpsc::unbounded_channel();
            let host = AcpHost::spawn(
                &root,
                &workspace,
                PermissionSemantics::RuntimeManagedV2,
                &frozen,
                incoming,
                None,
                CompactionDetectorPolicy::Disabled,
                true,
                &BTreeMap::new(),
                &root.join("private"),
                None,
            )
            .await
            .unwrap();
            let runtime = AcpRuntime::from_host(
                AcpRuntimeOwner {
                    agent_run_id: format!("agent-run-history-anomaly-{case_name}"),
                    execution_epoch: 1,
                },
                host.clone(),
                "sha256:compatibility".to_string(),
                "sha256:mcp".to_string(),
                root.clone(),
                Some(exact_attachment_root(&root)),
                "runtime_managed".to_string(),
            );
            let error = runtime
                .start_or_resume_session(
                    Some("session-old"),
                    AcpSessionCapabilities {
                        can_resume: false,
                        can_load_history: true,
                    },
                    "runtime_default",
                    TRAE_RUNTIME_DEFAULT_MODEL_ID,
                    &json!({}),
                    &BTreeMap::new(),
                )
                .await
                .unwrap_err();
            assert!(
                format!("{error:#}").contains(expected_error),
                "unexpected {case_name} error: {error:#}"
            );
            assert!(host.protocol_violated.load(Ordering::Acquire));
            assert!(receiver.try_recv().is_err());
            assert!(runtime.session_id().await.is_none());
            assert!(runtime.verification_evidence().await.is_none());
            assert!(!host.knows_session("session-old").await);
            assert!(!host.knows_session("session-other").await);
            {
                let routes = host.routes.read().await;
                assert!(!routes.contains_key("session-other"));
                assert!(routes.keys().all(|session_id| session_id == "session-old"));
                if case_name == "different-session-id" {
                    assert!(matches!(
                        routes.get("session-old").map(|route| &route.phase),
                        Some(AcpSessionPhase::ProtocolViolated { .. })
                    ));
                }
            }
            host.shutdown().await;
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[tokio::test]
    async fn trae_completed_run_enters_lru_and_reuses_the_same_host_session() {
        let root =
            std::env::temp_dir().join(format!("rovai-trae-warm-lru-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let executable = root.join("traecli");
        let protocol_log = root.join("protocol.jsonl");
        let invocation_log = root.join("invocations");
        make_executable(
            &executable,
            &format!(
                r#"#!/bin/sh
printf '%s\n' "$*" >> '{}'
IFS= read -r initialize || exit 1
printf '%s\n' "$initialize" >> '{}'
printf '%s\n' '{{"jsonrpc":"2.0","id":1,"result":{{"protocolVersion":1,"agentCapabilities":{{"loadSession":true}}}}}}'
IFS= read -r session || exit 1
printf '%s\n' "$session" >> '{}'
printf '%s\n' '{{"jsonrpc":"2.0","id":2,"result":{{"sessionId":"session-warm","configOptions":[{{"id":"model","currentValue":"trae-default","options":[{{"value":"trae-default","name":"TRAE Default"}}]}}],"modes":{{"currentModeId":"default","availableModes":[{{"id":"default","name":"Default"}}]}}}}}}'
IFS= read -r prompt_one || exit 1
printf '%s\n' "$prompt_one" >> '{}'
printf '%s\n' '{{"jsonrpc":"2.0","method":"session/update","params":{{"sessionId":"session-warm","update":{{"sessionUpdate":"agent_message_chunk","content":{{"type":"text","text":"one"}}}}}}}}'
printf '%s\n' '{{"jsonrpc":"2.0","id":3,"result":{{"stopReason":"end_turn"}}}}'
IFS= read -r prompt_two || exit 1
printf '%s\n' "$prompt_two" >> '{}'
printf '%s\n' '{{"jsonrpc":"2.0","method":"session/update","params":{{"sessionId":"session-warm","update":{{"sessionUpdate":"agent_message_chunk","content":{{"type":"text","text":"two"}}}}}}}}'
printf '%s\n' '{{"jsonrpc":"2.0","id":4,"result":{{"stopReason":"end_turn"}}}}'
while IFS= read -r ignored; do :; done
"#,
                invocation_log.display(),
                protocol_log.display(),
                protocol_log.display(),
                protocol_log.display(),
                protocol_log.display(),
            ),
        );
        let cli = root.join("rovai");
        make_executable(&cli, "#!/bin/sh\nexit 0\n");
        let endpoint = rovai_core::builtin_tool_transport::LocalIpcEndpoint::UnixSocket {
            path: root.join("core.sock").to_string_lossy().into_owned(),
        };
        let builtin_tools =
            BuiltinToolProcessConfig::create(&cli, &endpoint, &root.join("runtime")).unwrap();
        let frozen = frozen_trae_runtime(&executable);
        let workspace = AgentRunWorkspace::runtime_managed_path(root.to_string_lossy().to_string());
        let attachment_root = root.join("attachments");
        std::fs::create_dir_all(&attachment_root).unwrap();
        let (incoming, mut receiver) = mpsc::unbounded_channel();
        let fleet = Arc::new(AgentRuntimeFleetManager::new(
            AgentRuntimeFleetConfig::default(),
        ));
        let adapter = AcpCliRuntimeAdapter::new(
            AdapterKind::TraeCnCli,
            incoming,
            root.join("private"),
            fleet.clone(),
            CompactionDetectorPolicy::Disabled,
        )
        .unwrap();

        let first = adapter
            .ensure_agent_run_runtime(
                "agent-run-one",
                1,
                "camp-one",
                "agent-one",
                &workspace,
                PermissionSemantics::RuntimeManagedV2,
                &frozen,
                &builtin_tools,
                &BTreeMap::new(),
                "sha256:mcp",
                &attachment_root,
                "sha256:compatibility",
            )
            .await
            .unwrap();
        let first_host = first.host_instance_id().to_string();
        let session_id = first
            .start_or_resume_session(
                None,
                AcpSessionCapabilities {
                    can_resume: false,
                    can_load_history: true,
                },
                "runtime_default",
                TRAE_RUNTIME_DEFAULT_MODEL_ID,
                &json!({}),
                &BTreeMap::new(),
            )
            .await
            .unwrap();
        first.start_prompt("delivery-one", "one").await.unwrap();
        receive_through_prompt_completion(&mut receiver).await;
        adapter.complete_agent_run("agent-run-one", 1).await;

        let second = adapter
            .ensure_agent_run_runtime(
                "agent-run-two",
                1,
                "camp-one",
                "agent-one",
                &workspace,
                PermissionSemantics::RuntimeManagedV2,
                &frozen,
                &builtin_tools,
                &BTreeMap::new(),
                "sha256:mcp",
                &attachment_root,
                "sha256:compatibility",
            )
            .await
            .unwrap();
        assert_eq!(second.host_instance_id(), first_host);
        let successor_session = second
            .start_or_resume_session(
                Some(&session_id),
                AcpSessionCapabilities {
                    can_resume: false,
                    can_load_history: true,
                },
                "runtime_default",
                TRAE_RUNTIME_DEFAULT_MODEL_ID,
                &json!({}),
                &BTreeMap::new(),
            )
            .await
            .unwrap();
        assert_eq!(successor_session, session_id);
        assert!(second.verification_evidence().await.is_some());
        second.start_prompt("delivery-two", "two").await.unwrap();
        receive_through_prompt_completion(&mut receiver).await;
        adapter.complete_agent_run("agent-run-two", 1).await;
        fleet.shutdown_all().await;

        let invocations = std::fs::read_to_string(&invocation_log).unwrap();
        assert_eq!(invocations.lines().count(), 1);
        let protocol = std::fs::read_to_string(&protocol_log).unwrap();
        assert_eq!(protocol.matches("\"method\":\"session/new\"").count(), 1);
        assert_eq!(protocol.matches("\"method\":\"session/prompt\"").count(), 2);
        assert!(!protocol.contains("\"method\":\"session/load\""));
        assert!(!protocol.contains("\"method\":\"session/resume\""));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn completed_run_disposition_preserves_adapter_reuse_evidence() {
        assert_eq!(
            completed_run_release_disposition(AdapterKind::KiroCli),
            FleetReleaseDisposition::Stop
        );
        for adapter_kind in [
            AdapterKind::OpencodeCli,
            AdapterKind::CopilotCli,
            AdapterKind::QoderCli,
            AdapterKind::CodebuddyCli,
            AdapterKind::QwenCode,
            AdapterKind::TraeCnCli,
        ] {
            assert_eq!(
                completed_run_release_disposition(adapter_kind),
                FleetReleaseDisposition::Reusable,
                "{} should retain normal warm-Host reuse",
                adapter_kind.as_str()
            );
        }
    }

    #[test]
    fn recovery_collector_uses_the_latest_identified_assistant_message() {
        let mut collector = AcpMissingSendRecoveryCollector::default();
        collector.observe_assistant_chunk(Some("message-1"), "draft ");
        collector.observe_assistant_chunk(Some("message-1"), "continued");
        assert_eq!(collector.candidate().as_deref(), Some("draft continued"));

        collector.observe_assistant_chunk(Some("message-2"), "final ");
        collector.observe_assistant_chunk(Some("message-2"), "answer");
        assert_eq!(collector.candidate().as_deref(), Some("final answer"));
    }

    #[test]
    fn recovery_collector_accepts_anonymous_suffix_but_fails_closed_on_identity_mix() {
        let mut collector = AcpMissingSendRecoveryCollector::default();
        collector.observe_assistant_chunk(None, "anonymous ");
        collector.observe_assistant_chunk(None, "suffix");
        assert_eq!(collector.candidate().as_deref(), Some("anonymous suffix"));

        collector.observe_assistant_chunk(Some("message-1"), "identified");
        assert!(collector.candidate().is_none());
        collector.observe_assistant_chunk(Some("message-2"), "still ambiguous");
        assert!(collector.candidate().is_none());
    }

    #[test]
    fn recovery_collector_exposes_only_assistant_text_after_the_last_tool_activity() {
        let mut collector = AcpMissingSendRecoveryCollector::default();
        collector.observe_assistant_chunk(Some("message-1"), "before tool");
        collector.observe_tool_activity();
        assert!(collector.candidate().is_none());

        collector.observe_assistant_chunk(Some("message-2"), "after tool final");
        assert_eq!(collector.candidate().as_deref(), Some("after tool final"));

        collector.observe_tool_activity();
        assert!(collector.candidate().is_none());
        collector.observe_assistant_chunk(None, "fresh anonymous final");
        assert_eq!(
            collector.candidate().as_deref(),
            Some("fresh anonymous final")
        );
    }

    #[test]
    fn acp_compaction_detectors_admit_only_runtime_completion_signals() {
        assert!(
            detect_acp_compaction_signal(
                AdapterKind::OpencodeCli,
                &json!({
                    "method": "session.compacted",
                    "params": {"sessionId": "session-1"}
                }),
            )
            .is_none(),
            "OpenCode's ACP server does not expose its native event stream; the isolated Runtime plugin owns this signal"
        );

        let kiro = detect_acp_compaction_signal(
            AdapterKind::KiroCli,
            &json!({
                "method": "_kiro.dev/compaction/status",
                "params": {
                    "sessionId": "session-2",
                    "status": {"type": "completed"},
                    "summary": "must not participate in signal admission"
                }
            }),
        )
        .expect("Kiro completed status should be detected");
        assert_eq!(kiro.admission_point, "completed");
        assert!(
            detect_acp_compaction_signal(
                AdapterKind::KiroCli,
                &json!({
                    "method": "_kiro.dev/compaction/status",
                    "params": {"sessionId": "session-2", "status": {"type": "started"}}
                }),
            )
            .is_none()
        );
    }

    #[test]
    fn qwen_detector_settings_preserve_existing_user_hooks() {
        let mut settings = json!({
            "managed": true,
            "hooks": {
                "PreToolUse": [{"matcher": "write_file", "hooks": []}],
                "PostCompact": [{"matcher": "manual", "hooks": []}]
            }
        });
        append_post_compact_hook(&mut settings, "'/private/rovai' __compaction-hook")
            .expect("Rovai hook should append");
        assert_eq!(settings["managed"], true);
        assert_eq!(settings["hooks"]["PreToolUse"].as_array().unwrap().len(), 1);
        assert_eq!(
            settings["hooks"]["PostCompact"].as_array().unwrap().len(),
            2
        );
        assert_eq!(
            settings["hooks"]["PostCompact"][1]["hooks"][0]["async"],
            false
        );
        assert_eq!(settings["hooks"]["PostCompact"][1]["matcher"], "*");
    }

    #[test]
    fn hook_matcher_follows_runtime_lifecycle_contract() {
        let qoder = qoder_post_compact_hook_settings("rovai hook");
        assert_eq!(qoder["hooks"]["PostCompact"][0]["matcher"], "manual|auto");
        let codebuddy = codebuddy_compaction_hook_settings("rovai hook");
        assert_eq!(codebuddy["hooks"]["SessionStart"][0]["matcher"], "compact");
    }

    #[test]
    fn opencode_detector_plugin_is_additive_to_runtime_config() {
        let mut config = json!({
            "autoupdate": false,
            "permission": {"*": "ask"},
            "plugin": ["existing-plugin"]
        });
        append_opencode_compaction_plugin(
            &mut config,
            Path::new("/private/rovai/opencode-compaction-observer.ts"),
        )
        .expect("OpenCode detector plugin should append");
        assert_eq!(config["autoupdate"], false);
        assert_eq!(config["permission"]["*"], "ask");
        assert_eq!(config["plugin"][0], "existing-plugin");
        assert_eq!(
            config["plugin"][1],
            "/private/rovai/opencode-compaction-observer.ts"
        );
    }

    #[test]
    fn hook_relay_command_quotes_shell_metacharacters() {
        assert_eq!(
            quote_posix_shell_word("/tmp/Rovai's CLI"),
            "'/tmp/Rovai'\"'\"'s CLI'"
        );
    }

    #[test]
    fn every_acp_session_receives_the_exact_enumerable_camp_attachment_root() {
        let root = Path::new("/tmp/rovai-camp-attachments/camp-id");
        assert_eq!(
            session_additional_directories(Some(root)).unwrap(),
            vec![root.to_string_lossy().into_owned()]
        );
        assert!(
            session_additional_directories(None)
                .unwrap_err()
                .to_string()
                .contains("camp_attachment_view_runtime_unsupported")
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

    #[test]
    fn continuation_prefers_same_host_then_resume_then_history_restore() {
        let load_only = AcpSessionCapabilities {
            can_resume: false,
            can_load_history: true,
        };
        let resume_and_load = AcpSessionCapabilities {
            can_resume: true,
            can_load_history: true,
        };

        assert_eq!(
            select_acp_session_continuation(
                AdapterKind::TraeCnCli,
                true,
                Some("session-1"),
                load_only,
            ),
            AcpSessionContinuation::ReuseSameHost
        );
        assert_eq!(
            select_acp_session_continuation(
                AdapterKind::TraeCnCli,
                false,
                Some("session-1"),
                resume_and_load,
            ),
            AcpSessionContinuation::Resume
        );
        assert_eq!(
            select_acp_session_continuation(
                AdapterKind::TraeCnCli,
                false,
                Some("session-1"),
                load_only,
            ),
            AcpSessionContinuation::HistoryRestore
        );
        assert_eq!(
            select_acp_session_continuation(
                AdapterKind::CopilotCli,
                false,
                Some("session-1"),
                load_only,
            ),
            AcpSessionContinuation::HistoryRestore
        );
        assert_eq!(
            select_acp_session_continuation(AdapterKind::TraeCnCli, false, None, resume_and_load,),
            AcpSessionContinuation::New
        );
    }

    #[test]
    fn history_restore_budget_rejects_events_bytes_and_elapsed_time_independently() {
        assert!(
            replay_budget_violation(
                ACP_HISTORY_RESTORE_MAX_EVENTS,
                ACP_HISTORY_RESTORE_MAX_BYTES,
                ACP_HISTORY_RESTORE_TIMEOUT,
            )
            .is_none()
        );
        assert_eq!(
            replay_budget_violation(
                ACP_HISTORY_RESTORE_MAX_EVENTS + 1,
                ACP_HISTORY_RESTORE_MAX_BYTES,
                Duration::ZERO,
            ),
            Some("ACP History Restore exceeded its replay event limit")
        );
        assert_eq!(
            replay_budget_violation(1, ACP_HISTORY_RESTORE_MAX_BYTES + 1, Duration::ZERO,),
            Some("ACP History Restore exceeded its replay byte limit")
        );
        assert_eq!(
            replay_budget_violation(1, 1, ACP_HISTORY_RESTORE_TIMEOUT + Duration::from_nanos(1),),
            Some("ACP History Restore exceeded its replay time limit")
        );
    }

    #[test]
    fn trae_warm_compatibility_ignores_live_snapshot_upgrade_but_not_host_inputs() {
        let root =
            std::env::temp_dir().join(format!("rovai-trae-compatibility-{}", uuid::Uuid::new_v4()));
        let attachments = root.join("attachments");
        std::fs::create_dir_all(&attachments).unwrap();
        let attachment_authorization = CampAttachmentRuntimeAuthorization {
            camp_id: "rvcamp_01h47kvsy5fk1shh6w1g60eecf".to_string(),
            attachment_root: attachments,
            root_identity_digest: "sha256:root".to_string(),
            generation: 1,
            catalog_digest: "sha256:catalog".to_string(),
            visibility_mode:
                rovai_core::camp_attachment_view::CampAttachmentVisibilityMode::GenerationFencedV1,
        };
        let executable = root.join("traecli");
        make_executable(&executable, "#!/bin/sh\nexit 0\n");
        let workspace = AgentRunWorkspace::runtime_managed_path(root.to_string_lossy().to_string());
        let frozen = frozen_trae_runtime(&executable);
        let first = runtime_compatibility_digest(
            &frozen,
            &workspace,
            PermissionSemantics::RuntimeManagedV2,
            &BTreeMap::new(),
            "sha256:mcp",
            &attachment_authorization,
        )
        .unwrap();

        let mut upgraded = frozen.clone();
        upgraded.reported_version = Some("0.120.52".to_string());
        upgraded.capabilities = vec!["session.load".to_string(), "session.new".to_string()];
        upgraded.model.model_id = "GLM-5.2".to_string();
        upgraded.config_digest = "sha256:ready-snapshot".to_string();
        let ready = runtime_compatibility_digest(
            &upgraded,
            &workspace,
            PermissionSemantics::RuntimeManagedV2,
            &BTreeMap::new(),
            "sha256:mcp",
            &attachment_authorization,
        )
        .unwrap();
        assert_eq!(ready, first);

        let run_local_mcp_projection = runtime_compatibility_digest(
            &upgraded,
            &workspace,
            PermissionSemantics::RuntimeManagedV2,
            &BTreeMap::new(),
            "sha256:another-run-local-mcp-projection",
            &attachment_authorization,
        )
        .unwrap();
        assert_eq!(run_local_mcp_projection, first);

        let mut changed_servers = BTreeMap::new();
        changed_servers.insert(
            "fixture".to_string(),
            McpServerDefinition::StreamableHttp {
                url: "https://mcp.invalid/example".to_string(),
                headers: BTreeMap::new(),
            },
        );
        let changed_mcp = runtime_compatibility_digest(
            &upgraded,
            &workspace,
            PermissionSemantics::RuntimeManagedV2,
            &changed_servers,
            "sha256:another-run-local-mcp-projection",
            &attachment_authorization,
        )
        .unwrap();
        assert_ne!(changed_mcp, first);

        upgraded.host_config_digest = "sha256:changed-host-input".to_string();
        let changed_host = runtime_compatibility_digest(
            &upgraded,
            &workspace,
            PermissionSemantics::RuntimeManagedV2,
            &BTreeMap::new(),
            "sha256:mcp",
            &attachment_authorization,
        )
        .unwrap();
        assert_ne!(changed_host, first);

        let history_key = freeze_history_restore_compatibility(frozen.clone(), &workspace)
            .unwrap()
            .native_session_compatibility_key
            .unwrap();
        let same_history_key = freeze_history_restore_compatibility(frozen.clone(), &workspace)
            .unwrap()
            .native_session_compatibility_key
            .unwrap();
        assert_eq!(same_history_key, history_key);

        let other_root = root.join("other-workspace");
        std::fs::create_dir_all(&other_root).unwrap();
        let other_workspace =
            AgentRunWorkspace::runtime_managed_path(other_root.to_string_lossy().to_string());
        let other_workspace_key =
            freeze_history_restore_compatibility(frozen.clone(), &other_workspace)
                .unwrap()
                .native_session_compatibility_key
                .unwrap();
        assert_ne!(other_workspace_key, history_key);

        let mut changed_model = frozen.clone();
        changed_model.model.model_id = "another-model".to_string();
        let changed_model_key = freeze_history_restore_compatibility(changed_model, &workspace)
            .unwrap()
            .native_session_compatibility_key
            .unwrap();
        assert_ne!(changed_model_key, history_key);

        let mut changed_permissions = frozen.clone();
        changed_permissions.permissions.values = json!({"permission_mode": "plan"});
        let changed_permissions_key =
            freeze_history_restore_compatibility(changed_permissions, &workspace)
                .unwrap()
                .native_session_compatibility_key
                .unwrap();
        assert_ne!(changed_permissions_key, history_key);

        let mut changed_executable = frozen;
        changed_executable.executable_fingerprint = "sha256:changed".to_string();
        let changed_executable_key =
            freeze_history_restore_compatibility(changed_executable, &workspace)
                .unwrap()
                .native_session_compatibility_key
                .unwrap();
        assert_ne!(changed_executable_key, history_key);
        std::fs::remove_dir_all(root).unwrap();
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
