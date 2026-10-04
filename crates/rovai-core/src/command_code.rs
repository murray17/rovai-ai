//! Command Code's headless transport. Product admission and event projection
//! remain separate from this protocol boundary.
#![allow(dead_code)] // Staged transport; Catalog dispatch waits for parity evidence.

use std::path::PathBuf;

use anyhow::{Context, Result, bail, ensure};
use serde_json::Value;
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::Command,
    sync::{mpsc, oneshot},
    task::JoinHandle,
    time::{Duration, timeout},
};

use crate::builtin_tool_runtime::BuiltinToolProcessConfig;
use crate::command_code_activity::{CommandCodeActivityNormalizer, CommandCodeRuntimeEvent};
use crate::context::{CharterDeliveryMode, PreparedContext};
use crate::managed_process::{
    ManagedProcess, ManagedProcessLaunchSpec, ManagedProcessPurpose, ManagedStdinPolicy,
    ManagedWindowsArgvDialect,
};
use crate::monitoring::{
    ParsedRuntimeUsage, RuntimeInputSemantics, RuntimeUsageCounterMode, RuntimeUsageFields,
};

const MAX_FRAME_BYTES: usize = 2 * 1024 * 1024;
// Command Code 1.64.0 serializes the full private transcript into run_end.
// Its final `result` is a separate, bounded frame and is the only terminal
// authority we consume.
const RUN_END_PREFIX: &[u8] = b"{\"type\":\"event\",\"event\":{\"type\":\"run_end\"";
const CLEANUP_TIMEOUT: Duration = Duration::from_secs(2);

/// Only native modes with real headless evidence are admitted here. This is
/// independent of workspace access and never silently changes a saved mode.
#[derive(Debug, Clone, Copy)]
pub(crate) enum CommandCodePermissionMode {
    DontAsk,
    Yolo,
}

impl CommandCodePermissionMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::DontAsk => "dont-ask",
            Self::Yolo => "yolo",
        }
    }
}

pub(crate) struct CommandCodeHeadlessRequest {
    pub executable_path: PathBuf,
    pub execution_root: PathBuf,
    /// Materialized and frozen by the shared Context owner. The transport
    /// sends `runtime_payload`, which includes Bootstrap only when the
    /// existing FirstPayload policy selected it for this input.
    pub prepared_context: PreparedContext,
    pub resume_session_id: Option<String>,
    pub model_id: Option<String>,
    pub max_turns: Option<u16>,
    pub local_only: bool,
    pub trust_project: bool,
    pub permission_mode: CommandCodePermissionMode,
    /// Shared per-Run CLI lease; secrets stay in the native process environment.
    pub builtin_tools: Option<BuiltinToolProcessConfig>,
    pub ownership: String,
    /// Only normalized public activity crosses this channel. Native
    /// `run_end.nextState` contains the private transcript.
    pub events: Option<mpsc::UnboundedSender<CommandCodeRuntimeEvent>>,
    /// Private numeric stream; never routed through public Activity/Evidence.
    pub usage_events: Option<mpsc::UnboundedSender<ParsedRuntimeUsage>>,
}

#[derive(Default)]
pub(crate) struct CommandCodeUsageObserver {
    session_id: Option<String>,
    next_call: u64,
    active_call: Option<(u64, String)>,
}

