//! Bounded, read-only metadata export for rule-based daily analysis.
//! This is a user operation, never an Agent Built-in or an execution path.

use std::collections::{BTreeMap, BTreeSet};

use anyhow::{Context, Result, bail};
use chrono::{DateTime, Duration, Utc};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{
    command::canonical_json_digest, db::Database, runtime_activity_mapping::CLASSIFIER_VERSION,
};

pub const SCHEMA_VERSION: u32 = 1;
const ROW_LIMIT: usize = 5_000;
const BYTE_LIMIT: usize = 3 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TraceExportParams {
    pub since: DateTime<Utc>,
    pub until: DateTime<Utc>,
    #[serde(default)]
    pub camp_ids: Vec<String>,
    #[serde(default)]
    pub exclude_camp_ids: Vec<String>,
    #[serde(default)]
    pub exclude_automation_ids: Vec<String>,
}

impl TraceExportParams {
    pub fn validate(&self) -> Result<()> {
        if self.until <= self.since || self.until - self.since > Duration::hours(26) {
            bail!("trace_export_invalid_window: expected a positive window of at most 26 hours");
        }
        for ids in [
            &self.camp_ids,
            &self.exclude_camp_ids,
            &self.exclude_automation_ids,
        ] {
            if ids.len() > 100
                || ids.iter().any(|id| {
                    id.is_empty() || id.len() > 128 || id.chars().any(char::is_whitespace)
                })
            {
                bail!("trace_export_invalid_scope: expected at most 100 non-empty IDs per filter");
            }
        }
        Ok(())
    }
}

// A CampTurn owns its A2A descendants. Excluding an Automation identity therefore
// excludes the whole execution tree, while retaining ordinary user automations.
const SCOPE: &str = r#"
WITH eligible_turns AS (
    SELECT t.id, t.camp_id, a.id AS automation_run_id, a.automation_id
    FROM camp_turn t LEFT JOIN automation_run a ON a.id = t.automation_run_id
    WHERE (json_array_length(:camps) = 0 OR t.camp_id IN (SELECT value FROM json_each(:camps)))
      AND t.camp_id NOT IN (SELECT value FROM json_each(:excluded_camps))
      AND (a.automation_id IS NULL OR a.automation_id NOT IN (SELECT value FROM json_each(:excluded_automations)))
)
"#;

const RUNS: &str = r#"
SELECT json_object(
    'agentRunId', r.id, 'campId', t.camp_id, 'campTurnId', t.id,
    'automationId', t.automation_id, 'automationRunId', t.automation_run_id,
    'status', r.status, 'waitReason', r.wait_reason,
    'createdAt', r.created_at, 'inputReadyAt', r.input_ready_at,
    'startedAt', r.started_at, 'endedAt', r.ended_at,
    'executionEpoch', r.execution_epoch, 'startReason', r.start_reason,
    'predecessorAgentRunId', r.predecessor_agent_run_id,
    'automaticRetryCount', r.automatic_retry_count,
    'runtimeKind', r.runtime_adapter_kind, 'runtimeVersion', r.runtime_reported_version,
    'observedModelId', r.runtime_observed_model_id,
    'bindingCompatibilityDigest', r.runtime_binding_compatibility_digest,
    'failureOrigin', json_extract(r.public_runtime_failure_json, '$.origin'),
    'failurePhase', json_extract(r.public_runtime_failure_json, '$.phase'),
    'failureCode', json_extract(r.public_runtime_failure_json, '$.code'),
    'evidenceCount', (SELECT COUNT(*) FROM agent_run_execution_evidence e WHERE e.agent_run_id = r.id)
)
FROM agent_run r JOIN eligible_turns t ON t.id = r.camp_turn_id
WHERE julianday(r.created_at) < julianday(:until)
  AND (r.ended_at IS NULL OR julianday(r.ended_at) >= julianday(:since))
ORDER BY r.created_at, r.id LIMIT :row_limit
"#;

