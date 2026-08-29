use serde_json::{Value, json};

use crate::agent_profile::AdapterKind;

pub const SEARCH_OPERATION_SCHEMA_VERSION: u32 = 1;
pub const SEARCH_OPERATION_CANDIDATE_FIELD: &str = "runtimeSearchOperationCandidate";

const CODEX_WEB_SEARCH_RULE: &str = "codex.web_search.item.v1";
const CLAUDE_WEB_SEARCH_RULE: &str = "claude.web_search.tool_use.v1";
const ACP_EXPLICIT_WEB_SEARCH_RULE: &str = "acp.explicit_web_search.v1";
const COPILOT_QUERY_ONLY_RULE: &str = "copilot.search.query_only.v1";
const QODER_QUERY_ONLY_RULE: &str = "qoder.search.query_only.v1";
const KIRO_QUERY_ONLY_RULE: &str = "kiro.search.query_only.v1";
const CODEBUDDY_QUERY_ONLY_RULE: &str = "codebuddy.fetch.query_only.v1";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdmittedRuntimeSearchOperation {
    pub search_kind: String,
    pub query: String,
    pub adapter_kind: String,
    pub protocol_family: String,
    pub source_event_kind: String,
    pub admission_rule: String,
    pub observed_runtime_version: Option<String>,
}

impl AdmittedRuntimeSearchOperation {
    pub fn into_projection(self) -> Value {
        json!({
            "schemaVersion": SEARCH_OPERATION_SCHEMA_VERSION,
            "source": "runtime_reported",
            "status": "available",
            "searchKind": self.search_kind,
            "query": self.query,
            "sourceMetadata": {
                "adapterKind": self.adapter_kind,
                "protocolFamily": self.protocol_family,
                "sourceEventKind": self.source_event_kind,
                "admissionRule": self.admission_rule,
                "observedRuntimeVersion": self.observed_runtime_version,
            },
        })
    }
}

pub fn codex_web_search_candidate(method: &str, item: Option<&Value>) -> Option<Value> {
    if !matches!(method, "item/started" | "item/completed") {
        return None;
    }
    let item = item?;
    if item.get("type").and_then(Value::as_str) != Some("webSearch") {
        return None;
    }
    let query = nonempty_query(item.get("query"))?;
    Some(candidate(
        AdapterKind::CodexCli,
        "codex-app-server",
        method,
        CODEX_WEB_SEARCH_RULE,
        "webSearch",
        query,
    ))
}

pub fn claude_web_search_candidate(
    source_event_kind: &str,
    tool_name: &str,
    query: Option<&str>,
) -> Option<Value> {
    if tool_name != "WebSearch"
        || !matches!(
            source_event_kind,
            "assistant.tool_use.WebSearch" | "assistant.tool_use.WebSearch+user.tool_result"
        )
    {
        return None;
    }
    let query = query.filter(|query| !query.trim().is_empty())?;
    Some(candidate(
        AdapterKind::ClaudeCodeCli,
        "claude-stream-json",
        source_event_kind,
        CLAUDE_WEB_SEARCH_RULE,
        "WebSearch",
        query,
    ))
}

pub fn acp_web_search_candidate(
    adapter_kind: AdapterKind,
    session_update: Option<&str>,
    status: &str,
    native_kind: &str,
    raw_input: Option<&Value>,
) -> Option<Value> {
    let source_event_kind = match (session_update?, status) {
        ("tool_call", _) => "session/update.tool_call",
        ("tool_call_update", "completed") => "session/update.tool_call_update.completed",
        ("tool_call_update", "failed") => "session/update.tool_call_update.failed",
        ("tool_call_update", _) => "session/update.tool_call_update",
        _ => return None,
    };
    let native_kind = native_kind.trim();
    let (admission_rule, query) = if native_kind == "web_search" {
        (
            ACP_EXPLICIT_WEB_SEARCH_RULE,
            nonempty_query(raw_input?.get("query"))?,
        )
    } else {
        let query = query_only(raw_input?)?;
        match (adapter_kind, native_kind, status) {
            (AdapterKind::CopilotCli, "search", _) => (COPILOT_QUERY_ONLY_RULE, query),
            (AdapterKind::QoderCli, "search", _) => (QODER_QUERY_ONLY_RULE, query),
            (AdapterKind::KiroCli, "search", _) => (KIRO_QUERY_ONLY_RULE, query),
            (AdapterKind::CodebuddyCli, "fetch", "completed" | "failed") => {
                (CODEBUDDY_QUERY_ONLY_RULE, query)
            }
            _ => return None,
        }
    };
    Some(candidate(
        adapter_kind,
        "acp-v1",
        source_event_kind,
        admission_rule,
        native_kind,
        query,
    ))
}

