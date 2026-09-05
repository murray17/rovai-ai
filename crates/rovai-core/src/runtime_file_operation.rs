use std::path::Path;

use serde_json::Value;

use crate::{
    agent_profile::AdapterKind,
    runtime_diff::{normalize_reported_path_for_display, reported_path_is_within_root},
};

pub const FILE_OPERATION_SCHEMA_VERSION: u32 = 2;
pub(crate) const RUNTIME_FILE_OPERATION_MANAGED_OUTPUT_ROOT: &str =
    "runtime_file_operation_managed_output_root";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdmittedRuntimeFileOperation {
    pub operation_kind: String,
    pub path: String,
}

pub fn admit_runtime_file_operation(
    payload: &Value,
    execution_root: &Path,
    frozen_adapter_kind: Option<&str>,
) -> Option<Result<AdmittedRuntimeFileOperation, &'static str>> {
    admit_runtime_file_operation_with_managed_output_root(
        payload,
        execution_root,
        frozen_adapter_kind,
        None,
    )
}

pub fn admit_runtime_file_operation_with_managed_output_root(
    payload: &Value,
    execution_root: &Path,
    frozen_adapter_kind: Option<&str>,
    managed_output_root: Option<&Path>,
) -> Option<Result<AdmittedRuntimeFileOperation, &'static str>> {
    let candidate = payload.get("runtimeFileOperation")?;
    Some(admit_candidate(
        candidate,
        execution_root,
        frozen_adapter_kind,
        managed_output_root,
    ))
}

fn admit_candidate(
    candidate: &Value,
    execution_root: &Path,
    frozen_adapter_kind: Option<&str>,
    managed_output_root: Option<&Path>,
) -> Result<AdmittedRuntimeFileOperation, &'static str> {
    let adapter_kind = candidate
        .get("adapterKind")
        .and_then(Value::as_str)
        .ok_or("runtime_file_operation_source_invalid")?;
    if frozen_adapter_kind != Some(adapter_kind) {
        return Err("runtime_file_operation_adapter_mismatch");
    }
    let adapter = adapter_kind
        .parse::<AdapterKind>()
        .map_err(|_| "runtime_file_operation_adapter_invalid")?;
    let operation_kind = candidate
        .get("operationKind")
        .and_then(Value::as_str)
        .ok_or("runtime_file_operation_kind_invalid")?;
    if !matches!(operation_kind, "read" | "write") {
        return Err("runtime_file_operation_kind_invalid");
    }
    let protocol_family = candidate.get("protocolFamily").and_then(Value::as_str);
    let source_event_kind = candidate.get("sourceEventKind").and_then(Value::as_str);
    let source_is_allowlisted = if adapter.uses_acp() {
        protocol_family == Some("acp-v1")
            && source_event_kind == Some("session/update.tool_call_update.completed")
    } else {
        match adapter {
            AdapterKind::CodexCli => {
                operation_kind == "read"
                    && protocol_family == Some("codex-app-server")
                    && source_event_kind == Some("activity.commandExecution.read")
            }
            AdapterKind::ClaudeCodeCli => {
                protocol_family == Some("claude-stream-json")
                    && source_event_kind
                        == Some("assistant.tool_use.file+user.tool_result.completed")
            }
            AdapterKind::Pi => {
                protocol_family == Some("pi-jsonl-rpc-v1")
                    && source_event_kind == Some("tool_execution_end.completed")
            }
            _ => false,
        }
    };
    if !source_is_allowlisted {
        return Err("runtime_file_operation_source_not_allowlisted");
    }
    let raw_path = candidate
        .get("path")
        .and_then(Value::as_str)
        .ok_or("runtime_file_operation_path_invalid")?;
    if managed_output_root
        .is_some_and(|root| reported_path_is_within_root(execution_root, raw_path, root))
    {
        return Err(RUNTIME_FILE_OPERATION_MANAGED_OUTPUT_ROOT);
    }
    let path = normalize_reported_path_for_display(execution_root, raw_path)
        .ok_or("runtime_file_operation_path_invalid")?;
    Ok(AdmittedRuntimeFileOperation {
        operation_kind: operation_kind.to_string(),
        path,
    })
}

