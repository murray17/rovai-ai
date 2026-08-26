use std::ops::Deref;

use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use uuid::Uuid;

use crate::{
    canonical_activity::{self, CanonicalRuntimeActivity, EvidenceActivityFacts},
    db::Database,
    managed_blob::ManagedBlobStore,
};

const INLINE_PAYLOAD_LIMIT_BYTES: usize = 16 * 1024;
const PREVIEW_STRING_LIMIT_CHARS: usize = 4_000;
const PREVIEW_ARRAY_LIMIT: usize = 24;
pub const RUNTIME_EVIDENCE_DELTA_BATCH_MAX_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunExecutionEvidence {
    pub id: String,
    pub agent_run_id: String,
    pub execution_epoch: i64,
    pub sequence: i64,
    pub event_type: String,
    pub kind: String,
    pub phase: String,
    pub payload: Value,
    pub content_blob_id: Option<String>,
    pub content_byte_count: i64,
    pub is_truncated: bool,
    pub occurred_at: String,
    pub canonical: Option<CanonicalRuntimeActivity>,
}

#[derive(Debug, Clone)]
pub struct RecordedExecutionEvidence {
    pub evidence: AgentRunExecutionEvidence,
    pub inserted: bool,
}

#[derive(Debug, Clone)]
pub struct PreparedRuntimeEvidence {
    event_type: String,
    kind: String,
    phase: String,
    payload: Value,
    payload_json: String,
    content_byte_count: i64,
    occurred_at: String,
}

impl PreparedRuntimeEvidence {
    pub fn is_inline_delta_batchable(&self) -> bool {
        ExecutionEvidenceService::is_batchable_runtime_delta_event(&self.event_type)
            && self.content_byte_count <= INLINE_PAYLOAD_LIMIT_BYTES as i64
    }

    pub fn content_byte_count(&self) -> usize {
        usize::try_from(self.content_byte_count).unwrap_or(usize::MAX)
    }
}

impl RecordedExecutionEvidence {
    pub fn into_evidence(self) -> AgentRunExecutionEvidence {
        self.evidence
    }
}

impl Deref for RecordedExecutionEvidence {
    type Target = AgentRunExecutionEvidence;

    fn deref(&self) -> &Self::Target {
        &self.evidence
    }
}

#[derive(Debug, Default)]
pub struct ExecutionEvidenceService;

impl ExecutionEvidenceService {
    pub fn is_durable_runtime_evidence_event(event_type: &str) -> bool {
        matches!(
            event_type,
            "agent.reasoning.summary.delta"
                | "agent.thought.delta"
                | "agent.text.delta"
                | "runtime.plan"
                | "runtime.plan.delta"
                | "runtime.diagnostic"
                | "file.change.updated"
                | "runtime.action"
                | "activity.started"
                | "activity.completed"
        )
    }

    pub fn is_transient_command_output_event(event_type: &str) -> bool {
        event_type == "command.output.delta"
    }

    pub fn is_batchable_runtime_delta_event(event_type: &str) -> bool {
        matches!(
            event_type,
            "agent.reasoning.summary.delta"
                | "agent.thought.delta"
                | "agent.text.delta"
                | "runtime.plan.delta"
                | "file.change.updated"
        )
    }

    pub fn command_output_delta_admission_open(
        &self,
        database: &Database,
        agent_run_id: &str,
        execution_epoch: i64,
    ) -> Result<bool> {
        database
            .connection()
            .query_row(
                r#"
                SELECT EXISTS(
                    SELECT 1
                    FROM agent_run
                    WHERE id = ?1
                      AND execution_epoch = ?2
                      AND status IN ('running', 'waiting')
                      AND cancel_requested_at IS NULL
                )
                "#,
                params![agent_run_id, execution_epoch],
                |row| row.get(0),
            )
            .map_err(Into::into)
    }

    pub fn prepare_runtime_event(
        &self,
        event_type: &str,
        payload: &Value,
    ) -> Result<Option<PreparedRuntimeEvidence>> {
        let Some((kind, phase)) = evidence_classification(event_type, payload) else {
            return Ok(None);
        };
        let payload = normalize_public_payload(event_type, payload);
        let encoded = serde_json::to_vec(&payload)?;
        Ok(Some(PreparedRuntimeEvidence {
            event_type: event_type.to_string(),
            kind: kind.to_string(),
            phase: phase.to_string(),
            payload_json: serde_json::to_string(&payload)?,
            payload,
            content_byte_count: i64::try_from(encoded.len())
                .context("Execution Evidence payload size overflow")?,
            occurred_at: chrono::Utc::now().to_rfc3339(),
        }))
    }

    pub fn record_prepared_runtime_event_batch(
        &self,
        database: &mut Database,
        agent_run_id: &str,
        execution_epoch: i64,
        prepared: Vec<PreparedRuntimeEvidence>,
    ) -> Result<Vec<Option<RecordedExecutionEvidence>>> {
        if prepared.is_empty() {
            return Ok(Vec::new());
        }
        let total_bytes = prepared.iter().try_fold(0_usize, |total, evidence| {
            if !evidence.is_inline_delta_batchable() {
                anyhow::bail!("Execution Evidence batch contains a non-inline Delta");
            }
            total
                .checked_add(evidence.content_byte_count())
                .context("Execution Evidence batch size overflow")
        })?;
        if total_bytes > RUNTIME_EVIDENCE_DELTA_BATCH_MAX_BYTES {
            anyhow::bail!(
                "Execution Evidence batch exceeds {} bytes",
                RUNTIME_EVIDENCE_DELTA_BATCH_MAX_BYTES
            );
        }

        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let still_current: bool = transaction.query_row(
            r#"
            SELECT EXISTS(
                SELECT 1
                FROM agent_run
                WHERE id = ?1
                  AND execution_epoch = ?2
                  AND status IN ('running', 'waiting')
                  AND cancel_requested_at IS NULL
            )
            "#,
            params![agent_run_id, execution_epoch],
            |row| row.get(0),
        )?;
        if !still_current {
            transaction.commit()?;
            return Ok(std::iter::repeat_with(|| None)
                .take(prepared.len())
                .collect());
        }

        let first_sequence: i64 = transaction.query_row(
            r#"
            SELECT COALESCE(MAX(sequence), 0) + 1
            FROM agent_run_execution_evidence
            WHERE agent_run_id = ?1
            "#,
            [agent_run_id],
            |row| row.get(0),
        )?;
        let mut recorded = Vec::with_capacity(prepared.len());
        for (index, evidence) in prepared.into_iter().enumerate() {
            let sequence = first_sequence
                .checked_add(i64::try_from(index).context("Evidence batch index overflow")?)
                .context("Execution Evidence sequence overflow")?;
            let id = Uuid::new_v4().to_string();
            transaction.execute(
                r#"
                INSERT INTO agent_run_execution_evidence(
                    id, agent_run_id, execution_epoch, sequence,
                    event_type, kind, phase, source_event_key,
                    payload_preview_json, content_blob_id,
                    content_byte_count, is_truncated, occurred_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL,
                    ?8, NULL, ?9, 0, ?10
                )
                "#,
                params![
                    id,
                    agent_run_id,
                    execution_epoch,
                    sequence,
                    evidence.event_type,
                    evidence.kind,
                    evidence.phase,
                    evidence.payload_json,
                    evidence.content_byte_count,
                    evidence.occurred_at,
                ],
            )?;
            let facts = canonical_activity::classify_evidence(
                agent_run_id,
                execution_epoch,
                &id,
                &evidence.event_type,
                &evidence.kind,
                &evidence.phase,
                &evidence.payload,
            );
            let canonical = upsert_canonical_activity(
                &transaction,
                agent_run_id,
                execution_epoch,
                sequence,
                &id,
                &evidence.occurred_at,
                &facts,
            )?;
            recorded.push(Some(RecordedExecutionEvidence {
                evidence: AgentRunExecutionEvidence {
                    id,
                    agent_run_id: agent_run_id.to_string(),
                    execution_epoch,
                    sequence,
                    event_type: evidence.event_type,
                    kind: evidence.kind,
                    phase: evidence.phase,
                    payload: evidence.payload,
                    content_blob_id: None,
                    content_byte_count: evidence.content_byte_count,
                    is_truncated: false,
                    occurred_at: evidence.occurred_at,
                    canonical,
                },
                inserted: true,
            }));
        }
        transaction.commit()?;
        Ok(recorded)
    }

