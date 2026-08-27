//! Core-owned mapping from observed Runtime Evidence to the current activity projection.
//!
//! v0.41 intentionally keeps this small: Evidence stays append-only, a stable
//! Runtime/Core identity selects one operation, and a versioned mapping registry
//! maintains one current projection for that operation.  No hidden Runtime work is
//! inferred and no fuzzy identity correlation is performed.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::{
    builtin_tool_transport, runtime_activity_mapping,
    runtime_diff::{self, CommandDiffProjection},
};

pub use crate::runtime_activity_mapping::CLASSIFIER_VERSION;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalRuntimeActivity {
    pub operation_id: String,
    pub classifier_version: String,
    pub activity_domain: String,
    pub semantic_kind: Option<String>,
    pub tool_name: Option<String>,
    pub presentation_hint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff_projection: Option<CommandDiffProjection>,
    pub phase: String,
    pub outcome: String,
    pub credibility: String,
    pub coverage_level: String,
    pub source_authority: String,
    pub source_evidence_ids: Vec<String>,
    pub first_evidence_sequence: i64,
    pub last_evidence_sequence: i64,
    pub revision: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EvidenceActivityFacts {
    pub is_activity: bool,
    pub operation_id: String,
    pub identity_authority: String,
    pub activity_domain: String,
    pub semantic_kind: Option<String>,
    pub classification_is_structured: bool,
    pub tool_name: Option<String>,
    pub presentation_hint: Option<String>,
    pub presentation_hint_is_explicit: bool,
    pub diff_projection: Option<CommandDiffProjection>,
    pub phase: String,
    pub outcome: String,
    pub credibility: String,
    pub coverage_level: String,
    pub source_authority: String,
}

pub fn classify_evidence(
    agent_run_id: &str,
    execution_epoch: i64,
    evidence_id: &str,
    event_type: &str,
    kind: &str,
    phase: &str,
    payload: &Value,
) -> EvidenceActivityFacts {
    let item = payload.get("item").unwrap_or(&Value::Null);
    let item_type = item.get("type").and_then(Value::as_str).unwrap_or_default();
    let source_authority = payload
        .get("sourceAuthority")
        .and_then(Value::as_str)
        .unwrap_or("runtime")
        .to_string();
    let validated_core_tool = (source_authority == "core")
        .then(|| payload.get("canonicalTool").and_then(Value::as_str))
        .flatten()
        .and_then(builtin_tool_transport::builtin_tool_identity_by_operation)
        .map(|identity| identity.operation.to_string());
    let runtime_tool_name = string_field(payload, "toolName")
        .or_else(|| string_field(item, "toolName"))
        .or_else(|| {
            let server = string_field(item, "server")?;
            let tool = string_field(item, "tool").or_else(|| string_field(item, "name"))?;
            Some(format!("{server}/{tool}"))
        })
        .or_else(|| string_field(item, "tool"));
    let core_identity = (source_authority == "core")
        .then(|| string_field(payload, "coreActionId"))
        .flatten();
    let stable_identity = core_identity
        .clone()
        .or_else(|| string_field(payload, "operationId"))
        .or_else(|| string_field(payload, "toolCallId"))
        .or_else(|| string_field(payload, "itemId"))
        .or_else(|| string_field(item, "id"));
    let identity_authority = if core_identity.is_some() {
        "core"
    } else if stable_identity.is_some() {
        "runtime"
    } else {
        "evidence"
    };
    let identity = stable_identity.unwrap_or_else(|| format!("evidence:{evidence_id}"));
    let operation_id = stable_operation_id(agent_run_id, execution_epoch, &identity);
    let is_activity = !matches!(kind, "reasoning_summary" | "narration" | "plan")
        && !matches!(
            event_type,
            "agent.reasoning.summary.delta"
                | "agent.thought.delta"
                | "agent.text.delta"
                | "runtime.plan"
                | "runtime.plan.delta"
                | "runtime.diagnostic"
        );
    let (mut activity_domain, mut semantic_kind, runtime_classification_is_structured) =
        runtime_activity_mapping::classify_with_structure(item_type, kind, payload);
    let diff_projection = runtime_diff::projection_from_evidence(payload, evidence_id);
    if diff_projection
        .as_ref()
        .is_some_and(|projection| projection.status == "available")
    {
        activity_domain = "file".to_string();
        semantic_kind = Some("file.write".to_string());
    }
    let classification_is_structured = runtime_classification_is_structured
        || validated_core_tool.is_some()
        || diff_projection.is_some();
    let phase = canonical_phase(event_type, phase, payload);
    let outcome = canonical_outcome(&phase, payload);
    let tool_name = validated_core_tool.clone().or(runtime_tool_name);
    let credibility = if validated_core_tool.is_some() {
        "core_verified"
    } else if tool_name.is_some()
        || !item_type.is_empty()
        || payload.get("kind").and_then(Value::as_str).is_some()
    {
        "runtime_structured"
    } else {
        "runtime_reported"
    };
    let coverage_level = if activity_domain == "runtime" {
        "run_level"
    } else if activity_domain == "unknown" {
        "unknown"
    } else {
        "fine_grained"
    };
    let observed_presentation_hint = string_field(payload, "title")
        .or_else(|| string_field(item, "title"))
        .or_else(|| runtime_activity_mapping::structured_presentation_hint(item_type, item));
    let presentation_hint_is_explicit = observed_presentation_hint.is_some();
    let presentation_hint = observed_presentation_hint.or_else(|| {
        runtime_activity_mapping::default_presentation_hint(
            &activity_domain,
            semantic_kind.as_deref(),
        )
    });
    EvidenceActivityFacts {
        is_activity,
        operation_id,
        identity_authority: identity_authority.to_string(),
        activity_domain,
        semantic_kind,
        classification_is_structured,
        tool_name,
        presentation_hint,
        presentation_hint_is_explicit,
        diff_projection,
        phase,
        outcome,
        credibility: credibility.to_string(),
        coverage_level: coverage_level.to_string(),
        source_authority,
    }
}

pub fn new_projection(
    facts: EvidenceActivityFacts,
    evidence_id: &str,
    sequence: i64,
) -> Option<CanonicalRuntimeActivity> {
    facts.is_activity.then(|| CanonicalRuntimeActivity {
        operation_id: facts.operation_id,
        classifier_version: CLASSIFIER_VERSION.to_string(),
        activity_domain: facts.activity_domain,
        semantic_kind: facts.semantic_kind,
        tool_name: facts.tool_name,
        presentation_hint: facts.presentation_hint,
        diff_projection: facts.diff_projection,
        phase: facts.phase,
        outcome: facts.outcome,
        credibility: facts.credibility,
        coverage_level: facts.coverage_level,
        source_authority: facts.source_authority,
        source_evidence_ids: vec![evidence_id.to_string()],
        first_evidence_sequence: sequence,
        last_evidence_sequence: sequence,
        revision: 1,
    })
}

pub fn merge_projection(
    mut projection: CanonicalRuntimeActivity,
    facts: EvidenceActivityFacts,
    evidence_id: &str,
    sequence: i64,
) -> CanonicalRuntimeActivity {
    let prior_phase = projection.phase.clone();
    let prior_outcome = projection.outcome.clone();
    let prior_credibility_rank = credibility_rank(&projection.credibility);
    let incoming_credibility_rank = credibility_rank(&facts.credibility);
    let prior_default_presentation_hint = runtime_activity_mapping::default_presentation_hint(
        &projection.activity_domain,
        projection.semantic_kind.as_deref(),
    );
    if let Some(incoming) = facts.diff_projection {
        projection.diff_projection = Some(runtime_diff::merge_projection(
            projection.diff_projection.take(),
            incoming,
        ));
    }
    if prior_phase == "terminal"
        && facts.phase == "terminal"
        && is_settled_outcome(&prior_outcome)
        && is_settled_outcome(&facts.outcome)
        && prior_outcome != facts.outcome
    {
        projection.outcome = "unsettled".to_string();
    } else if facts.outcome != "unknown" {
        projection.outcome = facts.outcome;
    }
    if facts.phase == "terminal" || facts.phase == "progress" {
        projection.phase = facts.phase.clone();
    }
    let replace_classification = (facts.classification_is_structured
        || (projection.activity_domain == "unknown" && facts.activity_domain != "unknown"))
        && incoming_credibility_rank >= prior_credibility_rank;
    if replace_classification {
        projection.activity_domain = facts.activity_domain.clone();
        projection.semantic_kind = facts.semantic_kind.clone();
    }
    if facts.tool_name.is_some() && incoming_credibility_rank >= prior_credibility_rank {
        projection.tool_name = facts.tool_name.clone();
    }
    if facts.presentation_hint_is_explicit
        || projection.presentation_hint.is_none()
        || (replace_classification
            && projection.presentation_hint == prior_default_presentation_hint)
    {
        projection.presentation_hint = facts.presentation_hint.clone();
    }
    if incoming_credibility_rank > prior_credibility_rank {
        projection.credibility = facts.credibility.clone();
    }
    if projection.coverage_level == "unknown" {
        projection.coverage_level = facts.coverage_level;
    }
    if projection.source_authority != "core" {
        projection.source_authority = facts.source_authority;
    }
    if !projection
        .source_evidence_ids
        .iter()
        .any(|id| id == evidence_id)
    {
        projection.source_evidence_ids.push(evidence_id.to_string());
    }
    projection.last_evidence_sequence = sequence;
    projection.revision += 1;
    projection
}

fn canonical_phase(event_type: &str, phase: &str, payload: &Value) -> String {
    if event_type == "activity.started" || phase == "started" {
        return "started".to_string();
    }
    if event_type == "activity.completed" || matches!(phase, "completed" | "failed") {
        return "terminal".to_string();
    }
    if payload
        .get("status")
        .and_then(Value::as_str)
        .is_some_and(|status| {
            matches!(
                status,
                "completed" | "succeeded" | "failed" | "declined" | "cancelled" | "error"
            )
        })
    {
        return "terminal".to_string();
    }
    "progress".to_string()
}

fn canonical_outcome(phase: &str, payload: &Value) -> String {
    let status = payload
        .get("status")
        .and_then(Value::as_str)
        .or_else(|| payload.pointer("/item/status").and_then(Value::as_str));
    match status {
        Some("succeeded" | "completed" | "success") => "succeeded",
        Some("failed" | "error") => "failed",
        Some("declined" | "denied") => "denied",
        Some("cancelled" | "canceled") => "cancelled",
        Some("not_executed") => "not_executed",
        _ if phase == "terminal" => "unsettled",
        _ => "unknown",
    }
    .to_string()
}

fn is_settled_outcome(outcome: &str) -> bool {
    matches!(
        outcome,
        "succeeded" | "failed" | "denied" | "cancelled" | "not_executed"
    )
}

fn credibility_rank(credibility: &str) -> u8 {
    match credibility {
        "core_verified" => 3,
        "runtime_structured" => 2,
        "runtime_reported" => 1,
        _ => 0,
    }
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

fn stable_operation_id(agent_run_id: &str, execution_epoch: i64, identity: &str) -> String {
    let digest = Sha256::digest(format!("{agent_run_id}|{execution_epoch}|{identity}").as_bytes());
    format!("operation:sha256:{digest:x}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn mapping_registry_uses_structured_fields_not_title_guessing() {
        let facts = classify_evidence(
            "run-1",
            1,
            "evidence-1",
            "runtime.action",
            "tool_call",
            "updated",
            &json!({"toolCallId": "call-1", "kind": "read", "title": "随便一个标题", "status": "running"}),
        );
        assert_eq!(facts.activity_domain, "file");
        assert_eq!(facts.semantic_kind.as_deref(), Some("file.read"));
        assert_eq!(facts.presentation_hint.as_deref(), Some("随便一个标题"));
    }

    #[test]
    fn runtime_diagnostics_do_not_become_tool_activity() {
        let facts = classify_evidence(
            "run-1",
            1,
            "evidence-1",
            "runtime.diagnostic",
            "step",
            "updated",
            &json!({
                "diagnosticId": "claude-api-retry",
                "code": "runtime_api_retrying",
                "status": "retrying",
                "attempt": 1,
                "maxAttempts": 10
            }),
        );
        assert!(!facts.is_activity);
        assert!(new_projection(facts, "evidence-1", 1).is_none());
    }

    #[test]
    fn only_validated_core_catalog_names_are_authoritative() {
        let valid = classify_evidence(
            "run-1",
            1,
            "evidence-1",
            "runtime.action",
            "tool_call",
            "updated",
            &json!({"toolCallId": "call-1", "sourceAuthority": "core", "canonicalTool": "camp.message.send", "status": "running"}),
        );
        let invalid = classify_evidence(
            "run-1",
            1,
            "evidence-2",
            "runtime.action",
            "tool_call",
            "updated",
            &json!({"toolCallId": "call-2", "sourceAuthority": "runtime", "canonicalTool": "pretend.tool", "status": "running"}),
        );
        let forged_core_identity = classify_evidence(
            "run-1",
            1,
            "evidence-3",
            "runtime.action",
            "tool_call",
            "updated",
            &json!({"coreActionId": "forged-core-action", "sourceAuthority": "runtime", "status": "running"}),
        );
        assert_eq!(valid.tool_name.as_deref(), Some("camp.message.send"));
        assert_eq!(valid.credibility, "core_verified");
        assert_eq!(invalid.tool_name, None);
        assert_eq!(forged_core_identity.identity_authority, "evidence");
    }

    #[test]
    fn started_and_completed_update_one_projection() {
        let started = classify_evidence(
            "run-1",
            1,
            "evidence-1",
            "activity.started",
            "command",
            "started",
            &json!({"item": {"id": "item-1", "type": "commandExecution", "status": "inProgress"}}),
        );
        let completed = classify_evidence(
            "run-1",
            1,
            "evidence-2",
            "activity.completed",
            "command",
            "completed",
            &json!({"item": {"id": "item-1", "type": "commandExecution", "status": "completed"}}),
        );
        assert_eq!(started.operation_id, completed.operation_id);
        let projection = new_projection(started, "evidence-1", 1).unwrap();
        let projection = merge_projection(projection, completed, "evidence-2", 2);
        assert_eq!(projection.phase, "terminal");
        assert_eq!(projection.outcome, "succeeded");
        assert_eq!(
            projection.source_evidence_ids,
            vec!["evidence-1", "evidence-2"]
        );
        assert_eq!(projection.revision, 2);
    }

    #[test]
    fn claude_edit_diff_upgrades_the_existing_tool_activity_instead_of_creating_another_one() {
        let started = classify_evidence(
            "run-claude",
            1,
            "evidence-started",
            "runtime.action",
            "tool_call",
            "updated",
            &json!({
                "toolCallId": "toolu_edit_1",
                "toolName": "Edit",
                "kind": "edit",
                "status": "in_progress"
            }),
        );
        let completed = classify_evidence(
            "run-claude",
            1,
            "evidence-completed",
            "runtime.action",
            "tool_result",
            "completed",
            &json!({
                "toolCallId": "toolu_edit_1",
                "toolName": "Edit",
                "kind": "edit",
                "status": "completed",
                "runtimeDiff": {
                    "schemaVersion": 1,
                    "source": "runtime_reported",
                    "status": "available",
                    "semanticKind": "exact_mutation",
                    "entries": [{
                        "semantics": "exact_mutation",
                        "path": "src/app.ts",
                        "oldText": "false",
                        "newText": "true"
                    }]
                }
            }),
        );

        assert_eq!(started.operation_id, completed.operation_id);
        let projection = new_projection(started, "evidence-started", 1).unwrap();
        let projection = merge_projection(projection, completed, "evidence-completed", 2);
        assert_eq!(projection.activity_domain, "file");
        assert_eq!(projection.semantic_kind.as_deref(), Some("file.write"));
        assert_eq!(projection.tool_name.as_deref(), Some("Edit"));
        assert_eq!(projection.phase, "terminal");
        assert_eq!(projection.outcome, "succeeded");
        assert_eq!(
            projection
                .diff_projection
                .as_ref()
                .and_then(|diff| diff.semantic_kind.as_deref()),
            Some("exact_mutation")
        );
        assert_eq!(projection.source_evidence_ids.len(), 2);
    }

    #[test]
    fn codex_command_presentation_hint_survives_completion_merge() {
        let started = classify_evidence(
            "run-1",
            1,
            "evidence-1",
            "activity.started",
            "command",
            "started",
            &json!({
                "item": {
                    "id": "item-1",
                    "type": "commandExecution",
                    "status": "inProgress",
                    "title": null,
                    "commandActions": [{
                        "type": "read",
                        "name": "cat",
                        "path": "/repo/docs/README.md"
                    }]
                }
            }),
        );
        let completed = classify_evidence(
            "run-1",
            1,
            "evidence-2",
            "activity.completed",
            "command",
            "completed",
            &json!({
                "item": {
                    "id": "item-1",
                    "type": "commandExecution",
                    "status": "completed",
                    "title": null
                }
            }),
        );
        assert_eq!(started.presentation_hint.as_deref(), Some("读取 README.md"));
        assert!(started.presentation_hint_is_explicit);
        let projection = new_projection(started, "evidence-1", 1).unwrap();
        let projection = merge_projection(projection, completed, "evidence-2", 2);
        assert_eq!(
            projection.presentation_hint.as_deref(),
            Some("读取 README.md")
        );
        assert_eq!(projection.phase, "terminal");
        assert_eq!(projection.outcome, "succeeded");
    }

    #[test]
    fn sparse_acp_completion_preserves_structured_start_metadata() {
        let started = classify_evidence(
            "run-1",
            1,
            "evidence-1",
            "runtime.action",
            "tool_call",
            "updated",
            &json!({
                "toolCallId": "call-1",
                "kind": "execute",
                "title": "Count APAR rows per side up to 2026-06",
                "status": "running"
            }),
        );
        let completed = classify_evidence(
            "run-1",
            1,
            "evidence-2",
            "runtime.action",
            "tool_result",
            "completed",
            &json!({
                "toolCallId": "call-1",
                "status": "completed",
                "kind": null,
                "toolName": null,
                "title": null
            }),
        );
        assert!(started.classification_is_structured);
        assert!(!completed.classification_is_structured);
        assert_eq!(completed.credibility, "runtime_reported");
        let projection = new_projection(started, "evidence-1", 1).unwrap();
        let projection = merge_projection(projection, completed, "evidence-2", 2);
        assert_eq!(projection.activity_domain, "shell");
        assert_eq!(projection.semantic_kind.as_deref(), Some("shell.execute"));
        assert_eq!(
            projection.presentation_hint.as_deref(),
            Some("Count APAR rows per side up to 2026-06")
        );
        assert_eq!(projection.phase, "terminal");
        assert_eq!(projection.outcome, "succeeded");
        assert_eq!(projection.credibility, "runtime_structured");
    }

    #[test]
    fn later_structured_fact_upgrades_an_unknown_projection() {
        let unknown = classify_evidence(
            "run-1",
            1,
            "evidence-1",
            "runtime.event",
            "future_event",
            "updated",
            &json!({"operationId": "call-1", "status": "running"}),
        );
        let structured = classify_evidence(
            "run-1",
            1,
            "evidence-2",
            "runtime.action",
            "tool_result",
            "completed",
            &json!({"operationId": "call-1", "kind": "read", "status": "completed"}),
        );
        assert_eq!(unknown.activity_domain, "unknown");
        assert!(!unknown.classification_is_structured);
        let projection = new_projection(unknown, "evidence-1", 1).unwrap();
        let projection = merge_projection(projection, structured, "evidence-2", 2);
        assert_eq!(projection.activity_domain, "file");
        assert_eq!(projection.semantic_kind.as_deref(), Some("file.read"));
        assert_eq!(projection.presentation_hint.as_deref(), Some("读取文件"));
    }

    #[test]
    fn missing_native_identity_uses_evidence_id_without_fuzzy_merge() {
        let first = classify_evidence(
            "run-1",
            1,
            "evidence-1",
            "runtime.action",
            "tool_call",
            "updated",
            &json!({"status": "running"}),
        );
        let second = classify_evidence(
            "run-1",
            1,
            "evidence-2",
            "runtime.action",
            "tool_call",
            "updated",
            &json!({"status": "running"}),
        );
        assert_ne!(first.operation_id, second.operation_id);
        assert_eq!(first.identity_authority, "evidence");
    }
}
