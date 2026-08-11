//! Long-lived, Core-owned Runtime Activity Mapping Registry.
//!
//! Keep protocol-to-semantic rules here, not in adapters or Renderer.  Every
//! registry change must update `docs/runtime-activity/registry.md` and add a
//! fixture covering the reported fields and the honest unknown fallback.

use serde_json::Value;

use crate::agent_profile::AdapterKind;

pub const CLASSIFIER_VERSION: &str = "activity-v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RuntimeActivityMappingDescriptor {
    pub adapter_kind: AdapterKind,
    pub protocol_family: &'static str,
    pub baseline_coverage: &'static str,
    pub registry_entry: &'static str,
}

pub const RUNTIME_ACTIVITY_MAPPINGS: [RuntimeActivityMappingDescriptor; 9] = [
    descriptor(
        AdapterKind::CodexCli,
        "codex-app-server",
        "fine_grained",
        "codex",
    ),
    descriptor(AdapterKind::OpencodeCli, "acp-v1", "fine_grained", "acp"),
    descriptor(AdapterKind::CopilotCli, "acp-v1", "fine_grained", "acp"),
    descriptor(
        AdapterKind::ClaudeCodeCli,
        "claude-stream-json",
        "run_level",
        "claude-code",
    ),
    descriptor(AdapterKind::KiroCli, "acp-v1", "fine_grained", "acp"),
    descriptor(AdapterKind::QoderCli, "acp-v1", "fine_grained", "acp"),
    descriptor(AdapterKind::CodebuddyCli, "acp-v1", "fine_grained", "acp"),
    descriptor(AdapterKind::QwenCode, "acp-v1", "fine_grained", "acp"),
    descriptor(
        AdapterKind::AntigravityApp,
        "antigravity-log",
        "run_level",
        "antigravity",
    ),
];

const fn descriptor(
    adapter_kind: AdapterKind,
    protocol_family: &'static str,
    baseline_coverage: &'static str,
    registry_entry: &'static str,
) -> RuntimeActivityMappingDescriptor {
    RuntimeActivityMappingDescriptor {
        adapter_kind,
        protocol_family,
        baseline_coverage,
        registry_entry,
    }
}

pub fn descriptor_for(adapter_kind: AdapterKind) -> &'static RuntimeActivityMappingDescriptor {
    RUNTIME_ACTIVITY_MAPPINGS
        .iter()
        .find(|descriptor| descriptor.adapter_kind == adapter_kind)
        .expect("every built-in Adapter must have a Runtime Activity mapping descriptor")
}

pub fn classify(item_type: &str, evidence_kind: &str, payload: &Value) -> (String, Option<String>) {
    let (activity_domain, semantic_kind, _) =
        classify_with_structure(item_type, evidence_kind, payload);
    (activity_domain, semantic_kind)
}

pub(crate) fn classify_with_structure(
    item_type: &str,
    evidence_kind: &str,
    payload: &Value,
) -> (String, Option<String>, bool) {
    let runtime_kind = payload
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match item_type {
        "commandExecution" => return structured_domain("shell", "shell.execute"),
        "fileChange" => return structured_domain("file", "file.write"),
        "webSearch" => return structured_domain("tool", "tool.web.search"),
        "imageGeneration" => return structured_domain("tool", "tool.image.generate"),
        "mcpToolCall" => return structured_domain("tool", "tool.mcp.call"),
        "dynamicToolCall" | "collabToolCall" | "collabAgentToolCall" => {
            return structured_domain("tool", "tool.call");
        }
        "runtime" | "run" => return structured_domain("runtime", "runtime.run"),
        _ => {}
    }
    match runtime_kind.to_ascii_lowercase().as_str() {
        "read" | "read_file" | "readfile" => structured_domain("file", "file.read"),
        "edit" | "write" | "write_file" | "apply_patch" => structured_domain("file", "file.write"),
        "execute" | "command" | "terminal" | "shell" => structured_domain("shell", "shell.execute"),
        "search" | "web_search" => structured_domain("tool", "tool.web.search"),
        "mcp_tool_call" | "tool" => structured_domain("tool", "tool.call"),
        "runtime" | "run" => structured_domain("runtime", "runtime.run"),
        _ => {
            let (activity_domain, semantic_kind) = match evidence_kind {
                "command" => domain("shell", "shell.execute"),
                "file_change" => domain("file", "file.write"),
                "tool_call" | "tool_result" => domain("tool", "tool.call"),
                "runtime_activity" => domain("runtime", "runtime.run"),
                _ => ("unknown".to_string(), None),
            };
            (activity_domain, semantic_kind, false)
        }
    }
}

pub fn default_presentation_hint(
    activity_domain: &str,
    semantic_kind: Option<&str>,
) -> Option<String> {
    Some(
        match (activity_domain, semantic_kind) {
            ("shell", _) => "执行 Shell 命令",
            ("file", Some("file.read")) => "读取文件",
            ("file", _) => "修改文件",
            ("tool", Some("tool.web.search")) => "Web 搜索",
            ("tool", _) => "Runtime 工具调用",
            ("runtime", _) => "Agent 正在处理",
            _ => return None,
        }
        .to_string(),
    )
}

fn domain(activity_domain: &str, semantic_kind: &str) -> (String, Option<String>) {
    (activity_domain.to_string(), Some(semantic_kind.to_string()))
}

fn structured_domain(activity_domain: &str, semantic_kind: &str) -> (String, Option<String>, bool) {
    let (activity_domain, semantic_kind) = domain(activity_domain, semantic_kind);
    (activity_domain, semantic_kind, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::BTreeSet;

    #[test]
    fn registry_covers_every_adapter_exactly_once() {
        let registered = RUNTIME_ACTIVITY_MAPPINGS
            .iter()
            .map(|descriptor| descriptor.adapter_kind)
            .collect::<BTreeSet<_>>();
        let expected = AdapterKind::ALL.into_iter().collect::<BTreeSet<_>>();
        assert_eq!(registered, expected);
        assert_eq!(RUNTIME_ACTIVITY_MAPPINGS.len(), AdapterKind::ALL.len());
    }

    #[test]
    fn long_lived_registry_document_tracks_the_executable_catalog() {
        let registry = include_str!("../../../docs/runtime-activity/registry.md");
        assert!(registry.contains(&format!("classifier_version: {CLASSIFIER_VERSION}")));
        for adapter_kind in AdapterKind::ALL {
            let row_marker = format!("| `{}` |", adapter_kind.as_str());
            assert_eq!(
                registry.matches(&row_marker).count(),
                1,
                "Runtime Activity Registry must contain exactly one row for {}",
                adapter_kind.as_str()
            );
        }
    }

    #[test]
    fn acp_structured_kinds_have_explicit_unknown_fallbacks() {
        assert_eq!(
            classify("", "tool_call", &json!({"kind": "read"})),
            domain("file", "file.read")
        );
        assert_eq!(
            classify("", "tool_call", &json!({"kind": "edit"})),
            domain("file", "file.write")
        );
        assert_eq!(
            classify("", "tool_call", &json!({"kind": "execute"})),
            domain("shell", "shell.execute")
        );
        assert_eq!(
            classify("", "runtime_activity", &json!({"kind": "future"})),
            domain("runtime", "runtime.run")
        );
    }

    #[test]
    fn run_level_adapters_are_declared_without_invented_tool_coverage() {
        assert_eq!(
            descriptor_for(AdapterKind::ClaudeCodeCli).baseline_coverage,
            "run_level"
        );
        assert_eq!(
            descriptor_for(AdapterKind::AntigravityApp).baseline_coverage,
            "run_level"
        );
    }
}