    pub fn record_runtime_event(
        &self,
        database: &mut Database,
        blob_store: &ManagedBlobStore,
        agent_run_id: &str,
        execution_epoch: i64,
        event_type: &str,
        payload: &Value,
    ) -> Result<Option<RecordedExecutionEvidence>> {
        self.record_runtime_event_with_fence_policy(
            database,
            blob_store,
            agent_run_id,
            execution_epoch,
            event_type,
            payload,
            false,
        )
    }

    pub fn record_builtin_tool_result(
        &self,
        database: &mut Database,
        blob_store: &ManagedBlobStore,
        agent_run_id: &str,
        execution_epoch: i64,
        payload: &Value,
    ) -> Result<Option<RecordedExecutionEvidence>> {
        if !payload
            .get("status")
            .and_then(Value::as_str)
            .is_some_and(|status| matches!(status, "completed" | "failed"))
        {
            anyhow::bail!("Team Tool result evidence must be terminal");
        }
        self.record_runtime_event_with_fence_policy(
            database,
            blob_store,
            agent_run_id,
            execution_epoch,
            "runtime.action",
            payload,
            true,
        )
    }

    pub fn record_interrupted_runtime_activity(
        &self,
        database: &mut Database,
        blob_store: &ManagedBlobStore,
        agent_run_id: &str,
        execution_epoch: i64,
        payload: &Value,
    ) -> Result<Option<RecordedExecutionEvidence>> {
        if payload.get("reasonCode").and_then(Value::as_str) != Some("runtime_interrupted")
            || payload.pointer("/item/status").and_then(Value::as_str) != Some("interrupted")
        {
            anyhow::bail!("interrupted Runtime Activity must carry the interrupted terminal facts");
        }
        let item_id = payload
            .pointer("/item/id")
            .and_then(Value::as_str)
            .context("interrupted Runtime Activity has no item id")?;
        let started_source_key = format!("activity.started:{item_id}:updated");
        let started_exists: bool = database.connection().query_row(
            r#"
            SELECT EXISTS(
                SELECT 1
                FROM agent_run_execution_evidence
                WHERE agent_run_id = ?1
                  AND execution_epoch = ?2
                  AND source_event_key = ?3
            )
            "#,
            params![agent_run_id, execution_epoch, started_source_key],
            |row| row.get(0),
        )?;
        if !started_exists {
            return Ok(None);
        }
        self.record_runtime_event_with_fence_policy(
            database,
            blob_store,
            agent_run_id,
            execution_epoch,
            "activity.completed",
            payload,
            true,
        )
    }