pub fn path_from_evidence(payload: &Value) -> Option<&str> {
    operation_from_evidence(payload)
        .filter(|operation| operation.operation_kind == "write")
        .map(|operation| operation.path)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RuntimeFileOperationRef<'a> {
    pub operation_kind: &'a str,
    pub path: &'a str,
}

pub fn operation_from_evidence(payload: &Value) -> Option<RuntimeFileOperationRef<'_>> {
    let projection = payload.get("runtimeFileOperation")?;
    if projection.get("schemaVersion").and_then(Value::as_u64)
        != Some(u64::from(FILE_OPERATION_SCHEMA_VERSION))
        || projection.get("status").and_then(Value::as_str) != Some("available")
    {
        return None;
    }
    let operation_kind = projection.get("operationKind")?.as_str()?;
    if !matches!(operation_kind, "read" | "write") {
        return None;
    }
    Some(RuntimeFileOperationRef {
        operation_kind,
        path: projection.get("path")?.as_str()?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn admits_one_structured_acp_write_path_without_claiming_a_diff() {
        let admitted = admit_runtime_file_operation(
            &json!({
                "runtimeFileOperation": {
                    "adapterKind": "kimi-code-cli",
                    "protocolFamily": "acp-v1",
                    "sourceEventKind": "session/update.tool_call_update.completed",
                    "operationKind": "write",
                    "path": "/repo/src/app.ts"
                }
            }),
            Path::new("/repo"),
            Some("kimi-code-cli"),
        )
        .expect("candidate should exist")
        .expect("structured path should be admitted");

        assert_eq!(admitted.operation_kind, "write");
        assert_eq!(admitted.path, "src/app.ts");
    }

    #[test]
    fn cross_root_write_remains_visible_unless_it_is_managed_run_output() {
        let result = admit_runtime_file_operation_with_managed_output_root(
            &json!({
                "runtimeFileOperation": {
                    "adapterKind": "qoder-cli",
                    "protocolFamily": "acp-v1",
                    "sourceEventKind": "session/update.tool_call_update.completed",
                    "operationKind": "write",
                    "path": "../outside.txt"
                }
            }),
            Path::new("/repo"),
            Some("qoder-cli"),
            Some(Path::new("/rovai/runtime/builtin-tools/process/run-tmp")),
        )
        .expect("candidate should exist")
        .expect("cross-root writes should remain visible");
        assert_eq!(result.path, "/outside.txt");

        for (path, expected) in [
            (
                "/rovai/runtime/builtin-tools/process/run-tmp",
                Err(RUNTIME_FILE_OPERATION_MANAGED_OUTPUT_ROOT),
            ),
            (
                "/rovai/runtime/builtin-tools/process/run-tmp/report.html",
                Err(RUNTIME_FILE_OPERATION_MANAGED_OUTPUT_ROOT),
            ),
            (
                "/rovai/runtime/builtin-tools/process/run-tmp-copy/report.html",
                Ok("/rovai/runtime/builtin-tools/process/run-tmp-copy/report.html"),
            ),
        ] {
            let result = admit_runtime_file_operation_with_managed_output_root(
                &json!({
                    "runtimeFileOperation": {
                        "adapterKind": "qoder-cli",
                        "protocolFamily": "acp-v1",
                        "sourceEventKind": "session/update.tool_call_update.completed",
                        "operationKind": "write",
                        "path": path
                    }
                }),
                Path::new("/repo"),
                Some("qoder-cli"),
                Some(Path::new("/rovai/runtime/builtin-tools/process/run-tmp")),
            )
            .expect("candidate should exist")
            .map(|admitted| admitted.path.as_str().to_string());
            assert_eq!(
                result
                    .as_ref()
                    .map(String::as_str)
                    .map_err(|reason| *reason),
                expected
            );
        }
    }

    #[test]
    fn rejects_invalid_paths_or_unknown_file_operation_candidates() {
        for (operation_kind, path, reason) in [
            (
                "write",
                "https://example.com/outside.txt",
                "runtime_file_operation_path_invalid",
            ),
            (
                "delete",
                "src/app.ts",
                "runtime_file_operation_kind_invalid",
            ),
        ] {
            let result = admit_runtime_file_operation(
                &json!({
                    "runtimeFileOperation": {
                        "adapterKind": "qoder-cli",
                        "protocolFamily": "acp-v1",
                        "sourceEventKind": "session/update.tool_call_update.completed",
                        "operationKind": operation_kind,
                        "path": path
                    }
                }),
                Path::new("/repo"),
                Some("qoder-cli"),
            )
            .expect("candidate should exist");
            assert_eq!(result, Err(reason));
        }
    }

    #[test]
    fn admits_structured_reads_from_acp_codex_claude_and_pi_only() {
        for (adapter, protocol, source) in [
            (
                "opencode-cli",
                "acp-v1",
                "session/update.tool_call_update.completed",
            ),
            (
                "codex-cli",
                "codex-app-server",
                "activity.commandExecution.read",
            ),
            (
                "claude-code-cli",
                "claude-stream-json",
                "assistant.tool_use.file+user.tool_result.completed",
            ),
            ("pi", "pi-jsonl-rpc-v1", "tool_execution_end.completed"),
        ] {
            let admitted = admit_runtime_file_operation(
                &json!({
                    "runtimeFileOperation": {
                        "adapterKind": adapter,
                        "protocolFamily": protocol,
                        "sourceEventKind": source,
                        "operationKind": "read",
                        "path": "/repo/docs/README.md"
                    }
                }),
                Path::new("/repo"),
                Some(adapter),
            )
            .expect("candidate should exist")
            .expect("allowlisted read should be admitted");
            assert_eq!(admitted.operation_kind, "read");
            assert_eq!(admitted.path, "docs/README.md");
        }

        let rejected = admit_runtime_file_operation(
            &json!({
                "runtimeFileOperation": {
                    "adapterKind": "codex-cli",
                    "protocolFamily": "codex-app-server",
                    "sourceEventKind": "activity.commandExecution.read",
                    "operationKind": "write",
                    "path": "/repo/docs/README.md"
                }
            }),
            Path::new("/repo"),
            Some("codex-cli"),
        )
        .expect("candidate should exist");
        assert_eq!(
            rejected,
            Err("runtime_file_operation_source_not_allowlisted")
        );
    }

    #[test]
    fn every_acp_adapter_uses_the_same_terminal_file_operation_contract() {
        for adapter in [
            AdapterKind::OpencodeCli,
            AdapterKind::CopilotCli,
            AdapterKind::KiroCli,
            AdapterKind::QoderCli,
            AdapterKind::CodebuddyCli,
            AdapterKind::QwenCode,
            AdapterKind::TraeCnCli,
            AdapterKind::CursorAgent,
            AdapterKind::KimiCodeCli,
            AdapterKind::GrokBuild,
        ] {
            let admitted = admit_runtime_file_operation(
                &json!({
                    "runtimeFileOperation": {
                        "adapterKind": adapter.as_str(),
                        "protocolFamily": "acp-v1",
                        "sourceEventKind": "session/update.tool_call_update.completed",
                        "operationKind": "write",
                        "path": "/repo/src/app.ts"
                    }
                }),
                Path::new("/repo"),
                Some(adapter.as_str()),
            )
            .expect("candidate should exist")
            .unwrap_or_else(|reason| {
                panic!(
                    "{} should use the ACP file-operation contract: {reason}",
                    adapter.as_str()
                )
            });
            assert_eq!(admitted.path, "src/app.ts");
        }
    }
}