impl CommandCodeUsageObserver {
    pub(crate) fn observe(&mut self, event: &Value) -> Vec<ParsedRuntimeUsage> {
        match event["type"].as_str() {
            Some("run_start") => {
                self.session_id = event["sessionId"]
                    .as_str()
                    .filter(|id| validate_session_id(id).is_ok())
                    .map(str::to_owned);
                self.active_call = None;
                Vec::new()
            }
            Some("model_request_start") if self.session_id.is_some() => {
                self.next_call = self.next_call.saturating_add(1);
                self.active_call = event["model"]
                    .as_str()
                    .filter(|id| !id.is_empty())
                    .map(|id| (self.next_call, id.to_owned()));
                Vec::new()
            }
            Some("model_request_end") => {
                let Some((call, model)) = self.active_call.take() else {
                    return Vec::new();
                };
                if event["model"].as_str() != Some(model.as_str()) {
                    return Vec::new();
                }
                let count = |key: &str| event["usage"][key].as_i64().filter(|n| *n >= 0);
                let fields = RuntimeUsageFields {
                    input_tokens: count("inputTokens"),
                    output_tokens: count("outputTokens"),
                    cache_read_input_tokens: count("cacheReadTokens"),
                    cache_write_input_tokens: count("cacheWriteTokens"),
                    ..Default::default()
                };
                if fields.input_tokens.is_none()
                    && fields.output_tokens.is_none()
                    && fields.cache_read_input_tokens.is_none()
                    && fields.cache_write_input_tokens.is_none()
                {
                    return Vec::new();
                }
                let usage = ParsedRuntimeUsage {
                    identity_suffix: format!("model-call:{call}"),
                    dialect_id: "command-code-native-model-usage-v1".into(),
                    source: "runtime_event".into(),
                    scope: "model_call".into(),
                    counter_mode: RuntimeUsageCounterMode::Delta,
                    input_semantics: RuntimeInputSemantics::CacheInclusiveTotal,
                    native_session_id: self.session_id.clone(),
                    native_turn_id: None,
                    fields,
                    cost: None,
                    context_model_id: None,
                    occurred_at: Some(chrono::Utc::now().to_rfc3339()),
                };
                let mut observations = vec![usage.clone()];
                if let Some(used) = usage.fields.input_tokens {
                    observations.push(ParsedRuntimeUsage {
                        identity_suffix: format!("model-call:{call}:context"),
                        dialect_id: "command-code-native-model-context-v1".into(),
                        scope: "session".into(),
                        counter_mode: RuntimeUsageCounterMode::Gauge,
                        input_semantics: RuntimeInputSemantics::Unknown,
                        fields: RuntimeUsageFields {
                            context_used_tokens: Some(used),
                            ..Default::default()
                        },
                        context_model_id: Some(model),
                        ..usage
                    });
                }
                observations
            }
            // turn_end and result restate model_request_end. run_end contains
            // the private transcript; child-agent wrappers are not root calls.
            _ => Vec::new(),
        }
    }
}

#[derive(Debug)]
pub(crate) struct CommandCodeHeadlessResult {
    pub session_id: String,
    pub final_text: String,
    pub stop_reason: Option<String>,
    pub usage: Value,
    /// `turn_start` proves the native loop entered a model turn. It does not
    /// establish transcript durability or an application-level input ACK.
    pub turn_started: bool,
}

#[derive(Debug)]
struct TerminalFrame {
    subtype: String,
    session_id: Option<String>,
    final_text: String,
    stop_reason: Option<String>,
    usage: Value,
}

#[derive(Debug)]
pub(crate) struct CommandCodeHeadlessDecoder {
    expected_session_id: Option<String>,
    observed_session_id: Option<String>,
    terminal: Option<TerminalFrame>,
    turn_started: bool,
}

impl CommandCodeHeadlessDecoder {
    pub(crate) fn new(expected_session_id: Option<&str>) -> Result<Self> {
        if let Some(id) = expected_session_id {
            validate_session_id(id)?;
        }
        Ok(Self {
            expected_session_id: expected_session_id.map(str::to_owned),
            observed_session_id: None,
            terminal: None,
            turn_started: false,
        })
    }

    /// Returns a native event for an internal consumer. A final result is
    /// deliberately withheld: it alone controls the terminal outcome.
    pub(crate) fn consume_line(&mut self, line: &[u8]) -> Result<Option<Value>> {
        ensure!(
            self.terminal.is_none(),
            "Command Code emitted data after its final result"
        );
        if line.starts_with(RUN_END_PREFIX) {
            return Ok(None);
        }
        ensure!(
            line.len() <= MAX_FRAME_BYTES,
            "Command Code frame exceeds the size limit"
        );
        let frame: Value =
            serde_json::from_slice(line).context("Command Code emitted invalid NDJSON")?;
        match frame.get("type").and_then(Value::as_str) {
            Some("event") => {
                let event = frame
                    .get("event")
                    .filter(|event| event.is_object())
                    .context("Command Code event frame omitted its event object")?;
                let event_type = event
                    .get("type")
                    .and_then(Value::as_str)
                    .context("Command Code event omitted its type")?;
                if event_type == "run_start" {
                    let id = required_session_id(event.get("sessionId"))?;
                    self.observe_session(id)?;
                } else if event_type == "turn_start" {
                    ensure!(
                        self.observed_session_id.is_some(),
                        "Command Code began a turn before identifying its session"
                    );
                    self.turn_started = true;
                }
                Ok(Some(event.clone()))
            }
            Some("result") => {
                let subtype = frame
                    .get("subtype")
                    .and_then(Value::as_str)
                    .filter(|value| matches!(*value, "success" | "error" | "max_turns"))
                    .context("Command Code result has an unknown subtype")?;
                let final_text = frame
                    .get("finalText")
                    .and_then(Value::as_str)
                    .context("Command Code result omitted finalText")?;
                let usage = frame
                    .get("usage")
                    .filter(|usage| usage.is_object())
                    .context("Command Code result omitted usage")?;
                let _duration_ms = frame
                    .get("durationMs")
                    .and_then(Value::as_u64)
                    .context("Command Code result omitted durationMs")?;
                let session_id = match frame.get("sessionId") {
                    None => None,
                    Some(value) => Some(required_session_id(Some(value))?.to_owned()),
                };
                if let Some(id) = session_id.as_deref() {
                    self.observe_session(id)?;
                }
                self.terminal = Some(TerminalFrame {
                    subtype: subtype.to_owned(),
                    session_id,
                    final_text: final_text.to_owned(),
                    stop_reason: frame
                        .get("stopReason")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                    usage: usage.clone(),
                });
                Ok(None)
            }
            _ => bail!("Command Code emitted an unknown frame type"),
        }
    }

