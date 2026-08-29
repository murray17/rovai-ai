use std::{
    collections::{HashMap, HashSet},
    error::Error as StdError,
    ffi::OsString,
    fmt,
    fs::{File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Arc,
};

use crate::builtin_tool_runtime::BuiltinToolProcessConfig;
use anyhow::{Context, Result};
use rovai_core::{
    agent_profile::FrozenAgentRuntimeConfig,
    agent_runtime_adapter::ANTIGRAVITY_RUNTIME_DEFAULT_MODEL_ID,
    managed_process::{
        ManagedProcess, ManagedProcessLaunchSpec, ManagedProcessPurpose, ManagedStdinPolicy,
        ManagedWindowsArgvDialect,
    },
    runtime::{AgentRunWorkspace, PermissionSemantics},
    runtime_discovery::{configure_active_runtime_command, is_runtime_entrypoint_file},
    runtime_failure::{
        RuntimeFailureError, RuntimeFailureOrigin, RuntimeFailurePhase, RuntimeFailureView,
        public_runtime_failure_from_output,
    },
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
    sync::{Mutex, mpsc, oneshot},
    time::{Duration, Instant, MissedTickBehavior},
};

const MAX_CAPTURE_BYTES: usize = 2 * 1024 * 1024;
const MAX_LOG_INSPECTION_BYTES: u64 = 2 * 1024 * 1024;

pub struct AntigravityRunRequest {
    pub agent_run_id: String,
    pub execution_epoch: i64,
    pub workspace: AgentRunWorkspace,
    pub permission_semantics: PermissionSemantics,
    pub runtime: FrozenAgentRuntimeConfig,
    pub prompt: String,
    pub resumable_native_session_id: Option<String>,
    pub attachment_access_root: Option<PathBuf>,
    pub builtin_tools: Option<BuiltinToolProcessConfig>,
    pub input_accepted: Option<mpsc::UnboundedSender<AntigravityInputAccepted>>,
    pub runtime_events: Option<mpsc::UnboundedSender<AntigravityRuntimeEvent>>,
    pub launch_handoff: Option<oneshot::Sender<()>>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AntigravityInputAccepted {
    pub native_session_id: String,
    pub native_turn_id: String,
}

#[derive(Debug, Clone)]
pub struct AntigravityRuntimeEvent {
    pub event_type: &'static str,
    pub payload: Value,
}

#[derive(Debug, Clone)]
pub struct AntigravityRunResult {
    pub native_session_id: String,
    pub native_turn_id: String,
    pub final_output: String,
}

#[derive(Debug, Clone)]
pub struct AntigravityDeliveredFailure {
    pub native_session_id: String,
    pub native_turn_id: String,
    pub error_code: String,
    pub failure: RuntimeFailureView,
}

impl fmt::Display for AntigravityDeliveredFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "Antigravity accepted the input but ended with {}",
            self.error_code
        )
    }
}

impl StdError for AntigravityDeliveredFailure {}

#[derive(Debug)]
struct AntigravityProcessControl {
    interrupt: Mutex<Option<oneshot::Sender<()>>>,
}

pub struct AntigravityAppRuntimeAdapter {
    active: Mutex<HashMap<(String, i64), Arc<AntigravityProcessControl>>>,
    log_dir: PathBuf,
}

impl AntigravityAppRuntimeAdapter {
    pub fn new(data_dir: &Path) -> Result<Self> {
        let legacy_log_dir = data_dir.join("runtime-private").join("agy");
        if legacy_log_dir.exists() {
            std::fs::remove_dir_all(&legacy_log_dir).with_context(|| {
                format!(
                    "failed to remove legacy Antigravity companion logs {}",
                    legacy_log_dir.display()
                )
            })?;
        }
        let log_dir = data_dir.join("runtime-private").join("antigravity");
        std::fs::create_dir_all(&log_dir).with_context(|| {
            format!(
                "failed to create private Antigravity companion directory {}",
                log_dir.display()
            )
        })?;
        restrict_directory_permissions(&log_dir)?;
        // A hard crash can leave a sensitive upstream log behind. It is never
        // a recovery source, so remove leftovers before accepting new work.
        for entry in std::fs::read_dir(&log_dir)? {
            let entry = entry?;
            if entry.file_type()?.is_file() {
                let _ = std::fs::remove_file(entry.path());
            }
        }
        Ok(Self {
            active: Mutex::new(HashMap::new()),
            log_dir,
        })
    }

    pub async fn run(&self, mut request: AntigravityRunRequest) -> Result<AntigravityRunResult> {
        let key = (request.agent_run_id.clone(), request.execution_epoch);
        let (interrupt, interrupted) = oneshot::channel();
        let control = Arc::new(AntigravityProcessControl {
            interrupt: Mutex::new(Some(interrupt)),
        });
        {
            let mut active = self.active.lock().await;
            if active.contains_key(&key) {
                anyhow::bail!(
                    "Antigravity companion process already exists for this AgentRun epoch"
                );
            }
            active.insert(key.clone(), control);
        }
        let launch_handoff = request.launch_handoff.take();
        let result = self
            .run_process(&request, interrupted, launch_handoff)
            .await;
        self.active.lock().await.remove(&key);
        result
    }

    pub async fn interrupt(&self, agent_run_id: &str, execution_epoch: i64) -> bool {
        let control = self
            .active
            .lock()
            .await
            .get(&(agent_run_id.to_string(), execution_epoch))
            .cloned();
        let Some(control) = control else {
            return false;
        };
        control
            .interrupt
            .lock()
            .await
            .take()
            .is_some_and(|sender| sender.send(()).is_ok())
    }

