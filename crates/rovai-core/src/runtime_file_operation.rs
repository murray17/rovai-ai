use std::path::Path;

use serde_json::Value;

use crate::{agent_profile::AdapterKind, runtime_diff::normalize_reported_path};

pub const FILE_OPERATION_SCHEMA_VERSION: u32 = 1;

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
    let candidate = payload.get("runtimeFileOperation")?;
    Some(admit_candidate(
        candidate,
        execution_root,
        frozen_adapter_kind,
    ))
}

fn admit_candidate(
    candidate: &Value,
    execution_root: &Path,
    frozen_adapter_kind: Option<&str>,
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
    if !adapter.uses_acp()
        || candidate.get("protocolFamily").and_then(Value::as_str) != Some("acp-v1")
        || candidate.get("sourceEventKind").and_then(Value::as_str)
            != Some("session/update.tool_call_update.completed")
    {
        return Err("runtime_file_operation_source_not_allowlisted");
    }
    let operation_kind = candidate
        .get("operationKind")
        .and_then(Value::as_str)
        .ok_or("runtime_file_operation_kind_invalid")?;
    if operation_kind != "write" {
        return Err("runtime_file_operation_kind_invalid");
    }
    let raw_path = candidate
        .get("path")
        .and_then(Value::as_str)
        .ok_or("runtime_file_operation_path_invalid")?;
    let path = normalize_reported_path(execution_root, raw_path)
        .ok_or("runtime_file_operation_path_outside_root")?;
    Ok(AdmittedRuntimeFileOperation {
        operation_kind: operation_kind.to_string(),
        path,
    })
}

pub fn path_from_evidence(payload: &Value) -> Option<&str> {
    let projection = payload.get("runtimeFileOperation")?;
    (projection.get("status").and_then(Value::as_str) == Some("available")
        && projection.get("operationKind").and_then(Value::as_str) == Some("write"))
    .then(|| projection.get("path").and_then(Value::as_str))
    .flatten()
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
    fn rejects_unscoped_or_non_write_file_operation_candidates() {
        for (operation_kind, path, reason) in [
            (
                "write",
                "../outside.txt",
                "runtime_file_operation_path_outside_root",
            ),
            ("read", "src/app.ts", "runtime_file_operation_kind_invalid"),
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
