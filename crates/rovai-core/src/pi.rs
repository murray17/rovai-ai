mod host;
mod mcp;

use std::{path::Path, time::Duration};

use anyhow::{Context, Result, bail};
use rovai_core::{
    action::{
        ActionResultOutcome, CanonicalActionInput, RuntimeActionRequestBinding,
        RuntimePermissionOption, ShellCommandTransport,
    },
    agent_profile::{AdapterKind, FrozenAgentRuntimeConfig},
    camp_attachment_view::CampAttachmentRuntimeAuthorization,
    command::canonical_json_digest,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::io::AsyncBufRead;

use crate::acp::CompletedAcpAction;

pub use host::{PiAgentRunRuntimeRequest, PiRpcRuntimeAdapter, PiRuntime};
pub(crate) use host::{PiHost, machine_ready_probe};

pub(crate) const PI_PROTOCOL_VERSION: &str = "pi-jsonl-rpc-v1";
pub(crate) const PI_HOST_EXTENSION_VERSION: &str = "rovai-pi-host-v3";
const PI_APPROVAL_SCHEMA_VERSION: i64 = 1;
pub(super) const PI_MAX_JSONL_RECORD_BYTES: usize = 4 * 1024 * 1024;
pub(super) const PI_COMMAND_TIMEOUT: Duration = Duration::from_secs(45);

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
    IngressFlushed {
        acknowledgement: tokio::sync::oneshot::Sender<()>,
    },
}