const DELIVERIES: &str = r#"
SELECT json_object(
    'deliveryId', d.id, 'campId', t.camp_id, 'campTurnId', t.id,
    'automationId', t.automation_id, 'deliveryKind', d.delivery_kind,
    'sourceAgentRunId', d.source_agent_run_id, 'targetAgentRunId', d.target_agent_run_id,
    'a2aRootAgentRunId', d.a2a_root_agent_run_id, 'edgeKind', d.edge_kind,
    'dispatchDisposition', d.dispatch_disposition,
    'status', d.status, 'dispatchPhase', d.dispatch_phase,
    'waitCondition', d.wait_condition, 'targetRunWaitReason', r.wait_reason,
    'failureCode', d.failure_code, 'retryGeneration', d.retry_generation,
    'dispatchAttemptCount', d.dispatch_attempt_count,
    'createdAt', d.created_at, 'endedAt', d.ended_at, 'updatedAt', d.updated_at
)
FROM message_delivery d JOIN eligible_turns t ON t.id = d.camp_turn_id
LEFT JOIN agent_run r ON r.id = d.target_agent_run_id
WHERE julianday(d.created_at) < julianday(:until)
  AND (d.ended_at IS NULL OR julianday(d.ended_at) >= julianday(:since))
ORDER BY d.created_at, d.id LIMIT :row_limit
"#;

// No raw payload is exported. Current Delivery rows can lose an earlier terminal
// on retry, so retain the durable event identities and their observed order too.
const DELIVERY_EVENTS: &str = r#"
SELECT json_object(
    'eventId', e.event_id, 'globalSequence', e.global_sequence,
    'deliveryId', d.id, 'campId', t.camp_id, 'campTurnId', t.id,
    'automationId', t.automation_id, 'deliveryKind', d.delivery_kind,
    'dispatchDisposition', d.dispatch_disposition,
    'eventType', e.event_type, 'occurredAt', e.created_at,
    'retryGeneration', json_extract(e.payload_json, '$.retryGeneration'),
    'failureCode', json_extract(e.payload_json, '$.failureCode')
)
FROM event_log e
JOIN message_delivery d ON e.entity_type = 'message_delivery' AND e.entity_id = d.id
JOIN eligible_turns t ON t.id = d.camp_turn_id
WHERE e.event_type IN ('message_delivery.settled', 'message_delivery.failed',
    'message_delivery.cancelled', 'message_delivery.interrupted_before_dispatch',
    'message_delivery.retry_requested')
  AND julianday(e.created_at) >= julianday(:since)
  AND julianday(e.created_at) < julianday(:until)
ORDER BY e.global_sequence LIMIT :row_limit
"#;

const TOOLS: &str = r#"
SELECT json_object(
    'agentRunId', a.agent_run_id, 'campId', t.camp_id, 'campTurnId', t.id,
    'automationId', t.automation_id, 'executionEpoch', a.execution_epoch,
    'operationId', a.operation_id, 'classifierVersion', a.classifier_version,
    'activityDomain', a.activity_domain, 'semanticKind', a.semantic_kind,
    'phase', a.phase, 'outcome', a.outcome, 'coverageLevel', a.coverage_level,
    'sourceAuthority', a.source_authority,
    'firstEvidenceSequence', a.first_evidence_sequence, 'lastEvidenceSequence', a.last_evidence_sequence,
    'firstObservedAt', first_e.occurred_at, 'lastObservedAt', last_e.occurred_at,
    'originalTerminalObservedAt', original_e.occurred_at,
    'originalTerminalEvidenceSequence', original_e.sequence,
    'idempotentReplay', CASE WHEN a.source_authority = 'core'
        THEN json_extract(COALESCE(original_e.payload_preview_json, last_e.payload_preview_json), '$.idempotentReplay') ELSE NULL END,
    'errorCode', CASE WHEN a.source_authority = 'core'
        THEN json_extract(COALESCE(original_e.payload_preview_json, last_e.payload_preview_json), '$.errorCode') ELSE NULL END
)
FROM canonical_runtime_activity a
JOIN agent_run r ON r.id = a.agent_run_id JOIN eligible_turns t ON t.id = r.camp_turn_id
LEFT JOIN agent_run_execution_evidence first_e
    ON first_e.agent_run_id = a.agent_run_id AND first_e.sequence = a.first_evidence_sequence
LEFT JOIN agent_run_execution_evidence last_e
    ON last_e.agent_run_id = a.agent_run_id AND last_e.sequence = a.last_evidence_sequence