    pub fn record_builtin_tool_started(
        &self,
        database: &mut Database,
        blob_store: &ManagedBlobStore,
        agent_run_id: &str,
        execution_epoch: i64,
        payload: &Value,
    ) -> Result<Option<RecordedExecutionEvidence>> {
        if payload.get("status").and_then(Value::as_str) != Some("started") {
            anyhow::bail!("Built-in Tool start evidence must be started");
        }
        self.record_runtime_event_with_fence_policy(
            database,
            blob_store,
            agent_run_id,
            execution_epoch,
            "runtime.action",
            payload,
            false,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn record_runtime_event_with_fence_policy(
        &self,
        database: &mut Database,
        blob_store: &ManagedBlobStore,
        agent_run_id: &str,
        execution_epoch: i64,
        event_type: &str,
        payload: &Value,
        allow_fenced_terminal_tool_result: bool,
    ) -> Result<Option<RecordedExecutionEvidence>> {
        let Some((kind, phase)) = evidence_classification(event_type, payload) else {
            return Ok(None);
        };
        let current = database
            .connection()
            .query_row(
                r#"
                SELECT status, execution_epoch, cancel_requested_at
                FROM agent_run
                WHERE id = ?1
                "#,
                [agent_run_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .optional()?;
        let Some((status, current_epoch, cancel_requested_at)) = current else {
            return Ok(None);
        };
        if current_epoch != execution_epoch
            || (!allow_fenced_terminal_tool_result && cancel_requested_at.is_some())
            || (!matches!(status.as_str(), "running" | "waiting")
                && !(allow_fenced_terminal_tool_result
                    && matches!(status.as_str(), "succeeded" | "failed" | "cancelled")))
        {
            return Ok(None);
        }

        let source_event_key = source_event_key(event_type, payload);
        let payload = normalize_public_payload(event_type, payload);
        let encoded = serde_json::to_vec(&payload)?;
        let (preview, content_blob_id, is_truncated) = if encoded.len() > INLINE_PAYLOAD_LIMIT_BYTES
        {
            let blob = blob_store.put_bytes(database, &encoded, "application/json", "normal")?;
            (bounded_preview(&payload), Some(blob.id), true)
        } else {
            (payload, None, false)
        };
        let preview_json = serde_json::to_string(&preview)?;
        let occurred_at = chrono::Utc::now().to_rfc3339();
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;

        if let Some(source_event_key) = source_event_key.as_deref()
            && let Some(existing) =
                load_by_source_key(&transaction, agent_run_id, source_event_key)?
        {
            let mut existing = existing;
            existing.canonical = load_canonical_for_evidence(&transaction, &existing.id)?;
            transaction.commit()?;
            return Ok(Some(RecordedExecutionEvidence {
                evidence: existing,
                inserted: false,
            }));
        }

        let still_current: bool = transaction.query_row(
            r#"
            SELECT EXISTS(
                SELECT 1
                FROM agent_run
                WHERE id = ?1
                  AND execution_epoch = ?2
                  AND (
                    (status IN ('running', 'waiting')
                     AND (?3 = 1 OR cancel_requested_at IS NULL))
                    OR (?3 = 1 AND status IN ('succeeded', 'failed', 'cancelled'))
                  )
            )
            "#,
            params![
                agent_run_id,
                execution_epoch,
                i64::from(allow_fenced_terminal_tool_result)
            ],
            |row| row.get(0),
        )?;
        if !still_current {
            transaction.commit()?;
            return Ok(None);
        }

        let sequence: i64 = transaction.query_row(
            r#"
            SELECT COALESCE(MAX(sequence), 0) + 1
            FROM agent_run_execution_evidence
            WHERE agent_run_id = ?1
            "#,
            [agent_run_id],
            |row| row.get(0),
        )?;
        let id = Uuid::new_v4().to_string();
        transaction.execute(
            r#"
            INSERT INTO agent_run_execution_evidence(
                id, agent_run_id, execution_epoch, sequence,
                event_type, kind, phase, source_event_key,
                payload_preview_json, content_blob_id,
                content_byte_count, is_truncated, occurred_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                ?9, ?10, ?11, ?12, ?13
            )
            "#,
            params![
                id,
                agent_run_id,
                execution_epoch,
                sequence,
                event_type,
                kind,
                phase,
                source_event_key,
                preview_json,
                content_blob_id,
                encoded.len() as i64,
                i64::from(is_truncated),
                occurred_at,
            ],
        )?;
        let facts = canonical_activity::classify_evidence(
            agent_run_id,
            execution_epoch,
            &id,
            event_type,
            kind,
            phase,
            &preview,
        );
        let canonical = upsert_canonical_activity(
            &transaction,
            agent_run_id,
            execution_epoch,
            sequence,
            &id,
            &occurred_at,
            &facts,
        )?;
        transaction.commit()?;
        Ok(Some(RecordedExecutionEvidence {
            evidence: AgentRunExecutionEvidence {
                id,
                agent_run_id: agent_run_id.to_string(),
                execution_epoch,
                sequence,
                event_type: event_type.to_string(),
                kind: kind.to_string(),
                phase: phase.to_string(),
                payload: preview,
                content_blob_id,
                content_byte_count: encoded.len() as i64,
                is_truncated,
                occurred_at,
                canonical,
            },
            inserted: true,
        }))
    }

    pub fn read_full_payload(
        &self,
        database: &Database,
        blob_store: &ManagedBlobStore,
        camp_id: &str,
        evidence_id: &str,
    ) -> Result<Value> {
        let row = database
            .connection()
            .query_row(
                r#"
                SELECT evidence.payload_preview_json, evidence.content_blob_id
                FROM agent_run_execution_evidence AS evidence
                JOIN agent_run ON agent_run.id = evidence.agent_run_id
                JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                WHERE evidence.id = ?1 AND camp_turn.camp_id = ?2
                "#,
                params![evidence_id, camp_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .optional()?
            .context("Execution Evidence does not exist in this Camp")?;
        let bytes = match row.1 {
            Some(blob_id) => blob_store.read_bytes(database, &blob_id)?,
            None => row.0.into_bytes(),
        };
        serde_json::from_slice(&bytes).context("Execution Evidence payload is not valid JSON")
    }
}

fn evidence_classification(
    event_type: &str,
    payload: &Value,
) -> Option<(&'static str, &'static str)> {
    match event_type {
        "agent.reasoning.summary.delta" | "agent.thought.delta" => {
            Some(("reasoning_summary", "updated"))
        }
        "agent.text.delta" => Some(("narration", "updated")),
        "runtime.plan" | "runtime.plan.delta" => Some(("plan", "updated")),
        "runtime.diagnostic" => Some(("step", "updated")),
        "file.change.updated" => Some(("file_change", "updated")),
        "runtime.action" => Some((
            if payload
                .get("status")
                .and_then(Value::as_str)
                .is_some_and(|status| matches!(status, "completed" | "failed"))
            {
                "tool_result"
            } else {
                "tool_call"
            },
            phase_from_payload(payload),
        )),
        "activity.started" => Some((activity_kind(payload), "started")),
        "activity.completed" => Some((activity_kind(payload), "completed")),
        _ => None,
    }
}

fn normalize_public_payload(event_type: &str, payload: &Value) -> Value {
    match event_type {
        "agent.reasoning.summary.delta" | "agent.thought.delta" => serde_json::json!({
            "itemId": payload.get("itemId").or_else(|| payload.get("toolCallId")),
            "delta": payload
                .get("delta")
                .and_then(Value::as_str)
                .or_else(|| payload.pointer("/content/text").and_then(Value::as_str))
                .or_else(|| payload.get("text").and_then(Value::as_str))
                .unwrap_or(""),
        }),
        "agent.text.delta" => serde_json::json!({
            "itemId": payload.get("itemId"),
            "delta": payload.get("delta").and_then(Value::as_str).unwrap_or(""),
        }),
        "runtime.plan.delta" => serde_json::json!({
            "delta": payload.get("delta").and_then(Value::as_str).unwrap_or(""),
        }),
        "runtime.plan" => serde_json::json!({
            "explanation": payload.get("explanation"),
            "plan": payload.get("plan"),
        }),
        "runtime.diagnostic" => serde_json::json!({
            "diagnosticId": payload.get("diagnosticId"),
            "code": payload.get("code"),
            "status": payload.get("status"),
            "attempt": payload.get("attempt"),
            "maxAttempts": payload.get("maxAttempts"),
            "retryAfterSeconds": payload.get("retryAfterSeconds"),
        }),
        "file.change.updated" => serde_json::json!({
            "itemId": payload.get("itemId"),
            "patch": payload.get("patch").or_else(|| payload.get("delta")),
        }),
        "runtime.action" => {
            let mut normalized = serde_json::json!({
                "toolCallId": payload.get("toolCallId"),
                "status": payload.get("status"),
                "kind": payload.get("kind"),
                "toolName": payload.get("toolName"),
                "title": payload.get("title"),
                "sourceAuthority": payload.get("sourceAuthority"),
                "canonicalTool": payload.get("canonicalTool"),
                "authorizationDecision": payload.get("authorizationDecision"),
                "locationCount": payload.get("locationCount"),
                "input": payload.get("input"),
                "output": payload.get("output"),
                "rawInputDigest": payload.get("rawInputDigest"),
                "rawOutputDigest": payload.get("rawOutputDigest"),
                "errorCode": payload.get("errorCode"),
                "idempotentReplay": payload.get("idempotentReplay"),
                "receiptId": payload.get("receiptId"),
                "operationProjection": payload.get("operationProjection"),
            });
            if let Some(core_envelope) = payload.get("coreEnvelope") {
                normalized["coreEnvelope"] = core_envelope.clone();
            }
            normalized
        }
        "activity.started" | "activity.completed" => {
            let item = payload.get("item").unwrap_or(&Value::Null);
            serde_json::json!({
                "reasonCode": payload.get("reasonCode"),
                "item": {
                    "id": item.get("id"),
                    "type": item.get("type"),
                    "status": item.get("status"),
                    "title": item.get("title"),
                    "command": item.get("command"),
                    "commandActions": public_command_actions(item),
                    "cwd": item.get("cwd"),
                    "durationMs": item.get("durationMs"),
                    "exitCode": item.get("exitCode"),
                    "aggregatedOutput": item.get("aggregatedOutput"),
                    "output": item.get("output").or_else(|| item.get("result")),
                    "summary": item.get("summary"),
                    "changes": item.get("changes"),
                    "tool": item.get("tool"),
                    "server": item.get("server"),
                    "error": item.get("error"),
                }
            })
        }
        _ => Value::Null,
    }
}

fn public_command_actions(item: &Value) -> Value {
    let Some(actions) = item.get("commandActions").and_then(Value::as_array) else {
        return Value::Null;
    };
    Value::Array(
        actions
            .iter()
            .map(|action| {
                serde_json::json!({
                    "type": action.get("type"),
                    "name": action.get("name"),
                    "path": action.get("path"),
                })
            })
            .collect(),
    )
}

fn phase_from_payload(payload: &Value) -> &'static str {
    match payload.get("status").and_then(Value::as_str) {
        Some("completed" | "succeeded") => "completed",
        Some("failed" | "declined" | "cancelled") => "failed",
        Some("inProgress" | "running" | "pending") => "updated",
        _ => "updated",
    }
}

fn activity_kind(payload: &Value) -> &'static str {
    match payload
        .pointer("/item/type")
        .and_then(Value::as_str)
        .unwrap_or_default()
    {
        "commandExecution" => "command",
        "fileChange" => "file_change",
        "reasoning" => "reasoning_summary",
        "plan" => "plan",
        "agentMessage" | "userMessage" => "narration",
        "mcpToolCall"
        | "dynamicToolCall"
        | "webSearch"
        | "imageGeneration"
        | "collabToolCall"
        | "collabAgentToolCall" => "tool_call",
        _ => "runtime_activity",
    }
}

fn source_event_key(event_type: &str, payload: &Value) -> Option<String> {
    if event_type.ends_with(".delta") || event_type == "file.change.updated" {
        return None;
    }
    let identity = payload
        .get("eventId")
        .or_else(|| payload.get("toolCallId"))
        .or_else(|| payload.pointer("/item/id"))
        .and_then(Value::as_str)?;
    if event_type == "runtime.action"
        && payload.get("idempotentReplay").and_then(Value::as_bool) == Some(true)
    {
        // A replay is not a second logical Tool call or effect, but every observed
        // invocation attempt remains distinct diagnostic evidence.
        return None;
    }
    let replay_observation = if event_type == "runtime.action" {
        match payload.get("idempotentReplay").and_then(Value::as_bool) {
            Some(false) => ":original",
            Some(true) | None => "",
        }
    } else {
        ""
    };
    Some(format!(
        "{event_type}:{identity}:{}{replay_observation}",
        phase_from_payload(payload)
    ))
}

fn bounded_preview(value: &Value) -> Value {
    match value {
        Value::String(value) => Value::String(truncate_chars(value, PREVIEW_STRING_LIMIT_CHARS)),
        Value::Array(values) => Value::Array(
            values
                .iter()
                .take(PREVIEW_ARRAY_LIMIT)
                .map(bounded_preview)
                .collect(),
        ),
        Value::Object(values) => {
            let mut preview = Map::new();
            for (key, value) in values.iter().take(PREVIEW_ARRAY_LIMIT) {
                preview.insert(key.clone(), bounded_preview(value));
            }
            preview.insert("_rovaiTruncated".to_string(), Value::Bool(true));
            Value::Object(preview)
        }
        value => value.clone(),
    }
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut truncated = value.chars().take(max_chars).collect::<String>();
    truncated.push_str("\n…（内容已截断，可按需读取完整证据）");
    truncated
}

fn load_by_source_key(
    transaction: &rusqlite::Transaction<'_>,
    agent_run_id: &str,
    source_event_key: &str,
) -> Result<Option<AgentRunExecutionEvidence>> {
    transaction
        .query_row(
            r#"
            SELECT id, agent_run_id, execution_epoch, sequence,
                   event_type, kind, phase, payload_preview_json,
                   content_blob_id, content_byte_count, is_truncated, occurred_at
            FROM agent_run_execution_evidence
            WHERE agent_run_id = ?1 AND source_event_key = ?2
            "#,
            params![agent_run_id, source_event_key],
            |row| {
                let payload: String = row.get(7)?;
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    payload,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, i64>(9)?,
                    row.get::<_, i64>(10)? != 0,
                    row.get::<_, String>(11)?,
                ))
            },
        )
        .optional()?
        .map(
            |(
                id,
                agent_run_id,
                execution_epoch,
                sequence,
                event_type,
                kind,
                phase,
                payload,
                content_blob_id,
                content_byte_count,
                is_truncated,
                occurred_at,
            )| {
                Ok(AgentRunExecutionEvidence {
                    id,
                    agent_run_id,
                    execution_epoch,
                    sequence,
                    event_type,
                    kind,
                    phase,
                    payload: serde_json::from_str(&payload)?,
                    content_blob_id,
                    content_byte_count,
                    is_truncated,
                    occurred_at,
                    canonical: None,
                })
            },
        )
        .transpose()
}

fn upsert_canonical_activity(
    transaction: &rusqlite::Transaction<'_>,
    agent_run_id: &str,
    execution_epoch: i64,
    sequence: i64,
    evidence_id: &str,
    occurred_at: &str,
    facts: &EvidenceActivityFacts,
) -> Result<Option<CanonicalRuntimeActivity>> {
    if !facts.is_activity {
        return Ok(None);
    }
    let existing = transaction
        .query_row(
            r#"
            SELECT operation_id, classifier_version, activity_domain,
                   semantic_kind, tool_name, presentation_hint, phase, outcome,
                   credibility, coverage_level, source_authority,
                   source_evidence_ids_json, first_evidence_sequence,
                   last_evidence_sequence, revision
            FROM canonical_runtime_activity
            WHERE agent_run_id = ?1
              AND execution_epoch = ?2
              AND operation_id = ?3
              AND classifier_version = ?4
            "#,
            params![
                agent_run_id,
                execution_epoch,
                facts.operation_id,
                canonical_activity::CLASSIFIER_VERSION,
            ],
            canonical_activity_row,
        )
        .optional()?;
    let projection = match existing {
        Some(existing) => {
            canonical_activity::merge_projection(existing, facts.clone(), evidence_id, sequence)
        }
        None => canonical_activity::new_projection(facts.clone(), evidence_id, sequence)
            .context("Activity Evidence must produce a Canonical Runtime Activity")?,
    };
    let now = chrono::Utc::now().to_rfc3339();
    let started_at = (facts.phase == "started").then_some(occurred_at);
    let terminal_at = (facts.phase == "terminal").then_some(occurred_at);
    transaction.execute(
        r#"
        INSERT INTO canonical_runtime_activity(
            agent_run_id, execution_epoch, operation_id, classifier_version,
            activity_domain, semantic_kind, tool_name, presentation_hint,
            phase, outcome, credibility, coverage_level, source_authority,
            source_evidence_ids_json, first_evidence_sequence,
            last_evidence_sequence, revision, created_at, updated_at,
            started_at, terminal_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
            ?14, ?15, ?16, ?17, ?18, ?18, ?19, ?20
        )
        ON CONFLICT(agent_run_id, execution_epoch, operation_id, classifier_version)
        DO UPDATE SET
            activity_domain = excluded.activity_domain,
            semantic_kind = excluded.semantic_kind,
            tool_name = excluded.tool_name,
            presentation_hint = excluded.presentation_hint,
            phase = excluded.phase,
            outcome = excluded.outcome,
            credibility = excluded.credibility,
            coverage_level = excluded.coverage_level,
            source_authority = excluded.source_authority,
            source_evidence_ids_json = excluded.source_evidence_ids_json,
            last_evidence_sequence = excluded.last_evidence_sequence,
            revision = excluded.revision,
            started_at = COALESCE(
                canonical_runtime_activity.started_at, excluded.started_at
            ),
            terminal_at = COALESCE(
                excluded.terminal_at, canonical_runtime_activity.terminal_at
            ),
            updated_at = excluded.updated_at
        "#,
        params![
            agent_run_id,
            execution_epoch,
            projection.operation_id,
            projection.classifier_version,
            projection.activity_domain,
            projection.semantic_kind,
            projection.tool_name,
            projection.presentation_hint,
            projection.phase,
            projection.outcome,
            projection.credibility,
            projection.coverage_level,
            projection.source_authority,
            serde_json::to_string(&projection.source_evidence_ids)?,
            projection.first_evidence_sequence,
            projection.last_evidence_sequence,
            projection.revision,
            now,
            started_at,
            terminal_at,
        ],
    )?;
    Ok(Some(projection))
}

fn load_canonical_for_evidence(
    transaction: &rusqlite::Transaction<'_>,
    evidence_id: &str,
) -> Result<Option<CanonicalRuntimeActivity>> {
    transaction
        .query_row(
            r#"
            SELECT activity.operation_id, activity.classifier_version,
                   activity.activity_domain, activity.semantic_kind,
                   activity.tool_name, activity.presentation_hint,
                   activity.phase, activity.outcome, activity.credibility,
                   activity.coverage_level, activity.source_authority,
                   activity.source_evidence_ids_json,
                   activity.first_evidence_sequence,
                   activity.last_evidence_sequence, activity.revision
            FROM canonical_runtime_activity AS activity
            JOIN agent_run_execution_evidence AS evidence
              ON evidence.agent_run_id = activity.agent_run_id
             AND evidence.execution_epoch = activity.execution_epoch
            WHERE evidence.id = ?1
              AND activity.classifier_version = ?2
              AND EXISTS (
                  SELECT 1
                  FROM json_each(activity.source_evidence_ids_json)
                  WHERE json_each.value = evidence.id
              )
            LIMIT 1
            "#,
            params![evidence_id, canonical_activity::CLASSIFIER_VERSION],
            canonical_activity_row,
        )
        .optional()
        .map_err(Into::into)
}

fn canonical_activity_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CanonicalRuntimeActivity> {
    let source_evidence_ids: String = row.get(11)?;
    Ok(CanonicalRuntimeActivity {
        operation_id: row.get(0)?,
        classifier_version: row.get(1)?,
        activity_domain: row.get(2)?,
        semantic_kind: row.get(3)?,
        tool_name: row.get(4)?,
        presentation_hint: row.get(5)?,
        phase: row.get(6)?,
        outcome: row.get(7)?,
        credibility: row.get(8)?,
        coverage_level: row.get(9)?,
        source_authority: row.get(10)?,
        source_evidence_ids: serde_json::from_str(&source_evidence_ids).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                11,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?,
        first_evidence_sequence: row.get(12)?,
        last_evidence_sequence: row.get(13)?,
        revision: row.get(14)?,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        collaboration::{
            AddCampMemberCommand, CollaborationService, CreateCampCommand, ExecutionRequest,
            TestCampMessageAddress, TestCampMessageCommand,
        },
        command::{ActorRef, CommandEnvelope},
        context::{
            CharterDeliveryMode, ContextMaterialization, ContextService,
            DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES, MaterializeContextRequest,
        },
        runtime::{
            AgentRunWorkspace, CancelCampTurnCommand, ClaimAgentRunCommand, ExecutionRuntimeService,
        },
        team_tool::TeamToolService,
    };
    use serde_json::json;

    #[test]
    fn provider_packets_are_reduced_to_public_evidence_fields() {
        let normalized = normalize_public_payload(
            "activity.completed",
            &json!({
                "threadId": "internal-thread",
                "hiddenProviderPacket": "must-not-persist",
                "item": {
                    "id": "command-1",
                    "type": "commandExecution",
                    "status": "completed",
                    "command": "pnpm test",
                    "commandActions": [{
                        "type": "read",
                        "name": "test",
                        "path": "/repo/package.json",
                        "command": "cat /repo/package.json",
                        "providerPrivateState": "must-not-persist"
                    }],
                    "aggregatedOutput": "99 tests passed",
                    "providerPrivateState": "must-not-persist"
                }
            }),
        );
        let encoded = serde_json::to_string(&normalized).unwrap();
        assert!(encoded.contains("pnpm test"));
        assert!(encoded.contains("99 tests passed"));
        assert_eq!(normalized["item"]["commandActions"][0]["type"], "read");
        assert_eq!(
            normalized["item"]["commandActions"][0]["path"],
            "/repo/package.json"
        );
        assert!(normalized["item"]["commandActions"][0]["command"].is_null());
        assert!(!encoded.contains("hiddenProviderPacket"));
        assert!(!encoded.contains("providerPrivateState"));
        assert!(!encoded.contains("internal-thread"));
    }

    #[test]
    fn ordinary_messages_and_unknown_activities_are_not_classified_as_tool_calls() {
        assert_eq!(
            activity_kind(&json!({"item": {"type": "agentMessage"}})),
            "narration"
        );
        assert_eq!(
            activity_kind(&json!({"item": {"type": "userMessage"}})),
            "narration"
        );
        assert_eq!(
            activity_kind(&json!({"item": {"type": "providerPrivateActivity"}})),
            "runtime_activity"
        );
        assert_eq!(
            activity_kind(&json!({"item": {"type": "mcpToolCall"}})),
            "tool_call"
        );
    }

    #[test]
    fn team_tool_results_keep_authoritative_ledger_fields_without_private_packets() {
        let normalized = normalize_public_payload(
            "runtime.action",
            &json!({
                "toolCallId": "tool-call-digest",
                "status": "failed",
                "kind": "mcp_tool_call",
                "title": "camp.message.send",
                "sourceAuthority": "core",
                "canonicalTool": "camp.message.send",
                "authorizationDecision": "indeterminate",
                "rawInputDigest": "input-digest",
                "rawOutputDigest": null,
                "errorCode": "team_tool.execution_budget_exhausted",
                "idempotentReplay": true,
                "receiptId": "receipt-1",
                "operationProjection": {
                    "schemaVersion": 1,
                    "operation": "camp.message.send",
                    "canonicalInput": {
                        "recipientAgentIds": ["agent_5"],
                        "contentDigest": "safe-content-digest"
                    },
                    "canonicalResult": null,
                    "digestBinding": {
                        "input": {
                            "evidenceField": "rawInputDigest",
                            "digest": "input-digest"
                        },
                        "result": null
                    },
                    "inputDigest": "input-digest",
                    "resultDigest": null,
                    "projectionDigest": "safe-projection-digest"
                },
                "coreEnvelope": {
                    "contractVersion": 1,
                    "ok": false,
                    "operation": "camp.message.send",
                    "requestId": "7b5db24c-4a43-4cab-9217-d982b08f7691",
                    "receipt": "sha256:full-envelope-receipt",
                    "error": {
                        "code": "message.execution_budget_exceeded",
                        "message": "budget exhausted",
                        "recovery": "fix_input"
                    }
                },
                "bindingCredential": "must-not-persist",
                "rawInput": { "content": "must-not-persist" }
            }),
        );
        assert_eq!(
            normalized["errorCode"],
            "team_tool.execution_budget_exhausted"
        );
        assert_eq!(normalized["idempotentReplay"], true);
        assert_eq!(normalized["receiptId"], "receipt-1");
        assert_eq!(normalized["sourceAuthority"], "core");
        assert_eq!(normalized["canonicalTool"], "camp.message.send");
        assert_eq!(
            normalized["operationProjection"]["operation"],
            "camp.message.send"
        );
        assert_eq!(
            normalized["operationProjection"]["canonicalInput"]["recipientAgentIds"][0],
            "agent_5"
        );
        assert_eq!(
            normalized["coreEnvelope"]["requestId"],
            "7b5db24c-4a43-4cab-9217-d982b08f7691"
        );
        let encoded = serde_json::to_string(&normalized).unwrap();
        assert!(!encoded.contains("bindingCredential"));
        assert!(!encoded.contains("must-not-persist"));
    }

    #[test]
    fn evidence_is_durable_blob_backed_agent_inaccessible_and_cancel_fenced() {
        let (mut database, directory) = crate::test_support::seeded_runtime_database();
        let workspace = directory.join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let collaboration = CollaborationService::default();
        let camp = collaboration
            .create_camp(
                &mut database,
                &CommandEnvelope {
                    command_id: Uuid::new_v4().to_string(),
                    actor: ActorRef::User {
                        user_id: "test-user".to_string(),
                    },
                    camp_id: None,
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: CreateCampCommand::for_test(workspace.display().to_string()),
                },
            )
            .unwrap();
        let camp_id = camp.result.payload["campId"].as_str().unwrap().to_string();
        collaboration
            .add_camp_member(
                &mut database,
                &CommandEnvelope {
                    command_id: Uuid::new_v4().to_string(),
                    actor: ActorRef::User {
                        user_id: "test-user".to_string(),
                    },
                    camp_id: Some(camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: AddCampMemberCommand {
                        camp_id: camp_id.clone(),
                        agent_id: "agent_2".to_string(),
                        capability_overrides: json!({}),
                    },
                },
            )
            .unwrap();
        let sent = collaboration
            .send_test_camp_message(
                &mut database,
                &CommandEnvelope {
                    command_id: Uuid::new_v4().to_string(),
                    actor: ActorRef::User {
                        user_id: "test-user".to_string(),
                    },
                    camp_id: Some(camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: TestCampMessageCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: None,
                        body: "Run with private execution evidence".to_string(),
                        prepared_attachment_ids: Vec::new(),
                        address: TestCampMessageAddress::Explicit {
                            agent_ids: vec!["agent_2".to_string()],
                        },
                        reply_to_camp_message_id: None,
                        execution: Some(ExecutionRequest {
                            task_id: None,
                            purpose: "Verify evidence boundaries".to_string(),
                            completion_role: "required".to_string(),
                            budget: None,
                        }),
                    },
                },
            )
            .unwrap();
        let run_id = sent.result.payload["agentRunIds"][0]
            .as_str()
            .unwrap()
            .to_string();
        let camp_turn_id = sent.result.payload["campTurnId"]
            .as_str()
            .unwrap()
            .to_string();
        let runtime = ExecutionRuntimeService::default();
        let candidate = runtime
            .list_dispatchable_agent_runs(&database, 10)
            .unwrap()
            .into_iter()
            .find(|candidate| candidate.agent_run_id == run_id)
            .unwrap();
        let claim = runtime
            .claim_agent_run(
                &mut database,
                &CommandEnvelope {
                    command_id: Uuid::new_v4().to_string(),
                    actor: ActorRef::System {
                        component_id: "agent-run-scheduler".to_string(),
                    },
                    camp_id: Some(camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: ClaimAgentRunCommand {
                        agent_run_id: run_id.clone(),
                        expected_version: candidate.version,
                        lease_owner: "test-scheduler".to_string(),
                        lease_seconds: 60,
                        workspace: Some(AgentRunWorkspace::runtime_managed_path(
                            workspace.display().to_string(),
                        )),
                        starting_git_observation: None,
                    },
                },
            )
            .unwrap();
        let execution_epoch = claim.result.payload["executionEpoch"].as_i64().unwrap();
        TeamToolService::default()
            .prepare_binding_credential(&mut database, &run_id, execution_epoch, false)
            .unwrap();
        let blob_store = ManagedBlobStore::new(&directory);
        let output_delta = json!({ "itemId": "command-1", "delta": "transport only" });
        for _ in 0..100_000 {
            let evidence = ExecutionEvidenceService
                .record_runtime_event(
                    &mut database,
                    &blob_store,
                    &run_id,
                    execution_epoch,
                    "command.output.delta",
                    &output_delta,
                )
                .unwrap();
            assert!(evidence.is_none());
        }
        let durable_delta_count: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM agent_run_execution_evidence WHERE agent_run_id = ?1 AND event_type = 'command.output.delta'",
                [&run_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(durable_delta_count, 0);
        assert!(
            ExecutionEvidenceService
                .command_output_delta_admission_open(&database, &run_id, execution_epoch)
                .unwrap()
        );
        assert!(
            !ExecutionEvidenceService
                .command_output_delta_admission_open(&database, &run_id, execution_epoch + 1)
                .unwrap()
        );
        database
            .connection()
            .execute_batch("SAVEPOINT command_output_terminal_fence")
            .unwrap();
        let terminal_probe_at = chrono::Utc::now().to_rfc3339();
        database
            .connection()
            .execute(
                "UPDATE agent_run SET status = 'failed', ended_at = ?2, updated_at = ?2 WHERE id = ?1",
                params![run_id, terminal_probe_at],
            )
            .unwrap();
        assert!(
            !ExecutionEvidenceService
                .command_output_delta_admission_open(&database, &run_id, execution_epoch)
                .unwrap()
        );
        database
            .connection()
            .execute_batch(
                "ROLLBACK TO command_output_terminal_fence; RELEASE command_output_terminal_fence",
            )
            .unwrap();
        assert!(
            ExecutionEvidenceService
                .command_output_delta_admission_open(&database, &run_id, execution_epoch)
                .unwrap()
        );

        let secret = format!("EVIDENCE_ONLY_{}", "x".repeat(573_647));
        let started_command = ExecutionEvidenceService
            .record_runtime_event(
                &mut database,
                &blob_store,
                &run_id,
                execution_epoch,
                "activity.started",
                &json!({
                    "item": {
                        "id": "command-1",
                        "type": "commandExecution",
                        "command": "cargo test",
                        "status": "inProgress",
                    }
                }),
            )
            .unwrap()
            .unwrap();
        assert_eq!(started_command.sequence, 1);
        let evidence = ExecutionEvidenceService
            .record_runtime_event(
                &mut database,
                &blob_store,
                &run_id,
                execution_epoch,
                "activity.completed",
                &json!({
                    "item": {
                        "id": "command-1",
                        "type": "commandExecution",
                        "command": "cargo test",
                        "status": "completed",
                        "exitCode": 0,
                        "aggregatedOutput": secret,
                    }
                }),
            )
            .unwrap()
            .unwrap();
        assert!(evidence.inserted);
        assert!(evidence.is_truncated);
        assert!(evidence.content_blob_id.is_some());
        assert_eq!(evidence.sequence, 2);
        let canonical = evidence
            .canonical
            .as_ref()
            .expect("activity Evidence should persist its Canonical Projection");
        assert_eq!(canonical.activity_domain, "shell");
        assert_eq!(canonical.semantic_kind.as_deref(), Some("shell.execute"));
        assert_eq!(evidence.payload["item"]["command"], "cargo test");
        assert_eq!(evidence.payload["item"]["status"], "completed");
        assert_eq!(evidence.payload["item"]["exitCode"], 0);
        let full_payload = ExecutionEvidenceService
            .read_full_payload(&database, &blob_store, &camp_id, &evidence.id)
            .unwrap();
        assert_eq!(full_payload["item"]["aggregatedOutput"], secret);
        let canonical_count: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM canonical_runtime_activity WHERE agent_run_id = ?1 AND execution_epoch = ?2",
                params![run_id, execution_epoch],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(canonical_count, 1);

        let prepared_batch = [
            (
                "agent.text.delta",
                json!({"itemId": "message-1", "delta": "hello "}),
            ),
            (
                "agent.text.delta",
                json!({"itemId": "message-2", "delta": "world"}),
            ),
            (
                "agent.text.delta",
                json!({"itemId": "message-3", "delta": "!"}),
            ),
        ]
        .into_iter()
        .map(|(event_type, payload)| {
            ExecutionEvidenceService
                .prepare_runtime_event(event_type, &payload)
                .unwrap()
                .unwrap()
        })
        .collect::<Vec<_>>();
        assert!(
            prepared_batch
                .iter()
                .all(PreparedRuntimeEvidence::is_inline_delta_batchable)
        );
        let batch = ExecutionEvidenceService
            .record_prepared_runtime_event_batch(
                &mut database,
                &run_id,
                execution_epoch,
                prepared_batch,
            )
            .unwrap()
            .into_iter()
            .map(Option::unwrap)
            .collect::<Vec<_>>();
        assert_eq!(
            batch
                .iter()
                .map(|evidence| evidence.sequence)
                .collect::<Vec<_>>(),
            vec![3, 4, 5]
        );
        assert_eq!(batch[0].payload["delta"], "hello ");
        assert!(batch.iter().all(|evidence| evidence.canonical.is_none()));

        let runtime_diagnostic = ExecutionEvidenceService
            .prepare_runtime_event(
                "runtime.diagnostic",
                &json!({
                    "diagnosticId": "claude-api-retry",
                    "code": "runtime_api_retrying",
                    "status": "retrying",
                    "attempt": 1,
                    "maxAttempts": 10,
                    "retryAfterSeconds": 0,
                    "rawDetail": "api_key=private-key",
                }),
            )
            .unwrap()
            .unwrap();
        assert_eq!(runtime_diagnostic.kind, "step");
        assert_eq!(runtime_diagnostic.phase, "updated");
        assert_eq!(runtime_diagnostic.payload["attempt"], 1);
        assert!(runtime_diagnostic.payload.get("rawDetail").is_none());
        assert!(!runtime_diagnostic.is_inline_delta_batchable());

        let oversized = ExecutionEvidenceService
            .prepare_runtime_event(
                "agent.text.delta",
                &json!({"itemId": "message-2", "delta": "x".repeat(20_000)}),
            )
            .unwrap()
            .unwrap();
        assert!(!oversized.is_inline_delta_batchable());
        assert!(ExecutionEvidenceService::is_batchable_runtime_delta_event(
            "file.change.updated"
        ));
        assert!(!ExecutionEvidenceService::is_batchable_runtime_delta_event(
            "runtime.action"
        ));

        let started_tool = ExecutionEvidenceService
            .record_builtin_tool_started(
                &mut database,
                &blob_store,
                &run_id,
                execution_epoch,
                &json!({
                    "toolCallId": "team-tool-call-started",
                    "status": "started",
                    "kind": "builtin_tool_invocation",
                    "sourceAuthority": "core",
                    "canonicalTool": "camp.message.send",
                    "authorizationDecision": "allowed",
                    "rawInputDigest": "input-digest",
                    "rawOutputDigest": null,
                    "idempotentReplay": false,
                    "receiptId": null,
                }),
            )
            .unwrap()
            .expect("a Built-in Tool start must be durable before execution");
        assert!(started_tool.inserted);
        assert_eq!(started_tool.sequence, 6);

        let interrupted_started = ExecutionEvidenceService
            .record_runtime_event(
                &mut database,
                &blob_store,
                &run_id,
                execution_epoch,
                "activity.started",
                &json!({
                    "item": {
                        "id": "command-interrupted",
                        "type": "commandExecution",
                        "command": "long-running-command",
                        "status": "inProgress",
                    }
                }),
            )
            .unwrap()
            .unwrap();
        assert_eq!(interrupted_started.sequence, 7);

        let materialized = ContextService
            .materialize(
                &mut database,
                &blob_store,
                &MaterializeContextRequest {
                    agent_run_id: &run_id,
                    execution_epoch,
                    charter_delivery_mode: CharterDeliveryMode::NativeAppend,
                    max_payload_bytes: DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES,
                },
            )
            .unwrap();
        let ContextMaterialization::Ready(context) = materialized else {
            panic!("small Camp context should materialize");
        };
        assert!(!context.rendered_payload.contains("EVIDENCE_ONLY_"));

        let turn_version: i64 = database
            .connection()
            .query_row(
                "SELECT version FROM camp_turn WHERE id = ?1",
                [&camp_turn_id],
                |row| row.get(0),
            )
            .unwrap();
        runtime
            .request_camp_turn_cancellation(
                &mut database,
                &CommandEnvelope {
                    command_id: Uuid::new_v4().to_string(),
                    actor: ActorRef::User {
                        user_id: "test-user".to_string(),
                    },
                    camp_id: Some(camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: CancelCampTurnCommand {
                        camp_id,
                        camp_turn_id,
                        expected_version: turn_version,
                    },
                },
            )
            .unwrap();
        assert!(
            !ExecutionEvidenceService
                .command_output_delta_admission_open(&database, &run_id, execution_epoch)
                .unwrap()
        );
        let interrupted = ExecutionEvidenceService
            .record_interrupted_runtime_activity(
                &mut database,
                &blob_store,
                &run_id,
                execution_epoch,
                &json!({
                    "reasonCode": "runtime_interrupted",
                    "item": {
                        "id": "command-interrupted",
                        "type": "commandExecution",
                        "command": "long-running-command",
                        "status": "interrupted",
                        "aggregatedOutput": null,
                    }
                }),
            )
            .unwrap()
            .expect("an already-started Activity must receive one interruption terminal");
        assert_eq!(interrupted.sequence, 8);
        assert_eq!(interrupted.payload["reasonCode"], "runtime_interrupted");
        let interrupted_canonical = interrupted.canonical.as_ref().unwrap();
        assert_eq!(interrupted_canonical.phase, "terminal");
        assert_eq!(interrupted_canonical.outcome, "unsettled");
        let late = ExecutionEvidenceService
            .record_runtime_event(
                &mut database,
                &blob_store,
                &run_id,
                execution_epoch,
                "agent.thought.delta",
                &json!({ "delta": "must be fenced" }),
            )
            .unwrap();
        assert!(late.is_none());
        let fenced_batch = ["late one", "late two"]
            .into_iter()
            .map(|delta| {
                ExecutionEvidenceService
                    .prepare_runtime_event(
                        "agent.text.delta",
                        &json!({"itemId": "message-3", "delta": delta}),
                    )
                    .unwrap()
                    .unwrap()
            })
            .collect();
        let fenced_batch = ExecutionEvidenceService
            .record_prepared_runtime_event_batch(
                &mut database,
                &run_id,
                execution_epoch,
                fenced_batch,
            )
            .unwrap();
        assert!(fenced_batch.iter().all(Option::is_none));

        let failed_tool_result = json!({
            "toolCallId": "team-tool-call-1",
            "status": "failed",
            "kind": "mcp_tool_call",
            "title": "camp.message.send",
            "rawInputDigest": "input-digest",
            "rawOutputDigest": null,
            "errorCode": "team_tool.execution_budget_exhausted",
            "idempotentReplay": false,
            "receiptId": null,
        });
        let failed = ExecutionEvidenceService
            .record_builtin_tool_result(
                &mut database,
                &blob_store,
                &run_id,
                execution_epoch,
                &failed_tool_result,
            )
            .unwrap()
            .expect("terminal Team Tool result must survive the Turn fence");
        assert!(failed.inserted);
        assert_eq!(failed.sequence, 9);
        assert_eq!(
            failed.payload["errorCode"],
            "team_tool.execution_budget_exhausted"
        );

        let duplicate = ExecutionEvidenceService
            .record_builtin_tool_result(
                &mut database,
                &blob_store,
                &run_id,
                execution_epoch,
                &failed_tool_result,
            )
            .unwrap()
            .unwrap();
        assert!(!duplicate.inserted);
        assert_eq!(duplicate.id, failed.id);

        let mut replay_tool_result = failed_tool_result.clone();
        replay_tool_result["idempotentReplay"] = json!(true);
        let replay = ExecutionEvidenceService
            .record_builtin_tool_result(
                &mut database,
                &blob_store,
                &run_id,
                execution_epoch,
                &replay_tool_result,
            )
            .unwrap()
            .expect("the first replay observation must remain visible");
        assert!(replay.inserted);
        assert_eq!(replay.sequence, 10);
        assert_eq!(replay.payload["idempotentReplay"], true);

        let replay_duplicate = ExecutionEvidenceService
            .record_builtin_tool_result(
                &mut database,
                &blob_store,
                &run_id,
                execution_epoch,
                &replay_tool_result,
            )
            .unwrap()
            .unwrap();
        assert!(replay_duplicate.inserted);
        assert_ne!(replay_duplicate.id, replay.id);
        assert_eq!(replay_duplicate.sequence, 11);

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
