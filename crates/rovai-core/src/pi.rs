use std::{
    collections::HashMap,
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
    runtime_discovery::configure_active_runtime_command,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::{Mutex, RwLock, mpsc, oneshot},
    time::timeout,
};
use url::Url;

use crate::{
    acp::CompletedAcpAction,
    builtin_tool_runtime::BuiltinToolProcessConfig,
    runtime_fleet::{
        AgentRuntimeFleetManager, FleetAcquireRequest, FleetReleaseDisposition,
        RuntimeCompatibilityKey, RuntimeProcessHost,
    },
};

pub(crate) const PI_PROTOCOL_VERSION: &str = "pi-jsonl-rpc-v1";
pub(crate) const PI_PROVIDER_ID: &str = "rovai-claude-minimax";
pub(crate) const PI_APPROVAL_EXTENSION_VERSION: &str = "rovai-pi-approval-v1";
const PI_APPROVAL_SCHEMA_VERSION: i64 = 1;
const PI_MAX_JSONL_RECORD_BYTES: usize = 4 * 1024 * 1024;
const PI_COMMAND_TIMEOUT: Duration = Duration::from_secs(45);

const MANAGED_APPROVAL_EXTENSION: &str = r#"
export default function (pi: any) {
  const schemaVersion = 1;
  const extensionVersion = "rovai-pi-approval-v1";
  const announce = (_event: any, ctx: any) => {
    ctx.ui.setStatus("rovai-managed-approval", extensionVersion);
  };
  pi.on("session_start", announce);
  pi.on("before_agent_start", announce);
  pi.on("tool_call", async (event: any, ctx: any) => {
    if (["read", "grep", "find", "ls"].includes(event.toolName)) return undefined;
    if (!["bash", "write", "edit"].includes(event.toolName)) {
      return { block: true, reason: "Rovai managed approval blocks unknown mutating tools" };
    }
    if (!ctx.hasUI || ctx.mode !== "rpc") {
      return { block: true, reason: "Rovai managed approval requires the RPC UI bridge" };
    }
    const request = JSON.stringify({
      schemaVersion,
      extensionVersion,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      input: event.input,
    });
    const allowed = await ctx.ui.confirm("Rovai managed approval", request);
    if (!allowed) return { block: true, reason: "Blocked by Rovai approval" };
    return undefined;
  });
}
"#;

#[derive(Clone)]
pub(crate) struct PiProviderConfig {
    token: String,
    base_url: String,
    model_id: String,
    compatibility_key: String,
}

impl PiProviderConfig {
    pub(crate) fn compatibility_key(&self) -> &str {
        &self.compatibility_key
    }

    pub(crate) fn model_fingerprint(&self) -> String {
        short_digest(self.model_id.as_bytes())
    }
}

#[derive(Deserialize)]
struct ClaudeSettings {
    #[serde(default)]
    env: HashMap<String, String>,
}

pub(crate) fn load_claude_minimax_provider() -> Result<PiProviderConfig> {
    let home = dirs::home_dir().context("the local user Home is unavailable")?;
    load_claude_minimax_provider_at(&home.join(".claude/settings.json"))
}

pub(crate) struct PiBehavioralProbe {
    pub provider_compatibility_key: String,
    pub model_fingerprint: String,
    pub capabilities: Vec<String>,
}

pub(crate) async fn behavioral_probe(executable: &Path) -> Result<PiBehavioralProbe> {
    let provider = load_claude_minimax_provider()?;
    let probe_root = std::env::temp_dir().join(format!("rovai-pi-probe-{}", uuid::Uuid::new_v4()));
    let private_runtime_dir = probe_root.join("runtime");
    let session_root = probe_root.join("sessions");
    create_private_directory(&private_runtime_dir)?;
    create_private_directory(&session_root)?;
    let session_id = uuid::Uuid::new_v4().to_string();
    let prompt_id = uuid::Uuid::new_v4().to_string();
    let (incoming, mut receiver) = mpsc::unbounded_channel();
    let host = PiHost::spawn(PiHostLaunch {
        executable,
        cwd: &probe_root,
        private_runtime_dir: &private_runtime_dir,
        session_root: &session_root,
        expected_session_id: &session_id,
        exact_resume: false,
        provider: &provider,
        session_bootstrap: "Rovai Pi capability probe. Follow the user request exactly.",
        skill_paths: &[],
        incoming,
        builtin_tools: None,
    })
    .await?;
    let owner = PiRuntimeOwner {
        agent_run_id: "pi-capability-probe".to_string(),
        execution_epoch: 1,
        native_prompt_id: prompt_id,
        delivery_id: "pi-capability-probe-delivery".to_string(),
    };
    host.bind(owner.clone()).await?;
    let runtime = PiRuntime::from_host(owner, "pi-capability-probe-camp".to_string(), host.clone());
    let result = async {
        runtime
            .start_prompt(
                "Reply with exactly PI_RUNTIME_PROBE_OK and no other text. Do not use tools.",
            )
            .await?;
        timeout(Duration::from_secs(120), async {
            loop {
                match receiver.recv().await {
                    Some(PiIncoming::Message { message, .. }) => {
                        runtime.observe(&message).await?;
                        if message.get("type").and_then(Value::as_str) == Some("agent_settled") {
                            break Ok::<(), anyhow::Error>(());
                        }
                    }
                    Some(PiIncoming::Exited { .. }) | None => {
                        bail!("Pi capability probe Host exited before agent_settled")
                    }
                }
            }
        })
        .await
        .context("Pi capability probe timed out")??;
        let (final_message, stop_reason) = runtime.terminal().await;
        if stop_reason.as_deref() != Some("stop")
            || final_message.as_deref().map(str::trim) != Some("PI_RUNTIME_PROBE_OK")
        {
            bail!("Pi capability probe did not produce the required reliable final boundary");
        }
        if !runtime.approval_handshake_observed() {
            bail!("Pi managed Approval Extension handshake was not observed");
        }
        Ok(PiBehavioralProbe {
            provider_compatibility_key: provider.compatibility_key().to_string(),
            model_fingerprint: runtime.model_fingerprint().to_string(),
            capabilities: vec![
                PI_PROTOCOL_VERSION.to_string(),
                "pi.rpc.prompt".to_string(),
                "pi.rpc.agent_settled".to_string(),
                "pi.rpc.structured_tools".to_string(),
                "pi.rpc.extension_approval".to_string(),
                "conversation.exact_resume".to_string(),
                "process.interrupt".to_string(),
            ],
        })
    }
    .await;
    runtime.detach().await;
    host.shutdown_and_reap().await;
    let _ = std::fs::remove_dir_all(&probe_root);
    result
}

