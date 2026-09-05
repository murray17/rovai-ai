mod host;

use std::{path::Path, time::Duration};

use anyhow::{Context, Result, bail};
use rovai_core::{
    action::ActionResultOutcome,
    agent_profile::{AdapterKind, FrozenAgentRuntimeConfig},
    camp_attachment_view::CampAttachmentRuntimeAuthorization,
    command::canonical_json_digest,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::io::AsyncBufRead;

use crate::acp::CompletedAcpAction;

pub(crate) use host::{
    PiActivationFailureKind, PiHost, PiPromptImage, PreparedPiPromptImage, activation_failure_kind,
    machine_ready_probe, prepare_prompt_images,
};
pub use host::{PiAgentRunRuntimeRequest, PiRpcRuntimeAdapter, PiRuntime};

pub(crate) const PI_PROTOCOL_VERSION: &str = "pi-jsonl-rpc-v1";
pub(crate) const PI_HOST_EXTENSION_VERSION: &str = "rovai-pi-host-v7";
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
    Diagnostic {
        host_instance_id: String,
        agent_run_id: Option<String>,
        execution_epoch: Option<i64>,
        phase: String,
        message: String,
    },
    IngressFlushed {
        acknowledgement: tokio::sync::oneshot::Sender<()>,
    },
}