    fn observe_session(&mut self, id: &str) -> Result<()> {
        if let Some(expected) = self.expected_session_id.as_deref() {
            ensure!(
                id == expected,
                "Command Code resumed a different native session"
            );
        }
        if let Some(observed) = self.observed_session_id.as_deref() {
            ensure!(
                id == observed,
                "Command Code changed native session within one run"
            );
        }
        self.observed_session_id = Some(id.to_owned());
        Ok(())
    }

    fn finish(self, exit_success: bool) -> Result<CommandCodeHeadlessResult> {
        let terminal = self
            .terminal
            .context("Command Code omitted the final result frame")?;
        ensure!(
            exit_success && terminal.subtype == "success",
            "Command Code ended with subtype={}",
            terminal.subtype,
        );
        let session_id = terminal
            .session_id
            .context("Command Code success result omitted sessionId")?;
        ensure!(
            self.turn_started,
            "Command Code succeeded without a native turn_start"
        );
        Ok(CommandCodeHeadlessResult {
            session_id,
            final_text: terminal.final_text,
            stop_reason: terminal.stop_reason,
            usage: terminal.usage,
            turn_started: self.turn_started,
        })
    }
}

fn required_session_id(value: Option<&Value>) -> Result<&str> {
    let id = value
        .and_then(Value::as_str)
        .context("Command Code omitted a native session ID")?;
    validate_session_id(id)?;
    Ok(id)
}

fn validate_session_id(id: &str) -> Result<()> {
    // `--resume` also accepts unique prefixes and transcript paths. Rovai
    // only reuses the complete canonical UUID returned by `result.sessionId`.
    let parsed =
        uuid::Uuid::parse_str(id).context("Command Code returned an invalid native session ID")?;
    ensure!(
        parsed.hyphenated().to_string() == id,
        "Command Code native session ID is not a complete canonical UUID"
    );
    Ok(())
}

fn command_for(request: &CommandCodeHeadlessRequest) -> Result<Command> {
    ensure!(
        request.prepared_context.charter_delivery_mode == CharterDeliveryMode::FirstPayload,
        "Command Code requires first_payload context delivery"
    );
    ensure!(
        !request.prepared_context.runtime_payload.trim().is_empty(),
        "Command Code prompt is empty"
    );
    ensure!(
        !request.ownership.trim().is_empty(),
        "Command Code ownership is empty"
    );
    if let Some(id) = request.resume_session_id.as_deref() {
        validate_session_id(id)?;
    }
    let mut command = Command::new(&request.executable_path);
    command
        .arg("--print")
        .args(["--output-format", "json"])
        .arg("--no-auto-update")
        .args(["--permission-mode", request.permission_mode.as_str()]);
    if let Some(config) = request.builtin_tools.as_ref() {
        config.configure_command(&mut command)?;
    }
    if request.trust_project {
        command.arg("--trust");
    }
    if request.local_only {
        command.arg("--local-only");
    }
    if let Some(model) = request.model_id.as_deref() {
        ensure!(
            !model.is_empty()
                && model.len() <= 256
                && model.as_bytes()[0].is_ascii_alphanumeric()
                && model.bytes().all(|byte| {
                    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'/' | b':')
                }),
            "Command Code model ID is invalid"
        );
        command.args(["--model", model]);
    }
    if let Some(turns) = request.max_turns {
        ensure!(turns > 0, "Command Code max turns must be positive");
        command.args(["--max-turns", &turns.to_string()]);
    }
    if let Some(id) = request.resume_session_id.as_deref() {
        command.args(["--resume", id]);
    }
    command.current_dir(&request.execution_root);
    Ok(command)
}