fn load_claude_minimax_provider_at(path: &Path) -> Result<PiProviderConfig> {
    let metadata = std::fs::symlink_metadata(path)
        .with_context(|| "Claude local settings are unavailable for Pi MiniMax")?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        bail!("Claude local settings must be a regular private file");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};

        if metadata.permissions().mode() & 0o077 != 0 {
            bail!("Claude local settings permissions are too broad");
        }
        // A different owner must never be treated as the current user's secret source.
        if metadata.uid() != unsafe { libc::geteuid() } {
            bail!("Claude local settings are owned by another user");
        }
    }
    let document: ClaudeSettings = serde_json::from_slice(
        &std::fs::read(path).context("failed to read Claude local settings")?,
    )
    .context("Claude local settings are not valid JSON")?;
    let value = |key: &str| -> Result<String> {
        document
            .env
            .get(key)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .with_context(|| format!("Claude local settings do not define {key}"))
    };
    let token = value("ANTHROPIC_AUTH_TOKEN")?;
    let base_url = value("ANTHROPIC_BASE_URL")?;
    let model_id = value("ANTHROPIC_MODEL")?;
    let endpoint = Url::parse(&base_url).context("Claude MiniMax endpoint is not a valid URL")?;
    if endpoint.scheme() != "https"
        || endpoint.host_str().is_none()
        || endpoint.username() != ""
        || endpoint.password().is_some()
    {
        bail!("Claude MiniMax endpoint must be an HTTPS URL without embedded credentials");
    }
    let compatibility_key = canonical_json_digest(&json!({
        "provider": PI_PROVIDER_ID,
        "baseUrl": base_url,
        "modelId": model_id,
        "api": "anthropic-messages",
    }))?;
    Ok(PiProviderConfig {
        token,
        base_url,
        model_id,
        compatibility_key,
    })
}

#[derive(Debug)]
pub enum PiIncoming {
    Message {
        host_instance_id: String,
        agent_run_id: String,
        execution_epoch: i64,
        native_session_id: String,
        native_prompt_id: String,
        delivery_id: String,
        sequence: u64,
        message: Value,
    },
    Exited {
        host_instance_id: String,
        agent_run_id: String,
        execution_epoch: i64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PiRuntimeOwner {
    agent_run_id: String,
    execution_epoch: i64,
    native_prompt_id: String,
    delivery_id: String,
}

struct PendingPiCommand {
    sender: oneshot::Sender<std::result::Result<Value, String>>,
}

pub(crate) struct PiHost {
    host_instance_id: String,
    child: Mutex<ManagedProcess>,
    stdin: Mutex<ManagedChildStdin>,
    pending: Mutex<HashMap<String, PendingPiCommand>>,
    next_id: AtomicU64,
    owner: RwLock<Option<PiRuntimeOwner>>,
    incoming: mpsc::UnboundedSender<PiIncoming>,
    alive: AtomicBool,
    streaming: AtomicBool,
    sequence: AtomicU64,
    executable_path: PathBuf,
    builtin_tools: Option<BuiltinToolProcessConfig>,
    config_root: PathBuf,
    session_id: String,
    session_file: RwLock<PathBuf>,
    model_fingerprint: String,
}

struct PiHostLaunch<'a> {
    executable: &'a Path,
    cwd: &'a Path,
    private_runtime_dir: &'a Path,
    session_root: &'a Path,
    expected_session_id: &'a str,
    exact_resume: bool,
    provider: &'a PiProviderConfig,
    session_bootstrap: &'a str,
    skill_paths: &'a [PathBuf],
    incoming: mpsc::UnboundedSender<PiIncoming>,
    builtin_tools: Option<BuiltinToolProcessConfig>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PiSessionLocator {
    schema_version: i64,
    session_id: String,
    session_file: String,
}

impl PiHost {
    async fn spawn(launch: PiHostLaunch<'_>) -> Result<Arc<Self>> {
        create_private_directory(launch.private_runtime_dir)?;
        create_private_directory(launch.session_root)?;
        let host_instance_id = uuid::Uuid::new_v4().to_string();
        let config_root = launch
            .private_runtime_dir
            .join("host-config")
            .join(&host_instance_id);
        create_private_directory(&config_root)?;
        let extension_path = config_root.join("rovai-managed-approval.ts");
        write_private_file(&extension_path, MANAGED_APPROVAL_EXTENSION.as_bytes())?;
        write_private_json(
            &config_root.join("models.json"),
            &json!({
                "providers": {
                    PI_PROVIDER_ID: {
                        "baseUrl": launch.provider.base_url,
                        "api": "anthropic-messages",
                        "apiKey": "$ROVAI_PI_MINIMAX_API_KEY",
                        "models": [{
                            "id": launch.provider.model_id,
                            "name": "Claude local MiniMax",
                            "reasoning": false,
                            "input": ["text"],
                            "contextWindow": 128000,
                            "maxTokens": 16384,
                            "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}
                        }]
                    }
                }
            }),
        )?;

        let mut command = Command::new(launch.executable);
        configure_active_runtime_command(&mut command);
        if let Some(config) = &launch.builtin_tools {
            config.configure_command(&mut command)?;
        }
        command
            .args([
                "--mode",
                "rpc",
                "--provider",
                PI_PROVIDER_ID,
                "--model",
                &launch.provider.model_id,
                "--no-extensions",
                "--no-skills",
                "--no-context-files",
                "--no-prompt-templates",
                "--no-themes",
                "--no-approve",
                "--tools",
                "read,bash,edit,write,grep,find,ls",
                "--extension",
            ])
            .arg(&extension_path)
            .arg("--append-system-prompt")
            .arg(launch.session_bootstrap)
            .env("PI_CODING_AGENT_DIR", &config_root)
            .env("ROVAI_PI_MINIMAX_API_KEY", &launch.provider.token)
            .env("PI_TELEMETRY", "0")
            .current_dir(launch.cwd);
        for skill_path in launch.skill_paths {
            command.arg("--skill").arg(skill_path);
        }
        let expected_resume_file = if launch.exact_resume {
            let locator = read_session_locator(launch.session_root, launch.expected_session_id)?;
            let session_file = PathBuf::from(locator.session_file);
            command.arg("--session").arg(&session_file);
            Some(session_file)
        } else {
            command
                .arg("--session-dir")
                .arg(launch.session_root)
                .arg("--session-id")
                .arg(launch.expected_session_id);
            None
        };
        let spec = ManagedProcessLaunchSpec::capture(
            &command,
            ManagedProcessPurpose::RuntimeHost,
            ManagedStdinPolicy::Piped,
            ManagedWindowsArgvDialect::MicrosoftCrt,
            "runtime-host:pi",
        )?;
        let mut child = ManagedProcess::spawn(spec).context("failed to start Pi RPC Host")?;
        let stdin = child.take_stdin().context("Pi RPC stdin was unavailable")?;
        let stdout = child
            .take_stdout()
            .context("Pi RPC stdout was unavailable")?;
        let stderr = child
            .take_stderr()
            .context("Pi RPC stderr was unavailable")?;
        let host = Arc::new(Self {
            host_instance_id,
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            owner: RwLock::new(None),
            incoming: launch.incoming,
            alive: AtomicBool::new(true),
            streaming: AtomicBool::new(false),
            sequence: AtomicU64::new(0),
            executable_path: launch.executable.to_path_buf(),
            builtin_tools: launch.builtin_tools,
            config_root,
            session_id: launch.expected_session_id.to_string(),
            session_file: RwLock::new(PathBuf::new()),
            model_fingerprint: launch.provider.model_fingerprint(),
        });
        Self::spawn_stdout_reader(host.clone(), stdout);
        Self::spawn_stderr_reader(host.clone(), stderr);
        let state = match host.command("get_state", json!({})).await {
            Ok(state) => state,
            Err(error) => {
                host.shutdown_and_reap().await;
                return Err(error.context("Pi get_state failed during Host startup"));
            }
        };
        let session_file = match validate_host_state(
            &state,
            launch.session_root,
            launch.expected_session_id,
            &launch.provider.model_id,
            expected_resume_file.as_deref(),
        ) {
            Ok(session_file) => session_file,
            Err(error) => {
                host.shutdown_and_reap().await;
                return Err(error);
            }
        };
        *host.session_file.write().await = session_file.clone();
        if let Err(error) = write_session_locator(
            launch.session_root,
            launch.expected_session_id,
            &session_file,
        ) {
            host.shutdown_and_reap().await;
            return Err(error);
        }
        Ok(host)
    }

    fn spawn_stdout_reader(host: Arc<Self>, stdout: ManagedChildStdout) {
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            loop {
                let record = match read_jsonl_record(&mut reader, PI_MAX_JSONL_RECORD_BYTES).await {
                    Ok(Some(record)) => record,
                    Ok(None) => break,
                    Err(_) => break,
                };
                let message = match serde_json::from_slice::<Value>(&record) {
                    Ok(message) if message.is_object() => message,
                    _ => break,
                };
                if message.get("type").and_then(Value::as_str) == Some("response") {
                    let Some(id) = message.get("id").and_then(value_id) else {
                        continue;
                    };
                    if let Some(pending) = host.pending.lock().await.remove(&id) {
                        let response =
                            if message.get("success").and_then(Value::as_bool) == Some(true) {
                                Ok(message)
                            } else {
                                Err("Pi RPC command failed".to_string())
                            };
                        let _ = pending.sender.send(response);
                    }
                    continue;
                }
                match message.get("type").and_then(Value::as_str) {
                    Some("agent_start") => host.streaming.store(true, Ordering::Release),
                    Some("agent_settled") => host.streaming.store(false, Ordering::Release),
                    _ => {}
                }
                host.route_message(message).await;
            }
            host.alive.store(false, Ordering::Release);
            for (_, pending) in host.pending.lock().await.drain() {
                let _ = pending.sender.send(Err("Pi RPC Host exited".to_string()));
            }
            if let Some(owner) = host.owner.read().await.clone() {
                let _ = host.incoming.send(PiIncoming::Exited {
                    host_instance_id: host.host_instance_id.clone(),
                    agent_run_id: owner.agent_run_id,
                    execution_epoch: owner.execution_epoch,
                });
            }
        });
    }

