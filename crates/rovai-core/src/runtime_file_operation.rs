use std::path::Path;

use serde_json::Value;

use crate::{
    agent_profile::AdapterKind,
    runtime_diff::{normalize_reported_path_for_display, reported_path_is_within_root},
};

pub const FILE_OPERATION_SCHEMA_VERSION: u32 = 1;
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
    fn rejects_invalid_paths_or_non_write_file_operation_candidates() {
        for (operation_kind, path, reason) in [
            (
                "write",
                "https://example.com/outside.txt",
                "runtime_file_operation_path_invalid",
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