    pub async fn wait_for_agent_run_quiescence(
        &self,
        agent_run_id: &str,
        execution_epoch: i64,
        timeout: Duration,
    ) -> bool {
        let key = (agent_run_id.to_string(), execution_epoch);
        let deadline = Instant::now() + timeout;
        loop {
            if !self.active.lock().await.contains_key(&key) {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    pub async fn shutdown_all(&self) {
        let controls = self
            .active
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for control in controls {
            if let Some(sender) = control.interrupt.lock().await.take() {
                let _ = sender.send(());
            }
        }
        let deadline = Instant::now() + Duration::from_secs(3);
        while !self.active.lock().await.is_empty() && Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        self.active.lock().await.clear();
    }

    async fn run_process(
        &self,
        request: &AntigravityRunRequest,
        interrupted: oneshot::Receiver<()>,
        launch_handoff: Option<oneshot::Sender<()>>,
    ) -> Result<AntigravityRunResult> {
        let requested_execution_root = Path::new(&request.workspace.execution_root);
        if !requested_execution_root.is_dir() {
            let internal = anyhow::anyhow!(
                "Antigravity companion execution directory no longer exists: {}",
                requested_execution_root.display()
            );
            let failure = antigravity_public_failure(
                request,
                &self.log_dir,
                RuntimeFailureOrigin::Environment,
                RuntimeFailurePhase::Spawn,
                "runtime_execution_directory_unavailable",
                "Antigravity 的执行目录不可用",
                Some(&internal.to_string()),
                false,
            );
            return Err(internal.context(RuntimeFailureError::new(failure)));
        }
        if let Some(root) = request.attachment_access_root.as_deref()
            && !root.is_dir()
        {
            let internal = anyhow::anyhow!(
                "Antigravity Camp Attachment access root is unavailable: {}",
                root.display()
            );
            let failure = antigravity_public_failure(
                request,
                &self.log_dir,
                RuntimeFailureOrigin::Environment,
                RuntimeFailurePhase::Spawn,
                "runtime_attachment_root_unavailable",
                "Antigravity 的附件目录不可用",
                Some(&internal.to_string()),
                false,
            );
            return Err(internal.context(RuntimeFailureError::new(failure)));
        }
        let workspace_roots = canonical_antigravity_workspace_roots(
            requested_execution_root,
            request.attachment_access_root.as_deref(),
            request
                .builtin_tools
                .as_ref()
                .map(BuiltinToolProcessConfig::run_tmp),
        )
        .map_err(|error| {
            let failure = antigravity_public_failure(
                request,
                &self.log_dir,
                RuntimeFailureOrigin::Environment,
                RuntimeFailurePhase::Spawn,
                "runtime_execution_directory_unavailable",
                "Antigravity 的本机目录不可访问",
                Some(&error.to_string()),
                false,
            );
            error.context(RuntimeFailureError::new(failure))
        })?;
        let execution_root = workspace_roots
            .first()
            .context("Antigravity companion has no execution root")?;
        let executable = Path::new(&request.runtime.executable_path);
        if !is_runtime_entrypoint_file(executable) {
            let internal = anyhow::anyhow!(
                "Antigravity companion executable is missing or not executable: {}",
                executable.display()
            );
            let failure = antigravity_public_failure(
                request,
                &self.log_dir,
                RuntimeFailureOrigin::Environment,
                RuntimeFailurePhase::Spawn,
                "runtime_executable_unavailable",
                "Antigravity 可执行文件不可用",
                Some(&internal.to_string()),
                false,
            );
            return Err(internal.context(RuntimeFailureError::new(failure)));
        }
        let log_path = self.log_dir.join(format!(
            "{}-{}-{}.log",
            request.agent_run_id,
            request.execution_epoch,
            uuid::Uuid::new_v4()
        ));
        create_private_file(&log_path).map_err(|error| {
            let failure = antigravity_public_failure(
                request,
                &self.log_dir,
                RuntimeFailureOrigin::Environment,
                RuntimeFailurePhase::Spawn,
                "runtime_private_directory_unavailable",
                "Antigravity 的本机运行目录不可用",
                Some(&error.to_string()),
                false,
            );
            error.context(RuntimeFailureError::new(failure))
        })?;
        let _log_guard = SensitiveLogGuard(log_path.clone());

        let permission_values = request
            .runtime
            .permissions
            .values
            .as_object()
            .context("Antigravity companion permission configuration must be an object")?;
        let configured_mode = required_enum(permission_values, "mode", &["accept-edits", "plan"])?;
        let configured_sandbox = required_enum(permission_values, "sandbox", &["on", "off"])?;
        let configured_skip_permissions = required_enum(
            permission_values,
            "dangerously_skip_permissions",
            &["on", "off"],
        )?;
        let legacy_read_only = request.permission_semantics == PermissionSemantics::CoreEnforcedV1
            && request.workspace.access == "read_only";
        let (mode, sandbox, skip_permissions) = if legacy_read_only {
            ("plan", "on", "off")
        } else {
            (
                configured_mode,
                configured_sandbox,
                configured_skip_permissions,
            )
        };

        let mut runtime_args = vec![
            OsString::from("--print"),
            OsString::from(&request.prompt),
            OsString::from("--print-timeout"),
            OsString::from("5m"),
            OsString::from("--mode"),
            OsString::from(mode),
            OsString::from("--log-file"),
            log_path.as_os_str().to_os_string(),
        ];
        let structured_output = request
            .runtime
            .capabilities
            .iter()
            .any(|capability| capability == "output.stream_json");
        if structured_output {
            runtime_args.push(OsString::from("--output-format"));
            runtime_args.push(OsString::from("stream-json"));
        }
        // Antigravity 1.1.9 uses explicit --add-dir values as the model-visible
        // workspace list. Include the execution root as well as the attachment
        // projection, and canonicalize both so macOS sandbox rules do not mix
        // /var paths with their /private/var kernel identity.
        for root in &workspace_roots {
            runtime_args.push(OsString::from("--add-dir"));
            runtime_args.push(root.as_os_str().to_os_string());
        }
        if sandbox == "on" {
            runtime_args.push(OsString::from("--sandbox"));
        }
        if skip_permissions == "on" {
            runtime_args.push(OsString::from("--dangerously-skip-permissions"));
        }
        if request.runtime.model.source == "explicit"
            && request.runtime.model.model_id != ANTIGRAVITY_RUNTIME_DEFAULT_MODEL_ID
        {
            runtime_args.push(OsString::from("--model"));
            runtime_args.push(OsString::from(&request.runtime.model.model_id));
        }
        if let Some(session_id) = request.resumable_native_session_id.as_deref() {
            validate_session_id(session_id)?;
            runtime_args.push(OsString::from("--conversation"));
            runtime_args.push(OsString::from(session_id));
        }
        let mut command = Command::new(executable);
        command.args(&runtime_args);
        configure_active_runtime_command(&mut command);
        if let Some(config) = &request.builtin_tools {
            config.configure_command(&mut command)?;
        }
        // The native sandbox must not need access to the user's global Git
        // configuration merely to inspect the isolated execution workspace.
        #[cfg(unix)]
        command.env("GIT_CONFIG_GLOBAL", "/dev/null");
        #[cfg(windows)]
        command.env("GIT_CONFIG_GLOBAL", "NUL");
        command.current_dir(execution_root);
        let launch_result: Result<ManagedProcess> = (|| {
            let spec = ManagedProcessLaunchSpec::capture(
                &command,
                ManagedProcessPurpose::RuntimeOneShot,
                ManagedStdinPolicy::Null,
                ManagedWindowsArgvDialect::MicrosoftCrt,
                format!("agent-run:{}:antigravity-app", request.agent_run_id),
            )?;
            ManagedProcess::spawn(spec)
        })();
        let mut child = launch_result.map_err(|error| {
            let raw_detail = error.to_string();
            let failure = antigravity_public_failure(
                request,
                &self.log_dir,
                RuntimeFailureOrigin::Environment,
                RuntimeFailurePhase::Spawn,
                "runtime_spawn_failed",
                "Antigravity 进程无法启动",
                Some(&raw_detail),
                true,
            );
            error
                .context(format!(
                    "failed to start {} in print mode",
                    executable.display()
                ))
                .context(RuntimeFailureError::new(failure))
        })?;
        if let Some(handoff) = launch_handoff {
            let _ = handoff.send(());
        }
        let stdout = child
            .take_stdout()
            .context("Antigravity companion stdout was unavailable")?;
        let stderr = child
            .take_stderr()
            .context("Antigravity companion stderr was unavailable")?;
        let stdout_task = if structured_output {
            let resumable_native_session_id = request.resumable_native_session_id.clone();
            let runtime_events = request.runtime_events.clone();
            tokio::spawn(async move {
                capture_antigravity_stream(
                    stdout,
                    resumable_native_session_id.as_deref(),
                    runtime_events.as_ref(),
                )
                .await
                .map(|capture| AntigravityStdoutCapture::Structured(Box::new(capture)))
            })
        } else {
            tokio::spawn(async move {
                capture_bounded(stdout)
                    .await
                    .map(AntigravityStdoutCapture::Legacy)
            })
        };
        let stderr_task = tokio::spawn(capture_bounded(stderr));
        tokio::pin!(interrupted);
        let mut was_interrupted = false;
        let mut acceptance_emitted = false;
        let mut acceptance_poll = tokio::time::interval(Duration::from_millis(50));
        acceptance_poll.set_missed_tick_behavior(MissedTickBehavior::Delay);
        let status = loop {
            tokio::select! {
                status = child.wait() => {
                    break status.context("failed to wait for Antigravity companion process")?;
                }
                _ = &mut interrupted => {
                    was_interrupted = true;
                    let _ = child.force_terminate_tree();
                    break child.wait().await.context("failed to reap interrupted Antigravity companion process")?;
                }
                _ = acceptance_poll.tick(), if !acceptance_emitted && request.input_accepted.is_some() => {
                    acceptance_emitted = emit_input_accepted_if_observed(request, &log_path);
                }
            }
        };
        let _ = child.force_terminate_tree();
        if !acceptance_emitted {
            // A short-lived process can exit between polling ticks. Inspect the
            // now-closed log once more before classifying any terminal result.
            acceptance_emitted = emit_input_accepted_if_observed(request, &log_path);
        }
        let native_turn_id = format!("agy:{}:{}", request.agent_run_id, request.execution_epoch);
        let stdout = match stdout_task
            .await
            .context("Antigravity companion stdout collector failed")?
        {
            Ok(stdout) => stdout,
            Err(error) => {
                let observed_native_session_id = read_native_session_id(&log_path).ok().flatten();
                let failure = antigravity_public_failure(
                    request,
                    &self.log_dir,
                    RuntimeFailureOrigin::Compatibility,
                    RuntimeFailurePhase::Execution,
                    "runtime_stream_incompatible",
                    "Antigravity 返回了当前版本无法识别的输出",
                    Some(&error.to_string()),
                    false,
                );
                return Err(antigravity_failure_error(
                    error,
                    failure,
                    observed_native_session_id.as_deref(),
                    &native_turn_id,
                    acceptance_emitted,
                ));
            }
        };
        let stderr = stderr_task
            .await
            .context("Antigravity companion stderr collector failed")??;
        if was_interrupted {
            anyhow::bail!("Antigravity companion process was interrupted");
        }
        if !status.success() {
            let stderr_detail = String::from_utf8_lossy(&stderr.bytes).trim().to_string();
            let raw_detail = if stderr_detail.is_empty() {
                read_known_antigravity_error_lines(&log_path).unwrap_or_default()
            } else {
                stderr_detail
            };
            let compatibility = unsupported_antigravity_command(&raw_detail);
            let failure = antigravity_public_failure(
                request,
                &self.log_dir,
                if compatibility {
                    RuntimeFailureOrigin::Compatibility
                } else {
                    RuntimeFailureOrigin::Runtime
                },
                RuntimeFailurePhase::Execution,
                if compatibility {
                    "runtime_cli_incompatible"
                } else {
                    "runtime_process_failed"
                },
                if compatibility {
                    "当前 Antigravity 版本不支持 Rovai 所需的命令"
                } else {
                    "Antigravity 进程执行失败"
                },
                (!raw_detail.is_empty()).then_some(raw_detail.as_str()),
                !compatibility,
            );
            let internal = anyhow::anyhow!(
                "Antigravity companion process exited with {} (stderrBytes={}, stderrDigest={})",
                status,
                stderr.total_bytes,
                stderr.digest
            );
            let observed_native_session_id = read_native_session_id(&log_path).ok().flatten();
            return Err(antigravity_failure_error(
                internal,
                failure,
                observed_native_session_id.as_deref(),
                &native_turn_id,
                acceptance_emitted,
            ));
        }
        let native_session_id = match read_native_session_id(&log_path)? {
            Some(native_session_id) => native_session_id,
            None => {
                let stream_session_id = match &stdout {
                    AntigravityStdoutCapture::Structured(capture) => {
                        capture.conversation_id.as_deref()
                    }
                    AntigravityStdoutCapture::Legacy(_) => None,
                };
                let fallback_session_id = request
                    .resumable_native_session_id
                    .as_deref()
                    .or(stream_session_id);
                let internal = anyhow::anyhow!(
                    "Antigravity companion completed without a verifiable conversation identifier"
                );
                let failure = antigravity_public_failure(
                    request,
                    &self.log_dir,
                    RuntimeFailureOrigin::Compatibility,
                    RuntimeFailurePhase::Terminal,
                    "runtime_session_incompatible",
                    "Antigravity 最终结果缺少会话标识",
                    Some(&internal.to_string()),
                    false,
                );
                return Err(antigravity_failure_error(
                    internal,
                    failure,
                    fallback_session_id,
                    &native_turn_id,
                    fallback_session_id.is_some(),
                ));
            }
        };
        if let Some(expected) = request.resumable_native_session_id.as_deref()
            && native_session_id != expected
        {
            let internal = anyhow::anyhow!(
                "Antigravity companion resumed a different conversation than requested (expected {expected}, observed {native_session_id})"
            );
            let failure = antigravity_public_failure(
                request,
                &self.log_dir,
                RuntimeFailureOrigin::Compatibility,
                RuntimeFailurePhase::Terminal,
                "runtime_session_incompatible",
                "Antigravity 返回了另一个会话的结果",
                Some(&internal.to_string()),
                false,
            );
            return Err(antigravity_failure_error(
                internal,
                failure,
                Some(expected),
                &native_turn_id,
                true,
            ));
        }
        let final_output = match stdout {
            AntigravityStdoutCapture::Structured(capture) => {
                let capture = *capture;
                let result = match capture.final_result {
                    Some(result) => result,
                    None => {
                        let internal = anyhow::anyhow!(
                            "Antigravity stream-json output omitted its final result event"
                        );
                        let failure = antigravity_public_failure(
                            request,
                            &self.log_dir,
                            RuntimeFailureOrigin::Compatibility,
                            RuntimeFailurePhase::Terminal,
                            "runtime_missing_final_result",
                            "Antigravity 未返回当前集成所需的最终结果",
                            Some(&internal.to_string()),
                            false,
                        );
                        return Err(antigravity_failure_error(
                            internal,
                            failure,
                            Some(&native_session_id),
                            &native_turn_id,
                            true,
                        ));
                    }
                };
                if result.conversation_id != native_session_id {
                    let internal = anyhow::anyhow!(
                        "Antigravity stream targeted another conversation (expected {native_session_id}, observed {})",
                        result.conversation_id
                    );
                    let failure = antigravity_public_failure(
                        request,
                        &self.log_dir,
                        RuntimeFailureOrigin::Compatibility,
                        RuntimeFailurePhase::Terminal,
                        "runtime_session_incompatible",
                        "Antigravity 返回了另一个会话的结果",
                        Some(&internal.to_string()),
                        false,
                    );
                    return Err(antigravity_failure_error(
                        internal,
                        failure,
                        Some(&native_session_id),
                        &native_turn_id,
                        true,
                    ));
                }
                if !result.status.eq_ignore_ascii_case("success") {
                    let raw_detail = result
                        .error
                        .as_deref()
                        .or(result.message.as_deref())
                        .or(result.response.as_deref());
                    let failure = antigravity_public_failure(
                        request,
                        &self.log_dir,
                        RuntimeFailureOrigin::Runtime,
                        RuntimeFailurePhase::Terminal,
                        "runtime_terminal_failure",
                        "Antigravity 返回了失败结果",
                        raw_detail,
                        true,
                    );
                    let internal = anyhow::anyhow!(
                        "Antigravity structured final result ended as {}: {}",
                        result.status,
                        raw_detail.unwrap_or("no Runtime error detail")
                    );
                    return Err(antigravity_failure_error(
                        internal,
                        failure,
                        Some(&native_session_id),
                        &native_turn_id,
                        true,
                    ));
                }
                match result.response {
                    Some(response) => response.trim().to_string(),
                    None => {
                        let internal = anyhow::anyhow!(
                            "Antigravity success result omitted its response field"
                        );
                        let failure = antigravity_public_failure(
                            request,
                            &self.log_dir,
                            RuntimeFailureOrigin::Compatibility,
                            RuntimeFailurePhase::Terminal,
                            "runtime_missing_final_output",
                            "Antigravity 最终结果缺少必要内容",
                            Some(&internal.to_string()),
                            false,
                        );
                        return Err(antigravity_failure_error(
                            internal,
                            failure,
                            Some(&native_session_id),
                            &native_turn_id,
                            true,
                        ));
                    }
                }
            }
            AntigravityStdoutCapture::Legacy(stdout) if stdout.truncated => {
                let internal =
                    anyhow::anyhow!("Antigravity final output exceeded the safety limit");
                let failure = antigravity_public_failure(
                    request,
                    &self.log_dir,
                    RuntimeFailureOrigin::Compatibility,
                    RuntimeFailurePhase::Terminal,
                    "runtime_output_too_large",
                    "Antigravity 返回的最终结果超出当前集成限制",
                    Some(&internal.to_string()),
                    false,
                );
                return Err(antigravity_failure_error(
                    internal,
                    failure,
                    Some(&native_session_id),
                    &native_turn_id,
                    true,
                ));
            }
            AntigravityStdoutCapture::Legacy(stdout) => match String::from_utf8(stdout.bytes) {
                Ok(output) => output.trim().to_string(),
                Err(_) => {
                    let internal = anyhow::anyhow!("Antigravity final output was not valid UTF-8");
                    let failure = antigravity_public_failure(
                        request,
                        &self.log_dir,
                        RuntimeFailureOrigin::Compatibility,
                        RuntimeFailurePhase::Terminal,
                        "runtime_invalid_final_output",
                        "Antigravity 返回的最终结果格式不受支持",
                        Some(&internal.to_string()),
                        false,
                    );
                    return Err(antigravity_failure_error(
                        internal,
                        failure,
                        Some(&native_session_id),
                        &native_turn_id,
                        true,
                    ));
                }
            },
        };
        if final_output.is_empty() {
            let internal = anyhow::anyhow!("Antigravity final output was empty");
            let failure = antigravity_public_failure(
                request,
                &self.log_dir,
                RuntimeFailureOrigin::Compatibility,
                RuntimeFailurePhase::Terminal,
                "runtime_missing_final_output",
                "Antigravity 最终结果缺少必要内容",
                Some(&internal.to_string()),
                false,
            );
            return Err(antigravity_failure_error(
                internal,
                failure,
                Some(&native_session_id),
                &native_turn_id,
                true,
            ));
        }
        Ok(AntigravityRunResult {
            native_session_id,
            native_turn_id,
            final_output,
        })
    }
}

#[expect(
    clippy::too_many_arguments,
    reason = "the Runtime request and closed public failure fields stay explicit at this boundary"
)]
fn antigravity_public_failure(
    request: &AntigravityRunRequest,
    log_dir: &Path,
    origin: RuntimeFailureOrigin,
    phase: RuntimeFailurePhase,
    code: &str,
    summary: &str,
    raw_detail: Option<&str>,
    retryable: bool,
) -> RuntimeFailureView {
    let mut sensitive_paths = vec![
        (Path::new(&request.workspace.execution_root), "<project>"),
        (log_dir, "<runtime-private>"),
        (
            Path::new(&request.runtime.executable_path),
            "<runtime-executable>",
        ),
    ];
    if let Some(root) = request.attachment_access_root.as_deref() {
        sensitive_paths.push((root, "<attachment-root>"));
    }
    if let Some(config) = request.builtin_tools.as_ref() {
        sensitive_paths.push((config.run_tmp(), "<run-tmp>"));
    }
    public_runtime_failure_from_output(
        rovai_core::agent_profile::AdapterKind::AntigravityApp,
        origin,
        phase,
        code,
        summary,
        raw_detail,
        &sensitive_paths,
        retryable,
    )
}

fn antigravity_failure_error(
    internal: anyhow::Error,
    failure: RuntimeFailureView,
    native_session_id: Option<&str>,
    native_turn_id: &str,
    delivered: bool,
) -> anyhow::Error {
    if delivered && let Some(native_session_id) = native_session_id {
        let error_code = failure.code.clone();
        internal.context(AntigravityDeliveredFailure {
            native_session_id: native_session_id.to_string(),
            native_turn_id: native_turn_id.to_string(),
            error_code,
            failure,
        })
    } else {
        internal.context(RuntimeFailureError::new(failure))
    }
}

fn canonical_antigravity_workspace_roots(
    execution_root: &Path,
    attachment_access_root: Option<&Path>,
    run_tmp: Option<&Path>,
) -> Result<Vec<PathBuf>> {
    if !execution_root.is_dir() {
        anyhow::bail!(
            "Antigravity companion execution directory no longer exists: {}",
            execution_root.display()
        );
    }
    let execution_root = execution_root.canonicalize().with_context(|| {
        format!(
            "failed to canonicalize Antigravity execution root {}",
            execution_root.display()
        )
    })?;
    let execution_root = antigravity_runtime_visible_path(execution_root);
    let mut roots = vec![execution_root];
    if let Some(attachment_access_root) = attachment_access_root {
        if !attachment_access_root.is_dir() {
            anyhow::bail!(
                "Antigravity Camp Attachment access root is unavailable: {}",
                attachment_access_root.display()
            );
        }
        let attachment_access_root = attachment_access_root.canonicalize().with_context(|| {
            format!(
                "failed to canonicalize Antigravity Camp Attachment access root {}",
                attachment_access_root.display()
            )
        })?;
        let attachment_access_root = antigravity_runtime_visible_path(attachment_access_root);
        if !roots.contains(&attachment_access_root) {
            roots.push(attachment_access_root);
        }
    }
    if let Some(run_tmp) = run_tmp {
        if !run_tmp.is_dir() {
            anyhow::bail!(
                "Antigravity Built-in Tool Run tmp is unavailable: {}",
                run_tmp.display()
            );
        }
        let run_tmp = run_tmp.canonicalize().with_context(|| {
            format!(
                "failed to canonicalize Antigravity Built-in Tool Run tmp {}",
                run_tmp.display()
            )
        })?;
        let run_tmp = antigravity_runtime_visible_path(run_tmp);
        if !roots.contains(&run_tmp) {
            roots.push(run_tmp);
        }
    }
    Ok(roots)
}

fn antigravity_runtime_visible_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let value = path.to_string_lossy();
        if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{rest}"));
        }
        if let Some(rest) = value.strip_prefix(r"\\?\") {
            return PathBuf::from(rest);
        }
    }
    path
}

