use std::{
    collections::{BTreeSet, HashMap, HashSet},
    fs::{File, OpenOptions},
    io::{BufRead as _, BufReader as StdBufReader, Read as _, Write as _},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};

use anyhow::{Context, Result, bail};
use rovai_core::{
    agent_profile::{AdapterKind, FrozenAgentRuntimeConfig},
    agent_runtime_adapter::{
        AdapterRuntimeProjection, AdapterRuntimeResolutionInput, AgentRuntimeAdapter,
        AgentRuntimeAdapterRegistry, McpProjectionCapability, PI_RUNTIME_DEFAULT_MODEL_ID,
        SkillDiscoveryCapability,
    },
    command::canonical_json_digest,
    context::PreparedSessionBootstrap,
    managed_process::{
        ManagedChildStderr, ManagedChildStdin, ManagedChildStdout, ManagedProcess,
        ManagedProcessLaunchSpec, ManagedProcessPurpose, ManagedStdinPolicy,
        ManagedWindowsArgvDialect,
    },
    mcp_projection::PreparedMcpProjection,
    runtime_discovery::configure_active_runtime_command,
    skill::MAX_SKILL_FILE_BYTES,
    skill_projection::PreparedSkillExposure,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncWriteExt, BufReader},
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

use super::mcp::{PiMcpActivationFailure, PiMcpBridge, PiMcpToolDefinition};
use super::{
    PI_COMMAND_TIMEOUT, PI_HOST_EXTENSION_VERSION, PI_MAX_JSONL_RECORD_BYTES, PI_PROTOCOL_VERSION,
    PiIncoming, assistant_message_text, completed_action, read_jsonl_record, value_id,
};

