//! Bounded execution read surface. Pagination owns logical operations, never half of a
//! start/completion pair. Full output and diffs remain behind the evidence content read.
use anyhow::{Context, Result, ensure};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde_json::Value;

use crate::{
    canonical_activity,
    db::Database,
    read_model::{
        AgentRunExecutionEvidenceView, attach_canonical_activity, execution_evidence_row,
        execution_evidence_view,
    },
};

pub const DEFAULT_WINDOW_LIMIT: i64 = 24;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionWindowPage {
    pub schema_version: i64,
    pub camp_id: String,
    pub agent_run_id: String,
    pub requested_before_sequence: Option<i64>,
    pub next_before_sequence: Option<i64>,
    pub through_sequence: i64,
    pub has_more: bool,
    pub evidence: Vec<AgentRunExecutionEvidenceView>,
    pub active_evidence: Vec<AgentRunExecutionEvidenceView>,
}

pub fn read_page(
    database: &mut Database,
    camp_id: &str,
    agent_run_id: &str,
    before_sequence: Option<i64>,
    limit: i64,
) -> Result<ExecutionWindowPage> {
    ensure!(
        before_sequence.is_none_or(|sequence| sequence > 0),
        "Execution window cursor must be positive"
    );
    let transaction = database.connection_mut().transaction()?;
    let belongs: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM agent_run JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
         WHERE agent_run.id = ?1 AND camp_turn.camp_id = ?2)",
        params![agent_run_id, camp_id], |row| row.get(0),
    )?;
    ensure!(belongs, "AgentRun does not exist in this Camp");
    let through_sequence: i64 = transaction.query_row(
        "SELECT COALESCE(MAX(sequence), 0) FROM agent_run_execution_evidence WHERE agent_run_id = ?1",
        [agent_run_id], |row| row.get(0),
    )?;
    let limit = limit.clamp(1, 96);
    // Expand the canonical source index once. Only IDs/sequences participate in
    // window selection; old command/output/diff bodies are not hydrated.
    let mut statement = transaction.prepare(
        r#"
        WITH ranked AS MATERIALIZED (
          SELECT operation_id, execution_epoch, first_evidence_sequence, source_evidence_ids_json,
                 ROW_NUMBER() OVER (PARTITION BY operation_id, execution_epoch ORDER BY
                   CASE classifier_version WHEN ?4 THEN 0 WHEN ?5 THEN 1 WHEN ?6 THEN 2 ELSE 3 END) AS rank
          FROM canonical_runtime_activity
          WHERE agent_run_id = ?1 AND classifier_version IN (?4, ?5, ?6, ?7)
        ), owners AS MATERIALIZED (
          SELECT source.value AS id, operation_id, execution_epoch, first_evidence_sequence
          FROM ranked, json_each(source_evidence_ids_json) AS source WHERE rank = 1
        ), entries AS MATERIALIZED (
          SELECT e.id, e.sequence,
                 CASE WHEN o.operation_id IS NOT NULL THEN 'operation:' || o.execution_epoch || ':' || o.operation_id
                      WHEN e.event_type = 'runtime.compaction.display' THEN 'compaction:' || e.execution_epoch || ':' || COALESCE(json_extract(e.payload_preview_json, '$.compactionId'), e.id)
                      WHEN e.event_type = 'runtime.diagnostic' THEN 'diagnostic:' || e.execution_epoch || ':' || COALESCE(json_extract(e.payload_preview_json, '$.diagnosticId'), e.id)
                      WHEN e.event_type IN ('runtime.plan', 'runtime.plan.delta') THEN 'plan:' || e.execution_epoch
                      WHEN e.event_type = 'agent.text.delta' THEN 'text:' || e.execution_epoch || ':' || COALESCE(json_extract(e.payload_preview_json, '$.itemId'), e.id)
                      ELSE e.id END AS item_key,
                 COALESCE(o.first_evidence_sequence, e.sequence) AS first_sequence
          FROM agent_run_execution_evidence e LEFT JOIN owners o ON o.id = e.id
          WHERE e.agent_run_id = ?1
            AND e.event_type IN ('agent.text.block', 'agent.text.delta', 'runtime.plan', 'runtime.plan.delta',
              'runtime.diagnostic', 'runtime.compaction.display', 'activity.started', 'activity.completed', 'runtime.action')
            AND e.kind <> 'reasoning_summary'
        ), items AS (
          SELECT item_key, MIN(first_sequence) AS first_sequence,
                 json_group_array(id) AS evidence_ids
          FROM entries GROUP BY item_key
        )
        SELECT first_sequence, evidence_ids FROM items
        WHERE (?2 IS NULL OR first_sequence < ?2)
        ORDER BY first_sequence DESC LIMIT ?3
        "#,
    )?;
    let mut selected = statement
        .query_map(
            params![
                agent_run_id,
                before_sequence,
                limit + 1,
                canonical_activity::CLASSIFIER_VERSION,
                canonical_activity::PREVIOUS_CLASSIFIER_VERSION,
                canonical_activity::INTERMEDIATE_CLASSIFIER_VERSION,
                canonical_activity::LEGACY_CLASSIFIER_VERSION,
            ],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(statement);
    let has_more = selected.len() > limit as usize;
    selected.truncate(limit as usize);
    let next_before_sequence = has_more.then(|| selected.last().expect("nonempty window").0);
    let mut evidence = project_items(&transaction, agent_run_id, selected.into_iter().rev())?;
    let mut active_evidence = Vec::new();
    if before_sequence.is_none() {
        let mut active = transaction.prepare(
            r#"WITH ranked AS (
              SELECT first_evidence_sequence, source_evidence_ids_json, phase,
                     ROW_NUMBER() OVER (PARTITION BY operation_id, execution_epoch ORDER BY
                       CASE classifier_version WHEN ?2 THEN 0 WHEN ?3 THEN 1 WHEN ?4 THEN 2 ELSE 3 END) AS rank
              FROM canonical_runtime_activity
              WHERE agent_run_id = ?1 AND classifier_version IN (?2, ?3, ?4, ?5)
                AND EXISTS(SELECT 1 FROM agent_run WHERE id = ?1 AND status IN ('running', 'waiting', 'queued'))
            ) SELECT first_evidence_sequence, source_evidence_ids_json FROM ranked
              WHERE rank = 1 AND phase <> 'terminal' ORDER BY first_evidence_sequence"#,
        )?;
        let pending = active
            .query_map(
                params![
                    agent_run_id,
                    canonical_activity::CLASSIFIER_VERSION,
                    canonical_activity::PREVIOUS_CLASSIFIER_VERSION,
                    canonical_activity::INTERMEDIATE_CLASSIFIER_VERSION,
                    canonical_activity::LEGACY_CLASSIFIER_VERSION,
                ],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        active_evidence = project_items(
            &transaction,
            agent_run_id,
            pending
                .into_iter()
                .filter(|(sequence, _)| !evidence.iter().any(|item| item.sequence == *sequence)),
        )?;
    }
    transaction.commit()?;
    crate::execution_text::overlay(database, &mut evidence)?;
    Ok(ExecutionWindowPage {
        schema_version: 1,
        camp_id: camp_id.to_string(),
        agent_run_id: agent_run_id.to_string(),
        requested_before_sequence: before_sequence,
        next_before_sequence,
        through_sequence,
        has_more,
        evidence,
        active_evidence,
    })
}

