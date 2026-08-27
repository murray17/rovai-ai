use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque},
    ffi::OsString,
    path::{Component, Path, PathBuf},
    process::ExitStatus,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

#[cfg(unix)]
use std::{fs::OpenOptions, io::Write};

use anyhow::{Context, Result, bail};
#[cfg(all(test, unix))]
use rovai_core::agent_runtime_adapter::TRAE_RUNTIME_DEFAULT_MODEL_ID;
use rovai_core::{
    action::{
        ActionResultOutcome, CanonicalActionInput, RuntimeActionRequestBinding,
        RuntimePermissionOption,
    },
    agent_profile::{AdapterKind, FrozenAgentRuntimeConfig},
    agent_runtime_adapter::{
        AcpClientTerminalMode, AgentRuntimeAdapterRegistry, acp_model_catalog_from_session,
        acp_runtime_model_id_from_session, write_kiro_additive_agent_config,
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
    io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::{Mutex, Notify, RwLock, mpsc, oneshot},
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
        write_ephemeral_grok_mcp_plugin,
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
        native_error_code: Option<i64>,
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
        native_error_code: Option<i64>,
        error: String,
    ) -> AcpIncoming {
        AcpIncoming::InputNotAccepted {
            adapter_kind,
            host_instance_id: host_instance_id.to_string(),
            agent_run_id: self.agent_run_id.clone(),
            execution_epoch: self.execution_epoch,
            native_prompt_id: active_prompt.prompt_id.clone(),
            delivery_id: active_prompt.delivery_id.clone(),
            native_error_code,
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
    client_terminal_create_cancelled: bool,
}

#[derive(Debug, Clone)]
enum AcpSessionPhase {
    LoadingReplay {
        replay_event_count: u64,
        replay_byte_count: u64,
        started_at: Instant,
        last_event_at: Option<Instant>,
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
            last_event_at: None,
        }
    }
}

#[derive(Debug, Clone)]
struct AcpActivePrompt {
    prompt_id: String,
    delivery_id: String,
    acceptance_emitted: bool,
    prompt_activity_observed: bool,
    kimi_compaction_lifecycle: KimiCompactionLifecycle,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
enum KimiCompactionLifecycle {
    #[default]
    Idle,
    Pending,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum KimiCompactionLifecycleFrame {
    Started,
    Completed,
    Cancelled,
    Blocked,
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
    SessionMetadata,
    ReplayQuarantined,
    Quarantined(String),
    ReplayRejected(String),
    Missing,
}

fn is_cursor_blocking_request(method: &str) -> bool {
    matches!(method, "cursor/ask_question" | "cursor/create_plan")
}

fn is_cursor_private_notification(method: &str) -> bool {
    matches!(
        method,
        "cursor/update_todos" | "cursor/task" | "cursor/generate_image"
    )
}

fn is_acp_client_terminal_method(method: &str) -> bool {
    matches!(
        method,
        "terminal/create"
            | "terminal/output"
            | "terminal/wait_for_exit"
            | "terminal/kill"
            | "terminal/release"
    )
}

fn is_session_catalog_update(message: &Value) -> bool {
    message.get("id").is_none()
        && message.get("method").and_then(Value::as_str) == Some("session/update")
        && matches!(
            message
                .pointer("/params/update/sessionUpdate")
                .and_then(Value::as_str),
            Some(
                "available_commands_update"
                    | "config_option_update"
                    | "current_mode_update"
                    | "session_info_update"
            )
        )
}

fn is_known_session_lifecycle_extension(adapter_kind: AdapterKind, message: &Value) -> bool {
    if message.get("id").is_some() {
        return false;
    }
    let method = message.get("method").and_then(Value::as_str);
    (adapter_kind == AdapterKind::GrokBuild
        && method.is_some_and(|method| method.starts_with("_x.ai/")))
        || matches!(
            (adapter_kind, message.get("method").and_then(Value::as_str)),
            (AdapterKind::KiroCli, Some("_kiro.dev/compaction/status"))
                | (AdapterKind::KiroCli, Some("_kiro.dev/commands/available"))
                | (AdapterKind::KiroCli, Some("_kiro.dev/metadata"))
                | (
                    AdapterKind::KiroCli,
                    Some("_kiro.dev/mcp/server_initialized")
                )
                | (AdapterKind::CodebuddyCli, Some("_codebuddy.ai/command"))
        )
}

fn is_kimi_compaction_completed_frame(message: &Value) -> bool {
    kimi_compaction_lifecycle_frame(message) == Some(KimiCompactionLifecycleFrame::Completed)
}

fn kimi_compaction_lifecycle_frame(message: &Value) -> Option<KimiCompactionLifecycleFrame> {
    if !(message.get("id").is_none()
        && message.get("method").and_then(Value::as_str) == Some("session/update")
        && message
            .pointer("/params/update/sessionUpdate")
            .and_then(Value::as_str)
            == Some("agent_message_chunk")
        && message
            .pointer("/params/update/content/type")
            .and_then(Value::as_str)
            == Some("text"))
    {
        return None;
    }
    let text = message
        .pointer("/params/update/content/text")
        .and_then(Value::as_str)?;
    if is_kimi_compaction_started_text(text) {
        Some(KimiCompactionLifecycleFrame::Started)
    } else if is_kimi_compaction_completed_text(text) {
        Some(KimiCompactionLifecycleFrame::Completed)
    } else if text == "Compaction cancelled." {
        Some(KimiCompactionLifecycleFrame::Cancelled)
    } else if text == "Compaction is blocked by the current turn; retry when the turn is idle." {
        Some(KimiCompactionLifecycleFrame::Blocked)
    } else {
        None
    }
}

fn is_kimi_compaction_started_text(text: &str) -> bool {
    text == "Compacting conversation context…"
        || text
            .strip_prefix("Compacting conversation context with instruction: ")
            .is_some_and(|instruction| {
                !instruction.is_empty()
                    && !instruction.contains('\n')
                    && !instruction.contains('\r')
            })
}

fn consume_kimi_prompt_compaction_lifecycle_frame(
    state: &mut KimiCompactionLifecycle,
    message: &Value,
) -> bool {
    let Some(frame) = kimi_compaction_lifecycle_frame(message) else {
        return false;
    };
    match (frame, *state) {
        (KimiCompactionLifecycleFrame::Started, _) => {
            *state = KimiCompactionLifecycle::Pending;
            true
        }
        (KimiCompactionLifecycleFrame::Blocked, KimiCompactionLifecycle::Pending) => true,
        (
            KimiCompactionLifecycleFrame::Completed | KimiCompactionLifecycleFrame::Cancelled,
            KimiCompactionLifecycle::Pending,
        ) => {
            *state = KimiCompactionLifecycle::Idle;
            true
        }
        (
            KimiCompactionLifecycleFrame::Completed
            | KimiCompactionLifecycleFrame::Cancelled
            | KimiCompactionLifecycleFrame::Blocked,
            KimiCompactionLifecycle::Idle,
        ) => false,
    }
}

fn is_kimi_compaction_completed_text(text: &str) -> bool {
    let mut lines = text.split('\n');
    lines.next() == Some("Compaction completed.")
        && lines
            .next()
            .and_then(|line| line.strip_prefix("- Messages compacted: "))
            .is_some_and(is_en_us_unsigned_integer)
        && lines
            .next()
            .and_then(|line| line.strip_prefix("- Tokens before: "))
            .is_some_and(is_en_us_unsigned_integer)
        && lines
            .next()
            .and_then(|line| line.strip_prefix("- Tokens after: "))
            .is_some_and(is_en_us_unsigned_integer)
        && lines.next().is_none()
}

fn grok_compaction_completed_occurrence_id(message: &Value) -> Option<String> {
    if message.get("id").is_some()
        || message.get("method").and_then(Value::as_str) != Some("_x.ai/session_notification")
        || message
            .pointer("/params/update/sessionUpdate")
            .and_then(Value::as_str)
            != Some("auto_compact_completed")
        || message
            .pointer("/params/sessionId")
            .and_then(Value::as_str)
            .is_none_or(|session_id| session_id.trim().is_empty())
        || message
            .pointer("/params/update/tokens_after")
            .and_then(Value::as_u64)
            .is_none()
    {
        return None;
    }
    if let Some(value) = message.pointer("/params/update/tokens_before")
        && value.as_u64().is_none()
    {
        return None;
    }
    if let Some(value) = message.pointer("/params/update/elapsed_ms")
        && value.as_i64().is_none_or(|elapsed_ms| elapsed_ms < 0)
    {
        return None;
    }
    if let Some(value) = message.pointer("/params/_meta/isReplay")
        && value.as_bool() != Some(false)
    {
        return None;
    }
    let event_id = message
        .pointer("/params/_meta/eventId")
        .and_then(Value::as_str)?;
    (!event_id.trim().is_empty()).then(|| event_id.to_string())
}

fn is_en_us_unsigned_integer(value: &str) -> bool {
    if value == "0" {
        return true;
    }
    let mut groups = value.split(',');
    let Some(first) = groups.next() else {
        return false;
    };
    if first.is_empty()
        || first.len() > 3
        || first.starts_with('0')
        || !first.bytes().all(|byte| byte.is_ascii_digit())
    {
        return false;
    }
    groups.all(|group| group.len() == 3 && group.bytes().all(|byte| byte.is_ascii_digit()))
}

fn is_idle_session_metadata(adapter_kind: AdapterKind, message: &Value) -> bool {
    is_session_catalog_update(message)
        || is_known_session_lifecycle_extension(adapter_kind, message)
        || (adapter_kind == AdapterKind::KimiCodeCli && is_kimi_compaction_completed_frame(message))
        || (message.get("id").is_none()
            && message.get("method").and_then(Value::as_str) == Some("session/update")
            && message
                .pointer("/params/update/sessionUpdate")
                .and_then(Value::as_str)
                == Some("usage_update"))
}

const ACP_HISTORY_RESTORE_MAX_EVENTS: u64 = 4_096;
const ACP_HISTORY_RESTORE_MAX_BYTES: u64 = 8 * 1024 * 1024;
const ACP_HISTORY_RESTORE_TIMEOUT: Duration = Duration::from_secs(30);
const ACP_HISTORY_RESTORE_POST_RESPONSE_GRACE: Duration = Duration::from_secs(2);
const ACP_HISTORY_RESTORE_QUIET_PERIOD: Duration = Duration::from_millis(100);
const GROK_NATIVE_RULES_REVISION: i64 = 1;

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
    // ACP v1 ToolCallUpdate.content replaces the previous content collection.
    // Keep only validated standard Diff blocks until the matching terminal update.
    public_file_changes: Option<Value>,
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

const ACP_CLIENT_TERMINAL_DEFAULT_OUTPUT_BYTES: usize = 1024 * 1024;
const ACP_CLIENT_TERMINAL_MAX_OUTPUT_BYTES: usize = 8 * 1024 * 1024;
const ACP_CLIENT_TERMINAL_MAX_PER_HOST: usize = 16;

#[derive(Debug, Clone, PartialEq, Eq)]
struct AcpClientTerminalExit {
    exit_code: Option<u32>,
    signal: Option<String>,
}

impl AcpClientTerminalExit {
    fn from_status(status: ExitStatus) -> Self {
        #[cfg(unix)]
        let signal = {
            use std::os::unix::process::ExitStatusExt;

            status.signal().map(unix_signal_name)
        };
        #[cfg(not(unix))]
        let signal = None;
        #[cfg(windows)]
        let exit_code = status
            .code()
            .map(|code| u32::from_ne_bytes(code.to_ne_bytes()));
        #[cfg(not(windows))]
        let exit_code = status.code().and_then(|code| u32::try_from(code).ok());
        Self { exit_code, signal }
    }

    fn wire_value(&self) -> Value {
        json!({
            "exitCode": self.exit_code,
            "signal": self.signal,
        })
    }
}

#[cfg(unix)]
fn unix_signal_name(signal: i32) -> String {
    match signal {
        libc::SIGHUP => "SIGHUP".to_string(),
        libc::SIGINT => "SIGINT".to_string(),
        libc::SIGQUIT => "SIGQUIT".to_string(),
        libc::SIGKILL => "SIGKILL".to_string(),
        libc::SIGTERM => "SIGTERM".to_string(),
        other => format!("SIG{other}"),
    }
}

#[derive(Debug)]
struct AcpClientTerminalOutput {
    bytes: VecDeque<u8>,
    byte_limit: usize,
    truncated: bool,
}

impl AcpClientTerminalOutput {
    fn new(byte_limit: usize) -> Self {
        Self {
            bytes: VecDeque::with_capacity(byte_limit.min(64 * 1024)),
            byte_limit,
            truncated: false,
        }
    }

    fn append(&mut self, bytes: &[u8]) {
        if bytes.is_empty() {
            return;
        }
        if self.byte_limit == 0 {
            self.truncated = true;
            return;
        }
        self.bytes.extend(bytes);
        if self.bytes.len() > self.byte_limit {
            let excess = self.bytes.len() - self.byte_limit;
            self.bytes.drain(..excess);
            self.truncated = true;
        }
    }

    fn snapshot(&self) -> (String, bool) {
        let bytes = self.bytes.iter().copied().collect::<Vec<_>>();
        let mut output = String::from_utf8_lossy(&bytes).into_owned();
        while output.len() > self.byte_limit {
            let next = output
                .char_indices()
                .nth(1)
                .map_or(output.len(), |(index, _)| index);
            output.drain(..next);
        }
        (output, self.truncated)
    }
}

enum AcpClientTerminalControl {
    Kill(oneshot::Sender<std::result::Result<(), String>>),
}

struct AcpClientTerminal {
    session_id: String,
    owner: AcpRuntimeOwner,
    output: Mutex<AcpClientTerminalOutput>,
    completion: RwLock<Option<std::result::Result<AcpClientTerminalExit, String>>>,
    completion_changed: Notify,
    open_output_readers: AtomicU64,
    output_readers_changed: Notify,
    control: mpsc::UnboundedSender<AcpClientTerminalControl>,
}

impl AcpClientTerminal {
    async fn output(&self) -> Value {
        let (output, truncated) = self.output.lock().await.snapshot();
        let completion = self.completion.read().await.clone();
        let mut result = json!({"output": output, "truncated": truncated});
        if let Some(Ok(exit)) = completion {
            result["exitStatus"] = exit.wire_value();
        }
        result
    }

    async fn wait_for_exit(&self) -> Result<AcpClientTerminalExit> {
        loop {
            let notified = self.completion_changed.notified();
            if let Some(completion) = self.completion.read().await.clone() {
                let completion = completion.map_err(anyhow::Error::msg)?;
                self.wait_for_output_readers().await;
                return Ok(completion);
            }
            notified.await;
        }
    }

    async fn wait_for_output_readers(&self) {
        loop {
            let notified = self.output_readers_changed.notified();
            if self.open_output_readers.load(Ordering::Acquire) == 0 {
                return;
            }
            notified.await;
        }
    }

    async fn kill(&self) -> Result<()> {
        if self.completion.read().await.is_some() {
            return Ok(());
        }
        let (sender, receiver) = oneshot::channel();
        if self
            .control
            .send(AcpClientTerminalControl::Kill(sender))
            .is_err()
        {
            return if self.completion.read().await.is_some() {
                Ok(())
            } else {
                Err(anyhow::anyhow!("ACP Client Terminal supervisor stopped"))
            };
        }
        receiver
            .await
            .context("ACP Client Terminal kill acknowledgement was dropped")?
            .map_err(anyhow::Error::msg)
    }
}

struct AcpClientTerminalBridge {
    execution_root: PathBuf,
    launch_template: ManagedProcessLaunchSpec,
    state: Mutex<AcpClientTerminalBridgeState>,
}

#[derive(Default)]
struct AcpClientTerminalBridgeState {
    terminals: HashMap<String, Arc<AcpClientTerminal>>,
    closed: bool,
}

impl AcpClientTerminalBridge {
    fn new(execution_root: &Path, launch_template: ManagedProcessLaunchSpec) -> Result<Self> {
        let execution_root = execution_root.canonicalize().with_context(|| {
            format!(
                "failed to resolve ACP Client Terminal execution root {}",
                execution_root.display()
            )
        })?;
        Ok(Self {
            execution_root,
            launch_template,
            state: Mutex::new(AcpClientTerminalBridgeState::default()),
        })
    }

    async fn create(
        &self,
        session_id: &str,
        owner: &AcpRuntimeOwner,
        params: &Value,
    ) -> Result<Value> {
        let command = params
            .get("command")
            .and_then(Value::as_str)
            .context("terminal/create has no command")?;
        let application = self.launch_template.resolve_child_application(command)?;
        let arguments = terminal_arguments(params)?;
        let environment = terminal_environment(params)?;
        let working_directory = terminal_working_directory(&self.execution_root, params)?;
        let output_byte_limit = terminal_output_byte_limit(params)?;
        let terminal_id = format!("terminal-{}", uuid::Uuid::new_v4());
        let spec = self.launch_template.derive_runtime_one_shot(
            application,
            arguments,
            working_directory,
            environment,
            format!(
                "agent-run:{}:{}:acp-client-terminal:{}",
                owner.agent_run_id, owner.execution_epoch, terminal_id
            ),
        )?;
        let mut state = self.state.lock().await;
        if state.closed {
            bail!("ACP Client Terminal Bridge is closed");
        }
        if state.terminals.len() >= ACP_CLIENT_TERMINAL_MAX_PER_HOST {
            bail!("ACP Client Terminal limit was reached for this Host");
        }
        let mut child =
            ManagedProcess::spawn(spec).context("failed to create ACP Client Terminal")?;
        let stdout = child
            .take_stdout()
            .context("ACP Client Terminal stdout was unavailable")?;
        let stderr = child
            .take_stderr()
            .context("ACP Client Terminal stderr was unavailable")?;
        let (control, controls) = mpsc::unbounded_channel();
        let terminal = Arc::new(AcpClientTerminal {
            session_id: session_id.to_string(),
            owner: owner.clone(),
            output: Mutex::new(AcpClientTerminalOutput::new(output_byte_limit)),
            completion: RwLock::new(None),
            completion_changed: Notify::new(),
            open_output_readers: AtomicU64::new(2),
            output_readers_changed: Notify::new(),
            control,
        });
        state
            .terminals
            .insert(terminal_id.clone(), terminal.clone());
        drop(state);
        spawn_acp_client_terminal_output_reader(terminal.clone(), stdout);
        spawn_acp_client_terminal_output_reader(terminal.clone(), stderr);
        tokio::spawn(supervise_acp_client_terminal(child, terminal, controls));
        Ok(json!({"terminalId": terminal_id}))
    }

    async fn output(
        &self,
        session_id: &str,
        owner: &AcpRuntimeOwner,
        terminal_id: &str,
    ) -> Result<Value> {
        Ok(self
            .terminal(session_id, owner, terminal_id)
            .await?
            .output()
            .await)
    }

    async fn wait_for_exit(
        &self,
        session_id: &str,
        owner: &AcpRuntimeOwner,
        terminal_id: &str,
    ) -> Result<Value> {
        Ok(self
            .terminal(session_id, owner, terminal_id)
            .await?
            .wait_for_exit()
            .await?
            .wire_value())
    }

    async fn kill(
        &self,
        session_id: &str,
        owner: &AcpRuntimeOwner,
        terminal_id: &str,
    ) -> Result<Value> {
        self.terminal(session_id, owner, terminal_id)
            .await?
            .kill()
            .await?;
        Ok(json!({}))
    }

    async fn release(
        &self,
        session_id: &str,
        owner: &AcpRuntimeOwner,
        terminal_id: &str,
    ) -> Result<Value> {
        let terminal = {
            let state = self.state.lock().await;
            match state.terminals.get(terminal_id) {
                Some(terminal) if terminal.session_id == session_id && &terminal.owner == owner => {
                    Some(terminal.clone())
                }
                Some(_) => bail!("ACP Client Terminal belongs to another Session"),
                // Release is idempotent so a retried response cannot strand a
                // process after the first request already removed its handle.
                None => return Ok(json!({})),
            }
        };
        if let Some(terminal) = terminal {
            let settled =
                cleanup_acp_client_terminals(vec![(terminal_id.to_string(), terminal)]).await;
            if !settled.contains(terminal_id) {
                bail!("ACP Client Terminal did not exit before its release deadline");
            }
            self.state.lock().await.terminals.remove(terminal_id);
        }
        Ok(json!({}))
    }

    async fn release_session(&self, session_id: &str, owner: &AcpRuntimeOwner) {
        let terminals = {
            let state = self.state.lock().await;
            state
                .terminals
                .iter()
                .filter(|(_, terminal)| {
                    terminal.session_id == session_id && &terminal.owner == owner
                })
                .map(|(id, terminal)| (id.clone(), terminal.clone()))
                .collect::<Vec<_>>()
        };
        let settled = cleanup_acp_client_terminals(terminals).await;
        self.state
            .lock()
            .await
            .terminals
            .retain(|id, _| !settled.contains(id));
    }

    async fn release_all(&self) {
        let terminals = {
            let mut state = self.state.lock().await;
            state.closed = true;
            state
                .terminals
                .iter()
                .map(|(id, terminal)| (id.clone(), terminal.clone()))
                .collect::<Vec<_>>()
        };
        let settled = cleanup_acp_client_terminals(terminals).await;
        self.state
            .lock()
            .await
            .terminals
            .retain(|id, _| !settled.contains(id));
    }

    async fn is_empty(&self) -> bool {
        self.state.lock().await.terminals.is_empty()
    }

    async fn terminal(
        &self,
        session_id: &str,
        owner: &AcpRuntimeOwner,
        terminal_id: &str,
    ) -> Result<Arc<AcpClientTerminal>> {
        let terminal = self
            .state
            .lock()
            .await
            .terminals
            .get(terminal_id)
            .cloned()
            .context("ACP Client Terminal is unavailable or was released")?;
        if terminal.session_id != session_id || &terminal.owner != owner {
            bail!("ACP Client Terminal belongs to another Session or AgentRun");
        }
        Ok(terminal)
    }
}

fn terminal_arguments(params: &Value) -> Result<Vec<OsString>> {
    let Some(arguments) = params.get("args") else {
        return Ok(Vec::new());
    };
    let arguments = arguments
        .as_array()
        .context("terminal/create args must be an array")?;
    if arguments.len() > 4096 {
        bail!("terminal/create has too many arguments");
    }
    arguments
        .iter()
        .map(|argument| {
            argument
                .as_str()
                .map(OsString::from)
                .context("terminal/create argument must be a string")
        })
        .collect()
}

fn terminal_id(params: &Value) -> Result<&str> {
    params
        .get("terminalId")
        .and_then(Value::as_str)
        .context("ACP Client Terminal request has no terminalId")
}

fn terminal_environment(params: &Value) -> Result<BTreeMap<OsString, OsString>> {
    let Some(environment) = params.get("env") else {
        return Ok(BTreeMap::new());
    };
    let environment = environment
        .as_array()
        .context("terminal/create env must be an array")?;
    if environment.len() > 256 {
        bail!("terminal/create has too many environment variables");
    }
    environment
        .iter()
        .map(|variable| {
            let name = variable
                .get("name")
                .and_then(Value::as_str)
                .context("terminal/create environment variable has no name")?;
            let value = variable
                .get("value")
                .and_then(Value::as_str)
                .context("terminal/create environment variable has no value")?;
            Ok((OsString::from(name), OsString::from(value)))
        })
        .collect()
}

fn terminal_working_directory(execution_root: &Path, params: &Value) -> Result<PathBuf> {
    let Some(cwd) = params.get("cwd").filter(|value| !value.is_null()) else {
        return Ok(execution_root.to_path_buf());
    };
    let cwd = cwd
        .as_str()
        .context("terminal/create cwd must be a string")?;
    if !Path::new(cwd).is_absolute() {
        bail!("terminal/create cwd must be absolute");
    }
    let cwd = scoped_path(execution_root, cwd)?;
    if !cwd.is_dir() {
        bail!("terminal/create cwd is not an existing directory");
    }
    Ok(cwd)
}

fn terminal_output_byte_limit(params: &Value) -> Result<usize> {
    let requested = match params.get("outputByteLimit") {
        Some(Value::Null) | None => ACP_CLIENT_TERMINAL_DEFAULT_OUTPUT_BYTES as u64,
        Some(value) => value
            .as_u64()
            .context("terminal/create outputByteLimit must be an unsigned integer")?,
    };
    Ok(usize::try_from(requested)
        .unwrap_or(usize::MAX)
        .min(ACP_CLIENT_TERMINAL_MAX_OUTPUT_BYTES))
}

fn spawn_acp_client_terminal_output_reader<R>(terminal: Arc<AcpClientTerminal>, mut reader: R)
where
    R: AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut buffer = [0_u8; 16 * 1024];
        loop {
            match reader.read(&mut buffer).await {
                Ok(0) => break,
                Ok(read) => terminal.output.lock().await.append(&buffer[..read]),
                Err(_) => break,
            }
        }
        terminal.open_output_readers.fetch_sub(1, Ordering::AcqRel);
        terminal.output_readers_changed.notify_waiters();
    });
}