LEFT JOIN agent_run_execution_evidence original_e ON original_e.id = (
    SELECT e.id FROM agent_run_execution_evidence e
    JOIN json_each(a.source_evidence_ids_json) source ON source.value = e.id
    WHERE a.source_authority = 'core' AND e.agent_run_id = a.agent_run_id
      AND e.execution_epoch = a.execution_epoch AND e.phase IN ('completed', 'failed')
      AND json_extract(e.payload_preview_json, '$.idempotentReplay') = 0
    ORDER BY e.sequence LIMIT 1
)
WHERE a.classifier_version = :classifier
  AND a.activity_domain IN ('shell', 'file', 'tool')
  AND (first_e.occurred_at IS NULL OR julianday(first_e.occurred_at) < julianday(:until))
  AND (last_e.occurred_at IS NULL OR a.phase <> 'terminal'
       OR julianday(last_e.occurred_at) >= julianday(:since))
ORDER BY a.agent_run_id, a.execution_epoch, a.operation_id LIMIT :row_limit
"#;

pub fn export(database: &mut Database, params: &TraceExportParams) -> Result<Value> {
    params.validate()?;
    let transaction = database.connection_mut().transaction()?;
    let watermark: i64 = transaction.query_row(
        "SELECT last_sequence FROM event_sequence WHERE singleton = 1",
        [],
        |row| row.get(0),
    )?;
    let as_of = Utc::now();
    if params.until > as_of {
        bail!("trace_export_future_window: the window must have ended before export");
    }
    let result = export_snapshot(&transaction, params, as_of, watermark)?;
    transaction.commit()?;
    Ok(result)
}

fn export_snapshot(
    connection: &Connection,
    params: &TraceExportParams,
    as_of: DateTime<Utc>,
    watermark: i64,
) -> Result<Value> {
    let runs = query(connection, RUNS, params)?;
    let deliveries = query(connection, DELIVERIES, params)?;
    let events = query(connection, DELIVERY_EVENTS, params)?;
    let tools = query(connection, TOOLS, params)?;
    let facts =
        json!({"runs": runs, "deliveries": deliveries, "deliveryEvents": events, "tools": tools});
    let result = json!({
        "schemaVersion": SCHEMA_VERSION,
        "window": {"since": params.since, "until": params.until},
        "asOf": as_of, "observedThroughGlobalSequence": watermark,
        "exporter": {
            "corePackageVersion": env!("CARGO_PKG_VERSION"),
            "dataContractVersion": crate::db::CURRENT_DATA_CONTRACT_VERSION,
            "projectionSchemaVersion": crate::db::CURRENT_PROJECTION_SCHEMA_VERSION,
            "classifierVersion": CLASSIFIER_VERSION
        },
        "scope": params,
        "coverage": {
            "population": "retained_records_in_requested_scope",
            "originClassification": "unclassified_except_explicit_exclusions",
            "perRunRovaiBuild": "unavailable",
            "memoryCounters": "unavailable",
            "deliveryHistory": "retained_terminal_and_retry_events_in_window",
            "toolCoverage": "current_classifier_observed_operations_only",
            "runtimeToolErrorCodes": "unavailable",
            "crossSourceOperationDeduplication": "unavailable"
        },
        "metrics": aggregate(&facts, params)?,
        "factsDigest": canonical_json_digest(&facts)?,
        "facts": facts
    });
    if serde_json::to_vec(&result)?.len() > BYTE_LIMIT {
        bail!(
            "trace_export_limit_exceeded: narrow the window or Camp scope; no partial report is returned"
        );
    }
    Ok(result)
}