#[derive(Debug)]
pub struct InterceptedPiActionRequest {
    pub action_id: String,
    pub native_action_id: String,
    pub input: CanonicalActionInput,
    pub runtime_request: RuntimeActionRequestBinding,
    pub reason: Option<String>,
    pub mcp_envelope: Option<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PiApprovalEnvelope {
    schema_version: i64,
    extension_version: String,
    kind: String,
    host_instance_id: String,
    host_binding_generation: u64,
    agent_run_id: String,
    execution_epoch: i64,
    native_binding_generation: i64,
    tool_call_id: String,
    tool_name: String,
    input: Value,
    shell: Option<PiResolvedShell>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PiResolvedShell {
    path: String,
    args: Vec<String>,
    command_transport: PiShellCommandTransport,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum PiShellCommandTransport {
    Argv,
    Stdin,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PiBashInput {
    command: String,
    timeout: Option<f64>,
}

const PI_BASH_MAX_TIMEOUT_SECONDS: f64 = 2_147_483.647;

#[allow(clippy::too_many_arguments)]
pub fn intercepted_action_request(
    agent_run_id: &str,
    execution_epoch: i64,
    host_instance_id: &str,
    host_binding_generation: u64,
    native_binding_generation: i64,
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
    let envelope_value: Value = serde_json::from_str(
        request
            .get("message")
            .and_then(Value::as_str)
            .context("Pi Approval request has no structured envelope")?,
    )
    .context("Pi Approval request envelope is invalid")?;
    let kind = envelope_value
        .get("kind")
        .and_then(Value::as_str)
        .context("Pi Approval request omitted kind")?;
    let (tool_call_id, reason, input, mcp_envelope) = if kind == "native_tool" {
        let envelope: PiApprovalEnvelope = serde_json::from_value(envelope_value.clone())
            .context("Pi native Approval envelope is invalid")?;
        validate_common_envelope(
            envelope.schema_version,
            &envelope.extension_version,
            &envelope.kind,
            "native_tool",
            &envelope.host_instance_id,
            envelope.host_binding_generation,
            &envelope.agent_run_id,
            envelope.execution_epoch,
            envelope.native_binding_generation,
            agent_run_id,
            execution_epoch,
            host_instance_id,
            host_binding_generation,
            native_binding_generation,
        )?;
        let request_digest = canonical_json_digest(&envelope_value)?;
        let root = execution_root.to_string_lossy().to_string();
        let input = match envelope.tool_name.as_str() {
            "bash" => {
                let input: PiBashInput = serde_json::from_value(envelope.input)
                    .context("Pi bash Approval input is invalid")?;
                if input.command.trim().is_empty() {
                    bail!("Pi bash Approval request has no command");
                }
                if input.timeout.is_some_and(|timeout| {
                    !timeout.is_finite() || timeout <= 0.0 || timeout > PI_BASH_MAX_TIMEOUT_SECONDS
                }) {
                    bail!("Pi bash Approval timeout is invalid");
                }
                let shell = envelope
                    .shell
                    .context("Pi bash Approval omitted resolved shell identity")?;
                let (argv, command_transport) = canonical_pi_shell_input(shell, input)?;
                CanonicalActionInput::ShellCommand {
                    argv,
                    cwd: root,
                    environment_refs: Vec::new(),
                    command_transport: Some(command_transport),
                }
            }
            "write" | "edit" => {
                if envelope.shell.is_some() {
                    bail!("Pi file Approval unexpectedly included a shell identity");
                }
                let path = envelope
                    .input
                    .get("path")
                    .and_then(Value::as_str)
                    .filter(|value| !value.trim().is_empty())
                    .context("Pi file Approval request has no path")?;
                let path = if Path::new(path).is_absolute() {
                    Path::new(path).to_path_buf()
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
                    content_digest: request_digest,
                }
            }
            _ => bail!("Pi Approval request names an unsupported mutating native Tool"),
        };
        (
            envelope.tool_call_id,
            format!("Pi {} tool request", envelope.tool_name),
            input,
            None,
        )
    } else if kind == "mcp_tool" {
        validate_mcp_envelope_common(
            &envelope_value,
            agent_run_id,
            execution_epoch,
            host_instance_id,
            host_binding_generation,
            native_binding_generation,
        )?;
        let tool_call_id = required_string(&envelope_value, "toolCallId")?.to_string();
        let server = required_string(&envelope_value, "serverName")?.to_string();
        let tool = required_string(&envelope_value, "toolName")?.to_string();
        let arguments = envelope_value
            .get("arguments")
            .cloned()
            .context("Pi MCP Approval request omitted arguments")?;
        let expected_arguments_digest = required_string(&envelope_value, "argumentsDigest")?;
        if canonical_json_digest(&arguments)? != expected_arguments_digest {
            bail!("Pi MCP Approval arguments digest is invalid");
        }
        (
            tool_call_id,
            format!("Pi MCP {server}/{tool} Tool request"),
            CanonicalActionInput::McpTool {
                server,
                tool,
                arguments,
            },
            Some(envelope_value.clone()),
        )
    } else {
        bail!("Pi Approval request names an unknown managed kind");
    };
    let request_digest = canonical_json_digest(&envelope_value)?;
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
    let native_action_id = format!("{tool_call_id}:approval:{ui_id}");
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
            native_item_id: tool_call_id,
            native_thread_id: native_session_id.to_string(),
            native_turn_id: native_prompt_id.to_string(),
            response_context: json!({
                "schemaVersion": PI_APPROVAL_SCHEMA_VERSION,
                "extensionVersion": PI_HOST_EXTENSION_VERSION,
                "requestDigest": request_digest,
            }),
            options,
        },
        reason: Some(reason),
        mcp_envelope,
    })
}

fn canonical_pi_shell_input(
    shell: PiResolvedShell,
    input: PiBashInput,
) -> Result<(Vec<String>, ShellCommandTransport)> {
    if shell.path.trim().is_empty()
        || shell.path.contains('\0')
        || shell
            .args
            .iter()
            .any(|argument| argument.is_empty() || argument.contains('\0'))
    {
        bail!("Pi bash Approval resolved shell identity is invalid");
    }
    match shell.command_transport {
        PiShellCommandTransport::Argv => {
            if shell.args.as_slice() != ["-c"] {
                bail!("Pi bash Approval argv transport is incompatible with this Pi protocol");
            }
            let mut argv = Vec::with_capacity(shell.args.len() + 2);
            argv.push(shell.path);
            argv.extend(shell.args);
            argv.push(input.command);
            let command_index = argv.len() - 1;
            Ok((
                argv,
                ShellCommandTransport::CommandArgument {
                    command_index,
                    timeout_seconds: input.timeout,
                },
            ))
        }
        PiShellCommandTransport::Stdin => {
            if shell.args.as_slice() != ["-s"] || !is_legacy_wsl_bash_path(&shell.path) {
                bail!("Pi bash Approval stdin transport is incompatible with this Pi protocol");
            }
            let mut argv = Vec::with_capacity(shell.args.len() + 1);
            argv.push(shell.path);
            argv.extend(shell.args);
            Ok((
                argv,
                ShellCommandTransport::StandardInput {
                    command: input.command,
                    timeout_seconds: input.timeout,
                },
            ))
        }
    }
}

fn is_legacy_wsl_bash_path(value: &str) -> bool {
    let normalized = value.replace('/', "\\").to_ascii_lowercase();
    let Some(rest) = normalized.strip_prefix(|character: char| character.is_ascii_alphabetic())
    else {
        return false;
    };
    rest == ":\\windows\\system32\\bash.exe" || rest == ":\\windows\\sysnative\\bash.exe"
}

#[allow(clippy::too_many_arguments)]
fn validate_common_envelope(
    schema_version: i64,
    extension_version: &str,
    kind: &str,
    expected_kind: &str,
    observed_host: &str,
    observed_host_generation: u64,
    observed_run: &str,
    observed_epoch: i64,
    observed_binding_generation: i64,
    agent_run_id: &str,
    execution_epoch: i64,
    host_instance_id: &str,
    host_binding_generation: u64,
    native_binding_generation: i64,
) -> Result<()> {
    if schema_version != PI_APPROVAL_SCHEMA_VERSION
        || extension_version != PI_HOST_EXTENSION_VERSION
        || kind != expected_kind
        || observed_host != host_instance_id
        || observed_host_generation != host_binding_generation
        || observed_run != agent_run_id
        || observed_epoch != execution_epoch
        || observed_binding_generation != native_binding_generation
    {
        bail!("Pi managed Extension identity or binding is incompatible");
    }
    Ok(())
}

fn validate_mcp_envelope_common(
    envelope: &Value,
    agent_run_id: &str,
    execution_epoch: i64,
    host_instance_id: &str,
    host_binding_generation: u64,
    native_binding_generation: i64,
) -> Result<()> {
    validate_common_envelope(
        envelope
            .get("schemaVersion")
            .and_then(Value::as_i64)
            .context("Pi MCP envelope omitted schemaVersion")?,
        required_string(envelope, "extensionVersion")?,
        required_string(envelope, "kind")?,
        "mcp_tool",
        required_string(envelope, "hostInstanceId")?,
        envelope
            .get("hostBindingGeneration")
            .and_then(Value::as_u64)
            .context("Pi MCP envelope omitted hostBindingGeneration")?,
        required_string(envelope, "agentRunId")?,
        envelope
            .get("executionEpoch")
            .and_then(Value::as_i64)
            .context("Pi MCP envelope omitted executionEpoch")?,
        envelope
            .get("nativeBindingGeneration")
            .and_then(Value::as_i64)
            .context("Pi MCP envelope omitted nativeBindingGeneration")?,
        agent_run_id,
        execution_epoch,
        host_instance_id,
        host_binding_generation,
        native_binding_generation,
    )
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
    _attachment_authorization: &CampAttachmentRuntimeAuthorization,
) -> Result<String> {
    let cwd = cwd
        .canonicalize()
        .with_context(|| format!("failed to resolve execution root {}", cwd.display()))?;
    let executable = Path::new(&frozen_runtime.executable_path)
        .canonicalize()
        .context("failed to resolve qualified Pi executable")?;
    canonical_json_digest(&json!({
        "schemaVersion": 2,
        "adapterKind": AdapterKind::Pi,
        "protocolVersion": PI_PROTOCOL_VERSION,
        "executionRoot": cwd,
        "executablePath": executable,
        "reportedVersion": frozen_runtime.reported_version,
        "executableFingerprint": frozen_runtime.executable_fingerprint,
        "hostConfigDigest": frozen_runtime.host_config_digest,
        "managedExtensionVersion": PI_HOST_EXTENSION_VERSION,
        "managedExtensionDigest": format!("{:x}", Sha256::digest(include_str!("pi/managed-host.ts").as_bytes())),
        "platformPermissionBoundary": canonical_json_digest(&serde_json::to_value(&frozen_runtime.permissions)?)?,
    }))
}

pub(super) fn completed_action(message: &Value) -> Result<Option<CompletedAcpAction>> {
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
        public_search_operation_candidate: None,
        public_file_operation_path: terminal_file_operation_path(message, &tool_name),
        public_file_changes: None,
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

fn terminal_file_operation_path(message: &Value, tool_name: &str) -> Option<String> {
    matches!(tool_name, "write" | "edit")
        .then(|| message.pointer("/args/path").and_then(Value::as_str))
        .flatten()
        .filter(|path| !path.trim().is_empty())
        .map(str::to_string)
}

pub(super) fn assistant_message_text(message: &Value) -> Option<String> {
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
        Some(name) if name.starts_with("mcp_") => Some("mcp_tool"),
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

pub(super) fn value_id(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::to_string)
        .or_else(|| value.as_u64().map(|value| value.to_string()))
}

pub(super) async fn read_jsonl_record<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    max_bytes: usize,
) -> Result<Option<Vec<u8>>> {
    let mut record = Vec::new();
    loop {
        let buffer = tokio::io::AsyncBufReadExt::fill_buf(reader).await?;
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
        tokio::io::AsyncBufReadExt::consume(reader, take);
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

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::BufReader;

    #[tokio::test]
    async fn jsonl_reader_preserves_unicode_line_separators() {
        let input = b"{\"value\":\"a\xE2\x80\xA8b\xE2\x80\xA9c\"}\n";
        let mut reader = BufReader::new(&input[..]);
        let record = read_jsonl_record(&mut reader, 1024).await.unwrap().unwrap();
        let value: Value = serde_json::from_slice(&record).unwrap();
        assert_eq!(value["value"], "a\u{2028}b\u{2029}c");
    }

    #[test]
    fn managed_extension_has_no_claude_provider_overlay() {
        let source = include_str!("pi/managed-host.ts");
        assert!(!source.contains("PI_CODING_AGENT_DIR"));
        assert!(!source.contains("ANTHROPIC_AUTH_TOKEN"));
        assert!(source.contains("Rovai managed input receipt"));
    }

    #[test]
    fn bash_approval_uses_the_exact_pi_shell_argv() {
        let envelope = json!({
            "schemaVersion": PI_APPROVAL_SCHEMA_VERSION,
            "extensionVersion": PI_HOST_EXTENSION_VERSION,
            "kind": "native_tool",
            "hostInstanceId": "host-1",
            "hostBindingGeneration": 4,
            "agentRunId": "run-1",
            "executionEpoch": 3,
            "nativeBindingGeneration": 5,
            "toolCallId": "tool-1",
            "toolName": "bash",
            "input": {
                "command": "printf PI_NATIVE_SHELL_OK",
                "timeout": 12.5,
            },
            "shell": {
                "path": "/bin/bash",
                "args": ["-c"],
                "commandTransport": "argv",
            },
        });
        let request = json!({
            "type": "extension_ui_request",
            "method": "confirm",
            "title": "Rovai managed approval",
            "id": "ui-1",
            "message": serde_json::to_string(&envelope).unwrap(),
        });

        let action = intercepted_action_request(
            "run-1",
            3,
            "host-1",
            4,
            5,
            "session-1",
            "prompt-1",
            Path::new("/workspace"),
            &request,
        )
        .expect("valid Pi bash request should be intercepted");

        assert_eq!(
            action.input,
            CanonicalActionInput::ShellCommand {
                argv: vec![
                    "/bin/bash".to_string(),
                    "-c".to_string(),
                    "printf PI_NATIVE_SHELL_OK".to_string(),
                ],
                cwd: "/workspace".to_string(),
                environment_refs: Vec::new(),
                command_transport: Some(ShellCommandTransport::CommandArgument {
                    command_index: 2,
                    timeout_seconds: Some(12.5),
                }),
            }
        );
        let serialized = serde_json::to_string(&action.input).unwrap();
        assert!(serialized.contains("shell_command"));
        assert!(!serialized.contains("/bin/zsh"));
        assert!(!serialized.contains("-lc"));
    }

    #[test]
    fn legacy_wsl_bash_approval_preserves_stdin_transport() {
        let envelope = json!({
            "schemaVersion": PI_APPROVAL_SCHEMA_VERSION,
            "extensionVersion": PI_HOST_EXTENSION_VERSION,
            "kind": "native_tool",
            "hostInstanceId": "host-1",
            "hostBindingGeneration": 4,
            "agentRunId": "run-1",
            "executionEpoch": 3,
            "nativeBindingGeneration": 5,
            "toolCallId": "tool-1",
            "toolName": "bash",
            "input": {"command": "pwd"},
            "shell": {
                "path": "C:\\Windows\\System32\\bash.exe",
                "args": ["-s"],
                "commandTransport": "stdin",
            },
        });
        let request = json!({
            "type": "extension_ui_request",
            "method": "confirm",
            "title": "Rovai managed approval",
            "id": "ui-1",
            "message": serde_json::to_string(&envelope).unwrap(),
        });

        let action = intercepted_action_request(
            "run-1",
            3,
            "host-1",
            4,
            5,
            "session-1",
            "prompt-1",
            Path::new("C:\\workspace"),
            &request,
        )
        .expect("valid Pi stdin shell request should be intercepted");

        assert!(matches!(
            action.input,
            CanonicalActionInput::ShellCommand {
                command_transport: Some(ShellCommandTransport::StandardInput { ref command, .. }),
                ..
            } if command == "pwd"
        ));
    }
}