async fn supervise_acp_client_terminal(
    mut child: ManagedProcess,
    terminal: Arc<AcpClientTerminal>,
    mut controls: mpsc::UnboundedReceiver<AcpClientTerminalControl>,
) {
    let completion = loop {
        tokio::select! {
            status = child.wait() => {
                break status
                    .map(AcpClientTerminalExit::from_status)
                    .map_err(|error| format!("failed to wait for ACP Client Terminal: {error}"));
            }
            control = controls.recv() => match control {
                Some(AcpClientTerminalControl::Kill(sender)) => {
                    let result = child.force_terminate_tree().map_err(|error| error.to_string());
                    let _ = sender.send(result);
                }
                None => {
                    let _ = child.force_terminate_tree();
                }
            }
        }
    };
    *terminal.completion.write().await = Some(completion);
    terminal.completion_changed.notify_waiters();
    while let Ok(AcpClientTerminalControl::Kill(sender)) = controls.try_recv() {
        let _ = sender.send(Ok(()));
    }
}

async fn cleanup_acp_client_terminals(
    terminals: Vec<(String, Arc<AcpClientTerminal>)>,
) -> HashSet<String> {
    for (_, terminal) in &terminals {
        let _ = terminal.kill().await;
    }
    let deadline = Instant::now() + Duration::from_secs(2);
    let mut settled = HashSet::new();
    for (terminal_id, terminal) in terminals {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if timeout(remaining, terminal.wait_for_exit()).await.is_ok() {
            settled.insert(terminal_id);
        }
    }
    settled
}

#[derive(Debug, Clone)]
struct AcpRpcError {
    code: Option<i64>,
    message: String,
}

impl AcpRpcError {
    fn from_response(value: &Value) -> Self {
        Self {
            code: value.get("code").and_then(Value::as_i64),
            message: value
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("ACP request failed")
                .to_string(),
        }
    }

    fn diagnostic(&self) -> String {
        self.code.map_or_else(
            || self.message.clone(),
            |code| format!("ACP error {code}: {}", self.message),
        )
    }
}

