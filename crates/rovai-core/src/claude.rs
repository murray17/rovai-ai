use std::{
    collections::{BTreeMap, HashMap},
    error::Error as StdError,
    fmt,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
};

use anyhow::{Context, Result};
use rovai_core::{
    agent_profile::FrozenAgentRuntimeConfig,
    agent_runtime_adapter::CLAUDE_CODE_RUNTIME_DEFAULT_MODEL_ID,
    mcp::McpServerDefinition,
    runtime::{AgentRunWorkspace, PermissionSemantics},
    runtime_discovery::configure_active_runtime_command,
};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::Command,
    sync::{Mutex, mpsc, oneshot},
    time::{Duration, Instant},
};

use crate::{
    builtin_tool_runtime::BuiltinToolProcessConfig,
    runtime_mcp::{remove_stale_mcp_configs, write_ephemeral_additive_mcp_config},
};

const MAX_CAPTURE_BYTES: usize = 2 * 1024 * 1024;

pub struct ClaudeCodeRunRequest {
    pub agent_run_id: String,
    pub execution_epoch: i64,
    pub workspace: AgentRunWorkspace,
    pub permission_semantics: PermissionSemantics,
    pub runtime: FrozenAgentRuntimeConfig,
    pub prompt: String,
    pub resumable_native_session_id: Option<String>,
    pub new_native_session_id: Option<String>,
    pub session_bootstrap: Option<String>,
    pub builtin_tools: Option<BuiltinToolProcessConfig>,
    pub external_mcp_servers: BTreeMap<String, McpServerDefinition>,
    pub attachment_access_root: Option<PathBuf>,
    pub persist_session: bool,
    pub input_accepted: Option<mpsc::UnboundedSender<ClaudeCodeInputAccepted>>,
    pub launch_handoff: Option<oneshot::Sender<()>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaudeCodeInputAccepted {
    pub native_session_id: String,
    pub native_turn_id: String,
}

#[derive(Debug, Clone)]
pub struct ClaudeCodeRunResult {
    pub native_session_id: String,
    pub native_turn_id: String,
    pub final_output: String,
}

#[derive(Debug, Clone)]
pub struct ClaudeCodeDeliveredFailure {
    pub native_session_id: String,
    pub native_turn_id: String,
    pub error_code: &'static str,
}

impl fmt::Display for ClaudeCodeDeliveredFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "Claude Code accepted the input but ended with {}",
            self.error_code
        )
    }
}

impl StdError for ClaudeCodeDeliveredFailure {}

#[derive(Debug)]
struct ClaudeCodeProcessControl {
    interrupt: Mutex<Option<oneshot::Sender<()>>>,
}

#[derive(Debug)]
pub struct ClaudeCodeCliRuntimeAdapter {
    active: Mutex<HashMap<(String, i64), Arc<ClaudeCodeProcessControl>>>,
    private_runtime_dir: PathBuf,
}

impl ClaudeCodeCliRuntimeAdapter {
    pub fn new(data_dir: &Path) -> Result<Self> {
        let private_runtime_dir = data_dir.join("runtime-private");
        std::fs::create_dir_all(&private_runtime_dir).with_context(|| {
            format!(
                "failed to create private Runtime directory {}",
                private_runtime_dir.display()
            )
        })?;
        restrict_directory_permissions(&private_runtime_dir)?;
        remove_stale_mcp_configs(&private_runtime_dir)?;
        Ok(Self {
            active: Mutex::new(HashMap::new()),
            private_runtime_dir,
        })
    }

