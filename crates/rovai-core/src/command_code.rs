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
};

use crate::command_code_activity::{CommandCodeActivityNormalizer, CommandCodeRuntimeEvent};
use crate::managed_process::{
    ManagedProcess, ManagedProcessLaunchSpec, ManagedProcessPurpose, ManagedStdinPolicy,
    ManagedWindowsArgvDialect,
};

const MAX_FRAME_BYTES: usize = 2 * 1024 * 1024;
// Command Code 1.64.0 serializes the full private transcript into run_end.
// Its final `result` is a separate, bounded frame and is the only terminal
// authority we consume.
const RUN_END_PREFIX: &[u8] = b"{\"type\":\"event\",\"event\":{\"type\":\"run_end\"";

#[derive(Debug)]
pub(crate) struct CommandCodeHeadlessRequest {
    pub executable_path: PathBuf,
    pub execution_root: PathBuf,
    pub prompt: String,
    pub resume_session_id: Option<String>,
    pub model_id: Option<String>,
    pub max_turns: Option<u16>,
    pub local_only: bool,
    pub trust_project: bool,
    pub ownership: String,
    /// Only normalized public activity crosses this channel. Native
    /// `run_end.nextState` contains the private transcript.
    pub events: Option<mpsc::UnboundedSender<CommandCodeRuntimeEvent>>,
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
        !request.prompt.trim().is_empty(),
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
        .args(["--permission-mode", "dont-ask"]);
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
/// transport is not a Product Runtime adapter: it does not project Bootstrap,
/// Skills, MCP, Tool actions, or permission approvals.
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
    stdin.write_all(request.prompt.as_bytes()).await?;
    stdin.shutdown().await?;
    drop(stdin);

    let expected_session_id = request.resume_session_id;
    let mut stdout_task = tokio::spawn(async move {
        capture_stdout(stdout, expected_session_id.as_deref(), request.events).await
    });
    let mut stderr_task = tokio::spawn(capture_stderr(stderr));
    tokio::pin!(interrupted);
    let mut stdout_result = None;
    let mut stderr_result = None;
    let (status, was_interrupted) = loop {
        tokio::select! {
            status = child.wait() => break (status.context("failed to wait for Command Code")?, false),
            result = &mut stdout_task, if stdout_result.is_none() => {
                match result.context("Command Code stdout collector failed")? {
                    Ok(value) => stdout_result = Some(value),
                    Err(error) => {
                        let _ = child.force_terminate_tree();
                        let _ = child.wait().await;
                        return Err(error);
                    }
                }
            }
            result = &mut stderr_task, if stderr_result.is_none() => {
                match result.context("Command Code stderr collector failed")? {
                    Ok(value) => stderr_result = Some(value),
                    Err(error) => {
                        let _ = child.force_terminate_tree();
                        let _ = child.wait().await;
                        return Err(error);
                    }
                }
            }
            _ = &mut interrupted => {
                child.force_terminate_tree()?;
                break (child.wait().await.context("failed to reap Command Code")?, true);
            }
        }
    };
    let _ = child.force_terminate_tree();
    let decoded = match stdout_result {
        Some(value) => value,
        None => stdout_task
            .await
            .context("Command Code stdout collector failed")??,
    };
    let stderr_bytes = match stderr_result {
        Some(value) => value,
        None => stderr_task
            .await
            .context("Command Code stderr collector failed")??,
    };
    ensure!(!was_interrupted, "Command Code was interrupted");
    decoded
        .finish(status.success())
        .with_context(|| format!("Command Code exited with {status}; stderrBytes={stderr_bytes}"))
}

async fn capture_stdout(
    mut stdout: impl AsyncRead + Unpin,
    expected_session_id: Option<&str>,
    events: Option<mpsc::UnboundedSender<CommandCodeRuntimeEvent>>,
) -> Result<CommandCodeHeadlessDecoder> {
    let mut decoder = CommandCodeHeadlessDecoder::new(expected_session_id)?;
    let mut activity = CommandCodeActivityNormalizer::default();
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
        let result = run_headless(
            CommandCodeHeadlessRequest {
                executable_path: executable,
                execution_root: root.clone(),
                prompt: "frozen input".into(),
                resume_session_id: Some("11111111-1111-4111-8111-111111111111".into()),
                model_id: Some("probe/fixture".into()),
                max_turns: Some(2),
                local_only: true,
                trust_project: true,
                ownership: "command-code-transport-test".into(),
                events: Some(event_tx),
            },
            cancel_rx,
        )
        .await
        .unwrap();
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
        std::fs::remove_dir_all(root).unwrap();
    }
}