pub fn admit_runtime_search_operation(
    event_type: &str,
    payload: &Value,
    frozen_adapter_kind: Option<&str>,
    observed_runtime_version: Option<&str>,
) -> Option<Result<AdmittedRuntimeSearchOperation, &'static str>> {
    let candidate = payload.get(SEARCH_OPERATION_CANDIDATE_FIELD)?;
    Some(admit_candidate(
        event_type,
        payload,
        candidate,
        frozen_adapter_kind,
        observed_runtime_version,
    ))
}

fn admit_candidate(
    event_type: &str,
    payload: &Value,
    candidate: &Value,
    frozen_adapter_kind: Option<&str>,
    observed_runtime_version: Option<&str>,
) -> Result<AdmittedRuntimeSearchOperation, &'static str> {
    let adapter_kind = required_string(candidate, "adapterKind")?;
    if frozen_adapter_kind != Some(adapter_kind) {
        return Err("runtime_search_operation_adapter_mismatch");
    }
    let adapter = adapter_kind
        .parse::<AdapterKind>()
        .map_err(|_| "runtime_search_operation_adapter_invalid")?;
    let protocol_family = required_string(candidate, "protocolFamily")?;
    let source_event_kind = required_string(candidate, "sourceEventKind")?;
    let admission_rule = required_string(candidate, "admissionRule")?;
    let native_kind = required_string(candidate, "nativeKind")?;
    let query = required_string(candidate, "query")?;
    if query.trim().is_empty() || candidate.get("searchKind").and_then(Value::as_str) != Some("web")
    {
        return Err("runtime_search_operation_query_invalid");
    }

    let source_is_allowlisted = match admission_rule {
        CODEX_WEB_SEARCH_RULE => {
            adapter == AdapterKind::CodexCli
                && protocol_family == "codex-app-server"
                && matches!(
                    (event_type, source_event_kind),
                    ("activity.started", "item/started") | ("activity.completed", "item/completed")
                )
                && native_kind == "webSearch"
                && payload.pointer("/item/type").and_then(Value::as_str) == Some("webSearch")
                && payload.pointer("/item/query").and_then(Value::as_str) == Some(query)
        }
        CLAUDE_WEB_SEARCH_RULE => {
            adapter == AdapterKind::ClaudeCodeCli
                && protocol_family == "claude-stream-json"
                && event_type == "runtime.action"
                && matches!(
                    source_event_kind,
                    "assistant.tool_use.WebSearch"
                        | "assistant.tool_use.WebSearch+user.tool_result"
                )
                && native_kind == "WebSearch"
                && payload.get("toolName").and_then(Value::as_str) == Some("WebSearch")
        }
        ACP_EXPLICIT_WEB_SEARCH_RULE => {
            adapter.uses_acp()
                && protocol_family == "acp-v1"
                && event_type == "runtime.action"
                && acp_source_event_is_allowlisted(source_event_kind)
                && native_kind == "web_search"
        }
        COPILOT_QUERY_ONLY_RULE => inferred_acp_source_is_allowlisted(
            adapter,
            AdapterKind::CopilotCli,
            protocol_family,
            event_type,
            source_event_kind,
            native_kind,
            "search",
            observed_runtime_version,
            "1.0.79",
        ),
        QODER_QUERY_ONLY_RULE => inferred_acp_source_is_allowlisted(
            adapter,
            AdapterKind::QoderCli,
            protocol_family,
            event_type,
            source_event_kind,
            native_kind,
            "search",
            observed_runtime_version,
            "1.1.28",
        ),
        KIRO_QUERY_ONLY_RULE => inferred_acp_source_is_allowlisted(
            adapter,
            AdapterKind::KiroCli,
            protocol_family,
            event_type,
            source_event_kind,
            native_kind,
            "search",
            observed_runtime_version,
            "2.18.1",
        ),
        CODEBUDDY_QUERY_ONLY_RULE => {
            inferred_acp_source_is_allowlisted(
                adapter,
                AdapterKind::CodebuddyCli,
                protocol_family,
                event_type,
                source_event_kind,
                native_kind,
                "fetch",
                observed_runtime_version,
                "2.133.1",
            ) && matches!(
                source_event_kind,
                "session/update.tool_call_update.completed"
                    | "session/update.tool_call_update.failed"
            )
        }
        _ => false,
    };
    if !source_is_allowlisted
        || (protocol_family == "acp-v1"
            && !acp_source_event_matches_payload(source_event_kind, payload))
    {
        return Err("runtime_search_operation_source_not_allowlisted");
    }

    Ok(AdmittedRuntimeSearchOperation {
        search_kind: "web".to_string(),
        query: query.to_string(),
        adapter_kind: adapter_kind.to_string(),
        protocol_family: protocol_family.to_string(),
        source_event_kind: source_event_kind.to_string(),
        admission_rule: admission_rule.to_string(),
        observed_runtime_version: observed_runtime_version.map(str::to_string),
    })
}