fn query(connection: &Connection, body: &str, params: &TraceExportParams) -> Result<Vec<Value>> {
    let sql = format!("{SCOPE} {body}");
    let mut statement = connection.prepare(&sql)?;
    for (name, value) in [
        (":since", params.since.to_rfc3339()),
        (":until", params.until.to_rfc3339()),
        (":camps", serde_json::to_string(&params.camp_ids)?),
        (
            ":excluded_camps",
            serde_json::to_string(&params.exclude_camp_ids)?,
        ),
        (
            ":excluded_automations",
            serde_json::to_string(&params.exclude_automation_ids)?,
        ),
        (":classifier", CLASSIFIER_VERSION.to_string()),
    ] {
        if let Some(index) = statement.parameter_index(name)? {
            statement.raw_bind_parameter(index, value)?;
        }
    }
    let limit_index = statement
        .parameter_index(":row_limit")?
        .context("trace row limit is missing")?;
    statement.raw_bind_parameter(limit_index, (ROW_LIMIT + 1) as i64)?;
    let mut rows = statement.raw_query();
    let mut result = Vec::new();
    while let Some(row) = rows.next()? {
        if result.len() == ROW_LIMIT {
            bail!(
                "trace_export_limit_exceeded: narrow the window or Camp scope; no partial report is returned"
            );
        }
        let value: String = row.get(0)?;
        result.push(serde_json::from_str(&value).context("invalid trace metadata projection")?);
    }
    Ok(result)
}

fn in_window(value: &Value, params: &TraceExportParams) -> Result<bool> {
    let Some(value) = value.as_str() else {
        return Ok(false);
    };
    let time = DateTime::parse_from_rfc3339(value)
        .context("trace_export_invalid_timestamp: cannot calculate a reliable metric")?
        .with_timezone(&Utc);
    Ok(time >= params.since && time < params.until)
}

fn increment(counts: &mut BTreeMap<String, usize>, value: &Value) {
    *counts
        .entry(value.as_str().unwrap_or("unknown").to_string())
        .or_default() += 1;
}

fn ratio(numerator: usize, denominator: usize) -> Value {
    json!({"numerator": numerator, "denominator": denominator,
        "value": if denominator == 0 { None } else { Some(numerator as f64 / denominator as f64) }})
}