fn project_items(
    connection: &Connection,
    run_id: &str,
    selected: impl Iterator<Item = (i64, String)>,
) -> Result<Vec<AgentRunExecutionEvidenceView>> {
    let mut evidence = Vec::new();
    for (first_sequence, ids) in selected {
        let mut parts = load_summaries(connection, run_id, &ids)?;
        let Some(mut item) = parts.pop() else {
            continue;
        };
        if item.event_type == "agent.text.delta" {
            let mut delta = parts
                .iter()
                .filter_map(|part| part.payload["delta"].as_str())
                .collect::<String>();
            delta.push_str(item.payload["delta"].as_str().unwrap_or_default());
            item.payload["delta"] = Value::String(delta);
        }
        if matches!(
            item.event_type.as_str(),
            "runtime.plan" | "runtime.plan.delta"
        ) {
            let mut explanation = String::new();
            let mut plan = Value::Null;
            for part in parts.iter().chain(std::iter::once(&item)) {
                if let Some(text) = part.payload["explanation"].as_str() {
                    explanation = text.to_string();
                }
                if part.event_type == "runtime.plan.delta" {
                    explanation.push_str(part.payload["delta"].as_str().unwrap_or_default());
                }
                if let Some(steps) = part.payload.get("plan") {
                    plan = steps.clone();
                }
            }
            item.event_type = "runtime.plan".to_string();
            item.payload["explanation"] = Value::String(explanation);
            item.payload["plan"] = plan;
        }
        // Completion may contain only a status; earlier input still describes this operation.
        for earlier in parts.into_iter().rev() {
            fill_missing(&mut item.payload, &earlier.payload);
            item.occurred_at = earlier.occurred_at;
        }
        item.sequence = first_sequence;
        evidence.push(item);
    }
    attach_canonical_activity(connection, &mut evidence)?;
    for item in &mut evidence {
        if let Some(operation) = supporting_builtin_operation(connection, item)? {
            item.payload["executionWindowBuiltinOperation"] = Value::String(operation);
        }
        if let Some(entries) = item
            .canonical
            .as_mut()
            .and_then(|canonical| canonical.diff_projection.as_mut())
            .and_then(|projection| projection.entries.as_mut())
        {
            for entry in entries {
                entry.diff.clear();
            }
            // A file row needs paths and counts; its patch is fetched on expansion.
            if let Some(payload) = item.payload.as_object_mut() {
                payload.remove("input");
            }
            item.is_truncated = true;
        }
    }
    Ok(evidence)
}