    fn spawn_stderr_reader(_host: Arc<Self>, stderr: ManagedChildStderr) {
        tokio::spawn(async move {
            // Pi/provider stderr is private diagnostic material. Drain it with a
            // hard record bound, but never forward raw text to public Runtime events.
            let mut reader = BufReader::new(stderr);
            while let Ok(Some(_)) = read_jsonl_record(&mut reader, 64 * 1024).await {}
        });
    }

    async fn route_message(&self, message: Value) {
        let Some(owner) = self.owner.read().await.clone() else {
            return;
        };
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed) + 1;
        let _ = self.incoming.send(PiIncoming::Message {
            host_instance_id: self.host_instance_id.clone(),
            agent_run_id: owner.agent_run_id,
            execution_epoch: owner.execution_epoch,
            native_session_id: self.session_id.clone(),
            native_prompt_id: owner.native_prompt_id,
            delivery_id: owner.delivery_id,
            sequence,
            message,
        });
    }

    async fn command(&self, command_type: &str, fields: Value) -> Result<Value> {
        if !self.is_alive() {
            bail!("Pi RPC Host is not alive");
        }
        let id = format!("rovai-pi-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let mut command = fields.as_object().cloned().unwrap_or_default();
        command.insert("id".to_string(), Value::String(id.clone()));
        command.insert("type".to_string(), Value::String(command_type.to_string()));
        let (sender, receiver) = oneshot::channel();
        self.pending
            .lock()
            .await
            .insert(id.clone(), PendingPiCommand { sender });
        if let Err(error) = self.send(Value::Object(command)).await {
            self.pending.lock().await.remove(&id);
            return Err(error);
        }
        timeout(PI_COMMAND_TIMEOUT, receiver)
            .await
            .with_context(|| format!("Pi RPC command timed out: {command_type}"))?
            .with_context(|| format!("Pi RPC response channel closed: {command_type}"))?
            .map_err(|message| anyhow::anyhow!("{command_type}: {message}"))
    }

    async fn send_command_without_waiting(&self, command_type: &str, fields: Value) -> Result<()> {
        if !self.is_alive() {
            bail!("Pi RPC Host is not alive");
        }
        let id = format!("rovai-pi-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let mut command = fields.as_object().cloned().unwrap_or_default();
        command.insert("id".to_string(), Value::String(id));
        command.insert("type".to_string(), Value::String(command_type.to_string()));
        self.send(Value::Object(command)).await
    }

    async fn send(&self, message: Value) -> Result<()> {
        let encoded = serde_json::to_vec(&message)?;
        if encoded.len() > PI_MAX_JSONL_RECORD_BYTES {
            bail!("Pi RPC outbound record exceeds the safety limit");
        }
        let mut stdin = self.stdin.lock().await;
        stdin.write_all(&encoded).await?;
        stdin.write_all(b"\n").await?;
        stdin.flush().await?;
        Ok(())
    }

    async fn bind(&self, owner: PiRuntimeOwner) -> Result<()> {
        let mut current = self.owner.write().await;
        if current.is_some() {
            bail!("Pi Host already has an active AgentRun owner");
        }
        *current = Some(owner);
        Ok(())
    }

    async fn unbind(&self, owner: &PiRuntimeOwner) {
        let mut current = self.owner.write().await;
        if current.as_ref() == Some(owner) {
            *current = None;
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

    pub(crate) async fn is_quiescent(&self) -> bool {
        self.is_alive()
            && !self.streaming.load(Ordering::Acquire)
            && self.pending.lock().await.is_empty()
            && self.owner.read().await.is_none()
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
        let _ = std::fs::remove_dir_all(&self.config_root);
    }
}

pub struct PiRuntime {
    owner: PiRuntimeOwner,
    camp_id: String,
    host: Arc<PiHost>,
    final_message: RwLock<Option<String>>,
    final_stop_reason: RwLock<Option<String>>,
    approval_handshake: AtomicBool,
}

impl PiRuntime {
    fn from_host(owner: PiRuntimeOwner, camp_id: String, host: Arc<PiHost>) -> Arc<Self> {
        Arc::new(Self {
            owner,
            camp_id,
            host,
            final_message: RwLock::new(None),
            final_stop_reason: RwLock::new(None),
            approval_handshake: AtomicBool::new(false),
        })
    }

    pub async fn start_prompt(&self, message: &str) -> Result<()> {
        *self.final_message.write().await = None;
        *self.final_stop_reason.write().await = None;
        self.approval_handshake.store(false, Ordering::Release);
        let response = self
            .host
            .command("prompt", json!({"message": message}))
            .await?;
        if response.get("command").and_then(Value::as_str) != Some("prompt") {
            bail!("Pi prompt response has the wrong command identity");
        }
        Ok(())
    }

    pub async fn cancel(&self) -> Result<()> {
        // Pi can defer the abort response until a native tool unwinds. Core's
        // two-second interrupt window only requires a flushed abort request;
        // the subsequent Fleet Stop remains the authoritative process-tree fence.
        self.host
            .send_command_without_waiting("abort", json!({}))
            .await
    }

    pub async fn respond(&self, id: Value, response: Value) -> Result<()> {
        if response.get("type").and_then(Value::as_str) != Some("extension_ui_response")
            || response.get("id") != Some(&id)
        {
            bail!("Pi managed approval response failed Native Request fencing");
        }
        self.host.send(response).await
    }

    pub async fn observe(&self, message: &Value) -> Result<Option<CompletedAcpAction>> {
        match message.get("type").and_then(Value::as_str) {
            Some("extension_ui_request")
                if message.get("method").and_then(Value::as_str) == Some("setStatus")
                    && message.get("statusKey").and_then(Value::as_str)
                        == Some("rovai-managed-approval")
                    && message.get("statusText").and_then(Value::as_str)
                        == Some(PI_APPROVAL_EXTENSION_VERSION) =>
            {
                self.approval_handshake.store(true, Ordering::Release);
            }
            Some("message_end") => {
                let Some(assistant) = message
                    .get("message")
                    .filter(|value| value.get("role").and_then(Value::as_str) == Some("assistant"))
                else {
                    return Ok(None);
                };
                *self.final_stop_reason.write().await = assistant
                    .get("stopReason")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                if let Some(text) = assistant_message_text(assistant) {
                    *self.final_message.write().await = Some(text);
                }
            }
            Some("tool_execution_end") => return completed_action(message),
            _ => {}
        }
        Ok(None)
    }

    pub async fn terminal(&self) -> (Option<String>, Option<String>) {
        (
            self.final_message.read().await.clone(),
            self.final_stop_reason.read().await.clone(),
        )
    }

    pub fn approval_handshake_observed(&self) -> bool {
        self.approval_handshake.load(Ordering::Acquire)
    }

    pub fn host_instance_id(&self) -> &str {
        self.host.host_instance_id()
    }

    pub fn session_id(&self) -> &str {
        &self.host.session_id
    }

    pub fn model_fingerprint(&self) -> &str {
        &self.host.model_fingerprint
    }

    pub fn prompt_id(&self) -> &str {
        &self.owner.native_prompt_id
    }

    pub fn delivery_id(&self) -> &str {
        &self.owner.delivery_id
    }

    pub fn agent_run_epoch(&self) -> i64 {
        self.owner.execution_epoch
    }

    pub(crate) fn builtin_tool_process_config(&self) -> Option<&BuiltinToolProcessConfig> {
        self.host.builtin_tool_process_config()
    }

    fn belongs_to_camp(&self, camp_id: &str) -> bool {
        self.camp_id == camp_id
    }

    async fn detach(&self) {
        self.host.unbind(&self.owner).await;
    }
}

pub struct PiRpcRuntimeAdapter {
    active: Mutex<HashMap<String, Arc<PiRuntime>>>,
    runtime_creation: Mutex<()>,
    incoming: mpsc::UnboundedSender<PiIncoming>,
    fleet: Arc<AgentRuntimeFleetManager>,
    private_runtime_dir: PathBuf,
}

pub struct PiAgentRunRuntimeRequest<'a> {
    pub agent_run_id: &'a str,
    pub execution_epoch: i64,
    pub camp_id: &'a str,
    pub agent_id: &'a str,
    pub cwd: &'a Path,
    pub frozen_runtime: &'a FrozenAgentRuntimeConfig,
    pub runtime_compatibility_digest: &'a str,
    pub native_session_id: &'a str,
    pub exact_resume: bool,
    pub delivery_id: &'a str,
    pub native_prompt_id: &'a str,
    pub provider: &'a PiProviderConfig,
    pub session_bootstrap: &'a str,
    pub skill_paths: &'a [PathBuf],
    pub builtin_tools: &'a BuiltinToolProcessConfig,
}

impl PiRpcRuntimeAdapter {
    pub fn new(
        data_dir: &Path,
        incoming: mpsc::UnboundedSender<PiIncoming>,
        fleet: Arc<AgentRuntimeFleetManager>,
    ) -> Result<Self> {
        let private_runtime_dir = data_dir.join("runtime/pi");
        create_private_directory(&private_runtime_dir)?;
        Ok(Self {
            active: Mutex::new(HashMap::new()),
            runtime_creation: Mutex::new(()),
            incoming,
            fleet,
            private_runtime_dir,
        })
    }

    pub async fn ensure_agent_run_runtime(
        &self,
        request: PiAgentRunRuntimeRequest<'_>,
    ) -> Result<Arc<PiRuntime>> {
        if request.frozen_runtime.adapter_kind != AdapterKind::Pi {
            bail!("Pi Runtime received a non-Pi AgentRun");
        }
        let _creation = self.runtime_creation.lock().await;
        if let Some(existing) = self.active.lock().await.get(request.agent_run_id).cloned() {
            if existing.agent_run_epoch() == request.execution_epoch && existing.host.is_alive() {
                return Ok(existing);
            }
            let epoch = existing.agent_run_epoch();
            existing.detach().await;
            self.active.lock().await.remove(request.agent_run_id);
            self.fleet
                .release(request.agent_run_id, epoch, FleetReleaseDisposition::Stop)
                .await;
        }
        let session_root =
            session_root(&self.private_runtime_dir, request.camp_id, request.agent_id)?;
        let lease = self
            .fleet
            .acquire(
                FleetAcquireRequest {
                    agent_run_id: request.agent_run_id.to_string(),
                    execution_epoch: request.execution_epoch,
                    adapter_kind: AdapterKind::Pi,
                    compatibility: RuntimeCompatibilityKey {
                        camp_id: request.camp_id.to_string(),
                        agent_id: request.agent_id.to_string(),
                        runtime_compatibility_digest: request
                            .runtime_compatibility_digest
                            .to_string(),
                    },
                },
                || async {
                    let host = PiHost::spawn(PiHostLaunch {
                        executable: Path::new(&request.frozen_runtime.executable_path),
                        cwd: request.cwd,
                        private_runtime_dir: &self.private_runtime_dir,
                        session_root: &session_root,
                        expected_session_id: request.native_session_id,
                        exact_resume: request.exact_resume,
                        provider: request.provider,
                        session_bootstrap: request.session_bootstrap,
                        skill_paths: request.skill_paths,
                        incoming: self.incoming.clone(),
                        builtin_tools: Some(request.builtin_tools.clone()),
                    })
                    .await?;
                    Ok(RuntimeProcessHost::Pi(host))
                },
            )
            .await?;
        let host = lease.host.into_pi()?;
        if host.session_id != request.native_session_id {
            self.fleet
                .release(
                    request.agent_run_id,
                    request.execution_epoch,
                    FleetReleaseDisposition::Stop,
                )
                .await;
            bail!("Pi warm Host has a different Native Session identity");
        }
        let owner = PiRuntimeOwner {
            agent_run_id: request.agent_run_id.to_string(),
            execution_epoch: request.execution_epoch,
            native_prompt_id: request.native_prompt_id.to_string(),
            delivery_id: request.delivery_id.to_string(),
        };
        host.bind(owner.clone()).await?;
        let runtime = PiRuntime::from_host(owner, request.camp_id.to_string(), host);
        self.active
            .lock()
            .await
            .insert(request.agent_run_id.to_string(), runtime.clone());
        Ok(runtime)
    }

    pub async fn get_agent_run(
        &self,
        agent_run_id: &str,
        execution_epoch: i64,
    ) -> Option<Arc<PiRuntime>> {
        self.active
            .lock()
            .await
            .get(agent_run_id)
            .filter(|runtime| runtime.agent_run_epoch() == execution_epoch)
            .cloned()
    }

    pub async fn get_agent_run_on_host(
        &self,
        host_instance_id: &str,
        agent_run_id: &str,
        execution_epoch: i64,
    ) -> Option<Arc<PiRuntime>> {
        self.active
            .lock()
            .await
            .get(agent_run_id)
            .filter(|runtime| {
                runtime.agent_run_epoch() == execution_epoch
                    && runtime.host_instance_id() == host_instance_id
            })
            .cloned()
    }

    pub async fn complete_agent_run(&self, agent_run_id: &str, execution_epoch: i64) {
        let runtime = self.take_runtime(agent_run_id, execution_epoch).await;
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

    pub async fn forget_agent_run(&self, agent_run_id: &str, execution_epoch: i64) {
        let runtime = self.take_runtime(agent_run_id, execution_epoch).await;
        if let Some(runtime) = runtime {
            runtime.detach().await;
        }
        self.fleet
            .release(agent_run_id, execution_epoch, FleetReleaseDisposition::Stop)
            .await;
    }

    async fn take_runtime(
        &self,
        agent_run_id: &str,
        execution_epoch: i64,
    ) -> Option<Arc<PiRuntime>> {
        let mut active = self.active.lock().await;
        active
            .get(agent_run_id)
            .is_some_and(|runtime| runtime.agent_run_epoch() == execution_epoch)
            .then(|| active.remove(agent_run_id))
            .flatten()
    }

    pub async fn forget_camp(&self, camp_id: &str) {
        let runtimes = {
            let mut active = self.active.lock().await;
            let ids = active
                .iter()
                .filter_map(|(id, runtime)| runtime.belongs_to_camp(camp_id).then_some(id.clone()))
                .collect::<Vec<_>>();
            ids.into_iter()
                .filter_map(|id| active.remove(&id))
                .collect::<Vec<_>>()
        };
        for runtime in runtimes {
            runtime.detach().await;
        }
        self.fleet.invalidate_camp(camp_id).await;
        if let Ok(camp_key) = scope_key("camp", camp_id) {
            let _ =
                std::fs::remove_dir_all(self.private_runtime_dir.join("sessions").join(camp_key));
        }
    }

    pub async fn shutdown_all(&self) {
        let runtimes = self
            .active
            .lock()
            .await
            .drain()
            .map(|(_, value)| value)
            .collect::<Vec<_>>();
        for runtime in runtimes {
            runtime.detach().await;
        }
    }
}

impl AgentRuntimeAdapter for PiRpcRuntimeAdapter {
    fn kind(&self) -> AdapterKind {
        AdapterKind::Pi
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

#[derive(Debug)]
pub struct InterceptedPiActionRequest {
    pub action_id: String,
    pub native_action_id: String,
    pub input: CanonicalActionInput,
    pub runtime_request: RuntimeActionRequestBinding,
    pub reason: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PiApprovalEnvelope {
    schema_version: i64,
    extension_version: String,
    tool_call_id: String,
    tool_name: String,
    input: Value,
}

pub fn intercepted_action_request(
    agent_run_id: &str,
    execution_epoch: i64,
    native_session_id: &str,
    native_prompt_id: &str,
    execution_root: &Path,
    request: &Value,
) -> Result<InterceptedPiActionRequest> {
    if request.get("type").and_then(Value::as_str) != Some("extension_ui_request")
        || request.get("method").and_then(Value::as_str) != Some("confirm")
        || request.get("title").and_then(Value::as_str) != Some("Rovai managed approval")
    {
        bail!("Pi request is not a managed Approval confirmation");
    }
    let ui_id = required_string(request, "id")?;
    let envelope: PiApprovalEnvelope = serde_json::from_str(
        request
            .get("message")
            .and_then(Value::as_str)
            .context("Pi Approval request has no structured envelope")?,
    )
    .context("Pi Approval request envelope is invalid")?;
    if envelope.schema_version != PI_APPROVAL_SCHEMA_VERSION
        || envelope.extension_version != PI_APPROVAL_EXTENSION_VERSION
        || envelope.tool_call_id.trim().is_empty()
    {
        bail!("Pi Approval extension identity is incompatible");
    }
    let request_digest = canonical_json_digest(&json!({
        "schemaVersion": envelope.schema_version,
        "extensionVersion": envelope.extension_version,
        "toolCallId": envelope.tool_call_id,
        "toolName": envelope.tool_name,
        "input": envelope.input,
    }))?;
    let root = execution_root.to_string_lossy().to_string();
    let input = match envelope.tool_name.as_str() {
        "bash" => {
            let command = envelope
                .input
                .get("command")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .context("Pi bash Approval request has no command")?;
            CanonicalActionInput::ShellCommand {
                argv: vec![
                    "/bin/zsh".to_string(),
                    "-lc".to_string(),
                    command.to_string(),
                ],
                cwd: root,
                environment_refs: Vec::new(),
            }
        }
        "write" | "edit" => {
            let path = envelope
                .input
                .get("path")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .context("Pi file Approval request has no path")?;
            let path = if Path::new(path).is_absolute() {
                PathBuf::from(path)
            } else {
                execution_root.join(path)
            };
            CanonicalActionInput::FileWrite {
                path: path.to_string_lossy().to_string(),
                operation: if envelope.tool_name == "edit" {
                    "patch".to_string()
                } else {
                    "create".to_string()
                },
                content_digest: request_digest.clone(),
            }
        }
        _ => bail!("Pi Approval request names an unsupported mutating tool"),
    };
    let allow_response = json!({
        "type": "extension_ui_response",
        "id": ui_id,
        "confirmed": true,
    });
    let deny_response = json!({
        "type": "extension_ui_response",
        "id": ui_id,
        "confirmed": false,
    });
    let options = vec![
        RuntimePermissionOption::from_native(
            "allow_once",
            "allow_once",
            "允许一次",
            "仅允许当前 Pi Tool 请求；后续请求仍会重新询问。",
            allow_response,
            true,
        )?,
        RuntimePermissionOption::from_native(
            "deny",
            "deny",
            "拒绝",
            "拒绝当前 Pi Tool 请求，不产生该副作用。",
            deny_response,
            false,
        )?,
    ];
    let native_action_id = format!("{}:approval:{}", envelope.tool_call_id, ui_id);
    let action_id_digest = canonical_json_digest(&json!({
        "agentRunId": agent_run_id,
        "executionEpoch": execution_epoch,
        "nativeMethod": "pi/extension_ui/confirm",
        "nativeActionId": native_action_id,
    }))?;
    Ok(InterceptedPiActionRequest {
        action_id: format!("action-{action_id_digest}"),
        native_action_id,
        input,
        runtime_request: RuntimeActionRequestBinding {
            native_method: "pi/extension_ui/confirm".to_string(),
            native_request_id: Value::String(ui_id.to_string()),
            native_item_id: envelope.tool_call_id,
            native_thread_id: native_session_id.to_string(),
            native_turn_id: native_prompt_id.to_string(),
            response_context: json!({
                "schemaVersion": PI_APPROVAL_SCHEMA_VERSION,
                "extensionVersion": PI_APPROVAL_EXTENSION_VERSION,
                "requestDigest": request_digest,
            }),
            options,
        },
        reason: Some(format!("Pi {} tool request", envelope.tool_name)),
    })
}

pub fn rejection_response(request: &Value) -> Result<Value> {
    Ok(json!({
        "type": "extension_ui_response",
        "id": required_string(request, "id")?,
        "confirmed": false,
    }))
}

pub fn normalize_event(message: &Value) -> (&'static str, Value) {
    match message.get("type").and_then(Value::as_str) {
        Some("message_update")
            if message
                .pointer("/assistantMessageEvent/type")
                .and_then(Value::as_str)
                == Some("text_delta") =>
        {
            (
                "agent.text.delta",
                json!({
                    "delta": message.pointer("/assistantMessageEvent/delta").and_then(Value::as_str).unwrap_or(""),
                    "contentIndex": message.pointer("/assistantMessageEvent/contentIndex"),
                }),
            )
        }
        Some("message_update") => ("runtime.event", json!({"type": "message_update"})),
        Some("tool_execution_start") => (
            "runtime.action",
            json!({
                "toolCallId": message.get("toolCallId"),
                "toolName": message.get("toolName"),
                "status": "in_progress",
                "kind": public_tool_kind(message.get("toolName").and_then(Value::as_str)),
                "input": public_tool_input(message.get("toolName").and_then(Value::as_str), message.get("args")),
            }),
        ),
        Some("tool_execution_update") => (
            "runtime.action",
            json!({
                "toolCallId": message.get("toolCallId"),
                "toolName": message.get("toolName"),
                "status": "in_progress",
                "kind": public_tool_kind(message.get("toolName").and_then(Value::as_str)),
                "input": public_tool_input(message.get("toolName").and_then(Value::as_str), message.get("args")),
                "output": public_content_text(message.pointer("/partialResult/content")),
            }),
        ),
        Some("tool_execution_end") => (
            "runtime.action",
            json!({
                "toolCallId": message.get("toolCallId"),
                "toolName": message.get("toolName"),
                "status": if message.get("isError").and_then(Value::as_bool) == Some(true) { "failed" } else { "completed" },
                "kind": public_tool_kind(message.get("toolName").and_then(Value::as_str)),
                "output": public_content_text(message.pointer("/result/content")),
            }),
        ),
        Some("agent_settled") => ("runtime.turn.completed", json!({"status": "settled"})),
        Some("compaction_start" | "compaction_end") => (
            "runtime.event",
            json!({"type": message.get("type"), "reason": message.get("reason")}),
        ),
        Some(value) => ("runtime.event", json!({"type": value})),
        None => ("runtime.event", json!({"type": "unknown"})),
    }
}

pub(crate) fn runtime_compatibility_digest(
    frozen_runtime: &FrozenAgentRuntimeConfig,
    cwd: &Path,
    attachment_authorization: &CampAttachmentRuntimeAuthorization,
    provider_compatibility_key: &str,
    skill_exposure_digest: &str,
    session_bootstrap: &str,
) -> Result<String> {
    let cwd = cwd
        .canonicalize()
        .with_context(|| format!("failed to resolve execution root {}", cwd.display()))?;
    canonical_json_digest(&json!({
        "schemaVersion": 1,
        "adapterKind": AdapterKind::Pi,
        "protocolVersion": PI_PROTOCOL_VERSION,
        "runtimeConfigDigest": frozen_runtime.config_digest,
        "hostConfigDigest": frozen_runtime.host_config_digest,
        "executionRoot": cwd,
        "providerCompatibilityKey": provider_compatibility_key,
        "managedApprovalExtension": PI_APPROVAL_EXTENSION_VERSION,
        "skillExposureDigest": skill_exposure_digest,
        "sessionBootstrapDigest": canonical_json_digest(&json!(session_bootstrap))?,
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

fn completed_action(message: &Value) -> Result<Option<CompletedAcpAction>> {
    let native_item_id = required_string(message, "toolCallId")?.to_string();
    let tool_name = required_string(message, "toolName")?.to_string();
    let is_error = message
        .get("isError")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let result_digest = message
        .get("result")
        .map(canonical_json_digest)
        .transpose()?;
    let observation_digest = canonical_json_digest(&json!({
        "toolCallId": native_item_id,
        "toolName": tool_name,
        "resultDigest": result_digest.as_deref(),
        "isError": is_error,
    }))?;
    Ok(Some(CompletedAcpAction {
        native_item_id,
        native_kind: public_tool_kind(Some(&tool_name))
            .unwrap_or("other")
            .to_string(),
        public_command: None,
        observation_digest,
        outcome: if is_error {
            ActionResultOutcome::Failed
        } else {
            ActionResultOutcome::Succeeded
        },
        result_code: if is_error {
            "pi_tool_failed".to_string()
        } else {
            "pi_tool_completed".to_string()
        },
        result_summary: if is_error {
            "Pi tool execution failed".to_string()
        } else {
            "Pi tool execution completed".to_string()
        },
        result_data: json!({
            "status": if is_error { "failed" } else { "completed" },
            "resultDigest": result_digest.as_deref(),
        }),
        effect_disposition: if is_error { "unknown" } else { "complete" }.to_string(),
    }))
}

fn assistant_message_text(message: &Value) -> Option<String> {
    let text = match message.get("content")? {
        Value::String(text) => text.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|block| block.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join(""),
        _ => return None,
    };
    (!text.trim().is_empty()).then_some(text)
}

fn public_content_text(value: Option<&Value>) -> Option<String> {
    let value = value?;
    match value {
        Value::String(text) => (!text.is_empty()).then(|| text.clone()),
        Value::Array(parts) => {
            let text = parts
                .iter()
                .filter(|part| part.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|part| part.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n");
            (!text.is_empty()).then_some(text)
        }
        _ => None,
    }
}

fn public_tool_kind(name: Option<&str>) -> Option<&'static str> {
    match name {
        Some("bash") => Some("execute"),
        Some("write" | "edit") => Some("edit"),
        Some("read" | "grep" | "find" | "ls") => Some("read"),
        _ => None,
    }
}

fn public_tool_input(name: Option<&str>, args: Option<&Value>) -> Option<String> {
    match name {
        Some("bash") => args?.get("command")?.as_str().map(str::to_string),
        _ => None,
    }
}

fn required_string<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .with_context(|| format!("Pi message has no {key}"))
}

fn value_id(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::to_string)
        .or_else(|| value.as_u64().map(|value| value.to_string()))
}

async fn read_jsonl_record<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    max_bytes: usize,
) -> Result<Option<Vec<u8>>> {
    let mut record = Vec::new();
    loop {
        let buffer = reader.fill_buf().await?;
        if buffer.is_empty() {
            if record.is_empty() {
                return Ok(None);
            }
            break;
        }
        let take = buffer
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(buffer.len(), |offset| offset + 1);
        if record.len().saturating_add(take) > max_bytes {
            bail!("Pi JSONL record exceeds the safety limit");
        }
        record.extend_from_slice(&buffer[..take]);
        reader.consume(take);
        if record.last() == Some(&b'\n') {
            record.pop();
            if record.last() == Some(&b'\r') {
                record.pop();
            }
            break;
        }
    }
    Ok(Some(record))
}

fn session_root(private_root: &Path, camp_id: &str, agent_id: &str) -> Result<PathBuf> {
    Ok(private_root
        .join("sessions")
        .join(scope_key("camp", camp_id)?)
        .join(scope_key("agent", agent_id)?))
}

fn scope_key(kind: &str, id: &str) -> Result<String> {
    canonical_json_digest(&json!({"kind": kind, "id": id}))
}

fn locator_path(session_root: &Path) -> PathBuf {
    session_root.join("locator.json")
}

fn read_session_locator(
    session_root: &Path,
    expected_session_id: &str,
) -> Result<PiSessionLocator> {
    let path = locator_path(session_root);
    let metadata =
        std::fs::symlink_metadata(&path).context("Pi exact-resume locator is unavailable")?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        bail!("Pi exact-resume locator is not a regular file");
    }
    let locator: PiSessionLocator = serde_json::from_slice(&std::fs::read(&path)?)?;
    if locator.schema_version != 1 || locator.session_id != expected_session_id {
        bail!("Pi exact-resume locator failed Native Session identity validation");
    }
    validate_session_file_path(session_root, Path::new(&locator.session_file), true)?;
    Ok(locator)
}

fn write_session_locator(session_root: &Path, session_id: &str, session_file: &Path) -> Result<()> {
    validate_session_file_path(session_root, session_file, false)?;
    write_private_json(
        &locator_path(session_root),
        &PiSessionLocator {
            schema_version: 1,
            session_id: session_id.to_string(),
            session_file: session_file.to_string_lossy().to_string(),
        },
    )
}

fn validate_session_file_path(session_root: &Path, path: &Path, must_exist: bool) -> Result<()> {
    if !path.is_absolute() {
        bail!("Pi session file path is not absolute");
    }
    let root = session_root
        .canonicalize()
        .with_context(|| format!("Pi session root is unavailable: {}", session_root.display()))?;
    let parent = path
        .parent()
        .context("Pi session file has no parent directory")?
        .canonicalize()
        .context("Pi session file parent is unavailable")?;
    if !parent.starts_with(&root) {
        bail!("Pi session file escaped the managed Session root");
    }
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            bail!("Pi session path is not a regular file")
        }
        Ok(_) => Ok(()),
        Err(error) if !must_exist && error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).context("Pi session file is unavailable"),
    }
}

fn validate_host_state(
    state: &Value,
    session_root: &Path,
    expected_session_id: &str,
    expected_model_id: &str,
    expected_resume_file: Option<&Path>,
) -> Result<PathBuf> {
    let data = state.get("data").context("Pi get_state omitted data")?;
    let observed_session_id = data
        .get("sessionId")
        .and_then(Value::as_str)
        .context("Pi get_state omitted sessionId")?;
    if observed_session_id != expected_session_id {
        bail!("Pi returned a different Native Session identity");
    }
    let session_file = data
        .get("sessionFile")
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .context("Pi get_state omitted sessionFile")?;
    validate_session_file_path(session_root, &session_file, expected_resume_file.is_some())?;
    if let Some(expected_resume_file) = expected_resume_file {
        let expected = expected_resume_file
            .canonicalize()
            .context("Pi exact-resume locator could not be resolved")?;
        let observed = session_file
            .canonicalize()
            .context("Pi observed Session file could not be resolved")?;
        if observed != expected {
            bail!("Pi resumed a different canonical Session file");
        }
    }
    if data.pointer("/model/provider").and_then(Value::as_str) != Some(PI_PROVIDER_ID)
        || data.pointer("/model/id").and_then(Value::as_str) != Some(expected_model_id)
    {
        bail!("Pi selected a different provider or model than the frozen MiniMax binding");
    }
    Ok(session_file)
}

fn create_private_directory(path: &Path) -> Result<()> {
    std::fs::create_dir_all(path)
        .with_context(|| format!("failed to create private Pi directory {}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn write_private_json(path: &Path, value: &impl Serialize) -> Result<()> {
    write_private_file(path, &serde_json::to_vec_pretty(value)?)
}

fn write_private_file(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().context("private Pi file has no parent")?;
    create_private_directory(parent)?;
    let temporary = parent.join(format!(
        ".{}.tmp-{}",
        path.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("pi"),
        uuid::Uuid::new_v4()
    ));
    std::fs::write(&temporary, bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&temporary, std::fs::Permissions::from_mode(0o600))?;
    }
    std::fs::rename(&temporary, path)?;
    Ok(())
}

fn short_digest(bytes: &[u8]) -> String {
    let digest = format!("{:x}", Sha256::digest(bytes));
    digest[..12].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn jsonl_reader_preserves_unicode_line_separators() {
        let input = b"{\"value\":\"a\xE2\x80\xA8b\xE2\x80\xA9c\"}\n";
        let mut reader = BufReader::new(&input[..]);
        let record = read_jsonl_record(&mut reader, 1024).await.unwrap().unwrap();
        let value: Value = serde_json::from_slice(&record).unwrap();
        assert_eq!(value["value"], "a\u{2028}b\u{2029}c");
    }

    #[test]
    fn approval_parser_freezes_allow_and_deny_responses_without_file_content() {
        let request = json!({
            "type": "extension_ui_request",
            "id": "ui-1",
            "method": "confirm",
            "title": "Rovai managed approval",
            "message": serde_json::to_string(&json!({
                "schemaVersion": 1,
                "extensionVersion": PI_APPROVAL_EXTENSION_VERSION,
                "toolCallId": "tool-1",
                "toolName": "write",
                "input": {"path": "note.txt", "content": "private body"},
            })).unwrap(),
        });
        let action = intercepted_action_request(
            "run-1",
            1,
            "session-1",
            "prompt-1",
            Path::new("/tmp/workspace"),
            &request,
        )
        .unwrap();
        assert_eq!(action.runtime_request.options.len(), 2);
        assert_eq!(
            action.runtime_request.options[0].native_response,
            json!({"type":"extension_ui_response","id":"ui-1","confirmed":true})
        );
        assert!(
            !serde_json::to_string(&action.runtime_request)
                .unwrap()
                .contains("private body")
        );
        assert!(matches!(
            action.input,
            CanonicalActionInput::FileWrite { ref operation, .. } if operation == "create"
        ));
    }

    #[test]
    fn provider_loader_rejects_broad_secret_permissions() {
        let root = std::env::temp_dir().join(format!("rovai-pi-provider-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let settings = root.join("settings.json");
        std::fs::write(
            &settings,
            serde_json::to_vec(&json!({"env": {
                "ANTHROPIC_AUTH_TOKEN": "secret",
                "ANTHROPIC_BASE_URL": "https://example.invalid/api",
                "ANTHROPIC_MODEL": "model"
            }}))
            .unwrap(),
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&settings, std::fs::Permissions::from_mode(0o644)).unwrap();
            assert!(load_claude_minimax_provider_at(&settings).is_err());
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn exact_resume_state_requires_the_same_canonical_session_file() {
        let root = std::env::temp_dir().join(format!("rovai-pi-session-{}", uuid::Uuid::new_v4()));
        create_private_directory(&root).unwrap();
        let expected = root.join("expected.jsonl");
        let different = root.join("different.jsonl");
        std::fs::write(&expected, b"expected").unwrap();
        std::fs::write(&different, b"different").unwrap();
        let state = |session_file: &Path| {
            json!({
                "data": {
                    "sessionId": "session-1",
                    "sessionFile": session_file,
                    "model": {"provider": PI_PROVIDER_ID, "id": "model-1"}
                }
            })
        };

        assert_eq!(
            validate_host_state(
                &state(&expected),
                &root,
                "session-1",
                "model-1",
                Some(&expected),
            )
            .unwrap(),
            expected
        );
        assert!(
            validate_host_state(
                &state(&different),
                &root,
                "session-1",
                "model-1",
                Some(&expected),
            )
            .is_err()
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn completed_action_keeps_public_output_out_of_durable_action_state() {
        let completion = completed_action(&json!({
            "type": "tool_execution_end",
            "toolCallId": "tool-1",
            "toolName": "bash",
            "result": {
                "content": [{"type": "text", "text": "private command output"}]
            },
            "isError": false
        }))
        .unwrap()
        .unwrap();

        assert!(matches!(completion.outcome, ActionResultOutcome::Succeeded));
        assert_eq!(completion.effect_disposition, "complete");
        let durable = serde_json::to_string(&completion.result_data).unwrap();
        assert!(!durable.contains("private command output"));
        assert!(completion.result_data["resultDigest"].is_string());
    }
}