#[derive(Debug)]
enum AntigravityStdoutCapture {
    Structured(Box<AntigravityStreamCapture>),
    Legacy(CapturedBytes),
}

#[derive(Debug, Default)]
struct AntigravityStreamCapture {
    conversation_id: Option<String>,
    final_result: Option<AntigravityJsonResult>,
    model_observation_emitted: bool,
    started_tools: HashSet<String>,
    terminal_tools: HashSet<String>,
    started_shell_commands: HashMap<String, String>,
}

#[derive(Debug)]
struct AntigravityJsonResult {
    conversation_id: String,
    status: String,
    response: Option<String>,
    error: Option<String>,
    message: Option<String>,
}

async fn capture_antigravity_stream<R>(
    mut reader: R,
    expected_session_id: Option<&str>,
    runtime_events: Option<&mpsc::UnboundedSender<AntigravityRuntimeEvent>>,
) -> Result<AntigravityStreamCapture>
where
    R: AsyncRead + Unpin,
{
    let mut line = Vec::new();
    let mut buffer = [0_u8; 16 * 1024];
    let mut capture = AntigravityStreamCapture::default();
    loop {
        let read = reader.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        for byte in &buffer[..read] {
            if *byte == b'\n' {
                if !line.is_empty() {
                    process_antigravity_stream_line(
                        &line,
                        expected_session_id,
                        runtime_events,
                        &mut capture,
                    )?;
                    line.clear();
                }
                continue;
            }
            if line.len() >= MAX_CAPTURE_BYTES {
                anyhow::bail!(
                    "Antigravity stream event exceeded the {} byte safety limit",
                    MAX_CAPTURE_BYTES
                );
            }
            line.push(*byte);
        }
    }
    if !line.is_empty() {
        process_antigravity_stream_line(&line, expected_session_id, runtime_events, &mut capture)?;
    }
    Ok(capture)
}