pub(crate) struct AcpHost {
    adapter_kind: AdapterKind,
    reported_version: Option<String>,
    client_terminal_mode: AcpClientTerminalMode,
    client_terminal_bridge: Option<AcpClientTerminalBridge>,
    host_instance_id: String,
    child: Mutex<ManagedProcess>,
    stdin: Mutex<ManagedChildStdin>,
    pending: Mutex<HashMap<u64, PendingRpc>>,
    next_id: AtomicU64,
    next_compaction_observation_sequence: AtomicU64,
    grok_acceptance_auto_compact_armed: AtomicBool,
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
    remove_private_config_root_on_shutdown: bool,
    session_permission_mode: Option<String>,
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
        let private_config =
            prepare_private_host_config(private_runtime_dir, frozen_runtime.adapter_kind)?;
        let private_config_root = private_config.as_ref().map(|config| config.root.as_path());
        let session_permission_mode = if frozen_runtime.adapter_kind == AdapterKind::KimiCodeCli {
            Some(
                frozen_runtime
                    .permissions
                    .values
                    .get("permission_mode")
                    .and_then(Value::as_str)
                    .context("Kimi Code Runtime requires permission_mode")?
                    .to_string(),
            )
        } else {
            None
        };
        let host_instance_id = uuid::Uuid::new_v4().to_string();
        let grok_byok_configured =
            frozen_runtime.adapter_kind == AdapterKind::GrokBuild && grok_native_byok_configured()?;
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
            private_config_root,
            attachment_access_root,
            builtin_tools
                .as_ref()
                .map(BuiltinToolProcessConfig::run_tmp),
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
            private_config_root.context("Kiro Host isolation directory is missing")?
        } else {
            cwd
        };
        let process_working_directory = PathBuf::from(acp_protocol_path(process_working_directory));
        command.current_dir(&process_working_directory);
        let spec = ManagedProcessLaunchSpec::capture(
            &command,
            ManagedProcessPurpose::RuntimeHost,
            ManagedStdinPolicy::Piped,
            ManagedWindowsArgvDialect::MicrosoftCrt,
            format!("runtime-host:{}", frozen_runtime.adapter_kind.as_str()),
        )?;
        let client_terminal_mode = AgentRuntimeAdapterRegistry::default()
            .acp_client_terminal_mode(frozen_runtime.adapter_kind);
        let client_terminal_bridge = if client_terminal_mode.is_available() {
            Some(AcpClientTerminalBridge::new(
                workspace.path(),
                spec.clone(),
            )?)
        } else {
            None
        };
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
            client_terminal_mode,
            client_terminal_bridge,
            host_instance_id,
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            next_compaction_observation_sequence: AtomicU64::new(1),
            grok_acceptance_auto_compact_armed: AtomicBool::new(false),
            routes: RwLock::new(HashMap::new()),
            compaction_observers: RwLock::new(HashMap::new()),
            known_sessions: RwLock::new(HashSet::new()),
            session_results: RwLock::new(HashMap::new()),
            incoming,
            alive: AtomicBool::new(true),
            protocol_violated: AtomicBool::new(false),
            initialize_result: RwLock::new(None),
            startup_diagnostics: Mutex::new(String::new()),
            private_config_root: private_config.as_ref().map(|config| config.root.clone()),
            remove_private_config_root_on_shutdown: private_config
                .as_ref()
                .is_some_and(|config| config.remove_on_shutdown),
            session_permission_mode,
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
                        "terminal": host.client_terminal_mode.is_available()
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
                *host.initialize_result.write().await = Some(result.clone());
                let auth_method = match frozen_runtime.adapter_kind {
                    AdapterKind::CursorAgent => Ok(Some(("cursor_login", "Cursor"))),
                    AdapterKind::GrokBuild => health::select_grok_noninteractive_auth_method(
                        &result,
                        grok_byok_configured,
                    )
                    .map(|method| Some((method, "Grok Build"))),
                    _ => Ok(None),
                };
                let auth_method = match auth_method {
                    Ok(auth_method) => auth_method,
                    Err(error) => {
                        host.shutdown().await;
                        return Err(error);
                    }
                };
                if let Some((method_id, runtime_name)) = auth_method {
                    let advertised = result
                        .get("authMethods")
                        .and_then(Value::as_array)
                        .is_some_and(|methods| {
                            methods.iter().any(|method| {
                                method.get("id").and_then(Value::as_str) == Some(method_id)
                            })
                        });
                    if !advertised {
                        host.shutdown().await;
                        bail!(
                            "{runtime_name} ACP did not advertise required authentication method {method_id}"
                        );
                    }
                    if let Err(error) = host
                        .rpc_with_timeout(
                            "authenticate",
                            json!({"methodId": method_id, "_meta": {"headless": true}}),
                            Duration::from_secs(15),
                        )
                        .await
                    {
                        host.shutdown().await;
                        return Err(
                            error.context(format!("{runtime_name} ACP authentication failed"))
                        );
                    }
                }
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
                        let method = message.get("method").and_then(Value::as_str);
                        if host.client_terminal_mode.is_available()
                            && method.is_some_and(is_acp_client_terminal_method)
                            && message.get("id").is_some()
                        {
                            let request_host = host.clone();
                            tokio::spawn(async move {
                                request_host.handle_client_terminal_request(message).await;
                            });
                            continue;
                        }
                        if host.adapter_kind == AdapterKind::CursorAgent
                            && method.is_some_and(is_cursor_private_notification)
                        {
                            // Cursor's non-standard progress notifications do
                            // not carry ACP Session semantics that Rovai can
                            // safely publish or use as execution evidence.
                            continue;
                        }
                        if host.adapter_kind == AdapterKind::CursorAgent
                            && method.is_some_and(|method| {
                                method.starts_with("cursor/") && !is_cursor_blocking_request(method)
                            })
                            && let Some(id) = message.get("id").cloned()
                        {
                            let _ = host
                                .send(json!({
                                    "jsonrpc": "2.0",
                                    "id": id,
                                    "error": {
                                        "code": -32601,
                                        "message": "Unsupported Cursor ACP extension request"
                                    }
                                }))
                                .await;
                            continue;
                        }
                        let declared_session_id = message
                            .pointer("/params/sessionId")
                            .and_then(Value::as_str)
                            .map(str::to_string);
                        let (session_id, route) = match declared_session_id.as_deref() {
                            Some(session_id) => (
                                declared_session_id.clone(),
                                host.route_session_message(session_id, &message, line.len())
                                    .await,
                            ),
                            None if host.adapter_kind == AdapterKind::CursorAgent
                                && method.is_some_and(is_cursor_blocking_request) =>
                            {
                                host.route_unique_active_prompt_message(&message)
                                    .await
                                    .map_or((None, AcpSessionMessageRoute::Missing), |value| {
                                        (Some(value.0), value.1)
                                    })
                            }
                            None => (None, AcpSessionMessageRoute::Missing),
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
                                host.forward_compaction_observation(
                                    session_id,
                                    &message,
                                    AcpCompactionSignalSurface::ActivePrompt,
                                )
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
                            AcpSessionMessageRoute::SessionMetadata => {
                                let session_id = session_id
                                    .as_deref()
                                    .expect("Session metadata route has Session ID");
                                host.forward_compaction_observation(
                                    session_id,
                                    &message,
                                    AcpCompactionSignalSurface::SessionMetadata,
                                )
                                .await;
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
            host.release_all_client_terminals().await;
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
        let response_error = message.get("error").map(AcpRpcError::from_response);
        let response = if let Some(error) = response_error.as_ref() {
            Err(error.diagnostic())
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
                    let should_emit_input_disposition = !active_prompt.acceptance_emitted;
                    active_prompt.acceptance_emitted = true;
                    let active_prompt = active_prompt.clone();
                    route.phase = AcpSessionPhase::PromptCompleted(active_prompt.clone());
                    route.sequence = route.sequence.saturating_add(1);
                    Some((active_prompt, should_emit_input_disposition, route.sequence))
                };
                if let Some((active_prompt, should_emit_input_disposition, sequence)) =
                    active_prompt
                {
                    match (&response, response_error.as_ref()) {
                        (Ok(_), _) if should_emit_input_disposition => {
                            let _ = self.incoming.send(owner.input_accepted(
                                self.adapter_kind,
                                &self.host_instance_id,
                                &session_id,
                                &active_prompt,
                            ));
                        }
                        (Err(_), Some(_))
                            if should_emit_input_disposition
                                && active_prompt.prompt_activity_observed =>
                        {
                            // A matching terminal response alone may be a pre-execution
                            // rejection. Prompt-scoped activity observed before that matching
                            // response proves the current input was processed; terminal failure
                            // is recorded separately and must never make the input retryable.
                            let _ = self.incoming.send(owner.input_accepted(
                                self.adapter_kind,
                                &self.host_instance_id,
                                &session_id,
                                &active_prompt,
                            ));
                        }
                        (Err(error), Some(response_error)) if should_emit_input_disposition => {
                            let _ = self.incoming.send(owner.input_not_accepted(
                                self.adapter_kind,
                                &self.host_instance_id,
                                &active_prompt,
                                response_error.code,
                                error.clone(),
                            ));
                        }
                        _ => {}
                    }
                    let input_disposition =
                        if response.is_ok() || active_prompt.prompt_activity_observed {
                            "accepted"
                        } else {
                            "not_accepted"
                        };
                    let params = match (response, response_error) {
                        (Ok(result), _) => json!({
                            "sessionId": session_id,
                            "promptId": prompt_id,
                            "deliveryId": active_prompt.delivery_id,
                            "requestId": id,
                            "inputDisposition": input_disposition,
                            "result": result
                        }),
                        (Err(error), response_error) => json!({
                            "sessionId": session_id,
                            "promptId": prompt_id,
                            "deliveryId": active_prompt.delivery_id,
                            "requestId": id,
                            "inputDisposition": input_disposition,
                            "nativeErrorCode": response_error.and_then(|error| error.code),
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

    async fn handle_client_terminal_request(&self, request: Value) {
        let request_id = request.get("id").cloned().unwrap_or(Value::Null);
        let method = request
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let params = request.get("params").cloned().unwrap_or(Value::Null);
        let result = self.dispatch_client_terminal_request(method, &params).await;
        let response = match result {
            Ok(result) => json!({
                "jsonrpc": "2.0",
                "id": request_id,
                "result": result,
            }),
            Err(error) => json!({
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {
                    "code": -32000,
                    "message": format!("Rovai-ai ACP Client Terminal rejected the request: {error:#}"),
                }
            }),
        };
        if let Err(error) = self.send(response).await {
            eprintln!("failed to send ACP Client Terminal response for {method}: {error:#}");
        }
    }

    async fn dispatch_client_terminal_request(
        &self,
        method: &str,
        params: &Value,
    ) -> Result<Value> {
        let bridge = self
            .client_terminal_bridge
            .as_ref()
            .context("ACP Client Terminal is disabled for this Runtime")?;
        let session_id = params
            .get("sessionId")
            .and_then(Value::as_str)
            .context("ACP Client Terminal request has no sessionId")?;
        match method {
            "terminal/create" => {
                let routes = self.routes.read().await;
                let route = routes
                    .get(session_id)
                    .context("ACP Client Terminal Session is not bound to an AgentRun")?;
                if route.client_terminal_create_cancelled {
                    bail!("ACP Client Terminal Session is cancelling");
                }
                if !matches!(route.phase, AcpSessionPhase::PromptActive(_)) {
                    bail!("terminal/create is outside the current AgentRun Prompt");
                }
                // Keep the route read fence through process insertion. Cancel
                // and detach take the write fence before draining the Bridge,
                // so a create cannot land after its Run cleanup completed.
                bridge.create(session_id, &route.owner, params).await
            }
            "terminal/output" => {
                let owner = self.client_terminal_owner(session_id).await?;
                bridge
                    .output(session_id, &owner, terminal_id(params)?)
                    .await
            }
            "terminal/wait_for_exit" => {
                let owner = self.client_terminal_owner(session_id).await?;
                bridge
                    .wait_for_exit(session_id, &owner, terminal_id(params)?)
                    .await
            }
            "terminal/kill" => {
                let owner = self.client_terminal_owner(session_id).await?;
                bridge.kill(session_id, &owner, terminal_id(params)?).await
            }
            "terminal/release" => {
                let owner = self.client_terminal_owner(session_id).await?;
                bridge
                    .release(session_id, &owner, terminal_id(params)?)
                    .await
            }
            _ => bail!("unknown ACP Client Terminal method: {method}"),
        }
    }

    async fn client_terminal_owner(&self, session_id: &str) -> Result<AcpRuntimeOwner> {
        let routes = self.routes.read().await;
        let route = routes
            .get(session_id)
            .context("ACP Client Terminal Session is not bound to an AgentRun")?;
        if matches!(route.phase, AcpSessionPhase::ProtocolViolated { .. }) {
            bail!("ACP Client Terminal Session is protocol-violated");
        }
        Ok(route.owner.clone())
    }

    async fn fence_client_terminal_create(&self, session_id: &str, owner: &AcpRuntimeOwner) {
        let mut routes = self.routes.write().await;
        if let Some(route) = routes.get_mut(session_id)
            && &route.owner == owner
        {
            route.client_terminal_create_cancelled = true;
        }
    }

    async fn release_client_terminals_for_session(
        &self,
        session_id: &str,
        owner: &AcpRuntimeOwner,
    ) {
        if let Some(bridge) = &self.client_terminal_bridge {
            bridge.release_session(session_id, owner).await;
        }
    }

    async fn release_all_client_terminals(&self) {
        if let Some(bridge) = &self.client_terminal_bridge {
            bridge.release_all().await;
        }
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
                client_terminal_create_cancelled: false,
            },
        );
        Ok(())
    }

    async fn settle_loading_replay(&self, session_id: &str, owner: &AcpRuntimeOwner) -> Result<()> {
        let response_received_at = Instant::now();
        loop {
            let wait_for = {
                let mut routes = self.routes.write().await;
                let route = routes
                    .get_mut(session_id)
                    .context("ACP Session has no loading route")?;
                if &route.owner != owner {
                    bail!("ACP Session loading route failed Host/Run fencing");
                }
                let AcpSessionPhase::LoadingReplay {
                    started_at,
                    last_event_at,
                    ..
                } = &route.phase
                else {
                    bail!("ACP Session loading route failed Host/Run fencing");
                };
                let grace_remaining = ACP_HISTORY_RESTORE_POST_RESPONSE_GRACE
                    .saturating_sub(response_received_at.elapsed());
                let quiet_remaining = last_event_at.map_or(Duration::ZERO, |last_event_at| {
                    ACP_HISTORY_RESTORE_QUIET_PERIOD.saturating_sub(last_event_at.elapsed())
                });
                let required_wait = grace_remaining.max(quiet_remaining);
                if required_wait.is_zero() {
                    route.phase = AcpSessionPhase::Ready;
                    return Ok(());
                }
                let timeout_remaining =
                    ACP_HISTORY_RESTORE_TIMEOUT.saturating_sub(started_at.elapsed());
                if timeout_remaining.is_zero() {
                    let reason =
                        "ACP History Restore did not settle before its deadline".to_string();
                    route.phase = AcpSessionPhase::ProtocolViolated {
                        reason: reason.clone(),
                    };
                    self.protocol_violated.store(true, Ordering::Release);
                    bail!(reason);
                }
                required_wait.min(timeout_remaining)
            };
            tokio::time::sleep(wait_for).await;
        }
    }

    async fn route_session_message(
        &self,
        session_id: &str,
        message: &Value,
        message_bytes: usize,
    ) -> AcpSessionMessageRoute {
        let mut routes = self.routes.write().await;
        let Some(route) = routes.get_mut(session_id) else {
            drop(routes);
            if ((self.adapter_kind == AdapterKind::KimiCodeCli
                && is_kimi_compaction_completed_frame(message))
                || (self.adapter_kind == AdapterKind::GrokBuild
                    && grok_compaction_completed_occurrence_id(message).is_some()))
                && self
                    .compaction_observers
                    .read()
                    .await
                    .contains_key(session_id)
            {
                // Kimi and Grok compaction may finish outside the Prompt. A
                // normally completed AgentRun may already have detached its
                // owner while the compatibility-keyed Host remains warm, so
                // the Session observer is the surviving authoritative route.
                return AcpSessionMessageRoute::SessionMetadata;
            }
            return AcpSessionMessageRoute::Missing;
        };
        match &mut route.phase {
            AcpSessionPhase::PromptActive(active_prompt) => {
                if self.adapter_kind == AdapterKind::KimiCodeCli
                    && consume_kimi_prompt_compaction_lifecycle_frame(
                        &mut active_prompt.kimi_compaction_lifecycle,
                        message,
                    )
                {
                    return AcpSessionMessageRoute::SessionMetadata;
                }
                if is_session_catalog_update(message)
                    || is_known_session_lifecycle_extension(self.adapter_kind, message)
                {
                    return AcpSessionMessageRoute::SessionMetadata;
                }
                active_prompt.prompt_activity_observed = true;
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
                last_event_at,
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
                *last_event_at = Some(Instant::now());
                AcpSessionMessageRoute::ReplayQuarantined
            }
            AcpSessionPhase::Ready => {
                if is_idle_session_metadata(self.adapter_kind, message) {
                    return AcpSessionMessageRoute::SessionMetadata;
                }
                let reason = format!(
                    "session-scoped message arrived without an active prompt (method={}, update={}, request={})",
                    message
                        .get("method")
                        .and_then(Value::as_str)
                        .unwrap_or("missing"),
                    message
                        .pointer("/params/update/sessionUpdate")
                        .and_then(Value::as_str)
                        .unwrap_or("missing"),
                    message.get("id").is_some()
                );
                route.phase = AcpSessionPhase::ProtocolViolated {
                    reason: reason.clone(),
                };
                self.protocol_violated.store(true, Ordering::Release);
                AcpSessionMessageRoute::Quarantined(reason)
            }
            AcpSessionPhase::PromptCompleted(active_prompt) => {
                if self.adapter_kind == AdapterKind::KimiCodeCli
                    && consume_kimi_prompt_compaction_lifecycle_frame(
                        &mut active_prompt.kimi_compaction_lifecycle,
                        message,
                    )
                {
                    return AcpSessionMessageRoute::SessionMetadata;
                }
                if is_idle_session_metadata(self.adapter_kind, message) {
                    return AcpSessionMessageRoute::SessionMetadata;
                }
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

    async fn route_unique_active_prompt_message(
        &self,
        _message: &Value,
    ) -> Option<(String, AcpSessionMessageRoute)> {
        let mut routes = self.routes.write().await;
        let session_ids = routes
            .iter()
            .filter(|(_, route)| matches!(route.phase, AcpSessionPhase::PromptActive(_)))
            .map(|(session_id, _)| session_id.clone())
            .collect::<Vec<_>>();
        if session_ids.len() != 1 {
            return None;
        }
        let session_id = session_ids.into_iter().next()?;
        let route = routes.get_mut(&session_id)?;
        let AcpSessionPhase::PromptActive(active_prompt) = &mut route.phase else {
            return None;
        };
        active_prompt.prompt_activity_observed = true;
        route.sequence = route.sequence.saturating_add(1);
        Some((
            session_id,
            AcpSessionMessageRoute::Forward {
                owner: route.owner.clone(),
                active_prompt: active_prompt.clone(),
                sequence: route.sequence,
            },
        ))
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

    async fn forward_compaction_observation(
        &self,
        session_id: &str,
        message: &Value,
        surface: AcpCompactionSignalSurface,
    ) {
        let Some(detected) = detect_acp_compaction_signal(self.adapter_kind, message, surface)
        else {
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
        let removed = if routes.get(session_id).map(|route| &route.owner) == Some(owner) {
            routes.remove(session_id);
            true
        } else {
            false
        };
        drop(routes);
        if removed {
            self.release_client_terminals_for_session(session_id, owner)
                .await;
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
        let terminals_are_empty = match &self.client_terminal_bridge {
            Some(bridge) => bridge.is_empty().await,
            None => true,
        };
        self.is_alive()
            && !self.protocol_violated.load(Ordering::Acquire)
            && self.pending.lock().await.is_empty()
            && self.routes.read().await.is_empty()
            && terminals_are_empty
    }

    pub(crate) async fn shutdown_and_reap(&self) {
        self.alive.store(false, Ordering::Release);
        self.release_all_client_terminals().await;
        let mut child = self.child.lock().await;
        let _ = child.request_graceful_termination();
        if timeout(Duration::from_secs(3), child.wait()).await.is_err() {
            let _ = child.force_terminate_tree();
            let _ = timeout(Duration::from_secs(1), child.wait()).await;
        }
        let _ = child.force_terminate_tree();
        if self.remove_private_config_root_on_shutdown
            && let Some(root) = self.private_config_root.as_ref()
        {
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
                let reason = match &route.phase {
                    AcpSessionPhase::LoadingReplay { .. } => "history replay is still loading",
                    AcpSessionPhase::PromptActive(_) => "another prompt is active",
                    AcpSessionPhase::PromptCompleted(_) => "the completed prompt is not detached",
                    AcpSessionPhase::ProtocolViolated { reason } => reason.as_str(),
                    AcpSessionPhase::Ready => unreachable!(),
                };
                bail!("ACP Session is not ready for a new prompt: {reason}");
            }
            route.phase = AcpSessionPhase::PromptActive(AcpActivePrompt {
                prompt_id: prompt_id.clone(),
                delivery_id: delivery_id.to_string(),
                acceptance_emitted: false,
                prompt_activity_observed: false,
                kimi_compaction_lifecycle: KimiCompactionLifecycle::Idle,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AcpCompactionSignalSurface {
    ActivePrompt,
    SessionMetadata,
}

fn detect_acp_compaction_signal(
    adapter_kind: AdapterKind,
    message: &Value,
    surface: AcpCompactionSignalSurface,
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
        AdapterKind::KimiCodeCli
            if surface == AcpCompactionSignalSurface::SessionMetadata
                && is_kimi_compaction_completed_frame(message) =>
        {
            Some(DetectedAcpCompactionSignal {
                source_signal: "kimi.acp.compaction.completed_text.v1",
                admission_point: "completed",
                runtime_occurrence_id: None,
            })
        }
        AdapterKind::GrokBuild if surface == AcpCompactionSignalSurface::SessionMetadata => {
            let runtime_occurrence_id = grok_compaction_completed_occurrence_id(message)?;
            Some(DetectedAcpCompactionSignal {
                source_signal: "grok.acp.auto_compact_completed.v1",
                admission_point: "completed",
                runtime_occurrence_id: Some(runtime_occurrence_id),
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
            | AdapterKind::KimiCodeCli
    )
}

fn validate_new_session_native_rules(
    adapter_kind: AdapterKind,
    continuation: AcpSessionContinuation,
    native_rules: Option<&str>,
) -> Result<Option<&str>> {
    match (adapter_kind, continuation, native_rules) {
        (AdapterKind::GrokBuild, AcpSessionContinuation::New, Some(rules))
            if !rules.trim().is_empty() =>
        {
            Ok(Some(rules))
        }
        (AdapterKind::GrokBuild, AcpSessionContinuation::New, _) => {
            bail!("new Grok ACP Session requires non-empty native rules")
        }
        (AdapterKind::GrokBuild, _, None) => Ok(None),
        (AdapterKind::GrokBuild, _, Some(_)) => {
            bail!("Grok native rules may only be supplied to session/new")
        }
        (_, _, None) => Ok(None),
        (_, _, Some(_)) => {
            bail!("ACP native rules are only supported for a new Grok Session")
        }
    }
}

pub(crate) fn build_acp_new_session_params(
    adapter_kind: AdapterKind,
    cwd: &str,
    mcp_servers: &[Value],
    additional_directories: &[String],
    native_rules: Option<&str>,
) -> Value {
    let mut params = json!({
        "cwd": cwd,
        "mcpServers": mcp_servers,
    });
    if adapter_kind != AdapterKind::CursorAgent {
        params["additionalDirectories"] = json!(additional_directories);
    }
    if let Some(rules) = native_rules {
        params["_meta"] = json!({"rules": rules});
    }
    params
}

pub(crate) fn build_acp_resume_session_params(
    adapter_kind: AdapterKind,
    session_id: &str,
    cwd: &str,
    mcp_servers: &[Value],
    additional_directories: &[String],
) -> Value {
    let mut params = json!({
        "sessionId": session_id,
        "cwd": cwd,
        "mcpServers": mcp_servers,
    });
    if adapter_kind != AdapterKind::CursorAgent {
        // Grok Build 1.x rejects session/resume whenever
        // additionalDirectories is non-empty.
        params["additionalDirectories"] = if adapter_kind == AdapterKind::GrokBuild {
            json!([])
        } else {
            json!(additional_directories)
        };
    }
    params
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

    #[cfg(all(test, unix))]
    pub async fn start_or_resume_session(
        &self,
        existing_session_id: Option<&str>,
        capabilities: AcpSessionCapabilities,
        model_source: &str,
        model: &str,
        model_options: &Value,
        external_mcp_servers: &BTreeMap<String, McpServerDefinition>,
    ) -> Result<String> {
        self.start_or_resume_session_with_native_rules(
            existing_session_id,
            capabilities,
            model_source,
            model,
            model_options,
            external_mcp_servers,
            None,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn start_or_resume_session_with_native_rules(
        &self,
        existing_session_id: Option<&str>,
        capabilities: AcpSessionCapabilities,
        model_source: &str,
        model: &str,
        model_options: &Value,
        external_mcp_servers: &BTreeMap<String, McpServerDefinition>,
        new_session_native_rules: Option<&str>,
    ) -> Result<String> {
        let cwd = acp_protocol_path(&self.execution_root);
        let run_tmp = self
            .host
            .builtin_tool_process_config()
            .context("ACP Runtime has no Built-in Tool Run tmp")?
            .run_tmp();
        let additional_directories =
            session_additional_directories(self.attachment_access_root.as_deref(), Some(run_tmp))?;
        let mcp_servers = if !matches!(
            self.host.adapter_kind,
            AdapterKind::CopilotCli
                | AdapterKind::KiroCli
                | AdapterKind::QoderCli
                | AdapterKind::CodebuddyCli
                | AdapterKind::QwenCode
                | AdapterKind::CursorAgent
                | AdapterKind::GrokBuild
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
        let new_session_native_rules = validate_new_session_native_rules(
            self.host.adapter_kind,
            continuation,
            new_session_native_rules,
        )?;
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
                let params = if continuation == AcpSessionContinuation::Resume {
                    build_acp_resume_session_params(
                        self.host.adapter_kind,
                        existing_session_id,
                        &cwd,
                        &mcp_servers,
                        &additional_directories,
                    )
                } else {
                    let mut params = json!({
                        "sessionId": existing_session_id,
                        "cwd": cwd,
                        "mcpServers": mcp_servers,
                    });
                    if self.host.adapter_kind != AdapterKind::CursorAgent {
                        params["additionalDirectories"] = json!(additional_directories);
                    }
                    params
                };
                let result = match self
                    .host
                    .rpc_with_timeout(method, params, ACP_HISTORY_RESTORE_TIMEOUT)
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
                let params = build_acp_new_session_params(
                    self.host.adapter_kind,
                    &cwd,
                    &mcp_servers,
                    &additional_directories,
                    new_session_native_rules,
                );
                let result = self.host.rpc("session/new", params).await?;
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
            if matches!(
                self.host.adapter_kind,
                AdapterKind::KiroCli | AdapterKind::GrokBuild
            ) {
                self.set_model(&session_id, model).await?;
            } else {
                self.set_config_option(&session_id, "model", model).await?;
            }
        } else if model_source != "runtime_default" {
            bail!("ACP model source is invalid");
        }
        if model_source == "explicit"
            && matches!(
                self.host.adapter_kind,
                AdapterKind::KiroCli | AdapterKind::GrokBuild
            )
            && model_options
                .as_object()
                .is_some_and(|options| !options.is_empty())
        {
            bail!(
                "{} ACP does not support generic per-Session model options",
                self.host.adapter_kind.as_str()
            );
        }
        if model_source == "explicit"
            && !matches!(
                self.host.adapter_kind,
                AdapterKind::KiroCli | AdapterKind::GrokBuild
            )
            && let Some(options) = model_options.as_object()
        {
            for (key, value) in options {
                if let Some(value) = value.as_str() {
                    self.set_config_option(&session_id, key, value).await?;
                }
            }
        }
        if self.host.adapter_kind == AdapterKind::KimiCodeCli {
            let configured = self
                .host
                .session_permission_mode
                .as_deref()
                .context("Kimi Code Runtime has no frozen Session mode")?;
            let effective = if self.workspace_access == "read_only" {
                "plan"
            } else {
                configured
            };
            self.set_config_option(&session_id, "mode", effective)
                .await?;
        }
        if prebound_session {
            self.host
                .settle_loading_replay(&session_id, &self.owner)
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

    #[cfg(all(test, unix))]
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

    pub async fn arm_grok_auto_compact_for_acceptance_if_requested(&self) -> Result<bool> {
        if self.host.adapter_kind != AdapterKind::GrokBuild
            || std::env::var("ROVAI_INTERNAL_GROK_COMPACTION_ACCEPTANCE").as_deref() != Ok("1")
            || self
                .host
                .grok_acceptance_auto_compact_armed
                .swap(true, Ordering::AcqRel)
        {
            return Ok(false);
        }
        let session_id = self
            .session_id()
            .await
            .context("Grok Session is not ready for compaction acceptance arming")?;
        self.host
            .rpc_with_timeout(
                "_x.ai/debug/arm_auto_compact",
                json!({"sessionId": session_id}),
                Duration::from_secs(30),
            )
            .await
            .context("Grok compaction acceptance arming failed")?;
        Ok(true)
    }

    pub async fn cancel(&self) -> Result<()> {
        let session_id = self
            .session_id()
            .await
            .context("ACP Session is not ready")?;
        self.host
            .fence_client_terminal_create(&session_id, &self.owner)
            .await;
        let cancellation = self
            .host
            .notify("session/cancel", json!({"sessionId": &session_id}))
            .await;
        self.host
            .release_client_terminals_for_session(&session_id, &self.owner)
            .await;
        cancellation
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
            observed.native_kind = Some(
                effective_action_kind(self.host.adapter_kind, reported_kind, &raw_input)
                    .to_string(),
            );
        } else if public_acp_shell_command(self.host.adapter_kind, update.get("rawInput")).is_some()
        {
            observed.native_kind = Some("execute".to_string());
        }
        if let Some(raw_input) = update.get("rawInput").filter(|value| !value.is_null()) {
            observed.raw_input = Some(raw_input.clone());
        }
        if let Some(locations) = update.get("locations").filter(|value| !value.is_null()) {
            observed.locations = Some(locations.clone());
        }
        if update.get("content").is_some() {
            observed.public_file_changes = public_acp_file_changes(update.get("content"));
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
        let Some(mut completion) = completed_action(self.host.adapter_kind, params)? else {
            return Ok(None);
        };
        completion =
            reconcile_completed_action(self.host.adapter_kind, update, observed, completion)?;
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
        let candidate = self
            .active_observation
            .lock()
            .await
            .as_ref()
            .filter(|observation| observation.prompt_id == native_prompt_id)
            .and_then(|observation| observation.missing_send_recovery.candidate());
        candidate.filter(|text| !text.is_empty())
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

    pub async fn read_text_file(&self, params: &Value) -> Result<Value> {
        let path = params
            .get("path")
            .and_then(Value::as_str)
            .context("fs/read_text_file has no path")?;
        let path = client_filesystem_path(&self.execution_root, path);
        let content = std::fs::read_to_string(&path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        Ok(json!({"content": content}))
    }

    pub async fn write_text_file(&self, params: &Value) -> Result<Value> {
        let path = params
            .get("path")
            .and_then(Value::as_str)
            .context("fs/write_text_file has no path")?;
        let content = params
            .get("content")
            .and_then(Value::as_str)
            .context("fs/write_text_file has no content")?;
        let path = client_filesystem_path(&self.execution_root, path);
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

    pub async fn forget_agent_run(&self, agent_run_id: &str, execution_epoch: i64) -> bool {
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
            .await
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
        // Publish a quiescent Host before the durable terminal lets a successor
        // Run compete for it. Besides Kiro's process-scoped Session lock, warm
        // ACP Hosts retain a PromptCompleted route until detach; exposing the
        // terminal first can therefore race the successor into "active prompt".
        // complete_agent_run is idempotent, so common post-terminal cleanup is
        // still safe.
        self.complete_agent_run(agent_run_id, execution_epoch).await;
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
    if matches!(
        adapter_kind,
        AdapterKind::KiroCli | AdapterKind::CursorAgent
    ) {
        // Kiro keeps a Native Session locked for the lifetime of its ACP
        // process. Cursor Host reuse remains outside the current contract.
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
    // Ready and therefore changes the full frozen config digest. Kimi and Grok MCP
    // projection digests are also Run-local because their evidence includes the
    // AgentRun identity. Those values are not Host launch inputs. The concrete
    // resolved MCP server set below remains compatibility-authoritative.
    let excludes_runtime_config_digest = frozen_runtime.adapter_kind == AdapterKind::TraeCnCli;
    let excludes_mcp_projection_digest = matches!(
        frozen_runtime.adapter_kind,
        AdapterKind::TraeCnCli | AdapterKind::KimiCodeCli | AdapterKind::GrokBuild
    );
    let runtime_config_digest =
        (!excludes_runtime_config_digest).then_some(frozen_runtime.config_digest.as_str());
    let mcp_projection_compatibility_digest =
        (!excludes_mcp_projection_digest).then_some(mcp_projection_digest);
    let is_grok = frozen_runtime.adapter_kind == AdapterKind::GrokBuild;
    let mut compatibility = json!({
        "schemaVersion": if is_grok { 5 } else { 3 },
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
    });
    if is_grok {
        let compatibility = compatibility
            .as_object_mut()
            .context("Runtime compatibility payload must be an object")?;
        compatibility.insert(
            "grokNativeConfigurationDigest".to_string(),
            json!(grok_native_configuration_compatibility_digest()?),
        );
        compatibility.insert(
            "grokNativeRulesRevision".to_string(),
            json!(GROK_NATIVE_RULES_REVISION),
        );
    }
    canonical_json_digest(&compatibility)
}

pub(crate) fn freeze_native_session_compatibility(
    mut frozen_runtime: FrozenAgentRuntimeConfig,
    workspace: &AgentRunWorkspace,
) -> Result<FrozenAgentRuntimeConfig> {
    if !matches!(
        frozen_runtime.adapter_kind,
        AdapterKind::TraeCnCli | AdapterKind::GrokBuild
    ) {
        return Ok(frozen_runtime);
    }
    let adapter_kind = frozen_runtime.adapter_kind;
    let execution_root = PathBuf::from(&workspace.execution_root)
        .canonicalize()
        .with_context(|| {
            format!(
                "failed to resolve {} Native Session workspace {}",
                adapter_kind.as_str(),
                workspace.execution_root
            )
        })?;
    let is_grok = adapter_kind == AdapterKind::GrokBuild;
    let mut compatibility = json!({
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
    });
    if is_grok {
        let compatibility = compatibility
            .as_object_mut()
            .context("Native Session compatibility payload must be an object")?;
        compatibility.insert(
            "grokNativeConfigurationDigest".to_string(),
            json!(grok_native_configuration_compatibility_digest()?),
        );
        compatibility.insert(
            "grokNativeRulesRevision".to_string(),
            json!(GROK_NATIVE_RULES_REVISION),
        );
    }
    let compatibility_digest = canonical_json_digest(&compatibility)?;
    let compatibility_flow = if is_grok { "resume" } else { "history-restore" };
    let compatibility_key = format!(
        "{}:{compatibility_flow}-v1:{compatibility_digest}",
        adapter_kind.as_str()
    );
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

#[derive(Debug, Clone, PartialEq, Eq)]
struct PreparedPrivateHostConfig {
    root: PathBuf,
    remove_on_shutdown: bool,
}

fn prepare_private_host_config(
    private_runtime_dir: &Path,
    adapter_kind: AdapterKind,
) -> Result<Option<PreparedPrivateHostConfig>> {
    let (root, remove_on_shutdown) = match adapter_kind {
        AdapterKind::KiroCli => (
            private_runtime_dir
                .join("acp-host")
                .join(uuid::Uuid::new_v4().to_string()),
            true,
        ),
        _ => return Ok(None),
    };
    std::fs::create_dir_all(&root).with_context(|| {
        format!(
            "failed to create private ACP Host directory {}",
            root.display()
        )
    })?;
    restrict_private_directory(&root)?;
    Ok(Some(PreparedPrivateHostConfig {
        root,
        remove_on_shutdown,
    }))
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
    run_tmp: Option<&Path>,
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
            if let Some(root) = run_tmp {
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
                    // CodeBuddy resolves the launch model while creating an ACP
                    // Session. A custom provider cannot be selected later with
                    // session/set_model when session/new already rejected the
                    // product-account default for missing authentication.
                    command.arg("--model").arg(&runtime.model.model_id);
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
                .context("TRAE CLI requires permission_mode")?;
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
        AdapterKind::CursorAgent => {
            if !external_mcp_servers.is_empty() {
                bail!("Cursor Agent external MCP projection is not verified");
            }
            let execution_mode = values
                .get("execution_mode")
                .and_then(Value::as_str)
                .context("Cursor Agent Runtime requires execution_mode")?;
            let approval_policy = values
                .get("approval_policy")
                .and_then(Value::as_str)
                .context("Cursor Agent Runtime requires approval_policy")?;
            health::configure_acp_command(command, runtime.adapter_kind, false);
            let read_only = permission_semantics == PermissionSemantics::CoreEnforcedV1
                && workspace.access == "read_only";
            let mode = if read_only { "plan" } else { execution_mode };
            if mode != "agent" {
                command.arg("--mode").arg(mode);
            }
            if !read_only {
                match approval_policy {
                    "default" => {}
                    "auto_review" => {
                        command.arg("--auto-review");
                    }
                    "force" => {
                        command.arg("--force");
                    }
                    _ => bail!("Cursor Agent approval_policy is invalid"),
                }
            }
            if let Some(root) = attachment_access_root {
                command.arg("--add-dir").arg(root);
            }
            if let Some(root) = run_tmp {
                command.arg("--add-dir").arg(root);
            }
        }
        AdapterKind::KimiCodeCli => {
            let permission_mode = values
                .get("permission_mode")
                .and_then(Value::as_str)
                .context("Kimi Code Runtime requires permission_mode")?;
            if !matches!(permission_mode, "default" | "plan" | "auto" | "yolo") {
                bail!("Kimi Code permission_mode is invalid");
            }
            health::configure_acp_command(command, runtime.adapter_kind, false);
            // Formal AgentRun hosts inherit the user's KIMI_CODE_HOME, or
            // Kimi's native default when it is unset. The provider overlay is
            // process-local and must not replace Kimi's state/config home.
            configure_kimi_model_environment(command)?;
        }
        AdapterKind::GrokBuild => {
            let permission_mode = values
                .get("permission_mode")
                .and_then(Value::as_str)
                .context("Grok Build Runtime requires permission_mode")?;
            if !matches!(
                permission_mode,
                "default" | "acceptEdits" | "auto" | "dontAsk" | "bypassPermissions" | "plan"
            ) {
                bail!("Grok Build permission_mode is invalid");
            }
            let read_only = permission_semantics == PermissionSemantics::CoreEnforcedV1
                && workspace.access == "read_only";
            command
                .arg("--permission-mode")
                .arg(if read_only { "plan" } else { permission_mode });
            // Grok's permission mode is a top-level option and must precede
            // the `agent stdio` subcommand added by the ACP launcher. Dedicated
            // no-leader Hosts keep process ownership inside Rovai's Fleet LRU.
            let plugin = if external_mcp_servers.is_empty() {
                None
            } else {
                Some(write_ephemeral_grok_mcp_plugin(
                    private_runtime_dir,
                    external_mcp_servers,
                )?)
            };
            health::configure_grok_acp_command(
                command,
                plugin.as_ref().map(EphemeralMcpConfigFile::path),
            );
            // Formal AgentRun hosts inherit the user's official Grok Home and
            // config.toml. Only environment names referenced by that native
            // configuration are resolved from $GROK_HOME/.env for this child.
            configure_grok_native_environment(command)?;
            return Ok(plugin);
        }
        AdapterKind::CodexCli | AdapterKind::ClaudeCodeCli | AdapterKind::AntigravityApp => {
            bail!("Runtime is not implemented through ACP")
        }
    }
    Ok(None)
}

const KIMI_MODEL_ENVIRONMENT_KEYS: [&str; 6] = [
    "KIMI_MODEL_NAME",
    "KIMI_MODEL_PROVIDER_TYPE",
    "KIMI_MODEL_API_KEY",
    "KIMI_MODEL_BASE_URL",
    "KIMI_MODEL_MAX_CONTEXT_SIZE",
    "KIMI_MODEL_CAPABILITIES",
];

fn kimi_model_environment_path() -> Result<PathBuf> {
    if let Some(path) = std::env::var_os("ROVAI_KIMI_CONFIG") {
        return Ok(PathBuf::from(path));
    }
    Ok(dirs::home_dir()
        .context("could not determine the user home directory for Kimi Code configuration")?
        .join(".config/rovai/kimi-code.env"))
}

pub(crate) fn configure_kimi_model_environment(command: &mut Command) -> Result<()> {
    let path = kimi_model_environment_path()?;
    if !path.exists() {
        return Ok(());
    }
    configure_kimi_model_environment_from_path(command, &path)
}

fn configure_kimi_model_environment_from_path(command: &mut Command, path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let mode = std::fs::metadata(path)
            .with_context(|| format!("failed to inspect {}", path.display()))?
            .permissions()
            .mode();
        if mode & 0o077 != 0 {
            bail!(
                "Kimi Code provider configuration {} must not be accessible by group or others",
                path.display()
            );
        }
    }
    let contents = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read {}", path.display()))?;
    let mut values = BTreeMap::new();
    for (index, raw_line) in contents.lines().enumerate() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (key, value) = line.split_once('=').with_context(|| {
            format!(
                "invalid Kimi Code provider configuration at {}:{}",
                path.display(),
                index + 1
            )
        })?;
        let key = key.trim();
        let value = value.trim();
        if !KIMI_MODEL_ENVIRONMENT_KEYS.contains(&key) {
            bail!(
                "unsupported Kimi Code provider configuration key {key} at {}:{}",
                path.display(),
                index + 1
            );
        }
        if value.is_empty() {
            bail!(
                "empty Kimi Code provider configuration value at {}:{}",
                path.display(),
                index + 1
            );
        }
        if values.insert(key.to_string(), value.to_string()).is_some() {
            bail!(
                "duplicate Kimi Code provider configuration key {key} at {}:{}",
                path.display(),
                index + 1
            );
        }
    }
    for required in [
        "KIMI_MODEL_NAME",
        "KIMI_MODEL_PROVIDER_TYPE",
        "KIMI_MODEL_API_KEY",
        "KIMI_MODEL_BASE_URL",
    ] {
        if !values.contains_key(required) {
            bail!(
                "Kimi Code provider configuration {} is missing {required}",
                path.display()
            );
        }
    }
    for (key, value) in values {
        command.env(key, value);
    }
    Ok(())
}

const GROK_ENVIRONMENT_FILE_NAME: &str = ".env";
const GROK_GLOBAL_API_KEY_ENVIRONMENT_KEYS: [&str; 2] = ["XAI_API_KEY", "GROK_CODE_XAI_API_KEY"];

#[derive(Debug)]
struct GrokNativeConfiguration {
    byok_configured: bool,
    environment: BTreeMap<String, String>,
    compatibility_digest: String,
}

fn grok_home_path() -> Result<PathBuf> {
    if let Some(home) = std::env::var_os("GROK_HOME").filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(home));
    }
    Ok(dirs::home_dir()
        .context("could not determine the user home directory for Grok Build configuration")?
        .join(".grok"))
}

fn grok_native_config_path() -> Result<PathBuf> {
    Ok(grok_home_path()?.join("config.toml"))
}

fn grok_environment_file_path() -> Result<PathBuf> {
    Ok(grok_home_path()?.join(GROK_ENVIRONMENT_FILE_NAME))
}

fn portable_environment_key(value: &str) -> bool {
    let mut characters = value.chars();
    characters
        .next()
        .is_some_and(|character| character == '_' || character.is_ascii_alphabetic())
        && characters.all(|character| character == '_' || character.is_ascii_alphanumeric())
}

fn collect_grok_env_key_value(
    value: &toml::Value,
    section: &str,
    keys: &mut BTreeSet<String>,
) -> Result<()> {
    let values = if let Some(value) = value.as_str() {
        vec![value]
    } else if let Some(values) = value.as_array() {
        values
            .iter()
            .map(|value| {
                value
                    .as_str()
                    .with_context(|| format!("Grok Build {section} env_key must contain strings"))
            })
            .collect::<Result<Vec<_>>>()?
    } else {
        bail!("Grok Build {section} env_key must be a string or string array");
    };
    for value in values {
        let value = value.trim();
        if value.is_empty() || !portable_environment_key(value) {
            bail!("Grok Build {section} contains an invalid env_key");
        }
        keys.insert(value.to_string());
    }
    Ok(())
}

fn collect_grok_model_environment_keys(
    config: &toml::Value,
) -> Result<(BTreeSet<String>, BTreeSet<String>)> {
    let mut credential_keys = GROK_GLOBAL_API_KEY_ENVIRONMENT_KEYS
        .into_iter()
        .map(str::to_string)
        .collect::<BTreeSet<_>>();
    let mut injected_keys = credential_keys.clone();
    for section_name in ["model", "model_providers"] {
        let Some(entries) = config.get(section_name).and_then(toml::Value::as_table) else {
            continue;
        };
        for (entry_name, entry) in entries {
            let Some(entry) = entry.as_table() else {
                continue;
            };
            if let Some(env_key) = entry.get("env_key") {
                collect_grok_env_key_value(
                    env_key,
                    &format!("{section_name}.{entry_name}"),
                    &mut credential_keys,
                )?;
            }
            if let Some(headers) = entry.get("env_http_headers") {
                let headers = headers.as_table().with_context(|| {
                    format!(
                        "Grok Build {section_name}.{entry_name}.env_http_headers must be a table"
                    )
                })?;
                for environment_key in headers.values() {
                    let environment_key = environment_key.as_str().with_context(|| {
                        format!(
                            "Grok Build {section_name}.{entry_name}.env_http_headers values must be strings"
                        )
                    })?;
                    let environment_key = environment_key.trim();
                    if environment_key.is_empty() || !portable_environment_key(environment_key) {
                        bail!(
                            "Grok Build {section_name}.{entry_name} contains an invalid env_http_headers value"
                        );
                    }
                    injected_keys.insert(environment_key.to_string());
                }
            }
        }
    }
    injected_keys.extend(credential_keys.iter().cloned());
    Ok((credential_keys, injected_keys))
}

fn grok_config_has_literal_api_key(config: &toml::Value) -> bool {
    ["model", "model_providers"]
        .into_iter()
        .any(|section_name| {
            config
                .get(section_name)
                .and_then(toml::Value::as_table)
                .is_some_and(|entries| {
                    entries.values().any(|entry| {
                        entry
                            .get("api_key")
                            .and_then(toml::Value::as_str)
                            .is_some_and(|value| !value.trim().is_empty())
                    })
                })
        })
}

fn grok_environment_value(raw: &str, path: &Path, line: usize) -> Result<String> {
    let value = raw.trim();
    if value.is_empty() {
        bail!(
            "empty Grok Build environment value at {}:{line}",
            path.display()
        );
    }
    let quoted = value.starts_with('"') || value.starts_with('\'');
    if quoted {
        let delimiter = value.as_bytes()[0] as char;
        if value.len() < 2 || !value.ends_with(delimiter) {
            bail!(
                "unterminated Grok Build environment value at {}:{line}",
                path.display()
            );
        }
        return Ok(value[1..value.len() - 1].to_string());
    }
    Ok(value.to_string())
}

fn read_grok_environment_file(
    path: &Path,
    allowed_keys: &BTreeSet<String>,
) -> Result<(BTreeMap<String, String>, Option<String>)> {
    if !path.exists() {
        return Ok((BTreeMap::new(), None));
    }
    let metadata =
        std::fs::metadata(path).with_context(|| format!("failed to inspect {}", path.display()))?;
    if !metadata.is_file() {
        bail!(
            "Grok Build environment source {} is not a file",
            path.display()
        );
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        if metadata.permissions().mode() & 0o077 != 0 {
            bail!(
                "Grok Build environment source {} must not be accessible by group or others",
                path.display()
            );
        }
    }
    let contents = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read {}", path.display()))?;
    let mut values = BTreeMap::new();
    let mut observed_keys = BTreeSet::new();
    for (index, raw_line) in contents.lines().enumerate() {
        let line_number = index + 1;
        let mut line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(exported) = line.strip_prefix("export ") {
            line = exported.trim_start();
        }
        let (key, value) = line.split_once('=').with_context(|| {
            format!(
                "invalid Grok Build environment source at {}:{line_number}",
                path.display()
            )
        })?;
        let key = key.trim();
        if !portable_environment_key(key) {
            bail!(
                "invalid Grok Build environment key at {}:{line_number}",
                path.display()
            );
        }
        if !observed_keys.insert(key.to_string()) {
            bail!(
                "duplicate Grok Build environment key {key} at {}:{line_number}",
                path.display()
            );
        }
        if allowed_keys.contains(key) {
            values.insert(
                key.to_string(),
                grok_environment_value(value, path, line_number)?,
            );
        }
    }
    Ok((values, Some(contents)))
}

fn load_grok_native_configuration_from_paths(
    home: &Path,
    config_path: &Path,
    environment_path: &Path,
    inherited_environment: &BTreeMap<String, String>,
) -> Result<GrokNativeConfiguration> {
    let config_contents = if config_path.exists() {
        Some(
            std::fs::read_to_string(config_path)
                .with_context(|| format!("failed to read {}", config_path.display()))?,
        )
    } else {
        None
    };
    let config = match config_contents.as_deref() {
        Some(contents) => toml::from_str::<toml::Value>(contents).with_context(|| {
            format!(
                "failed to parse official Grok Build config {}",
                config_path.display()
            )
        })?,
        None => toml::Value::Table(toml::map::Map::new()),
    };
    let literal_api_key = grok_config_has_literal_api_key(&config);
    let (credential_keys, injected_keys) = collect_grok_model_environment_keys(&config)?;
    let (file_environment, environment_contents) =
        read_grok_environment_file(environment_path, &injected_keys)?;
    let environment = injected_keys
        .iter()
        .filter_map(|key| {
            file_environment
                .get(key)
                .or_else(|| inherited_environment.get(key))
                .filter(|value| !value.trim().is_empty())
                .map(|value| (key.clone(), value.clone()))
        })
        .collect::<BTreeMap<_, _>>();
    let byok_configured = literal_api_key
        || credential_keys
            .iter()
            .any(|key| environment.contains_key(key));
    let compatibility_digest = canonical_json_digest(&json!({
        "schemaVersion": 1,
        "home": home,
        "config": config_contents,
        "environment": environment_contents,
    }))?;
    Ok(GrokNativeConfiguration {
        byok_configured,
        environment,
        compatibility_digest,
    })
}

fn load_grok_native_configuration() -> Result<GrokNativeConfiguration> {
    let home = grok_home_path()?;
    let config_path = grok_native_config_path()?;
    let environment_path = grok_environment_file_path()?;
    let inherited_environment = std::env::vars_os()
        .filter_map(|(key, value)| Some((key.into_string().ok()?, value.into_string().ok()?)))
        .collect::<BTreeMap<_, _>>();
    load_grok_native_configuration_from_paths(
        &home,
        &config_path,
        &environment_path,
        &inherited_environment,
    )
}

pub(crate) fn grok_native_byok_configured() -> Result<bool> {
    Ok(load_grok_native_configuration()?.byok_configured)
}

fn apply_grok_native_configuration(command: &mut Command, configuration: GrokNativeConfiguration) {
    for (key, value) in configuration.environment {
        command.env(key, value);
    }
    command.env("GROK_DISABLE_AUTOUPDATER", "1");
}

pub(crate) fn configure_grok_native_environment(command: &mut Command) -> Result<()> {
    let configuration = load_grok_native_configuration()?;
    apply_grok_native_configuration(command, configuration);
    Ok(())
}

fn grok_native_configuration_compatibility_digest() -> Result<String> {
    Ok(load_grok_native_configuration()?.compatibility_digest)
}

fn prepare_grok_probe_home_from(source_home: &Path, probe_home: &Path) -> Result<()> {
    std::fs::create_dir_all(probe_home)
        .with_context(|| format!("failed to create {}", probe_home.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        std::fs::set_permissions(probe_home, std::fs::Permissions::from_mode(0o700))?;
    }
    for file_name in ["config.toml", "managed_config.toml", "requirements.toml"] {
        let source = source_home.join(file_name);
        if !source.is_file() {
            continue;
        }
        let target = probe_home.join(file_name);
        std::fs::copy(&source, &target).with_context(|| {
            format!(
                "failed to copy official Grok Build configuration {} into the isolated Probe Home",
                source.display()
            )
        })?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;

            std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o600))?;
        }
    }
    Ok(())
}

pub(crate) fn prepare_grok_probe_home(probe_home: &Path) -> Result<()> {
    prepare_grok_probe_home_from(&grok_home_path()?, probe_home)
}

fn configure_compaction_detector_command(
    command: &mut Command,
    adapter_kind: AdapterKind,
    host_instance_id: &str,
    builtin_tools: &BuiltinToolProcessConfig,
    private_runtime_dir: &Path,
    runtime_cwd: &Path,
) -> Result<Option<PathBuf>> {
    if matches!(
        adapter_kind,
        AdapterKind::KiroCli | AdapterKind::KimiCodeCli
    ) {
        // Kiro emits a structured lifecycle notification and Kimi emits its
        // native completed event as a strict ACP-local text frame. Neither
        // detector needs Runtime-side Hook installation or user configuration.
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

#[cfg(unix)]
fn qoder_post_compact_hook_settings(hook_command: &str) -> Value {
    json!({"hooks": {"PostCompact": [{
        "matcher": "manual|auto",
        "hooks": [{
            "type": "command",
            "command": hook_command
        }]
    }]}})
}

#[cfg(unix)]
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

#[cfg(unix)]
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

#[cfg(unix)]
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

#[cfg(unix)]
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

#[cfg(unix)]
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

#[cfg(unix)]
fn quote_posix_shell_word(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn launchable_acp_adapter(kind: AdapterKind) -> bool {
    kind.uses_acp()
}

fn session_additional_directories(
    attachment_access_root: Option<&Path>,
    run_tmp: Option<&Path>,
) -> Result<Vec<String>> {
    let attachment_root = attachment_access_root.context(
        "camp_attachment_view_runtime_unsupported: ACP Session has no exact Camp attachment root",
    )?;
    let run_tmp = run_tmp.context("ACP Session has no exact Built-in Tool Run tmp root")?;
    Ok(vec![
        acp_protocol_path(attachment_root),
        acp_protocol_path(run_tmp),
    ])
}

fn acp_protocol_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    #[cfg(windows)]
    {
        if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{rest}");
        }
        if let Some(rest) = value.strip_prefix(r"\\?\") {
            return rest.to_string();
        }
    }
    value.into_owned()
}

#[cfg(all(test, windows))]
mod windows_path_tests {
    use super::acp_protocol_path;
    use std::path::Path;

    #[test]
    fn acp_protocol_paths_do_not_expose_windows_verbatim_prefixes() {
        assert_eq!(
            acp_protocol_path(Path::new(r"\\?\C:\workspace\project")),
            r"C:\workspace\project"
        );
        assert_eq!(
            acp_protocol_path(Path::new(r"\\?\UNC\server\share\project")),
            r"\\server\share\project"
        );
    }
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
    pub adapter_kind: AdapterKind,
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
    let kind = effective_action_kind(context.adapter_kind, reported_kind, &raw_input);
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
            let argv = if let Some(command) =
                public_acp_shell_command(context.adapter_kind, Some(&raw_input))
            {
                vec!["/bin/zsh".to_string(), "-lc".to_string(), command]
            } else {
                match raw_input.get("command") {
                    Some(Value::Array(values)) => values
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect::<Vec<_>>(),
                    _ => Vec::new(),
                }
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

pub fn automatically_allows_permission_requests(
    adapter_kind: AdapterKind,
    permissions: &Value,
) -> bool {
    match adapter_kind {
        AdapterKind::OpencodeCli => permissions["permission"] == "allow",
        AdapterKind::CopilotCli => permissions["allow_all"] == "on",
        AdapterKind::KiroCli => permissions["trust_all_tools"] == "on",
        AdapterKind::QoderCli | AdapterKind::TraeCnCli => {
            permissions["permission_mode"] == "bypass_permissions"
        }
        AdapterKind::CodebuddyCli | AdapterKind::GrokBuild => {
            permissions["permission_mode"] == "bypassPermissions"
        }
        AdapterKind::QwenCode => permissions["approval_mode"] == "yolo",
        AdapterKind::CursorAgent => permissions["approval_policy"] == "force",
        AdapterKind::KimiCodeCli => permissions["permission_mode"] == "yolo",
        AdapterKind::CodexCli | AdapterKind::ClaudeCodeCli | AdapterKind::AntigravityApp => false,
    }
}

fn effective_action_kind<'a>(
    adapter_kind: AdapterKind,
    reported_kind: &'a str,
    raw_input: &Value,
) -> &'a str {
    if matches!(reported_kind, "edit" | "move" | "delete" | "execute") {
        return reported_kind;
    }

    if public_acp_shell_command(adapter_kind, Some(raw_input)).is_some() {
        return "execute";
    }

    // OpenCode's ACP bridge currently reports an external-directory permission
    // request as `other`, even when the request belongs to a file-edit tool call.
    // The stable file target remains present in rawInput. Classify that narrow
    // shape as a write so it receives Rovai-ai's normal path and approval checks.
    if ["filepath", "filePath", "file_path"]
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
    pub public_command: Option<String>,
    pub public_file_changes: Option<Value>,
    pub observation_digest: String,
    pub outcome: ActionResultOutcome,
    pub result_code: String,
    pub result_summary: String,
    pub result_data: Value,
    pub effect_disposition: String,
}

pub fn completed_action(
    adapter_kind: AdapterKind,
    params: &Value,
) -> Result<Option<CompletedAcpAction>> {
    let update = match params.get("update") {
        Some(update)
            if update.get("sessionUpdate").and_then(Value::as_str) == Some("tool_call_update") =>
        {
            update
        }
        _ => return Ok(None),
    };
    let reported_status = update
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("in_progress");
    if !matches!(reported_status, "completed" | "failed") {
        return Ok(None);
    }
    let native_item_id = update
        .get("toolCallId")
        .and_then(Value::as_str)
        .context("ACP tool_call_update has no toolCallId")?
        .to_string();
    let raw_input = update.get("rawInput");
    let public_command = public_acp_shell_command(adapter_kind, raw_input);
    let raw_input_digest = update
        .get("rawInput")
        .map(canonical_json_digest)
        .transpose()?;
    let raw_output_digest = update
        .get("rawOutput")
        .map(canonical_json_digest)
        .transpose()?;
    let reported_kind = update
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("other");
    let native_kind = effective_action_kind(
        adapter_kind,
        reported_kind,
        raw_input.unwrap_or(&Value::Null),
    )
    .to_string();
    let status = effective_acp_tool_status(update, &native_kind);
    let succeeded = status == "completed";
    let observation_digest = canonical_json_digest(&json!({
        "nativeItemId": &native_item_id,
        "nativeKind": &native_kind,
        "rawInput": update.get("rawInput"),
        "locations": update.get("locations"),
    }))?;
    let effect_disposition = acp_effect_disposition(succeeded, &native_kind);
    let public_file_changes = succeeded
        .then(|| public_acp_file_changes(update.get("content")))
        .flatten();
    Ok(Some(CompletedAcpAction {
        native_item_id: native_item_id.clone(),
        native_kind,
        public_command,
        public_file_changes,
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

fn reconcile_completed_action(
    adapter_kind: AdapterKind,
    update: &Value,
    observed: ObservedToolMetadata,
    mut completion: CompletedAcpAction,
) -> Result<CompletedAcpAction> {
    let observed_raw_input_digest = observed
        .raw_input
        .as_ref()
        .map(canonical_json_digest)
        .transpose()?;
    if completion.public_command.is_none() {
        completion.public_command =
            public_acp_shell_command(adapter_kind, observed.raw_input.as_ref());
    }
    if matches!(completion.outcome, ActionResultOutcome::Succeeded)
        && completion.public_file_changes.is_none()
    {
        completion.public_file_changes = observed.public_file_changes;
    }
    if let Some(native_kind) = observed.native_kind {
        completion.native_kind = native_kind;
    }
    if completion.native_kind == "other" && completion.public_command.is_some() {
        completion.native_kind = "execute".to_string();
    }
    if let Some(observation_digest) = observed.observation_digest {
        completion.observation_digest = observation_digest;
    }
    let effective_status = effective_acp_tool_status(update, &completion.native_kind);
    completion.outcome = if effective_status == "completed" {
        ActionResultOutcome::Succeeded
    } else {
        ActionResultOutcome::Failed
    };
    completion.result_code = format!("acp_tool_{effective_status}");
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
        result_data.insert("status".to_string(), Value::String(effective_status));
        if result_data.get("rawInputDigest").is_none_or(Value::is_null)
            && let Some(raw_input_digest) = observed_raw_input_digest
        {
            result_data.insert(
                "rawInputDigest".to_string(),
                Value::String(raw_input_digest),
            );
        }
    }
    Ok(completion)
}

fn public_acp_file_changes(content: Option<&Value>) -> Option<Value> {
    let blocks = content?.as_array()?;
    let changes = blocks
        .iter()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("diff"))
        .filter_map(|block| {
            let path = block.get("path")?.as_str()?;
            let new_text = block.get("newText")?.as_str()?;
            let old_text = match block.get("oldText") {
                Some(Value::String(value)) => Value::String(value.clone()),
                Some(Value::Null) | None => Value::Null,
                _ => return None,
            };
            Some(json!({
                "path": path,
                "oldText": old_text,
                "newText": new_text,
            }))
        })
        .collect::<Vec<_>>();
    (!changes.is_empty()).then_some(Value::Array(changes))
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

pub fn public_acp_shell_command(
    adapter_kind: AdapterKind,
    raw_input: Option<&Value>,
) -> Option<String> {
    let raw_input = raw_input?;
    raw_input
        .get("command")
        .or_else(|| {
            if adapter_kind == AdapterKind::TraeCnCli {
                raw_input.get("Command")
            } else {
                None
            }
        })
        .and_then(Value::as_str)
        .filter(|command| !command.trim().is_empty())
        .map(str::to_string)
}

pub fn public_acp_tool_kind(adapter_kind: AdapterKind, update: &Value) -> Option<String> {
    update
        .get("kind")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|kind| !kind.is_empty())
        .map(str::to_string)
        .or_else(|| {
            public_acp_shell_command(adapter_kind, update.get("rawInput"))
                .map(|_| "execute".to_string())
        })
}

pub fn effective_acp_tool_status(update: &Value, native_kind: &str) -> String {
    let reported = update
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("in_progress");
    if reported == "completed"
        && native_kind == "execute"
        && acp_tool_exit_code(update).is_some_and(|exit_code| exit_code != 0)
    {
        "failed".to_string()
    } else {
        reported.to_string()
    }
}

fn acp_tool_exit_code(update: &Value) -> Option<i64> {
    ["exitCode", "exit_code"].into_iter().find_map(|field| {
        update
            .get(field)
            .or_else(|| update.get("rawOutput")?.get(field))
            .and_then(Value::as_i64)
    })
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
        for key in ["filepath", "filePath", "file_path", "path"] {
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

fn client_filesystem_path(execution_root: &Path, value: &str) -> PathBuf {
    let path = Path::new(value);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        execution_root.join(path)
    }
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
mod route_policy_tests {
    use super::*;

    #[test]
    fn grok_new_and_resume_sessions_use_their_exact_wire_shapes() {
        let bootstrap = "SESSION_CHARTER\nMEMBER_IDENTITY\nMEMORY_ENTRYPOINT";
        let rules = validate_new_session_native_rules(
            AdapterKind::GrokBuild,
            AcpSessionContinuation::New,
            Some(bootstrap),
        )
        .unwrap();
        let params = build_acp_new_session_params(
            AdapterKind::GrokBuild,
            "/workspace",
            &[],
            &["/attachments".to_string(), "/run-tmp".to_string()],
            rules,
        );

        assert_eq!(params.pointer("/_meta/rules"), Some(&json!(bootstrap)));
        assert!(params.pointer("/_meta/systemPromptOverride").is_none());
        assert!(params.get("systemPromptOverride").is_none());
        assert_eq!(
            serde_json::to_string(&params)
                .unwrap()
                .matches("SESSION_CHARTER")
                .count(),
            1
        );
        assert_eq!(params["additionalDirectories"].as_array().unwrap().len(), 2);

        let additional_directories = ["/attachments".to_string(), "/run-tmp".to_string()];
        let resume = build_acp_resume_session_params(
            AdapterKind::GrokBuild,
            "grok-session",
            "/workspace",
            &[],
            &additional_directories,
        );
        assert_eq!(resume["sessionId"], "grok-session");
        assert_eq!(resume["cwd"], "/workspace");
        assert_eq!(resume["mcpServers"], json!([]));
        assert_eq!(resume["additionalDirectories"], json!([]));
        assert!(resume.get("_meta").is_none());

        let other = build_acp_resume_session_params(
            AdapterKind::QwenCode,
            "qwen-session",
            "/workspace",
            &[],
            &additional_directories,
        );
        assert_eq!(
            other["additionalDirectories"],
            json!(["/attachments", "/run-tmp"])
        );
    }

    #[test]
    fn grok_native_rules_fail_closed_outside_exact_session_new() {
        assert!(
            validate_new_session_native_rules(
                AdapterKind::GrokBuild,
                AcpSessionContinuation::New,
                None,
            )
            .is_err()
        );
        assert!(
            validate_new_session_native_rules(
                AdapterKind::GrokBuild,
                AcpSessionContinuation::Resume,
                Some("rules"),
            )
            .is_err()
        );
        assert_eq!(
            validate_new_session_native_rules(
                AdapterKind::GrokBuild,
                AcpSessionContinuation::Resume,
                None,
            )
            .unwrap(),
            None
        );
        assert!(
            validate_new_session_native_rules(
                AdapterKind::KimiCodeCli,
                AcpSessionContinuation::New,
                Some("rules"),
            )
            .is_err()
        );
    }

    #[test]
    fn grok_snake_case_file_path_is_an_authorizable_write_target() {
        let request = json!({
            "toolCall": {
                "kind": "edit",
                "rawInput": {"file_path": "/tmp/grok-write.txt"}
            }
        });
        assert_eq!(acp_tool_paths(&request), ["/tmp/grok-write.txt"]);
        assert_eq!(
            effective_action_kind(
                AdapterKind::GrokBuild,
                "other",
                &request["toolCall"]["rawInput"],
            ),
            "edit"
        );
    }

    #[test]
    fn codebuddy_private_command_notification_is_narrow_idle_metadata() {
        let notification = json!({
            "jsonrpc": "2.0",
            "method": "_codebuddy.ai/command",
            "params": { "sessionId": "session-codebuddy" }
        });
        assert!(is_known_session_lifecycle_extension(
            AdapterKind::CodebuddyCli,
            &notification
        ));
        assert!(!is_known_session_lifecycle_extension(
            AdapterKind::TraeCnCli,
            &notification
        ));

        let mut request = notification;
        request["id"] = json!(1);
        assert!(!is_known_session_lifecycle_extension(
            AdapterKind::CodebuddyCli,
            &request
        ));
    }

    #[test]
    fn kiro_private_command_catalog_notification_is_narrow_idle_metadata() {
        let notification = json!({
            "jsonrpc": "2.0",
            "method": "_kiro.dev/commands/available",
            "params": { "sessionId": "session-kiro", "commands": [] }
        });
        assert!(is_known_session_lifecycle_extension(
            AdapterKind::KiroCli,
            &notification
        ));
        let metadata = json!({
            "jsonrpc": "2.0",
            "method": "_kiro.dev/metadata",
            "params": { "sessionId": "session-kiro", "metadata": {} }
        });
        assert!(is_known_session_lifecycle_extension(
            AdapterKind::KiroCli,
            &metadata
        ));
        let mcp_server_initialized = json!({
            "jsonrpc": "2.0",
            "method": "_kiro.dev/mcp/server_initialized",
            "params": { "sessionId": "session-kiro", "serverName": "rovai_smoke" }
        });
        assert!(is_known_session_lifecycle_extension(
            AdapterKind::KiroCli,
            &mcp_server_initialized
        ));
        assert!(!is_known_session_lifecycle_extension(
            AdapterKind::CodebuddyCli,
            &notification
        ));

        let mut request = notification;
        request["id"] = json!(1);
        assert!(!is_known_session_lifecycle_extension(
            AdapterKind::KiroCli,
            &request
        ));
        let mut mcp_request = mcp_server_initialized;
        mcp_request["id"] = json!(2);
        assert!(!is_known_session_lifecycle_extension(
            AdapterKind::KiroCli,
            &mcp_request
        ));
    }
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

    fn exact_builtin_tools(root: &Path) -> BuiltinToolProcessConfig {
        let cli = root.join("rovai");
        make_executable(&cli, "#!/bin/sh\nexit 0\n");
        let endpoint = rovai_core::builtin_tool_transport::LocalIpcEndpoint::UnixSocket {
            path: root.join("core.sock").to_string_lossy().into_owned(),
        };
        BuiltinToolProcessConfig::create(&cli, &endpoint, &root.join("runtime")).unwrap()
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

    fn frozen_cursor_runtime(executable: &Path) -> FrozenAgentRuntimeConfig {
        FrozenAgentRuntimeConfig {
            adapter_kind: AdapterKind::CursorAgent,
            installation_id: "installation-cursor".to_string(),
            installation_generation: 1,
            search_environment_generation: 1,
            executable_path: executable.to_string_lossy().to_string(),
            auth_scope: "default".to_string(),
            reported_version: Some("2026.08.11-e8db854".to_string()),
            executable_fingerprint: "sha256:cursor".to_string(),
            capabilities: vec![
                "acp.initialize".to_string(),
                "cursor.authenticate".to_string(),
                "session.new".to_string(),
            ],
            protocol_version: "acp-v1".to_string(),
            model: ResolvedModelSelection {
                source: "runtime_default".to_string(),
                model_id: "cursor-agent://runtime-default".to_string(),
                options: json!({}),
            },
            permissions: AdapterPermissionConfig {
                adapter_kind: AdapterKind::CursorAgent,
                schema_version: 1,
                values: json!({
                    "execution_mode": "agent",
                    "approval_policy": "force"
                }),
            },
            native_session_compatibility_key: Some("cursor-agent:acp-v1:sha256:cursor".to_string()),
            binding_compatibility_digest: "sha256:binding".to_string(),
            host_config_digest: "sha256:host".to_string(),
            config_digest: "sha256:config".to_string(),
        }
    }

    fn frozen_kimi_runtime(executable: &Path) -> FrozenAgentRuntimeConfig {
        FrozenAgentRuntimeConfig {
            adapter_kind: AdapterKind::KimiCodeCli,
            installation_id: "installation-kimi".to_string(),
            installation_generation: 1,
            search_environment_generation: 1,
            executable_path: executable.to_string_lossy().to_string(),
            auth_scope: "default".to_string(),
            reported_version: Some("0.32.0".to_string()),
            executable_fingerprint: "sha256:kimi".to_string(),
            capabilities: vec!["session.load".to_string(), "session.resume".to_string()],
            protocol_version: "acp-v1".to_string(),
            model: ResolvedModelSelection {
                source: "runtime_default".to_string(),
                model_id: "runtime_default".to_string(),
                options: json!({}),
            },
            permissions: AdapterPermissionConfig {
                adapter_kind: AdapterKind::KimiCodeCli,
                schema_version: 1,
                values: json!({"permission_mode": "default"}),
            },
            native_session_compatibility_key: Some("kimi-code-cli:acp-v1".to_string()),
            binding_compatibility_digest: "sha256:binding".to_string(),
            host_config_digest: "sha256:host".to_string(),
            config_digest: "sha256:config".to_string(),
        }
    }

    fn frozen_grok_runtime(executable: &Path) -> FrozenAgentRuntimeConfig {
        FrozenAgentRuntimeConfig {
            adapter_kind: AdapterKind::GrokBuild,
            installation_id: "installation-grok".to_string(),
            installation_generation: 1,
            search_environment_generation: 1,
            executable_path: executable.to_string_lossy().to_string(),
            auth_scope: "default".to_string(),
            reported_version: Some("1.0.0".to_string()),
            executable_fingerprint: "sha256:grok".to_string(),
            capabilities: vec!["session.resume".to_string()],
            protocol_version: "acp-v1".to_string(),
            model: ResolvedModelSelection {
                source: "runtime_default".to_string(),
                model_id: "MiniMax-M3".to_string(),
                options: json!({}),
            },
            permissions: AdapterPermissionConfig {
                adapter_kind: AdapterKind::GrokBuild,
                schema_version: 1,
                values: json!({"permission_mode": "bypassPermissions"}),
            },
            native_session_compatibility_key: Some("grok-build:acp-v1".to_string()),
            binding_compatibility_digest: "sha256:binding".to_string(),
            host_config_digest: "sha256:host".to_string(),
            config_digest: "sha256:config".to_string(),
        }
    }

    fn terminal_owner() -> AcpRuntimeOwner {
        AcpRuntimeOwner {
            agent_run_id: "run-client-terminal".to_string(),
            execution_epoch: 7,
        }
    }

    fn terminal_bridge(root: &Path) -> AcpClientTerminalBridge {
        let mut command = Command::new("/bin/sh");
        command
            .current_dir(root)
            .env("ROVAI_TERMINAL_BASE", "base-environment");
        let template = ManagedProcessLaunchSpec::capture(
            &command,
            ManagedProcessPurpose::RuntimeHost,
            ManagedStdinPolicy::Null,
            ManagedWindowsArgvDialect::MicrosoftCrt,
            "terminal-test-host",
        )
        .unwrap();
        AcpClientTerminalBridge::new(root, template).unwrap()
    }

    fn process_is_alive(pid: i32) -> bool {
        (unsafe { libc::kill(pid, 0) }) == 0
            || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }

    async fn assert_runtime_terminal_capability(
        root: &Path,
        frozen: &FrozenAgentRuntimeConfig,
        expected: bool,
    ) {
        let protocol_log = root.join("initialize.json");
        make_executable(
            Path::new(&frozen.executable_path),
            &format!(
                r#"#!/bin/sh
IFS= read -r initialize || exit 1
printf '%s\n' "$initialize" > '{}'
printf '%s\n' '{{"jsonrpc":"2.0","id":1,"result":{{"protocolVersion":1,"agentCapabilities":{{}}}}}}'
while IFS= read -r ignored; do :; done
"#,
                protocol_log.display()
            ),
        );
        let workspace = AgentRunWorkspace::runtime_managed_path(root.to_string_lossy().to_string());
        let (incoming, _receiver) = mpsc::unbounded_channel();
        let host = AcpHost::spawn(
            root,
            &workspace,
            PermissionSemantics::RuntimeManagedV2,
            frozen,
            incoming,
            Some(exact_builtin_tools(root)),
            CompactionDetectorPolicy::Disabled,
            true,
            &BTreeMap::new(),
            &root.join("private"),
            None,
        )
        .await
        .unwrap();

        let initialize: Value =
            serde_json::from_slice(&std::fs::read(&protocol_log).unwrap()).unwrap();
        assert_eq!(
            initialize
                .pointer("/params/clientCapabilities/terminal")
                .and_then(Value::as_bool),
            Some(expected)
        );
        assert_eq!(host.client_terminal_bridge.is_some(), expected);
        host.shutdown().await;
    }

    #[tokio::test]
    async fn runtime_policy_negotiates_client_terminal_only_for_kimi() {
        let kimi_root = std::env::temp_dir().join(format!(
            "rovai-acp-terminal-capability-kimi-{}",
            uuid::Uuid::new_v4()
        ));
        let trae_root = std::env::temp_dir().join(format!(
            "rovai-acp-terminal-capability-trae-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&kimi_root).unwrap();
        std::fs::create_dir_all(&trae_root).unwrap();
        let mut kimi = frozen_kimi_runtime(&kimi_root.join("kimi"));
        // The compatibility regression was observed in Kimi Code 0.38.x.
        // Version selection intentionally remains outside the wire bridge: the
        // Runtime policy owns whether this generic client capability is enabled.
        kimi.reported_version = Some("0.38.0".to_string());
        let trae = frozen_trae_runtime(&trae_root.join("traecli"));

        assert_runtime_terminal_capability(&kimi_root, &kimi, true).await;
        assert_runtime_terminal_capability(&trae_root, &trae, false).await;

        std::fs::remove_dir_all(kimi_root).unwrap();
        std::fs::remove_dir_all(trae_root).unwrap();
    }

    #[tokio::test]
    async fn client_filesystem_proxies_runtime_paths_without_core_file_authorization() {
        let root =
            std::env::temp_dir().join(format!("rovai-acp-client-fs-root-{}", uuid::Uuid::new_v4()));
        let outside = std::env::temp_dir().join(format!(
            "rovai-acp-client-fs-outside-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let executable = root.join("traecli");
        make_executable(
            &executable,
            r#"#!/bin/sh
IFS= read -r initialize || exit 1
printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentCapabilities":{}}}'
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
            Some(exact_builtin_tools(&root)),
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
                agent_run_id: "run-client-fs-proxy".to_string(),
                execution_epoch: 1,
            },
            host.clone(),
            "sha256:compatibility".to_string(),
            "sha256:mcp".to_string(),
            root.clone(),
            Some(exact_attachment_root(&root)),
            "read_only".to_string(),
        );
        let target = outside.join("runtime-owned.txt");
        let first_write = runtime
            .write_text_file(&json!({"path": target, "content": "first"}))
            .await;
        let second_write = runtime
            .write_text_file(&json!({"path": target, "content": "second"}))
            .await;
        let read = runtime.read_text_file(&json!({"path": target})).await;

        host.shutdown().await;
        let persisted = std::fs::read_to_string(&target).ok();
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&outside).unwrap();

        assert!(
            first_write.is_ok(),
            "Core must not require a separate ACP file-write authorization: {first_write:?}"
        );
        assert!(
            second_write.is_ok(),
            "ACP Client FS writes must not consume one-time Core authorization: {second_write:?}"
        );
        assert_eq!(read.unwrap()["content"], "second");
        assert_eq!(persisted.as_deref(), Some("second"));
    }

    #[tokio::test]
    async fn kimi_038_fixture_uses_the_standard_terminal_wire_lifecycle() {
        let root = std::env::temp_dir().join(format!(
            "rovai-acp-client-terminal-kimi-038-wire-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let executable = root.join("kimi");
        let protocol_log = root.join("protocol.jsonl");
        let create_request = serde_json::to_string(&json!({
            "jsonrpc": "2.0",
            "id": 91,
            "method": "terminal/create",
            "params": {
                "sessionId": "session-kimi-038-terminal",
                "command": "/bin/sh",
                "args": [
                    "-c",
                    "printf wire-stdout; printf wire-stderr >&2; exit 7"
                ],
                "cwd": root,
                "outputByteLimit": 65536,
            }
        }))
        .unwrap();
        make_executable(
            &executable,
            &format!(
                r#"#!/bin/sh
IFS= read -r initialize || exit 1
printf '%s\n' "$initialize" >> '{}'
printf '%s\n' '{{"jsonrpc":"2.0","id":1,"result":{{"protocolVersion":1,"agentCapabilities":{{}}}}}}'
IFS= read -r session_new || exit 1
printf '%s\n' "$session_new" >> '{}'
printf '%s\n' '{{"jsonrpc":"2.0","id":2,"result":{{"sessionId":"session-kimi-038-terminal","configOptions":[{{"id":"mode","currentValue":"default","options":[{{"value":"default","name":"Default"}}]}}]}}}}'
IFS= read -r mode || exit 1
printf '%s\n' "$mode" >> '{}'
printf '%s\n' '{{"jsonrpc":"2.0","id":3,"result":null}}'
IFS= read -r prompt || exit 1
printf '%s\n' "$prompt" >> '{}'
cat <<'ROVAI_CREATE_TERMINAL_REQUEST'
{}
ROVAI_CREATE_TERMINAL_REQUEST
IFS= read -r create_response || exit 1
printf '%s\n' "$create_response" >> '{}'
terminal_id=$(printf '%s' "$create_response" | sed -n 's/.*"terminalId":"\([^"]*\)".*/\1/p')
[ -n "$terminal_id" ] || exit 1
printf '{{"jsonrpc":"2.0","id":92,"method":"terminal/output","params":{{"sessionId":"session-kimi-038-terminal","terminalId":"%s"}}}}\n' "$terminal_id"
IFS= read -r initial_output || exit 1
printf '%s\n' "$initial_output" >> '{}'
printf '{{"jsonrpc":"2.0","id":93,"method":"terminal/wait_for_exit","params":{{"sessionId":"session-kimi-038-terminal","terminalId":"%s"}}}}\n' "$terminal_id"
IFS= read -r wait_response || exit 1
printf '%s\n' "$wait_response" >> '{}'
printf '{{"jsonrpc":"2.0","id":94,"method":"terminal/output","params":{{"sessionId":"session-kimi-038-terminal","terminalId":"%s"}}}}\n' "$terminal_id"
IFS= read -r final_output || exit 1
printf '%s\n' "$final_output" >> '{}'
printf '{{"jsonrpc":"2.0","id":95,"method":"terminal/kill","params":{{"sessionId":"session-kimi-038-terminal","terminalId":"%s"}}}}\n' "$terminal_id"
IFS= read -r kill_response || exit 1
printf '%s\n' "$kill_response" >> '{}'
printf '{{"jsonrpc":"2.0","id":96,"method":"terminal/release","params":{{"sessionId":"session-kimi-038-terminal","terminalId":"%s"}}}}\n' "$terminal_id"
IFS= read -r release_response || exit 1
printf '%s\n' "$release_response" >> '{}'
printf '{{"jsonrpc":"2.0","id":97,"method":"terminal/release","params":{{"sessionId":"session-kimi-038-terminal","terminalId":"%s"}}}}\n' "$terminal_id"
IFS= read -r repeated_release_response || exit 1
printf '%s\n' "$repeated_release_response" >> '{}'
printf '%s\n' '{{"jsonrpc":"2.0","id":4,"result":{{"stopReason":"end_turn"}}}}'
while IFS= read -r ignored; do :; done
"#,
                protocol_log.display(),
                protocol_log.display(),
                protocol_log.display(),
                protocol_log.display(),
                create_request,
                protocol_log.display(),
                protocol_log.display(),
                protocol_log.display(),
                protocol_log.display(),
                protocol_log.display(),
                protocol_log.display(),
                protocol_log.display(),
            ),
        );

        let mut frozen = frozen_kimi_runtime(&executable);
        frozen.reported_version = Some("0.38.0".to_string());
        let workspace = AgentRunWorkspace::runtime_managed_path(root.to_string_lossy().to_string());
        let (incoming, mut receiver) = mpsc::unbounded_channel();
        let host = AcpHost::spawn(
            &root,
            &workspace,
            PermissionSemantics::RuntimeManagedV2,
            &frozen,
            incoming,
            Some(exact_builtin_tools(&root)),
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
                agent_run_id: "run-kimi-038-terminal-wire".to_string(),
                execution_epoch: 1,
            },
            host.clone(),
            "sha256:compatibility".to_string(),
            "sha256:mcp".to_string(),
            root.clone(),
            Some(exact_attachment_root(&root)),
            "runtime_managed".to_string(),
        );
        runtime
            .start_or_resume_session(
                None,
                AcpSessionCapabilities::default(),
                "runtime_default",
                "runtime_default",
                &json!({}),
                &BTreeMap::new(),
            )
            .await
            .unwrap();
        runtime
            .start_prompt(
                "delivery-kimi-038-terminal",
                "exercise standard ACP terminal",
            )
            .await
            .unwrap();
        receive_through_prompt_completion(&mut receiver).await;

        let protocol = std::fs::read_to_string(&protocol_log).unwrap();
        let response = |id| {
            protocol
                .lines()
                .filter_map(|line| serde_json::from_str::<Value>(line).ok())
                .find(|message| message.get("id").and_then(Value::as_u64) == Some(id))
                .unwrap_or_else(|| panic!("Kimi 0.38 fixture has no response {id}"))
        };
        assert!(response(91).pointer("/result/terminalId").is_some());
        assert_eq!(response(93).pointer("/result/exitCode"), Some(&json!(7)));
        let final_output = response(94);
        assert!(
            final_output
                .pointer("/result/output")
                .and_then(Value::as_str)
                .is_some_and(|output| {
                    output.contains("wire-stdout") && output.contains("wire-stderr")
                })
        );
        assert_eq!(
            final_output.pointer("/result/exitStatus/exitCode"),
            Some(&json!(7))
        );
        assert_eq!(response(95).get("result"), Some(&json!({})));
        assert_eq!(response(96).get("result"), Some(&json!({})));
        assert_eq!(response(97).get("result"), Some(&json!({})));
        assert!(
            host.client_terminal_bridge
                .as_ref()
                .unwrap()
                .is_empty()
                .await
        );

        runtime.detach().await;
        host.shutdown().await;
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn client_terminal_output_is_bounded_and_reports_truncation() {
        let mut output = AcpClientTerminalOutput::new(4);
        output.append(b"abcdef");
        assert_eq!(output.snapshot(), ("cdef".to_string(), true));
    }

    #[tokio::test]
    async fn client_terminal_create_output_wait_and_release_use_the_run_context() {
        let root = std::env::temp_dir().join(format!(
            "rovai-acp-client-terminal-lifecycle-{}",
            uuid::Uuid::new_v4()
        ));
        let child_cwd = root.join("child");
        std::fs::create_dir_all(&child_cwd).unwrap();
        let bridge = terminal_bridge(&root);
        let owner = terminal_owner();
        let created = bridge
            .create(
                "session-terminal",
                &owner,
                &json!({
                    "sessionId": "session-terminal",
                    "command": "/bin/sh",
                    "args": [
                        "-c",
                        "printf 'stdout:%s:%s:%s' \"$PWD\" \"$ROVAI_TERMINAL_BASE\" \"$TERMINAL_OVERRIDE\"; printf ':stderr' >&2; exit 7"
                    ],
                    "env": [{"name": "TERMINAL_OVERRIDE", "value": "request-environment"}],
                    "cwd": child_cwd,
                    "outputByteLimit": 65536,
                }),
            )
            .await
            .unwrap();
        let terminal_id = created["terminalId"].as_str().unwrap();

        let initial = bridge
            .output("session-terminal", &owner, terminal_id)
            .await
            .unwrap();
        assert_eq!(initial["truncated"], false);
        let exit = bridge
            .wait_for_exit("session-terminal", &owner, terminal_id)
            .await
            .unwrap();
        assert_eq!(exit["exitCode"], 7);
        assert!(exit["signal"].is_null());
        let output = bridge
            .output("session-terminal", &owner, terminal_id)
            .await
            .unwrap();
        let text = output["output"].as_str().unwrap();
        assert!(text.contains(&format!(
            "stdout:{}",
            child_cwd.canonicalize().unwrap().display()
        )));
        assert!(text.contains("base-environment"));
        assert!(text.contains("request-environment"));
        assert!(text.contains(":stderr"));
        assert_eq!(output["exitStatus"]["exitCode"], 7);

        bridge
            .release("session-terminal", &owner, terminal_id)
            .await
            .unwrap();
        bridge
            .release("session-terminal", &owner, terminal_id)
            .await
            .expect("terminal/release must be idempotent");
        assert!(
            bridge
                .output("session-terminal", &owner, terminal_id)
                .await
                .is_err()
        );
        assert!(bridge.is_empty().await);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn client_terminal_kill_is_safe_and_keeps_the_handle_until_release() {
        let root = std::env::temp_dir().join(format!(
            "rovai-acp-client-terminal-kill-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let bridge = terminal_bridge(&root);
        let owner = terminal_owner();
        let created = bridge
            .create(
                "session-kill",
                &owner,
                &json!({
                    "sessionId": "session-kill",
                    "command": "/bin/sh",
                    "args": ["-c", "printf started; sleep 30"],
                    "cwd": root,
                }),
            )
            .await
            .unwrap();
        let terminal_id = created["terminalId"].as_str().unwrap();
        bridge
            .kill("session-kill", &owner, terminal_id)
            .await
            .unwrap();
        let exit = timeout(
            Duration::from_secs(2),
            bridge.wait_for_exit("session-kill", &owner, terminal_id),
        )
        .await
        .expect("killed terminal must exit promptly")
        .unwrap();
        assert!(exit["exitCode"].is_null() || exit["exitCode"].as_u64() != Some(0));
        bridge
            .kill("session-kill", &owner, terminal_id)
            .await
            .expect("terminal/kill must be safe after exit");
        let output = bridge
            .output("session-kill", &owner, terminal_id)
            .await
            .unwrap();
        assert!(output["exitStatus"].is_object());
        bridge
            .release("session-kill", &owner, terminal_id)
            .await
            .unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn client_terminal_host_cleanup_reaps_processes_and_closes_the_bridge() {
        let root = std::env::temp_dir().join(format!(
            "rovai-acp-client-terminal-host-cleanup-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let terminal_pid = root.join("terminal.pid");
        let bridge = terminal_bridge(&root);
        let owner = terminal_owner();
        bridge
            .create(
                "session-host-cleanup",
                &owner,
                &json!({
                    "sessionId": "session-host-cleanup",
                    "command": "/bin/sh",
                    "args": [
                        "-c",
                        format!("printf '%s' $$ > '{}'; exec sleep 30", terminal_pid.display())
                    ],
                    "cwd": root,
                }),
            )
            .await
            .unwrap();
        timeout(Duration::from_secs(2), async {
            while !terminal_pid.exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("Host cleanup Terminal process did not start");
        let pid = std::fs::read_to_string(&terminal_pid)
            .unwrap()
            .parse::<i32>()
            .unwrap();

        bridge.release_all().await;

        assert!(bridge.is_empty().await);
        assert!(!process_is_alive(pid));
        let late_create = bridge
            .create(
                "session-host-cleanup",
                &owner,
                &json!({
                    "sessionId": "session-host-cleanup",
                    "command": "/bin/sh",
                    "args": ["-c", "exit 0"],
                    "cwd": root,
                }),
            )
            .await
            .expect_err("closed Host must reject a late terminal/create");
        assert!(late_create.to_string().contains("Bridge is closed"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn client_terminal_rejects_workspace_escape_and_cleans_a_run_session() {
        let root = std::env::temp_dir().join(format!(
            "rovai-acp-client-terminal-scope-{}",
            uuid::Uuid::new_v4()
        ));
        let outside = std::env::temp_dir().join(format!(
            "rovai-acp-client-terminal-outside-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let symlink_escape = root.join("symlink-escape");
        std::os::unix::fs::symlink(&outside, &symlink_escape).unwrap();
        let bridge = terminal_bridge(&root);
        let owner = terminal_owner();
        let escaped = bridge
            .create(
                "session-scope",
                &owner,
                &json!({
                    "sessionId": "session-scope",
                    "command": "/bin/sh",
                    "args": ["-c", "exit 0"],
                    "cwd": outside,
                }),
            )
            .await
            .expect_err("workspace escape must fail closed");
        assert!(
            escaped
                .to_string()
                .contains("outside the AgentRun execution root")
        );
        let symlink_escaped = bridge
            .create(
                "session-scope",
                &owner,
                &json!({
                    "sessionId": "session-scope",
                    "command": "/bin/sh",
                    "args": ["-c", "exit 0"],
                    "cwd": symlink_escape,
                }),
            )
            .await
            .expect_err("cwd symlink escape must fail closed");
        assert!(
            symlink_escaped
                .to_string()
                .contains("outside the AgentRun execution root")
        );

        let created = bridge
            .create(
                "session-scope",
                &owner,
                &json!({
                    "sessionId": "session-scope",
                    "command": "/bin/sh",
                    "args": ["-c", "sleep 30"],
                    "cwd": root,
                }),
            )
            .await
            .unwrap();
        let terminal_id = created["terminalId"].as_str().unwrap().to_string();
        bridge.release_session("session-scope", &owner).await;
        assert!(bridge.is_empty().await);
        assert!(
            bridge
                .output("session-scope", &owner, &terminal_id)
                .await
                .is_err()
        );
        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(outside).unwrap();
    }

    #[tokio::test]
    async fn runtime_cancellation_terminates_and_releases_client_terminals() {
        let root = std::env::temp_dir().join(format!(
            "rovai-acp-client-terminal-cancel-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let executable = root.join("kimi");
        let protocol_log = root.join("protocol.jsonl");
        let terminal_pid = root.join("terminal.pid");
        let late_terminal_pid = root.join("late-terminal.pid");
        let terminal_request = serde_json::to_string(&json!({
            "jsonrpc": "2.0",
            "id": 91,
            "method": "terminal/create",
            "params": {
                "sessionId": "session-kimi-terminal",
                "command": "/bin/sh",
                "args": [
                    "-c",
                    format!("printf '%s' $$ > '{}'; exec sleep 30", terminal_pid.display())
                ],
                "cwd": root,
                "outputByteLimit": 65536,
            }
        }))
        .unwrap();
        let late_terminal_request = serde_json::to_string(&json!({
            "jsonrpc": "2.0",
            "id": 92,
            "method": "terminal/create",
            "params": {
                "sessionId": "session-kimi-terminal",
                "command": "/bin/sh",
                "args": [
                    "-c",
                    format!(
                        "printf '%s' $$ > '{}'; exec sleep 30",
                        late_terminal_pid.display()
                    )
                ],
                "cwd": root,
            }
        }))
        .unwrap();
        make_executable(
            &executable,
            &format!(
                r#"#!/bin/sh
IFS= read -r initialize || exit 1
printf '%s\n' "$initialize" >> '{}'
printf '%s\n' '{{"jsonrpc":"2.0","id":1,"result":{{"protocolVersion":1,"agentCapabilities":{{}}}}}}'
IFS= read -r session_new || exit 1
printf '%s\n' "$session_new" >> '{}'
printf '%s\n' '{{"jsonrpc":"2.0","id":2,"result":{{"sessionId":"session-kimi-terminal","configOptions":[{{"id":"mode","currentValue":"default","options":[{{"value":"default","name":"Default"}}]}}]}}}}'
IFS= read -r mode || exit 1
printf '%s\n' "$mode" >> '{}'
printf '%s\n' '{{"jsonrpc":"2.0","id":3,"result":null}}'
IFS= read -r prompt || exit 1
printf '%s\n' "$prompt" >> '{}'
cat <<'ROVAI_TERMINAL_REQUEST'
{}
ROVAI_TERMINAL_REQUEST
IFS= read -r terminal_response || exit 1
printf '%s\n' "$terminal_response" >> '{}'
while IFS= read -r message; do
  printf '%s\n' "$message" >> '{}'
  if printf '%s' "$message" | grep -q '"method":"session/cancel"'; then
    cat <<'ROVAI_LATE_TERMINAL_REQUEST'
{}
ROVAI_LATE_TERMINAL_REQUEST
    IFS= read -r late_terminal_response || exit 1
    printf '%s\n' "$late_terminal_response" >> '{}'
  fi
done
"#,
                protocol_log.display(),
                protocol_log.display(),
                protocol_log.display(),
                protocol_log.display(),
                terminal_request,
                protocol_log.display(),
                protocol_log.display(),
                late_terminal_request,
                protocol_log.display(),
            ),
        );

        let frozen = frozen_kimi_runtime(&executable);
        let workspace = AgentRunWorkspace::runtime_managed_path(root.to_string_lossy().to_string());
        let (incoming, mut receiver) = mpsc::unbounded_channel();
        let host = AcpHost::spawn(
            &root,
            &workspace,
            PermissionSemantics::RuntimeManagedV2,
            &frozen,
            incoming,
            Some(exact_builtin_tools(&root)),
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
                agent_run_id: "run-kimi-terminal-cancel".to_string(),
                execution_epoch: 1,
            },
            host.clone(),
            "sha256:compatibility".to_string(),
            "sha256:mcp".to_string(),
            root.clone(),
            Some(exact_attachment_root(&root)),
            "runtime_managed".to_string(),
        );
        runtime
            .start_or_resume_session(
                None,
                AcpSessionCapabilities::default(),
                "runtime_default",
                "runtime_default",
                &json!({}),
                &BTreeMap::new(),
            )
            .await
            .unwrap();
        runtime
            .start_prompt("delivery-kimi-terminal", "run a shell command")
            .await
            .unwrap();

        timeout(Duration::from_secs(2), async {
            while !terminal_pid.exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("Kimi terminal process did not start");
        let pid = std::fs::read_to_string(&terminal_pid)
            .unwrap()
            .parse::<i32>()
            .unwrap();
        runtime.cancel().await.unwrap();

        assert!(
            host.client_terminal_bridge
                .as_ref()
                .unwrap()
                .is_empty()
                .await
        );
        assert!(
            receiver.try_recv().is_err(),
            "Terminal output must stay protocol-private"
        );
        timeout(Duration::from_secs(2), async {
            loop {
                if !process_is_alive(pid) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("AgentRun cancellation left the Terminal process alive");
        timeout(Duration::from_secs(2), async {
            loop {
                let protocol = std::fs::read_to_string(&protocol_log).unwrap_or_default();
                let late_create_was_rejected = protocol.lines().any(|line| {
                    serde_json::from_str::<Value>(line).is_ok_and(|message| {
                        message.get("id").and_then(Value::as_u64) == Some(92)
                            && message.get("error").is_some()
                    })
                });
                if protocol.contains("\"terminalId\"")
                    && protocol.contains("\"method\":\"session/cancel\"")
                    && late_create_was_rejected
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("Kimi fixture did not observe Terminal response and cancellation");
        assert!(
            !late_terminal_pid.exists(),
            "terminal/create raced past the AgentRun cancellation fence"
        );

        host.shutdown().await;
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn kimi_provider_configuration_is_allowlisted_and_process_local() {
        let root = std::env::temp_dir().join(format!(
            "rovai-kimi-provider-config-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("kimi-code.env");
        std::fs::write(
            &path,
            concat!(
                "KIMI_MODEL_NAME=MiniMax-M3\n",
                "KIMI_MODEL_PROVIDER_TYPE=openai\n",
                "KIMI_MODEL_API_KEY=test-plan-key\n",
                "KIMI_MODEL_BASE_URL=https://api.minimaxi.com/v1\n",
                "KIMI_MODEL_MAX_CONTEXT_SIZE=204800\n",
                "KIMI_MODEL_CAPABILITIES=thinking\n",
            ),
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        }

        let mut command = Command::new("/usr/bin/true");
        configure_kimi_model_environment_from_path(&mut command, &path).unwrap();
        let environment = command
            .as_std()
            .get_envs()
            .map(|(key, value)| {
                (
                    key.to_string_lossy().to_string(),
                    value.unwrap().to_string_lossy().to_string(),
                )
            })
            .collect::<BTreeMap<_, _>>();
        assert_eq!(environment.len(), KIMI_MODEL_ENVIRONMENT_KEYS.len());
        assert_eq!(environment["KIMI_MODEL_NAME"], "MiniMax-M3");
        assert_eq!(
            environment["KIMI_MODEL_BASE_URL"],
            "https://api.minimaxi.com/v1"
        );
        assert_eq!(environment["KIMI_MODEL_API_KEY"], "test-plan-key");

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn kimi_provider_configuration_rejects_unknown_keys() {
        let root = std::env::temp_dir().join(format!(
            "rovai-kimi-provider-config-invalid-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("kimi-code.env");
        std::fs::write(
            &path,
            concat!(
                "KIMI_MODEL_NAME=MiniMax-M3\n",
                "KIMI_MODEL_PROVIDER_TYPE=openai\n",
                "KIMI_MODEL_API_KEY=test-plan-key\n",
                "KIMI_MODEL_BASE_URL=https://api.minimaxi.com/v1\n",
                "UNSCOPED_SECRET=must-not-pass\n",
            ),
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        }

        let mut command = Command::new("/usr/bin/true");
        let error = configure_kimi_model_environment_from_path(&mut command, &path)
            .expect_err("unknown provider keys must fail closed");
        assert!(error.to_string().contains("unsupported"));

        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn kimi_provider_configuration_rejects_group_readable_secrets() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!(
            "rovai-kimi-provider-config-permissions-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("kimi-code.env");
        std::fs::write(&path, "KIMI_MODEL_NAME=MiniMax-M3\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o640)).unwrap();

        let mut command = Command::new("/usr/bin/true");
        let error = configure_kimi_model_environment_from_path(&mut command, &path)
            .expect_err("group-readable provider secrets must fail closed");
        assert!(error.to_string().contains("group or others"));

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn grok_official_model_config_resolves_only_referenced_secure_environment() {
        let root = std::env::temp_dir().join(format!(
            "rovai-grok-provider-config-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let config_path = root.join("config.toml");
        let environment_path = root.join(".env");
        std::fs::write(
            &config_path,
            concat!(
                "[models]\n",
                "default = \"minimax-m3\"\n",
                "\n",
                "[model.minimax-m3]\n",
                "model = \"MiniMax-M3\"\n",
                "base_url = \"https://api.minimaxi.com/v1\"\n",
                "env_key = \"MINIMAX_API_KEY\"\n",
                "env_http_headers = { \"X-Tenant\" = \"MINIMAX_TENANT_TOKEN\" }\n",
            ),
        )
        .unwrap();
        std::fs::write(
            &environment_path,
            concat!(
                "export MINIMAX_API_KEY='test-plan-key'\n",
                "MINIMAX_TENANT_TOKEN=test-tenant\n",
                "UNREFERENCED_SECRET=must-not-pass\n",
            ),
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&environment_path, std::fs::Permissions::from_mode(0o600))
                .unwrap();
        }

        let configuration = load_grok_native_configuration_from_paths(
            &root,
            &config_path,
            &environment_path,
            &BTreeMap::new(),
        )
        .unwrap();
        assert!(configuration.byok_configured);
        assert_eq!(configuration.environment.len(), 2);
        assert_eq!(
            configuration.environment["MINIMAX_API_KEY"],
            "test-plan-key"
        );
        assert_eq!(
            configuration.environment["MINIMAX_TENANT_TOKEN"],
            "test-tenant"
        );
        assert!(
            !configuration
                .environment
                .contains_key("UNREFERENCED_SECRET")
        );

        let mut command = Command::new("/usr/bin/true");
        apply_grok_native_configuration(&mut command, configuration);
        let environment = command
            .as_std()
            .get_envs()
            .map(|(key, value)| {
                (
                    key.to_string_lossy().to_string(),
                    value.unwrap().to_string_lossy().to_string(),
                )
            })
            .collect::<BTreeMap<_, _>>();
        assert_eq!(environment.len(), 3);
        assert_eq!(environment["MINIMAX_API_KEY"], "test-plan-key");
        assert_eq!(environment["MINIMAX_TENANT_TOKEN"], "test-tenant");
        assert_eq!(environment["GROK_DISABLE_AUTOUPDATER"], "1");
        assert!(!environment.contains_key("GROK_DEFAULT_MODEL"));
        assert!(!environment.contains_key("GROK_MODELS_BASE_URL"));

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn grok_official_literal_api_key_is_byok_without_a_rovai_translation() {
        let root = std::env::temp_dir().join(format!(
            "rovai-grok-provider-config-literal-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let config_path = root.join("config.toml");
        std::fs::write(
            &config_path,
            concat!(
                "[model.minimax-m3]\n",
                "model = \"MiniMax-M3\"\n",
                "base_url = \"https://api.minimaxi.com/v1\"\n",
                "api_key = \"test-plan-key\"\n",
            ),
        )
        .unwrap();
        let configuration = load_grok_native_configuration_from_paths(
            &root,
            &config_path,
            &root.join(".env"),
            &BTreeMap::new(),
        )
        .unwrap();
        assert!(configuration.byok_configured);
        assert!(configuration.environment.is_empty());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn grok_environment_source_rejects_group_readable_secrets() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!(
            "rovai-grok-provider-config-permissions-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let config_path = root.join("config.toml");
        let environment_path = root.join(".env");
        std::fs::write(
            &config_path,
            "[model.minimax-m3]\nenv_key = \"MINIMAX_API_KEY\"\n",
        )
        .unwrap();
        std::fs::write(&environment_path, "MINIMAX_API_KEY=test-plan-key\n").unwrap();
        std::fs::set_permissions(&environment_path, std::fs::Permissions::from_mode(0o640))
            .unwrap();

        let error = load_grok_native_configuration_from_paths(
            &root,
            &config_path,
            &environment_path,
            &BTreeMap::new(),
        )
        .expect_err("group-readable Grok environment secrets must fail closed");
        assert!(error.to_string().contains("group or others"));

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn grok_byok_probe_copies_official_config_without_copying_the_env_file() {
        let root = std::env::temp_dir().join(format!(
            "rovai-grok-provider-probe-home-{}",
            uuid::Uuid::new_v4()
        ));
        let source_home = root.join("source");
        let probe_home = root.join("probe");
        std::fs::create_dir_all(&source_home).unwrap();
        std::fs::write(
            source_home.join("config.toml"),
            "[model.minimax-m3]\nenv_key = \"MINIMAX_API_KEY\"\n",
        )
        .unwrap();
        std::fs::write(
            source_home.join("managed_config.toml"),
            "[features]\ntelemetry = false\n",
        )
        .unwrap();
        std::fs::write(source_home.join(".env"), "MINIMAX_API_KEY=test-plan-key\n").unwrap();

        prepare_grok_probe_home_from(&source_home, &probe_home).unwrap();
        assert_eq!(
            std::fs::read_to_string(probe_home.join("config.toml")).unwrap(),
            "[model.minimax-m3]\nenv_key = \"MINIMAX_API_KEY\"\n"
        );
        assert!(probe_home.join("managed_config.toml").is_file());
        assert!(!probe_home.join(".env").exists());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cursor_effective_launch_preserves_native_permissions_and_narrows_read_only() {
        let root =
            std::env::temp_dir().join(format!("rovai-cursor-launch-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let runtime = frozen_cursor_runtime(Path::new("/usr/bin/true"));
        let attachment_root = exact_attachment_root(&root);
        let run_tmp = root.join("run-tmp");
        std::fs::create_dir_all(&run_tmp).unwrap();
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
                None,
                Some(&attachment_root),
                Some(&run_tmp),
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

        let writable_arguments = configure(&writable);
        assert_eq!(writable_arguments[0], "acp");
        assert!(
            writable_arguments
                .iter()
                .any(|argument| argument == "--force")
        );
        assert_eq!(
            writable_arguments
                .iter()
                .filter(|argument| argument.as_str() == "--add-dir")
                .count(),
            2
        );
        let read_only_arguments = configure(&read_only);
        assert!(
            read_only_arguments
                .windows(2)
                .any(|arguments| arguments == ["--mode", "plan"])
        );
        assert!(
            !read_only_arguments
                .iter()
                .any(|argument| argument == "--force")
        );

        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn cursor_private_requests_route_to_the_unique_prompt_and_notifications_stay_private() {
        let root = std::env::temp_dir().join(format!(
            "rovai-cursor-private-routing-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let executable = root.join("cursor-agent");
        let protocol_log = root.join("protocol");
        make_executable(
            &executable,
            &format!(
                r#"#!/bin/sh
IFS= read -r initialize || exit 1
printf '%s\n' "$initialize" >> '{}'
printf '%s\n' '{{"jsonrpc":"2.0","id":1,"result":{{"protocolVersion":1,"agentCapabilities":{{}},"authMethods":[{{"id":"cursor_login","name":"Cursor"}}]}}}}'
IFS= read -r authenticate || exit 1
printf '%s\n' "$authenticate" >> '{}'
printf '%s\n' '{{"jsonrpc":"2.0","id":2,"result":null}}'
IFS= read -r session || exit 1
printf '%s\n' "$session" >> '{}'
printf '%s\n' '{{"jsonrpc":"2.0","id":3,"result":{{"sessionId":"cursor-session"}}}}'
IFS= read -r prompt || exit 1
printf '%s\n' "$prompt" >> '{}'
printf '%s\n' '{{"jsonrpc":"2.0","method":"cursor/update_todos","params":{{"todos":[]}}}}'
printf '%s\n' '{{"jsonrpc":"2.0","id":91,"method":"cursor/unknown","params":{{}}}}'
printf '%s\n' '{{"jsonrpc":"2.0","id":90,"method":"cursor/ask_question","params":{{"toolCallId":"tool-1","questions":[]}}}}'
IFS= read -r unknown_response || exit 1
printf '%s\n' "$unknown_response" >> '{}'
IFS= read -r question_response || exit 1
printf '%s\n' "$question_response" >> '{}'
printf '%s\n' '{{"jsonrpc":"2.0","id":4,"result":{{"stopReason":"end_turn"}}}}'
while IFS= read -r ignored; do :; done
"#,
                protocol_log.display(),
                protocol_log.display(),
                protocol_log.display(),
                protocol_log.display(),
                protocol_log.display(),
                protocol_log.display(),
            ),
        );

        let frozen = frozen_cursor_runtime(&executable);
        let workspace = AgentRunWorkspace::runtime_managed_path(root.to_string_lossy().to_string());
        let (incoming, mut receiver) = mpsc::unbounded_channel();
        let builtin_tools = exact_builtin_tools(&root);
        let host = AcpHost::spawn(
            &root,
            &workspace,
            PermissionSemantics::RuntimeManagedV2,
            &frozen,
            incoming,
            Some(builtin_tools),
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
                agent_run_id: "run-cursor-private".to_string(),
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
                "cursor-agent://runtime-default",
                &json!({}),
                &BTreeMap::new(),
            )
            .await
            .unwrap();
        assert_eq!(session_id, "cursor-session");

        let prompt_id = runtime
            .start_prompt("delivery-cursor-private", "continue")
            .await
            .unwrap();
        let request = receiver
            .recv()
            .await
            .expect("Cursor question was not routed");
        let request_id = match request {
            AcpIncoming::Message {
                native_session_id,
                native_prompt_id,
                delivery_id,
                sequence: 1,
                message,
                ..
            } => {
                assert_eq!(native_session_id, "cursor-session");
                assert_eq!(native_prompt_id, prompt_id);
                assert_eq!(delivery_id, "delivery-cursor-private");
                assert_eq!(
                    message.get("method").and_then(Value::as_str),
                    Some("cursor/ask_question")
                );
                message.get("id").cloned().unwrap()
            }
            other => panic!("unexpected Cursor private message: {other:?}"),
        };
        runtime
            .respond(request_id, json!({"outcome": {"outcome": "skipped"}}))
            .await
            .unwrap();
        assert!(matches!(
            receiver.recv().await,
            Some(AcpIncoming::InputAccepted { native_prompt_id, .. })
                if native_prompt_id == prompt_id
        ));
        assert!(matches!(
            receiver.recv().await,
            Some(AcpIncoming::Message { message, .. })
                if message.get("method").and_then(Value::as_str)
                    == Some("rovai/acp_prompt_completed")
        ));
        assert!(receiver.try_recv().is_err());
        assert!(!host.protocol_violated.load(Ordering::Acquire));
        host.shutdown().await;

        let protocol = std::fs::read_to_string(&protocol_log).unwrap();
        assert!(protocol.contains("\"method\":\"authenticate\""));
        assert!(protocol.contains("\"methodId\":\"cursor_login\""));
        assert!(protocol.contains("\"code\":-32601"));
        assert!(protocol.contains("\"outcome\":\"skipped\""));
        assert!(!protocol.contains("cursor/update_todos\"}"));
        std::fs::remove_dir_all(root).unwrap();
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
    async fn prompt_error_after_activity_keeps_input_accepted_while_early_rejection_does_not() {
        for (case_name, prompt_activity, error_code, expected_accepted) in [
            (
                "activity-before-error",
                r#"printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"session-error","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"working"}}}}'"#,
                -32603,
                true,
            ),
            ("error-before-activity", ":", -32602, false),
        ] {
            let root = std::env::temp_dir().join(format!(
                "rovai-acp-prompt-error-{case_name}-{}",
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&root).unwrap();
            let executable = root.join("traecli");
            make_executable(
                &executable,
                &format!(
                    r#"#!/bin/sh
IFS= read -r initialize || exit 1
printf '%s\n' '{{"jsonrpc":"2.0","id":1,"result":{{"protocolVersion":1,"agentCapabilities":{{}}}}}}'
IFS= read -r session || exit 1
printf '%s\n' '{{"jsonrpc":"2.0","id":2,"result":{{"sessionId":"session-error","models":{{"currentModelId":"trae-default","availableModels":[{{"modelId":"trae-default","name":"TRAE Default"}}]}}}}}}'
IFS= read -r prompt || exit 1
{prompt_activity}
printf '%s\n' '{{"jsonrpc":"2.0","id":3,"error":{{"code":{error_code},"message":"Internal error"}}}}'
while IFS= read -r ignored; do :; done
"#,
                ),
            );

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
                Some(exact_builtin_tools(&root)),
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
                    agent_run_id: format!("run-{case_name}"),
                    execution_epoch: 1,
                },
                host.clone(),
                "sha256:compatibility".to_string(),
                "sha256:mcp".to_string(),
                root.clone(),
                Some(exact_attachment_root(&root)),
                "runtime_managed".to_string(),
            );
            runtime
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
            let prompt_id = runtime
                .start_prompt(&format!("delivery-{case_name}"), "continue")
                .await
                .unwrap();

            if expected_accepted {
                assert!(matches!(
                    receiver.recv().await,
                    Some(AcpIncoming::Message { ref message, .. })
                        if message.pointer("/params/update/content/text").and_then(Value::as_str)
                            == Some("working")
                ));
                assert!(matches!(
                    receiver.recv().await,
                    Some(AcpIncoming::InputAccepted { native_prompt_id, .. })
                        if native_prompt_id == prompt_id
                ));
            } else {
                assert!(matches!(
                    receiver.recv().await,
                    Some(AcpIncoming::InputNotAccepted {
                        native_prompt_id,
                        native_error_code: Some(-32602),
                        ..
                    }) if native_prompt_id == prompt_id
                ));
            }
            assert!(matches!(
                receiver.recv().await,
                Some(AcpIncoming::Message { message, .. })
                    if message.get("method").and_then(Value::as_str)
                        == Some("rovai/acp_prompt_completed")
                        && message.pointer("/params/nativeErrorCode").and_then(Value::as_i64)
                            == Some(error_code)
                        && message.pointer("/params/inputDisposition").and_then(Value::as_str)
                            == Some(if expected_accepted { "accepted" } else { "not_accepted" })
            ));

            host.shutdown().await;
            std::fs::remove_dir_all(root).unwrap();
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
        let builtin_tools = exact_builtin_tools(&root);
        let host = AcpHost::spawn(
            &root,
            &workspace,
            PermissionSemantics::RuntimeManagedV2,
            &frozen,
            incoming,
            Some(builtin_tools),
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
    async fn idle_session_metadata_stays_out_of_prompt_output_and_preserves_the_session() {
        let root = std::env::temp_dir().join(format!(
            "rovai-acp-idle-session-metadata-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let executable = root.join("traecli");
        let emit_metadata = root.join("emit-metadata");
        make_executable(
            &executable,
            &format!(
                r#"#!/bin/sh
IFS= read -r initialize || exit 1
printf '%s\n' '{{"jsonrpc":"2.0","id":1,"result":{{"protocolVersion":1,"agentCapabilities":{{}}}}}}'
IFS= read -r session || exit 1
printf '%s\n' '{{"jsonrpc":"2.0","id":2,"result":{{"sessionId":"session-idle-metadata","models":{{"currentModelId":"trae-default","availableModels":[{{"modelId":"trae-default","name":"TRAE Default"}}]}},"modes":{{"currentModeId":"default","availableModes":[{{"id":"default","name":"Default"}}]}}}}}}'
while [ ! -f '{}' ]; do sleep 0.01; done
printf '%s\n' '{{"jsonrpc":"2.0","method":"session/update","params":{{"sessionId":"session-idle-metadata","update":{{"sessionUpdate":"available_commands_update","availableCommands":[{{"name":"audit-skill","description":"must stay out of prompt output"}}]}}}}}}'
IFS= read -r barrier || exit 1
printf '%s\n' '{{"jsonrpc":"2.0","id":3,"result":{{}}}}'
IFS= read -r prompt || exit 1
printf '%s\n' '{{"jsonrpc":"2.0","method":"session/update","params":{{"sessionId":"session-idle-metadata","update":{{"sessionUpdate":"agent_message_chunk","content":{{"type":"text","text":"current"}}}}}}}}'
printf '%s\n' '{{"jsonrpc":"2.0","id":4,"result":{{"stopReason":"end_turn"}}}}'
printf '%s\n' '{{"jsonrpc":"2.0","method":"session/update","params":{{"sessionId":"session-idle-metadata","update":{{"sessionUpdate":"config_option_update","configOptions":[{{"id":"model","currentValue":"trae-default","options":[]}}]}}}}}}'
IFS= read -r terminal_barrier || exit 1
printf '%s\n' '{{"jsonrpc":"2.0","id":5,"result":{{}}}}'
while IFS= read -r ignored; do :; done
"#,
                emit_metadata.display()
            ),
        );

        let frozen = frozen_trae_runtime(&executable);
        let workspace = AgentRunWorkspace::runtime_managed_path(root.to_string_lossy().to_string());
        let (incoming, mut receiver) = mpsc::unbounded_channel();
        let builtin_tools = exact_builtin_tools(&root);
        let host = AcpHost::spawn(
            &root,
            &workspace,
            PermissionSemantics::RuntimeManagedV2,
            &frozen,
            incoming,
            Some(builtin_tools),
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
                agent_run_id: "run-idle-metadata".to_string(),
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
        std::fs::write(&emit_metadata, b"ready").unwrap();
        host.rpc("audit/barrier", json!({})).await.unwrap();

        assert!(!host.protocol_violated.load(Ordering::Acquire));
        assert!(receiver.try_recv().is_err());
        let prompt_id = runtime
            .start_prompt("delivery-after-metadata", "continue")
            .await
            .unwrap();
        assert!(matches!(
            receiver.recv().await,
            Some(AcpIncoming::Message {
                native_session_id,
                native_prompt_id,
                delivery_id,
                sequence: 1,
                message,
                ..
            }) if native_session_id == session_id
                && native_prompt_id == prompt_id
                && delivery_id == "delivery-after-metadata"
                && message.pointer("/params/update/content/text").and_then(Value::as_str)
                    == Some("current")
        ));
        receive_through_prompt_completion(&mut receiver).await;
        host.rpc("audit/terminal-barrier", json!({})).await.unwrap();
        assert!(!host.protocol_violated.load(Ordering::Acquire));
        assert!(receiver.try_recv().is_err());

        host.shutdown().await;
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
        let builtin_tools = exact_builtin_tools(&root);
        let host = AcpHost::spawn(
            &root,
            &workspace,
            PermissionSemantics::RuntimeManagedV2,
            &frozen,
            incoming,
            Some(builtin_tools),
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
printf '%s\n' '{{"jsonrpc":"2.0","id":90,"method":"session/request_permission","params":{{"sessionId":"session-old","toolCall":{{"toolCallId":"historical-tool"}},"options":[]}}}}'
IFS= read -r quarantined_permission || exit 1
printf '%s\n' '{{"jsonrpc":"2.0","id":2,"result":{{}}}}'
sleep 0.2
printf '%s\n' '{{"jsonrpc":"2.0","method":"session/update","params":{{"sessionId":"session-old","update":{{"sessionUpdate":"agent_message_chunk","content":{{"type":"text","text":"historical"}}}}}}}}'
printf '%s\n' '{{"jsonrpc":"2.0","method":"session/update","params":{{"sessionId":"session-old","update":{{"sessionUpdate":"tool_call","toolCallId":"historical-tool","kind":"execute","title":"historical"}}}}}}'
printf '%s\n' '{{"jsonrpc":"2.0","method":"session/update","params":{{"sessionId":"session-old","update":{{"sessionUpdate":"usage_update","used":999}}}}}}'
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
        let builtin_tools = exact_builtin_tools(&root);
        let host = AcpHost::spawn(
            &root,
            &workspace,
            PermissionSemantics::RuntimeManagedV2,
            &frozen,
            incoming,
            Some(builtin_tools),
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
            let builtin_tools = exact_builtin_tools(&root);
            let host = AcpHost::spawn(
                &root,
                &workspace,
                PermissionSemantics::RuntimeManagedV2,
                &frozen,
                incoming,
                Some(builtin_tools),
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

    #[tokio::test]
    async fn kimi_stopped_host_inherits_native_home_and_exactly_resumes() {
        let root =
            std::env::temp_dir().join(format!("rovai-kimi-cold-resume-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let executable = root.join("kimi");
        let protocol_log = root.join("protocol.jsonl");
        let invocation_log = root.join("invocations");
        let home_log = root.join("homes");
        let native_state_home = root.join("user-kimi-home");
        make_executable(
            &executable,
            &format!(
                r#"#!/bin/sh
printf '%s\n' "$*" >> '{}'
printf '%s\n' "${{KIMI_CODE_HOME-__UNSET__}}" >> '{}'
native_state_home='{}'
mkdir -p "$native_state_home"
IFS= read -r initialize || exit 1
printf '%s\n' "$initialize" >> '{}'
printf '%s\n' '{{"jsonrpc":"2.0","id":1,"result":{{"protocolVersion":1,"agentCapabilities":{{"loadSession":true,"sessionCapabilities":{{"resume":{{}}}}}}}}}}'
IFS= read -r session || exit 1
printf '%s\n' "$session" >> '{}'
case "$session" in
  *'"method":"session/new"'*)
    printf '%s\n' 'session-kimi' > "$native_state_home/session-id"
    ;;
  *'"method":"session/resume"'*)
    test "$(cat "$native_state_home/session-id")" = 'session-kimi' || exit 2
    ;;
  *) exit 3 ;;
esac
printf '%s\n' '{{"jsonrpc":"2.0","id":2,"result":{{"sessionId":"session-kimi","configOptions":[{{"id":"model","currentValue":"runtime_default","options":[{{"value":"runtime_default","name":"Runtime Default"}}]}},{{"id":"mode","currentValue":"default","options":[{{"value":"default","name":"Default"}}]}}]}}}}'
IFS= read -r mode || exit 1
printf '%s\n' "$mode" >> '{}'
printf '%s\n' '{{"jsonrpc":"2.0","id":3,"result":null}}'
while IFS= read -r ignored; do :; done
"#,
                invocation_log.display(),
                home_log.display(),
                native_state_home.display(),
                protocol_log.display(),
                protocol_log.display(),
                protocol_log.display(),
            ),
        );
        let builtin_tools = exact_builtin_tools(&root);
        let frozen = frozen_kimi_runtime(&executable);
        let workspace = AgentRunWorkspace::runtime_managed_path(root.to_string_lossy().to_string());
        let attachment_root = exact_attachment_root(&root);
        let external_mcp_servers = BTreeMap::from([(
            "rovai-test".to_string(),
            McpServerDefinition::Stdio {
                command: "/usr/bin/printf".to_string(),
                args: vec!["mcp".to_string()],
                cwd: Some(root.to_string_lossy().to_string()),
                env: BTreeMap::new(),
            },
        )]);
        let (incoming, _receiver) = mpsc::unbounded_channel();
        let fleet = Arc::new(AgentRuntimeFleetManager::new(
            AgentRuntimeFleetConfig::default(),
        ));
        let private_runtime_dir = root.join("private");
        let adapter = AcpCliRuntimeAdapter::new(
            AdapterKind::KimiCodeCli,
            incoming,
            private_runtime_dir.clone(),
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
                &external_mcp_servers,
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
                    can_resume: true,
                    can_load_history: true,
                },
                "runtime_default",
                "runtime_default",
                &json!({}),
                &external_mcp_servers,
            )
            .await
            .unwrap();
        assert_eq!(session_id, "session-kimi");
        adapter.forget_agent_run("agent-run-one", 1).await;

        assert_eq!(
            std::fs::read_to_string(native_state_home.join("session-id"))
                .unwrap()
                .trim(),
            session_id
        );

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
                &external_mcp_servers,
                "sha256:mcp",
                &attachment_root,
                "sha256:compatibility",
            )
            .await
            .unwrap();
        assert_ne!(second.host_instance_id(), first_host);
        let successor_session = second
            .start_or_resume_session(
                Some(&session_id),
                AcpSessionCapabilities {
                    can_resume: true,
                    can_load_history: true,
                },
                "runtime_default",
                "runtime_default",
                &json!({}),
                &external_mcp_servers,
            )
            .await
            .unwrap();
        assert_eq!(successor_session, session_id);
        adapter.complete_agent_run("agent-run-two", 1).await;
        fleet.shutdown_all().await;

        let invocations = std::fs::read_to_string(&invocation_log).unwrap();
        assert_eq!(invocations.lines().count(), 2);
        let homes = std::fs::read_to_string(&home_log).unwrap();
        let homes = homes.lines().collect::<Vec<_>>();
        let inherited_kimi_home = std::env::var_os("KIMI_CODE_HOME")
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_else(|| "__UNSET__".to_string());
        assert_eq!(homes.len(), 2);
        assert_eq!(homes, vec![inherited_kimi_home.as_str(); 2]);
        let protocol = std::fs::read_to_string(&protocol_log).unwrap();
        assert_eq!(protocol.matches("\"method\":\"session/new\"").count(), 1);
        assert_eq!(protocol.matches("\"method\":\"session/resume\"").count(), 1);
        assert_eq!(protocol.matches("\"name\":\"rovai-test\"").count(), 2);
        assert!(!protocol.contains("\"method\":\"session/load\""));
        assert!(native_state_home.exists());
        assert!(!private_runtime_dir.join("home").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn kimi_completed_run_keeps_the_warm_session_and_idle_compaction_observer() {
        let root =
            std::env::temp_dir().join(format!("rovai-kimi-warm-lru-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let executable = root.join("kimi");
        let protocol_log = root.join("protocol.jsonl");
        let invocation_log = root.join("invocations");
        let home_log = root.join("homes");
        let emit_completion = root.join("emit-compaction-completion");
        make_executable(
            &executable,
            &format!(
                r#"#!/bin/sh
printf '%s\n' "$*" >> '{}'
printf '%s\n' "${{KIMI_CODE_HOME-__UNSET__}}" >> '{}'
IFS= read -r initialize || exit 1
printf '%s\n' "$initialize" >> '{}'
printf '%s\n' '{{"jsonrpc":"2.0","id":1,"result":{{"protocolVersion":1,"agentCapabilities":{{"loadSession":true,"sessionCapabilities":{{"resume":{{}}}}}}}}}}'
IFS= read -r session_new || exit 1
printf '%s\n' "$session_new" >> '{}'
printf '%s\n' '{{"jsonrpc":"2.0","id":2,"result":{{"sessionId":"session-kimi-warm","configOptions":[{{"id":"model","currentValue":"runtime_default","options":[{{"value":"runtime_default","name":"Runtime Default"}}]}},{{"id":"mode","currentValue":"default","options":[{{"value":"default","name":"Default"}}]}}]}}}}'
IFS= read -r mode_one || exit 1
printf '%s\n' "$mode_one" >> '{}'
printf '%s\n' '{{"jsonrpc":"2.0","id":3,"result":null}}'
while [ ! -f '{}' ]; do sleep 0.01; done
printf '%s\n' '{{"jsonrpc":"2.0","method":"session/update","params":{{"sessionId":"session-kimi-warm","update":{{"sessionUpdate":"agent_message_chunk","content":{{"type":"text","text":"Compaction completed.\n- Messages compacted: 12\n- Tokens before: 34,567\n- Tokens after: 8,901"}}}}}}}}'
IFS= read -r mode_two || exit 1
printf '%s\n' "$mode_two" >> '{}'
printf '%s\n' '{{"jsonrpc":"2.0","id":4,"result":null}}'
while IFS= read -r ignored; do :; done
"#,
                invocation_log.display(),
                home_log.display(),
                protocol_log.display(),
                protocol_log.display(),
                protocol_log.display(),
                emit_completion.display(),
                protocol_log.display(),
            ),
        );
        let builtin_tools = exact_builtin_tools(&root);
        let frozen = frozen_kimi_runtime(&executable);
        let workspace = AgentRunWorkspace::runtime_managed_path(root.to_string_lossy().to_string());
        let attachment_root = exact_attachment_root(&root);
        let external_mcp_servers = BTreeMap::from([(
            "rovai-test".to_string(),
            McpServerDefinition::Stdio {
                command: "/usr/bin/printf".to_string(),
                args: vec!["mcp".to_string()],
                cwd: Some(root.to_string_lossy().to_string()),
                env: BTreeMap::new(),
            },
        )]);
        let (incoming, mut receiver) = mpsc::unbounded_channel();
        let fleet = Arc::new(AgentRuntimeFleetManager::new(
            AgentRuntimeFleetConfig::default(),
        ));
        let private_runtime_dir = root.join("private");
        let adapter = AcpCliRuntimeAdapter::new(
            AdapterKind::KimiCodeCli,
            incoming,
            private_runtime_dir.clone(),
            fleet.clone(),
            CompactionDetectorPolicy::BestEffort,
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
                &external_mcp_servers,
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
                    can_resume: true,
                    can_load_history: true,
                },
                "runtime_default",
                "runtime_default",
                &json!({}),
                &external_mcp_servers,
            )
            .await
            .unwrap();
        first
            .install_compaction_observer(CompactionObserverLease {
                id: "observer-kimi-warm".to_string(),
                conversation_id: "conversation-kimi-warm".to_string(),
                adapter_installation_id: frozen.installation_id.clone(),
                adapter_kind: AdapterKind::KimiCodeCli,
                host_instance_id: first.host_instance_id().to_string(),
                relay_process_id: "relay-kimi-warm".to_string(),
                native_session_id: session_id.clone(),
                native_binding_id: "binding-kimi-warm".to_string(),
                native_binding_generation: 1,
                detector_policy_epoch: 1,
            })
            .await
            .unwrap();
        adapter.complete_agent_run("agent-run-one", 1).await;
        std::fs::write(&emit_completion, b"ready").unwrap();
        let observation = tokio::time::timeout(Duration::from_secs(2), receiver.recv())
            .await
            .expect("detached warm Kimi completion observation timed out")
            .expect("detached warm Kimi completion observation missing");
        assert!(matches!(
            observation,
            AcpIncoming::CompactionObservation {
                adapter_kind: AdapterKind::KimiCodeCli,
                observer_lease_id,
                native_session_id,
                source_signal,
                admission_point,
                ..
            } if observer_lease_id == "observer-kimi-warm"
                && native_session_id == session_id
                && source_signal == "kimi.acp.compaction.completed_text.v1"
                && admission_point == "completed"
        ));

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
                &external_mcp_servers,
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
                    can_resume: true,
                    can_load_history: true,
                },
                "runtime_default",
                "runtime_default",
                &json!({}),
                &external_mcp_servers,
            )
            .await
            .unwrap();
        assert_eq!(successor_session, session_id);
        assert!(second.verification_evidence().await.is_some());
        adapter.complete_agent_run("agent-run-two", 1).await;
        fleet.shutdown_all().await;

        let invocations = std::fs::read_to_string(&invocation_log).unwrap();
        assert_eq!(invocations.lines().count(), 1);
        let homes = std::fs::read_to_string(&home_log).unwrap();
        let inherited_kimi_home = std::env::var_os("KIMI_CODE_HOME")
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_else(|| "__UNSET__".to_string());
        assert_eq!(
            homes.lines().collect::<Vec<_>>(),
            [inherited_kimi_home.as_str()]
        );
        let protocol = std::fs::read_to_string(&protocol_log).unwrap();
        assert_eq!(protocol.matches("\"method\":\"session/new\"").count(), 1);
        assert_eq!(
            protocol
                .matches("\"method\":\"session/set_config_option\"")
                .count(),
            2
        );
        assert!(!protocol.contains("\"method\":\"session/load\""));
        assert!(!protocol.contains("\"method\":\"session/resume\""));
        assert!(!private_runtime_dir.join("home").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn kimi_active_prompt_compaction_is_observed_without_polluting_public_text() {
        let root = std::env::temp_dir().join(format!(
            "rovai-kimi-active-prompt-compaction-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let executable = root.join("kimi");
        make_executable(
            &executable,
            r#"#!/bin/sh
IFS= read -r initialize || exit 1
printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentCapabilities":{}}}'
IFS= read -r session_new || exit 1
printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"sessionId":"session-kimi-active","configOptions":[{"id":"mode","currentValue":"default","options":[{"value":"default","name":"Default"}]}]}}'
IFS= read -r mode || exit 1
printf '%s\n' '{"jsonrpc":"2.0","id":3,"result":null}'
IFS= read -r prompt || exit 1
printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"session-kimi-active","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Compacting conversation context…"}}}}'
printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"session-kimi-active","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Compaction is blocked by the current turn; retry when the turn is idle."}}}}'
printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"session-kimi-active","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Compaction completed.\n- Messages compacted: 12\n- Tokens before: 34,567\n- Tokens after: 8,901"}}}}'
printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"session-kimi-active","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"The compact implementation is complete."}}}}'
printf '%s\n' '{"jsonrpc":"2.0","id":4,"result":{"stopReason":"end_turn"}}'
while IFS= read -r ignored; do :; done
"#,
        );

        let frozen = frozen_kimi_runtime(&executable);
        let workspace = AgentRunWorkspace::runtime_managed_path(root.to_string_lossy().to_string());
        let (incoming, mut receiver) = mpsc::unbounded_channel();
        let builtin_tools = exact_builtin_tools(&root);
        let host = AcpHost::spawn(
            &root,
            &workspace,
            PermissionSemantics::RuntimeManagedV2,
            &frozen,
            incoming,
            Some(builtin_tools),
            CompactionDetectorPolicy::BestEffort,
            true,
            &BTreeMap::new(),
            &root.join("private"),
            None,
        )
        .await
        .unwrap();
        let runtime = AcpRuntime::from_host(
            AcpRuntimeOwner {
                agent_run_id: "run-kimi-active-compaction".to_string(),
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
                "runtime_default",
                &json!({}),
                &BTreeMap::new(),
            )
            .await
            .unwrap();
        runtime
            .install_compaction_observer(CompactionObserverLease {
                id: "observer-kimi-active".to_string(),
                conversation_id: "conversation-kimi-active".to_string(),
                adapter_installation_id: frozen.installation_id.clone(),
                adapter_kind: AdapterKind::KimiCodeCli,
                host_instance_id: runtime.host_instance_id().to_string(),
                relay_process_id: "relay-kimi-active".to_string(),
                native_session_id: session_id.clone(),
                native_binding_id: "binding-kimi-active".to_string(),
                native_binding_generation: 1,
                detector_policy_epoch: 1,
            })
            .await
            .unwrap();

        let prompt_id = runtime
            .start_prompt("delivery-kimi-active", "continue")
            .await
            .unwrap();
        let mut observation_count = 0;
        let mut forwarded_chunks = Vec::new();
        loop {
            let incoming = tokio::time::timeout(Duration::from_secs(2), receiver.recv())
                .await
                .expect("Kimi active compaction fixture timed out")
                .expect("Kimi active compaction fixture stopped early");
            match incoming {
                AcpIncoming::CompactionObservation {
                    adapter_kind: AdapterKind::KimiCodeCli,
                    observer_lease_id,
                    native_session_id,
                    source_signal,
                    admission_point,
                    ..
                } => {
                    assert_eq!(observer_lease_id, "observer-kimi-active");
                    assert_eq!(native_session_id, session_id);
                    assert_eq!(source_signal, "kimi.acp.compaction.completed_text.v1");
                    assert_eq!(admission_point, "completed");
                    observation_count += 1;
                }
                AcpIncoming::Message {
                    native_prompt_id,
                    message,
                    ..
                } => {
                    let method = message.get("method").and_then(Value::as_str).unwrap_or("");
                    if method == "rovai/acp_prompt_completed" {
                        break;
                    }
                    if method == "session/update" {
                        if let Some(text) = message
                            .pointer("/params/update/content/text")
                            .and_then(Value::as_str)
                        {
                            forwarded_chunks.push(text.to_string());
                        }
                        runtime
                            .observe_message(
                                &native_prompt_id,
                                method,
                                message.get("params").unwrap_or(&Value::Null),
                            )
                            .await
                            .unwrap();
                    }
                }
                AcpIncoming::InputAccepted { .. } => {}
                other => panic!("unexpected Kimi active compaction event: {other:?}"),
            }
        }

        assert_eq!(observation_count, 1);
        assert_eq!(
            forwarded_chunks,
            ["The compact implementation is complete."]
        );
        assert_eq!(
            runtime.final_agent_message(&prompt_id).await.as_deref(),
            Some("The compact implementation is complete.")
        );
        assert_eq!(
            runtime
                .missing_send_recovery_candidate(&prompt_id)
                .await
                .as_deref(),
            Some("The compact implementation is complete.")
        );
        assert!(!host.protocol_violated.load(Ordering::Acquire));

        host.shutdown().await;
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn completed_run_disposition_preserves_adapter_reuse_evidence() {
        assert_eq!(
            completed_run_release_disposition(AdapterKind::KiroCli),
            FleetReleaseDisposition::Stop
        );
        assert_eq!(
            completed_run_release_disposition(AdapterKind::CursorAgent),
            FleetReleaseDisposition::Stop
        );
        for adapter_kind in [
            AdapterKind::OpencodeCli,
            AdapterKind::CopilotCli,
            AdapterKind::QoderCli,
            AdapterKind::CodebuddyCli,
            AdapterKind::QwenCode,
            AdapterKind::TraeCnCli,
            AdapterKind::KimiCodeCli,
            AdapterKind::GrokBuild,
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
    fn recovery_collector_preserves_provider_text_without_reasoning_tag_cleanup() {
        let mut collector = AcpMissingSendRecoveryCollector::default();
        collector.observe_assistant_chunk(
            Some("message-1"),
            "<think>provider reasoning</think>\nPUBLIC",
        );
        assert_eq!(
            collector.candidate().as_deref(),
            Some("<think>provider reasoning</think>\nPUBLIC")
        );
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
                AcpCompactionSignalSurface::ActivePrompt,
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
            AcpCompactionSignalSurface::SessionMetadata,
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
                AcpCompactionSignalSurface::SessionMetadata,
            )
            .is_none()
        );

        let grok_completed = json!({
            "jsonrpc": "2.0",
            "method": "_x.ai/session_notification",
            "params": {
                "sessionId": "session-grok",
                "_meta": {
                    "eventId": "session-grok:42",
                    "agentTimestampMs": 1_787_579_334_000_i64
                },
                "update": {
                    "sessionUpdate": "auto_compact_completed",
                    "tokens_before": 12_345,
                    "tokens_after": 6_789,
                    "elapsed_ms": 123,
                    "summary_preview": "must not participate in signal admission"
                }
            }
        });
        let grok = detect_acp_compaction_signal(
            AdapterKind::GrokBuild,
            &grok_completed,
            AcpCompactionSignalSurface::SessionMetadata,
        )
        .expect("Grok's exact structured completion should be detected");
        assert_eq!(grok.source_signal, "grok.acp.auto_compact_completed.v1");
        assert_eq!(grok.admission_point, "completed");
        assert_eq!(
            grok.runtime_occurrence_id.as_deref(),
            Some("session-grok:42")
        );
        assert!(is_idle_session_metadata(
            AdapterKind::GrokBuild,
            &grok_completed
        ));
        assert!(
            detect_acp_compaction_signal(
                AdapterKind::GrokBuild,
                &grok_completed,
                AcpCompactionSignalSurface::ActivePrompt,
            )
            .is_none(),
            "Grok completion must be consumed as private Session metadata"
        );

        let grok_malformed = [
            {
                let mut value = grok_completed.clone();
                value["id"] = json!(7);
                value
            },
            {
                let mut value = grok_completed.clone();
                value["method"] = json!("x.ai/session_notification");
                value
            },
            {
                let mut value = grok_completed.clone();
                value["params"]["method"] = json!("x.ai/session_notification");
                value["params"]["params"] = value["params"].clone();
                value["params"].as_object_mut().unwrap().remove("sessionId");
                value["params"].as_object_mut().unwrap().remove("_meta");
                value["params"].as_object_mut().unwrap().remove("update");
                value
            },
            {
                let mut value = grok_completed.clone();
                value["params"]["update"]["sessionUpdate"] = json!("auto_compact_started");
                value
            },
            {
                let mut value = grok_completed.clone();
                value["params"]["sessionId"] = json!("");
                value
            },
            {
                let mut value = grok_completed.clone();
                value["params"]["_meta"]
                    .as_object_mut()
                    .unwrap()
                    .remove("eventId");
                value
            },
            {
                let mut value = grok_completed.clone();
                value["params"]["_meta"]["eventId"] = json!("  ");
                value
            },
            {
                let mut value = grok_completed.clone();
                value["params"]["_meta"]["isReplay"] = json!(true);
                value
            },
            {
                let mut value = grok_completed.clone();
                value["params"]["update"]["tokens_after"] = json!(-1);
                value
            },
            {
                let mut value = grok_completed.clone();
                value["params"]["update"]["tokens_before"] = json!("12345");
                value
            },
            {
                let mut value = grok_completed.clone();
                value["params"]["update"]["elapsed_ms"] = json!(-1);
                value
            },
        ];
        for malformed in grok_malformed {
            assert!(
                detect_acp_compaction_signal(
                    AdapterKind::GrokBuild,
                    &malformed,
                    AcpCompactionSignalSurface::SessionMetadata,
                )
                .is_none(),
                "Grok compaction completion parsing must fail closed for {malformed}"
            );
        }

        let kimi_completed = json!({
            "method": "session/update",
            "params": {
                "sessionId": "session-kimi",
                "update": {
                    "sessionUpdate": "agent_message_chunk",
                    "content": {
                        "type": "text",
                        "text": "Compaction completed.\n- Messages compacted: 1,234\n- Tokens before: 12,345\n- Tokens after: 6,789"
                    }
                }
            }
        });
        let kimi = detect_acp_compaction_signal(
            AdapterKind::KimiCodeCli,
            &kimi_completed,
            AcpCompactionSignalSurface::SessionMetadata,
        )
        .expect("Kimi's exact idle completion frame should be detected");
        assert_eq!(kimi.source_signal, "kimi.acp.compaction.completed_text.v1");
        assert_eq!(kimi.admission_point, "completed");
        assert!(kimi.runtime_occurrence_id.is_none());
        assert!(is_idle_session_metadata(
            AdapterKind::KimiCodeCli,
            &kimi_completed
        ));
        assert!(!is_idle_session_metadata(
            AdapterKind::TraeCnCli,
            &kimi_completed
        ));
        assert!(
            detect_acp_compaction_signal(
                AdapterKind::KimiCodeCli,
                &kimi_completed,
                AcpCompactionSignalSurface::ActivePrompt,
            )
            .is_none(),
            "model output inside an active prompt is not Kimi lifecycle metadata"
        );

        for ordinary_or_malformed in [
            "The compact implementation is complete.",
            "Compaction completed.",
            "Compaction completed.\n- Messages compacted: 1234\n- Tokens before: 12,345\n- Tokens after: 6,789",
            "Compaction completed.\n- Messages compacted: 1,234\n- Tokens before: 12,345\n- Tokens after: 6,789\n",
        ] {
            let mut message = kimi_completed.clone();
            message["params"]["update"]["content"]["text"] =
                Value::String(ordinary_or_malformed.to_string());
            assert!(
                detect_acp_compaction_signal(
                    AdapterKind::KimiCodeCli,
                    &message,
                    AcpCompactionSignalSurface::SessionMetadata,
                )
                .is_none(),
                "Kimi compaction completion parsing must fail closed for {ordinary_or_malformed:?}"
            );
        }
    }

    #[test]
    fn kimi_prompt_compaction_lifecycle_keeps_blocked_pending_and_clears_only_on_terminal() {
        let frame = |text: &str| {
            json!({
                "method": "session/update",
                "params": {
                    "sessionId": "session-kimi",
                    "update": {
                        "sessionUpdate": "agent_message_chunk",
                        "content": {"type": "text", "text": text}
                    }
                }
            })
        };
        let started = frame("Compacting conversation context…");
        let instructed_started =
            frame("Compacting conversation context with instruction: preserve tool evidence");
        let blocked =
            frame("Compaction is blocked by the current turn; retry when the turn is idle.");
        let completed = frame(
            "Compaction completed.\n- Messages compacted: 12\n- Tokens before: 34,567\n- Tokens after: 8,901",
        );
        let cancelled = frame("Compaction cancelled.");
        let ordinary = frame("The compact implementation is complete.");
        let mut state = KimiCompactionLifecycle::Idle;

        assert!(!consume_kimi_prompt_compaction_lifecycle_frame(
            &mut state, &completed
        ));
        assert!(!consume_kimi_prompt_compaction_lifecycle_frame(
            &mut state, &ordinary
        ));
        assert_eq!(state, KimiCompactionLifecycle::Idle);

        assert!(consume_kimi_prompt_compaction_lifecycle_frame(
            &mut state, &started
        ));
        assert_eq!(state, KimiCompactionLifecycle::Pending);
        assert!(consume_kimi_prompt_compaction_lifecycle_frame(
            &mut state, &blocked
        ));
        assert_eq!(state, KimiCompactionLifecycle::Pending);
        assert!(consume_kimi_prompt_compaction_lifecycle_frame(
            &mut state, &completed
        ));
        assert_eq!(state, KimiCompactionLifecycle::Idle);

        assert!(consume_kimi_prompt_compaction_lifecycle_frame(
            &mut state,
            &instructed_started,
        ));
        assert_eq!(state, KimiCompactionLifecycle::Pending);
        assert!(consume_kimi_prompt_compaction_lifecycle_frame(
            &mut state, &cancelled
        ));
        assert_eq!(state, KimiCompactionLifecycle::Idle);
        assert!(!consume_kimi_prompt_compaction_lifecycle_frame(
            &mut state, &blocked
        ));
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
    fn every_acp_session_receives_exact_attachment_and_run_tmp_roots() {
        let root = Path::new("/tmp/rovai-camp-attachments/camp-id");
        let run_tmp = Path::new("/tmp/rovai-process/run-tmp");
        assert_eq!(
            session_additional_directories(Some(root), Some(run_tmp)).unwrap(),
            vec![
                root.to_string_lossy().into_owned(),
                run_tmp.to_string_lossy().into_owned(),
            ]
        );
        assert!(
            session_additional_directories(None, Some(run_tmp))
                .unwrap_err()
                .to_string()
                .contains("camp_attachment_view_runtime_unsupported")
        );
        assert!(
            session_additional_directories(Some(root), None)
                .unwrap_err()
                .to_string()
                .contains("Built-in Tool Run tmp")
        );
    }

    #[test]
    fn private_host_config_is_created_only_for_kiro() {
        let root = std::env::temp_dir().join(format!(
            "rovai-private-host-config-{}",
            uuid::Uuid::new_v4()
        ));
        let kiro_one = prepare_private_host_config(&root, AdapterKind::KiroCli)
            .unwrap()
            .unwrap();
        let kiro_two = prepare_private_host_config(&root, AdapterKind::KiroCli)
            .unwrap()
            .unwrap();
        assert_ne!(kiro_one.root, kiro_two.root);
        assert!(kiro_one.remove_on_shutdown);
        assert!(kiro_two.remove_on_shutdown);

        assert!(
            prepare_private_host_config(&root, AdapterKind::KimiCodeCli)
                .unwrap()
                .is_none()
        );
        assert!(!root.join("home").exists());

        std::fs::remove_dir_all(root).unwrap();
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
            select_acp_session_continuation(
                AdapterKind::KimiCodeCli,
                false,
                Some("session-1"),
                resume_and_load,
            ),
            AcpSessionContinuation::Resume
        );
        assert_eq!(
            select_acp_session_continuation(
                AdapterKind::KimiCodeCli,
                false,
                Some("session-1"),
                load_only,
            ),
            AcpSessionContinuation::HistoryRestore
        );
        assert_eq!(
            select_acp_session_continuation(
                AdapterKind::GrokBuild,
                false,
                Some("session-1"),
                load_only,
            ),
            AcpSessionContinuation::New
        );
        assert_eq!(
            select_acp_session_continuation(
                AdapterKind::GrokBuild,
                false,
                Some("session-1"),
                resume_and_load,
            ),
            AcpSessionContinuation::Resume
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
    fn warm_compatibility_ignores_run_local_projection_but_not_host_inputs() {
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
        let legacy_digest = canonical_json_digest(&json!({
            "schemaVersion": 3,
            "adapterKind": frozen.adapter_kind,
            "runtimeConfigDigest": None::<&str>,
            "hostConfigDigest": frozen.host_config_digest,
            "executionRoot": root.canonicalize().unwrap(),
            "workspace": workspace,
            "permissionSemantics": PermissionSemantics::RuntimeManagedV2,
            "builtinToolContractVersion": BUILTIN_TOOL_CONTRACT_VERSION,
            "builtinToolCatalogDigest": builtin_tool_catalog_digest().unwrap(),
            "externalMcpServers": BTreeMap::<String, McpServerDefinition>::new(),
            "mcpProjectionDigest": None::<&str>,
            "campAttachmentViewContractVersion": CAMP_ATTACHMENT_VIEW_CONTRACT_VERSION,
            "campAttachmentRoot": attachment_authorization.attachment_root,
            "campAttachmentVisibilityMode": attachment_authorization.visibility_mode.as_str(),
            "campAttachmentGeneration": attachment_authorization
                .visibility_mode
                .compatibility_generation(attachment_authorization.generation),
        }))
        .unwrap();
        assert_eq!(first, legacy_digest);

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

        let kimi = frozen_kimi_runtime(&executable);
        let kimi_first = runtime_compatibility_digest(
            &kimi,
            &workspace,
            PermissionSemantics::RuntimeManagedV2,
            &BTreeMap::new(),
            "sha256:kimi-run-one-projection",
            &attachment_authorization,
        )
        .unwrap();
        let kimi_next_run_projection = runtime_compatibility_digest(
            &kimi,
            &workspace,
            PermissionSemantics::RuntimeManagedV2,
            &BTreeMap::new(),
            "sha256:kimi-run-two-projection",
            &attachment_authorization,
        )
        .unwrap();
        assert_eq!(kimi_next_run_projection, kimi_first);

        let kimi_changed_mcp = runtime_compatibility_digest(
            &kimi,
            &workspace,
            PermissionSemantics::RuntimeManagedV2,
            &changed_servers,
            "sha256:kimi-run-three-projection",
            &attachment_authorization,
        )
        .unwrap();
        assert_ne!(kimi_changed_mcp, kimi_first);

        let mut kimi_changed_config = kimi.clone();
        kimi_changed_config.config_digest = "sha256:kimi-changed-config".to_string();
        let kimi_changed_config = runtime_compatibility_digest(
            &kimi_changed_config,
            &workspace,
            PermissionSemantics::RuntimeManagedV2,
            &BTreeMap::new(),
            "sha256:kimi-run-four-projection",
            &attachment_authorization,
        )
        .unwrap();
        assert_ne!(kimi_changed_config, kimi_first);

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

        let history_key = freeze_native_session_compatibility(frozen.clone(), &workspace)
            .unwrap()
            .native_session_compatibility_key
            .unwrap();
        assert!(history_key.starts_with("trae-cn-cli:history-restore-v1:"));
        let same_history_key = freeze_native_session_compatibility(frozen.clone(), &workspace)
            .unwrap()
            .native_session_compatibility_key
            .unwrap();
        assert_eq!(same_history_key, history_key);

        let other_root = root.join("other-workspace");
        std::fs::create_dir_all(&other_root).unwrap();
        let other_workspace =
            AgentRunWorkspace::runtime_managed_path(other_root.to_string_lossy().to_string());
        let other_workspace_key =
            freeze_native_session_compatibility(frozen.clone(), &other_workspace)
                .unwrap()
                .native_session_compatibility_key
                .unwrap();
        assert_ne!(other_workspace_key, history_key);

        let mut changed_model = frozen.clone();
        changed_model.model.model_id = "another-model".to_string();
        let changed_model_key = freeze_native_session_compatibility(changed_model, &workspace)
            .unwrap()
            .native_session_compatibility_key
            .unwrap();
        assert_ne!(changed_model_key, history_key);

        let mut changed_permissions = frozen.clone();
        changed_permissions.permissions.values = json!({"permission_mode": "plan"});
        let changed_permissions_key =
            freeze_native_session_compatibility(changed_permissions, &workspace)
                .unwrap()
                .native_session_compatibility_key
                .unwrap();
        assert_ne!(changed_permissions_key, history_key);

        let mut changed_executable = frozen;
        changed_executable.executable_fingerprint = "sha256:changed".to_string();
        let changed_executable_key =
            freeze_native_session_compatibility(changed_executable, &workspace)
                .unwrap()
                .native_session_compatibility_key
                .unwrap();
        assert_ne!(changed_executable_key, history_key);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn grok_resume_compatibility_fences_native_binding_inputs() {
        let root = std::env::temp_dir().join(format!(
            "rovai-grok-resume-compatibility-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let executable = root.join("grok");
        make_executable(&executable, "#!/bin/sh\nexit 0\n");
        let workspace = AgentRunWorkspace::runtime_managed_path(root.to_string_lossy().to_string());
        let frozen = frozen_grok_runtime(&executable);
        let baseline = freeze_native_session_compatibility(frozen.clone(), &workspace)
            .unwrap()
            .native_session_compatibility_key
            .unwrap();
        assert!(baseline.starts_with("grok-build:resume-v1:"));
        assert_eq!(
            freeze_native_session_compatibility(frozen.clone(), &workspace)
                .unwrap()
                .native_session_compatibility_key
                .unwrap(),
            baseline
        );

        let mut changed_installation = frozen.clone();
        changed_installation.installation_id = "installation-grok-other".to_string();
        let mut changed_protocol = frozen.clone();
        changed_protocol.protocol_version = "acp-v2".to_string();
        let mut changed_executable = frozen.clone();
        changed_executable.executable_fingerprint = "sha256:grok-other".to_string();
        let mut changed_host = frozen.clone();
        changed_host.host_config_digest = "sha256:host-other".to_string();
        let mut changed_model = frozen.clone();
        changed_model.model.model_id = "grok-4.5".to_string();
        let mut changed_permissions = frozen.clone();
        changed_permissions.permissions.values = json!({"permission_mode": "default"});
        for changed in [
            changed_installation,
            changed_protocol,
            changed_executable,
            changed_host,
            changed_model,
            changed_permissions,
        ] {
            let changed_key = freeze_native_session_compatibility(changed, &workspace)
                .unwrap()
                .native_session_compatibility_key
                .unwrap();
            assert_ne!(changed_key, baseline);
        }

        let other_root = root.join("other-workspace");
        std::fs::create_dir_all(&other_root).unwrap();
        let other_workspace =
            AgentRunWorkspace::runtime_managed_path(other_root.to_string_lossy().to_string());
        assert_ne!(
            freeze_native_session_compatibility(frozen.clone(), &other_workspace)
                .unwrap()
                .native_session_compatibility_key
                .unwrap(),
            baseline
        );
        let mut read_only_workspace = workspace.clone();
        read_only_workspace.access = "read_only".to_string();
        assert_ne!(
            freeze_native_session_compatibility(frozen, &read_only_workspace)
                .unwrap()
                .native_session_compatibility_key
                .unwrap(),
            baseline
        );

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
    fn acp_bypass_modes_auto_allow_protocol_permission_requests() {
        let automatic = [
            (AdapterKind::OpencodeCli, json!({"permission": "allow"})),
            (AdapterKind::CopilotCli, json!({"allow_all": "on"})),
            (AdapterKind::KiroCli, json!({"trust_all_tools": "on"})),
            (
                AdapterKind::QoderCli,
                json!({"permission_mode": "bypass_permissions"}),
            ),
            (
                AdapterKind::CodebuddyCli,
                json!({"permission_mode": "bypassPermissions"}),
            ),
            (AdapterKind::QwenCode, json!({"approval_mode": "yolo"})),
            (
                AdapterKind::TraeCnCli,
                json!({"permission_mode": "bypass_permissions"}),
            ),
            (
                AdapterKind::CursorAgent,
                json!({"execution_mode": "agent", "approval_policy": "force"}),
            ),
            (AdapterKind::KimiCodeCli, json!({"permission_mode": "yolo"})),
            (
                AdapterKind::GrokBuild,
                json!({"permission_mode": "bypassPermissions"}),
            ),
        ];
        for (adapter_kind, permissions) in automatic {
            assert!(
                automatically_allows_permission_requests(adapter_kind, &permissions),
                "{} bypass mode must not create a second Core authorization",
                adapter_kind.as_str()
            );
        }

        let interactive = [
            (AdapterKind::OpencodeCli, json!({"permission": "ask"})),
            (AdapterKind::CopilotCli, json!({"allow_all": "off"})),
            (AdapterKind::KiroCli, json!({"trust_all_tools": "off"})),
            (AdapterKind::QoderCli, json!({"permission_mode": "default"})),
            (
                AdapterKind::CodebuddyCli,
                json!({"permission_mode": "default"}),
            ),
            (AdapterKind::QwenCode, json!({"approval_mode": "default"})),
            (
                AdapterKind::TraeCnCli,
                json!({"permission_mode": "default"}),
            ),
            (
                AdapterKind::CursorAgent,
                json!({"execution_mode": "agent", "approval_policy": "default"}),
            ),
            (
                AdapterKind::KimiCodeCli,
                json!({"permission_mode": "default"}),
            ),
            (
                AdapterKind::GrokBuild,
                json!({"permission_mode": "default"}),
            ),
        ];
        for (adapter_kind, permissions) in interactive {
            assert!(
                !automatically_allows_permission_requests(adapter_kind, &permissions),
                "{} interactive mode must preserve its ACP permission request",
                adapter_kind.as_str()
            );
        }
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
            adapter_kind: AdapterKind::OpencodeCli,
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
            adapter_kind: AdapterKind::OpencodeCli,
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
                "Command": command,
                "Description": "Read the approved fixture",
            })),
            locations: Some(json!([{"path": target}])),
        };
        let context = InterceptedAcpActionContext {
            adapter_kind: AdapterKind::TraeCnCli,
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
    fn completed_action_keeps_only_public_command_and_persists_raw_payload_digests() {
        let completion = completed_action(
            AdapterKind::OpencodeCli,
            &json!({
                "update": {
                    "sessionUpdate": "tool_call_update",
                    "toolCallId": "tool-1",
                    "status": "completed",
                    "kind": "execute",
                    "title": "Run command",
                    "rawInput": {"command": "echo TOP_SECRET_INPUT"},
                    "rawOutput": {
                        "stdout": "TOP_SECRET_OUTPUT",
                        "exitCode": 7
                    }
                }
            }),
        )
        .expect("completion should normalize")
        .expect("terminal tool update should create a result");

        let persisted = serde_json::to_string(&completion.result_data)
            .expect("normalized result should serialize");
        assert!(!persisted.contains("TOP_SECRET_INPUT"));
        assert!(!persisted.contains("TOP_SECRET_OUTPUT"));
        assert!(completion.result_data["rawInputDigest"].is_string());
        assert!(completion.result_data["rawOutputDigest"].is_string());
        assert_eq!(completion.native_kind, "execute");
        assert_eq!(
            completion.public_command.as_deref(),
            Some("echo TOP_SECRET_INPUT")
        );
        assert!(matches!(completion.outcome, ActionResultOutcome::Failed));
        assert_eq!(completion.result_data["status"], "failed");
        assert!(!completion.observation_digest.is_empty());

        let sparse_update = json!({
            "sessionUpdate": "tool_call_update",
            "toolCallId": "tool-sparse",
            "status": "completed",
            "rawOutput": {"stdout": "failed output", "exitCode": 7}
        });
        let sparse = completed_action(
            AdapterKind::TraeCnCli,
            &json!({"update": sparse_update.clone()}),
        )
        .expect("sparse completion should normalize")
        .expect("sparse terminal update should create a result");
        let observed_raw_input = json!({
            "Command": "printf 'SPARSE_TERMINAL_COMMAND\\n'",
            "Description": "SPARSE_PRIVATE_FIELD"
        });
        let observed_raw_input_digest = canonical_json_digest(&observed_raw_input).unwrap();
        let reconciled = reconcile_completed_action(
            AdapterKind::TraeCnCli,
            &sparse_update,
            ObservedToolMetadata {
                native_kind: Some("execute".to_string()),
                observation_digest: Some("observed-digest".to_string()),
                raw_input: Some(observed_raw_input),
                locations: None,
                public_file_changes: None,
            },
            sparse,
        )
        .expect("active Prompt observation should enrich a sparse terminal update");
        assert_eq!(reconciled.native_kind, "execute");
        assert_eq!(
            reconciled.public_command.as_deref(),
            Some("printf 'SPARSE_TERMINAL_COMMAND\\n'")
        );
        assert_eq!(reconciled.result_data["status"], "failed");
        assert_eq!(
            reconciled.result_data["rawInputDigest"],
            observed_raw_input_digest
        );
        assert!(
            !reconciled
                .result_data
                .to_string()
                .contains("SPARSE_PRIVATE_FIELD")
        );
    }

    #[test]
    fn failed_side_effects_do_not_claim_that_nothing_happened() {
        let execute = completed_action(
            AdapterKind::OpencodeCli,
            &json!({
                "update": {
                    "sessionUpdate": "tool_call_update",
                    "toolCallId": "tool-1",
                    "status": "failed",
                    "kind": "execute"
                }
            }),
        )
        .expect("completion should normalize")
        .expect("terminal tool update should create a result");
        let edit = completed_action(
            AdapterKind::OpencodeCli,
            &json!({
                "update": {
                    "sessionUpdate": "tool_call_update",
                    "toolCallId": "tool-2",
                    "status": "failed",
                    "kind": "edit"
                }
            }),
        )
        .expect("completion should normalize")
        .expect("terminal tool update should create a result");

        assert_eq!(execute.effect_disposition, "unknown");
        assert_eq!(edit.effect_disposition, "partial");
    }

    #[test]
    fn successful_terminal_acp_diff_content_is_kept_for_evidence_projection_only() {
        let completion = completed_action(
            AdapterKind::CursorAgent,
            &json!({
                "update": {
                    "sessionUpdate": "tool_call_update",
                    "toolCallId": "tool-edit",
                    "status": "completed",
                    "kind": "edit",
                    "content": [{
                        "type": "diff",
                        "path": "src/app.ts",
                        "oldText": "before\n",
                        "newText": "after\n"
                    }]
                }
            }),
        )
        .unwrap()
        .expect("terminal ACP edit should complete");

        assert_eq!(
            completion.public_file_changes,
            Some(json!([{
                "path": "src/app.ts",
                "oldText": "before\n",
                "newText": "after\n"
            }]))
        );
        assert!(!completion.result_data.to_string().contains("before"));
        assert!(!completion.result_data.to_string().contains("after"));

        let failed = completed_action(
            AdapterKind::CursorAgent,
            &json!({
                "update": {
                    "sessionUpdate": "tool_call_update",
                    "toolCallId": "tool-edit-failed",
                    "status": "failed",
                    "kind": "edit",
                    "content": [{
                        "type": "diff",
                        "path": "src/app.ts",
                        "oldText": "before\n",
                        "newText": "partial\n"
                    }]
                }
            }),
        )
        .unwrap()
        .expect("failed ACP edit should still complete its audit action");
        assert!(failed.public_file_changes.is_none());
    }
}
