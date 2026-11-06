mod host;
mod interactions;

use std::{fmt, path::Path, time::Duration};

use anyhow::{Context, Result, bail};
use rovai_core::{
    action::ActionResultOutcome,
    agent_profile::{AdapterKind, FrozenAgentRuntimeConfig},
    command::canonical_json_digest,
    runtime_failure::{RuntimeFailureOrigin, RuntimeFailurePhase, RuntimeFailureView},
    storage_layout::ThreadOutputDirectory,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::io::AsyncBufRead;

use crate::acp::CompletedAcpAction;

pub(crate) use host::{
    PiActivationFailureKind, PiHost, PiPromptImage, PreparedPiPromptImage, activation_failure_kind,
    machine_ready_probe, model_catalog_probe, prepare_prompt_images,
};
pub use host::{PiAgentRunRuntimeRequest, PiRpcRuntimeAdapter, PiRuntime};

pub(crate) const PI_PROTOCOL_VERSION: &str = "pi-jsonl-rpc-v1";
pub(crate) const PI_HOST_EXTENSION_VERSION: &str = "rovai-pi-host-v8";
// Pi image results may include the same base64 data in content and structuredContent.
// Receive and send budgets are independent; stderr retains its own smaller limit.
pub(super) const PI_MAX_INBOUND_RECORD_BYTES: usize = 64 * 1024 * 1024;
pub(super) const PI_MAX_OUTBOUND_RECORD_BYTES: usize = 4 * 1024 * 1024;
pub(super) const PI_COMMAND_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PiTransportFailure {
    FrameTooLarge {
        limit_bytes: usize,
        observed_bytes: usize,
    },
    ProtocolViolation,
    ReadFailed,
}

impl PiTransportFailure {
    pub fn public_failure(self) -> RuntimeFailureView {
        let (origin, code, summary) = match self {
            Self::FrameTooLarge { .. } => (
                RuntimeFailureOrigin::Rovai,
                "pi_rpc_frame_too_large",
                "Pi 返回消息超出接收上限",
            ),
            Self::ProtocolViolation => (
                RuntimeFailureOrigin::Compatibility,
                "pi_rpc_protocol_error",
                "Pi 返回了不兼容的协议消息",
            ),
            Self::ReadFailed => (
                RuntimeFailureOrigin::Environment,
                "pi_rpc_read_failed",
                "无法读取 Pi 运行连接",
            ),
        };
        RuntimeFailureView::new(
            AdapterKind::Pi,
            origin,
            RuntimeFailurePhase::Execution,
            code,
            summary,
            Some(self.to_string()),
            false,
        )
    }
}

impl fmt::Display for PiTransportFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::FrameTooLarge {
                limit_bytes,
                observed_bytes,
            } => write!(
                formatter,
                "Pi RPC frame exceeds the receive limit: at least {observed_bytes} bytes, limit {limit_bytes} bytes"
            ),
            Self::ProtocolViolation => formatter.write_str("Pi RPC protocol validation failed"),
            Self::ReadFailed => formatter.write_str("Pi RPC stdout could not be read"),
        }
    }
}