// A compact presentation association keeps the exact-result proof available even
// when the enclosed Core activity is on the adjacent page. The renderer still
// checks that the command is a pure CLI carrier before omitting the duplicate.
fn supporting_builtin_operation(
    connection: &Connection,
    item: &AgentRunExecutionEvidenceView,
) -> Result<Option<String>> {
    let Some(shell) = item.canonical.as_ref().filter(|canonical| {
        canonical.activity_domain == "shell" && canonical.outcome == "succeeded"
    }) else {
        return Ok(None);
    };
    let command = item
        .payload
        .pointer("/item/command")
        .or_else(|| item.payload.get("command"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !command.contains("rovai") {
        return Ok(None);
    }
    let output: Option<String> = connection.query_row(
        "SELECT COALESCE(json_extract(payload_preview_json, '$.output'),
          json_extract(payload_preview_json, '$.item.aggregatedOutput'), json_extract(payload_preview_json, '$.item.output'))
         FROM agent_run_execution_evidence WHERE id = ?1", [&item.id], |row| row.get(0),
    ).optional()?.flatten();
    let Some(response) = output
        .and_then(|output| serde_json::from_str::<Value>(&output).ok())
        .filter(|value| value.as_object().is_some_and(|object| !object.is_empty()))
    else {
        return Ok(None);
    };
    let mut statement = connection.prepare(
        "SELECT c.operation_id, e.payload_preview_json FROM canonical_runtime_activity c
         JOIN json_each(c.source_evidence_ids_json) source
         JOIN agent_run_execution_evidence e ON e.id = source.value
         WHERE c.agent_run_id = ?1 AND c.execution_epoch = ?2
           AND c.source_authority = 'core' AND c.credibility = 'core_verified'
           AND c.first_evidence_sequence > ?3 AND c.last_evidence_sequence < ?4
           AND e.event_type = 'runtime.action' ORDER BY e.sequence DESC",
    )?;
    let candidates = statement.query_map(
        params![
            item.agent_run_id,
            item.execution_epoch,
            shell.first_evidence_sequence,
            shell.last_evidence_sequence
        ],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    )?;
    let mut matched = std::collections::BTreeMap::new();
    let mut seen = std::collections::BTreeSet::new();
    for candidate in candidates {
        let (id, payload) = candidate?;
        if !seen.insert(id.clone()) {
            continue;
        }
        let payload: Value = serde_json::from_str(&payload)?;
        let Some(operation) = payload["canonicalTool"].as_str() else {
            continue;
        };
        let envelope = &payload["coreEnvelope"];
        if envelope["ok"] != true || envelope["operation"] != operation {
            continue;
        }
        let result = &envelope["result"];
        let keys: Option<&[&str]> = match operation {
            "camp.message.send" => Some(&[
                "messageId",
                "agentAddressingMode",
                "effectiveRecipients",
                "deliveryIds",
            ]),
            "team.gather" => Some(&[
                "gatherId",
                "requestMessageId",
                "effectiveRecipients",
                "completion",
            ]),
            "team.create_task" => Some(&[
                "taskId",
                "title",
                "status",
                "assigneeAgentId",
                "version",
                "availableActions",
            ]),
            "team.update_task" => Some(&[
                "taskId",
                "title",
                "status",
                "assigneeAgentId",
                "version",
                "availableActions",
                "changed",
            ]),
            "memory.write" if result["outcome"] == "effective" => {
                Some(&["outcome", "memoryId", "revisionId"])
            }
            "memory.write" if result["outcome"] == "review_pending" => {
                Some(&["outcome", "reviewItemId"])
            }
            _ => None,
        };
        if keys.is_some_and(|keys| keys.iter().any(|key| result.get(*key).is_none())) {
            continue;
        }
        let result = keys
            .map(|keys| {
                keys.iter()
                    .filter_map(|key| {
                        result
                            .get(*key)
                            .map(|value| (key.to_string(), value.clone()))
                    })
                    .collect::<serde_json::Map<_, _>>()
            })
            .map(Value::Object)
            .unwrap_or_else(|| result.clone());
        if result == response {
            matched.insert(id, operation.to_string());
        }
    }
    Ok((matched.len() == 1).then(|| matched.into_values().next().unwrap()))
}

fn load_summaries(
    connection: &Connection,
    run_id: &str,
    ids: &str,
) -> Result<Vec<AgentRunExecutionEvidenceView>> {
    let mut statement = connection.prepare(
        r#"SELECT id, agent_run_id, execution_epoch, sequence, event_type, kind, phase,
           CASE WHEN event_type IN ('activity.started', 'activity.completed', 'runtime.action')
             THEN json_remove(payload_preview_json, '$.output', '$.item.aggregatedOutput', '$.item.output',
               '$.item.changes', '$.changes', '$.patch', '$.runtimeDiff', '$.coreEnvelope', '$.operationProjection.canonicalResult')
             ELSE payload_preview_json END,
           content_blob_id, content_byte_count,
           CASE WHEN event_type IN ('activity.started', 'activity.completed', 'runtime.action') THEN 1 ELSE is_truncated END,
           occurred_at
           FROM agent_run_execution_evidence
           WHERE agent_run_id = ?1 AND id IN (SELECT value FROM json_each(?2))
             AND event_type <> 'command.output.delta' ORDER BY sequence"#,
    )?;
    statement
        .query_map(params![run_id, ids], execution_evidence_row)?
        .map(|row| execution_evidence_view(row?))
        .collect()
}

fn fill_missing(latest: &mut Value, earlier: &Value) {
    match (latest, earlier) {
        (Value::Object(latest), Value::Object(earlier)) => {
            for (key, value) in earlier {
                fill_missing(latest.entry(key).or_insert(Value::Null), value);
            }
        }
        (latest @ Value::Null, earlier) => *latest = earlier.clone(),
        _ => {}
    }
}

pub fn content_canonical(
    database: &Database,
    evidence_id: &str,
) -> Result<Option<canonical_activity::CanonicalRuntimeActivity>> {
    let connection = database.connection();
    let mut statement = connection.prepare(
        "SELECT id, agent_run_id, execution_epoch, sequence, event_type, kind, phase,
         '{}', content_blob_id, content_byte_count, is_truncated, occurred_at
         FROM agent_run_execution_evidence WHERE id = ?1",
    )?;
    let item = statement
        .query_row([evidence_id], execution_evidence_row)
        .context("Execution Evidence does not exist")?;
    let mut evidence = vec![execution_evidence_view(item)?];
    attach_canonical_activity(connection, &mut evidence)?;
    Ok(evidence.pop().and_then(|item| item.canonical))
}