/// Runs a single headless turn through the shared process owner. This
/// transport is not a Product Runtime adapter: it consumes the shared frozen
/// Context input but does not materialize Context or project Skills, MCP,
/// Tool actions, or permission approvals. The caller owns the selected native
/// permission mode and any Built-in CLI lease.
pub(crate) async fn run_headless(
    request: CommandCodeHeadlessRequest,
    interrupted: oneshot::Receiver<()>,
) -> Result<CommandCodeHeadlessResult> {
    let command = command_for(&request)?;
    let spec = ManagedProcessLaunchSpec::capture(
        &command,
        ManagedProcessPurpose::RuntimeOneShot,
        ManagedStdinPolicy::Piped,
        ManagedWindowsArgvDialect::MicrosoftCrt,
        request.ownership,
    )?;
    let mut child = ManagedProcess::spawn(spec)?;
    let mut stdin = child
        .take_stdin()
        .context("Command Code stdin unavailable")?;
    let stdout = child
        .take_stdout()
        .context("Command Code stdout unavailable")?;
    let stderr = child
        .take_stderr()
        .context("Command Code stderr unavailable")?;
    let expected_session_id = request.resume_session_id;
    let stdout_task = tokio::spawn(async move {
        capture_stdout(
            stdout,
            expected_session_id.as_deref(),
            request.events,
            request.usage_events,
        )
        .await
    });
    let stderr_task = tokio::spawn(capture_stderr(stderr));
    // Some runtimes emit their startup frames before draining stdin. All
    // pipes must run concurrently, including cancellation during a large write.
    let stdin_task = tokio::spawn(async move {
        stdin
            .write_all(request.prepared_context.runtime_payload.as_bytes())
            .await
            .context("failed to write Command Code input")?;
        stdin
            .shutdown()
            .await
            .context("failed to close Command Code input")
    });
    let mut tasks = CommandCodeIoTasks {
        stdin: stdin_task,
        stdout: stdout_task,
        stderr: stderr_task,
    };
    tokio::pin!(interrupted);
    let mut stdin_result = None;
    let mut stdout_result = None;
    let mut stderr_result = None;
    let outcome = loop {
        tokio::select! {
            status = child.wait() => break status.context("failed to wait for Command Code"),
            result = &mut tasks.stdin, if stdin_result.is_none() => {
                match result.context("Command Code stdin writer failed").and_then(|value| value) {
                    Ok(()) => stdin_result = Some(()),
                    Err(error) => break Err(error),
                }
            }
            result = &mut tasks.stdout, if stdout_result.is_none() => {
                match result.context("Command Code stdout collector failed").and_then(|value| value) {
                    Ok(value) => stdout_result = Some(value),
                    Err(error) => break Err(error),
                }
            }
            result = &mut tasks.stderr, if stderr_result.is_none() => {
                match result.context("Command Code stderr collector failed").and_then(|value| value) {
                    Ok(value) => stderr_result = Some(value),
                    Err(error) => break Err(error),
                }
            }
            _ = &mut interrupted => break Err(anyhow::anyhow!("Command Code was interrupted")),
        }
    };
    // Settle the whole owned tree even after a nominally successful root exit.
    // Collector errors and cancellation share this path; no detached reader or
    // writer task may retain a pipe after the transport returns.
    child
        .force_terminate_tree()
        .context("failed to stop Command Code process tree")?;
    timeout(CLEANUP_TIMEOUT, child.wait())
        .await
        .context("Command Code process reap timed out")??;
    #[cfg(windows)]
    timeout(CLEANUP_TIMEOUT, async {
        while !child.tree_is_empty()? {
            child.force_terminate_tree()?;
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        Ok::<(), anyhow::Error>(())
    })
    .await
    .context("Command Code process tree cleanup timed out")??;
    let status = outcome?;
    if stdin_result.is_none() {
        timeout(CLEANUP_TIMEOUT, &mut tasks.stdin)
            .await
            .context("Command Code stdin did not settle")?
            .context("Command Code stdin writer failed")??;
    }
    let decoded = match stdout_result {
        Some(value) => value,
        None => timeout(CLEANUP_TIMEOUT, &mut tasks.stdout)
            .await
            .context("Command Code stdout did not settle")?
            .context("Command Code stdout collector failed")??,
    };
    let stderr_bytes = match stderr_result {
        Some(value) => value,
        None => timeout(CLEANUP_TIMEOUT, &mut tasks.stderr)
            .await
            .context("Command Code stderr did not settle")?
            .context("Command Code stderr collector failed")??,
    };
    decoded
        .finish(status.success())
        .with_context(|| format!("Command Code exited with {status}; stderrBytes={stderr_bytes}"))
}

struct CommandCodeIoTasks {
    stdin: JoinHandle<Result<()>>,
    stdout: JoinHandle<Result<CommandCodeHeadlessDecoder>>,
    stderr: JoinHandle<Result<usize>>,
}

impl Drop for CommandCodeIoTasks {
    fn drop(&mut self) {
        self.stdin.abort();
        self.stdout.abort();
        self.stderr.abort();
    }
}

async fn capture_stdout(
    mut stdout: impl AsyncRead + Unpin,
    expected_session_id: Option<&str>,
    events: Option<mpsc::UnboundedSender<CommandCodeRuntimeEvent>>,
    usage_events: Option<mpsc::UnboundedSender<ParsedRuntimeUsage>>,
) -> Result<CommandCodeHeadlessDecoder> {
    let mut decoder = CommandCodeHeadlessDecoder::new(expected_session_id)?;
    let mut activity = CommandCodeActivityNormalizer::default();
    let mut usage = CommandCodeUsageObserver::default();
    let mut buffer = [0u8; 8192];
    let mut line = Vec::new();
    let mut skip_run_end = false;
    loop {
        let count = stdout.read(&mut buffer).await?;
        if count == 0 {
            break;
        }
        for &byte in &buffer[..count] {
            if byte == b'\n' {
                if skip_run_end {
                    skip_run_end = false;
                    line.clear();
                } else if !line.is_empty() {
                    if let Some(event) = decoder.consume_line(&line)? {
                        for observation in usage.observe(&event) {
                            if let Some(sender) = &usage_events {
                                let _ = sender.send(observation);
                            }
                        }
                        for normalized in activity.observe(&event)? {
                            if let Some(sender) = events.as_ref() {
                                let _ = sender.send(normalized);
                            }
                        }
                    }
                    line.clear();
                }
            } else if !skip_run_end {
                if line.len() == MAX_FRAME_BYTES {
                    ensure!(
                        line.starts_with(RUN_END_PREFIX),
                        "Command Code frame exceeds the size limit"
                    );
                    skip_run_end = true;
                    line.clear();
                    continue;
                }
                line.push(byte);
            }
        }
    }
    ensure!(!skip_run_end, "Command Code truncated its run_end frame");
    if !line.is_empty()
        && let Some(event) = decoder.consume_line(&line)?
    {
        for observation in usage.observe(&event) {
            if let Some(sender) = &usage_events {
                let _ = sender.send(observation);
            }
        }
        for normalized in activity.observe(&event)? {
            if let Some(sender) = events.as_ref() {
                let _ = sender.send(normalized);
            }
        }
    }
    Ok(decoder)
}

async fn capture_stderr(mut stderr: impl AsyncRead + Unpin) -> Result<usize> {
    let mut buffer = [0u8; 8192];
    let mut total_bytes = 0usize;
    loop {
        let count = stderr.read(&mut buffer).await?;
        if count == 0 {
            break;
        }
        total_bytes = total_bytes.saturating_add(count);
    }
    Ok(total_bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Root call framing owns deduplication: turn/result restatements and child
    // wrappers cannot prove a new call. Pure events are the lowest-cost owner.
    #[test]
    fn usage_counts_root_calls_once_and_keeps_context_separate() {
        use serde_json::json;
        let mut observer = CommandCodeUsageObserver::default();
        observer.observe(
            &json!({"type":"run_start","sessionId":"11111111-1111-4111-8111-111111111111"}),
        );
        let mut calls = Vec::new();
        for (input, read, output) in [(12075, 0, 115), (12205, 11904, 185), (12319, 11904, 120)] {
            observer.observe(&json!({"type":"model_request_start","model":"sub2api/gpt-6-sol"}));
            let end = json!({"type":"model_request_end","model":"sub2api/gpt-6-sol","usage":{"inputTokens":input,"outputTokens":output,"cacheReadTokens":read,"cacheWriteTokens":0}});
            let parsed = observer.observe(&end);
            assert_eq!(parsed.len(), 2);
            assert_eq!(parsed[0].scope, "model_call");
            assert_eq!(parsed[1].fields.context_used_tokens, Some(input));
            assert_eq!(parsed[1].fields.context_size_tokens, None);
            assert_eq!(parsed[1].fields.input_tokens, None);
            assert_eq!(parsed[0].fields.reasoning_output_tokens, None);
            assert_eq!(parsed[0].cost, None);
            calls.push(parsed[0].clone());
            assert!(observer.observe(&end).is_empty());
            for kind in ["turn_end", "result", "child_event"] {
                let mut replay = end.clone();
                replay["type"] = json!(kind);
                assert!(observer.observe(&replay).is_empty());
            }
        }
        assert_eq!(
            calls
                .iter()
                .map(|u| u.fields.input_tokens.unwrap())
                .sum::<i64>(),
            36599
        );
        assert_eq!(
            calls
                .iter()
                .map(|u| u.fields.output_tokens.unwrap())
                .sum::<i64>(),
            420
        );
        assert_eq!(
            calls
                .iter()
                .map(|u| u.fields.cache_read_input_tokens.unwrap())
                .sum::<i64>(),
            23808
        );
        observer.observe(&json!({"type":"model_request_start","model":"sub2api/gpt-6-sol"}));
        let sparse = observer.observe(&json!({"type":"model_request_end","model":"sub2api/gpt-6-sol","usage":{"outputTokens":0,"inputTokens":-1,"cacheReadTokens":"0"}}));
        assert_eq!(sparse.len(), 1);
        assert_eq!(sparse[0].fields.output_tokens, Some(0));
        assert_eq!(sparse[0].fields.input_tokens, None);
        assert_eq!(sparse[0].fields.cache_read_input_tokens, None);
        observer.observe(&json!({"type":"model_request_start","model":"model-a"}));
        assert!(
            observer
                .observe(
                    &json!({"type":"model_request_end","model":"model-b","usage":{"inputTokens":1}})
                )
                .is_empty()
        );
    }

    #[test]
    fn headless_decoder_fences_session_and_terminal_outcome() {
        assert!(CommandCodeHeadlessDecoder::new(Some("11111111")).is_err());
        let mut stream =
            CommandCodeHeadlessDecoder::new(Some("11111111-1111-4111-8111-111111111111")).unwrap();
        assert!(
            stream
                .consume_line(
                    br#"{"type":"event","event":{"type":"run_start","sessionId":"11111111-1111-4111-8111-111111111111"}}"#
                )
                .unwrap()
                .is_some()
        );
        assert!(
            stream
                .consume_line(br#"{"type":"event","event":{"type":"turn_start","turnNumber":1}}"#)
                .unwrap()
                .is_some()
        );
        stream.consume_line(br#"{"type":"result","subtype":"success","sessionId":"11111111-1111-4111-8111-111111111111","stopReason":"end_turn","usage":{},"durationMs":5,"finalText":"done"}"#).unwrap();
        let result = stream.finish(true).unwrap();
        assert_eq!(result.session_id, "11111111-1111-4111-8111-111111111111");
        assert_eq!(result.final_text, "done");

        let mut crossed =
            CommandCodeHeadlessDecoder::new(Some("11111111-1111-4111-8111-111111111111")).unwrap();
        assert!(
            crossed
                .consume_line(
                    br#"{"type":"event","event":{"type":"run_start","sessionId":"22222222-2222-4222-8222-222222222222"}}"#
                )
                .is_err()
        );

        let mut early_auth = CommandCodeHeadlessDecoder::new(None).unwrap();
        early_auth.consume_line(br#"{"type":"result","subtype":"error","usage":{},"durationMs":0,"finalText":"","error":"Not authenticated"}"#).unwrap();
        assert!(early_auth.finish(false).is_err());

        let mut duplicate = CommandCodeHeadlessDecoder::new(None).unwrap();
        duplicate
            .consume_line(
                br#"{"type":"result","subtype":"error","usage":{},"durationMs":0,"finalText":""}"#,
            )
            .unwrap();
        assert!(duplicate.consume_line(br#"{"type":"result","subtype":"error","usage":{},"durationMs":0,"finalText":""}"#).is_err());
    }

    // External opt-in smoke owns the real transport -> numeric stream seam;
    // deterministic framing and field matrices stay in the pure owner above.
    #[tokio::test]
    #[ignore = "requires isolated Command Code Home, BYOK credentials and ROVAI_COMMAND_CODE_SMOKE_ROOT"]
    async fn isolated_command_code_reports_live_calls_and_exact_resume_usage() {
        let root = PathBuf::from(std::env::var("ROVAI_COMMAND_CODE_SMOKE_ROOT").unwrap());
        assert!(root.is_absolute());
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("metric.txt"), "COMMAND_METRICS_VALUE\n").unwrap();
        let mut resume = None;
        for (label, prompt) in [
            (
                "first",
                "Reply exactly COMMAND_METRICS_READY without tools.",
            ),
            (
                "resumed-tools",
                "Read metric.txt, then run the command sleep 6, then reply with the value from the file.",
            ),
        ] {
            let (usage_events, mut observations) = mpsc::unbounded_channel();
            let (keep_cancel, cancelled) = oneshot::channel();
            let expected_session = resume.clone();
            let request = CommandCodeHeadlessRequest {
                executable_path: PathBuf::from(
                    std::env::var("ROVAI_COMMAND_CODE_SMOKE_EXECUTABLE").unwrap(),
                ),
                execution_root: root.clone(),
                prepared_context: PreparedContext {
                    manifest_id: "isolated-numeric-smoke".into(),
                    bootstrap_evidence_id: "isolated-numeric-smoke".into(),
                    rendered_payload: prompt.into(),
                    rendered_payload_digest: "isolated-numeric-smoke".into(),
                    runtime_payload: prompt.into(),
                    charter_delivery_mode: CharterDeliveryMode::FirstPayload,
                    bootstrap_in_runtime_payload: false,
                    bootstrap_redelivery_revision: None,
                    expected_binding_generation: 1,
                    requires_new_native_session: resume.is_none(),
                    camp_message_boundary_sequence: 0,
                    collaboration_state_digest: "isolated-numeric-smoke".into(),
                },
                resume_session_id: resume,
                model_id: Some("sub2api/gpt-6-sol".into()),
                max_turns: Some(8),
                local_only: true,
                trust_project: true,
                permission_mode: CommandCodePermissionMode::Yolo,
                builtin_tools: None,
                ownership: format!("command-code-real-metrics-{label}"),
                events: None,
                usage_events: Some(usage_events),
            };
            let running = tokio::spawn(run_headless(request, cancelled));
            let mut usage = Vec::new();
            let mut live_context = false;
            while let Some(item) = timeout(Duration::from_secs(180), observations.recv())
                .await
                .unwrap()
            {
                if item.fields.context_used_tokens.is_some_and(|used| used > 0)
                    && !running.is_finished()
                {
                    live_context = true;
                }
                eprintln!(
                    "COMMAND_METRICS {label} {}",
                    serde_json::to_string(&item).unwrap()
                );
                usage.push(item);
            }
            let result = running.await.unwrap().unwrap();
            drop(keep_cancel);
            assert!(
                live_context,
                "context did not arrive before transport completion"
            );
            if let Some(expected) = expected_session {
                assert_eq!(result.session_id, expected);
            }
            let calls: Vec<_> = usage.iter().filter(|u| u.scope == "model_call").collect();
            assert!(!calls.is_empty());
            if label == "resumed-tools" {
                assert!(calls.len() >= 2);
            }
            for (key, total) in [
                (
                    "inputTokens",
                    calls
                        .iter()
                        .map(|u| u.fields.input_tokens.unwrap())
                        .sum::<i64>(),
                ),
                (
                    "outputTokens",
                    calls
                        .iter()
                        .map(|u| u.fields.output_tokens.unwrap())
                        .sum::<i64>(),
                ),
                (
                    "cacheReadTokens",
                    calls
                        .iter()
                        .map(|u| u.fields.cache_read_input_tokens.unwrap())
                        .sum::<i64>(),
                ),
                (
                    "cacheWriteTokens",
                    calls
                        .iter()
                        .map(|u| u.fields.cache_write_input_tokens.unwrap())
                        .sum::<i64>(),
                ),
            ] {
                assert_eq!(
                    Some(total),
                    result.usage[key].as_i64(),
                    "native result did not reconcile: {key}"
                );
            }
            assert!(
                usage
                    .iter()
                    .all(|u| u.native_session_id.as_deref() == Some(result.session_id.as_str()))
            );
            resume = Some(result.session_id);
        }
    }

    #[cfg(all(unix, feature = "extended-tests"))]
    #[tokio::test]
    async fn managed_headless_process_delivers_stdin_and_exact_resume() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!(
            "rovai-command-code-transport-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir(&root).unwrap();
        let executable = root.join("fixture-command-code");
        std::fs::write(
            &executable,
            r##"#!/bin/sh
case " $* " in
  *" --print --output-format json --no-auto-update --permission-mode dont-ask --trust --local-only --model probe/fixture --max-turns 2 --resume 11111111-1111-4111-8111-111111111111 "*) ;;
  *) exit 42 ;;
esac
input=$(cat)
[ "$input" = "frozen input" ] || exit 43
printf '%s\n' '{"type":"event","event":{"type":"run_start","sessionId":"11111111-1111-4111-8111-111111111111"}}'
printf '%s\n' '{"type":"event","event":{"type":"turn_start","turnNumber":1}}'
printf '%s\n' '{"type":"event","event":{"type":"message_start"}}'
printf '%s\n' '{"type":"event","event":{"type":"text_delta","delta":"fixture done"}}'
printf '%s\n' '{"type":"event","event":{"type":"message_end","content":[{"type":"text","text":"fixture done"}]}}'
printf '%s\n' '{"type":"result","subtype":"success","sessionId":"11111111-1111-4111-8111-111111111111","stopReason":"end_turn","usage":{"inputTokens":2},"durationMs":5,"finalText":"fixture done"}'
"##,
        )
        .unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        let (cancel_tx, cancel_rx) = oneshot::channel();
        let (event_tx, mut event_rx) = mpsc::unbounded_channel();
        let make_request = |payload: String, events| CommandCodeHeadlessRequest {
            usage_events: None,
            executable_path: executable.clone(),
            execution_root: root.clone(),
            prepared_context: PreparedContext {
                manifest_id: "fixture-manifest".into(),
                bootstrap_evidence_id: "fixture-bootstrap".into(),
                rendered_payload: "dynamic input".into(),
                rendered_payload_digest: "fixture-rendered-digest".into(),
                runtime_payload: payload,
                charter_delivery_mode: CharterDeliveryMode::FirstPayload,
                bootstrap_in_runtime_payload: true,
                bootstrap_redelivery_revision: Some(1),
                expected_binding_generation: 1,
                requires_new_native_session: false,
                camp_message_boundary_sequence: 0,
                collaboration_state_digest: "fixture-collaboration-digest".into(),
            },
            resume_session_id: Some("11111111-1111-4111-8111-111111111111".into()),
            model_id: Some("probe/fixture".into()),
            max_turns: Some(2),
            local_only: true,
            trust_project: true,
            permission_mode: CommandCodePermissionMode::DontAsk,
            builtin_tools: None,
            ownership: "command-code-transport-test".into(),
            events,
        };
        let mut request = make_request("frozen input".into(), Some(event_tx));
        request.prepared_context.charter_delivery_mode = CharterDeliveryMode::NativeAppend;
        assert!(command_for(&request).is_err());
        request.prepared_context.charter_delivery_mode = CharterDeliveryMode::FirstPayload;
        let result = run_headless(request, cancel_rx).await.unwrap();
        drop(cancel_tx);
        assert_eq!(result.session_id, "11111111-1111-4111-8111-111111111111");
        assert_eq!(result.final_text, "fixture done");
        assert_eq!(result.usage["inputTokens"], 2);
        assert!(result.turn_started);
        assert_eq!(event_rx.try_recv().unwrap().event_type, "agent.text.delta");
        assert_eq!(
            event_rx.try_recv().unwrap().event_type,
            "agent.text.completed"
        );
        assert!(event_rx.try_recv().is_err());

        // Regression: a native startup can fill both output pipes before it
        // reads a prompt larger than stdin's buffer. Sequential write/read
        // deadlocks here; all three pipes must be driven concurrently.
        std::fs::write(&executable, r##"#!/bin/sh
head -c 262144 /dev/zero >&2
i=0
while [ "$i" -lt 4000 ]; do
  printf '%s\n' '{"type":"event","event":{"type":"startup_diagnostic"}}'
  i=$((i + 1))
done
count=$(wc -c)
[ "$count" -eq 1048576 ] || exit 44
printf '%s\n' '{"type":"event","event":{"type":"run_start","sessionId":"11111111-1111-4111-8111-111111111111"}}'
printf '%s\n' '{"type":"event","event":{"type":"turn_start","turnNumber":1}}'
printf '%s\n' '{"type":"result","subtype":"success","sessionId":"11111111-1111-4111-8111-111111111111","stopReason":"end_turn","usage":{},"durationMs":5,"finalText":"drained"}'
"##).unwrap();
        let (keep_cancel, cancel) = oneshot::channel();
        let result = timeout(
            Duration::from_secs(10),
            run_headless(make_request("x".repeat(1024 * 1024), None), cancel),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(result.final_text, "drained");
        drop(keep_cancel);

        // Cancellation must work while the native process never reads stdin.
        // A public marker is the handshake, so no timing sleep owns this case.
        std::fs::write(&executable, r##"#!/bin/sh
printf '%s\n' '{"type":"event","event":{"type":"run_start","sessionId":"11111111-1111-4111-8111-111111111111"}}'
printf '%s\n' '{"type":"event","event":{"type":"turn_start","turnNumber":1}}'
printf '%s\n' '{"type":"event","event":{"type":"message_start"}}'
printf '%s\n' '{"type":"event","event":{"type":"text_delta","delta":"blocked stdin"}}'
exec sleep 30
"##).unwrap();
        let (cancel, interrupted) = oneshot::channel();
        let (events, mut received) = mpsc::unbounded_channel();
        let running = tokio::spawn(run_headless(
            make_request("x".repeat(1024 * 1024), Some(events)),
            interrupted,
        ));
        assert_eq!(
            timeout(Duration::from_secs(5), received.recv())
                .await
                .unwrap()
                .unwrap()
                .event_type,
            "agent.text.delta"
        );
        cancel.send(()).unwrap();
        let error = timeout(Duration::from_secs(5), running)
            .await
            .unwrap()
            .unwrap()
            .unwrap_err();
        assert!(error.to_string().contains("interrupted"), "{error:#}");
        std::fs::remove_dir_all(root).unwrap();
    }
}