fn process_antigravity_stream_line(
    line: &[u8],
    expected_session_id: Option<&str>,
    runtime_events: Option<&mpsc::UnboundedSender<AntigravityRuntimeEvent>>,
    capture: &mut AntigravityStreamCapture,
) -> Result<()> {
    let event: Value =
        serde_json::from_slice(line).context("Antigravity emitted invalid stream JSON")?;
    match event.get("event").and_then(Value::as_str) {
        Some("init") => {
            let conversation_id = antigravity_event_conversation_id(&event, "init")?;
            observe_antigravity_conversation(capture, expected_session_id, conversation_id)?;
            if !capture.model_observation_emitted
                && let Some(model_id) = antigravity_init_model_id(&event)
            {
                capture.model_observation_emitted = true;
                if let Some(sender) = runtime_events {
                    let _ = sender.send(AntigravityRuntimeEvent {
                        event_type: "runtime.model.observed",
                        payload: serde_json::json!({"modelId": model_id}),
                    });
                }
            }
        }
        Some("step_update") => {
            let step = event
                .get("step_update")
                .context("Antigravity step_update event omitted its payload")?;
            let conversation_id = step
                .get("conversation_id")
                .and_then(Value::as_str)
                .context("Antigravity step_update omitted conversation_id")?;
            observe_antigravity_conversation(capture, expected_session_id, conversation_id)?;
            if let Some(runtime_event) = normalize_antigravity_tool_step(step, capture)?
                && let Some(sender) = runtime_events
            {
                let _ = sender.send(runtime_event);
            }
        }
        Some("result") => {
            if capture.final_result.is_some() {
                anyhow::bail!("Antigravity stream emitted more than one final result event");
            }
            let result = event
                .get("result")
                .context("Antigravity result event omitted its payload")?;
            let conversation_id = result
                .get("conversation_id")
                .and_then(Value::as_str)
                .context("Antigravity result omitted conversation_id")?;
            observe_antigravity_conversation(capture, expected_session_id, conversation_id)?;
            let status = result
                .get("status")
                .and_then(Value::as_str)
                .context("Antigravity result omitted status")?
                .to_string();
            let response = result
                .get("response")
                .and_then(Value::as_str)
                .map(str::to_string);
            let error = result
                .get("error")
                .and_then(Value::as_str)
                .map(str::to_string);
            let message = result
                .get("message")
                .and_then(Value::as_str)
                .map(str::to_string);
            if status.eq_ignore_ascii_case("success") && response.is_none() {
                anyhow::bail!("Antigravity success result omitted response");
            }
            if !status.eq_ignore_ascii_case("success")
                && error.is_none()
                && message.is_none()
                && response.is_none()
            {
                anyhow::bail!("Antigravity failed result omitted error, message and response");
            }
            capture.final_result = Some(AntigravityJsonResult {
                conversation_id: conversation_id.to_string(),
                status,
                response,
                error,
                message,
            });
        }
        Some(_) => {}
        None => anyhow::bail!("Antigravity stream event omitted its event type"),
    }
    Ok(())
}

fn antigravity_init_model_id(event: &Value) -> Option<String> {
    [
        event.get("model"),
        event.pointer("/init/model"),
        event.pointer("/init/model_id"),
        event.pointer("/init/modelId"),
    ]
    .into_iter()
    .flatten()
    .find_map(|value| {
        value
            .as_str()
            .or_else(|| value.get("id").and_then(Value::as_str))
            .map(str::trim)
            .filter(|model_id| !model_id.is_empty())
            .map(str::to_string)
    })
}

fn antigravity_event_conversation_id<'a>(event: &'a Value, event_name: &str) -> Result<&'a str> {
    event
        .get("conversation_id")
        .and_then(Value::as_str)
        .with_context(|| format!("Antigravity {event_name} event omitted conversation_id"))
}

fn observe_antigravity_conversation(
    capture: &mut AntigravityStreamCapture,
    expected_session_id: Option<&str>,
    conversation_id: &str,
) -> Result<()> {
    validate_session_id(conversation_id)?;
    if let Some(expected) = expected_session_id
        && conversation_id != expected
    {
        anyhow::bail!(
            "Antigravity stream targeted another conversation (expected {expected}, observed {conversation_id})"
        );
    }
    if let Some(observed) = capture.conversation_id.as_deref()
        && observed != conversation_id
    {
        anyhow::bail!(
            "Antigravity stream changed conversations (expected {observed}, observed {conversation_id})"
        );
    }
    capture.conversation_id = Some(conversation_id.to_string());
    Ok(())
}

fn normalize_antigravity_tool_step(
    step: &Value,
    capture: &mut AntigravityStreamCapture,
) -> Result<Option<AntigravityRuntimeEvent>> {
    if step.get("step_type").and_then(Value::as_str) != Some("tool") {
        return Ok(None);
    }
    let conversation_id = step
        .get("conversation_id")
        .and_then(Value::as_str)
        .context("Antigravity tool step omitted conversation_id")?;
    let step_index = step
        .get("step_index")
        .and_then(Value::as_u64)
        .context("Antigravity tool step omitted step_index")?;
    let tool_info = step.get("tool_info").unwrap_or(&Value::Null);
    let tool_name = step
        .get("tool_name")
        .or_else(|| tool_info.get("name"))
        .and_then(Value::as_str)
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("tool");
    let tool_call_id = format!("agy:{conversation_id}:step:{step_index}");
    let state = step
        .get("state")
        .and_then(Value::as_str)
        .unwrap_or("IN_PROGRESS")
        .to_ascii_uppercase();
    let status = match state.as_str() {
        "DONE" | "SUCCESS" | "SUCCEEDED" => "completed",
        "FAILED" | "ERROR" | "CANCELLED" | "CANCELED" => "failed",
        _ => "in_progress",
    };
    let shell_tool = antigravity_command_tool(tool_name);
    let observed_command = shell_tool
        .then(|| public_antigravity_shell_command(tool_info))
        .flatten();
    if status == "in_progress"
        && let Some(command) = observed_command.as_ref()
    {
        capture
            .started_shell_commands
            .insert(tool_call_id.clone(), command.clone());
    }
    let newly_observed = if status == "in_progress" {
        capture.started_tools.insert(tool_call_id.clone())
    } else {
        capture.terminal_tools.insert(tool_call_id.clone())
    };
    if !newly_observed {
        return Ok(None);
    }
    let output = shell_tool
        .then(|| public_antigravity_command_output(tool_info))
        .flatten();
    let command = if !shell_tool {
        None
    } else if status == "in_progress" {
        observed_command
    } else {
        let cached_command = capture.started_shell_commands.remove(&tool_call_id);
        observed_command.or(cached_command)
    };
    let input = command.map(|command| serde_json::json!({"command": command}));
    Ok(Some(AntigravityRuntimeEvent {
        event_type: "runtime.action",
        payload: serde_json::json!({
            "toolCallId": tool_call_id,
            "toolName": tool_name,
            "status": status,
            "kind": antigravity_tool_kind(tool_name),
            "input": input,
            "output": output,
        }),
    }))
}

fn antigravity_tool_kind(tool_name: &str) -> &'static str {
    match tool_name.to_ascii_lowercase().as_str() {
        "run_command" | "bash" | "terminal" => "execute",
        "read_file" | "read" | "list_directory" => "read",
        "grep_search" => "file_search",
        "search" => "search",
        "web_search" => "web_search",
        "replace_file_content" | "edit_file" | "apply_patch" => "edit",
        "write_to_file" | "write_file" => "write",
        _ => "tool",
    }
}

fn antigravity_command_tool(tool_name: &str) -> bool {
    matches!(
        tool_name.to_ascii_lowercase().as_str(),
        "run_command" | "bash" | "terminal"
    )
}

fn public_antigravity_shell_command(tool_info: &Value) -> Option<String> {
    tool_info
        .pointer("/parameters/CommandLine")
        .and_then(Value::as_str)
        .filter(|command| !command.trim().is_empty())
        .map(str::to_string)
}

fn public_antigravity_command_output(tool_info: &Value) -> Option<String> {
    let mut output = Vec::new();
    for field in ["stdout", "stderr", "output"] {
        let Some(text) = tool_info
            .get(field)
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
        else {
            continue;
        };
        if !output.iter().any(|existing| existing == text) {
            output.push(text.to_string());
        }
    }
    (!output.is_empty()).then(|| output.join("\n"))
}

#[derive(Debug)]
struct CapturedBytes {
    bytes: Vec<u8>,
    total_bytes: usize,
    truncated: bool,
    digest: String,
}

async fn capture_bounded<R>(mut reader: R) -> Result<CapturedBytes>
where
    R: AsyncRead + Unpin,
{
    let mut bytes = Vec::new();
    let mut total_bytes = 0_usize;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        let read = reader.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        total_bytes = total_bytes.saturating_add(read);
        digest.update(&buffer[..read]);
        if bytes.len() < MAX_CAPTURE_BYTES {
            let remaining = MAX_CAPTURE_BYTES - bytes.len();
            bytes.extend_from_slice(&buffer[..read.min(remaining)]);
        }
    }
    Ok(CapturedBytes {
        truncated: total_bytes > bytes.len(),
        bytes,
        total_bytes,
        digest: format!("sha256:{:x}", digest.finalize()),
    })
}