    pub async fn run(&self, mut request: ClaudeCodeRunRequest) -> Result<ClaudeCodeRunResult> {
        let key = (request.agent_run_id.clone(), request.execution_epoch);
        let (interrupt, interrupted) = oneshot::channel();
        let control = Arc::new(ClaudeCodeProcessControl {
            interrupt: Mutex::new(Some(interrupt)),
        });
        {
            let mut active = self.active.lock().await;
            if active.contains_key(&key) {
                anyhow::bail!("Claude Code process already exists for this AgentRun epoch");
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
        request: &ClaudeCodeRunRequest,
        interrupted: oneshot::Receiver<()>,
        launch_handoff: Option<oneshot::Sender<()>>,
    ) -> Result<ClaudeCodeRunResult> {
        let execution_root = Path::new(&request.workspace.execution_root);
        if !execution_root.is_dir() {
            anyhow::bail!(
                "Claude Code execution directory no longer exists: {}",
                execution_root.display()
            );
        }
        if let Some(root) = request.attachment_access_root.as_deref()
            && !root.is_dir()
        {
            anyhow::bail!(
                "Claude Code Camp Attachment access root is unavailable: {}",
                root.display()
            );
        }
        let executable = Path::new(&request.runtime.executable_path);
        if !executable.is_file() {
            anyhow::bail!(
                "Claude Code executable no longer exists: {}",
                executable.display()
            );
        }
        let values = request
            .runtime
            .permissions
            .values
            .as_object()
            .context("Claude Code permission configuration must be an object")?;
        let configured_mode = values
            .get("permission_mode")
            .and_then(serde_json::Value::as_str)
            .context("Claude Code requires permission_mode")?;
        if ![
            "acceptEdits",
            "auto",
            "bypassPermissions",
            "manual",
            "dontAsk",
            "plan",
        ]
        .contains(&configured_mode)
        {
            anyhow::bail!("Claude Code permission_mode has an unsupported value");
        }
        let legacy_read_only = request.permission_semantics == PermissionSemantics::CoreEnforcedV1
            && request.workspace.access == "read_only";
        let permission_mode = if legacy_read_only {
            // `plan` also suppresses Rovai-ai's explicitly pre-authorized Team
            // Tool. `dontAsk` fails closed for every action that would require
            // a prompt, while `--allowedTools` below can still admit the one
            // binding-authenticated collaboration tool.
            "dontAsk"
        } else {
            configured_mode
        };

        let native_session_id =
            if let Some(session_id) = request.resumable_native_session_id.as_deref() {
                validate_session_id(session_id)?;
                session_id.to_string()
            } else if let Some(session_id) = request.new_native_session_id.as_deref() {
                validate_session_id(session_id)?;
                session_id.to_string()
            } else {
                uuid::Uuid::new_v4().to_string()
            };
        let mut command = Command::new(executable);
        configure_active_runtime_command(&mut command);
        if let Some(config) = &request.builtin_tools {
            config.configure_command(&mut command)?;
        }
        command
            .arg("--print")
            .args(["--output-format", "stream-json"])
            .arg("--verbose")
            .arg("--include-partial-messages")
            .args(["--permission-mode", permission_mode]);
        if let Some(root) = request.attachment_access_root.as_deref() {
            command.arg("--add-dir").arg(root);
        }
        if permission_mode == "bypassPermissions" {
            command.arg("--dangerously-skip-permissions");
        }
        if legacy_read_only {
            command.arg("--disallowedTools=Edit,Write,NotebookEdit");
        }
        if request.runtime.model.source == "explicit"
            && request.runtime.model.model_id != CLAUDE_CODE_RUNTIME_DEFAULT_MODEL_ID
        {
            command.args(["--model", request.runtime.model.model_id.as_str()]);
        }
        if let Some(effort) = request
            .runtime
            .model
            .options
            .get("effort")
            .and_then(serde_json::Value::as_str)
        {
            if !["low", "medium", "high", "xhigh", "max"].contains(&effort) {
                anyhow::bail!("Claude Code effort has an unsupported value");
            }
            command.args(["--effort", effort]);
        }
        command.args(session_arguments(
            request.resumable_native_session_id.as_deref(),
            &native_session_id,
            request.session_bootstrap.as_deref(),
        ));
        if !request.persist_session {
            command.arg("--no-session-persistence").arg("--tools=");
        }
        let _external_mcp_config = if request.external_mcp_servers.is_empty() {
            None
        } else {
            let config = write_ephemeral_additive_mcp_config(
                &self.private_runtime_dir,
                &request.external_mcp_servers,
            )?;
            command.arg("--mcp-config").arg(config.path());
            Some(config)
        };
        let mut child = command
            .current_dir(execution_root)
            // Frozen context can contain user messages and local paths. Send it
            // over stdin so it never appears in `ps` or process diagnostics.
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .with_context(|| {
                format!(
                    "failed to start {} in Claude Code print mode",
                    executable.display()
                )
            })?;
        let mut stdin = child
            .stdin
            .take()
            .context("Claude Code stdin was unavailable")?;
        stdin
            .write_all(request.prompt.as_bytes())
            .await
            .context("failed to deliver frozen input to Claude Code stdin")?;
        stdin
            .shutdown()
            .await
            .context("failed to close Claude Code stdin after frozen input")?;
        drop(stdin);
        if let Some(handoff) = launch_handoff {
            let _ = handoff.send(());
        }
        let stdout = child
            .stdout
            .take()
            .context("Claude Code stdout was unavailable")?;
        let stderr = child
            .stderr
            .take()
            .context("Claude Code stderr was unavailable")?;
        let native_turn_id = format!(
            "claude-code:{}:{}",
            request.agent_run_id, request.execution_epoch
        );
        let stdout_task = tokio::spawn(capture_claude_stream(
            stdout,
            native_session_id.clone(),
            native_turn_id.clone(),
            request.input_accepted.clone(),
        ));
        let stderr_task = tokio::spawn(capture_bounded(stderr));
        tokio::pin!(interrupted);
        let mut was_interrupted = false;
        let status = tokio::select! {
            status = child.wait() => status.context("failed to wait for Claude Code process")?,
            _ = &mut interrupted => {
                was_interrupted = true;
                let _ = child.kill().await;
                child.wait().await.context("failed to reap interrupted Claude Code process")?
            }
        };
        let stdout = stdout_task
            .await
            .context("Claude Code stdout collector failed")??;
        let stderr = stderr_task
            .await
            .context("Claude Code stderr collector failed")??;
        if was_interrupted {
            anyhow::bail!("Claude Code process was interrupted");
        }
        if !status.success() {
            if explicit_mcp_config_rejection(&stderr.bytes) {
                anyhow::bail!(
                    "mcp_config.explicit_rejection: Claude Code rejected its MCP configuration"
                );
            }
            anyhow::bail!(
                "Claude Code process exited with {} (stderrBytes={}, stderrDigest={})",
                status,
                stderr.total_bytes,
                stderr.digest
            );
        }
        let output = stdout
            .final_result
            .context("Claude Code stream omitted its final result event")?;
        let final_output =
            validate_claude_terminal_result(&output, &native_session_id, &native_turn_id)?;
        Ok(ClaudeCodeRunResult {
            native_session_id,
            native_turn_id,
            final_output,
        })
    }
}

fn validate_claude_terminal_result(
    output: &ClaudeCodeJsonResult,
    native_session_id: &str,
    native_turn_id: &str,
) -> Result<String> {
    let observed_session_id = output
        .session_id
        .as_deref()
        .context("Claude Code result omitted session_id")?;
    validate_session_id(observed_session_id)?;
    if observed_session_id != native_session_id {
        anyhow::bail!(
            "Claude Code returned a different session than requested (expected {native_session_id}, observed {observed_session_id})"
        );
    }
    if output.is_error || output.subtype.as_deref() != Some("success") {
        return Err(ClaudeCodeDeliveredFailure {
            native_session_id: native_session_id.to_string(),
            native_turn_id: native_turn_id.to_string(),
            error_code: "runtime_terminal_failure",
        }
        .into());
    }
    let final_output = output.result.trim().to_string();
    if final_output.is_empty() {
        return Err(ClaudeCodeDeliveredFailure {
            native_session_id: native_session_id.to_string(),
            native_turn_id: native_turn_id.to_string(),
            error_code: "runtime_missing_final_output",
        }
        .into());
    }
    Ok(final_output)
}

fn explicit_mcp_config_rejection(stderr: &[u8]) -> bool {
    let diagnostic = String::from_utf8_lossy(stderr).to_ascii_lowercase();
    ["--mcp-config", "mcp config", "mcp configuration"]
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

#[derive(Debug, Deserialize)]
struct ClaudeCodeJsonResult {
    #[serde(default)]
    subtype: Option<String>,
    #[serde(default)]
    is_error: bool,
    #[serde(default)]
    result: String,
    #[serde(default)]
    session_id: Option<String>,
}

#[derive(Debug)]
struct ClaudeCodeStreamCapture {
    final_result: Option<ClaudeCodeJsonResult>,
}

async fn capture_claude_stream<R>(
    mut reader: R,
    expected_session_id: String,
    native_turn_id: String,
    input_accepted: Option<mpsc::UnboundedSender<ClaudeCodeInputAccepted>>,
) -> Result<ClaudeCodeStreamCapture>
where
    R: AsyncRead + Unpin,
{
    let mut line = Vec::new();
    let mut buffer = [0_u8; 16 * 1024];
    let mut final_result = None;
    let mut acceptance_emitted = false;
    loop {
        let read = reader.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        for byte in &buffer[..read] {
            if *byte == b'\n' {
                if !line.is_empty() {
                    process_claude_stream_line(
                        &line,
                        &expected_session_id,
                        &native_turn_id,
                        input_accepted.as_ref(),
                        &mut acceptance_emitted,
                        &mut final_result,
                    )?;
                    line.clear();
                }
                continue;
            }
            if line.len() >= MAX_CAPTURE_BYTES {
                anyhow::bail!(
                    "Claude Code stream event exceeded the {} byte safety limit",
                    MAX_CAPTURE_BYTES
                );
            }
            line.push(*byte);
        }
    }
    if !line.is_empty() {
        process_claude_stream_line(
            &line,
            &expected_session_id,
            &native_turn_id,
            input_accepted.as_ref(),
            &mut acceptance_emitted,
            &mut final_result,
        )?;
    }
    Ok(ClaudeCodeStreamCapture { final_result })
}

fn process_claude_stream_line(
    line: &[u8],
    expected_session_id: &str,
    native_turn_id: &str,
    input_accepted: Option<&mpsc::UnboundedSender<ClaudeCodeInputAccepted>>,
    acceptance_emitted: &mut bool,
    final_result: &mut Option<ClaudeCodeJsonResult>,
) -> Result<()> {
    let event: Value =
        serde_json::from_slice(line).context("Claude Code emitted invalid stream JSON")?;
    if !*acceptance_emitted && claude_event_proves_input_accepted(&event, expected_session_id)? {
        if let Some(sender) = input_accepted {
            let _ = sender.send(ClaudeCodeInputAccepted {
                native_session_id: expected_session_id.to_string(),
                native_turn_id: native_turn_id.to_string(),
            });
        }
        *acceptance_emitted = true;
    }
    if event.get("type").and_then(Value::as_str) == Some("result") {
        if final_result.is_some() {
            anyhow::bail!("Claude Code stream emitted more than one final result event");
        }
        *final_result = Some(
            serde_json::from_value(event).context("Claude Code final stream event was invalid")?,
        );
    }
    Ok(())
}

fn claude_event_proves_input_accepted(event: &Value, expected_session_id: &str) -> Result<bool> {
    let event_type = event.get("type").and_then(Value::as_str);
    let proves_acceptance = match event_type {
        Some("assistant") => true,
        Some("stream_event") => matches!(
            event.pointer("/event/type").and_then(Value::as_str),
            Some(
                "message_start"
                    | "content_block_start"
                    | "content_block_delta"
                    | "message_delta"
                    | "message_stop"
            )
        ),
        _ => false,
    };
    if !proves_acceptance {
        return Ok(false);
    }
    let observed_session_id = event
        .get("session_id")
        .and_then(Value::as_str)
        .context("Claude Code accepted-input event omitted session_id")?;
    validate_session_id(observed_session_id)?;
    if observed_session_id != expected_session_id {
        anyhow::bail!(
            "Claude Code accepted-input event targeted another session (expected {expected_session_id}, observed {observed_session_id})"
        );
    }
    Ok(true)
}

#[derive(Debug)]
struct CapturedBytes {
    bytes: Vec<u8>,
    total_bytes: usize,
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
        bytes,
        total_bytes,
        digest: format!("sha256:{:x}", digest.finalize()),
    })
}

fn validate_session_id(value: &str) -> Result<()> {
    uuid::Uuid::parse_str(value).with_context(|| "Claude Code session identifier is not a UUID")?;
    Ok(())
}

fn session_arguments(
    resumable_session_id: Option<&str>,
    native_session_id: &str,
    session_bootstrap: Option<&str>,
) -> Vec<String> {
    let mut arguments = if let Some(session_id) = resumable_session_id {
        vec!["--resume".to_string(), session_id.to_string()]
    } else {
        vec!["--session-id".to_string(), native_session_id.to_string()]
    };
    if let Some(bootstrap) = session_bootstrap {
        arguments.push("--append-system-prompt".to_string());
        arguments.push(bootstrap.to_string());
    }
    arguments
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::io::AsyncWriteExt;

    #[test]
    fn accepts_only_uuid_session_identifiers() {
        assert!(validate_session_id("0bdd2166-d420-40c6-94be-70b93eb290c5").is_ok());
        assert!(validate_session_id("latest").is_err());
    }

    #[test]
    fn appends_complete_bootstrap_for_new_and_resumed_sessions() {
        assert_eq!(
            session_arguments(None, "new-id", Some("bootstrap-new")),
            vec![
                "--session-id",
                "new-id",
                "--append-system-prompt",
                "bootstrap-new",
            ]
        );
        assert_eq!(
            session_arguments(Some("resume-id"), "unused", Some("bootstrap-latest")),
            vec![
                "--resume",
                "resume-id",
                "--append-system-prompt",
                "bootstrap-latest",
            ]
        );
    }

    #[test]
    fn only_session_bound_model_events_prove_input_acceptance() {
        let session_id = "0bdd2166-d420-40c6-94be-70b93eb290c5";
        assert!(
            !claude_event_proves_input_accepted(
                &json!({
                    "type": "system",
                    "subtype": "init",
                    "session_id": session_id
                }),
                session_id,
            )
            .unwrap(),
            "process initialization is not model input acceptance"
        );
        assert!(
            claude_event_proves_input_accepted(
                &json!({
                    "type": "stream_event",
                    "session_id": session_id,
                    "event": {"type": "message_start"}
                }),
                session_id,
            )
            .unwrap()
        );
        assert!(
            claude_event_proves_input_accepted(
                &json!({"type": "assistant", "session_id": session_id}),
                session_id,
            )
            .unwrap()
        );
        assert!(
            claude_event_proves_input_accepted(
                &json!({
                    "type": "assistant",
                    "session_id": "5ade59ac-f87e-4827-8cf2-0e1f3ba720ea"
                }),
                session_id,
            )
            .is_err()
        );
    }

    #[test]
    fn only_identity_matched_structured_results_create_terminal_failure_proof() {
        let session_id = "0bdd2166-d420-40c6-94be-70b93eb290c5";
        let native_turn_id = "claude-code:run-1:1";
        let terminal_failure = ClaudeCodeJsonResult {
            subtype: Some("error".to_string()),
            is_error: true,
            result: "provider detail".to_string(),
            session_id: Some(session_id.to_string()),
        };
        let error = validate_claude_terminal_result(&terminal_failure, session_id, native_turn_id)
            .expect_err("a structured non-success result should be terminal failure proof");
        let proof = error
            .downcast_ref::<ClaudeCodeDeliveredFailure>()
            .expect("the reliable failure must retain its typed proof");
        assert_eq!(proof.native_session_id, session_id);
        assert_eq!(proof.native_turn_id, native_turn_id);
        assert_eq!(proof.error_code, "runtime_terminal_failure");

        let mismatched = ClaudeCodeJsonResult {
            session_id: Some("5ade59ac-f87e-4827-8cf2-0e1f3ba720ea".to_string()),
            ..terminal_failure
        };
        let error = validate_claude_terminal_result(&mismatched, session_id, native_turn_id)
            .expect_err("a different Session must be fenced");
        assert!(error.downcast_ref::<ClaudeCodeDeliveredFailure>().is_none());
    }

    #[tokio::test]
    async fn stream_reports_acceptance_before_the_terminal_result() {
        let session_id = "0bdd2166-d420-40c6-94be-70b93eb290c5";
        let native_turn_id = "claude-code:run-1:1";
        let (mut writer, reader) = tokio::io::duplex(16 * 1024);
        let (accepted_sender, mut accepted_receiver) = mpsc::unbounded_channel();
        let (finish_sender, finish_receiver) = oneshot::channel();
        let session_id_for_writer = session_id.to_string();
        let writer_task = tokio::spawn(async move {
            for event in [
                json!({
                    "type": "system",
                    "subtype": "init",
                    "session_id": session_id_for_writer
                }),
                json!({
                    "type": "stream_event",
                    "session_id": session_id_for_writer,
                    "event": {"type": "message_start"}
                }),
            ] {
                writer
                    .write_all(format!("{event}\n").as_bytes())
                    .await
                    .unwrap();
            }
            finish_receiver.await.unwrap();
            let result = json!({
                "type": "result",
                "subtype": "success",
                "is_error": false,
                "result": "done",
                "session_id": session_id_for_writer
            });
            writer
                .write_all(format!("{result}\n").as_bytes())
                .await
                .unwrap();
        });
        let capture_task = tokio::spawn(capture_claude_stream(
            reader,
            session_id.to_string(),
            native_turn_id.to_string(),
            Some(accepted_sender),
        ));

        let accepted = tokio::time::timeout(Duration::from_secs(1), accepted_receiver.recv())
            .await
            .expect("accepted evidence should precede the terminal result")
            .expect("acceptance channel should remain open");
        assert_eq!(accepted.native_session_id, session_id);
        assert_eq!(accepted.native_turn_id, native_turn_id);
        finish_sender.send(()).unwrap();

        let captured = capture_task.await.unwrap().unwrap();
        assert_eq!(captured.final_result.unwrap().result, "done");
        writer_task.await.unwrap();
        assert!(accepted_receiver.try_recv().is_err());
    }
}