impl std::error::Error for PiTransportFailure {}

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
        received_at: i64,
        message: Value,
    },
    Exited {
        host_instance_id: String,
        agent_run_id: String,
        execution_epoch: i64,
        failure: Option<PiTransportFailure>,
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
    Ok(json!({"type": "extension_ui_response", "id": id, "cancelled": true}))
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
        Some("message_update")
            if message
                .pointer("/assistantMessageEvent/type")
                .and_then(Value::as_str)
                == Some("thinking_delta") =>
        {
            (
                "agent.thought.delta",
                json!({
                    "delta": message.pointer("/assistantMessageEvent/delta").and_then(Value::as_str).unwrap_or(""),
                    "contentIndex": message.pointer("/assistantMessageEvent/contentIndex"),
                }),
            )
        }
        Some("message_update")
            if matches!(
                message
                    .pointer("/assistantMessageEvent/type")
                    .and_then(Value::as_str),
                Some("thinking_start" | "thinking_end")
            ) =>
        {
            let event = if message
                .pointer("/assistantMessageEvent/type")
                .and_then(Value::as_str)
                == Some("thinking_start")
            {
                "agent.thought.started"
            } else {
                "agent.thought.completed"
            };
            (
                event,
                json!({"contentIndex": message.pointer("/assistantMessageEvent/contentIndex")}),
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
                "runtimePhaseBoundary": false,
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
            if !is_error
                && tool_name == Some("edit")
                && let Some((path, patch)) = terminal_edit_patch(message)
            {
                payload["runtimeDiff"] = json!({
                    "adapterKind": "pi",
                    "protocolFamily": PI_PROTOCOL_VERSION,
                    "sourceEventKind": "tool_execution_end.completed",
                    "semanticKind": "pi_edit_patch",
                    "entries": [{
                        "path": path,
                        "changeKind": "update",
                        "diff": patch,
                    }],
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

/// Pi's delta frame contains a contentIndex, not a message identity. Keep that
/// index scoped to this Runtime's explicit message_start/message_end interval.

#[derive(Default)]
pub(super) struct PiTextState {
    message_ordinal: u64,
    native_message_id: Option<String>,
    assistant_active: bool,
}

impl PiTextState {
    fn item_id(&self, index: u64) -> String {
        format!(
            "pi-text-{}-{index}",
            self.native_message_id
                .as_deref()
                .map(str::to_owned)
                .unwrap_or_else(|| self.message_ordinal.to_string())
        )
    }

    pub(super) fn normalize(&mut self, message: &Value) -> Vec<(&'static str, Value)> {
        let event = message.get("type").and_then(Value::as_str);
        let assistant =
            message.pointer("/message/role").and_then(Value::as_str) == Some("assistant");
        if assistant
            && matches!(event, Some("message_start" | "message_end"))
            && !crate::runtime::is_root_output(message)
        {
            return vec![];
        }
        if event == Some("message_start") && assistant {
            self.message_ordinal += 1;
            self.assistant_active = crate::runtime::is_root_output(message);
            self.native_message_id = message
                .pointer("/message/id")
                .and_then(Value::as_str)
                .map(str::to_owned);
        }
        if event == Some("message_end") && assistant {
            self.assistant_active = false;
            return message.pointer("/message/content").and_then(Value::as_array)
                .into_iter().flatten().enumerate().filter_map(|(index, block)| {
                    (block.get("type").and_then(Value::as_str) == Some("text"))
                        .then(|| block.get("text").and_then(Value::as_str)).flatten().map(|text| {
                            ("agent.text.completed", json!({
                                "itemId": self.item_id(index as u64), "text": text,
                                "status": match message.pointer("/message/stopReason").and_then(Value::as_str) {
                                    Some("aborted" | "error") => "interrupted", _ => "completed"
                                }
                            }))
                        })
                }).collect();
        }
        let (event_type, mut payload) = normalize_event(message);
        crate::runtime_subagent::mark_agent_tool(
            crate::agent_profile::AdapterKind::Pi,
            &mut payload,
        );
        if matches!(
            event_type,
            "agent.thought.delta" | "agent.thought.started" | "agent.thought.completed"
        ) && (!self.assistant_active || !crate::runtime::is_root_output(message))
        {
            return vec![];
        }
        if matches!(
            event_type,
            "agent.text.delta"
                | "agent.thought.delta"
                | "agent.thought.started"
                | "agent.thought.completed"
        ) {
            let index = message
                .pointer("/assistantMessageEvent/contentIndex")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            payload["itemId"] = json!(self.item_id(index));
        }
        if !crate::runtime::is_root_output(message) {
            payload["runtimeRootOutput"] = json!(false);
        }
        vec![(event_type, payload)]
    }
}

pub(crate) fn runtime_compatibility_digest(
    frozen_runtime: &FrozenAgentRuntimeConfig,
    cwd: &Path,
    _attachment_authorization: &ThreadOutputDirectory,
) -> Result<String> {
    let cwd = cwd
        .canonicalize()
        .with_context(|| format!("failed to resolve execution root {}", cwd.display()))?;
    canonical_json_digest(&json!({
        "schemaVersion": 4,
        "adapterKind": AdapterKind::Pi,
        "protocolVersion": PI_PROTOCOL_VERSION,
        "executionRoot": cwd,
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
        public_file_operation_change_kind: None,
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

fn terminal_edit_patch(message: &Value) -> Option<(String, String)> {
    let path = message
        .pointer("/args/path")
        .and_then(Value::as_str)
        .filter(|path| !path.trim().is_empty())?;
    let patch = message
        .pointer("/result/details/patch")
        .and_then(Value::as_str)
        .filter(|patch| !patch.trim().is_empty())?;
    Some((path.to_string(), patch.to_string()))
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
        let observed_bytes = record.len().saturating_add(take);
        if observed_bytes > max_bytes {
            return Err(PiTransportFailure::FrameTooLarge {
                limit_bytes: max_bytes,
                observed_bytes,
            }
            .into());
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

#[cfg(all(test, feature = "extended-tests"))]
mod tests {
    use super::*;
    use tokio::io::BufReader;

    #[test]
    fn text_identity_is_scoped_to_message_and_content_index_with_authoritative_terminal() {
        let mut state = PiTextState::default();
        state.normalize(&json!({"type":"message_start","message":{"role":"assistant"}}));
        let a = state.normalize(&json!({"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"A"}}));
        let b = state.normalize(&json!({"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":2,"delta":"B"}}));
        let thinking = json!({"type":"message_update","assistantMessageEvent":{
            "type":"thinking_delta","contentIndex":1,"delta":"PRIVATE_THOUGHT_MARKER",
            "partial":{"content":[{"type":"thinking","thinking":"PRIVATE_FULL_BLOCK"}]}
        }});
        let thought = state.normalize(&thinking);
        assert_eq!(thought[0].0, "agent.thought.delta");
        assert_ne!(thought[0].1["itemId"], a[0].1["itemId"]);
        assert!(
            !serde_json::to_string(&thought[0].1)
                .unwrap()
                .contains("PRIVATE_FULL_BLOCK")
        );
        for (native, normalized) in [
            ("thinking_start", "agent.thought.started"),
            ("thinking_end", "agent.thought.completed"),
        ] {
            let frame = json!({"type":"message_update","assistantMessageEvent":{"type":native,"contentIndex":1,"content":"PRIVATE_SIGNATURE"}});
            let events = state.normalize(&frame);
            assert_eq!(events[0].0, normalized);
            assert_eq!(events[0].1["itemId"], thought[0].1["itemId"]);
            assert_eq!(events[0].1.as_object().unwrap().len(), 2);
        }
        assert!(state.normalize(&json!({"type":"message_end","parent_tool_use_id":"child","message":{"role":"assistant","content":[{"type":"text","text":"child"}]}})).is_empty());
        assert!(!state.normalize(&thinking).is_empty());
        for field in ["subagentId", "parent_tool_use_id", "replay", "snapshot"] {
            let mut excluded = thinking.clone();
            excluded["assistantMessageEvent"]["partial"][field] = json!(true);
            assert!(state.normalize(&excluded).is_empty());
        }
        let terminal = state.normalize(&json!({"type":"message_end","message":{"role":"assistant","stopReason":"aborted","content":[{"type":"text","text":"A final"},{"type":"toolCall","id":"tool"},{"type":"text","text":"B partial"}]}}));
        assert_ne!(a[0].1["itemId"], b[0].1["itemId"]);
        assert_eq!(terminal.len(), 2);
        assert_eq!(terminal[0].0, "agent.text.completed");
        assert_eq!(terminal[0].1["itemId"], a[0].1["itemId"]);
        assert_eq!(terminal[1].1["itemId"], b[0].1["itemId"]);
        assert_eq!(terminal[0].1["text"], "A final");
        assert_eq!(terminal[0].1["status"], "interrupted");
        assert!(state.normalize(&thinking).is_empty());
        state.normalize(&json!({"type":"message_start","message":{"role":"assistant"}}));
        let next = state.normalize(&json!({"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"C"}}));
        assert_ne!(next[0].1["itemId"], a[0].1["itemId"]);
    }

    #[tokio::test]
    async fn jsonl_reader_bounds_records_and_preserves_unicode() {
        use tokio::io::AsyncReadExt;

        for input in [
            b"{\"value\":\"a\xE2\x80\xA8b\xE2\x80\xA9c\"}\n".as_slice(),
            b"{}\r\n",
            b"{}",
        ] {
            let mut reader = BufReader::with_capacity(1, input);
            let record = read_jsonl_record(&mut reader, 1024).await.unwrap().unwrap();
            let value: Value = serde_json::from_slice(&record).unwrap();
            if let Some(value) = value.get("value") {
                assert_eq!(value, "a\u{2028}b\u{2029}c");
            }
            assert!(
                read_jsonl_record(&mut reader, 1024)
                    .await
                    .unwrap()
                    .is_none()
            );
        }
        // The wire budget includes the line delimiter. Generate the input as a
        // stream so the boundary cases do not require two 64 MiB input copies.
        for (length, accepted) in [
            (PI_MAX_INBOUND_RECORD_BYTES - 1, true),
            (PI_MAX_INBOUND_RECORD_BYTES, false),
        ] {
            let input = tokio::io::repeat(b'x')
                .take(length as u64)
                .chain(b"\n".as_slice());
            let mut reader = BufReader::new(input);
            let result = read_jsonl_record(&mut reader, PI_MAX_INBOUND_RECORD_BYTES).await;
            if accepted {
                assert_eq!(result.unwrap().unwrap().len(), length);
            } else {
                let error = result.unwrap_err();
                let failure = error.downcast_ref::<PiTransportFailure>().unwrap();
                assert_eq!(
                    *failure,
                    PiTransportFailure::FrameTooLarge {
                        limit_bytes: PI_MAX_INBOUND_RECORD_BYTES,
                        observed_bytes: PI_MAX_INBOUND_RECORD_BYTES + 1,
                    }
                );
                let public = failure.public_failure();
                public.validate().unwrap();
                assert_eq!(public.code, "pi_rpc_frame_too_large");
                assert_eq!(public.origin, RuntimeFailureOrigin::Rovai);
                assert!(!public.retryable);
            }
        }
    }

    #[test]
    fn managed_extension_reports_numeric_session_state_and_injects_bootstrap() {
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
        assert_eq!(source.matches("pi.on(").count(), 4);
        assert!(source.contains("ctx.getContextUsage()"));
        assert!(source.contains("rovai-managed-context-usage"));
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
    fn successful_edit_emits_the_native_patch_but_write_and_failed_edit_do_not() {
        let patch = concat!(
            "--- /repo/src/app.ts\n",
            "+++ /repo/src/app.ts\n",
            "@@ -1 +1,2 @@\n",
            "-old\n",
            "+new\n",
            "+next\n",
        );
        let (_, edited) = normalize_event(&json!({
            "type": "tool_execution_end",
            "toolCallId": "tool-edit",
            "toolName": "edit",
            "args": {"path": "/repo/src/app.ts"},
            "isError": false,
            "result": {
                "content": [{"type":"text","text":"done"}],
                "details": {"patch": patch}
            }
        }));
        assert_eq!(edited["runtimeDiff"]["semanticKind"], "pi_edit_patch");
        assert_eq!(
            edited["runtimeDiff"]["entries"][0]["path"],
            "/repo/src/app.ts"
        );
        assert_eq!(edited["runtimeDiff"]["entries"][0]["diff"], patch);

        for (tool_name, is_error) in [("write", false), ("edit", true)] {
            let (_, payload) = normalize_event(&json!({
                "type": "tool_execution_end",
                "toolCallId": format!("tool-{tool_name}"),
                "toolName": tool_name,
                "args": {"path": "/repo/src/app.ts"},
                "isError": is_error,
                "result": {"details": {"patch": patch}}
            }));
            assert!(payload.get("runtimeDiff").is_none());
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
        let (_, progress) = normalize_event(&update);
        assert_eq!(progress["runtimePhaseBoundary"], false);
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
    fn terminal_edit_patch_reuses_only_the_same_tool_calls_observed_arguments() {
        let start = json!({
            "type": "tool_execution_start",
            "toolCallId": "tool-edit",
            "toolName": "edit",
            "args": {"path": "/repo/src/app.ts"}
        });
        let mut terminal = json!({
            "type": "tool_execution_end",
            "toolCallId": "tool-edit",
            "isError": false,
            "result": {"details": {"patch": concat!(
                "--- /repo/src/app.ts\n",
                "+++ /repo/src/app.ts\n",
                "@@ -1 +1 @@\n-old\n+new\n"
            )}}
        });

        reconcile_terminal_tool_message(&mut terminal, &start);
        let (_, payload) = normalize_event(&terminal);

        assert_eq!(payload["runtimeFileOperation"]["path"], "/repo/src/app.ts");
        assert_eq!(
            payload["runtimeDiff"]["entries"][0]["path"],
            "/repo/src/app.ts"
        );
    }

    #[test]
    fn native_extension_ui_preserves_answers_and_expires_without_default_answers() {
        use crate::native_interaction::{
            NativeInteractionAnswer as Answer, NativeInteractionStatus as Status,
        };
        let mut dialogs = interactions::PiInteractions::default();
        for method in ["confirm", "select", "input", "editor"] {
            let request = json!({"type":"extension_ui_request", "method":method, "id":format!("native-{method}"),
                "title":"原问题\n第二行", "message":" 保留说明 ", "options":["A", "A", "Type something."],
                "placeholder":" 原提示 ", "prefill":"  初始\n中文  ", "timeout":10});
            assert!(dialogs.register(&request, "run-1", 7, 100).unwrap());
            assert!(
                dialogs.register(&request, "run-1", 7, 999).unwrap(),
                "duplicate ingress must not renew its deadline"
            );
            let entry = dialogs
                .entries
                .values_mut()
                .find(|entry| entry.native_id == request["id"])
                .unwrap();
            assert_eq!(entry.view.questions[0].title, "原问题\n第二行");
            assert_eq!(
                entry.view.questions[0].description.as_deref(),
                Some(" 保留说明 ")
            );
            assert_eq!(entry.view.can_skip, true);
            assert_eq!(
                entry.response(&Answer::Skip).unwrap(),
                json!({"type":"extension_ui_response", "id":request["id"], "cancelled":true})
            );
            match method {
                "confirm" => {
                    for confirmed in [false, true] {
                        assert_eq!(
                            entry.response(&Answer::Confirm { confirmed }).unwrap()["confirmed"],
                            confirmed
                        );
                    }
                }
                "select" => {
                    assert_eq!(entry.view.questions[0].options.len(), 3);
                    assert_eq!(
                        entry
                            .response(&Answer::Select {
                                option_id: "2".into()
                            })
                            .unwrap()["value"],
                        "Type something."
                    );
                    assert!(
                        entry
                            .response(&Answer::Input {
                                value: "custom text must wait for native input".into()
                            })
                            .is_err()
                    );
                    assert!(
                        entry
                            .response(&Answer::Select {
                                option_id: "missing".into()
                            })
                            .is_err()
                    );
                }
                _ => {
                    for text in ["", "  中文\n保留空格  "] {
                        assert_eq!(
                            entry
                                .response(&Answer::Input { value: text.into() })
                                .unwrap()["value"],
                            text
                        );
                        assert_eq!(
                            entry.view.questions[0].prefill.as_deref(),
                            Some("  初始\n中文  ")
                        );
                        assert_eq!(entry.view.questions[0].multiline, method == "editor");
                    }
                }
            }
            entry.expire(109);
            assert_eq!(entry.view.status, Status::Pending);
            entry.expire(110);
            assert_eq!(
                entry.view.status,
                if method == "editor" {
                    Status::Pending
                } else {
                    Status::Expired
                }
            );
        }
        assert_eq!(
            dialogs.pending(1000).len(),
            1,
            "editor has no native timeout"
        );
        for method in ["confirm", "select", "input"] {
            let request = json!({"method":method, "id":format!("zero-timeout-{method}"),
                "title":"No deadline", "options":["A"], "timeout":0});
            assert!(dialogs.register(&request, "run-1", 7, 100).unwrap());
            let entry = dialogs
                .entries
                .values_mut()
                .find(|entry| entry.native_id == request["id"])
                .unwrap();
            assert_eq!(
                entry.view.expires_at, None,
                "Pi does not start a timer for timeout: 0"
            );
            entry.expire(i64::MAX);
            assert_eq!(entry.view.status, Status::Pending);
            assert!(entry.response(&Answer::Skip).is_ok());
        }
        assert!(
            !dialogs
                .register(&json!({"method":"notify"}), "run-1", 7, 100)
                .unwrap()
        );
        assert!(
            dialogs
                .register(
                    &json!({"method":"select", "id":"malformed", "title":"bad", "options":[1]}),
                    "run-1",
                    7,
                    100
                )
                .is_err()
        );
        let mut scoped = interactions::PiInteractions::default();
        scoped.tool_scope(Some("native-tool-a"));
        scoped.register(&json!({"method":"select","id":"a","title":"平台","options":["Windows","自行填写（本地化）"]}), "run", 1, 1).unwrap();
        let select = scoped.pending(1).pop().unwrap();
        scoped.complete(
            &select.id,
            &Answer::Select {
                option_id: "1".into(),
            },
            Status::Sent,
        );
        scoped
            .register(
                &json!({"method":"input","id":"b","title":"原生输入说明"}),
                "run",
                1,
                2,
            )
            .unwrap();
        let input = scoped.pending(2).pop().unwrap();
        assert_ne!(select.id, input.id);
        assert_eq!(select.presentation_id, input.presentation_id);
        assert_eq!(
            input.selection.as_ref().unwrap().options[1].label,
            "自行填写（本地化）"
        );
        assert_eq!(input.selection.as_ref().unwrap().option_id, "1");
        assert_eq!(
            scoped.entries[&input.id]
                .response(&Answer::Input {
                    value: "  中文  ".into()
                })
                .unwrap()["id"],
            "b"
        );
        scoped.complete(
            &input.id,
            &Answer::Input {
                value: "  中文  ".into(),
            },
            Status::Sent,
        );
        scoped.tool_scope(None);
        scoped.tool_scope(Some("native-tool-b"));
        scoped
            .register(
                &json!({"method":"input","id":"c","title":"不同工具"}),
                "run",
                1,
                3,
            )
            .unwrap();
        let other = scoped.pending(3).pop().unwrap();
        assert_ne!(input.presentation_id, other.presentation_id);
        assert!(other.selection.is_none());
        scoped
            .register(
                &json!({"method":"input","id":"d","title":"同一工具并发"}),
                "run",
                1,
                4,
            )
            .unwrap();
        let concurrent = scoped
            .entries
            .values()
            .find(|entry| entry.native_id == "d")
            .unwrap();
        assert!(
            concurrent.view.presentation_id.is_none(),
            "concurrent requests never share a card"
        );
        // Unsupported requests and system cleanup use cancellation, never a synthetic negative answer.
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
                "cancelled": true,
            })
        );
    }
}