pub fn unsupported_extension_ui_cancellation(request: &Value) -> Result<Value> {
    if request.get("type").and_then(Value::as_str) != Some("extension_ui_request") {
        bail!("Pi message is not an Extension UI request");
    }
    let id = request
        .get("id")
        .filter(|id| !id.is_null())
        .cloned()
        .context("Pi Extension UI request omitted id")?;
    Ok(
        if request.get("method").and_then(Value::as_str) == Some("confirm") {
            json!({"type": "extension_ui_response", "id": id, "confirmed": false})
        } else {
            json!({"type": "extension_ui_response", "id": id, "cancelled": true})
        },
    )
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
        Some("tool_execution_end") => {
            let is_error = message.get("isError").and_then(Value::as_bool) == Some(true);
            let tool_name = message.get("toolName").and_then(Value::as_str);
            let mut payload = json!({
                "toolCallId": message.get("toolCallId"),
                "toolName": message.get("toolName"),
                "status": if is_error { "failed" } else { "completed" },
                "kind": public_tool_kind(tool_name),
                "output": public_content_text(message.pointer("/result/content")),
            });
            if !is_error
                && let Some(tool_name) = tool_name
                && let Some((operation_kind, path)) = terminal_file_operation(message, tool_name)
            {
                payload["runtimeFileOperation"] = json!({
                    "adapterKind": "pi",
                    "protocolFamily": PI_PROTOCOL_VERSION,
                    "sourceEventKind": "tool_execution_end.completed",
                    "operationKind": operation_kind,
                    "path": path,
                });
            }
            ("runtime.action", payload)
        }
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
        "schemaVersion": 4,
        "adapterKind": AdapterKind::Pi,
        "protocolVersion": PI_PROTOCOL_VERSION,
        "executionRoot": cwd,
        "executablePath": executable,
        "reportedVersion": frozen_runtime.reported_version,
        "executableFingerprint": frozen_runtime.executable_fingerprint,
        "hostConfigDigest": frozen_runtime.host_config_digest,
        "managedExtensionVersion": PI_HOST_EXTENSION_VERSION,
        "managedExtensionDigest": format!("{:x}", Sha256::digest(include_str!("pi/managed-host.ts").as_bytes())),
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
    let file_operation = (!is_error)
        .then(|| terminal_file_operation(message, &tool_name))
        .flatten();
    Ok(Some(CompletedAcpAction {
        native_item_id,
        native_kind: public_tool_kind(Some(&tool_name))
            .unwrap_or("other")
            .to_string(),
        public_command: None,
        public_search_operation_candidate: None,
        public_file_operation_kind: file_operation
            .as_ref()
            .map(|(operation_kind, _)| operation_kind.clone()),
        public_file_operation_path: file_operation.map(|(_, path)| path),
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

fn terminal_file_operation(message: &Value, tool_name: &str) -> Option<(String, String)> {
    let operation_kind = match tool_name {
        "read" => "read",
        "write" | "edit" => "write",
        _ => return None,
    };
    let path = message
        .pointer("/args/path")
        .and_then(Value::as_str)
        .filter(|path| !path.trim().is_empty())?;
    Some((operation_kind.to_string(), path.to_string()))
}

fn reconcile_terminal_tool_message(message: &mut Value, observed: &Value) {
    let Some(message) = message.as_object_mut() else {
        return;
    };
    if !message
        .get("toolName")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty())
        && let Some(value) = observed
            .get("toolName")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
    {
        message.insert("toolName".to_string(), Value::String(value.to_string()));
    }
    if let Some(observed_args) = observed.get("args").and_then(Value::as_object) {
        if let Some(current_args) = message.get_mut("args").and_then(Value::as_object_mut) {
            for (key, value) in observed_args {
                current_args
                    .entry(key.clone())
                    .or_insert_with(|| value.clone());
            }
        } else {
            message.insert("args".to_string(), Value::Object(observed_args.clone()));
        }
    }
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
    fn managed_extension_only_reports_session_and_injects_bootstrap() {
        let source = include_str!("pi/managed-host.ts");
        assert!(!source.contains("PI_CODING_AGENT_DIR"));
        assert!(!source.contains("ANTHROPIC_AUTH_TOKEN"));
        assert!(!source.contains("mcpTools"));
        assert!(!source.contains("mcpProjectionDigest"));
        assert!(!source.contains("registerTool"));
        assert!(!source.contains("Rovai MCP bridge"));
        assert!(!source.contains("pi.setActiveTools"));
        assert!(!source.contains("resources_discover"));
        assert!(!source.contains("skillPaths"));
        assert!(!source.contains("skillRoot"));
        assert!(!source.contains("expectedManagedSkillExposureDigest"));
        assert!(!source.contains("pi.on(\"input\""));
        assert!(!source.contains("pi.on(\"tool_call\""));
        assert!(!source.contains("ctx.ui.confirm"));
        assert!(!source.contains("ctx.ui.input"));
        assert!(!source.contains("ctx.abort"));
        assert!(!source.contains("pi.getAllTools"));
        assert!(!source.contains("GOVERNED_NATIVE_TOOLS"));
        assert!(!source.contains("SettingsManager"));
        assert!(!source.contains("getAgentDir"));
        assert!(!source.contains("getShellConfig"));
        assert!(!source.contains("Rovai partial approval"));
        assert!(!source.contains("Rovai managed input receipt"));
        assert!(!source.contains("approvedBindingDigest"));
        assert_eq!(source.matches("pi.on(").count(), 2);
        assert!(source.contains("pi.on(\"session_start\""));
        assert!(source.contains("pi.on(\"before_agent_start\""));
        assert!(source.contains("const current = loadBinding()"));
        assert!(source.contains("`${event.systemPrompt}\\n\\n${current.bootstrap}`"));
    }

    #[test]
    fn terminal_file_tools_emit_bounded_read_and_write_operations() {
        for (tool_name, operation_kind) in [("read", "read"), ("write", "write"), ("edit", "write")]
        {
            let (_, payload) = normalize_event(&json!({
                "type": "tool_execution_end",
                "toolCallId": format!("tool-{tool_name}"),
                "toolName": tool_name,
                "args": {"path": "/repo/src/app.ts"},
                "isError": false,
                "result": {"content": [{"type":"text","text":"done"}]}
            }));
            assert_eq!(
                payload["runtimeFileOperation"]["operationKind"],
                operation_kind
            );
            assert_eq!(payload["runtimeFileOperation"]["path"], "/repo/src/app.ts");
        }
        for tool_name in ["grep", "find", "ls"] {
            let (_, payload) = normalize_event(&json!({
                "type": "tool_execution_end",
                "toolCallId": format!("tool-{tool_name}"),
                "toolName": tool_name,
                "args": {"path": "/repo/src/app.ts"},
                "isError": false
            }));
            assert!(payload.get("runtimeFileOperation").is_none());
        }
    }

    #[test]
    fn terminal_file_tools_reuse_start_arguments_when_pi_omits_them_at_end() {
        let start = json!({
            "type": "tool_execution_start",
            "toolCallId": "tool-read",
            "toolName": "read",
            "args": {"path": "/repo/src/app.ts"}
        });
        let mut update = json!({
            "type": "tool_execution_update",
            "toolCallId": "tool-read",
            "toolName": "read",
            "args": {"line": 10}
        });
        reconcile_terminal_tool_message(&mut update, &start);
        let mut terminal = json!({
            "type": "tool_execution_end",
            "toolCallId": "tool-read",
            "isError": false,
            "result": {"content": [{"type":"text","text":"done"}]}
        });

        reconcile_terminal_tool_message(&mut terminal, &update);
        let (_, payload) = normalize_event(&terminal);

        assert_eq!(payload["runtimeFileOperation"]["operationKind"], "read");
        assert_eq!(payload["runtimeFileOperation"]["path"], "/repo/src/app.ts");
    }

    #[test]
    fn unsupported_native_extension_ui_is_cancelled_without_managed_interpretation() {
        for method in ["select", "input", "editor"] {
            let request = json!({
                "type": "extension_ui_request",
                "method": method,
                "id": format!("ui-{method}"),
                "title": "Third-party Pi Extension",
            });
            assert_eq!(
                unsupported_extension_ui_cancellation(&request).unwrap(),
                json!({
                    "type": "extension_ui_response",
                    "id": format!("ui-{method}"),
                    "cancelled": true,
                })
            );
        }
        let confirm = json!({
            "type": "extension_ui_request",
            "method": "confirm",
            "id": "ui-confirm",
            "title": "Third-party Pi Extension",
        });
        assert_eq!(
            unsupported_extension_ui_cancellation(&confirm).unwrap(),
            json!({
                "type": "extension_ui_response",
                "id": "ui-confirm",
                "confirmed": false,
            })
        );
    }
}