#[allow(clippy::too_many_arguments)]
fn inferred_acp_source_is_allowlisted(
    observed_adapter: AdapterKind,
    expected_adapter: AdapterKind,
    protocol_family: &str,
    event_type: &str,
    source_event_kind: &str,
    native_kind: &str,
    expected_native_kind: &str,
    observed_runtime_version: Option<&str>,
    qualified_version: &str,
) -> bool {
    observed_adapter == expected_adapter
        && protocol_family == "acp-v1"
        && event_type == "runtime.action"
        && acp_source_event_is_allowlisted(source_event_kind)
        && native_kind == expected_native_kind
        && observed_runtime_version
            .is_some_and(|version| version_contains_token(version, qualified_version))
}

fn acp_source_event_is_allowlisted(source_event_kind: &str) -> bool {
    matches!(
        source_event_kind,
        "session/update.tool_call"
            | "session/update.tool_call_update"
            | "session/update.tool_call_update.completed"
            | "session/update.tool_call_update.failed"
    )
}

fn acp_source_event_matches_payload(source_event_kind: &str, payload: &Value) -> bool {
    let status = payload.get("status").and_then(Value::as_str);
    match source_event_kind {
        "session/update.tool_call" | "session/update.tool_call_update" => {
            !matches!(status, Some("completed" | "failed"))
        }
        "session/update.tool_call_update.completed" => status == Some("completed"),
        "session/update.tool_call_update.failed" => status == Some("failed"),
        _ => false,
    }
}

fn candidate(
    adapter_kind: AdapterKind,
    protocol_family: &str,
    source_event_kind: &str,
    admission_rule: &str,
    native_kind: &str,
    query: &str,
) -> Value {
    json!({
        "adapterKind": adapter_kind.as_str(),
        "protocolFamily": protocol_family,
        "sourceEventKind": source_event_kind,
        "admissionRule": admission_rule,
        "nativeKind": native_kind,
        "searchKind": "web",
        "query": query,
    })
}

fn query_only(raw_input: &Value) -> Option<&str> {
    let input = raw_input.as_object()?;
    (input.len() == 1).then_some(())?;
    nonempty_query(input.get("query"))
}

fn nonempty_query(query: Option<&Value>) -> Option<&str> {
    query?.as_str().filter(|query| !query.trim().is_empty())
}

fn required_string<'a>(value: &'a Value, key: &str) -> Result<&'a str, &'static str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or("runtime_search_operation_candidate_invalid")
}

fn version_contains_token(observed: &str, expected: &str) -> bool {
    observed
        .split(|character: char| {
            !(character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '+' | '_'))
        })
        .any(|token| token == expected || token.strip_prefix('v') == Some(expected))
}

pub fn unavailable_projection(
    reason: &str,
    candidate: Option<&Value>,
    observed_runtime_version: Option<&str>,
) -> Value {
    json!({
        "schemaVersion": SEARCH_OPERATION_SCHEMA_VERSION,
        "source": "runtime_reported",
        "status": "unavailable",
        "searchKind": "web",
        "safeReasonCode": reason,
        "sourceMetadata": {
            "adapterKind": candidate.and_then(|value| value.get("adapterKind")),
            "protocolFamily": candidate.and_then(|value| value.get("protocolFamily")),
            "sourceEventKind": candidate.and_then(|value| value.get("sourceEventKind")),
            "admissionRule": candidate.and_then(|value| value.get("admissionRule")),
            "observedRuntimeVersion": observed_runtime_version,
        },
    })
}