fn aggregate(facts: &Value, params: &TraceExportParams) -> Result<Value> {
    let mut created = 0;
    let mut run_terminals = BTreeMap::new();
    let mut active_runs = BTreeMap::new();
    let mut failures = BTreeMap::new();
    let runs = facts["runs"]
        .as_array()
        .context("trace Run facts are missing")?;
    for run in runs {
        if in_window(&run["createdAt"], params)? {
            created += 1;
        }
        if in_window(&run["endedAt"], params)? {
            increment(&mut run_terminals, &run["status"]);
            if run["status"] == "failed" {
                increment(&mut failures, &run["failureCode"]);
            }
        }
        if matches!(
            run["status"].as_str(),
            Some("queued" | "running" | "waiting")
        ) {
            increment(&mut active_runs, &run["status"]);
        }
    }
    let mut delivery_cohort = BTreeMap::new();
    let mut waits = BTreeMap::new();
    let mut captured_responses = 0;
    for delivery in facts["deliveries"]
        .as_array()
        .context("trace Delivery facts are missing")?
    {
        if delivery["deliveryKind"] != "public_a2a" {
            continue;
        }
        if delivery["dispatchDisposition"] == "gather_captured" {
            if in_window(&delivery["createdAt"], params)? {
                captured_responses += 1;
            }
            continue;
        }
        if delivery["dispatchDisposition"] != "dispatch" {
            continue;
        }
        if in_window(&delivery["createdAt"], params)? {
            increment(&mut delivery_cohort, &delivery["status"]);
        }
        if matches!(delivery["status"].as_str(), Some("pending" | "running")) {
            let reason = if !delivery["waitCondition"].is_null() {
                &delivery["waitCondition"]
            } else {
                &delivery["targetRunWaitReason"]
            };
            increment(&mut waits, reason);
        }
    }
    let mut delivery_event_counts = BTreeMap::new();
    for event in facts["deliveryEvents"]
        .as_array()
        .context("trace Delivery events are missing")?
    {
        if event["deliveryKind"] == "public_a2a" && event["dispatchDisposition"] == "dispatch" {
            increment(&mut delivery_event_counts, &event["eventType"]);
        }
    }
    let count = |key: &str| delivery_cohort.get(key).copied().unwrap_or(0);
    let admitted: usize = delivery_cohort.values().sum();
    let terminal_count = count("settled")
        + count("failed")
        + count("cancelled")
        + count("interrupted_before_dispatch");
    let mut sources: BTreeMap<String, Value> = BTreeMap::new();
    let mut observed_runs = BTreeSet::new();
    for source in ["core", "runtime"] {
        let mut outcomes = BTreeMap::new();
        let mut errors = BTreeMap::new();
        let mut replays = 0;
        let mut unknown_replay = 0;
        let mut active = 0;
        let mut missing_time = 0;
        for tool in facts["tools"]
            .as_array()
            .context("trace Tool facts are missing")?
        {
            if tool["sourceAuthority"] != source {
                continue;
            }
            observed_runs.insert(
                tool["agentRunId"]
                    .as_str()
                    .context("trace Run identity is missing")?,
            );
            if tool["phase"] != "terminal" {
                active += 1;
                continue;
            }
            // A later transport replay must not move the original operation into
            // another day's totals or remove it from its original day.
            let terminal_at = if source == "core" && !tool["originalTerminalObservedAt"].is_null() {
                &tool["originalTerminalObservedAt"]
            } else {
                &tool["lastObservedAt"]
            };
            if terminal_at.is_null() {
                missing_time += 1;
                continue;
            }
            if !in_window(terminal_at, params)? {
                continue;
            }
            if source == "core" {
                if tool["idempotentReplay"] == true || tool["idempotentReplay"] == 1 {
                    replays += 1;
                    continue;
                }
                if tool["idempotentReplay"].is_null() {
                    unknown_replay += 1;
                    continue;
                }
            }
            increment(&mut outcomes, &tool["outcome"]);
            if tool["outcome"] == "failed" {
                increment(&mut errors, &tool["errorCode"]);
            }
        }
        let failed = outcomes.get("failed").copied().unwrap_or(0);
        let succeeded = outcomes.get("succeeded").copied().unwrap_or(0);
        sources.insert(source.to_string(), json!({
            "terminalOutcomesInWindow": outcomes, "failureRate": ratio(failed, failed + succeeded),
            "failureCodes": errors, "inFlightAsOf": active,
            "excludedReplaysInWindow": replays, "unknownReplayIdentityInWindow": unknown_replay,
            "missingTerminalTimestamp": missing_time
        }));
    }
    Ok(json!({
        "definitionVersion": 2,
        "population": "retained_records_after_explicit_exclusions_not_verified_production",
        "runs": {"createdInWindow": created, "terminalOutcomesInWindow": run_terminals,
            "inFlightAsOf": active_runs, "failureCodes": failures,
            "scope": "created_before_window_end"},
        "a2a": {"admittedInWindow": admitted, "cohortOutcomesAsOf": delivery_cohort,
            "capturedResponsesInWindow": captured_responses,
            "failureRate": ratio(count("failed"), count("failed") + count("settled")),
            "terminalCoverage": ratio(terminal_count, admitted),
            "openWaitReasonsAsOf": waits, "eventsInWindow": delivery_event_counts},
        "tools": {"bySource": sources,
            "runCoverage": ratio(runs.iter().filter(|run| observed_runs.contains(run["agentRunId"].as_str().unwrap_or(""))).count(), runs.len()),
            "runCoverageMeaning": "selected_runs_with_current_classifier_tool_evidence_in_export",
            "sourcesAreNotAdditive": true},
        "memory": {"bodyReads": null, "formalRevisions": null, "status": "unavailable"}
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn window() -> TraceExportParams {
        serde_json::from_value(json!({
            "since": "2020-01-02T00:00:00+08:00", "until": "2020-01-03T00:00:00+08:00"
        }))
        .unwrap()
    }

    #[test]
    fn export_window_is_explicit_bounded_and_half_open() {
        let params = window();
        params.validate().unwrap();
        assert!(in_window(&json!("2020-01-01T16:00:00Z"), &params).unwrap());
        assert!(!in_window(&json!("2020-01-02T16:00:00Z"), &params).unwrap());
        assert!(in_window(&json!("invalid"), &params).is_err());
        for hours in [0, -1, 25, 27] {
            let mut changed = params.clone();
            changed.until = changed.since + Duration::hours(hours);
            assert_eq!(changed.validate().is_ok(), hours == 25);
        }
        assert!(
            serde_json::from_value::<TraceExportParams>(json!({
                "since": params.since, "until": params.until, "rawSql": "SELECT 1"
            }))
            .is_err()
        );
    }

    #[test]
    fn metrics_separate_terminal_flow_cohort_retries_and_unknowns() {
        let params = window();
        let facts = json!({
            "runs": [
                {"agentRunId":"old", "createdAt":"2019-12-31T16:00:00Z", "endedAt":"2020-01-02T01:00:00Z", "status":"failed"},
                {"agentRunId":"new", "createdAt":"2020-01-01T16:00:00Z", "endedAt":null, "status":"waiting"}
            ],
            "deliveries": [
                {"deliveryId":"d1", "deliveryKind":"public_a2a", "dispatchDisposition":"dispatch", "createdAt":params.since, "status":"settled", "retryGeneration":1},
                {"deliveryId":"d2", "deliveryKind":"public_a2a", "dispatchDisposition":"dispatch", "createdAt":params.since, "status":"pending", "waitCondition":"target_busy"},
                {"deliveryId":"captured", "deliveryKind":"public_a2a", "dispatchDisposition":"gather_captured", "createdAt":params.since, "status":"settled"},
                {"deliveryId":"g", "deliveryKind":"gather_completion", "createdAt":params.since, "status":"failed"}
            ],
            "deliveryEvents": [
                {"deliveryId":"d1", "deliveryKind":"public_a2a", "dispatchDisposition":"dispatch", "eventType":"message_delivery.failed"},
                {"deliveryId":"d1", "deliveryKind":"public_a2a", "dispatchDisposition":"dispatch", "eventType":"message_delivery.retry_requested"}
            ],
            "tools": [
                {"agentRunId":"old", "sourceAuthority":"runtime", "phase":"terminal", "lastObservedAt":params.since, "outcome":"failed"},
                {"agentRunId":"new", "sourceAuthority":"core", "phase":"terminal", "lastObservedAt":params.since, "outcome":"succeeded", "idempotentReplay":1},
                {"agentRunId":"new", "sourceAuthority":"core", "phase":"terminal", "lastObservedAt":params.since, "outcome":"succeeded"},
                {"agentRunId":"new", "sourceAuthority":"core", "phase":"terminal", "lastObservedAt":params.since, "outcome":"denied", "idempotentReplay":0}
            ]
        });
        let metrics = aggregate(&facts, &params).unwrap();
        assert_eq!(metrics["runs"]["createdInWindow"], 1);
        assert_eq!(metrics["runs"]["terminalOutcomesInWindow"]["failed"], 1);
        assert_eq!(metrics["runs"]["inFlightAsOf"]["waiting"], 1);
        assert_eq!(metrics["a2a"]["admittedInWindow"], 2);
        assert_eq!(metrics["a2a"]["capturedResponsesInWindow"], 1);
        assert_eq!(metrics["a2a"]["failureRate"], ratio(0, 1));
        assert_eq!(metrics["a2a"]["terminalCoverage"], ratio(1, 2));
        assert_eq!(
            metrics["a2a"]["eventsInWindow"]["message_delivery.failed"],
            1
        );
        assert_eq!(
            metrics["tools"]["bySource"]["runtime"]["failureRate"],
            ratio(1, 1)
        );
        assert_eq!(
            metrics["tools"]["bySource"]["runtime"]["failureCodes"]["unknown"],
            1
        );
        assert_eq!(
            metrics["tools"]["bySource"]["core"]["failureRate"]["value"],
            Value::Null
        );
        assert_eq!(
            metrics["tools"]["bySource"]["core"]["excludedReplaysInWindow"],
            1
        );
        assert_eq!(
            metrics["tools"]["bySource"]["core"]["unknownReplayIdentityInWindow"],
            1
        );
        assert_eq!(metrics["memory"]["bodyReads"], Value::Null);
    }

    // The database seam owns schema joins, metadata-only disclosure, classifier
    // selection, source filtering and read-only execution. The pure test above
    // owns the larger metric input matrix; this fixture is not a Runtime trial.
    #[cfg(feature = "slow-tests")]
    #[test]
    fn export_queries_current_schema_without_reading_bodies_or_writing_state() {
        use crate::{
            collaboration::{
                CollaborationService, ProjectBindingKind, TestCampConversationCommand,
                TestCampMessageAddress,
            },
            command::{ActorRef, CommandEnvelope},
        };
        use rusqlite::{
            hooks::{AuthAction, Authorization},
            params,
        };
        let mut database = crate::test_support::seeded_runtime_database_owned();
        let workspace = database.directory().join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let created = CollaborationService::default()
            .create_test_camp_conversation(
                &mut database,
                &CommandEnvelope {
                    command_id: "trace-fixture".to_string(),
                    actor: ActorRef::User {
                        user_id: "local_user".to_string(),
                    },
                    camp_id: None,
                    expected_versions: vec![],
                    execution_epoch: None,
                    payload: TestCampConversationCommand {
                        project_path: workspace.to_string_lossy().to_string(),
                        project_binding_kind: ProjectBindingKind::Directory,
                        body: "PRIVATE_BODY_CANARY".to_string(),
                        address: TestCampMessageAddress::Default,
                        purpose: "PRIVATE_PURPOSE_CANARY".to_string(),
                    },
                },
            )
            .unwrap();
        let run_id = created.result.payload["agentRunIds"][0].as_str().unwrap();
        let camp_id = created.result.payload["campId"].as_str().unwrap();
        let params = window();
        database
            .connection()
            .execute(
                "UPDATE agent_run SET created_at = ?2, input_ready_at = ?2 WHERE id = ?1",
                params![run_id, params.since.to_rfc3339()],
            )
            .unwrap();
        for sequence in 1..=3 {
            database.connection().execute(
                "INSERT INTO agent_run_execution_evidence(id, agent_run_id, execution_epoch, sequence, event_type, kind, phase, payload_preview_json, content_byte_count, is_truncated, occurred_at)
                 VALUES (?1, ?2, 0, ?3, 'runtime.action', 'tool_result', 'completed', ?4, 0, 0, ?5)",
                params![format!("trace-e{sequence}"), run_id, sequence,
                    json!({"idempotentReplay":sequence == 3, "errorCode":null, "rawBody":"PRIVATE_TOOL_CANARY"}).to_string(),
                    if sequence == 3 { params.until.to_rfc3339() } else { params.since.to_rfc3339() }]
            ).unwrap();
        }
        for classifier in [CLASSIFIER_VERSION, "activity-v1"] {
            database.connection().execute(
                "INSERT INTO canonical_runtime_activity(agent_run_id, execution_epoch, operation_id, classifier_version, activity_domain, phase, outcome, credibility, coverage_level, source_authority, source_evidence_ids_json, first_evidence_sequence, last_evidence_sequence, revision, created_at, updated_at)
                 VALUES (?1, 0, 'one-operation', ?2, 'tool', 'terminal', 'succeeded', 'observed', 'fine_grained', 'core', '[\"trace-e1\",\"trace-e2\",\"trace-e3\"]', 1, 3, 3, ?3, ?3)",
                params![run_id, classifier, params.since.to_rfc3339()]
            ).unwrap();
        }
        // Reject body hydration and any DML at SQLite's boundary.
        database.connection().authorizer(Some(|context: rusqlite::hooks::AuthContext<'_>| match context.action {
            AuthAction::Insert {..} | AuthAction::Update {..} | AuthAction::Delete {..} => Authorization::Deny,
            AuthAction::Read {table_name: "managed_blob" | "memory_revision" | "conversation_message" | "camp_message", ..} => Authorization::Deny,
            _ => Authorization::Allow,
        })).unwrap();
        let report = export(&mut database, &params).unwrap();
        assert_eq!(report["facts"]["runs"].as_array().unwrap().len(), 1);
        assert_eq!(report["facts"]["tools"].as_array().unwrap().len(), 1);
        assert_eq!(
            report["metrics"]["tools"]["bySource"]["core"]["terminalOutcomesInWindow"]["succeeded"],
            1
        );
        assert!(!report.to_string().contains("PRIVATE_"));
        assert!(!report.to_string().contains(workspace.to_str().unwrap()));
        let mut excluded = params;
        excluded.exclude_camp_ids.push(camp_id.to_string());
        let filtered = export(&mut database, &excluded).unwrap();
        assert!(filtered["facts"]["runs"].as_array().unwrap().is_empty());
        assert!(filtered["facts"]["tools"].as_array().unwrap().is_empty());
    }
}