fn unsupported_antigravity_command(detail: &str) -> bool {
    let lower = detail.to_ascii_lowercase();
    [
        "unknown command",
        "unrecognized command",
        "unsupported command",
        "unknown option",
        "unrecognized option",
        "unsupported option",
        "unknown argument",
        "unrecognized argument",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
}

fn read_known_antigravity_error_lines(path: &Path) -> Result<String> {
    let mut bytes = Vec::new();
    File::open(path)?
        .take(MAX_LOG_INSPECTION_BYTES)
        .read_to_end(&mut bytes)?;
    let body = String::from_utf8_lossy(&bytes);
    let mut matches = Vec::new();
    for line in body.lines() {
        let lower = line.to_ascii_lowercase();
        if [
            "[error]",
            "error:",
            "failed:",
            "authentication",
            "unauthorized",
            "permission denied",
            "unknown command",
            "unknown option",
            "model unavailable",
            "model not found",
            "quota exceeded",
            "rate limit",
        ]
        .iter()
        .any(|marker| lower.contains(marker))
        {
            matches.push(line.trim().to_string());
            if matches.len() == 4 {
                break;
            }
        }
    }
    Ok(matches.join("\n"))
}

fn required_enum<'a>(
    values: &'a serde_json::Map<String, serde_json::Value>,
    key: &str,
    allowed: &[&str],
) -> Result<&'a str> {
    let value = values
        .get(key)
        .and_then(serde_json::Value::as_str)
        .with_context(|| format!("Antigravity companion requires {key}"))?;
    if !allowed.contains(&value) {
        anyhow::bail!("Antigravity companion {key} has an unsupported value");
    }
    Ok(value)
}

fn read_native_session_id(path: &Path) -> Result<Option<String>> {
    let mut bytes = Vec::new();
    File::open(path)?
        .take(MAX_LOG_INSPECTION_BYTES)
        .read_to_end(&mut bytes)?;
    let body = String::from_utf8_lossy(&bytes);
    Ok(native_session_id_from_log(&body))
}

fn native_session_id_from_log(body: &str) -> Option<String> {
    // Print mode identifies the conversation that owns this one-shot input;
    // prefer it over any unrelated conversation creation emitted at startup.
    for marker in ["Print mode: conversation=", "Created conversation "] {
        for suffix in body
            .match_indices(marker)
            .map(|(index, _)| &body[index + marker.len()..])
        {
            let candidate = suffix
                .split(|character: char| {
                    character.is_whitespace() || character == ',' || character == ']'
                })
                .next()
                .unwrap_or("")
                .trim_matches(|character: char| character == '"' || character == '\'');
            if validate_session_id(candidate).is_ok() {
                return Some(candidate.to_string());
            }
        }
    }
    None
}

fn read_accepted_native_session_id(path: &Path) -> Result<Option<String>> {
    let mut bytes = Vec::new();
    File::open(path)?
        .take(MAX_LOG_INSPECTION_BYTES)
        .read_to_end(&mut bytes)?;
    Ok(accepted_native_session_id_from_log(
        &String::from_utf8_lossy(&bytes),
    ))
}

fn accepted_native_session_id_from_log(body: &str) -> Option<String> {
    let native_session_id = native_session_id_from_log(body)?;
    let forwarding_markers = [
        format!("Forwarding user message to conversation {native_session_id}"),
        format!("Sending user message to conversation {native_session_id}"),
    ];
    let forwarding_offset = forwarding_markers
        .iter()
        .filter_map(|marker| body.find(marker).map(|offset| offset + marker.len()))
        .min()?;
    let response_observed = body[forwarding_offset..]
        .lines()
        .any(|line| line.contains("streamGenerateContent") && line.contains("ResponseID:"));
    response_observed.then_some(native_session_id)
}

fn emit_input_accepted_if_observed(request: &AntigravityRunRequest, log_path: &Path) -> bool {
    let Some(sender) = request.input_accepted.as_ref() else {
        return false;
    };
    let Ok(Some(native_session_id)) = read_accepted_native_session_id(log_path) else {
        return false;
    };
    if request
        .resumable_native_session_id
        .as_deref()
        .is_some_and(|expected| native_session_id != expected)
    {
        return false;
    }
    let _ = sender.send(AntigravityInputAccepted {
        native_session_id,
        native_turn_id: format!("agy:{}:{}", request.agent_run_id, request.execution_epoch),
    });
    true
}

fn validate_session_id(value: &str) -> Result<()> {
    uuid::Uuid::parse_str(value)
        .with_context(|| "Antigravity companion conversation identifier is not a UUID")?;
    Ok(())
}

#[cfg(test)]
fn bytes_digest(bytes: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(bytes);
    format!("sha256:{:x}", digest.finalize())
}

fn create_private_file(path: &Path) -> Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).with_context(|| {
        format!(
            "failed to create private Antigravity companion log {}",
            path.display()
        )
    })?;
    file.flush()?;
    restrict_file_permissions(path)
}

#[cfg(unix)]
fn restrict_directory_permissions(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    Ok(())
}

#[cfg(not(unix))]
fn restrict_directory_permissions(_path: &Path) -> Result<()> {
    Ok(())
}

#[cfg(unix)]
fn restrict_file_permissions(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    Ok(())
}

#[cfg(not(unix))]
fn restrict_file_permissions(_path: &Path) -> Result<()> {
    Ok(())
}

struct SensitiveLogGuard(PathBuf);