pub fn insert_candidate(payload: &mut Value, candidate: Option<Value>) {
    let (Some(payload), Some(candidate)) = (payload.as_object_mut(), candidate) else {
        return;
    };
    payload.insert(SEARCH_OPERATION_CANDIDATE_FIELD.to_string(), candidate);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(candidate: Value, item_type: Option<&str>, tool_name: Option<&str>) -> Value {
        let source_event_kind = candidate
            .get("sourceEventKind")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let status = if source_event_kind.ends_with(".completed") {
            "completed"
        } else if source_event_kind.ends_with(".failed") {
            "failed"
        } else {
            "in_progress"
        };
        let query = candidate.get("query").cloned().unwrap_or(Value::Null);
        let mut value = json!({
            SEARCH_OPERATION_CANDIDATE_FIELD: candidate,
            "status": status,
        });
        if let Some(item_type) = item_type {
            value["item"] = json!({"type": item_type, "query": query});
        }
        if let Some(tool_name) = tool_name {
            value["toolName"] = json!(tool_name);
        }
        value
    }

    #[test]
    fn explicit_codex_and_claude_events_are_admitted_by_identity() {
        let codex = codex_web_search_candidate(
            "item/started",
            Some(&json!({"type": "webSearch", "query": "exact query"})),
        )
        .expect("Codex webSearch should create a candidate");
        let admitted = admit_runtime_search_operation(
            "activity.started",
            &payload(codex, Some("webSearch"), None),
            Some("codex-cli"),
            Some("codex-cli 0.147.0"),
        )
        .unwrap()
        .unwrap();
        assert_eq!(admitted.query, "exact query");

        let claude = claude_web_search_candidate(
            "assistant.tool_use.WebSearch",
            "WebSearch",
            Some("exact query"),
        )
        .expect("Claude WebSearch should create a candidate");
        let admitted = admit_runtime_search_operation(
            "runtime.action",
            &payload(claude, None, Some("WebSearch")),
            Some("claude-code-cli"),
            Some("2.1.220"),
        )
        .unwrap()
        .unwrap();
        assert_eq!(admitted.query, "exact query");
    }

    #[test]
    fn inferred_acp_searches_require_adapter_shape_and_qualified_version() {
        for (adapter, kind, version) in [
            (AdapterKind::CopilotCli, "search", "1.0.79"),
            (AdapterKind::QoderCli, "search", "qoder 1.1.28"),
            (AdapterKind::KiroCli, "search", "kiro-cli v2.18.1"),
            (AdapterKind::CodebuddyCli, "fetch", "2.133.1"),
        ] {
            let candidate = acp_web_search_candidate(
                adapter,
                Some("tool_call_update"),
                "completed",
                kind,
                Some(&json!({"query": "network query"})),
            )
            .expect("qualified ACP shape should create a candidate");
            let admitted = admit_runtime_search_operation(
                "runtime.action",
                &payload(candidate, None, None),
                Some(adapter.as_str()),
                Some(version),
            )
            .unwrap()
            .unwrap();
            assert_eq!(admitted.query, "network query");
        }
    }

    #[test]
    fn project_search_shapes_and_unqualified_versions_are_not_admitted() {
        for input in [
            json!({"pattern": "needle"}),
            json!({"path": "/repo", "pattern": "needle"}),
            json!({"output_mode": "files_with_matches", "path": "/repo", "pattern": "needle"}),
            json!({"query": "needle", "providerPrivate": true}),
        ] {
            assert!(
                acp_web_search_candidate(
                    AdapterKind::QoderCli,
                    Some("tool_call_update"),
                    "completed",
                    "search",
                    Some(&input),
                )
                .is_none()
            );
        }

        let candidate = acp_web_search_candidate(
            AdapterKind::KiroCli,
            Some("tool_call_update"),
            "completed",
            "search",
            Some(&json!({"query": "network query"})),
        )
        .unwrap();
        assert_eq!(
            admit_runtime_search_operation(
                "runtime.action",
                &payload(candidate, None, None),
                Some("kiro-cli"),
                Some("2.19.0"),
            )
            .unwrap(),
            Err("runtime_search_operation_source_not_allowlisted")
        );
    }

    #[test]
    fn codebuddy_requires_a_terminal_fetch_event() {
        assert!(
            acp_web_search_candidate(
                AdapterKind::CodebuddyCli,
                Some("tool_call"),
                "in_progress",
                "fetch",
                Some(&json!({"query": "network query"})),
            )
            .is_none()
        );
    }

    #[test]
    fn explicit_acp_web_search_copies_only_the_query() {
        let candidate = acp_web_search_candidate(
            AdapterKind::OpencodeCli,
            Some("tool_call"),
            "in_progress",
            "web_search",
            Some(&json!({"query": "network query", "providerPrivate": "not public"})),
        )
        .unwrap();
        assert_eq!(candidate["query"], "network query");
        assert!(candidate.get("providerPrivate").is_none());
    }
}