const MANAGED_HOST_EXTENSION: &str = include_str!("managed-host.ts");
const NATIVE_TOOL_NAMES: [&str; 7] = ["read", "bash", "edit", "write", "grep", "find", "ls"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PiHostBindingDocument {
    pub schema_version: i64,
    pub extension_version: String,
    pub host_instance_id: String,
    pub host_binding_generation: u64,
    pub agent_run_id: String,
    pub execution_epoch: i64,
    pub native_binding_id: String,
    pub native_binding_generation: i64,
    pub runtime_input_delivery_id: String,
    pub native_prompt_id: String,
    pub expected_native_session_id: Option<String>,
    pub bootstrap_evidence_id: String,
    pub bootstrap: String,
    pub bootstrap_payload_digest: String,
    pub skill_root: String,
    pub expected_managed_skill_exposure_digest: String,
    pub mcp_projection_digest: String,
    pub mcp_tools: Vec<PiMcpToolDefinition>,
}

#[derive(Debug, Clone)]
struct PiBindingSeed {
    agent_run_id: String,
    execution_epoch: i64,
    native_binding_id: String,
    native_binding_generation: i64,
    runtime_input_delivery_id: String,
    native_prompt_id: String,
    expected_native_session_id: Option<String>,
    bootstrap_evidence_id: String,
    bootstrap: String,
    bootstrap_payload_digest: String,
    skill_root: PathBuf,
    expected_managed_skill_exposure_digest: String,
    mcp_projection_digest: String,
    mcp_tools: Vec<PiMcpToolDefinition>,
}

impl PiBindingSeed {
    fn document(
        &self,
        host_instance_id: &str,
        host_binding_generation: u64,
    ) -> PiHostBindingDocument {
        PiHostBindingDocument {
            schema_version: 1,
            extension_version: PI_HOST_EXTENSION_VERSION.to_string(),
            host_instance_id: host_instance_id.to_string(),
            host_binding_generation,
            agent_run_id: self.agent_run_id.clone(),
            execution_epoch: self.execution_epoch,
            native_binding_id: self.native_binding_id.clone(),
            native_binding_generation: self.native_binding_generation,
            runtime_input_delivery_id: self.runtime_input_delivery_id.clone(),
            native_prompt_id: self.native_prompt_id.clone(),
            expected_native_session_id: self.expected_native_session_id.clone(),
            bootstrap_evidence_id: self.bootstrap_evidence_id.clone(),
            bootstrap: self.bootstrap.clone(),
            bootstrap_payload_digest: self.bootstrap_payload_digest.clone(),
            skill_root: self.skill_root.to_string_lossy().to_string(),
            expected_managed_skill_exposure_digest: self
                .expected_managed_skill_exposure_digest
                .clone(),
            mcp_projection_digest: self.mcp_projection_digest.clone(),
            mcp_tools: self.mcp_tools.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PiSessionLocator {
    schema_version: i64,
    session_id: String,
    session_file: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PiManagedSessionState {
    schema_version: i64,
    extension_version: String,
    host_instance_id: String,
    host_binding_generation: u64,
    session_id: String,
    session_file: String,
    cwd: String,
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
    poisoned: AtomicBool,
    streaming: AtomicBool,
    sequence: AtomicU64,
    executable_path: PathBuf,
    builtin_tools: Option<BuiltinToolProcessConfig>,
    config_root: PathBuf,
    binding_path: PathBuf,
    binding_generation: AtomicU64,
    binding_document: RwLock<Option<PiHostBindingDocument>>,
    managed_session_state: RwLock<Option<PiManagedSessionState>>,
    session_id: RwLock<String>,
    session_file: RwLock<PathBuf>,
    model_identity: RwLock<Option<(String, String, String)>>,
    cwd: PathBuf,
}

struct PiHostLaunch<'a> {
    executable: &'a Path,
    cwd: &'a Path,
    private_runtime_dir: &'a Path,
    session_dir: Option<&'a Path>,
    initial_session_file: Option<&'a Path>,
    initial_binding: &'a PiBindingSeed,
    incoming: mpsc::UnboundedSender<PiIncoming>,
    builtin_tools: Option<BuiltinToolProcessConfig>,
}

struct PiProbeRootCleanup(PathBuf);

impl Drop for PiProbeRootCleanup {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct ActivatedPiSession {
    session_id: String,
    session_file: PathBuf,
    model_fingerprint: String,
    binding_document: PiHostBindingDocument,
    skill_command_catalog: Vec<PiReceiptSkill>,
}

fn append_session_directory_argument(command: &mut Command, session_dir: Option<&Path>) {
    if let Some(session_dir) = session_dir {
        command.arg("--session-dir").arg(session_dir);
    }
}

fn append_initial_session_argument(command: &mut Command, session_file: Option<&Path>) {
    if let Some(session_file) = session_file {
        command.arg("--session").arg(session_file);
    }
}

impl PiHost {
    async fn spawn(launch: PiHostLaunch<'_>) -> Result<Arc<Self>> {
        create_private_directory(launch.private_runtime_dir)?;
        if let Some(session_dir) = launch.session_dir {
            create_private_directory(session_dir)?;
        }
        let host_instance_id = uuid::Uuid::new_v4().to_string();
        let config_root = launch
            .private_runtime_dir
            .join("host-config")
            .join(&host_instance_id);
        create_private_directory(&config_root)?;
        let extension_path = config_root.join("rovai-pi-host.ts");
        write_private_file(&extension_path, MANAGED_HOST_EXTENSION.as_bytes())?;
        let binding_path = config_root.join("binding.json");
        let initial_document = launch.initial_binding.document(&host_instance_id, 1);
        write_private_json(&binding_path, &initial_document)?;

        let mut command = Command::new(launch.executable);
        configure_active_runtime_command(&mut command);
        if let Some(config) = &launch.builtin_tools {
            config.configure_command(&mut command)?;
        }
        command
            .args([
                "--mode",
                "rpc",
                "--no-extensions",
                "--no-skills",
                "--no-context-files",
                "--no-prompt-templates",
                "--no-themes",
                "--no-approve",
                "--no-builtin-tools",
                "--extension",
            ])
            .arg(&extension_path);
        append_session_directory_argument(&mut command, launch.session_dir);
        append_initial_session_argument(&mut command, launch.initial_session_file);
        command
            .env("ROVAI_PI_HOST_BINDING_FILE", &binding_path)
            .env("PI_TELEMETRY", "0")
            .current_dir(launch.cwd);
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
            poisoned: AtomicBool::new(false),
            streaming: AtomicBool::new(false),
            sequence: AtomicU64::new(0),
            executable_path: launch.executable.to_path_buf(),
            builtin_tools: launch.builtin_tools,
            config_root,
            binding_path,
            binding_generation: AtomicU64::new(1),
            binding_document: RwLock::new(Some(initial_document)),
            managed_session_state: RwLock::new(None),
            session_id: RwLock::new(String::new()),
            session_file: RwLock::new(PathBuf::new()),
            model_identity: RwLock::new(None),
            cwd: launch.cwd.to_path_buf(),
        });
        Self::spawn_stdout_reader(host.clone(), stdout);
        Self::spawn_stderr_reader(stderr);
        if let Err(error) = host.command("get_state", json!({})).await {
            host.shutdown_and_reap().await;
            return Err(error.context("Pi get_state failed during Host startup"));
        }
        Ok(host)
    }

    fn spawn_stdout_reader(host: Arc<Self>, stdout: ManagedChildStdout) {
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            loop {
                let record = match read_jsonl_record(&mut reader, PI_MAX_JSONL_RECORD_BYTES).await {
                    Ok(Some(record)) => record,
                    _ => break,
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
                                Err(message
                                    .get("error")
                                    .and_then(Value::as_str)
                                    .unwrap_or("Pi RPC command failed")
                                    .chars()
                                    .take(2_000)
                                    .collect())
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

    fn spawn_stderr_reader(stderr: ManagedChildStderr) {
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr);
            while let Ok(Some(_)) = read_jsonl_record(&mut reader, 64 * 1024).await {}
        });
    }

    async fn route_message(&self, message: Value) {
        if message.get("type").and_then(Value::as_str) == Some("extension_ui_request")
            && message.get("method").and_then(Value::as_str) == Some("setStatus")
            && message.get("statusKey").and_then(Value::as_str)
                == Some("rovai-managed-session-state")
        {
            let result = self.capture_managed_session_state(&message).await;
            if result.is_err() {
                self.poisoned.store(true, Ordering::Release);
            }
            return;
        }
        let Some(owner) = self.owner.read().await.clone() else {
            return;
        };
        let native_session_id = self.session_id.read().await.clone();
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed) + 1;
        let _ = self.incoming.send(PiIncoming::Message {
            host_instance_id: self.host_instance_id.clone(),
            agent_run_id: owner.agent_run_id,
            execution_epoch: owner.execution_epoch,
            native_session_id,
            native_prompt_id: owner.native_prompt_id,
            delivery_id: owner.delivery_id,
            sequence,
            message,
        });
    }

    async fn capture_managed_session_state(&self, message: &Value) -> Result<()> {
        let state: PiManagedSessionState = serde_json::from_str(
            message
                .get("statusText")
                .and_then(Value::as_str)
                .context("Pi managed Session state omitted statusText")?,
        )
        .context("Pi managed Session state is invalid")?;
        let binding = self
            .binding_document
            .read()
            .await
            .clone()
            .context("Pi managed Session state has no active binding")?;
        if state.schema_version != 1
            || state.extension_version != PI_HOST_EXTENSION_VERSION
            || state.host_instance_id != self.host_instance_id
            || state.host_binding_generation != binding.host_binding_generation
            || state.session_id.trim().is_empty()
            || !Path::new(&state.session_file).is_absolute()
            || !Path::new(&state.cwd).is_absolute()
        {
            bail!("Pi managed Session state failed Host/Binding validation");
        }
        *self.managed_session_state.write().await = Some(state);
        Ok(())
    }

    pub(super) async fn command(&self, command_type: &str, fields: Value) -> Result<Value> {
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
        match timeout(PI_COMMAND_TIMEOUT, receiver).await {
            Ok(Ok(Ok(response))) => Ok(response),
            Ok(Ok(Err(message))) => bail!("{command_type}: {message}"),
            Ok(Err(_)) => bail!("Pi RPC response channel closed: {command_type}"),
            Err(_) => {
                self.pending.lock().await.remove(&id);
                self.poisoned.store(true, Ordering::Release);
                bail!("Pi RPC command timed out: {command_type}")
            }
        }
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

    async fn activate(
        &self,
        seed: &PiBindingSeed,
        locator_root: &Path,
        frozen_runtime: &FrozenAgentRuntimeConfig,
        expected_managed_skills: &[(String, PathBuf)],
    ) -> Result<ActivatedPiSession> {
        if !self.is_quiescent().await {
            bail!("Pi Host is not quiescent for Session activation");
        }
        let generation = self.binding_generation.fetch_add(1, Ordering::AcqRel) + 1;
        let document = seed.document(&self.host_instance_id, generation);
        write_private_json(&self.binding_path, &document)?;
        *self.binding_document.write().await = Some(document.clone());
        *self.managed_session_state.write().await = None;

        if let Some(expected_session_id) = seed.expected_native_session_id.as_deref() {
            let locator = read_session_locator(locator_root, expected_session_id, &self.cwd)?;
            let response = self
                .command(
                    "switch_session",
                    json!({"sessionPath": locator.session_file}),
                )
                .await?;
            ensure_session_replacement_succeeded(&response, "switch_session")?;
        } else {
            let response = self.command("new_session", json!({})).await?;
            ensure_session_replacement_succeeded(&response, "new_session")?;
        }
        let available_models = self.command("get_available_models", json!({})).await?;
        if frozen_runtime.model.model_id != PI_RUNTIME_DEFAULT_MODEL_ID {
            let (provider, model_id) = parse_explicit_model_id(&frozen_runtime.model.model_id)?;
            let found = available_models
                .pointer("/data/models")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .any(|model| {
                    model.get("provider").and_then(Value::as_str) == Some(provider.as_str())
                        && model.get("id").and_then(Value::as_str) == Some(model_id.as_str())
                });
            if !found {
                bail!("Pi explicit provider/model is unavailable");
            }
            self.command(
                "set_model",
                json!({"provider": provider, "modelId": model_id}),
            )
            .await?;
        }
        if let Some(thinking_level) = frozen_runtime
            .model
            .options
            .get("thinking_level")
            .and_then(Value::as_str)
        {
            self.command("set_thinking_level", json!({"level": thinking_level}))
                .await?;
        }
        let state = self.command("get_state", json!({})).await?;
        let (session_id, session_file, provider, model_id, thinking_level) = validate_host_state(
            &state,
            seed.expected_native_session_id.as_deref(),
            locator_root,
            &self.cwd,
            &frozen_runtime.model.model_id,
        )?;
        validate_managed_session_state(
            self.managed_session_state
                .read()
                .await
                .as_ref()
                .context("Pi managed Extension did not report Session state")?,
            &document,
            &session_id,
            &session_file,
            &self.cwd,
        )?;
        write_session_locator(
            locator_root,
            &session_id,
            &session_file,
            &self.cwd,
            seed.expected_native_session_id.is_some(),
        )?;
        let commands = self.command("get_commands", json!({})).await?;
        let skill_command_catalog = validate_skill_commands(
            &commands,
            &seed.skill_root,
            &self.cwd,
            expected_managed_skills,
        )?;
        let model_fingerprint =
            short_digest(format!("{provider}\0{model_id}\0{thinking_level}").as_bytes());
        *self.session_id.write().await = session_id.clone();
        *self.session_file.write().await = session_file.clone();
        *self.model_identity.write().await = Some((provider, model_id, thinking_level));
        Ok(ActivatedPiSession {
            session_id,
            session_file,
            model_fingerprint,
            binding_document: document,
            skill_command_catalog,
        })
    }

    async fn bind(&self, owner: PiRuntimeOwner) -> Result<()> {
        let mut current = self.owner.write().await;
        if current.is_some() {
            bail!("Pi Host already has an active AgentRun owner");
        }
        *current = Some(owner);
        Ok(())
    }

    async fn unbind_and_clear(&self, owner: &PiRuntimeOwner) -> Result<()> {
        let mut current = self.owner.write().await;
        if current.as_ref().is_some_and(|current| current != owner) {
            bail!("Pi Host owner changed before cleanup");
        }
        let binding = self
            .binding_document
            .read()
            .await
            .clone()
            .context("Pi Host binding disappeared before cleanup")?;
        if binding.agent_run_id != owner.agent_run_id
            || binding.execution_epoch != owner.execution_epoch
        {
            bail!("Pi Host binding changed before cleanup");
        }
        std::fs::remove_file(&self.binding_path)
            .context("failed to clear the private Pi Host binding")?;
        *self.binding_document.write().await = None;
        *current = None;
        Ok(())
    }

    async fn detach_and_flush_ingress(&self, owner: &PiRuntimeOwner) -> bool {
        let mut current = self.owner.write().await;
        if current.as_ref() != Some(owner) {
            return false;
        }
        *current = None;
        let (acknowledgement, receiver) = oneshot::channel();
        if self
            .incoming
            .send(PiIncoming::IngressFlushed { acknowledgement })
            .is_err()
        {
            return false;
        }
        drop(current);
        timeout(Duration::from_secs(2), receiver).await.is_ok()
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
        self.alive.load(Ordering::Acquire) && !self.poisoned.load(Ordering::Acquire)
    }

    pub(crate) async fn is_quiescent(&self) -> bool {
        self.is_alive()
            && !self.streaming.load(Ordering::Acquire)
            && self.pending.lock().await.is_empty()
            && self.owner.read().await.is_none()
    }

    pub(crate) async fn force_reap_until(&self, deadline: tokio::time::Instant) -> bool {
        self.alive.store(false, Ordering::Release);
        let Ok(mut child) = tokio::time::timeout_at(deadline, self.child.lock()).await else {
            return false;
        };
        let _ = child.force_terminate_tree();
        let reaped = matches!(
            tokio::time::timeout_at(deadline, child.wait()).await,
            Ok(Ok(_))
        );
        let _ = std::fs::remove_dir_all(&self.config_root);
        reaped
    }

    async fn shutdown_and_reap_with_status(&self) -> bool {
        self.alive.store(false, Ordering::Release);
        let mut child = self.child.lock().await;
        let _ = child.request_graceful_termination();
        let reaped_gracefully = matches!(
            timeout(Duration::from_secs(3), child.wait()).await,
            Ok(Ok(_))
        );
        if !reaped_gracefully {
            let _ = child.force_terminate_tree();
            let _ = timeout(Duration::from_secs(1), child.wait()).await;
        }
        let _ = child.force_terminate_tree();
        let _ = std::fs::remove_dir_all(&self.config_root);
        reaped_gracefully
    }

    pub(crate) async fn shutdown_and_reap(&self) {
        let _ = self.shutdown_and_reap_with_status().await;
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct PiMcpAuthorization {
    host_instance_id: String,
    host_binding_generation: u64,
    agent_run_id: String,
    execution_epoch: i64,
    native_binding_generation: i64,
    mcp_projection_digest: String,
    runtime_name: String,
    server_id: String,
    server_name: String,
    tool_name: String,
    tool_call_id: String,
    arguments_digest: String,
}

pub struct PiRuntime {
    owner: PiRuntimeOwner,
    camp_id: String,
    host: Arc<PiHost>,
    mcp: Arc<PiMcpBridge>,
    binding_document: PiHostBindingDocument,
    expected_managed_skills: Vec<(String, PathBuf)>,
    skill_command_catalog: Vec<PiReceiptSkill>,
    final_message: RwLock<Option<String>>,
    final_stop_reason: RwLock<Option<String>>,
    approval_handshake: AtomicBool,
    receipt_committed: AtomicBool,
    pending_mcp_approvals: Mutex<HashMap<String, PiMcpAuthorization>>,
    authorized_mcp_calls: Mutex<HashSet<PiMcpAuthorization>>,
    session_id: String,
    session_file: PathBuf,
    model_fingerprint: String,
}

impl PiRuntime {
    fn from_host(
        owner: PiRuntimeOwner,
        camp_id: String,
        host: Arc<PiHost>,
        mcp: Arc<PiMcpBridge>,
        activation: ActivatedPiSession,
        expected_managed_skills: Vec<(String, PathBuf)>,
    ) -> Arc<Self> {
        Arc::new(Self {
            owner,
            camp_id,
            host,
            mcp,
            binding_document: activation.binding_document,
            expected_managed_skills,
            skill_command_catalog: activation.skill_command_catalog,
            final_message: RwLock::new(None),
            final_stop_reason: RwLock::new(None),
            approval_handshake: AtomicBool::new(false),
            receipt_committed: AtomicBool::new(false),
            pending_mcp_approvals: Mutex::new(HashMap::new()),
            authorized_mcp_calls: Mutex::new(HashSet::new()),
            session_id: activation.session_id,
            session_file: activation.session_file,
            model_fingerprint: activation.model_fingerprint,
        })
    }

    pub async fn start_prompt(&self, message: &str) -> Result<()> {
        *self.final_message.write().await = None;
        *self.final_stop_reason.write().await = None;
        self.approval_handshake.store(false, Ordering::Release);
        self.receipt_committed.store(false, Ordering::Release);
        let response = self
            .host
            .command("prompt", json!({"message": message}))
            .await?;
        if response.get("command").and_then(Value::as_str) != Some("prompt") {
            bail!("Pi prompt response has the wrong command identity");
        }
        if !self.receipt_committed() {
            self.host.poisoned.store(true, Ordering::Release);
            bail!("Pi prompt returned without a committed managed input receipt");
        }
        Ok(())
    }

    pub async fn cancel(&self) -> Result<()> {
        self.mcp.shutdown().await;
        self.host
            .send_command_without_waiting("abort", json!({}))
            .await
    }

    pub(crate) async fn detach_and_flush_ingress(&self) -> bool {
        self.host.detach_and_flush_ingress(&self.owner).await
    }

    pub async fn respond(&self, id: Value, response: Value) -> Result<()> {
        if response.get("type").and_then(Value::as_str) != Some("extension_ui_response")
            || response.get("id") != Some(&id)
        {
            bail!("Pi Extension response failed Native Request fencing");
        }
        if let Some(id) = value_id(&id)
            && let Some(authorization) = self.pending_mcp_approvals.lock().await.remove(&id)
            && response.get("confirmed").and_then(Value::as_bool) == Some(true)
        {
            self.authorized_mcp_calls.lock().await.insert(authorization);
        }
        self.host.send(response).await
    }

    pub async fn observe(&self, message: &Value) -> Result<Option<CompletedAcpAction>> {
        match message.get("type").and_then(Value::as_str) {
            Some("extension_ui_request")
                if message.get("method").and_then(Value::as_str) == Some("setStatus")
                    && message.get("statusKey").and_then(Value::as_str)
                        == Some("rovai-managed-host")
                    && message.get("statusText").and_then(Value::as_str)
                        == Some(PI_HOST_EXTENSION_VERSION) =>
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

    pub fn receipt_committed(&self) -> bool {
        self.receipt_committed.load(Ordering::Acquire)
    }

    pub(crate) fn mark_failed_closed(&self) {
        self.host.poisoned.store(true, Ordering::Release);
    }

    pub fn host_instance_id(&self) -> &str {
        self.host.host_instance_id()
    }

    pub fn host_binding_generation(&self) -> u64 {
        self.binding_document.host_binding_generation
    }

    pub fn native_binding_generation(&self) -> i64 {
        self.binding_document.native_binding_generation
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn model_fingerprint(&self) -> &str {
        &self.model_fingerprint
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

    pub(crate) async fn register_mcp_approval(&self, ui_id: &str, envelope: &Value) -> Result<()> {
        let authorization = self.validate_mcp_envelope(envelope)?;
        let replaced = self
            .pending_mcp_approvals
            .lock()
            .await
            .insert(ui_id.to_string(), authorization);
        if replaced.is_some() {
            bail!("Pi MCP Approval UI identity was reused");
        }
        Ok(())
    }

    pub(crate) fn validate_managed_receipt(&self, receipt: &Value) -> Result<(String, String)> {
        let receipt: PiManagedInputReceipt = serde_json::from_value(receipt.clone())
            .context("Pi managed input receipt shape is invalid")?;
        if receipt.schema_version != 1
            || receipt.extension_version != PI_HOST_EXTENSION_VERSION
            || receipt.host_instance_id != self.host_instance_id()
            || receipt.host_binding_generation != self.host_binding_generation()
            || receipt.agent_run_id != self.owner.agent_run_id
            || receipt.execution_epoch != self.owner.execution_epoch
            || receipt.native_binding_id != self.binding_document.native_binding_id
            || receipt.native_binding_generation != self.binding_document.native_binding_generation
            || receipt.runtime_input_delivery_id != self.binding_document.runtime_input_delivery_id
            || receipt.native_prompt_id != self.binding_document.native_prompt_id
            || receipt.native_session_id != self.session_id
            || receipt.native_session_file_digest != session_file_path_digest(&self.session_file)?
            || Path::new(&receipt.cwd).canonicalize()? != self.host.cwd.canonicalize()?
            || receipt.bootstrap_evidence_id != self.binding_document.bootstrap_evidence_id
            || receipt.bootstrap_payload_digest != self.binding_document.bootstrap_payload_digest
            || receipt.skill_exposure_digest
                != self.binding_document.expected_managed_skill_exposure_digest
            || receipt.mcp_projection_digest != self.mcp.projection_digest()
            || !is_hex_digest(&receipt.pi_base_system_prompt_digest)
            || !is_hex_digest(&receipt.effective_system_prompt_digest)
        {
            bail!("Pi managed input receipt failed Host/Run/Binding validation");
        }
        let expected_active_tools = NATIVE_TOOL_NAMES
            .into_iter()
            .map(str::to_string)
            .chain(
                self.mcp
                    .tools()
                    .iter()
                    .map(|tool| tool.runtime_name.clone()),
            )
            .collect::<Vec<_>>();
        if receipt.active_tool_names != expected_active_tools {
            bail!("Pi managed input receipt active Tool catalog is invalid");
        }
        let expected_mcp_catalog = self
            .mcp
            .tools()
            .iter()
            .map(PiReceiptMcpTool::from)
            .collect::<Vec<_>>();
        if receipt.mcp_tool_catalog != expected_mcp_catalog
            || canonical_json_digest(&serde_json::to_value(&receipt.mcp_tool_catalog)?)?
                != receipt.mcp_tool_catalog_digest
        {
            bail!("Pi managed input receipt MCP catalog is invalid");
        }
        if canonical_json_digest(&serde_json::to_value(&receipt.skill_catalog)?)?
            != receipt.skill_catalog_digest
        {
            bail!("Pi managed input receipt Skill catalog digest is invalid");
        }
        if !skill_catalogs_match(&receipt.skill_catalog, &self.skill_command_catalog) {
            bail!("Pi managed input receipt Skill catalog changed after get_commands");
        }
        validate_receipt_skills(
            &receipt.skill_catalog,
            Path::new(&self.binding_document.skill_root),
            &self.host.cwd,
            &self.expected_managed_skills,
        )?;
        let expected_binding_digest =
            canonical_json_digest(&serde_json::to_value(&self.binding_document)?)?;
        if receipt.binding_document_digest != expected_binding_digest {
            bail!("Pi managed input receipt binding document digest is invalid");
        }
        let receipt_value = serde_json::to_value(&receipt)?;
        let receipt_digest = canonical_json_digest(&receipt_value)?;
        let nonce = managed_receipt_nonce(&receipt_value)?;
        Ok((receipt_digest, nonce))
    }

    pub(crate) fn mark_receipt_committed(&self) {
        self.receipt_committed.store(true, Ordering::Release);
    }

    pub(crate) fn mcp_activation_failures(&self) -> &[PiMcpActivationFailure] {
        self.mcp.activation_failures()
    }

    pub(crate) async fn execute_mcp_bridge(&self, envelope: &Value) -> Result<Value> {
        let result = async {
            let authorization = self.validate_mcp_envelope(envelope)?;
            if !self
                .authorized_mcp_calls
                .lock()
                .await
                .remove(&authorization)
            {
                bail!("Pi MCP call has no one-shot Durable Approval");
            }
            let arguments = envelope
                .get("arguments")
                .cloned()
                .context("Pi MCP bridge omitted arguments")?;
            self.mcp
                .execute(&authorization.runtime_name, arguments)
                .await
        }
        .await;
        if result.is_err() {
            self.mark_failed_closed();
        }
        result
    }

    fn validate_mcp_envelope(&self, envelope: &Value) -> Result<PiMcpAuthorization> {
        let envelope: PiMcpEnvelope =
            serde_json::from_value(envelope.clone()).context("Pi MCP envelope shape is invalid")?;
        if envelope.schema_version != 1
            || envelope.extension_version != PI_HOST_EXTENSION_VERSION
            || envelope.kind != "mcp_tool"
            || envelope.host_instance_id != self.host_instance_id()
            || envelope.host_binding_generation != self.host_binding_generation()
            || envelope.agent_run_id != self.owner.agent_run_id
            || envelope.execution_epoch != self.owner.execution_epoch
            || envelope.native_binding_generation != self.binding_document.native_binding_generation
            || envelope.mcp_projection_digest != self.mcp.projection_digest()
            || canonical_json_digest(&envelope.arguments)? != envelope.arguments_digest
        {
            bail!("Pi MCP envelope failed Run/Binding fencing");
        }
        let tool = self
            .mcp
            .tool(&envelope.runtime_name)
            .context("Pi MCP envelope names an unknown Tool")?;
        if tool.server_id != envelope.server_id
            || tool.server_name != envelope.server_name
            || tool.tool_name != envelope.tool_name
        {
            bail!("Pi MCP envelope source identity is invalid");
        }
        Ok(PiMcpAuthorization {
            host_instance_id: envelope.host_instance_id,
            host_binding_generation: envelope.host_binding_generation,
            agent_run_id: envelope.agent_run_id,
            execution_epoch: envelope.execution_epoch,
            native_binding_generation: envelope.native_binding_generation,
            mcp_projection_digest: envelope.mcp_projection_digest,
            runtime_name: envelope.runtime_name,
            server_id: envelope.server_id,
            server_name: envelope.server_name,
            tool_name: envelope.tool_name,
            tool_call_id: envelope.tool_call_id,
            arguments_digest: envelope.arguments_digest,
        })
    }

    fn belongs_to_camp(&self, camp_id: &str) -> bool {
        self.camp_id == camp_id
    }

    async fn cleanup_for_release(&self) -> Result<()> {
        let session_result = validate_native_session_file(
            &self.session_file,
            &self.session_id,
            &self.host.cwd,
            true,
        );
        if session_result.is_err() {
            self.mark_failed_closed();
        }
        self.mcp.shutdown().await;
        self.pending_mcp_approvals.lock().await.clear();
        self.authorized_mcp_calls.lock().await.clear();
        let binding_result = self.host.unbind_and_clear(&self.owner).await;
        session_result?;
        binding_result
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PiMcpEnvelope {
    schema_version: i64,
    extension_version: String,
    kind: String,
    host_instance_id: String,
    host_binding_generation: u64,
    agent_run_id: String,
    execution_epoch: i64,
    native_binding_generation: i64,
    mcp_projection_digest: String,
    runtime_name: String,
    server_id: String,
    server_name: String,
    tool_name: String,
    tool_call_id: String,
    arguments: Value,
    arguments_digest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PiManagedInputReceipt {
    schema_version: i64,
    extension_version: String,
    host_instance_id: String,
    host_binding_generation: u64,
    agent_run_id: String,
    execution_epoch: i64,
    native_binding_id: String,
    native_binding_generation: i64,
    runtime_input_delivery_id: String,
    native_prompt_id: String,
    native_session_id: String,
    native_session_file_digest: String,
    cwd: String,
    bootstrap_evidence_id: String,
    bootstrap_payload_digest: String,
    skill_exposure_digest: String,
    pi_base_system_prompt_digest: String,
    effective_system_prompt_digest: String,
    skill_catalog: Vec<PiReceiptSkill>,
    skill_catalog_digest: String,
    active_tool_names: Vec<String>,
    mcp_tool_catalog: Vec<PiReceiptMcpTool>,
    mcp_tool_catalog_digest: String,
    mcp_projection_digest: String,
    binding_document_digest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PiReceiptSkill {
    name: String,
    description_digest: String,
    entry_path: String,
    model_visible: bool,
}

fn skill_catalogs_match(observed: &[PiReceiptSkill], expected: &[PiReceiptSkill]) -> bool {
    observed.len() == expected.len()
        && observed.iter().zip(expected).all(|(observed, expected)| {
            observed.name == expected.name
                && observed.description_digest == expected.description_digest
                && observed.entry_path == expected.entry_path
                && observed.model_visible == expected.model_visible
        })
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PiReceiptMcpTool {
    server_id: String,
    server_name: String,
    tool_name: String,
    runtime_name: String,
    description_digest: String,
    input_schema_digest: String,
}

impl From<&PiMcpToolDefinition> for PiReceiptMcpTool {
    fn from(value: &PiMcpToolDefinition) -> Self {
        Self {
            server_id: value.server_id.clone(),
            server_name: value.server_name.clone(),
            tool_name: value.tool_name.clone(),
            runtime_name: value.runtime_name.clone(),
            description_digest: value.description_digest.clone(),
            input_schema_digest: value.input_schema_digest.clone(),
        }
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
    pub native_session_id: Option<&'a str>,
    pub delivery_id: &'a str,
    pub native_prompt_id: &'a str,
    pub native_binding_id: &'a str,
    pub native_binding_generation: i64,
    pub bootstrap: &'a PreparedSessionBootstrap,
    pub skill_exposure: &'a PreparedSkillExposure,
    pub mcp_projection: &'a PreparedMcpProjection,
    pub builtin_tools: &'a BuiltinToolProcessConfig,
}

impl PiRpcRuntimeAdapter {
    pub fn deferred(
        data_dir: &Path,
        incoming: mpsc::UnboundedSender<PiIncoming>,
        fleet: Arc<AgentRuntimeFleetManager>,
    ) -> Self {
        Self {
            active: Mutex::new(HashMap::new()),
            runtime_creation: Mutex::new(()),
            incoming,
            fleet,
            private_runtime_dir: data_dir.join("runtime/pi"),
        }
    }

    pub fn initialize_storage(&self) -> Result<()> {
        create_private_directory(&self.private_runtime_dir)
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
            let _ = existing.cleanup_for_release().await;
            self.active.lock().await.remove(request.agent_run_id);
            self.fleet
                .release(request.agent_run_id, epoch, FleetReleaseDisposition::Stop)
                .await;
        }
        let skill_root = request.cwd.join(".pi/skills");
        create_private_or_workspace_directory(&skill_root)?;
        let expected_managed_skills = expected_managed_skills(request.skill_exposure)?;
        let mcp = PiMcpBridge::start(request.mcp_projection).await?;
        let bootstrap_payload_digest =
            format!("{:x}", Sha256::digest(request.bootstrap.payload.as_bytes()));
        let seed = PiBindingSeed {
            agent_run_id: request.agent_run_id.to_string(),
            execution_epoch: request.execution_epoch,
            native_binding_id: request.native_binding_id.to_string(),
            native_binding_generation: request.native_binding_generation,
            runtime_input_delivery_id: request.delivery_id.to_string(),
            native_prompt_id: request.native_prompt_id.to_string(),
            expected_native_session_id: request.native_session_id.map(str::to_string),
            bootstrap_evidence_id: request.bootstrap.evidence_id.clone(),
            bootstrap: request.bootstrap.payload.clone(),
            bootstrap_payload_digest,
            skill_root,
            expected_managed_skill_exposure_digest: request.skill_exposure.digest.clone(),
            mcp_projection_digest: request.mcp_projection.projection_digest.clone(),
            mcp_tools: mcp.tools().to_vec(),
        };
        let locator_root =
            session_locator_root(&self.private_runtime_dir, request.camp_id, request.agent_id)?;
        let workspace_key = canonical_workspace_key(request.cwd)?;
        let lease = self
            .fleet
            .acquire(
                FleetAcquireRequest {
                    agent_run_id: request.agent_run_id.to_string(),
                    execution_epoch: request.execution_epoch,
                    adapter_kind: AdapterKind::Pi,
                    compatibility: RuntimeCompatibilityKey::workspace(
                        request.camp_id,
                        request.agent_id,
                        workspace_key,
                        request.runtime_compatibility_digest,
                    ),
                },
                || async {
                    let host = PiHost::spawn(PiHostLaunch {
                        executable: Path::new(&request.frozen_runtime.executable_path),
                        cwd: request.cwd,
                        private_runtime_dir: &self.private_runtime_dir,
                        session_dir: None,
                        initial_session_file: None,
                        initial_binding: &seed,
                        incoming: self.incoming.clone(),
                        builtin_tools: Some(request.builtin_tools.clone()),
                    })
                    .await?;
                    Ok(RuntimeProcessHost::Pi(host))
                },
            )
            .await;
        let lease = match lease {
            Ok(lease) => lease,
            Err(error) => {
                mcp.shutdown().await;
                return Err(error);
            }
        };
        let host = lease.host.into_pi()?;
        let activation = match host
            .activate(
                &seed,
                &locator_root,
                request.frozen_runtime,
                &expected_managed_skills,
            )
            .await
        {
            Ok(activation) => activation,
            Err(error) => {
                mcp.shutdown().await;
                self.fleet
                    .release(
                        request.agent_run_id,
                        request.execution_epoch,
                        FleetReleaseDisposition::Stop,
                    )
                    .await;
                return Err(error);
            }
        };
        let owner = PiRuntimeOwner {
            agent_run_id: request.agent_run_id.to_string(),
            execution_epoch: request.execution_epoch,
            native_prompt_id: request.native_prompt_id.to_string(),
            delivery_id: request.delivery_id.to_string(),
        };
        if let Err(error) = host.bind(owner.clone()).await {
            mcp.shutdown().await;
            self.fleet
                .release(
                    request.agent_run_id,
                    request.execution_epoch,
                    FleetReleaseDisposition::Stop,
                )
                .await;
            return Err(error);
        }
        let runtime = PiRuntime::from_host(
            owner,
            request.camp_id.to_string(),
            host,
            mcp,
            activation,
            expected_managed_skills,
        );
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
        let disposition = if let Some(runtime) = runtime {
            if runtime.cleanup_for_release().await.is_ok() {
                FleetReleaseDisposition::Reusable
            } else {
                FleetReleaseDisposition::Stop
            }
        } else {
            FleetReleaseDisposition::Stop
        };
        self.fleet
            .release(agent_run_id, execution_epoch, disposition)
            .await;
    }

    pub async fn forget_agent_run(&self, agent_run_id: &str, execution_epoch: i64) {
        if let Some(runtime) = self.take_runtime(agent_run_id, execution_epoch).await {
            let _ = runtime.cleanup_for_release().await;
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
            let epoch = runtime.agent_run_epoch();
            let run_id = runtime.owner.agent_run_id.clone();
            let _ = runtime.cleanup_for_release().await;
            self.fleet
                .release(&run_id, epoch, FleetReleaseDisposition::Stop)
                .await;
        }
        self.fleet.invalidate_camp(camp_id).await;
        if let Ok(camp_scope) = scope_key("camp", camp_id) {
            let _ =
                std::fs::remove_dir_all(self.private_runtime_dir.join("sessions").join(camp_scope));
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
            let _ = runtime.cleanup_for_release().await;
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

pub(crate) struct PiMachineReadyProbe {
    pub model_fingerprint: String,
    pub capabilities: Vec<String>,
    pub raw_model_catalog: Value,
}

pub(crate) async fn machine_ready_probe(executable: &Path) -> Result<PiMachineReadyProbe> {
    let probe_root = std::env::temp_dir().join(format!("rovai-pi-probe-{}", uuid::Uuid::new_v4()));
    let _probe_root_cleanup = PiProbeRootCleanup(probe_root.clone());
    let private_runtime_dir = probe_root.join("private");
    let session_dir = probe_root.join("sessions");
    let skill_root = probe_root.join(".pi/skills");
    create_private_directory(&private_runtime_dir)?;
    create_private_directory(&session_dir)?;
    let initial_session_file = session_dir.join("machine-ready-session.jsonl");
    write_private_file(&initial_session_file, b"")?;
    std::fs::create_dir_all(&skill_root)?;
    let bootstrap = "Rovai Pi no-Prompt Machine Ready probe.".to_string();
    let seed = PiBindingSeed {
        agent_run_id: uuid::Uuid::new_v4().to_string(),
        execution_epoch: 1,
        native_binding_id: uuid::Uuid::new_v4().to_string(),
        native_binding_generation: 1,
        runtime_input_delivery_id: "pi-probe-delivery".to_string(),
        native_prompt_id: "pi-probe-prompt".to_string(),
        expected_native_session_id: None,
        bootstrap_evidence_id: uuid::Uuid::new_v4().to_string(),
        bootstrap_payload_digest: format!("{:x}", Sha256::digest(bootstrap.as_bytes())),
        bootstrap,
        skill_root,
        expected_managed_skill_exposure_digest: "pi-probe-empty-skills".to_string(),
        mcp_projection_digest: "pi-probe-empty-mcp".to_string(),
        mcp_tools: Vec::new(),
    };
    let (incoming, _receiver) = mpsc::unbounded_channel();
    let host = PiHost::spawn(PiHostLaunch {
        executable,
        cwd: &probe_root,
        private_runtime_dir: &private_runtime_dir,
        session_dir: Some(&session_dir),
        initial_session_file: Some(&initial_session_file),
        initial_binding: &seed,
        incoming,
        builtin_tools: None,
    })
    .await?;
    let result = async {
        let models_response = host.command("get_available_models", json!({})).await?;
        let raw_model_catalog = models_response
            .pointer("/data/models")
            .cloned()
            .context("Pi probe model catalog is unavailable")?;
        let models = raw_model_catalog
            .as_array()
            .filter(|models| !models.is_empty())
            .context("Pi probe model catalog is empty or malformed")?;
        if models.iter().any(|model| {
            model
                .get("provider")
                .and_then(Value::as_str)
                .is_none_or(|provider| provider.trim().is_empty())
                || model
                    .get("id")
                    .and_then(Value::as_str)
                    .is_none_or(|id| id.trim().is_empty())
        }) {
            bail!("Pi probe model catalog contains an invalid entry");
        }
        let state = host.command("get_state", json!({})).await?;
        let locator_root = private_runtime_dir.join("probe-locator");
        let (session_id, session_file, provider, model, thinking) = validate_host_state(
            &state,
            None,
            &locator_root,
            &probe_root,
            PI_RUNTIME_DEFAULT_MODEL_ID,
        )?;
        let probe_binding = host
            .binding_document
            .read()
            .await
            .clone()
            .context("Pi probe Host binding disappeared")?;
        validate_managed_session_state(
            host.managed_session_state
                .read()
                .await
                .as_ref()
                .context("Pi probe managed Extension did not report Session state")?,
            &probe_binding,
            &session_id,
            &session_file,
            &probe_root,
        )?;
        validate_probe_session_file_directory(&session_file, &session_dir)?;
        let canonical_session_file = session_file
            .canonicalize()
            .context("Pi probe empty Session did not materialize canonically")?;
        write_session_locator(
            &locator_root,
            &session_id,
            &canonical_session_file,
            &probe_root,
            true,
        )?;
        if !models.iter().any(|entry| {
            entry.get("provider").and_then(Value::as_str) == Some(provider.as_str())
                && entry.get("id").and_then(Value::as_str) == Some(model.as_str())
        }) {
            bail!("Pi current model is absent from the available model catalog");
        }

        *host.managed_session_state.write().await = None;
        let replacement = host.command("new_session", json!({})).await?;
        ensure_session_replacement_succeeded(&replacement, "new_session")?;
        let replacement_state = host.command("get_state", json!({})).await?;
        let (replacement_id, replacement_file, _, _, _) = validate_host_state(
            &replacement_state,
            None,
            &locator_root,
            &probe_root,
            PI_RUNTIME_DEFAULT_MODEL_ID,
        )?;
        validate_probe_session_file_directory(&replacement_file, &session_dir)?;
        validate_managed_session_state(
            host.managed_session_state
                .read()
                .await
                .as_ref()
                .context("Pi probe replacement Session state was not reported")?,
            &probe_binding,
            &replacement_id,
            &replacement_file,
            &probe_root,
        )?;
        if replacement_id == session_id
            || canonical_or_future_session_path(&replacement_file)?
                == canonical_or_future_session_path(&session_file)?
        {
            bail!("Pi probe new_session did not replace the Native Session identity");
        }

        *host.managed_session_state.write().await = None;
        let switched = host
            .command(
                "switch_session",
                json!({"sessionPath": canonical_session_file.to_string_lossy().to_string()}),
            )
            .await?;
        ensure_session_replacement_succeeded(&switched, "switch_session")?;
        let restored_state = host.command("get_state", json!({})).await?;
        // Pi get_state reports the Session identity and file, but not cwd.
        // validate_host_state therefore verifies cwd against the restored
        // Session file header while also matching the private exact locator.
        let (restored_id, restored_file, _, _, _) = validate_host_state(
            &restored_state,
            Some(&session_id),
            &locator_root,
            &probe_root,
            PI_RUNTIME_DEFAULT_MODEL_ID,
        )?;
        if restored_id != session_id || restored_file.canonicalize()? != canonical_session_file {
            bail!("Pi probe switch_session did not restore the exact Native Session");
        }
        validate_managed_session_state(
            host.managed_session_state
                .read()
                .await
                .as_ref()
                .context("Pi probe restored Session state was not reported")?,
            &probe_binding,
            &restored_id,
            &restored_file,
            &probe_root,
        )?;

        Ok(PiMachineReadyProbe {
            model_fingerprint: short_digest(format!("{provider}\0{model}\0{thinking}").as_bytes()),
            raw_model_catalog,
            capabilities: vec![
                PI_PROTOCOL_VERSION.to_string(),
                "pi.rpc.host".to_string(),
                "pi.rpc.managed_extension".to_string(),
                "pi.rpc.get_state".to_string(),
                "model.dynamic_catalog".to_string(),
                "session.new".to_string(),
                "conversation.exact_resume".to_string(),
            ],
        })
    }
    .await;
    let reaped_gracefully = host.shutdown_and_reap_with_status().await;
    let cleanup = std::fs::remove_dir_all(&probe_root)
        .context("failed to remove the private Pi probe Session/config root");
    match result {
        Ok(observation) => {
            if !reaped_gracefully {
                bail!("Pi probe Host did not shutdown and reap within the grace period");
            }
            cleanup?;
            Ok(observation)
        }
        Err(error) => {
            let _ = cleanup;
            Err(error)
        }
    }
}

pub(crate) fn managed_receipt_nonce(receipt: &Value) -> Result<String> {
    let canonical = canonical_json(receipt.clone())?;
    Ok(format!(
        "{:x}",
        Sha256::digest(format!("rovai-pi-managed-input-receipt-v1\n{canonical}").as_bytes())
    ))
}

fn canonical_json(value: Value) -> Result<String> {
    fn canonicalize(value: Value) -> Value {
        match value {
            Value::Array(values) => Value::Array(values.into_iter().map(canonicalize).collect()),
            Value::Object(values) => {
                let mut entries = values.into_iter().collect::<Vec<_>>();
                entries.sort_by(|left, right| left.0.cmp(&right.0));
                Value::Object(
                    entries
                        .into_iter()
                        .map(|(key, value)| (key, canonicalize(value)))
                        .collect(),
                )
            }
            value => value,
        }
    }
    Ok(serde_json::to_string(&canonicalize(value))?)
}

fn expected_managed_skills(exposure: &PreparedSkillExposure) -> Result<Vec<(String, PathBuf)>> {
    let mut values = exposure
        .snapshot
        .skills
        .iter()
        .filter(|skill| skill.group_key == "pi" && skill.status == "ready")
        .map(|skill| {
            Ok((
                skill.name.clone(),
                PathBuf::from(
                    skill
                        .entry_path
                        .as_deref()
                        .context("ready Pi Skill has no entry path")?,
                ),
            ))
        })
        .collect::<Result<Vec<_>>>()?;
    values.sort_by(|left, right| left.0.cmp(&right.0).then(left.1.cmp(&right.1)));
    Ok(values)
}

fn validate_skill_commands(
    response: &Value,
    skill_root: &Path,
    workspace: &Path,
    expected_managed_skills: &[(String, PathBuf)],
) -> Result<Vec<PiReceiptSkill>> {
    let commands = response
        .pointer("/data/commands")
        .and_then(Value::as_array)
        .context("Pi get_commands omitted commands")?;
    let mut receipt = Vec::new();
    for command in commands
        .iter()
        .filter(|command| command.get("source").and_then(Value::as_str) == Some("skill"))
    {
        let name = command
            .get("name")
            .and_then(Value::as_str)
            .and_then(|name| name.strip_prefix("skill:"))
            .context("Pi Skill command has an invalid name")?;
        let path = command
            .pointer("/sourceInfo/path")
            .and_then(Value::as_str)
            .map(PathBuf::from)
            .context("Pi Skill command omitted source path")?;
        receipt.push(PiReceiptSkill {
            name: name.to_string(),
            description_digest: canonical_json_digest(&json!(
                command
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or("")
            ))?,
            entry_path: path.to_string_lossy().to_string(),
            model_visible: true,
        });
    }
    receipt.sort_by(|left, right| {
        left.name
            .cmp(&right.name)
            .then(left.entry_path.cmp(&right.entry_path))
    });
    validate_receipt_skills(&receipt, skill_root, workspace, expected_managed_skills)?;
    for skill in &mut receipt {
        skill.model_visible = pi_skill_model_visible(Path::new(&skill.entry_path))?;
    }
    Ok(receipt)
}

fn pi_skill_model_visible(path: &Path) -> Result<bool> {
    let path = path
        .canonicalize()
        .context("Pi Skill model visibility path cannot be resolved")?;
    let metadata =
        std::fs::metadata(&path).context("Pi Skill model visibility metadata is unavailable")?;
    if !metadata.is_file() || metadata.len() > MAX_SKILL_FILE_BYTES {
        bail!("Pi Skill model visibility source is not an admissible regular file");
    }
    let mut markdown = String::new();
    File::open(&path)
        .context("Pi Skill model visibility source cannot be opened")?
        .take(MAX_SKILL_FILE_BYTES + 1)
        .read_to_string(&mut markdown)
        .context("Pi Skill model visibility source must be UTF-8 text")?;
    if markdown.len() as u64 > MAX_SKILL_FILE_BYTES {
        bail!("Pi Skill model visibility source exceeded the Skill file limit");
    }
    pi_skill_model_visible_from_markdown(&markdown)
}

fn pi_skill_model_visible_from_markdown(markdown: &str) -> Result<bool> {
    let mut lines = markdown.lines();
    if lines.next().map(str::trim) != Some("---") {
        return Ok(true);
    }
    let mut disabled = false;
    let mut found_end = false;
    for line in lines {
        if line.trim() == "---" {
            found_end = true;
            break;
        }
        if line.starts_with(' ') || line.starts_with('\t') {
            continue;
        }
        let Some((key, raw_value)) = line.split_once(':') else {
            continue;
        };
        if key.trim() != "disable-model-invocation" {
            continue;
        }
        disabled = pi_yaml_boolean_is_true(raw_value);
    }
    if !found_end {
        bail!("Pi Skill model visibility frontmatter has no closing delimiter");
    }
    Ok(!disabled)
}

fn pi_yaml_boolean_is_true(raw_value: &str) -> bool {
    let comment = raw_value.char_indices().find_map(|(index, character)| {
        (character == '#'
            && raw_value[..index]
                .chars()
                .next_back()
                .is_none_or(char::is_whitespace))
        .then_some(index)
    });
    let value = raw_value[..comment.unwrap_or(raw_value.len())].trim();
    let (value, explicitly_boolean) = value
        .strip_prefix("!!bool")
        .or_else(|| value.strip_prefix("!<tag:yaml.org,2002:bool>"))
        .map_or((value, false), |value| (value.trim(), true));
    let value = if explicitly_boolean {
        value
            .strip_prefix('"')
            .and_then(|value| value.strip_suffix('"'))
            .or_else(|| {
                value
                    .strip_prefix('\'')
                    .and_then(|value| value.strip_suffix('\''))
            })
            .unwrap_or(value)
    } else {
        value
    };
    matches!(value, "true" | "True" | "TRUE")
}

fn validate_receipt_skills(
    skills: &[PiReceiptSkill],
    skill_root: &Path,
    workspace: &Path,
    expected_managed_skills: &[(String, PathBuf)],
) -> Result<()> {
    let root = skill_root
        .canonicalize()
        .context("Pi Skill root cannot be resolved")?;
    let workspace = workspace
        .canonicalize()
        .context("Pi Workspace cannot be resolved")?;
    let mut names = BTreeSet::new();
    let mut real_files = BTreeSet::new();
    let mut previous: Option<(&str, &str)> = None;
    for skill in skills {
        if !names.insert(skill.name.clone()) || !is_hex_digest(&skill.description_digest) {
            bail!("Pi Skill receipt contains a duplicate or invalid identity");
        }
        let path = PathBuf::from(&skill.entry_path);
        if !path.is_absolute() || !path.starts_with(skill_root) {
            bail!("Pi Skill receipt path escaped the lexical Skill root");
        }
        let real = path
            .canonicalize()
            .context("Pi Skill receipt path cannot be resolved")?;
        if !real_files.insert(real.clone()) {
            bail!("Pi Skill receipt contains a duplicate real file");
        }
        let managed = expected_managed_skills
            .iter()
            .find(|(name, _)| name == &skill.name);
        if let Some((_, expected)) = managed {
            let expected = expected
                .canonicalize()
                .context("managed Pi Skill target cannot be resolved")?;
            if !real.starts_with(&expected) && expected != real {
                bail!("managed Pi Skill receipt target changed");
            }
        } else if !real.starts_with(&workspace) {
            bail!("project-owned Pi Skill escaped the Workspace");
        }
        if let Some((previous_name, previous_path)) = previous
            && (previous_name, previous_path) >= (skill.name.as_str(), skill.entry_path.as_str())
        {
            bail!("Pi Skill receipt is not bytewise sorted");
        }
        previous = Some((&skill.name, &skill.entry_path));
    }
    for (name, expected) in expected_managed_skills {
        let count = skills.iter().filter(|skill| &skill.name == name).count();
        if count != 1 || !expected.starts_with(skill_root) {
            bail!("expected managed Pi Skill is missing or duplicated");
        }
    }
    if !root.starts_with(&workspace) {
        bail!("Pi Skill root escaped the Workspace");
    }
    Ok(())
}

fn ensure_session_replacement_succeeded(response: &Value, command: &str) -> Result<()> {
    if response.get("command").and_then(Value::as_str) != Some(command)
        || response.pointer("/data/cancelled").and_then(Value::as_bool) == Some(true)
    {
        bail!("Pi {command} did not establish the requested Session");
    }
    Ok(())
}

fn validate_probe_session_file_directory(session_file: &Path, session_dir: &Path) -> Result<()> {
    let observed = session_file
        .parent()
        .context("Pi probe Session file has no parent")?
        .canonicalize()
        .context("Pi probe Session directory is unavailable")?;
    let expected = session_dir
        .canonicalize()
        .context("Pi probe private Session directory is unavailable")?;
    if observed != expected {
        bail!("Pi probe Session escaped its private Session directory");
    }
    Ok(())
}

fn validate_managed_session_state(
    state: &PiManagedSessionState,
    binding: &PiHostBindingDocument,
    session_id: &str,
    session_file: &Path,
    cwd: &Path,
) -> Result<()> {
    if state.schema_version != 1
        || state.extension_version != PI_HOST_EXTENSION_VERSION
        || state.host_instance_id != binding.host_instance_id
        || state.host_binding_generation != binding.host_binding_generation
        || state.session_id != session_id
    {
        bail!("Pi managed Extension reported a different Session identity");
    }
    // Pi allocates the absolute Session filename before it materializes the JSONL file.
    // Compare canonical parent + filename during that pre-prompt state; once the file
    // exists, canonicalization additionally rejects a symlink replacement.
    let reported_file = canonical_or_future_session_path(Path::new(&state.session_file))
        .context("Pi managed Extension Session file cannot be resolved")?;
    let expected_file = canonical_or_future_session_path(session_file)
        .context("Pi get_state Session file cannot be resolved")?;
    let reported_cwd = Path::new(&state.cwd)
        .canonicalize()
        .context("Pi managed Extension cwd cannot be resolved")?;
    let expected_cwd = cwd
        .canonicalize()
        .context("Pi expected cwd cannot be resolved")?;
    if reported_file != expected_file || reported_cwd != expected_cwd {
        bail!("Pi managed Extension Session file or cwd differs from get_state");
    }
    Ok(())
}

fn canonical_or_future_session_path(path: &Path) -> Result<PathBuf> {
    if !path.is_absolute() {
        bail!("Pi Session file path is not absolute");
    }
    match std::fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                bail!("Pi Session path is not a regular file");
            }
            path.canonicalize()
                .context("Pi Session file cannot be canonicalized")
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let parent = path.parent().context("Pi Session file has no parent")?;
            let filename = path
                .file_name()
                .context("Pi Session file has no filename")?;
            Ok(parent
                .canonicalize()
                .context("Pi Session file parent cannot be canonicalized")?
                .join(filename))
        }
        Err(error) => Err(error).context("Pi Session file metadata is unavailable"),
    }
}

fn session_file_path_digest(path: &Path) -> Result<String> {
    let canonical = canonical_or_future_session_path(path)
        .context("Pi Native Session file cannot be resolved for digest")?;
    Ok(format!(
        "{:x}",
        Sha256::digest(canonical.to_string_lossy().as_bytes())
    ))
}

fn canonical_workspace_key(cwd: &Path) -> Result<String> {
    let cwd = cwd
        .canonicalize()
        .with_context(|| format!("failed to resolve Pi Workspace {}", cwd.display()))?;
    canonical_json_digest(&json!({"workspace": cwd}))
}

fn validate_host_state(
    state: &Value,
    expected_session_id: Option<&str>,
    locator_root: &Path,
    cwd: &Path,
    frozen_model_id: &str,
) -> Result<(String, PathBuf, String, String, String)> {
    let data = state.get("data").context("Pi get_state omitted data")?;
    let session_id = data
        .get("sessionId")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .context("Pi get_state omitted sessionId")?
        .to_string();
    let parsed_session_id =
        uuid::Uuid::parse_str(&session_id).context("Pi get_state sessionId is not a full UUID")?;
    if parsed_session_id.hyphenated().to_string() != session_id {
        bail!("Pi get_state sessionId is not a canonical full UUID");
    }
    if let Some(expected) = expected_session_id
        && session_id != expected
    {
        bail!("Pi returned a different Native Session identity");
    }
    let session_file = data
        .get("sessionFile")
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .context("Pi get_state omitted sessionFile")?;
    validate_native_session_file(
        &session_file,
        &session_id,
        cwd,
        expected_session_id.is_some(),
    )?;
    if expected_session_id.is_some() {
        let locator = read_session_locator(locator_root, &session_id, cwd)?;
        if locator.session_file != session_file.to_string_lossy() {
            let expected = PathBuf::from(locator.session_file).canonicalize()?;
            let observed = session_file.canonicalize()?;
            if expected != observed {
                bail!("Pi resumed a different canonical Session file");
            }
        }
    }
    let provider = data
        .pointer("/model/provider")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .context("model_required: Pi has no selected provider/model")?
        .to_string();
    let model_id = data
        .pointer("/model/id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .context("model_required: Pi has no selected provider/model")?
        .to_string();
    if frozen_model_id != PI_RUNTIME_DEFAULT_MODEL_ID {
        let expected = parse_explicit_model_id(frozen_model_id)?;
        if expected != (provider.clone(), model_id.clone()) {
            bail!("Pi selected a different explicit provider/model");
        }
    }
    let thinking = data
        .get("thinkingLevel")
        .and_then(Value::as_str)
        .unwrap_or("off")
        .to_string();
    Ok((session_id, session_file, provider, model_id, thinking))
}

fn parse_explicit_model_id(value: &str) -> Result<(String, String)> {
    let url = Url::parse(value).context("Pi explicit model identity is not a URL")?;
    if url.scheme() != "pi" || url.host_str() != Some("model") {
        bail!("Pi explicit model identity has the wrong scheme");
    }
    let pairs = url.query_pairs().collect::<HashMap<_, _>>();
    let provider = pairs
        .get("provider")
        .filter(|value| !value.trim().is_empty())
        .context("Pi explicit model identity omitted provider")?
        .to_string();
    let model = pairs
        .get("id")
        .filter(|value| !value.trim().is_empty())
        .context("Pi explicit model identity omitted id")?
        .to_string();
    Ok((provider, model))
}

fn session_locator_root(private_root: &Path, camp_id: &str, agent_id: &str) -> Result<PathBuf> {
    Ok(private_root
        .join("sessions")
        .join(scope_key("camp", camp_id)?)
        .join(scope_key("agent", agent_id)?))
}

fn scope_key(kind: &str, id: &str) -> Result<String> {
    canonical_json_digest(&json!({"kind": kind, "id": id}))
}

fn locator_path(root: &Path) -> PathBuf {
    root.join("locator.json")
}

fn read_session_locator(root: &Path, expected_id: &str, cwd: &Path) -> Result<PiSessionLocator> {
    let path = locator_path(root);
    let metadata =
        std::fs::symlink_metadata(&path).context("Pi exact-resume locator is unavailable")?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        bail!("Pi exact-resume locator is not a regular file");
    }
    let locator: PiSessionLocator = serde_json::from_slice(&std::fs::read(&path)?)?;
    if locator.schema_version != 2 || locator.session_id != expected_id {
        bail!("Pi exact-resume locator failed Native Session identity validation");
    }
    validate_native_session_file(Path::new(&locator.session_file), expected_id, cwd, true)?;
    Ok(locator)
}

fn write_session_locator(
    root: &Path,
    id: &str,
    file: &Path,
    cwd: &Path,
    must_exist: bool,
) -> Result<()> {
    validate_native_session_file(file, id, cwd, must_exist)?;
    write_private_json(
        &locator_path(root),
        &PiSessionLocator {
            schema_version: 2,
            session_id: id.to_string(),
            session_file: file.to_string_lossy().to_string(),
        },
    )
}

fn validate_native_session_file(path: &Path, id: &str, cwd: &Path, must_exist: bool) -> Result<()> {
    if !path.is_absolute() {
        bail!("Pi Session file path is not absolute");
    }
    let parent = path.parent().context("Pi Session file has no parent")?;
    let parent_metadata =
        std::fs::symlink_metadata(parent).context("Pi Session file parent is unavailable")?;
    if parent_metadata.file_type().is_symlink() || !parent_metadata.is_dir() {
        bail!("Pi Session file parent is not a regular directory");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if parent_metadata.uid() != unsafe { libc::geteuid() } {
            bail!("Pi Session file parent is owned by another user");
        }
    }
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if !must_exist && error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error).context("Pi Session file is unavailable"),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        bail!("Pi Session path is not a regular file");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.uid() != unsafe { libc::geteuid() } {
            bail!("Pi Session file is owned by another user");
        }
    }
    let file = File::open(path)?;
    let mut line = String::new();
    StdBufReader::new(file)
        .take(64 * 1024)
        .read_line(&mut line)?;
    let header: Value = serde_json::from_str(&line).context("Pi Session header is invalid")?;
    if header.get("type").and_then(Value::as_str) != Some("session")
        || header.get("id").and_then(Value::as_str) != Some(id)
    {
        bail!("Pi Session header identity is invalid");
    }
    let header_cwd = header
        .get("cwd")
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .context("Pi Session header omitted cwd")?;
    if header_cwd.canonicalize()? != cwd.canonicalize()? {
        bail!("Pi Session belongs to another Workspace");
    }
    Ok(())
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

fn create_private_or_workspace_directory(path: &Path) -> Result<()> {
    std::fs::create_dir_all(path)
        .with_context(|| format!("failed to create Pi Skill root {}", path.display()))
}

fn write_private_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let mut bytes = serde_json::to_vec(value)?;
    bytes.push(b'\n');
    write_private_file(path, &bytes)
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
    #[cfg(unix)]
    let mut file = {
        use std::os::unix::fs::OpenOptionsExt;
        OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&temporary)?
    };
    #[cfg(not(unix))]
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)?;
    let result = (|| -> Result<()> {
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temporary, path)?;
        File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

fn short_digest(bytes: &[u8]) -> String {
    let digest = format!("{:x}", Sha256::digest(bytes));
    digest[..12].to_string()
}

fn is_hex_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[tokio::test]
    async fn machine_ready_probe_never_sends_a_prompt_or_waits_for_agent_events() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!(
            "rovai-pi-machine-ready-fixture-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let executable = root.join("pi");
        std::fs::write(
            &executable,
            r###"#!/bin/sh
set -eu
fixture_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
request_log="$fixture_dir/requests.jsonl"
event_log="$fixture_dir/events.jsonl"
shutdown_marker="$fixture_dir/shutdown"
probe_root_log="$fixture_dir/probe-root"
printf '%s\n' "$PWD" > "$probe_root_log"
session_dir="$PWD/sessions"
mkdir -p "$session_dir"
session_number=1
session_id="00000000-0000-4000-8000-000000000001"
session_file=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--session" ]; then
    session_file="$2"
    shift 2
  else
    shift
  fi
done
if [ -z "$session_file" ]; then
  printf '%s\n' 'controlled Pi Host requires --session' >&2
  exit 1
fi
initial_session_file="$session_file"

write_session() {
  printf '{"type":"session","id":"%s","cwd":"%s"}\n' "$session_id" "$PWD" > "$session_file"
}

emit_managed_session_state() {
  host_instance_id=$(sed -n 's/.*"hostInstanceId":"\([^"]*\)".*/\1/p' "$ROVAI_PI_HOST_BINDING_FILE")
  host_binding_generation=$(sed -n 's/.*"hostBindingGeneration":\([0-9][0-9]*\).*/\1/p' "$ROVAI_PI_HOST_BINDING_FILE")
  event=$(printf '{"type":"extension_ui_request","method":"setStatus","statusKey":"rovai-managed-session-state","statusText":"{\\"schemaVersion\\":1,\\"extensionVersion\\":\\"rovai-pi-host-v3\\",\\"hostInstanceId\\":\\"%s\\",\\"hostBindingGeneration\\":%s,\\"sessionId\\":\\"%s\\",\\"sessionFile\\":\\"%s\\",\\"cwd\\":\\"%s\\"}"}' "$host_instance_id" "$host_binding_generation" "$session_id" "$session_file" "$PWD")
  printf '%s\n' "$event" >> "$event_log"
  printf '%s\n' "$event"
}

write_session
trap 'printf stopped > "$shutdown_marker"; exit 0' TERM INT

while IFS= read -r request; do
  printf '%s\n' "$request" >> "$request_log"
  request_id=$(printf '%s\n' "$request" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
  request_type=$(printf '%s\n' "$request" | sed -n 's/.*"type":"\([^"]*\)".*/\1/p')
  case "$request_type" in
    get_state)
      emit_managed_session_state
      printf '{"type":"response","id":"%s","success":true,"command":"get_state","data":{"sessionId":"%s","sessionFile":"%s","model":{"provider":"minimax","id":"MiniMax-M3"},"thinkingLevel":"off"}}\n' "$request_id" "$session_id" "$session_file"
      ;;
    get_available_models)
      printf '{"type":"response","id":"%s","success":true,"command":"get_available_models","data":{"models":[{"provider":"minimax","id":"MiniMax-M3","name":"MiniMax M3"}]}}\n' "$request_id"
      ;;
    get_commands)
      printf '{"type":"response","id":"%s","success":true,"command":"get_commands","data":{"commands":[]}}\n' "$request_id"
      ;;
    new_session)
      session_number=$((session_number + 1))
      session_id=$(printf '00000000-0000-4000-8000-%012d' "$session_number")
      session_file="$session_dir/$session_id.jsonl"
      write_session
      emit_managed_session_state
      printf '{"type":"response","id":"%s","success":true,"command":"new_session","data":{"cancelled":false}}\n' "$request_id"
      ;;
    switch_session)
      session_id="00000000-0000-4000-8000-000000000001"
      session_file="$initial_session_file"
      emit_managed_session_state
      printf '{"type":"response","id":"%s","success":true,"command":"switch_session","data":{"cancelled":false}}\n' "$request_id"
      ;;
    prompt)
      event='{"type":"agent_settled"}'
      printf '%s\n' "$event" >> "$event_log"
      printf '%s\n' "$event"
      printf '{"type":"response","id":"%s","success":false,"error":"machine Ready probe sent a model Prompt"}\n' "$request_id"
      ;;
    *)
      printf '{"type":"response","id":"%s","success":false,"error":"unexpected readiness command: %s"}\n' "$request_id" "$request_type"
      ;;
  esac
done
"###,
        )
        .unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();

        let observation = machine_ready_probe(&executable)
            .await
            .expect("the no-Prompt Machine Ready exchange should succeed");
        let requests = std::fs::read_to_string(root.join("requests.jsonl")).unwrap();
        let command_types = requests
            .lines()
            .map(|line| {
                serde_json::from_str::<Value>(line).unwrap()["type"]
                    .as_str()
                    .unwrap()
                    .to_string()
            })
            .collect::<Vec<_>>();
        assert_eq!(
            command_types,
            [
                "get_state",
                "get_available_models",
                "get_state",
                "new_session",
                "get_state",
                "switch_session",
                "get_state",
            ]
        );
        assert!(!requests.contains("\"type\":\"prompt\""));

        let events = std::fs::read_to_string(root.join("events.jsonl")).unwrap();
        for forbidden in [
            "\"type\":\"agent_start\"",
            "\"type\":\"message_update\"",
            "\"type\":\"message_end\"",
            "\"type\":\"agent_settled\"",
        ] {
            assert!(
                !events.contains(forbidden),
                "Machine Ready must not depend on {forbidden}"
            );
        }
        assert!(observation.raw_model_catalog.is_array());
        assert!(
            observation
                .capabilities
                .contains(&"conversation.exact_resume".to_string())
        );
        assert!(root.join("shutdown").is_file());
        let probe_root = PathBuf::from(
            std::fs::read_to_string(root.join("probe-root"))
                .unwrap()
                .trim(),
        );
        assert!(
            !probe_root.exists(),
            "the private probe Session/config root must be removed"
        );

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn host_launch_adds_probe_session_arguments_only_when_explicitly_requested() {
        let session_dir = std::env::temp_dir().join("rovai-pi-probe-session-argument");
        let session_file = session_dir.join("machine-ready-session.jsonl");
        let mut production = Command::new("pi");
        append_session_directory_argument(&mut production, None);
        append_initial_session_argument(&mut production, None);
        assert!(production.as_std().get_args().next().is_none());

        let mut probe = Command::new("pi");
        append_session_directory_argument(&mut probe, Some(&session_dir));
        append_initial_session_argument(&mut probe, Some(&session_file));
        assert_eq!(
            probe
                .as_std()
                .get_args()
                .map(|argument| argument.to_os_string())
                .collect::<Vec<_>>(),
            vec![
                "--session-dir".into(),
                session_dir.into_os_string(),
                "--session".into(),
                session_file.into_os_string(),
            ]
        );
    }

    #[test]
    fn managed_session_path_comparison_accepts_a_future_regular_file() {
        let root =
            std::env::temp_dir().join(format!("rovai-pi-future-session-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let future = root.join("session.jsonl");

        assert_eq!(
            canonical_or_future_session_path(&future).unwrap(),
            root.canonicalize().unwrap().join("session.jsonl")
        );

        std::fs::write(&future, b"session").unwrap();
        assert_eq!(
            canonical_or_future_session_path(&future).unwrap(),
            future.canonicalize().unwrap()
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn explicit_pi_model_identity_round_trips_reserved_characters() {
        let value = "pi://model?provider=openai-codex&id=gpt-5.6%2Fspecial";
        assert_eq!(
            parse_explicit_model_id(value).unwrap(),
            ("openai-codex".to_string(), "gpt-5.6/special".to_string())
        );
    }

    #[test]
    fn managed_receipt_nonce_matches_extension_formula() {
        let value = json!({"z": 1, "a": [true, {"b": "x"}]});
        let canonical = "{\"a\":[true,{\"b\":\"x\"}],\"z\":1}";
        let expected = format!(
            "{:x}",
            Sha256::digest(format!("rovai-pi-managed-input-receipt-v1\n{canonical}").as_bytes())
        );
        assert_eq!(managed_receipt_nonce(&value).unwrap(), expected);
    }

    #[test]
    fn managed_skill_catalog_rejects_a_model_visibility_change() {
        let expected = vec![PiReceiptSkill {
            name: "manual-only".to_string(),
            description_digest: "a".repeat(64),
            entry_path: "/workspace/.pi/skills/manual-only/SKILL.md".to_string(),
            model_visible: false,
        }];
        let mut observed = expected.clone();
        observed[0].model_visible = true;

        assert!(!skill_catalogs_match(&observed, &expected));
        assert!(skill_catalogs_match(&expected, &expected));
    }

    #[test]
    fn pi_skill_visibility_matches_native_yaml_boolean_forms() {
        for value in [
            "true",
            "True",
            "TRUE",
            "!!bool true",
            "!!bool \"true\"",
            "!<tag:yaml.org,2002:bool> true",
            "true # command only",
            "true\t# command only",
        ] {
            let markdown =
                format!("---\ndescription: command only\ndisable-model-invocation: {value}\n---\n");
            assert!(!pi_skill_model_visible_from_markdown(&markdown).unwrap());
        }
        for value in ["false", "yes", "\"true\"", "[true]"] {
            let markdown = format!(
                "---\ndescription: model visible\ndisable-model-invocation: {value}\n---\n"
            );
            assert!(pi_skill_model_visible_from_markdown(&markdown).unwrap());
        }
    }

    #[test]
    fn skill_command_validation_keeps_manual_only_skills_out_of_model_visibility() {
        let workspace = std::env::temp_dir().join(format!(
            "rovai-pi-skill-visibility-{}",
            uuid::Uuid::new_v4()
        ));
        let skill_root = workspace.join(".pi/skills");
        let visible_path = skill_root.join("visible/SKILL.md");
        let manual_path = skill_root.join("manual-only/SKILL.md");
        std::fs::create_dir_all(visible_path.parent().unwrap()).unwrap();
        std::fs::create_dir_all(manual_path.parent().unwrap()).unwrap();
        std::fs::write(
            &visible_path,
            "---\nname: visible\ndescription: model visible\n---\n",
        )
        .unwrap();
        std::fs::write(
            &manual_path,
            "---\nname: manual-only\ndescription: command only\ndisable-model-invocation: true\n---\n",
        )
        .unwrap();
        let response = json!({
            "data": {
                "commands": [
                    {
                        "name": "skill:visible",
                        "description": "model visible",
                        "source": "skill",
                        "sourceInfo": {"path": visible_path},
                    },
                    {
                        "name": "skill:manual-only",
                        "description": "command only",
                        "source": "skill",
                        "sourceInfo": {"path": manual_path},
                    },
                ]
            }
        });

        let catalog = validate_skill_commands(&response, &skill_root, &workspace, &[]).unwrap();
        assert_eq!(catalog.len(), 2);
        assert_eq!(
            catalog
                .iter()
                .find(|skill| skill.name == "manual-only")
                .map(|skill| skill.model_visible),
            Some(false)
        );
        assert_eq!(
            catalog
                .iter()
                .find(|skill| skill.name == "visible")
                .map(|skill| skill.model_visible),
            Some(true)
        );

        std::fs::remove_dir_all(workspace).unwrap();
    }

    #[tokio::test]
    #[ignore = "requires a qualified local Pi installation and native configuration"]
    async fn real_pi_machine_ready_smoke() {
        let executable = std::env::var_os("ROVAI_REAL_PI_EXECUTABLE")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/opt/homebrew/bin/pi"));
        let observation = machine_ready_probe(&executable).await.unwrap();
        assert!(
            observation
                .capabilities
                .iter()
                .any(|capability| capability == "conversation.exact_resume")
        );
        assert!(
            !observation
                .capabilities
                .iter()
                .any(|capability| capability == "pi.rpc.prompt")
        );
        assert!(observation.raw_model_catalog.is_array());
    }
}