impl Drop for SensitiveLogGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn structured_init_exposes_only_an_explicit_nonempty_model() {
        assert_eq!(
            antigravity_init_model_id(&serde_json::json!({
                "event": "init",
                "conversation_id": "0bdd2166-d420-40c6-94be-70b93eb290c5",
                "init": {"model": {"id": " gemini-2.5-pro "}}
            })),
            Some("gemini-2.5-pro".to_string())
        );
        assert_eq!(
            antigravity_init_model_id(&serde_json::json!({
                "event": "init",
                "conversation_id": "0bdd2166-d420-40c6-94be-70b93eb290c5",
                "init": {"tools": ["run_command"]}
            })),
            None
        );
        assert_eq!(
            antigravity_init_model_id(&serde_json::json!({
                "event": "init",
                "conversation_id": "0bdd2166-d420-40c6-94be-70b93eb290c5",
                "model": "  "
            })),
            None
        );
    }

    #[test]
    fn command_terminal_carries_the_complete_public_output() {
        let conversation_id = "0bdd2166-d420-40c6-94be-70b93eb290c5";
        let mut capture = AntigravityStreamCapture::default();
        let started = normalize_antigravity_tool_step(
            &serde_json::json!({
                "conversation_id": conversation_id,
                "step_index": 4,
                "state": "RUNNING",
                "step_type": "tool",
                "tool_name": "run_command",
                "tool_info": {
                    "name": "run_command",
                    "parameters": {"CommandLine": "pnpm test"}
                }
            }),
            &mut capture,
        )
        .unwrap()
        .unwrap();
        let completed = normalize_antigravity_tool_step(
            &serde_json::json!({
                "conversation_id": conversation_id,
                "step_index": 4,
                "state": "DONE",
                "step_type": "tool",
                "tool_name": "run_command",
                "tool_info": {
                    "name": "run_command",
                    "output": "complete Antigravity output"
                }
            }),
            &mut capture,
        )
        .unwrap()
        .unwrap();

        assert_eq!(started.event_type, "runtime.action");
        assert_eq!(started.payload["status"], "in_progress");
        assert_eq!(completed.event_type, "runtime.action");
        assert_eq!(completed.payload["status"], "completed");
        assert_eq!(completed.payload["input"]["command"], "pnpm test");
        assert_eq!(completed.payload["output"], "complete Antigravity output");
    }

    #[test]
    fn workspace_roots_include_canonical_execution_attachment_and_run_tmp_directories() {
        let root = std::env::temp_dir().join(format!(
            "rovai-antigravity-workspace-roots-test-{}",
            uuid::Uuid::new_v4()
        ));
        let workspace = root.join("workspace");
        let attachments = root.join("attachments");
        let run_tmp = root.join("run-tmp");
        std::fs::create_dir_all(&workspace).expect("workspace should be created");
        std::fs::create_dir_all(&attachments).expect("attachments should be created");
        std::fs::create_dir_all(&run_tmp).expect("Run tmp should be created");

        let roots =
            canonical_antigravity_workspace_roots(&workspace, Some(&attachments), Some(&run_tmp))
                .expect("all visible roots should resolve");
        assert_eq!(
            roots,
            vec![
                antigravity_runtime_visible_path(workspace.canonicalize().unwrap()),
                antigravity_runtime_visible_path(attachments.canonicalize().unwrap()),
                antigravity_runtime_visible_path(run_tmp.canonicalize().unwrap())
            ]
        );
        let deduplicated =
            canonical_antigravity_workspace_roots(&workspace, Some(&workspace), Some(&workspace))
                .expect("identical roots should resolve");
        assert_eq!(
            deduplicated,
            vec![antigravity_runtime_visible_path(
                workspace.canonicalize().unwrap()
            )]
        );

        std::fs::remove_dir_all(root).expect("temporary root should be removed");
    }

    #[tokio::test]
    #[ignore = "manual local Runtime smoke"]
    async fn isolated_completion_real_runtime_smoke() {
        use rovai_core::agent_profile::{
            AdapterKind, AdapterPermissionConfig, ResolvedModelSelection,
        };
        use serde_json::json;

        let executable = crate::health::find_adapter(AdapterKind::AntigravityApp)
            .expect("Antigravity companion must be installed");
        let root = std::env::temp_dir().join(format!(
            "rovai-antigravity-compaction-smoke-{}",
            uuid::Uuid::new_v4()
        ));
        let workspace = root.join("workspace");
        std::fs::create_dir_all(&workspace).expect("workspace should be created");
        let adapter = AntigravityAppRuntimeAdapter::new(&root).expect("Adapter should initialize");
        let result = adapter
            .run(AntigravityRunRequest {
                agent_run_id: format!("context-compaction:{}", uuid::Uuid::new_v4()),
                execution_epoch: 1,
                workspace: AgentRunWorkspace {
                    execution_root: workspace.to_string_lossy().to_string(),
                    access: "read_only".to_string(),
                    isolation: "shared".to_string(),
                },
                permission_semantics: PermissionSemantics::CoreEnforcedV1,
                runtime: FrozenAgentRuntimeConfig {
                    adapter_kind: AdapterKind::AntigravityApp,
                    installation_id: "smoke".to_string(),
                    installation_generation: 1,
                    search_environment_generation: 1,
                    executable_path: executable.to_string_lossy().to_string(),
                    auth_scope: "local_user".to_string(),
                    reported_version: Some("smoke".to_string()),
                    executable_fingerprint:
                        rovai_core::agent_runtime_adapter::executable_fingerprint(&executable)
                            .expect("Antigravity companion executable should be readable"),
                    capabilities: vec!["cli.print".to_string()],
                    protocol_version: "antigravity-app-cli-v1".to_string(),
                    model: ResolvedModelSelection {
                        source: "runtime_default".to_string(),
                        model_id: ANTIGRAVITY_RUNTIME_DEFAULT_MODEL_ID.to_string(),
                        options: json!({}),
                    },
                    permissions: AdapterPermissionConfig {
                        adapter_kind: AdapterKind::AntigravityApp,
                        schema_version: 1,
                        values: json!({
                            "mode": "plan",
                            "sandbox": "on",
                            "dangerously_skip_permissions": "off",
                        }),
                    },
                    native_session_compatibility_key: Some("antigravity-app:cli-v1".to_string()),
                    binding_compatibility_digest: "smoke-binding".to_string(),
                    host_config_digest: "smoke-host".to_string(),
                    config_digest: "smoke-config".to_string(),
                },
                prompt: "只输出这六个字：压缩路径可用".to_string(),
                resumable_native_session_id: None,
                attachment_access_root: None,
                builtin_tools: None,
                input_accepted: None,
                runtime_events: None,
                launch_handoff: None,
            })
            .await
            .unwrap();
        assert!(result.final_output.contains("压缩路径可用"));
        std::fs::remove_dir_all(root).expect("temporary root should be removed");
    }

    #[test]
    fn extracts_created_and_resumed_conversation_ids_without_retaining_log_content() {
        let root = std::env::temp_dir().join(format!(
            "rovai-antigravity-log-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).expect("test directory should be created");
        let created = "0bdd2166-d420-40c6-94be-70b93eb290c5";
        let created_log = root.join("created.log");
        std::fs::write(
            &created_log,
            format!("private payload\nCreated conversation {created}\n"),
        )
        .expect("log should be written");
        assert_eq!(
            read_native_session_id(&created_log)
                .expect("log should parse")
                .as_deref(),
            Some(created)
        );

        let resumed_log = root.join("resumed.log");
        std::fs::write(
            &resumed_log,
            format!("Print mode: conversation={created}, timeout=5m0s\n"),
        )
        .expect("log should be written");
        assert_eq!(
            read_native_session_id(&resumed_log)
                .expect("log should parse")
                .as_deref(),
            Some(created)
        );

        let unrelated = "2b3f7448-3b73-49db-bcb7-cfa6b347f693";
        let mixed_log = root.join("mixed.log");
        std::fs::write(
            &mixed_log,
            format!(
                "Created conversation {unrelated}\nPrint mode: conversation={created}, sending message\n"
            ),
        )
        .expect("mixed log should be written");
        assert_eq!(
            read_native_session_id(&mixed_log)
                .expect("mixed log should parse")
                .as_deref(),
            Some(created),
            "the print-mode conversation owns the one-shot input"
        );
        std::fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn extracts_only_known_error_lines_from_private_logs() {
        let root = std::env::temp_dir().join(format!(
            "rovai-antigravity-private-error-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).expect("test directory should be created");
        let log = root.join("runtime.log");
        std::fs::write(
            &log,
            concat!(
                "private prompt payload that must stay private\n",
                "[ERROR] provider rate limit exceeded\n",
                "private tool output that must stay private\n",
                "failed: model unavailable\n",
            ),
        )
        .expect("private log should be written");
        let extracted =
            read_known_antigravity_error_lines(&log).expect("known errors should parse");
        assert!(extracted.contains("rate limit exceeded"));
        assert!(extracted.contains("model unavailable"));
        assert!(!extracted.contains("private prompt payload"));
        assert!(!extracted.contains("private tool output"));
        std::fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn accepts_only_a_session_bound_response_after_the_current_input_was_forwarded() {
        let session_id = "0bdd2166-d420-40c6-94be-70b93eb290c5";
        let response =
            "I0811 streamGenerateContent?alt=sse request completed ResponseID: response-1";
        assert_eq!(
            accepted_native_session_id_from_log(&format!(
                "Created conversation {session_id}\n{response}\nForwarding user message to conversation {session_id}\n"
            )),
            None,
            "an unrelated response before forwarding cannot acknowledge this input"
        );
        assert_eq!(
            accepted_native_session_id_from_log(&format!(
                "Created conversation {session_id}\nForwarding user message to conversation {session_id}\n"
            )),
            None,
            "local forwarding alone is not accepted evidence"
        );
        assert_eq!(
            accepted_native_session_id_from_log(&format!(
                "Created conversation {session_id}\nForwarding user message to conversation {session_id}\n{response}\n"
            )),
            Some(session_id.to_string())
        );
        assert_eq!(
            accepted_native_session_id_from_log(&format!(
                "Print mode: conversation={session_id}, timeout=5m0s\nSending user message to conversation {session_id}\n{response}\n"
            )),
            Some(session_id.to_string())
        );
    }

    #[test]
    fn bounded_capture_digest_never_needs_the_sensitive_text() {
        assert_eq!(
            bytes_digest(b"diagnostic"),
            "sha256:5a695eea5b00a31f8aef7dbb89c8f798fab371246ac1549afe84b16420707b99"
        );
    }

    #[cfg(unix)]
    fn fake_antigravity_request(
        workspace: &Path,
        executable: &Path,
        agent_run_id: String,
    ) -> AntigravityRunRequest {
        use rovai_core::agent_profile::{
            AdapterKind, AdapterPermissionConfig, ResolvedModelSelection,
        };
        use serde_json::json;

        AntigravityRunRequest {
            agent_run_id,
            execution_epoch: 1,
            workspace: AgentRunWorkspace {
                execution_root: workspace.to_string_lossy().to_string(),
                access: "read_write".to_string(),
                isolation: "shared".to_string(),
            },
            permission_semantics: PermissionSemantics::RuntimeManagedV2,
            runtime: FrozenAgentRuntimeConfig {
                adapter_kind: AdapterKind::AntigravityApp,
                installation_id: "agy-test".to_string(),
                installation_generation: 1,
                search_environment_generation: 1,
                executable_path: executable.to_string_lossy().to_string(),
                auth_scope: "test".to_string(),
                reported_version: Some("test".to_string()),
                executable_fingerprint: "sha256:test".to_string(),
                capabilities: vec!["cli.print".to_string()],
                protocol_version: "antigravity-app-cli-v1".to_string(),
                model: ResolvedModelSelection {
                    source: "runtime_default".to_string(),
                    model_id: ANTIGRAVITY_RUNTIME_DEFAULT_MODEL_ID.to_string(),
                    options: json!({}),
                },
                permissions: AdapterPermissionConfig {
                    adapter_kind: AdapterKind::AntigravityApp,
                    schema_version: 1,
                    values: json!({
                        "mode": "accept-edits",
                        "sandbox": "on",
                        "dangerously_skip_permissions": "off",
                    }),
                },
                native_session_compatibility_key: Some("antigravity-app:cli-v1".to_string()),
                binding_compatibility_digest: "binding".to_string(),
                host_config_digest: "host".to_string(),
                config_digest: "config".to_string(),
            },
            prompt: "test input".to_string(),
            resumable_native_session_id: None,
            attachment_access_root: None,
            builtin_tools: None,
            input_accepted: None,
            runtime_events: None,
            launch_handoff: None,
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn response_evidence_emits_acceptance_before_process_completion() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!(
            "rovai-antigravity-early-acceptance-test-{}",
            uuid::Uuid::new_v4()
        ));
        let workspace = root.join("workspace");
        std::fs::create_dir_all(&workspace).expect("workspace should be created");
        let executable = root.join("fake-agy");
        std::fs::write(
            &executable,
            r#"#!/bin/sh
printf '%s\n' "$@" > .agy-args
log_file=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--log-file" ]; then
    shift
    log_file="$1"
  fi
  shift
done
session_id="0bdd2166-d420-40c6-94be-70b93eb290c5"
echo "Created conversation $session_id" >> "$log_file"
echo "Forwarding user message to conversation $session_id" >> "$log_file"
echo "I0811 streamGenerateContent?alt=sse request completed ResponseID: response-1" >> "$log_file"
while [ ! -f .release ]; do
  sleep 0.05
done
echo "finished"
"#,
        )
        .expect("fake Antigravity companion should be written");
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700))
            .expect("fake Antigravity companion should be executable");
        let adapter =
            Arc::new(AntigravityAppRuntimeAdapter::new(&root).expect("Adapter should initialize"));
        let run_id = uuid::Uuid::new_v4().to_string();
        let mut request = fake_antigravity_request(&workspace, &executable, run_id.clone());
        let (accepted_sender, mut accepted_receiver) = mpsc::unbounded_channel();
        let (runtime_event_sender, mut runtime_event_receiver) = mpsc::unbounded_channel();
        let (handoff_sender, handoff_receiver) = oneshot::channel();
        request.input_accepted = Some(accepted_sender);
        request.runtime_events = Some(runtime_event_sender);
        request.launch_handoff = Some(handoff_sender);
        let running_adapter = Arc::clone(&adapter);
        let task = tokio::spawn(async move { running_adapter.run(request).await });

        tokio::time::timeout(Duration::from_secs(5), handoff_receiver)
            .await
            .expect("prompt handoff should follow successful process spawn")
            .expect("prompt handoff channel should stay open");
        let accepted = tokio::time::timeout(Duration::from_secs(5), accepted_receiver.recv())
            .await
            .expect("accepted evidence should arrive before the process exits")
            .expect("accepted evidence channel should stay open");
        assert_eq!(
            accepted.native_session_id,
            "0bdd2166-d420-40c6-94be-70b93eb290c5"
        );
        assert_eq!(accepted.native_turn_id, format!("agy:{run_id}:1"));
        assert!(!task.is_finished(), "acceptance must precede final output");
        std::fs::write(workspace.join(".release"), b"")
            .expect("fake process should be released after acceptance");

        let result = tokio::time::timeout(Duration::from_secs(5), task)
            .await
            .expect("fake process should finish")
            .expect("run task should join")
            .expect("final output should remain successful");
        assert_eq!(result.final_output, "finished");
        let arguments = std::fs::read_to_string(workspace.join(".agy-args"))
            .expect("legacy fixture should record its arguments");
        assert!(!arguments.contains("--output-format"));
        assert!(
            runtime_event_receiver.try_recv().is_err(),
            "legacy text output must remain run-level"
        );
        std::fs::remove_dir_all(root).expect("temporary root should be removed");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn stream_json_projects_tool_lifecycle_and_command_output() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!(
            "rovai-antigravity-stream-json-test-{}",
            uuid::Uuid::new_v4()
        ));
        let workspace = root.join("workspace");
        std::fs::create_dir_all(&workspace).expect("workspace should be created");
        let executable = root.join("fake-agy");
        std::fs::write(
            &executable,
            r#"#!/bin/sh
printf '%s\n' "$@" > .agy-args
log_file=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--log-file" ]; then
    shift
    log_file="$1"
  fi
  shift
done
session_id="0bdd2166-d420-40c6-94be-70b93eb290c5"
echo "Created conversation $session_id" >> "$log_file"
echo "Forwarding user message to conversation $session_id" >> "$log_file"
echo "I0811 streamGenerateContent?alt=sse request completed ResponseID: response-1" >> "$log_file"
printf '%s\n' '{"event":"init","conversation_id":"0bdd2166-d420-40c6-94be-70b93eb290c5","init":{"tools":["run_command"]}}'
printf '%s\n' '{"event":"step_update","step_update":{"conversation_id":"0bdd2166-d420-40c6-94be-70b93eb290c5","step_index":4,"state":"RUNNING","step_type":"tool","tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"Cwd":"/private/workspace","privateToken":"AGY_FIRST_RUNNING_MUST_NOT_LEAK"}}}}'
printf '%s\n' '{"event":"step_update","step_update":{"conversation_id":"0bdd2166-d420-40c6-94be-70b93eb290c5","step_index":4,"state":"RUNNING","step_type":"tool","tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"pnpm test","Cwd":"/private/workspace","privateToken":"AGY_LATE_RUNNING_MUST_NOT_LEAK"}}}}'
printf '%s\n' '{"event":"step_update","step_update":{"conversation_id":"0bdd2166-d420-40c6-94be-70b93eb290c5","step_index":4,"state":"DONE","step_type":"tool","tool_name":"run_command","tool_info":{"name":"run_command","output":"AGY_PRINTF_OK","privateToken":"AGY_MUST_NOT_LEAK"}}}'
printf '%s\n' '{"event":"step_update","step_update":{"conversation_id":"0bdd2166-d420-40c6-94be-70b93eb290c5","step_index":5,"state":"RUNNING","step_type":"tool","tool_name":"read_file","tool_info":{"name":"read_file","parameters":{"CommandLine":"cat /private/secret","Cwd":"/private/workspace"}}}}'
printf '%s\n' '{"event":"step_update","step_update":{"conversation_id":"0bdd2166-d420-40c6-94be-70b93eb290c5","step_index":5,"state":"DONE","step_type":"tool","tool_name":"read_file","tool_info":{"name":"read_file"}}}'
printf '%s\n' '{"event":"step_update","step_update":{"conversation_id":"0bdd2166-d420-40c6-94be-70b93eb290c5","step_index":6,"state":"RUNNING","step_type":"tool","tool_name":"terminal","tool_info":{"name":"terminal","parameters":{"CommandLine":"cached command","Cwd":"/private/workspace"}}}}'
printf '%s\n' '{"event":"step_update","step_update":{"conversation_id":"0bdd2166-d420-40c6-94be-70b93eb290c5","step_index":6,"state":"DONE","step_type":"tool","tool_name":"terminal","tool_info":{"name":"terminal","parameters":{"CommandLine":"terminal command","privateToken":"AGY_TERMINAL_MUST_NOT_LEAK"}}}}'
printf '%s\n' '{"event":"result","result":{"conversation_id":"0bdd2166-d420-40c6-94be-70b93eb290c5","status":"SUCCESS","response":"structured final"}}'
"#,
        )
        .expect("fake Antigravity companion should be written");
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700))
            .expect("fake Antigravity companion should be executable");
        let adapter = AntigravityAppRuntimeAdapter::new(&root).expect("Adapter should initialize");
        let mut request =
            fake_antigravity_request(&workspace, &executable, uuid::Uuid::new_v4().to_string());
        request
            .runtime
            .capabilities
            .push("output.stream_json".to_string());
        let (accepted_sender, mut accepted_receiver) = mpsc::unbounded_channel();
        let (runtime_event_sender, mut runtime_event_receiver) = mpsc::unbounded_channel();
        request.input_accepted = Some(accepted_sender);
        request.runtime_events = Some(runtime_event_sender);

        let result = adapter
            .run(request)
            .await
            .expect("structured fixture should complete");
        assert_eq!(result.final_output, "structured final");
        assert_eq!(
            accepted_receiver
                .try_recv()
                .expect("structured run should preserve accepted-input proof")
                .native_session_id,
            "0bdd2166-d420-40c6-94be-70b93eb290c5"
        );
        let started = runtime_event_receiver
            .try_recv()
            .expect("structured tool start should be emitted");
        let completed = runtime_event_receiver
            .try_recv()
            .expect("structured tool result should be emitted");
        let read_started = runtime_event_receiver
            .try_recv()
            .expect("structured non-Shell tool start should be emitted");
        let read_completed = runtime_event_receiver
            .try_recv()
            .expect("structured non-Shell tool result should be emitted");
        let terminal_override_started = runtime_event_receiver
            .try_recv()
            .expect("structured terminal start should be emitted");
        let terminal_override_completed = runtime_event_receiver
            .try_recv()
            .expect("structured terminal result should be emitted");
        assert_eq!(
            started.payload["toolCallId"],
            completed.payload["toolCallId"]
        );
        assert_eq!(started.payload["status"], "in_progress");
        assert_eq!(completed.payload["status"], "completed");
        assert_eq!(completed.payload["kind"], "execute");
        assert_eq!(started.payload["toolName"], "run_command");
        assert!(started.payload["input"].is_null());
        assert_eq!(
            completed.payload["input"],
            serde_json::json!({"command": "pnpm test"})
        );
        assert!(started.payload.get("title").is_none());
        assert!(completed.payload.get("title").is_none());
        assert_eq!(completed.payload["output"], "AGY_PRINTF_OK");
        assert_eq!(read_started.payload["kind"], "read");
        assert!(read_started.payload["input"].is_null());
        assert!(read_completed.payload["input"].is_null());
        assert_eq!(
            terminal_override_started.payload["input"],
            serde_json::json!({"command": "cached command"})
        );
        assert_eq!(
            terminal_override_completed.payload["input"],
            serde_json::json!({"command": "terminal command"})
        );
        let normalized_events = serde_json::to_string(&serde_json::json!([
            started.payload,
            completed.payload,
            read_started.payload,
            read_completed.payload,
            terminal_override_started.payload,
            terminal_override_completed.payload,
        ]))
        .expect("normalized events should serialize");
        for private_value in [
            "AGY_FIRST_RUNNING_MUST_NOT_LEAK",
            "AGY_LATE_RUNNING_MUST_NOT_LEAK",
            "AGY_MUST_NOT_LEAK",
            "AGY_TERMINAL_MUST_NOT_LEAK",
            "/private/workspace",
            "cat /private/secret",
            "CommandLine",
            "parameters",
        ] {
            assert!(!normalized_events.contains(private_value));
        }
        let arguments = std::fs::read_to_string(workspace.join(".agy-args"))
            .expect("structured fixture should record its arguments");
        assert!(arguments.contains("--output-format\nstream-json"));
        for tool_name in ["run_command", "bash", "terminal"] {
            assert_eq!(antigravity_tool_kind(tool_name), "execute");
            assert!(antigravity_command_tool(tool_name));
        }
        assert_eq!(antigravity_tool_kind("read_file"), "read");
        assert_eq!(antigravity_tool_kind("grep_search"), "file_search");
        assert_eq!(antigravity_tool_kind("search"), "search");
        assert_eq!(antigravity_tool_kind("web_search"), "web_search");
        assert_eq!(antigravity_tool_kind("write_to_file"), "write");
        assert_eq!(antigravity_tool_kind("future_tool"), "tool");
        std::fs::remove_dir_all(root).expect("temporary root should be removed");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn structured_runtime_failure_preserves_sanitized_provider_detail() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!(
            "rovai-antigravity-structured-failure-test-{}",
            uuid::Uuid::new_v4()
        ));
        let workspace = root.join("workspace");
        std::fs::create_dir_all(&workspace).expect("workspace should be created");
        let executable = root.join("fake-agy");
        std::fs::write(
            &executable,
            r#"#!/bin/sh
log_file=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--log-file" ]; then
    shift
    log_file="$1"
  fi
  shift
done
session_id="0bdd2166-d420-40c6-94be-70b93eb290c5"
echo "Created conversation $session_id" >> "$log_file"
printf '%s\n' '{"event":"init","conversation_id":"0bdd2166-d420-40c6-94be-70b93eb290c5","init":{}}'
printf '%s\n' '{"event":"result","result":{"conversation_id":"0bdd2166-d420-40c6-94be-70b93eb290c5","status":"ERROR","error":"quota exceeded; api_key=private-key"}}'
"#,
        )
        .expect("fake Antigravity companion should be written");
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700))
            .expect("fake Antigravity companion should be executable");
        let adapter = AntigravityAppRuntimeAdapter::new(&root).expect("Adapter should initialize");
        let mut request =
            fake_antigravity_request(&workspace, &executable, uuid::Uuid::new_v4().to_string());
        request
            .runtime
            .capabilities
            .push("output.stream_json".to_string());

        let error = adapter
            .run(request)
            .await
            .expect_err("structured Runtime failure must remain a typed failure");
        let delivered = error
            .downcast_ref::<AntigravityDeliveredFailure>()
            .expect("structured final should prove the delivered turn ended");
        assert_eq!(delivered.error_code, "runtime_quota_exceeded");
        assert_eq!(delivered.failure.origin, RuntimeFailureOrigin::Runtime);
        assert_eq!(delivered.failure.phase, RuntimeFailurePhase::Terminal);
        let detail = delivered.failure.detail.as_deref().expect("safe detail");
        assert!(detail.contains("quota exceeded"));
        assert!(detail.contains("api_key=[redacted]"));
        assert!(!detail.contains("private-key"));
        std::fs::remove_dir_all(root).expect("temporary root should be removed");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn terminal_process_failure_still_emits_observed_acceptance() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!(
            "rovai-antigravity-accepted-terminal-failure-test-{}",
            uuid::Uuid::new_v4()
        ));
        let workspace = root.join("workspace");
        std::fs::create_dir_all(&workspace).expect("workspace should be created");
        let executable = root.join("fake-agy");
        std::fs::write(
            &executable,
            r#"#!/bin/sh
log_file=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--log-file" ]; then
    shift
    log_file="$1"
  fi
  shift
done
session_id="0bdd2166-d420-40c6-94be-70b93eb290c5"
echo "Created conversation $session_id" >> "$log_file"
echo "Forwarding user message to conversation $session_id" >> "$log_file"
echo "I0811 streamGenerateContent?alt=sse request completed ResponseID: response-1" >> "$log_file"
exit 7
"#,
        )
        .expect("fake Antigravity companion should be written");
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700))
            .expect("fake Antigravity companion should be executable");
        let adapter = AntigravityAppRuntimeAdapter::new(&root).expect("Adapter should initialize");
        let mut request =
            fake_antigravity_request(&workspace, &executable, uuid::Uuid::new_v4().to_string());
        let (accepted_sender, mut accepted_receiver) = mpsc::unbounded_channel();
        request.input_accepted = Some(accepted_sender);

        let error = adapter
            .run(request)
            .await
            .expect_err("non-zero process exit should remain a failure");
        assert!(format!("{error:#}").contains("process exited with"));
        assert_eq!(
            accepted_receiver
                .try_recv()
                .expect("the final log scan should preserve accepted evidence")
                .native_session_id,
            "0bdd2166-d420-40c6-94be-70b93eb290c5"
        );
        std::fs::remove_dir_all(root).expect("temporary root should be removed");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn verified_session_without_final_text_is_a_delivered_failure() {
        use std::os::unix::fs::PermissionsExt;

        use rovai_core::agent_profile::{
            AdapterKind, AdapterPermissionConfig, ResolvedModelSelection,
        };
        use serde_json::json;

        let root = std::env::temp_dir().join(format!(
            "rovai-antigravity-delivered-failure-test-{}",
            uuid::Uuid::new_v4()
        ));
        let workspace = root.join("workspace");
        std::fs::create_dir_all(&workspace).expect("workspace should be created");
        let executable = root.join("fake-agy");
        std::fs::write(
            &executable,
            r#"#!/bin/sh
log_file=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--log-file" ]; then
    shift
    log_file="$1"
  fi
  shift
done
echo "Created conversation 0bdd2166-d420-40c6-94be-70b93eb290c5" > "$log_file"
"#,
        )
        .expect("fake Antigravity companion should be written");
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700))
            .expect("fake Antigravity companion should be executable");
        let adapter = AntigravityAppRuntimeAdapter::new(&root).expect("Adapter should initialize");
        let error = adapter
            .run(AntigravityRunRequest {
                agent_run_id: uuid::Uuid::new_v4().to_string(),
                execution_epoch: 1,
                workspace: AgentRunWorkspace {
                    execution_root: workspace.to_string_lossy().to_string(),
                    access: "read_write".to_string(),
                    isolation: "shared".to_string(),
                },
                permission_semantics: PermissionSemantics::RuntimeManagedV2,
                runtime: FrozenAgentRuntimeConfig {
                    adapter_kind: AdapterKind::AntigravityApp,
                    installation_id: "delivered-failure-test".to_string(),
                    installation_generation: 1,
                    search_environment_generation: 1,
                    executable_path: executable.to_string_lossy().to_string(),
                    auth_scope: "local_user".to_string(),
                    reported_version: Some("test".to_string()),
                    executable_fingerprint: "test-fingerprint".to_string(),
                    capabilities: vec!["cli.print".to_string()],
                    protocol_version: "antigravity-app-cli-v1".to_string(),
                    model: ResolvedModelSelection {
                        source: "runtime_default".to_string(),
                        model_id: ANTIGRAVITY_RUNTIME_DEFAULT_MODEL_ID.to_string(),
                        options: json!({}),
                    },
                    permissions: AdapterPermissionConfig {
                        adapter_kind: AdapterKind::AntigravityApp,
                        schema_version: 1,
                        values: json!({
                            "mode": "accept-edits",
                            "sandbox": "on",
                            "dangerously_skip_permissions": "off",
                        }),
                    },
                    native_session_compatibility_key: Some("antigravity-app:cli-v1".to_string()),
                    binding_compatibility_digest: "test-binding".to_string(),
                    host_config_digest: "test-host".to_string(),
                    config_digest: "test-config".to_string(),
                },
                prompt: "produce no final output".to_string(),
                resumable_native_session_id: None,
                attachment_access_root: None,
                builtin_tools: None,
                input_accepted: None,
                runtime_events: None,
                launch_handoff: None,
            })
            .await
            .expect_err("a verified Session without final text must not look successful");
        let delivered = error
            .downcast_ref::<AntigravityDeliveredFailure>()
            .expect("the failure should preserve delivered-input identity");
        assert_eq!(delivered.error_code, "runtime_missing_final_output");
        assert_eq!(
            delivered.native_session_id,
            "0bdd2166-d420-40c6-94be-70b93eb290c5"
        );
        std::fs::remove_dir_all(root).expect("temporary root should be removed");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn interrupt_after_acceptance_terminates_process_and_removes_private_logs() {
        use std::os::unix::fs::PermissionsExt;

        use rovai_core::agent_profile::{
            AdapterKind, AdapterPermissionConfig, ResolvedModelSelection,
        };
        use serde_json::json;

        let root = std::env::temp_dir().join(format!(
            "rovai-antigravity-interrupt-test-{}",
            uuid::Uuid::new_v4()
        ));
        let workspace = root.join("workspace");
        std::fs::create_dir_all(&workspace).expect("workspace should be created");
        let executable = root.join("fake-agy");
        std::fs::write(
            &executable,
            r#"#!/bin/sh
log_file=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--log-file" ]; then
    shift
    log_file="$1"
  fi
  shift
done
session_id="0bdd2166-d420-40c6-94be-70b93eb290c5"
echo "Created conversation $session_id" > "$log_file"
echo "Forwarding user message to conversation $session_id" >> "$log_file"
echo "I0811 streamGenerateContent?alt=sse request completed ResponseID: response-1" >> "$log_file"
exec sleep 30
"#,
        )
        .expect("fake Antigravity companion should be written");
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700))
            .expect("fake Antigravity companion should be executable");
        let adapter =
            Arc::new(AntigravityAppRuntimeAdapter::new(&root).expect("Adapter should initialize"));
        let run_id = uuid::Uuid::new_v4().to_string();
        let (accepted_sender, mut accepted_receiver) = mpsc::unbounded_channel();
        let request = AntigravityRunRequest {
            agent_run_id: run_id.clone(),
            execution_epoch: 1,
            workspace: AgentRunWorkspace {
                execution_root: workspace.to_string_lossy().to_string(),
                access: "read_only".to_string(),
                isolation: "shared".to_string(),
            },
            permission_semantics: PermissionSemantics::CoreEnforcedV1,
            runtime: FrozenAgentRuntimeConfig {
                adapter_kind: AdapterKind::AntigravityApp,
                installation_id: "agy-test".to_string(),
                installation_generation: 1,
                search_environment_generation: 1,
                executable_path: executable.to_string_lossy().to_string(),
                auth_scope: "test".to_string(),
                reported_version: Some("test".to_string()),
                executable_fingerprint: "sha256:test".to_string(),
                capabilities: vec!["cli.print".to_string()],
                protocol_version: "antigravity-app-cli-v1".to_string(),
                model: ResolvedModelSelection {
                    source: "runtime_default".to_string(),
                    model_id: ANTIGRAVITY_RUNTIME_DEFAULT_MODEL_ID.to_string(),
                    options: json!({}),
                },
                permissions: AdapterPermissionConfig {
                    adapter_kind: AdapterKind::AntigravityApp,
                    schema_version: 1,
                    values: json!({
                        "mode": "plan",
                        "sandbox": "on",
                        "dangerously_skip_permissions": "off",
                    }),
                },
                native_session_compatibility_key: Some("antigravity-app:cli-v1".to_string()),
                binding_compatibility_digest: "binding".to_string(),
                host_config_digest: "host".to_string(),
                config_digest: "config".to_string(),
            },
            prompt: "wait".to_string(),
            resumable_native_session_id: None,
            attachment_access_root: None,
            builtin_tools: None,
            input_accepted: Some(accepted_sender),
            runtime_events: None,
            launch_handoff: None,
        };
        let running_adapter = adapter.clone();
        let task = tokio::spawn(async move { running_adapter.run(request).await });
        let deadline = Instant::now() + Duration::from_secs(2);
        while adapter.active.lock().await.is_empty() && Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let accepted = tokio::time::timeout(Duration::from_secs(5), accepted_receiver.recv())
            .await
            .expect("accepted evidence should be observed before interruption")
            .expect("accepted evidence channel should stay open");
        assert_eq!(
            accepted.native_session_id,
            "0bdd2166-d420-40c6-94be-70b93eb290c5"
        );
        assert!(adapter.interrupt(&run_id, 1).await);
        let error = task
            .await
            .expect("run task should join")
            .expect_err("interrupted Run should fail safely");
        assert!(format!("{error:#}").contains("interrupted"));
        assert!(
            std::fs::read_dir(root.join("runtime-private/antigravity"))
                .expect("private log directory should exist")
                .next()
                .is_none()
        );
        std::fs::remove_dir_all(root).expect("test directory should be removed");
    }
}
