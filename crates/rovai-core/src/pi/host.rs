use std::{
    cmp::Ordering as EpochOrdering,
    collections::HashMap,
    fs::File,
    io::{BufRead as _, BufReader as StdBufReader, Read as _},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex as StdMutex, Weak,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};

#[cfg(not(windows))]
use std::{fs::OpenOptions, io::Write as _};

use anyhow::{Context, Result, bail};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
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

use super::{
    PI_COMMAND_TIMEOUT, PI_HOST_EXTENSION_VERSION, PI_MAX_JSONL_RECORD_BYTES, PI_PROTOCOL_VERSION,
    PiIncoming, assistant_message_text, completed_action, read_jsonl_record, value_id,
};

const MANAGED_HOST_EXTENSION: &str = include_str!("managed-host.ts");

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
    pub expected_native_session_id: Option<String>,
    pub bootstrap: String,
    pub bootstrap_payload_digest: String,
}

#[derive(Debug, Clone)]
struct PiBindingSeed {
    agent_run_id: String,
    execution_epoch: i64,
    native_binding_id: String,
    native_binding_generation: i64,
    expected_native_session_id: Option<String>,
    bootstrap: String,
    bootstrap_payload_digest: String,
}

impl PiBindingSeed {
    fn document(
        &self,
        host_instance_id: &str,
        host_binding_generation: u64,
    ) -> PiHostBindingDocument {
        PiHostBindingDocument {
            schema_version: 3,
            extension_version: PI_HOST_EXTENSION_VERSION.to_string(),
            host_instance_id: host_instance_id.to_string(),
            host_binding_generation,
            agent_run_id: self.agent_run_id.clone(),
            execution_epoch: self.execution_epoch,
            native_binding_id: self.native_binding_id.clone(),
            native_binding_generation: self.native_binding_generation,
            expected_native_session_id: self.expected_native_session_id.clone(),
            bootstrap: self.bootstrap.clone(),
            bootstrap_payload_digest: self.bootstrap_payload_digest.clone(),
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PiManagedContextUsage {
    schema_version: i64,
    extension_version: String,
    host_instance_id: String,
    host_binding_generation: u64,
    agent_run_id: String,
    execution_epoch: i64,
    native_binding_id: String,
    native_binding_generation: i64,
    session_id: String,
    provider: String,
    model_id: String,
    used_tokens: Option<i64>,
    window_tokens: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PiRuntimeOwner {
    agent_run_id: String,
    execution_epoch: i64,
    native_prompt_id: String,
    delivery_id: String,
}

impl PiManagedContextUsage {
    fn matches(
        &self,
        host: &str,
        session: &str,
        binding: &PiHostBindingDocument,
        owner: &PiRuntimeOwner,
    ) -> bool {
        self.schema_version == 1
            && self.extension_version == PI_HOST_EXTENSION_VERSION
            && self.host_instance_id == host
            && self.host_binding_generation == binding.host_binding_generation
            && self.agent_run_id == binding.agent_run_id
            && self.agent_run_id == owner.agent_run_id
            && self.execution_epoch == binding.execution_epoch
            && self.execution_epoch == owner.execution_epoch
            && self.native_binding_id == binding.native_binding_id
            && self.native_binding_generation == binding.native_binding_generation
            && self.session_id == session
            && !self.provider.is_empty()
            && self.provider.len() <= 512
            && !self.model_id.is_empty()
            && self.model_id.len() <= 512
            && (self.used_tokens.is_some() || self.window_tokens.is_some())
            && self
                .window_tokens
                .is_none_or(|n| n >= 0 && n <= 9_007_199_254_740_991)
            && self
                .used_tokens
                .is_none_or(|n| n >= 0 && n <= 9_007_199_254_740_991)
    }

    fn into_incoming(
        self,
        host_instance_id: String,
        owner: PiRuntimeOwner,
        sequence: u64,
    ) -> PiIncoming {
        // Preserve the identity validated before any await. Re-reading the
        // live owner after validation can relabel an old status during handoff.
        PiIncoming::Message {
            host_instance_id,
            agent_run_id: self.agent_run_id,
            execution_epoch: self.execution_epoch,
            native_session_id: self.session_id,
            native_prompt_id: owner.native_prompt_id,
            delivery_id: owner.delivery_id,
            sequence,
            message: json!({"type":"rovai.context_usage", "usedTokens":self.used_tokens,
                "windowTokens":self.window_tokens, "provider":self.provider, "modelId":self.model_id}),
        }
    }
}

struct PendingPiCommand {
    command_type: String,
    sender: oneshot::Sender<std::result::Result<Value, String>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PiActivationFailureKind {
    ResumeContinuityLost,
    ActivationFailed,
    HostFailed,
    ConfigurationFailed,
}

#[derive(Debug)]
struct PiActivationFailure {
    kind: PiActivationFailureKind,
    message: String,
}

impl std::fmt::Display for PiActivationFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for PiActivationFailure {}

fn activation_failure(
    kind: PiActivationFailureKind,
    error: impl std::fmt::Display,
) -> anyhow::Error {
    anyhow::Error::new(PiActivationFailure {
        kind,
        message: error.to_string(),
    })
}

pub(crate) fn activation_failure_kind(error: &anyhow::Error) -> Option<PiActivationFailureKind> {
    error
        .chain()
        .find_map(|cause| cause.downcast_ref::<PiActivationFailure>())
        .map(|failure| failure.kind)
}

#[derive(Debug)]
struct PiRpcCommandRejected {
    command: String,
    message: String,
}

impl std::fmt::Display for PiRpcCommandRejected {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.command, self.message)
    }
}

impl std::error::Error for PiRpcCommandRejected {}

fn switch_target_is_explicitly_unavailable(error: &anyhow::Error) -> bool {
    let Some(rejection) = error.downcast_ref::<PiRpcCommandRejected>() else {
        return false;
    };
    if rejection.command != "switch_session" {
        return false;
    }
    let message = rejection.message.to_ascii_lowercase();
    [
        "not found",
        "does not exist",
        "no such file",
        "cannot read",
        "can't read",
        "unreadable",
        "failed to read",
    ]
    .iter()
    .any(|needle| message.contains(needle))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PiEpochDisposition {
    ReuseOrRetireSame,
    ReplaceOlder,
    RejectStale,
}

fn pi_epoch_disposition(existing: i64, requested: i64) -> PiEpochDisposition {
    match existing.cmp(&requested) {
        EpochOrdering::Equal => PiEpochDisposition::ReuseOrRetireSame,
        EpochOrdering::Less => PiEpochDisposition::ReplaceOlder,
        EpochOrdering::Greater => PiEpochDisposition::RejectStale,
    }
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
    provider_registration_failed: AtomicBool,
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
    model_supports_images: bool,
}

pub(crate) const PI_PROMPT_IMAGE_MAX_BYTES: usize = 20 * 1024 * 1024;
pub(crate) const PI_PROMPT_IMAGE_TOTAL_MAX_BYTES: usize = 80 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PiPromptImage {
    pub(crate) r#type: String,
    pub(crate) data: String,
    pub(crate) mime_type: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PreparedPiPromptImage {
    pub(crate) wire: PiPromptImage,
    pub(crate) content_digest: String,
    pub(crate) byte_length: usize,
}

pub(crate) fn prepare_prompt_images(
    attachments: &[(PathBuf, Option<String>)],
) -> Result<Vec<PreparedPiPromptImage>> {
    let mut images = Vec::new();
    let mut total_bytes = 0usize;
    for (path, expected_digest) in attachments {
        let prepared = prepare_prompt_image(path, expected_digest.as_deref());
        let image = match prepared {
            Ok(Some(image)) => image,
            Ok(None) => continue,
            Err(_) if expected_digest.is_none() => continue,
            Err(error) => return Err(error),
        };
        let next_total = total_bytes.saturating_add(image.byte_length);
        if next_total > PI_PROMPT_IMAGE_TOTAL_MAX_BYTES {
            if expected_digest.is_none() {
                continue;
            }
            bail!("Pi prompt images exceed their aggregate limit");
        }
        total_bytes = next_total;
        images.push(image);
    }
    Ok(images)
}

// Inline image delivery is optional for mutable sources. Their exact paths are
// already in the input, so one missing or unreadable image cannot reject a Run.
fn prepare_prompt_image(
    path: &Path,
    expected_digest: Option<&str>,
) -> Result<Option<PreparedPiPromptImage>> {
    if !path.is_absolute() {
        bail!("Pi attachment path is not absolute");
    }
    let metadata = match if expected_digest.is_some() {
        std::fs::symlink_metadata(path)
    } else {
        std::fs::metadata(path)
    } {
        Ok(metadata) => metadata,
        Err(_) if expected_digest.is_none() => return Ok(None),
        Err(error) => {
            return Err(error).with_context(|| {
                format!("Pi attachment metadata is unavailable: {}", path.display())
            });
        }
    };
    if metadata.file_type().is_symlink() {
        bail!("Pi attachment is not a non-symlink regular file");
    }
    if metadata.is_dir() {
        return Ok(None);
    }
    if !metadata.is_file() {
        bail!("Pi attachment is not a non-symlink regular file");
    }
    let mut prefix = [0u8; 12];
    let mut file = File::open(path)
        .with_context(|| format!("Pi attachment cannot be opened: {}", path.display()))?;
    let prefix_len = file
        .read(&mut prefix)
        .context("Pi attachment MIME prefix cannot be read")?;
    let Some(mime_type) = sniff_pi_image_mime(&prefix[..prefix_len]) else {
        return Ok(None);
    };
    let byte_length =
        usize::try_from(metadata.len()).context("Pi prompt image size cannot be represented")?;
    if byte_length == 0 || byte_length > PI_PROMPT_IMAGE_MAX_BYTES {
        bail!("Pi prompt image exceeds its per-image limit");
    }
    let bytes = std::fs::read(path)
        .with_context(|| format!("Pi prompt image cannot be read: {}", path.display()))?;
    if bytes.len() != byte_length || sniff_pi_image_mime(&bytes) != Some(mime_type) {
        bail!("Pi prompt image changed during MIME validation");
    }
    let digest = sha256_bytes(&bytes);
    if expected_digest.is_some_and(|expected| expected != format!("sha256:{digest}")) {
        bail!("Pi prompt image bytes differ from the authorized attachment digest");
    }
    Ok(Some(PreparedPiPromptImage {
        wire: PiPromptImage {
            r#type: "image".to_string(),
            data: BASE64_STANDARD.encode(&bytes),
            mime_type: mime_type.to_string(),
        },
        content_digest: digest,
        byte_length,
    }))
}

fn sniff_pi_image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
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

fn append_host_arguments(command: &mut Command, extension_path: &Path) {
    command.args(["--mode", "rpc"]);
    command
        .args(["--no-themes", "--approve", "--extension"])
        .arg(extension_path);
}

fn configure_host_working_directory(command: &mut Command, cwd: &Path) -> Result<()> {
    #[cfg(windows)]
    let cwd = {
        // Pi encodes cwd into its native Session directory name, retaining the
        // '?' in a verbatim prefix. Only change the process-visible spelling;
        // Host/Fleet/Session identity continues to use the admitted canonical cwd.
        let visible = dunce::simplified(cwd);
        if matches!(
            visible.components().next(),
            Some(std::path::Component::Prefix(prefix)) if prefix.kind().is_verbatim()
        ) {
            bail!(
                "Pi working directory requires unsupported Windows verbatim syntax; use a shorter local directory without reserved names or trailing dots/spaces"
            );
        }
        visible
    };
    command.current_dir(cwd);
    Ok(())
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
        rovai_core::runtime_discovery::configure_runtime_command(AdapterKind::Pi, &mut command);
        if let Some(config) = &launch.builtin_tools {
            config.configure_command(&mut command)?;
        }
        append_host_arguments(&mut command, &extension_path);
        append_session_directory_argument(&mut command, launch.session_dir);
        append_initial_session_argument(&mut command, launch.initial_session_file);
        command
            .env("ROVAI_PI_HOST_BINDING_FILE", &binding_path)
            .env("PI_TELEMETRY", "0");
        configure_host_working_directory(&mut command, launch.cwd)?;
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
            incoming: launch.incoming.clone(),
            alive: AtomicBool::new(true),
            poisoned: AtomicBool::new(false),
            provider_registration_failed: AtomicBool::new(false),
            streaming: AtomicBool::new(false),
            sequence: AtomicU64::new(0),
            executable_path: launch.executable.to_path_buf(),
            builtin_tools: launch.builtin_tools.clone(),
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
        Self::spawn_stderr_reader(host.clone(), stderr);
        if let Err(error) = host.command("get_state", json!({})).await {
            host.shutdown_and_reap().await;
            return Err(error.context("Pi get_state failed during Host startup"));
        }
        Ok(host)
    }

    fn spawn_stdout_reader(host: Arc<Self>, stdout: ManagedChildStdout) {
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            let mut protocol_started = false;
            let mut startup_prelude_lines = 0usize;
            let mut startup_prelude_bytes = 0usize;
            let mut consecutive_malformed = 0usize;
            loop {
                let record = match read_jsonl_record(&mut reader, PI_MAX_JSONL_RECORD_BYTES).await {
                    Ok(Some(record)) => record,
                    Ok(None) => break,
                    Err(error) => {
                        host.emit_diagnostic(
                            if protocol_started {
                                "running"
                            } else {
                                "startup"
                            },
                            &format!("Pi stdout framing error: {error:#}"),
                        )
                        .await;
                        host.poisoned.store(true, Ordering::Release);
                        break;
                    }
                };
                let message = match serde_json::from_slice::<Value>(&record) {
                    Ok(message) if message.is_object() => message,
                    _ => {
                        if !protocol_started {
                            startup_prelude_lines += 1;
                            startup_prelude_bytes =
                                startup_prelude_bytes.saturating_add(record.len());
                            host.emit_diagnostic(
                                "startup",
                                &format!(
                                    "Pi stdout startup prelude: {}",
                                    String::from_utf8_lossy(&record)
                                ),
                            )
                            .await;
                            if startup_prelude_lines > 32 || startup_prelude_bytes > 64 * 1024 {
                                host.poisoned.store(true, Ordering::Release);
                                break;
                            }
                        } else {
                            consecutive_malformed += 1;
                            host.emit_diagnostic(
                                "running",
                                &format!(
                                    "Pi stdout skipped malformed record: {}",
                                    String::from_utf8_lossy(&record)
                                ),
                            )
                            .await;
                            if consecutive_malformed >= 3 {
                                host.poisoned.store(true, Ordering::Release);
                                break;
                            }
                        }
                        continue;
                    }
                };
                protocol_started = true;
                consecutive_malformed = 0;
                if message.get("type").and_then(Value::as_str) == Some("response") {
                    let Some(id) = message.get("id").and_then(value_id) else {
                        host.emit_diagnostic("running", "Pi RPC response omitted its request id")
                            .await;
                        host.poisoned.store(true, Ordering::Release);
                        break;
                    };
                    let Some(pending) = host.pending.lock().await.remove(&id) else {
                        host.emit_diagnostic(
                            "running",
                            "Pi RPC response did not match a pending request",
                        )
                        .await;
                        host.poisoned.store(true, Ordering::Release);
                        break;
                    };
                    if message.get("command").and_then(Value::as_str)
                        != Some(pending.command_type.as_str())
                    {
                        let _ = pending.sender.send(Err(format!(
                            "Pi RPC response command identity mismatch: expected {}",
                            pending.command_type
                        )));
                        host.emit_diagnostic(
                            "running",
                            "Pi RPC response command identity mismatch",
                        )
                        .await;
                        host.poisoned.store(true, Ordering::Release);
                        break;
                    }
                    let response = if message.get("success").and_then(Value::as_bool) == Some(true)
                    {
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

    fn spawn_stderr_reader(host: Arc<Self>, stderr: ManagedChildStderr) {
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr);
            loop {
                match read_jsonl_record(&mut reader, 64 * 1024).await {
                    Ok(Some(record)) => {
                        host.emit_diagnostic(
                            if host.owner.read().await.is_some() {
                                "running"
                            } else {
                                "startup"
                            },
                            &format!("Pi stderr: {}", String::from_utf8_lossy(&record)),
                        )
                        .await;
                    }
                    Ok(None) => break,
                    Err(error) => {
                        host.emit_diagnostic(
                            "running",
                            &format!("Pi stderr framing error: {error:#}"),
                        )
                        .await;
                        break;
                    }
                }
            }
        });
    }

    async fn emit_diagnostic(&self, phase: &str, message: &str) {
        let owner = self.owner.read().await.clone();
        let _ = self.incoming.send(PiIncoming::Diagnostic {
            host_instance_id: self.host_instance_id.clone(),
            agent_run_id: owner.as_ref().map(|value| value.agent_run_id.clone()),
            execution_epoch: owner.as_ref().map(|value| value.execution_epoch),
            phase: phase.to_string(),
            message: redact_pi_diagnostic(message),
        });
    }

    async fn route_message(&self, message: Value) {
        // Native RPC exposes extension registration failures separately from a
        // successful get_available_models response. Only this typed event is
        // catalog evidence; generic stderr and unrelated extension errors aren't.
        if message.get("type").and_then(Value::as_str) == Some("extension_error")
            && message.get("event").and_then(Value::as_str) == Some("register_provider")
            && message.get("error").and_then(Value::as_str).is_some()
        {
            self.provider_registration_failed
                .store(true, Ordering::Release);
        }
        if message.get("type").and_then(Value::as_str) == Some("extension_ui_request")
            && message.get("method").and_then(Value::as_str) == Some("setStatus")
            && message.get("statusKey").and_then(Value::as_str)
                == Some("rovai-managed-context-usage")
        {
            let Some(binding) = self.binding_document.read().await.clone() else {
                return;
            };
            let Some(owner) = self.owner.read().await.clone() else {
                return;
            };
            let Some(text) = message
                .get("statusText")
                .and_then(Value::as_str)
                .filter(|s| s.len() <= 4096)
            else {
                return;
            };
            let Ok(value) = serde_json::from_str::<PiManagedContextUsage>(text) else {
                return;
            };
            if !value.matches(
                &self.host_instance_id,
                &self.session_id.read().await,
                &binding,
                &owner,
            ) {
                return;
            }
            if !self
                .model_identity
                .read()
                .await
                .as_ref()
                .is_some_and(|(provider, model, _)| {
                    value.provider == *provider && value.model_id == *model
                })
            {
                return;
            }
            let sequence = self.sequence.fetch_add(1, Ordering::Relaxed) + 1;
            let _ = self.incoming.send(value.into_incoming(
                self.host_instance_id.clone(),
                owner,
                sequence,
            ));
            return;
        }
        if message.get("type").and_then(Value::as_str) == Some("extension_ui_request")
            && message.get("method").and_then(Value::as_str) == Some("setStatus")
            && message.get("statusKey").and_then(Value::as_str) == Some("rovai-managed-failure")
        {
            self.emit_diagnostic(
                "activation",
                message
                    .get("statusText")
                    .and_then(Value::as_str)
                    .unwrap_or("Pi managed extension reported a failure"),
            )
            .await;
            return;
        }
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
        if state.schema_version != 3
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
        self.pending.lock().await.insert(
            id.clone(),
            PendingPiCommand {
                command_type: command_type.to_string(),
                sender,
            },
        );
        if let Err(error) = self.send(Value::Object(command)).await {
            self.pending.lock().await.remove(&id);
            return Err(error);
        }
        match timeout(PI_COMMAND_TIMEOUT, receiver).await {
            Ok(Ok(Ok(response))) => Ok(response),
            Ok(Ok(Err(message))) => Err(anyhow::Error::new(PiRpcCommandRejected {
                command: command_type.to_string(),
                message,
            })),
            Ok(Err(_)) => bail!("Pi RPC response channel closed: {command_type}"),
            Err(_) => {
                // Keep the correlation entry as a tombstone. A caller (or an
                // outer cancellation deadline) may stop waiting before Pi
                // writes its normal response; the stdout reader must still
                // recognize and consume that late response without poisoning
                // the Host as an unmatched frame.
                bail!("Pi RPC command timed out: {command_type}")
            }
        }
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
    ) -> Result<ActivatedPiSession> {
        if !self.is_quiescent().await {
            return Err(activation_failure(
                PiActivationFailureKind::ActivationFailed,
                "Pi Host is not quiescent for Session activation",
            ));
        }
        let generation = self.binding_generation.fetch_add(1, Ordering::AcqRel) + 1;
        let document = seed.document(&self.host_instance_id, generation);
        write_private_json(&self.binding_path, &document).map_err(|error| {
            activation_failure(PiActivationFailureKind::ActivationFailed, error)
        })?;
        *self.binding_document.write().await = Some(document.clone());
        *self.managed_session_state.write().await = None;

        if let Some(expected_session_id) = seed.expected_native_session_id.as_deref() {
            let locator = read_session_locator(locator_root, expected_session_id, &self.cwd)
                .map_err(|error| {
                    activation_failure(PiActivationFailureKind::ResumeContinuityLost, error)
                })?;
            let response = match self
                .command(
                    "switch_session",
                    json!({"sessionPath": locator.session_file}),
                )
                .await
            {
                Ok(response) => response,
                Err(error) if switch_target_is_explicitly_unavailable(&error) => {
                    return Err(activation_failure(
                        PiActivationFailureKind::ResumeContinuityLost,
                        error,
                    ));
                }
                Err(error) => {
                    return Err(activation_failure(
                        PiActivationFailureKind::ActivationFailed,
                        error,
                    ));
                }
            };
            ensure_session_replacement_succeeded(&response, "switch_session").map_err(|error| {
                activation_failure(PiActivationFailureKind::ActivationFailed, error)
            })?;
        } else {
            let response = self
                .command("new_session", json!({}))
                .await
                .map_err(|error| {
                    activation_failure(PiActivationFailureKind::ActivationFailed, error)
                })?;
            ensure_session_replacement_succeeded(&response, "new_session").map_err(|error| {
                activation_failure(PiActivationFailureKind::ActivationFailed, error)
            })?;
        }
        // A restored Session may have a different thinking level from the global
        // default. Pi's set_model resets it even when selecting the same model.
        // Read the activated Session, never the previous Host's cached identity.
        let activated_state = self
            .command("get_state", json!({}))
            .await
            .map_err(|error| {
                activation_failure(PiActivationFailureKind::ActivationFailed, error)
            })?;
        let exact_resume = seed.expected_native_session_id.is_some();
        let (activated_session_id, activated_session_file) = validate_host_session_state(
            &activated_state,
            seed.expected_native_session_id.as_deref(),
            locator_root,
            &self.cwd,
        )
        .map_err(|error| {
            activation_failure(
                if exact_resume {
                    PiActivationFailureKind::ResumeContinuityLost
                } else {
                    PiActivationFailureKind::ActivationFailed
                },
                error,
            )
        })?;
        let managed_session_state = self
            .managed_session_state
            .read()
            .await
            .clone()
            .context("Pi managed Extension did not report Session state")
            .map_err(|error| {
                activation_failure(PiActivationFailureKind::ActivationFailed, error)
            })?;
        validate_managed_session_state(
            &managed_session_state,
            &document,
            &activated_session_id,
            &activated_session_file,
            &self.cwd,
        )
        .map_err(|error| activation_failure(PiActivationFailureKind::ActivationFailed, error))?;
        let options = frozen_runtime.model.options.as_object().ok_or_else(|| {
            activation_failure(
                PiActivationFailureKind::ConfigurationFailed,
                "Pi model options must be an object",
            )
        })?;
        for (key, value) in options {
            if key != "thinking_level" || !value.is_string() {
                return Err(activation_failure(
                    PiActivationFailureKind::ConfigurationFailed,
                    format!("unsupported Pi model option: {key}"),
                ));
            }
        }
        let mut available_thinking_levels = None;
        if frozen_runtime.model.model_id != PI_RUNTIME_DEFAULT_MODEL_ID {
            let available_models = self
                .command("get_available_models", json!({}))
                .await
                .map_err(|error| {
                    activation_failure(PiActivationFailureKind::ConfigurationFailed, error)
                })?;
            let (provider, model_id) = parse_explicit_model_id(&frozen_runtime.model.model_id)
                .map_err(|error| {
                    activation_failure(PiActivationFailureKind::ConfigurationFailed, error)
                })?;
            let selected_model = available_models
                .pointer("/data/models")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .find(|model| {
                    model.get("provider").and_then(Value::as_str) == Some(provider.as_str())
                        && model.get("id").and_then(Value::as_str) == Some(model_id.as_str())
                });
            let Some(selected_model) = selected_model else {
                return Err(activation_failure(
                    PiActivationFailureKind::ConfigurationFailed,
                    format!("Pi explicit provider={provider} model={model_id} is unavailable"),
                ));
            };
            available_thinking_levels =
                crate::agent_runtime_adapter::pi_thinking_levels(selected_model);
            if activated_state
                .pointer("/data/model/provider")
                .and_then(Value::as_str)
                != Some(provider.as_str())
                || activated_state
                    .pointer("/data/model/id")
                    .and_then(Value::as_str)
                    != Some(model_id.as_str())
            {
                self.command(
                    "set_model",
                    json!({"provider": provider, "modelId": model_id}),
                )
                .await
                .map_err(|error| {
                    activation_failure(PiActivationFailureKind::ConfigurationFailed, error)
                })?;
            }
        }
        if let Some(thinking_level) = frozen_runtime
            .model
            .options
            .get("thinking_level")
            .and_then(Value::as_str)
        {
            self.command("set_thinking_level", json!({"level": thinking_level}))
                .await
                .map_err(|error| {
                    activation_failure(
                        PiActivationFailureKind::ConfigurationFailed,
                        format!(
                            "Pi model {} rejected thinking_level={thinking_level}: {error:#}",
                            frozen_runtime.model.model_id
                        ),
                    )
                })?;
        }
        let state = self
            .command("get_state", json!({}))
            .await
            .map_err(|error| {
                activation_failure(PiActivationFailureKind::ActivationFailed, error)
            })?;
        let (session_id, session_file) = validate_host_session_state(
            &state,
            seed.expected_native_session_id.as_deref(),
            locator_root,
            &self.cwd,
        )
        .map_err(|error| {
            activation_failure(
                if exact_resume {
                    PiActivationFailureKind::ResumeContinuityLost
                } else {
                    PiActivationFailureKind::ActivationFailed
                },
                error,
            )
        })?;
        if session_id != activated_session_id || session_file != activated_session_file {
            return Err(activation_failure(
                PiActivationFailureKind::ActivationFailed,
                "Pi Session identity changed while applying model configuration",
            ));
        }
        let (provider, model_id, thinking_level, model_supports_images) =
            validate_host_model_state(&state, &frozen_runtime.model.model_id).map_err(|error| {
                activation_failure(PiActivationFailureKind::ConfigurationFailed, error)
            })?;
        if let Some(requested) = options
            .get("thinking_level")
            .and_then(Value::as_str)
            .filter(|requested| *requested != thinking_level)
        {
            let available = available_thinking_levels
                .as_ref()
                .map(|levels| format!(", available={}", levels.join(",")))
                .unwrap_or_default();
            return Err(activation_failure(
                PiActivationFailureKind::ConfigurationFailed,
                format!(
                    "Pi provider={provider} model={model_id} did not apply thinking_level: requested={requested}, observed={thinking_level}{available}"
                ),
            ));
        }
        let managed_session_state = self
            .managed_session_state
            .read()
            .await
            .clone()
            .context("Pi managed Extension did not report Session state")
            .map_err(|error| {
                activation_failure(PiActivationFailureKind::ActivationFailed, error)
            })?;
        validate_managed_session_state(
            &managed_session_state,
            &document,
            &session_id,
            &session_file,
            &self.cwd,
        )
        .map_err(|error| activation_failure(PiActivationFailureKind::ActivationFailed, error))?;
        write_session_locator(
            locator_root,
            &session_id,
            &session_file,
            &self.cwd,
            seed.expected_native_session_id.is_some(),
        )
        .map_err(|error| activation_failure(PiActivationFailureKind::ActivationFailed, error))?;
        let model_fingerprint =
            short_digest(format!("{provider}\0{model_id}\0{thinking_level}").as_bytes());
        *self.session_id.write().await = session_id.clone();
        *self.session_file.write().await = session_file.clone();
        *self.model_identity.write().await = Some((provider, model_id, thinking_level));
        Ok(ActivatedPiSession {
            session_id,
            session_file,
            model_fingerprint,
            model_supports_images,
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

pub struct PiRuntime {
    owner: PiRuntimeOwner,
    camp_id: String,
    host: Arc<PiHost>,
    model_supports_images: bool,
    final_message: RwLock<Option<String>>,
    final_stop_reason: RwLock<Option<String>>,
    active_tool_executions: Mutex<HashMap<String, Value>>,
    session_id: String,
    session_file: PathBuf,
    model_fingerprint: String,
    text_state: Mutex<super::PiTextState>,
}

impl PiRuntime {
    fn from_host(
        owner: PiRuntimeOwner,
        camp_id: String,
        host: Arc<PiHost>,
        activation: ActivatedPiSession,
    ) -> Arc<Self> {
        Arc::new(Self {
            owner,
            camp_id,
            host,
            model_supports_images: activation.model_supports_images,
            final_message: RwLock::new(None),
            final_stop_reason: RwLock::new(None),
            active_tool_executions: Mutex::new(HashMap::new()),
            session_id: activation.session_id,
            session_file: activation.session_file,
            model_fingerprint: activation.model_fingerprint,
            text_state: Mutex::new(super::PiTextState::default()),
        })
    }

    pub(crate) async fn normalize_events(&self, message: &Value) -> Vec<(&'static str, Value)> {
        self.text_state.lock().await.normalize(message)
    }

    pub async fn start_prompt(&self, message: &str, images: &[PiPromptImage]) -> Result<()> {
        *self.final_message.write().await = None;
        *self.final_stop_reason.write().await = None;
        self.active_tool_executions.lock().await.clear();
        if !images.is_empty() && !self.model_supports_images {
            bail!("Pi selected model does not advertise image input support");
        }
        let mut fields = json!({"message": message});
        if !images.is_empty() {
            let mut total_bytes = 0usize;
            for image in images {
                if image.r#type != "image"
                    || !matches!(
                        image.mime_type.as_str(),
                        "image/png" | "image/jpeg" | "image/gif" | "image/webp"
                    )
                {
                    bail!("Pi prompt image has an invalid wire shape");
                }
                let byte_length = BASE64_STANDARD
                    .decode(&image.data)
                    .context("Pi prompt image data is not valid base64")?
                    .len();
                if byte_length == 0 || byte_length > PI_PROMPT_IMAGE_MAX_BYTES {
                    bail!("Pi prompt image exceeds its per-image limit");
                }
                total_bytes = total_bytes
                    .checked_add(byte_length)
                    .context("Pi prompt image total size overflow")?;
            }
            if total_bytes > PI_PROMPT_IMAGE_TOTAL_MAX_BYTES {
                bail!("Pi prompt images exceed their aggregate limit");
            }
            fields
                .as_object_mut()
                .expect("prompt fields are an object")
                .insert("images".to_string(), serde_json::to_value(images)?);
        }
        let response = self.host.command("prompt", fields).await?;
        if response.get("command").and_then(Value::as_str) != Some("prompt") {
            bail!("Pi prompt response has the wrong command identity");
        }
        Ok(())
    }

    #[allow(dead_code)]
    pub(crate) async fn clear_queue(&self) -> Result<Value> {
        self.host.command("clear_queue", json!({})).await
    }

    #[allow(dead_code)]
    pub(crate) async fn set_steering_mode(&self, mode: &str) -> Result<()> {
        if !matches!(mode, "all" | "one-at-a-time") {
            bail!("Pi steering mode is invalid");
        }
        self.host
            .command("set_steering_mode", json!({"mode": mode}))
            .await?;
        Ok(())
    }

    #[allow(dead_code)]
    pub(crate) async fn set_follow_up_mode(&self, mode: &str) -> Result<()> {
        if !matches!(mode, "all" | "one-at-a-time") {
            bail!("Pi follow-up mode is invalid");
        }
        self.host
            .command("set_follow_up_mode", json!({"mode": mode}))
            .await?;
        Ok(())
    }

    #[allow(dead_code)]
    pub(crate) async fn get_messages(&self) -> Result<Value> {
        self.host.command("get_messages", json!({})).await
    }

    #[allow(dead_code)]
    pub(crate) async fn get_entries(&self, since: Option<&str>) -> Result<Value> {
        let fields = since.map_or_else(|| json!({}), |since| json!({"since": since}));
        self.host.command("get_entries", fields).await
    }

    #[allow(dead_code)]
    pub(crate) async fn get_session_stats(&self) -> Result<Value> {
        self.host.command("get_session_stats", json!({})).await
    }

    #[allow(dead_code)]
    pub(crate) async fn set_session_name(&self, name: &str) -> Result<()> {
        self.host
            .command("set_session_name", json!({"name": name}))
            .await?;
        Ok(())
    }

    #[allow(dead_code)]
    pub(crate) async fn compact(&self, custom_instructions: Option<&str>) -> Result<Value> {
        let fields = custom_instructions.map_or_else(
            || json!({}),
            |instructions| json!({"customInstructions": instructions}),
        );
        self.host.command("compact", fields).await
    }

    #[allow(dead_code)]
    pub(crate) async fn set_auto_compaction(&self, enabled: bool) -> Result<()> {
        self.host
            .command("set_auto_compaction", json!({"enabled": enabled}))
            .await?;
        Ok(())
    }

    #[allow(dead_code)]
    pub(crate) async fn export_html(&self, output_path: &Path) -> Result<Value> {
        if !output_path.is_absolute() {
            bail!("Pi export path must be absolute");
        }
        self.host
            .command(
                "export_html",
                json!({"outputPath": output_path.to_string_lossy()}),
            )
            .await
    }

    pub async fn cancel(&self) -> Result<()> {
        self.host.command("abort", json!({})).await?;
        Ok(())
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
        self.host.send(response).await
    }

    pub async fn observe(&self, mut message: Value) -> Result<(Value, Option<CompletedAcpAction>)> {
        match message.get("type").and_then(Value::as_str) {
            Some("message_end") => {
                let Some(assistant) = message
                    .get("message")
                    .filter(|value| value.get("role").and_then(Value::as_str) == Some("assistant"))
                else {
                    return Ok((message, None));
                };
                *self.final_stop_reason.write().await = assistant
                    .get("stopReason")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                if let Some(text) = assistant_message_text(assistant) {
                    *self.final_message.write().await = Some(text);
                }
            }
            Some("tool_execution_start" | "tool_execution_update") => {
                if let Some(tool_call_id) = message.get("toolCallId").and_then(Value::as_str)
                    && (message.get("toolName").is_some() || message.get("args").is_some())
                {
                    let mut active = self.active_tool_executions.lock().await;
                    let mut observation = message.clone();
                    if let Some(previous) = active.get(tool_call_id) {
                        super::reconcile_terminal_tool_message(&mut observation, previous);
                    }
                    active.insert(tool_call_id.to_string(), observation);
                }
            }
            Some("tool_execution_end") => {
                let start =
                    if let Some(tool_call_id) = message.get("toolCallId").and_then(Value::as_str) {
                        self.active_tool_executions
                            .lock()
                            .await
                            .remove(tool_call_id)
                    } else {
                        None
                    };
                if let Some(start) = start.as_ref() {
                    super::reconcile_terminal_tool_message(&mut message, start);
                }
                let completion = completed_action(&message)?;
                return Ok((message, completion));
            }
            _ => {}
        }
        Ok((message, None))
    }

    pub async fn terminal(&self) -> (Option<String>, Option<String>) {
        (
            self.final_message.read().await.clone(),
            self.final_stop_reason.read().await.clone(),
        )
    }

    pub(crate) fn mark_failed_closed(&self) {
        self.host.poisoned.store(true, Ordering::Release);
    }

    pub fn host_instance_id(&self) -> &str {
        self.host.host_instance_id()
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn model_fingerprint(&self) -> &str {
        &self.model_fingerprint
    }

    pub async fn observed_model_id(&self) -> Option<String> {
        let identity = self.host.model_identity.read().await;
        let (provider, model, _) = identity.as_ref()?;
        let query = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("provider", provider)
            .append_pair("id", model)
            .finish();
        Some(format!("pi://model?{query}"))
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
        let binding_result = self.host.unbind_and_clear(&self.owner).await;
        session_result?;
        binding_result
    }
}

type PiRuntimeCreationKey = (String, i64);
type PiRuntimeCreationGate = Weak<Mutex<()>>;

pub struct PiRpcRuntimeAdapter {
    active: Mutex<HashMap<String, Arc<PiRuntime>>>,
    runtime_creation: StdMutex<HashMap<PiRuntimeCreationKey, PiRuntimeCreationGate>>,
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
            runtime_creation: StdMutex::new(HashMap::new()),
            incoming,
            fleet,
            private_runtime_dir: private_runtime_directory(data_dir),
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
        let creation_key = (request.agent_run_id.to_string(), request.execution_epoch);
        let creation_gate = {
            let mut gates = self
                .runtime_creation
                .lock()
                .map_err(|_| anyhow::anyhow!("Pi Runtime creation gate registry is poisoned"))?;
            gates.retain(|_, gate| gate.strong_count() > 0);
            if let Some(gate) = gates.get(&creation_key).and_then(Weak::upgrade) {
                gate
            } else {
                let gate = Arc::new(Mutex::new(()));
                gates.insert(creation_key.clone(), Arc::downgrade(&gate));
                gate
            }
        };
        let _creation = creation_gate.lock().await;
        if let Some(existing) = self.active.lock().await.get(request.agent_run_id).cloned() {
            let existing_epoch = existing.agent_run_epoch();
            match pi_epoch_disposition(existing_epoch, request.execution_epoch) {
                PiEpochDisposition::RejectStale => {
                    bail!(
                        "stale Pi Runtime execution epoch {} cannot affect active epoch {}",
                        request.execution_epoch,
                        existing_epoch
                    );
                }
                PiEpochDisposition::ReuseOrRetireSame if existing.host.is_alive() => {
                    return Ok(existing);
                }
                PiEpochDisposition::ReuseOrRetireSame | PiEpochDisposition::ReplaceOlder => {}
            }
            // Re-check the exact epoch while removing. Another creation gate
            // may have committed a newer Runtime after the snapshot above;
            // this request must never detach or stop that newer generation.
            if let Some(retired) = self
                .take_runtime(request.agent_run_id, existing_epoch)
                .await
            {
                let _ = retired.cleanup_for_release().await;
                self.fleet
                    .release(
                        request.agent_run_id,
                        existing_epoch,
                        FleetReleaseDisposition::Stop,
                    )
                    .await;
            }
        }
        let bootstrap_payload_digest =
            format!("{:x}", Sha256::digest(request.bootstrap.payload.as_bytes()));
        let seed = PiBindingSeed {
            agent_run_id: request.agent_run_id.to_string(),
            execution_epoch: request.execution_epoch,
            native_binding_id: request.native_binding_id.to_string(),
            native_binding_generation: request.native_binding_generation,
            expected_native_session_id: request.native_session_id.map(str::to_string),
            bootstrap: request.bootstrap.payload.clone(),
            bootstrap_payload_digest,
        };
        let locator_root =
            session_locator_root(&self.private_runtime_dir, request.camp_id, request.agent_id)?;
        let workspace_key = canonical_workspace_key(request.cwd)?;
        let spawn_executable = PathBuf::from(&request.frozen_runtime.executable_path);
        let spawn_cwd = request.cwd.to_path_buf();
        let spawn_private_runtime_dir = self.private_runtime_dir.clone();
        let spawn_seed = seed.clone();
        let spawn_incoming = self.incoming.clone();
        let spawn_builtin_tools = request.builtin_tools.clone();
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
                move || async move {
                    let host = PiHost::spawn(PiHostLaunch {
                        executable: &spawn_executable,
                        cwd: &spawn_cwd,
                        private_runtime_dir: &spawn_private_runtime_dir,
                        session_dir: None,
                        initial_session_file: None,
                        initial_binding: &spawn_seed,
                        incoming: spawn_incoming,
                        builtin_tools: Some(spawn_builtin_tools),
                    })
                    .await?;
                    Ok(RuntimeProcessHost::Pi(host))
                },
            )
            .await;
        let lease = lease
            .map_err(|error| activation_failure(PiActivationFailureKind::HostFailed, error))?;
        let host = lease
            .host
            .into_pi()
            .map_err(|error| activation_failure(PiActivationFailureKind::HostFailed, error))?;
        let activation = match host
            .activate(&seed, &locator_root, request.frozen_runtime)
            .await
        {
            Ok(activation) => activation,
            Err(error) => {
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
            self.fleet
                .release(
                    request.agent_run_id,
                    request.execution_epoch,
                    FleetReleaseDisposition::Stop,
                )
                .await;
            return Err(activation_failure(
                PiActivationFailureKind::ActivationFailed,
                error,
            ));
        }
        let runtime = PiRuntime::from_host(owner, request.camp_id.to_string(), host, activation);
        let displaced = {
            let mut active = self.active.lock().await;
            if let Some(existing) = active.get(request.agent_run_id)
                && existing.agent_run_epoch() > request.execution_epoch
            {
                drop(active);
                let _ = runtime.cleanup_for_release().await;
                self.fleet
                    .release(
                        request.agent_run_id,
                        request.execution_epoch,
                        FleetReleaseDisposition::Stop,
                    )
                    .await;
                bail!("late Pi Runtime creation cannot replace a newer execution epoch");
            }
            active.insert(request.agent_run_id.to_string(), runtime.clone())
        };
        if let Some(displaced) = displaced
            && displaced.agent_run_epoch() != request.execution_epoch
        {
            let displaced_epoch = displaced.agent_run_epoch();
            let _ = displaced.cleanup_for_release().await;
            self.fleet
                .release(
                    request.agent_run_id,
                    displaced_epoch,
                    FleetReleaseDisposition::Stop,
                )
                .await;
        }
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

async fn spawn_probe_host(executable: &Path) -> Result<(Arc<PiHost>, PiProbeRootCleanup)> {
    let probe_root = std::env::temp_dir().join(format!("rovai-pi-probe-{}", uuid::Uuid::new_v4()));
    let _probe_root_cleanup = PiProbeRootCleanup(probe_root.clone());
    let private_runtime_dir = probe_root.join("private");
    let session_dir = probe_root.join("sessions");
    create_private_directory(&private_runtime_dir)?;
    create_private_directory(&session_dir)?;
    let initial_session_file = session_dir.join("machine-ready-session.jsonl");
    write_private_file(&initial_session_file, b"")?;
    let bootstrap = "Rovai Pi no-Prompt Machine Ready probe.".to_string();
    let seed = PiBindingSeed {
        agent_run_id: uuid::Uuid::new_v4().to_string(),
        execution_epoch: 1,
        native_binding_id: uuid::Uuid::new_v4().to_string(),
        native_binding_generation: 1,
        expected_native_session_id: None,
        bootstrap_payload_digest: format!("{:x}", Sha256::digest(bootstrap.as_bytes())),
        bootstrap,
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
    Ok((host, _probe_root_cleanup))
}

pub(crate) async fn model_catalog_probe(executable: &Path) -> Result<Value> {
    let (host, _probe_root) = spawn_probe_host(executable).await?;
    let result = read_probe_model_catalog(&host).await;
    if !host.shutdown_and_reap_with_status().await {
        bail!("Pi catalog Host did not shutdown and reap within the grace period");
    }
    if host.provider_registration_failed.load(Ordering::Acquire) {
        bail!("Pi catalog observation included a native Provider registration failure");
    }
    result
}

async fn read_probe_model_catalog(host: &PiHost) -> Result<Value> {
    let response = host.command("get_available_models", json!({})).await?;
    let catalog = response
        .pointer("/data/models")
        .cloned()
        .context("Pi probe model catalog is unavailable")?;
    let models = catalog
        .as_array()
        .context("Pi probe model catalog is malformed")?;
    if models.iter().any(|model| {
        ["provider", "id"].iter().any(|key| {
            model
                .get(key)
                .and_then(Value::as_str)
                .is_none_or(|value| value.trim().is_empty())
        })
    }) {
        bail!("Pi probe model catalog contains an invalid entry");
    }
    Ok(catalog)
}

pub(crate) async fn machine_ready_probe(executable: &Path) -> Result<PiMachineReadyProbe> {
    let (host, _probe_root_cleanup) = spawn_probe_host(executable).await?;
    let probe_root = &_probe_root_cleanup.0;
    let private_runtime_dir = probe_root.join("private");
    let session_dir = probe_root.join("sessions");
    let result = async {
        let raw_model_catalog = read_probe_model_catalog(&host).await?;
        let models = raw_model_catalog
            .as_array()
            .expect("catalog reader validated array");
        let state = host.command("get_state", json!({})).await?;
        let locator_root = private_runtime_dir.join("probe-locator");
        let (session_id, session_file, provider, model, thinking, _) = validate_host_state(
            &state,
            None,
            &locator_root,
            probe_root,
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
            probe_root,
        )?;
        validate_probe_session_file_directory(&session_file, &session_dir)?;
        let canonical_session_file = session_file
            .canonicalize()
            .context("Pi probe empty Session did not materialize canonically")?;
        write_session_locator(
            &locator_root,
            &session_id,
            &canonical_session_file,
            probe_root,
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
        let (replacement_id, replacement_file, _, _, _, _) = validate_host_state(
            &replacement_state,
            None,
            &locator_root,
            probe_root,
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
            probe_root,
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
        let (restored_id, restored_file, _, _, _, _) = validate_host_state(
            &restored_state,
            Some(&session_id),
            &locator_root,
            probe_root,
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
            probe_root,
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
    let cleanup = std::fs::remove_dir_all(probe_root)
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

fn sha256_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
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
    if state.schema_version != 3
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
) -> Result<(String, PathBuf, String, String, String, bool)> {
    let (session_id, session_file) =
        validate_host_session_state(state, expected_session_id, locator_root, cwd)?;
    let (provider, model_id, thinking, supports_images) =
        validate_host_model_state(state, frozen_model_id)?;
    Ok((
        session_id,
        session_file,
        provider,
        model_id,
        thinking,
        supports_images,
    ))
}

fn validate_host_session_state(
    state: &Value,
    expected_session_id: Option<&str>,
    locator_root: &Path,
    cwd: &Path,
) -> Result<(String, PathBuf)> {
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
    Ok((session_id, session_file))
}

fn validate_host_model_state(
    state: &Value,
    frozen_model_id: &str,
) -> Result<(String, String, String, bool)> {
    let data = state.get("data").context("Pi get_state omitted data")?;
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
    let supports_images = data
        .pointer("/model/input")
        .and_then(Value::as_array)
        .is_some_and(|inputs| inputs.iter().any(|input| input.as_str() == Some("image")));
    Ok((provider, model_id, thinking, supports_images))
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

fn private_runtime_directory(data_dir: &Path) -> PathBuf {
    // The old Windows root was created with inherited ACLs even when Pi was
    // unused. Its first private write always failed at directory fsync, so it
    // cannot contain a successfully admitted Windows Pi Session. Leave it intact
    // instead of silently repairing unknown objects into the private boundary.
    if cfg!(windows) {
        data_dir.join("runtime/pi-windows-private-v1")
    } else {
        data_dir.join("runtime/pi")
    }
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
    let mut reader = StdBufReader::new(file).take(64 * 1024);
    let header = loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            bail!("Pi Session has no parseable Session header within the scan limit");
        }
        let Ok(candidate) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if candidate.get("type").and_then(Value::as_str) == Some("session") {
            break candidate;
        }
    };
    if header.get("id").and_then(Value::as_str) != Some(id) {
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

#[cfg(windows)]
fn create_private_directory(path: &Path) -> Result<()> {
    rovai_core::platform::prepare_private_directory(path)?;
    Ok(())
}

#[cfg(not(windows))]
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
    let mut bytes = serde_json::to_vec(value)?;
    bytes.push(b'\n');
    write_private_file(path, &bytes)
}

#[cfg(windows)]
fn write_private_file(path: &Path, bytes: &[u8]) -> Result<()> {
    // Windows does not support Unix directory fsync. The shared primitive
    // flushes a private sibling and publishes via MOVEFILE_WRITE_THROUGH,
    // including replacement of resident Host binding/locator documents.
    rovai_core::platform::atomic_write_private_bytes(path, bytes)
}

#[cfg(not(windows))]
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

fn redact_pi_diagnostic(message: &str) -> String {
    let truncated = message.chars().take(4_000).collect::<String>();
    let lowercase = truncated.to_ascii_lowercase();
    if [
        "api_key",
        "apikey",
        "authorization",
        "bearer ",
        "auth token",
    ]
    .iter()
    .any(|marker| lowercase.contains(marker))
    {
        "[redacted Pi diagnostic: sensitive marker detected]".to_string()
    } else {
        truncated
    }
}

#[cfg(all(test, feature = "extended-tests"))]
mod tests {
    use super::*;

    // Owns Pi's actual private-file seam: the no-Prompt probe creates an empty
    // Session, while resident Hosts replace binding documents at the same path.
    // Pure Session validators and Unix-only fake Hosts do not exercise this I/O.
    #[test]
    fn private_files_support_empty_probe_sessions_and_atomic_binding_replacement() {
        let root = std::env::temp_dir().join(format!("rovai-pi-private-{}", uuid::Uuid::new_v4()));
        let result = (|| -> Result<()> {
            #[cfg(windows)]
            {
                let legacy = root.join("runtime/pi");
                std::fs::create_dir_all(&legacy)?;
                std::fs::write(legacy.join("untouched"), b"legacy")?;
            }
            let private_root = private_runtime_directory(&root);
            let session = private_root
                .join("sessions")
                .join("machine-ready-session.jsonl");
            write_private_file(&session, b"")?;
            assert!(std::fs::read(&session)?.is_empty());
            let locator = private_root
                .join("sessions")
                .join("a".repeat(64))
                .join("b".repeat(64))
                .join("locator.json");
            write_private_json(&locator, &json!({"session": "exact"}))?;
            assert!(locator.is_file());
            let binding = private_root.join("host-config").join("binding.json");
            for generation in [1, 2] {
                write_private_json(&binding, &json!({"generation": generation}))?;
                let saved: Value = serde_json::from_slice(&std::fs::read(&binding)?)?;
                assert_eq!(saved["generation"], generation);
            }
            assert_eq!(std::fs::read_dir(binding.parent().unwrap())?.count(), 1);
            // A failed destination must stay a directory; genuine I/O failures
            // remain errors and the helper removes its uncommitted sibling.
            let occupied = private_root.join("occupied");
            create_private_directory(&occupied)?;
            assert!(write_private_file(&occupied, b"invalid").is_err());
            assert!(occupied.is_dir());
            assert_eq!(std::fs::read_dir(&private_root)?.count(), 3);
            #[cfg(windows)]
            assert_eq!(std::fs::read(root.join("runtime/pi/untouched"))?, b"legacy");
            Ok(())
        })();
        let _ = std::fs::remove_dir_all(&root);
        result.unwrap();
    }

    #[test]
    fn numeric_context_rejects_content_and_stale_run_host_session_or_binding() {
        let value = json!({"schemaVersion":1,"extensionVersion":PI_HOST_EXTENSION_VERSION,
            "hostInstanceId":"host","hostBindingGeneration":2,"agentRunId":"run","executionEpoch":3,
            "nativeBindingId":"binding","nativeBindingGeneration":4,"sessionId":"session",
            "provider":"provider","modelId":"model","usedTokens":32,"windowTokens":100});
        let binding = PiBindingSeed {
            agent_run_id: "run".into(),
            execution_epoch: 3,
            native_binding_id: "binding".into(),
            native_binding_generation: 4,
            expected_native_session_id: Some("session".into()),
            bootstrap: String::new(),
            bootstrap_payload_digest: String::new(),
        }
        .document("host", 2);
        let owner = PiRuntimeOwner {
            agent_run_id: "run".into(),
            execution_epoch: 3,
            native_prompt_id: "prompt".into(),
            delivery_id: "delivery".into(),
        };
        let parse = |v: Value| serde_json::from_value::<PiManagedContextUsage>(v).unwrap();
        assert!(parse(value.clone()).matches("host", "session", &binding, &owner));
        let packet = parse(value.clone()).into_incoming("host".into(), owner.clone(), 7);
        let successor = PiRuntimeOwner {
            agent_run_id: "next-run".into(),
            execution_epoch: 4,
            native_prompt_id: "next-prompt".into(),
            delivery_id: "next-delivery".into(),
        };
        let PiIncoming::Message {
            agent_run_id,
            execution_epoch,
            native_session_id,
            native_prompt_id,
            delivery_id,
            message,
            ..
        } = packet
        else {
            panic!("expected numeric packet")
        };
        assert_eq!(agent_run_id, owner.agent_run_id);
        assert_eq!(execution_epoch, owner.execution_epoch);
        assert_eq!(native_session_id, "session");
        assert_eq!(native_prompt_id, owner.native_prompt_id);
        assert_eq!(delivery_id, owner.delivery_id);
        assert_ne!(agent_run_id, successor.agent_run_id);
        assert_eq!(message["usedTokens"], 32);
        for (key, changed) in [
            ("agentRunId", json!("old-run")),
            ("executionEpoch", json!(2)),
            ("hostInstanceId", json!("old-host")),
            ("hostBindingGeneration", json!(1)),
            ("nativeBindingId", json!("old-binding")),
            ("nativeBindingGeneration", json!(3)),
            ("sessionId", json!("old-session")),
            ("usedTokens", json!(-1)),
            ("windowTokens", json!(-1)),
        ] {
            let mut altered = value.clone();
            altered[key] = changed;
            assert!(
                !parse(altered).matches("host", "session", &binding, &owner),
                "reject {key}"
            );
        }
        let mut unknown = value.clone();
        unknown["usedTokens"] = Value::Null;
        assert!(parse(unknown).matches("host", "session", &binding, &owner));
        let mut used_only = value.clone();
        used_only["windowTokens"] = json!(0);
        assert!(parse(used_only.clone()).matches("host", "session", &binding, &owner));
        used_only["windowTokens"] = Value::Null;
        assert!(parse(used_only.clone()).matches("host", "session", &binding, &owner));
        used_only["usedTokens"] = Value::Null;
        assert!(!parse(used_only).matches("host", "session", &binding, &owner));
        let mut overflow = value.clone();
        overflow["usedTokens"] = json!(101);
        assert!(
            parse(overflow).matches("host", "session", &binding, &owner),
            "projection preserves used and removes the inapplicable window"
        );
        let mut content = value;
        content["text"] = json!("PRIVATE_CANARY");
        assert!(serde_json::from_value::<PiManagedContextUsage>(content).is_err());
    }

    #[test]
    fn execution_epoch_fence_rejects_stale_before_runtime_retirement() {
        assert_eq!(
            pi_epoch_disposition(7, 7),
            PiEpochDisposition::ReuseOrRetireSame
        );
        assert_eq!(pi_epoch_disposition(6, 7), PiEpochDisposition::ReplaceOlder);
        assert_eq!(pi_epoch_disposition(8, 7), PiEpochDisposition::RejectStale);
    }

    #[test]
    fn exact_resume_fallback_accepts_only_explicit_unavailable_switch_targets() {
        for message in [
            "session file not found",
            "target does not exist",
            "cannot read session",
            "session is unreadable",
        ] {
            let error = anyhow::Error::new(PiRpcCommandRejected {
                command: "switch_session".to_string(),
                message: message.to_string(),
            });
            assert!(switch_target_is_explicitly_unavailable(&error));
        }
        for error in [
            anyhow::Error::new(PiRpcCommandRejected {
                command: "switch_session".to_string(),
                message: "internal RPC failure".to_string(),
            }),
            anyhow::Error::new(PiRpcCommandRejected {
                command: "get_available_models".to_string(),
                message: "model catalog not found".to_string(),
            }),
            anyhow::anyhow!("Pi RPC command timed out: switch_session"),
        ] {
            assert!(!switch_target_is_explicitly_unavailable(&error));
        }
    }

    #[test]
    fn activation_failure_taxonomy_is_stable_through_context() {
        for kind in [
            PiActivationFailureKind::ResumeContinuityLost,
            PiActivationFailureKind::ActivationFailed,
            PiActivationFailureKind::HostFailed,
            PiActivationFailureKind::ConfigurationFailed,
        ] {
            let error = activation_failure(kind, "controlled failure").context("outer context");
            assert_eq!(activation_failure_kind(&error), Some(kind));
        }
        assert_eq!(
            activation_failure_kind(&anyhow::anyhow!("unclassified")),
            None
        );
    }

    #[cfg(unix)]
    fn write_pi_host_fixture(root: &Path) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let executable = root.join("pi");
        std::fs::write(
            &executable,
            r###"#!/bin/sh
set -eu
fixture_dir=$(CDPATH= cd -- "$(/usr/bin/dirname -- "$0")" && pwd)
request_log="$fixture_dir/requests.jsonl"
event_log="$fixture_dir/events.jsonl"
shutdown_marker="$fixture_dir/shutdown"
probe_root_log="$fixture_dir/probe-root"
printf '%s\n' "$PWD" > "$probe_root_log"
session_dir="$PWD/sessions"
/bin/mkdir -p "$session_dir"
session_number=1
provider=minimax
model_id=MiniMax-M3
thinking_level=high
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
  host_instance_id=$(/usr/bin/sed -n 's/.*"hostInstanceId":"\([^"]*\)".*/\1/p' "$ROVAI_PI_HOST_BINDING_FILE")
  host_binding_generation=$(/usr/bin/sed -n 's/.*"hostBindingGeneration":\([0-9][0-9]*\).*/\1/p' "$ROVAI_PI_HOST_BINDING_FILE")
  event=$(printf '{"type":"extension_ui_request","method":"setStatus","statusKey":"rovai-managed-session-state","statusText":"{\\"schemaVersion\\":3,\\"extensionVersion\\":\\"rovai-pi-host-v8\\",\\"hostInstanceId\\":\\"%s\\",\\"hostBindingGeneration\\":%s,\\"sessionId\\":\\"%s\\",\\"sessionFile\\":\\"%s\\",\\"cwd\\":\\"%s\\"}"}' "$host_instance_id" "$host_binding_generation" "$session_id" "$session_file" "$PWD")
  printf '%s\n' "$event" >> "$event_log"
  printf '%s\n' "$event"
}

write_session
trap 'printf stopped > "$shutdown_marker"; exit 0' TERM INT

while IFS= read -r request; do
  printf '%s\n' "$request" >> "$request_log"
  request_id=$(printf '%s\n' "$request" | /usr/bin/sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
  request_type=$(printf '%s\n' "$request" | /usr/bin/sed -n 's/.*"type":"\([^"]*\)".*/\1/p')
  case "$request_type" in
    get_state)
      emit_managed_session_state
      printf '{"type":"response","id":"%s","success":true,"command":"get_state","data":{"sessionId":"%s","sessionFile":"%s","model":{"provider":"%s","id":"%s"},"thinkingLevel":"%s"}}\n' "$request_id" "$session_id" "$session_file" "$provider" "$model_id" "$thinking_level"
      ;;
    get_available_models)
      if [ -f "$fixture_dir/provider-error" ]; then
        printf '%s\n' '{"type":"extension_error","extensionPath":"fixture.ts","event":"register_provider","error":"invalid provider configuration"}'
      fi
      if [ -f "$fixture_dir/stderr-only" ]; then
        printf '%s\n' 'provider warning text without structured evidence' >&2
      fi
      printf '{"type":"response","id":"%s","success":true,"command":"get_available_models","data":{"models":[{"provider":"minimax","id":"MiniMax-M3","name":"MiniMax M3"},{"provider":"other","id":"MiniMax-M3"},{"provider":"minimax","id":"next"}]}}\n' "$request_id"
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
      provider=minimax
      model_id=MiniMax-M3
      thinking_level=high
      session_id="00000000-0000-4000-8000-000000000001"
      session_file="$initial_session_file"
      emit_managed_session_state
      printf '{"type":"response","id":"%s","success":true,"command":"switch_session","data":{"cancelled":false}}\n' "$request_id"
      ;;
    set_model)
      provider=$(printf '%s\n' "$request" | /usr/bin/sed -n 's/.*"provider":"\([^"]*\)".*/\1/p')
      model_id=$(printf '%s\n' "$request" | /usr/bin/sed -n 's/.*"modelId":"\([^"]*\)".*/\1/p')
      thinking_level=medium
      printf '{"type":"response","id":"%s","success":true,"command":"set_model","data":{}}\n' "$request_id"
      ;;
    set_thinking_level)
      thinking_level=$(printf '%s\n' "$request" | /usr/bin/sed -n 's/.*"level":"\([^"]*\)".*/\1/p')
      if [ "$thinking_level" = max ]; then thinking_level=high; fi
      printf '{"type":"response","id":"%s","success":true,"command":"set_thinking_level","data":{"level":"%s"}}\n' "$request_id" "$thinking_level"
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

        executable
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn machine_ready_probe_never_sends_a_prompt_or_waits_for_agent_events() {
        let root = std::env::temp_dir().join(format!(
            "rovai-pi-machine-ready-fixture-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let executable = write_pi_host_fixture(&root);

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

        // Compare scopes at the same managed-host boundary: catalog refresh must
        // not repeat the full replacement/resume behavioral checks above.
        let catalog = model_catalog_probe(&executable).await.unwrap();
        assert_eq!(catalog, observation.raw_model_catalog);
        let requests = std::fs::read_to_string(root.join("requests.jsonl")).unwrap();
        let catalog_commands = requests
            .lines()
            .skip(command_types.len())
            .map(|line| {
                serde_json::from_str::<Value>(line).unwrap()["type"]
                    .as_str()
                    .unwrap()
                    .to_string()
            })
            .collect::<Vec<_>>();
        assert_eq!(catalog_commands, ["get_state", "get_available_models"]);
        let catalog_root = PathBuf::from(
            std::fs::read_to_string(root.join("probe-root"))
                .unwrap()
                .trim(),
        );
        assert!(
            !catalog_root.exists(),
            "catalog-only private root must also be cleaned"
        );

        // Native RPC's register_provider event is observable even when the
        // catalog response succeeds. No completeness field is added to the RPC.
        std::fs::write(root.join("provider-error"), "").unwrap();
        assert!(
            model_catalog_probe(&executable)
                .await
                .unwrap_err()
                .to_string()
                .contains("registration failure")
        );
        std::fs::remove_file(root.join("provider-error")).unwrap();
        // Internal ModelRuntime.getError() has no RPC representation. A valid
        // partial-looking list, with only arbitrary stderr, remains an observation.
        std::fs::write(root.join("stderr-only"), "").unwrap();
        assert_eq!(model_catalog_probe(&executable).await.unwrap(), catalog);

        std::fs::remove_dir_all(root).unwrap();
    }

    // Activation owns restored native state and side-effectful RPC order, which
    // pure model validators and the no-Session catalog probe cannot demonstrate.
    #[cfg(unix)]
    #[tokio::test]
    async fn activation_preserves_same_model_thinking_and_strictly_verifies_overrides() {
        let root =
            std::env::temp_dir().join(format!("rovai-pi-activation-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let executable = write_pi_host_fixture(&root);
        let (host, _probe_root) = spawn_probe_host(&executable).await.unwrap();
        let state = host.command("get_state", json!({})).await.unwrap();
        let session_id = state["data"]["sessionId"].as_str().unwrap();
        let session_file = PathBuf::from(state["data"]["sessionFile"].as_str().unwrap());
        let locators = root.join("locators");
        write_session_locator(&locators, session_id, &session_file, &host.cwd, false).unwrap();
        let seed = PiBindingSeed {
            agent_run_id: "run".into(),
            execution_epoch: 1,
            native_binding_id: "binding".into(),
            native_binding_generation: 1,
            expected_native_session_id: Some(session_id.into()),
            bootstrap: "fixture".into(),
            bootstrap_payload_digest: "fixture".into(),
        };
        for (restore, provider, model, requested, observed, switches) in [
            (true, "minimax", "MiniMax-M3", None, "high", 0),
            (true, "minimax", "MiniMax-M3", Some("low"), "low", 0),
            (true, "minimax", "next", None, "medium", 1),
            (true, "other", "MiniMax-M3", None, "medium", 1),
            (true, "minimax", "next", Some("low"), "low", 1),
            (true, "minimax", "MiniMax-M3", Some("max"), "high", 0),
            (false, "minimax", "MiniMax-M3", None, "high", 0),
        ] {
            let frozen: FrozenAgentRuntimeConfig = serde_json::from_value(json!({
                "adapterKind":"pi", "installationId":"fixture", "installationGeneration":1,
                "searchEnvironmentGeneration":0, "executablePath":executable, "authScope":"default",
                "reportedVersion":null, "executableFingerprint":"fixture", "capabilities":[],
                "protocolVersion":"pi-rpc", "model": {"source":"explicit",
                    "modelId":format!("pi://model?provider={provider}&id={model}"),
                    "options":requested.map(|value| json!({"thinking_level":value})).unwrap_or(json!({}))},
                "permissions":{"adapterKind":"pi","schemaVersion":1,"values":{}},
                "nativeSessionCompatibilityKey":null,"bindingCompatibilityDigest":"fixture",
                "hostConfigDigest":"fixture","configDigest":"fixture"
            })).unwrap();
            std::fs::write(root.join("requests.jsonl"), "").unwrap();
            // Deliberately poison only the old cached identity; activation must
            // decide from the restored native Session's state instead.
            *host.model_identity.write().await =
                Some((provider.into(), model.into(), "off".into()));
            let activation_seed = PiBindingSeed {
                expected_native_session_id: restore.then(|| session_id.to_string()),
                ..seed.clone()
            };
            let result = host.activate(&activation_seed, &locators, &frozen).await;
            if requested == Some("max") {
                let error = result.err().expect("clamped override must fail");
                assert_eq!(
                    activation_failure_kind(&error),
                    Some(PiActivationFailureKind::ConfigurationFailed)
                );
                assert!(error.to_string().contains("requested=max, observed=high"));
            } else {
                result.unwrap();
                assert_eq!(
                    host.model_identity.read().await.as_ref().unwrap().2,
                    observed
                );
            }
            let requests = std::fs::read_to_string(root.join("requests.jsonl")).unwrap();
            let commands = requests
                .lines()
                .map(|line| {
                    serde_json::from_str::<Value>(line).unwrap()["type"]
                        .as_str()
                        .unwrap()
                        .to_owned()
                })
                .collect::<Vec<_>>();
            assert_eq!(
                &commands[..3],
                [
                    if restore {
                        "switch_session"
                    } else {
                        "new_session"
                    },
                    "get_state",
                    "get_available_models"
                ]
            );
            assert_eq!(
                commands
                    .iter()
                    .filter(|command| *command == "set_model")
                    .count(),
                switches
            );
            assert_eq!(
                commands
                    .iter()
                    .filter(|command| *command == "set_thinking_level")
                    .count(),
                usize::from(requested.is_some())
            );
            assert_eq!(commands.last().unwrap(), "get_state");
            assert_eq!(
                commands
                    .iter()
                    .filter(|command| *command == "new_session")
                    .count(),
                usize::from(!restore)
            );
            assert!(!commands.iter().any(|command| command == "prompt"));
        }
        host.shutdown_and_reap().await;
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn late_abort_response_remains_correlated_after_the_waiter_deadline() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!(
            "rovai-pi-abort-correlation-fixture-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let executable = root.join("pi");
        std::fs::write(
            &executable,
            r###"#!/bin/sh
set -eu
fixture_dir=$(CDPATH= cd -- "$(/usr/bin/dirname -- "$0")" && pwd)
request_log="$fixture_dir/requests.jsonl"
trap 'exit 0' TERM INT
while IFS= read -r request; do
  printf '%s\n' "$request" >> "$request_log"
  request_id=$(printf '%s\n' "$request" | /usr/bin/sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
  request_type=$(printf '%s\n' "$request" | /usr/bin/sed -n 's/.*"type":"\([^"]*\)".*/\1/p')
  case "$request_type" in
    get_state)
      printf '{"type":"response","id":"%s","success":true,"command":"get_state","data":{}}\n' "$request_id"
      ;;
    abort)
      /bin/sleep 0.15
      printf '{"type":"response","id":"%s","success":true,"command":"abort","data":{}}\n' "$request_id"
      ;;
    *)
      printf '{"type":"response","id":"%s","success":false,"command":"%s","error":"unexpected command"}\n' "$request_id" "$request_type"
      ;;
  esac
done
"###,
        )
        .unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        let bootstrap = "managed bootstrap".to_string();
        let seed = PiBindingSeed {
            agent_run_id: "run-abort".to_string(),
            execution_epoch: 1,
            native_binding_id: "binding-abort".to_string(),
            native_binding_generation: 1,
            expected_native_session_id: None,
            bootstrap_payload_digest: format!("{:x}", Sha256::digest(bootstrap.as_bytes())),
            bootstrap,
        };
        let (incoming, _receiver) = mpsc::unbounded_channel();
        let host = PiHost::spawn(PiHostLaunch {
            executable: &executable,
            cwd: &root,
            private_runtime_dir: &root.join("private"),
            session_dir: None,
            initial_session_file: None,
            initial_binding: &seed,
            incoming,
            builtin_tools: None,
        })
        .await
        .unwrap();
        let runtime = PiRuntime::from_host(
            PiRuntimeOwner {
                agent_run_id: "run-abort".to_string(),
                execution_epoch: 1,
                native_prompt_id: "prompt-abort".to_string(),
                delivery_id: "delivery-abort".to_string(),
            },
            "camp-abort".to_string(),
            host.clone(),
            ActivatedPiSession {
                session_id: "session-abort".to_string(),
                session_file: root.join("session.jsonl"),
                model_fingerprint: "model-abort".to_string(),
                model_supports_images: false,
            },
        );

        assert!(
            timeout(Duration::from_millis(20), runtime.cancel())
                .await
                .is_err(),
            "the outer cancellation deadline should be allowed to stop waiting"
        );
        tokio::time::sleep(Duration::from_millis(220)).await;
        assert!(
            host.is_alive(),
            "a late abort response must not poison the Host"
        );
        host.command("get_state", json!({})).await.unwrap();
        assert!(host.pending.lock().await.is_empty());

        let requests = std::fs::read_to_string(root.join("requests.jsonl")).unwrap();
        let commands = requests
            .lines()
            .map(|line| {
                serde_json::from_str::<Value>(line).unwrap()["type"]
                    .as_str()
                    .unwrap()
                    .to_string()
            })
            .collect::<Vec<_>>();
        assert_eq!(commands, ["get_state", "abort", "get_state"]);
        host.shutdown_and_reap().await;
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
    fn production_host_launch_preserves_pi_native_resources() {
        let extension = Path::new("/private/rovai-pi-host-v8.ts");
        let mut production = Command::new("pi");
        append_host_arguments(&mut production, extension);
        let production_args = production
            .as_std()
            .get_args()
            .map(|argument| argument.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert_eq!(
            production_args,
            [
                "--mode",
                "rpc",
                "--no-themes",
                "--approve",
                "--extension",
                "/private/rovai-pi-host-v8.ts",
            ]
        );
        for forbidden in [
            "--no-skills",
            "--no-context-files",
            "--no-prompt-templates",
            "--no-builtin-tools",
            "--no-approve",
            "--no-extensions",
        ] {
            assert!(!production_args.iter().any(|argument| argument == forbidden));
        }
    }

    #[cfg(windows)]
    #[test]
    fn host_cwd_uses_safe_dos_spelling_and_rejects_extended_only_paths() {
        let long_path = format!(r"\\?\C:\{}\project", "segment\\".repeat(40));
        let cases = [
            (r"C:\work\project", Some(r"C:\work\project")),
            (r"\\?\C:\work\project", Some(r"C:\work\project")),
            (r"\\?\C:\用户\项目 空格", Some(r"C:\用户\项目 空格")),
            (r"\\?\C:\work\trailing.", None),
            (r"\\?\C:\work\trailing ", None),
            (r"\\?\C:\work\NUL", None),
            (r"\\?\UNC\server\share\project", None),
            (r"\\?\Volume{fixture}\project", None),
            (long_path.as_str(), None),
        ];
        for (cwd, expected) in cases {
            let mut command = Command::new(std::env::current_exe().unwrap());
            let result = configure_host_working_directory(&mut command, Path::new(cwd));
            match expected {
                Some(expected) => {
                    result.unwrap();
                    assert_eq!(
                        command.as_std().get_current_dir(),
                        Some(Path::new(expected))
                    );
                }
                None => {
                    let error = result.expect_err(cwd);
                    assert!(error.to_string().contains("Pi working directory"));
                    assert!(command.as_std().get_current_dir().is_none());
                }
            }
        }
    }

    // This explicit smoke owns native EXE + ManagedProcess + Pi's default
    // Session-directory creation. The deterministic command test above cannot
    // prove how an upstream binary interprets the captured Windows cwd.
    #[cfg(windows)]
    #[tokio::test]
    #[ignore = "requires native Pi via ROVAI_PI_STARTUP_SMOKE_EXE and an isolated ROVAI_PI_STARTUP_SMOKE_ROOT/PI_CODING_AGENT_DIR"]
    async fn native_pi_host_starts_with_canonical_workspace() -> Result<()> {
        let executable = PathBuf::from(std::env::var("ROVAI_PI_STARTUP_SMOKE_EXE")?);
        let root = PathBuf::from(std::env::var("ROVAI_PI_STARTUP_SMOKE_ROOT")?);
        let agent_dir = PathBuf::from(std::env::var("PI_CODING_AGENT_DIR")?);
        anyhow::ensure!(root.is_absolute() && agent_dir == root.join("agent"));
        anyhow::ensure!(executable.extension().is_some_and(|ext| ext == "exe"));
        std::fs::create_dir_all(&agent_dir)?;
        for workspace_name in ["quick-chat", "中文项目 空格"] {
            let workspace = root.join(workspace_name);
            std::fs::create_dir_all(&workspace)?;
            let canonical = workspace.canonicalize()?;
            let bootstrap = "Pi cwd no-Prompt smoke".to_string();
            let seed = PiBindingSeed {
                agent_run_id: uuid::Uuid::new_v4().to_string(),
                execution_epoch: 1,
                native_binding_id: uuid::Uuid::new_v4().to_string(),
                native_binding_generation: 1,
                expected_native_session_id: None,
                bootstrap_payload_digest: format!("{:x}", Sha256::digest(bootstrap.as_bytes())),
                bootstrap,
            };
            let (incoming, _receiver) = mpsc::unbounded_channel();
            let host = PiHost::spawn(PiHostLaunch {
                executable: &executable,
                cwd: &canonical,
                private_runtime_dir: &private_runtime_directory(&root),
                session_dir: None,
                initial_session_file: None,
                initial_binding: &seed,
                incoming,
                builtin_tools: None,
            })
            .await?;
            let state = host.command("get_state", json!({})).await;
            let reaped = host.shutdown_and_reap_with_status().await;
            let state = state?;
            anyhow::ensure!(reaped, "Pi Host was not reaped");
            assert_eq!(host.cwd, canonical);
            let session_file = PathBuf::from(state["data"]["sessionFile"].as_str().unwrap());
            assert!(session_file.starts_with(agent_dir.join("sessions")));
            assert!(!session_file.to_string_lossy().contains('?'));
        }
        Ok(())
    }

    #[test]
    fn prompt_images_keep_authorized_order_mime_and_exact_bytes() {
        let root =
            std::env::temp_dir().join(format!("rovai-pi-prompt-images-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let png = root.join("one.bin");
        let text = root.join("notes.txt");
        let gif = root.join("two.bin");
        let png_bytes = b"\x89PNG\r\n\x1a\nfixture";
        let gif_bytes = b"GIF89afixture";
        std::fs::write(&png, png_bytes).unwrap();
        std::fs::write(&text, b"ordinary file").unwrap();
        std::fs::write(&gif, gif_bytes).unwrap();
        let images = prepare_prompt_images(&[
            (png, Some(format!("sha256:{}", sha256_bytes(png_bytes)))),
            (
                text,
                Some(format!("sha256:{}", sha256_bytes(b"ordinary file"))),
            ),
            (root.join("missing.png"), None),
            (gif, None),
        ])
        .unwrap();
        assert_eq!(images.len(), 2);
        assert_eq!(images[0].wire.mime_type, "image/png");
        assert_eq!(images[1].wire.mime_type, "image/gif");
        assert_eq!(
            BASE64_STANDARD.decode(&images[0].wire.data).unwrap(),
            png_bytes
        );
        assert_eq!(
            BASE64_STANDARD.decode(&images[1].wire.data).unwrap(),
            gif_bytes
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn session_header_scan_skips_malformed_and_unknown_records() {
        let root =
            std::env::temp_dir().join(format!("rovai-pi-session-scan-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let id = "00000000-0000-4000-8000-000000000077";
        let session = root.join("session.jsonl");
        std::fs::write(
            &session,
            format!(
                "not-json\n{{\"type\":\"future_record\"}}\n{}\n",
                serde_json::to_string(&json!({"type":"session", "id":id, "cwd":root})).unwrap()
            ),
        )
        .unwrap();
        validate_native_session_file(&session, id, &root, true).unwrap();
        std::fs::remove_dir_all(root).unwrap();
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
